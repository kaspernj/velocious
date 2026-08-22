// @ts-check

import Configuration from "../../src/configuration.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import DatabasePoolBase from "../../src/database/pool/base.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SharedTransactionBrokerClient from "../../src/testing/shared-transaction-broker-client.js"
import TestTransactionSession from "../../src/testing/test-transaction-session.js"

class EnrollmentConnection extends DatabaseDriverBase {
  constructor(config, configuration) {
    super(config, configuration)
    this.calls = []
    this.startError = undefined
  }

  async connect() {}
  getType() { return "test" }
  insideTransaction() { return false }
  primaryKeyType() { return "bigint" }
  queryToSql() { return "" }
  async _queryActual() { return [] }
  async startTransaction() {
    this.calls.push("begin")
    if (this.startError) throw this.startError
  }
  async rollbackTransaction() { this.calls.push("rollback") }
  async query(sql) {
    this.calls.push(sql)
    return []
  }
}

class EnrollmentPool extends DatabasePoolBase {
  constructor(args) {
    super(args)
    /** @type {Array<EnrollmentConnection>} */
    this.connections = []
    /** @type {Array<EnrollmentConnection>} */
    this.released = []
    this.checkoutCount = 0
    /** @type {(value?: void) => void} */
    this.releaseSecondCheckout = () => {}
    /** @type {(value?: void) => void} */
    this.resolveSecondCheckout = () => {}
    this.secondCheckout = new Promise((resolve) => { this.resolveSecondCheckout = resolve })
    this.holdSecondCheckout = false
  }

  async checkout() {
    const connection = this.connections[this.checkoutCount]
    this.checkoutCount++
    if (!connection) throw new Error("Enrollment pool connection missing")
    if (this.holdSecondCheckout && this.checkoutCount === 2) {
      this.resolveSecondCheckout()
      await new Promise((resolve) => { this.releaseSecondCheckout = resolve })
    }
    return connection
  }

  async checkin(connection) { this.released.push(/** @type {EnrollmentConnection} */ (connection)) }
  getCurrentConnection() { throw new Error("Enrollment pool has no current connection") }
}

function enrollmentConfiguration() {
  return new Configuration({
    database: {test: {default: {driver: EnrollmentConnection, name: "enrollment", poolType: EnrollmentPool, type: "test"}}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("Test transaction session enrollment ownership", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("releases a checked-out connection when transaction start rejects", async () => {
    const configuration = enrollmentConfiguration()
    const pool = /** @type {EnrollmentPool} */ (configuration.getDatabasePool("default"))
    const connection = new EnrollmentConnection(configuration.resolveDatabaseConfiguration("default"), configuration)
    connection.startError = new Error("transaction start failed")
    pool.connections.push(connection)
    const session = await TestTransactionSession.begin({configuration})

    await expect(() => session.enrollDatabase({databaseIdentifier: "default"})).toThrow(/transaction start failed/)
    expect(pool.released).toEqual([connection])
    await session.cleanup()
    expect(pool.released).toEqual([connection])
  })

  it("releases a concurrent duplicate checkout while preserving the successful owner", async () => {
    const configuration = enrollmentConfiguration()
    const pool = /** @type {EnrollmentPool} */ (configuration.getDatabasePool("default"))
    const owner = new EnrollmentConnection(configuration.resolveDatabaseConfiguration("default"), configuration)
    const duplicate = new EnrollmentConnection(configuration.resolveDatabaseConfiguration("default"), configuration)
    pool.connections.push(owner, duplicate)
    pool.holdSecondCheckout = true
    const session = await TestTransactionSession.begin({configuration})

    const firstEnrollment = session.enrollDatabase({databaseIdentifier: "default"})
    const secondEnrollment = session.enrollDatabase({databaseIdentifier: "default"})
    await pool.secondCheckout
    await firstEnrollment
    pool.releaseSecondCheckout()
    await secondEnrollment
    const client = new SharedTransactionBrokerClient({...session.joinMessage(), databaseIdentifier: "default", reuseKey: pool.getConfigurationReuseKey()})
    await client.call("query", ["owner remains usable"])
    await client.close()
    await session.cleanup()
    await session.cleanup()

    expect(owner.calls).toEqual(["begin", "owner remains usable", "rollback"])
    expect(duplicate.calls).toEqual([])
    expect(pool.released).toEqual([duplicate, owner])
  })
})
