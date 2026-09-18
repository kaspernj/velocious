// @ts-check

import dummyConfiguration from "../../dummy/src/config/configuration.js"
import Dummy from "../../dummy/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"

function getPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  return pool instanceof AsyncTrackedMultiConnection ? pool : null
}

describe("AsyncTrackedMultiConnection context handling", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("does not return the global fallback when asking for the current context connection", async () => {
    await Dummy.run(async () => {
      const pool = getPool()

      if (!pool) return

      // Prime the pool and fallback
      await pool.ensureGlobalConnection()

      // In a blank async context: current context connection should be undefined
      await pool.asyncLocalStorage.run(undefined, async () => {
        expect(pool.getCurrentContextConnection()).toBeUndefined()

        // Outside async context getCurrentConnection uses the fallback
        const outside = pool.getCurrentConnection()
        expect(outside).toBe(pool.getGlobalConnection())
      })

      // Inside async context should return the scoped connection, not the fallback
      await pool.withConnection(async () => {
        const contextConnection = pool.getCurrentContextConnection()
        const current = pool.getCurrentConnection()

        expect(contextConnection).toBeDefined()
        expect(current).toBe(contextConnection)
        expect(current).not.toBe(pool.getGlobalConnection())
      })
    })
  })

  it("selects test shared connection providers from the live tenant context", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-pool-live-tenant-shared-provider")
    const pool = configuration.getDatabasePool("projectTenant")

    if (!(pool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected an AsyncTrackedMultiConnection pool")

    try {
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await pool.withConnection(async (alphaConnection) => {
          await alphaConnection.query("CREATE TABLE tenant_values(value varchar(255) NOT NULL)")
          await alphaConnection.query("INSERT INTO tenant_values(value) VALUES ('alpha')")

          await configuration.runWithTenant({slug: "beta"}, async () => {
            await pool.withConnection(async (betaConnection) => {
              await betaConnection.query("CREATE TABLE tenant_values(value varchar(255) NOT NULL)")
              await betaConnection.query("INSERT INTO tenant_values(value) VALUES ('beta')")

              await configuration.runWithTenant({slug: "unmatched"}, async () => {
                await pool.withConnection(async (requestConnection) => {
                  await requestConnection.query("CREATE TABLE tenant_values(value varchar(255) NOT NULL)")
                  await requestConnection.query("INSERT INTO tenant_values(value) VALUES ('unmatched')")

                  const alphaRegistration = pool.registerTestSharedConnectionProvider({
                    matches: () => configuration.getCurrentTenant()?.slug == "alpha",
                    provider: () => alphaConnection
                  })
                  const betaRegistration = pool.registerTestSharedConnectionProvider({
                    matches: () => configuration.getCurrentTenant()?.slug == "beta",
                    provider: () => betaConnection
                  })
                  const mismatchRegistration = pool.registerTestSharedConnectionProvider({
                    matches: () => configuration.getCurrentTenant()?.slug == "mismatch",
                    provider: () => alphaConnection
                  })
                  const undefinedRegistration = pool.registerTestSharedConnectionProvider({
                    matches: () => configuration.getCurrentTenant()?.slug == "undefined",
                    provider: () => undefined
                  })
                  const unrelatedRegistration = pool.setTestSharedConnection(alphaConnection)

                  try {
                    await configuration.runWithTenant({slug: "alpha"}, async () => {
                      const currentConnection = pool.getCurrentConnection()

                      expect(currentConnection).toBe(alphaConnection)
                      expect(await currentConnection.query("SELECT value FROM tenant_values")).toEqual([{value: "alpha"}])
                    })
                    await configuration.runWithTenant({slug: "beta"}, async () => {
                      const currentConnection = pool.getCurrentConnection()

                      expect(currentConnection).toBe(betaConnection)
                      expect(await currentConnection.query("SELECT value FROM tenant_values")).toEqual([{value: "beta"}])
                    })
                    await configuration.runWithTenant({slug: "unmatched"}, async () => {
                      const currentConnection = pool.getCurrentConnection()

                      expect(currentConnection).toBe(requestConnection)
                      expect(await currentConnection.query("SELECT value FROM tenant_values")).toEqual([{value: "unmatched"}])
                    })
                    await configuration.runWithTenant({slug: "undefined"}, async () => {
                      const currentConnection = pool.getCurrentConnection()

                      expect(currentConnection).toBe(requestConnection)
                      expect(await currentConnection.query("SELECT value FROM tenant_values")).toEqual([{value: "unmatched"}])
                    })
                    await configuration.runWithTenant({slug: "mismatch"}, async () => {
                      await expect(async () => {
                        const currentConnection = pool.getCurrentConnection()

                        await currentConnection.query("SELECT value FROM tenant_values")
                      }).toThrowError("Test shared connection provider for projectTenant returned a connection for a different database configuration")
                    })
                  } finally {
                    pool.clearTestSharedConnection(unrelatedRegistration)
                    pool.clearTestSharedConnection(undefinedRegistration)
                    pool.clearTestSharedConnection(mismatchRegistration)
                    pool.clearTestSharedConnection(betaRegistration)
                    pool.clearTestSharedConnection(alphaRegistration)
                  }
                })
              })
            })
          })
        })
      })
    } finally {
      await cleanup()
    }
  })
})
