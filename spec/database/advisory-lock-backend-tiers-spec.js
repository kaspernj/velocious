// @ts-check

import AdvisoryLockFileBackend from "../../src/database/advisory-lock-file-backend.js"
import AdvisoryLockRunner from "../../src/database/advisory-lock-runner.js"
import Configuration from "../../src/configuration.js"
import DatabaseDriver from "../../src/database/drivers/base.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Driver that always grants advisory locks (records nothing else).
 * @extends DatabaseDriver
 */
class GrantingDriver extends DatabaseDriver {
  /**
   * Records the acquisition and succeeds.
   * @param {string} _name - Lock name.
   * @param {{timeoutMs?: number | null}} [_args] - Acquisition options.
   * @returns {Promise<boolean>} - Always acquired.
   */
  async _acquireAdvisoryLock(_name, _args = {}) { return true }

  /**
   * Runs try acquire advisory lock.
   * @param {string} _name - Lock name.
   * @returns {Promise<boolean>} - Always acquired.
   */
  async _tryAcquireAdvisoryLock(_name) { return true }

  /**
   * Runs release advisory lock.
   * @param {string} _name - Lock name.
   * @returns {Promise<boolean>} - Always released.
   */
  async _releaseAdvisoryLock(_name) { return true }

  /**
   * Runs get type.
   * @returns {string} - Driver type.
   */
  getType() { return "mysql" }
}

/**
 * SQLite-type driver (no native advisory lock) used to prove the fail-closed
 * driver-path rule for names with an explicit minimum tier.
 * @extends DatabaseDriver
 */
class SqliteEmulationDriver extends GrantingDriver {
  /**
   * Runs get type.
   * @returns {string} - Driver type.
   */
  getType() { return "sqlite" }
}

/**
 * Isolated configuration for one runner example.
 * @param {object} args - Options.
 * @param {object} args.advisoryLocks - `advisoryLocks` configuration block under test.
 * @param {typeof DatabaseDriver} DriverClass - Driver used for the default database.
 * @returns {Promise<{configuration: Configuration, connection: DatabaseDriver, directory: string, cleanup: () => Promise<void>}>} - Test fixture.
 */
async function withRunnerConfiguration({advisoryLocks, DriverClass}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-advisory-lock-backend-"))
  const configuration = new Configuration({
    advisoryLocks,
    database: {
      test: {
        default: {
          driver: DriverClass,
          migrations: false,
          name: "advisory-lock-backend",
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
  const databaseConfiguration = configuration.getDatabaseConfiguration().default

  if (!databaseConfiguration) throw new Error("Expected a default database configuration")

  const connection = new DriverClass(databaseConfiguration, configuration)

  return {
    cleanup: async () => {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration,
    connection,
    directory
  }
}

describe("Advisory lock backend tiers", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("refuses the file tier for a cross-host-minimum lock name with a clear error", async () => {
    const {cleanup, configuration, connection, directory} = await withRunnerConfiguration({
      advisoryLocks: {
        backends: {file: {enabled: true}},
        policy: [{minTier: "driver-native", name: "cross-host-thing", preferredTier: "file"}]
      },
      DriverClass: GrantingDriver
    })
    const frameworkErrors = []

    configuration.getErrorEvents().on("framework-error", (/** @type {{context?: string}} */ payload) => frameworkErrors.push(payload))

    const runner = new AdvisoryLockRunner({
      configuration,
      connectionProvider: () => connection,
      databaseIdentifier: "default"
    })

    let refusalError

    try {
      await runner.withAdvisoryLock("cross-host-thing", async () => "should-not-run")
    } catch (error) {
      refusalError = error
    }

    try {
      expect(refusalError.name).toEqual("AdvisoryLockMinTierRefusedError")
      expect(refusalError.lockName).toEqual("cross-host-thing")
      expect(refusalError.requestedBackend).toEqual("file")
      expect(refusalError.minTier).toEqual("driver-native")
      expect(refusalError.message).toContain("minimum tier")

      // The refusal is loud: reported on the framework-error channel before
      // any contact with the weaker backend.
      expect(frameworkErrors.some((event) => event.context === "advisory-lock-min-tier-refused")).toBeTrue()

      // And the file tier was refused before any contact with it: no lock
      // directory was ever created under the file-backend directory.
      expect(await fs.stat(path.join(directory, "tmp", "advisory-locks")).then(() => true).catch(() => false)).toBeFalse()
    } finally {
      await cleanup()
    }
  })

  it("never enables the file tier by default: an undeclared name stays on the driver", async () => {
    const {cleanup, configuration, connection, directory} = await withRunnerConfiguration({
      advisoryLocks: {},
      DriverClass: GrantingDriver
    })
    const runner = new AdvisoryLockRunner({
      configuration,
      connectionProvider: () => connection,
      databaseIdentifier: "default"
    })

    const provenance = await runner.withAdvisoryLock("undeclared-name", async ({lockBackend}) => lockBackend)

    try {
      expect(provenance.backend).toEqual("driver-native")
      expect(provenance.fencingSupported).toBeTrue()
      expect(await configuration.getAdvisoryLockFileBackend()).toEqual(undefined)
      expect(await fs.stat(path.join(directory, "tmp", "advisory-locks")).then(() => true).catch(() => false)).toBeFalse()
    } finally {
      await cleanup()
    }
  })

  it("serves an explicitly opted-in name on the file tier and reports the tier", async () => {
    const {cleanup, configuration, directory} = await withRunnerConfiguration({
      advisoryLocks: {
        backends: {file: {enabled: true}},
        policy: [{allowedTiers: ["file"], minTier: "file", name: "single-host-thing", preferredTier: "file"}]
      },
      DriverClass: GrantingDriver
    })
    const runner = new AdvisoryLockRunner({
      configuration,
      connectionProvider: () => {
        throw new Error("The file tier must not consume a database connection")
      },
      databaseIdentifier: "default"
    })

    const provenance = await runner.withAdvisoryLock("single-host-thing", async ({lockBackend}) => lockBackend)

    try {
      expect(provenance.backend).toEqual("file")
      // The file tier cannot carry fencing tokens; it reports that limitation
      // on every acquisition instead of pretending.
      expect(provenance.fencingSupported).toBeFalse()
      expect(provenance.holderId).toEqual((await configuration.getAdvisoryLockFileBackend()).holderId)

      // Acquisition reports which backend served it on the status surface.
      const status = configuration.getAdvisoryLockBackendStatus("single-host-thing")

      expect(status.acquisition.backend).toEqual("file")
      expect(status.acquisition.fencingSupported).toBeFalse()
      expect(status.policy.minTier).toEqual("file")

      // The lock directory lived under the configured file-backend directory.
      expect(await fs.stat(path.join(directory, "tmp", "advisory-locks"))).toBeTruthy()
    } finally {
      await cleanup()
    }
  })

  it("fails closed on the driver path when the driver cannot satisfy an explicit minimum tier", async () => {
    const {cleanup, configuration, connection} = await withRunnerConfiguration({
      advisoryLocks: {policy: [{minTier: "driver-native", name: "db-invariant:*"}]},
      DriverClass: SqliteEmulationDriver
    })
    const runner = new AdvisoryLockRunner({
      configuration,
      connectionProvider: () => connection,
      databaseIdentifier: "default"
    })

    let unavailableError

    try {
      await runner.withAdvisoryLock("db-invariant:apply", async () => "should-not-run")
    } catch (error) {
      unavailableError = error
    }

    try {
      expect(unavailableError.name).toEqual("AdvisoryLockBackendUnavailableError")
      expect(unavailableError.lockName).toEqual("db-invariant:apply")
      expect(unavailableError.minTier).toEqual("driver-native")
    } finally {
      await cleanup()
    }
  })

  it("keeps today's behavior for undeclared names on a SQLite driver", async () => {
    const {cleanup, configuration, connection} = await withRunnerConfiguration({
      advisoryLocks: {},
      DriverClass: SqliteEmulationDriver
    })
    const runner = new AdvisoryLockRunner({
      configuration,
      connectionProvider: () => connection,
      databaseIdentifier: "default"
    })

    const provenance = await runner.withAdvisoryLock("legacy-sqlite-name", async ({lockBackend}) => lockBackend)

    try {
      expect(provenance.backend).toEqual("process-local")
      expect(provenance.driverType).toEqual("sqlite")
    } finally {
      await cleanup()
    }
  })

  it("throws AdvisoryLockTimeoutError when a file-tier wait exceeds timeoutMs", async () => {
    const {cleanup, configuration, connection} = await withRunnerConfiguration({
      advisoryLocks: {
        backends: {file: {enabled: true}},
        policy: [{minTier: "file", name: "contended-file", preferredTier: "file"}]
      },
      DriverClass: GrantingDriver
    })
    const runner = new AdvisoryLockRunner({
      configuration,
      connectionProvider: () => connection,
      databaseIdentifier: "default"
    })
    const backend = await configuration.getAdvisoryLockFileBackend()

    // Hold the lock from a second backend instance so the runner's wait is
    // genuinely contended.
    const contender = new AdvisoryLockFileBackend({directory: backend.directory})

    try {
      expect(await contender.acquire("contended-file", {timeoutMs: 1000})).toBe(true)

      let timeoutError

      try {
        await runner.withAdvisoryLock("contended-file", async () => "should-not-run", {timeoutMs: 200})
      } catch (error) {
        timeoutError = error
      }

      expect(timeoutError.name).toEqual("AdvisoryLockTimeoutError")
      expect(timeoutError.lockName).toEqual("contended-file")

      let busyError

      try {
        await runner.withAdvisoryLockOrFail("contended-file", async () => "should-not-run")
      } catch (error) {
        busyError = error
      }

      expect(busyError.name).toEqual("AdvisoryLockBusyError")
      expect(busyError.lockName).toEqual("contended-file")
    } finally {
      await contender.release("contended-file")
      await cleanup()
    }
  })
})
