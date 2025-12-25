// @ts-check

import Dummy from "../dummy/index.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Configuration.ensureGlobalConnections", () => {
  it("ensures global or fallback connections for all pools", async () => {
    await Dummy.run(async () => {
      const configuration = /** @type {any} */ (dummyConfiguration)

      await configuration.ensureGlobalConnections()

      const defaultPool = configuration.getDatabasePool("default")
      const mssqlPool = /** @type {AsyncTrackedMultiConnection} */ (configuration.getDatabasePool("mssql"))

      const defaultConnection = defaultPool.getCurrentConnection()
      const fallbackConnection = mssqlPool.getGlobalConnection()
      const outsideConnection = await mssqlPool.asyncLocalStorage.run(undefined, async () => mssqlPool.getCurrentConnection())

      expect(defaultConnection).toBeDefined()
      expect(fallbackConnection).toBeDefined()
      expect(outsideConnection).toBe(fallbackConnection)
    })
  })
})
