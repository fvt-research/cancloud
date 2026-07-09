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

// one row per device folder; blocked/incomplete devices included (greyed)
export const getRows = createSelector(
  devicesSelector,
  deviceFilesSelector,
  heartbeatsSelector,
  artifactsSelector,
  evaluationsSelector,
  runStatusSelector,
  (devices, deviceFiles, heartbeats, artifacts, evaluations, runStatus) =>
    devices.map((deviceId) => {
      const deviceJson = deviceFiles[deviceId];
      const artifact = artifacts[deviceId] || {};
      const configMeta = artifact.config || {};
      const evaluation = evaluations[deviceId];

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
        evaluation: evaluation || null,
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
  rows.filter((row) => row.evaluation && row.evaluation.status === "ready")
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

// aggregated warnings across evaluated devices: unique message with count
export const getAggregatedWarnings = createSelector(
  evaluationsSelector,
  (evaluations) => {
    const counts = {};
    const order = [];
    Object.keys(evaluations).forEach((deviceId) => {
      const evaluation = evaluations[deviceId];
      if (!evaluation || evaluation.status !== "ready") return;
      (evaluation.warnings || []).forEach((message) => {
        if (counts[message] === undefined) {
          counts[message] = 0;
          order.push(message);
        }
        counts[message] += 1;
      });
    });
    return order.map((message) => ({ message, devices: counts[message] }));
  }
);
