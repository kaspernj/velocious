// @ts-check

import AdvisoryLockRunner from "../../src/database/advisory-lock-runner.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import DatabaseDriver from "../../src/database/drivers/base.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

class InspectableSqliteDriver extends SqliteDriver {
  /** @type {InspectableSqliteDriver[]} */
  static instances = []

  /** @returns {Promise<void>} - Resolves after connecting. */
  async connect() {
    await super.connect()
    InspectableSqliteDriver.instances.push(this)
  }
}

class ReentrantAdvisoryLockDriver extends DatabaseDriver {
  releaseCount = 0

  /** @returns {Promise<boolean>} - Resolves true for this test driver. */
  async _tryAcquireAdvisoryLock() {
    return true
  }

  /** @returns {Promise<boolean>} - Resolves true after recording the release. */
  async _releaseAdvisoryLock() {
    this.releaseCount++

    return true
  }
}

/**
 * @param {(args: {configuration: Configuration, pool: AsyncTrackedMultiConnection}) => Promise<void>} callback - Spec body.
 * @param {string[]} lockNames - Lock names to clean if an assertion fails before the new cleanup runs.
 * @returns {Promise<void>} - Resolves after closing the isolated configuration.
 */
async function withAdvisoryLockPool(callback, lockNames) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-advisory-lock-cleanup-"))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: InspectableSqliteDriver,
          migrations: false,
          name: "advisory-lock-cleanup",
          poolType: AsyncTrackedMultiConnection,
          type: "sqlite"
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
  const pool = configuration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected async tracked pool")

  InspectableSqliteDriver.instances = []

  try {
    await callback({configuration, pool})
  } finally {
    for (const connection of InspectableSqliteDriver.instances) {
      for (const lockName of lockNames) {
        await connection.releaseAdvisoryLock(lockName)
      }
    }

    await configuration.closeDatabaseConnections()
    await fs.rm(directory, {force: true, recursive: true})
  }
}

describe("AdvisoryLockRunner connection cleanup", () => {
  it("releases every counted acquisition of a re-entrant lock", async () => {
    await withAdvisoryLockPool(async ({configuration}) => {
      const databaseConfiguration = configuration.getDatabaseConfiguration().default

      if (!databaseConfiguration) throw new Error("Expected a default database configuration")

      const connection = new ReentrantAdvisoryLockDriver(databaseConfiguration, configuration)

      expect(await connection.tryAcquireAdvisoryLock("reentrant-lock")).toBe(true)
      expect(await connection.tryAcquireAdvisoryLock("reentrant-lock")).toBe(true)

      await connection.releaseHeldAdvisoryLocks()

      expect(connection.releaseCount).toBe(2)
    }, [])
  })

  it("releases leftover locks when the caller connection returns to the pool", async () => {
    const runnerLockName = "runner-caller-lock"
    const leftoverLockName = "runner-caller-leftover-lock"

    await withAdvisoryLockPool(async ({configuration, pool}) => {
      await pool.withConnection(async (connection) => {
        const runner = new AdvisoryLockRunner({
          configuration,
          connectionProvider: () => connection,
          databaseIdentifier: "default"
        })

        await runner.withAdvisoryLockOrFail(runnerLockName, async () => {
          expect(await connection.tryAcquireAdvisoryLock(leftoverLockName)).toBe(true)
        })
      })

      const probeConnection = await pool.spawnConnection()

      try {
        expect(await probeConnection.tryAcquireAdvisoryLock(leftoverLockName)).toBe(true)
      } finally {
        await probeConnection.releaseAdvisoryLock(leftoverLockName)
        await probeConnection.close()
      }
    }, [runnerLockName, leftoverLockName])
  })

  it("releases a lock held on a dedicated runner connection when the configuration's connections are closed on shutdown", async () => {
    const runnerLockName = "runner-shutdown-lock"

    await withAdvisoryLockPool(async ({configuration, pool}) => {
      const runner = new AdvisoryLockRunner({
        configuration,
        connectionProvider: () => {
          throw new Error("The dedicated runner must not use the caller connection")
        },
        databaseIdentifier: "default"
      })

      await runner.withAdvisoryLockOrFail(runnerLockName, async () => {
        // The lock is held on the dedicated connection, which lives outside the pool's
        // tracked sets. A shutdown closes the configuration's connections while the pass
        // is still running (as when a runner is torn down mid-pass); that must reach the
        // dedicated connection and release the lock, not orphan it until wait_timeout.
        await configuration.closeDatabaseConnections()

        const probeConnection = await pool.spawnConnection()

        try {
          expect(await probeConnection.tryAcquireAdvisoryLock(runnerLockName)).toBe(true)
        } finally {
          await probeConnection.releaseAdvisoryLock(runnerLockName)
          await probeConnection.close()
        }
      }, {holdTimeoutMs: 1000})
    }, [runnerLockName])
  })

  it("releases leftover locks when the dedicated runner connection closes", async () => {
    const runnerLockName = "runner-dedicated-lock"
    const leftoverLockName = "runner-dedicated-leftover-lock"

    await withAdvisoryLockPool(async ({configuration, pool}) => {
      const runner = new AdvisoryLockRunner({
        configuration,
        connectionProvider: () => {
          throw new Error("The dedicated runner must not use the caller connection")
        },
        databaseIdentifier: "default"
      })

      await runner.withAdvisoryLockOrFail(runnerLockName, async () => {
        const dedicatedConnection = InspectableSqliteDriver.instances[0]

        if (!dedicatedConnection) throw new Error("Expected a dedicated advisory-lock connection")

        expect(await dedicatedConnection.tryAcquireAdvisoryLock(leftoverLockName)).toBe(true)
      }, {holdTimeoutMs: 1000})

      const probeConnection = await pool.spawnConnection()

      try {
        expect(await probeConnection.tryAcquireAdvisoryLock(leftoverLockName)).toBe(true)
      } finally {
        await probeConnection.releaseAdvisoryLock(leftoverLockName)
        await probeConnection.close()
      }
    }, [runnerLockName, leftoverLockName])
  })
})
