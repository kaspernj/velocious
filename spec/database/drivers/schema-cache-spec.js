// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class SchemaCacheTestDriver extends DatabaseDriverBase {
  /** @type {string[]} */
  queries = []

  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /** @returns {string} - Query SQL. */
  queryToSql() { return "" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(sql) {
    this.queries.push(sql)

    return []
  }
}

/**
 * @param {import("../../../src/configuration-types.js").DatabaseConfigurationType} databaseConfig - Database configuration.
 * @returns {import("../../../src/configuration.js").default} - Configuration-shaped object.
 */
function buildConfiguration(databaseConfig) {
  return /** @type {import("../../../src/configuration.js").default} */ (/** @type {unknown} */ ({
    getCurrentRequestTiming() {
      return undefined
    },
    getEnvironment() {
      return "test"
    },
    getQueryLoggingEnabled() {
      return false
    },
    resolveDatabaseConfiguration() {
      return databaseConfig
    }
  }))
}

describe("Database drivers - schema cache", {databaseCleaning: {truncate: false}}, () => {
  it("clears schema caches across live async-tracked pool connections", async () => {
    const pool = new AsyncTrackedMultiConnection({
      configuration: buildConfiguration({driver: SchemaCacheTestDriver, name: "schema-cache-test", type: "sqlite"}),
      identifier: "default"
    })
    const firstConnection = await pool.checkout()
    const secondConnection = await pool.checkout()
    let firstLoads = 0
    let secondLoads = 0

    try {
      await firstConnection._cachedSchemaMetadata("tables", async () => {
        firstLoads++

        return ["first"]
      })
      await secondConnection._cachedSchemaMetadata("tables", async () => {
        secondLoads++

        return ["second"]
      })

      await secondConnection.query("CREATE TABLE schema_cache_pool_test(id int)")

      await firstConnection._cachedSchemaMetadata("tables", async () => {
        firstLoads++

        return ["first-after-ddl"]
      })
      await secondConnection._cachedSchemaMetadata("tables", async () => {
        secondLoads++

        return ["second-after-ddl"]
      })

      expect(firstLoads).toBe(2)
      expect(secondLoads).toBe(2)
    } finally {
      pool.checkin(firstConnection)
      pool.checkin(secondConnection)
    }
  })

  it("treats comment statements as schema-cache-invalidating SQL", async () => {
    const driver = new SchemaCacheTestDriver({}, buildConfiguration({driver: SchemaCacheTestDriver, name: "schema-cache-test", type: "sqlite"}))
    let loads = 0

    await driver._cachedSchemaMetadata("columns:posts", async () => {
      loads++

      return ["before-comment"]
    })

    await driver.query("COMMENT ON COLUMN posts.title IS 'Visible title'")

    await driver._cachedSchemaMetadata("columns:posts", async () => {
      loads++

      return ["after-comment"]
    })

    expect(loads).toBe(2)
  })
})
