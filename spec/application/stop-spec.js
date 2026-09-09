// @ts-check

import Application from "../../src/application.js"
import {describe, expect, it} from "../../src/testing/test.js"

class TestApplication extends Application {
  stopFinished = false

  /** @returns {Promise<void>} - Resolves when the fake server has started. */
  async startHttpServer() {}

  /** @returns {Promise<void>} - Resolves after async shutdown has completed. */
  async stop() {
    await new Promise((resolve) => setTimeout(resolve, 10))
    this.stopFinished = true
  }
}

describe("Application.stop", {databaseCleaning: {transaction: true}}, () => {
  it("closes database connections", async () => {
    let closedConnections = false

    const configuration = {
      closeDatabaseConnections: async () => { closedConnections = true },
      debug: false,
      disconnectBeacon: async () => {},
      shutdown: async () => {}
    }

    const app = new Application({configuration, type: "test"})
    app.httpServer = {stop: async () => {}}

    await app.stop()

    expect(closedConnections).toBeTrue()
  })

  it("shares one stop and closes application resources before every framework resource", async () => {
    const events = []
    const applicationError = new Error("application teardown failed")
    const beaconError = new Error("beacon close failed")
    const databaseError = new Error("database close failed")
    const configuration = {
      closeDatabaseConnections: async () => {
        events.push("database")
        throw databaseError
      },
      debug: false,
      disconnectBeacon: async () => {
        events.push("beacon")
        throw beaconError
      },
      shutdown: async () => {
        events.push("application")
        throw applicationError
      }
    }
    const app = new Application({configuration, type: "test"})
    app.httpServer = {stop: async () => { events.push("http") }}

    const first = app.stop()
    const second = app.stop()
    let error

    expect(second).toBe(first)
    try {
      await first
    } catch (caughtError) {
      error = caughtError
    }

    expect(events).toEqual(["http", "application", "beacon", "database"])
    expect(error).toBeInstanceOf(AggregateError)
    expect(/** @type {AggregateError} */ (error).errors).toEqual([applicationError, beaconError, databaseError])
    expect(error.cause).toBe(applicationError)
  })

  it("waits for run cleanup to stop the application", async () => {
    const app = new TestApplication({configuration: {}, type: "test"})

    await app.run(async () => {})

    expect(app.stopFinished).toBeTrue()
  })
})
