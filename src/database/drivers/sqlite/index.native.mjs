import Base from "./base"
import {digg} from "diggerize"
import escapeString from "sql-string-escape"
import Options from "../sqlite/options.mjs"
import query from "./query"
import * as SQLite from "expo-sqlite"

export default class VelociousDatabaseDriversSqliteNative extends Base {
  async connect() {
    const connection = await SQLite.openDatabaseAsync(digg(this.getArgs(), "name"))

    this.connection = connection
  }

  disconnect() {
    this.connection.end()
  }

  connectArgs() {
    const args = this.getArgs()
    const connectArgs = []
    const forward = ["database", "host", "password"]

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  async close() {
    await this.connection.end()
    this.connection = undefined
  }

  query = async (sql) => await query(this.connection, sql)

  quote(string) {
    const type = typeof string

    if (type == "number") return string
    if (type != "string") string = `${string}`

    return escapeString(string)
  }

  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }
}
