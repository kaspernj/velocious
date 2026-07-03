// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import VelociousError from "../../src/velocious-error.js"

/**
 * Builds a frontend-model resource instance without the frontend-model pipeline.
 * @param {typeof FrontendModelBaseResource} ResourceClass - Resource class to instantiate.
 * @param {Record<string, ?>} params - Request params.
 * @returns {FrontendModelBaseResource} Resource instance.
 */
function buildResource(ResourceClass, params) {
  return /** @type {FrontendModelBaseResource} */ (Object.assign(Object.create(ResourceClass.prototype), {
    params: () => params
  }))
}

describe("frontend model writable attributes permit bridge", () => {
  it("normalizes writable attributes through the declared schema on plain frontend-model resources", () => {
    class SchemaResource extends FrontendModelBaseResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      static writableAttributes = {
        name: {maxLength: 255, required: true, type: "string"},
        scannedAt: {type: "date"}
      }
    }

    const resource = buildResource(SchemaResource, {})
    const normalized = resource.normalizeWritableAttributes({name: " Changed ", scannedAt: "2026-07-03T10:00:00.000Z"})

    expect(normalized.name).toEqual("Changed")
    expect(/** @type {Date} */ (normalized.scanned_at).toISOString()).toEqual("2026-07-03T10:00:00.000Z")
  })

  it("throws client-safe errors for schema validation failures on plain frontend-model resources", () => {
    class SchemaResource extends FrontendModelBaseResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      static writableAttributes = {
        name: {required: true, type: "string"}
      }
    }

    const resource = buildResource(SchemaResource, {})

    try {
      resource.normalizeWritableAttributes({name: "   "})
      throw new Error("Expected normalizeWritableAttributes to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.safeToExpose).toEqual(true)
      expect(error.code).toEqual("sync-name-required")
      expect(error.message).toEqual("name is required.")
    }
  })

  it("fails loudly when normalizing without a declared schema", () => {
    class SchemalessResource extends FrontendModelBaseResource {
    }

    const resource = buildResource(SchemalessResource, {})

    expect(() => resource.normalizeWritableAttributes({name: "x"})).toThrow(/must define static writableAttributes/u)
  })
})
