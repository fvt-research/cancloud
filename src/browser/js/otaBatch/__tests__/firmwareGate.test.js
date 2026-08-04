// firmwareGate: the per-device firmware-update decision (Phase 2). Reuses the
// Phase-1 migration helpers, so it stays in sync with the editor tool. Covers
// the full matrix: wrong type, already-on-target, patch-only, migrate-up,
// downgrade-block, and unsupported source revision.

import { firmwareGate } from "../evaluate";
import { DEVICE_FAMILIES, makeDeviceJson } from "../__fixtures__/otaTestKit";

// firmwareGate only reads deviceType / fwVer / revision from the firmware
const fw = (deviceType, fwVer) => ({
  deviceType,
  fwVer,
  revision: fwVer.slice(0, 5) // "01.09.02" -> "01.09"
});

const CE2 = DEVICE_FAMILIES.CANedge2.type; // device.json hex type -> "CANedge2"

// device.json on revision `rev`; optional 3-part fw patch override
const dev = (rev, fwPatch) => {
  const d = makeDeviceJson({ id: "AABBCCDD", type: CE2, rev, cfg_crc32: "" });
  if (fwPatch) d.fw_ver = rev + "." + fwPatch;
  return d;
};

describe("firmwareGate", () => {
  it("blocks a firmware for a different device type", () => {
    const g = firmwareGate(dev("01.09"), fw("CANedge3 GNSS", "01.09.02"));
    expect(g.reason).toMatch(/CANedge3 GNSS/);
    expect(g.willUpdate).toBeUndefined();
  });

  it("marks a device already on the exact firmware as no update (gray)", () => {
    const g = firmwareGate(dev("01.09", "02"), fw("CANedge2", "01.09.02"));
    expect(g.willUpdate).toBe(false);
  });

  it("pushes firmware only (no migration) when only the patch differs", () => {
    const g = firmwareGate(dev("01.09", "01"), fw("CANedge2", "01.09.03"));
    expect(g.willUpdate).toBe(true);
    expect(g.willMigrate).toBe(false);
    expect(g.targetConfigName).toBe("config-01.09.json");
  });

  it("migrates the config up when the firmware major/minor is newer", () => {
    const g = firmwareGate(dev("01.07"), fw("CANedge2", "01.09.02"));
    expect(g.willUpdate).toBe(true);
    expect(g.willMigrate).toBe(true);
    expect(g.fromRevision).toBe("01.07");
    expect(g.toRevision).toBe("01.09");
    expect(g.targetConfigName).toBe("config-01.09.json");
  });

  it("allows a patch-level downgrade within the same revision (intended re-flash)", () => {
    // device on fw 01.09.03, loaded firmware 01.09.01: same major/minor, so
    // this is a supported re-flash - no migration, config name unchanged
    const g = firmwareGate(dev("01.09", "03"), fw("CANedge2", "01.09.01"));
    expect(g.willUpdate).toBe(true);
    expect(g.willMigrate).toBe(false);
    expect(g.targetConfigName).toBe("config-01.09.json");
  });

  it("blocks a downgrade (device config newer major/minor than firmware)", () => {
    const g = firmwareGate(dev("01.09"), fw("CANedge2", "01.07.03"));
    expect(g.reason).toMatch(/downgrade/i);
    expect(g.willUpdate).toBeUndefined();
  });

  it("blocks a device whose config revision is unsupported", () => {
    const g = firmwareGate(dev("01.06"), fw("CANedge2", "01.09.02"));
    expect(g.reason).toBeDefined();
    expect(g.willUpdate).toBeUndefined();
  });
});
