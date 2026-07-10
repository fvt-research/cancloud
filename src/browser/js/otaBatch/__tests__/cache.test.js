// Module-cache unit tests. cache.js holds the raw config text/parsed, the
// content-hash-deduped schema validators, and the crc32 recipe that the drift
// check and the config-synced column both key off. No config-editor-base import
// here, so no detect-browser mock is needed.

import Ajv from "ajv";
import * as cache from "../cache";

const { crc32 } = require("crc");

beforeEach(() => cache.clearAll());

describe("crc32Hex", () => {
  it("matches the standard CRC-32 check vector, upper-cased", () => {
    // CRC-32 of "123456789" is 0xCBF43926 (the canonical check value)
    expect(cache.crc32Hex("123456789")).toBe("CBF43926");
  });

  it("left-pads to 8 hex chars (empty string -> all zeros)", () => {
    expect(cache.crc32Hex("")).toBe("00000000");
  });

  it("agrees with the crc package recipe used across the app", () => {
    const text = '{\n  "general": {}\n}';
    const expected = crc32(text).toString(16).toUpperCase().padStart(8, "0");
    expect(cache.crc32Hex(text)).toBe(expected);
  });
});

describe("setConfig / getConfig", () => {
  it("stores a valid JSON object and reports loaded + crc32", () => {
    const text = '{"a":1}';
    const meta = cache.setConfig("DEV1", text);
    expect(meta.status).toBe("loaded");
    expect(meta.crc32).toBe(cache.crc32Hex(text));
    expect(cache.getConfig("DEV1")).toEqual({ text, parsed: { a: 1 } });
  });

  it("rejects a top-level JSON array (a config must be an object)", () => {
    expect(cache.setConfig("DEV1", "[1,2]").status).toBe("invalid");
    expect(cache.getConfig("DEV1")).toBeUndefined();
  });

  it("rejects a scalar and null", () => {
    expect(cache.setConfig("DEV1", "5").status).toBe("invalid");
    expect(cache.setConfig("DEV1", "null").status).toBe("invalid");
    expect(cache.getConfig("DEV1")).toBeUndefined();
  });

  it("rejects malformed JSON", () => {
    expect(cache.setConfig("DEV1", "{ not json").status).toBe("invalid");
    expect(cache.getConfig("DEV1")).toBeUndefined();
  });

  it("evicts a previously-valid config when re-set with invalid text", () => {
    cache.setConfig("DEV1", '{"a":1}');
    expect(cache.getConfig("DEV1")).toBeDefined();
    cache.setConfig("DEV1", "{ broken");
    expect(cache.getConfig("DEV1")).toBeUndefined();
  });
});

describe("setSchema / getValidator (content-hash dedup)", () => {
  const schemaText = JSON.stringify({ type: "object", properties: { a: { type: "integer" } } });

  it("compiles identical schema text only once and shares the validator", () => {
    const spy = jest.spyOn(Ajv.prototype, "compile");
    cache.clearAll();
    const a = cache.setSchema("DEV_A", schemaText);
    const b = cache.setSchema("DEV_B", schemaText);
    expect(a.status).toBe("loaded");
    expect(b.status).toBe("loaded");
    expect(a.hash).toBe(b.hash);
    expect(cache.getValidator("DEV_A")).toBe(cache.getValidator("DEV_B"));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("compiles distinct schema texts separately", () => {
    const other = JSON.stringify({ type: "object", properties: { b: { type: "string" } } });
    cache.setSchema("DEV_A", schemaText);
    cache.setSchema("DEV_B", other);
    expect(cache.getValidator("DEV_A")).not.toBe(cache.getValidator("DEV_B"));
  });

  it("produces a working validator from the compiled schema", () => {
    cache.setSchema("DEV_A", schemaText);
    const validate = cache.getValidator("DEV_A");
    expect(validate({ a: 1 })).toBe(true);
    expect(validate({ a: "nope" })).toBe(false);
  });

  it("marks malformed schema JSON invalid with a null validator", () => {
    const meta = cache.setSchema("DEV_A", "{ not json");
    expect(meta.status).toBe("invalid");
    expect(cache.getValidator("DEV_A")).toBeNull();
  });

  it("marks a schema that ajv.compile rejects invalid (null validator)", () => {
    // parses fine, but "notatype" fails ajv's meta-schema validation at compile
    const meta = cache.setSchema("DEV_A", JSON.stringify({ type: "notatype" }));
    expect(meta.status).toBe("invalid");
    expect(cache.getValidator("DEV_A")).toBeNull();
  });

  it("returns null for an unknown device", () => {
    expect(cache.getValidator("NOPE")).toBeNull();
  });
});

describe("merged-result store + clearing", () => {
  it("stores and returns a merged result per device", () => {
    cache.setMergedResult("DEV1", { merged: { a: 1 }, mergedText: '{"a":1}' });
    expect(cache.getMergedResult("DEV1")).toEqual({ merged: { a: 1 }, mergedText: '{"a":1}' });
  });

  it("clearMergedResults drops only merged results", () => {
    cache.setConfig("DEV1", '{"a":1}');
    cache.setMergedResult("DEV1", { merged: {}, mergedText: "{}" });
    cache.clearMergedResults();
    expect(cache.getMergedResult("DEV1")).toBeUndefined();
    expect(cache.getConfig("DEV1")).toBeDefined(); // config survives
  });

  it("clearAll wipes configs, schemas and merged results", () => {
    cache.setConfig("DEV1", '{"a":1}');
    cache.setSchema("DEV1", JSON.stringify({ type: "object" }));
    cache.setMergedResult("DEV1", { merged: {}, mergedText: "{}" });
    cache.clearAll();
    expect(cache.getConfig("DEV1")).toBeUndefined();
    expect(cache.getValidator("DEV1")).toBeNull();
    expect(cache.getMergedResult("DEV1")).toBeUndefined();
  });
});
