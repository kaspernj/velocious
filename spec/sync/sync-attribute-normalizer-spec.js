// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import normalizeAttributesWithSchema from "../../src/sync/sync-attribute-normalizer.js"

/** Error type carrying the mapped code from the spec error factory. */
class TestSchemaError extends Error {
  /**
   * Creates a test schema error.
   * @param {string} message - Error message.
   * @param {{cause?: Error, code: string}} args - Error details.
   */
  constructor(message, {cause, code}) {
    super(message, cause ? {cause} : undefined)
    this.code = code
  }
}

/** @type {import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeErrorFactory} */
const errorFactory = (message, details) => new TestSchemaError(message, details)

/** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
const schema = {
  authenticationTokenId: {type: "raw"},
  clientUpdatedAt: {required: true, type: "date"},
  data: {invalidJsonMessage: "Data must be valid JSON.", invalidMessage: "Data must be an object or JSON string.", type: "json"},
  eventId: {maxLength: 255, type: "string"},
  expiresAt: {type: "date"},
  resourceId: {maxLength: 255, type: "string"},
  syncType: {maxLength: 255, required: true, type: "string"}
}

/**
 * Normalizes attributes against the shared spec schema.
 * @param {Record<string, ?>} attributes - Raw attributes.
 * @returns {Record<string, ?>} Normalized attributes.
 */
function normalize(attributes) {
  return normalizeAttributesWithSchema({attributes, errorFactory, schema})
}

/**
 * Runs a normalization expected to fail and returns the thrown error.
 * @param {Record<string, ?>} attributes - Raw attributes.
 * @returns {TestSchemaError} Thrown error.
 */
function normalizeError(attributes) {
  try {
    normalize(attributes)
  } catch (error) {
    if (error instanceof TestSchemaError) return error

    throw error
  }

  throw new Error("Expected normalization to fail")
}

describe("sync attribute normalizer", () => {
  it("accepts both camelCase and snake_case keys and writes snake_case columns", () => {
    expect(normalize({resource_id: "row-1"})).toEqual({resource_id: "row-1"})
    expect(normalize({resourceId: "row-2"})).toEqual({resource_id: "row-2"})
    expect(normalize({resource_id: "snake", resourceId: "camel"})).toEqual({resource_id: "camel"})
  })

  it("trims strings before bounds checking and coerces non-string values", () => {
    expect(normalize({resourceId: "  row-1  "})).toEqual({resource_id: "row-1"})
    expect(normalize({resourceId: 34})).toEqual({resource_id: "34"})
    expect(normalize({resourceId: ` ${"a".repeat(255)} `})).toEqual({resource_id: "a".repeat(255)})

    const error = normalizeError({resourceId: "a".repeat(256)})

    expect(error.message).toEqual("resourceId is too long (maximum is 255 characters).")
    expect(error.code).toEqual("sync-resourceId-too-long")
  })

  it("rejects blank required strings after trimming with derived message and code", () => {
    expect(normalizeError({syncType: ""}).message).toEqual("syncType is required.")
    expect(normalizeError({syncType: "   "}).message).toEqual("syncType is required.")
    expect(normalizeError({syncType: null}).code).toEqual("sync-syncType-required")
  })

  it("uses pinned per-attribute messages when the schema overrides them", () => {
    /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
    const pinnedSchema = {
      syncType: {maxLength: 10, required: true, requiredMessage: "Sync type is required.", tooLongMessage: "Sync type is too long.", type: "string"}
    }

    /**
     * Normalizes against the pinned schema and returns the thrown error.
     * @param {Record<string, ?>} attributes - Raw attributes.
     * @returns {TestSchemaError} Thrown error.
     */
    const pinnedError = (attributes) => {
      try {
        normalizeAttributesWithSchema({attributes, errorFactory, schema: pinnedSchema})
      } catch (error) {
        if (error instanceof TestSchemaError) return error

        throw error
      }

      throw new Error("Expected normalization to fail")
    }

    expect(pinnedError({syncType: ""}).message).toEqual("Sync type is required.")
    expect(pinnedError({syncType: ""}).code).toEqual("sync-syncType-required")
    expect(pinnedError({syncType: "12345678901"}).message).toEqual("Sync type is too long.")
    expect(pinnedError({syncType: "12345678901"}).code).toEqual("sync-syncType-too-long")
  })

  it("maps empty optional strings to null and keeps blank-trimmed optional strings", () => {
    expect(normalize({eventId: ""})).toEqual({event_id: null})
    expect(normalize({eventId: null})).toEqual({event_id: null})
    expect(normalize({eventId: "   "})).toEqual({event_id: ""})
  })

  it("validates required dates with derived message and code", () => {
    const parsedDate = /** @type {Date} */ (normalize({clientUpdatedAt: "2026-07-03T10:00:00.000Z"}).client_updated_at)

    expect(parsedDate instanceof Date).toEqual(true)
    expect(parsedDate.toISOString()).toEqual("2026-07-03T10:00:00.000Z")

    const passedThroughDate = /** @type {Date} */ (normalize({client_updated_at: new Date("2026-07-03T10:00:00.000Z")}).client_updated_at)

    expect(passedThroughDate.toISOString()).toEqual("2026-07-03T10:00:00.000Z")

    const error = normalizeError({clientUpdatedAt: "not-a-date"})

    expect(error.message).toEqual("clientUpdatedAt must be a valid datetime.")
    expect(error.code).toEqual("sync-clientUpdatedAt-invalid-datetime")
    expect(normalizeError({clientUpdatedAt: null}).code).toEqual("sync-clientUpdatedAt-invalid-datetime")
  })

  it("maps absent optional dates to null and validates present ones", () => {
    expect(normalize({expiresAt: null})).toEqual({expires_at: null})
    expect(normalize({expiresAt: ""})).toEqual({expires_at: null})
    expect(/** @type {Date} */ (normalize({expiresAt: "2026-07-04T10:00:00.000Z"}).expires_at).toISOString()).toEqual("2026-07-04T10:00:00.000Z")
    expect(normalizeError({expiresAt: "not-a-date"}).code).toEqual("sync-expiresAt-invalid-datetime")
  })

  it("parses json strings, passes objects through and rejects other json values", () => {
    expect(normalize({data: `{"name": "Changed"}`})).toEqual({data: {name: "Changed"}})
    expect(normalize({data: {name: "Changed"}})).toEqual({data: {name: "Changed"}})
    expect(normalize({data: ""})).toEqual({data: null})
    expect(normalize({data: null})).toEqual({data: null})

    const parseError = normalizeError({data: "{invalid"})

    expect(parseError.message).toEqual("Data must be valid JSON.")
    expect(parseError.code).toEqual("sync-data-invalid-json")
    expect(parseError.cause instanceof Error).toEqual(true)

    const typeError = normalizeError({data: 5})

    expect(typeError.message).toEqual("Data must be an object or JSON string.")
    expect(typeError.code).toEqual("sync-data-invalid")
  })

  it("passes raw attributes through untouched", () => {
    expect(normalize({authenticationTokenId: "3f1c9f2e-6a52-4a8f-9a63-0f4b6f6c8a01"})).toEqual({authentication_token_id: "3f1c9f2e-6a52-4a8f-9a63-0f4b6f6c8a01"})
    expect(normalize({authentication_token_id: null})).toEqual({authentication_token_id: null})
  })

  it("ignores unknown keys and does not validate absent required attributes", () => {
    expect(normalize({unknownColumn: "ignored"})).toEqual({})
    expect(normalize({})).toEqual({})
  })

  it("fails loudly on unknown schema types and missing error factories", () => {
    expect(() => normalizeAttributesWithSchema({
      attributes: {weird: 1},
      errorFactory,
      schema: {weird: {type: /** @type {?} */ ("nope")}}
    })).toThrow(/Unknown sync attribute schema type/u)

    expect(() => normalizeAttributesWithSchema({
      attributes: {},
      errorFactory: /** @type {?} */ (undefined),
      schema
    })).toThrow(/errorFactory/u)
  })
})
