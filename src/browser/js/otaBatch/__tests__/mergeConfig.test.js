// mergeConfig is the single most load-bearing primitive in the feature: every
// per-device merged config (and every submitted PUT body) comes from it. Its
// array-OVERWRITE semantics are a deliberate, safety-relevant choice - and also
// the most likely way a careless partial silently wipes fleet data, so pin it.

import { mergeConfig } from "../evaluate";

describe("mergeConfig array-overwrite semantics", () => {
  it("REPLACES arrays wholesale rather than concatenating (transmit list)", () => {
    const config = { can_1: { transmit: [{ id: "1" }, { id: "2" }, { id: "3" }] } };
    const merged = mergeConfig(config, { can_1: { transmit: [{ id: "9" }] } });
    // the device's other transmit entries are GONE - a 1-entry partial wipes the rest
    expect(merged.can_1.transmit).toEqual([{ id: "9" }]);
  });

  it("REPLACES a CAN filter list wholesale", () => {
    const config = { can_1: { filter: { id: [{ name: "a" }, { name: "b" }] } } };
    const merged = mergeConfig(config, { can_1: { filter: { id: [{ name: "only" }] } } });
    expect(merged.can_1.filter.id).toEqual([{ name: "only" }]);
  });

  it("REPLACES the wifi accesspoint array wholesale (encryption relies on this)", () => {
    const config = { connect: { wifi: { accesspoint: [{ ssid: "a" }, { ssid: "b" }] } } };
    const merged = mergeConfig(config, { connect: { wifi: { accesspoint: [{ ssid: "c" }] } } });
    expect(merged.connect.wifi.accesspoint).toEqual([{ ssid: "c" }]);
  });

  it("an empty array partial clears the list (e.g. removes all filters)", () => {
    const config = { can_1: { filter: { id: [{ name: "a" }] } } };
    const merged = mergeConfig(config, { can_1: { filter: { id: [] } } });
    expect(merged.can_1.filter.id).toEqual([]);
  });
});

describe("mergeConfig object-merge semantics", () => {
  it("deep-merges nested objects, preserving untouched siblings", () => {
    const config = { general: { device: { meta: "x" }, security: { kpub: "K" } } };
    const merged = mergeConfig(config, { general: { device: { meta: "y" } } });
    expect(merged.general.device.meta).toBe("y");
    expect(merged.general.security.kpub).toBe("K"); // untouched sibling survives
  });

  it("adds new keys without removing existing ones", () => {
    const merged = mergeConfig({ a: 1 }, { b: 2 });
    expect(merged).toEqual({ a: 1, b: 2 });
  });

  it("an empty partial yields a config deep-equal to the original", () => {
    const config = { general: { device: { meta: "x" } }, can_1: { transmit: [{ id: "1" }] } };
    expect(mergeConfig(config, {})).toEqual(config);
  });

  it("does not mutate the source config", () => {
    const config = { general: { security: { kpub: "K" } } };
    mergeConfig(config, { general: { security: { kpub: "NEW" } } });
    expect(config.general.security.kpub).toBe("K");
  });

  it("SETS a null value rather than ignoring it (kpub cleared to null != '')", () => {
    // documents why D14's clearsKpub keys on === "" (evaluate.js:119): a partial
    // that sets kpub to null would NOT be caught by the kpub-clear note/guard.
    const merged = mergeConfig({ general: { security: { kpub: "K" } } }, { general: { security: { kpub: null } } });
    expect(merged.general.security.kpub).toBeNull();
  });
});
