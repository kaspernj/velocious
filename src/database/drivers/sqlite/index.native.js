import {digg} from "diggerize"
import envSense from "env-sense/src/use-env-sense.js"
import query from "./query"
import * as SQLite from "expo-sqlite"

import Base from "./base"

export default class VelociousDatabaseDriversSqliteNative extends Base {
  async connect() {
    const {isBrowser, isNative, isServer} = envSense()

    if (!isNative) throw new Error(`SQLite native driver running inside non-native environment: ${JSON.stringify({isBrowser, isNative, isServer})}`)

    const args = this.getArgs()

    if (!args.name) throw new Error("No name given for SQLite Native")

    const databaseName = args.name

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

  async query(sql) {
    console.error("Native SQL: ", sql)

    if (!this.connection) throw new Error("Not connected yet")

    return await query(this.connection, sql)
  }
}
