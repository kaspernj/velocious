import {describe, expect, it} from "../../src/testing/test.js"
import SyncApiClient from "../../src/sync/sync-api-client.js"

describe("sync API client", () => {
  it("queues local sync rows while normalizing and stripping app-local attributes", async () => {
    const created = []
    const syncModel = {
      findBy: async () => null,
      create: async (attributes) => {
        created.push(attributes)
        return attributes
      }
    }
    const resource = {
      id: () => 12,
      constructor: {getModelName: () => "TicketScan", name: "t"},
      attributes: () => ({accepted: 1, id: 12, ticketNr: "T-1"})
    }

    const sync = await SyncApiClient.queueLocalSync({
      booleanAttributes: ["accepted"],
      localOnlyAttributes: ["id"],
      resource,
      syncModel,
      syncType: "scanAttempt"
    })

    expect(sync).toEqual({
      data: {accepted: true, ticketNr: "T-1"},
      resourceId: "12",
      resourceType: "TicketScan",
      state: "pending",
      syncType: "scanAttempt"
    })
    expect(created).toEqual([sync])
  })

  it("fails loudly when queueing a resource without a stable model name", async () => {
    const resource = {
      id: () => 12,
      constructor: {name: "t"},
      attributes: () => ({ticketNr: "T-1"})
    }

    await expect(async () => await SyncApiClient.queueLocalSync({resource, syncModel: {findBy: async () => null}}))
      .toThrow(/getModelName/u)
  })

  it("replays local sync rows through framework-built envelopes", async () => {
    const sync = new TestSync({data: {ticketNr: "T-1"}, id: 5, resourceId: 12, resourceType: "TicketScan", syncType: "scanAttempt"})
    const posted = []
    const syncModel = buildReplaySyncModel([sync])

    await SyncApiClient.replayLocalSyncs({
      authenticationToken: "token-1",
      postReplay: async (payload) => {
        posted.push(payload)
        return {syncs: [{id: 5, syncState: "successful"}]}
      },
      syncModel
    })

    expect(posted).toEqual([{
      authenticationToken: "token-1",
      syncs: [{
        clientUpdatedAt: "2026-07-02T10:00:00.000Z",
        data: {ticketNr: "T-1"},
        id: 5,
        resourceId: "12",
        resourceType: "TicketScan",
        syncType: "scanAttempt"
      }]
    }])
    expect(sync.attributes.state).toEqual("success")
  })

  it("keeps rows pending when they were edited during the replay flight", async () => {
    const sync = new TestSync({data: {ticketNr: "T-1"}, id: 5, resourceId: 12, resourceType: "TicketScan", syncType: "scanAttempt"})
    const syncModel = buildReplaySyncModel([sync])

    await SyncApiClient.replayLocalSyncs({
      authenticationToken: "token-1",
      postReplay: async () => {
        sync.attributes.data = {ticketNr: "T-1", whereaboutState: "inside"}

        return {syncs: [{id: 5, syncState: "successful"}]}
      },
      syncModel
    })

    expect(sync.attributes.state).toEqual("pending")

    await SyncApiClient.replayLocalSyncs({
      authenticationToken: "token-1",
      postReplay: async (payload) => {
        expect(payload.syncs[0].data).toEqual({ticketNr: "T-1", whereaboutState: "inside"})

        return {syncs: [{id: 5, syncState: "successful"}]}
      },
      syncModel
    })

    expect(sync.attributes.state).toEqual("success")
  })

  it("persists pull cursors and projects resource result keys", async () => {
    const option = new TestOption()
    const cursorModel = {
      findBy: async () => option,
      findOrInitializeBy: async () => option
    }
    const saved = await SyncApiClient.loadSyncCursor({cursorKey: "sync:key", cursorModel})

    await SyncApiClient.saveSyncCursor({cursor: {id: "1", serverSequence: 2, updatedAt: "2026-07-02T10:00:00.000Z"}, cursorKey: "sync:key", cursorModel})

    expect(saved).toEqual("old-cursor")
    expect(option.attributes.value).toEqual(JSON.stringify({id: "1", serverSequence: 2, updatedAt: "2026-07-02T10:00:00.000Z"}))
    expect(SyncApiClient.syncResultForResources({
      resources: {Ticket: {changedKey: "ticketsChanged", countKey: "ticketSyncCount"}},
      result: {changed: true, pages: 2, resourceChanged: {Ticket: true}, resourceCounts: {Ticket: 3}, syncedCount: 3}
    })).toEqual({changed: true, pages: 2, syncedCount: 3, ticketSyncCount: 3, ticketsChanged: true})
  })

  it("builds declarative local sync queue facades", async () => {
    const syncModel = {
      findBy: async () => null,
      create: async (attributes) => attributes
    }
    const resource = {
      id: () => 13,
      constructor: {getModelName: () => "TicketScan", name: "t"},
      attributes: () => ({accepted: 0, id: 13, ticketNr: "T-2"})
    }
    let pendingSyncCalls = 0
    const queue = SyncApiClient.localSyncQueue({
      booleanAttributes: () => ["accepted"],
      localOnlyAttributes: () => ["id"],
      singleFlightKey: "test-sync",
      syncModel,
      syncPending: async () => { pendingSyncCalls += 1 }
    })

    const sync = await queue.queue({resource, syncType: "scanAttempt"})
    await Promise.all([queue.syncPending(), queue.syncPending()])

    expect(sync.data).toEqual({accepted: false, ticketNr: "T-2"})
    expect(pendingSyncCalls).toEqual(2)
  })

  it("lets queued sync work retry after a failed flight", async () => {
    let rejectFirstFlight
    let secondFlightRan = false
    const firstFlight = SyncApiClient.singleFlight("retry-key", () => new Promise((_resolve, reject) => {
      rejectFirstFlight = reject
    }))
    const secondFlight = SyncApiClient.singleFlight("retry-key", async () => {
      secondFlightRan = true
    })

    rejectFirstFlight(new Error("Transient replay failure"))

    await expect(async () => await firstFlight).toThrow("Transient replay failure")
    await secondFlight

    expect(secondFlightRan).toEqual(true)
  })
})

/**
 * Builds a fake local sync model with pending-row querying and id lookup.
 * @param {TestSync[]} rows - Local sync rows.
 * @returns {?} Fake sync model.
 */
function buildReplaySyncModel(rows) {
  return {
    findBy: async ({id}) => rows.find((row) => row.id() === id) || null,
    preload: () => ({
      where: ({state}) => ({
        order: () => ({
          toArray: async () => rows.filter((row) => row.attributes.state !== "success" && state === "pending")
        })
      })
    })
  }
}

class TestSync {
  constructor(attributes) {
    this.attributes = {state: "pending", ...attributes}
  }

  createdAt() {
    return new Date("2026-07-02T09:00:00.000Z")
  }

  data() {
    return this.attributes.data
  }

  id() {
    return this.attributes.id
  }

  resourceId() {
    return this.attributes.resourceId
  }

  resourceType() {
    return this.attributes.resourceType
  }

  syncType() {
    return this.attributes.syncType
  }

  updatedAt() {
    return new Date("2026-07-02T10:00:00.000Z")
  }

  async update(attributes) {
    Object.assign(this.attributes, attributes)
  }
}

class TestOption {
  constructor() {
    this.attributes = {value: "old-cursor"}
  }

  assign(attributes) {
    Object.assign(this.attributes, attributes)
  }

  isChanged() {
    return true
  }

  async save() {}

  value() {
    return this.attributes.value
  }
}
