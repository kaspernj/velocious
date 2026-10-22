import {digg} from "diggerize"
import envSense from "env-sense/build/use-env-sense.js"

// @ts-expect-error
import query from "./query"

// @ts-expect-error
import * as SQLite from "expo-sqlite"

import Base from "./base.js"
import {nativeDatabaseMutex, runNativeOperation} from "./native-query-gate.js"

export default class VelociousDatabaseDriversSqliteNative extends Base {
  async connect() {
    const {isBrowser, isNative, isServer} = envSense()

    if (!isNative) throw new Error(`SQLite native driver running inside non-native environment: ${JSON.stringify({isBrowser, isNative, isServer})}`)

    const args = this.getArgs()
    const databaseName = this._databaseName()

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

    // expo-sqlite caches native databases by name. A shared cache means closing
    // one driver's handle closes every other driver's handle for that database.
    this.connection = await SQLite.openDatabaseAsync(databaseName, {useNewConnection: true})
    await this.registerVersion()
  }

  connectArgs() {
    const args = this.getArgs()
    /**
     * Connect args.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const connectArgs = {}
    const forward = ["database", "host", "password"]

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  /**
   * Returns the configured SQLite database name.
   * @returns {string} - Database name.
   */
  _databaseName() {
    const databaseName = this.getArgs().name

    if (!databaseName) throw new Error("No name given for SQLite Native")

    return databaseName
  }

  async _close() {
    const databaseName = this._databaseName()

    await nativeDatabaseMutex(databaseName).sync(async () => {
      const connection = this.connection

      this.connection = undefined
      await connection?.closeAsync()
    })
  }

  async deleteDatabaseStorage() {
    const databaseName = this._databaseName()
    try {
      await SQLite.deleteDatabaseAsync(databaseName)
    } catch (error) {
      if (!(error instanceof Error && error.message.match(/Database '(.+)' not found/))) throw error
    }
  }

  /**
   * Runs query actual.
   * @param {string} sql - SQL string.
   * @param {import("../base.js").QueryOptions} [options] - Query options.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Query result rows.
   */
  async _queryActual(sql, options = {}) {
    const databaseName = this._databaseName()

    return await runNativeOperation({
      databaseName,
      getConnection: () => this.connection,
      reopenConnection: async () => {
        this.connection = await SQLite.openDatabaseAsync(databaseName, {useNewConnection: true})

        return this.connection
      },
      operation: async (connection) => {
        if (options.sqliteScript) {
          await connection.execAsync(sql)
          return []
        }

        return await query(connection, sql)
      }
    })
  }

  /**
   * Executes a mutation with affected-row metadata.
   * @param {string} sql - Mutation SQL.
   * @returns {Promise<number>} - Affected row count.
   */
  async _affectedRowsActual(sql) {
    const databaseName = this._databaseName()

    return await runNativeOperation({
      databaseName,
      getConnection: () => this.connection,
      reopenConnection: async () => {
        this.connection = await SQLite.openDatabaseAsync(databaseName, {useNewConnection: true})

        return this.connection
      },
      operation: async (connection) => {
        const result = await connection.runAsync(sql)

        return result.changes
      }
    })
  }
}
