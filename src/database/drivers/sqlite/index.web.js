// @ts-check

import BetterLocalStorage from "better-localstorage"
import ConnectionSqlJs from "./connection-sql-js.js"
import initSqlJs from "sql.js"

import Base from "./base.js"

/**
 * VelociousDatabaseDriversSqliteWeb class.
 * @typedef {{query: (sql: string) => Promise<Record<string, ?>[]>, close: () => Promise<void>}} SqliteWebConnection
 */

export default class VelociousDatabaseDriversSqliteWeb extends Base {
  /**
 * Better local storage.
 * @type {BetterLocalStorage | undefined} */
  betterLocalStorage = undefined
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
      this.betterLocalStorage ||= new BetterLocalStorage()

      if (this.args.reset) {
        await this.betterLocalStorage.delete(this.localStorageName())
      }

      const SQL = await initSqlJs({locateFile: this.sqlJsLocateFile()})

      const databaseContent = await this.betterLocalStorage.get(this.localStorageName())
      const connectionSqlJs = new ConnectionSqlJs(this, new SQL.Database(databaseContent))

      this._connection = connectionSqlJs
    }
  }

  async close() {
    await this.getConnection().close()
  }

  /**
 * Runs get connection.
 * @returns {ConnectionSqlJs | SqliteWebConnection} - The connection.  */
  getConnection() {
    if (this.args?.getConnection) {
      return /** Documents this API. @type {SqliteWebConnection} */ (this.args.getConnection())
    } else {
      if (!this._connection) throw new Error("SQLite web connection has not been initialized")
      return this._connection
    }
  }

  localStorageName() {
    if (!this.args?.name) {
      throw new Error("No name given in arguments for SQLite Web database")
    }

    return `VelociousDatabaseDriversSqliteWeb---${this.args?.name}`
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
