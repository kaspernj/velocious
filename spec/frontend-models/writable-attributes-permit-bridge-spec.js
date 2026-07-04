// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Ability from "../../src/authorization/ability.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import UuidItem from "../dummy/src/models/uuid-item.js"

/** Inline resource declaring a writable-attribute permit list for the dummy Task model. */
class TaskPermitResource extends FrontendModelBaseResource {
  static ModelClass = Task

  /** @type {string[]} */
  static writableAttributes = ["description", "isDone", "name", "projectId"]
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
  it("uses the declared writableAttributes list as the default permit", () => {
    const resource = buildResource(TaskPermitResource, {})

    expect(resource.permittedParams()).toEqual(["description", "isDone", "name", "projectId"])
  })

  it("keeps the empty permit default without a declared list", () => {
    class ListlessResource extends FrontendModelBaseResource {
    }

    const resource = buildResource(ListlessResource, {})

    expect(resource.permittedParams()).toEqual([])
  })

  it("lets an explicit permittedParams override win over the declared list", () => {
    class PinnedPermitResource extends TaskPermitResource {
      /** @returns {string[]} - Permit spec. */
      permittedParams() {
        return ["name", "projectId"]
      }
    }

    const resource = buildResource(PinnedPermitResource, {})

    expect(resource.permittedParams()).toEqual(["name", "projectId"])
  })

  it("honors a writableAttributes list declared on the shared resource", () => {
    class SharedPermitResource extends FrontendModelBaseResource {
      /** @type {string[]} */
      static writableAttributes = ["name", "scannedAt"]
    }

    class EnvironmentResource extends FrontendModelBaseResource {
      static ModelClass = Task
      static SharedResource = SharedPermitResource
    }

    const resource = new EnvironmentResource({modelName: "Task", params: {}})

    expect(resource.permittedParams()).toEqual(["name", "scannedAt"])
  })

  it("lets an environment list win over the shared resource list", () => {
    class SharedPermitResource extends FrontendModelBaseResource {
      /** @type {string[]} */
      static writableAttributes = ["name"]
    }

    class EnvironmentResource extends FrontendModelBaseResource {
      static ModelClass = Task
      static SharedResource = SharedPermitResource

      /** @type {string[]} */
      static writableAttributes = ["title"]
    }

    const resource = new EnvironmentResource({modelName: "Task", params: {}})

    expect(resource.permittedParams()).toEqual(["title"])
  })
})

describe("frontend model writable attributes permit bridge - resource mutations", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("permits creates and updates through the declared list", async () => {
    const project = await Project.create({name: "Bridge project"})
    const resource = new TaskPermitResource({})
    const task = await resource.create({
      isDone: true,
      name: "Bridge task",
      projectId: project.id()
    })

    expect(task.name()).toEqual("Bridge task")
    expect(task.isDone()).toEqual(true)

    await resource.update(task, {description: "Updated description", name: "After"})

    const persistedTask = await Task.findByOrFail({id: task.id()})

    expect(persistedTask.name()).toEqual("After")
    expect(persistedTask.description()).toEqual("Updated description")
  })

  it("rejects attributes outside the declared list before any write", async () => {
    const project = await Project.create({name: "Bridge unknown project"})
    const resource = new TaskPermitResource({})

    await expect(async () => await resource.create({evil: "y", name: "Nope", projectId: project.id()}))
      .toThrow(/not permitted by permittedParams/u)

    expect(await Task.where({name: "Nope"}).toArray()).toHaveLength(0)
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
    const resource = buildResource(TaskPermitResource, {})

    expect(await resource.authorizeSyncMutation({context: {}, mutation: hookMutation})).toEqual({allowed: true})
    expect(resource.syncAuthorizationFailureReason({action: "create", mutation: hookMutation})).toEqual(null)
    expect(await resource.applySync({context: {}, existingSync: null, mutation: hookMutation})).toEqual(null)
    expect(await resource.afterSyncApply({context: {}, created: false, mutation: hookMutation, record: null})).toEqual({})
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
