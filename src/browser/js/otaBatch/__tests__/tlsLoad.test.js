// loadTlsFile thunk + the TLS<->config/firmware mutual-exclusion reducer
// transitions. Real store/reducer/cache/evaluate; the firmware parsing trio is
// mocked only for the firmware-load-clears-TLS direction.

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
    migration: {
      ...actual.migration,
      firmwareSpan: jest.fn(() => 128),
      parseFirmwareBin: jest.fn(),
      checkKnownFirmware: jest.fn(() => true)
    }
  };
});
jest.mock("config-editor-base", () => {
  const actual = jest.requireActual("config-editor-base");
  return { ...actual, loadFile: jest.fn() };
});

import { createStore, combineReducers, applyMiddleware } from "redux";
import thunk from "redux-thunk";

import * as alertActions from "../../alert/actions";
import { migration } from "config-editor-tools";
import { loadFile } from "config-editor-base";
import otaBatchReducer from "../reducer";
import * as actions from "../actions";
import * as cache from "../cache";
import { TLS_MAX_FILE_SIZE } from "../constants";

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
    connect: { type: "object" }
  }
};

const baseConfig = () => ({
  general: { device: { meta: "fleet-x" }, security: { kpub: "" } },
  log: { file: { split_size: 10 } },
  can_1: { phy: { mode: 0 } },
  can_2: { phy: { mode: 0 } }
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

const seedLoaded = (id, config = baseConfig()) => {
  const text = JSON.stringify(config, null, 2);
  cache.setConfig(id, text);
  cache.setSchema(id, JSON.stringify(SCHEMA));
  const crc = cache.crc32Hex(text);
  return {
    deviceFile: { ...deviceJsonFor(id), cfg_crc32: crc },
    artifact: {
      config: { status: "loaded", crc32: crc },
      schema: { status: "loaded" }
    },
    crc
  };
};

const makeLoadedStore = (id, extra = {}) => {
  const { deviceFile, artifact } = seedLoaded(id);
  return makeStore({
    devices: [id],
    devicesLoaded: true,
    artifactsRequested: true,
    deviceFiles: { [id]: deviceFile },
    heartbeats: { [id]: Date.now() },
    artifacts: { [id]: artifact },
    ...extra
  });
};

const p7bFile = (overrides = {}) => ({
  name: "certs_server.p7b",
  size: 4096,
  ...overrides
});

const fakeBin = () => {
  const buf = new ArrayBuffer(64);
  return {
    name: "firmware.bin",
    size: 1024,
    slice: jest.fn(() => ({ arrayBuffer: () => Promise.resolve(buf) }))
  };
};

const officialFw = () => ({
  deviceType: "CANedge2",
  fwVer: "01.09.05",
  revision: "01.09",
  defaultConfig: baseConfig()
});

const lastAlert = () => {
  const calls = alertActions.set.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
};

beforeEach(() => {
  cache.clearAll();
  migration.firmwareSpan.mockClear().mockReturnValue(128);
  migration.parseFirmwareBin.mockReset();
  migration.checkKnownFirmware.mockClear().mockReturnValue(true);
  loadFile.mockReset().mockReturnValue(SCHEMA);
  alertActions.set.mockClear();
  global.fetch = jest.fn();
});

describe("loadTlsFile", () => {
  it("loads a valid certs_server.p7b: cache + redux summary set, evaluations re-run", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    const file = p7bFile();

    await store.dispatch(actions.loadTlsFile(file));

    const s = store.getState().otaBatch;
    expect(s.loadedTls).toEqual({ fileName: "certs_server.p7b", size: 4096 });
    expect(s.activeTab).toBe("tls");
    expect(cache.getTls().file).toBe(file);
    // device fw_ver 01.09.01 -> supported revision, eligible for the cert push
    expect(s.evaluations[id].eligible).toBe(true);
    expect(s.evaluations[id].tls).toEqual({ willUpdate: true });
    expect(alertActions.set).not.toHaveBeenCalled();
  });

  it("rejects any other file name (alert, nothing loaded)", async () => {
    const store = makeLoadedStore("AABBCCDD");

    await store.dispatch(actions.loadTlsFile(p7bFile({ name: "certs.p7b" })));

    expect(store.getState().otaBatch.loadedTls).toBeNull();
    expect(cache.getTls()).toBeNull();
    expect(lastAlert().message).toContain('named "certs_server.p7b"');
  });

  it("rejects an empty file", async () => {
    const store = makeLoadedStore("AABBCCDD");

    await store.dispatch(actions.loadTlsFile(p7bFile({ size: 0 })));

    expect(store.getState().otaBatch.loadedTls).toBeNull();
    expect(lastAlert().message).toContain("empty");
  });

  it("rejects an oversized file", async () => {
    const store = makeLoadedStore("AABBCCDD");

    await store.dispatch(
      actions.loadTlsFile(p7bFile({ size: TLS_MAX_FILE_SIZE + 1 }))
    );

    expect(store.getState().otaBatch.loadedTls).toBeNull();
    expect(lastAlert().message).toContain("larger than");
  });

  it("clears a loaded partial, the encrypt toggle and a loaded firmware (mutual exclusion)", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id, {
      partial: { general: { device: { meta: "x" } } },
      encryptPasswords: true
    });
    migration.parseFirmwareBin.mockReturnValue(officialFw());
    await store.dispatch(actions.loadFirmwareFile(fakeBin()));
    expect(cache.getFirmware()).not.toBeNull();

    await store.dispatch(actions.loadTlsFile(p7bFile()));

    const s = store.getState().otaBatch;
    expect(s.loadedTls).not.toBeNull();
    expect(s.partial).toBeNull();
    expect(s.encryptPasswords).toBe(false);
    expect(s.loadedFirmware).toBeNull();
    expect(cache.getFirmware()).toBeNull();
  });
});

describe("clearTls", () => {
  it("drops cache + redux state and re-evaluates (devices selectable again)", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    await store.dispatch(actions.loadTlsFile(p7bFile()));
    expect(store.getState().otaBatch.evaluations[id].tls).toBeDefined();

    await store.dispatch(actions.clearTls());

    const s = store.getState().otaBatch;
    expect(s.loadedTls).toBeNull();
    expect(cache.getTls()).toBeNull();
    // base (no-TLS) evaluation restored, not an empty map
    expect(s.evaluations[id]).toBeDefined();
    expect(s.evaluations[id].tls).toBeUndefined();
    expect(s.evaluations[id].eligible).toBe(false); // no partial -> no change
  });
});

describe("other loads clear a loaded TLS bundle (mutual exclusion, other directions)", () => {
  it("SET_PARTIAL resets loadedTls in redux AND drops the cached File", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    await store.dispatch(actions.loadTlsFile(p7bFile()));
    expect(cache.getTls()).not.toBeNull();

    await store.dispatch(
      actions.loadPartialFile(
        "p.json",
        JSON.stringify({ general: { device: { meta: "y" } } })
      )
    );

    const s = store.getState().otaBatch;
    expect(s.loadedTls).toBeNull();
    expect(s.activeTab).toBe("config");
    expect(cache.getTls()).toBeNull();
  });

  it("SET_FIRMWARE resets loadedTls in redux AND drops the cached File", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    await store.dispatch(actions.loadTlsFile(p7bFile()));
    expect(cache.getTls()).not.toBeNull();

    migration.parseFirmwareBin.mockReturnValue(officialFw());
    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    const s = store.getState().otaBatch;
    expect(s.loadedFirmware).not.toBeNull();
    expect(s.loadedTls).toBeNull();
    expect(s.activeTab).toBe("fw");
    expect(cache.getTls()).toBeNull();
  });
});

describe("run-active guards", () => {
  const runActive = { run: { ...initial.run, active: true } };

  it("loadTlsFile is a no-op during a run", async () => {
    const store = makeStore(runActive);

    await store.dispatch(actions.loadTlsFile(p7bFile()));

    expect(store.getState().otaBatch.loadedTls).toBeNull();
    expect(cache.getTls()).toBeNull();
  });

  it("clearTls is a no-op during a run", async () => {
    const loadedTls = { fileName: "certs_server.p7b", size: 4096 };
    const store = makeStore({ ...runActive, loadedTls });

    await store.dispatch(actions.clearTls());

    expect(store.getState().otaBatch.loadedTls).toEqual(loadedTls);
  });
});
