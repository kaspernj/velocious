// @ts-check

import ConnectionSqlJs from "./connection-sql-js.js"
import initSqlJs from "sql.js"
import {createSqliteWebPersistence, deleteSqliteWebPersistences, sqliteWebPersistenceKey} from "./web-persistence.js"

import Base from "./base.js"

/**
 * VelociousDatabaseDriversSqliteWeb class.
 * @typedef {{query: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} SqliteWebConnection
 */

export default class VelociousDatabaseDriversSqliteWeb extends Base {
  /**
   * Connection.
   * @type {ConnectionSqlJs | undefined} */
  _connection = undefined

  /**
   * Runs sql js locate file.
   * @returns {(file: string) => string} - locateFile callback for sql.js.
   */
  sqlJsLocateFile() {
    const locateFile = this.getArgs().locateFile

    if (typeof locateFile === "function") {
      return locateFile
    }

    return (file) => `https://sql.js.org/dist/${file}`
  }

  async connect() {
    this.args = this.getArgs()

    if (!this.args.getConnection) {
      if (this.args.reset) {
        await deleteSqliteWebPersistences({databaseName: this.databaseName()})
      }

      const persistence = await createSqliteWebPersistence({databaseName: this.databaseName()})
      const SQL = await initSqlJs({locateFile: this.sqlJsLocateFile()})
      const databaseContent = await persistence.load()
      const connectionSqlJs = new ConnectionSqlJs(this, new SQL.Database(databaseContent), persistence)

      this._connection = connectionSqlJs
    }
  }

  async _close() {
    await this.getConnection().close()
  }

  /**
   * Flushes pending SQL.js local persistence writes.
   * @returns {Promise<void>} - Resolves when pending writes are durable.
   */
  async flushPendingWrites() {
    if (!this.args?.getConnection) {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")

      await this._connection.flushDatabaseSave()
    }
  }

  /**
   * Starts an outer transaction after draining SQL.js persistence admission.
   * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when the transaction starts.
   */
  async startTransaction(options = {}) {
    if (!this.args?.getConnection) {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")

      try {
        await super.startTransaction(options)
      } finally {
        this._connection.completeTransactionStart()
      }

      return
    }

    await super.startTransaction(options)
  }

  /**
   * Coordinates SQL BEGIN with active and queued persistence exports.
   * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when the transaction starts.
   */
  async _startTransactionAction(options = {}) {
    if (!this.args?.getConnection) {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")

      await this._connection.withTransactionStart(async () => {
        await super._startTransactionAction(options)
      })

      return
    }

    await super._startTransactionAction(options)
  }

  /**
   * Commits and persists bytes after the outermost SQL.js transaction closes.
   * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when committed bytes are persisted.
   */
  async commitTransaction(options = {}) {
    const outermostTransaction = this._transactionsCount === 1

    await super.commitTransaction(options)

    if (outermostTransaction && !this.args?.getConnection) {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")

      await this._connection.flushPendingDatabaseSave()
    }
  }

  /**
   * Rolls back and persists bytes after the outermost SQL.js transaction closes.
   * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when rolled-back bytes are persisted.
   */
  async rollbackTransaction(options = {}) {
    const outermostTransaction = this._transactionsCount === 1

    await super.rollbackTransaction(options)

    if (outermostTransaction && !this.args?.getConnection) {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")

      await this._connection.flushPendingDatabaseSave()
    }
  }

  /**
   * Runs get connection.
   * @returns {ConnectionSqlJs | SqliteWebConnection} - The connection.
   */
  getConnection() {
    if (this.args?.getConnection) {
      return /** @type {SqliteWebConnection} */ (this.args.getConnection())
    } else {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")
      return this._connection
    }
  }

  localStorageName() {
    return sqliteWebPersistenceKey(this.databaseName())
  }

  /**
   * Returns the configured database name.
   * @returns {string} - Database name.
   */
  databaseName() {
    const name = this.args?.name

    if (typeof name !== "string" || name.length < 1) throw new Error("No name given in arguments for SQLite Web database")

    return name
  }

  /**
   * Runs query actual.
   * @param {string} sql - SQL string.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    const result = await this.getConnection().query(sql)

    if (!Array.isArray(result)) {
      const connection = this.getConnection()
      const connectionName = connection?.constructor?.name || "UnknownConnection"

      throw new Error(`Sqlite web connection ${connectionName} returned a non-array result: ${typeof result}`)
    }

    return result
  }

  /**
   * Executes a mutation with affected-row metadata.
   * @param {string} sql - Mutation SQL.
   * @returns {Promise<number>} - Affected row count.
   */
  async _affectedRowsActual(sql) {
    const connection = this.getConnection()
    return await connection.affectedRows(sql)
  }
}
