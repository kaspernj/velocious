// @ts-check

import Dummy from "../dummy/index.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Configuration.ensureGlobalConnections", {databaseCleaning: {transaction: true}}, () => {
  it("ensures global or fallback connections for all pools", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureGlobalConnections()

      const defaultPool = dummyConfiguration.getDatabasePool("default")
      const asyncTrackedPool = dummyConfiguration.getDatabaseIdentifiers()
        .map((identifier) => dummyConfiguration.getDatabasePool(identifier))
        .find((pool) => pool instanceof AsyncTrackedMultiConnection)

      const defaultConnection = defaultPool.getCurrentConnection()

      expect(defaultConnection).toBeDefined()

      if (!asyncTrackedPool) return

      const fallbackConnection = asyncTrackedPool.getGlobalConnection()
      const outsideConnection = await asyncTrackedPool.asyncLocalStorage.run(undefined, async () => asyncTrackedPool.getCurrentConnection())

      expect(fallbackConnection).toBeDefined()
      expect(outsideConnection).toBe(fallbackConnection)
    })
  })
})
