// @ts-check

import {digg} from "diggerize"

import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import DropTable from "./sql/drop-table.js"
import escapeString from "sql-escape-string"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import StructureSql from "./structure-sql.js"
import Upsert from "./sql/upsert.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversSqliteBase extends Base {
  /** @type {number | undefined} */
  versionMajor = undefined
  /** @type {number | undefined} */
  versionMinor = undefined
  /** @type {number | undefined} */
  versionPatch = undefined

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async alterTableSQLs(tableData) {
    const alterArgs = {driver: this, tableData}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSQLs()
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
   * @abstract
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) {
    const createArgs = {tableData, driver: this, indexInCreateTable: false}
    const createTable = new CreateTable(createArgs)

    return await createTable.toSql()
  }

  currentDatabase() {
    return null
  }

  async disableForeignKeys() {
    await this.query("PRAGMA foreign_keys = 0")
  }

  async enableForeignKeys() {
    await this.query("PRAGMA foreign_keys = 1")
  }

  /**
   * @param {string} tableName - Table name.
   * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args = {}) {
    const driver = /** @type {import("../base.js").default} */ (this)
    const dropArgs = Object.assign({tableName, driver}, args)
    const dropTable = new DropTable(dropArgs)

    return await dropTable.toSQLs()
  }

  /**
   * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql(args) { return new Delete(Object.assign({driver: this}, args)).toSql() }

  /**
   * @returns {string} - The type.
   */
  getType() { return "sqlite" }

  /**
   * @param {import("../base.js").InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) { return new Insert(Object.assign({driver: this}, args)).toSql() }

  /**
   * @param {string} name - Name.
   * @param {object} [args] - Options object.
   * @param {boolean} args.throwError - Whether throw error.
   * @returns {Promise<import("../base-table.js").default | undefined>} - Resolves with the table by name.
   */
  async getTableByName(name, args) {
    const result = await this.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${this.quote(name)} LIMIT 1`)
    const row = result[0]

    if (row) {
      return new Table({driver: this, row: /** @type {Record<string, string | number | null>} */ (row)})
    }

    if (args?.throwError !== false) {
      const tables = await this.getTables()
      const tableNames = tables.map((table) => table.getName())

      throw new Error(this._missingTableErrorMessage(name, tableNames))
    }
  }

  /** @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.  */
  async getTables() {
    const result = await this.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    const tables = []

    for (const row of result) {
      const table = new Table({driver: this, row: /** @type {Record<string, string | number | null>} */ (row)})

      tables.push(table)
    }

    return tables
  }

  /**
   * @param {string} tableName - Table name.
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<unknown>>} rows - Rows to insert.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insertMultiple(tableName, columns, rows) {
    this._assertNotReadOnly()
    await this.registerVersion()

    if (this.supportsMultipleInsertValues()) {
      await this.insertMultipleWithSingleInsert(tableName, columns, rows)
    } else {
      await this.insertMultipleWithTransaction(tableName, columns, rows)
    }
  }

  /**
   * @returns {boolean} - Whether supports multiple insert values.
   */
  supportsMultipleInsertValues() {
    /** @type {number} */
    const versionMajor = this.versionMajor || 0
    /** @type {number} */
    const versionMinor = this.versionMinor || 0
    /** @type {number} */
    const versionPatch = this.versionPatch || 0

    if (versionMajor >= 4) return true
    if (versionMajor == 3 && versionMinor >= 8) return true
    if (versionMajor == 3 && versionMinor == 7 && versionPatch >= 11) return true

    return false
  }

  /**
   * @returns {boolean} - Whether supports insert into returning.
   */
  supportsInsertIntoReturning() {
    /** @type {number} */
    const versionMajor = this.versionMajor || 0
    /** @type {number} */
    const versionMinor = this.versionMinor || 0

    if (versionMajor >= 4) return true
    if (versionMajor == 3 && versionMinor >= 35) return true

    return false
  }

  /**
   * @param {string} tableName - Table name.
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<unknown>>} rows - Rows to insert.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insertMultipleWithSingleInsert(tableName, columns, rows) {
    this._assertNotReadOnly()
    const sql = new Insert({columns, driver: this, rows, tableName}).toSql()

    await this.query(sql)
  }

  /**
   * @param {string} tableName - Table name.
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<unknown>>} rows - Rows to insert.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insertMultipleWithTransaction(tableName, columns, rows) {
    this._assertNotReadOnly()
    /** @type {string[]} */
    const sqls = []

    for (const row of rows) {
      /** @type {Record<string, any>} */
      const data = {}

      for (const columnIndex in columns) {
        const columnName = columns[columnIndex]
        const value = row[columnIndex]

        data[columnName] = value
      }

      const insertSql = this.insertSql({tableName, data})

      sqls.push(insertSql)
    }

    await this.transaction(async () => {
      for (const sql of sqls) {
        await this.query(sql)
      }
    })
  }

  async lastInsertID() {
    const result = await this.query("SELECT LAST_INSERT_ROWID() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) this._options = new Options(this)

    return this._options
  }

  /**
   * @returns {string} - The type of the primary key for this driver.
   */
  primaryKeyType() { return "integer" } // Because bigint on SQLite doesn't support auto increment

  /**
   * @param {import("../../query/index.js").default} query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(query) { return new QueryParser({query}).toSql() }

  async registerVersion() {
    if (this.versionMajor || this.versionMinor) {
      return
    }

    const versionResult = await this.query("SELECT sqlite_version() AS version")

    this.version = String(versionResult[0].version)

    const versionParts = this.version.split(".")

    this.versionMajor = Number(versionParts[0])
    this.versionMinor = Number(versionParts[1])
    this.versionPatch = Number(versionParts[2])
  }

  shouldSetAutoIncrementWhenPrimaryKey() { return false }
  supportsDefaultPrimaryKeyUUID() { return false }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The escape.
   */
  escape(value) {
    value = this._convertValue(value)

    const type = typeof value

    if (type != "string") value = `${value}`

    const resultWithQuotes = escapeString(value, null)
    const result = resultWithQuotes.substring(1, resultWithQuotes.length - 1)

    return result
  }

  /**
   * @param {Error} error - Error instance.
   * @returns {import("../base.js").RetryableDatabaseErrorResult} - Retry info.
   */
  retryableDatabaseError(error) {
    const shouldRetry = (
      error.message?.startsWith("attempt to write a readonly database") ||
      error.message?.startsWith("database is locked") ||
      error.message?.includes("→ Caused by: Error code : database is locked")
    )

    return {retry: shouldRetry, reconnect: false}
  }

  /**
   * @param {any} value - Value to use.
   * @returns {string | number} - The quoted value.
   */
  quote(value) {
    value = this._convertValue(value)

    const type = typeof value

    if (type == "number") return /** @type {number} */ (value)
    if (type != "string") value = String(value)

    return escapeString(value, null)
  }

  /**
   * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql({conditions, data, tableName}) { return new Update({conditions, data, driver: this, tableName}).toSql() }

  /**
   * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  upsertSql(args) { return new Upsert({...args, driver: this}).toSql() }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return await new StructureSql({driver: this}).toSql()
  }

  /**
   * Blocks until an in-process advisory lock with the given name is
   * acquired. SQLite has no built-in advisory lock primitive, so this is
   * implemented as a process-local waiter queue. Typical SQLite deployments
   * run inside a single Node process, which is exactly the scope this
   * emulation covers; multi-process SQLite setups should not rely on this
   * for cross-process mutual exclusion.
   *
   * The owning driver instance is recorded so that `releaseAdvisoryLock`
   * can refuse to release a lock that was acquired by someone else.
   *
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if the timeout elapsed.
   */
  async acquireAdvisoryLock(name, {timeoutMs} = {}) {
    const state = VelociousDatabaseDriversSqliteBase._advisoryLockState

    while (state.ownersByName.has(name)) {
      let remainingMs = null

      if (typeof timeoutMs === "number" && timeoutMs >= 0) {
        remainingMs = timeoutMs

        if (remainingMs <= 0) return false
      }

      await new Promise((resolve) => {
        const waiters = state.waitersByName.get(name) || []
        /** @type {NodeJS.Timeout | null} */
        let timeoutHandle = null
        /** @type {(() => void) | null} */
        let removeAndResolve = null

        removeAndResolve = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle)

          const current = state.waitersByName.get(name) || []
          const index = current.indexOf(/** @type {() => void} */ (removeAndResolve))

          if (index >= 0) current.splice(index, 1)
          if (current.length === 0) state.waitersByName.delete(name)

          resolve(undefined)
        }

        waiters.push(removeAndResolve)
        state.waitersByName.set(name, waiters)

        if (remainingMs !== null) {
          timeoutHandle = setTimeout(() => {
            if (removeAndResolve) removeAndResolve()
          }, remainingMs)
        }
      })

      if (typeof timeoutMs === "number" && timeoutMs >= 0 && state.ownersByName.has(name)) {
        return false
      }
    }

    state.ownersByName.set(name, this)

    return true
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
   */
  async tryAcquireAdvisoryLock(name) {
    const state = VelociousDatabaseDriversSqliteBase._advisoryLockState

    if (state.ownersByName.has(name)) return false

    state.ownersByName.set(name, this)

    return true
  }

  /**
   * Releases the lock only if **this** driver instance owns it. Calling
   * release for a lock owned by another driver instance is a no-op that
   * returns `false`, matching the "you can only release locks you own"
   * contract of MySQL's `RELEASE_LOCK` and PostgreSQL's
   * `pg_advisory_unlock`.
   *
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if the lock was held by this driver and has now been released.
   */
  async releaseAdvisoryLock(name) {
    const state = VelociousDatabaseDriversSqliteBase._advisoryLockState
    const owner = state.ownersByName.get(name)

    if (owner !== this) return false

    state.ownersByName.delete(name)

    const waiters = state.waitersByName.get(name)

    if (waiters && waiters.length > 0) {
      const nextWaiter = waiters.shift()

      if (waiters.length === 0) state.waitersByName.delete(name)
      if (nextWaiter) nextWaiter()
    }

    return true
  }

  /**
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - True if any driver instance currently holds the lock.
   */
  async isAdvisoryLockHeld(name) {
    return VelociousDatabaseDriversSqliteBase._advisoryLockState.ownersByName.has(name)
  }
}

/**
 * Process-wide state for the SQLite advisory lock emulation. Shared across
 * every SQLite driver instance (native, web, sql.js) because there is no
 * concept of "connection" to distinguish them at the SQLite level.
 *
 * `ownersByName` maps each held lock name to the driver instance that
 * acquired it so `releaseAdvisoryLock` can reject releases from drivers
 * that do not own the lock.
 *
 * @type {{ownersByName: Map<string, VelociousDatabaseDriversSqliteBase>, waitersByName: Map<string, Array<() => void>>}}
 */
VelociousDatabaseDriversSqliteBase._advisoryLockState = {
  ownersByName: new Map(),
  waitersByName: new Map()
}
