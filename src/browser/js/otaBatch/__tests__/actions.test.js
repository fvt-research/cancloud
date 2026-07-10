// Thunk tests. Uses a REAL redux store (reducer + thunk) so state updates flow
// through multi-step thunks (evaluateAll, retryFailed), with the S3 surface
// (web + global fetch), the submit engine, history and crypto mocked. cache and
// evaluate run for real so evaluations are authentic.

// detect-browser returns null under jsdom - mock before config-editor-base
jest.mock("detect-browser", () => ({ detect: () => ({ name: "chrome" }) }));

jest.mock("../../web", () => ({
  __esModule: true,
  default: {
    LoggedIn: jest.fn(() => true),
    PresignedGet: jest.fn(({ bucket, object }) =>
      Promise.resolve({ url: "http://fake/" + bucket + "/" + object })
    ),
    PutObject: jest.fn(() => Promise.resolve())
  }
}));
jest.mock("../../history", () => ({
  __esModule: true,
  default: { push: jest.fn(), location: { pathname: "/ota-batch-manager/" } }
}));
jest.mock("../../dashboardStatus/actions", () => ({
  fetchDeviceFileContentAll: jest.fn(() => () => Promise.resolve([]))
}));
jest.mock("../../alert/actions", () => ({
  set: jest.fn((alert) => ({ type: "alert/SET", alert }))
}));
jest.mock("../submitEngine", () => ({
  startRun: jest.fn(() => Promise.resolve()),
  retryRun: jest.fn(() => Promise.resolve()),
  abortRun: jest.fn(),
  invalidateRun: jest.fn()
}));
jest.mock("config-editor-tools", () => {
  const actual = jest.requireActual("config-editor-tools");
  return {
    ...actual,
    encryptionCrypto: { ...actual.encryptionCrypto, deriveEncryptionMaterial: jest.fn() },
    encryptionFields: { ...actual.encryptionFields, buildEncryptedDelta: jest.fn() }
  };
});

import { createStore, combineReducers, applyMiddleware } from "redux";
import thunk from "redux-thunk";

import web from "../../web";
import * as alertActions from "../../alert/actions";
import { encryptionCrypto, encryptionFields } from "config-editor-tools";
import otaBatchReducer from "../reducer";
import * as actions from "../actions";
import * as engine from "../submitEngine";
import * as cache from "../cache";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["general", "log", "can_1", "can_2"],
  properties: {
    general: {
      type: "object",
      properties: {
        device: { type: "object", properties: { meta: { type: "string" } } },
        security: { type: "object", properties: { kpub: { type: "string" } } }
      }
    },
    log: { type: "object" },
    can_1: { type: "object" },
    can_2: { type: "object" },
    connect: {
      type: "object",
      properties: {
        wifi: {
          type: "object",
          properties: {
            keyformat: { type: "integer", enum: [0, 1] },
            accesspoint: { type: "array" }
          }
        },
        s3: { type: "object" }
      }
    }
  }
};

const baseConfig = (endpoint = "http://s3.example.com") => ({
  general: { device: { meta: "fleet-x" }, security: { kpub: "" } },
  log: { file: { split_size: 10 } },
  can_1: { phy: { mode: 0 } },
  can_2: { phy: { mode: 0 } },
  connect: {
    wifi: { keyformat: 0, accesspoint: [{ ssid: "net", pwd: "pass" }] },
    s3: { server: { endpoint, port: 80, keyformat: 0, secretkey: "secret" } }
  }
});

const deviceJsonFor = (id) => ({
  id,
  type: "0000001F",
  kpub: "A".repeat(88),
  fw_ver: "01.09.01",
  cfg_ver: "01.09",
  cfg_name: "config-01.09.json",
  sch_name: "schema-01.09.json",
  cfg_crc32: "",
  log_meta: "device-" + id
});

const initial = otaBatchReducer(undefined, { type: "@@INIT" });
const makeStore = (otaOverrides = {}) =>
  createStore(
    combineReducers({ otaBatch: otaBatchReducer }),
    { otaBatch: { ...initial, ...otaOverrides } },
    applyMiddleware(thunk)
  );

// seed cache + return the artifact/deviceFile pieces for a loaded device
const seedLoaded = (id, config = baseConfig()) => {
  const text = JSON.stringify(config, null, 2);
  cache.setConfig(id, text);
  cache.setSchema(id, JSON.stringify(SCHEMA));
  const crc = cache.crc32Hex(text);
  return {
    deviceFile: { ...deviceJsonFor(id), cfg_crc32: crc },
    artifact: { config: { status: "loaded", crc32: crc }, schema: { status: "loaded" } },
    crc
  };
};

beforeEach(() => {
  cache.clearAll();
  web.LoggedIn.mockReturnValue(true);
  web.PresignedGet.mockClear();
  web.PutObject.mockClear();
  engine.startRun.mockClear();
  engine.retryRun.mockClear();
  engine.abortRun.mockClear();
  engine.invalidateRun.mockClear();
  encryptionCrypto.deriveEncryptionMaterial.mockReset();
  encryptionFields.buildEncryptedDelta.mockReset();
  alertActions.set.mockClear();
  global.fetch = jest.fn();
});

describe("loadPartialFile", () => {
  it("records a blocker for invalid JSON and stores no partial", async () => {
    const store = makeStore();
    await store.dispatch(actions.loadPartialFile("p.json", "{ not json"));
    const s = store.getState().otaBatch;
    expect(s.partialBlockers.length).toBe(1);
    expect(s.partialBlockers[0]).toContain("not valid JSON");
  });

  it("blocks a partial that broadcasts a device-specific kpub (B5)", async () => {
    const store = makeStore();
    await store.dispatch(
      actions.loadPartialFile("p.json", JSON.stringify({ general: { security: { kpub: "SOMEKEY" } } }))
    );
    const s = store.getState().otaBatch;
    expect(s.partial).toEqual({ general: { security: { kpub: "SOMEKEY" } } });
    expect(s.partialBlockers.some((b) => b.includes("device-specific"))).toBe(true);
  });

  it("accepts a clean partial (no blockers)", async () => {
    const store = makeStore();
    await store.dispatch(
      actions.loadPartialFile("p.json", JSON.stringify({ connect: { s3: { server: { port: 443 } } } }))
    );
    const s = store.getState().otaBatch;
    expect(s.partialBlockers).toEqual([]);
    expect(s.partial).toEqual({ connect: { s3: { server: { port: 443 } } } });
  });
});

describe("evaluateAll", () => {
  it("produces an eligible evaluation for a valid partial change", () => {
    const id = "AABBCCDD";
    const { deviceFile, artifact } = seedLoaded(id);
    const store = makeStore({
      devices: [id],
      devicesLoaded: true,
      deviceFiles: { [id]: deviceFile },
      heartbeats: { [id]: Date.now() },
      artifacts: { [id]: artifact },
      partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } }
    });
    store.dispatch(actions.evaluateAll());
    const evalr = store.getState().otaBatch.evaluations[id];
    expect(evalr.status).toBe("eligible");
    expect(evalr.eligible).toBe(true);
    expect(evalr.partialChanges).toBe(true);
  });

  it("suppresses evaluation entirely when the partial has batch blockers", () => {
    const id = "AABBCCDD";
    const { deviceFile, artifact } = seedLoaded(id);
    const store = makeStore({
      devices: [id],
      devicesLoaded: true,
      deviceFiles: { [id]: deviceFile },
      artifacts: { [id]: artifact },
      partial: { general: { security: { kpub: "X" } } },
      partialBlockers: ["blocked"]
    });
    store.dispatch(actions.evaluateAll());
    expect(store.getState().otaBatch.evaluations).toEqual({});
  });
});

describe("startRun", () => {
  const evalState = () => ({
    selected: { A: true, B: true, C: true },
    evaluations: {
      A: { eligible: true, partialChanges: true, enc: { hasPlain: false, compatible: false } },
      B: { eligible: true, partialChanges: false, enc: { hasPlain: false, compatible: false } },
      C: { eligible: false }
    },
    encryptPasswords: false
  });

  it("submits only devices that will actually change", () => {
    const store = makeStore(evalState());
    store.dispatch(actions.startRun());
    expect(engine.startRun).toHaveBeenCalledTimes(1);
    expect(engine.startRun.mock.calls[0][2]).toEqual(["A"]);
  });

  it("is a no-op while a run is already active", () => {
    const store = makeStore({ ...evalState(), run: { ...initial.run, active: true } });
    store.dispatch(actions.startRun());
    expect(engine.startRun).not.toHaveBeenCalled();
  });
});

describe("retryFailed", () => {
  it("is a no-op while a run is active or when nothing failed", () => {
    const active = makeStore({ run: { ...initial.run, active: true, deviceStatus: { A: { state: "error" } } } });
    active.dispatch(actions.retryFailed());
    expect(engine.retryRun).not.toHaveBeenCalled();

    const none = makeStore({ run: { ...initial.run, deviceStatus: { A: { state: "submitted" } } } });
    none.dispatch(actions.retryFailed());
    expect(engine.retryRun).not.toHaveBeenCalled();
  });

  it("re-queues still-ready devices, converges applied ones, and re-blocks broken ones", async () => {
    const A = "AABBCC01"; // still needs the change -> ready -> re-queued
    const B = "AABBCC02"; // fresh config already has the change -> converged
    const C = "AABBCC03"; // fresh config unparseable -> blocked
    const partial = { connect: { s3: { server: { endpoint: "http://target" } } } };

    // cache/schema for all three (config comes fresh from fetch below)
    [A, B, C].forEach((id) => cache.setSchema(id, JSON.stringify(SCHEMA)));

    const configTextById = {
      [A]: JSON.stringify(baseConfig("http://s3.example.com"), null, 2), // != target -> change
      [B]: JSON.stringify(baseConfig("http://target"), null, 2), // == target -> no change
      [C]: "{ broken json"
    };

    global.fetch = jest.fn((url) => {
      if (url.indexOf("/schema-") > -1) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(SCHEMA)) });
      }
      const id = url.split("/")[3];
      return Promise.resolve({ ok: true, text: () => Promise.resolve(configTextById[id]) });
    });

    const store = makeStore({
      devices: [A, B, C],
      devicesLoaded: true,
      deviceFiles: { [A]: deviceJsonFor(A), [B]: deviceJsonFor(B), [C]: deviceJsonFor(C) },
      heartbeats: { [A]: Date.now(), [B]: Date.now(), [C]: Date.now() },
      partial,
      run: {
        ...initial.run,
        deviceStatus: {
          [A]: { state: "error" }, [B]: { state: "error" }, [C]: { state: "error" }
        }
      }
    });

    await store.dispatch(actions.retryFailed());

    // A still needs the change -> handed to the engine
    expect(engine.retryRun).toHaveBeenCalledTimes(1);
    expect(engine.retryRun.mock.calls[0][2]).toEqual([A]);

    // B converged (already applied) and C is broken -> both reflected in run status
    const st = store.getState().otaBatch.run.deviceStatus;
    expect(st[B].state).toBe("submitted");
    expect(st[B].message).toContain("No changes");
    expect(st[C].state).toBe("error");
  });
});

describe("run-active guards", () => {
  it("clearPartial is ignored while a run is active", () => {
    const store = makeStore({ partial: { a: 1 }, run: { ...initial.run, active: true } });
    store.dispatch(actions.clearPartial());
    expect(store.getState().otaBatch.partial).toEqual({ a: 1 });
  });

  it("clearPartial clears when no run is active", () => {
    const store = makeStore({ partial: { a: 1 } });
    store.dispatch(actions.clearPartial());
    expect(store.getState().otaBatch.partial).toBeNull();
  });

  it("setEncryptPasswords is ignored while a run is active", () => {
    const store = makeStore({ encryptPasswords: false, run: { ...initial.run, active: true } });
    store.dispatch(actions.setEncryptPasswords(true));
    expect(store.getState().otaBatch.encryptPasswords).toBe(false);
  });
});

describe("teardownView", () => {
  it("invalidates the run, clears the cache and resets the slice", () => {
    cache.setConfig("X", JSON.stringify(baseConfig()));
    const store = makeStore({ partial: { a: 1 }, devices: ["X"] });
    store.dispatch(actions.teardownView());
    expect(engine.invalidateRun).toHaveBeenCalledTimes(1);
    expect(cache.getConfig("X")).toBeUndefined();
    expect(store.getState().otaBatch).toEqual(initial);
  });
});

describe("downloadNewConfig", () => {
  let createdAnchors;
  let realCreate;
  beforeEach(() => {
    createdAnchors = [];
    realCreate = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === "a") createdAnchors.push(el);
      return el;
    });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("downloads the exact merged text in partial mode", async () => {
    const id = "AABBCCDD";
    const merged = baseConfig("http://new-host");
    const mergedText = JSON.stringify(merged, null, 2);
    cache.setMergedResult(id, { merged, mergedText });
    const store = makeStore({
      deviceFiles: { [id]: deviceJsonFor(id) },
      evaluations: { [id]: { enc: { hasPlain: true, compatible: true } } },
      selected: {},
      encryptPasswords: false
    });

    await store.dispatch(actions.downloadNewConfig(id));

    expect(createdAnchors.length).toBe(1);
    expect(createdAnchors[0].download).toBe(id + "_config-01.09.json");
    const body = decodeURIComponent(createdAnchors[0].href.split(",")[1]);
    expect(body).toBe(mergedText);
  });

  it("builds an encrypted preview (per-device key) when the encrypt toggle is active", async () => {
    const id = "AABBCCDD";
    cache.setConfig(id, JSON.stringify(baseConfig()));
    encryptionCrypto.deriveEncryptionMaterial.mockResolvedValue({
      symmetricKey: "SK",
      serverPublicKeyBase64: "PUB"
    });
    encryptionFields.buildEncryptedDelta.mockResolvedValue({
      general: { security: { kpub: "PUB" } },
      connect: { wifi: { keyformat: 1, accesspoint: [{ ssid: "net", pwd: "ENC" }] } }
    });
    const store = makeStore({
      deviceFiles: { [id]: deviceJsonFor(id) },
      evaluations: { [id]: { eligible: true, enc: { hasPlain: true, compatible: true } } },
      selected: { [id]: true },
      encryptPasswords: true
    });

    await store.dispatch(actions.downloadNewConfig(id));

    expect(encryptionCrypto.deriveEncryptionMaterial).toHaveBeenCalledWith("A".repeat(88));
    expect(createdAnchors.length).toBe(1);
    const body = decodeURIComponent(createdAnchors[0].href.split(",")[1]);
    expect(body).toContain("PUB"); // the encrypted preview carries the new kpub
  });
});
