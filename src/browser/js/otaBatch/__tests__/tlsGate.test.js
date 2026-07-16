// tlsGate + the evaluateDevice TLS-run branch: a pure binary cert push gated
// only by the device's reported firmware revision (safety precaution) on top
// of the shared base gates - no config merge, migration or validation.

// detect-browser returns null under jsdom; evaluate.js imports config-editor-base
jest.mock("detect-browser", () => ({ detect: () => ({ name: "chrome" }) }));

import { tlsGate, evaluateDevice } from "../evaluate";
import * as cache from "../cache";
import { makeDeviceJson } from "../__fixtures__/otaTestKit";

const DEVICE_ID = "AABBCCDD";

// the TLS branch never validates the config, so a permissive schema suffices
const SCHEMA = { type: "object" };
const CONFIG = { general: { device: { meta: "x" } } };

const TLS = { file: { name: "certs_server.p7b", size: 4096 } };

const makeInput = (deviceOverrides = {}, inputOverrides = {}) => {
  const text = JSON.stringify(CONFIG, null, 2);
  const crc = cache.crc32Hex(text);
  cache.clearAll();
  cache.setSchema(DEVICE_ID, JSON.stringify(SCHEMA));
  return {
    deviceId: DEVICE_ID,
    deviceJson: makeDeviceJson({ id: DEVICE_ID, cfg_crc32: crc, ...deviceOverrides }),
    heartbeatMs: Date.now(),
    nowMs: Date.now(),
    config: {
      data: { text, parsed: CONFIG },
      meta: { status: "loaded", crc32: crc }
    },
    schemaStatus: "loaded",
    validator: cache.getValidator(DEVICE_ID),
    partial: null,
    facts: null,
    firmware: null,
    tls: TLS,
    ...inputOverrides
  };
};

describe("tlsGate", () => {
  it.each(["01.07", "01.08", "01.09"])(
    "allows a device on firmware revision %s",
    (rev) => {
      expect(tlsGate(makeDeviceJson({ fw_ver: rev + ".03" }))).toEqual({
        willUpdate: true
      });
    }
  );

  it("blocks an unsupported firmware revision", () => {
    const g = tlsGate(makeDeviceJson({ fw_ver: "01.06.03" }));
    expect(g.reason).toContain("01.06");
    expect(g.reason).toContain("not supported for TLS certificate updates");
    expect(g.willUpdate).toBeUndefined();
  });

  it("blocks a missing firmware version", () => {
    const g = tlsGate(makeDeviceJson({ fw_ver: undefined }));
    expect(g.reason).toContain("missing");
    expect(g.willUpdate).toBeUndefined();
  });

  it("blocks a malformed firmware version", () => {
    const g = tlsGate(makeDeviceJson({ fw_ver: "1.9.1" }));
    expect(g.reason).toContain("1.9.1");
    expect(g.willUpdate).toBeUndefined();
  });
});

describe("evaluateDevice TLS run", () => {
  it("is eligible with tls.willUpdate and no config artifacts", () => {
    const result = evaluateDevice(makeInput());
    expect(result.status).toBe("eligible");
    expect(result.eligible).toBe(true);
    expect(result.tls).toEqual({ willUpdate: true });
    expect(result.partialChanges).toBe(false);
    expect(result.fw).toBeUndefined();
    // nothing config-related is written - no download payload
    expect(result.merged).toBeUndefined();
    expect(result.mergedText).toBeUndefined();
  });

  it("blocks a device on an unsupported firmware revision (base gates pass)", () => {
    // config revision 01.09 passes the base gates; only fw_ver is old
    const result = evaluateDevice(makeInput({ fw_ver: "01.06.03" }));
    expect(result.status).toBe("blocked");
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("not supported for TLS certificate updates");
  });

  it("still applies the shared base gates (unsupported config revision)", () => {
    const result = evaluateDevice(makeInput({ rev: "01.06", fw_ver: "01.09.01" }));
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("not supported");
  });

  it("warns on a stale heartbeat but NOT on a config crc mismatch", () => {
    const staleMs = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const result = evaluateDevice(
      makeInput({ cfg_crc32: "DEADBEEF" }, { heartbeatMs: staleMs })
    );
    expect(result.eligible).toBe(true);
    expect(result.warnings.some((w) => w.includes("heartbeat"))).toBe(true);
    // config sync state is irrelevant to a certificate push
    expect(result.warnings.some((w) => w.includes("not yet adopted"))).toBe(false);
  });
});
