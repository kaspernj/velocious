// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import wait from "awaitery/build/wait.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * @param {string} databaseName - Test database name.
 * @param {number} idleTimeoutMillis - Pool idle timeout.
 * @param {(pool: AsyncTrackedMultiConnection) => Promise<void>} callback - Spec body.
 * @returns {Promise<void>} - Resolves after cleanup.
 */
async function withIdleReaperPool(databaseName, idleTimeoutMillis, callback) {
  const {cleanup, configuration} = await createTenantTestConfiguration(databaseName)

  try {
    configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis}
    const pool = configuration.getDatabasePool("default")

    if (!(pool instanceof AsyncTrackedMultiConnection)) return

    await callback(pool)
  } finally {
    await cleanup()
  }
}

/**
 * @param {AsyncTrackedMultiConnection} pool - Pool to checkout from.
 * @returns {Promise<import("../../../src/database/drivers/base.js").default>} - Connection that was checked in with a rolled-back transaction.
 */
async function checkedInTransactionConnection(pool) {
  /** @type {import("../../../src/database/drivers/base.js").default | undefined} */
  let transactionConnection

  await pool.withConnection(async (connection) => {
    transactionConnection = connection
    await connection.startTransaction()
  })

  if (!transactionConnection) throw new Error("Expected transaction connection")

  return transactionConnection
}

describe("database - pool - async tracked multi connection idle reaper", () => {
  it("reuses matching idle connections before reaping expired connections", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-reuse-before-reap")

    try {
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 1}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      let firstConnection

      await pool.withConnection(async (connection) => {
        firstConnection = connection
      })

      pool.clearIdleConnectionReaperTimer()
      await wait(20)

      let secondConnection

      await pool.withConnection(async (connection) => {
        secondConnection = connection
      })

      expect(secondConnection).toBe(firstConnection)
    } finally {
      await cleanup()
    }
  })

  it("closes checked-in idle connections after the configured idle timeout", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-reaper")

    try {
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 1}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      /** @type {(import("../../../src/database/drivers/base.js").default & {connection?: unknown}) | undefined} */
      let checkedInConnection

      await pool.withConnection(async (connection) => {
        checkedInConnection = connection
        await connection.query("CREATE TABLE IF NOT EXISTS idle_reaper_values(value varchar(255))")
      })

      if (!checkedInConnection) throw new Error("Expected checked-in connection")

      expect(pool.connections.includes(checkedInConnection)).toBe(true)

      pool.clearIdleConnectionReaperTimer()
      await wait(20)
      await pool.reapIdleConnections()

      expect(checkedInConnection.connection).toEqual(undefined)
    } finally {
      await cleanup()
    }
  })

  it("reports checked-in idle timing in debug snapshots", async () => {
    await withIdleReaperPool("velocious-pool-idle-debug-timing", 60000, async (pool) => {
      /** @type {import("../../../src/database/drivers/base.js").default | undefined} */
      let checkedInConnection

      await pool.withConnection({name: "debug idle checkout"}, async (connection) => {
        checkedInConnection = connection
      })

      await wait(0.02)

      const snapshot = pool.getDebugSnapshot()
      const idleConnection = snapshot.connections.find((connection) => connection.state === "idle")

      if (!idleConnection) throw new Error("Expected an idle connection debug snapshot")

      expect(idleConnection.checkedInAt).toBeGreaterThan(0)
      expect(idleConnection.idleForMs).toBeGreaterThanOrEqual(0)
      expect(idleConnection.checkoutName).toBeUndefined()
      expect(pool.connections.includes(checkedInConnection)).toBe(true)
    })
  })

  it("closes a connection only once when reaped concurrently", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-double-close")

    try {
      // A large timeout keeps the scheduled reaper from firing on its own, so the
      // test drives the concurrent closes explicitly (mirroring a fire-and-forget
      // scheduled reap racing an explicit reap).
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 60000}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      /** @type {(import("../../../src/database/drivers/base.js").default & {connection?: unknown}) | undefined} */
      let checkedInConnection

      await pool.withConnection(async (connection) => {
        checkedInConnection = connection
      })

      if (!checkedInConnection) throw new Error("Expected checked-in connection")

      let closeCalls = 0
      const originalClose = checkedInConnection.close.bind(checkedInConnection)

      checkedInConnection.close = async () => {
        closeCalls++

        return await originalClose()
      }

      // Two concurrent closes of the same connection must close the driver handle
      // exactly once and leave it fully closed.
      await Promise.all([
        pool.closeConnection(checkedInConnection),
        pool.closeConnection(checkedInConnection)
      ])

      expect(closeCalls).toEqual(1)
      expect(checkedInConnection.connection).toEqual(undefined)
    } finally {
      await cleanup()
    }
  })

  it("closes checked-in idle connections immediately when idle timeout is zero", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-reaper-zero")

    try {
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 0}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      let checkedInConnection

      await pool.withConnection(async (connection) => {
        checkedInConnection = connection
      })

      expect(pool.connections.includes(checkedInConnection)).toBe(false)
    } finally {
      await cleanup()
    }
  })

  it("rolls back a left-open transaction on check-in and then reaps the now-clean connection", async () => {
    await withIdleReaperPool("velocious-pool-idle-transaction", 1, async (pool) => {
      // The holder leaves a transaction open; check-in must roll it back so the
      // connection never re-enters the pool dirty.
      const transactionConnection = await checkedInTransactionConnection(pool)

      expect(pool.connectionHasOpenTransaction(transactionConnection)).toBe(false)

      // Being clean, it is reaped like any other idle connection once expired.
      await wait(20)
      await pool.reapIdleConnections()

      expect(pool.connections.includes(transactionConnection)).toBe(false)
    })
  })

  it("rolls back a left-open transaction and reaps the connection immediately when idle timeout is zero", async () => {
    await withIdleReaperPool("velocious-pool-idle-transaction-zero", 0, async (pool) => {
      const transactionConnection = await checkedInTransactionConnection(pool)

      // checkin rolled the transaction back and the zero idle timeout reaped the
      // now-clean connection immediately.
      expect(transactionConnection._transactionsCount).toBe(0)
      expect(pool.connections.includes(transactionConnection)).toBe(false)
    })
  })
})
