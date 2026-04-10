// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/** @returns {AsyncTrackedMultiConnection | null} */
function getPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) return null

  return pool
}

describe("database - pool - checkin with open transaction", () => {
  it("preserves connections with an open transaction so they can be rolled back later", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      let connectionFromFirstCall

      // Simulate the databaseCleaning.transaction pattern: start a
      // transaction inside withConnection, check the connection back
      // in, then check it out again to roll back.
      await pool.withConnection(async (connection) => {
        connectionFromFirstCall = connection
        await connection.startTransaction()
        expect(connection._transactionsCount).toBe(1)
      })

      // The connection must be back in the idle pool despite
      // _transactionsCount being 1 — the transaction-cleaning pattern
      // needs to check the same connection out again to roll back.
      expect(pool.connections.includes(connectionFromFirstCall)).toBe(true)

      // Put only our connection in the pool so checkout returns it.
      pool.connections = [connectionFromFirstCall]

      await pool.withConnection(async (connection) => {
        expect(connection).toBe(connectionFromFirstCall)
        await connection.rollbackTransaction()
        expect(connection._transactionsCount).toBe(0)
      })
    })
  })
})
