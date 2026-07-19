// @ts-check

/**
 * CreateIndexSqlArgs type.
 * @typedef {object} CreateIndexSqlArgs
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns - Columns to include in the index.
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should enforce uniqueness.
 * @property {string} tableName - Name of the table to add the index to.
 */
/**
 * RemoveIndexSqlArgs type.
 * @typedef {object} RemoveIndexSqlArgs
 * @property {string} name - Index name to drop.
 * @property {string} tableName - Name of the table the index belongs to.
 */
/**
 * DropTableSqlArgsType type.
 * @typedef {object} DropTableSqlArgsType
 * @property {boolean} [cascade] - Whether dependent objects should be dropped too.
 * @property {boolean} [ifExists] - Skip dropping if the table does not exist.
 */
/**
 * DeleteSqlArgsType type.
 * @typedef {object} DeleteSqlArgsType
 * @property {string} tableName - Table name to delete from.
 * @property {{[key: string]: ?}} conditions - Conditions used to build the delete WHERE clause.
 */
/**
 * InsertSqlArgsType type.
 * @typedef {object} InsertSqlArgsType
 * @property {string[]} [columns] - Column names for `rows` inserts.
 * @property {{[key: string]: ?}} [data] - Column/value pairs for a single-row insert.
 * @property {boolean} [multiple] - Whether this insert should be treated as multi-row.
 * @property {string[]} [returnLastInsertedColumnNames] - Column names to return after insert.
 * @property {Array<Array<?>>} [rows] - Row values for a multi-row insert.
 * @property {string} tableName - Table name to insert into.
 */
/**
 * QueryRowType type.
 * @typedef {Record<string, ?>} QueryRowType
 * @typedef {Array<QueryRowType>} QueryResultType
 */
/**
 * RetryableDatabaseErrorResult type.
 * @typedef {object} RetryableDatabaseErrorResult
 * @property {boolean} retry - Whether the error should be retried.
 * @property {boolean} reconnect - Whether to reconnect before retrying.
 * @property {number} [maxTries] - Override the max retry attempts.
 * @property {number} [waitMs] - Wait time before retrying in milliseconds.
 */
/**
 * QueryOptions type.
 * @typedef {object} QueryOptions
 * @property {string} [logName] - Query log subject.
 * @property {boolean} [logQuery] - Whether to log the query.
 * @property {boolean} [processListComment] - Whether to add process-list comments to the query.
 * @property {boolean} [sessionTimeZone] - Whether to ensure the configured database session time zone before the query.
 * @property {string} [sourceStack] - Stack captured at the caller boundary.
 */

/**
 * ActiveQueryDebugSnapshot type.
 * @typedef {object} ActiveQueryDebugSnapshot
 * @property {string[]} annotations - Database annotations active when the query started.
 * @property {string} logName - Query log name.
 * @property {number} startedAtUnixMs - Query start timestamp.
 * @property {number} runningMs - Query runtime in milliseconds.
 * @property {string} sqlPreview - Truncated SQL preview.
 */

/**
 * DatabaseConnectionDebugSnapshot type.
 * @typedef {object} DatabaseConnectionDebugSnapshot
 * @property {ActiveQueryDebugSnapshot | null} activeQuery - Currently running query, if any.
 * @property {number | undefined} checkedOutAtUnixMs - Checkout start timestamp for active checkouts.
 * @property {number | undefined} checkoutAgeMs - Active checkout age in milliseconds.
 * @property {string | undefined} checkoutName - Human-readable checkout name.
 * @property {string} driverClass - Driver class name.
 * @property {number | undefined} idSeq - Pool checkout ID sequence.
 * @property {number} openTransactions - Number of open transaction frames.
 * @property {number} schemaCacheEntries - Number of cached schema metadata entries.
 */

/**
 * ActiveQueryState type.
 * @typedef {object} ActiveQueryState
 * @property {string[]} annotations - Database annotations active when the query started.
 * @property {string} logName - Query log name.
 * @property {number} startedAtUnixMs - Query start timestamp.
 * @property {string} sqlPreview - Truncated SQL preview.
 */

/**
 * UpdateSqlArgsType type.
 * @typedef {object}UpdateSqlArgsType
 * @property {object} conditions - Conditions used to build the update WHERE clause.
 * @property {object} data - Column/value pairs to update.
 * @property {string} tableName - Table name to update.
 */
/**
 * UpsertSqlArgsType type.
 * @typedef {object}UpsertSqlArgsType
 * @property {string[]} conflictColumns - Columns that define a conflict.
 * @property {object} data - Column/value pairs to insert.
 * @property {string} tableName - Table name to upsert into.
 * @property {string[]} updateColumns - Columns to update on conflict.
 */

import BacktraceCleaner from "../../utils/backtrace-cleaner.js"
import { getDatabaseAnnotations } from "../annotations.js"
import { formatDateForDatabase } from "../datetime-storage.js"
import isDate from "../../utils/is-date.js"
import Logger from "../../logger.js"
import Query from "../query/index.js"
import Handler from "../handler.js"
import Mutex from "epic-locks/build/mutex.js"
import UUID from "pure-uuid"
import TableData from "../table-data/index.js"
import TableColumn from "../table-data/table-column.js"
import TableForeignKey from "../table-data/table-foreign-key.js"
import wait from "awaitery/build/wait.js"

/**
 * Runs now ms.
 * @returns {number} - Current high-resolution-ish timestamp in milliseconds.
 */
function nowMs() {
  if (globalThis.performance && typeof globalThis.performance.now == "function") {
    return globalThis.performance.now()
  }

  return Date.now()
}

/**
 * Runs format elapsed ms.
 * @param {number} elapsedMs - Elapsed milliseconds.
 * @returns {string} - Formatted elapsed milliseconds.
 */
function formatElapsedMs(elapsedMs) {
  return `${Math.max(elapsedMs, 0).toFixed(1)}ms`
}

export default class VelociousDatabaseDriversBase {
  /**
   * Id seq.
   * @type {number | undefined} */
  idSeq = undefined
  /**
   * Narrows the runtime value to the documented type.
   * @type {Array<Array<() => void | Promise<void>>>} */
  _afterCommitCallbackFrames
  /**
   * Narrows the runtime value to the documented type.
   * @type {Map<string, Promise<?>>} */
  _schemaCache
  /**
   * Narrows the runtime value to the documented type.
   * @type {(() => void) | undefined} */
  _schemaCacheInvalidator
  /**
   * Narrows the runtime value to the documented type.
   * @type {string | undefined} */
  _connectionCheckoutName
  /**
   * Active query.
   * @type {ActiveQueryState | null} */
  _activeQuery = null

  /**
   * Runs constructor.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
   * @param {import("../../configuration.js").default} configuration - Configuration instance.
   */
  constructor(config, configuration) {
    this._args = config
    this.configuration = configuration
    this.mutex = new Mutex() // Can be used to lock this instance for exclusive use
    this.logger = new Logger(this)
    this._afterCommitCallbackFrames = []
    this._transactionsCount = 0
    this._transactionsActionsMutex = new Mutex()
    this._schemaCache = new Map()
  }

  /**
   * Runs add foreign key.
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   * @param {string} referencedTableName - Referenced table name.
   * @param {string} referencedColumnName - Referenced column name.
   * @param {object} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async addForeignKey(tableName, columnName, referencedTableName, referencedColumnName, args) {
    this._assertNotReadOnly()
    const tableForeignKeyArgs = Object.assign(
      {
        columnName,
        tableName,
        referencedColumnName,
        referencedTableName
      },
      args
    )
    const tableForeignKey = new TableForeignKey(tableForeignKeyArgs)
    const tableData = new TableData(tableName)

    tableData.addForeignKey(tableForeignKey)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * Runs alter table sqls.
   * @abstract
   * @param {import("../table-data/index.js").default} _tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  alterTableSQLs(_tableData) {
    throw new Error("alterTableSQLs not implemented")
  }

  /**
   * Runs connect.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  connect() {
    throw new Error("'connect' not implemented")
  }

  /**
   * Optional close hook for database drivers.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async close() {
    // No-op by default
  }

  /**
   * Flushes pending writes that the driver delayed for persistence.
   * @returns {Promise<void>} - Resolves when pending writes are durable.
   */
  async flushPendingWrites() {
    // No-op by default
  }

  /**
   * Runs set connection checkout name.
   * @param {string | undefined} name - Human-readable name for this active checkout.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async setConnectionCheckoutName(name) {
    this._connectionCheckoutName = name
    this._connectionCheckedOutAtUnixMs = Date.now()
  }

  /**
   * Runs clear connection checkout name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async clearConnectionCheckoutName() {
    this._connectionCheckoutName = undefined
    this._connectionCheckedOutAtUnixMs = undefined
  }

  /**
   * Runs reconnect.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async reconnect() {
    this.clearSchemaCache()
    await this.close()
    await this.connect()
  }

  /**
   * Runs create database sql.
   * @abstract
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifNotExists] - Whether if not exists.
   * @param {string} [args.databaseCharset] - Database-default character set (driver-specific; mysql/mariadb).
   * @param {string} [args.databaseCollation] - Database-default collation (driver-specific; mysql/mariadb).
   * @returns {string[]} - SQL statements.
   */
  createDatabaseSql(databaseName, args) { throw new Error("'createDatabaseSql' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs drop database sql.
   * @abstract
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifExists] - Whether if exists.
   * @returns {string[]} - SQL statements.
   */
  dropDatabaseSql(databaseName, args) { throw new Error("'dropDatabaseSql' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs create index sqls.
   * @abstract
   * @param {CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) { // eslint-disable-line no-unused-vars
    throw new Error("'createIndexSQLs' not implemented")
  }

  /**
   * Runs remove index sqls.
   * @abstract
   * @param {RemoveIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async removeIndexSQLs(indexData) { // eslint-disable-line no-unused-vars
    throw new Error("'removeIndexSQLs' not implemented")
  }

  /**
   * Runs create table.
   * @param {import("../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createTable(tableData) {
    this._assertNotReadOnly()
    const sqls = await this.createTableSql(tableData)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * Runs create table sql.
   * @abstract
   * @param {import("../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) { // eslint-disable-line no-unused-vars
    throw new Error("'createTableSql' not implemented")
  }

  /**
   * Runs delete.
   * @param {DeleteSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async delete(args) {
    this._assertNotReadOnly()
    const sql = this.deleteSql(args)

    await this.query(sql)
  }

  /**
   * Runs delete sql.
   * @abstract
   * @param {DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql(args) { // eslint-disable-line no-unused-vars
    throw new Error(`'deleteSql' not implemented`)
  }

  /**
   * Runs drop table.
   * @param {string} tableName - Table name.
   * @param {DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async dropTable(tableName, args) {
    this._assertNotReadOnly()
    const sqls = await this.dropTableSQLs(tableName, args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * Runs drop table sqls.
   * @abstract
   * @param {string} tableName - Table name.
   * @param {DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args) { // eslint-disable-line no-unused-vars
    throw new Error("dropTableSQLs not implemented")
  }

  /**
   * Runs escape.
   * @abstract
   * @param {?} value - Value to use.
   * @returns {?} - The escape.
   */
  escape(value) { // eslint-disable-line no-unused-vars
    throw new Error("'escape' not implemented")
  }

  /**
   * Runs get args.
   * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - The args.
   */
  getArgs() {
    return this._args
  }

  /**
   * Runs get configuration.
   * @returns {import("../../configuration.js").default} - The configuration.
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("No configuration set")

    return this.configuration
  }

  /**
   * Runs get id seq.
   * @returns {number | undefined} - The id seq.
   */
  getIdSeq() {
    return this.idSeq
  }

  /**
   * Runs primary key type.
   * @returns {string} - Configured primary key type, defaulting to UUID.
   */
  primaryKeyType() {
    return this.getArgs().primaryKeyType || "uuid"
  }

  /**
   * Clears cached schema metadata for this driver instance.
   * @returns {void} - No return value.
   */
  clearSchemaCache() {
    if (this._schemaCacheInvalidator) {
      this._schemaCacheInvalidator()
      return
    }

    this._clearLocalSchemaCache()
  }

  /**
   * Clears only the metadata cached on this driver instance.
   * @returns {void} - No return value.
   */
  _clearLocalSchemaCache() {
    this._schemaCache.clear()
  }

  /**
   * Runs set schema cache invalidator.
   * @param {() => void} invalidator - Callback used to clear schema caches that share this driver pool.
   * @returns {void} - No return value.
   */
  setSchemaCacheInvalidator(invalidator) {
    this._schemaCacheInvalidator = invalidator
  }

  /**
   * Runs schema cache enabled.
   * @returns {boolean} - Whether schema metadata caching is enabled.
   */
  _schemaCacheEnabled() {
    return this.getArgs().schemaCache !== false
  }

  /**
   * Runs cached schema metadata.
   * @template T
   * @param {string} cacheKey - Schema cache key.
   * @param {() => Promise<T>} callback - Cache miss callback.
   * @returns {Promise<T>} - Resolves with the cached metadata.
   */
  async _cachedSchemaMetadata(cacheKey, callback) {
    if (!this._schemaCacheEnabled()) return await callback()

    const existingPromise = this._schemaCache.get(cacheKey)

    if (existingPromise) {
      return /** @type {T} */ (this._schemaCacheReturnValue(await existingPromise))
    }

    const promise = (async () => await callback())()

    this._schemaCache.set(cacheKey, promise)

    try {
      return /** @type {T} */ (this._schemaCacheReturnValue(await promise))
    } catch (error) {
      if (this._schemaCache.get(cacheKey) === promise) {
        this._schemaCache.delete(cacheKey)
      }

      throw error
    }
  }

  /**
   * Runs cached table schema metadata.
   * @template T
   * @param {string} tableName - Table name.
   * @param {string} metadataName - Metadata name.
   * @param {() => Promise<T>} callback - Cache miss callback.
   * @returns {Promise<T>} - Resolves with the cached table metadata.
   */
  async _cachedTableSchemaMetadata(tableName, metadataName, callback) {
    return await this._cachedSchemaMetadata(`table:${tableName}:${metadataName}`, callback)
  }

  /**
   * Runs schema cache return value.
   * @param {?} value - Cached value.
   * @returns {?} - Value returned to callers.
   */
  _schemaCacheReturnValue(value) {
    if (Array.isArray(value)) return value.slice()

    return value
  }

  /**
   * Runs get tables.
   * @abstract
   * @returns {Promise<Array<import("./base-table.js").default>>} - Resolves with the tables.
   */
  getTables() {
    throw new Error(`${this.constructor.name}#getTables not implemented`)
  }

  /**
   * Runs structure sql.
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return null
  }

  /**
   * Runs get table by name.
   * @param {string} name - Name.
   * @param {object} [args] - Options object.
   * @param {boolean} args.throwError - Whether throw error.
   * @returns {Promise<import("./base-table.js").default | undefined>} - Resolves with the table by name.
   */
  async getTableByName(name, args) {
    const tables = await this.getTables()
    const tableNames = []
    let table

    for (const candidate of tables) {
      const candidateName = candidate.getName()

      if (candidateName == name) {
        table = candidate
        break
      }

      tableNames.push(candidateName)
    }

    if (!table && args?.throwError !== false) {
      throw new Error(this._missingTableErrorMessage(name, tableNames))
    }

    return table
  }

  /**
   * Runs missing table error message.
   * @param {string} name - Table name.
   * @param {string[]} tableNames - Available table names.
   * @returns {string} - Error message.
   */
  _missingTableErrorMessage(name, tableNames) {
    const environment = this.getConfiguration().getEnvironment()
    const args = this.getArgs()
    const databaseName = args?.database || args?.name || args?.useDatabase || "unknown"

    return `Couldn't find a table by that name "${name}" in: ${tableNames.join(", ")} (environment: ${environment}, database: ${databaseName})`
  }

  /**
   * Runs get table by name or fail.
   * @param {string} name - Name.
   * @returns {Promise<import("./base-table.js").default>} - Resolves with the table by name or fail.
   */
  async getTableByNameOrFail(name) {
    return /** @type {import("./base-table.js").default} */ (await this.getTableByName(name, {throwError: true}))
  }

  /**
   * Runs get type.
   * @abstract
   * @returns {string} - The type.
   */
  getType() {
    throw new Error("'type' not implemented")
  }

  /**
   * Runs insert.
   * @param {InsertSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insert(args) {
    this._assertNotReadOnly()
    const sql = this.insertSql(args)

    await this.query(sql)
  }

  /**
   * Runs insert multiple.
   * @param {string} tableName - Table name.
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<?>>} rows - Rows to insert.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insertMultiple(tableName, columns, rows) {
    this._assertNotReadOnly()

    const sql = this.insertSql({columns, tableName, rows})

    await this.query(sql)
  }

  /**
   * Runs insert sql.
   * @abstract
   * @param {InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'insertSql' not implemented")
  }

  /**
   * Runs upsert.
   * @param {UpsertSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async upsert(args) {
    this._assertNotReadOnly()
    const sql = this.upsertSql(args)

    await this.query(sql)
  }

  /**
   * Runs last insert id.
   * @abstract
   * @returns {Promise<number>} - Resolves with the last insert id.
   */
  lastInsertID() {
    throw new Error(`${this.constructor.name}#lastInsertID not implemented`)
  }

  /**
   * Runs convert value.
   * @param {?} value - Value to use.
   * @returns {?} - The convert value.
   */
  _convertValue(value) {
    if (typeof value === "boolean") {
      return value ? 1 : 0
    }

    // isDate instead of instanceof: a Date created in another realm (e.g. the console REPL) would
    // fail instanceof, skip this conversion, and serialize as an empty SQL value downstream.
    if (isDate(value)) {
      return formatDateForDatabase(value, {databaseType: this.getType()})
    }

    // JSON-encode plain objects/arrays so they land in JSON/text columns as valid
    // JSON. Without this, drivers like mysql's escape() turn an object into
    // `key` = value assignment pairs (its `SET ?` form), producing invalid SQL in
    // a value position. Only PLAIN objects and arrays are encoded — class
    // instances (e.g. model records, which are circular via _changes) and Buffers
    // pass through untouched, since JSON.stringify on a record throws on its
    // circular structure and a record is never a valid column value to serialize.
    if (this._isJsonEncodableValue(value)) {
      return JSON.stringify(value)
    }

    return value
  }

  /**
   * Whether a value is a plain object or array that should be JSON-encoded for a
   * JSON/text column. Excludes Buffers and class instances (e.g. model records).
   * @param {?} value - Value to test.
   * @returns {boolean} - Whether to JSON-encode the value.
   */
  _isJsonEncodableValue(value) {
    if (value === null || typeof value !== "object") return false
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return false
    if (Array.isArray(value)) return true

    const prototype = Object.getPrototypeOf(value)

    return prototype === Object.prototype || prototype === null
  }

  /**
   * Runs options.
   * @abstract
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  options() {
    throw new Error("'options' not implemented.")
  }

  /**
   * Runs quote.
   * @param {?} value - Value to use.
   * @returns {number | string} - The quote.
   */
  quote(value) {
    if (typeof value == "number") return value

    const escapedValue = this.escape(value)
    const result = `"${escapedValue}"`

    return result
  }

  /**
   * Runs quote column.
   * @param {string} columnName - Column name.
   * @returns {string} - The quote column.
   */
  quoteColumn(columnName) {
    return this.options().quoteColumnName(columnName)
  }

  /**
   * Runs quote index.
   * @param {string} columnName - Column name.
   * @returns {string} - The quote index.
   */
  quoteIndex(columnName) {
    return this.options().quoteIndexName(columnName)
  }

  /**
   * Runs quote table.
   * @param {string} tableName - Table name.
   * @returns {string} - The quote table.
   */
  quoteTable(tableName) {
    return this.options().quoteTableName(tableName)
  }

  /**
   * Runs new query.
   * @returns {Query} - The new query.
   */
  newQuery() {
    const handler = new Handler()

    return new Query({
      driver: this,
      handler
    })
  }

  /**
   * Runs select.
   * @param {string} tableName - Table name.
   * @returns {Promise<QueryResultType>} - Resolves with the select.
   */
  async select(tableName) {
    const query = this.newQuery()

    const sql = query
      .from(tableName)
      .toSql()

    return await this.query(sql)
  }

  /**
   * Runs set id seq.
   * @param {number | undefined} newIdSeq - New id seq.
   * @returns {void} - No return value.
   */
  setIdSeq(newIdSeq) {
    this.idSeq = newIdSeq
  }

  /**
   * Runs should set auto increment when primary key.
   * @abstract
   * @returns {boolean} - Whether set auto increment when primary key.
   */
  shouldSetAutoIncrementWhenPrimaryKey() {
    throw new Error(`'shouldSetAutoIncrementWhenPrimaryKey' not implemented`)
  }

  /**
   * Runs supports default primary key uuid.
   * @returns {boolean} - Whether supports default primary key uuid.
   */
  supportsDefaultPrimaryKeyUUID() { return false }

  /**
   * Runs supports insert into returning.
   * @abstract
   * @returns {boolean} - Whether supports insert into returning.
   */
  supportsInsertIntoReturning() { return false }

  /**
   * Whether a single connection can reference tables in another database on the same server via a
   * two-part `database`.`table` identifier. When true, a query spanning several databases on this
   * server can be expressed as one statement (a cross-tenant `UNION ALL`); when false, each database
   * is queried on its own connection and the results merged in the caller. Only MySQL/MariaDB return
   * true: PostgreSQL (one database per connection) and SQLite (one attached file per connection)
   * cannot, and MSSQL is excluded because it reads a two-part name as `schema.table` (cross-database
   * access needs a three-part `database.schema.table`), so it stays on the always-correct fan-out
   * path. Consumed by `Tenant.aggregateAcross`.
   * @returns {boolean} - Whether two-part cross-database references are supported.
   */
  supportsCrossDatabaseReferences() { return false }

  /**
   * Runs table exists.
   * @param {string} tableName - Table name.
   * @returns {Promise<boolean>} - Resolves with Whether table exists.
   */
  async tableExists(tableName) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == tableName)

    if (table) return true

    return false
  }

  /**
   * Runs transaction.
   * @param {() => Promise<void>} callback - Callback function.
   * @returns {Promise<?>} - Resolves with the transaction.
   */
  async transaction(callback) {
    const savePointName = this.generateSavePointName()
    /**
     * Callback frame.
     * @type {Array<() => void | Promise<void>>} */
    const callbackFrame = []
    let transactionStarted = false
    let savePointStarted = false

    this._afterCommitCallbackFrames.push(callbackFrame)

    if (this._transactionsCount == 0) {
      this.logger.debug("Start transaction")
      await this.startTransaction()
      transactionStarted = true
    } else {
      this.logger.debug("Start savepoint", savePointName)
      await this.startSavePoint(savePointName)
      savePointStarted = true
    }

    let result

    try {
      result = await callback()

      if (savePointStarted) {
        this.logger.debug("Release savepoint", savePointName)
        await this.releaseSavePoint(savePointName)
      }

      if (transactionStarted) {
        this.logger.debug("Commit transaction")
        await this.commitTransaction()
      }

      await this._commitAfterCommitCallbackFrame()
    } catch (error) {
      if (error instanceof Error) {
        this.logger.debug("Transaction error", error.message)
      } else {
        this.logger.debug("Transaction error", error)
      }

      let transactionRolledBack = false

      if (savePointStarted) {
        this.logger.debug("Rollback savepoint", savePointName)
        try {
          await this.rollbackSavePoint(savePointName)
        } catch (savePointError) {
          const message = savePointError instanceof Error ? savePointError.message : `${savePointError}`

          // MySQL sometimes drops savepoints unexpectedly; fall back to rolling back the full transaction
          if (message.includes("SAVEPOINT") || message.includes("ER_SP_DOES_NOT_EXIST")) {
            this.logger.debug("Savepoint rollback failed; rolling back entire transaction instead")
            await this.rollbackTransaction()
            transactionRolledBack = true
          } else {
            throw savePointError
          }
        }
      }

      if (transactionStarted && !transactionRolledBack) {
        this.logger.debug("Rollback transaction")
        await this.rollbackTransaction()
      }

      this._afterCommitCallbackFrames.pop()

      throw error
    }

    return result
  }

  /**
   * Runs a callback after the surrounding transaction commits.
   * If no transaction is active, the callback runs immediately.
   * @param {() => void | Promise<void>} callback - Callback.
   * @returns {Promise<void>} - Resolves when the callback has been registered or run.
   */
  async afterCommit(callback) {
    const currentFrame = this._afterCommitCallbackFrames[this._afterCommitCallbackFrames.length - 1]

    if (!currentFrame) {
      await callback()
      return
    }

    currentFrame.push(callback)
  }

  /**
   * Whether a transaction is currently open on this connection.
   * @returns {boolean} - Whether inside a transaction.
   */
  insideTransaction() { return this._transactionsCount > 0 }

  /**
   * Runs start transaction.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async startTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startTransactionAction()
      this._transactionsCount++
    })
  }

  /**
   * Runs start transaction action.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startTransactionAction() {
    await this.query("BEGIN TRANSACTION")
  }

  /**
   * Runs commit transaction.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async commitTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._commitTransactionAction()
      this._transactionsCount--
    })
  }

  /**
   * Runs commit transaction action.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _commitTransactionAction() {
    await this.query("COMMIT")
  }

  /**
   * Merges committed callbacks into the parent transaction frame or runs them when the outermost commit completes.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _commitAfterCommitCallbackFrame() {
    const committedCallbacks = this._afterCommitCallbackFrames.pop()

    if (!committedCallbacks || committedCallbacks.length === 0) return

    const parentFrame = this._afterCommitCallbackFrames[this._afterCommitCallbackFrames.length - 1]

    if (parentFrame) {
      parentFrame.push(...committedCallbacks)
      return
    }

    for (const callback of committedCallbacks) {
      await callback()
    }
  }

  /**
   * Streams the rows of `sql` one at a time instead of buffering the whole result set, so a
   * caller can process an arbitrarily large result with bounded memory. This base implementation
   * falls back to a buffered {@link query} and yields its rows; drivers backed by a cursor-capable
   * client (the MySQL driver) override it with true server-side streaming.
   * @param {string} sql - SQL string to stream.
   * @param {QueryOptions} [options] - Query options, as for {@link query}.
   * @yields {Record<string, unknown>} - The result rows, one at a time.
   */
  async *queryStream(sql, options = {}) {
    const rows = await this.query(sql, options)

    for (const row of Array.isArray(rows) ? rows : []) {
      yield row
    }
  }

  /**
   * Runs query.
   * @param {string} sql - SQL string.
   * @param {QueryOptions} [options] - Query options.
   * @returns {Promise<QueryResultType>} - Resolves with the query.
   */
  async query(sql, options = {}) {
    this._assertWritableQuery(sql)

    let tries = 0
    const maxTries = 5
    const requestTiming = this.configuration.getCurrentRequestTiming()
    const logQuery = options.logQuery ?? this._queryLoggingEnabled()
    const sourceStack = logQuery ? (options.sourceStack || Error().stack) : undefined
    const querySql = this._querySqlWithProcessListComment(sql, options)

    while (tries < maxTries) {
      tries++

      try {
        return await this._queryActualWithLogging({originalSql: sql, querySql}, {...options, logQuery, sourceStack}, requestTiming, tries)
      } catch (error) {
        if (!(error instanceof Error)) throw error

        const retryInfo = this.retryableDatabaseError(error)

        if (tries < maxTries && retryInfo.retry) {
          if (retryInfo.reconnect) {
            if (this._transactionsCount > 0) {
              throw new Error(`Cannot reconnect while a transaction is active (${this._transactionsCount}). Original error: ${error.message}`, {cause: error})
            }

            await this.reconnect()
          }

          const waitMs = typeof retryInfo.waitMs === "number" && Number.isFinite(retryInfo.waitMs) ? retryInfo.waitMs : 100

          if (waitMs > 0) await wait(waitMs)
          this.logger.warn(`Retrying query because failed with: ${error.stack}`)
          // Retry
        } else {
          throw error
        }
      }
    }

    throw new Error("'query' unexpected came here")
  }

  /**
   * Executes a mutation and returns the number of rows changed by that statement.
   * @param {string} sql - Mutation SQL string.
   * @returns {Promise<number>} - Affected row count.
   */
  async affectedRows(sql) {
    this._assertWritableQuery(sql)
    await this.beforeQuery(sql, {})

    try {
      return await this._affectedRowsActual(sql)
    } finally {
      await this.afterQuery(sql, {})
    }
  }

  /**
   * Runs query actual with logging.
   * @param {object} args - Options object.
   * @param {string} args.originalSql - Original SQL string before process-list comments.
   * @param {string} args.querySql - SQL string sent to the database.
   * @param {QueryOptions} options - Query options.
   * @param {import("../../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing.
   * @param {number} tries - Query attempt count.
   * @returns {Promise<QueryResultType>} - Resolves with the query.
   */
  async _queryActualWithLogging({originalSql, querySql}, options, requestTiming, tries) {
    const startedAtMs = nowMs()
    const previousActiveQuery = this._activeQuery
    this._activeQuery = {
      annotations: getDatabaseAnnotations(),
      logName: options.logName || "SQL",
      sqlPreview: this._debugSqlPreview(originalSql),
      startedAtUnixMs: Date.now()
    }
    let result

    try {
      const runQueryActualWithHooks = async () => await this._queryActualWithHooks(querySql, options)

      if (requestTiming && tries === 1) {
        result = await requestTiming.measureDbQuery(runQueryActualWithHooks)
      } else if (requestTiming) {
        result = await requestTiming.measure("db", runQueryActualWithHooks)
      } else {
        result = await runQueryActualWithHooks()
      }
    } finally {
      this._activeQuery = previousActiveQuery
    }

    const elapsedMs = nowMs() - startedAtMs

    if (options.logQuery !== false) {
      await this._logQuery({
        elapsedMs,
        logName: options.logName || "SQL",
        sourceStack: options.sourceStack,
        sql: originalSql
      })
    }

    if (this._schemaCacheInvalidatingSql(originalSql)) {
      this.clearSchemaCache()
    }

    return result
  }

  /**
   * Runs query actual with before/after hooks.
   * @param {string} sql - SQL string.
   * @param {QueryOptions} options - Query options.
   * @returns {Promise<QueryResultType>} - Resolves with the query.
   */
  async _queryActualWithHooks(sql, options) {
    await this.beforeQuery(sql, options)

    try {
      return await this._queryActual(sql)
    } finally {
      await this.afterQuery(sql, options)
    }
  }

  /**
   * Hook that runs immediately before a SQL query is sent to the driver.
   * @param {string} _sql - SQL string.
   * @param {QueryOptions} _options - Query options.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async beforeQuery(_sql, _options) {
    // No-op by default
  }

  /**
   * Hook that runs immediately after a SQL query has completed or failed.
   * @param {string} _sql - SQL string.
   * @param {QueryOptions} _options - Query options.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterQuery(_sql, _options) {
    // No-op by default
  }

  /**
   * Runs get debug snapshot.
   * @returns {DatabaseConnectionDebugSnapshot} - Diagnostic snapshot for this connection.
   */
  getDebugSnapshot() {
    const now = Date.now()
    const activeQuery = this._activeQuery

    return {
      activeQuery: activeQuery ? {...activeQuery, runningMs: Math.max(0, now - activeQuery.startedAtUnixMs)} : null,
      checkoutAgeMs: this._connectionCheckedOutAtUnixMs ? Math.max(0, now - this._connectionCheckedOutAtUnixMs) : undefined,
      checkedOutAtUnixMs: this._connectionCheckedOutAtUnixMs,
      checkoutName: this._connectionCheckoutName,
      driverClass: this.constructor.name,
      idSeq: this.idSeq,
      openTransactions: this._transactionsCount,
      schemaCacheEntries: this._schemaCache.size
    }
  }

  /**
   * Runs debug sql preview.
   * @param {string} sql - SQL to preview.
   * @returns {string} - Normalized truncated SQL preview for diagnostics.
   */
  _debugSqlPreview(sql) {
    return sql
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500)
  }

  /**
   * Runs query sql with process list comment.
   * @param {string} sql - SQL string.
   * @param {QueryOptions} options - Query options.
   * @returns {string} - SQL string with a leading process-list comment when annotations exist.
   */
  _querySqlWithProcessListComment(sql, options) {
    if (options.processListComment === false) return sql

    const parts = []

    if (this._connectionCheckoutName) {
      parts.push(`checkout="${this._processListCommentValue(this._connectionCheckoutName)}"`)
    }

    const annotations = getDatabaseAnnotations()

    if (annotations.length > 0) {
      parts.push(`annotations="${this._processListCommentValue(annotations.join(" > "))}"`)
    }

    if (parts.length === 0) return sql

    return `/* velocious ${parts.join(" ")} */ ${sql}`
  }

  /**
   * Runs process list comment value.
   * @param {string} value - Raw process-list comment value.
   * @returns {string} - Sanitized process-list comment value.
   */
  _processListCommentValue(value) {
    let sanitized = ""

    for (const character of value) {
      const codePoint = character.codePointAt(0)

      sanitized += codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character
    }

    return sanitized
      .replace(/\*\//g, "* /")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200)
      .replace(/"/g, "'")
  }

  /**
   * Runs schema cache invalidating sql.
   * @param {string} sql - SQL string.
   * @returns {boolean} - Whether the SQL should invalidate schema metadata.
   */
  _schemaCacheInvalidatingSql(sql) {
    const normalized = sql
      .trim()
      .replace(/^\ufeff/, "")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*(\n|$)/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase()

    if (!normalized) return false
    if (/^(create|alter|drop|rename)\b/.test(normalized)) return true
    if (/^comment\s+on\b/.test(normalized)) return true
    if (/^exec(?:ute)?\s+sp_rename\b/.test(normalized)) return true
    if (/^if\b[\s\S]*\bbegin\s+(create|alter|drop|rename)\b/.test(normalized)) return true

    return false
  }

  /**
   * Runs query logging enabled.
   * @returns {boolean} - Whether query logging is enabled for this driver.
   */
  _queryLoggingEnabled() {
    if (!this.configuration) return true
    if (!this.configuration.getQueryLoggingEnabled()) return false

    const logger = new Logger("SQL", {configuration: this.configuration})

    return logger.isLevelEnabled("info")
  }

  /**
   * Runs log query.
   * @param {object} args - Options object.
   * @param {number} args.elapsedMs - Elapsed milliseconds.
   * @param {string} args.logName - Query log subject.
   * @param {string | undefined} args.sourceStack - Source stack.
   * @param {string} args.sql - SQL string.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _logQuery({elapsedMs, logName, sourceStack, sql}) {
    const logger = new Logger(logName, {configuration: this.configuration})
    const sourceLine = this._querySourceLine(sourceStack)
    const message = sourceLine
      ? `(${formatElapsedMs(elapsedMs)})  ${sql}\n  ↳ ${sourceLine}`
      : `(${formatElapsedMs(elapsedMs)})  ${sql}`

    await logger.info(message)
  }

  /**
   * Runs query source line.
   * @param {string | undefined} sourceStack - Source stack.
   * @returns {string | undefined} - Source line when an application frame is available.
   */
  _querySourceLine(sourceStack) {
    if (!sourceStack) return undefined

    const applicationDirectory = this.configuration
      ? this.configuration.getDirectoryIfAvailable()
      : undefined

    if (!applicationDirectory) return undefined

    const error = new Error("Query source")

    error.stack = sourceStack

    return BacktraceCleaner.getApplicationSourceLine(error, {
      applicationDirectory,
      frameworkSourceDirectory: this.configuration.getEnvironmentHandler().getFrameworkSourceDirectory()
    })
  }

  /**
   * Runs query actual.
   * @abstract
   * @param {string} sql - SQL string.
   * @returns {Promise<QueryResultType>} - Resolves with the query actual.
   */
  _queryActual(sql) { // eslint-disable-line no-unused-vars
    throw new Error(`queryActual not implemented`)
  }

  /**
   * Executes a mutation and returns its affected row count.
   * @abstract
   * @param {string} sql - Mutation SQL string.
   * @returns {Promise<number>} - Affected row count.
   */
  _affectedRowsActual(sql) { // eslint-disable-line no-unused-vars
    throw new Error(`affectedRowsActual not implemented`)
  }

  /**
   * Runs query to sql.
   * @abstract
   * @param {Query} _query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(_query) { throw new Error("queryToSql not implemented") }

  /**
   * Runs retryable database error.
   * @param {Error} _error - Error instance.
   * @returns {RetryableDatabaseErrorResult} - Retry info.
   */
  retryableDatabaseError(_error) {
    return {retry: false, reconnect: false}
  }

  /**
   * Runs assert writable query.
   * @param {string} sql - SQL string.
   * @returns {void} - No return value.
   */
  _assertWritableQuery(sql) {
    if (!this.isReadOnly()) return
    if (!this._sqlLooksLikeWrite(sql)) return

    throw new Error("Database is read-only")
  }

  /**
   * Runs assert not read only.
   * @returns {void} - No return value.
   */
  _assertNotReadOnly() {
    if (this.isReadOnly()) {
      throw new Error("Database is read-only")
    }
  }

  /**
   * Runs sql looks like write.
   * @param {string} sql - SQL string.
   * @returns {boolean} - SQL representation.
   */
  _sqlLooksLikeWrite(sql) {
    const normalized = sql.trim().toLowerCase()

    if (!normalized) return false

    if (
      normalized.startsWith("select") ||
      normalized.startsWith("show") ||
      normalized.startsWith("pragma") ||
      normalized.startsWith("explain") ||
      normalized.startsWith("describe")
    ) {
      return false
    }

    if (normalized.startsWith("with")) {
      const withMatch = normalized.match(/^\s*with[\s\S]+?\)\s*(select|insert|update|delete|merge|replace)\b/)

      if (withMatch) {
        return withMatch[1] !== "select"
      }

      return false
    }

    const keywordMatch = normalized.match(/^\s*(\w+)/)
    const keyword = keywordMatch ? keywordMatch[1] : ""

    return [
      "insert",
      "update",
      "delete",
      "create",
      "alter",
      "drop",
      "truncate",
      "merge",
      "replace"
    ].includes(keyword)
  }

  /**
   * Runs is read only.
   * @returns {boolean} - Whether read only.
   */
  isReadOnly() {
    return Boolean(this.getArgs().readOnly)
  }

  /**
   * Runs rollback transaction.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async rollbackTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      try {
        await this._rollbackTransactionAction()
      } finally {
        this._transactionsCount--

        // A rolled-back transaction may have reverted DDL (e.g. a CREATE TABLE
        // run lazily inside the transaction), so any cached schema metadata is
        // now stale and must be invalidated. Without this, a later tableExists()
        // check can report a table that the rollback already removed, so callers
        // skip recreating it and then fail with "no such table".
        this.clearSchemaCache()
      }
    })
  }

  /**
   * Runs rollback transaction action.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackTransactionAction() {
    await this.query("ROLLBACK")
  }

  /**
   * Runs generate save point name.
   * @returns {string} - The generate save point name.
   */
  generateSavePointName() {
    return `sp${new UUID(4).format().replaceAll("-", "")}`
  }

  /**
   * Runs start save point.
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async startSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startSavePointAction(savePointName)
    })
  }

  /**
   * Runs start save point action.
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startSavePointAction(savePointName) {
    await this.query(`SAVEPOINT ${savePointName}`)
  }

  /**
   * Runs rename column.
   * @param {string} tableName - Table name.
   * @param {string} oldColumnName - Previous column name.
   * @param {string} newColumnName - New column name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    this._assertNotReadOnly()
    const tableColumn = new TableColumn(oldColumnName)

    tableColumn.setNewName(newColumnName)

    const tableData = new TableData(tableName)

    tableData.addColumn(tableColumn)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * Runs release save point.
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async releaseSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._releaseSavePointAction(savePointName)
    })
  }

  /**
   * Runs release save point action.
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _releaseSavePointAction(savePointName) {
    try {
      await this.query(`RELEASE SAVEPOINT ${savePointName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`

      // Savepoint may already be gone if the database rolled back automatically
      if (message.toLowerCase().includes("savepoint") && message.toLowerCase().includes("does not exist")) {
        this.logger.debug(`Release savepoint ignored because it no longer exists: ${savePointName}`)
        return
      }

      throw error
    }
  }

  /**
   * Runs rollback save point.
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async rollbackSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._rollbackSavePointAction(savePointName)
    })
  }

  /**
   * Runs rollback save point action.
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackSavePointAction(savePointName) {
    await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`)
  }

  /**
   * Runs truncate all tables.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async truncateAllTables() {
    this._assertNotReadOnly()
    await this.withDisabledForeignKeys(async () => {
      let tries = 0

      while(tries <= 5) {
        tries++

        const tables = await this.getTables()
        const truncateErrors = []

        for (const table of tables) {
          if (table.getName() != "schema_migrations") {
            try {
              await table.truncate({cascade: true})
            } catch (error) {
              console.error(error)
              truncateErrors.push(error)
            }
          }
        }

        if (truncateErrors.length == 0) {
          break
        } else if (tries <= 5) {
          // A truncate failed — the schema cache may still list a table that was
          // dropped out from under us (e.g. a db:rollback test that left the
          // shared DB rolled back). Clear it so the next pass re-reads the live
          // table list and no longer tries to truncate a table that is gone.
          this.clearSchemaCache()
        } else {
          throw truncateErrors[0]
        }
      }
    })
    await this.flushPendingWrites()
  }

  /**
   * Runs update.
   * @param {UpdateSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async update(args) {
    this._assertNotReadOnly()
    const sql = this.updateSql(args)

    await this.query(sql)
  }

  /**
   * Runs update sql.
   * @abstract
   * @param {UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'disableForeignKeys' not implemented")
  }

  /**
   * Runs upsert sql.
   * @abstract
   * @param {UpsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  upsertSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'upsertSql' not implemented")
  }

  /**
   * Runs disable foreign keys.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  disableForeignKeys() {
    throw new Error("'disableForeignKeys' not implemented")
  }

  /**
   * Runs enable foreign keys.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  enableForeignKeys() {
    throw new Error("'enableForeignKeys' not implemented")
  }

  /**
   * Runs with disabled foreign keys.
   * @param {function() : void} callback - Callback function.
   * @returns {Promise<?>} - Resolves with the with disabled foreign keys.
   */
  async withDisabledForeignKeys(callback) {
    await this.disableForeignKeys()

    try {
      return await callback()
    } finally {
      await this.enableForeignKeys()
    }
  }

  /**
   * Blocks until a named advisory lock is acquired on this connection.
   * Advisory locks are connection-scoped and do not interact with row or
   * table locks; they are purely cooperative between callers that use the
   * same name and let you serialize functionality without blocking readers
   * or writers that do not participate in the same lock.
   * @abstract
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [_args] - Optional timeout in milliseconds; `null` or undefined blocks forever.
   * @returns {Promise<boolean>} - Resolves to true when the lock has been acquired, false if the timeout elapsed.
   */
  acquireAdvisoryLock(name, _args = {}) {
    throw new Error(`'acquireAdvisoryLock' not implemented for ${this.constructor.name}`)
  }

  /**
   * Attempts to acquire a named advisory lock without blocking.
   * @abstract
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Resolves to true if the lock was acquired, false if it was already held.
   */
  tryAcquireAdvisoryLock(name) { // eslint-disable-line no-unused-vars
    throw new Error(`'tryAcquireAdvisoryLock' not implemented for ${this.constructor.name}`)
  }

  /**
   * Releases a named advisory lock previously acquired on this connection.
   * @abstract
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Resolves to true if the lock was held by this session and has now been released.
   */
  releaseAdvisoryLock(name) { // eslint-disable-line no-unused-vars
    throw new Error(`'releaseAdvisoryLock' not implemented for ${this.constructor.name}`)
  }

  /**
   * Checks whether a named advisory lock is currently held by any session.
   * Intended as an introspection helper; callers who need to act on the
   * result should prefer `tryAcquireAdvisoryLock` to avoid a TOCTOU race.
   * @abstract
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Resolves to true if the lock is held by ? session.
   */
  isAdvisoryLockHeld(name) { // eslint-disable-line no-unused-vars
    throw new Error(`'isAdvisoryLockHeld' not implemented for ${this.constructor.name}`)
  }
}
