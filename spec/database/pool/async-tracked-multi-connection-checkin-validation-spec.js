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

// Mutates `pool.connections` directly, so start from a freshly restarted Dummy
// to avoid leaking that replacement into unrelated tests sharing the pool.
describe("database - pool - checkin with open transaction", () => {
  it("rolls back a transaction left open on check-in so the reused connection is not poisoned", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      let connectionFromFirstCall

      // Reproduce the leak the test-suite databaseCleaning.transaction pattern
      // can hit: a transaction is started inside withConnection and the holder
      // returns without rolling it back, so checkin sees an open transaction.
      await pool.withConnection(async (connection) => {
        connectionFromFirstCall = connection
        await connection.startTransaction()
        expect(connection._transactionsCount).toBe(1)
      })

      // checkin must have rolled the transaction back so the connection
      // re-enters the idle pool clean.
      expect(pool.connections.includes(connectionFromFirstCall)).toBe(true)
      expect(pool.connectionHasOpenTransaction(connectionFromFirstCall)).toBe(false)
      expect(connectionFromFirstCall._transactionsCount).toBe(0)

      // Put only our connection in the pool so checkout returns it, then verify
      // a fresh holder can start a transaction without hitting
      // "A transaction is already running".
      pool.connections = [connectionFromFirstCall]

      await pool.withConnection(async (connection) => {
        expect(connection).toBe(connectionFromFirstCall)
        await connection.startTransaction()
        expect(connection._transactionsCount).toBe(1)
        await connection.rollbackTransaction()
        expect(connection._transactionsCount).toBe(0)
      })
    }, {fresh: true})
  })
})
