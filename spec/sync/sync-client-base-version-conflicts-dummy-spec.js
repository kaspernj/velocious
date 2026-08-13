// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel} from "./sync-client-fakes.js"
import {buildMutationLog, conflictTracking} from "../helpers/sync-client-conflict-tracking-helper.js"
import SyncClient from "../../src/sync/sync-client.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncUuidItemResource from "../dummy/src/resources/sync-uuid-item-resource.js"
import UuidItem from "../dummy/src/models/uuid-item.js"

const ACTOR_ID = "1f6e9a4c-2b3d-4e5f-8a9b-0c1d2e3f4a5b"

/** @returns {SyncEnvelopeReplayService} Resource-routed replay service. */
function replayService({persistSerializedData, syncModel} = {}) {
  class TestReplayService extends SyncEnvelopeReplayService {
    /** @returns {Promise<{actor: {id: () => string}, authenticated: true}>} Test actor. */
    async authenticateReplay() {
      return {actor: {id: () => ACTOR_ID}, authenticated: true}
    }
  }

  return new TestReplayService({
    conflictStrategy: {strategy: "serverWins", versionAttribute: "updatedAt"},
    persistSerializedData,
    resourceTypeOverrides: {UuidItem: SyncUuidItemResource},
    syncModel
  })
}

/** @param {string[]} ids - Mutation ids. @returns {ReturnType<typeof JSON.parse>} Harness. */
function harness(ids) {
  const mutationLog = buildMutationLog(ids)
  const originalSync = UuidItem.sync
  let online = false
  const service = replayService()

  UuidItem.sync = {...originalSync, conflictTracking: conflictTracking(mutationLog, ids)}

  const configuration = buildConfiguration({
    modelClasses: [UuidItem],
    sync: {client: {
      authenticationToken: () => "token-1",
      isOnline: () => online,
      transport: {post: async (_path, payload) => ({json: async () => await service.replay(payload)})}
    }}
  })

  return {
    client: new SyncClient({configuration, syncModel: buildFakeSyncModel()}),
    mutationLog,
    restore: () => { UuidItem.sync = originalSync },
    setOnline: () => { online = true }
  }
}

describe("sync client base-version conflicts - dummy integration", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("captures each automatic same-record update base before one transaction commits", async () => {
    const test = harness(["mutation-1", "mutation-2"])
    const item = await UuidItem.create({id: "38a7f6e5-d4c3-412b-8a9f-7e6d5c4b3a29", title: "base"})
    const originalBase = item.updatedAt().toISOString()

    try {
      await test.client.start()
      await UuidItem.transaction(async () => {
        item.assign({title: "first", updatedAt: "2026-08-12T09:10:00.000Z"})
        await item.save()
        item.assign({title: "second", updatedAt: "2026-08-12T09:20:00.000Z"})
        await item.save()

        expect(await test.mutationLog.records()).toEqual([])
      })

      const records = await test.mutationLog.records()

      expect(records.map((record) => record.mutation.baseVersion)).toEqual([
        originalBase,
        "2026-08-12T09:10:00.000Z"
      ])
      expect(records[1].dependencies).toEqual([{clientMutationId: "mutation-1", model: "UuidItem"}])
    } finally {
      test.client.stop()
      test.restore()
    }
  })

  it("rebases and applies a successor after a real persisted duplicate replay", async () => {
    const ids = ["mutation-1", "mutation-2"]
    const mutationLog = buildMutationLog(ids)
    const originalSync = UuidItem.sync
    const service = replayService({syncModel: SyncEntry})
    const responses = []
    let loseFirstResponse = true
    let online = false
    let mutationTime = 0
    const tracking = conflictTracking(mutationLog, ids)

    tracking.now = () => new Date(`2026-08-12T09:00:0${mutationTime++}.000Z`)
    UuidItem.sync = {...originalSync, conflictTracking: tracking}

    const configuration = buildConfiguration({
      modelClasses: [UuidItem],
      sync: {client: {
        authenticationToken: () => "token-1",
        isOnline: () => online,
        transport: {post: async (_path, payload) => {
          const response = await service.replay(payload)

          responses.push(response)
          if (loseFirstResponse) {
            loseFirstResponse = false
            throw new Error("response lost after persistence")
          }

          return {json: () => response}
        }}
      }}
    })
    const client = new SyncClient({configuration, syncModel: buildFakeSyncModel()})
    const item = await UuidItem.create({id: "49b8a7f6-e5d4-423c-9b0a-8f7e6d5c4b3a", title: "base"})
    const baseVersion = item.updatedAt().toISOString()

    try {
      await client.queue({baseVersion, data: {title: "first"}, operation: "update", resource: item})
      await client.queue({baseVersion, data: {title: "second"}, operation: "update", resource: item})
      online = true

      await expect(async () => await client.replayPending()).toThrow("response lost after persistence")
      await client.replayPending()

      const records = await mutationLog.records()

      expect(responses[1].syncs[0].syncState).toEqual("duplicate")
      expect(responses[1].syncs[0].serverVersion).toEqual(records[0].syncResult?.serverVersion)
      expect(records.map((record) => record.status)).toEqual(["synced", "synced"])
      expect(records[1].mutation.baseVersion).toEqual(records[0].syncResult?.serverVersion)
      expect((await UuidItem.findByOrFail({id: item.id()})).title()).toEqual("second")
    } finally {
      UuidItem.sync = originalSync
    }
  })

  it("keeps the original duplicate acknowledgement across snapshots and an intervening server write", async () => {
    const ids = ["mutation-1", "mutation-2"]
    const mutationLog = buildMutationLog(ids)
    const originalSync = UuidItem.sync
    const service = replayService({
      persistSerializedData: ({applyResult}) => ({id: applyResult.record.id(), title: applyResult.record.title()}),
      syncModel: SyncEntry
    })
    const responses = []
    let requestCount = 0
    let online = false
    const tracking = conflictTracking(mutationLog, ids)

    tracking.now = () => new Date("2026-08-12T09:00:00.000Z")
    UuidItem.sync = {...originalSync, conflictTracking: tracking}

    const item = await UuidItem.create({id: "5ac9b8a7-f6e5-434d-ac1b-9f8e7d6c5b4a", title: "base"})
    const originalBase = item.updatedAt().toISOString()
    const configuration = buildConfiguration({
      modelClasses: [UuidItem],
      sync: {client: {
        authenticationToken: () => "token-1",
        isOnline: () => online,
        transport: {post: async (_path, payload) => {
          requestCount += 1

          if (requestCount === 2) {
            const remote = await UuidItem.findByOrFail({id: item.id()})

            remote.assign({title: "remote", updatedAt: "2026-08-12T09:30:00.000Z"})
            await remote.save()
          }

          const response = await service.replay(payload)

          responses.push(response)
          if (requestCount === 1) throw new Error("response lost after persistence")

          return {json: () => response}
        }}
      }}
    })
    const client = new SyncClient({configuration, syncModel: buildFakeSyncModel()})

    try {
      await client.queue({baseVersion: originalBase, data: {title: "first"}, operation: "update", resource: item})
      await client.queue({baseVersion: originalBase, data: {title: "second"}, operation: "update", resource: item})
      online = true

      await expect(async () => await client.replayPending()).toThrow("response lost after persistence")
      await client.replayPending()

      const records = await mutationLog.records()

      expect(responses[1].syncs[0]).toEqual({
        id: "mutation-1",
        serverVersion: responses[0].syncs[0].serverVersion,
        syncState: "duplicate"
      })
      expect(records[1].mutation.baseVersion).toEqual(responses[0].syncs[0].serverVersion)
      expect(records[1].status).toEqual("conflict")
      expect((await UuidItem.findByOrFail({id: item.id()})).title()).toEqual("remote")
    } finally {
      UuidItem.sync = originalSync
    }
  })

  it("returns the real saved version and rebases an ordered successor", async () => {
    const test = harness(["mutation-1", "mutation-2"])
    const item = await UuidItem.create({id: "27f6e5d4-c3b2-401a-9f8e-7d6c5b4a3928", title: "base"})
    const baseVersion = item.updatedAt().toISOString()

    try {
      await test.client.queue({baseVersion, data: {title: "first"}, operation: "update", resource: item})
      await test.client.queue({baseVersion, data: {title: "second"}, operation: "update", resource: item})
      test.setOnline()
      await test.client.replayPending()

      const records = await test.mutationLog.records()

      expect(records.map((record) => record.status)).toEqual(["synced", "synced"])
      expect(records[1].mutation.baseVersion).toEqual(records[0].syncResult?.serverVersion)
      expect((await UuidItem.findByOrFail({id: item.id()})).title()).toEqual("second")
    } finally {
      test.restore()
    }
  })

  it("keeps a stale update durable and leaves the real authoritative row unchanged", async () => {
    const test = harness(["mutation-1"])
    const item = await UuidItem.create({id: "05d4c3b2-a190-4e8f-9d7c-6b5a49382716", title: "base"})
    const baseVersion = item.updatedAt().toISOString()

    try {
      item.assign({title: "server", updatedAt: "2026-08-12T09:30:00.000Z"})
      await item.save()
      await test.client.queue({baseVersion, data: {title: "local"}, operation: "update", resource: item})
      test.setOnline()
      await test.client.replayPending()

      expect((await UuidItem.findByOrFail({id: item.id()})).title()).toEqual("server")
      expect((await test.mutationLog.records())[0].status).toEqual("conflict")
    } finally {
      test.restore()
    }
  })

  it("keeps a stale delete durable and does not delete the real authoritative row", async () => {
    const test = harness(["mutation-1"])
    const item = await UuidItem.create({id: "16e5d4c3-b2a1-4f90-8e7d-6c5b4a392817", title: "base"})
    const baseVersion = item.updatedAt().toISOString()

    try {
      item.assign({title: "server", updatedAt: "2026-08-12T09:30:00.000Z"})
      await item.save()
      await test.client.queue({baseVersion, data: {}, operation: "destroy", resource: item})
      test.setOnline()
      await test.client.replayPending()

      expect(await UuidItem.findBy({id: item.id()})).not.toEqual(null)
      expect((await test.mutationLog.records())[0].status).toEqual("conflict")
    } finally {
      test.restore()
    }
  })
})
