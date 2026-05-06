// @ts-check

import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import DropDatabase from "./sql/drop-database.js"
import DropTable from "./sql/drop-table.js"
import {digg} from "diggerize"
import escapeString from "sql-escape-string"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import mssql from "mssql"
import net from "node:net"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import StructureSql from "./structure-sql.js"
import timeout from "awaitery/build/timeout.js"
import Upsert from "./sql/upsert.js"
import Update from "./sql/update.js"
import UUID from "pure-uuid"

export default class VelociousDatabaseDriversMssql extends Base{
  async connect() {
    const args = this.getArgs()
    const sqlConfig = digg(args, "sqlConfig")

    try {
      if (sqlConfig?.server && !sqlConfig.options?.serverName && net.isIP(sqlConfig.server)) {
        sqlConfig.options = Object.assign({}, sqlConfig.options, {serverName: ""})
      }

      this.connection = new mssql.ConnectionPool(sqlConfig)
      await this.connection.connect()
    } catch (error) {
      // Re-throw to fix unuseable stack trace.
      throw new Error(`Couldn't connect to database: ${error instanceof Error ? error.message : error}`, {cause: error})
    }
  }

  async close() {
    if (!this.connection) return

    const connection = this.connection
    this.connection = undefined
    this._currentTransaction = null
    this._transactionsCount = 0

    try {
      await timeout({timeout: 2000}, () => connection.close())
    } catch (error) {
      this.logger.warn("Failed to close MSSQL connection cleanly", {error})
    }
  }

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async alterTableSQLs(tableData) {
    const alterArgs = {tableData, driver: this}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSQLs()
  }

  /**
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
   * @param {import("../base.js").CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return await createIndex.toSQLs()
  }

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) {
    const createArgs = {tableData, driver: this, indexInCreateTable: false}
    const createTable = new CreateTable(createArgs)

    return await createTable.toSql()
  }

  /**
   * @returns {Promise<string>} - Resolves with the current database.
   */
  async currentDatabase() {
    const rows = await this.query("SELECT DB_NAME() AS db_name")

    return digg(rows, 0, "db_name")
  }

  async disableForeignKeys() {
    await this.query("EXEC sp_MSforeachtable \"ALTER TABLE ? NOCHECK CONSTRAINT all\"")
  }

  async enableForeignKeys() {
    await this.query("EXEC sp_MSforeachtable @command1=\"print '?'\", @command2=\"ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all\"")
  }

  /**
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
   * @returns {string} - The type.
   */
  getType() { return "mssql" }

  /**
   * @returns {string} - The primary key type.
   */
  primaryKeyType() { return "bigint" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    let result
    let tries = 0

    while (true) {
      tries++

      try {
        const request = this._currentTransaction
          ? new mssql.Request(this._currentTransaction)
          : new mssql.Request(this.connection)
        result = await request.query(sql)
        break
      } catch (error) {
        if (error instanceof Error && error.message == "No connection is specified for that request." && tries <= 3) {
          this.logger.warn("Reconnecting to database")
          await this.connect()
          // Retry
        } else if (error instanceof Error) {
          // Re-throw error because the stack-trace is broken and can't be used for app-development.
          throw new Error(`Query failed '${error.message}': ${sql}`, {cause: error})
        } else {
          throw new Error(`Query failed '${error}': ${sql}`, {cause: error})
        }
      }
    }

    return Array.isArray(result.recordsets) ? result.recordsets[0] || [] : []
  }

  /**
   * @param {import("../../query/index.js").default} query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(query) { return new QueryParser({query}).toSql() }

  shouldSetAutoIncrementWhenPrimaryKey() { return true }
  supportsDefaultPrimaryKeyUUID() { return true }

  /**
   * @param {unknown} value - Value to use.
   * @returns {string} - The escape.
   */
  escape(value) {
    value = this._convertValue(value)
    const stringValue = typeof value == "string" ? value : `${value}`

    const resultWithQuotes = escapeString(stringValue, null)
    const result = resultWithQuotes.substring(1, resultWithQuotes.length - 1)

    return result
  }

  /**
   * @param {unknown} value - Value to use.
   * @returns {string | number} - The quoted value.
   */
  quote(value) {
    value = this._convertValue(value)

    if (typeof value == "number") return value
    const stringValue = typeof value == "string" ? value : String(value)

    return `N${escapeString(stringValue, null)}`
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {string} - The quote column.
   */
  quoteColumn(columnName) { return this.options().quoteColumnName(columnName) }

  /**
   * @param {string} string - String.
   * @returns {string} - The quote table.
   */
  quoteTable(string) { return this.options().quoteTableName(string) }

  /**
   * @param {string} tableName - Table name.
   * @param {string} oldColumnName - Previous column name.
   * @param {string} newColumnName - New column name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    await this.query(`EXEC sp_rename ${this.quote(`${tableName}.${oldColumnName}`)}, ${this.quote(newColumnName)}, 'COLUMN'`)
  }

  /**
   * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  /**
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
   * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
   */
  async getTables() {
    return await this._cachedSchemaMetadata("tables", async () => {
      const schema = this.getArgs()?.schema || this.getArgs()?.sqlConfig?.options?.schema
      const schemaClause = schema
        ? ` AND [TABLE_SCHEMA] = ${this.quote(schema)}`
        : " AND [TABLE_SCHEMA] = SCHEMA_NAME()"
      const result = await this.query(`SELECT [TABLE_NAME] FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_CATALOG] = DB_NAME()${schemaClause}`)
      const tables = []

      for (const row of result) {
        const table = new Table(this, /** @type {Record<string, string>} */ (row))

        tables.push(table)
      }

      return tables
    })
  }

  async lastInsertID() {
    const result = await this.query("SELECT SCOPE_IDENTITY() AS last_insert_id")
    const lastInsertID = digg(result, 0, "last_insert_id")

    if (lastInsertID === null) throw new Error("Couldn't get the last inserted ID")

    return lastInsertID
  }

  /** @returns {Options} - The options options.  */
  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  async _startTransactionAction() {
    if (this._currentTransaction) throw new Error("A transaction is already running")
    if (!this.connection) await this.connect()

    this._currentTransaction = new mssql.Transaction(this.connection)

    try {
      await this._currentTransaction.begin()
    } catch (error) {
      this._currentTransaction = null
      throw error
    }
  }

  async _commitTransactionAction() {
    if (!this._currentTransaction) throw new Error("A transaction isn't running")

    await this._currentTransaction.commit()
    this._currentTransaction = null
  }

  async _rollbackTransactionAction() {
    if (!this._currentTransaction) {
      this.logger.debug("A transaction isn't running - ignoring because that can happen if something else has failed in the db")
      return
    }

    try {
      await this._currentTransaction.rollback()
    } catch (transactionRollbackError) {
      // When SQL Server has already aborted the transaction (e.g., a
      // stale concurrent request triggered XACT_ABORT), the
      // mssql.Transaction.rollback() call fails because the
      // Transaction object is dead.  Issue a raw ROLLBACK on the
      // underlying connection to clear SQL Server's session-level
      // aborted-transaction state so the connection is usable for the
      // next BEGIN TRANSACTION.
      this.logger.warn("Transaction.rollback() failed, clearing session state with raw ROLLBACK", {
        error: transactionRollbackError instanceof Error ? transactionRollbackError.message : transactionRollbackError
      })

      const request = new mssql.Request(this.connection)

      await request.query("IF @@TRANCOUNT > 0 ROLLBACK")
    } finally {
      this._currentTransaction = null
    }
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startSavePointAction(savePointName) {
    await this.query(`SAVE TRANSACTION [${savePointName}]`)
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _releaseSavePointAction(savePointName) { // eslint-disable-line no-unused-vars
    // Do nothing in MS-SQL.
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackSavePointAction(savePointName) {
    try {
      await this.query(`ROLLBACK TRANSACTION [${savePointName}]`)
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`

      // When XACT_ABORT kills the entire transaction, the savepoint
      // no longer exists and the ROLLBACK TRANSACTION [name] fails.
      // Issue a raw IF @@TRANCOUNT > 0 ROLLBACK to clear whatever
      // session state remains, then let the error propagate so the
      // outer transaction() call knows the transaction is dead.
      if (message.includes("Transaction has not begun") || message.includes("Transaction has been aborted")) {
        this.logger.debug("Savepoint rollback failed; transaction already dead, clearing session state")

        const request = new mssql.Request(this.connection)

        await request.query("IF @@TRANCOUNT > 0 ROLLBACK")

        return
      }

      throw error
    }
  }

  generateSavePointName() {
    return `sp${new UUID(4).format().replaceAll("-", "")}`.substring(0, 32)
  }

  /**
   * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }

  /**
   * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  upsertSql(args) {
    const upsert = new Upsert({...args, driver: this})

    return upsert.toSql()
  }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return await this._cachedSchemaMetadata("structureSql", async () => await new StructureSql({driver: this}).toSql())
  }

  /**
   * Blocks until a SQL Server application lock is acquired on this
   * connection via `sp_getapplock`. The Session lock owner scopes the lock
   * to the current session, matching the connection-scoped semantics on
   * MySQL and PostgreSQL.
   *
   * `sp_getapplock` returns 0 on immediate grant, 1 after waiting, and
   * negative values on failure (timeout, deadlock, canceled, parameter
   * error). We treat 0/1 as success and -1 (timeout) as a clean `false`;
   * anything else throws.
   *
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if the timeout elapsed.
   */
  async acquireAdvisoryLock(name, {timeoutMs} = {}) {
    const timeoutValue = typeof timeoutMs === "number" && timeoutMs >= 0 ? Math.ceil(timeoutMs) : -1
    const rows = await this.query(
      `DECLARE @velocious_advisory_lock_result INT; EXEC @velocious_advisory_lock_result = sp_getapplock @Resource = ${this.quote(name)}, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = ${timeoutValue}; SELECT @velocious_advisory_lock_result AS velocious_advisory_lock_result`
    )
    const result = Number(rows?.[0]?.velocious_advisory_lock_result)

    if (result === 0 || result === 1) return true
    if (result === -1) return false

    throw new Error(`sp_getapplock returned ${result} for advisory lock ${JSON.stringify(name)} (see SQL Server documentation for sp_getapplock return codes)`)
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
   */
  async tryAcquireAdvisoryLock(name) {
    return await this.acquireAdvisoryLock(name, {timeoutMs: 0})
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
   */
  async releaseAdvisoryLock(name) {
    const rows = await this.query(
      `DECLARE @velocious_advisory_lock_result INT; EXEC @velocious_advisory_lock_result = sp_releaseapplock @Resource = ${this.quote(name)}, @LockOwner = 'Session'; SELECT @velocious_advisory_lock_result AS velocious_advisory_lock_result`
    )
    const result = Number(rows?.[0]?.velocious_advisory_lock_result)

    return result === 0
  }

  /**
   * Returns true if any session currently holds the application lock.
   *
   * This combines two probes because neither is sufficient on its own:
   *   - `APPLOCK_MODE(..., 'Session')` only reports locks held by the
   *     **current** session, so it misses locks held by any other
   *     session and would return `NoLock` even under cross-session
   *     contention.
   *   - `APPLOCK_TEST(..., 'Exclusive', 'Session')` returns whether an
   *     Exclusive lock could be granted to *this* session right now. A
   *     return value of 0 means somebody else holds an incompatible
   *     lock; a value of 1 means it is either free **or** already held
   *     by us re-entrantly (which the `APPLOCK_MODE` check catches).
   *
   * The combined result is "held" iff we hold it ourselves or
   * `APPLOCK_TEST` reports we cannot acquire it without waiting.
   *
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if any session currently holds the lock.
   */
  async isAdvisoryLockHeld(name) {
    const rows = await this.query(
      `SELECT ` +
        `APPLOCK_MODE('public', ${this.quote(name)}, 'Session') AS velocious_advisory_self_mode, ` +
        `APPLOCK_TEST('public', ${this.quote(name)}, 'Exclusive', 'Session') AS velocious_advisory_test_result`
    )
    const selfMode = rows?.[0]?.velocious_advisory_self_mode
    const heldBySelf = typeof selfMode === "string" && selfMode.length > 0 && selfMode !== "NoLock"

    if (heldBySelf) return true

    const testResult = Number(rows?.[0]?.velocious_advisory_test_result)

    return testResult === 0
  }
}
