import {digg} from "diggerize"
import envSense from "env-sense/build/use-env-sense.js"

// @ts-expect-error
import query from "./query"

// @ts-expect-error
import * as SQLite from "expo-sqlite"

import Mutex from "epic-locks/build/mutex.js"

import Base from "./base.js"

export default class VelociousDatabaseDriversSqliteNative extends Base {
  /**
   * Serializes native queries so concurrent `getAllAsync` calls never race
   * `expo-sqlite`'s shared `NativeStatement` objects (a single connection
   * prepares/executes/finalizes one statement at a time).
   * @type {Mutex}
   */
  _queryMutex = new Mutex()

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
        if (error instanceof Error && error.message.match(/Database '(.+)' not found/)) {
          // Ignore not found
        } else {
          throw error
        }
      }
    }

    this.connection = await SQLite.openDatabaseAsync(databaseName)
    await this.registerVersion()
  }

  connectArgs() {
    const args = this.getArgs()
    /**
     * Connect args.
     * @type {Record<string, ?>} */
    const connectArgs = {}
    const forward = ["database", "host", "password"]

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  async _close() {
    await this.connection.closeAsync()
    this.connection = undefined
  }

  /**
   * Runs query actual.
   * @param {string} sql - SQL string.
   * @returns {Promise<Record<string, ?>[]>} - Query result rows.
   */
  async _queryActual(sql) {
    return await this._queryMutex.sync(() => {
      if (!this.connection) throw new Error("Not connected yet")

      return query(this.connection, sql)
    })
  }

  /**
   * Executes a mutation with affected-row metadata.
   * @param {string} sql - Mutation SQL.
   * @returns {Promise<number>} - Affected row count.
   */
  async _affectedRowsActual(sql) {
    return await this._queryMutex.sync(async () => {
      if (!this.connection) throw new Error("Not connected yet")
      const result = await this.connection.runAsync(sql)
      return result.changes
    })
  }
}
