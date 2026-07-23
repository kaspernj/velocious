// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"

import {closeRunnerConnections} from "../../src/background-jobs/runner-graceful-shutdown.js"

/**
 * A fake configuration that records the framework-close calls a runner makes on
 * shutdown, optionally overriding each to throw or hang.
 * @param {{closeDatabaseConnections?: () => Promise<void>, disconnectBeacon?: () => Promise<void>}} [overrides]
 * @returns {{calls: string[], closeDatabaseConnections: () => Promise<void>, disconnectBeacon: () => Promise<void>}}
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
    }
  }
}

describe("runner graceful shutdown", () => {
  it("closes database connections (after disconnecting the beacon) so held advisory locks release on shutdown", async () => {
    const configuration = fakeConfiguration()

    await closeRunnerConnections(/** @type {any} */ (configuration))

    expect(configuration.calls).toEqual(["disconnectBeacon", "closeDatabaseConnections"])
  })

  it("still closes database connections when disconnecting the beacon fails", async () => {
    const configuration = fakeConfiguration({disconnectBeacon: async () => { throw new Error("beacon down") }})

    await closeRunnerConnections(/** @type {any} */ (configuration))

    expect(configuration.calls).toEqual(["disconnectBeacon", "closeDatabaseConnections"])
  })

  it("does not throw when the close itself fails (the caller is exiting regardless)", async () => {
    const configuration = fakeConfiguration({closeDatabaseConnections: async () => { throw new Error("close failed") }})

    await closeRunnerConnections(/** @type {any} */ (configuration))

    expect(configuration.calls).toEqual(["disconnectBeacon", "closeDatabaseConnections"])
  })

  it("is bounded so a wedged close cannot block the exit", async () => {
    const configuration = fakeConfiguration({closeDatabaseConnections: () => new Promise(() => {})})

    // Completing (rather than hanging on the never-settling close) proves the bound.
    await closeRunnerConnections(/** @type {any} */ (configuration), 20)

    expect(configuration.calls).toEqual(["disconnectBeacon", "closeDatabaseConnections"])
  })

  it("is a no-op when no configuration is set", async () => {
    await closeRunnerConnections(null)
  })
})
