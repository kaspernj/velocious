// @ts-check

import {wait} from "awaitery"

import {runNativeOperation} from "../../../../src/database/drivers/sqlite/native-query-gate.js"

class FakeNativeConnection {
  /** @type {(() => Promise<void>) | undefined} */
  onRun = undefined
  /** @type {Error | undefined} */
  failWith = undefined

  /**
   * @param {object} [args] - Fake connection options.
   * @param {() => Promise<void>} [args.onRun] - Hook awaited for each statement.
   * @param {Error} [args.failWith] - Error thrown by the next statement.
   */
  constructor({onRun, failWith} = {}) {
    this.onRun = onRun
    this.failWith = failWith
  }

  /** @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Empty rows. */
  async getAllAsync() {
    await this.#run()

    return []
  }

  /** @returns {Promise<{changes: number}>} - One affected row. */
  async runAsync() {
    await this.#run()

    return {changes: 1}
  }

  /** @returns {Promise<void>} - Resolves after running. */
  async execAsync() {
    await this.#run()
  }

  /** @returns {Promise<void>} - Resolves after closing. */
  async closeAsync() {}

  /**
   * Runs the configured hook or throws the configured one-shot error.
   * @returns {Promise<void>} - Resolves after the statement.
   */
  async #run() {
    if (this.failWith) {
      const error = this.failWith

      this.failWith = undefined
      throw error
    }

    if (this.onRun) await this.onRun()
  }
}

/**
 * Builds the exact wrapped error expo-sqlite produces when its shared native
 * statement is released mid-call.
 * @returns {Error} Native-handle failure.
 */
function nativeHandleError() {
  return new Error("Call to function 'NativeDatabase.prepareAsync' has been rejected.", {
    cause: new Error("java.lang.NullPointerException: java.lang.NullPointerException")
  })
}

describe("database - sqlite native query gate", () => {
  it("serializes native operations per database name across connections", async () => {
    const databaseName = `sqlite-native-gate-serialization-${Date.now()}`
    let active = 0
    let maxActive = 0
    const onRun = async () => {
      active++
      maxActive = Math.max(maxActive, active)

      try {
        await wait(10)
      } finally {
        active--
      }
    }
    const firstConnection = new FakeNativeConnection({onRun})
    const secondConnection = new FakeNativeConnection({onRun})

    await Promise.all([
      runNativeOperation({
        databaseName,
        getConnection: () => firstConnection,
        reopenConnection: async () => firstConnection,
        operation: async (connection) => await connection.getAllAsync("SELECT 1")
      }),
      runNativeOperation({
        databaseName,
        getConnection: () => secondConnection,
        reopenConnection: async () => secondConnection,
        operation: async (connection) => await connection.runAsync("UPDATE tickets SET updated_at = updated_at")
      })
    ])

    expect(maxActive).toEqual(1)
  })

  it("reopens a fresh native connection and retries once when expo-sqlite releases the handle", async () => {
    const databaseName = `sqlite-native-gate-recovery-${Date.now()}`
    const failingConnection = new FakeNativeConnection({failWith: nativeHandleError()})
    const reopenedConnection = new FakeNativeConnection()
    let reopenCalls = 0

    const result = await runNativeOperation({
      databaseName,
      getConnection: () => failingConnection,
      reopenConnection: async () => {
        reopenCalls++

        return reopenedConnection
      },
      operation: async (connection) => await connection.runAsync("UPDATE tickets SET updated_at = updated_at")
    })

    expect(reopenCalls).toEqual(1)
    expect(result).toEqual({changes: 1})
  })

  it("does not reopen or retry unrelated SQLite errors", async () => {
    const databaseName = `sqlite-native-gate-unrelated-${Date.now()}`
    const failingConnection = new FakeNativeConnection({failWith: new Error("database is locked")})
    let reopenCalls = 0

    await expect(async () => await runNativeOperation({
      databaseName,
      getConnection: () => failingConnection,
      reopenConnection: async () => {
        reopenCalls++

        return failingConnection
      },
      operation: async (connection) => await connection.getAllAsync("SELECT 1")
    })).toThrowError("database is locked")

    expect(reopenCalls).toEqual(0)
  })
})
