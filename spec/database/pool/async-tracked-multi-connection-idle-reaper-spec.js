// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import wait from "awaitery/build/wait.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../../src/testing/test.js"

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
      await wait(0.02)

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
      await wait(0.02)
      await pool.reapIdleConnections()

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
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-transaction")

    try {
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 1}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      /** @type {import("../../../src/database/drivers/base.js").default | undefined} */
      let transactionConnection

      // The holder leaves a transaction open; check-in must roll it back so the
      // connection never re-enters the pool dirty.
      await pool.withConnection(async (connection) => {
        transactionConnection = connection
        await connection.startTransaction()
      })

      if (!transactionConnection) throw new Error("Expected transaction connection")

      expect(pool.connectionHasOpenTransaction(transactionConnection)).toBe(false)

      // Being clean, it is reaped like any other idle connection once expired.
      await wait(0.02)
      await pool.reapIdleConnections()

      expect(pool.connections.includes(transactionConnection)).toBe(false)
    } finally {
      await cleanup()
    }
  })

  it("rolls back a left-open transaction and reaps the connection immediately when idle timeout is zero", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-transaction-zero")

    try {
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 0}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      let transactionConnection

      await pool.withConnection(async (connection) => {
        transactionConnection = connection
        await connection.startTransaction()
      })

      if (!transactionConnection) throw new Error("Expected transaction connection")

      // checkin rolled the transaction back and the zero idle timeout reaped the
      // now-clean connection immediately.
      expect(transactionConnection._transactionsCount).toBe(0)
      expect(pool.connections.includes(transactionConnection)).toBe(false)
    } finally {
      await cleanup()
    }
  })
})
