// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

function getPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) return null

  return pool
}

describe("database - pool - async tracked multi connection", () => {
  it("returns a global fallback connection when no async context has been set", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      const fallbackConnection = await pool.ensureGlobalConnection()
      const currentConnection = await pool.asyncLocalStorage.run(undefined, async () => pool.getCurrentConnection())

      expect(currentConnection).toBe(fallbackConnection)
    })
  })

  it("prefers the async-context connection and falls back to the global connection outside the context", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      const fallbackConnection = await pool.ensureGlobalConnection()
      const contextConnection = await pool.spawnConnection()

      pool.connections.unshift(contextConnection)

      await pool.withConnection(async () => {
        const currentConnection = pool.getCurrentConnection()

        expect(currentConnection).toBe(contextConnection)
      })

      const outsideConnection = await pool.asyncLocalStorage.run(undefined, async () => pool.getCurrentConnection())

      expect(outsideConnection).toBe(fallbackConnection)
    })
  })

  it("ensures a global connection is created when missing", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      const connection = await pool.ensureGlobalConnection()
      const outsideConnection = await pool.asyncLocalStorage.run(undefined, async () => pool.getCurrentConnection())

      expect(connection).toBe(pool.getGlobalConnection())
      expect(outsideConnection).toBe(connection)
    })
  })

  it("does not replace an existing global connection when ensuring", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      const existing = await pool.spawnConnection()

      pool.setGlobalConnection(existing)

      const connection = await pool.ensureGlobalConnection()
      const outsideConnection = await pool.asyncLocalStorage.run(undefined, async () => pool.getCurrentConnection())

      expect(connection).toBe(existing)
      expect(outsideConnection).toBe(existing)
    })
  })
})
