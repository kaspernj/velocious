// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import TestProfiler from "../../../src/testing/test-profiler.js"

class ProfilePoolDriver extends DatabaseDriverBase {
  connected = false
  closed = false

  async connect() { this.connected = true }
  async close() { this.closed = true }
  /** @returns {string} - Driver type. */
  getType() { return "profile-pool" }
  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }
}

class FailingProfilePoolDriver extends ProfilePoolDriver {
  async connect() { throw new Error("secret connection failure") }
}

class ContextCapturingProfilePoolDriver extends ProfilePoolDriver {
  /** @type {import("../../../src/testing/test-profiler.js").TestProfileAsyncContext | undefined} */
  activationProfileContext = undefined

  async setConnectionCheckoutName(name) {
    this.activationProfileContext = this.configuration.getEnvironmentHandler().getCurrentTestProfileContext()
    await super.setConnectionCheckoutName(name)
  }
}

class FailingCloseProfilePoolDriver extends ProfilePoolDriver {
  async close() { throw new Error("secret close failure") }
}

class DeterministicProfilePool extends AsyncTrackedMultiConnection {
  /** @type {number[]} */
  clockValues = []

  /** @param {number[]} values - Clock reads. */
  setClockValues(values) { this.clockValues = [...values] }

  /** @returns {number} - Deterministic time. */
  nowMs() {
    const value = this.clockValues.shift()

    if (value === undefined) throw new Error("Expected a deterministic pool clock value")

    return value
  }

  /**
   * @returns {{expiredConnections: import("../../../src/database/drivers/base.js").default[], keptConnections: import("../../../src/database/drivers/base.js").default[]}} - Deterministic expiry.
   */
  classifyIdleConnectionsForReaping() {
    return {expiredConnections: [...this.connections], keptConnections: []}
  }
}

function buildConfiguration() {
  return new Configuration({
    database: {
      test: {
        default: {
          driver: ProfilePoolDriver,
          pool: {idleTimeoutMillis: 1},
          type: "profile-pool"
        }
      }
    },
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("test profiler pool metrics", () => {
  it("records lifecycle telemetry and attributes aggregate deltas to the active span", async () => {
    const configuration = buildConfiguration()
    const pool = new DeterministicProfilePool({configuration, identifier: "default"})
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const filePath = `${process.cwd()}/spec/database/profile-pool-example-spec.js`
    const attempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["pool profile"],
      testData: {args: {}, filePath, line: 18, ownerFilePath: filePath, function: async () => {}},
      testDescription: "uses a pool"
    })
    /** @type {ProfilePoolDriver | undefined} */
    let createdConnection

    await profiler.runAttempt(attempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        pool.setClockValues([10, 14])
        createdConnection = /** @type {ProfilePoolDriver} */ (await pool.spawnConnectionWithConfiguration({driver: ProfilePoolDriver}))

        pool.setClockValues([20, 27])
        await expect(() => pool.spawnConnectionWithConfiguration({driver: FailingProfilePoolDriver})).toThrow(/secret connection failure/)

        let checkoutError
        const pendingCheckout = {
          databaseConfig: configuration.getDatabaseConfiguration().default,
          enqueuedAt: 30,
          options: {name: "tenant-sensitive-checkout"},
          reject: (error) => { checkoutError = error },
          resolve: () => {},
          reuseKey: "secret-reuse-key",
          timeoutAt: 35,
          timeoutMillis: 5,
          timeoutTimer: undefined,
          testProfileContext: configuration.getEnvironmentHandler().getCurrentTestProfileContext()
        }

        pool.pendingCheckouts.push(pendingCheckout)
        pool.setClockValues([35])
        pool.timeoutPendingCheckout(pendingCheckout)
        expect(checkoutError).toBeInstanceOf(Error)

        pool.connections = [createdConnection]
        pool.setClockValues([40, 40, 46])
        await pool.reapIdleConnections()
      })
    })
    profiler.finishAttempt(attempt, "passed")

    const telemetry = pool.getDebugSnapshot().telemetry
    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const poolProfile = profile.pools[0]

    expect(telemetry.connectionCreationCount).toBe(2)
    expect(telemetry.connectionCreationFailureCount).toBe(1)
    expect(telemetry.connectionCreationTotalMs).toBe(11)
    expect(telemetry.connectionCreationMaxMs).toBe(7)
    expect(telemetry.checkoutTimeoutCount).toBe(1)
    expect(telemetry.idleReapCount).toBe(1)
    expect(telemetry.idleReapFailureCount).toBe(0)
    expect(telemetry.idleReapTotalMs).toBe(6)
    expect(telemetry.idleReapMaxMs).toBe(6)
    expect(telemetry.idleReapDisposalCount).toBe(1)
    expect(telemetry.peakLiveConnections).toBe(1)
    expect(poolProfile.identifier).toBe("default")
    expect(poolProfile.connectionCreation.count).toBe(2)
    expect(poolProfile.checkoutWait.count).toBe(1)
    expect(poolProfile.checkoutTimeoutCount).toBe(1)
    expect(poolProfile.idleReap.count).toBe(1)
    expect(poolProfile.idleReap.disposalCount).toBe(1)
    expect(profile.tests[0].attempts[0].spans[0].pools[0].identifier).toBe("default")
    expect(JSON.stringify(profile).includes("tenant-sensitive-checkout")).toBe(false)
    expect(JSON.stringify(profile).includes("secret-reuse-key")).toBe(false)
  })

  it("does not schedule or measure idle reaping when idleTimeoutMillis is null", async () => {
    const configuration = buildConfiguration()
    configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis: null}
    const pool = new DeterministicProfilePool({configuration, identifier: "default"})
    const connection = new ProfilePoolDriver({}, configuration)

    pool.connections = [connection]

    expect(pool.idleTimeoutMillis()).toBe(null)
    expect(pool.hasIdleConnectionsToReap()).toBe(false)
    pool.scheduleIdleConnectionReaper()
    await pool.reapIdleConnections()

    expect(pool.idleConnectionReaperTimer).toBe(undefined)
    expect(pool.connections).toEqual([connection])
    expect(connection.closed).toBe(false)
    expect(pool.getDebugSnapshot().telemetry.idleReapCount).toBe(0)
  })

  it("records failed idle reap attempts with the deterministic pool clock", async () => {
    const configuration = buildConfiguration()
    const pool = new DeterministicProfilePool({configuration, identifier: "default"})
    const connection = new FailingCloseProfilePoolDriver({}, configuration)

    pool.connections = [connection]
    pool.setClockValues([50, 50, 58])

    await expect(() => pool.reapIdleConnections()).toThrow(/secret close failure/)

    expect(pool.getDebugSnapshot().telemetry.idleReapCount).toBe(1)
    expect(pool.getDebugSnapshot().telemetry.idleReapFailureCount).toBe(1)
    expect(pool.getDebugSnapshot().telemetry.idleReapDisposalCount).toBe(0)
    expect(pool.getDebugSnapshot().telemetry.idleReapTotalMs).toBe(8)
    expect(pool.getDebugSnapshot().telemetry.idleReapMaxMs).toBe(8)
  })

  it("keeps queued checkout metrics on the context captured at enqueue", async () => {
    const configuration = buildConfiguration()
    const pool = new DeterministicProfilePool({configuration, identifier: "default"})
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const firstFilePath = `${process.cwd()}/spec/database/profile-pool-first-spec.js`
    const secondFilePath = `${process.cwd()}/spec/database/profile-pool-second-spec.js`
    const firstAttempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["pool profile"],
      testData: {args: {}, filePath: firstFilePath, line: 20, ownerFilePath: firstFilePath, function: async () => {}},
      testDescription: "queues the checkout"
    })
    const secondAttempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["pool profile"],
      testData: {args: {}, filePath: secondFilePath, line: 30, ownerFilePath: secondFilePath, function: async () => {}},
      testDescription: "drains the checkout"
    })
    /** @type {import("../../../src/testing/test-profiler.js").TestProfileAsyncContext | undefined} */
    let capturedContext
    let markFirstSpanStarted
    let releaseFirstSpan
    const firstSpanStarted = new Promise((resolve) => { markFirstSpanStarted = resolve })
    const firstSpanGate = new Promise((resolve) => { releaseFirstSpan = resolve })
    const runningFirstSpan = profiler.runAttempt(firstAttempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        capturedContext = configuration.getEnvironmentHandler().getCurrentTestProfileContext()
        markFirstSpanStarted()
        await firstSpanGate
      })
    })

    await firstSpanStarted

    if (!capturedContext) throw new Error("Expected the checkout profile context")

    /** @type {ContextCapturingProfilePoolDriver | undefined} */
    let resolvedConnection
    let failedCreationError
    let noContextTimeoutError
    let profiledTimeoutError

    await profiler.runAttempt(secondAttempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        const noContextCheckout = {
          databaseConfig: configuration.getDatabaseConfiguration().default,
          enqueuedAt: 5,
          options: {},
          reject: (error) => { noContextTimeoutError = error },
          resolve: () => {},
          reuseKey: "no-profile-context",
          timeoutAt: 10,
          timeoutMillis: 5,
          timeoutTimer: undefined,
          testProfileContext: undefined
        }

        pool.pendingCheckouts.push(noContextCheckout)
        pool.setClockValues([10])
        pool.timeoutPendingCheckout(noContextCheckout)

        const profiledTimeoutCheckout = {
          databaseConfig: configuration.getDatabaseConfiguration().default,
          enqueuedAt: 15,
          options: {},
          reject: (error) => { profiledTimeoutError = error },
          resolve: () => {},
          reuseKey: "profiled-timeout",
          timeoutAt: 20,
          timeoutMillis: 5,
          timeoutTimer: undefined,
          testProfileContext: capturedContext
        }

        pool.pendingCheckouts.push(profiledTimeoutCheckout)
        pool.setClockValues([20])
        pool.timeoutPendingCheckout(profiledTimeoutCheckout)

        const successfulCheckout = {
          databaseConfig: {driver: ContextCapturingProfilePoolDriver},
          enqueuedAt: 25,
          options: {},
          reject: () => {},
          resolve: (connection) => { resolvedConnection = /** @type {ContextCapturingProfilePoolDriver} */ (connection) },
          reuseKey: "profiled-success",
          timeoutAt: null,
          timeoutMillis: null,
          timeoutTimer: undefined,
          testProfileContext: capturedContext
        }

        pool.pendingCheckouts.push(successfulCheckout)
        pool.setClockValues([30])
        pool.removePendingCheckoutAt(0)
        pool.setClockValues([40, 46])
        await pool.spawnAndResolvePendingCheckout(successfulCheckout)

        const failedCheckout = {
          databaseConfig: {driver: FailingProfilePoolDriver},
          enqueuedAt: 45,
          options: {},
          reject: (error) => { failedCreationError = error },
          resolve: () => {},
          reuseKey: "profiled-failure",
          timeoutAt: null,
          timeoutMillis: null,
          timeoutTimer: undefined,
          testProfileContext: capturedContext
        }

        pool.pendingCheckouts.push(failedCheckout)
        pool.setClockValues([50])
        pool.removePendingCheckoutAt(0)
        pool.setClockValues([60, 68])
        await pool.spawnAndResolvePendingCheckout(failedCheckout)
      })
    })
    profiler.finishAttempt(secondAttempt, "passed")
    releaseFirstSpan()
    await runningFirstSpan
    profiler.finishAttempt(firstAttempt, "passed")

    const profile = profiler.finish({
      counts: {discovered: 2, executed: 2, failed: 0, passed: 2},
      focused: false,
      status: "passed"
    })
    const firstSpan = profile.tests[0].attempts[0].spans[0]
    const secondSpan = profile.tests[1].attempts[0].spans[0]

    expect(noContextTimeoutError).toBeInstanceOf(Error)
    expect(profiledTimeoutError).toBeInstanceOf(Error)
    expect(failedCreationError).toBeInstanceOf(Error)
    expect(resolvedConnection).toBeInstanceOf(ContextCapturingProfilePoolDriver)
    expect(resolvedConnection.activationProfileContext).toBe(capturedContext)
    expect(firstSpan.pools[0].checkoutWait.count).toBe(3)
    expect(firstSpan.pools[0].checkoutTimeoutCount).toBe(1)
    expect(firstSpan.pools[0].connectionCreation.count).toBe(2)
    expect(firstSpan.pools[0].connectionCreation.failedCount).toBe(1)
    expect(secondSpan.pools).toBe(undefined)

    await pool.closeAll()
  })
})
