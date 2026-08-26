import { COLUMNS, SORT_KEYS, sortRows } from "../rowSort";

// minimal row shape (see DeviceTable.js tableData)
const row = (id, over = {}) => ({
  id,
  type: "CANedge2",
  meta: "",
  sec: null,
  lastHeartbeat: "",
  time_since_heartbeat_min: 0,
  storageUsed: undefined,
  storageUsedAbs: undefined,
  fwVer: "",
  configSync: { synced: false, crc32: "" },
  lastLogUpload: "",
  uploadedMb: NaN,
  heartbeatDeltaMin: undefined,
  storageUsedMb: undefined,
  ...over
});

const ids = (rows, sortBy, sortDesc = false) =>
  sortRows(rows, sortBy, sortDesc).map((r) => r.id);

describe("dashboard SORT_KEYS", () => {
  it("covers every column exactly once", () => {
    expect(Object.keys(SORT_KEYS).sort()).toEqual(
      COLUMNS.map((c) => c.key).sort()
    );
  });

  it("sorts the two heartbeat columns as inverses of each other", () => {
    const rows = [
      row("A", { heartbeatDeltaMin: 30, time_since_heartbeat_min: 30 }),
      row("B", { heartbeatDeltaMin: 5000, time_since_heartbeat_min: 5000 }),
      row("C", { heartbeatDeltaMin: 600, time_since_heartbeat_min: 600 })
    ];
    // ascending "Last heartbeat" = oldest timestamp = largest age first
    expect(ids(rows, "lastHeartbeat")).toEqual(["B", "C", "A"]);
    // ascending "Time since" = smallest age first
    expect(ids(rows, "time_since_heartbeat_min")).toEqual(["A", "C", "B"]);
  });

  it("sorts SD used vs total numerically, not by its display string", () => {
    const rows = [
      row("A", { storageUsedAbs: "9 / 32000", storageUsedMb: 9 }),
      row("B", { storageUsedAbs: "1234 / 32000", storageUsedMb: 1234 }),
      row("C", { storageUsedAbs: "120 / 32000", storageUsedMb: 120 })
    ];
    expect(ids(rows, "storageUsedAbs")).toEqual(["A", "C", "B"]);
  });

  it("keeps devices with no uploads last in both directions", () => {
    const rows = [
      row("A"), // uploadedMb: NaN
      row("B", { uploadedMb: 0.2 }),
      row("C", { uploadedMb: 1 })
    ];
    expect(ids(rows, "uploadedMb")).toEqual(["B", "C", "A"]);
    expect(ids(rows, "uploadedMb", true)).toEqual(["C", "B", "A"]);
  });

  it("ranks the Sec column plain -> mixed -> encrypted -> none, unloaded last", () => {
    const rows = [
      row("A", { sec: "none" }),
      row("B", { sec: "encrypted" }),
      row("C", { sec: "plain" }),
      row("D", { sec: "mixed" }),
      row("E") // config not fetched (yet)
    ];
    expect(ids(rows, "sec")).toEqual(["C", "D", "B", "A", "E"]);
  });

  it("ranks config sync synced before not synced", () => {
    const rows = [
      row("A", { configSync: { synced: false, crc32: "1" } }),
      row("B", { configSync: { synced: true, crc32: "2" } })
    ];
    expect(ids(rows, "configSync")).toEqual(["B", "A"]);
  });

  it("sorts meta case-insensitively and keeps devices without one last", () => {
    const rows = [
      row("A", { meta: "van" }),
      row("B", { meta: "Truck" }),
      row("C"), // no device.json -> undefined meta
      row("D", { meta: "bus" })
    ];
    expect(ids(rows, "meta")).toEqual(["D", "B", "A", "C"]);
    expect(ids(rows, "meta", true)).toEqual(["A", "B", "D", "C"]);
  });
});
