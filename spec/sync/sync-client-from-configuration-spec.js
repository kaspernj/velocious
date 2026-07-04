// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {DEVICE_COLUMNS, SCAN_COLUMNS, buildConfiguration, buildFakeSyncModel, buildMetadataModelClass, buildRecord, buildTransport, fakeQuery, triggerLifecycle} from "./sync-client-fakes.js"
import ProjectDetail from "../dummy/src/models/project-detail.js"
import SyncClient, {syncClient} from "../../src/sync/sync-client.js"
import Task from "../dummy/src/models/task.js"

describe("sync client from configuration", () => {
  it("auto-discovers models declaring static sync and derives boolean and local-only attributes", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const Undeclared = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "Undeclared"})
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [TicketScan, Undeclared], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    expect(Object.keys(client.config.resources)).toEqual(["TicketScan"])
    expect(client.config.resources.TicketScan.booleanAttributes).toEqual(["accepted", "flagged", "rejected"])
    expect(client.config.resources.TicketScan.localOnlyAttributes).toEqual(["createdAt", "id", "lastSyncChangeAt", "updatedAt"])
    expect(client.config.resources.TicketScan.modelClass).toEqual(TicketScan)
  })

  it("queues records with derived stripping, boolean coercion, and ISO dates, replaying over the transport", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [TicketScan], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})
    const record = buildRecord(TicketScan, "0f8fad5b-d9cb-469f-a165-70867728950e", {
      accepted: 1,
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      lastSyncChangeAt: new Date("2026-07-01T09:30:00.000Z"),
      rejected: 0,
      scannedAt: new Date("2026-07-01T10:00:00.000Z"),
      ticketNr: "T-1",
      updatedAt: new Date("2026-07-01T09:15:00.000Z")
    })
    const syncRow = await client.queue({resource: record})

    expect(syncRow.attributes.data).toEqual({accepted: true, rejected: false, scannedAt: "2026-07-01T10:00:00.000Z", ticketNr: "T-1"})

    await client.waitForScheduledReplay()

    expect(transport.posts.length).toEqual(1)
    expect(transport.posts[0].path).toEqual("/velocious/sync/replay")
    expect(transport.posts[0].payload.authenticationToken).toEqual("token-1")
    expect(syncRow.attributes.state).toEqual("success")
  })

  it("pulls declared scopes through the framework-owned changes endpoint", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [TicketScan], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    await client.sync(fakeQuery("TicketScan", {event_id: "a3bb189e-8bf9-3888-9912-ace4e6543002"}))

    expect(transport.posts.length).toEqual(1)
    expect(transport.posts[0].path).toEqual("/velocious/sync/changes")
    expect(transport.posts[0].payload.authenticationToken).toEqual("token-1")
    expect(transport.posts[0].payload.scope).toEqual({conditions: {event_id: "a3bb189e-8bf9-3888-9912-ace4e6543002"}, resourceType: "TicketScan"})
  })

  it("tracks declared operations and maps the upsert flag to update and delete wire types", async () => {
    const ScannerDevice = buildMetadataModelClass({
      columns: DEVICE_COLUMNS,
      modelName: "ScannerDevice",
      sync: {syncType: "upsert", track: ["create", "update"]}
    })
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [ScannerDevice], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    await client.start()

    expect(Object.keys(ScannerDevice.lifecycleCallbacks)).toEqual(["afterCreate", "afterUpdate"])

    const record = buildRecord(ScannerDevice, "6fa459ea-ee8a-3ca4-894e-db77e160355e", {
      batteryLevelPercent: 80,
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
      id: "6fa459ea-ee8a-3ca4-894e-db77e160355e",
      lastSeenAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T09:15:00.000Z")
    })

    await triggerLifecycle(ScannerDevice, "afterCreate", record)
    await client.waitForScheduledReplay()

    expect(syncModel.rows.length).toEqual(1)
    expect(syncModel.rows[0].attributes.syncType).toEqual("update")
    expect(syncModel.rows[0].attributes.data).toEqual({batteryLevelPercent: 80, lastSeenAt: "2026-07-01T10:00:00.000Z"})

    client.stop()
  })

  it("maps tracked destroys to delete wire types under the upsert flag", async () => {
    const ScannerDevice = buildMetadataModelClass({
      columns: DEVICE_COLUMNS,
      modelName: "ScannerDevice",
      sync: {syncType: "upsert", track: true}
    })
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({
      modelClasses: [ScannerDevice],
      sync: {client: {authenticationToken: () => "token-1", isOnline: () => false, transport}}
    })
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    await client.start()

    const record = buildRecord(ScannerDevice, "6fa459ea-ee8a-3ca4-894e-db77e160355e", {id: "6fa459ea-ee8a-3ca4-894e-db77e160355e"})

    await triggerLifecycle(ScannerDevice, "afterDestroy", record)

    expect(syncModel.rows[0].attributes.syncType).toEqual("delete")

    client.stop()
  })

  it("wires isOnline and onError from the sync.client block", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    /** @type {Array<Error>} */
    const errors = []
    const state = {online: false}
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({
      modelClasses: [TicketScan],
      sync: {
        client: {
          authenticationToken: () => "token-1",
          batchSize: 25,
          isOnline: () => state.online,
          onError: (/** @type {Error} */ error) => {
            errors.push(error)
          },
          transport
        }
      }
    })
    const client = SyncClient.fromConfiguration(configuration, {syncModel})
    const record = buildRecord(TicketScan, "0f8fad5b-d9cb-469f-a165-70867728950e", {id: "0f8fad5b-d9cb-469f-a165-70867728950e", ticketNr: "T-1"})
    const syncRow = await client.queue({resource: record})

    await client.waitForScheduledReplay()

    expect(transport.posts.length).toEqual(0)
    expect(syncRow.attributes.state).toEqual("pending")
    expect(client.config.batchSize).toEqual(25)

    state.online = true
    transport.post = async () => ({})

    await client.queue({resource: record})
    await client.waitForScheduledReplay()

    expect(errors.length).toEqual(1)
    expect(errors[0].message).toMatch(/json\(\)/u)
  })

  it("posts to the configured sync.client mountPath with trailing slashes normalized", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({
      modelClasses: [TicketScan],
      sync: {client: {authenticationToken: () => "token-1", mountPath: "/api/sync/", transport}}
    })
    const client = SyncClient.fromConfiguration(configuration, {syncModel})
    const record = buildRecord(TicketScan, "0f8fad5b-d9cb-469f-a165-70867728950e", {id: "0f8fad5b-d9cb-469f-a165-70867728950e", ticketNr: "T-1"})

    await client.queue({resource: record})
    await client.waitForScheduledReplay()
    await client.sync(fakeQuery("TicketScan", {event_id: "a3bb189e-8bf9-3888-9912-ace4e6543002"}))

    expect(transport.posts.map((post) => post.path)).toEqual(["/api/sync/replay", "/api/sync/changes"])
  })

  it("passes findRecord, findRecordForDelete, afterApply, attributes, and trackedData through to the resource config", async () => {
    /** @returns {Promise<?>} Custom record resolver result. */
    const findRecord = async () => null
    /** @returns {Promise<?>} Custom delete resolver result. */
    const findRecordForDelete = async () => null
    /** @returns {Promise<boolean>} Post-apply hook result. */
    const afterApply = async () => false
    /** @returns {Record<string, ?>} Pull-apply attributes. */
    const attributes = () => ({})
    /** @returns {Record<string, ?>} Tracked payload. */
    const trackedData = () => ({})
    const Ticket = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "Ticket",
      sync: {afterApply, attributes, findRecord, findRecordForDelete, trackedData}
    })
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [Ticket], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    expect(client.config.resources.Ticket.findRecord).toEqual(findRecord)
    expect(client.config.resources.Ticket.trackedData).toEqual(trackedData)
    expect(client.pullResourceConfigs().Ticket.afterApply).toEqual(afterApply)
    expect(client.pullResourceConfigs().Ticket.attributes).toEqual(attributes)
    expect(client.pullResourceConfigs().Ticket.findRecordForDelete).toEqual(findRecordForDelete)
  })

  it("merges declared extra local-only and boolean attributes with the derived sets", async () => {
    const TicketScan = buildMetadataModelClass({
      columns: SCAN_COLUMNS,
      modelName: "TicketScan",
      sync: {booleanAttributes: ["localFlag"], localOnlyAttributes: ["localState"]}
    })
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [TicketScan], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    expect(client.config.resources.TicketScan.booleanAttributes).toEqual(["accepted", "flagged", "localFlag", "rejected"])
    expect(client.config.resources.TicketScan.localOnlyAttributes).toEqual(["createdAt", "id", "lastSyncChangeAt", "localState", "updatedAt"])
  })

  it("resolves the registered Sync model as the pending-sync model", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})

    class Sync {
      /** @returns {string} Stable model name. */
      static getModelName() {
        return "Sync"
      }
    }

    const transport = buildTransport()
    const configuration = buildConfiguration({modelClasses: [TicketScan, Sync], transport})
    const client = SyncClient.fromConfiguration(configuration)

    expect(client.config.syncModel).toEqual(Sync)
  })

  it("memoizes the lazy syncClient accessor per configuration and registers it as current", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})

    class Sync {
      /** @returns {string} Stable model name. */
      static getModelName() {
        return "Sync"
      }
    }

    const transport = buildTransport()
    const configuration = buildConfiguration({modelClasses: [TicketScan, Sync], transport})
    const client = syncClient(configuration)

    expect(syncClient(configuration)).toEqual(client)
    expect(SyncClient.current()).toEqual(client)
  })

  it("fails loudly without a sync.client configuration block", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const configuration = buildConfiguration({modelClasses: [TicketScan], sync: null})

    await expect(() => SyncClient.fromConfiguration(configuration)).toThrow(/sync\.client/u)
  })

  it("fails loudly when no registered model declares static sync", async () => {
    const Undeclared = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "Undeclared"})
    const transport = buildTransport()
    const configuration = buildConfiguration({modelClasses: [Undeclared], transport})

    await expect(() => SyncClient.fromConfiguration(configuration)).toThrow(/static sync/u)
  })

  it("fails loudly when no Sync model is registered and no options.syncModel is given", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const transport = buildTransport()
    const configuration = buildConfiguration({modelClasses: [TicketScan], transport})

    await expect(() => SyncClient.fromConfiguration(configuration)).toThrow(/options\.syncModel/u)
  })

  it("fails loudly on unknown sync declaration keys and invalid syncType flags", async () => {
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const unknownKeyConfiguration = buildConfiguration({
      modelClasses: [buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: {tracked: true}})],
      transport
    })

    await expect(() => SyncClient.fromConfiguration(unknownKeyConfiguration, {syncModel})).toThrow(/unknown keys: tracked/u)

    const invalidSyncTypeConfiguration = buildConfiguration({
      modelClasses: [buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: {syncType: "update"}})],
      transport: buildTransport()
    })

    await expect(() => SyncClient.fromConfiguration(invalidSyncTypeConfiguration, {syncModel})).toThrow(/upsert/u)
  })

  it("fails loudly when a declaring class has no column metadata", async () => {
    class NotAModel {
      static sync = true

      /** @returns {string} Stable model name. */
      static getModelName() {
        return "NotAModel"
      }
    }

    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [NotAModel], transport})

    await expect(() => SyncClient.fromConfiguration(configuration, {syncModel})).toThrow(/column metadata/u)
  })

  it("fails loudly on invalid sync.client configuration blocks", async () => {
    await expect(() => buildConfiguration({modelClasses: [], sync: {client: {authenticationToken: () => "token-1"}}}))
      .toThrow(/sync\.client\.transport/u)
    await expect(() => buildConfiguration({modelClasses: [], sync: {client: {transport: buildTransport()}}}))
      .toThrow(/sync\.client\.authenticationToken/u)
    await expect(() => buildConfiguration({modelClasses: [], sync: {client: {authenticationToken: () => "token-1", batchSize: 0, transport: buildTransport()}}}))
      .toThrow(/sync\.client\.batchSize/u)
    await expect(() => buildConfiguration({modelClasses: [], sync: {client: {authenticationToken: () => "token-1", token: "nope", transport: buildTransport()}}}))
      .toThrow(/unknown keys: token/u)
    await expect(() => buildConfiguration({modelClasses: [], sync: {client: {authenticationToken: () => "token-1", mountPath: "api/sync", transport: buildTransport()}}}))
      .toThrow(/sync\.client\.mountPath/u)
  })
})

describe("sync client from configuration - dummy models", {databaseCleaning: {transaction: true}, tags: ["dummy"]}, () => {
  it("derives resource configs from real model column metadata and static sync declarations", async () => {
    class Sync {
      /** @returns {string} Stable model name. */
      static getModelName() {
        return "Sync"
      }
    }

    const transport = buildTransport()
    const configuration = buildConfiguration({modelClasses: [ProjectDetail, Sync, Task], transport})
    const client = SyncClient.fromConfiguration(configuration)

    expect(Object.keys(client.config.resources).sort()).toEqual(["ProjectDetail", "Task"])
    expect(client.config.resources.Task.booleanAttributes).toEqual(["isDone"])
    expect(client.config.resources.Task.localOnlyAttributes).toEqual(["createdAt", "id", "updatedAt"])
    expect(client.config.resources.Task.modelClass).toEqual(Task)
    expect(client.config.resources.ProjectDetail.booleanAttributes).toEqual(["isActive"])
    expect(client.config.resources.ProjectDetail.localOnlyAttributes).toEqual(["createdAt", "id", "updatedAt"])
    expect(client.config.resources.ProjectDetail.syncType).toEqual("upsert")
    expect(client.config.resources.ProjectDetail.track).toEqual({operations: ["create", "update"]})
    expect(client.config.syncModel).toEqual(Sync)
  })
})
