// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Ability from "../../src/authorization/ability.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Project from "../dummy/src/models/project.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncUuidItemResource from "../dummy/src/resources/sync-uuid-item-resource.js"
import Task from "../dummy/src/models/task.js"
import UuidItem from "../dummy/src/models/uuid-item.js"

const ACTOR_ID = "1f6e9a4c-2b3d-4e5f-8a9b-0c1d2e3f4a5b"

/**
 * Builds a routed replay service with a stubbed authenticated actor.
 * @param {Record<string, ?>} serviceArgs - Service constructor args.
 * @returns {SyncEnvelopeReplayService} Routed replay service.
 */
function buildService(serviceArgs) {
  class RoutedReplayService extends SyncEnvelopeReplayService {
    /** @returns {Promise<{authenticated: true, actor: {id: () => string}}>} Authenticated fake actor. */
    async authenticateReplay() {
      return {actor: {id: () => ACTOR_ID}, authenticated: true}
    }
  }

  return new RoutedReplayService(serviceArgs)
}

/**
 * Builds one update sync entry payload.
 * @param {object} args - Options.
 * @param {Record<string, ?>} args.data - Mutation data.
 * @param {string} args.id - Client sync id.
 * @param {string} args.resourceId - Resource id.
 * @param {string} [args.resourceType] - Resource type. Defaults to "UuidItem".
 * @param {string} [args.syncType] - Sync type. Defaults to "update".
 * @param {string} [args.clientUpdatedAt] - Client timestamp. Defaults to a fixed time.
 * @returns {Record<string, ?>} Raw sync entry.
 */
function buildSync({clientUpdatedAt = "2026-07-03T10:00:00.000Z", data, id, resourceId, resourceType = "UuidItem", syncType = "update"}) {
  return {clientUpdatedAt, data, id, resourceId, resourceType, syncType}
}

describe("sync envelope replay service - resource routed", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("routes mutations through resourceTypeOverrides resource classes", async () => {
    const uuidItem = await UuidItem.create({id: "0d9ee786-8524-4536-9d3d-8a0b4b3e5a01", title: "Before"})
    const service = buildService({resourceTypeOverrides: {UuidItem: SyncUuidItemResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "  After  "}, id: "aa11f0e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "aa11f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})

    const updatedUuidItem = await UuidItem.findByOrFail({id: uuidItem.id()})

    expect(updatedUuidItem.title()).toEqual("After")
  })

  it("routes mutations through the configuration frontend-model registry", async () => {
    const uuidItem = await UuidItem.create({id: "23c1a8b4-6d5e-4f7a-9b0c-1d2e3f4a5b6c", title: "Registry before"})
    const service = buildService({configuration: dummyConfiguration})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Registry after"}, id: "bb22f0e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "bb22f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Registry after")
  })

  it("resolves string overrides as registry aliases", async () => {
    const uuidItem = await UuidItem.create({id: "31d2b9c5-7e6f-4a8b-9c0d-2e3f4a5b6c7d", title: "Alias before"})
    const service = buildService({configuration: dummyConfiguration, resourceTypeOverrides: {LegacyItem: "UuidItem"}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Alias after"}, id: "cc33f0e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id()), resourceType: "LegacyItem"})]
    })

    expect(result).toEqual({syncs: [{id: "cc33f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Alias after")
  })

  it("fails unknown resource types per sync and continues the batch", async () => {
    const uuidItem = await UuidItem.create({id: "42e3c0d6-8f7a-4b9c-8d1e-3f4a5b6c7d8e", title: "Continue before"})
    const service = buildService({configuration: dummyConfiguration})
    const result = await service.replay({
      syncs: [
        buildSync({data: {title: "Nope"}, id: "dd44f0e2-1111-4222-8333-444455556666", resourceId: "53f4d1e7-9a8b-4c0d-9e2f-4a5b6c7d8e9f", resourceType: "Nope"}),
        buildSync({data: {title: "Continue after"}, id: "ee55f0e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})
      ]
    })

    expect(result.syncs).toHaveLength(2)
    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("unknown-resource-type")
    expect(result.syncs[1]).toEqual({id: "ee55f0e2-1111-4222-8333-444455556666", syncState: "successful"})
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Continue after")
  })

  it("creates missing records with the client-generated primary key by default", async () => {
    const service = buildService({resourceTypeOverrides: {UuidItem: SyncUuidItemResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Created"}, id: "ff66f0e2-1111-4222-8333-444455556666", resourceId: "64a5e2f8-0b9c-4d1e-8f3a-5b6c7d8e9f0a"})]
    })

    expect(result).toEqual({syncs: [{id: "ff66f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})

    const createdUuidItem = await UuidItem.findByOrFail({id: "64a5e2f8-0b9c-4d1e-8f3a-5b6c7d8e9f0a"})

    expect(createdUuidItem.title()).toEqual("Created")
  })

  it("skips missing records when syncMissingRecordBehavior is ignore", async () => {
    class IgnoreMissingResource extends SyncUuidItemResource {
      /** @returns {"create" | "ignore"} - Missing-record behavior. */
      syncMissingRecordBehavior() {
        return "ignore"
      }
    }

    const service = buildService({resourceTypeOverrides: {UuidItem: IgnoreMissingResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Ignored"}, id: "0177f0e2-1111-4222-8333-444455556666", resourceId: "75b6f3a9-1c0d-4e2f-9a4b-6c7d8e9f0a1b"})]
    })

    expect(result).toEqual({syncs: [{id: "0177f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect(await UuidItem.findBy({id: "75b6f3a9-1c0d-4e2f-9a4b-6c7d8e9f0a1b"})).toEqual(null)
  })

  it("scopes lookups through the resource ability and treats out-of-scope updates per missing-record behavior", async () => {
    class ScopedUuidItemResource extends SyncUuidItemResource {
      /** @returns {void} - Declares abilities. */
      abilities() {
        this.can("update", {title: "Accessible"})
      }

      /** @returns {"create" | "ignore"} - Missing-record behavior. */
      syncMissingRecordBehavior() {
        return "ignore"
      }
    }

    const blockedUuidItem = await UuidItem.create({id: "86c7a4b0-2d1e-4f3a-8b5c-7d8e9f0a1b2c", title: "Blocked"})
    const ability = new Ability({resources: [ScopedUuidItemResource]})
    const service = buildService({ability, resourceTypeOverrides: {UuidItem: ScopedUuidItemResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Hacked"}, id: "1288f0e2-1111-4222-8333-444455556666", resourceId: String(blockedUuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "1288f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: blockedUuidItem.id()})).title()).toEqual("Blocked")
  })

  it("destroys unauthorized creates and fails the sync with the resource-declared reason", async () => {
    class CreateDeniedResource extends SyncUuidItemResource {
      /** @returns {void} - Declares abilities. */
      abilities() {
        this.can("update", {title: "Accessible"})
      }

      /** @param {{action: "create" | "destroy" | "update", mutation: import("../../src/sync/sync-envelope-replay-service.js").SyncReplayMutation}} args - Denial args. @returns {string | null} - Failure reason. */
      syncAuthorizationFailureReason({action, mutation}) {
        void mutation

        return action == "create" ? "uuid-item-create-denied" : null
      }
    }

    const ability = new Ability({resources: [CreateDeniedResource]})
    const service = buildService({ability, resourceTypeOverrides: {UuidItem: CreateDeniedResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Denied"}, id: "2399f0e2-1111-4222-8333-444455556666", resourceId: "97d8b5c1-3e2f-4a4b-9c6d-8e9f0a1b2c3d"})]
    })

    expect(result.syncs).toHaveLength(1)
    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("uuid-item-create-denied")
    expect(await UuidItem.findBy({id: "97d8b5c1-3e2f-4a4b-9c6d-8e9f0a1b2c3d"})).toEqual(null)
  })

  it("fails syncs denied by authorizeSyncMutation with the custom reason and continues the batch", async () => {
    class AuthorizeDeniedResource extends SyncUuidItemResource {
      /** @param {{context: Record<string, ?>, mutation: import("../../src/sync/sync-envelope-replay-service.js").SyncReplayMutation}} args - Authorization args. @returns {{allowed: boolean, reason?: string}} - Authorization result. */
      authorizeSyncMutation({context, mutation}) {
        void context

        if (mutation.data.title == "Denied") return {allowed: false, reason: "custom-denied"}

        return {allowed: true}
      }
    }

    const service = buildService({resourceTypeOverrides: {UuidItem: AuthorizeDeniedResource}})
    const result = await service.replay({
      syncs: [
        buildSync({data: {title: "Denied"}, id: "34aaf0e2-1111-4222-8333-444455556666", resourceId: "a8e9c6d2-4f3a-4b5c-8d7e-9f0a1b2c3d4e"}),
        buildSync({data: {title: "Allowed"}, id: "45bbf0e2-1111-4222-8333-444455556666", resourceId: "b9f0d7e3-5a4b-4c6d-9e8f-0a1b2c3d4e5f"})
      ]
    })

    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("custom-denied")
    expect(result.syncs[1]).toEqual({id: "45bbf0e2-1111-4222-8333-444455556666", syncState: "successful"})
    expect(await UuidItem.findBy({id: "a8e9c6d2-4f3a-4b5c-8d7e-9f0a1b2c3d4e"})).toEqual(null)
    expect((await UuidItem.findByOrFail({id: "b9f0d7e3-5a4b-4c6d-9e8f-0a1b2c3d4e5f"})).title()).toEqual("Allowed")
  })

  it("fails schema validation errors per sync with their code and message and continues the batch", async () => {
    const service = buildService({resourceTypeOverrides: {UuidItem: SyncUuidItemResource}})
    const result = await service.replay({
      syncs: [
        buildSync({data: {title: "a".repeat(256)}, id: "56ccf0e2-1111-4222-8333-444455556666", resourceId: "c0a1e8f4-6b5c-4d7e-8f9a-1b2c3d4e5f6a"}),
        buildSync({data: {title: "Fine"}, id: "67ddf0e2-1111-4222-8333-444455556666", resourceId: "d1b2f9a5-7c6d-4e8f-9a0b-2c3d4e5f6a7b"})
      ]
    })

    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("sync-title-too-long")
    expect(result.syncs[0].message).toEqual("title is too long (maximum is 255 characters).")
    expect(result.syncs[1]).toEqual({id: "67ddf0e2-1111-4222-8333-444455556666", syncState: "successful"})
    expect(await UuidItem.findBy({id: "c0a1e8f4-6b5c-4d7e-8f9a-1b2c3d4e5f6a"})).toEqual(null)
  })

  it("fails model validation errors per sync with the translated validation message", async () => {
    class SyncTaskResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true> | null} */
      static writableAttributes = {name: true, projectId: true}
    }

    const project = await Project.create({name: "Routed validation project"})
    const task = await Task.create({name: "Valid name", projectId: project.id()})
    const service = buildService({resourceTypeOverrides: {Task: SyncTaskResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {name: ""}, id: "78eef0e2-1111-4222-8333-444455556666", resourceId: String(task.id()), resourceType: "Task"})]
    })

    expect(result.syncs[0].syncState).toEqual("failed")
    expect(result.syncs[0].reason).toEqual("validation-error")
    expect(result.syncs[0].message).toEqual("Name can't be blank")
    expect((await Task.findByOrFail({id: task.id()})).name()).toEqual("Valid name")
  })

  it("destroys records on delete mutations by default and ignores them when configured", async () => {
    const destroyedUuidItem = await UuidItem.create({id: "e2c3a0b6-8d7e-4f9a-8b1c-3d4e5f6a7b8c", title: "Destroyed"})
    const keptUuidItem = await UuidItem.create({id: "f3d4b1c7-9e8f-4a0b-9c2d-4e5f6a7b8c9d", title: "Kept"})

    class IgnoreDeleteResource extends SyncUuidItemResource {
      /** @returns {"destroy" | "ignore"} - Delete behavior. */
      syncDeleteBehavior() {
        return "ignore"
      }
    }

    const destroyService = buildService({resourceTypeOverrides: {UuidItem: SyncUuidItemResource}})
    const destroyResult = await destroyService.replay({
      syncs: [buildSync({data: {}, id: "89fff0e2-1111-4222-8333-444455556666", resourceId: String(destroyedUuidItem.id()), syncType: "delete"})]
    })

    expect(destroyResult).toEqual({syncs: [{id: "89fff0e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect(await UuidItem.findBy({id: destroyedUuidItem.id()})).toEqual(null)

    const ignoreService = buildService({resourceTypeOverrides: {UuidItem: IgnoreDeleteResource}})
    const ignoreResult = await ignoreService.replay({
      syncs: [buildSync({data: {}, id: "9a00f0e2-1111-4222-8333-444455556666", resourceId: String(keptUuidItem.id()), syncType: "delete"})]
    })

    expect(ignoreResult).toEqual({syncs: [{id: "9a00f0e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: keptUuidItem.id()})).title()).toEqual("Kept")
  })

  it("lets shouldApplySync force-skip fresh mutations", async () => {
    class ForceSkipResource extends SyncUuidItemResource {
      /** @param {{existingSync: import("../../src/database/record/index.js").default | null, mutation: import("../../src/sync/sync-envelope-replay-service.js").SyncReplayMutation}} args - Staleness args. @returns {boolean | null} - Whether to apply. */
      shouldApplySync({existingSync, mutation}) {
        void existingSync
        void mutation

        return false
      }
    }

    const uuidItem = await UuidItem.create({id: "a4e5c2d8-0f9a-4b1c-8d3e-5f6a7b8c9d0e", title: "Untouched"})
    const service = buildService({resourceTypeOverrides: {UuidItem: ForceSkipResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Touched"}, id: "ab11f1e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "ab11f1e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Untouched")
  })

  it("lets shouldApplySync force-apply mutations that are stale by timestamp", async () => {
    class ForceApplyResource extends SyncUuidItemResource {
      /** @param {{existingSync: import("../../src/database/record/index.js").default | null, mutation: import("../../src/sync/sync-envelope-replay-service.js").SyncReplayMutation}} args - Staleness args. @returns {boolean | null} - Whether to apply. */
      shouldApplySync({existingSync, mutation}) {
        void existingSync
        void mutation

        return true
      }
    }

    const uuidItem = await UuidItem.create({id: "b5f6d3e9-1a0b-4c2d-9e4f-6a7b8c9d0e1f", title: "Stale before"})

    await SyncEntry.create({
      authenticationTokenId: ACTOR_ID,
      clientUpdatedAt: new Date("2026-07-03T12:00:00.000Z"),
      data: `{"title":"Newer"}`,
      resourceId: String(uuidItem.id()),
      resourceType: "UuidItem",
      syncType: "update"
    })

    const service = buildService({resourceTypeOverrides: {UuidItem: ForceApplyResource}, syncModel: SyncEntry})
    const result = await service.replay({
      syncs: [buildSync({clientUpdatedAt: "2026-07-03T10:00:00.000Z", data: {title: "Forced"}, id: "bc22f1e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "bc22f1e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Forced")
  })

  it("merges afterSyncApply extras into the apply result for persistence and broadcasts", async () => {
    class ExtrasResource extends SyncUuidItemResource {
      /** @param {{context: Record<string, ?>, created: boolean, mutation: import("../../src/sync/sync-envelope-replay-service.js").SyncReplayMutation, record: import("../../src/database/record/index.js").default | null}} args - After-apply args. @returns {Record<string, ?>} - Extra apply-result entries. */
      afterSyncApply({context, created, mutation, record}) {
        void context
        void created
        void mutation
        void record

        return {extraNote: "extra-value"}
      }
    }

    const uuidItem = await UuidItem.create({id: "c6a7e4f0-2b1c-4d3e-8f5a-7b8c9d0e1f2a", title: "Extras before"})
    /** @type {Array<Record<string, ?>>} */
    const broadcastCalls = []
    /** @type {Array<Record<string, ?>>} */
    const persistExtraCalls = []

    const service = buildService({
      broadcaster: async (broadcast) => {
        broadcastCalls.push(broadcast)
      },
      broadcasts: [{
        body: (/** @type {Record<string, ?>} */ args) => ({extraNote: args.applyResult.extraNote, title: args.applyResult.record.title()}),
        broadcastParams: () => ({}),
        channel: "uuid-items"
      }],
      persistExtraAttributes: (/** @type {Record<string, ?>} */ args) => {
        persistExtraCalls.push(args)

        return {}
      },
      resourceTypeOverrides: {UuidItem: ExtrasResource},
      syncModel: SyncEntry
    })

    const result = await service.replay({
      syncs: [buildSync({data: {title: "Extras after"}, id: "cd33f1e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "cd33f1e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect(persistExtraCalls).toHaveLength(1)
    expect(persistExtraCalls[0].applyResult.extraNote).toEqual("extra-value")
    expect(broadcastCalls).toHaveLength(1)
    expect(broadcastCalls[0].body).toEqual({extraNote: "extra-value", title: "Extras after"})
  })

  it("keeps applyHandlers precedence over resource routing", async () => {
    const uuidItem = await UuidItem.create({id: "d7b8f5a1-3c2d-4e4f-9a6b-8c9d0e1f2a3b", title: "Handler before"})
    /** @type {Array<string>} */
    const handlerCalls = []

    const service = buildService({
      applyHandlers: {
        UuidItem: async (/** @type {Record<string, ?>} */ args) => {
          handlerCalls.push(args.mutation.resourceId)

          return {created: false, deleted: false, record: null}
        }
      },
      configuration: dummyConfiguration
    })

    const result = await service.replay({
      syncs: [buildSync({data: {title: "Handler after"}, id: "de44f1e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "de44f1e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect(handlerCalls).toEqual([String(uuidItem.id())])
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Handler before")
  })

  it("keeps the envelope resource id authoritative over a payload id on create", async () => {
    class SnapshotUuidItemResource extends SyncUuidItemResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true> | null} */
      static writableAttributes = {id: true, title: true}
    }

    const service = buildService({resourceTypeOverrides: {UuidItem: SnapshotUuidItemResource}})
    const result = await service.replay({
      syncs: [buildSync({
        data: {id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e", title: "Snapshot created"},
        id: "f0a1b2c3-1111-4222-8333-444455556666",
        resourceId: "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e"
      })]
    })

    expect(result).toEqual({syncs: [{id: "f0a1b2c3-1111-4222-8333-444455556666", syncState: "successful"}]})

    const createdUuidItem = await UuidItem.findByOrFail({id: "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e"})

    expect(createdUuidItem.title()).toEqual("Snapshot created")
    expect(await UuidItem.findBy({id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e"})).toEqual(null)
  })

  it("keeps the envelope resource id authoritative over a payload id on update", async () => {
    class SnapshotUuidItemResource extends SyncUuidItemResource {
      /** @type {Record<string, import("../../src/sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true> | null} */
      static writableAttributes = {id: true, title: true}
    }

    const targetUuidItem = await UuidItem.create({id: "8c7d6e5f-4a3b-4c2d-9e1f-0a9b8c7d6e5f", title: "Snapshot before"})
    const service = buildService({resourceTypeOverrides: {UuidItem: SnapshotUuidItemResource}})
    const result = await service.replay({
      syncs: [buildSync({
        data: {id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", title: "Snapshot after"},
        id: "e1b2c3d4-1111-4222-8333-444455556666",
        resourceId: String(targetUuidItem.id())
      })]
    })

    expect(result).toEqual({syncs: [{id: "e1b2c3d4-1111-4222-8333-444455556666", syncState: "successful"}]})

    const updatedUuidItem = await UuidItem.findByOrFail({id: targetUuidItem.id()})

    expect(updatedUuidItem.title()).toEqual("Snapshot after")
    expect(await UuidItem.findBy({id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e"})).toEqual(null)
  })

  it("lets applySync fully replace the default routed apply flow", async () => {
    class CustomApplyResource extends SyncUuidItemResource {
      /** @param {import("../../src/frontend-model-resource/base-resource.js").FrontendModelApplySyncArgs} args - Apply args. @returns {import("../../src/frontend-model-resource/base-resource.js").FrontendModelSyncApplyResult} - Apply result. */
      applySync(args) {
        void args

        return {created: false, deleted: false, record: null}
      }
    }

    const uuidItem = await UuidItem.create({id: "e8c9a6b2-4d3e-4f5a-8b7c-9d0e1f2a3b4c", title: "Custom before"})
    const service = buildService({resourceTypeOverrides: {UuidItem: CustomApplyResource}})
    const result = await service.replay({
      syncs: [buildSync({data: {title: "Custom after"}, id: "ef55f1e2-1111-4222-8333-444455556666", resourceId: String(uuidItem.id())})]
    })

    expect(result).toEqual({syncs: [{id: "ef55f1e2-1111-4222-8333-444455556666", syncState: "successful"}]})
    expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Custom before")
  })
})
