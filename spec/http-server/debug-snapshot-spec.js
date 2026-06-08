// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

class DebugWorkerHandler {
  /**
   * @param {object} args - Options object.
   * @param {number} args.workerCount - Worker number.
   */
  constructor({workerCount}) {
    this.workerCount = workerCount
  }

  /** @returns {Promise<void>} Resolves when started. */
  async start() {}

  /** @returns {Promise<void>} Resolves when stopped. */
  async stop() {}

  /** @returns {Promise<Record<string, unknown>>} Worker debug snapshot. */
  async getDebugSnapshot() {
    return {
      active: true,
      snapshot: {
        database: {
          activeIdentifiers: ["default"],
          pools: {}
        }
      },
      workerCount: this.workerCount
    }
  }
}

describe("HttpServer debug snapshots", {databaseCleaning: {transaction: true}}, () => {
  it("includes per-worker debug snapshots", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: false, file: false}
    })
    const httpServer = new HttpServer({
      configuration,
      workerHandlerFactory: ({workerCount}) => new DebugWorkerHandler({workerCount}),
      workers: 2
    })

    await httpServer._ensureWorkers()

    try {
      const snapshot = await httpServer.getDebugSnapshot()

      expect(snapshot.configuredWorkerCount).toEqual(2)
      expect(snapshot.workerCount).toEqual(2)
      expect(snapshot.workers).toEqual([
        {
          active: true,
          snapshot: {
            database: {
              activeIdentifiers: ["default"],
              pools: {}
            }
          },
          workerCount: 0
        },
        {
          active: true,
          snapshot: {
            database: {
              activeIdentifiers: ["default"],
              pools: {}
            }
          },
          workerCount: 1
        }
      ])
    } finally {
      await httpServer.stop()
    }
  })
})
