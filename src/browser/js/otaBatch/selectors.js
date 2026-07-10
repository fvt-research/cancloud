import { createSelector } from "reselect";
import { canedgeTypeName } from "../utils";

const devicesSelector = (state) => state.otaBatch.devices;
const deviceFilesSelector = (state) => state.otaBatch.deviceFiles;
const heartbeatsSelector = (state) => state.otaBatch.heartbeats;
const artifactsSelector = (state) => state.otaBatch.artifacts;
const evaluationsSelector = (state) => state.otaBatch.evaluations;
const selectedSelector = (state) => state.otaBatch.selected;
const querySelector = (state) => state.otaBatch.query;
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
  const willEncrypt = !!(
    encryptActive &&
    evaluation.enc &&
    evaluation.enc.hasPlain &&
    evaluation.enc.compatible
  );
  const hasChange = !!evaluation.partialChanges || willEncrypt;
  let warnings = [];
  if (hasChange) {
    warnings = (evaluation.warnings || []).slice();
    if (willEncrypt) warnings = warnings.concat(evaluation.enc.warnings || []);
  }
  return {
    status: hasChange ? "ready" : "nochange",
    reasons: [],
    warnings,
    willEncrypt
  };
};

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
  ) =>
    devices.map((deviceId) => {
      const deviceJson = deviceFiles[deviceId];
      const artifact = artifacts[deviceId] || {};
      const configMeta = artifact.config || {};
      const evaluation = evaluations[deviceId] || null;

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

      return {
        id: deviceId,
        type: canedgeTypeName(deviceJson && deviceJson.type),
        meta: (deviceJson && deviceJson.log_meta) || "",
        fwVer: (deviceJson && deviceJson.fw_ver) || "",
        heartbeatMs: heartbeats[deviceId] || null,
        configSync: { synced, resolved, crc32: crc32 || "" },
        evaluation,
        eligible: !!(evaluation && evaluation.eligible),
        currentEncStatus: evaluation ? evaluation.currentEncStatus : null,
        display: deriveDisplay(evaluation, encryptActive),
        runState: runStatus[deviceId] || null,
        searchLabel: (
          deviceId +
          " " +
          ((deviceJson && deviceJson.log_meta) || "")
        ).toLowerCase()
      };
    })
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

// aggregated warnings across devices that will actually change, given the
// current toggle: unique message with device count
export const getAggregatedWarnings = createSelector(getRows, (rows) => {
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
