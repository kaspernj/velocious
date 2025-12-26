// @ts-check

import fs from "fs/promises"
import query from "./query.js"
import sqlite3 from "sqlite3"
import {open} from "sqlite"

import Base from "./base.js"

export default class VelociousDatabaseDriversSqliteNode extends Base {
  /** @type {import("sqlite3").Database | undefined} */
  connection = undefined

  async connect() {
    const args = this.getArgs()
    const databasePath = `${this.getConfiguration().getDirectory()}/db/${this.localStorageName()}.sqlite`

    if (args.reset) {
      await fs.unlink(databasePath)
    }

    // @ts-expect-error
    this.connection = /** @type {import("sqlite3").Database} */ (await open({
      filename: databasePath,
      driver: sqlite3.Database
    }))
    await this.registerVersion()
  }

  localStorageName() {
    const args = this.getArgs()

    if (!args.name) throw new Error("No name given for SQLite Node")

    return `VelociousDatabaseDriversSqlite---${args.name}`
  }

  async close() {
    await this.connection?.close()
    this.connection = undefined
  }

  /**
   * @param {string} sql
   * @returns {Promise<Record<string, any>[]>} - Result.
   */
  async _queryActual(sql) {
    if (!this.connection) throw new Error("No connection")

    return await query(this.connection, sql)
  }
}
