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

  it("maps empty and whitespace-only optional strings to null", () => {
    expect(normalize({eventId: ""})).toEqual({event_id: null})
    expect(normalize({eventId: null})).toEqual({event_id: null})
    expect(normalize({eventId: "   "})).toEqual({event_id: null})
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

  it("does not validate absent required attributes", () => {
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

  it("rejects unknown attribute keys by default", () => {
    expect(() => normalizeAttributesWithSchema({
      attributes: {evil: "y", resourceId: "x"},
      errorFactory: (message, {code}) => Object.assign(new Error(message), {code}),
      schema: {resourceId: {type: "string"}}
    })).toThrow(/Unknown attribute: evil\./u)
  })

  it("ignores unknown attribute keys when configured", () => {
    const normalized = normalizeAttributesWithSchema({
      attributes: {ignored: "y", resourceId: "x"},
      errorFactory: (message, {code}) => Object.assign(new Error(message), {code}),
      schema: {resourceId: {type: "string"}},
      unknownAttributes: "ignore"
    })

    expect(normalized).toEqual({resource_id: "x"})
  })

  describe("boolean type", () => {
    /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
    const booleanSchema = {
      published: {required: true, type: "boolean"},
      scanned: {type: "boolean"}
    }

    /**
     * Normalizes against the boolean schema and returns the thrown error.
     * @param {Record<string, ?>} attributes - Raw attributes.
     * @returns {TestSchemaError} Thrown error.
     */
    const booleanError = (attributes) => {
      try {
        normalizeAttributesWithSchema({attributes, errorFactory, schema: booleanSchema})
      } catch (error) {
        if (error instanceof TestSchemaError) return error

        throw error
      }

      throw new Error("Expected normalization to fail")
    }

    it("accepts booleans and 1/0 and maps empty optional values to null", () => {
      expect(normalizeAttributesWithSchema({attributes: {scanned: true}, errorFactory, schema: booleanSchema})).toEqual({scanned: true})
      expect(normalizeAttributesWithSchema({attributes: {scanned: false}, errorFactory, schema: booleanSchema})).toEqual({scanned: false})
      expect(normalizeAttributesWithSchema({attributes: {scanned: 1}, errorFactory, schema: booleanSchema})).toEqual({scanned: true})
      expect(normalizeAttributesWithSchema({attributes: {scanned: 0}, errorFactory, schema: booleanSchema})).toEqual({scanned: false})
      expect(normalizeAttributesWithSchema({attributes: {scanned: null}, errorFactory, schema: booleanSchema})).toEqual({scanned: null})
      expect(normalizeAttributesWithSchema({attributes: {scanned: ""}, errorFactory, schema: booleanSchema})).toEqual({scanned: null})
    })

    it("rejects invalid booleans and empty required booleans with derived messages and codes", () => {
      const invalidError = booleanError({scanned: "yes"})

      expect(invalidError.message).toEqual("scanned must be a boolean.")
      expect(invalidError.code).toEqual("sync-scanned-invalid-boolean")

      expect(booleanError({published: null}).message).toEqual("published is required.")
      expect(booleanError({published: null}).code).toEqual("sync-published-required")
      expect(booleanError({published: ""}).code).toEqual("sync-published-required")
    })

    it("uses pinned invalid messages when the schema overrides them", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const pinnedSchema = {scanned: {invalidMessage: "Scanned must be true or false.", type: "boolean"}}

      try {
        normalizeAttributesWithSchema({attributes: {scanned: "yes"}, errorFactory, schema: pinnedSchema})
        throw new Error("Expected normalization to fail")
      } catch (error) {
        if (!(error instanceof TestSchemaError)) throw error

        expect(error.message).toEqual("Scanned must be true or false.")
        expect(error.code).toEqual("sync-scanned-invalid-boolean")
      }
    })
  })

  describe("integer type", () => {
    /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
    const integerSchema = {
      position: {max: 100, min: 1, type: "integer"},
      quantity: {required: true, type: "integer"}
    }

    /**
     * Normalizes against the integer schema and returns the thrown error.
     * @param {Record<string, ?>} attributes - Raw attributes.
     * @returns {TestSchemaError} Thrown error.
     */
    const integerError = (attributes) => {
      try {
        normalizeAttributesWithSchema({attributes, errorFactory, schema: integerSchema})
      } catch (error) {
        if (error instanceof TestSchemaError) return error

        throw error
      }

      throw new Error("Expected normalization to fail")
    }

    it("accepts integers and integer strings and maps empty optional values to null", () => {
      expect(normalizeAttributesWithSchema({attributes: {position: 5}, errorFactory, schema: integerSchema})).toEqual({position: 5})
      expect(normalizeAttributesWithSchema({attributes: {position: "5"}, errorFactory, schema: integerSchema})).toEqual({position: 5})
      expect(normalizeAttributesWithSchema({attributes: {position: null}, errorFactory, schema: integerSchema})).toEqual({position: null})
      expect(normalizeAttributesWithSchema({attributes: {position: ""}, errorFactory, schema: integerSchema})).toEqual({position: null})
    })

    it("rejects non-integers, empty required integers and out-of-bounds values with derived messages and codes", () => {
      const invalidError = integerError({position: "abc"})

      expect(invalidError.message).toEqual("position must be an integer.")
      expect(invalidError.code).toEqual("sync-position-invalid-integer")
      expect(integerError({position: 5.5}).code).toEqual("sync-position-invalid-integer")

      expect(integerError({quantity: null}).message).toEqual("quantity is required.")
      expect(integerError({quantity: null}).code).toEqual("sync-quantity-required")

      const tooSmallError = integerError({position: 0})

      expect(tooSmallError.message).toEqual("position must be at least 1.")
      expect(tooSmallError.code).toEqual("sync-position-too-small")

      const tooLargeError = integerError({position: 101})

      expect(tooLargeError.message).toEqual("position must be at most 100.")
      expect(tooLargeError.code).toEqual("sync-position-too-large")
    })

    it("uses pinned invalid and bounds messages when the schema overrides them", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const pinnedSchema = {
        position: {
          invalidMessage: "Position must be a whole number.",
          max: 10,
          min: 2,
          tooLargeMessage: "Position is too large.",
          tooSmallMessage: "Position is too small.",
          type: "integer"
        }
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

      expect(pinnedError({position: "x"}).message).toEqual("Position must be a whole number.")
      expect(pinnedError({position: 1}).message).toEqual("Position is too small.")
      expect(pinnedError({position: 11}).message).toEqual("Position is too large.")
    })
  })

  describe("float type", () => {
    /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
    const floatSchema = {
      latitude: {type: "float"},
      price: {required: true, type: "float"}
    }

    it("accepts finite numbers and numeric strings and maps empty optional values to null", () => {
      expect(normalizeAttributesWithSchema({attributes: {latitude: 55.5}, errorFactory, schema: floatSchema})).toEqual({latitude: 55.5})
      expect(normalizeAttributesWithSchema({attributes: {latitude: "55.5"}, errorFactory, schema: floatSchema})).toEqual({latitude: 55.5})
      expect(normalizeAttributesWithSchema({attributes: {latitude: -7}, errorFactory, schema: floatSchema})).toEqual({latitude: -7})
      expect(normalizeAttributesWithSchema({attributes: {latitude: null}, errorFactory, schema: floatSchema})).toEqual({latitude: null})
      expect(normalizeAttributesWithSchema({attributes: {latitude: ""}, errorFactory, schema: floatSchema})).toEqual({latitude: null})
    })

    it("rejects non-numbers and empty required floats with derived messages and codes", () => {
      /**
       * Normalizes against the float schema and returns the thrown error.
       * @param {Record<string, ?>} attributes - Raw attributes.
       * @returns {TestSchemaError} Thrown error.
       */
      const floatError = (attributes) => {
        try {
          normalizeAttributesWithSchema({attributes, errorFactory, schema: floatSchema})
        } catch (error) {
          if (error instanceof TestSchemaError) return error

          throw error
        }

        throw new Error("Expected normalization to fail")
      }

      const invalidError = floatError({latitude: "abc"})

      expect(invalidError.message).toEqual("latitude must be a number.")
      expect(invalidError.code).toEqual("sync-latitude-invalid-float")

      expect(floatError({price: null}).message).toEqual("price is required.")
      expect(floatError({price: null}).code).toEqual("sync-price-required")
    })
  })

  describe("uuid type", () => {
    /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
    const uuidSchema = {
      eventId: {required: true, type: "uuid"},
      ticketId: {type: "uuid"}
    }

    /**
     * Normalizes against the uuid schema and returns the thrown error.
     * @param {Record<string, ?>} attributes - Raw attributes.
     * @returns {TestSchemaError} Thrown error.
     */
    const uuidError = (attributes) => {
      try {
        normalizeAttributesWithSchema({attributes, errorFactory, schema: uuidSchema})
      } catch (error) {
        if (error instanceof TestSchemaError) return error

        throw error
      }

      throw new Error("Expected normalization to fail")
    }

    it("accepts uuid strings in any casing and maps empty optional values to null", () => {
      expect(normalizeAttributesWithSchema({attributes: {ticketId: "0d9ee786-8524-4536-9d3d-8a0b4b3e5a01"}, errorFactory, schema: uuidSchema}))
        .toEqual({ticket_id: "0d9ee786-8524-4536-9d3d-8a0b4b3e5a01"})
      expect(normalizeAttributesWithSchema({attributes: {ticketId: "0D9EE786-8524-4536-9D3D-8A0B4B3E5A01"}, errorFactory, schema: uuidSchema}))
        .toEqual({ticket_id: "0D9EE786-8524-4536-9D3D-8A0B4B3E5A01"})
      expect(normalizeAttributesWithSchema({attributes: {ticketId: null}, errorFactory, schema: uuidSchema})).toEqual({ticket_id: null})
      expect(normalizeAttributesWithSchema({attributes: {ticketId: ""}, errorFactory, schema: uuidSchema})).toEqual({ticket_id: null})
    })

    it("rejects malformed uuids and empty required uuids with derived messages and codes", () => {
      const invalidError = uuidError({ticketId: "not-a-uuid"})

      expect(invalidError.message).toEqual("ticketId must be a valid UUID.")
      expect(invalidError.code).toEqual("sync-ticketId-invalid-uuid")
      expect(uuidError({ticketId: 5}).code).toEqual("sync-ticketId-invalid-uuid")

      expect(uuidError({eventId: null}).message).toEqual("eventId is required.")
      expect(uuidError({eventId: null}).code).toEqual("sync-eventId-required")
    })
  })

  describe("rawOrNull type", () => {
    it("passes values through and maps undefined to null", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const rawOrNullSchema = {payload: {type: "rawOrNull"}}

      expect(normalizeAttributesWithSchema({attributes: {payload: "kept  "}, errorFactory, schema: rawOrNullSchema})).toEqual({payload: "kept  "})
      expect(normalizeAttributesWithSchema({attributes: {payload: 0}, errorFactory, schema: rawOrNullSchema})).toEqual({payload: 0})
      expect(normalizeAttributesWithSchema({attributes: {payload: undefined}, errorFactory, schema: rawOrNullSchema})).toEqual({payload: null})
    })
  })

  describe("ignored type", () => {
    it("accepts the key without erroring and drops it from the output", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const ignoredSchema = {
        localOnlyFlag: {type: "ignored"},
        resourceId: {type: "string"}
      }

      const normalized = normalizeAttributesWithSchema({
        attributes: {localOnlyFlag: "device-thing", local_only_flag: "column-cased", resourceId: "row-1"},
        errorFactory,
        schema: ignoredSchema
      })

      expect(normalized).toEqual({resource_id: "row-1"})
    })
  })

  describe("date invalid option", () => {
    it("maps invalid and blank optional dates to null when invalid is null", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const lenientSchema = {scannedAt: {invalid: "null", type: "date"}}

      expect(normalizeAttributesWithSchema({attributes: {scannedAt: "not-a-date"}, errorFactory, schema: lenientSchema})).toEqual({scanned_at: null})
      expect(normalizeAttributesWithSchema({attributes: {scannedAt: ""}, errorFactory, schema: lenientSchema})).toEqual({scanned_at: null})
      expect(/** @type {Date} */ (normalizeAttributesWithSchema({
        attributes: {scannedAt: "2026-07-03T10:00:00.000Z"},
        errorFactory,
        schema: lenientSchema
      }).scanned_at).toISOString()).toEqual("2026-07-03T10:00:00.000Z")
    })

    it("still rejects blank required dates via required when invalid is null", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const lenientRequiredSchema = {scannedAt: {invalid: "null", required: true, type: "date"}}

      try {
        normalizeAttributesWithSchema({attributes: {scannedAt: ""}, errorFactory, schema: lenientRequiredSchema})
        throw new Error("Expected normalization to fail")
      } catch (error) {
        if (!(error instanceof TestSchemaError)) throw error

        expect(error.message).toEqual("scannedAt is required.")
        expect(error.code).toEqual("sync-scannedAt-required")
      }
    })
  })

  describe("string trim option", () => {
    it("keeps surrounding whitespace and bounds the untrimmed length when trim is false", () => {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      const untrimmedSchema = {note: {maxLength: 6, trim: false, type: "string"}}

      expect(normalizeAttributesWithSchema({attributes: {note: "  hi  "}, errorFactory, schema: untrimmedSchema})).toEqual({note: "  hi  "})
      expect(normalizeAttributesWithSchema({attributes: {note: ""}, errorFactory, schema: untrimmedSchema})).toEqual({note: null})

      try {
        normalizeAttributesWithSchema({attributes: {note: "  hi   "}, errorFactory, schema: untrimmedSchema})
        throw new Error("Expected normalization to fail")
      } catch (error) {
        if (!(error instanceof TestSchemaError)) throw error

        expect(error.code).toEqual("sync-note-too-long")
      }
    })
  })

})
