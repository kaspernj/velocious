// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../src/configuration.js"
import Dummy from "../../dummy/index.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../../src/database/drivers/sqlite/index.js"
import wait from "awaitery/build/wait.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class CloseTrackingSqliteDriver extends SqliteDriver {
  /** @type {string[]} */
  static closedConnectionNames = []

  /** @returns {Promise<void>} - Resolves when the driver connection is closed. */
  async close() {
    const name = this.getArgs().name

    if (typeof name === "string") CloseTrackingSqliteDriver.closedConnectionNames.push(name)

    await super.close()
  }
}

/**
 * @param {string} prefix - Temp-path prefix.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test configuration and cleanup.
 */
async function createCloseTrackingConfiguration(prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: CloseTrackingSqliteDriver,
          migrations: false,
          name: `${prefix}-default`,
          poolType: AsyncTrackedMultiConnection,
          type: "sqlite"
        },
        projectTenant: {
          driver: CloseTrackingSqliteDriver,
          migrations: false,
          name: `${prefix}-project-tenant-default`,
          poolType: AsyncTrackedMultiConnection,
          tenantOnly: true,
          type: "sqlite"
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    tenantDatabaseResolver: ({identifier, tenant}) => {
      const tenantSlug = tenant && typeof tenant === "object" && "slug" in tenant ? tenant.slug : undefined

      if (typeof tenantSlug !== "string") return

      return {name: `${prefix}-${identifier}-${tenantSlug}`}
    }
  })

  CloseTrackingSqliteDriver.closedConnectionNames = []

  return {
    cleanup: async () => {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration
  }
}

function getPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) return null

  return pool
}

/**
 * Runs `callback` with an isolated AsyncTrackedMultiConnection pool backed by its
 * own throwaway sqlite configuration, tearing it down afterwards.
 *
 * Pool-internals specs that drive checkout/checkin and the max-connection cap
 * directly must NOT use the shared dummy `default` pool: the test harness holds
 * one ambient connection on it for the whole run (TestRunner.run wraps everything
 * in ensureConnections), so a spec that sets `max: 1` on the shared pool would
 * deadlock its own first checkout and leak a pending checkout into later specs.
 * An isolated pool also means these specs don't have to stop/start the dummy app.
 * @param {(pool: AsyncTrackedMultiConnection) => Promise<void>} callback - Receives the isolated pool.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function withIsolatedPool(callback) {
  const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-reuse")

  try {
    const pool = configuration.getDatabasePool("default")

    if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

    await callback(pool)
  } finally {
    await cleanup()
  }
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
    await withIsolatedPool(async (pool) => {
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
    })
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
    await withIsolatedPool(async (pool) => {
      pool.getConfiguration().pool = {max: 1}
      await pool.ensureGlobalConnection()

      expect(pool.liveConnectionCount()).toEqual(1)
      expect(pool.canSpawnConnection()).toBe(false)
    })
  })

  it("closes a global fallback connection even when the current tenant context no longer matches it", async () => {
    const {cleanup, configuration} = await createCloseTrackingConfiguration("velocious-pool-stale-global")

    try {
      /** @type {AsyncTrackedMultiConnection | undefined} */
      let pool

      await configuration.runWithTenant({slug: "beta"}, async () => {
        const tenantPool = configuration.getDatabasePool("projectTenant")

        if (!(tenantPool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

        pool = tenantPool
        await tenantPool.ensureGlobalConnection()
      })

      if (!pool) throw new Error("Expected tenant pool to be initialized")

      await pool.closeAll()

      expect(CloseTrackingSqliteDriver.closedConnectionNames).toEqual(["velocious-pool-stale-global-projectTenant-beta"])
      expect(pool.getGlobalConnectionForIdentifier()).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it("closes and clears the test shared connection", async () => {
    const {cleanup, configuration} = await createCloseTrackingConfiguration("velocious-pool-test-shared")

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

      const connection = await pool.spawnConnection()

      pool.setTestSharedConnection(connection)
      await pool.closeAll()

      expect(CloseTrackingSqliteDriver.closedConnectionNames).toEqual(["velocious-pool-test-shared-default"])
      expect(pool.getCurrentContextConnection()).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it("rejects pending checkouts when the pool is closed", async () => {
    await withIsolatedPool(async (pool) => {
      pool.getConfiguration().pool = {max: 1}

      const firstConnection = await pool.checkout()
      const secondConnectionPromise = pool.checkout()

      // Attach the rejection handler eagerly: closeAll() rejects the pending
      // checkout, and without a handler already in place that surfaces as an
      // unhandled rejection before the assertion below can observe it.
      const secondCheckoutRejection = secondConnectionPromise.then(
        () => { throw new Error("Expected the pending checkout to be rejected when the pool closed") },
        (error) => error
      )

      await wait(0.02)
      await pool.closeAll()

      const rejectionError = await secondCheckoutRejection

      expect(rejectionError.message).toEqual("Database pool was closed before checkout completed.")

      if (firstConnection.getIdSeq() !== undefined) {
        firstConnection.setIdSeq(undefined)
      }
    })
  })

  it("rolls back a transaction left open on a connection being checked in and hands the cleaned connection to a pending checkout", async () => {
    await withIsolatedPool(async (pool) => {
      pool.getConfiguration().pool = {idleTimeoutMillis: 0, max: 1}

      const transactionConnection = await pool.checkout()
      await transactionConnection.startTransaction()

      let pendingResolved = false
      const pendingCheckoutPromise = pool.checkout().then((connection) => {
        pendingResolved = true

        return connection
      })

      await wait(0.02)

      // Checking the connection back in must roll back the transaction the holder
      // left open, so it never re-enters the pool dirty and can be reused safely.
      await pool.checkin(transactionConnection)
      await wait(0.02)

      expect(pool.connectionHasOpenTransaction(transactionConnection)).toBe(false)
      expect(pendingResolved).toBe(true)

      const pendingConnection = await pendingCheckoutPromise

      expect(pendingConnection).toBe(transactionConnection)

      // The cleaned connection accepts a fresh transaction without throwing
      // "A transaction is already running".
      await pendingConnection.startTransaction()
      await pendingConnection.rollbackTransaction()

      await pool.checkin(pendingConnection)
    })
  })
})
