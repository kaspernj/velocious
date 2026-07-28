// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import ServerSequenceAllocator, {withServerSequence} from "../../src/sync/server-sequence-allocator.js"

/**
 * @typedef {object} SequenceConnection
 * @property {string[]} queries - SQL statements sent to this connection.
 * @property {() => Promise<boolean>} tableExists - Reports that the sequence table exists.
 * @property {(args: object) => string} insertSql - Builds a deterministic insert marker.
 * @property {(sql: string) => Promise<Array<{id: number}>>} query - Records one insert and returns its id.
 * @property {() => Promise<number>} lastInsertID - Fallback inserted id.
 */

/** @returns {SequenceConnection} - Recording sequence connection. */
function buildConnection() {
  const queries = []

  return {
    queries,
    tableExists: async () => true,
    insertSql: () => "INSERT SERVER SEQUENCE",
    query: async (sql) => {
      queries.push(sql)

      return [{id: queries.length}]
    },
    lastInsertID: async () => queries.length
  }
}

class RoutingConfiguration {
  /** @param {Record<string, SequenceConnection>} connections - Connections by database identifier. */
  constructor(connections) {
    this.connections = connections
    /** @type {string[][]} */
    this.ensureConnectionCalls = []
  }

  /** @returns {Record<string, {type: string}>} - Configured database identifiers. */
  getDatabaseConfiguration() {
    return Object.fromEntries(Object.keys(this.connections).map((identifier) => [identifier, {type: "test"}]))
  }

  /**
   * @template Result
   * @param {{databaseIdentifiers: string[]}} options - Requested database identifiers.
   * @param {(connections: Record<string, SequenceConnection>) => Promise<Result>} callback - Connection callback.
   * @returns {Promise<Result>} - Callback result.
   */
  async ensureConnections(options, callback) {
    this.ensureConnectionCalls.push(options.databaseIdentifiers)

    return await callback(this.connections)
  }
}

/**
 * @param {object} args - Model harness options.
 * @param {RoutingConfiguration} args.configuration - Model configuration.
 * @param {SequenceConnection} args.connection - Ordinary model connection.
 * @param {string} args.databaseIdentifier - Model database identifier.
 * @returns {{ModelClass: typeof SequenceRecord, buildRecord: (operation?: ReturnType<typeof buildOperation>) => SequenceRecord, callbacks: Array<(record: SequenceRecord) => Promise<void>>}} - Sequence model harness.
 */
function buildModelHarness({configuration, connection, databaseIdentifier}) {
  /** @type {Array<(record: SequenceRecord) => Promise<void>>} */
  const callbacks = []

  class SequenceRecord {
    /** @type {ReturnType<typeof buildOperation> | undefined} */
    _databaseOperation = undefined

    /** @type {number | undefined} */
    _serverSequence = undefined

    /** @param {(record: SequenceRecord) => Promise<void>} callback - Before-create callback. */
    static beforeCreate(callback) { callbacks.push(callback) }

    /** @returns {RoutingConfiguration} - Model configuration. */
    static _getConfiguration() { return configuration }

    /** @returns {string} - Model database identifier. */
    static getDatabaseIdentifier() { return databaseIdentifier }

    /** @returns {string} - Model name. */
    static getModelName() { return "SequenceRecord" }

    /** @returns {SequenceConnection} - Ordinary model connection. */
    static connection() { return connection }

    /** @returns {SequenceConnection} - Record-owned connection. */
    connection() {
      return this._databaseOperation?.connection() || connection
    }

    /** @returns {ReturnType<typeof buildOperation> | undefined} - Record operation. */
    databaseOperation() { return this._databaseOperation }

    /** @returns {typeof SequenceRecord} - Model class. */
    getModelClass() { return SequenceRecord }

    /** @returns {boolean} - Whether a sequence is assigned. */
    hasServerSequence() { return this._serverSequence !== undefined }

    /** @param {number} value - Assigned sequence. */
    setServerSequence(value) { this._serverSequence = value }
  }

  return {
    ModelClass: SequenceRecord,
    buildRecord: (operation) => {
      const record = new SequenceRecord()

      record._databaseOperation = operation

      return record
    },
    callbacks
  }
}

/**
 * @param {object} args - Operation options.
 * @param {RoutingConfiguration} args.configuration - Operation configuration.
 * @param {SequenceConnection} args.connection - Pinned operation connection.
 * @param {string} args.databaseIdentifier - Operation database identifier.
 * @returns {{configuration: RoutingConfiguration, connection: () => SequenceConnection, databaseIdentifier: string, forModel: (ModelClass: typeof import("../../src/database/record/index.js").default) => {driver: SequenceConnection}, modelClasses: Array<typeof import("../../src/database/record/index.js").default>}} - Operation double.
 */
function buildOperation({configuration, connection, databaseIdentifier}) {
  /** @type {Array<typeof import("../../src/database/record/index.js").default>} */
  const modelClasses = []

  return {
    configuration,
    connection: () => connection,
    databaseIdentifier,
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

/**
 * @param {Array<(record: InstanceType<typeof import("../../src/database/record/index.js").default>) => Promise<void>>} callbacks - Lifecycle callbacks.
 * @param {InstanceType<typeof import("../../src/database/record/index.js").default>} record - Record to create.
 * @returns {Promise<void>} - Runs the sequence callback.
 */
async function runBeforeCreate(callbacks, record) {
  const callback = callbacks[0]

  if (!callback) throw new Error("Server-sequence callback was not registered")

  await callback(record)
}

describe("server sequence allocator database routing", () => {
  it("keeps ordinary allocation on the allocator-configured database", async () => {
    const modelConnection = buildConnection()
    const allocatorConnection = buildConnection()
    const configuration = new RoutingConfiguration({
      default: modelConnection,
      sequences: allocatorConnection
    })
    const harness = buildModelHarness({configuration, connection: modelConnection, databaseIdentifier: "default"})
    const allocator = new ServerSequenceAllocator({
      configuration: /** @type {?} */ (configuration),
      databaseIdentifier: "sequences"
    })

    withServerSequence(/** @type {?} */ (harness.ModelClass), {allocator})
    await runBeforeCreate(/** @type {?} */ (harness.callbacks), /** @type {?} */ (harness.buildRecord()))

    expect(configuration.ensureConnectionCalls).toEqual([["sequences"], ["sequences"]])
    expect(allocatorConnection.queries).toEqual(["INSERT SERVER SEQUENCE"])
    expect(modelConnection.queries).toHaveLength(0)
  })

  it("propagates a compatible operation connection", async () => {
    const ordinaryConnection = buildConnection()
    const operationConnection = buildConnection()
    const configuration = new RoutingConfiguration({default: ordinaryConnection})
    const harness = buildModelHarness({configuration, connection: ordinaryConnection, databaseIdentifier: "default"})
    const allocator = new ServerSequenceAllocator({configuration: /** @type {?} */ (configuration)})
    const operation = buildOperation({
      configuration,
      connection: operationConnection,
      databaseIdentifier: "default"
    })

    withServerSequence(/** @type {?} */ (harness.ModelClass), {allocator})
    await runBeforeCreate(/** @type {?} */ (harness.callbacks), /** @type {?} */ (harness.buildRecord(operation)))

    expect(operation.modelClasses).toEqual([harness.ModelClass])
    expect(operationConnection.queries).toEqual(["INSERT SERVER SEQUENCE"])
    expect(ordinaryConnection.queries).toHaveLength(0)
    expect(configuration.ensureConnectionCalls).toHaveLength(0)
  })

  it("rejects an operation when the allocator uses another database", async () => {
    const operationConnection = buildConnection()
    const allocatorConnection = buildConnection()
    const configuration = new RoutingConfiguration({
      default: operationConnection,
      sequences: allocatorConnection
    })
    const harness = buildModelHarness({configuration, connection: operationConnection, databaseIdentifier: "default"})
    const allocator = new ServerSequenceAllocator({
      configuration: /** @type {?} */ (configuration),
      databaseIdentifier: "sequences"
    })
    const operation = buildOperation({
      configuration,
      connection: operationConnection,
      databaseIdentifier: "default"
    })

    withServerSequence(/** @type {?} */ (harness.ModelClass), {allocator})

    await expect(async () => {
      await runBeforeCreate(/** @type {?} */ (harness.callbacks), /** @type {?} */ (harness.buildRecord(operation)))
    }).toThrowError("Server sequence allocator uses database \"sequences\", not operation model database \"default\"")
    expect(operationConnection.queries).toHaveLength(0)
    expect(allocatorConnection.queries).toHaveLength(0)
  })

  it("rejects an operation when the allocator belongs to another configuration", async () => {
    const operationConnection = buildConnection()
    const allocatorConnection = buildConnection()
    const modelConfiguration = new RoutingConfiguration({default: operationConnection})
    const allocatorConfiguration = new RoutingConfiguration({default: allocatorConnection})
    const harness = buildModelHarness({
      configuration: modelConfiguration,
      connection: operationConnection,
      databaseIdentifier: "default"
    })
    const allocator = new ServerSequenceAllocator({configuration: /** @type {?} */ (allocatorConfiguration)})
    const operation = buildOperation({
      configuration: modelConfiguration,
      connection: operationConnection,
      databaseIdentifier: "default"
    })

    withServerSequence(/** @type {?} */ (harness.ModelClass), {allocator})

    await expect(async () => {
      await runBeforeCreate(/** @type {?} */ (harness.callbacks), /** @type {?} */ (harness.buildRecord(operation)))
    }).toThrowError("Server sequence allocator belongs to another Velocious configuration")
    expect(operationConnection.queries).toHaveLength(0)
    expect(allocatorConnection.queries).toHaveLength(0)
  })
})
