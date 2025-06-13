import debounce from "debounce"
import {digg} from "diggerize"
import fs from "fs/promises"
import query from "./query.js"
import sqlite3 from "sqlite3"
import {open} from "sqlite"

import Base from "./base.js"

export default class VelociousDatabaseDriversSqliteNode extends Base {
  async connect() {
    const args = this.getArgs()
    const databasePath = `db/${this.localStorageName()}.sqlite`

    if (args.reset) {
      await fs.unlink(databasePath)
    }

    this.connection = await open({
      filename: databasePath,
      driver: sqlite3.Database
    })
    await this.registerVersion()
  }

  localStorageName = () => `VelociousDatabaseDriversSqlite---${digg(this.getArgs(), "name")}`
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
}
