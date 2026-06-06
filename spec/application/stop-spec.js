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
      disconnectBeacon: async () => {}
    }

    const app = new Application({configuration, type: "test"})
    app.httpServer = {stop: async () => {}}

    await app.stop()

    expect(closedConnections).toBeTrue()
  })

  it("waits for run cleanup to stop the application", async () => {
    const app = new TestApplication({configuration: {}, type: "test"})

    await app.run(async () => {})

    expect(app.stopFinished).toBeTrue()
  })
})
