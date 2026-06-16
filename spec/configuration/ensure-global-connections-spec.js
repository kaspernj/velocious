// @ts-check

import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Configuration.ensureGlobalConnections", {databaseCleaning: {transaction: true}}, () => {
  it("ensures global or fallback connections for all pools", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureGlobalConnections()

      const defaultPool = dummyConfiguration.getDatabasePool("default")
      const defaultConnection = defaultPool.getCurrentConnection()

      expect(defaultConnection).toBeDefined()

      if (!dummyConfiguration.getDatabaseIdentifiers().includes("mssql")) return

      const mssqlPool = /** @type {import("../../src/database/pool/async-tracked-multi-connection.js").default} */ (dummyConfiguration.getDatabasePool("mssql"))
      const fallbackConnection = mssqlPool.getGlobalConnection()
      const outsideConnection = await mssqlPool.asyncLocalStorage.run(undefined, async () => mssqlPool.getCurrentConnection())

      expect(fallbackConnection).toBeDefined()
      expect(outsideConnection).toBe(fallbackConnection)
    })
  })
})
