// Shared test kit for the OTA batch manager suite. Lives under __fixtures__/
// (NOT __tests__/) so jest's testMatch does not collect it as an empty suite.
//
// IMPORTANT: any test file that imports helpers which transitively load
// config-editor-base/-tools (mergeConfig, evaluateDevice, editorActions, ...)
// MUST declare, before its imports:
//   jest.mock("detect-browser", () => ({ detect: () => ({ name: "chrome" }) }))
// This kit itself only pulls ajv / @rjsf / deepmerge / crc-based cache, none of
// which need that mock - so cache-only tests can import it freely.

import Ajv from "ajv";
import validatorAjv6 from "@rjsf/validator-ajv6";
import { getDefaultFormState } from "@rjsf/utils";

import * as cache from "../cache";

const merge = require("deepmerge");

// ---------------------------------------------------------------------------
// device families + revisions (matches encryptionFields DEVICE_TYPE_MAP and the
// real schema folders under config-editor-base/dist/schema). There is no
// non-GNSS CANedge3 schema in the distribution - CANedge3 is always GNSS.
export const DEVICE_FAMILIES = {
  CANedge2: { type: "0000001F", wifi: true, cellular: false, s3: true, gnss: false },
  "CANedge2 GNSS": { type: "0000005F", wifi: true, cellular: false, s3: true, gnss: true },
  "CANedge3 GNSS": { type: "0000007D", wifi: false, cellular: true, s3: true, gnss: true }
};

// revisions supported by the batch tool (== AUTO_ENCRYPTION_SUPPORTED_REVISIONS)
export const MATRIX_REVISIONS = ["01.07", "01.08", "01.09"];

// [device, revision] permutations for describe.each
export const MATRIX = [];
Object.keys(DEVICE_FAMILIES).forEach((device) => {
  MATRIX_REVISIONS.forEach((rev) => MATRIX.push([device, rev]));
});

// ---------------------------------------------------------------------------
// real schemas + validators

export const loadSchema = (device, rev) =>
  require(`config-editor-base/dist/schema/${device}/schema-${rev}.json`);

// the exact ajv recipe used in production (cache.js:49)
export const compileValidator = (schema) =>
  new Ajv({ allErrors: true, strict: false, logger: false }).compile(schema);

// compile through the production cache module so real-schema tests also
// exercise cache.setSchema / cache.getValidator (returns the compiled validator)
export const compileViaCache = (deviceId, schema) => {
  cache.setSchema(deviceId, JSON.stringify(schema));
  return cache.getValidator(deviceId);
};

// ---------------------------------------------------------------------------
// baseline configs generated from the real schemas (no committed secrets)

// rjsf default config - schema-INVALID by itself (~19-20 pre-existing ajv
// errors: rtc.sync default 2 without its network siblings, the default
// filter.id[0] item, and gnss.geofence). Use with newErrorsVsBaseline().
export const generatedBaseline = (device, rev) => {
  const schema = loadSchema(device, rev);
  return getDefaultFormState(validatorAjv6, schema, undefined, schema);
};

const VALID_FILTER = {
  name: "f",
  state: 1,
  type: 0,
  id_format: 0,
  method: 0,
  f1: "0",
  f2: "7FF",
  prescaler_type: 0
};

// a schema-VALID baseline: fixes exactly the deterministic defects in the rjsf
// default (verified 0 ajv errors for every family x revision in the matrix).
// Guard tests should assert compileValidator(schema)(makeCleanBaseline(...)) is
// true so a future schema change that breaks this fix-up fails loudly.
export const makeCleanBaseline = (device, rev) => {
  const base = generatedBaseline(device, rev);
  if (base.rtc) {
    base.rtc.sync = 0; // "Retain current time" - no required siblings
    ["manual_date_time", "message", "valid_signal", "time_signal", "tolerance", "ntp_server"].forEach(
      (k) => delete base.rtc[k]
    );
  }
  ["can_internal", "can_1", "can_2"].forEach((c) => {
    if (base[c] && base[c].filter && Array.isArray(base[c].filter.id)) {
      base[c].filter.id = [{ ...VALID_FILTER }];
    }
  });
  if (base.gnss && base.gnss.geofence === undefined) base.gnss.geofence = [];
  return base;
};

// ---------------------------------------------------------------------------
// merge + validation-diff helpers (mirror evaluate.js mergeConfig semantics)

export const overwriteMerge = (destinationArray, sourceArray) => sourceArray;
export const mergeCfg = (config, partial) =>
  merge(config, partial, { arrayMerge: overwriteMerge });

const errKeys = (validator, obj) => {
  validator(obj);
  return (validator.errors || []).map((e) => e.dataPath + "|" + e.message);
};

export const errorSet = (validator, obj) => new Set(errKeys(validator, obj));

// error keys present after the merge but not in the (possibly dirty) baseline -
// the robust way to assert "this partial introduced a schema violation"
export const newErrorsVsBaseline = (validator, base, merged) => {
  const baseline = errorSet(validator, base);
  return errKeys(validator, merged).filter((k) => !baseline.has(k));
};

// ---------------------------------------------------------------------------
// device.json + evaluateDevice input builders

export const makeDeviceJson = (overrides = {}) => {
  const rev = overrides.rev || "01.09";
  return {
    id: "AABBCCDD",
    type: "0000001F", // CANedge2
    kpub: "A".repeat(88),
    fw_ver: rev + ".01",
    cfg_ver: rev,
    cfg_name: "config-" + rev + ".json",
    sch_name: "schema-" + rev + ".json",
    cfg_crc32: "",
    log_meta: "test-device",
    ...stripHelperKeys(overrides)
  };
};

const stripHelperKeys = (o) => {
  const { rev, ...rest } = o;
  return rest;
};

// ---------------------------------------------------------------------------
// async S3 helpers (submitEngine/actions use global fetch + web.* mocks)

// a fetch() Response stand-in for submitEngine.fetchFreshConfigText /
// actions.fetchDeviceObjectText (they read .ok/.status and call .text())
export const fakeFetchResponse = (text, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: () => Promise.resolve(text)
});

// install a scriptable global.fetch; returns a restore() to call in afterEach
export const installFetchMock = (impl) => {
  const real = global.fetch;
  global.fetch = jest.fn(impl);
  return () => {
    global.fetch = real;
  };
};

// poll until predicate() is truthy (real timers); mirrors uploadEngine.test.js
export const waitFor = (predicate, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
