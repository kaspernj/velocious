// @ts-check

import "../../../src/database/annotations-async-hooks.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { withDatabaseAnnotation } from "../../../src/database/annotations.js"

class ProcessListCommentDriver extends DatabaseDriverBase {
  clearSchemaCacheCalls = 0

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

  /** @returns {void} - No return value. */
  clearSchemaCache() {
    this.clearSchemaCacheCalls++
  }
}

/** @returns {import("../../../src/configuration.js").default} - Configuration-shaped object. */
function buildConfiguration() {
  return /** @type {import("../../../src/configuration.js").default} */ ({
    getCurrentRequestTiming() {
      return undefined
    },
    getQueryLoggingEnabled() {
      return false
    }
  })
}

describe("Database drivers - process-list comments", {databaseCleaning: {transaction: true}}, () => {
  it("adds checkout and annotation comments to executed SQL", async () => {
    const driver = new ProcessListCommentDriver({}, buildConfiguration())

    await driver.setConnectionCheckoutName("Frontend model request")

    await withDatabaseAnnotation("report export", async () => {
      await withDatabaseAnnotation("tenant beta", async () => {
        await driver.query("SELECT 1")
      })
    })

    expect(driver.queries).toEqual([
      "/* velocious checkout=\"Frontend model request\" annotations=\"report export > tenant beta\" */ SELECT 1"
    ])
  })

  it("sanitizes process-list comment values", async () => {
    const driver = new ProcessListCommentDriver({}, buildConfiguration())

    await driver.setConnectionCheckoutName("bad */ checkout\nname")

    await withDatabaseAnnotation("quoted \"annotation\"", async () => {
      await driver.query("SELECT 1")
    })

    expect(driver.queries).toEqual([
      "/* velocious checkout=\"bad * / checkout name\" annotations=\"quoted 'annotation'\" */ SELECT 1"
    ])
  })

  it("skips process-list comments when disabled for a query", async () => {
    const driver = new ProcessListCommentDriver({}, buildConfiguration())

    await driver.setConnectionCheckoutName("metadata query")
    await driver.query("SET application_name = 'metadata query'", {processListComment: false})

    expect(driver.queries).toEqual(["SET application_name = 'metadata query'"])
  })

  it("uses original SQL for schema cache invalidation", async () => {
    const driver = new ProcessListCommentDriver({}, buildConfiguration())

    await driver.setConnectionCheckoutName("migration")
    await driver.query("CREATE TABLE schema_cache_test(id int)")

    expect(driver.queries).toEqual([
      "/* velocious checkout=\"migration\" */ CREATE TABLE schema_cache_test(id int)"
    ])
    expect(driver.clearSchemaCacheCalls).toBe(1)
  })
})
