import Base from "./base.mjs"
import debounce from "debounce"
import {digg} from "diggerize"
import escapeString from "sql-string-escape"
import BetterLocalStorage from "better-localstorage"
import Options from "../sqlite/options.mjs"
import query from "./query"

import initSqlJs from "sql.js"

export default class VelociousDatabaseDriversSqliteWeb extends Base {
  async connect() {
    this.betterLocaleStorage ||= new BetterLocalStorage()

    const SQL = await initSqlJs({
      // Required to load the wasm binary asynchronously. Of course, you can host it wherever you want you can omit locateFile completely when running in Node.
      locateFile: (file) => `https://sql.js.org/dist/${file}`
    })

    const databaseContent = await this.betterLocaleStorage.get(this.localStorageName())

    this.connection = new SQL.Database(databaseContent)
  }

  localStorageName = () => `VelociousDatabaseDriversSqliteWeb---${digg(this.getArgs(), "name")}`
  disconnect = () => this.saveDatabase()
  saveDatabase = async () => {
    const localStorageContent = this.connection.export()
    await this.betterLocaleStorage.set(this.localStorageName(), localStorageContent)
  }

  saveDatabaseDebounce = debounce(this.saveDatabase, 500)

  async close() {
    await this.saveDatabase()
    await this.connection.end()
    this.connection = undefined
  }

  query = async (sql) => {
    const result = await query(this.connection, sql)
    const downcasedSQL = sql.toLowerCase().trim()

    // Auto-save database in local storage in case we can find manipulating instructions in the SQL
    if (downcasedSQL.startsWith("delete ") || downcasedSQL.startsWith("insert into ") || downcasedSQL.startsWith("update ")) {
      this.saveDatabaseDebounce()
    }

    return result
  }

  quote(string) {
    const type = typeof string

    if (type == "number") return string
    if (type != "string") string = `${string}`

    return escapeString(string)
  }

  options() {
    if (!this._options) {
      this._options = new Options({driver: this})
    }

    return this._options
  }
}
