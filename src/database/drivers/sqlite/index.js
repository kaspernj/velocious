import fs from "fs/promises"
import query from "./query.js"
import sqlite3 from "sqlite3"
import {open} from "sqlite"

import Base from "./base.js"

export default class VelociousDatabaseDriversSqliteNode extends Base {
  async connect() {
    const args = this.getArgs()
    const databasePath = `${this.getConfiguration().getDirectory()}/db/${this.localStorageName()}.sqlite`

    if (args.reset) {
      await fs.unlink(databasePath)
    }

    this.connection = await open({
      filename: databasePath,
      driver: sqlite3.Database
    })
    await this.registerVersion()
  }

  localStorageName() {
    const args = this.getArgs()

    if (!args.name) throw new Error("No name given for SQLite Node")

    return `VelociousDatabaseDriversSqlite---${args.name}`
  }

  async close() {
    await this.connection.close()
    this.connection = undefined
  }

  query = async (sql) => {
    return await query(this.connection, sql)
  }
}
