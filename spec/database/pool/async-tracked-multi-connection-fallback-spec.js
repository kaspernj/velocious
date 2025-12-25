// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

function getPoolOrSkip() {
  const pool = dummyConfiguration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) {
    // Skip if the dummy configuration doesn't use the async-tracked pool.
    return null
  }

  return pool
}

describe("database - pool - async tracked multi connection", () => {
  it("returns a global fallback connection when no async context has been set", async () => {
    const pool = getPoolOrSkip()
    if (!pool) return

    const fallbackConnection = await pool.ensureGlobalConnection()
    const currentConnection = pool.getCurrentConnection()

    expect(pool.connections.includes(fallbackConnection)).toBeFalse()
    expect(currentConnection).toBe(fallbackConnection)
  })

  it("prefers the async-context connection and falls back to the global connection outside the context", async () => {
    const pool = getPoolOrSkip()
    if (!pool) return

    const fallbackConnection = await pool.ensureGlobalConnection()
    const contextConnection = await pool.spawnConnection()

    pool.connections.unshift(contextConnection)

    await pool.withConnection(async () => {
      const currentConnection = pool.getCurrentConnection()

      expect(currentConnection).toBe(contextConnection)
    })

    const outsideConnection = pool.getCurrentConnection()

    expect(outsideConnection).toBe(fallbackConnection)
  })

  it("ensures a global connection is created when missing", async () => {
    const pool = getPoolOrSkip()
    if (!pool) return

    const connection = await pool.ensureGlobalConnection()

    expect(connection).toBe(pool.getGlobalConnection())
    expect(pool.connections.includes(connection)).toBeFalse()
  })

  it("does not replace an existing global connection when ensuring", async () => {
    const pool = getPoolOrSkip()
    if (!pool) return

    const existing = await pool.spawnConnection()

    pool.setGlobalConnection(existing)

    const connection = await pool.ensureGlobalConnection()

    expect(connection).toBe(existing)
    expect(pool.connections.includes(existing)).toBeFalse()
  })
})
