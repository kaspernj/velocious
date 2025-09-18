import BetterLocalStorage from "better-localstorage"
import ConnectionSqlJs from "./connection-sql-js"
import initSqlJs from "sql.js"

import Base from "./base.js"

export default class VelociousDatabaseDriversSqliteWeb extends Base {
  async connect() {
    this.args = this.getArgs()

    if (!this.args.getConnection) {
      this.betterLocalStorage ||= new BetterLocalStorage()

      if (this.args.reset) {
        await this.betterLocalStorage.delete(this.localStorageName())
      }

      const SQL = await initSqlJs({
        // Required to load the wasm binary asynchronously. Of course, you can host it wherever you want you can omit locateFile completely when running in Node.
        locateFile: (file) => `https://sql.js.org/dist/${file}`
      })

      const databaseContent = await this.betterLocalStorage.get(this.localStorageName())
      const connectionSqlJs = new ConnectionSqlJs(this, new SQL.Database(databaseContent))

      this._connection = connectionSqlJs
    }
  }

  async close() {
    await this.getConnection().close()
  }

  getConnection() {
    if (this.args.getConnection) {
      return this.args.getConnection()
    } else {
      return this._connection
    }
  }

  localStorageName() {
    if (!this.args.name) {
      throw new Error("No name given in arguments for SQLite Web database")
    }

    return `VelociousDatabaseDriversSqliteWeb---${this.args.name}`
  }

  async _queryActual(sql) {
    return await this.getConnection().query(sql)
  }
}
