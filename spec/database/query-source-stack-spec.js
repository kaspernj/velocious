// @ts-check

import DatabaseDriverBase from "../../src/database/drivers/base.js"
import {describe, expect, it} from "../../src/testing/test.js"

class TestDriver extends DatabaseDriverBase {
  /** @type {string | undefined} */
  lastSourceStack = undefined

  /**
   * @param {string} sql - SQL string.
   * @param {import("../../src/database/drivers/base.js").QueryOptions} options - Query options.
   * @returns {Promise<string | undefined>} - Source stack passed to query logging.
   */
  async readSourceStack(sql, options) {
    await this.query(sql, options)

    return this.lastSourceStack
  }

  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /** @returns {string} - Query SQL. */
  queryToSql() { return "" }

  /** @returns {Promise<import("../../src/database/drivers/base.js").QueryResultType>} - Query result. */
  async _queryActual() {
    return []
  }

  /** @returns {Promise<void>} - Prevents real log output in the unit test. */
  async _logQuery() {}

  /**
   * @param {object} args - Query arguments.
   * @param {string} args.originalSql - Original SQL before process-list comments.
   * @param {string} args.querySql - SQL sent to the database.
   * @param {import("../../src/database/drivers/base.js").QueryOptions} options - Query options.
   * @param {import("../../src/http-server/client/request-timing.js").default | undefined} requestTiming - Request timing.
   * @param {number} tries - Query attempt count.
   * @returns {Promise<import("../../src/database/drivers/base.js").QueryResultType>} - Resolves with the query.
   */
  async _queryActualWithLogging(args, options, requestTiming, tries) {
    this.lastSourceStack = options.sourceStack

    return await super._queryActualWithLogging(args, options, requestTiming, tries)
  }
}

describe("query source stack conditionality", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  /** @returns {TestDriver} - Test driver with no request timing. */
  function createDriver() {
    return new TestDriver({}, {
      getCurrentRequestTiming() {
        return undefined
      }
    })
  }

  it("passes undefined sourceStack when query logging is disabled", async () => {
    const driver = createDriver()

    const sourceStack = await driver.readSourceStack("SELECT 1", {logQuery: false})

    expect(sourceStack).toBeUndefined()
  })

  it("passes a captured source stack when query logging is enabled", async () => {
    const driver = createDriver()

    const sourceStack = await driver.readSourceStack("SELECT 1", {logQuery: true})

    expect(sourceStack).toBeDefined()
    expect(typeof sourceStack).toEqual("string")
    expect(sourceStack).toMatch(/^Error/)
  })
})