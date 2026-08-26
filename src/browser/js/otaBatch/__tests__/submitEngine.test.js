// Submit-engine tests - the code that actually writes configs to S3, and the
// least-forgiving path in the whole feature. Mirrors canedge_manager.py:
// GET fresh -> drift-check -> re-validate -> PUT, per device. These tests pin
// the safety invariants: NEVER PUT on drift, NEVER PUT outside the device's own
// config object key, a fresh per-device ephemeral key on the encrypt path, and
// correct abort / stale-run / retry behaviour.

// mock only the S3 surface (web) - keep cache/evaluate/selectors real
vi.mock("../../web", () => ({
  __esModule: true,
  default: {
    LoggedIn: vi.fn(() => true),
    PresignedGet: vi.fn(() => Promise.resolve({ url: "http://fake-s3/get" })),
    PutObject: vi.fn(() => Promise.resolve())
  }
}));

// surgical crypto mock: keep the pure analyzers (analyzeConfigEncryption,
// validateDeviceFile, detectDeviceTypeFromConfig, ...) real; stub only the
// WebCrypto-backed functions (jsdom under jest 23 has no crypto.subtle)
vi.mock("config-editor-tools", async () => {
  const actual = await vi.importActual("config-editor-tools");
  return {
    ...actual,
    encryptionCrypto: {
      ...actual.encryptionCrypto,
      deriveEncryptionMaterial: vi.fn()
    },
    encryptionFields: {
      ...actual.encryptionFields,
      buildEncryptedDelta: vi.fn()
    }
  };
});

import web from "../../web";
import { encryptionCrypto, encryptionFields } from "config-editor-tools";
import * as cache from "../cache";
import { mergeConfig } from "../evaluate";
import { startRun, abortRun, invalidateRun } from "../submitEngine";
import { RUN_DEVICE_STATUS_BATCH, RUN_DONE } from "../actionTypes";
import { waitFor } from "../__fixtures__/otaTestKit";

// self-contained CANedge2-like schema (root additionalProperties:false so the
// re-validation path is exercised). Same shape as evaluate.test.js.
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

const baseConfig = () => ({
  general: { device: { meta: "fleet-x" }, security: { kpub: "" } },
  log: { file: { split_size: 10 } },
  can_1: { phy: { mode: 0 } },
  can_2: { phy: { mode: 0 } },
  connect: {
    wifi: { keyformat: 0, accesspoint: [{ ssid: "net", pwd: "pass" }] },
    s3: { server: { endpoint: "http://s3.example.com", port: 80, keyformat: 0, secretkey: "secret" } }
  }
});

const deviceJsonFor = (id, overrides = {}) => ({
  id,
  type: "0000001F", // CANedge2
  kpub: "A".repeat(88),
  fw_ver: "01.09.01",
  cfg_ver: "01.09",
  cfg_name: "config-01.09.json",
  sch_name: "schema-01.09.json",
  cfg_crc32: "",
  log_meta: "device-" + id,
  ...overrides
});

const makeDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const fetchOk = (text) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });

// build a redux-ish env: one device by default, everything wired for a happy run
const buildEnv = ({
  ids = ["AABBCCDD"],
  partial = null,
  encryptPasswords = false,
  config = baseConfig(),
  enc = { hasPlain: true, compatible: true },
  deviceJsonOverrides = {},
  baselineCrc32
} = {}) => {
  cache.clearAll();
  const text = JSON.stringify(config, null, 2);
  const crc = baselineCrc32 !== undefined ? baselineCrc32 : cache.crc32Hex(text);

  const deviceFiles = {};
  const evaluations = {};
  const selected = {};
  ids.forEach((id) => {
    cache.setSchema(id, JSON.stringify(SCHEMA));
    deviceFiles[id] = deviceJsonFor(id, deviceJsonOverrides);
    evaluations[id] = { eligible: true, baselineCrc32: crc, enc };
    selected[id] = true;
  });

  const state = {
    otaBatch: {
      deviceFiles,
      evaluations,
      selected,
      partial,
      partialDeletions: [],
      encryptPasswords
    }
  };
  const actions = [];
  const dispatch = (a) => actions.push(a);
  const getState = () => state;
  return { dispatch, getState, actions, text, crc, config };
};

// status updates arrive coalesced (RUN_DEVICE_STATUS_BATCH) - flatten them back
// to one entry per update so the assertions read as before
const statusUpdates = (actions) =>
  actions
    .filter((a) => a.type === RUN_DEVICE_STATUS_BATCH)
    .reduce((all, a) => all.concat(a.updates), []);

const statusOf = (actions, deviceId) => {
  const rows = statusUpdates(actions).filter((u) => u.deviceId === deviceId);
  return rows[rows.length - 1];
};

beforeEach(() => {
  web.LoggedIn.mockReturnValue(true);
  web.PresignedGet.mockReset().mockReturnValue(Promise.resolve({ url: "http://fake-s3/get" }));
  web.PutObject.mockReset().mockReturnValue(Promise.resolve());
  encryptionCrypto.deriveEncryptionMaterial.mockReset();
  encryptionFields.buildEncryptedDelta.mockReset();
  global.fetch = vi.fn();
});

describe("happy path", () => {
  it("PUTs the merged config to the device's own object key with a 2-space body", async () => {
    const partial = { connect: { s3: { server: { endpoint: "http://new-host" } } } };
    const env = buildEnv({ partial });
    global.fetch.mockReturnValue(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).toHaveBeenCalledTimes(1);
    const expectedBody = JSON.stringify(mergeConfig(baseConfig(), partial), null, 2);
    expect(web.PutObject).toHaveBeenCalledWith({
      objectName: "AABBCCDD/config-01.09.json",
      file: expectedBody
    });
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
    expect(env.actions.some((a) => a.type === RUN_DONE)).toBe(true);
  });
});

describe("drift check", () => {
  it("does NOT PUT when the fresh crc32 differs from the reviewed baseline", async () => {
    const env = buildEnv({
      partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } },
      baselineCrc32: "DEADBEEF" // wrong on purpose
    });
    global.fetch.mockReturnValue(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("changed on the server");
  });
});

describe("PUT object-key whitelist", () => {
  it("refuses to write when cfg_name would escape the device's config key", async () => {
    const env = buildEnv({
      partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } },
      deviceJsonOverrides: {
        cfg_name: "config-01.09.json.evil",
        sch_name: "schema-01.09.json"
      }
    });
    global.fetch.mockReturnValue(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("refusing to write");
  });
});

describe("session expiry", () => {
  it("aborts without PUT when the session has expired", async () => {
    const env = buildEnv({ partial: { connect: { s3: { server: { endpoint: "http://x" } } } } });
    web.LoggedIn.mockReturnValue(false);
    global.fetch.mockReturnValue(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("Session expired");
  });
});

describe("retry semantics", () => {
  it("retries once on a 5xx and then succeeds", async () => {
    const env = buildEnv({ partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } } });
    global.fetch
      .mockReturnValueOnce(Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") }))
      .mockReturnValueOnce(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  }, 15000);

  it("retries once on a network error (TypeError) and then succeeds", async () => {
    const env = buildEnv({ partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } } });
    global.fetch
      .mockReturnValueOnce(Promise.reject(new TypeError("Failed to fetch")))
      .mockReturnValueOnce(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  }, 15000);

  it("does NOT retry a 403 and surfaces an actionable message", async () => {
    const env = buildEnv({ partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } } });
    global.fetch.mockReturnValue(Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("") }));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("Access denied (403)");
  });
});

describe("idempotent skip", () => {
  it("marks a device 'No changes' (no PUT) when the fresh config already matches", async () => {
    // partial sets the endpoint to what the config already has -> no change; and
    // encryption toggle off -> nothing to encrypt either
    const env = buildEnv({
      partial: { connect: { s3: { server: { endpoint: "http://s3.example.com" } } } }
    });
    global.fetch.mockReturnValue(fetchOk(env.text));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("submitted");
    expect(row.message).toContain("No changes");
  });
});

describe("encrypt-at-submit", () => {
  it("derives a FRESH ephemeral key per device and PUTs the encrypted config", async () => {
    const ids = ["AABBCC01", "AABBCC02"];
    const env = buildEnv({ ids, encryptPasswords: true });
    // per-device device.json kpubs differ so we can prove per-device derivation
    env.getState().otaBatch.deviceFiles["AABBCC01"].kpub = "K".repeat(88);
    env.getState().otaBatch.deviceFiles["AABBCC02"].kpub = "Z".repeat(88);
    global.fetch.mockReturnValue(fetchOk(env.text));

    encryptionCrypto.deriveEncryptionMaterial.mockImplementation((kpub) =>
      Promise.resolve({ symmetricKey: "SK-" + kpub[0], serverPublicKeyBase64: "PUB-" + kpub[0] })
    );
    encryptionFields.buildEncryptedDelta.mockImplementation((base, sk, pub) =>
      Promise.resolve({
        general: { security: { kpub: pub } },
        connect: {
          wifi: { keyformat: 1, accesspoint: [{ ssid: "net", pwd: "ENC" }] },
          s3: { server: { keyformat: 1, secretkey: "ENC" } }
        }
      })
    );

    await startRun(env.dispatch, env.getState, ids);

    expect(encryptionCrypto.deriveEncryptionMaterial).toHaveBeenCalledTimes(2);
    const kpubsUsed = encryptionCrypto.deriveEncryptionMaterial.mock.calls.map((c) => c[0]);
    expect(kpubsUsed.sort()).toEqual(["K".repeat(88), "Z".repeat(88)].sort());
    expect(web.PutObject).toHaveBeenCalledTimes(2);
    // each PUT body carries the per-device server public key
    const bodies = web.PutObject.mock.calls.map((c) => c[0].file);
    expect(bodies.some((b) => b.includes("PUB-K"))).toBe(true);
    expect(bodies.some((b) => b.includes("PUB-Z"))).toBe(true);
  });

  it("errors when the freshly-encrypted config fails schema validation (no bad PUT)", async () => {
    const env = buildEnv({ encryptPasswords: true });
    global.fetch.mockReturnValue(fetchOk(env.text));
    encryptionCrypto.deriveEncryptionMaterial.mockResolvedValue({
      symmetricKey: "SK",
      serverPublicKeyBase64: "PUB"
    });
    // keyformat 5 is outside the schema enum [0,1] -> finalConfig invalid
    encryptionFields.buildEncryptedDelta.mockResolvedValue({
      general: { security: { kpub: "PUB" } },
      connect: { wifi: { keyformat: 5, accesspoint: [{ ssid: "net", pwd: "ENC" }] } }
    });

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("Encrypted config fails validation");
  });
});

describe("abort", () => {
  it("marks queued (not-yet-started) devices aborted; never PUTs them", async () => {
    // 6 devices, concurrency 5 -> the 6th stays queued; hold the 5 in-flight at
    // the presigned GET so a slot never frees
    const ids = ["AABBCC01", "AABBCC02", "AABBCC03", "AABBCC04", "AABBCC05", "AABBCC06"];
    const env = buildEnv({ ids, partial: { connect: { s3: { server: { endpoint: "http://x" } } } } });
    web.PresignedGet.mockReturnValue(new Promise(() => {})); // never resolves

    startRun(env.dispatch, env.getState, ids); // do not await - it never settles
    await waitFor(() => statusUpdates(env.actions).some((u) => u.state === "submitting"));

    abortRun();
    await waitFor(() => statusUpdates(env.actions).some((u) => u.state === "aborted"));

    const aborted = statusUpdates(env.actions).filter((u) => u.state === "aborted");
    expect(aborted.map((u) => u.deviceId)).toContain("AABBCC06");
    expect(web.PutObject).not.toHaveBeenCalled();
  });

  it("reports every aborted device in ONE dispatch (no per-device render storm)", async () => {
    // 40 queued devices: the whole rejection burst must coalesce into a single
    // RUN_DEVICE_STATUS_BATCH, or the table re-renders 40 times in one task
    const ids = Array.from({ length: 40 }, (unused, n) =>
      "AABB" + n.toString(16).toUpperCase().padStart(4, "0")
    );
    const env = buildEnv({ ids, partial: { connect: { s3: { server: { endpoint: "http://x" } } } } });
    web.PresignedGet.mockReturnValue(new Promise(() => {}));

    startRun(env.dispatch, env.getState, ids);
    await waitFor(() => statusUpdates(env.actions).some((u) => u.state === "submitting"));
    const before = env.actions.filter((a) => a.type === RUN_DEVICE_STATUS_BATCH).length;

    abortRun();
    await waitFor(() => statusUpdates(env.actions).filter((u) => u.state === "aborted").length >= 35);

    const dispatches = env.actions.filter((a) => a.type === RUN_DEVICE_STATUS_BATCH).length - before;
    expect(dispatches).toBe(1);
    expect(statusUpdates(env.actions).filter((u) => u.state === "aborted").length).toBe(35);
  });
});

describe("run-token invalidation", () => {
  it("lets an in-flight PUT complete but suppresses its status + RUN_DONE", async () => {
    const env = buildEnv({ partial: { connect: { s3: { server: { endpoint: "http://new-host" } } } } });
    const gate = makeDeferred();
    global.fetch.mockReturnValue(gate.promise);

    startRun(env.dispatch, env.getState, ["AABBCCDD"]); // do not await yet
    await waitFor(() => statusUpdates(env.actions).some((u) => u.state === "submitting"));

    invalidateRun(); // bump the run token mid-flight
    gate.resolve({ ok: true, status: 200, text: () => Promise.resolve(env.text) });
    await waitFor(() => web.PutObject.mock.calls.length === 1);

    // the PUT was validated on fresh data and is allowed to finish...
    expect(web.PutObject).toHaveBeenCalledTimes(1);
    // ...but the now-stale run must not report submitted or fire RUN_DONE
    const submitted = statusUpdates(env.actions).filter((u) => u.state === "submitted");
    expect(submitted).toEqual([]);
    expect(env.actions.some((a) => a.type === RUN_DONE)).toBe(false);
  });
});
