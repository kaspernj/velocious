import {digg} from "diggerize"
import query from "./query"
import * as SQLite from "expo-sqlite"

import Base from "./base"

export default class VelociousDatabaseDriversSqliteNative extends Base {
  async connect() {
    const args = this.getArgs()
    const databaseName = digg(args, "name")

    if (args.reset) {
      try {
        await SQLite.deleteDatabaseAsync(databaseName)
      } catch (error) {
        if (error.message.match(/Database '(.+)' not found/)) {
          // Ignore not found
        } else {
          throw error
        }
      }
    }

    this.connection = await SQLite.openDatabaseAsync(databaseName)
    await this.registerVersion()
  }

  async disconnect() {
    await this.connection.closeAsync()
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
}
