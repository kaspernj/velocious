// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"

import {closeRunnerConnections} from "../../src/background-jobs/runner-graceful-shutdown.js"

/**
 * A fake configuration that records the framework-close calls a runner makes on
 * shutdown, optionally overriding each to throw or hang. Structurally matches the
 * `RunnerCloseableConfiguration` contract `closeRunnerConnections` depends on, so no
 * broad cast is needed to pass it.
 * @param {{closeDatabaseConnections?: () => Promise<void>, disconnectBeacon?: () => Promise<void>, shutdown?: () => Promise<void>}} [overrides] - Per-call behavior overrides.
 * @returns {{calls: string[], closeDatabaseConnections: () => Promise<void>, disconnectBeacon: () => Promise<void>, shutdown: () => Promise<void>}} - The fake configuration.
 */
function fakeConfiguration(overrides = {}) {
  /** @type {string[]} */
  const calls = []

  return {
    calls,
    async disconnectBeacon() {
      calls.push("disconnectBeacon")
      if (overrides.disconnectBeacon) await overrides.disconnectBeacon()
    },
    async closeDatabaseConnections() {
      calls.push("closeDatabaseConnections")
      if (overrides.closeDatabaseConnections) await overrides.closeDatabaseConnections()
    },
    async shutdown() {
      calls.push("shutdown")
      if (overrides.shutdown) await overrides.shutdown()
    }
  }
}

/**
 * Runs `callback` and returns the error it threw, or undefined if it did not throw.
 * @param {() => Promise<unknown>} callback - Callback expected to reject.
 * @returns {Promise<unknown>} - The thrown error, or undefined.
 */
async function errorFrom(callback) {
  try {
    await callback()
  } catch (error) {
    return error
  }

  return undefined
}

describe("runner graceful shutdown", () => {
  it("closes both the beacon and the database connections so held advisory locks release on shutdown", async () => {
    const configuration = fakeConfiguration()

    await closeRunnerConnections(configuration)

    expect(configuration.calls).toEqual(["shutdown", "disconnectBeacon", "closeDatabaseConnections"])
  })

  it("still closes the database even when the beacon disconnect hangs, and surfaces the failure", async () => {
    const configuration = fakeConfiguration({disconnectBeacon: () => new Promise(() => {})})

    // The database close (which releases the locks) must not be skipped because the
    // beacon disconnect never settles; the hung beacon is surfaced via the bound.
    const error = await errorFrom(() => closeRunnerConnections(configuration, 20))

    expect(error).toBeInstanceOf(Error)
    expect(configuration.calls.includes("closeDatabaseConnections")).toBe(true)
  })

  it("surfaces a beacon disconnect failure instead of swallowing it, while still closing the database", async () => {
    const configuration = fakeConfiguration({disconnectBeacon: async () => { throw new Error("beacon down") }})

    const error = await errorFrom(() => closeRunnerConnections(configuration))

    expect(error).toBeInstanceOf(Error)
    expect(configuration.calls.includes("closeDatabaseConnections")).toBe(true)
  })

  it("surfaces a database close failure instead of swallowing it", async () => {
    const configuration = fakeConfiguration({closeDatabaseConnections: async () => { throw new Error("close failed") }})

    const error = await errorFrom(() => closeRunnerConnections(configuration))

    expect(error).toBeInstanceOf(Error)
  })

  it("attempts application and framework cleanup and aggregates failures in lifecycle order", async () => {
    const applicationError = new Error("application close failed")
    const beaconError = new Error("beacon close failed")
    const databaseError = new Error("database close failed")
    const configuration = fakeConfiguration({
      closeDatabaseConnections: async () => { throw databaseError },
      disconnectBeacon: async () => { throw beaconError },
      shutdown: async () => { throw applicationError }
    })

    const error = await errorFrom(() => closeRunnerConnections(configuration))

    expect(configuration.calls).toEqual(["shutdown", "disconnectBeacon", "closeDatabaseConnections"])
    expect(error).toBeInstanceOf(AggregateError)
    expect(/** @type {AggregateError} */ (error).errors).toEqual([applicationError, beaconError, databaseError])
    expect(error.cause).toBe(applicationError)
  })

  it("is bounded so a wedged database close cannot block the exit (rejects instead of hanging)", async () => {
    const configuration = fakeConfiguration({closeDatabaseConnections: () => new Promise(() => {})})

    // Completing at all (rather than hanging on the never-settling close) proves the bound.
    const error = await errorFrom(() => closeRunnerConnections(configuration, 20))

    expect(error).toBeInstanceOf(Error)
  })

  it("is a no-op when no configuration is set", async () => {
    await closeRunnerConnections(null)
  })
})
