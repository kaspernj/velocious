// @ts-check

import {createTenantDatabase, dropTenantDatabase} from "../../src/tenants/default-tenant-database-provisioning.js"
import {describe, expect, it} from "../../src/testing/test.js"

class FakeDriver {
  /** @type {FakeDriver[]} */
  static instances = []

  /** @param {Record<string, any>} config */
  constructor(config) {
    this.config = config
    /** @type {string[]} */
    this.queries = []
    this.connected = false
    this.closed = false
    FakeDriver.instances.push(this)
  }

  async connect() { this.connected = true }
  async close() { this.closed = true }
  /** @param {string} sql */
  async query(sql) { this.queries.push(sql) }
  /** @param {string} name @returns {string[]} */
  createDatabaseSql(name) { return [`CREATE DATABASE \`${name}\``] }
  /** @param {string} name @returns {string[]} */
  dropDatabaseSql(name) { return [`DROP DATABASE IF EXISTS \`${name}\``] }
}

const mysqlConfig = () => /** @type {any} */ ({type: "mysql", driver: FakeDriver, database: "tenant_db", useDatabase: "maintenance_db"})

describe("default tenant database provisioning", () => {
  it("opens only the requested database for file-backed tenant provisioning", async () => {
    /** @type {string[] | undefined} */
    let requestedDatabaseIdentifiers
    const configuration = {
      ensureConnections: async (options, callback) => {
        requestedDatabaseIdentifiers = options.databaseIdentifiers
        await callback({})
      },
      runWithTenant: async (_tenant, callback) => await callback()
    }

    await createTenantDatabase({
      configuration: /** @type {any} */ (configuration),
      databaseConfiguration: /** @type {any} */ ({type: "sqlite", driver: FakeDriver, database: "tenant_db"}),
      identifier: "projectTenant",
      tenant: {}
    })

    expect(requestedDatabaseIdentifiers).toEqual(["projectTenant"])
  })

  it("creates a server tenant database through the maintenance connection and the driver's createDatabaseSql", async () => {
    FakeDriver.instances = []

    await createTenantDatabase({configuration: /** @type {any} */ ({}), databaseConfiguration: mysqlConfig(), tenant: {}})

    const driver = FakeDriver.instances[0]

    expect(driver.config.database).toEqual("maintenance_db")
    expect(driver.queries).toEqual(["CREATE DATABASE `tenant_db`"])
    expect(driver.connected).toEqual(true)
    expect(driver.closed).toEqual(true)
  })

  it("drops a server tenant database through the driver's dropDatabaseSql", async () => {
    FakeDriver.instances = []

    await dropTenantDatabase({configuration: /** @type {any} */ ({}), databaseConfiguration: mysqlConfig()})

    expect(FakeDriver.instances[0].queries).toEqual(["DROP DATABASE IF EXISTS `tenant_db`"])
    expect(FakeDriver.instances[0].closed).toEqual(true)
  })

  it("rejects an unsafe tenant database name before issuing DDL", async () => {
    FakeDriver.instances = []
    let threw = false

    try {
      await dropTenantDatabase({configuration: /** @type {any} */ ({}), databaseConfiguration: /** @type {any} */ ({...mysqlConfig(), database: "tenant_db; DROP"})})
    } catch {
      threw = true
    }

    expect(threw).toEqual(true)
    expect(FakeDriver.instances.filter((driver) => driver.queries.length > 0).length).toEqual(0)
  })

  it("treats a file-backed (sqlite) drop as a no-op with no maintenance connection", async () => {
    FakeDriver.instances = []

    await dropTenantDatabase({configuration: /** @type {any} */ ({}), databaseConfiguration: /** @type {any} */ ({type: "sqlite", driver: FakeDriver, database: "tenant_db"})})

    expect(FakeDriver.instances.length).toEqual(0)
  })
})
