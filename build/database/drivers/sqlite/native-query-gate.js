// @ts-check

import Mutex from "epic-locks/build/mutex.js"

/**
 * @typedef {object} NativeSqliteConnection
 * @property {(sql: string) => Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} getAllAsync - Reads rows.
 * @property {(sql: string) => Promise<{changes: number}>} runAsync - Runs a mutation.
 * @property {(sql: string) => Promise<void>} execAsync - Executes a SQL script.
 * @property {() => Promise<void>} closeAsync - Closes the native connection.
 */

/** @type {Map<string, Mutex>} */
const mutexesByDatabaseName = new Map()

/**
 * Returns the process-wide native query gate for one SQLite database name.
 * expo-sqlite caches native databases by name, so a gate scoped to a driver
 * instance is not enough: two drivers on the same database can still release
 * each other's shared `NativeStatement` objects.
 * @param {string} databaseName - SQLite database name.
 * @returns {Mutex} Mutex serializing native calls for that database.
 */
export function nativeDatabaseMutex(databaseName) {
  let mutex = mutexesByDatabaseName.get(databaseName)

  if (!mutex) {
    mutex = new Mutex()
    mutexesByDatabaseName.set(databaseName, mutex)
  }

  return mutex
}

/**
 * Whether an expo-sqlite error means the native database/statement was released.
 * @param {unknown} error - Thrown error.
 * @returns {boolean} Whether the error is the native-handle lifetime failure.
 */
export function isNativeHandleError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const causeMessage = error instanceof Error && error.cause instanceof Error ? error.cause.message : ""
  const text = `${message} ${causeMessage}`

  return /NativeStatement\.runAsync|NativeDatabase\.prepareAsync/.test(text) && /NullPointerException|already released/.test(text)
}

/**
 * Runs one native operation under the per-database gate, reopening once when
 * expo-sqlite reports the shared native handle was released.
 * @template T
 * @param {object} args - Operation args.
 * @param {string} args.databaseName - SQLite database name.
 * @param {() => NativeSqliteConnection | undefined} args.getConnection - Current connection getter.
 * @param {() => Promise<NativeSqliteConnection>} args.reopenConnection - Opens a fresh native connection.
 * @param {(connection: NativeSqliteConnection) => Promise<T>} args.operation - Operation to run.
 * @returns {Promise<T>} Operation result.
 */
export async function runNativeOperation({databaseName, getConnection, reopenConnection, operation}) {
  return await nativeDatabaseMutex(databaseName).sync(async () => {
    const connection = getConnection()

    if (!connection) throw new Error("Not connected yet")

    try {
      return await operation(connection)
    } catch (error) {
      if (!isNativeHandleError(error)) throw error

      return await operation(await reopenConnection())
    }
  })
}
