// @ts-check

import Application from "../../src/application.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Application.stop", () => {
  it("closes database connections", async () => {
    let closedConnections = false

    const configuration = {
      closeDatabaseConnections: async () => { closedConnections = true },
      debug: false
    }

    const app = new Application({configuration, type: "test"})
    app.httpServer = {stop: async () => {}}

    await app.stop()

    expect(closedConnections).toBeTrue()
  })
})
