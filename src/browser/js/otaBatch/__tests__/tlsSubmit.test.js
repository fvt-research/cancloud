// TLS-run submit-engine tests - the path that writes ONLY certs_server.p7b to
// the device root. Pins the invariants: no config GET/PUT of any kind, the
// certificate object-key whitelist, the fresh re-gate on the (pure) firmware
// revision, and one 5xx retry with a fresh presigned URL.

// mock only the S3 surface (web) - keep cache/evaluate real
vi.mock("../../web", () => ({
  __esModule: true,
  default: {
    LoggedIn: vi.fn(() => true),
    PresignedGet: vi.fn(() => Promise.resolve({ url: "http://fake-s3/get" })),
    PresignedPutObject: vi.fn(() =>
      Promise.resolve({ url: "http://fake-s3/put" })
    ),
    PresignedPutObjectRaw: vi.fn(() =>
      Promise.resolve({ url: "http://fake-s3/put" })
    ),
    PutObject: vi.fn(() => Promise.resolve())
  }
}));

import web from "../../web";
import * as cache from "../cache";
import { startRun } from "../submitEngine";
import { RUN_DEVICE_STATUS_BATCH } from "../actionTypes";
import { makeDeviceJson } from "../__fixtures__/otaTestKit";

// minimal scriptable XMLHttpRequest stand-in (mirrors firmwareSubmit.test.js)
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

const SCHEMA = { type: "object" };

const buildTlsEnv = ({ ids = ["AABBCCDD"], deviceJsonOverrides = {} } = {}) => {
  cache.clearAll();
  const tlsFile = { name: "certs_server.p7b", size: 4096 };
  cache.setTls({ file: tlsFile });

  const deviceFiles = {};
  const evaluations = {};
  const selected = {};
  ids.forEach((id) => {
    cache.setSchema(id, JSON.stringify(SCHEMA));
    deviceFiles[id] = makeDeviceJson({ id, ...deviceJsonOverrides });
    evaluations[id] = { eligible: true, tls: { willUpdate: true } };
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
      loadedFirmware: null,
      loadedTls: { fileName: "certs_server.p7b", size: 4096 }
    }
  };
  const actions = [];
  return {
    dispatch: (a) => actions.push(a),
    getState: () => state,
    actions,
    tlsFile
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
  web.PresignedPutObjectRaw.mockReset().mockReturnValue(
    Promise.resolve({ url: "http://fake-s3/put" })
  );
  web.PutObject.mockReset().mockReturnValue(Promise.resolve());
  FakeXHR.instances = [];
  FakeXHR.script = [];
  global.XMLHttpRequest = FakeXHR;
  global.fetch = vi.fn();
});

afterEach(() => {
  global.XMLHttpRequest = realXHR;
});

describe("TLS run", () => {
  it("PUTs only the certs_server.p7b - no config GET, PUT or presigned GET", async () => {
    const env = buildTlsEnv();
    FakeXHR.script = [(xhr) => xhr.respond(200)];

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PresignedPutObjectRaw).toHaveBeenCalledTimes(1);
    expect(web.PresignedPutObjectRaw).toHaveBeenCalledWith({
      bucketName: "AABBCCDD",
      objectName: "certs_server.p7b",
      expiry: expect.any(Number)
    });
    // the raw File goes over the binary XHR transport, byte-identical
    expect(FakeXHR.instances[0].file).toBe(env.tlsFile);
    // nothing config-related happens in a TLS run
    expect(global.fetch).not.toHaveBeenCalled();
    expect(web.PresignedGet).not.toHaveBeenCalled();
    expect(web.PutObject).not.toHaveBeenCalled();
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  });

  it("re-gates on fresh device.json: an unsupported firmware revision fails without a PUT", async () => {
    const env = buildTlsEnv({ deviceJsonOverrides: { fw_ver: "01.06.03" } });

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PresignedPutObjectRaw).not.toHaveBeenCalled();
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    expect(row.message).toContain("not supported for TLS certificate updates");
  });

  it("refuses to write certs_server.p7b outside an 8-hex device folder", async () => {
    const badId = "NOTAHEX1";
    const env = buildTlsEnv({ ids: [badId] });

    await startRun(env.dispatch, env.getState, [badId]);

    expect(web.PresignedPutObjectRaw).not.toHaveBeenCalled();
    const row = statusOf(env.actions, badId);
    expect(row.state).toBe("error");
    expect(row.message).toContain("refusing to write");
  });

  it("retries a 5xx certificate PUT once with a FRESH presigned URL", async () => {
    const env = buildTlsEnv();
    FakeXHR.script = [(xhr) => xhr.respond(503), (xhr) => xhr.respond(200)];

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PresignedPutObjectRaw).toHaveBeenCalledTimes(2);
    expect(FakeXHR.instances.length).toBe(2);
    expect(statusOf(env.actions, "AABBCCDD").state).toBe("submitted");
  }, 15000);

  it("does not retry a 4xx and surfaces a certificate-labelled error", async () => {
    const env = buildTlsEnv();
    FakeXHR.script = [(xhr) => xhr.respond(403)];

    await startRun(env.dispatch, env.getState, ["AABBCCDD"]);

    expect(web.PresignedPutObjectRaw).toHaveBeenCalledTimes(1);
    const row = statusOf(env.actions, "AABBCCDD");
    expect(row.state).toBe("error");
    // 403 is mapped to the friendly permissions message
    expect(row.message).toContain("Access denied (403)");
  });
});
