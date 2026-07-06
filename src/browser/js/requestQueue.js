/*
 * A minimal promise-based request queue with a fixed concurrency limit.
 *
 * Browsers cap concurrent HTTP/1.1 connections to a single host (S3) at ~6.
 * Firing dozens of S3 requests at once therefore only serializes them in the
 * network layer and delays the earliest results. Routing metadata requests
 * through this queue keeps the connection pool saturated while preserving
 * enqueue order, so on-screen rows resolve first.
 */

export function createRequestQueue(limit) {
  let active = 0;
  const pending = [];

  const next = () => {
    if (active >= limit || pending.length === 0) {
      return;
    }
    active += 1;
    const { task, resolve, reject } = pending.shift();
    Promise.resolve()
      .then(task)
      .then(
        (result) => {
          active -= 1;
          next();
          resolve(result);
        },
        (err) => {
          active -= 1;
          next();
          reject(err);
        }
      );
  };

  return {
    // enqueue a task (function returning a promise); resolves/rejects with the task result
    add(task) {
      return new Promise((resolve, reject) => {
        pending.push({ task, resolve, reject });
        next();
      });
    },
    // drop queued (not yet started) tasks; their promises reject so callers can ignore them
    clear() {
      while (pending.length) {
        const { reject } = pending.shift();
        reject(new Error("cancelled"));
      }
    },
  };
}

// Queue for S3 metadata requests in the session/object browser (cleared on navigation)
export const metaRequestQueue = createRequestQueue(6);

// Separate queue for status dashboard / device widget requests, so clearing the
// browser queue on navigation does not cancel dashboard requests
export const statusRequestQueue = createRequestQueue(6);

// Queue for file uploads, bounded so a large multi-file drop does not
// monopolize the ~6-connection S3 pool. Never clear() this queue - uploads
// are cancelled individually via the upload engine
export const uploadRequestQueue = createRequestQueue(3);
