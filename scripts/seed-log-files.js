/*
 * Uploads synthetic CANedge log files to the seeded TRUCK fleet so the status
 * dashboard shows realistic "uploaded data". Re-run it a few times over the
 * day: The dashboard bins uploads by the S3 Last-Modified timestamp (set by
 * the server at upload), so history can only be built by actually uploading
 * at different times. Every run writes NEW session folders - nothing is
 * overwritten.
 *
 * Structure per upload (mirrors a real CANedge):
 *   <serial>/<session>/<split>-<epochhex>.MF4
 * with 1-3 splits of ~300 KB per device per run (~18 MB per run across 30
 * devices), each object carrying the custom S3 meta "timestamp" the CANcloud
 * browser reads as the log file Start Time. Content is random bytes behind an
 * MDF4 magic header - CANcloud never parses log file contents.
 *
 * Devices are discovered from the bucket: Top-level 8-hex folders whose
 * device.json meta starts with "TRUCK " (the seed-perf-fleet.js --profile real
 * fleet). Other folders are never touched.
 *
 * USAGE
 *   node scripts/seed-log-files.js <mode> [options]
 *
 *   modes
 *     upload      write one new session folder per device (default sizes above)
 *     verify      per-device session/file/MB totals
 *     teardown    delete ONLY the session folders under TRUCK devices (--yes);
 *                 device.json/config/schema stay in place
 *
 *   credentials: --creds <file.json> or S3_* env vars, as in seed-perf-fleet.js
 *
 *   options
 *     --session <n>      fixed session number for all devices (default: each
 *                        device's max existing session + 1)
 *     --files <n>        splits per session (default: random 1-3)
 *     --size-kb <n>      base split size in KB (default 300, +/-20% jitter)
 *     --concurrency <n>  parallel PUTs (default 8)
 *     --yes              required by teardown
 */

const fs = require("fs");
const crypto = require("crypto");

const AWS = require("aws-sdk");

// --------------------------------------------------------------------------
// arguments

const argv = process.argv.slice(2);
const MODE = argv[0];
const flag = (name, fallback) => {
  const at = argv.indexOf("--" + name);
  return at > -1 && argv[at + 1] ? argv[at + 1] : fallback;
};
const has = (name) => argv.indexOf("--" + name) > -1;

const SESSION = flag("session", null);
const FILES = flag("files", null);
const SIZE_KB = Number(flag("size-kb", 300));
const CONCURRENCY = Number(flag("concurrency", 8));

const usage = (message) => {
  if (message) console.error("error: " + message + "\n");
  console.error(
    fs
      .readFileSync(__filename, "utf8")
      .split("*/")[0]
      .split("\n")
      .slice(1)
      .map((line) => line.replace(/^ \* ?/, ""))
      .join("\n")
  );
  process.exit(1);
};

// --------------------------------------------------------------------------
// S3 glue (same conventions as seed-perf-fleet.js)

const readCreds = () => {
  const file = flag("creds", null);
  if (file) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const server =
      parsed.connect && parsed.connect.s3 && parsed.connect.s3.server
        ? parsed.connect.s3.server
        : parsed;
    return {
      endpoint: server.endpoint,
      port: server.port,
      bucket: server.bucket,
      region: server.region,
      accessKey: server.accesskey || server.accessKey,
      secretKey: server.secretkey || server.secretKey,
      pathStyle: server.request_style === 1 || server.pathStyle === true
    };
  }
  if (process.env.S3_ENDPOINT) {
    return {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION,
      accessKey: process.env.S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY,
      pathStyle: process.env.S3_PATH_STYLE === "1"
    };
  }
  return usage("no credentials: pass --creds <file.json> or set S3_ENDPOINT etc.");
};

const makeClient = () => {
  const creds = readCreds();
  ["endpoint", "bucket", "accessKey", "secretKey"].forEach((key) => {
    if (!creds[key]) usage("credentials are missing " + key);
  });
  let endpoint = creds.endpoint;
  if (!/^https?:\/\//.test(endpoint)) endpoint = "https://" + endpoint;
  if (creds.port && ![80, 443].includes(Number(creds.port)) && !/:\d+$/.test(endpoint)) {
    endpoint = endpoint + ":" + creds.port;
  }
  const s3 = new AWS.S3({
    endpoint,
    region: creds.region || "us-east-1",
    accessKeyId: creds.accessKey,
    secretAccessKey: creds.secretKey,
    s3ForcePathStyle: !!creds.pathStyle,
    signatureVersion: "v4"
  });
  console.log(
    "bucket " + creds.bucket + " @ " + endpoint + " (" + (creds.region || "us-east-1") + ")"
  );
  return { s3, bucket: creds.bucket };
};

const listAll = async (s3, bucket, prefix, delimiter) => {
  const keys = [];
  const prefixes = [];
  let token;
  do {
    const res = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        ContinuationToken: token
      })
      .promise();
    (res.Contents || []).forEach((o) => keys.push({ key: o.Key, size: o.Size }));
    (res.CommonPrefixes || []).forEach((p) => prefixes.push(p.Prefix));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { keys, prefixes };
};

const pool = async (items, limit, worker) => {
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        await worker(items[cursor++]);
        done += 1;
        if (done % 20 === 0) console.log("  ... " + done + "/" + items.length);
      }
    })
  );
};

// --------------------------------------------------------------------------
// fleet discovery + naming

// the seeded fleet: 8-hex top-level folders whose device.json meta says TRUCK
const findTruckDevices = async (s3, bucket) => {
  const { prefixes } = await listAll(s3, bucket, "", "/");
  const folders = prefixes
    .map((p) => p.replace(/\/$/, ""))
    .filter((p) => /^[0-9A-F]{8}$/i.test(p));
  const devices = [];
  await pool(folders, CONCURRENCY, async (id) => {
    try {
      const res = await s3.getObject({ Bucket: bucket, Key: id + "/device.json" }).promise();
      const meta = JSON.parse(res.Body.toString()).log_meta;
      if (typeof meta === "string" && meta.indexOf("TRUCK ") === 0) devices.push(id);
    } catch (e) {}
  });
  return devices.sort();
};

const SESSION_RE = /^\d{8}$/;

const sessionFoldersOf = async (s3, bucket, deviceId) => {
  const { prefixes } = await listAll(s3, bucket, deviceId + "/", "/");
  return prefixes
    .map((p) => p.split("/")[1])
    .filter((name) => SESSION_RE.test(name));
};

const pad8 = (n) => String(n).padStart(8, "0");

// filename epoch (8-hex unix seconds) + the matching S3 meta timestamp the
// CANcloud browser reads as the log file Start Time (YYYYMMDDTHHmmssZ, UTC)
const epochHex = (seconds) => seconds.toString(16).toUpperCase().padStart(8, "0");
const metaTimestamp = (seconds) => {
  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z"
  );
};

// random bytes (incompressible, realistic transfer) behind the MDF4 magic id -
// CANcloud recognizes log files purely by extension and never parses content
const makeLogBody = (bytes) =>
  Buffer.concat([Buffer.from("MDF     4.11    "), crypto.randomBytes(Math.max(bytes - 16, 0))]);

// --------------------------------------------------------------------------
// modes

const modeUpload = async () => {
  const { s3, bucket } = makeClient();
  const devices = await findTruckDevices(s3, bucket);
  if (!devices.length) {
    console.log("no TRUCK devices found - seed the fleet first (seed-perf-fleet.js --profile real)");
    return;
  }

  // one new session per device: --session, or each device's max existing + 1
  const jobs = [];
  await pool(devices, CONCURRENCY, async (deviceId) => {
    let sessionNo;
    if (SESSION !== null) {
      sessionNo = Number(SESSION);
    } else {
      const existing = await sessionFoldersOf(s3, bucket, deviceId);
      sessionNo = existing.length ? Math.max(...existing.map(Number)) + 1 : 1;
    }
    const splits = FILES !== null ? Number(FILES) : 1 + Math.floor(Math.random() * 3);
    const nowSec = Math.floor(Date.now() / 1000);
    for (let k = 0; k < splits; k += 1) {
      // splits ~5 min apart, the last one ending "now"
      const startSec = nowSec - (splits - k) * 300;
      const bytes = Math.round(SIZE_KB * 1024 * (0.8 + Math.random() * 0.4));
      jobs.push({
        key: deviceId + "/" + pad8(sessionNo) + "/" + pad8(k + 1) + "-" + epochHex(startSec) + ".MF4",
        startSec,
        bytes
      });
    }
  });

  let totalBytes = 0;
  await pool(jobs, CONCURRENCY, async (job) => {
    await s3
      .putObject({
        Bucket: bucket,
        Key: job.key,
        Body: makeLogBody(job.bytes),
        ContentType: "application/octet-stream",
        Metadata: { timestamp: metaTimestamp(job.startSec) }
      })
      .promise();
    totalBytes += job.bytes;
  });

  console.log(
    "uploaded " + jobs.length + " log files to " + devices.length + " devices (" +
      (totalBytes / (1024 * 1024)).toFixed(1) + " MB) - one new session per device"
  );
};

const modeVerify = async () => {
  const { s3, bucket } = makeClient();
  const devices = await findTruckDevices(s3, bucket);
  let totalFiles = 0;
  let totalBytes = 0;
  for (const deviceId of devices) {
    const { keys } = await listAll(s3, bucket, deviceId + "/", undefined);
    const logs = keys.filter((o) => /\/\d{8}\/\d{8}-[0-9A-F]{8}\.MF4$/i.test(o.key));
    const sessions = new Set(logs.map((o) => o.key.split("/")[1]));
    const bytes = logs.reduce((acc, o) => acc + o.size, 0);
    totalFiles += logs.length;
    totalBytes += bytes;
    console.log(
      "  " + deviceId + "  sessions: " + String(sessions.size).padStart(3) +
        "  files: " + String(logs.length).padStart(4) +
        "  " + (bytes / (1024 * 1024)).toFixed(2) + " MB"
    );
  }
  console.log(
    "total: " + devices.length + " devices, " + totalFiles + " files, " +
      (totalBytes / (1024 * 1024)).toFixed(1) + " MB"
  );
};

const modeTeardown = async () => {
  const { s3, bucket } = makeClient();
  const devices = await findTruckDevices(s3, bucket);
  const keys = [];
  for (const deviceId of devices) {
    const listing = await listAll(s3, bucket, deviceId + "/", undefined);
    // session folders only - device.json/config/schema stay
    listing.keys.forEach((o) => {
      if (new RegExp("^" + deviceId + "/\\d{8}/").test(o.key)) keys.push(o.key);
    });
  }
  if (!keys.length) {
    console.log("  no session folders under the TRUCK fleet");
    return;
  }
  if (!has("yes")) {
    console.log("  would delete " + keys.length + " log objects - re-run with --yes to confirm");
    return;
  }
  console.log("  deleting " + keys.length + " log objects");
  for (let i = 0; i < keys.length; i += 1000) {
    await s3
      .deleteObjects({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true }
      })
      .promise();
    console.log("  ... " + Math.min(i + 1000, keys.length) + "/" + keys.length);
  }
  console.log("done");
};

const MODES = { upload: modeUpload, verify: modeVerify, teardown: modeTeardown };

if (!MODES[MODE]) usage(MODE ? "unknown mode: " + MODE : null);
MODES[MODE]().catch((e) => {
  console.error("failed: " + e.message);
  process.exit(1);
});
