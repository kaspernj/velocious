// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {DEVICE_COLUMNS, SCAN_COLUMNS, buildConfiguration, buildMetadataModelClass, buildRecord, triggerLifecycle} from "./sync-client-fakes.js"
import SyncPublisher from "../../src/sync/sync-publisher.js"

/**
 * Builds a fake server sync/change model implementing the shared Sync-row
 * upsert contract (where().first(), create, assign/advanceServerSequence/save)
 * while recording rows and sequence advances.
 * @returns {?} Fake server sync model with a rows array.
 */
function buildFakeServerSyncModel() {
  /** @type {Array<?>} */
  const rows = []

  return {
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

  it("rejects invalid publish declarations loudly", async () => {
    /** @param {?} publish - Publish declaration under test. @returns {SyncPublisher} Built publisher. */
    const buildWithPublish = (publish) => {
      const Invalid = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "Invalid", sync: {publish}})

      return new SyncPublisher({configuration: buildConfiguration({modelClasses: [Invalid], sync: {}}), syncModel: buildFakeServerSyncModel()})
    }

    await expect(() => buildWithPublish(true)).toThrow(/Invalid static sync publish must be false or a publish declaration object/u)
    await expect(() => buildWithPublish({})).toThrow(/requires a serialize\(record\) function/u)
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
