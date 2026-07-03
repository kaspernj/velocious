// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import VelociousError from "../../src/velocious-error.js"

/** Inline resource declaring a writable-attribute schema for the dummy Task model. */
class TaskSchemaResource extends FrontendModelBaseResource {
  static ModelClass = Task

  /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
  static writableAttributes = {
    description: {type: "string"},
    isDone: {type: "boolean"},
    localNote: {type: "ignored"},
    name: {maxLength: 255, required: true, type: "string"},
    projectId: {type: "raw"}
  }
}

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

  it("derives permittedParams from the declared schema including ignored entries", () => {
    const resource = buildResource(TaskSchemaResource, {})

    expect(resource.permittedParams()).toEqual(["description", "isDone", "localNote", "name", "projectId"])
  })

  it("keeps the empty permit default without a declared schema", () => {
    class SchemalessResource extends FrontendModelBaseResource {
    }

    const resource = buildResource(SchemalessResource, {})

    expect(resource.permittedParams()).toEqual([])
  })

  it("lets an explicit permittedParams override win over schema derivation", () => {
    class PinnedPermitResource extends TaskSchemaResource {
      /** @returns {string[]} - Permit spec. */
      permittedParams() {
        return ["name", "projectId"]
      }
    }

    const resource = buildResource(PinnedPermitResource, {})

    expect(resource.permittedParams()).toEqual(["name", "projectId"])
  })
})

describe("frontend model writable attributes permit bridge - resource mutations", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("normalizes create attributes through the declared schema and drops ignored keys", async () => {
    const project = await Project.create({name: "Bridge project"})
    const resource = new TaskSchemaResource({})
    const task = await resource.create({
      isDone: 1,
      localNote: "device-only",
      name: "  Bridge task  ",
      projectId: project.id()
    })

    expect(task.name()).toEqual("Bridge task")
    expect(task.isDone()).toEqual(true)

    const persistedTask = await Task.findByOrFail({id: task.id()})

    expect(persistedTask.name()).toEqual("Bridge task")
  })

  it("normalizes update attributes through the declared schema", async () => {
    const project = await Project.create({name: "Bridge update project"})
    const task = await Task.create({name: "Before", projectId: project.id()})
    const resource = new TaskSchemaResource({})

    await resource.update(task, {description: " Updated description ", name: "  After  "})

    const persistedTask = await Task.findByOrFail({id: task.id()})

    expect(persistedTask.name()).toEqual("After")
    expect(persistedTask.description()).toEqual("Updated description")
  })

  it("rejects unknown attributes with a client-safe error before any write", async () => {
    const project = await Project.create({name: "Bridge unknown project"})
    const resource = new TaskSchemaResource({})

    try {
      await resource.create({evil: "y", name: "Nope", projectId: project.id()})
      throw new Error("Expected create to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.safeToExpose).toEqual(true)
      expect(error.code).toEqual("sync-unknown-attribute")
    }

    expect(await Task.where({name: "Nope"}).toArray()).toHaveLength(0)
  })

  it("rejects schema validation failures with a client-safe error before any write", async () => {
    const project = await Project.create({name: "Bridge invalid project"})
    const resource = new TaskSchemaResource({})

    try {
      await resource.create({name: "   ", projectId: project.id()})
      throw new Error("Expected create to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.safeToExpose).toEqual(true)
      expect(error.code).toEqual("sync-name-required")
    }
  })

  it("enforces an explicit permittedParams override over the schema-derived permit", async () => {
    class PinnedPermitResource extends TaskSchemaResource {
      /** @returns {string[]} - Permit spec. */
      permittedParams() {
        return ["name", "projectId"]
      }
    }

    const project = await Project.create({name: "Bridge pinned project"})
    const resource = new PinnedPermitResource({})

    await expect(async () => await resource.create({description: "Not permitted", name: "Pinned", projectId: project.id()}))
      .toThrow(/not permitted by permittedParams/u)
  })

  it("keeps passthrough normalization without a declared schema", async () => {
    class SchemalessTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @returns {string[]} - Permit spec. */
      permittedParams() {
        return ["name", "projectId"]
      }
    }

    const project = await Project.create({name: "Bridge passthrough project"})
    const resource = new SchemalessTaskResource({})
    const task = await resource.create({name: "  Untrimmed  ", projectId: project.id()})

    expect(task.name()).toEqual("  Untrimmed  ")
  })
})
