// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {DEVICE_COLUMNS, SCAN_COLUMNS, buildConfiguration, buildMetadataModelClass, buildRecord, triggerLifecycle} from "./sync-client-fakes.js"
import SyncPublisher from "../../src/sync/sync-publisher.js"
import {VELOCIOUS_SYNC_CHANNEL} from "../../src/sync/sync-channel-name.js"

/** Column fixtures for an account-scoped model carrying its own accountId column. */
const ACCOUNT_SCOPED_COLUMNS = [
  ...SCAN_COLUMNS,
  {attributeName: "accountId", name: "account_id", type: "uuid"}
]

const ACCOUNT_ID = "a3bb189e-8bf9-3888-9912-ace4e6543002"
const SCAN_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"

/**
 * Builds a publisher with a recording broadcaster for one published model class.
 * @param {{modelClass: ?, scopeAttributes?: string[]}} args - Published model class and the sync model's declared scope attributes.
 * @returns {{broadcasts: Array<{body: ?, channel: string, params: Record<string, ?>}>, publisher: SyncPublisher, syncModel: ?}} Publisher harness.
 */
function buildBroadcastingPublisher({modelClass, scopeAttributes}) {
  /** @type {Array<{body: ?, channel: string, params: Record<string, ?>}>} */
  const broadcasts = []
  const syncModel = buildFakeServerSyncModel({scopeAttributes})
  const publisher = new SyncPublisher({
    broadcaster: async (broadcast) => {
      broadcasts.push(broadcast)
    },
    configuration: buildConfiguration({modelClasses: [modelClass], sync: {}}),
    syncModel
  })

  return {broadcasts, publisher, syncModel}
}

/**
 * Builds a fake server sync/change model implementing the shared Sync-row
 * upsert contract (where().first(), create, assign/advanceServerSequence/save)
 * while recording rows and sequence advances.
 * @param {object} [args] - Sync model args.
 * @param {string[]} [args.scopeAttributes] - Declared static syncScopeAttributes.
 * @returns {?} Fake server sync model with a rows array.
 */
function buildFakeServerSyncModel({scopeAttributes} = {}) {
  /** @type {Array<?>} */
  const rows = []

  return {
    /** @returns {Record<string, string>} Attribute-to-column map like a real model class. */
    getAttributeNameToColumnNameMap: () => ({accountId: "account_id", eventId: "event_id"}),
    syncScopeAttributes: scopeAttributes,
    /** @param {Record<string, ?>} attributes - Row attributes. @returns {Promise<?>} Created row. */
    create: async (attributes) => {
      const row = {
        advanceServerSequenceCalls: 0,
        /** @returns {Promise<void>} Advances the fake server sequence. */
        advanceServerSequence: async () => {
          row.advanceServerSequenceCalls++
        },
        /** @param {Record<string, ?>} newAttributes - Assigned attributes. @returns {void} */
        assign: (newAttributes) => {
          Object.assign(row.attributes, newAttributes)
        },
        attributes,
        /** @returns {Promise<void>} Saves the fake row. */
        save: async () => {
          row.saveCalls++
        },
        saveCalls: 0
      }

      rows.push(row)

      return row
    },
    rows,
    /** @param {Record<string, ?>} conditions - Where conditions. @returns {{first: () => Promise<?>}} Chainable query. */
    where: (conditions) => ({
      first: async () => rows.find((row) =>
        row.attributes.resource_id === conditions.resource_id &&
        row.attributes.resource_type === conditions.resource_type &&
        row.attributes.authentication_token_id === conditions.authentication_token_id) || null
    })
  }
}

describe("sync publisher from configuration", () => {
  it("derives published resources from static sync publish declarations and skips opted-out models", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {serialize: (/** @type {?} */ scan) => ({id: scan.id()})}}
    })
    const OptedOut = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "OptedOut", sync: {publish: false, track: true}})
    const ClientOnly = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "ClientOnly", sync: true})
    const configuration = buildConfiguration({modelClasses: [PublishedScan, OptedOut, ClientOnly], sync: {}})
    const publisher = new SyncPublisher({configuration, syncModel: buildFakeServerSyncModel()})

    await publisher.start()

    expect(Object.keys(publisher.config.resources)).toEqual(["PublishedScan"])
    expect(publisher.config.resources.PublishedScan.operations).toEqual(["create", "update"])
    expect(Object.keys(PublishedScan.lifecycleCallbacks)).toEqual(["afterCreate", "afterUpdate"])
    expect(Object.keys(OptedOut.lifecycleCallbacks)).toEqual([])
    expect(Object.keys(ClientOnly.lifecycleCallbacks)).toEqual([])
  })

  it("persists the published payload, event scope, and server-origin actor row through the sync model", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {
        publish: {
          eventId: (/** @type {?} */ scan) => scan.attributes().eventId,
          resourceType: "TicketScan",
          serialize: (/** @type {?} */ scan) => ({id: scan.id(), ticketNr: scan.attributes().ticketNr})
        }
      }
    })
    const configuration = buildConfiguration({modelClasses: [PublishedScan], sync: {}})
    const syncModel = buildFakeServerSyncModel()
    const publisher = new SyncPublisher({configuration, syncModel})

    await publisher.start()

    const record = buildRecord(PublishedScan, "0f8fad5b-d9cb-469f-a165-70867728950e", {
      eventId: "a3bb189e-8bf9-3888-9912-ace4e6543002",
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      ticketNr: "T-1"
    })

    await triggerLifecycle(PublishedScan, "afterCreate", record)

    expect(syncModel.rows).toHaveLength(1)
    expect(syncModel.rows[0].attributes.authentication_token_id).toEqual(null)
    expect(syncModel.rows[0].attributes.event_id).toEqual("a3bb189e-8bf9-3888-9912-ace4e6543002")
    expect(syncModel.rows[0].attributes.resource_id).toEqual("0f8fad5b-d9cb-469f-a165-70867728950e")
    expect(syncModel.rows[0].attributes.resource_type).toEqual("TicketScan")
    expect(syncModel.rows[0].attributes.sync_type).toEqual("update")
    expect(JSON.parse(syncModel.rows[0].attributes.data)).toEqual({id: "0f8fad5b-d9cb-469f-a165-70867728950e", ticketNr: "T-1"})

    await triggerLifecycle(PublishedScan, "afterUpdate", record)

    expect(syncModel.rows).toHaveLength(1)
    expect(syncModel.rows[0].advanceServerSequenceCalls).toEqual(1)
    expect(syncModel.rows[0].saveCalls).toEqual(1)
  })

  it("broadcasts the standard sync envelope on the framework sync channel scoped by the sync model's declared scope attributes", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: ACCOUNT_SCOPED_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {serialize: (/** @type {?} */ scan) => ({id: scan.id(), ticketNr: scan.readAttribute("ticketNr")})}}
    })
    const {broadcasts, publisher, syncModel} = buildBroadcastingPublisher({modelClass: PublishedScan, scopeAttributes: ["accountId"]})

    await publisher.start()

    const record = buildRecord(PublishedScan, SCAN_ID, {accountId: ACCOUNT_ID, id: SCAN_ID, ticketNr: "T-1"})

    await triggerLifecycle(PublishedScan, "afterCreate", record)

    expect(syncModel.rows).toHaveLength(1)
    expect(syncModel.rows[0].attributes.account_id).toEqual(ACCOUNT_ID)
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].channel).toEqual(VELOCIOUS_SYNC_CHANNEL)
    expect(broadcasts[0].params).toEqual({accountId: ACCOUNT_ID})
    expect(broadcasts[0].body).toEqual({
      echoOrigin: null,
      syncs: [{
        data: {id: SCAN_ID, ticketNr: "T-1"},
        resourceId: SCAN_ID,
        resourceType: "PublishedScan",
        syncType: "update"
      }]
    })
  })

  it("scopes scope-root models without the scope attribute by their own id", async () => {
    const PublishedAccount = buildMetadataModelClass({
      columns: DEVICE_COLUMNS,
      modelName: "PublishedAccount",
      sync: {publish: {serialize: (/** @type {?} */ account) => ({id: account.id()})}}
    })
    const {broadcasts, publisher, syncModel} = buildBroadcastingPublisher({modelClass: PublishedAccount, scopeAttributes: ["accountId"]})

    await publisher.start()
    await triggerLifecycle(PublishedAccount, "afterCreate", buildRecord(PublishedAccount, ACCOUNT_ID, {id: ACCOUNT_ID}))

    expect(syncModel.rows[0].attributes.account_id).toEqual(ACCOUNT_ID)
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].channel).toEqual(VELOCIOUS_SYNC_CHANNEL)
    expect(broadcasts[0].params).toEqual({accountId: ACCOUNT_ID})
  })

  it("scopes through declared per-model scopeAttributes record-attribute overrides", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {scopeAttributes: {accountId: "ticketNr"}, serialize: (/** @type {?} */ scan) => ({id: scan.id()})}}
    })
    const {broadcasts, publisher, syncModel} = buildBroadcastingPublisher({modelClass: PublishedScan, scopeAttributes: ["accountId"]})

    await publisher.start()
    await triggerLifecycle(PublishedScan, "afterCreate", buildRecord(PublishedScan, SCAN_ID, {id: SCAN_ID, ticketNr: "T-9"}))

    expect(syncModel.rows[0].attributes.account_id).toEqual("T-9")
    expect(broadcasts[0].params).toEqual({accountId: "T-9"})
  })

  it("persists no scope partition and broadcasts empty scoping params when the sync model declares no scope attributes", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {serialize: (/** @type {?} */ scan) => ({id: scan.id()})}}
    })
    const {broadcasts, publisher, syncModel} = buildBroadcastingPublisher({modelClass: PublishedScan})

    await publisher.start()
    await triggerLifecycle(PublishedScan, "afterCreate", buildRecord(PublishedScan, SCAN_ID, {id: SCAN_ID}))

    expect("event_id" in syncModel.rows[0].attributes).toEqual(false)
    expect("account_id" in syncModel.rows[0].attributes).toEqual(false)
    expect(broadcasts[0].channel).toEqual(VELOCIOUS_SYNC_CHANNEL)
    expect(broadcasts[0].params).toEqual({})
  })

  it("keeps the deprecated eventId declaration forms on the 1.0.503 event_id column and eventId scoping param", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {eventId: "ticketNr", serialize: (/** @type {?} */ scan) => ({id: scan.id()})}}
    })
    const {broadcasts, publisher, syncModel} = buildBroadcastingPublisher({modelClass: PublishedScan})

    await publisher.start()
    await triggerLifecycle(PublishedScan, "afterCreate", buildRecord(PublishedScan, SCAN_ID, {id: SCAN_ID, ticketNr: "T-9"}))

    expect(syncModel.rows[0].attributes.event_id).toEqual("T-9")
    expect(broadcasts[0].params).toEqual({eventId: "T-9"})
  })

  it("publishes record attributes with ISO dates through the default serializer when declared publish: true", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: ACCOUNT_SCOPED_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: true}
    })
    const {broadcasts, publisher, syncModel} = buildBroadcastingPublisher({modelClass: PublishedScan, scopeAttributes: ["accountId"]})

    await publisher.start()

    const scannedAt = new Date("2026-07-06T10:20:30.000Z")

    await triggerLifecycle(PublishedScan, "afterCreate", buildRecord(PublishedScan, SCAN_ID, {accountId: ACCOUNT_ID, id: SCAN_ID, scannedAt, ticketNr: "T-1"}))

    expect(JSON.parse(syncModel.rows[0].attributes.data)).toEqual({
      accountId: ACCOUNT_ID,
      id: SCAN_ID,
      scannedAt: "2026-07-06T10:20:30.000Z",
      ticketNr: "T-1"
    })
    expect(broadcasts[0].body.syncs[0].data.scannedAt).toEqual("2026-07-06T10:20:30.000Z")
  })

  it("still delivers deprecated declared broadcasts after the framework sync channel broadcast", async () => {
    const PublishedScan = buildMetadataModelClass({
      columns: ACCOUNT_SCOPED_COLUMNS,
      modelName: "PublishedScan",
      sync: {
        publish: {
          broadcasts: [{
            body: (/** @type {import("../../src/sync/sync-publisher-types.js").SyncPublishBroadcastArgs} */ args) => ({syncType: args.syncType}),
            broadcastParams: (/** @type {import("../../src/sync/sync-publisher-types.js").SyncPublishBroadcastArgs} */ args) => ({resourceId: args.resourceId}),
            channel: "legacy-scans"
          }],
          serialize: (/** @type {?} */ scan) => ({id: scan.id()})
        }
      }
    })
    const {broadcasts, publisher} = buildBroadcastingPublisher({modelClass: PublishedScan, scopeAttributes: ["accountId"]})

    await publisher.start()
    await triggerLifecycle(PublishedScan, "afterCreate", buildRecord(PublishedScan, SCAN_ID, {accountId: ACCOUNT_ID, id: SCAN_ID}))

    expect(broadcasts).toHaveLength(2)
    expect(broadcasts[0].channel).toEqual(VELOCIOUS_SYNC_CHANNEL)
    expect(broadcasts[1].channel).toEqual("legacy-scans")
    expect(broadcasts[1].params).toEqual({resourceId: SCAN_ID})
  })

  it("rejects invalid publish declarations loudly", async () => {
    /** @param {?} publish - Publish declaration under test. @param {string[]} [scopeAttributes] - Sync model scope attributes. @returns {SyncPublisher} Built publisher. */
    const buildWithPublish = (publish, scopeAttributes) => {
      const Invalid = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "Invalid", sync: {publish}})

      return new SyncPublisher({configuration: buildConfiguration({modelClasses: [Invalid], sync: {}}), syncModel: buildFakeServerSyncModel({scopeAttributes})})
    }

    await expect(() => buildWithPublish("yes")).toThrow(/Invalid static sync publish must be true, false or a publish declaration object/u)
    await expect(() => buildWithPublish({serialize: "nope"})).toThrow(/serialize must be a function/u)
    await expect(() => buildWithPublish({eventId: 5})).toThrow(/eventId must be an attribute-name string/u)
    await expect(() => buildWithPublish({eventId: "batteryLevelPercent", scopeAttributes: {accountId: "id"}})).toThrow(/can't declare both scopeAttributes and the deprecated eventId form/u)
    await expect(() => buildWithPublish({scopeAttributes: {accountId: "id"}})).toThrow(/declares scopeAttributes but the sync model declares no static syncScopeAttributes/u)
    await expect(() => buildWithPublish({scopeAttributes: {nopeId: "id"}}, ["accountId"])).toThrow(/scopeAttributes received unknown scope attribute: nopeId/u)
    await expect(() => buildWithPublish({scopeAttributes: {accountId: "nope"}}, ["accountId"])).toThrow(/scopeAttributes\.accountId must name an existing record attribute/u)
    await expect(() => buildWithPublish({nope: true, serialize: () => ({})})).toThrow(/received unknown keys: nope/u)
    await expect(() => buildWithPublish({operations: [], serialize: () => ({})})).toThrow(/operations must be a non-empty array/u)
    await expect(() => buildWithPublish({operations: ["upsert"], serialize: () => ({})})).toThrow(/operations must be create\/update\/destroy, got: upsert/u)
  })

  it("requires publish declarations and a sync model", async () => {
    const ClientOnly = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "ClientOnly", sync: true})

    await expect(() => SyncPublisher.fromConfiguration(buildConfiguration({modelClasses: [ClientOnly], sync: {}})))
      .toThrow(/SyncPublisher found no registered models declaring static sync publish/u)

    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {serialize: (/** @type {?} */ scan) => ({id: scan.id()})}}
    })

    await expect(() => SyncPublisher.fromConfiguration(buildConfiguration({modelClasses: [PublishedScan], sync: {}})))
      .toThrow(/SyncPublisher requires a registered "Sync" model/u)
  })

  it("starts once per configuration from server boot and no-ops without publish declarations", async () => {
    const ClientOnly = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "ClientOnly", sync: true})

    expect(await SyncPublisher.startFromConfiguration(buildConfiguration({modelClasses: [ClientOnly], sync: {}}))).toEqual(null)

    const PublishedScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "PublishedScan",
      sync: {publish: {serialize: (/** @type {?} */ scan) => ({id: scan.id()})}}
    })
    const Sync = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "Sync"})
    const configuration = buildConfiguration({modelClasses: [PublishedScan, Sync], sync: {}})
    const publisher = await SyncPublisher.startFromConfiguration(configuration)

    expect(publisher).toBeInstanceOf(SyncPublisher)
    expect(PublishedScan.lifecycleCallbacks.afterCreate).toHaveLength(1)
    expect(PublishedScan.lifecycleCallbacks.afterUpdate).toHaveLength(1)

    expect(await SyncPublisher.startFromConfiguration(configuration)).toEqual(publisher)
    expect(PublishedScan.lifecycleCallbacks.afterCreate).toHaveLength(1)
    expect(PublishedScan.lifecycleCallbacks.afterUpdate).toHaveLength(1)
  })
})
