// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"

describe("SingleMultiUsePool context handling", () => {
  it("suppresses the shared current connection across async callbacks", async () => {
    await Dummy.run(async () => {
      const pool = dummyConfiguration.getDatabasePool("default")

      if (!(pool instanceof SingleMultiUsePool)) throw new Error("Expected the dummy default pool to be SingleMultiUsePool")

      const sharedConnection = pool.getCurrentConnection()
      let contextConnection
      let configurationConnectionCount = 0

      await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
        await Promise.resolve()
        contextConnection = pool.getCurrentContextConnection()
        configurationConnectionCount = Object.keys(dummyConfiguration.getCurrentConnections()).length
      })

      expect(sharedConnection).toBeDefined()
      expect(contextConnection).toBeUndefined()
      expect(configurationConnectionCount).toEqual(0)
    })
  })
})
