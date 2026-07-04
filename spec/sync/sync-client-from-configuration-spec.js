// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import ProjectDetail from "../dummy/src/models/project-detail.js"
import SyncClient, {syncClient} from "../../src/sync/sync-client.js"
import Task from "../dummy/src/models/task.js"

/**
 * Builds a recording transport implementing the frontend-model websocket client post contract.
 * @returns {?} Recording transport with a posts array and per-path response state.
 */
function buildTransport() {
  const transport = {
    changesResponse: /** @type {Record<string, ?>} */ ({nextCursor: null, status: "success", syncs: [], upToCursor: null}),
    /** @param {string} path - Posted path. @param {Record<string, ?>} payload - Posted payload. @returns {Promise<{json: () => Record<string, ?>}>} Response with json accessor. */
    post: async (path, payload) => {
      transport.posts.push({path, payload})

      if (path.endsWith("/changes")) return {json: () => transport.changesResponse}

      return {
        json: () => ({
          status: "success",
          syncs: payload.syncs.map((/** @type {Record<string, ?>} */ sync) => ({id: sync.id, syncState: "successful"}))
        })
      }
    },
    posts: /** @type {Array<{path: string, payload: Record<string, ?>}>} */ ([])
  }

  return transport
}

/**
 * Builds a fake local pending-sync model compatible with the sync client.
 * @returns {?} Fake sync model with a rows array.
 */
function buildFakeSyncModel() {
  /** @type {Array<?>} */
  const rows = []
  let nextId = 1

  /**
   * @param {Record<string, ?>} attributes - Row attributes.
   * @returns {?} Fake sync row.
   */
  const buildRow = (attributes) => {
    const row = {
      attributes: {...attributes, id: nextId++},
      createdAt: () => new Date("2026-07-01T10:00:00.000Z"),
      data: () => row.attributes.data,
      id: () => row.attributes.id,
      resource: () => null,
      resourceId: () => row.attributes.resourceId,
      resourceType: () => row.attributes.resourceType,
      syncType: () => row.attributes.syncType,
      /** @param {Record<string, ?>} newAttributes - Updated attributes. @returns {Promise<void>} */
      update: async (newAttributes) => {
        Object.assign(row.attributes, newAttributes)
      },
      updatedAt: () => new Date("2026-07-01T10:00:00.000Z")
    }

    return row
  }

  return {
    /** @param {Record<string, ?>} attributes - Row attributes. @returns {Promise<?>} Created row. */
    create: async (attributes) => {
      const row = buildRow(attributes)

      rows.push(row)

      return row
    },
    /** @param {Record<string, ?>} conditions - Lookup conditions. @returns {Promise<?>} Existing row. */
    findBy: async (conditions) => {
      if ("id" in conditions) return rows.find((row) => row.attributes.id === conditions.id) || null

      return rows.find((row) => row.attributes.resourceId === conditions.resourceId && row.attributes.resourceType === conditions.resourceType) || null
    },
    preload: () => ({
      /** @param {Record<string, ?>} conditions - Where conditions. @returns {?} Chainable query. */
      where: (conditions) => ({
        first: async () => rows.find((row) => row.attributes.id === conditions.id) || null,
        order: () => ({
          toArray: async () => rows.filter((row) => row.attributes.state === conditions.state)
        })
      })
    }),
    rows
  }
}

/**
 * Builds a fake model class exposing the column metadata and lifecycle statics the derivation uses.
 * @param {object} args - Model class args.
 * @param {Array<{attributeName: string, name: string, type: string}>} args.columns - Column fixtures.
 * @param {string} args.modelName - Stable model name.
 * @param {?} [args.sync] - Static sync declaration.
 * @returns {?} Fake model class.
 */
function buildMetadataModelClass({columns, modelName, sync}) {
  /** @type {Record<string, string>} */
  const columnNameToAttributeName = {}
  /** @type {Record<string, string>} */
  const typesByColumnName = {}

  for (const column of columns) {
    columnNameToAttributeName[column.name] = column.attributeName
    typesByColumnName[column.name] = column.type
  }

  const klass = class {
    /** @type {Record<string, Array<Function>>} */
    static lifecycleCallbacks = {}

    /** @returns {string} Stable model name. */
    static getModelName() {
      return modelName
    }

    /** @returns {Array<string>} Column names. */
    static getColumnNames() {
      return columns.map((column) => column.name)
    }

    /** @returns {Record<string, string>} Column name to attribute name map. */
    static getColumnNameToAttributeNameMap() {
      return columnNameToAttributeName
    }

    /** @param {string} name - Column name. @returns {string | undefined} Column type. */
    static getColumnTypeByName(name) {
      return typesByColumnName[name]
    }

    /** @returns {string} Primary key column name. */
    static primaryKey() {
      return "id"
    }

    /** @returns {boolean} Whether the model has a single primary key column. */
    static hasPrimaryKey() {
      return true
    }

    /** @param {Function} callback - Lifecycle callback. @returns {void} */
    static afterCreate(callback) {
      (this.lifecycleCallbacks.afterCreate ||= []).push(callback)
    }

    /** @param {Function} callback - Lifecycle callback. @returns {void} */
    static afterUpdate(callback) {
      (this.lifecycleCallbacks.afterUpdate ||= []).push(callback)
    }

    /** @param {Function} callback - Lifecycle callback. @returns {void} */
    static afterDestroy(callback) {
      (this.lifecycleCallbacks.afterDestroy ||= []).push(callback)
    }

    /** @param {string} callbackName - Callback type. @param {Function} callback - Registered callback. @returns {void} */
    static unregisterLifecycleCallback(callbackName, callback) {
      const callbacks = this.lifecycleCallbacks[callbackName]

      if (!callbacks) return

      const index = callbacks.indexOf(callback)

      if (index >= 0) callbacks.splice(index, 1)
    }
  }

  Object.defineProperty(klass, "name", {value: modelName})
  klass.sync = sync

  return klass
}

/**
 * Builds a fake record instance of a metadata model class.
 * @param {?} modelClass - Fake model class.
 * @param {string} id - Record id.
 * @param {Record<string, ?>} attributes - Record attributes.
 * @returns {?} Fake record.
 */
function buildRecord(modelClass, id, attributes) {
  const record = Object.create(modelClass.prototype)

  record.id = () => id
  record.attributes = () => attributes

  return record
}

/**
 * Invokes the registered lifecycle callbacks like the record layer would.
 * @param {?} modelClass - Fake model class.
 * @param {string} callbackName - Callback type.
 * @param {?} record - Mutated record.
 * @returns {Promise<void>}
 */
async function triggerLifecycle(modelClass, callbackName, record) {
  for (const callback of modelClass.lifecycleCallbacks[callbackName] || []) {
    await callback(record)
  }
}

/**
 * Builds a fake query for a resource type with plain conditions.
 * @param {string} resourceType - Resource/model name.
 * @param {Record<string, ?>} conditions - Attribute conditions.
 * @returns {?} Fake model query.
 */
function fakeQuery(resourceType, conditions) {
  return {
    getGroups: () => [],
    getJoins: () => [],
    getLimit: () => null,
    getModelClass: () => ({getModelName: () => resourceType}),
    getOffset: () => null,
    getOrders: () => [],
    getWheres: () => [{hash: conditions}]
  }
}

/**
 * Builds a database-less configuration with a sync.client block and registered model classes.
 * @param {object} args - Configuration args.
 * @param {Array<?>} args.modelClasses - Model classes to register.
 * @param {?} [args.sync] - Sync configuration override.
 * @param {?} [args.transport] - Transport for the sync.client block.
 * @returns {Configuration} Configuration with the model classes registered.
 */
function buildConfiguration({modelClasses, sync, transport}) {
  const configuration = new Configuration({
    database: {test: {}},
    directory: "/tmp/velocious-sync-client-from-configuration-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    locales: ["en"],
    sync: sync !== undefined ? sync : {client: {authenticationToken: () => "token-1", transport}}
  })

  for (const modelClass of modelClasses) {
    configuration.registerModelClass(modelClass)
  }

  return configuration
}

const SCAN_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "accepted", name: "accepted", type: "boolean"},
  {attributeName: "rejected", name: "rejected", type: "boolean"},
  {attributeName: "ticketNr", name: "ticket_nr", type: "varchar"},
  {attributeName: "scannedAt", name: "scanned_at", type: "datetime"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"},
  {attributeName: "lastSyncChangeAt", name: "last_sync_change_at", type: "datetime"}
]

const DEVICE_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "batteryLevelPercent", name: "battery_level_percent", type: "integer"},
  {attributeName: "lastSeenAt", name: "last_seen_at", type: "datetime"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

describe("sync client from configuration", () => {
  it("auto-discovers models declaring static sync and derives boolean and local-only attributes", async () => {
    const TicketScan = buildMetadataModelClass({columns: SCAN_COLUMNS, modelName: "TicketScan", sync: true})
    const Undeclared = buildMetadataModelClass({columns: DEVICE_COLUMNS, modelName: "Undeclared"})
    const transport = buildTransport()
    const syncModel = buildFakeSyncModel()
    const configuration = buildConfiguration({modelClasses: [TicketScan, Undeclared], transport})
    const client = SyncClient.fromConfiguration(configuration, {syncModel})

    expect(Object.keys(client.config.resources)).toEqual(["TicketScan"])
    expect(client.config.resources.TicketScan.booleanAttributes).toEqual(["accepted", "rejected"])
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

    expect(client.config.resources.TicketScan.booleanAttributes).toEqual(["accepted", "localFlag", "rejected"])
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
