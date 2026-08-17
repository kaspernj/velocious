// @ts-check

import Configuration from "../../src/configuration.js"
import Current from "../../src/current.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import TestRunner from "../../src/testing/test-runner.js"
import { SHARED_TRANSACTION_BROKER_ENV } from "../../src/testing/shared-transaction-proxy-driver.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"

class BrokerLifecycleConnection extends DatabaseDriverBase {
  transactionActive = false

  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {boolean} - Whether this synthetic connection is transaction-active. */
  insideTransaction() { return this.transactionActive }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /** @returns {string} - Query SQL. */
  queryToSql() { return "" }

  /** @returns {Promise<import("../../src/database/drivers/base.js").QueryResultType>} - Empty result. */
  async _queryActual() { return [] }
}

/** @returns {Configuration} - Minimal broker lifecycle configuration. */
function brokerLifecycleConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

class ReplacingConnectionTestRunner extends TestRunner {
  /** @type {Record<string, DatabaseDriverBase>} */
  currentConnections = {}

  sharedTransactionConnections() { return this.currentConnections }
}

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

  it("replaces a pre-hook broker when the active transaction uses a new physical connection", async () => {
    const configuration = brokerLifecycleConfiguration()
    const firstConnection = new BrokerLifecycleConnection({}, configuration)
    const secondConnection = new BrokerLifecycleConnection({}, configuration)
    const testRunner = new ReplacingConnectionTestRunner({configuration, testFiles: []})
    testRunner.currentConnections = {default: firstConnection}
    const preparation = await testRunner.prepareSharedTransactionBroker()
    let registration

    try {
      secondConnection.transactionActive = true
      testRunner.currentConnections = {default: secondConnection}
      registration = await testRunner.startSharedTransactionBroker(preparation)

      expect(registration?.broker.connections.default).toBe(secondConnection)
      expect(preparation?.broker.accepting).toBe(false)
    } finally {
      await testRunner.stopSharedTransactionBroker(registration || preparation)
    }
  })

  it("replaces a pre-hook broker when the active identifier set becomes a strict subset", async () => {
    const configuration = brokerLifecycleConfiguration()
    const defaultConnection = new BrokerLifecycleConnection({}, configuration)
    const auditConnection = new BrokerLifecycleConnection({}, configuration)
    const testRunner = new ReplacingConnectionTestRunner({configuration, testFiles: []})
    testRunner.currentConnections = {audit: auditConnection, default: defaultConnection}
    const preparation = await testRunner.prepareSharedTransactionBroker()
    let registration

    try {
      defaultConnection.transactionActive = true
      testRunner.currentConnections = {default: defaultConnection}
      registration = await testRunner.startSharedTransactionBroker(preparation)

      expect(registration?.broker === preparation?.broker).toEqual(false)
      expect(preparation?.broker.accepting).toBe(false)
      expect(Object.keys(registration?.broker.connections || {})).toEqual(["default"])
    } finally {
      await testRunner.stopSharedTransactionBroker(registration || preparation)
    }
  })
})
