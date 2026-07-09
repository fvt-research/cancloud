// Module-level cache for per-device artifacts that are too bulky or not
// serializable for redux: raw config text + parsed object, schema JSON and
// compiled ajv validators. Schemas/validators are deduplicated by content
// hash - a fleet holds only a handful of distinct type x revision schemas,
// so ~6-20 ajv compiles serve 1000+ devices. Redux keeps only small status
// maps; the table/evaluation read the bulky parts from here.

import Ajv from "ajv";

const { crc32 } = require("crc");

// the app-wide crc32 recipe (dashboardStatus/actions.js, encryptionFields.js)
export const crc32Hex = (text) =>
  crc32(text)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0");

let configs = new Map(); // deviceId -> { text, parsed }
let deviceSchemaHash = new Map(); // deviceId -> schema content hash
let schemasByHash = new Map(); // hash -> { parsed, validator }
let mergedResults = new Map(); // deviceId -> { merged, mergedText } (last evaluation)

export const setConfig = (deviceId, text) => {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    configs.set(deviceId, { text, parsed });
    return { status: "loaded", crc32: crc32Hex(text) };
  } catch (e) {
    configs.delete(deviceId);
    return { status: "invalid" };
  }
};

export const getConfig = (deviceId) => configs.get(deviceId);

export const setSchema = (deviceId, text) => {
  const hash = crc32Hex(text);
  deviceSchemaHash.set(deviceId, hash);

  if (!schemasByHash.has(hash)) {
    let entry;
    try {
      const parsed = JSON.parse(text);
      // identical ajv recipe to the encryption tool / OBD tool
      const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
      entry = { parsed, validator: ajv.compile(parsed) };
    } catch (e) {
      entry = { parsed: null, validator: null };
    }
    schemasByHash.set(hash, entry);
  }

  return {
    status: schemasByHash.get(hash).validator ? "loaded" : "invalid",
    hash
  };
};

export const getValidator = (deviceId) => {
  const hash = deviceSchemaHash.get(deviceId);
  const entry = hash !== undefined ? schemasByHash.get(hash) : undefined;
  return entry && entry.validator ? entry.validator : null;
};

export const setMergedResult = (deviceId, result) =>
  mergedResults.set(deviceId, result);

export const getMergedResult = (deviceId) => mergedResults.get(deviceId);

export const clearMergedResults = () => {
  mergedResults = new Map();
};

export const clearAll = () => {
  configs = new Map();
  deviceSchemaHash = new Map();
  schemasByHash = new Map();
  mergedResults = new Map();
};
