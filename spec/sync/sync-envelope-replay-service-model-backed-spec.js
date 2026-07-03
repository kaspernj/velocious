// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"

class DummyModelBackedReplayService extends SyncEnvelopeReplayService {
  constructor() {
    super({logger: {warn: () => {}}, syncModel: SyncEntry})
  }

  /** @returns {Promise<{authenticated: true, actor: {id: () => string}}>} Authenticated fake actor. */
  async authenticateReplay() {
    return {actor: {id: () => "token-1"}, authenticated: true}
  }
}

describe("sync envelope replay service - model-backed defaults", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("creates a sync row through the real sync model when none exists", async () => {
    const service = new DummyModelBackedReplayService()
    const result = await service.replay({
      syncs: [{
        clientUpdatedAt: "2026-06-25T11:00:00.000Z",
        data: {name: "Changed"},
        id: 1,
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: 1, syncState: "successful"}]})

    const persistedEntry = await SyncEntry.findByOrFail({resourceId: "34", resourceType: "Task"})

    expect(persistedEntry.authenticationTokenId()).toEqual("token-1")
    expect(persistedEntry.syncType()).toEqual("update")
    expect(persistedEntry.clientUpdatedAt()?.toISOString()).toEqual("2026-06-25T11:00:00.000Z")
    expect(JSON.parse(String(persistedEntry.data()))).toEqual({name: "Changed"})

    // withServerSequence assigns an initial sequence on create through the shared allocator.
    const persistedSequence = persistedEntry.serverSequence()

    if (persistedSequence === null) throw new Error("Expected a server sequence to be assigned on create")

    expect(persistedSequence).toBeGreaterThan(0)
  })

  it("updates and re-sequences the existing sync row for newer client mutations", async () => {
    const service = new DummyModelBackedReplayService()

    await service.replay({
      syncs: [{clientUpdatedAt: "2026-06-25T10:00:00.000Z", data: {name: "First"}, id: 1, resourceId: 34, resourceType: "Task", syncType: "update"}]
    })

    const firstEntry = await SyncEntry.findByOrFail({resourceId: "34", resourceType: "Task"})

    await firstEntry.advanceServerSequence()
    await firstEntry.save()

    const firstServerSequence = firstEntry.serverSequence()

    await service.replay({
      syncs: [{clientUpdatedAt: "2026-06-25T11:00:00.000Z", data: {name: "Second"}, id: 2, resourceId: 34, resourceType: "Task", syncType: "update"}]
    })

    const updatedEntries = await SyncEntry.where({resourceId: "34", resourceType: "Task"}).toArray()

    expect(updatedEntries).toHaveLength(1)
    expect(JSON.parse(String(updatedEntries[0].data()))).toEqual({name: "Second"})
    expect(updatedEntries[0].serverSequence()).toBeGreaterThan(firstServerSequence)
  })

  it("does not persist stale mutations over a newer existing sync row", async () => {
    const service = new DummyModelBackedReplayService()

    await service.replay({
      syncs: [{clientUpdatedAt: "2026-06-25T12:00:00.000Z", data: {name: "Newest"}, id: 1, resourceId: 34, resourceType: "Task", syncType: "update"}]
    })

    const result = await service.replay({
      syncs: [{clientUpdatedAt: "2026-06-25T11:00:00.000Z", data: {name: "Stale"}, id: 2, resourceId: 34, resourceType: "Task", syncType: "update"}]
    })

    expect(result).toEqual({syncs: [{id: 2, syncState: "successful"}]})

    const persistedEntry = await SyncEntry.findByOrFail({resourceId: "34", resourceType: "Task"})

    expect(JSON.parse(String(persistedEntry.data()))).toEqual({name: "Newest"})
    expect(persistedEntry.clientUpdatedAt()?.toISOString()).toEqual("2026-06-25T12:00:00.000Z")
  })
})
