// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"

export {buildFakeSyncModel} from "./fake-sync-model.js"

/** Column fixtures matching a scanner-style ticket-scan table. */
export const SCAN_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "accepted", name: "accepted", type: "boolean"},
  {attributeName: "rejected", name: "rejected", type: "boolean"},
  {attributeName: "flagged", name: "flagged", type: "bit"},
  {attributeName: "ticketNr", name: "ticket_nr", type: "varchar"},
  {attributeName: "scannedAt", name: "scanned_at", type: "datetime"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"},
  {attributeName: "lastSyncChangeAt", name: "last_sync_change_at", type: "datetime"}
]

/** Column fixtures matching a scanner-style device table. */
export const DEVICE_COLUMNS = [
  {attributeName: "id", name: "id", type: "uuid"},
  {attributeName: "batteryLevelPercent", name: "battery_level_percent", type: "integer"},
  {attributeName: "lastSeenAt", name: "last_seen_at", type: "datetime"},
  {attributeName: "createdAt", name: "created_at", type: "datetime"},
  {attributeName: "updatedAt", name: "updated_at", type: "datetime"}
]

/**
 * Builds a recording transport implementing the frontend-model websocket client post contract.
 * @returns {?} Recording transport with a posts array and per-path response state.
 */
export function buildTransport() {
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
 * Builds a fake model class exposing the column metadata and lifecycle statics the derivation uses.
 * @param {object} args - Model class args.
 * @param {Array<{attributeName: string, name: string, type: string}>} args.columns - Column fixtures.
 * @param {string} args.modelName - Stable model name.
 * @param {?} [args.sync] - Static sync declaration.
 * @returns {?} Fake model class.
 */
export function buildMetadataModelClass({columns, modelName, sync}) {
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

    /** @returns {?} Fake connection running afterCommit callbacks immediately, like a driver with no open transaction. */
    static connection() {
      return {
        /** @param {() => Promise<void>} callback - Commit callback. @returns {Promise<void>} */
        afterCommit: async (callback) => await callback()
      }
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
export function buildRecord(modelClass, id, attributes) {
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
export async function triggerLifecycle(modelClass, callbackName, record) {
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
export function fakeQuery(resourceType, conditions) {
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
export function buildConfiguration({modelClasses, sync, transport}) {
  const configuration = new Configuration({
    database: {test: {}},
    directory: "/tmp/velocious-sync-client-spec",
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
