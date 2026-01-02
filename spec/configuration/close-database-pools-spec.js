// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

class FakePool {
  static cleared = false

  static clearGlobalConnections() {
    this.cleared = true
  }

  constructor({configuration, identifier}) {
    this.configuration = configuration
    this.identifier = identifier
    this.closed = false
  }

  async closeAll() {
    this.closed = true
  }
}

describe("Configuration.closeDatabasePools", () => {
  it("closes pools and clears global connections", async () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: class {},
            poolType: FakePool,
            type: "fake"
          }
        }
      },
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    const pool = configuration.getDatabasePool("default")

    await configuration.closeDatabasePools()

    expect(pool.closed).toBe(true)
    expect(FakePool.cleared).toBe(true)
  })
})
