// @ts-check

import {deferred} from "awaitery"

import {describe, expect, it} from "../../src/testing/test.js"
import {upsertServerOriginSyncRow} from "../../src/sync/upsert-server-origin-sync-row.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"

const ACTOR_ID = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"
const RESOURCE_ID = "5c2dfb56-d43f-4ae7-b940-4f9a94977da1"
const RESOURCE_TYPE = "ServerOriginItem"

/**
 * Builds one complete server-origin sync-row mutation.
 * @param {{dataTitle?: string, projectId?: string | null}} [args] - Attribute overrides.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync-row attributes.
 */
function serverOriginAttributes({dataTitle = "Current snapshot", projectId = null} = {}) {
  return {
    authentication_token_id: null,
    client_updated_at: new Date("2026-09-18T10:00:00.000Z"),
    data: JSON.stringify({title: dataTitle}),
    project_id: projectId,
    resource_id: RESOURCE_ID,
    resource_type: RESOURCE_TYPE,
    sync_type: "update"
  }
}

describe("upsertServerOriginSyncRow", {databaseCleaning: {transaction: true}, tags: ["dummy"]}, () => {
  it("serializes concurrent calls for the same nullable complete identity on one stable dedicated lock", async () => {
    const firstCreateStarted = deferred()
    const releaseFirstCreate = deferred()
    const secondLockRequested = deferred()
    /** @type {Array<{dedicatedConnection: boolean | undefined, name: string}>} */
    const locks = []
    let createCalls = 0

    class CoordinatedSyncEntry extends SyncEntry {
      /** @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Sync row attributes. @returns {Promise<SyncEntry>} Created sync row. */
      static async create(attributes) {
        createCalls += 1

        if (createCalls === 1) {
          firstCreateStarted.resolve(undefined)
          await releaseFirstCreate.promise
        }

        return await super.create(attributes)
      }

      /** @param {string} name - Advisory lock name. @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Locked callback. @param {{dedicatedConnection?: boolean}} args - Lock options. @returns {Promise<ReturnType<typeof JSON.parse>>} Callback result. */
      static async withAdvisoryLock(name, callback, args) {
        locks.push({dedicatedConnection: args.dedicatedConnection, name})
        if (locks.length === 2) secondLockRequested.resolve(undefined)

        return await super.withAdvisoryLock(name, callback, args)
      }
    }

    const firstUpsert = upsertServerOriginSyncRow({
      attributes: serverOriginAttributes({dataTitle: "First snapshot"}),
      syncModel: CoordinatedSyncEntry
    })

    await firstCreateStarted.promise

    const secondUpsert = upsertServerOriginSyncRow({
      attributes: serverOriginAttributes({dataTitle: "Second snapshot"}),
      syncModel: CoordinatedSyncEntry
    })

    await secondLockRequested.promise

    try {
      expect(createCalls).toEqual(1)
      expect(locks).toHaveLength(2)
      expect(locks[0].name).toEqual(locks[1].name)
      expect(locks[0].dedicatedConnection).toEqual(true)
      expect(locks[1].dedicatedConnection).toEqual(true)
    } finally {
      releaseFirstCreate.resolve(undefined)
    }

    await Promise.all([firstUpsert, secondUpsert])

    const matchingRows = await SyncEntry
      .where({authentication_token_id: null, project_id: null, resource_id: RESOURCE_ID, resource_type: RESOURCE_TYPE})
      .toArray()

    expect(matchingRows).toHaveLength(1)
    expect(JSON.parse(matchingRows[0].data()).title).toEqual("Second snapshot")
    expect(matchingRows[0].serverSequence()).not.toEqual(null)
  })

  it("keeps the newest deterministic duplicate survivor and leaves actor and other-scope rows untouched", async () => {
    const higherIdDuplicate = await SyncEntry.create({
      ...serverOriginAttributes({dataTitle: "Higher id duplicate"}),
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    })
    const lowerIdDuplicate = await SyncEntry.create({
      ...serverOriginAttributes({dataTitle: "Lower id duplicate"}),
      id: "11111111-1111-4111-8111-111111111111"
    })

    higherIdDuplicate.setServerSequence(lowerIdDuplicate.serverSequence())
    await higherIdDuplicate.save()

    const actorRow = await SyncEntry.create({
      ...serverOriginAttributes({dataTitle: "Device mutation"}),
      authentication_token_id: ACTOR_ID
    })
    const otherScopeRow = await SyncEntry.create({
      ...serverOriginAttributes({dataTitle: "Other scope", projectId: "project-elsewhere"})
    })
    const previousSequence = lowerIdDuplicate.serverSequence()

    const upsertedRow = await upsertServerOriginSyncRow({
      attributes: serverOriginAttributes({dataTitle: "Reconciled snapshot"}),
      syncModel: SyncEntry
    })

    expect(upsertedRow.id()).toEqual(lowerIdDuplicate.id())
    expect(upsertedRow.serverSequence()).toBeGreaterThan(previousSequence)
    expect(JSON.parse(upsertedRow.data()).title).toEqual("Reconciled snapshot")
    expect(await SyncEntry.findBy({id: higherIdDuplicate.id()})).toEqual(null)

    const persistedActorRow = await SyncEntry.findBy({id: actorRow.id()})
    const persistedOtherScopeRow = await SyncEntry.findBy({id: otherScopeRow.id()})

    expect(persistedActorRow?.authenticationTokenId()).toEqual(ACTOR_ID)
    expect(JSON.parse(persistedActorRow?.data()).title).toEqual("Device mutation")
    expect(persistedOtherScopeRow?.projectId()).toEqual("project-elsewhere")
    expect(JSON.parse(persistedOtherScopeRow?.data()).title).toEqual("Other scope")
  })

  it("fails loudly before locking when the complete null-safe identity is malformed", async () => {
    const validAttributes = serverOriginAttributes()

    for (const [label, attributes, expectedMessage] of [
      ["missing actor", {...validAttributes, authentication_token_id: undefined}, "must include the actor column authentication_token_id"],
      ["device actor", {...validAttributes, authentication_token_id: ACTOR_ID}, "actor column authentication_token_id must be null"],
      ["missing resource id", {...validAttributes, resource_id: undefined}, "resource_id must be a non-empty string"],
      ["missing resource type", {...validAttributes, resource_type: undefined}, "resource_type must be a non-empty string"],
      ["missing scope", {...validAttributes, project_id: undefined}, "must include the declared scope column project_id"],
      ["invalid scope", {...validAttributes, project_id: {id: "nested"}}, "scope column project_id must be a string, finite number, or null"]
    ]) {
      await expect(async () => await upsertServerOriginSyncRow({attributes, syncModel: SyncEntry}))
        .toThrow(new RegExp(`${label}: ${expectedMessage}|${expectedMessage}`, "u"))
    }
  })
})
