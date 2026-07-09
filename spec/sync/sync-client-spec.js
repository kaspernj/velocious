// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, buildRecord, fakeQuery, triggerLifecycle} from "./sync-client-fakes.js"
import SyncClient from "../../src/sync/sync-client.js"

const SCAN_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"
const TICKET_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

const TICKET_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "name", name: "name", type: "varchar"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

const SCAN_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "accepted", name: "accepted", type: "boolean"},
  {attributeName: "ticketId", name: "ticket_id", type: "uuid"},
  {attributeName: "localOnly", name: "local_only", type: "varchar"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

/**
 * Builds a sync client harness deriving everything from a configuration with
 * registered fake models and a recording transport.
 * @param {object} [args] - Harness args.
 * @param {(args: {scope: Record<string, ?>}) => string | null | Promise<string | null>} [args.legacyCursor] - Legacy cursor seed hook.
 * @param {Array<?>} [args.modelClasses] - Model classes to register. Defaults to a Ticket (pull-apply) and TicketScan (queueing) pair.
 * @returns {?} Harness with client, fakes, and recorded calls.
 */
function buildHarness({legacyCursor, modelClasses} = {}) {
  /** @type {Array<Record<string, ?>>} */
  const postChangesCalls = []
  /** @type {Array<Record<string, ?>>} */
  const postReplayCalls = []
  /** @type {Array<Error>} */
  const errors = []
  const syncModel = buildFakeSyncModel()
  const ticketRecord = {
    assignedAttributes: /** @type {Record<string, ?> | null} */ (null),
    /** @param {Record<string, ?>} attributes - Applied attributes. @returns {void} */
    assign(attributes) {
      this.assignedAttributes = attributes
    },
    isChanged: () => true,
    save: async () => {}
  }
  const state = {
    changesResponses: /** @type {Array<Record<string, ?>>} */ ([]),
    online: true,
    replayResponse: /** @type {Record<string, ?> | ((payload: Record<string, ?>) => Record<string, ?>)} */ ({status: "success", syncs: []})
  }
  const transport = {
    /** @param {string} path - Posted path. @param {Record<string, ?>} payload - Posted payload. @returns {Promise<{json: () => Record<string, ?>}>} Response with json accessor. */
    post: async (path, payload) => {
      if (path.endsWith("/changes")) {
        postChangesCalls.push(payload)

        const changesResponse = state.changesResponses.shift() || {nextCursor: null, status: "success", syncs: [], upToCursor: null}

        return {json: () => changesResponse}
      }

      postReplayCalls.push(payload)

      if (typeof state.replayResponse === "function") {
        const replayResponse = state.replayResponse(payload)

        return {json: () => replayResponse}
      }

      const replayResponse = {
        ...state.replayResponse,
        syncs: state.replayResponse.syncs.length > 0
          ? state.replayResponse.syncs
          : payload.syncs.map((/** @type {Record<string, ?>} */ sync) => ({id: sync.id, syncState: "successful"}))
      }

      return {json: () => replayResponse}
    }
  }
  const resolvedModelClasses = modelClasses || [
    buildMetadataModelClass({
      columns: TICKET_COLUMNS,
      modelName: "Ticket",
      sync: {
        attributes: (/** @type {{data: Record<string, ?>}} */ {data}) => ({name: data.name}),
        findRecord: async () => ticketRecord
      }
    }),
    buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TicketScan",
      sync: {
        localOnlyAttributes: ["localOnly"],
        syncType: (/** @type {{operation: string}} */ {operation}) => operation === "create" ? "scanAttempt" : "update"
      }
    })
  ]
  const configuration = buildConfiguration({
    modelClasses: resolvedModelClasses,
    sync: {
      client: {
        authenticationToken: () => "token-1",
        isOnline: () => state.online,
        onError: (/** @type {Error} */ error) => {
          errors.push(error)
        },
        transport
      }
    }
  })
  const client = new SyncClient({configuration, legacyCursor, syncModel})

  return {client, errors, modelClasses: resolvedModelClasses, postChangesCalls, postReplayCalls, state, syncModel, ticketRecord}
}

/**
 * Builds a fake scan record of a harness TicketScan model class for queueing tests.
 * @param {?} modelClass - TicketScan model class.
 * @returns {?} Fake TicketScan record.
 */
function buildScanRecord(modelClass) {
  return buildRecord(modelClass, SCAN_ID, {accepted: 1, localOnly: "internal", ticketId: TICKET_ID})
}

describe("sync client", () => {
  it("declares a scope and pulls it with the scope in the changes payload", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: TICKET_ID, resourceType: "Ticket", syncType: "update"}],
      upToCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"}
    })

    const result = await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].authenticationToken).toEqual("token-1")
    expect(harness.postChangesCalls[0].scope).toEqual({conditions: {partner_id: 5}, resourceType: "Ticket"})
    expect(harness.ticketRecord.assignedAttributes).toEqual({name: "New name"})
    expect(result.pulled?.syncedCount).toEqual(1)
  })

  it("sends the persisted scope cursor on subsequent pulls", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: TICKET_ID, resourceType: "Ticket", syncType: "update"}],
      upToCursor: null
    })

    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))
    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(2)
    expect(harness.postChangesCalls[1].afterId).toEqual("s-1")
    expect(harness.postChangesCalls[1].afterServerSequence).toEqual(3)
    expect(harness.postChangesCalls[1].afterUpdatedAt).toEqual("2026-07-01T10:00:00.000Z")
  })

  it("seeds new scope cursors from the legacyCursor hook", async () => {
    const harness = buildHarness({
      legacyCursor: async () => JSON.stringify({id: "legacy-1", serverSequence: 7, updatedAt: "2026-06-30T10:00:00.000Z"})
    })

    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].afterId).toEqual("legacy-1")
    expect(harness.postChangesCalls[0].afterServerSequence).toEqual(7)
  })

  it("does not pull while offline and pulls declared scopes once online", async () => {
    const harness = buildHarness()

    harness.state.online = false

    const result = await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    expect(result.pulled).toEqual(null)
    expect(harness.postChangesCalls.length).toEqual(0)

    harness.state.online = true

    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].scope).toEqual({conditions: {partner_id: 5}, resourceType: "Ticket"})
  })

  it("pulls every active scope with its own cursor and stops pulling unsynced scopes", async () => {
    const harness = buildHarness()

    harness.state.online = false
    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))
    await harness.client.sync(fakeQuery("Ticket", {partner_id: 6}))
    harness.state.online = true

    await harness.client.pull()

    expect(harness.postChangesCalls.map((call) => call.scope.conditions.partner_id)).toEqual([5, 6])

    await harness.client.unsync(fakeQuery("Ticket", {partner_id: 5}))
    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(3)
    expect(harness.postChangesCalls[2].scope.conditions.partner_id).toEqual(6)
  })

  it("reports pull progress with the server total to an onProgress callback", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: TICKET_ID, resourceType: "Ticket", syncType: "update"}],
      total: 1,
      upToCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"}
    })

    await harness.client.sync(fakeQuery("Ticket", {partner_id: 5}))

    /** @type {Array<{pages: number, syncedCount: number, total: number}>} */
    const progress = []

    harness.state.changesResponses.push({nextCursor: null, status: "success", syncs: [], total: 0, upToCursor: null})

    const pulled = await harness.client.pull({onProgress: (update) => progress.push(update)})

    expect(progress).toEqual([{pages: 0, syncedCount: 0, total: 0}])
    expect(pulled?.total).toEqual(0)
  })

  it("threads onProgress across the initial scope pull with the server total", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: TICKET_ID, resourceType: "Ticket", syncType: "update"}],
      total: 1,
      upToCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"}
    })

    /** @type {Array<{pages: number, syncedCount: number, total: number}>} */
    const progress = []
    const scope = harness.client.scopeStore()

    await scope.findOrCreateScope({conditions: {partner_id: 5}, resourceType: "Ticket"})

    const pulled = await harness.client.pull({onProgress: (update) => progress.push(update)})

    expect(progress).toEqual([{pages: 1, syncedCount: 1, total: 1}])
    expect(pulled?.syncedCount).toEqual(1)
    expect(pulled?.total).toEqual(1)
  })

  it("still pulls when called without arguments", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "New name"}, id: "s-1", resourceId: TICKET_ID, resourceType: "Ticket", syncType: "update"}],
      total: 1,
      upToCursor: {id: "s-1", serverSequence: 3, updatedAt: "2026-07-01T10:00:00.000Z"}
    })

    await harness.client.scopeStore().findOrCreateScope({conditions: {partner_id: 5}, resourceType: "Ticket"})

    const pulled = await harness.client.pull()

    expect(pulled?.syncedCount).toEqual(1)
  })

  it("queues local changes declaratively and replays them immediately when online", async () => {
    const harness = buildHarness()
    const syncRow = await harness.client.queue({resource: buildScanRecord(harness.modelClasses[1]), syncType: "scanAttempt"})

    expect(syncRow.attributes.data).toEqual({accepted: true, ticketId: TICKET_ID})
    expect(syncRow.attributes.syncType).toEqual("scanAttempt")

    await harness.client.waitForScheduledReplay()

    expect(harness.postReplayCalls.length).toEqual(1)
    expect(harness.postReplayCalls[0].syncs[0].resourceType).toEqual("TicketScan")
    expect(syncRow.attributes.state).toEqual("success")
    expect(harness.errors).toEqual([])
  })

  it("keeps queued rows pending while offline", async () => {
    const harness = buildHarness()

    harness.state.online = false

    const syncRow = await harness.client.queue({resource: buildScanRecord(harness.modelClasses[1])})

    await harness.client.waitForScheduledReplay()

    expect(harness.postReplayCalls.length).toEqual(0)
    expect(syncRow.attributes.state).toEqual("pending")
  })

  it("keeps rows pending and reports the error when the replay request fails", async () => {
    const harness = buildHarness()

    harness.state.replayResponse = () => {
      throw new Error("Network down")
    }

    const syncRow = await harness.client.queue({resource: buildScanRecord(harness.modelClasses[1])})

    await harness.client.waitForScheduledReplay()

    expect(harness.errors.map((error) => error.message)).toEqual(["Network down"])
    expect(syncRow.attributes.state).toEqual("pending")
  })

  it("keeps rows pending when the backend does not acknowledge success", async () => {
    const harness = buildHarness()

    harness.state.replayResponse = (payload) => ({
      status: "success",
      syncs: payload.syncs.map((/** @type {Record<string, ?>} */ sync) => ({id: sync.id, syncState: "failed"}))
    })

    const syncRow = await harness.client.queue({resource: buildScanRecord(harness.modelClasses[1])})

    await harness.client.waitForScheduledReplay()

    expect(harness.errors.length).toEqual(1)
    expect(syncRow.attributes.state).toEqual("pending")
  })

  it("fails loudly instead of skipping pulled changes without an applyable resource", async () => {
    const harness = buildHarness()

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 1, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {name: "Someone"}, id: "s-1", resourceId: "c-1", resourceType: "Customer", syncType: "update"}],
      upToCursor: null
    })

    await expect(async () => await harness.client.sync(fakeQuery("Ticket", {partner_id: 5})))
      .toThrow(/No sync resource with pull attributes configured for pulled change: Customer/u)

    await harness.client.pull()

    expect(harness.postChangesCalls.length).toEqual(2)
    expect(harness.postChangesCalls[1].afterId).toEqual(undefined)
  })

  it("fails loudly when queueing a resource type that is not configured", async () => {
    const harness = buildHarness()

    class UnknownModel {
      /** @returns {string} Stable model name. */
      static getModelName() {
        return "UnknownModel"
      }
    }

    const record = Object.create(UnknownModel.prototype)

    await expect(async () => await harness.client.queue({resource: record}))
      .toThrow(/No sync resource configured for: UnknownModel/u)
  })

  it("fails loudly when built without a sync.client configuration block", async () => {
    const configuration = buildConfiguration({modelClasses: [], sync: null})

    await expect(() => new SyncClient({configuration})).toThrow(/sync\.client/u)
  })

  it("exposes a current sync client singleton", async () => {
    const harness = buildHarness()

    harness.client.setCurrent()

    expect(SyncClient.current()).toEqual(harness.client)
  })

  it("tracks create and update mutations by default for models declaring static sync", async () => {
    const DefaultTracked = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "DefaultTracked", sync: true})
    const harness = buildHarness({modelClasses: [DefaultTracked]})

    harness.state.online = false

    await harness.client.start()

    expect(Object.keys(DefaultTracked.lifecycleCallbacks)).toEqual(["afterCreate", "afterUpdate"])

    const record = buildScanRecord(DefaultTracked)

    await triggerLifecycle(DefaultTracked, "afterCreate", record)

    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("create")
    expect(harness.syncModel.rows[0].attributes.data).toEqual({accepted: true, localOnly: "internal", ticketId: TICKET_ID})

    harness.client.stop()
  })

  it("tracks create and update mutations by default for declaration objects without a track key", async () => {
    const DefaultTracked = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "DefaultTracked",
      sync: {localOnlyAttributes: ["localOnly"]}
    })
    const harness = buildHarness({modelClasses: [DefaultTracked]})

    harness.state.online = false

    await harness.client.start()

    expect(Object.keys(DefaultTracked.lifecycleCallbacks)).toEqual(["afterCreate", "afterUpdate"])

    harness.client.stop()
  })

  it("does not track models declaring track: false", async () => {
    const Untracked = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "Untracked", sync: {track: false}})
    const harness = buildHarness({modelClasses: [Untracked]})

    await harness.client.start()

    expect(Object.keys(Untracked.lifecycleCallbacks)).toEqual([])

    harness.client.stop()
  })

  it("automatically queues tracked model mutations and replays them", async () => {
    const TrackedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TrackedScan",
      sync: {
        localOnlyAttributes: ["localOnly"],
        syncType: (/** @type {{operation: string}} */ {operation}) => operation === "create" ? "scanAttempt" : "update",
        track: true
      }
    })
    const harness = buildHarness({modelClasses: [TrackedScan]})

    await harness.client.start()

    const record = buildScanRecord(TrackedScan)

    await triggerLifecycle(TrackedScan, "afterCreate", record)
    await harness.client.waitForScheduledReplay()

    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("scanAttempt")
    expect(harness.syncModel.rows[0].attributes.data).toEqual({accepted: true, ticketId: TICKET_ID})
    expect(harness.syncModel.rows[0].attributes.state).toEqual("success")
    expect(harness.postReplayCalls.length).toEqual(1)
  })

  it("tracks only the configured operations", async () => {
    const TrackedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TrackedScan",
      sync: {track: {operations: ["update"]}}
    })
    const harness = buildHarness({modelClasses: [TrackedScan]})

    await harness.client.start()

    expect(Object.keys(TrackedScan.lifecycleCallbacks)).toEqual(["afterUpdate"])
  })

  it("maps tracked destroys to delete sync rows", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildRecord(TrackedScan, SCAN_ID, {ticketId: TICKET_ID})

    await triggerLifecycle(TrackedScan, "afterDestroy", record)

    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("delete")
  })

  it("maps the upsert syncType flag to update and delete wire types", async () => {
    const TrackedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TrackedScan",
      sync: {syncType: "upsert", track: true}
    })
    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildRecord(TrackedScan, SCAN_ID, {ticketId: TICKET_ID})

    await triggerLifecycle(TrackedScan, "afterCreate", record)

    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("update")

    await triggerLifecycle(TrackedScan, "afterDestroy", record)

    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("delete")
  })

  it("rejects syncType strings other than upsert", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {syncType: "update"}})

    await expect(() => buildHarness({modelClasses: [TrackedScan]})).toThrow(/upsert/u)
  })

  it("uses trackedData to build tracked payloads", async () => {
    const TrackedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TrackedScan",
      sync: {
        track: true,
        trackedData: (/** @type {{operation: string, record: ?}} */ {operation, record}) => ({deviceId: "device-1", operation, ticketId: record.attributes().ticketId})
      }
    })
    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildRecord(TrackedScan, SCAN_ID, {ticketId: TICKET_ID})

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows[0].attributes.data).toEqual({deviceId: "device-1", operation: "update", ticketId: TICKET_ID})
  })

  it("does not queue tracked mutations for records written by pull-apply", async () => {
    /** @type {?} */
    let record = null
    const TrackedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TrackedScan",
      sync: {
        attributes: (/** @type {{data: Record<string, ?>}} */ {data}) => ({ticketId: data.ticketId}),
        findRecord: async () => record,
        track: true
      }
    })

    record = buildRecord(TrackedScan, SCAN_ID, {ticketId: TICKET_ID})
    record.assign = () => {}
    record.isChanged = () => true
    record.save = async () => {
      await triggerLifecycle(TrackedScan, "afterUpdate", record)
    }

    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.changesResponses.push({
      nextCursor: {id: "s-1", serverSequence: 1, updatedAt: "2026-07-01T10:00:00.000Z"},
      status: "success",
      syncs: [{data: {ticketId: TICKET_ID}, id: "s-1", resourceId: SCAN_ID, resourceType: "TrackedScan", syncType: "update"}],
      upToCursor: null
    })

    await harness.client.start()
    await harness.client.sync(fakeQuery("TrackedScan", {event_id: 5}))
    await harness.client.waitForScheduledReplay()

    expect(harness.syncModel.rows.length).toEqual(0)

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows.length).toEqual(1)
  })

  it("queues tracked mutations through the connection's afterCommit hook", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    /** @type {Array<() => Promise<void>>} */
    const afterCommitCallbacks = []

    TrackedScan.connection = () => ({
      /** @param {() => Promise<void>} callback - Deferred commit callback. @returns {Promise<void>} */
      afterCommit: async (callback) => {
        afterCommitCallbacks.push(callback)
      }
    })

    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildScanRecord(TrackedScan)

    await triggerLifecycle(TrackedScan, "afterCreate", record)

    expect(harness.syncModel.rows.length).toEqual(0)
    expect(afterCommitCallbacks.length).toEqual(1)

    await afterCommitCallbacks[0]()

    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.syncType).toEqual("create")

    harness.client.stop()
  })

  it("snapshots tracked payloads at mutation time before deferring to afterCommit", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    /** @type {Array<() => Promise<void>>} */
    const afterCommitCallbacks = []

    TrackedScan.connection = () => ({
      /** @param {() => Promise<void>} callback - Deferred commit callback. @returns {Promise<void>} */
      afterCommit: async (callback) => {
        afterCommitCallbacks.push(callback)
      }
    })

    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const attributes = {accepted: 1, localOnly: "internal", ticketId: TICKET_ID}
    const record = buildRecord(TrackedScan, SCAN_ID, attributes)

    await triggerLifecycle(TrackedScan, "afterCreate", record)

    // Simulates an afterSave hook assigning an unsaved attribute after the tracked callback ran.
    attributes.ticketId = "0ffbf58a-90b2-4c9c-97b1-14f5f0c68b09"

    for (const callback of afterCommitCallbacks) await callback()

    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.data).toEqual({accepted: true, localOnly: "internal", ticketId: TICKET_ID})

    harness.client.stop()
  })

  it("routes post-commit queue failures to onError and keeps later afterCommit callbacks running", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    /** @type {Array<() => Promise<void>>} */
    const afterCommitCallbacks = []

    TrackedScan.connection = () => ({
      /** @param {() => Promise<void>} callback - Deferred commit callback. @returns {Promise<void>} */
      afterCommit: async (callback) => {
        afterCommitCallbacks.push(callback)
      }
    })

    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const originalCreate = harness.syncModel.create
    let failNextCreate = true

    harness.syncModel.create = async (/** @type {Record<string, ?>} */ attributes) => {
      if (failNextCreate) {
        failNextCreate = false

        throw new Error("Local sync row write failed")
      }

      return await originalCreate(attributes)
    }

    const failingRecord = buildScanRecord(TrackedScan)
    const laterRecord = buildRecord(TrackedScan, TICKET_ID, {accepted: 0, localOnly: "internal", ticketId: TICKET_ID})

    await triggerLifecycle(TrackedScan, "afterCreate", failingRecord)
    await triggerLifecycle(TrackedScan, "afterUpdate", laterRecord)

    // Mimics the driver's committed-callback loop: a failure must not break later callbacks.
    for (const callback of afterCommitCallbacks) await callback()

    expect(harness.errors.map((/** @type {Error} */ error) => error.message)).toEqual(["Local sync row write failed"])
    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.resourceId).toEqual(TICKET_ID)

    harness.client.stop()
  })

  it("logs post-commit queue failures loudly without rethrowing when no onError is configured", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    const syncModel = buildFakeSyncModel()

    syncModel.create = async () => {
      throw new Error("Local sync row write failed")
    }

    const transport = {
      /** @returns {Promise<{json: () => Record<string, ?>}>} Response with json accessor. */
      post: async () => ({json: () => ({status: "success", syncs: []})})
    }
    const configuration = buildConfiguration({
      modelClasses: [TrackedScan],
      sync: {client: {authenticationToken: () => "token-1", isOnline: () => false, transport}}
    })
    const client = new SyncClient({configuration, syncModel})
    /** @type {Array<Array<?>>} */
    const loggedErrors = []

    client._logger = {
      /** @param {...?} messages - Logged error parts. @returns {Promise<void>} */
      error: async (...messages) => {
        loggedErrors.push(messages)
      }
    }

    await client.start()

    const record = buildScanRecord(TrackedScan)

    await triggerLifecycle(TrackedScan, "afterCreate", record)

    expect(loggedErrors.length).toEqual(1)
    expect(/** @type {Error} */ (loggedErrors[0][loggedErrors[0].length - 1]).message).toEqual("Local sync row write failed")
    expect(syncModel.rows.length).toEqual(0)

    client.stop()
  })

  it("suppresses tracked queueing inside withoutTracking across awaits and returns the callback result", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildScanRecord(TrackedScan)
    const result = await harness.client.withoutTracking(async () => {
      await triggerLifecycle(TrackedScan, "afterCreate", record)
      await Promise.resolve()
      await triggerLifecycle(TrackedScan, "afterUpdate", record)

      return "applied"
    })

    expect(result).toEqual("applied")
    expect(harness.syncModel.rows.length).toEqual(0)

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows.length).toEqual(1)

    harness.client.stop()
  })

  it("restores tracking when a withoutTracking callback throws and supports nesting", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildScanRecord(TrackedScan)

    await expect(async () => {
      await harness.client.withoutTracking(async () => {
        await harness.client.withoutTracking(async () => {
          await triggerLifecycle(TrackedScan, "afterCreate", record)
        })

        await triggerLifecycle(TrackedScan, "afterUpdate", record)

        throw new Error("Backfill failed")
      })
    }).toThrow(/Backfill failed/u)

    expect(harness.syncModel.rows.length).toEqual(0)

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows.length).toEqual(1)

    harness.client.stop()
  })

  it("suppresses tracked queueing for records marked as remote applies until released", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    const harness = buildHarness({modelClasses: [TrackedScan]})

    harness.state.online = false

    await harness.client.start()

    const record = buildScanRecord(TrackedScan)
    const release = harness.client.markRemoteApply(record)

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows.length).toEqual(0)

    release()

    await triggerLifecycle(TrackedScan, "afterUpdate", record)

    expect(harness.syncModel.rows.length).toEqual(1)

    harness.client.stop()
  })

  it("unregisters tracking callbacks when stopped", async () => {
    const TrackedScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TrackedScan", sync: {track: true}})
    const harness = buildHarness({modelClasses: [TrackedScan]})

    await harness.client.start()

    expect(TrackedScan.lifecycleCallbacks.afterCreate.length).toEqual(1)

    harness.client.stop()

    expect(TrackedScan.lifecycleCallbacks.afterCreate.length).toEqual(0)
    expect(TrackedScan.lifecycleCallbacks.afterUpdate.length).toEqual(0)
    expect(TrackedScan.lifecycleCallbacks.afterDestroy.length).toEqual(0)
  })

  it("fails loudly on invalid track configuration", async () => {
    const TrackedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TrackedScan",
      sync: {track: {operations: ["upsert"]}}
    })
    const harness = buildHarness({modelClasses: [TrackedScan]})

    await expect(async () => await harness.client.start()).toThrow(/track\.operations/u)
  })
})
