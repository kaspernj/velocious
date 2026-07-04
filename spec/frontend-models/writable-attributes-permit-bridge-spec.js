// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import Ability from "../../src/authorization/ability.js"
import UuidItem from "../dummy/src/models/uuid-item.js"
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
      static ModelClass = /** @type {?} */ ({getAttributeNameToColumnNameMap: () => ({name: "name", scannedAt: "scanned_at"})})

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
      static writableAttributes = {
        name: {maxLength: 255, required: true, type: "string"},
        scannedAt: {type: "date"}
      }
    }

    const resource = buildResource(SchemaResource, {})
    const normalized = resource.normalizeWritableAttributes({name: " Changed ", scanned_at: "2026-07-03T10:00:00.000Z"})

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
      expect(error.message).toEqual("name can't be blank.")
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

  it("fails loudly when a true entry cannot be inferred without a model class", () => {
    class NoModelInferenceResource extends FrontendModelBaseResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {name: true}
    }

    const resource = buildResource(NoModelInferenceResource, {})

    expect(() => resource.resolvedWritableAttributes()).toThrow(/Cannot infer writable attribute/u)
  })

  it("honors a writableAttributes schema declared on the shared resource", () => {
    class SharedSchemaResource extends FrontendModelBaseResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {
        createdAt: {column: "created_at", required: false, type: "date"},
        name: {maxLength: 255, required: true, type: "string"}
      }
    }

    class EnvironmentResource extends FrontendModelBaseResource {
      static ModelClass = Task
      static SharedResource = SharedSchemaResource
    }

    const resource = new EnvironmentResource({modelName: "Task", params: {}})

    expect(resource.permittedParams()).toEqual(["createdAt", "name"])

    const normalized = resource.normalizeWritableAttributes({created_at: "2026-07-03T10:00:00.000Z", name: " Shared "})

    expect(normalized.name).toEqual("Shared")
    expect(/** @type {Date} */ (normalized.created_at).toISOString()).toEqual("2026-07-03T10:00:00.000Z")
  })

  it("lets an environment schema win over the shared resource schema", () => {
    class SharedSchemaResource extends FrontendModelBaseResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {name: {type: "string"}}
    }

    class EnvironmentResource extends FrontendModelBaseResource {
      static ModelClass = Task
      static SharedResource = SharedSchemaResource

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {title: {type: "string"}}
    }

    const resource = new EnvironmentResource({modelName: "Task", params: {}})

    expect(resource.permittedParams()).toEqual(["title"])
  })
})

describe("frontend model writable attributes column inference", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("infers type, maxLength and required from the model's column metadata for true entries", () => {
    class InferredTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {
        description: true,
        isDone: true,
        name: true,
        projectId: true
      }
    }

    const resource = new InferredTaskResource({})
    const resolvedSchema = resource.resolvedWritableAttributes()

    if (!resolvedSchema) throw new Error("Expected a resolved schema")

    expect(resolvedSchema.name).toEqual({maxLength: 255, required: false, type: "string"})
    expect(resolvedSchema.description).toEqual({required: false, type: "string"})
    expect(resolvedSchema.isDone).toEqual({required: false, type: "boolean"})
    expect(resolvedSchema.projectId).toEqual({required: true, type: "integer"})
  })

  it("infers uuid and date types from uuid and datetime columns", () => {
    class InferredUuidItemResource extends FrontendModelBaseResource {
      static ModelClass = UuidItem

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {
        createdAt: true,
        id: true,
        title: true
      }
    }

    const resource = new InferredUuidItemResource({})
    const resolvedSchema = resource.resolvedWritableAttributes()

    if (!resolvedSchema) throw new Error("Expected a resolved schema")

    // The primary key is never inferred as required: the framework guarantees
    // a value on every driver (PG/MSSQL via a database default, sqlite/mysql
    // via record-level UUID assignment), so driver-divergent column defaults
    // must not make inference driver-divergent.
    expect(resolvedSchema.id).toEqual({required: false, type: "uuid"})
    expect(resolvedSchema.createdAt).toEqual({required: false, type: "date"})
    expect(resolvedSchema.title).toEqual({maxLength: 255, required: false, type: "string"})
  })

  it("lets explicit entry fields override inferred ones on partial entries", () => {
    class PartialEntryTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {
        description: {type: "raw"},
        name: {trim: false},
        projectId: {required: false}
      }
    }

    const resource = new PartialEntryTaskResource({})
    const resolvedSchema = resource.resolvedWritableAttributes()

    if (!resolvedSchema) throw new Error("Expected a resolved schema")

    expect(resolvedSchema.name).toEqual({maxLength: 255, required: false, trim: false, type: "string"})
    expect(resolvedSchema.description).toEqual({type: "raw"})
    expect(resolvedSchema.projectId).toEqual({required: false, type: "integer"})
  })

  it("normalizes writes through the inferred schema", async () => {
    class InferredTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {
        isDone: true,
        name: true,
        projectId: true
      }
    }

    const project = await Project.create({name: "Inference project"})
    const resource = new InferredTaskResource({})
    const task = await resource.create({isDone: 1, name: "  Inferred  ", projectId: project.id()})

    expect(task.name()).toEqual("Inferred")
    expect(task.isDone()).toEqual(true)

    try {
      await resource.create({name: "a".repeat(256), projectId: project.id()})
      throw new Error("Expected create to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.code).toEqual("sync-name-too-long")
    }
  })

  it("fails loudly for true entries without a matching column", () => {
    class MissingColumnTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true>} */
      static writableAttributes = {nonexistentColumn: true}
    }

    const resource = new MissingColumnTaskResource({})

    expect(() => resource.resolvedWritableAttributes()).toThrow(/Cannot infer writable attribute/u)
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

/** @type {import("../../src/sync/sync-envelope-replay-service.js").SyncReplayMutation} */
const hookMutation = {
  clientUpdatedAt: new Date("2026-07-03T10:00:00.000Z"),
  data: {title: "Changed"},
  id: "b39d5be2-58b3-4c8f-9a41-7f3d2e5c8a10",
  resourceId: "0d9ee786-8524-4536-9d3d-8a0b4b3e5a01",
  resourceType: "UuidItem",
  serializedData: `{"title":"Changed"}`,
  syncType: "update"
}

describe("frontend model sync hooks", () => {
  it("provides permissive defaults for the sync replay hooks", async () => {
    const resource = buildResource(TaskSchemaResource, {})

    expect(await resource.authorizeSyncMutation({context: {}, mutation: hookMutation})).toEqual({allowed: true})
    expect(resource.syncAuthorizationFailureReason({action: "create", mutation: hookMutation})).toEqual(null)
    expect(resource.syncDeleteBehavior()).toEqual("destroy")
    expect(resource.syncMissingRecordBehavior()).toEqual("create")
    expect(await resource.shouldApplySync({existingSync: null, mutation: hookMutation})).toEqual(null)
    expect(await resource.applySync({context: {}, existingSync: null, mutation: hookMutation})).toEqual(null)
    expect(await resource.afterSyncApply({context: {}, created: false, mutation: hookMutation, record: null})).toEqual({})
  })

  it("returns the resolved writable-attribute schema from syncWritableAttributes", () => {
    const resource = buildResource(TaskSchemaResource, {})

    expect(resource.syncWritableAttributes()).toEqual(resource.resolvedWritableAttributes())
    expect(resource.syncWritableAttributes()?.name).toEqual({maxLength: 255, required: true, type: "string"})

    class SchemalessResource extends FrontendModelBaseResource {
    }

    expect(buildResource(SchemalessResource, {}).syncWritableAttributes()).toEqual(null)
  })
})

describe("frontend model sync hooks - findSyncRecord", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  class SyncFindUuidItemResource extends FrontendModelBaseResource {
    static ModelClass = UuidItem
    static attributes = ["id", "title"]

    /** @returns {void} - Declares abilities. */
    abilities() {
      this.can("update", {title: "Accessible"})
      this.can("destroy", {title: "Deletable"})
    }
  }

  it("finds records through the update accessibleFor scope by default", async () => {
    const accessibleUuidItem = await UuidItem.create({id: "0d9ee786-8524-4536-9d3d-8a0b4b3e5a01", title: "Accessible"})
    const blockedUuidItem = await UuidItem.create({id: "9d3adf10-63f2-4a08-8f2a-2b4c6d8e0f12", title: "Blocked"})
    const ability = new Ability({resources: [SyncFindUuidItemResource]})
    const resource = new SyncFindUuidItemResource({ability})
    const foundUuidItem = await resource.findSyncRecord({mutation: {...hookMutation, resourceId: String(accessibleUuidItem.id())}})

    if (!foundUuidItem) throw new Error("Expected the accessible record to be found")

    expect(foundUuidItem.id()).toEqual(accessibleUuidItem.id())

    expect(await resource.findSyncRecord({mutation: {...hookMutation, resourceId: String(blockedUuidItem.id())}})).toEqual(null)
  })

  it("uses the destroy scope for delete lookups", async () => {
    const deletableUuidItem = await UuidItem.create({id: "417cf6c8-9a3b-4f0e-8a4d-5e6f7a8b9c0d", title: "Deletable"})
    const updatableUuidItem = await UuidItem.create({id: "88f0a1b2-c3d4-4e5f-9a6b-7c8d9e0f1a2b", title: "Accessible"})
    const ability = new Ability({resources: [SyncFindUuidItemResource]})
    const resource = new SyncFindUuidItemResource({ability})
    const foundUuidItem = await resource.findSyncRecord({forDelete: true, mutation: {...hookMutation, resourceId: String(deletableUuidItem.id())}})

    if (!foundUuidItem) throw new Error("Expected the deletable record to be found")

    expect(foundUuidItem.id()).toEqual(deletableUuidItem.id())

    expect(await resource.findSyncRecord({forDelete: true, mutation: {...hookMutation, resourceId: String(updatableUuidItem.id())}})).toEqual(null)
  })

  it("falls back to an unscoped lookup without an ability", async () => {
    const anyUuidItem = await UuidItem.create({id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", title: "Blocked"})
    const resource = new SyncFindUuidItemResource({})
    const foundUuidItem = await resource.findSyncRecord({mutation: {...hookMutation, resourceId: String(anyUuidItem.id())}})

    if (!foundUuidItem) throw new Error("Expected the record to be found without an ability")

    expect(foundUuidItem.id()).toEqual(anyUuidItem.id())
  })
})
