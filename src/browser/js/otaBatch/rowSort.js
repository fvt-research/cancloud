// Column sorting for the OTA device table. Pure - operates on the row objects
// built by selectors.js (getRows).

// display order for the columns whose natural string order is not meaningful
const ENC_RANK = { plain: 0, mixed: 1, encrypted: 2, none: 3 };
const STATUS_RANK = {
  error: 0,
  ready: 1,
  submitting: 2,
  queued: 3,
  submitted: 4,
  nochange: 5,
  aborted: 6,
  blocked: 7,
  pending: 8
};

const statusKey = (row) => {
  const state =
    (row.runState && row.runState.state) ||
    (row.display && row.display.status) ||
    "pending";
  const rank = STATUS_RANK[state];
  return rank === undefined ? null : rank;
};

export const SORT_KEYS = {
  id: (row) => row.id,
  type: (row) => row.type,
  meta: (row) => row.meta.toLowerCase(),
  sec: (row) => {
    const rank = ENC_RANK[row.currentEncStatus];
    return rank === undefined ? null : rank;
  },
  heartbeat: (row) => row.heartbeatMs,
  // "Time since" ascending = smallest age = newest heartbeat
  age: (row) => (row.heartbeatMs ? -row.heartbeatMs : null),
  fwVer: (row) => row.fwVer,
  configSync: (row) =>
    !row.configSync.resolved ? 2 : row.configSync.synced ? 0 : 1,
  status: statusKey
};

const isMissing = (value) =>
  value === null || value === undefined || value === "";

const compare = (a, b) => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

const byId = (rowA, rowB) => (rowA.id < rowB.id ? -1 : rowA.id > rowB.id ? 1 : 0);

// unknown/empty sortBy keeps the incoming (device-id) order
export const sortRows = (rows, sortBy, sortDesc) => {
  const accessor = SORT_KEYS[sortBy];
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
