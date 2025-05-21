import Base from "./base.mjs"
import {digg} from "diggerize"
import Options from "../sqlite/options.mjs"
import query from "./query"

import initSqlJs from "sql.js"

export default class VelociousDatabaseDriversSqliteWeb extends Base {
  async connect() {
    const SQL = await initSqlJs({
      // Required to load the wasm binary asynchronously. Of course, you can host it wherever you want you can omit locateFile completely when running in Node.
      locateFile: (file) => `https://sql.js.org/dist/${file}`
    })

    const databaseContent = localStorage.getItem(this.localStorageName())

    this.connection = new SQL.Database(databaseContent)
  }

  localStorageName = () => `VelociousDatabaseDriversSqliteWeb---${digg(this.getArgs(), "name")}`
  disconnect = () => this.saveDatabase()
  saveDatabase = () => localStorage.setItem(this.localStorageName(), this.connection.export())

  async close() {
    this.saveDatabase()
    await this.connection.end()
    this.connection = undefined
  }

  query = async (sql) => await query(this.connection, sql)

  quote(string) {
    if (!this.connection) throw new Error("Can't escape before connected")

    return this.connection.escape(string)
  }

  options() {
    if (!this._options) {
      this._options = new Options({driver: this})
    }

    return this._options
  }
}
