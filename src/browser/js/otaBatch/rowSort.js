// Column sorting for the OTA device table: the accessors for the row objects
// built by selectors.js (getRows). The algorithm itself is in ../tableSort.js.

import { encRank, sortRows as sortRowsWith } from "../tableSort";

// display order for the status column, whose natural string order is meaningless
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
  sec: (row) => encRank(row.currentEncStatus),
  heartbeat: (row) => row.heartbeatMs,
  // "Time since" ascending = smallest age = newest heartbeat
  age: (row) => (row.heartbeatMs ? -row.heartbeatMs : null),
  fwVer: (row) => row.fwVer,
  configSync: (row) =>
    !row.configSync.resolved ? 2 : row.configSync.synced ? 0 : 1,
  status: statusKey
};

export const sortRows = (rows, sortBy, sortDesc) =>
  sortRowsWith(rows, sortBy, sortDesc, SORT_KEYS);
