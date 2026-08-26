// Column sorting shared by the device tables (OTA batch manager + status
// dashboard). Pure - rows in, a new sorted array out; the caller supplies the
// accessor map for its own row shape.

// display order for the encryption states rendered by encryptionLock.js
const ENC_RANK = { plain: 0, mixed: 1, encrypted: 2, none: 3 };

export const encRank = (status) => {
  const rank = ENC_RANK[status];
  return rank === undefined ? null : rank;
};

// NaN counts as missing: a comparator returning NaN leaves the order undefined
const isMissing = (value) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (typeof value === "number" && isNaN(value));

const compare = (a, b) => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

const byId = (rowA, rowB) => (rowA.id < rowB.id ? -1 : rowA.id > rowB.id ? 1 : 0);

// unknown/empty sortBy keeps the incoming (device-id) order
export const sortRows = (rows, sortBy, sortDesc, sortKeys) => {
  const accessor = sortKeys[sortBy];
  if (!accessor) return rows;
  const direction = sortDesc ? -1 : 1;
  return rows.slice().sort((rowA, rowB) => {
    const valueA = accessor(rowA);
    const valueB = accessor(rowB);
    // devices with no value (e.g. missing device.json) stay last in BOTH
    // directions - they must not jump to the top when the arrow flips
    const missingA = isMissing(valueA);
    const missingB = isMissing(valueB);
    if (missingA || missingB) {
      if (missingA && missingB) return byId(rowA, rowB);
      return missingA ? 1 : -1;
    }
    const result = compare(valueA, valueB);
    return result !== 0 ? result * direction : byId(rowA, rowB);
  });
};

// clicking a column sorts it ascending; clicking the same column flips it
export const nextSort = (sortBy, sortDesc, key) => ({
  sortBy: key,
  sortDesc: sortBy === key ? !sortDesc : false
});
