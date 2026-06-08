// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {Configuration} Test configuration for debug snapshot specs. */
function debugSnapshotConfiguration() {
  return new Configuration({
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
}

describe("HttpServer debug snapshots", {databaseCleaning: {transaction: true}}, () => {
  it("includes per-worker debug snapshots", async () => {
    const configuration = debugSnapshotConfiguration()
    const httpServer = new HttpServer({
      configuration,
      inProcess: true,
      workers: 2
    })

    await httpServer._ensureWorkers()

    try {
      const snapshot = await httpServer.getDebugSnapshot()

      expect(snapshot.configuredWorkerCount).toEqual(2)
      expect(snapshot.workerCount).toEqual(2)
      expect(snapshot.workers.map((worker) => ({active: worker.active, workerCount: worker.workerCount}))).toEqual([
        {active: true, workerCount: 0},
        {active: true, workerCount: 1}
      ])
      expect(snapshot.workers[0].snapshot.database).toMatchObject({initializedPools: []})
      expect(snapshot.workers[1].snapshot.database).toMatchObject({initializedPools: []})
    } finally {
      await httpServer.stop()
    }
  })
})
