// detect-browser returns null under jsdom's user agent - mock it before
// config-editor-base (whose utils.js dereferences detect().name at import)
jest.mock("detect-browser", () => ({ detect: () => ({ name: "chrome" }) }));

import {
  analyzePartial,
  evaluateDevicePartial,
  evaluateDeviceEncryption
} from "../evaluate";
import * as cache from "../cache";

// self-contained CANedge-like schema (real schemas are exercised in e2e);
// root additionalProperties:false makes schema-validation blocks testable
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

const DEVICE_ID = "AABBCCDD";

const baseConfig = () => ({
  general: { device: { meta: "fleet-x" }, security: { kpub: "" } },
  log: { file: { split_size: 10, split_time_period: 60, split_time_offset: 0 } },
  can_1: { phy: { mode: 0 }, transmit: [], filter: { id: [{ name: "f1", state: 1 }] } },
  can_2: { phy: { mode: 0 }, transmit: [], filter: { id: [{ name: "f1", state: 1 }] } },
  connect: {
    wifi: { keyformat: 0, accesspoint: [{ ssid: "net", pwd: "pass" }] },
    s3: {
      server: {
        endpoint: "http://s3.example.com",
        port: 80,
        keyformat: 0,
        secretkey: "secret"
      }
    }
  }
});

const baseDeviceJson = () => ({
  id: DEVICE_ID,
  type: "0000001F", // CANedge2
  kpub: "A".repeat(88),
  fw_ver: "01.09.01",
  cfg_ver: "01.09",
  cfg_name: "config-01.09.json",
  sch_name: "schema-01.09.json",
  cfg_crc32: "",
  log_meta: "my-device"
});

const makeInput = ({ config, deviceJson, partial } = {}) => {
  const conf = config || baseConfig();
  const text = JSON.stringify(conf, null, 2);
  const crc = cache.crc32Hex(text);

  cache.clearAll();
  cache.setSchema(DEVICE_ID, JSON.stringify(SCHEMA));

  const analysis = partial ? analyzePartial(partial, []) : { facts: null };

  return {
    deviceId: DEVICE_ID,
    deviceJson: { ...baseDeviceJson(), cfg_crc32: crc, ...(deviceJson || {}) },
    heartbeatMs: Date.now(),
    nowMs: Date.now(),
    config: { data: { text, parsed: conf }, meta: { status: "loaded", crc32: crc } },
    schemaStatus: "loaded",
    validator: cache.getValidator(DEVICE_ID),
    partial,
    facts: analysis.facts
  };
};

describe("analyzePartial (batch-level gates)", () => {
  it("blocks empty / non-object partials", () => {
    expect(analyzePartial({}, []).blockers.length).toBe(1);
    expect(analyzePartial(null, []).blockers.length).toBe(1);
    expect(analyzePartial([1, 2], []).blockers.length).toBe(1);
  });

  it("blocks a non-empty kpub anywhere (device-specific key broadcast)", () => {
    const { blockers } = analyzePartial(
      { general: { security: { kpub: "SOMEKEY" } } },
      []
    );
    expect(blockers.some((b) => b.includes("device-specific"))).toBe(true);
  });

  it("blocks keyformat: 1 anywhere (encrypted credential broadcast)", () => {
    const { blockers } = analyzePartial(
      { connect: { s3: { server: { keyformat: 1, secretkey: "abc==" } } } },
      []
    );
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("blocks webserver security: 2", () => {
    const { blockers } = analyzePartial(
      { connect: { webserver: { security: 2, password: "abc==" } } },
      []
    );
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("notes (not blocks) kpub clearing and meta broadcast + deletions", () => {
    const { blockers, notes } = analyzePartial(
      { general: { security: { kpub: "" }, device: { meta: "same-name" } } },
      ["can_1.filter.f9"]
    );
    expect(blockers).toEqual([]);
    expect(notes.length).toBe(3);
  });

  it("passes a plain S3 endpoint partial", () => {
    const { blockers, notes } = analyzePartial(
      { connect: { s3: { server: { endpoint: "https://new", port: 443 } } } },
      []
    );
    expect(blockers).toEqual([]);
    expect(notes).toEqual([]);
  });
});

describe("evaluateDevicePartial", () => {
  it("ready: valid partial merges, validates, collects warnings", () => {
    // https + port 80 in the merged config triggers the editor's TLS warning
    const input = makeInput({
      partial: { connect: { s3: { server: { endpoint: "https://new-host" } } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("ready");
    expect(result.targetName).toBe("config-01.09.json");
    expect(result.baselineCrc32).toBe(input.config.meta.crc32);
    expect(result.merged.connect.s3.server.endpoint).toBe("https://new-host");
    expect(result.warnings.some((w) => w.includes("TLS"))).toBe(true);
  });

  it("blocked: merged config fails the device's own schema", () => {
    const input = makeInput({ partial: { gnss: { mode: 1 } } });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("fails validation");
  });

  it("unchanged: merged text equals the current config text", () => {
    const input = makeInput({
      partial: { connect: { s3: { server: { port: 80 } } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("unchanged");
  });

  it("blocked: device.json id does not match the folder", () => {
    const input = makeInput({
      deviceJson: { id: "11223344" },
      partial: { general: { device: { meta: "x" } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("does not match the folder");
  });

  it("blocked: unsupported revision", () => {
    const input = makeInput({
      deviceJson: {
        cfg_name: "config-01.06.json",
        sch_name: "schema-01.06.json",
        cfg_ver: "01.06"
      },
      partial: { general: { device: { meta: "x" } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("not supported");
  });

  it("blocked: inconsistent device.json revisions (mid-update)", () => {
    const input = makeInput({
      deviceJson: { sch_name: "schema-01.08.json" },
      partial: { general: { device: { meta: "x" } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("inconsistent");
  });

  it("blocked: config file missing in the folder", () => {
    const input = makeInput({ partial: { general: { device: { meta: "x" } } } });
    input.config = { data: undefined, meta: { status: "missing" } };
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("not found in the device folder");
  });

  it("blocked: schema missing in the folder", () => {
    const input = makeInput({ partial: { general: { device: { meta: "x" } } } });
    input.schemaStatus = "missing";
    input.validator = null;
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("Rule schema");
  });

  it("pending while artifacts are loading", () => {
    const input = makeInput({ partial: { general: { device: { meta: "x" } } } });
    input.config = { data: undefined, meta: { status: "loading" } };
    expect(evaluateDevicePartial(input).status).toBe("pending");
  });

  it("blocked (D9): plaintext credential over an encrypted section", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1;
    config.connect.wifi.accesspoint[0].pwd = "ZW5jcnlwdGVk==";
    const input = makeInput({
      config,
      partial: { connect: { wifi: { accesspoint: [{ ssid: "n", pwd: "plain" }] } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("expects it encrypted");
  });

  it("blocked (D10): flips to plain without providing the value", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1;
    const input = makeInput({
      config,
      partial: { connect: { wifi: { keyformat: 0 } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("does not provide the password value");
  });

  it("allowed: fleet-wide de-encryption with values provided", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1;
    config.connect.s3.server.keyformat = 1;
    const input = makeInput({
      config,
      partial: {
        general: { security: { kpub: "" } },
        connect: {
          wifi: { keyformat: 0, accesspoint: [{ ssid: "n", pwd: "plain" }] },
          s3: { server: { keyformat: 0, secretkey: "plainsecret" } }
        }
      }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("ready");
  });

  it("blocked (D14): clearing kpub while encrypted sections remain", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1;
    const input = makeInput({
      config,
      partial: { general: { security: { kpub: "" } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("could not decrypt");
  });

  it("non-credential partials pass over an encrypted fleet", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1;
    const input = makeInput({
      config,
      partial: { connect: { s3: { server: { endpoint: "http://other", port: 9000 } } } }
    });
    const result = evaluateDevicePartial(input);
    expect(result.status).toBe("ready");
  });
});

describe("evaluateDeviceEncryption", () => {
  it("ready: plain credentials produce an encryption summary", () => {
    const input = makeInput({});
    const result = evaluateDeviceEncryption(input);
    expect(result.status).toBe("ready");
    expect(result.encryptionSummary.length).toBeGreaterThan(0);
    expect(result.targetName).toBe("config-01.09.json");
  });

  it("blocked: invalid kpub (validateDeviceFile reused verbatim)", () => {
    const input = makeInput({ deviceJson: { kpub: "tooshort" } });
    const result = evaluateDeviceEncryption(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("kpub");
  });

  it("unchanged: all passwords already encrypted", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1;
    config.connect.s3.server.keyformat = 1;
    const input = makeInput({ config });
    const result = evaluateDeviceEncryption(input);
    expect(result.status).toBe("unchanged");
  });

  it("blocked: mixed plain/encrypted formats", () => {
    const config = baseConfig();
    config.general.security.kpub = "B".repeat(88);
    config.connect.wifi.keyformat = 1; // s3 stays plain -> mixed
    const input = makeInput({ config });
    const result = evaluateDeviceEncryption(input);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("encrypted while others are plain");
  });
});
