import { SORT_KEYS, sortRows } from "../rowSort";

// minimal row shape (see selectors.js getRows)
const row = (id, over = {}) => ({
  id,
  type: "CE2",
  meta: "",
  fwVer: "",
  heartbeatMs: null,
  configSync: { synced: false, resolved: false, crc32: "" },
  currentEncStatus: null,
  display: { status: "pending" },
  runState: null,
  ...over
});

const ids = (rows, sortBy, sortDesc = false) =>
  sortRows(rows, sortBy, sortDesc).map((r) => r.id);

describe("sortRows", () => {
  it("returns the input untouched for an empty or unknown sort key", () => {
    const rows = [row("B"), row("A")];
    expect(sortRows(rows, "", false)).toBe(rows);
    expect(sortRows(rows, "nope", false)).toBe(rows);
  });

  it("does not mutate the input array", () => {
    const rows = [row("B"), row("A")];
    sortRows(rows, "id", false);
    expect(rows.map((r) => r.id)).toEqual(["B", "A"]);
  });

  it("sorts by device id and flips on descending", () => {
    const rows = [row("C"), row("A"), row("B")];
    expect(ids(rows, "id")).toEqual(["A", "B", "C"]);
    expect(ids(rows, "id", true)).toEqual(["C", "B", "A"]);
  });

  it("sorts strings case-insensitively for meta", () => {
    const rows = [
      row("A", { meta: "van" }),
      row("B", { meta: "Truck" }),
      row("C", { meta: "bus" })
    ];
    expect(ids(rows, "meta")).toEqual(["C", "B", "A"]);
  });

  it("sorts firmware versions in string order (zero-padded)", () => {
    const rows = [
      row("A", { fwVer: "01.10.01" }),
      row("B", { fwVer: "01.07.07" }),
      row("C", { fwVer: "01.09.00" })
    ];
    expect(ids(rows, "fwVer")).toEqual(["B", "C", "A"]);
    expect(ids(rows, "fwVer", true)).toEqual(["A", "C", "B"]);
  });

  it("sorts heartbeats numerically, and 'age' as their inverse", () => {
    const rows = [
      row("A", { heartbeatMs: 3000 }),
      row("B", { heartbeatMs: 1000 }),
      row("C", { heartbeatMs: 2000 })
    ];
    expect(ids(rows, "heartbeat")).toEqual(["B", "C", "A"]);
    // "Time since" ascending = smallest age = newest heartbeat first
    expect(ids(rows, "age")).toEqual(["A", "C", "B"]);
  });

  it("ranks the Sec column plain -> mixed -> encrypted -> none", () => {
    const rows = [
      row("A", { currentEncStatus: "none" }),
      row("B", { currentEncStatus: "encrypted" }),
      row("C", { currentEncStatus: "plain" }),
      row("D", { currentEncStatus: "mixed" })
    ];
    expect(ids(rows, "sec")).toEqual(["C", "D", "B", "A"]);
  });

  it("ranks config-sync synced -> not synced -> unresolved", () => {
    const rows = [
      row("A", { configSync: { synced: false, resolved: false, crc32: "" } }),
      row("B", { configSync: { synced: false, resolved: true, crc32: "1" } }),
      row("C", { configSync: { synced: true, resolved: true, crc32: "1" } })
    ];
    expect(ids(rows, "configSync")).toEqual(["C", "B", "A"]);
  });

  it("ranks status with errors first and pending last, run state winning", () => {
    const rows = [
      row("A", { display: { status: "blocked" } }),
      row("B", { display: { status: "ready" } }),
      row("C", { display: { status: "pending" } }),
      row("D", { display: { status: "nochange" } }),
      // a run state overrides the evaluation display
      row("E", { display: { status: "ready" }, runState: { state: "error" } })
    ];
    expect(ids(rows, "status")).toEqual(["E", "B", "D", "A", "C"]);
  });

  it("keeps rows with no value last in BOTH directions", () => {
    const rows = [
      row("A", { fwVer: "" }), // e.g. no readable device.json
      row("B", { fwVer: "01.09.00" }),
      row("C", { fwVer: "01.07.07" })
    ];
    expect(ids(rows, "fwVer")).toEqual(["C", "B", "A"]);
    expect(ids(rows, "fwVer", true)).toEqual(["B", "C", "A"]);
  });

  it("breaks ties on device id ascending, in both directions", () => {
    const rows = [
      row("C", { fwVer: "01.09.00" }),
      row("A", { fwVer: "01.09.00" }),
      row("B", { fwVer: "01.09.00" })
    ];
    expect(ids(rows, "fwVer")).toEqual(["A", "B", "C"]);
    expect(ids(rows, "fwVer", true)).toEqual(["A", "B", "C"]);
  });
});

describe("SORT_KEYS", () => {
  it("covers every sortable column exactly once", () => {
    expect(Object.keys(SORT_KEYS)).toEqual([
      "id",
      "type",
      "meta",
      "sec",
      "heartbeat",
      "age",
      "fwVer",
      "configSync",
      "status"
    ]);
  });

  it("returns null (-> sorted last) for unknown rank values", () => {
    expect(SORT_KEYS.sec(row("A", { currentEncStatus: "bogus" }))).toBeNull();
    expect(SORT_KEYS.status(row("A", { display: { status: "bogus" } }))).toBeNull();
  });
});
