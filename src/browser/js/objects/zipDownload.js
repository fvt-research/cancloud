/*
 * Streaming multi-file zip download engine.
 *
 * Downloads any number of S3 objects and packs them into zip archives without
 * holding the whole batch in memory:
 *  - at most MAX_CONCURRENT files are fetched (and buffered) at a time
 *  - zip output is streamed to disk via the origin private file system (OPFS)
 *    where supported, so peak memory stays at a few files regardless of the
 *    total download size; browsers without OPFS fall back to assembling each
 *    archive in memory (with a warning for large downloads)
 *  - archives are split into parts below the 4 GiB / 65535 entry limits of
 *    non-Zip64 archives, so batches of any total size work
 *  - every file download has an inactivity watchdog and bounded retries with
 *    a fresh presigned URL per attempt; if the connection drops, the download
 *    waits for it to return instead of failing. Files that still fail are
 *    skipped and reported (via alert + SKIPPED_FILES.txt in the archive)
 *    rather than stalling the batch
 */

import { Zip, ZipPassThrough, strToU8 } from "fflate";
import saveAs from "file-saver";

import web from "../web";
import * as alertActions from "../alert/actions";
import * as alertModalActions from "../alertModals/actions";
import { DOWNLOAD } from "../constants";
import { downloadRequestQueue } from "../requestQueue";

const MAX_CONCURRENT = 4; // files fetched/buffered at a time
const MAX_PART_BYTES = 3.5 * 1024 * 1024 * 1024; // headroom below the 4 GiB zip cap
const MAX_PART_ENTRIES = 60000; // headroom below the 65535 entry zip cap
const MAX_ATTEMPTS = 5;
const INACTIVITY_TIMEOUT_MS = 30 * 1000; // abort an attempt when no bytes arrive for this long
const OFFLINE_WAIT_MS = 2 * 60 * 1000; // max wait for connectivity to return
const MEMORY_SINK_WARN_BYTES = 500 * 1000 * 1000;
const PROGRESS_DISPATCH_INTERVAL_MS = 400;
const OPFS_TMP_DIR = "cancloud-downloads";

let activeDownload = null;

// Abort the running zip download (if any); returns whether one was active
export const abortZipDownload = () => {
  if (!activeDownload) return false;
  activeDownload.abort();
  return true;
};

const abortError = () => {
  const err = new Error("Download aborted");
  err.aborted = true;
  return err;
};

// Shared cancellation context: aborts in-flight fetches and wakes any
// pending backoff/offline waits so an abort takes effect immediately
const createContext = () => {
  const ctx = {
    aborted: false,
    controllers: [],
    wakeups: [],
    abort() {
      if (ctx.aborted) return;
      ctx.aborted = true;
      ctx.controllers.forEach((controller) => controller.abort());
      const wakeups = ctx.wakeups;
      ctx.wakeups = [];
      wakeups.forEach((wake) => wake());
    },
    throwIfAborted() {
      if (ctx.aborted) throw abortError();
    },
    // abort-responsive setTimeout
    delay(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(wake, ms);
        function wake() {
          clearTimeout(timer);
          resolve();
        }
        ctx.wakeups.push(wake);
      });
    },
  };
  return ctx;
};

// Resolves when the browser reports connectivity again (or after a cap/abort)
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

// Fetch a single object once, streaming the body into an array of chunks.
// A watchdog aborts the attempt when no bytes arrive for INACTIVITY_TIMEOUT_MS,
// so a hung connection can never stall the batch.
const fetchObjectOnce = async (ctx, url, objectName, onProgress) => {
  const controller = new AbortController();
  ctx.controllers.push(controller);
  let timer = null;
  let timedOut = false;
  const armWatchdog = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, INACTIVITY_TIMEOUT_MS);
  };
  try {
    armWatchdog();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} while downloading ${objectName}`);
      err.permanent = response.status === 404;
      throw err;
    }
    const chunks = [];
    let loaded = 0;
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      while (true) {
        armWatchdog();
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        loaded += result.value.length;
        onProgress(loaded);
      }
    } else {
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
      onProgress(buffer.byteLength);
    }
    return chunks;
  } catch (err) {
    if (timedOut) {
      throw new Error(
        `Timed out downloading ${objectName} (no data received for ${INACTIVITY_TIMEOUT_MS / 1000}s)`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    const index = ctx.controllers.indexOf(controller);
    if (index !== -1) ctx.controllers.splice(index, 1);
  }
};

// Fetch an object with bounded retries. Each attempt uses a freshly signed
// URL (signing is local). When the browser is offline, wait for connectivity
// instead of burning attempts.
const fetchObjectWithRetry = async (ctx, bucketName, objectName, onProgress) => {
  let attempt = 0;
  let offlineWaits = 0;
  while (true) {
    ctx.throwIfAborted();
    attempt += 1;
    try {
      const res = await web.PresignedGetObj({
        bucket: bucketName,
        object: objectName,
        expiry: 24 * 60 * 60,
      });
      return await fetchObjectOnce(ctx, res.obj.url, objectName, onProgress);
    } catch (err) {
      ctx.throwIfAborted();
      if (err && err.permanent) throw err;
      if (navigator.onLine === false && offlineWaits < 3) {
        offlineWaits += 1;
        attempt = 0;
        onProgress(0);
        await waitForOnline(ctx);
        continue;
      }
      if (attempt >= MAX_ATTEMPTS) throw err;
      onProgress(0);
      await ctx.delay(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
    }
  }
};

const triggerBlobDownload = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Streaming sink: zip output is written to a temporary OPFS file and handed
// to the browser's download manager as a disk-backed File when complete
const createOpfsSink = async () => {
  if (
    !(
      navigator.storage &&
      navigator.storage.getDirectory &&
      window.FileSystemFileHandle &&
      window.FileSystemFileHandle.prototype.createWritable
    )
  ) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    // drop temp files left behind by interrupted downloads
    try {
      await root.removeEntry(OPFS_TMP_DIR, { recursive: true });
    } catch (err) {}
    const dir = await root.getDirectoryHandle(OPFS_TMP_DIR, { create: true });
    return {
      streaming: true,
      async openPart(tmpName) {
        const handle = await dir.getFileHandle(tmpName, { create: true });
        const writable = await handle.createWritable();
        return {
          write: (chunk) => writable.write(chunk),
          async save(fileName) {
            await writable.close();
            const file = await handle.getFile();
            triggerBlobDownload(file, fileName);
          },
          async discard() {
            try {
              await writable.abort();
            } catch (err) {}
            try {
              await dir.removeEntry(tmpName);
            } catch (err) {}
          },
        };
      },
    };
  } catch (err) {
    return null;
  }
};

// Fallback sink for browsers without OPFS: buffer the archive in memory
const createMemorySink = () => ({
  streaming: false,
  openPart() {
    let chunks = [];
    return Promise.resolve({
      write(chunk) {
        chunks.push(chunk);
      },
      save(fileName) {
        saveAs(new Blob(chunks, { type: "application/zip" }), fileName);
        chunks = [];
      },
      discard() {
        chunks = [];
      },
    });
  },
});

// One archive part: a fflate Zip stream whose output chunks are chained into
// the sink writer. flush() applies sink backpressure and surfaces zip errors.
const openZipPart = async (sink, partIndex) => {
  const writer = await sink.openPart(`part-${partIndex}.zip`);
  const part = {
    partIndex,
    bytes: 0,
    entries: 0,
    error: null,
    writeChain: Promise.resolve(),
    writer,
    zip: null,
  };
  part.zip = new Zip((err, chunk) => {
    if (err) {
      part.error = err;
      return;
    }
    part.bytes += chunk.length;
    part.writeChain = part.writeChain.then(() => writer.write(chunk));
  });
  part.flush = () =>
    part.writeChain.then(() => {
      if (part.error) throw part.error;
    });
  return part;
};

// Entries are stored uncompressed (CANedge logs are already compressed) and
// written strictly sequentially, awaiting the sink between chunks so no more
// than one chunk of zip output is buffered per file
const addFileToPart = async (part, fileName, chunks) => {
  const entry = new ZipPassThrough(fileName);
  part.zip.add(entry);
  part.entries += 1;
  for (let i = 0; i < chunks.length - 1; i++) {
    entry.push(chunks[i], false);
    await part.flush();
  }
  entry.push(chunks.length ? chunks[chunks.length - 1] : new Uint8Array(0), true);
  await part.flush();
};

const closeZipPart = async (part, fileName) => {
  part.zip.end();
  await part.flush();
  await part.writer.save(fileName);
};

const partFileName = (bucketName, partIndex) =>
  `${bucketName}_part${partIndex < 10 ? "0" + partIndex : partIndex}.zip`;

// Single aggregated progress-modal entry for the whole batch (per-file redux
// entries would mean one dispatch/re-render per file, which freezes the UI
// for batches of thousands of files)
const createProgressTracker = (dispatch, bucketName, totalSize) => {
  const slug = `${bucketName}.zip`;
  dispatch(alertModalActions.AddQueue(DOWNLOAD, slug, totalSize, slug));
  let completedBytes = 0;
  const inFlightBytes = {};
  let lastDispatchTime = 0;
  const dispatchLoaded = (force) => {
    const now = Date.now();
    if (!force && now - lastDispatchTime < PROGRESS_DISPATCH_INTERVAL_MS) return;
    lastDispatchTime = now;
    let loaded = completedBytes;
    for (const key in inFlightBytes) loaded += inFlightBytes[key];
    dispatch(alertModalActions.updateQueue(slug, loaded));
  };
  return {
    fileProgress(name, loaded) {
      inFlightBytes[name] = loaded;
      dispatchLoaded(false);
    },
    fileDone(name, size) {
      delete inFlightBytes[name];
      completedBytes += size;
      dispatchLoaded(true);
    },
    finish() {
      // any STOP_QUEUE clears the whole modal queue, so call it exactly once
      dispatch(alertModalActions.stopQueue(slug));
    },
  };
};

// Entry names flatten the object path with underscores, which can collide
// (e.g. "a/b" and "a_b") - deduplicate so no zip entry silently overwrites
const createEntryNamer = (bucketName) => {
  const used = {};
  return (objectName) => {
    const flat = objectName.replace(/\//g, "_");
    const name = bucketName === "Home" ? flat : `${bucketName}_${flat}`;
    if (!used[name]) {
      used[name] = 1;
      return name;
    }
    used[name] += 1;
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${name.slice(0, dot)}_${used[name]}${name.slice(dot)}`
      : `${name}_${used[name]}`;
  };
};

export const startZipDownload = async (dispatch, bucketName, files) => {
  if (activeDownload) {
    dispatch(
      alertActions.set({
        type: "info",
        message: "A download is already in progress - wait for it to finish or abort it first",
        autoClear: true,
      })
    );
    return;
  }
  const ctx = createContext();
  activeDownload = ctx;
  try {
    await runZipDownload(ctx, dispatch, bucketName, files);
  } finally {
    activeDownload = null;
  }
};

const runZipDownload = async (ctx, dispatch, bucketName, files) => {
  // drop S3 "folder marker" objects
  const objects = files.filter((file) => file.name && !file.name.endsWith("/"));
  if (objects.length === 0) {
    dispatch(
      alertActions.set({
        type: "info",
        message: "No files to download",
        autoClear: true,
      })
    );
    return;
  }

  let progress = null;
  let part = null;
  const inFlight = [];
  try {
    // resolve sizes for directly-checked objects (folder expansions already
    // carry sizes from the listing) so the progress total is meaningful
    await Promise.all(
      objects.map((file) => {
        if (typeof file.size === "number") return null;
        return downloadRequestQueue
          .add(() => web.getObjectStat({ bucketName: bucketName, objectName: file.name }))
          .then((res) => {
            file.size = res.metaInfo.size;
          })
          .catch(() => {
            file.size = 0;
          });
      })
    );
    const totalSize = objects.reduce((sum, file) => sum + (file.size || 0), 0);

    const sink = (await createOpfsSink()) || createMemorySink();
    if (!sink.streaming && totalSize > MEMORY_SINK_WARN_BYTES) {
      dispatch(
        alertActions.set({
          type: "info",
          message: `Your browser does not support streaming downloads to disk, so this download (${Math.round(
            totalSize / 1000000
          )} MB) will be assembled in memory and may fail. Consider using Chrome/Edge or splitting up your download`,
        })
      );
    } else {
      dispatch(alertActions.clear());
    }

    progress = createProgressTracker(dispatch, bucketName, totalSize);
    const entryName = createEntryNamer(bucketName);
    part = await openZipPart(sink, 1);

    const skipped = [];
    let succeeded = 0;
    let written = 0;
    let nextIndex = 0;

    // pipeline: keep up to MAX_CONCURRENT downloads in flight; append results
    // to the archive in order as they complete
    const startNext = () => {
      const file = objects[nextIndex];
      nextIndex += 1;
      inFlight.push(
        fetchObjectWithRetry(ctx, bucketName, file.name, (loaded) =>
          progress.fileProgress(file.name, loaded)
        )
          .then((chunks) => ({ file: file, chunks: chunks }))
          .catch((err) => {
            if (ctx.aborted || (err && err.aborted)) throw err;
            return { file: file, failed: true, error: err };
          })
      );
    };

    while (written < objects.length) {
      ctx.throwIfAborted();
      while (inFlight.length < MAX_CONCURRENT && nextIndex < objects.length) {
        startNext();
      }
      const result = await inFlight.shift();
      ctx.throwIfAborted();
      written += 1;
      if (result.failed) {
        skipped.push({
          name: result.file.name,
          reason: (result.error && result.error.message) || "unknown error",
        });
        progress.fileDone(result.file.name, result.file.size || 0);
        // bail out early when nothing succeeds at all (systemic failure)
        if (skipped.length >= 5 && succeeded === 0) {
          throw new Error(
            "Could not download any files - check your connection and permissions, then try again"
          );
        }
        continue;
      }
      const fileBytes = result.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      // start a new archive part when this file would exceed the zip limits
      if (
        part.entries > 0 &&
        (part.bytes + fileBytes > MAX_PART_BYTES || part.entries >= MAX_PART_ENTRIES)
      ) {
        await closeZipPart(part, partFileName(bucketName, part.partIndex));
        part = await openZipPart(sink, part.partIndex + 1);
      }
      await addFileToPart(part, entryName(result.file.name), result.chunks);
      progress.fileDone(result.file.name, result.file.size || fileBytes);
      succeeded += 1;
    }

    if (skipped.length && succeeded) {
      const report = skipped.map((skip) => `${skip.name}: ${skip.reason}`).join("\r\n");
      await addFileToPart(part, "SKIPPED_FILES.txt", [strToU8(report)]);
    }

    if (part.entries > 0) {
      const fileName =
        part.partIndex === 1 ? `${bucketName}.zip` : partFileName(bucketName, part.partIndex);
      await closeZipPart(part, fileName);
    } else {
      await part.writer.discard();
    }

    progress.finish();
    dispatch(alertModalActions.hideAbortModal());
    if (skipped.length === 0) {
      dispatch(alertActions.clear());
    } else if (succeeded === 0) {
      dispatch(
        alertActions.set({
          type: "danger",
          message: `Download failed - none of the ${objects.length} files could be downloaded. Check your connection and try again`,
        })
      );
    } else {
      dispatch(
        alertActions.set({
          type: "danger",
          message: `Download completed, but ${skipped.length} of ${objects.length} files failed and were skipped - see SKIPPED_FILES.txt in the zip for details`,
        })
      );
    }
  } catch (err) {
    const userAborted = ctx.aborted || (err && err.aborted);
    ctx.abort(); // stop any in-flight fetches
    inFlight.forEach((pending) => {
      Promise.resolve(pending).catch(() => {});
    });
    if (part) {
      try {
        await part.writer.discard();
      } catch (discardErr) {}
    }
    if (progress) progress.finish();
    dispatch(alertModalActions.hideAbortModal());
    dispatch(
      userAborted
        ? alertActions.set({
            type: "info",
            message: "Download aborted",
            autoClear: true,
          })
        : alertActions.set({
            type: "danger",
            message: `Download failed: ${err.message}`,
          })
    );
  }
};
