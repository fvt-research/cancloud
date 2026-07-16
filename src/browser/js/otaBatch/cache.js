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
let firmware = null; // { file, deviceType, fwVer, revision, defaultConfig, targetSchema }

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

// the single loaded firmware for a FW batch: raw File (for the binary PUT), the
// parsed header, the firmware's embedded default config, and the official dist
// targetSchema resolved via loadFile (reused as migrateConfig's targetSchema)
export const setFirmware = (entry) => {
  // pre-compile the target (official) schema once so the per-device evaluation
  // can validate each migrated config without recompiling (mirrors the
  // device-schema dedup above)
  let targetValidator = null;
  if (entry && entry.targetSchema) {
    try {
      const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
      targetValidator = ajv.compile(entry.targetSchema);
    } catch (e) {
      targetValidator = null;
    }
  }
  firmware = entry ? { ...entry, targetValidator } : null;
};

export const getFirmware = () => firmware;

export const clearFirmware = () => {
  firmware = null;
};

export const clearAll = () => {
  configs = new Map();
  deviceSchemaHash = new Map();
  schemasByHash = new Map();
  mergedResults = new Map();
  firmware = null;
};
