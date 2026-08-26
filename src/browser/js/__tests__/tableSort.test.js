import { encRank, nextSort, sortRows } from "../tableSort";

// toy row shape - the real accessor maps live in otaBatch/rowSort.js and
// dashboardStatus/rowSort.js, each with their own tests
const SORT_KEYS = {
  id: (row) => row.id,
  name: (row) => row.name,
  size: (row) => row.size
};

const row = (id, over = {}) => ({ id, name: "n", size: 1, ...over });

const ids = (rows, sortBy, sortDesc = false) =>
  sortRows(rows, sortBy, sortDesc, SORT_KEYS).map((r) => r.id);

describe("sortRows", () => {
  it("returns the input untouched for an empty or unknown sort key", () => {
    const rows = [row("B"), row("A")];
    expect(sortRows(rows, "", false, SORT_KEYS)).toBe(rows);
    expect(sortRows(rows, "nope", false, SORT_KEYS)).toBe(rows);
  });

  it("does not mutate the input array", () => {
    const rows = [row("B"), row("A")];
    sortRows(rows, "id", false, SORT_KEYS);
    expect(rows.map((r) => r.id)).toEqual(["B", "A"]);
  });

  it("sorts strings and flips on descending", () => {
    const rows = [row("C"), row("A"), row("B")];
    expect(ids(rows, "id")).toEqual(["A", "B", "C"]);
    expect(ids(rows, "id", true)).toEqual(["C", "B", "A"]);
  });

  it("sorts numbers numerically, not as strings", () => {
    const rows = [
      row("A", { size: 9 }),
      row("B", { size: 100 }),
      row("C", { size: 20 })
    ];
    expect(ids(rows, "size")).toEqual(["A", "C", "B"]);
  });

  it("keeps missing values last in BOTH directions", () => {
    const cases = [null, undefined, "", NaN];
    cases.forEach((missing) => {
      const rows = [
        row("A", { size: missing }),
        row("B", { size: 2 }),
        row("C", { size: 1 })
      ];
      expect(ids(rows, "size")).toEqual(["C", "B", "A"]);
      expect(ids(rows, "size", true)).toEqual(["B", "C", "A"]);
    });
  });

  it("orders rows that are both missing by id", () => {
    const rows = [row("C", { size: NaN }), row("A", { size: null })];
    expect(ids(rows, "size")).toEqual(["A", "C"]);
    expect(ids(rows, "size", true)).toEqual(["A", "C"]);
  });

  it("breaks ties on id ascending, in both directions", () => {
    const rows = [row("C"), row("A"), row("B")];
    expect(ids(rows, "name")).toEqual(["A", "B", "C"]);
    expect(ids(rows, "name", true)).toEqual(["A", "B", "C"]);
  });
});

describe("nextSort", () => {
  it("sorts a new column ascending and flips the current one", () => {
    expect(nextSort("", false, "id")).toEqual({ sortBy: "id", sortDesc: false });
    expect(nextSort("id", false, "id")).toEqual({ sortBy: "id", sortDesc: true });
    expect(nextSort("id", true, "id")).toEqual({ sortBy: "id", sortDesc: false });
    expect(nextSort("id", true, "size")).toEqual({
      sortBy: "size",
      sortDesc: false
    });
  });
});

describe("encRank", () => {
  it("ranks plain -> mixed -> encrypted -> none, unknown last", () => {
    expect(
      ["none", "encrypted", "plain", "mixed"].sort((a, b) => encRank(a) - encRank(b))
    ).toEqual(["plain", "mixed", "encrypted", "none"]);
    expect(encRank("bogus")).toBeNull();
    expect(encRank(null)).toBeNull();
  });
});
