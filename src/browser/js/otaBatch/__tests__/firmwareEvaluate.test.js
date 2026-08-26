// evaluateDevice firmware-run path: the migration + target-schema validation
// runs DURING evaluation, so an incompatible config (e.g. from a custom
// firmware that adds non-official fields) is blocked/grayed before submit -
// matching the editor tool, instead of only erroring at submit time.

import { evaluateDevice } from "../evaluate";
import * as cache from "../cache";
import {
  DEVICE_FAMILIES,
  loadSchema,
  compileValidator,
  makeCleanBaseline,
  makeDeviceJson
} from "../__fixtures__/otaTestKit";

const DEVICE_ID = "AABBCCDD";
const CE2 = DEVICE_FAMILIES.CANedge2;

// mirrors cache.getFirmware(): parsed header + the pre-compiled target validator
const makeFirmware = (revision) => {
  const schema = loadSchema("CANedge2", revision);
  return {
    deviceType: "CANedge2",
    fwVer: revision + ".05",
    revision,
    defaultConfig: makeCleanBaseline("CANedge2", revision),
    targetSchema: schema,
    targetValidator: compileValidator(schema)
  };
};

const makeInput = (currentConfig, currentRev, firmware, deviceOverrides = {}) => {
  const text = JSON.stringify(currentConfig, null, 2);
  const crc = cache.crc32Hex(text);
  cache.clearAll();
  cache.setSchema(DEVICE_ID, JSON.stringify(loadSchema("CANedge2", currentRev)));
  return {
    deviceId: DEVICE_ID,
    deviceJson: makeDeviceJson({
      id: DEVICE_ID,
      type: CE2.type,
      rev: currentRev,
      cfg_crc32: crc,
      ...deviceOverrides
    }),
    heartbeatMs: Date.now(),
    nowMs: Date.now(),
    config: {
      data: { text, parsed: currentConfig },
      meta: { status: "loaded", crc32: crc }
    },
    schemaStatus: "loaded",
    validator: cache.getValidator(DEVICE_ID),
    partial: null,
    facts: null,
    firmware
  };
};

describe("evaluateDevice firmware run (real CANedge2 schema)", () => {
  it("BLOCKS during evaluation when the migrated config is invalid (custom-firmware extras)", () => {
    const current = makeCleanBaseline("CANedge2", "01.07");
    current.customField = { foo: 1 }; // official schema forbids unknown top-level keys
    const result = evaluateDevice(makeInput(current, "01.07", makeFirmware("01.08")));
    expect(result.status).toBe("blocked");
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("not valid for firmware 01.08");
  });

  it("a patch-only difference is eligible and does not migrate the config", () => {
    // device on 01.08 (.01), firmware 01.08.05 -> same major/minor, push fw only
    const result = evaluateDevice(
      makeInput(makeCleanBaseline("CANedge2", "01.08"), "01.08", makeFirmware("01.08"))
    );
    expect(result.status).toBe("eligible");
    expect(result.eligible).toBe(true);
    expect(result.fw.willUpdate).toBe(true);
    expect(result.fw.willMigrate).toBe(false);
    // no config write -> no merged result to download
    expect(result.merged).toBeUndefined();
  });

  it("a clean migration is eligible and exposes the migrated config (New-config download)", () => {
    const result = evaluateDevice(
      makeInput(makeCleanBaseline("CANedge2", "01.07"), "01.07", makeFirmware("01.08"))
    );
    expect(result.status).toBe("eligible");
    expect(result.eligible).toBe(true);
    expect(result.fw).toMatchObject({
      willUpdate: true,
      willMigrate: true,
      fromRevision: "01.07",
      toRevision: "01.08",
      targetConfigName: "config-01.08.json"
    });
    expect(result.targetName).toBe("config-01.08.json");
    // the migrated config is stored so the table download serves EXACTLY what
    // the run will write - and it must validate against the target schema
    expect(result.merged).toBeDefined();
    expect(result.mergedText).toBe(JSON.stringify(result.merged, null, 2));
    expect(compileValidator(loadSchema("CANedge2", "01.08"))(result.merged)).toBe(true);
  });

  it("a device already on the exact target firmware is shown but not selectable", () => {
    const result = evaluateDevice(
      makeInput(
        makeCleanBaseline("CANedge2", "01.08"),
        "01.08",
        makeFirmware("01.08"),
        { fw_ver: "01.08.05" } // equals the firmware's full fwVer
      )
    );
    expect(result.status).toBe("eligible");
    expect(result.eligible).toBe(false);
    expect(result.fw).toEqual({ willUpdate: false, upToDate: true });
  });

  it("warns when the device has not yet adopted the current server config (crc mismatch)", () => {
    const input = makeInput(
      makeCleanBaseline("CANedge2", "01.08"),
      "01.08",
      makeFirmware("01.08"),
      { cfg_crc32: "DEADBEEF" } // device reports a different adopted crc
    );
    const result = evaluateDevice(input);
    expect(result.eligible).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("not yet adopted"))
    ).toBe(true);
  });
});
