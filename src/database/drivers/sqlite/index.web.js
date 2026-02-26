// @ts-check

import BetterLocalStorage from "better-localstorage"
import ConnectionSqlJs from "./connection-sql-js.js"
import initSqlJs from "sql.js"

import Base from "./base.js"

/**
 * @typedef {{query: (sql: string) => Promise<Record<string, unknown>[]>, close: () => Promise<void>}} SqliteWebConnection
 */

export default class VelociousDatabaseDriversSqliteWeb extends Base {
  /** @type {BetterLocalStorage | undefined} */
  betterLocalStorage = undefined

  /**
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

  /** @returns {ConnectionSqlJs | SqliteWebConnection} - The connection.  */
  getConnection() {
    if (this.args?.getConnection) {
      return /** @type {SqliteWebConnection} */ (this.args.getConnection())
    } else {
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
   * @param {string} sql - SQL string.
   * @returns {Promise<Record<string, any>[]>} - Resolves with the query actual.
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
