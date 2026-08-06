// @ts-check

import DatabaseRecord from "../../../src/database/record/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * @typedef {object} RecordingConnection
 * @property {string[]} queries - SQL statements sent to the connection.
 * @property {(sql: string) => Promise<[]>} query - Records one SQL statement.
 * @property {(value: number | string) => string} quote - Quotes one value.
 * @property {(columnName: string) => string} quoteColumn - Quotes one column.
 * @property {(tableName: string) => string} quoteTable - Quotes one table.
 */

/** @returns {RecordingConnection} - Recording database connection. */
function buildConnection() {
  const queries = []

  return {
    queries,
    query: async (sql) => {
      queries.push(sql)

      return []
    },
    quote: (value) => `'${value}'`,
    quoteColumn: (columnName) => `"${columnName}"`,
    quoteTable: (tableName) => `"${tableName}"`
  }
}

/**
 * @param {object} args - Operation ownership.
 * @param {object} args.configuration - Owning configuration identity.
 * @param {RecordingConnection} args.connection - Operation connection.
 * @param {string} args.databaseIdentifier - Operation database identifier.
 * @returns {{connection: () => RecordingConnection, forModel: (ModelClass: typeof RoutingParent) => {driver: RecordingConnection}, modelClasses: Array<typeof RoutingParent>}} - Operation double.
 */
function buildOperation({configuration, connection, databaseIdentifier}) {
  /** @type {Array<typeof RoutingParent>} */
  const modelClasses = []

  return {
    connection: () => connection,
    forModel: (ModelClass) => {
      modelClasses.push(ModelClass)

      if (ModelClass._getConfiguration() !== configuration) {
        throw new Error(`${ModelClass.getModelName()} belongs to another Velocious configuration`)
      }

      const modelDatabaseIdentifier = ModelClass.getDatabaseIdentifier()

      if (modelDatabaseIdentifier !== databaseIdentifier) {
        throw new Error(`${ModelClass.getModelName()} uses database ${JSON.stringify(modelDatabaseIdentifier)}, not operation database ${JSON.stringify(databaseIdentifier)}`)
      }

      return {driver: connection}
    },
    modelClasses
  }
}

const routingConfiguration = {}
let childConnection = buildConnection()
let parentConnection = buildConnection()
let parentDatabaseIdentifier = "parent"
/** @type {Array<(record: RoutingChild) => Promise<void>>} */
let afterCreateCallbacks = []

class RoutingParent extends DatabaseRecord {
  /** @returns {object} - Model configuration identity. */
  static _getConfiguration() { return routingConfiguration }

  /** @returns {RecordingConnection} - Parent connection. */
  static connection() { return parentConnection }

  /** @returns {string} - Parent database identifier. */
  static getDatabaseIdentifier() { return parentDatabaseIdentifier }

  /** @returns {string} - Parent model name. */
  static getModelName() { return "RoutingParent" }

  /**
   * @param {{driver?: RecordingConnection | (() => RecordingConnection)}} [args] - Query arguments.
   * @returns {{driver: RecordingConnection}} - Minimal model query.
   */
  static _newQuery({driver = () => this.connection()} = {}) {
    return {driver: typeof driver == "function" ? driver() : driver}
  }

  /** @returns {string} - Parent table name. */
  static tableName() { return "routing_parents" }
}

class RoutingChild extends DatabaseRecord {
  /** @returns {object} - Model configuration identity. */
  static _getConfiguration() { return routingConfiguration }

  /** @param {(record: RoutingChild) => Promise<void>} callback - Lifecycle callback. */
  static afterCreate(callback) { afterCreateCallbacks.push(callback) }

  /** @param {() => Promise<void>} _callback - Lifecycle callback. */
  static afterDestroy(_callback) {}

  /** @param {() => Promise<void>} _callback - Lifecycle callback. */
  static afterSave(_callback) {}

  /** @param {() => Promise<void>} _callback - Lifecycle callback. */
  static beforeSave(_callback) {}

  /** @returns {RecordingConnection} - Child connection. */
  static connection() { return childConnection }

  /** @returns {string} - Child database identifier. */
  static getDatabaseIdentifier() { return "child" }

  /** @returns {string} - Child model name. */
  static getModelName() { return "RoutingChild" }

  /** @returns {{getForeignKey: () => string, getPrimaryKey: () => string, getTargetModelClass: () => typeof RoutingParent}} - Parent relationship. */
  static getRelationshipByName() {
    return {
      getForeignKey: () => "routing_parent_id",
      getPrimaryKey: () => "id",
      getTargetModelClass: () => RoutingParent
    }
  }

  /** @returns {string} - Child table name. */
  static tableName() { return "routing_children" }

  /** @returns {number} - Parent identifier. */
  readAttribute() { return 42 }
}

/** @returns {RoutingChild} - Counter-cached child record. */
function buildRecord() {
  return Object.create(RoutingChild.prototype)
}

/** @returns {Promise<void>} - Runs the registered after-create counter callback. */
async function runCounterCacheCallback(record) {
  const callback = afterCreateCallbacks[0]

  if (!callback) throw new Error("Counter-cache callback was not registered")

  await callback(record)
}

function registerCounterCache() {
  childConnection = buildConnection()
  parentConnection = buildConnection()
  parentDatabaseIdentifier = "parent"
  afterCreateCallbacks = []
  RoutingChild._registerCounterCacheCallbacks("routingParent")
}

describe("Record - counterCache database routing", () => {
  it("routes an ordinary parent update through the parent model connection", async () => {
    registerCounterCache()

    await runCounterCacheCallback(buildRecord())

    expect(parentConnection.queries).toHaveLength(1)
    expect(childConnection.queries).toHaveLength(0)
  })

  it("routes a compatible operation-owned parent update through the operation", async () => {
    registerCounterCache()
    parentDatabaseIdentifier = "child"
    const operationConnection = buildConnection()
    const operation = buildOperation({
      configuration: routingConfiguration,
      connection: operationConnection,
      databaseIdentifier: "child"
    })
    const record = buildRecord()

    // Narrows the complete operation test double at the record ownership boundary.
    record.bindDatabaseOperation(/** @type {ReturnType<typeof JSON.parse>} */ (operation))
    await runCounterCacheCallback(record)

    expect(operation.modelClasses).toEqual([RoutingParent])
    expect(operationConnection.queries).toHaveLength(1)
    expect(childConnection.queries).toHaveLength(0)
    expect(parentConnection.queries).toHaveLength(0)
  })

  it("rejects an operation-owned parent routed to another database before SQL", async () => {
    registerCounterCache()
    const operationConnection = buildConnection()
    const operation = buildOperation({
      configuration: routingConfiguration,
      connection: operationConnection,
      databaseIdentifier: "child"
    })
    const record = buildRecord()

    // Narrows the complete operation test double at the record ownership boundary.
    record.bindDatabaseOperation(/** @type {ReturnType<typeof JSON.parse>} */ (operation))

    await expect(async () => runCounterCacheCallback(record)).toThrowError("RoutingParent uses database \"parent\", not operation database \"child\"")
    expect(operationConnection.queries).toHaveLength(0)
    expect(childConnection.queries).toHaveLength(0)
    expect(parentConnection.queries).toHaveLength(0)
  })
})
