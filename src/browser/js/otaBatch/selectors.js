import { createSelector } from "reselect";
import { canedgeTypeName } from "../utils";
import { sortRows } from "./rowSort";

const devicesSelector = (state) => state.otaBatch.devices;
const deviceFilesSelector = (state) => state.otaBatch.deviceFiles;
const heartbeatsSelector = (state) => state.otaBatch.heartbeats;
const artifactsSelector = (state) => state.otaBatch.artifacts;
const artifactsRequestedSelector = (state) => state.otaBatch.artifactsRequested;
const evaluationsSelector = (state) => state.otaBatch.evaluations;
const selectedSelector = (state) => state.otaBatch.selected;
const querySelector = (state) => state.otaBatch.query;
const sortBySelector = (state) => state.otaBatch.sortBy;
const sortDescSelector = (state) => state.otaBatch.sortDesc;
const runStatusSelector = (state) => state.otaBatch.run.deviceStatus;
const encryptPasswordsSelector = (state) => state.otaBatch.encryptPasswords;

// Encrypt-checkbox enablement over the current selection: enabled only when no
// selected device is encryption-incompatible AND at least one has plaintext to
// encrypt. An incompatible device blocks the batch (it is NOT auto-excluded);
// fully-encrypted / no-password devices are neutral.
export const getEncryptEnablement = createSelector(
  evaluationsSelector,
  selectedSelector,
  (evaluations, selected) => {
    const selectedCount = Object.keys(selected).length;
    let blockers = 0;
    let candidates = 0;
    Object.keys(selected).forEach((deviceId) => {
      const enc = evaluations[deviceId] && evaluations[deviceId].enc;
      if (!enc || !enc.hasPlain) return; // neutral - nothing to encrypt
      if (enc.compatible) candidates += 1;
      else blockers += 1;
    });
    const enabled = blockers === 0 && candidates > 0;
    let reason = null;
    if (!enabled) {
      if (blockers > 0) {
        reason =
          blockers +
          " of the selected device(s) can't be encrypted (mixed encryption, password too long, or an invalid device key) - deselect them, or load a partial that sets those passwords to plain-text, to enable encryption";
      } else if (selectedCount === 0) {
        reason =
          "Select one or more devices with plain-text passwords to enable encryption";
      } else {
        reason =
          "None of the selected devices have plain-text passwords to encrypt (they are already encrypted or have no passwords)";
      }
    }
    return { enabled, reason, blockers, candidates };
  }
);

// effective encrypt intent: the toggle is on AND the selection allows it
export const getEncryptActive = createSelector(
  encryptPasswordsSelector,
  getEncryptEnablement,
  (encryptPasswords, enablement) => encryptPasswords && enablement.enabled
);

// a firmware.bin is loaded -> the batch is a firmware run (mutually exclusive
// with the config/encrypt flow)
const loadedFirmwareSelector = (state) => state.otaBatch.loadedFirmware;
export const getFirmwareActive = createSelector(
  loadedFirmwareSelector,
  (loadedFirmware) => !!loadedFirmware
);

// a certs_server.p7b is loaded -> the batch is a TLS certificate run
// (mutually exclusive with the config/encrypt and firmware flows)
const loadedTlsSelector = (state) => state.otaBatch.loadedTls;
export const getTlsActive = createSelector(
  loadedTlsSelector,
  (loadedTls) => !!loadedTls
);

// derive the per-row display given the (toggle-independent) evaluation and the
// effective encrypt state
const deriveDisplay = (evaluation, encryptActive) => {
  if (!evaluation || evaluation.status === "pending") {
    return { status: "pending", reasons: [], warnings: [], willEncrypt: false };
  }
  if (evaluation.status === "blocked") {
    return {
      status: "blocked",
      reasons: evaluation.reasons || [],
      warnings: [],
      willEncrypt: false
    };
  }
  // eligible
  const willFirmware = !!(evaluation.fw && evaluation.fw.willUpdate);
  const willMigrate = !!(willFirmware && evaluation.fw.willMigrate);
  const willTls = !!(evaluation.tls && evaluation.tls.willUpdate);
  const willEncrypt = !!(
    encryptActive &&
    evaluation.enc &&
    evaluation.enc.hasPlain &&
    evaluation.enc.compatible
  );
  const hasChange =
    !!evaluation.partialChanges || willEncrypt || willFirmware || willTls;
  let warnings = [];
  if (hasChange) {
    warnings = (evaluation.warnings || []).slice();
    if (willEncrypt) warnings = warnings.concat(evaluation.enc.warnings || []);
  }
  return {
    status: hasChange ? "ready" : "nochange",
    reasons: [],
    warnings,
    willEncrypt,
    willFirmware,
    willMigrate,
    willTls
  };
};

// searchable words per status so the search box can narrow on what the Status
// column shows (run states are already single words)
const STATUS_WORDS = {
  pending: "evaluating pending",
  blocked: "incompatible blocked",
  nochange: "no change nochange",
  ready: "ready"
};
const statusWords = (display, runState) =>
  (runState && runState.state) || STATUS_WORDS[display.status] || "";

const buildRow = (
  deviceId,
  deviceJson,
  artifact,
  evaluation,
  runState,
  heartbeatMs,
  encryptActive
) => {
  const configMeta = artifact.config || {};
  const crc32 = deviceJson && deviceJson.cfg_crc32;
  // identical predicate to the status dashboard (prepareDataDevices.js)
  const synced =
    crc32 && configMeta.crc32
      ? parseInt(configMeta.crc32, 16) === parseInt(crc32, 16)
      : false;
  // resolved once the folder config crc is known - until then (e.g. during
  // a refresh) the sync state is unknown, so the column shows nothing
  // rather than defaulting to a red cross
  const resolved = !!(configMeta && configMeta.crc32);

  const type = canedgeTypeName(deviceJson && deviceJson.type);
  const meta = (deviceJson && deviceJson.log_meta) || "";
  const fwVer = (deviceJson && deviceJson.fw_ver) || "";
  const display = deriveDisplay(evaluation, encryptActive);

  return {
    id: deviceId,
    type,
    meta,
    fwVer,
    heartbeatMs,
    configSync: { synced, resolved, crc32: crc32 || "" },
    evaluation,
    eligible: !!(evaluation && evaluation.eligible),
    currentEncStatus: evaluation ? evaluation.currentEncStatus : null,
    display,
    runState,
    searchLabel: [deviceId, meta, type, fwVer, statusWords(display, runState)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
};

// Per-device row memo. A run-status or artifact change for ONE device must not
// hand every OTHER row a new object: the rows are PureComponents, so that would
// re-render the whole table on every update (O(n^2) over a fleet-sized run -
// measured at ~0.7s per status change with 200 devices). Entries are keyed by
// the identity of each input, and devices that disappear drop out on rebuild.
const EMPTY_ARTIFACT = {};
let rowMemo = new Map();

// one row per device folder; blocked/incomplete devices included (greyed)
export const getRows = createSelector(
  devicesSelector,
  deviceFilesSelector,
  heartbeatsSelector,
  artifactsSelector,
  evaluationsSelector,
  runStatusSelector,
  getEncryptActive,
  (
    devices,
    deviceFiles,
    heartbeats,
    artifacts,
    evaluations,
    runStatus,
    encryptActive
  ) => {
    const memo = new Map();
    const rows = devices.map((deviceId) => {
      const deviceJson = deviceFiles[deviceId] || null;
      const artifact = artifacts[deviceId] || EMPTY_ARTIFACT;
      const evaluation = evaluations[deviceId] || null;
      const runState = runStatus[deviceId] || null;
      const heartbeatMs = heartbeats[deviceId] || null;

      const cached = rowMemo.get(deviceId);
      if (
        cached &&
        cached.deviceJson === deviceJson &&
        cached.artifact === artifact &&
        cached.evaluation === evaluation &&
        cached.runState === runState &&
        cached.heartbeatMs === heartbeatMs &&
        cached.encryptActive === encryptActive
      ) {
        memo.set(deviceId, cached);
        return cached.row;
      }

      const row = buildRow(
        deviceId,
        deviceJson,
        artifact,
        evaluation,
        runState,
        heartbeatMs,
        encryptActive
      );
      memo.set(deviceId, {
        deviceJson,
        artifact,
        evaluation,
        runState,
        heartbeatMs,
        encryptActive,
        row
      });
      return row;
    });
    rowMemo = memo;
    return rows;
  }
);

// config/schema fetch progress, so the table can say what it is waiting for
// instead of showing a fleet of silent "Evaluating ..." rows
export const getLoadProgress = createSelector(
  devicesSelector,
  artifactsSelector,
  artifactsRequestedSelector,
  (devices, artifacts, requested) => {
    if (!requested || !devices.length) return null;
    let done = 0;
    let loading = 0;
    devices.forEach((deviceId) => {
      const artifact = artifacts[deviceId];
      const status = artifact && artifact.config && artifact.config.status;
      if (status === "loading") loading += 1;
      else if (status) done += 1;
    });
    return loading ? { done, total: done + loading } : null;
  }
);

export const getFilteredRows = createSelector(
  getRows,
  querySelector,
  (rows, query) => {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
    if (!terms.length) return rows;
    return rows.filter((row) =>
      terms.every((term) => row.searchLabel.indexOf(term) > -1)
    );
  }
);

// the rendered order. Must be a selector: the component slices RENDER_CAP off
// this result, so sorting after that would order only the first 1000 matches
export const getSortedRows = createSelector(
  getFilteredRows,
  sortBySelector,
  sortDescSelector,
  sortRows
);

export const getFilteredEligibleRows = createSelector(getFilteredRows, (rows) =>
  rows.filter((row) => row.eligible)
);

export const getCounts = createSelector(
  getRows,
  getFilteredRows,
  selectedSelector,
  (rows, filteredRows, selected) => ({
    selected: Object.keys(selected).length,
    inScope: filteredRows.length,
    total: rows.length
  })
);

// master checkbox: checked iff every filtered ELIGIBLE row is selected
// (false when none are eligible)
export const getMasterChecked = createSelector(
  getFilteredEligibleRows,
  selectedSelector,
  (eligibleRows, selected) =>
    eligibleRows.length > 0 && eligibleRows.every((row) => selected[row.id])
);

// rows the user has picked (order/filter independent - the submit set is the
// selection, not what the table happens to show)
export const getSelectedRows = createSelector(
  getRows,
  selectedSelector,
  (rows, selected) => rows.filter((row) => selected[row.id])
);

// aggregated warnings across the SELECTED devices that will actually change,
// given the current toggle: unique message with device count
export const getAggregatedWarnings = createSelector(getSelectedRows, (rows) => {
  const counts = {};
  const order = [];
  rows.forEach((row) => {
    if (!row.display || row.display.status !== "ready") return;
    (row.display.warnings || []).forEach((message) => {
      if (counts[message] === undefined) {
        counts[message] = 0;
        order.push(message);
      }
      counts[message] += 1;
    });
  });
  return order.map((message) => ({ message, devices: counts[message] }));
});
