// @ts-check

import Configuration from "../configuration.js"
import TableData from "../database/table-data/index.js"

/**
 * Allocation queues per database+table, serializing insert/last-insert-id
 * pairs across all allocator instances in this process.
 * @type {Map<string, Promise<void>>}
 */
const allocationQueues = new Map()

/**
 * Allocates monotonically increasing server sync sequences from an
 * AUTO_INCREMENT id table: every allocation inserts a row and returns the
 * driver's last-insert id, so sequences stay unique and increasing across
 * processes sharing the same database.
 *
 * Backed by an auto-created `velocious_server_sequences` table on the
 * configured database, with a process-local memory counter fallback when no
 * database is configured (mirroring the sync scope store). Apps with an
 * existing sequence table (for example a bare `id`-only AUTO_INCREMENT table)
 * point `tableName` at it and pass `insertData: {}` to insert empty rows.
 */
export default class ServerSequenceAllocator {
  /**
   * Creates a server sequence allocator.
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the database. Defaults to the current configuration, resolved lazily per allocation.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   * @param {Record<string, ?>} [args.insertData] - Row payload inserted per allocation. Defaults to `{created_at: new Date()}` matching the auto-created table; pass `{}` for bare id-only tables.
   * @param {string} [args.tableName] - Sequence table name.
   */
  constructor({configuration, databaseIdentifier = "default", insertData, tableName = "velocious_server_sequences"} = {}) {
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.insertData = insertData
    this.tableName = tableName
    this._memorySequence = 0
    this._isReady = false
    /** @type {Promise<void> | null} */
    this._readyPromise = null
  }

  /**
   * Allocates the next monotonically increasing sequence.
   *
   * Allocations serialize through a module-level queue per database+table so
   * parallel `next()` calls - including calls from other allocator instances
   * sharing the same table and connection - cannot interleave their insert
   * and last-insert-id reads and hand out duplicate sequences.
   * @returns {Promise<number>} Next sequence value.
   */
  async next() {
    const queueKey = `${this.databaseIdentifier}::${this.tableName}`
    const previousAllocation = allocationQueues.get(queueKey) ?? Promise.resolve()
    const allocation = previousAllocation.then(() => this._allocateNext())

    allocationQueues.set(queueKey, allocation.then(() => undefined, () => undefined))

    return await allocation
  }

  /**
   * Ensures the backing table exists.
   * @returns {Promise<void>} Resolves when ready.
   */
  async ensureReady() {
    if (this._isReady) return

    if (this._usesMemoryStorage()) {
      this._isReady = true
      return
    }

    if (this._readyPromise) return await this._readyPromise

    this._readyPromise = this._withDb(async (db) => {
      const created = await this._ensureSequencesTable(db)

      // DDL joins any transaction already open on this connection (the mixin's
      // beforeCreate allocation always runs inside the record save transaction),
      // and on transactional-DDL databases (MSSQL, PostgreSQL, SQLite) a rollback
      // of that outer transaction removes the just-created table again. Only
      // cache readiness when the table was not created inside an active
      // transaction; otherwise the next allocation re-verifies the table.
      if (!created || !db.insideTransaction()) this._isReady = true
    })

    try {
      await this._readyPromise
    } finally {
      if (!this._isReady) this._readyPromise = null
    }
  }

  /**
   * Allocates one sequence value after queueing.
   * @returns {Promise<number>} Allocated sequence value.
   */
  async _allocateNext() {
    await this.ensureReady()

    if (this._usesMemoryStorage()) {
      return ++this._memorySequence
    }

    return await this._withDb(async (db) => {
      // The allocated id must be returned by the insert statement itself (OUTPUT
      // INSERTED/RETURNING), like the record create path does: MSSQL's
      // SCOPE_IDENTITY() only sees inserts from the same batch/scope, so reading
      // the last-insert id as a separate query always returns NULL there. Drivers
      // without insert-returning support (older SQLite) keep the reliable
      // connection-scoped last-insert-id fallback.
      const insertSql = db.insertSql({
        data: this._insertPayload(),
        returnLastInsertedColumnNames: ["id"],
        tableName: this.tableName
      })
      const insertResult = await db.query(insertSql)
      const insertedId = Array.isArray(insertResult) ? insertResult[0]?.id : undefined

      if (insertedId !== undefined && insertedId !== null) return Number(insertedId)

      return Number(await db.lastInsertID())
    })
  }

  /**
   * Builds the row payload inserted per allocation.
   * @returns {Record<string, ?>} Insert payload.
   */
  _insertPayload() {
    return this.insertData ?? {created_at: new Date()}
  }

  /**
   * Resolves the configuration owning the sequence table.
   * @returns {import("../configuration.js").default} Resolved configuration.
   */
  _getConfiguration() {
    return this.configuration ?? Configuration.current()
  }

  /**
   * Whether the allocator runs without a configured database.
   * @returns {boolean} Whether memory storage is used.
   */
  _usesMemoryStorage() {
    try {
      return !this._getConfiguration().getDatabaseConfiguration()[this.databaseIdentifier]
    } catch {
      return true
    }
  }

  /**
   * Runs a callback with a database connection.
   * @template Result
   * @param {(db: import("../database/drivers/base.js").default) => Promise<Result>} callback - Database callback.
   * @returns {Promise<Result>} Callback result.
   */
  async _withDb(callback) {
    return await this._getConfiguration().ensureConnections({name: "Server sequence allocator"}, async (dbs) => {
      const db = dbs[this.databaseIdentifier]

      if (!db) throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`)

      return await callback(db)
    })
  }

  /**
   * Ensures the sequences table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<boolean>} Whether the table had to be created.
   */
  async _ensureSequencesTable(db) {
    if (await db.tableExists(this.tableName)) return false

    const table = new TableData(this.tableName, {ifNotExists: true})

    table.bigint("id", {autoIncrement: true, null: false, primaryKey: true})
    table.datetime("created_at", {null: false})

    await db.createTable(table)

    return true
  }
}

/**
 * Wires server sequencing onto a sync model class: registers a beforeCreate
 * lifecycle callback assigning the next sequence when the record has none, and
 * defines an `advance<Column>()` instance method (when the model does not
 * already define one) that re-sequences the record through the allocator.
 *
 * The sequence is always written through the model's generated typed setter
 * (for example `setServerSequence`), so the model must expose the generated
 * `set<Column>`/`has<Column>` accessors for the column.
 * @template {typeof import("../database/record/index.js").default} TModelClass
 * @param {TModelClass} ModelClass - Sync model class to sequence.
 * @param {object} args - Options.
 * @param {ServerSequenceAllocator} args.allocator - Allocator providing sequence values.
 * @param {string} [args.column] - Sequence attribute name.
 * @returns {TModelClass} The given model class.
 */
export function withServerSequence(ModelClass, {allocator, column = "serverSequence"}) {
  if (!(allocator instanceof ServerSequenceAllocator)) {
    throw new Error(`withServerSequence requires a ServerSequenceAllocator, got: ${String(allocator)}`)
  }

  const upperColumn = `${column.charAt(0).toUpperCase()}${column.slice(1)}`
  const advanceMethodName = `advance${upperColumn}`
  const hasMethodName = `has${upperColumn}`
  const setterMethodName = `set${upperColumn}`

  // Narrows the prototype to dynamic method access for the configured column name.
  const prototype = /** @type {Record<string, ?>} */ (ModelClass.prototype)

  if (typeof prototype[setterMethodName] != "function" || typeof prototype[hasMethodName] != "function") {
    throw new Error(`withServerSequence requires generated ${setterMethodName} and ${hasMethodName} accessors on ${ModelClass.name}`)
  }

  if (typeof prototype[advanceMethodName] != "function") {
    /**
     * Assigns the next server-side sequence.
     * @this {Record<string, ?>}
     * @returns {Promise<void>}
     */
    prototype[advanceMethodName] = async function advanceServerSequenceThroughAllocator() {
      this[setterMethodName](await allocator.next())
    }
  }

  ModelClass.beforeCreate(async (record) => {
    // Narrows the record to dynamic method access for the configured column name.
    const dynamicRecord = /** @type {Record<string, ?>} */ (/** @type {?} */ (record))

    if (dynamicRecord[hasMethodName]()) return

    await dynamicRecord[advanceMethodName]()
  })

  return ModelClass
}
