// @ts-check

import ConnectionSqlJs from "./connection-sql-js.js"
import initSqlJs from "sql.js"
import {createSqliteWebPersistence, deleteSqliteWebPersistences, sqliteWebPersistenceKey} from "./web-persistence.js"

import Base from "./base.js"

/**
 * VelociousDatabaseDriversSqliteWeb class.
 * @typedef {{query: (sql: string) => Promise<Record<string, ?>[]>, close: () => Promise<void>}} SqliteWebConnection
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

  async close() {
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
   * @returns {Promise<Record<string, ?>[]>} - Resolves with the query actual.
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
}
