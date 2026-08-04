// "Devices could go offline" behaviour tests. Two parts:
//  1. Warning oracle - the batch tool reuses config-editor-base's
//     collectConfigurationWarnings on every changed config; assert it surfaces
//     the classic offline-risk mistakes (TLS/port mismatch, blank/space APN,
//     encrypted-password-without-kpub self-lockout).
//  2. Potential-bug pins - each pins the CURRENT behaviour so a regression is
//     caught, and carries an it.skip stating the intended-SAFE behaviour that
//     the code does NOT yet implement (see the Findings section of the plan).
//     Per the agreed policy these are flagged, not fixed, and several live in
//     the upstream config-editor-tools/base packages.

import { editorActions } from "config-editor-base";
import { encryptionFields } from "config-editor-tools";
import { analyzePartial } from "../evaluate";
import {
  makeCleanBaseline,
  loadSchema,
  compileValidator,
  mergeCfg
} from "../__fixtures__/otaTestKit";

const { collectConfigurationWarnings } = editorActions;
const { analyzeConfigEncryption } = encryptionFields;

// the warning checks read many can_1/can_2/rtc/filter fields, so start from a
// complete valid CANedge2 config and overlay the connect section under test
// (the checks are gated on content.can_2 != undefined and never validate vs a
// schema - they only read fields).
const CLEAN = makeCleanBaseline("CANedge2", "01.09");
const canedge = (connect, over = {}) => {
  const cfg = { ...CLEAN, connect };
  cfg.general = { ...CLEAN.general, ...(over.general || {}) };
  if (!cfg.general.security) cfg.general.security = {};
  return cfg;
};

describe("warning oracle - offline-risk configs raise a warning", () => {
  it("flags an https endpoint on port 80 (TLS/port mismatch)", () => {
    const w = collectConfigurationWarnings(
      canedge({ s3: { server: { endpoint: "https://s3.example.com", port: 80 } } })
    );
    expect(w.some((m) => m.includes("uses TLS (https://), but your port is 80"))).toBe(true);
  });

  it("flags an http endpoint on port 443 (TLS/port mismatch)", () => {
    const w = collectConfigurationWarnings(
      canedge({ s3: { server: { endpoint: "http://s3.example.com", port: 443 } } })
    );
    expect(w.some((m) => m.includes("does not use TLS (http://), but your port is 443"))).toBe(true);
  });

  it("flags a blank cellular APN (CANedge3 would fail to attach)", () => {
    const w = collectConfigurationWarnings(
      canedge({ s3: { server: { endpoint: "http://s3.example.com", port: 80 } }, cellular: { apn: "" } })
    );
    expect(w.some((m) => m.includes("SIM APN is blank"))).toBe(true);
  });

  it("flags an APN with leading/trailing spaces", () => {
    const w = collectConfigurationWarnings(
      canedge({ s3: { server: { endpoint: "http://s3.example.com", port: 80 } }, cellular: { apn: "internet " } })
    );
    expect(w.some((m) => m.includes("starts/ends with spaces"))).toBe(true);
  });

  it("flags an encrypted S3 secret with no server public key (self-lockout)", () => {
    const w = collectConfigurationWarnings(
      canedge({ s3: { server: { endpoint: "http://s3.example.com", port: 80, keyformat: 1, secretkey: "ZW5j" } } }, {
        general: { security: { kpub: "" } }
      })
    );
    expect(
      w.some((m) => m.includes("S3 SecretKey format is set to Encrypted, but you have not provided the Server public key"))
    ).toBe(true);
  });

  it("flags an encrypted WiFi key with no server public key (self-lockout)", () => {
    const w = collectConfigurationWarnings(
      canedge({ wifi: { keyformat: 1 }, s3: { server: { endpoint: "http://s3.example.com", port: 80 } } }, {
        general: { security: { kpub: "" } }
      })
    );
    expect(
      w.some((m) => m.includes("WiFi Key format is set to Encrypted, but you have not provided the Server public key"))
    ).toBe(true);
  });
});

describe("FINDING #1 (fixed) - disabling the OTA poll period warns", () => {
  // connect.s3.sync.ota == 0 stops the device polling for config/firmware
  // updates entirely -> it becomes unreachable for future remote management.
  // A NON-blocking warning (checkS3OtaDisabled) was added in config-editor-base
  // 3.2.2 and reaches cancloud via collectConfigurationWarnings.
  it("warns (non-blocking) when connect.s3.sync.ota is 0", () => {
    const w = collectConfigurationWarnings(
      canedge({
        s3: { sync: { ota: 0, heartbeat: 300, logfiles: 1 }, server: { endpoint: "http://s3.example.com", port: 80 } }
      })
    );
    expect(w.some((m) => m.includes("OTA") && m.includes("disables"))).toBe(true);
  });

  it("does NOT warn when the OTA interval is a normal non-zero value", () => {
    const w = collectConfigurationWarnings(
      canedge({
        s3: { sync: { ota: 600, heartbeat: 300, logfiles: 1 }, server: { endpoint: "http://s3.example.com", port: 80 } }
      })
    );
    expect(w.some((m) => m.includes("OTA") && m.includes("disables"))).toBe(false);
  });
});

describe("FINDING #2 (retracted) - schema backstops make the UTF-8 length miscount unreachable", () => {
  // analyzeConfigEncryption's length check counts UTF-16 code units while
  // encryptField encodes UTF-8, but this is NOT a device risk: (a) plain
  // credential values are constrained to printable ASCII in their keyformat:0
  // schema branch, so .length == UTF-8 byte length for any schema-valid value,
  // and (b) the encrypted form's maxLength (+ the submit-time re-validation)
  // rejects an over-length ciphertext before any PUT. Both backstops pinned.
  const validator = compileValidator(loadSchema("CANedge2", "01.09"));

  it("rejects a non-ASCII plain wifi password (keyformat:0 branch pattern)", () => {
    const merged = mergeCfg(makeCleanBaseline("CANedge2", "01.09"), {
      connect: { wifi: { keyformat: 0, accesspoint: [{ ssid: "AP", pwd: "ü".repeat(10), minrssi: 0 }] } }
    });
    validator(merged);
    const errs = (validator.errors || []).map((e) => e.dataPath + "|" + e.message);
    expect(errs.some((e) => e.includes("accesspoint") && e.includes("pattern"))).toBe(true);
  });

  it("rejects an over-length encrypted wifi password (encrypted-form maxLength)", () => {
    const merged = mergeCfg(makeCleanBaseline("CANedge2", "01.09"), {
      connect: { wifi: { keyformat: 1, accesspoint: [{ ssid: "AP", pwd: "A".repeat(108), minrssi: 0 }] } }
    });
    validator(merged);
    const errs = (validator.errors || []).map((e) => e.dataPath + "|" + e.message);
    expect(errs.some((e) => e.includes("accesspoint") && /longer than|more than|maxLength/i.test(e))).toBe(true);
  });
});

describe("potential-bug pins (current behaviour pinned; it.skip = intended-safe)", () => {
  // FINDING #4 - the batch broadcast guard (analyzePartial/B6) tests
  // keyformat === 1 (a number). A partial with the STRING "1" slips past it.
  it("current: a string keyformat \"1\" is NOT blocked by analyzePartial (B6 gap)", () => {
    const { blockers } = analyzePartial(
      { connect: { s3: { server: { keyformat: "1", secretkey: "ZW5jcnlwdGVk" } } } },
      []
    );
    expect(blockers).toEqual([]); // slips through the batch-level guard
    // (the device's own schema still rejects a string keyformat via D8, so this
    //  is a defense-in-depth gap rather than an offline risk)
  });
  it.skip("intended: a string keyformat \"1\" SHOULD be blocked as an encrypted broadcast (FINDING #4)", () => {
    const { blockers } = analyzePartial(
      { connect: { s3: { server: { keyformat: "1", secretkey: "ZW5jcnlwdGVk" } } } },
      []
    );
    expect(blockers.length).toBeGreaterThan(0);
  });

  // FINDING #5 (benign) - an empty accesspoint array makes
  // analyzeConfigEncryption OMIT the wifi section, so the per-device D10 guard
  // ("flip to plain without a value") never fires. This is harmless: an empty
  // accesspoint list has no stored password to be mis-read as a literal, so
  // there is no credential at risk. Pinned to document the analyzer behaviour.
  it("an empty wifi accesspoint array yields no wifi encryption section (benign)", () => {
    const analysis = analyzeConfigEncryption({
      connect: { wifi: { keyformat: 1, accesspoint: [] } }
    });
    expect(analysis.sections.find((s) => s.id === "wifi")).toBeUndefined();
  });
});
