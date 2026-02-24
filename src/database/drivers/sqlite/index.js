// @ts-check

import fs from "fs/promises"
import query from "./query.js"
import sqlite3 from "sqlite3"
import {open} from "sqlite"

import Base from "./base.js"
import fileExists from "../../../utils/file-exists.js"

export default class VelociousDatabaseDriversSqliteNode extends Base {
  /** @type {import("sqlite3").Database | undefined} */
  connection = undefined

  async connect() {
    const args = this.getArgs()
    const databaseDir = `${this.getConfiguration().getDirectory()}/db`
    const databasePath = `${databaseDir}/${this.localStorageName()}.sqlite`

    if (!await fileExists(databaseDir)) {
      await fs.mkdir(databaseDir, {recursive: true})
    }

    if (args.reset) {
      await fs.unlink(databasePath)
    }

    try {
      // @ts-expect-error
      this.connection = /** @type {import("sqlite3").Database} */ (await open({
        filename: databasePath,
        driver: sqlite3.Database
      }))
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Couldn't open database ${databasePath} because of ${error.constructor.name}: ${error.message}`, {cause: error})
      } else {
        throw new Error(`Couldn't open database ${databasePath} because of ${typeof error}: ${error}`, {cause: error})
      }
    }

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
   * @param {string} sql - SQL string.
   * @returns {Promise<Record<string, any>[]>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    if (!this.connection) throw new Error("No connection")

    return await query(this.connection, sql)
  }
}
