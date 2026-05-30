// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import wait from "awaitery/build/wait.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - pool - async tracked multi connection idle reaper", () => {
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

  it("keeps checked-in transaction connections so callers can check them out and roll back", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-idle-transaction")

    try {
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: 1}
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      /** @type {import("../../../src/database/drivers/base.js").default | undefined} */
      let transactionConnection

      await pool.withConnection(async (connection) => {
        transactionConnection = connection
        await connection.startTransaction()
      })

      await wait(0.02)
      await pool.reapIdleConnections()

      if (!transactionConnection) throw new Error("Expected transaction connection")

      expect(pool.connections.includes(transactionConnection)).toBe(true)

      await pool.withConnection(async (connection) => {
        expect(connection).toBe(transactionConnection)
        await connection.rollbackTransaction()
      })
    } finally {
      await cleanup()
    }
  })
})
