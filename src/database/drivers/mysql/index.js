// @ts-check

import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import {digg} from "diggerize"
import DropDatabase from "./sql/drop-database.js"
import DropTable from "./sql/drop-table.js"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import mysql from "mysql"
import query from "./query.js"
import QueryParser from "./query-parser.js"
import streamQuery from "./query-stream.js"
import RemoveIndex from "./sql/remove-index.js"
import Table from "./table.js"
import StructureSql from "./structure-sql.js"
import Upsert from "./sql/upsert.js"
import Update from "./sql/update.js"

/**
 * Sentinel timeout (in seconds) used as the "block forever" value when a
 * caller asks for an indefinite advisory lock acquire. MySQL historically
 * accepted negative timeouts as "infinite", but MariaDB 10+ silently
 * returns NULL from `GET_LOCK` when the timeout is negative, so the
 * driver clamps to a comfortably large positive value (1 year ≫ any
 * realistic critical section) instead.
 */
const MYSQL_INDEFINITE_LOCK_TIMEOUT_SECONDS = 60 * 60 * 24 * 365

export default class VelociousDatabaseDriversMysql extends Base{
  /** @type {import("mysql").Pool | undefined} */
  pool = undefined

  /** @type {string | null} */
  _desiredSessionTimeZone = "+00:00"

  /** @type {string | null} */
  _currentSessionTimeZone = null

  /**
   * Runs connect.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async connect() {
    this.resetCurrentSessionTimeZone()
    this.pool = mysql.createPool(Object.assign({connectionLimit: 1}, this.connectArgs()))
    this.pool.on("error", this.onPoolError)
  }

  /**
   * On pool error.
   * @param {Error} error - Error from the connection attempt.
   */
  onPoolError = (error) => {
    console.error("Velocious / MySQL driver / Pool error", error)
  }

  /**
   * Runs close.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async close() {
    await this.pool?.end()
    this.pool = undefined
    this.resetCurrentSessionTimeZone()
  }

  /**
   * Runs set connection checkout name.
   * @param {string | undefined} name - Human-readable name for this active checkout.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async setConnectionCheckoutName(name) {
    const previousName = this._connectionCheckoutName

    await super.setConnectionCheckoutName(name)

    if (name === undefined) {
      if (previousName !== undefined) {
        await this.query("SET @velocious_connection_checkout_name = NULL", {logName: "Clear Connection Checkout Name", processListComment: false, sessionTimeZone: false})
      }

      return
    }

    await this.query(`SET @velocious_connection_checkout_name = ${this.quote(name)}`, {logName: "Set Connection Checkout Name", processListComment: false, sessionTimeZone: false})
  }

  /**
   * Runs clear connection checkout name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async clearConnectionCheckoutName() {
    if (this._connectionCheckoutName !== undefined) {
      await this.query("SET @velocious_connection_checkout_name = NULL", {logName: "Clear Connection Checkout Name", processListComment: false, sessionTimeZone: false})
    }

    await super.clearConnectionCheckoutName()
  }

  /**
   * Hook before every query.
   * @param {string} _sql - SQL string.
   * @param {import("../base.js").QueryOptions} options - Query options.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async beforeQuery(_sql, options) {
    if (options.sessionTimeZone !== false) await this.ensureSessionTimeZone()
  }

  /**
   * Gets the desired database session time zone for this connection context.
   * @returns {string | null} - Desired session time zone.
   */
  getDesiredSessionTimeZone() {
    return this._desiredSessionTimeZone
  }

  /**
   * Sets the desired database session time zone without querying MySQL immediately.
   * @param {string | null} timeZone - Desired session time zone.
   */
  setDesiredSessionTimeZone(timeZone) {
    this._desiredSessionTimeZone = timeZone
  }

  /**
   * Gets the database session time zone last confirmed through SET time_zone.
   * @returns {string | null} - Current known session time zone.
   */
  getCurrentSessionTimeZone() {
    return this._currentSessionTimeZone
  }

  /**
   * Clears the current known database session time zone when the physical connection changes.
   */
  resetCurrentSessionTimeZone() {
    this._currentSessionTimeZone = null
  }

  /**
   * Ensures MySQL has the desired session time zone before user SQL runs.
   * @returns {Promise<boolean>} - True when SET time_zone was executed.
   */
  async ensureSessionTimeZone() {
    const desiredSessionTimeZone = this.getDesiredSessionTimeZone()

    if (desiredSessionTimeZone === null || this.getCurrentSessionTimeZone() === desiredSessionTimeZone) return false

    await this.setSessionTimeZone(desiredSessionTimeZone)

    return true
  }

  /**
   * Sets the database session time zone if it changed from the last confirmed value.
   * @param {string} timeZone - Session time zone value accepted by MySQL.
   * @returns {Promise<boolean>} - True when SET time_zone was executed.
   */
  async setSessionTimeZone(timeZone) {
    if (this.getCurrentSessionTimeZone() === timeZone) return false

    await this._queryActual(`SET time_zone = ${this.quote(timeZone)}`)
    this._currentSessionTimeZone = timeZone

    return true
  }

  /**
   * Runs connect args.
   * @returns {Record<string, ?>} - The connect args.
   */
  connectArgs() {
    const args = this.getArgs()
    const forward = ["database", "host", "password"]

    /**
     * Connect args.
     * @type {Record<string, ?>} */
    const connectArgs = {charset: "utf8mb4", timezone: "Z"}

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]
    if ("charset" in args) connectArgs["charset"] = args["charset"]

    return connectArgs
  }

  /**
   * Runs alter table sqls.
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async alterTableSQLs(tableData) {
    const alterArgs = {tableData, driver: this}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSQLs()
  }

  /**
   * Runs create database sql.
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifNotExists] - Whether if not exists.
   * @returns {string[]} - SQL statements.
   */
  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
  }

  /**
   * Runs drop database sql.
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifExists] - Whether if exists.
   * @returns {string[]} - SQL statements.
   */
  dropDatabaseSql(databaseName, args) {
    const dropArgs = Object.assign({databaseName, driver: this}, args)
    const dropDatabase = new DropDatabase(dropArgs)

    return dropDatabase.toSql()
  }

  /**
   * Runs create index sqls.
   * @param {import("../base.js").CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return await createIndex.toSQLs()
  }

  /**
   * Runs remove index sqls.
   * @param {import("../base.js").RemoveIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async removeIndexSQLs(indexData) {
    const removeArgs = Object.assign({driver: this}, indexData)
    const removeIndex = new RemoveIndex(removeArgs)

    return await removeIndex.toSQLs()
  }

  /**
   * Runs create table sql.
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) {
    const createArgs = {tableData, driver: this}
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  /**
   * Runs current database.
   * @returns {Promise<string>} - Resolves with the current database.
   */
  async currentDatabase() {
    const rows = await this.query("SELECT DATABASE() AS db_name")

    return digg(rows, 0, "db_name")
  }

  /**
   * Runs disable foreign keys.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async disableForeignKeys() {
    await this.query("SET FOREIGN_KEY_CHECKS = 0")
  }

  /**
   * Runs enable foreign keys.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async enableForeignKeys() {
    await this.query("SET FOREIGN_KEY_CHECKS = 1")
  }

  /**
   * Runs drop table sqls.
   * @param {string} tableName - Table name.
   * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return await dropTable.toSQLs()
  }

  /**
   * Runs get type.
   * @returns {string} - The type.
   */
  getType() { return "mysql" }

  /**
   * Runs retryable database error.
   * @param {Error} error - Error instance.
   * @returns {import("../base.js").RetryableDatabaseErrorResult} - Retry info.
   */
  retryableDatabaseError(error) {
    /** @type {Error | undefined} */
    let currentError = error
    let shouldReconnect = false

    while (currentError) {
      const errorCode = "code" in currentError && typeof currentError.code == "string" ? currentError.code : undefined
      const message = currentError.message || ""

      if (errorCode == "ER_CHECKREAD" || message.includes("Record has changed since last read")) {
        return {retry: true, reconnect: false, waitMs: 50}
      }

      shouldReconnect ||= (
        errorCode == "ECONNREFUSED" ||
        message.includes("ECONNREFUSED") ||
        message.includes("connect ECONNREFUSED") ||
        message.includes("PROTOCOL_CONNECTION_LOST") ||
        message.includes("Connection lost")
      )

      currentError = currentError.cause instanceof Error ? currentError.cause : undefined
    }

    return {
      retry: shouldReconnect,
      reconnect: shouldReconnect,
      waitMs: 50
    }
  }

  /**
   * Runs query actual.
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    if (!this.pool) await this.connect()
    if (!this.pool) throw new Error("MySQL pool failed to initialize")

    try {
      return await query(this.pool, sql)
    } catch (error) {
      // Re-throw to un-corrupt stacktrace
      if (error instanceof Error) {
        throw new Error(`Query failed: ${error.message}`, {cause: error})
      } else {
        throw new Error(`Query failed: ${error}`, {cause: error})
      }
    }
  }

  /**
   * Streams the rows of `sql` from a dedicated pooled connection using the MySQL cursor, so a
   * large result set is read incrementally instead of being buffered. Overrides the base
   * buffered fallback with true server-side streaming.
   * @param {string} sql - SQL string to stream.
   * @yields {Record<string, unknown>} - The result rows, one at a time.
   */
  async *queryStream(sql) {
    if (!this.pool) await this.connect()
    if (!this.pool) throw new Error("MySQL pool failed to initialize")

    yield* streamQuery(this.pool, sql)
  }

  /**
   * Executes a mutation with affected-row metadata.
   * @param {string} sql - Mutation SQL.
   * @returns {Promise<number>} - Affected row count.
   */
  async _affectedRowsActual(sql) {
    if (!this.pool) await this.connect()
    if (!this.pool) throw new Error("MySQL pool failed to initialize")
    const pool = this.pool

    return await new Promise((resolve, reject) => {
      pool.query(sql, (error, result) => {
        if (error) reject(error)
        else resolve("affectedRows" in result ? result.affectedRows : 0)
      })
    })
  }

  /**
   * Runs query to sql.
   * @param {import("../../query/index.js").default} query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(query) { return new QueryParser({query}).toSql() }

  /**
   * Runs should set auto increment when primary key.
   * @returns {boolean} - Whether set auto increment when primary key.
   */
  shouldSetAutoIncrementWhenPrimaryKey() { return true }
  supportsDefaultPrimaryKeyUUID() { return false }
  supportsCrossDatabaseReferences() { return true }

  /**
   * Runs escape.
   * @param {?} value - Value to use.
   * @returns {?} - The escape.
   */
  escape(value) {
    const escapedValueWithQuotes = this.pool
      ? this.pool.escape(this._convertValue(value))
      : mysql.escape(this._convertValue(value))

    return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1)
  }

  /**
   * Runs quote.
   * @param {string} value - Value to use.
   * @returns {string} - The quote.
   */
  quote(value) {
    if (this.pool) {
      return this.pool.escape(this._convertValue(value))
    }

    return mysql.escape(this._convertValue(value))
  }

  /**
   * Runs delete sql.
   * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  /**
   * Runs insert sql.
   * @abstract
   * @param {import("../base.js").InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) {
    const insertArgs = Object.assign({driver: this}, args)
    const insert = new Insert(insertArgs)

    return insert.toSql()
  }

  /**
   * Runs get tables.
   * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
   */
  async getTables() {
    return await this._cachedSchemaMetadata("tables", async () => {
      const result = await this.query("SHOW FULL TABLES")
      const tables = []

      for (const row of result) {
        const table = new Table(this, /** @type {Record<string, string>} */ (row))

        tables.push(table)
      }

      return tables
    })
  }

  /**
   * Runs structure sql.
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return await this._cachedSchemaMetadata("structureSql", async () => await new StructureSql({driver: this}).toSql())
  }

  /**
   * Runs last insert id.
   * @returns {Promise<number>} - Resolves with the last insert id.
   */
  async lastInsertID() {
    const result = await this.query("SELECT LAST_INSERT_ID() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  /**
   * Runs options.
   * @returns {Options} - The options options.
   */
  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  /**
   * Runs start transaction action.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startTransactionAction() {
    await this.query("START TRANSACTION")
  }

  /**
   * Runs update sql.
   * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }

  /**
   * Runs upsert sql.
   * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  upsertSql(args) {
    const upsert = new Upsert({...args, driver: this})

    return upsert.toSql()
  }

  /**
   * Blocks until a MySQL/MariaDB user-level lock is acquired on this
   * connection. Implemented via `GET_LOCK(name, timeout)`, where the
   * timeout is in seconds.
   *
   * MySQL historically documented a negative timeout as "infinite",
   * but MariaDB 10+ silently rejects negative timeouts and returns
   * `NULL` from `GET_LOCK`. To make the helper portable across MySQL
   * and MariaDB the "indefinite" case is encoded as a large positive
   * timeout (one year), which is comfortably longer than any
   * realistic critical section and works on every supported version.
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks for `MYSQL_INDEFINITE_LOCK_TIMEOUT_SECONDS`.
   * @returns {Promise<boolean>} - True if acquired, false if the timeout elapsed.
   */
  async acquireAdvisoryLock(name, {timeoutMs} = {}) {
    const timeoutSeconds = typeof timeoutMs === "number" && timeoutMs >= 0
      ? Math.ceil(timeoutMs / 1000)
      : MYSQL_INDEFINITE_LOCK_TIMEOUT_SECONDS
    const rows = await this.query(`SELECT GET_LOCK(${this.quote(name)}, ${timeoutSeconds}) AS velocious_advisory_lock_result`)
    const result = rows?.[0]?.velocious_advisory_lock_result

    if (result === null || result === undefined) {
      throw new Error(`GET_LOCK returned NULL for advisory lock ${JSON.stringify(name)} (typically an out-of-memory or thread-killed condition)`)
    }

    return Number(result) === 1
  }

  /**
   * Runs try acquire advisory lock.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
   */
  async tryAcquireAdvisoryLock(name) {
    const rows = await this.query(`SELECT GET_LOCK(${this.quote(name)}, 0) AS velocious_advisory_lock_result`)
    const result = rows?.[0]?.velocious_advisory_lock_result

    if (result === null || result === undefined) {
      throw new Error(`GET_LOCK returned NULL for advisory lock ${JSON.stringify(name)} (typically an out-of-memory or thread-killed condition)`)
    }

    return Number(result) === 1
  }

  /**
   * Runs release advisory lock.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
   */
  async releaseAdvisoryLock(name) {
    const rows = await this.query(`SELECT RELEASE_LOCK(${this.quote(name)}) AS velocious_advisory_lock_result`)
    const result = rows?.[0]?.velocious_advisory_lock_result

    return Number(result) === 1
  }

  /**
   * Runs is advisory lock held.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if any session currently holds the lock.
   */
  async isAdvisoryLockHeld(name) {
    const rows = await this.query(`SELECT IS_USED_LOCK(${this.quote(name)}) AS velocious_advisory_lock_holder`)
    const holder = rows?.[0]?.velocious_advisory_lock_holder

    return holder !== null && holder !== undefined
  }
}
