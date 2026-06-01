// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Dummy from "../../dummy/index.js"
import wait from "awaitery/build/wait.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

function getPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) return null

  return pool
}

// Mutates `pool.connections` and asserts on a snapshot of `connectionsInUse`,
// so run against a freshly restarted Dummy to isolate from other pool specs.
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
    }, {fresh: true})
  })

  it("waits when max connections are checked out and hands checked-in connections to waiters", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      pool.getConfiguration().pool = {idleTimeoutMillis: 0, max: 1}

      const firstConnection = await pool.checkout()
      let secondResolved = false
      const secondConnectionPromise = pool.checkout().then((connection) => {
        secondResolved = true

        return connection
      })

      await wait(0.02)

      expect(secondResolved).toBe(false)

      await pool.checkin(firstConnection)

      const secondConnection = await secondConnectionPromise

      expect(secondConnection).toBe(firstConnection)

      await pool.checkin(secondConnection)
      expect(pool.connections.includes(secondConnection)).toBe(false)
    }, {fresh: true})
  })

  it("spawns pending tenant checkouts with the queued checkout configuration", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-pending-tenant")

    try {
      configuration.getDatabaseConfiguration().projectTenant.pool = {max: 1}
      const pool = configuration.getDatabasePool("projectTenant")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      const betaConnection = await configuration.runWithTenant({slug: "beta"}, async () => {
        return await pool.checkout()
      })

      let alphaResolved = false
      const alphaConnectionPromise = configuration.runWithTenant({slug: "alpha"}, async () => {
        const connection = await pool.checkout()

        alphaResolved = true

        return connection
      })

      await wait(0.02)
      expect(alphaResolved).toBe(false)

      await configuration.runWithTenant({slug: "beta"}, async () => {
        await pool.checkin(betaConnection)
      })

      const alphaConnection = await alphaConnectionPromise

      expect(alphaConnection.getArgs().name).toEqual("velocious-pool-pending-tenant-projectTenant-alpha")

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await pool.checkin(alphaConnection)
      })
    } finally {
      await cleanup()
    }
  })

  it("counts global fallback connections against the max connection cap", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      pool.getConfiguration().pool = {max: 1}
      await pool.ensureGlobalConnection()

      expect(pool.liveConnectionCount()).toEqual(1)
      expect(pool.canSpawnConnection()).toBe(false)
    }, {fresh: true})
  })

  it("rejects pending checkouts when the pool is closed", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      pool.getConfiguration().pool = {max: 1}

      const firstConnection = await pool.checkout()
      const secondConnectionPromise = pool.checkout()

      await wait(0.02)
      await pool.closeAll()

      await expect(async () => secondConnectionPromise).toThrow("Database pool was closed before checkout completed.")

      if (firstConnection.getIdSeq() !== undefined) {
        firstConnection.setIdSeq(undefined)
      }
    }, {fresh: true})
  })

  it("does not hand open transaction connections to pending checkouts", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      pool.getConfiguration().pool = {idleTimeoutMillis: 0, max: 1}

      const transactionConnection = await pool.checkout()
      await transactionConnection.startTransaction()

      let pendingResolved = false
      const pendingCheckoutPromise = pool.checkout().then((connection) => {
        pendingResolved = true

        return connection
      })

      await wait(0.02)
      await pool.checkin(transactionConnection)
      await wait(0.02)

      expect(pendingResolved).toBe(false)

      const rollbackConnection = await pool.checkout()

      expect(rollbackConnection).toBe(transactionConnection)

      await rollbackConnection.rollbackTransaction()
      await pool.checkin(rollbackConnection)

      const pendingConnection = await pendingCheckoutPromise

      expect(pendingConnection).toBe(transactionConnection)

      await pool.checkin(pendingConnection)
    }, {fresh: true})
  })
})
