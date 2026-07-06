/*
 * Multi-file upload engine.
 *
 * Uploads any number of files via presigned S3 PUTs without the failure modes
 * of the naive per-file fan-out:
 *  - at most a few uploads run at a time (uploadRequestQueue), the rest wait
 *  - every attempt has an inactivity watchdog and bounded retries with a
 *    fresh presigned URL per attempt (signing is local); if the connection
 *    drops, the upload waits for it to return instead of failing
 *  - every HTTP status settles the upload, so the progress modal can never
 *    hang on an unhandled response (e.g. S3 503 SlowDown)
 *  - files that still fail are reported in one summary alert; the batch
 *    completes and triggers a single bucket refresh instead of one alert and
 *    one refetch per file
 */

import web from "../web";
import * as uploadsActions from "./actions";
import * as alertActions from "../alert/actions";
import * as bucketActions from "../buckets/actions";
import { uploadRequestQueue } from "../requestQueue";

const MAX_ATTEMPTS = 5;
const INACTIVITY_TIMEOUT_MS = 30 * 1000; // abort an attempt when no bytes are sent for this long
const OFFLINE_WAIT_MS = 2 * 60 * 1000; // max wait for connectivity to return
const MAX_OFFLINE_WAITS = 3;
const SYSTEMIC_FAIL_LIMIT = 5; // bail out when this many files fail with zero successes
const MAX_FAILED_NAMES_IN_ALERT = 5;
const PRESIGN_EXPIRY = 24 * 60 * 60;

// per-file upload state, keyed by slug
const tasks = {};
// all files enqueued until the current set drains form one batch, reported
// with a single summary alert and a single bucket refresh
let batch = null;

const abortError = () => {
  const err = new Error("Upload aborted");
  err.aborted = true;
  return err;
};

// Cancel a queued or in-flight upload. Silent no-op for unknown/settled
// slugs; dispatches nothing (abortUpload owns the redux side)
export const cancelUpload = (slug) => {
  const ctx = tasks[slug];
  if (!ctx || ctx.settled) return;
  ctx.cancelled = true;
  if (ctx.xhr) ctx.xhr.abort();
  const wakeups = ctx.wakeups;
  ctx.wakeups = [];
  wakeups.forEach((wake) => wake());
};

// abort-responsive setTimeout
const delay = (ctx, ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(wake, ms);
    function wake() {
      clearTimeout(timer);
      resolve();
    }
    ctx.wakeups.push(wake);
  });

// Resolves when the browser reports connectivity again (or after a cap/cancel)
const waitForOnline = (ctx) => {
  if (navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(wake, OFFLINE_WAIT_MS);
    function wake() {
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      resolve();
    }
    window.addEventListener("online", wake);
    ctx.wakeups.push(wake);
  });
};

// One PUT attempt. The watchdog aborts the attempt when no request bytes are
// sent for INACTIVITY_TIMEOUT_MS (upload progress events stop once the body
// is fully sent, so a hung response wait is also covered - S3 responds near
// instantly after the body completes)
const putOnce = (dispatch, ctx, slug, url, file) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    ctx.xhr = xhr;
    ctx.timedOut = false;
    let timer = null;
    const armWatchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        ctx.timedOut = true;
        xhr.abort();
      }, INACTIVITY_TIMEOUT_MS);
    };
    const settleAttempt = () => {
      clearTimeout(timer);
      ctx.xhr = null;
    };
    xhr.open("PUT", url, true);
    xhr.onload = () => {
      settleAttempt();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else if (xhr.status == 401 || xhr.status == 403) {
        const err = new Error("Unauthorized request.");
        err.permanent = true;
        reject(err);
      } else {
        reject(new Error(`HTTP ${xhr.status} uploading '${file.name}'`));
      }
    };
    xhr.onerror = () => {
      settleAttempt();
      reject(new Error(`Network error uploading '${file.name}'`));
    };
    xhr.onabort = () => {
      settleAttempt();
      if (ctx.timedOut && !ctx.cancelled) {
        reject(
          new Error(
            `Timed out uploading '${file.name}' (no data sent for ${INACTIVITY_TIMEOUT_MS / 1000}s)`
          )
        );
      } else {
        reject(abortError());
      }
    };
    xhr.upload.addEventListener("progress", (event) => {
      armWatchdog();
      // guard against late events resurrecting a stopped redux entry
      if (event.lengthComputable && !ctx.cancelled && !ctx.settled) {
        dispatch(uploadsActions.updateProgress(slug, event.loaded));
      }
    });
    armWatchdog();
    xhr.send(file);
  });

// Upload one file with bounded retries; resolves a status object, never throws
const runUpload = async (dispatch, ctx, slug, bucketName, prefix, file) => {
  const objectName = `${prefix}${file.name}`;
  // post-upload navigation target: the CANedge filename convention encodes
  // the S3 path with underscores (the SDK rewrites _ to /)
  const objectPath =
    bucketName == "Home" ? objectName.split("_")[0] : `${bucketName}/${objectName.split("_")[0]}`;
  let attempt = 0;
  let offlineWaits = 0;
  while (true) {
    if (ctx.cancelled) return { status: "aborted" };
    attempt += 1;
    try {
      // fresh presigned URL per attempt (signing is local, no request involved)
      const res = await web.PresignedPutObject({
        bucketName: bucketName,
        objectName: objectName,
        expiry: PRESIGN_EXPIRY,
      });
      await putOnce(dispatch, ctx, slug, res.url, file);
      return { status: "success", objectPath: objectPath };
    } catch (err) {
      if (ctx.cancelled) return { status: "aborted" };
      if (err && err.permanent) {
        return { status: "failed", name: file.name, reason: err.message };
      }
      if (navigator.onLine === false && offlineWaits < MAX_OFFLINE_WAITS) {
        offlineWaits += 1;
        attempt = 0;
        dispatch(uploadsActions.updateProgress(slug, 0));
        await waitForOnline(ctx);
        continue;
      }
      if (attempt >= MAX_ATTEMPTS) {
        return { status: "failed", name: file.name, reason: (err && err.message) || "unknown error" };
      }
      dispatch(uploadsActions.updateProgress(slug, 0));
      await delay(ctx, 1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
    }
  }
};

const settle = (dispatch, slug, ctx, result) => {
  ctx.settled = true;
  delete tasks[slug];
  dispatch(uploadsActions.stop(slug));
  batch.settled += 1;
  if (result.status === "success") {
    batch.succeeded += 1;
    batch.lastSuccessPath = result.objectPath;
  } else if (result.status === "failed" || batch.bailing) {
    // aborted settles during a systemic bail-out count as failures
    batch.failedNames.push(result.name || ctx.fileName);
  } else {
    batch.aborted += 1;
  }
  // bail out early when nothing succeeds at all (systemic failure)
  if (!batch.bailing && batch.succeeded === 0 && batch.failedNames.length >= SYSTEMIC_FAIL_LIMIT) {
    batch.bailing = true;
    Object.keys(tasks).forEach((pendingSlug) => cancelUpload(pendingSlug));
  }
  if (batch.settled === batch.total) {
    finalizeBatch(dispatch);
  }
};

const finalizeBatch = (dispatch) => {
  const done = batch;
  batch = null;
  // the abort-confirm dialog outlives the files map unless explicitly hidden
  dispatch(uploadsActions.hideAbortModal());
  const failed = done.failedNames.length;
  if (done.aborted > 0 && !done.bailing) {
    dispatch(
      alertActions.set({
        type: "info",
        message:
          done.succeeded > 0
            ? `Upload aborted - ${done.succeeded} file(s) were already uploaded`
            : "Upload aborted",
        autoClear: true,
      })
    );
  } else if (failed === 0) {
    dispatch(
      alertActions.set({
        type: "success",
        message: `${done.succeeded} file(s) uploaded successfully.`,
      })
    );
  } else if (done.succeeded === 0) {
    dispatch(
      alertActions.set({
        type: "danger",
        message: `Upload failed - none of the ${done.total} file(s) could be uploaded. Check your connection and permissions, then try again`,
      })
    );
  } else {
    const names = done.failedNames.slice(0, MAX_FAILED_NAMES_IN_ALERT).join(", ");
    const more = failed - MAX_FAILED_NAMES_IN_ALERT;
    dispatch(
      alertActions.set({
        type: "danger",
        message: `${failed} of ${done.total} files failed to upload: ${names}${
          more > 0 ? ` (+${more} more)` : ""
        }`,
      })
    );
  }
  if (done.succeeded > 0) {
    dispatch(bucketActions.fetchBucketsPostUpload(done.lastSuccessPath));
  }
};

// Enqueue one file for upload; dispatches add(slug, ...) immediately so
// queued files show in the modal and can be aborted. Returns the slug
export const enqueueUpload = (dispatch, { bucketName, prefix, file }) => {
  let slug = `${bucketName}-${prefix}-${file.name}`;
  for (let i = 2; tasks[slug]; i++) {
    slug = `${bucketName}-${prefix}-${file.name} (${i})`;
  }
  const ctx = {
    cancelled: false,
    timedOut: false,
    settled: false,
    xhr: null,
    wakeups: [],
    fileName: file.name,
  };
  tasks[slug] = ctx;
  if (!batch) {
    batch = {
      total: 0,
      settled: 0,
      succeeded: 0,
      failedNames: [],
      aborted: 0,
      bailing: false,
      lastSuccessPath: null,
    };
  }
  batch.total += 1;
  dispatch(uploadsActions.add(slug, file.size, file.name));
  uploadRequestQueue
    .add(() => runUpload(dispatch, ctx, slug, bucketName, prefix, file))
    .then(
      (result) => settle(dispatch, slug, ctx, result),
      () => settle(dispatch, slug, ctx, { status: "failed", name: file.name, reason: "unknown error" })
    );
  return slug;
};
