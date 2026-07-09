// Bounded-concurrency batch submission run. A PUT only happens for a device
// that passes the full re-validation on FRESH data immediately before the
// write (mirrors canedge_manager.py cfg_update: get -> transform -> validate
// -> put, per device):
//   1. session alive (web.LoggedIn())
//   2. fresh GET of the device's config (cache: no-store)
//   3. drift check: fresh crc32 must equal the evaluation-time baseline
//   4. re-merge + full re-evaluation (partial) / fresh encrypt (encryption)
//   5. PUT-key whitelist assert, then web.PutObject
// Uses its OWN request queue instance so aborting never clears the shared
// statusRequestQueue.

import web from "../web";
import { createRequestQueue } from "../requestQueue";
import { encryptionFields, encryptionCrypto } from "config-editor-tools";

import * as cache from "./cache";
import {
  analyzePartial,
  evaluateDevicePartial,
  mergeConfig
} from "./evaluate";
import {
  SUBMIT_CONCURRENCY,
  PUT_NAME_REGEX,
  PRESIGN_EXPIRY
} from "./constants";
import { RUN_START, RUN_APPEND, RUN_DEVICE_STATUS, RUN_DONE } from "./actionTypes";

let runToken = 0;
let queue = null;

const setDeviceStatus = (dispatch, deviceId, state, message) =>
  dispatch({ type: RUN_DEVICE_STATUS, deviceId, state, message });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// web.makeCall strips err.status and rethrows "Server returned error [NNN]";
// fetchFreshConfigText keeps both err.status and a "[NNN]" message. Recover the
// HTTP status from either form so retry/messaging can key off it.
const statusOf = (e) => {
  if (e && typeof e.status === "number") return e.status;
  const m =
    e && typeof e.message === "string" && e.message.match(/\[(\d{3})\]/);
  return m ? parseInt(m[1], 10) : null;
};

// retry once (2 s) for network-class + HTTP 5xx failures only - never for 4xx
const isRetriable = (e) => {
  if (e instanceof TypeError) return true;
  const status = statusOf(e);
  if (status !== null) return status >= 500;
  return (
    e &&
    typeof e.message === "string" &&
    /network|failed to fetch|timeout|econn/i.test(e.message)
  );
};

// user-facing failure message - make the common 403 actionable
const friendlyMessage = (e) => {
  if (statusOf(e) === 403) {
    return "Access denied (403) - check the bucket write permissions for this device folder";
  }
  return e && e.message ? e.message : String(e);
};

const withOneRetry = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    if (!isRetriable(e)) throw e;
    await delay(2000);
    return fn();
  }
};

const fetchFreshConfigText = (deviceId, configName) =>
  withOneRetry(() =>
    web
      .PresignedGet({
        bucket: deviceId,
        object: configName,
        expiry: PRESIGN_EXPIRY
      })
      .then((res) => fetch(res.url, { cache: "no-store" }))
      .then((r) => {
        if (!r.ok) {
          const err = new Error(
            "Could not fetch the device's current config [" + r.status + "]"
          );
          err.status = r.status;
          throw err;
        }
        return r.text();
      })
  );

const putConfig = (deviceId, configName, body) => {
  const objectName = deviceId + "/" + configName;
  if (
    !PUT_NAME_REGEX.test(objectName) ||
    objectName.indexOf(deviceId + "/") !== 0
  ) {
    // defense-in-depth: should be unreachable
    throw new Error("Internal error - refusing to write to " + objectName);
  }
  return withOneRetry(() => web.PutObject({ objectName, file: body }));
};

const submitDevice = async (dispatch, getState, deviceId, token) => {
  if (token !== runToken) return;

  if (!web.LoggedIn()) {
    // abort everything still queued; in-flight tasks fail the same check
    if (queue) queue.clear();
    throw new Error("Session expired - please log in again");
  }

  setDeviceStatus(dispatch, deviceId, "submitting");

  const state = getState().otaBatch;
  const deviceJson = state.deviceFiles[deviceId];
  const evaluation = state.evaluations[deviceId];
  const validator = cache.getValidator(deviceId);

  if (
    !deviceJson ||
    !evaluation ||
    evaluation.status !== "ready" ||
    !validator
  ) {
    throw new Error("Device is no longer ready - re-evaluate");
  }

  // fresh baseline + drift check
  const freshText = await fetchFreshConfigText(deviceId, deviceJson.cfg_name);
  if (cache.crc32Hex(freshText) !== evaluation.baselineCrc32) {
    throw new Error(
      "Config changed on the server since review - use Retry failed to re-evaluate and resubmit"
    );
  }
  const freshParsed = JSON.parse(freshText); // crc matched -> parses like the baseline

  let mergedText;

  if (state.mode === "partial") {
    // authoritative re-run of the full evaluation pipeline on the fresh text
    const analysis = analyzePartial(state.partial, state.partialDeletions);
    const result = evaluateDevicePartial({
      deviceId,
      deviceJson,
      heartbeatMs: null,
      nowMs: null,
      config: {
        data: { text: freshText, parsed: freshParsed },
        meta: { status: "loaded", crc32: cache.crc32Hex(freshText) }
      },
      schemaStatus: "loaded",
      validator,
      partial: state.partial,
      facts: analysis.facts
    });
    if (result.status === "unchanged") {
      if (token !== runToken) return; // run was invalidated during the GET
      setDeviceStatus(
        dispatch,
        deviceId,
        "submitted",
        "No changes (already applied)"
      );
      return;
    }
    if (result.status !== "ready") {
      throw new Error(
        result.reasons && result.reasons[0]
          ? result.reasons[0]
          : "Validation failed"
      );
    }
    mergedText = result.mergedText;
  } else {
    // encryption mode: fresh analysis + fresh ephemeral key PER DEVICE -
    // encrypted values and the server public key are device-specific
    const analysis = encryptionFields.analyzeConfigEncryption(freshParsed);
    if (!analysis.ok) {
      throw new Error(
        "Config changed on the server and can no longer be encrypted - use Retry failed to re-evaluate"
      );
    }
    const material = await encryptionCrypto.deriveEncryptionMaterial(
      deviceJson.kpub
    );
    const delta = await encryptionFields.buildEncryptedDelta(
      freshParsed,
      material.symmetricKey,
      material.serverPublicKeyBase64,
      analysis
    );
    const merged = mergeConfig(freshParsed, delta);
    if (!validator(merged)) {
      throw new Error(
        "Encrypted config fails validation vs the device's schema"
      );
    }
    mergedText = JSON.stringify(merged, null, 2);
  }

  await putConfig(deviceId, deviceJson.cfg_name, mergedText);
  // the PUT was validated against fresh data and is allowed to complete even if
  // the run was invalidated meanwhile; only skip the (now-stale) status dispatch
  if (token !== runToken) return;
  setDeviceStatus(dispatch, deviceId, "submitted");
};

const runTasks = (dispatch, getState, deviceIds, token) => {
  const tasks = deviceIds.map((deviceId) =>
    queue
      .add(() => submitDevice(dispatch, getState, deviceId, token))
      .catch((err) => {
        if (token !== runToken) return;
        if (err && err.message === "cancelled") {
          setDeviceStatus(dispatch, deviceId, "aborted");
        } else {
          setDeviceStatus(dispatch, deviceId, "error", friendlyMessage(err));
        }
      })
  );

  return Promise.all(tasks).then(() => {
    if (token === runToken) {
      dispatch({ type: RUN_DONE });
    }
  });
};

// fresh run: RUN_START resets the run slice for the selected devices
export const startRun = (dispatch, getState, deviceIds) => {
  runToken += 1;
  const token = runToken;
  queue = createRequestQueue(SUBMIT_CONCURRENCY);
  dispatch({ type: RUN_START, deviceIds });
  return runTasks(dispatch, getState, deviceIds, token);
};

// retry-failed: re-queue the given devices INTO the existing run (RUN_APPEND)
// so the already-submitted rows and the cumulative summary are preserved
export const retryRun = (dispatch, getState, deviceIds) => {
  runToken += 1;
  const token = runToken;
  queue = createRequestQueue(SUBMIT_CONCURRENCY);
  dispatch({ type: RUN_APPEND, deviceIds });
  return runTasks(dispatch, getState, deviceIds, token);
};

export const abortRun = () => {
  if (queue) queue.clear();
};

// invalidate any in-flight run (view teardown): queued tasks are dropped and
// late task results exit silently on the token check
export const invalidateRun = () => {
  runToken += 1;
  if (queue) queue.clear();
};
