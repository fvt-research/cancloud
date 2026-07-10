import web from "../web";
import history from "../history";
import { pathSlice } from "../utils";
import { statusRequestQueue } from "../requestQueue";
import * as dashboardStatusActions from "../dashboardStatus/actions";
import * as alertActions from "../alert/actions";
import { encryptionFields, encryptionCrypto } from "config-editor-tools";

import * as cache from "./cache";
import { analyzePartial, evaluateDevice, mergeConfig } from "./evaluate";
import { getEncryptActive } from "./selectors";
import {
  startRun as engineStartRun,
  retryRun as engineRetryRun,
  abortRun as engineAbortRun,
  invalidateRun as engineInvalidateRun
} from "./submitEngine";
import { DEVICE_FOLDER_REGEX, PRESIGN_EXPIRY } from "./constants";
import {
  SET_ENCRYPT_PASSWORDS,
  SET_DEVICE_DATA,
  SET_PARTIAL,
  CLEAR_PARTIAL,
  SET_ARTIFACTS_REQUESTED,
  PATCH_ARTIFACTS,
  SET_EVALUATIONS,
  BUMP_EVAL_TOKEN,
  SET_QUERY,
  TOGGLE_SELECT,
  SET_SELECTION,
  SET_CONFIRM_OPEN,
  RUN_ABORT_REQUESTED,
  RUN_DEVICE_STATUS,
  RESET
} from "./actionTypes";

export * from "./actionTypes";

export const setQuery = (query) => ({ type: SET_QUERY, query });
export const toggleSelect = (deviceId) => ({ type: TOGGLE_SELECT, deviceId });
export const setSelection = (selected) => ({ type: SET_SELECTION, selected });
export const setConfirmOpen = (open) => ({ type: SET_CONFIRM_OPEN, open });

// ---------------------------------------------------------------------------
// bootstrap: device folders + device.json contents (reuses the queued
// dashboard loader, which also populates the sidebar meta names)

export const bootstrapDeviceData = () => {
  return function (dispatch, getState) {
    const devices = getState().buckets.list.filter((bucket) =>
      DEVICE_FOLDER_REGEX.test(bucket)
    );

    return dispatch(
      dashboardStatusActions.fetchDeviceFileContentAll(
        devices.map((deviceId) => ({ deviceId }))
      )
    ).then((results) => {
      dispatch({ type: SET_DEVICE_DATA, devices, results: results || [] });
      // a partial may already be loaded (transfer from the editor); force a
      // config/schema refresh on every view entry so evaluations never run
      // on stale data from a previous visit
      return dispatch(ensureArtifacts(true));
    });
  };
};

// manual refresh triggered from the table's refresh button: re-fetch every
// device.json (fresh heartbeat + reported cfg_crc32) and force a config/schema
// reload + re-evaluation. Supports the "deploy to one, confirm it syncs, then
// roll out to the rest" workflow.
export const refresh = () => bootstrapDeviceData();

// ---------------------------------------------------------------------------
// per-device config + schema loader (own loader: keeps RAW text in the module
// cache - crc32/drift checks must run over the file's real bytes)

const fetchDeviceObjectText = (deviceId, objectName) =>
  web
    .PresignedGet({
      bucket: deviceId,
      object: objectName,
      expiry: PRESIGN_EXPIRY
    })
    .then((res) => statusRequestQueue.add(() => fetch(res.url)))
    .then((r) => {
      if (!r.ok) return { status: "missing" };
      return r.text().then((text) => ({ status: "loaded", text }));
    })
    .catch(() => ({ status: "missing" }));

const fetchArtifactsFor = (dispatch, getState, deviceIds) => {
  const { deviceFiles } = getState().otaBatch;

  const targets = deviceIds.filter((deviceId) => {
    const deviceJson = deviceFiles[deviceId];
    return (
      deviceJson &&
      typeof deviceJson === "object" &&
      typeof deviceJson.cfg_name === "string" &&
      typeof deviceJson.sch_name === "string"
    );
  });

  // mark everything as loading in one dispatch
  const loadingPatch = {};
  targets.forEach((deviceId) => {
    loadingPatch[deviceId] = {
      config: { status: "loading" },
      schema: { status: "loading" }
    };
  });
  dispatch({ type: PATCH_ARTIFACTS, patch: loadingPatch });

  // buffered status flushes to avoid one render per device on big fleets
  let buffer = {};
  let buffered = 0;
  const flush = () => {
    if (!buffered) return;
    dispatch({ type: PATCH_ARTIFACTS, patch: buffer });
    buffer = {};
    buffered = 0;
  };
  const patch = (deviceId, part) => {
    const existing =
      buffer[deviceId] || { ...getState().otaBatch.artifacts[deviceId] };
    buffer[deviceId] = { ...existing, ...part };
    buffered += 1;
    if (buffered >= 20) flush();
  };

  const jobs = [];
  targets.forEach((deviceId) => {
    const deviceJson = deviceFiles[deviceId];
    jobs.push(
      fetchDeviceObjectText(deviceId, deviceJson.cfg_name).then((res) => {
        const meta =
          res.status === "loaded"
            ? cache.setConfig(deviceId, res.text)
            : { status: "missing" };
        patch(deviceId, { config: meta });
      })
    );
    jobs.push(
      fetchDeviceObjectText(deviceId, deviceJson.sch_name).then((res) => {
        const meta =
          res.status === "loaded"
            ? { status: cache.setSchema(deviceId, res.text).status }
            : { status: "missing" };
        patch(deviceId, { schema: meta });
      })
    );
  });

  return Promise.all(jobs).then(() => {
    flush();
    dispatch(evaluateAll());
  });
};

export const ensureArtifacts = (force) => {
  return function (dispatch, getState) {
    const state = getState().otaBatch;
    // the dashboard + the per-device encryption assessment need the configs
    // and schemas regardless of whether a partial is loaded; only a broken
    // partial suppresses evaluation
    const needed = !(state.partial && state.partialBlockers.length);

    if (!needed || !state.devicesLoaded) {
      return Promise.resolve();
    }
    if (state.artifactsRequested && !force) {
      dispatch(evaluateAll());
      return Promise.resolve();
    }
    dispatch({ type: SET_ARTIFACTS_REQUESTED });
    return fetchArtifactsFor(dispatch, getState, state.devices);
  };
};

// re-fetch configs for specific devices (retry-failed path: the fresh text
// becomes the new reviewed baseline before resubmission)
export const refreshConfigs = (deviceIds) => {
  return function (dispatch, getState) {
    return fetchArtifactsFor(dispatch, getState, deviceIds);
  };
};

// ---------------------------------------------------------------------------
// evaluation

export const evaluateAll = () => {
  return function (dispatch, getState) {
    dispatch({ type: BUMP_EVAL_TOKEN });
    const state = getState().otaBatch;
    const token = state.evalToken;

    const evaluations = {};
    cache.clearMergedResults();

    // a partial is optional; a broken partial suppresses evaluation entirely
    if (state.partial && state.partialBlockers.length) {
      dispatch({ type: SET_EVALUATIONS, evaluations, token });
      return;
    }

    const analysis = state.partial
      ? analyzePartial(state.partial, state.partialDeletions)
      : null;
    const nowMs = Date.now();

    state.devices.forEach((deviceId) => {
      const artifact = state.artifacts[deviceId] || {};
      const input = {
        deviceId,
        deviceJson: state.deviceFiles[deviceId],
        heartbeatMs: state.heartbeats[deviceId],
        nowMs,
        config: {
          data: cache.getConfig(deviceId),
          meta: artifact.config || { status: "loading" }
        },
        schemaStatus: (artifact.schema || { status: "loading" }).status,
        validator: cache.getValidator(deviceId),
        partial: state.partial,
        facts: analysis ? analysis.facts : null
      };

      const result = evaluateDevice(input);

      // bulky merge results (the post-merge base for download/submit) stay in
      // the module cache
      if (result.merged) {
        cache.setMergedResult(deviceId, {
          merged: result.merged,
          mergedText: result.mergedText
        });
      }
      evaluations[deviceId] = {
        status: result.status,
        eligible: result.eligible,
        reasons: result.reasons,
        warnings: result.warnings,
        targetName: result.targetName,
        baselineCrc32: result.baselineCrc32,
        partialChanges: result.partialChanges,
        currentEncStatus: result.currentEncStatus,
        enc: result.enc
      };
    });

    dispatch({ type: SET_EVALUATIONS, evaluations, token });
  };
};

// ---------------------------------------------------------------------------
// partial loading (file upload + editor transfer)

export const loadPartialFile = (fileName, rawText) => {
  return function (dispatch) {
    let parsed = null;
    let blockers = [];
    let notes = [];
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      blockers = ["The selected file is not valid JSON: " + e.message];
    }
    if (!blockers.length) {
      const analysis = analyzePartial(parsed, []);
      blockers = analysis.blockers;
      notes = analysis.notes;
    }
    dispatch({
      type: SET_PARTIAL,
      partial: parsed,
      deletions: [],
      source: { kind: "file", fileName },
      blockers,
      notes
    });
    return dispatch(ensureArtifacts());
  };
};

// called from the editor's Review-changes modal ("Transfer to OTA batch manager")
export const receivePartialFromEditor = ({ partial, deletions, configName }) => {
  return function (dispatch) {
    const { prefix } = pathSlice(history.location.pathname);
    const analysis = analyzePartial(partial, deletions || []);

    dispatch({
      type: SET_PARTIAL,
      partial,
      deletions: deletions || [],
      source: {
        kind: "editor",
        deviceId: prefix || null,
        configName: configName || null,
        revision: encryptionFields.getConfigRevision(configName || "")
      },
      blockers: analysis.blockers,
      notes: analysis.notes
    });

    history.push("/ota-batch-manager/");
    // artifacts load once the view bootstraps (bootstrapDeviceData calls
    // ensureArtifacts); if device data is already present, evaluate right away
    return dispatch(ensureArtifacts());
  };
};

export const clearPartial = () => {
  return function (dispatch, getState) {
    if (getState().otaBatch.run.active) return;
    dispatch({ type: CLEAR_PARTIAL });
  };
};

// the encrypt toggle is a pure display/behaviour switch - eligibility and the
// per-device encryption assessment are already computed, so no re-evaluation
export const setEncryptPasswords = (value) => {
  return function (dispatch, getState) {
    if (getState().otaBatch.run.active) return;
    dispatch({ type: SET_ENCRYPT_PASSWORDS, value });
  };
};

// ---------------------------------------------------------------------------
// "New config" column download - the exact resulting config per device

const downloadJsonFile = (fileName, text) => {
  const anchor = document.createElement("a");
  anchor.href = "data:text/json;charset=utf-8," + encodeURIComponent(text);
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

export const downloadNewConfig = (deviceId) => {
  return function (dispatch, getState) {
    const rootState = getState();
    const state = rootState.otaBatch;
    const deviceJson = state.deviceFiles[deviceId];
    const fileName =
      deviceId + "_" + (deviceJson ? deviceJson.cfg_name : "config.json");

    // the post-merge base (partial applied if loaded, else the raw config)
    const mergedResult = cache.getMergedResult(deviceId);
    const config = cache.getConfig(deviceId);
    const base = mergedResult
      ? mergedResult.merged
      : config
      ? config.parsed
      : null;
    if (!base) return Promise.resolve();

    const evaluation = state.evaluations[deviceId];
    const encryptThisDevice =
      getEncryptActive(rootState) &&
      evaluation &&
      evaluation.enc &&
      evaluation.enc.hasPlain &&
      evaluation.enc.compatible;

    if (!encryptThisDevice) {
      downloadJsonFile(fileName, JSON.stringify(base, null, 2));
      return Promise.resolve();
    }

    // encryption preview: build a delta on the POST-merge base with a fresh
    // ephemeral key. The submission re-encrypts with another fresh key
    // (structure and fields identical, ciphertexts differ)
    if (!deviceJson) return Promise.resolve();
    const analysis = encryptionFields.analyzeConfigEncryption(base);
    return encryptionCrypto
      .deriveEncryptionMaterial(deviceJson.kpub)
      .then(({ serverPublicKeyBase64, symmetricKey }) =>
        encryptionFields.buildEncryptedDelta(
          base,
          symmetricKey,
          serverPublicKeyBase64,
          analysis
        )
      )
      .then((delta) => {
        const merged = mergeConfig(base, delta);
        downloadJsonFile(fileName, JSON.stringify(merged, null, 2));
      })
      .catch((e) => {
        dispatch(
          alertActions.set({
            type: "danger",
            message: "Could not build the encrypted preview: " + e.message,
            autoClear: true
          })
        );
      });
  };
};

// ---------------------------------------------------------------------------
// run control (see submitEngine.js)

// refresh the configs of successfully submitted devices once a run finishes:
// their rows re-evaluate as "unchanged" with a fresh crc32 (truthful UI +
// idempotent resume)
const refreshSubmitted = (dispatch, getState, deviceIds) => {
  const status = getState().otaBatch.run.deviceStatus;
  const succeeded = deviceIds.filter(
    (deviceId) => status[deviceId] && status[deviceId].state === "submitted"
  );
  if (succeeded.length) {
    return dispatch(refreshConfigs(succeeded));
  }
  return Promise.resolve();
};

// a device is submitted only if it will actually change: a partial change
// and/or (when the encrypt toggle is effectively on) an encryptable device
const willChange = (evaluation, encryptActive) => {
  if (!evaluation || !evaluation.eligible) return false;
  const willEncrypt =
    encryptActive &&
    evaluation.enc &&
    evaluation.enc.hasPlain &&
    evaluation.enc.compatible;
  return !!evaluation.partialChanges || !!willEncrypt;
};

export const startRun = () => {
  return function (dispatch, getState) {
    const rootState = getState();
    const state = rootState.otaBatch;
    const encryptActive = getEncryptActive(rootState);
    const deviceIds = Object.keys(state.selected).filter((deviceId) =>
      willChange(state.evaluations[deviceId], encryptActive)
    );
    if (!deviceIds.length || state.run.active) return;
    engineStartRun(dispatch, getState, deviceIds).then(() =>
      refreshSubmitted(dispatch, getState, deviceIds)
    );
  };
};

// re-fetch the failed devices' configs (fresh baseline), re-evaluate, then
// resubmit those that are ready again
export const retryFailed = () => {
  return function (dispatch, getState) {
    const state = getState().otaBatch;
    if (state.run.active) return;
    const failed = Object.keys(state.run.deviceStatus).filter(
      (deviceId) => state.run.deviceStatus[deviceId].state === "error"
    );
    if (!failed.length) return;

    return dispatch(refreshConfigs(failed)).then(() => {
      const rootState = getState();
      const fresh = rootState.otaBatch;
      const encryptActive = getEncryptActive(rootState);
      const ready = [];
      failed.forEach((deviceId) => {
        const evaluation = fresh.evaluations[deviceId];
        if (willChange(evaluation, encryptActive)) {
          ready.push(deviceId);
        } else if (evaluation && evaluation.status === "eligible") {
          // converged in the meantime (e.g. applied by another session)
          dispatch({
            type: RUN_DEVICE_STATUS,
            deviceId,
            state: "submitted",
            message: "No changes (already applied)"
          });
        } else {
          // no longer applicable (e.g. now blocked) - surface why
          dispatch({
            type: RUN_DEVICE_STATUS,
            deviceId,
            state: "error",
            message:
              evaluation && evaluation.reasons && evaluation.reasons[0]
                ? evaluation.reasons[0]
                : "Device is no longer ready"
          });
        }
      });
      if (ready.length) {
        engineRetryRun(dispatch, getState, ready).then(() =>
          refreshSubmitted(dispatch, getState, ready)
        );
      }
    });
  };
};

export const abortRun = () => {
  return function (dispatch) {
    dispatch({ type: RUN_ABORT_REQUESTED });
    engineAbortRun();
  };
};

// Full teardown when the view unmounts (navigation away, logout): a loaded
// partial and the per-device artifact cache must never survive into another
// session/bucket. Any in-flight run is invalidated (queued tasks dropped;
// in-flight PUTs were already validated against fresh data).
export const teardownView = () => {
  return function (dispatch) {
    engineInvalidateRun();
    cache.clearAll();
    dispatch({ type: RESET });
  };
};
