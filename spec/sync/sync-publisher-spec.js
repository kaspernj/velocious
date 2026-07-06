// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {markServerApply, withoutPublishing} from "../../src/sync/sync-publish-suppression.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncPublisher from "../../src/sync/sync-publisher.js"
import SyncUuidItemResource from "../dummy/src/resources/sync-uuid-item-resource.js"
import UuidItem from "../dummy/src/models/uuid-item.js"

const REPLAY_ACTOR_ID = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"

/**
 * Builds a routed replay service persisting through the real SyncEntry model
 * with a stubbed authenticated actor.
 * @returns {SyncEnvelopeReplayService} Routed replay service.
 */
function buildRoutedReplayService() {
  class RoutedReplayService extends SyncEnvelopeReplayService {
    /** @returns {Promise<{authenticated: true, actor: {id: () => string}}>} Authenticated fake actor. */
    async authenticateReplay() {
      return {actor: {id: () => REPLAY_ACTOR_ID}, authenticated: true}
    }
  }

  return new RoutedReplayService({resourceTypeOverrides: {UuidItem: SyncUuidItemResource}, syncModel: SyncEntry})
}

/**
 * Builds a started-publisher harness watching the real dummy UuidItem model with
 * the real SyncEntry sync model and a recording broadcaster. The publish
 * declaration is assigned onto UuidItem's static sync for the duration of the
 * test and restored by the returned restore callback.
 * @param {{broadcaster?: (broadcast: {body: ?, channel: string, params: Record<string, ?>}) => Promise<void>, publish?: Record<string, ?>}} [args] - Broadcaster and publish declaration overrides.
 * @returns {{broadcasts: Array<{body: ?, channel: string, params: Record<string, ?>}>, errors: Error[], publisher: SyncPublisher, restore: () => void}} Publish harness.
 */
function buildUuidItemPublishHarness({broadcaster, publish} = {}) {
  /** @type {Array<{body: ?, channel: string, params: Record<string, ?>}>} */
  const broadcasts = []
  /** @type {Error[]} */
  const errors = []
  const originalSync = UuidItem.sync

  UuidItem.sync = {
    .../** @type {Record<string, ?>} */ (originalSync),
    publish: publish || {
      broadcasts: [{
        body: (/** @type {import("../../src/sync/sync-publisher-types.js").SyncPublishBroadcastArgs} */ args) => ({data: args.data, syncType: args.syncType}),
        broadcastParams: (/** @type {import("../../src/sync/sync-publisher-types.js").SyncPublishBroadcastArgs} */ args) => ({resourceId: args.resourceId}),
        channel: "uuid-items"
      }],
      serialize: (/** @type {UuidItem} */ uuidItem) => ({id: uuidItem.id(), title: uuidItem.title()})
    }
  }

  const publisher = new SyncPublisher({
    broadcaster: broadcaster || (async (broadcast) => {
      broadcasts.push(broadcast)
    }),
    configuration: dummyConfiguration,
    onError: (error) => {
      errors.push(error)
    },
    syncModel: SyncEntry
  })

  return {
    broadcasts,
    errors,
    publisher,
    restore: () => {
      publisher.stop()
      UuidItem.sync = originalSync
    }
  }
}

describe("sync publisher", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("publishes committed server-side creates and updates to the sync feed and broadcasts", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness()

    await publisher.start()

    try {
      const uuidItem = await UuidItem.create({id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c", title: "Pin 111111"})
      const createdRows = await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(createdRows).toHaveLength(1)
      expect(createdRows[0].authenticationTokenId()).toEqual(null)
      expect(createdRows[0].syncType()).toEqual("update")
      expect(JSON.parse(createdRows[0].data()).title).toEqual("Pin 111111")

      const createdServerSequence = createdRows[0].serverSequence()

      await uuidItem.update({title: "Pin 222222"})

      const updatedRows = await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(updatedRows).toHaveLength(1)
      expect(JSON.parse(updatedRows[0].data()).title).toEqual("Pin 222222")
      expect(updatedRows[0].serverSequence()).toBeGreaterThan(createdServerSequence)

      expect(broadcasts).toHaveLength(2)
      expect(broadcasts[0].channel).toEqual("uuid-items")
      expect(broadcasts[0].params).toEqual({resourceId: uuidItem.id()})
      expect(broadcasts[0].body.syncType).toEqual("update")
      expect(broadcasts[1].body.data.title).toEqual("Pin 222222")
    } finally {
      restore()
    }
  })

  it("publishes only after the save transaction commits", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness()

    await publisher.start()

    try {
      await UuidItem.transaction(async () => {
        await UuidItem.create({id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", title: "Inside transaction"})

        expect(await SyncEntry.where({resource_type: "UuidItem"}).toArray()).toHaveLength(0)
        expect(broadcasts).toHaveLength(0)
      })

      expect(await SyncEntry.where({resource_type: "UuidItem"}).toArray()).toHaveLength(1)
      expect(broadcasts).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it("does not publish rolled-back saves", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness()

    await publisher.start()

    try {
      await expect(async () => {
        await UuidItem.transaction(async () => {
          await UuidItem.create({id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", title: "Rolled back"})

          throw new Error("Roll the save back")
        })
      }).toThrow(/Roll the save back/u)

      expect(await SyncEntry.where({resource_type: "UuidItem"}).toArray()).toHaveLength(0)
      expect(broadcasts).toHaveLength(0)
      expect(await UuidItem.findBy({id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"})).toEqual(null)
    } finally {
      restore()
    }
  })

  it("publishes the payload committed by the save even when an afterSave hook assigns unsaved drift", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness()

    await publisher.start()

    /** @param {?} record - Saved uuid item. @returns {Promise<void>} Assigns an unsaved attribute after the publish callback ran. */
    const driftAfterSave = async (record) => {
      record.assign({title: "Drifted title"})
    }

    UuidItem.afterSave(driftAfterSave)

    try {
      const uuidItem = await UuidItem.create({id: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f", title: "Committed title"})
      const syncRows = await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(syncRows).toHaveLength(1)
      expect(JSON.parse(syncRows[0].data()).title).toEqual("Committed title")
      expect(broadcasts).toHaveLength(1)
      expect(broadcasts[0].body.data.title).toEqual("Committed title")
    } finally {
      UuidItem.unregisterLifecycleCallback("afterSave", driftAfterSave)
      restore()
    }
  })

  it("suppresses publishing across the async duration of withoutPublishing", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness()

    await publisher.start()

    try {
      await withoutPublishing(async () => {
        await UuidItem.create({id: "4d5e6f7a-8b9c-4d0e-8f1a-3b4c5d6e7f8a", title: "Applied first"})

        const appliedUuidItem = await UuidItem.findByOrFail({id: "4d5e6f7a-8b9c-4d0e-8f1a-3b4c5d6e7f8a"})

        await appliedUuidItem.update({title: "Applied second"})
      })

      expect(await SyncEntry.where({resource_type: "UuidItem"}).toArray()).toHaveLength(0)
      expect(broadcasts).toHaveLength(0)

      await UuidItem.create({id: "5e6f7a8b-9c0d-4e1f-8a2b-4c5d6e7f8a9b", title: "Server origin"})

      expect(await SyncEntry.where({resource_type: "UuidItem"}).toArray()).toHaveLength(1)
      expect(broadcasts).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it("suppresses publishing for records marked as server applies until released", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness()

    await publisher.start()

    try {
      const uuidItem = await UuidItem.create({id: "6f7a8b9c-0d1e-4f2a-8b3c-5d6e7f8a9b0c", title: "Server origin"})

      expect(broadcasts).toHaveLength(1)

      const release = markServerApply(uuidItem)

      await uuidItem.update({title: "Applied from device"})

      expect(await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()).toHaveLength(1)
      expect(broadcasts).toHaveLength(1)

      release()
      await uuidItem.update({title: "Server origin again"})

      expect(broadcasts).toHaveLength(2)
    } finally {
      restore()
    }
  })

  it("does not publish destroys by default and publishes them as deletes when opted in", async () => {
    const defaultHarness = buildUuidItemPublishHarness()

    await defaultHarness.publisher.start()

    try {
      const uuidItem = await UuidItem.create({id: "7a8b9c0d-1e2f-4a3b-8c4d-6e7f8a9b0c1d", title: "Destroyed by default"})

      await uuidItem.destroy()

      const syncRows = await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(syncRows).toHaveLength(1)
      expect(syncRows[0].syncType()).toEqual("update")
    } finally {
      defaultHarness.restore()
    }

    const destroyHarness = buildUuidItemPublishHarness({
      publish: {
        operations: ["create", "update", "destroy"],
        serialize: (/** @type {UuidItem} */ uuidItem) => ({id: uuidItem.id(), title: uuidItem.title()})
      }
    })

    await destroyHarness.publisher.start()

    try {
      const uuidItem = await UuidItem.create({id: "8b9c0d1e-2f3a-4b4c-8d5e-7f8a9b0c1d2e", title: "Destroyed opt-in"})

      await uuidItem.destroy()

      const syncRows = await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(syncRows).toHaveLength(1)
      expect(syncRows[0].syncType()).toEqual("delete")
      expect(JSON.parse(syncRows[0].data()).title).toEqual("Destroyed opt-in")
    } finally {
      destroyHarness.restore()
    }
  })

  it("reports post-commit publish failures loudly without failing the committed save", async () => {
    const {errors, publisher, restore} = buildUuidItemPublishHarness({
      broadcaster: async () => {
        throw new Error("Broadcast delivery blew up")
      }
    })

    await publisher.start()

    try {
      const uuidItem = await UuidItem.create({id: "9c0d1e2f-3a4b-4c5d-8e6f-8a9b0c1d2e3f", title: "Still saved"})

      expect((await UuidItem.findByOrFail({id: uuidItem.id()})).title()).toEqual("Still saved")
      expect(await SyncEntry.where({resource_id: uuidItem.id(), resource_type: "UuidItem"}).toArray()).toHaveLength(1)
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toEqual("Broadcast delivery blew up")
    } finally {
      restore()
    }
  })

  it("does not double-publish mutations applied through the routed replay", async () => {
    const {broadcasts, publisher, restore} = buildUuidItemPublishHarness({
      publish: {
        broadcasts: [{
          body: (/** @type {import("../../src/sync/sync-publisher-types.js").SyncPublishBroadcastArgs} */ args) => ({data: args.data}),
          broadcastParams: () => ({}),
          channel: "uuid-items"
        }],
        operations: ["create", "update", "destroy"],
        serialize: (/** @type {UuidItem} */ uuidItem) => ({id: uuidItem.id(), title: uuidItem.title()})
      }
    })

    await publisher.start()

    try {
      const existingUuidItem = await withoutPublishing(async () => await UuidItem.create({id: "ad0e1f2a-3b4c-4d5e-8f6a-9b0c1d2e3f4a", title: "Replay before"}))
      const replayService = buildRoutedReplayService()
      const updateResult = await replayService.replay({
        syncs: [{
          clientUpdatedAt: "2026-07-06T10:00:00.000Z",
          data: {title: "Replay after"},
          id: "be1f2a3b-4c5d-4e6f-8a7b-0c1d2e3f4a5b",
          resourceId: String(existingUuidItem.id()),
          resourceType: "UuidItem",
          syncType: "update"
        }]
      })

      expect(updateResult).toEqual({syncs: [{id: "be1f2a3b-4c5d-4e6f-8a7b-0c1d2e3f4a5b", syncState: "successful"}]})
      expect((await UuidItem.findByOrFail({id: existingUuidItem.id()})).title()).toEqual("Replay after")

      const updateSyncRows = await SyncEntry.where({resource_id: existingUuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(updateSyncRows).toHaveLength(1)
      expect(updateSyncRows[0].authenticationTokenId()).toEqual(REPLAY_ACTOR_ID)

      const createResult = await replayService.replay({
        syncs: [{
          clientUpdatedAt: "2026-07-06T10:01:00.000Z",
          data: {title: "Replay created"},
          id: "cf2a3b4c-5d6e-4f7a-8b8c-1d2e3f4a5b6c",
          resourceId: "da3b4c5d-6e7f-4a8b-8c9d-2e3f4a5b6c7d",
          resourceType: "UuidItem",
          syncType: "update"
        }]
      })

      expect(createResult).toEqual({syncs: [{id: "cf2a3b4c-5d6e-4f7a-8b8c-1d2e3f4a5b6c", syncState: "successful"}]})

      const createSyncRows = await SyncEntry.where({resource_id: "da3b4c5d-6e7f-4a8b-8c9d-2e3f4a5b6c7d", resource_type: "UuidItem"}).toArray()

      expect(createSyncRows).toHaveLength(1)
      expect(createSyncRows[0].authenticationTokenId()).toEqual(REPLAY_ACTOR_ID)

      const deleteResult = await replayService.replay({
        syncs: [{
          clientUpdatedAt: "2026-07-06T10:02:00.000Z",
          data: {},
          id: "eb4c5d6e-7f8a-4b9c-8d0e-3f4a5b6c7d8e",
          resourceId: String(existingUuidItem.id()),
          resourceType: "UuidItem",
          syncType: "delete"
        }]
      })

      expect(deleteResult).toEqual({syncs: [{id: "eb4c5d6e-7f8a-4b9c-8d0e-3f4a5b6c7d8e", syncState: "successful"}]})
      expect(await UuidItem.findBy({id: existingUuidItem.id()})).toEqual(null)

      const deleteSyncRows = await SyncEntry.where({resource_id: existingUuidItem.id(), resource_type: "UuidItem"}).toArray()

      expect(deleteSyncRows).toHaveLength(1)
      expect(deleteSyncRows[0].authenticationTokenId()).toEqual(REPLAY_ACTOR_ID)

      expect(broadcasts).toHaveLength(0)
    } finally {
      restore()
    }
  })
})
