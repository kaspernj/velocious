// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, fakeQuery, triggerLifecycle} from "./sync-client-fakes.js"
import {buildFakeWebsocketClient} from "./sync-realtime-fakes.js"
import SyncClient from "../../src/sync/sync-client.js"

const DEVICE_ID = "6fa459ea-ee8a-3ca4-894e-db77e160355e"
const EVENT_ID = "a3bb189e-8bf9-3888-9912-ace4e6543002"
const OTHER_DEVICE_ID = "886313e1-3b8a-5372-9b90-0c9aee199e5d"
const SCAN_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"
const SECOND_SCAN_ID = "16fd2706-8baf-433b-82eb-8c7fada847da"

const SCAN_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "accepted", name: "accepted", type: "boolean"},
  {attributeName: "ticketNr", name: "ticket_nr", type: "varchar"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

/**
 * Flushes microtasks until a condition holds, failing loudly when it never does.
 * @param {() => boolean} condition - Condition to wait for.
 * @returns {Promise<void>}
 */
async function flushUntil(condition) {
  for (let flushCount = 0; flushCount < 100; flushCount++) {
    if (condition()) return

    await Promise.resolve()
  }

  throw new Error("Condition never became true while flushing microtasks")
}

/**
 * Builds a record for an applyable fake model class, mimicking the model layer's
 * assign/isChanged/save/destroy plus lifecycle callback firing on save.
 * @param {?} modelClass - Applyable fake model class.
 * @param {string} id - Record id.
 * @returns {?} Fake record.
 */
function buildApplyableRecord(modelClass, id) {
  const record = Object.create(modelClass.prototype)

  record.attributesData = /** @type {Record<string, ?>} */ ({id})
  record.pendingAttributes = /** @type {Record<string, ?> | null} */ (null)
  record.persisted = false
  record.id = () => id
  record.attributes = () => ({...record.attributesData})
  /** @param {Record<string, ?>} attributes - Assigned attributes. @returns {void} */
  record.assign = (attributes) => {
    record.pendingAttributes = attributes
  }
  record.isChanged = () => Boolean(record.pendingAttributes) && Object.entries(record.pendingAttributes).some(([name, value]) => record.attributesData[name] !== value)
  record.save = async () => {
    const wasPersisted = record.persisted

    Object.assign(record.attributesData, record.pendingAttributes)
    record.pendingAttributes = null
    record.persisted = true
    modelClass.records.set(id, record)

    await triggerLifecycle(modelClass, wasPersisted ? "afterUpdate" : "afterCreate", record)
  }
  record.destroy = async () => {
    modelClass.records.delete(id)

    await triggerLifecycle(modelClass, "afterDestroy", record)
  }

  return record
}

/**
 * Builds a fake model class that can receive applied changes through the default
 * find-or-initialize-by-id resolver.
 * @param {object} args - Model class args.
 * @param {Array<{attributeName: string, name: string, type: string}>} args.columns - Column fixtures.
 * @param {string} args.modelName - Stable model name.
 * @param {?} [args.sync] - Static sync declaration.
 * @returns {?} Applyable fake model class.
 */
function buildApplyableModelClass({columns, modelName, sync}) {
  const modelClass = buildMetadataModelClass({columns, modelName, sync})

  modelClass.records = new Map()
  /** @param {{id: string}} conditions - Lookup conditions. @returns {Promise<?>} Existing or initialized record. */
  modelClass.findOrInitializeBy = async ({id}) => modelClass.records.get(id) || buildApplyableRecord(modelClass, id)
  /** @param {{id: string}} conditions - Lookup conditions. @returns {Promise<?>} Existing record. */
  modelClass.findBy = async ({id}) => modelClass.records.get(id) || null

  return modelClass
}

/**
 * Builds a realtime sync client harness with a fake websocket client, a recording
 * transport, and an applyable tracked TicketScan model.
 * @param {object} [args] - Harness args.
 * @param {(context: ?) => Array<?> | Promise<Array<?>>} [args.channels] - Realtime channels callback.
 * @param {boolean} [args.deferConnect] - Defer the fake client's connect().
 * @param {boolean} [args.deferReady] - Defer each fake subscription's readiness.
 * @param {() => string | Promise<string>} [args.localOrigin] - Realtime local origin callback.
 * @param {Array<?>} [args.modelClasses] - Model classes to register.
 * @param {boolean} [args.pullOnReconnect] - Realtime pull-on-reconnect flag.
 * @param {?} [args.realtime] - Full realtime block override.
 * @param {Array<{conditions: Record<string, ?>, resourceType: string}>} [args.scopes] - Active pull scopes served by a fake scope store.
 * @param {?} [args.websocketClient] - Shared app-lifetime websocket client instance (sync.client.websocketClient); when set, no realtime.createClient is configured so the bridge rides the shared connection.
 * @returns {?} Harness with client, fakes, and recorded calls.
 */
function buildRealtimeHarness({channels, deferConnect, deferReady, localOrigin, modelClasses, pullOnReconnect, realtime, scopes, websocketClient} = {}) {
  /** @type {Array<Error>} */
  const errors = []
  /** @type {Array<Record<string, ?>>} */
  const postChangesCalls = []
  const fakeWebsocketClient = buildFakeWebsocketClient({deferConnect, deferReady})
  const syncModel = buildFakeSyncModel()
  const transport = {
    /** @param {string} path - Posted path. @param {Record<string, ?>} payload - Posted payload. @returns {Promise<{json: () => Record<string, ?>}>} Response with json accessor. */
    post: async (path, payload) => {
      if (path.endsWith("/changes")) postChangesCalls.push(payload)

      return {json: () => ({nextCursor: null, status: "success", syncs: [], upToCursor: null})}
    }
  }
  const resolvedModelClasses = modelClasses || [
    buildApplyableModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TicketScan",
      sync: {
        attributes: (/** @type {{data: Record<string, ?>}} */ {data}) => ({accepted: data.accepted, ticketNr: data.ticketNr}),
        track: true
      }
    })
  ]
  const resolvedRealtime = realtime !== undefined ? realtime : websocketClient ? {channels, localOrigin, pullOnReconnect} : {
    channels,
    createClient: () => fakeWebsocketClient,
    localOrigin,
    pullOnReconnect
  }
  const configuration = buildConfiguration({
    modelClasses: resolvedModelClasses,
    sync: {
      client: {
        authenticationToken: () => "token-1",
        onError: (/** @type {Error} */ error) => {
          errors.push(error)
        },
        realtime: resolvedRealtime,
        transport,
        websocketClient: websocketClient || undefined
      }
    }
  })
  const scopeStore = scopes ? /** @type {?} */ ({
    activeScopes: async () => scopes.map((scope) => ({...scope})),
    loadCursor: async () => null,
    saveCursor: async () => {}
  }) : undefined
  const client = new SyncClient({configuration, scopeStore, syncModel})

  return {client, errors, fakeWebsocketClient, modelClasses: resolvedModelClasses, postChangesCalls, syncModel}
}

describe("sync realtime bridge", () => {
  it("subscribes declared channels with the auth token injected, idempotently and single-flighted", async () => {
    /** @type {Array<?>} */
    const channelsContexts = []
    const harness = buildRealtimeHarness({
      channels: (/** @type {?} */ context) => {
        channelsContexts.push(context)

        return [{channel: "ticket-scans", params: {eventId: EVENT_ID}, resourceType: "TicketScan"}]
      }
    })

    expect(harness.client.realtimeStatus()).toEqual({channels: [], state: "unsubscribed"})

    const firstSubscribe = harness.client.subscribeRealtime({eventId: EVENT_ID})

    expect(harness.client.realtimeStatus().state).toEqual("subscribing")

    await Promise.all([firstSubscribe, harness.client.subscribeRealtime({eventId: EVENT_ID})])
    await harness.client.subscribeRealtime({eventId: EVENT_ID})

    expect(channelsContexts).toEqual([{eventId: EVENT_ID}])
    expect(harness.fakeWebsocketClient.connectCalls).toEqual(1)
    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(1)
    expect(harness.fakeWebsocketClient.subscriptions[0].channelType).toEqual("ticket-scans")
    expect(harness.fakeWebsocketClient.subscriptions[0].params).toEqual({authenticationToken: "token-1", eventId: EVENT_ID})
    expect(harness.client.realtimeStatus()).toEqual({
      channels: [{channel: "ticket-scans", ready: true, resourceType: "TicketScan"}],
      state: "subscribed"
    })
  })

  it("unsubscribes idempotently and can resubscribe afterwards", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}]
    })

    await harness.client.subscribeRealtime()
    await harness.client.unsubscribeRealtime()
    await harness.client.unsubscribeRealtime()

    expect(harness.fakeWebsocketClient.subscriptions[0].closed).toEqual(true)
    expect(harness.fakeWebsocketClient.disconnectCalls).toEqual(1)
    expect(harness.client.realtimeStatus()).toEqual({channels: [], state: "unsubscribed"})

    await harness.client.subscribeRealtime()

    expect(harness.fakeWebsocketClient.connectCalls).toEqual(2)
    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(2)
    expect(harness.client.realtimeStatus().state).toEqual("subscribed")
  })

  it("applies pushed messages through the derived applier without re-queueing tracked records", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}]
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.start()
    await harness.client.subscribeRealtime()

    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      data: {accepted: true, ticketNr: "T-1"},
      resourceId: SCAN_ID,
      syncType: "update"
    })

    await harness.client.waitForRealtimeApplied()

    const appliedRecord = ticketScanClass.records.get(SCAN_ID)

    expect(appliedRecord.attributesData).toEqual({accepted: true, id: SCAN_ID, ticketNr: "T-1"})
    expect(harness.syncModel.rows.length).toEqual(0)
    expect(harness.errors).toEqual([])

    appliedRecord.assign({accepted: false})
    await appliedRecord.save()
    await harness.client.waitForScheduledReplay()

    expect(harness.syncModel.rows.length).toEqual(1)
    expect(harness.syncModel.rows[0].attributes.data).toEqual({accepted: false, ticketNr: "T-1"})

    harness.client.stop()
  })

  it("applies batched syncs arrays in order", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}]
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.subscribeRealtime()

    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      syncs: [
        {data: {accepted: true, ticketNr: "T-1"}, resourceId: SCAN_ID, syncType: "update"},
        {data: {accepted: false, ticketNr: "T-2"}, resourceId: SECOND_SCAN_ID, syncType: "update"},
        {data: {accepted: false, ticketNr: "T-1"}, resourceId: SCAN_ID, syncType: "update"}
      ]
    })

    await harness.client.waitForRealtimeApplied()

    expect(ticketScanClass.records.get(SCAN_ID).attributesData.accepted).toEqual(false)
    expect(ticketScanClass.records.get(SECOND_SCAN_ID).attributesData.ticketNr).toEqual("T-2")
    expect(harness.errors).toEqual([])
  })

  it("drops messages whose echo origin matches the configured local origin", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}],
      localOrigin: () => DEVICE_ID
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.subscribeRealtime()

    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      data: {accepted: true, ticketNr: "T-1"},
      echoOrigin: DEVICE_ID,
      resourceId: SCAN_ID,
      syncType: "update"
    })
    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      data: {accepted: true, ticketNr: "T-2"},
      echoOrigin: OTHER_DEVICE_ID,
      resourceId: SECOND_SCAN_ID,
      syncType: "update"
    })

    await harness.client.waitForRealtimeApplied()

    expect(ticketScanClass.records.has(SCAN_ID)).toEqual(false)
    expect(ticketScanClass.records.get(SECOND_SCAN_ID).attributesData.ticketNr).toEqual("T-2")
    expect(harness.errors).toEqual([])
  })

  it("fails loudly when a pushed change has no applyable resource", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}]
    })

    await harness.client.subscribeRealtime()

    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      data: {name: "Someone"},
      resourceId: SCAN_ID,
      resourceType: "Customer",
      syncType: "update"
    })

    await harness.client.waitForRealtimeApplied()

    expect(harness.errors.length).toEqual(1)
    expect(harness.errors[0].message).toMatch(/No sync resource with pull attributes configured for remote change: Customer/u)
  })

  it("coalesces pull-on-reconnect resumes into a single pull", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [
        {channel: "ticket-scans", resourceType: "TicketScan"},
        {channel: "frontend-models", resourceType: "TicketScan"}
      ]
    })

    await harness.client.sync(fakeQuery("TicketScan", {event_id: EVENT_ID}))

    expect(harness.postChangesCalls.length).toEqual(1)

    await harness.client.subscribeRealtime()
    await harness.client.waitForRealtimeApplied()

    const postsAfterSubscribe = harness.postChangesCalls.length

    harness.fakeWebsocketClient.subscriptions[0].emitResume()
    harness.fakeWebsocketClient.subscriptions[1].emitResume()

    await harness.client.waitForRealtimeApplied()

    expect(harness.postChangesCalls.length).toEqual(postsAfterSubscribe + 1)
    expect(harness.errors).toEqual([])
  })

  it("pulls once when the subscription becomes ready to close offline gaps", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}]
    })

    await harness.client.sync(fakeQuery("TicketScan", {event_id: EVENT_ID}))
    await harness.client.subscribeRealtime()
    await harness.client.waitForRealtimeApplied()

    expect(harness.postChangesCalls.length).toEqual(2)
  })

  it("waits for channel readiness before the gap-closing pull and keeps pushes arriving before readiness", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}],
      deferReady: true
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.sync(fakeQuery("TicketScan", {event_id: EVENT_ID}))

    const subscribePromise = harness.client.subscribeRealtime()

    // The declared scope derives a framework sync channel subscription beside the legacy ticket-scans channel.
    await flushUntil(() => harness.fakeWebsocketClient.subscriptions.length === 2)

    const ticketScansSubscription = harness.fakeWebsocketClient.subscriptions.find((/** @type {{channelType: string}} */ subscription) => subscription.channelType === "ticket-scans")

    ticketScansSubscription.emitMessage({
      data: {accepted: true, ticketNr: "T-1"},
      resourceId: SCAN_ID,
      syncType: "update"
    })

    await harness.client.waitForRealtimeApplied()

    expect(harness.client.realtimeStatus().state).toEqual("subscribing")
    expect(harness.postChangesCalls.length).toEqual(1)
    expect(ticketScanClass.records.get(SCAN_ID).attributesData.ticketNr).toEqual("T-1")

    for (const subscription of harness.fakeWebsocketClient.subscriptions) {
      subscription.resolveReady()
    }

    await subscribePromise
    await harness.client.waitForRealtimeApplied()

    expect(harness.client.realtimeStatus().state).toEqual("subscribed")
    expect(harness.postChangesCalls.length).toEqual(2)
    expect(harness.errors).toEqual([])
  })

  it("aborts an in-flight subscribe when unsubscribed while connecting", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}],
      deferConnect: true
    })

    const subscribePromise = harness.client.subscribeRealtime()

    await flushUntil(() => harness.fakeWebsocketClient.connectCalls === 1)
    await harness.client.unsubscribeRealtime()

    harness.fakeWebsocketClient.resolveConnect()

    await subscribePromise
    await harness.client.waitForRealtimeApplied()

    expect(harness.client.realtimeStatus()).toEqual({channels: [], state: "unsubscribed"})
    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(0)
    expect(harness.fakeWebsocketClient.disconnectCalls).toEqual(1)
    expect(harness.postChangesCalls.length).toEqual(0)
  })

  it("fails loudly when channel params try to supply their own authenticationToken", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", params: {authenticationToken: "stale-token"}, resourceType: "TicketScan"}]
    })

    await expect(async () => await harness.client.subscribeRealtime()).toThrow(/authenticationToken/u)
    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(0)
    expect(harness.client.realtimeStatus().state).toEqual("unsubscribed")
  })

  it("skips pull-on-reconnect when disabled", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", resourceType: "TicketScan"}],
      pullOnReconnect: false
    })

    await harness.client.sync(fakeQuery("TicketScan", {event_id: EVENT_ID}))
    await harness.client.subscribeRealtime()

    harness.fakeWebsocketClient.subscriptions[0].emitResume()

    await harness.client.waitForRealtimeApplied()

    expect(harness.postChangesCalls.length).toEqual(1)
  })

  it("derives static realtime channels from model sync declarations", async () => {
    const harness = buildRealtimeHarness({
      modelClasses: [
        buildApplyableModelClass({
          columns: SCAN_COLUMNS,
          modelName: "TicketScan",
          sync: {
            attributes: (/** @type {{data: Record<string, ?>}} */ {data}) => ({ticketNr: data.ticketNr}),
            realtime: {channel: "ticket-scans", params: {scope: "all"}}
          }
        })
      ]
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.subscribeRealtime()

    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(1)
    expect(harness.fakeWebsocketClient.subscriptions[0].channelType).toEqual("ticket-scans")
    expect(harness.fakeWebsocketClient.subscriptions[0].params).toEqual({authenticationToken: "token-1", scope: "all"})

    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      data: {ticketNr: "T-1"},
      resourceId: SCAN_ID,
      syncType: "update"
    })

    await harness.client.waitForRealtimeApplied()

    expect(ticketScanClass.records.get(SCAN_ID).attributesData.ticketNr).toEqual("T-1")
    expect(harness.errors).toEqual([])
  })

  it("auto-subscribes every declared pull scope to the framework sync channel with only createClient configured", async () => {
    const harness = buildRealtimeHarness({
      modelClasses: [
        buildApplyableModelClass({
          columns: SCAN_COLUMNS,
          modelName: "TicketScan",
          sync: {
            attributes: (/** @type {{data: Record<string, ?>}} */ {data}) => ({accepted: data.accepted, ticketNr: data.ticketNr}),
            track: true
          }
        }),
        buildApplyableModelClass({columns: SCAN_COLUMNS, modelName: "Device", sync: true})
      ],
      scopes: [
        {conditions: {eventId: EVENT_ID}, resourceType: "TicketScan"},
        {conditions: {partnerId: 7}, resourceType: "Device"}
      ]
    })

    await harness.client.subscribeRealtime()

    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(2)
    expect(harness.fakeWebsocketClient.subscriptions[0].channelType).toEqual("velocious-sync")
    expect(harness.fakeWebsocketClient.subscriptions[0].params).toEqual({
      authenticationToken: "token-1",
      conditions: {eventId: EVENT_ID},
      resourceType: "TicketScan"
    })
    expect(harness.fakeWebsocketClient.subscriptions[1].channelType).toEqual("velocious-sync")
    expect(harness.fakeWebsocketClient.subscriptions[1].params).toEqual({
      authenticationToken: "token-1",
      conditions: {partnerId: 7},
      resourceType: "Device"
    })
    expect(harness.errors).toEqual([])
  })

  it("applies framework sync channel envelopes through the derived resource applier", async () => {
    const harness = buildRealtimeHarness({
      scopes: [{conditions: {eventId: EVENT_ID}, resourceType: "TicketScan"}]
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.subscribeRealtime()

    harness.fakeWebsocketClient.subscriptions[0].emitMessage({
      echoOrigin: null,
      syncs: [{
        data: {accepted: true, ticketNr: "T-1"},
        resourceId: SCAN_ID,
        resourceType: "TicketScan",
        syncType: "update"
      }]
    })

    await harness.client.waitForRealtimeApplied()

    expect(ticketScanClass.records.get(SCAN_ID).attributesData.ticketNr).toEqual("T-1")
    expect(harness.errors).toEqual([])
  })

  it("subscribes persisted column-named scope conditions under attribute names so they match the publisher's scoping params", async () => {
    // serializedScopeFromQuery persists model-normalized column names (ticket_nr),
    // while the publisher broadcasts attribute-named scoping params (ticketNr).
    const harness = buildRealtimeHarness({
      scopes: [{conditions: {ticket_nr: "T-1"}, resourceType: "TicketScan"}]
    })

    await harness.client.subscribeRealtime()

    expect(harness.fakeWebsocketClient.subscriptions[0].params).toEqual({
      authenticationToken: "token-1",
      conditions: {ticketNr: "T-1"},
      resourceType: "TicketScan"
    })
    expect(harness.errors).toEqual([])
  })

  it("fails loudly when a declared scope's resourceType has no declared sync resource", async () => {
    const harness = buildRealtimeHarness({
      scopes: [{conditions: {eventId: EVENT_ID}, resourceType: "UndeclaredThing"}]
    })

    await expect(async () => await harness.client.subscribeRealtime()).toThrow(/UndeclaredThing/u)
  })

  it("subscribes deprecated channels callbacks alongside the scope-derived framework subscriptions", async () => {
    const harness = buildRealtimeHarness({
      channels: () => [{channel: "ticket-scans", params: {eventId: EVENT_ID}, resourceType: "TicketScan"}],
      scopes: [{conditions: {eventId: EVENT_ID}, resourceType: "TicketScan"}]
    })

    await harness.client.subscribeRealtime()

    expect(harness.fakeWebsocketClient.subscriptions.length).toEqual(2)
    expect(harness.fakeWebsocketClient.subscriptions[0].channelType).toEqual("velocious-sync")
    expect(harness.fakeWebsocketClient.subscriptions[1].channelType).toEqual("ticket-scans")
  })

  it("fails loudly when subscribeRealtime is called without a realtime configuration block", async () => {
    const harness = buildRealtimeHarness({realtime: null})

    await expect(async () => await harness.client.subscribeRealtime()).toThrow(/sync\.client\.realtime.*createClient/u)
  })

  it("fails loudly when no scopes are declared and no legacy channels are configured", async () => {
    const harness = buildRealtimeHarness()

    await expect(async () => await harness.client.subscribeRealtime()).toThrow(/declare a sync scope/u)
  })

  it("rides a shared connection across subscribe/unsubscribe cycles without disconnecting the socket", async () => {
    const sharedClient = buildFakeWebsocketClient()
    const harness = buildRealtimeHarness({
      scopes: [{conditions: {eventId: EVENT_ID}, resourceType: "TicketScan"}],
      websocketClient: sharedClient
    })

    await harness.client.subscribeRealtime()

    const firstSubscription = sharedClient.subscriptions[0]

    expect(firstSubscription.channelType).toEqual("velocious-sync")

    await harness.client.unsubscribeRealtime()

    expect(firstSubscription.closed).toEqual(true)
    expect(sharedClient.disconnectCalls).toEqual(0)

    await harness.client.subscribeRealtime()

    expect(sharedClient.disconnectCalls).toEqual(0)
    expect(sharedClient.subscriptions.length).toEqual(2)
    expect(harness.client.syncConnection()).toBe(sharedClient)
    expect(harness.client.realtimeStatus().state).toEqual("subscribed")
    expect(harness.errors).toEqual([])
  })

  it("applies pushes arriving over the shared connection through the derived applier", async () => {
    const sharedClient = buildFakeWebsocketClient()
    const harness = buildRealtimeHarness({
      scopes: [{conditions: {eventId: EVENT_ID}, resourceType: "TicketScan"}],
      websocketClient: sharedClient
    })
    const ticketScanClass = harness.modelClasses[0]

    await harness.client.subscribeRealtime()

    sharedClient.subscriptions[0].emitMessage({
      echoOrigin: null,
      syncs: [{data: {accepted: true, ticketNr: "T-1"}, resourceId: SCAN_ID, resourceType: "TicketScan", syncType: "update"}]
    })

    await harness.client.waitForRealtimeApplied()

    expect(ticketScanClass.records.get(SCAN_ID).attributesData.ticketNr).toEqual("T-1")
    expect(sharedClient.connectCalls).toBeGreaterThanOrEqual(1)
    expect(harness.errors).toEqual([])
  })
})

describe("sync client user scope", () => {
  it("subscribes the server-enumerated user scope over the shared connection and pulls it with empty conditions", async () => {
    const sharedClient = buildFakeWebsocketClient()
    const harness = buildRealtimeHarness({pullOnReconnect: false, websocketClient: sharedClient})

    await harness.client.subscribeUserScope()

    expect(sharedClient.subscriptions.length).toEqual(1)
    expect(sharedClient.subscriptions[0].channelType).toEqual("velocious-sync")
    expect(sharedClient.subscriptions[0].params).toEqual({authenticationToken: "token-1", conditions: {}, resourceType: "TicketScan"})
    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.postChangesCalls[0].scope).toEqual({conditions: {}, resourceType: "TicketScan"})
    expect(harness.errors).toEqual([])
  })

  it("is idempotent and single-flighted", async () => {
    const sharedClient = buildFakeWebsocketClient()
    const harness = buildRealtimeHarness({pullOnReconnect: false, websocketClient: sharedClient})

    await Promise.all([harness.client.subscribeUserScope(), harness.client.subscribeUserScope()])
    await harness.client.subscribeUserScope()

    expect(sharedClient.subscriptions.length).toEqual(1)
    expect(harness.postChangesCalls.length).toEqual(1)
    expect(harness.errors).toEqual([])
  })

  it("continues the per-scope cursor across a resubscribe (sign-out then sign-in) so it does not re-pull everything", async () => {
    const sharedClient = buildFakeWebsocketClient()
    const harness = buildRealtimeHarness({pullOnReconnect: false, websocketClient: sharedClient})

    harness.postChangesCalls.length = 0

    await harness.client.subscribeUserScope()

    expect(harness.postChangesCalls[0].afterServerSequence).toBeUndefined()

    // The changes response advances the scope cursor; the next pull must resume from it.
    await harness.client.unsubscribeUserScope()
    await harness.client.subscribeUserScope()

    expect(harness.postChangesCalls.length).toEqual(2)
    expect(harness.postChangesCalls[1].scope).toEqual({conditions: {}, resourceType: "TicketScan"})
    expect(harness.errors).toEqual([])
  })

  it("unsubscribes on sign-out by closing subscriptions without disconnecting, then resubscribes over the same socket", async () => {
    const sharedClient = buildFakeWebsocketClient()
    const harness = buildRealtimeHarness({pullOnReconnect: false, websocketClient: sharedClient})

    await harness.client.subscribeUserScope()

    const subscription = sharedClient.subscriptions[0]

    await harness.client.unsubscribeUserScope()

    expect(subscription.closed).toEqual(true)
    expect(sharedClient.disconnectCalls).toEqual(0)

    await harness.client.subscribeUserScope()

    expect(sharedClient.disconnectCalls).toEqual(0)
    expect(sharedClient.subscriptions.length).toEqual(2)
    expect(harness.client.syncConnection()).toBe(sharedClient)
    expect(harness.errors).toEqual([])
  })
})
