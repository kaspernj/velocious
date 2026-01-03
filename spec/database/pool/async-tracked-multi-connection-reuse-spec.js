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

describe("database - pool - async tracked multi connection reuse", () => {
  it("checks connections back in and reuses them", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      const keysBefore = new Set(Object.keys(pool.connectionsInUse))
      let firstConnection

      await pool.withConnection(async (connection) => {
        firstConnection = connection

        const inUse = Object.values(pool.connectionsInUse)
        expect(inUse.includes(connection)).toBe(true)
      })

      const keysAfter = new Set(Object.keys(pool.connectionsInUse))
      expect([...keysAfter].sort()).toEqual([...keysBefore].sort())
      expect(pool.connections.includes(firstConnection)).toBe(true)

      pool.connections = [firstConnection]

      let secondConnection

      await pool.withConnection(async (connection) => {
        secondConnection = connection
      })

      expect(secondConnection).toBe(firstConnection)
    })
  })
})
