// Firmware-run submit-engine tests - the path that writes configs AND
// firmware.bin to devices. Pins the safety invariants: config-before-firmware
// write order, NEVER PUT on drift, fresh re-gate before any write, the
// firmware object-key whitelist, the "config landed but firmware failed"
// partial-failure message, and a fresh presigned URL per upload attempt.

// mock only the S3 surface (web) - keep cache/evaluate/migration real
jest.mock("../../web", () => ({
  __esModule: true,
  default: {
    LoggedIn: jest.fn(() => true),
    PresignedGet: jest.fn(() => Promise.resolve({ url: "http://fake-s3/get" })),
    PresignedPutObject: jest.fn(() =>
      Promise.resolve({ url: "http://fake-s3/put" })
    ),
    PutObject: jest.fn(() => Promise.resolve())
  }
}));

import web from "../../web";
import { migration } from "config-editor-tools";
import * as cache from "../cache";
import { startRun } from "../submitEngine";
import { RUN_DEVICE_STATUS_BATCH } from "../actionTypes";
import {
  loadSchema,
  makeCleanBaseline,
  makeDeviceJson,
  fakeFetchResponse
} from "../__fixtures__/otaTestKit";

// Minimal scriptable XMLHttpRequest stand-in (mirrors uploadEngine.test.js):
// each send() consumes the next handler from FakeXHR.script
class FakeXHR {
  constructor() {
    FakeXHR.instances.push(this);
    this.upload = {
      addEventListener: (event, cb) => {
        if (event === "progress") this.progressCb = cb;
      }
    };
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  send(file) {
    this.file = file;
    FakeXHR.sequence.push("fw-put");
    const handler = FakeXHR.script.shift();
    if (handler) setTimeout(() => handler(this), 0);
  }
  abort() {
    if (this.onabort) this.onabort();
  }
  respond(status) {
    this.status = status;
    this.onload();
  }
}

// one device, firmware loaded (cache + redux summary), everything wired for a
// happy firmware run; deviceRev vs fwRevision decides migrate vs patch-only
const buildFwEnv = ({
  ids = ["AABBCCDD"],
  deviceRev = "01.08",
  fwRevision = "01.09",
  fwVer,
  config,
  deviceJsonOverrides = {},
  baselineCrc32
} = {}) => {
  cache.clearAll();
  const effectiveFwVer = fwVer || fwRevision + ".05";
  const cfg = config || makeCleanBaseline("CANedge2", deviceRev);
  const text = JSON.stringify(cfg, null, 2);
  const crc =
    baselineCrc32 !== undefined ? baselineCrc32 : cache.crc32Hex(text);
  const fwFile = { name: "firmware.bin", size: 42 };

  cache.setFirmware({
    file: fwFile,
    deviceType: "CANedge2",
    fwVer: effectiveFwVer,
    revision: fwRevision,
    defaultConfig: makeCleanBaseline("CANedge2", fwRevision),
    targetSchema: loadSchema("CANedge2", fwRevision)
  });

  const deviceFiles = {};
  const evaluations = {};
  const selected = {};
  ids.forEach((id) => {
    cache.setSchema(id, JSON.stringify(loadSchema("CANedge2", deviceRev)));
    deviceFiles[id] = makeDeviceJson({
      id,
      rev: deviceRev,
      ...deviceJsonOverrides
    });
    evaluations[id] = { eligible: true, baselineCrc32: crc };
    selected[id] = true;
  });

  const state = {
    otaBatch: {
      deviceFiles,
      evaluations,
      selected,
      partial: null,
      partialDeletions: [],
      encryptPasswords: false,
      loadedFirmware: {
        fileName: "firmware.bin",
        deviceType: "CANedge2",
        fwVer: effectiveFwVer,
        revision: fwRevision
      }
    }
  };
  const actions = [];
  return {
    dispatch: (a) => actions.push(a),
    getState: () => state,
    actions,
    text,
    crc,
    cfg,
    fwFile
  };
};

// the engine coalesces status updates into RUN_DEVICE_STATUS_BATCH dispatches
const statusOf = (actions, deviceId) => {
  const rows = actions
    .filter((a) => a.type === RUN_DEVICE_STATUS_BATCH)
    .reduce((all, a) => all.concat(a.updates), [])
    .filter((u) => u.deviceId === deviceId);
  return rows[rows.length - 1];
};

const realXHR = global.XMLHttpRequest;

beforeEach(() => {
  web.LoggedIn.mockReturnValue(true);
  web.PresignedGet.mockReset().mockReturnValue(
    Promise.resolve({ url: "http://fake-s3/get" })
  );
  web.PresignedPutObject.mockReset().mockReturnValue(
    Promise.resolve({ url: "http://fake-s3/put" })
  );
  web.PutObject.mockReset().mockImplementation(() => {
    FakeXHR.sequence.push("config-put");
    return Promise.resolve();
  });
  FakeXHR.instances = [];
  FakeXHR.script = [];
  FakeXHR.sequence = [];
  global.XMLHttpRequest = FakeXHR;
  global.fetch = jest.fn();
});

afterEach(() => {
  global.XMLHttpRequest = realXHR;
});

describe("migrate path (01.08 device, 01.09 firmware)", () => {
  it("PUTs the migrated config under the NEW name BEFORE the firmware.bin", async () => {
    const env = buildFwEnv();
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));
    FakeXHR.script = [(xhr) => xhr.respond(200)];

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    // config write: migrated body, target (new-revision) object key
    expect(web.PutObject).toHaveBeenCalledTimes(1);
    const expected = migration.migrateConfig({
      configOld: JSON.parse(env.text),
      fromRevision: "01.08",
      toRevision: "01.09",
      deviceType: "CANedge2",
      defaultConfig: makeCleanBaseline("CANedge2", "01.09"),
      targetSchema: loadSchema("CANedge2", "01.09")
    });
    expect(expected.valid).toBe(true);
    expect(web.PutObject).toHaveBeenCalledWith({
      objectName: "AABBCCDD/config-01.09.json",
      file: JSON.stringify(expected.migratedConfig, null, 2)
    });

    // firmware write: presigned binary PUT of the raw File, AFTER the config
    expect(web.PresignedPutObject).toHaveBeenCalledWith({
      bucketName: "AABBCCDD",
      objectName: "firmware.bin",
      expiry: expect.any(Number)
    });
    expect(FakeXHR.instances[0].file).toBe(env.fwFile);
    expect(FakeXHR.sequence).toEqual(["config-put", "fw-put"]);
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  });

  it("surfaces the partial-failure message when the config landed but the firmware PUT fails", async () => {
    const env = buildFwEnv();
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));
    FakeXHR.script = [(xhr) => xhr.respond(403)]; // not retriable

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).toHaveBeenCalledTimes(1); // config DID land
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain(
      "Config updated, but the firmware upload failed"
    );
  });
});

describe("patch-only path (same revision, different patch)", () => {
  it("PUTs only the firmware.bin - the config is never rewritten", async () => {
    const env = buildFwEnv({ deviceRev: "01.09", fwRevision: "01.09" });
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));
    FakeXHR.script = [(xhr) => xhr.respond(200)];

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    expect(web.PresignedPutObject).toHaveBeenCalledTimes(1);
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  });

  it("skips a device already on the exact target firmware (no PUTs)", async () => {
    // stale evaluation says eligible, but fresh re-gate sees fw_ver == target
    const env = buildFwEnv({
      deviceRev: "01.09",
      fwRevision: "01.09",
      fwVer: "01.09.05",
      deviceJsonOverrides: { fw_ver: "01.09.05" }
    });
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    expect(web.PresignedPutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("submitted");
    expect(row.message).toContain("Already on this firmware");
  });
});

describe("drift check", () => {
  it("does NOT write config or firmware when the fresh crc32 differs from the baseline", async () => {
    const env = buildFwEnv({ baselineCrc32: "DEADBEEF" });
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    expect(web.PresignedPutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("changed on the server");
  });
});

describe("fresh re-gate", () => {
  it("blocks (no PUTs) when the fresh config no longer migrates cleanly", async () => {
    // custom-firmware extra key survives migration and fails the official
    // target schema - must be caught by the authoritative re-run, not the PUT
    const cfg = makeCleanBaseline("CANedge2", "01.08");
    cfg.customField = { foo: 1 };
    const env = buildFwEnv({ config: cfg });
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PutObject).not.toHaveBeenCalled();
    expect(web.PresignedPutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("not valid for firmware 01.09");
  });
});

describe("firmware object-key whitelist", () => {
  it("refuses to write firmware.bin outside an 8-hex device folder", async () => {
    // patch-only so the config whitelist is never reached; the device id is
    // not 8-hex, so FW_PUT_NAME_REGEX must refuse before any presign
    const badId = "NOTAHEX1";
    const env = buildFwEnv({
      ids: [badId],
      deviceRev: "01.09",
      fwRevision: "01.09"
    });
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));

    await startRun(env.dispatch, env.getState, [badId]);

    expect(web.PresignedPutObject).not.toHaveBeenCalled();
    const row = statusOf(env.actions, badId);
    expect(row.state).toBe("error");
    expect(row.message).toContain("refusing to write");
  });
});

describe("retry semantics", () => {
  it("retries a 5xx firmware PUT once with a FRESH presigned URL", async () => {
    const env = buildFwEnv({ deviceRev: "01.09", fwRevision: "01.09" });
    global.fetch.mockReturnValue(Promise.resolve(fakeFetchResponse(env.text)));
    FakeXHR.script = [(xhr) => xhr.respond(503), (xhr) => xhr.respond(200)];

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PresignedPutObject).toHaveBeenCalledTimes(2);
    expect(FakeXHR.instances.length).toBe(2);
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  }, 15000);
});
