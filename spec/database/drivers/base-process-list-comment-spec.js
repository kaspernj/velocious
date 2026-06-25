// @ts-check

import "../../../src/database/annotations-async-hooks.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { withDatabaseAnnotation } from "../../../src/database/annotations.js"

class ProcessListCommentDriver extends DatabaseDriverBase {
  clearSchemaCacheCalls = 0

  /** @type {string[]} */
  queries = []

  /** @type {string[]} */
  hookEvents = []

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

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async beforeQuery(sql) {
    this.hookEvents.push(`before:${sql}`)
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterQuery(sql) {
    this.hookEvents.push(`after:${sql}`)
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

  it("runs before and after query hooks around executed SQL", async () => {
    const driver = new ProcessListCommentDriver({}, buildConfiguration())

    await driver.query("SELECT 1")

    expect(driver.hookEvents).toEqual([
      "before:SELECT 1",
      "after:SELECT 1"
    ])
    expect(driver.queries).toEqual(["SELECT 1"])
  })

  it("runs after query hooks when the driver query fails", async () => {
    class FailingProcessListCommentDriver extends ProcessListCommentDriver {
      /**
       * @param {string} sql - SQL string.
       * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query result.
       */
      async _queryActual(sql) {
        this.queries.push(sql)
        throw new Error("query failed")
      }
    }

    const driver = new FailingProcessListCommentDriver({}, buildConfiguration())
    const error = await driver.query("SELECT fail").then(
      () => undefined,
      (caughtError) => caughtError
    )

    expect(error.message).toEqual("query failed")

    expect(driver.hookEvents).toEqual([
      "before:SELECT fail",
      "after:SELECT fail"
    ])
    expect(driver.queries).toEqual(["SELECT fail"])
  })
})
