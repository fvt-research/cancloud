import {
  getEncryptEnablement,
  getEncryptActive,
  getFirmwareActive,
  getTlsActive,
  getRows,
  getFilteredRows,
  getSortedRows,
  getFilteredEligibleRows,
  getCounts,
  getMasterChecked,
  getSelectedRows,
  getAggregatedWarnings,
  getLoadProgress
} from "../selectors";

// minimal state slice for the encryption-enablement selectors
const state = (selected, evaluations, encryptPasswords = false) => ({
  otaBatch: { selected, evaluations, encryptPasswords }
});
const enc = (hasPlain, compatible) => ({ enc: { hasPlain, compatible } });

describe("getEncryptEnablement", () => {
  it("enabled when a compatible candidate is selected and none block", () => {
    const r = getEncryptEnablement(
      state(
        { A: true, B: true },
        { A: enc(true, true), B: enc(false, false) } // B neutral (nothing to encrypt)
      )
    );
    expect(r.enabled).toBe(true);
    expect(r.candidates).toBe(1);
    expect(r.blockers).toBe(0);
  });

  it("disabled + reason when a selected device is incompatible", () => {
    const r = getEncryptEnablement(
      state(
        { A: true, B: true },
        { A: enc(true, true), B: enc(true, false) } // B mixed/over-length -> blocker
      )
    );
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain("can't be encrypted");
  });

  it("disabled when nothing selected has plaintext to encrypt", () => {
    const r = getEncryptEnablement(state({ A: true }, { A: enc(false, false) }));
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain("plain-text");
  });

  it("disabled with an empty selection", () => {
    expect(getEncryptEnablement(state({}, {})).enabled).toBe(false);
  });
});

describe("getEncryptActive", () => {
  it("true only when the toggle is on AND the selection allows it", () => {
    const evals = { A: enc(true, true) };
    expect(getEncryptActive(state({ A: true }, evals, true))).toBe(true);
    expect(getEncryptActive(state({ A: true }, evals, false))).toBe(false);
    // toggle on but an incompatible device is selected -> not active
    expect(
      getEncryptActive(
        state(
          { A: true, B: true },
          { A: enc(true, true), B: enc(true, false) },
          true
        )
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// row/table selectors (previously only the encrypt-enablement selectors were
// covered). Full otaBatch slice needed since getRows reads devices/files/
// heartbeats/artifacts/evaluations/run/encrypt.

const rowsState = (over = {}) => ({
  otaBatch: {
    devices: [],
    deviceFiles: {},
    heartbeats: {},
    artifacts: {},
    artifactsRequested: false,
    evaluations: {},
    evalProgress: null,
    selected: {},
    query: "",
    sortBy: "",
    sortDesc: false,
    run: { deviceStatus: {} },
    encryptPasswords: false,
    ...over
  }
});

describe("getRows", () => {
  it("maps the device type name and copies meta/fw/heartbeat", () => {
    const s = rowsState({
      devices: ["AABBCCDD"],
      deviceFiles: { AABBCCDD: { type: "0000001F", log_meta: "Truck-1", fw_ver: "01.09.01" } },
      heartbeats: { AABBCCDD: 1234 }
    });
    const row = getRows(s)[0];
    expect(row.type).toBe("CE2");
    expect(row.meta).toBe("Truck-1");
    expect(row.fwVer).toBe("01.09.01");
    expect(row.heartbeatMs).toBe(1234);
    // the search box also matches type/firmware/status, not just id + meta
    expect(row.searchLabel).toBe("aabbccdd truck-1 ce2 01.09.01 evaluating pending");
  });

  it("resolves config-sync only once the folder crc is known", () => {
    const mk = (deviceCrc, folderCrc) =>
      getRows(
        rowsState({
          devices: ["D"],
          deviceFiles: { D: { type: "0000001F", cfg_crc32: deviceCrc } },
          artifacts: { D: { config: folderCrc ? { crc32: folderCrc } : {} } }
        })
      )[0].configSync;

    expect(mk("1A2B3C4D", "1A2B3C4D")).toEqual({ synced: true, resolved: true, crc32: "1A2B3C4D" });
    expect(mk("1A2B3C4D", "FFFFFFFF")).toEqual({ synced: false, resolved: true, crc32: "1A2B3C4D" });
    // no folder crc yet -> unresolved (column shows nothing, not a red cross)
    expect(mk("1A2B3C4D", null)).toEqual({ synced: false, resolved: false, crc32: "1A2B3C4D" });
  });

  it("derives the per-row display for each evaluation state", () => {
    const disp = (evaluation, extra = {}) =>
      getRows(
        rowsState({ devices: ["D"], deviceFiles: { D: {} }, evaluations: { D: evaluation }, ...extra })
      )[0].display;

    expect(disp(null).status).toBe("pending");
    expect(disp({ status: "pending" }).status).toBe("pending");
    expect(disp({ status: "blocked", reasons: ["nope"] })).toEqual({
      status: "blocked",
      reasons: ["nope"],
      warnings: [],
      willEncrypt: false
    });
    expect(disp({ status: "eligible", partialChanges: true, warnings: ["w"] }).status).toBe("ready");
    expect(disp({ status: "eligible", partialChanges: false, enc: { hasPlain: false } }).status).toBe(
      "nochange"
    );
  });

  it("a TLS-run evaluation is 'ready' with willTls and no download payload flags", () => {
    const evaluation = {
      status: "eligible",
      eligible: true,
      partialChanges: false,
      warnings: [],
      tls: { willUpdate: true }
    };
    const disp = getRows(
      rowsState({ devices: ["D"], deviceFiles: { D: {} }, evaluations: { D: evaluation } })
    )[0].display;
    expect(disp.status).toBe("ready");
    expect(disp.willTls).toBe(true);
    expect(disp.willFirmware).toBe(false);
  });

  it("sets willEncrypt (and merges enc warnings) only when the encrypt toggle is active", () => {
    const evaluation = {
      status: "eligible",
      eligible: true,
      partialChanges: false,
      warnings: [],
      enc: { hasPlain: true, compatible: true, warnings: ["blank pwd"] }
    };
    const base = { devices: ["D"], deviceFiles: { D: {} }, evaluations: { D: evaluation }, selected: { D: true } };

    const off = getRows(rowsState({ ...base, encryptPasswords: false }))[0].display;
    expect(off.willEncrypt).toBe(false);
    expect(off.status).toBe("nochange");

    const on = getRows(rowsState({ ...base, encryptPasswords: true }))[0].display;
    expect(on.willEncrypt).toBe(true);
    expect(on.status).toBe("ready");
    expect(on.warnings).toContain("blank pwd");
  });
});

describe("getRows row identity (fleet-scale re-render guard)", () => {
  const fleetState = (over = {}) =>
    rowsState({
      devices: ["D1", "D2", "D3"],
      deviceFiles: { D1: { type: "0000001F" }, D2: { type: "0000001F" }, D3: {} },
      artifacts: { D1: { config: { crc32: "A" } }, D2: {}, D3: {} },
      evaluations: {
        D1: { status: "eligible", eligible: true, partialChanges: true },
        D2: { status: "eligible", eligible: true, partialChanges: true },
        D3: { status: "blocked", eligible: false }
      },
      ...over
    });

  it("a run-status change for ONE device leaves the other rows identical", () => {
    // spread from the same base, exactly as the reducer does - untouched
    // devices keep their deviceFiles/artifacts/evaluations object identity
    const base = fleetState();
    const before = getRows(base);
    const after = getRows({
      otaBatch: {
        ...base.otaBatch,
        run: { deviceStatus: { D1: { state: "submitting" } } }
      }
    });
    expect(after[0]).not.toBe(before[0]); // D1 rebuilt
    expect(after[0].runState).toEqual({ state: "submitting" });
    // D2/D3 must keep their object identity or every PureComponent row in the
    // table re-renders on every status dispatch (O(n^2) across a run)
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it("an artifact patch for ONE device leaves the other rows identical", () => {
    const base = fleetState();
    const before = getRows(base);
    const patched = {
      otaBatch: {
        ...base.otaBatch,
        artifacts: { ...base.otaBatch.artifacts, D2: { config: { crc32: "B" } } }
      }
    };
    const after = getRows(patched);
    expect(after[1]).not.toBe(before[1]);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it("drops devices that disappear from the fleet", () => {
    getRows(fleetState());
    const shrunk = getRows(fleetState({ devices: ["D2"] }));
    expect(shrunk.map((r) => r.id)).toEqual(["D2"]);
  });
});

describe("getLoadProgress", () => {
  const mk = (artifacts, requested = true) =>
    getLoadProgress(
      rowsState({ devices: ["D1", "D2", "D3"], artifacts, artifactsRequested: requested })
    );

  it("is null before artifacts are requested and once nothing is loading", () => {
    expect(mk({}, false)).toBeNull();
    expect(
      mk({
        D1: { config: { status: "loaded" } },
        D2: { config: { status: "loaded" } },
        D3: { config: { status: "missing" } }
      })
    ).toBeNull();
  });

  it("counts resolved vs still-loading configs while the fetch runs", () => {
    expect(
      mk({
        D1: { config: { status: "loaded" } },
        D2: { config: { status: "loading" } },
        D3: { config: { status: "loading" } }
      })
    ).toEqual({ done: 1, total: 3 });
  });
});

describe("getFirmwareActive / getTlsActive", () => {
  it("reflect whether a firmware.bin / certs_server.p7b is loaded", () => {
    const mk = (over) => ({ otaBatch: { loadedFirmware: null, loadedTls: null, ...over } });
    expect(getFirmwareActive(mk({}))).toBe(false);
    expect(getTlsActive(mk({}))).toBe(false);
    expect(getFirmwareActive(mk({ loadedFirmware: { fileName: "firmware.bin" } }))).toBe(true);
    expect(getTlsActive(mk({ loadedTls: { fileName: "certs_server.p7b" } }))).toBe(true);
  });
});

describe("getFilteredRows / counts / master checkbox", () => {
  const fleet = () =>
    rowsState({
      devices: ["AABBCC01", "AABBCC02", "AABBCC03"],
      deviceFiles: {
        AABBCC01: { type: "0000001F", log_meta: "Truck alpha", fw_ver: "01.07.07" },
        AABBCC02: { type: "0000001F", log_meta: "Truck beta", fw_ver: "01.09.01" },
        AABBCC03: { type: "0000007D", log_meta: "Van gamma", fw_ver: "01.07.07" }
      },
      evaluations: {
        AABBCC01: { status: "eligible", eligible: true, partialChanges: true },
        AABBCC02: { status: "eligible", eligible: true, partialChanges: true },
        AABBCC03: { status: "blocked", eligible: false }
      }
    });

  it("requires every search term to match the id-or-meta label", () => {
    const rows = getFilteredRows({ otaBatch: { ...fleet().otaBatch, query: "truck beta" } });
    expect(rows.map((r) => r.id)).toEqual(["AABBCC02"]);
  });

  it("empty query returns all rows", () => {
    expect(getFilteredRows(fleet()).length).toBe(3);
  });

  it("matches on firmware version, device type and status too", () => {
    const filter = (query) =>
      getFilteredRows({ otaBatch: { ...fleet().otaBatch, query } }).map((r) => r.id);
    expect(filter("01.07.07")).toEqual(["AABBCC01", "AABBCC03"]);
    expect(filter("ce3g")).toEqual(["AABBCC03"]);
    expect(filter("ready")).toEqual(["AABBCC01", "AABBCC02"]);
    expect(filter("incompatible")).toEqual(["AABBCC03"]);
    // terms still AND across fields - the firmware cohort, minus the blocked one
    expect(filter("01.07.07 ready")).toEqual(["AABBCC01"]);
  });

  it("in-scope count and master checkbox follow the filtered set", () => {
    const s = { otaBatch: { ...fleet().otaBatch, query: "01.07.07" } };
    expect(getCounts(s)).toEqual({ selected: 0, inScope: 2, total: 3 });
    // only AABBCC01 of that cohort is eligible -> selecting it checks the master
    expect(getFilteredEligibleRows(s).map((r) => r.id)).toEqual(["AABBCC01"]);
    expect(
      getMasterChecked({ otaBatch: { ...s.otaBatch, selected: { AABBCC01: true } } })
    ).toBe(true);
  });

  it("getSortedRows orders the filtered rows and flips on sortDesc", () => {
    const sorted = (over) =>
      getSortedRows({ otaBatch: { ...fleet().otaBatch, ...over } }).map((r) => r.id);
    expect(sorted({})).toEqual(["AABBCC01", "AABBCC02", "AABBCC03"]);
    // ties (01.07.07) fall back to device id
    expect(sorted({ sortBy: "fwVer" })).toEqual(["AABBCC01", "AABBCC03", "AABBCC02"]);
    expect(sorted({ sortBy: "fwVer", sortDesc: true })).toEqual([
      "AABBCC02",
      "AABBCC01",
      "AABBCC03"
    ]);
    expect(sorted({ sortBy: "meta", sortDesc: true })).toEqual([
      "AABBCC03",
      "AABBCC02",
      "AABBCC01"
    ]);
    // sorting applies after filtering
    expect(sorted({ query: "truck", sortBy: "meta", sortDesc: true })).toEqual([
      "AABBCC02",
      "AABBCC01"
    ]);
  });

  it("filtered-eligible excludes blocked rows", () => {
    expect(getFilteredEligibleRows(fleet()).map((r) => r.id)).toEqual(["AABBCC01", "AABBCC02"]);
  });

  it("counts selected / in-scope / total", () => {
    const s = { otaBatch: { ...fleet().otaBatch, selected: { AABBCC01: true } } };
    expect(getCounts(s)).toEqual({ selected: 1, inScope: 3, total: 3 });
  });

  it("master checkbox is checked only when every filtered-eligible row is selected", () => {
    const none = fleet();
    expect(getMasterChecked(none)).toBe(false);
    const all = { otaBatch: { ...fleet().otaBatch, selected: { AABBCC01: true, AABBCC02: true } } };
    expect(getMasterChecked(all)).toBe(true);
    const some = { otaBatch: { ...fleet().otaBatch, selected: { AABBCC01: true } } };
    expect(getMasterChecked(some)).toBe(false);
  });
});

describe("getSelectedRows / getAggregatedWarnings", () => {
  const ready = (warnings) => ({
    status: "eligible",
    eligible: true,
    partialChanges: true,
    warnings
  });

  const warnFleet = (selected) =>
    rowsState({
      devices: ["D1", "D2", "D3", "D4"],
      deviceFiles: { D1: {}, D2: {}, D3: {}, D4: {} },
      evaluations: {
        D1: ready(["TLS mismatch"]),
        D2: ready(["TLS mismatch", "stale"]),
        // blocked rows never contribute warnings
        D3: { status: "blocked", reasons: ["x"], warnings: ["should not count"] },
        D4: ready(["only D4"])
      },
      selected
    });

  it("selected rows are the picked ones, independent of the search filter", () => {
    const s = warnFleet({ D2: true, D4: true });
    expect(getSelectedRows(s).map((r) => r.id)).toEqual(["D2", "D4"]);
    expect(
      getSelectedRows({ otaBatch: { ...s.otaBatch, query: "d4" } }).map((r) => r.id)
    ).toEqual(["D2", "D4"]);
  });

  it("counts each unique warning across SELECTED 'ready' rows only", () => {
    const agg = getAggregatedWarnings(warnFleet({ D1: true, D2: true }));
    expect(agg).toEqual([
      { message: "TLS mismatch", devices: 2 },
      { message: "stale", devices: 1 }
    ]);
  });

  it("ignores warnings of devices the user is not submitting to", () => {
    // D4's warning and D1's copy of the shared message must not appear
    expect(getAggregatedWarnings(warnFleet({ D2: true }))).toEqual([
      { message: "TLS mismatch", devices: 1 },
      { message: "stale", devices: 1 }
    ]);
    // a selected blocked device contributes nothing
    expect(getAggregatedWarnings(warnFleet({ D3: true }))).toEqual([]);
    expect(getAggregatedWarnings(warnFleet({}))).toEqual([]);
  });
});
