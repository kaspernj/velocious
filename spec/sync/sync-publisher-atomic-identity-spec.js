// @ts-check

import { deferred } from "awaitery"

import { describe, expect, it } from "../../src/testing/test.js"
import { DEVICE_COLUMNS, buildConfiguration, buildMetadataModelClass, buildRecord, triggerLifecycle } from "./sync-client-fakes.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import SyncPublisher from "../../src/sync/sync-publisher.js"

const ACTOR_ID = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"
const RESOURCE_ID = "5c2dfb56-d43f-4ae7-b940-4f9a94977da1"
const RESOURCE_TYPE = "AtomicPublishedItem"

describe("sync publisher atomic server identity", { databaseCleaning: { transaction: true }, tags: ["dummy"] }, () => {
  it("serializes concurrent server publication for a nullable complete identity without collapsing actor rows", async () => {
    const firstCreateStarted = deferred()
    const releaseFirstCreate = deferred()
    const secondPublisherContended = deferred()
    let serverCreateCalls = 0
    let serverLockCalls = 0
    let serverLookupCalls = 0

    class CoordinatedSyncEntry extends SyncEntry {
      /** @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Sync row attributes. @returns {Promise<SyncEntry>} Created sync row. */
      static async create(attributes) {
        if (attributes.authentication_token_id === null && attributes.resource_id === RESOURCE_ID) {
          serverCreateCalls += 1

          if (serverCreateCalls === 1) {
            firstCreateStarted.resolve(undefined)
            await releaseFirstCreate.promise
          }
        }

        return await super.create(attributes)
      }

      /** @param {string} name - Advisory lock name. @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Locked callback. @param {{dedicatedConnection?: boolean}} args - Lock options. @returns {Promise<ReturnType<typeof JSON.parse>>} Callback result. */
      static async withAdvisoryLock(name, callback, args) {
        serverLockCalls += 1
        if (serverLockCalls === 2) secondPublisherContended.resolve(undefined)

        return await super.withAdvisoryLock(name, callback, args)
      }

      /** @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Sync identity conditions. @returns {ReturnType<SyncEntry["where"]>} Sync row query. */
      static where(conditions) {
        if (conditions.authentication_token_id === null && conditions.resource_id === RESOURCE_ID) {
          serverLookupCalls += 1
          if (serverLookupCalls === 2) secondPublisherContended.resolve(undefined)
        }

        return super.where(conditions)
      }
    }

    const AtomicPublishedItem = buildMetadataModelClass({
      columns: DEVICE_COLUMNS,
      modelName: RESOURCE_TYPE,
      sync: {
        publish: {
          scopeAttributes: async ({ record }) => ({ projectId: record.readAttribute("projectId") ?? null }),
          serialize: (/** @type {ReturnType<typeof JSON.parse>} */ record) => ({ id: record.id(), title: record.readAttribute("title") })
        }
      }
    })
    /** @type {Array<{body: ReturnType<typeof JSON.parse>, channel: string, params: Record<string, ReturnType<typeof JSON.parse>>}>} */
    const broadcasts = []
    const publisher = new SyncPublisher({
      broadcaster: async (broadcast) => {
        broadcasts.push(broadcast)
      },
      configuration: buildConfiguration({ modelClasses: [AtomicPublishedItem], sync: {} }),
      syncModel: CoordinatedSyncEntry
    })

    await SyncEntry.create({
      authentication_token_id: ACTOR_ID,
      client_updated_at: new Date("2026-09-11T10:00:00.000Z"),
      data: JSON.stringify({ title: "Device replay" }),
      project_id: null,
      resource_id: RESOURCE_ID,
      resource_type: RESOURCE_TYPE,
      sync_type: "update"
    })
    await publisher.start()

    try {
      const firstPublish = triggerLifecycle(AtomicPublishedItem, "afterCreate", buildRecord(AtomicPublishedItem, RESOURCE_ID, {
        id: RESOURCE_ID,
        title: "First committed"
      }))

      await firstCreateStarted.promise

      const secondPublish = triggerLifecycle(AtomicPublishedItem, "afterCreate", buildRecord(AtomicPublishedItem, RESOURCE_ID, {
        id: RESOURCE_ID,
        title: "Second committed"
      }))

      await secondPublisherContended.promise
      releaseFirstCreate.resolve(undefined)
      await Promise.all([firstPublish, secondPublish])

      await triggerLifecycle(AtomicPublishedItem, "afterCreate", buildRecord(AtomicPublishedItem, RESOURCE_ID, {
        id: RESOURCE_ID,
        projectId: "project-elsewhere",
        title: "Other scope"
      }))

      const rows = await SyncEntry
        .where({ resource_id: RESOURCE_ID, resource_type: RESOURCE_TYPE })
        .toArray()
      const actorRows = rows.filter((row) => row.authenticationTokenId() === ACTOR_ID)
      const nullableScopeServerRows = rows.filter((row) => row.authenticationTokenId() === null && row.projectId() === null)
      const otherScopeServerRows = rows.filter((row) => row.authenticationTokenId() === null && row.projectId() === "project-elsewhere")

      expect(actorRows).toHaveLength(1)
      expect(JSON.parse(actorRows[0].data()).title).toEqual("Device replay")
      expect(nullableScopeServerRows).toHaveLength(1)
      expect(otherScopeServerRows).toHaveLength(1)
      expect(JSON.parse(otherScopeServerRows[0].data()).title).toEqual("Other scope")
      expect(broadcasts).toHaveLength(3)

      const latestBroadcast = broadcasts[1].body.syncs[0]
      const serverRow = nullableScopeServerRows[0]

      expect(latestBroadcast.data.title).toEqual("Second committed")
      expect(serverRow.id()).toEqual(latestBroadcast.id)
      expect(serverRow.projectId()).toEqual(null)
      expect(serverRow.serverSequence()).toEqual(latestBroadcast.serverSequence)
      expect(serverRow.syncType()).toEqual(latestBroadcast.syncType)
      expect(serverRow.updatedAt()?.toISOString()).toEqual(latestBroadcast.updatedAt)
      expect(JSON.parse(serverRow.data()).title).toEqual(latestBroadcast.data.title)
    } finally {
      releaseFirstCreate.resolve(undefined)
      publisher.stop()
    }
  })
})
