// @ts-check

import Current from "../../src/current.js"
import TestRunner from "../../src/testing/test-runner.js"
import { SHARED_TRANSACTION_BROKER_ENV } from "../../src/testing/shared-transaction-proxy-driver.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"

describe("TestRunner shared transaction broker registration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("registers multiple active non-tenant databases and explicitly excludes tenant-only connections", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-shared-transaction-registration")
    const testRunner = new TestRunner({configuration, testFiles: []})
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // No previous configuration.
      }
      configuration.setCurrent()

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          for (const connection of Object.values(dbs)) await connection.startTransaction()
          const registration = await testRunner.startSharedTransactionBroker()

          try {
            expect(registration).toBeDefined()
            const serialized = process.env[SHARED_TRANSACTION_BROKER_ENV]
            if (!serialized) throw new Error("Expected shared transaction broker environment")
            const childConfig = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8"))

            expect(childConfig.databaseIdentifiers.sort()).toEqual(["analytics", "default"])
          } finally {
            await testRunner.stopSharedTransactionBroker(registration)
            for (const connection of Object.values(dbs)) await connection.rollbackTransaction()
          }
        })
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
