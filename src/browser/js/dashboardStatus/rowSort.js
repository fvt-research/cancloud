// Columns and sort accessors for the status dashboard device table (see
// DeviceTable.js). The algorithm itself is in ../tableSort.js.

import { encRank, sortRows as sortRowsWith } from "../tableSort";

// drives both the header row and the cell order - every column is sortable
export const COLUMNS = [
  { key: "id", label: "Device ID" },
  { key: "type", label: "Type" },
  { key: "meta", label: "Config meta" },
  { key: "sec", label: "Sec", title: "Current password encryption state" },
  { key: "lastHeartbeat", label: "Last heartbeat" },
  { key: "time_since_heartbeat_min", label: "Time since" },
  { key: "storageUsed", label: "SD storage used" },
  { key: "storageUsedAbs", label: "SD used vs total" },
  { key: "fwVer", label: "Firmware" },
  { key: "configSync", label: "Config sync" },
  { key: "lastLogUpload", label: "Last log upload" },
  { key: "uploadedMb", label: "MB uploaded" }
];

export const SORT_KEYS = {
  id: (row) => row.id,
  type: (row) => row.type,
  meta: (row) => (row.meta ? row.meta.toLowerCase() : null),
  sec: (row) => encRank(row.sec),
  // ascending = oldest heartbeat first; the cell is a formatted string, so both
  // heartbeat columns sort on the underlying age in minutes
  lastHeartbeat: (row) =>
    row.heartbeatDeltaMin === undefined ? null : -row.heartbeatDeltaMin,
  time_since_heartbeat_min: (row) => row.time_since_heartbeat_min,
  storageUsed: (row) => row.storageUsed,
  // the cell is the string "1234 / 32000" - sort on the used MB instead
  storageUsedAbs: (row) => row.storageUsedMb,
  fwVer: (row) => row.fwVer,
  configSync: (row) => (row.configSync.synced ? 0 : 1),
  lastLogUpload: (row) => row.lastLogUpload,
  uploadedMb: (row) => row.uploadedMb
};

export const sortRows = (rows, sortBy, sortDesc) =>
  sortRowsWith(rows, sortBy, sortDesc, SORT_KEYS);
