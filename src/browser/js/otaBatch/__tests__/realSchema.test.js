// Real-schema cross-device / cross-firmware validation - the headline gap.
// evaluate.test.js exercises the guard pipeline against a SYNTHETIC schema
// (its own comment: "real schemas are exercised in e2e"). This suite loads the
// ACTUAL Rule Schemas shipped in config-editor-base/dist/schema for every
// supported device type x revision and proves that:
//   - a partial built for the wrong device type / wrong firmware is rejected by
//     the device's own schema (guard D8 - the last line of defence before a
//     device-killing config is written), and
//   - a valid same-type/same-revision partial is accepted,
//   - the encryption field-location assumptions (analyzeConfigEncryption /
//     evaluate.js CRED_SECTIONS) hold for every real device x revision.
//
// Two layers (the rjsf-generated baseline is schema-dirty by ~19-20 errors, so
// evaluateDevice - which treats validator(merged) as a hard boolean - can only
// run on a cleaned baseline):
//   A. schema-assumption tests via a new-errors-vs-baseline diff (dirty-baseline
//      safe; mirrors config-editor-tools encryptionFields.test.js)
//   B. a small evaluateDevice end-to-end pass on a cleaned, schema-valid baseline

import { encryptionFields } from "config-editor-tools";

import {
  mergeConfig,
  evaluateDevice,
  analyzePartial,
  classifyCurrentEncryption
} from "../evaluate";
import * as cache from "../cache";
import {
  DEVICE_FAMILIES,
  MATRIX,
  loadSchema,
  compileValidator,
  compileViaCache,
  generatedBaseline,
  makeCleanBaseline,
  newErrorsVsBaseline,
  makeDeviceJson
} from "../__fixtures__/otaTestKit";

const { analyzeConfigEncryption } = encryptionFields;

// seed plain credentials into the given config (structural - for the analyzer;
// not necessarily schema-valid)
const seedCreds = (config, family, rev) => {
  config.log = config.log || {};
  config.log.encryption = { state: 1, keyformat: 0, pwd: "logpass" };
  if (family.wifi && config.connect) {
    config.connect.wifi = config.connect.wifi || {};
    config.connect.wifi.keyformat = 0;
    config.connect.wifi.accesspoint = [{ ssid: "AP", pwd: "wifipass", minrssi: 0 }];
  }
  if (family.cellular && config.connect) {
    config.connect.cellular = config.connect.cellular || {};
    config.connect.cellular.keyformat = 0;
    config.connect.cellular.pin = "1234";
  }
  if (family.s3 && config.connect) {
    if (rev !== "01.07") {
      config.connect.protocol = 0;
      delete config.connect.webserver;
    }
    config.connect.s3 = {
      sync: { ota: 600, heartbeat: 300, logfiles: 1 },
      server: {
        endpoint: "http://s3.us-east-1.amazonaws.com",
        port: 80,
        bucket: "test-bucket",
        region: "us-east-1",
        request_style: 1,
        accesskey: "DUMMYACCESSKEY",
        keyformat: 0,
        secretkey: "plainsecret",
        signed_payload: 0
      }
    };
  }
  return config;
};

describe.each(MATRIX)("real schema %s %s", (device, rev) => {
  const family = DEVICE_FAMILIES[device];
  const schema = loadSchema(device, rev);
  const validator = compileValidator(schema);

  it("the cleaned baseline is schema-valid (guards the test fixtures)", () => {
    const clean = makeCleanBaseline(device, rev);
    expect(validator(clean)).toBe(true);
  });

  it("a benign valid partial introduces no schema errors (D8 pass)", () => {
    const base = generatedBaseline(device, rev);
    const merged = mergeConfig(base, { general: { device: { meta: "fleetA" } } });
    expect(newErrorsVsBaseline(validator, base, merged)).toEqual([]);
  });

  if (!family.gnss) {
    it("BLOCKS a GNSS partial pushed to a non-GNSS device (D8)", () => {
      const base = generatedBaseline(device, rev);
      const merged = mergeConfig(base, { gnss: { system: 5 } });
      const errs = newErrorsVsBaseline(validator, base, merged);
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => e.includes("additional properties"))).toBe(true);
    });
  }

  if (!family.wifi) {
    it("BLOCKS a WiFi partial pushed to a cellular device (D8)", () => {
      const base = generatedBaseline(device, rev);
      const merged = mergeConfig(base, {
        connect: { wifi: { keyformat: 0, accesspoint: [] } }
      });
      const errs = newErrorsVsBaseline(validator, base, merged);
      expect(errs.some((e) => e.includes("additional properties"))).toBe(true);
    });
  }

  if (!family.cellular) {
    it("BLOCKS a cellular partial pushed to a WiFi device (D8)", () => {
      const base = generatedBaseline(device, rev);
      const merged = mergeConfig(base, {
        connect: { cellular: { keyformat: 0, pin: "1234", apn: "x", roaming: 0 } }
      });
      const errs = newErrorsVsBaseline(validator, base, merged);
      expect(errs.some((e) => e.includes("additional properties"))).toBe(true);
    });
  }

  it("analyzeConfigEncryption finds exactly the family's credential sections", () => {
    const seeded = seedCreds(makeCleanBaseline(device, rev), family, rev);
    const ids = analyzeConfigEncryption(seeded)
      .sections.map((s) => s.id)
      .sort();
    const expected = ["log"]
      .concat(family.wifi ? ["wifi"] : [])
      .concat(family.cellular ? ["cellular"] : [])
      .concat(family.s3 ? ["s3"] : [])
      .sort();
    expect(ids).toEqual(expected);
    expect(classifyCurrentEncryption(seeded)).toBe("plain");
  });
});

describe("cross-revision schema drift (CANedge2)", () => {
  const v = (rev) => compileValidator(loadSchema("CANedge2", rev));
  const base = (rev) => generatedBaseline("CANedge2", rev);

  it("routing (added 01.09) is rejected on 01.08 but accepted on 01.09", () => {
    const partial = { routing: [] };
    const b08 = base("01.08");
    expect(
      newErrorsVsBaseline(v("01.08"), b08, mergeConfig(b08, partial)).some((e) =>
        e.includes("additional properties")
      )
    ).toBe(true);
    const b09 = base("01.09");
    expect(newErrorsVsBaseline(v("01.09"), b09, mergeConfig(b09, partial))).toEqual([]);
  });

  it("a 65-entry transmit list is rejected on 01.08 (max 64) but accepted on 01.09 (max 224)", () => {
    const tx = Array.from({ length: 65 }, (_, i) => ({
      state: 1,
      id_format: 0,
      id: (i).toString(16),
      dlc: 8,
      data: "0000000000000000",
      period: 1000,
      delay: 0
    }));
    const partial = { can_1: { transmit: tx } };
    const b08 = base("01.08");
    expect(
      newErrorsVsBaseline(v("01.08"), b08, mergeConfig(b08, partial)).some((e) =>
        e.includes("more than 64 items")
      )
    ).toBe(true);
    const b09 = base("01.09");
    // 65 items is under the 01.09 cap (224) - the transmit array itself adds no
    // "too many items" error (individual item errors, if any, are not maxItems)
    expect(
      newErrorsVsBaseline(v("01.09"), b09, mergeConfig(b09, partial)).some((e) =>
        e.includes("more than")
      )
    ).toBe(false);
  });

  it("can_X.heartbeat (removed in 01.09) is accepted on 01.08 but rejected on 01.09", () => {
    const partial = { can_1: { heartbeat: { state: 0 } } };
    const b08 = base("01.08");
    expect(
      newErrorsVsBaseline(v("01.08"), b08, mergeConfig(b08, partial)).some((e) =>
        e.includes("additional properties")
      )
    ).toBe(false);
    const b09 = base("01.09");
    expect(
      newErrorsVsBaseline(v("01.09"), b09, mergeConfig(b09, partial)).some((e) =>
        e.includes("additional properties")
      )
    ).toBe(true);
  });

  it("can_internal (added 01.07) is rejected on 01.06", () => {
    const schema06 = loadSchema("CANedge2", "01.06");
    const v06 = compileValidator(schema06);
    const b06 = generatedBaseline("CANedge2", "01.06");
    const merged = mergeConfig(b06, { can_internal: { general: { mode: 0 } } });
    expect(
      newErrorsVsBaseline(v06, b06, merged).some((e) =>
        e.includes("additional properties")
      )
    ).toBe(true);
  });
});

// Cross-checked against the Python canedge_manager migration functions
// (config_func_01_07_XX_01_08_XX.py / _01_08_XX_01_09_XX.py). The migrations
// confirm the structural deltas across our supported range; these tests verify
// our (data-path-based) assumptions survive them and pin what schema validation
// does / does NOT catch.
describe("migration-driven schema changes (01.07 -> 01.08 -> 01.09) vs our assumptions", () => {
  const CE2 = DEVICE_FAMILIES.CANedge2;

  // 01.07->01.08 added connect.protocol and moved s3 (and new webserver) into
  // connect.dependencies.protocol branches. Our CRED_SECTIONS + analyzer use the
  // DATA path connect.s3.server.* (dependency branches don't change data paths),
  // so the s3 credential section must be found in BOTH the 01.07 static layout
  // and the 01.08+ dependency layout.
  it("finds the s3 credential section in both the 01.07 static and 01.09 dependency layouts", () => {
    const s07 = seedCreds(makeCleanBaseline("CANedge2", "01.07"), CE2, "01.07");
    const s09 = seedCreds(makeCleanBaseline("CANedge2", "01.09"), CE2, "01.09");
    expect(analyzeConfigEncryption(s07).sections.some((x) => x.id === "s3")).toBe(true);
    expect(analyzeConfigEncryption(s09).sections.some((x) => x.id === "s3")).toBe(true);
  });

  // structural cross-revision mismatch IS caught by D8: connect.protocol does not
  // exist on 01.07
  it("BLOCKS a connect.protocol partial pushed to a 01.07 device (D8)", () => {
    const base = generatedBaseline("CANedge2", "01.07");
    const validator = compileValidator(loadSchema("CANedge2", "01.07"));
    const errs = newErrorsVsBaseline(validator, base, mergeConfig(base, { connect: { protocol: 0 } }));
    expect(errs.some((e) => e.includes("additional properties"))).toBe(true);
  });

  // SEMANTIC gap (NOT caught by schema): the protocol dependency branches make
  // s3/webserver optional (no `required`), so flipping protocol 0 -> 1 switches a
  // CANedge2 to local web-server mode (stops S3 upload AND OTA) yet still
  // validates - even with no webserver block. Documented so the offline vector is
  // visible; schema/D8 cannot guard it (see the recommended batch-level note).
  it("does NOT block flipping connect.protocol to web-server (1) - schema can't guard this offline vector", () => {
    const base = seedCreds(makeCleanBaseline("CANedge2", "01.09"), CE2, "01.09");
    const validator = compileValidator(loadSchema("CANedge2", "01.09"));
    expect(validator(base)).toBe(true);
    const errs = newErrorsVsBaseline(validator, base, mergeConfig(base, { connect: { protocol: 1 } }));
    expect(errs).toEqual([]); // no schema error -> the batch tool would apply it silently
  });

  // on a CANedge3 (cellular, S3-only) there is no web-server branch, so
  // protocol:1 IS rejected by the schema
  it("BLOCKS connect.protocol:1 on a CANedge3 GNSS (no web-server branch)", () => {
    const base = seedCreds(makeCleanBaseline("CANedge3 GNSS", "01.09"), DEVICE_FAMILIES["CANedge3 GNSS"], "01.09");
    const validator = compileValidator(loadSchema("CANedge3 GNSS", "01.09"));
    const errs = newErrorsVsBaseline(validator, base, mergeConfig(base, { connect: { protocol: 1 } }));
    expect(errs.length).toBeGreaterThan(0);
  });

  // 01.08->01.09 removed can_X.heartbeat and restructured can_internal.filter.id.
  // Structural removals ARE caught by D8 (heartbeat rejected on 01.09 - covered in
  // the cross-revision block). But an array-overwrite of can_internal.filter.id
  // with a valid-shaped OLD list is NOT caught: the schema does not validate
  // filter NAMES, so a 01.08 internal filter list survives onto 01.09 intact.
  it("does NOT block a stale (01.08-shaped) can_internal.filter.id array on 01.09 - the delta-vs-migration gap", () => {
    const base = makeCleanBaseline("CANedge2", "01.09");
    const validator = compileValidator(loadSchema("CANedge2", "01.09"));
    // the 01.08 internal list still contained AllStandardID/AllExtendedID, which
    // 01.09 replaced with dedicated filters - but the shape is valid
    const stale = [
      { name: "AllStandardID", state: 1, type: 0, id_format: 0, method: 0, f1: "0", f2: "7FF", prescaler_type: 0 },
      { name: "AllExtendedID", state: 1, type: 0, id_format: 1, method: 0, f1: "0", f2: "1FFFFFFF", prescaler_type: 0 }
    ];
    const errs = newErrorsVsBaseline(validator, base, mergeConfig(base, { can_internal: { filter: { id: stale } } }));
    expect(errs).toEqual([]); // valid shape -> schema accepts the semantically-stale list
  });
});

describe("discriminator / dependency traps (CANedge2 01.09, clean baseline)", () => {
  const schema = loadSchema("CANedge2", "01.09");
  const validator = compileValidator(schema);

  it("flipping log.encryption.state on without keyformat/pwd is rejected (D8)", () => {
    const base = makeCleanBaseline("CANedge2", "01.09");
    expect(validator(base)).toBe(true);
    // preserve the discriminator flip only (no keyformat/pwd siblings)
    const merged = mergeConfig(base, { log: { encryption: { state: 1 } } });
    const errs = newErrorsVsBaseline(validator, base, merged);
    expect(
      errs.some((e) => e.includes("required property") || e.includes("allowed values"))
    ).toBe(true);
  });
});

describe("Layer B - evaluateDevice end-to-end against a real CANedge2 01.09 schema", () => {
  const DEVICE_ID = "AABBCCDD";
  const schema = loadSchema("CANedge2", "01.09");
  const family = DEVICE_FAMILIES.CANedge2;

  // a schema-valid, plain-credential CANedge2 config
  const validConfig = () => seedCreds(makeCleanBaseline("CANedge2", "01.09"), family, "01.09");

  const makeInput = (partial) => {
    const conf = validConfig();
    const text = JSON.stringify(conf, null, 2);
    const crc = cache.crc32Hex(text);
    cache.clearAll();
    cache.setSchema(DEVICE_ID, JSON.stringify(schema));
    const analysis = partial ? analyzePartial(partial, []) : { facts: null };
    return {
      deviceId: DEVICE_ID,
      deviceJson: makeDeviceJson({ id: DEVICE_ID, type: family.type, rev: "01.09", cfg_crc32: crc }),
      heartbeatMs: Date.now(),
      nowMs: Date.now(),
      config: { data: { text, parsed: conf }, meta: { status: "loaded", crc32: crc } },
      schemaStatus: "loaded",
      validator: cache.getValidator(DEVICE_ID),
      partial,
      facts: analysis.facts
    };
  };

  it("the seeded config validates against the real schema (guard)", () => {
    expect(compileValidator(schema)(validConfig())).toBe(true);
  });

  it("a valid https-endpoint partial is eligible and raises the TLS warning", () => {
    const result = evaluateDevice(
      makeInput({ connect: { s3: { server: { endpoint: "https://s3.us-east-1.amazonaws.com" } } } })
    );
    expect(result.status).toBe("eligible");
    expect(result.partialChanges).toBe(true);
    expect(result.warnings.some((w) => w.includes("TLS"))).toBe(true);
  });

  it("a GNSS partial is blocked by the real schema (D8)", () => {
    const result = evaluateDevice(makeInput({ gnss: { system: 5 } }));
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toContain("fails validation");
  });

  it("compiling the real schema through the production cache yields a working validator", () => {
    cache.clearAll();
    const validator = compileViaCache(DEVICE_ID, schema);
    expect(typeof validator).toBe("function");
    expect(validator(validConfig())).toBe(true);
  });
});
