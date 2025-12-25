// @ts-check

import dummyConfiguration from "../../dummy/src/config/configuration.js"
import Dummy from "../../dummy/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"

function getPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  return pool instanceof AsyncTrackedMultiConnection ? pool : null
}

describe("AsyncTrackedMultiConnection context handling", {focus: true}, () => {
  it("does not return the global fallback when asking for the current context connection", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      // Prime the pool and fallback
      await pool.ensureGlobalConnection()

      // In a blank async context: current context connection should be undefined
      await pool.asyncLocalStorage.run(undefined, async () => {
        expect(pool.getCurrentContextConnection()).toBeUndefined()

        // Outside async context getCurrentConnection uses the fallback
        const outside = pool.getCurrentConnection()
        expect(outside).toBe(pool.getGlobalConnection())
      })

      // Inside async context should return the scoped connection, not the fallback
      await pool.withConnection(async () => {
        const contextConnection = pool.getCurrentContextConnection()
        const current = pool.getCurrentConnection()

        expect(contextConnection).toBeDefined()
        expect(current).toBe(contextConnection)
        expect(current).not.toBe(pool.getGlobalConnection())
      })
    })
  })
})
