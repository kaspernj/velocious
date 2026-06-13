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

class SpawnBlockingSqliteDriver extends SqliteDriver {
  /** @type {number} */
  static connectionAttempts = 0

  /** @type {() => void} */
  static releaseConnectionAttempts = () => {}

  /** @type {Promise<void>} */
  static connectionAttemptBarrier = Promise.resolve()

  /** Resets connection attempt tracking. */
  static resetConnectionAttempts() {
    SpawnBlockingSqliteDriver.connectionAttempts = 0
    SpawnBlockingSqliteDriver.connectionAttemptBarrier = new Promise((resolve) => {
      SpawnBlockingSqliteDriver.releaseConnectionAttempts = resolve
    })
  }

  /** @returns {Promise<void>} - Resolves when connected. */
  async connect() {
    SpawnBlockingSqliteDriver.connectionAttempts++
    await SpawnBlockingSqliteDriver.connectionAttemptBarrier
    await super.connect()
  }
}

class FailingConnectSqliteDriver extends SqliteDriver {
  /** @type {boolean} */
  static closed = false

  /** @returns {Promise<void>} - Rejects after opening the underlying connection. */
  async connect() {
    await super.connect()

    throw new Error("Connect failed after opening")
  }

  /** @returns {Promise<void>} - Resolves when the opened connection is closed. */
  async close() {
    FailingConnectSqliteDriver.closed = true
    await super.close()
  }
}

class FailingRollbackSqliteDriver extends SqliteDriver {
  /** @type {boolean} */
  static closed = false

  /** @returns {Promise<void>} - Rejects while rolling back a transaction. */
  async _rollbackTransactionAction() {
    throw new Error("Rollback failed during checkin")
  }

  /** @returns {Promise<void>} - Resolves when the opened connection is closed. */
  async close() {
    FailingRollbackSqliteDriver.closed = true
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

/**
 * @param {string} prefix - Temp-path prefix.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test configuration and cleanup.
 */
async function createSpawnBlockingConfiguration(prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SpawnBlockingSqliteDriver,
          migrations: false,
          name: `${prefix}-default`,
          pool: {max: 1},
          poolType: AsyncTrackedMultiConnection,
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
    locales: ["en"]
  })

  SpawnBlockingSqliteDriver.resetConnectionAttempts()

  return {
    cleanup: async () => {
      SpawnBlockingSqliteDriver.releaseConnectionAttempts()
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration
  }
}

/**
 * @param {string} prefix - Temp-path prefix.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test configuration and cleanup.
 */
async function createFailingConnectConfiguration(prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: FailingConnectSqliteDriver,
          migrations: false,
          name: `${prefix}-default`,
          poolType: AsyncTrackedMultiConnection,
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
    locales: ["en"]
  })

  return {
    cleanup: async () => {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration
  }
}

/**
 * @param {string} prefix - Temp-path prefix.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test configuration and cleanup.
 */
async function createFailingRollbackConfiguration(prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: FailingRollbackSqliteDriver,
          migrations: false,
          name: `${prefix}-default`,
          pool: {max: 1},
          poolType: AsyncTrackedMultiConnection,
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
    locales: ["en"]
  })

  FailingRollbackSqliteDriver.closed = false

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

  it("defaults to a bounded max connection cap", async () => {
    await withIsolatedPool(async (pool) => {
      delete pool.getConfiguration().pool

      expect(pool.maxConnections()).toEqual(10)
    })
  })

  it("uses configured max connection caps and allows explicit unbounded pools", async () => {
    await withIsolatedPool(async (pool) => {
      pool.getConfiguration().pool = {max: 3}

      expect(pool.maxConnections()).toEqual(3)

      pool.getConfiguration().pool = {max: null}

      expect(pool.maxConnections()).toEqual(undefined)
    })
  })

  it("hands a matching idle connection to pending checkouts before waiting for spawn capacity", async () => {
    await withIsolatedPool(async (pool) => {
      pool.getConfiguration().pool = {idleTimeoutMillis: 0, max: 1}

      const firstConnection = await pool.checkout()
      const reuseKey = pool.getConfigurationReuseKey()

      let pendingResolved = false
      const pendingConnectionPromise = new Promise((resolve, reject) => {
        pool.pendingCheckouts.push({
          databaseConfig: pool.getConfiguration(),
          enqueuedAt: Date.now(),
          options: {},
          reject,
          resolve,
          reuseKey
        })
      }).then((connection) => {
        pendingResolved = true

        return connection
      })

      await pool.checkin(firstConnection)

      expect(pendingResolved).toBe(true)

      const pendingConnection = await pendingConnectionPromise

      expect(pendingConnection).toBe(firstConnection)
      expect(pool.connections.includes(firstConnection)).toBe(false)

      await pool.checkin(firstConnection)
    })
  })

  it("does not let a blocked pending checkout prevent later matching idle reuse", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-pending-head-of-line")

    try {
      configuration.getDatabaseConfiguration().projectTenant.pool = {max: 2}
      const pool = configuration.getDatabasePool("projectTenant")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      const betaConnection = await configuration.runWithTenant({slug: "beta"}, async () => {
        return await pool.checkout()
      })
      const gammaConnection = await configuration.runWithTenant({slug: "gamma"}, async () => {
        return await pool.checkout()
      })

      await configuration.runWithTenant({slug: "gamma"}, async () => {
        await pool.checkin(gammaConnection)
      })

      let alphaResolved = false
      let gammaResolved = false
      const alphaConnectionPromise = configuration.runWithTenant({slug: "alpha"}, async () => {
        const connection = await pool.checkout()

        alphaResolved = true

        return connection
      })
      const pendingGammaConnectionPromise = configuration.runWithTenant({slug: "gamma"}, async () => {
        const connection = await pool.checkout()

        gammaResolved = true

        return connection
      })

      await wait(0.02)

      expect(alphaResolved).toBe(false)
      expect(gammaResolved).toBe(true)

      const pendingGammaConnection = await pendingGammaConnectionPromise

      expect(pendingGammaConnection).toBe(gammaConnection)

      await configuration.runWithTenant({slug: "beta"}, async () => {
        await pool.checkin(betaConnection)
      })

      const alphaConnection = await alphaConnectionPromise

      expect(alphaConnection.getArgs().name).toEqual("velocious-pool-pending-head-of-line-projectTenant-alpha")

      await configuration.runWithTenant({slug: "gamma"}, async () => {
        await pool.checkin(pendingGammaConnection)
      })
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await pool.checkin(alphaConnection)
      })
    } finally {
      await cleanup()
    }
  })

  it("counts in-progress direct checkout spawns against the max connection cap", async () => {
    const {cleanup, configuration} = await createSpawnBlockingConfiguration("velocious-pool-spawn-cap")

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

      const firstConnectionPromise = pool.checkout()
      let secondResolved = false
      const secondConnectionPromise = pool.checkout().then((connection) => {
        secondResolved = true

        return connection
      })

      await wait(0.02)
      expect(SpawnBlockingSqliteDriver.connectionAttempts).toEqual(1)
      expect(secondResolved).toBe(false)

      SpawnBlockingSqliteDriver.releaseConnectionAttempts()

      const firstConnection = await firstConnectionPromise

      await pool.checkin(firstConnection)

      const secondConnection = await secondConnectionPromise

      expect(secondConnection).toBe(firstConnection)

      await pool.checkin(secondConnection)
    } finally {
      await cleanup()
    }
  })

  it("closes a spawned connection when connect fails after opening", async () => {
    const {cleanup, configuration} = await createFailingConnectConfiguration("velocious-pool-connect-failure")

    try {
      FailingConnectSqliteDriver.closed = false
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

      const error = await pool.checkout().then(
        () => undefined,
        (caughtError) => caughtError
      )

      expect(error.message).toEqual("Connect failed after opening")
      expect(FailingConnectSqliteDriver.closed).toBe(true)
      expect(pool.liveConnectionCount()).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("clears same-database schema caches from direct checkout connections", async () => {
    const {cleanup, configuration} = await createSpawnBlockingConfiguration("velocious-pool-schema-cache")

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

      let clearedReuseKey
      const originalClearSchemaCachesForReuseKey = configuration.clearSchemaCachesForReuseKey.bind(configuration)

      configuration.clearSchemaCachesForReuseKey = (reuseKey) => {
        clearedReuseKey = reuseKey
        originalClearSchemaCachesForReuseKey(reuseKey)
      }

      SpawnBlockingSqliteDriver.releaseConnectionAttempts()

      const connection = await pool.checkout()

      connection.clearSchemaCache()

      expect(clearedReuseKey).toEqual(pool.getConfigurationReuseKey())

      await pool.checkin(connection)
    } finally {
      await cleanup()
    }
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

  it("closes a checked-out connection when rollback fails during checkin", async () => {
    const {cleanup, configuration} = await createFailingRollbackConfiguration("velocious-pool-checkin-rollback-failure")

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

      const connection = await pool.checkout()
      await connection.startTransaction()

      let checkoutRejected = false
      const pendingCheckout = pool.checkout().catch((error) => {
        checkoutRejected = true
        throw error
      })

      await wait(0.02)

      try {
        await pool.checkin(connection)
        throw new Error("Checkin unexpectedly resolved")
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(/** @type {Error} */ (error).message).toBe("Rollback failed during checkin")
      }

      await wait(0.02)

      expect(FailingRollbackSqliteDriver.closed).toBe(true)
      expect(Object.values(pool.connectionsInUse).includes(connection)).toBe(false)
      expect(pool.connections.includes(connection)).toBe(false)
      expect(pool.pendingCheckouts.length).toBe(0)
      expect(checkoutRejected).toBe(false)

      const pendingConnection = await pendingCheckout

      expect(pendingConnection).not.toBe(connection)

      await pool.checkin(pendingConnection)
    } finally {
      await cleanup()
    }
  })
})
