// @ts-check

import DatabaseDriversPgsql from "../../../src/database/drivers/pgsql/index.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../../src/testing/test.js"

class QueryCapturingPgsqlDriver extends DatabaseDriversPgsql {
  /** @type {Array<{options: import("../../../src/database/drivers/base.js").QueryOptions, sql: string}>} */
  queries = []

  /**
   * @param {string} value - Value to quote.
   * @returns {string} - Quoted value.
   */
  quote(value) {
    return `'${value.replace(/'/g, "''")}'`
  }

  /**
   * @param {string} sql - SQL string.
   * @param {import("../../../src/database/drivers/base.js").QueryOptions} [options] - Query options.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async query(sql, options = {}) {
    this.queries.push({options, sql})

    return []
  }
}

/** @returns {import("../../../src/configuration.js").default} - Configuration-shaped object. */
function buildConfiguration() {
  return /** @type {import("../../../src/configuration.js").default} */ ({
    environmentHandler: new EnvironmentHandlerNode(),
    getCurrentRequestTiming() {
      return undefined
    },
    getQueryLoggingEnabled() {
      return false
    }
  })
}

describe("Database - Drivers - PostgreSQL - checkout names", {databaseCleaning: {transaction: true}}, () => {
  it("sets and resets application_name without process-list comments", async () => {
    const pgsql = new QueryCapturingPgsqlDriver({}, buildConfiguration())

    await pgsql.setConnectionCheckoutName("pgsql checkout spec")
    await pgsql.clearConnectionCheckoutName()

    expect(pgsql.queries).toEqual([
      {
        options: {logName: "Set Connection Checkout Name", processListComment: false},
        sql: "SET application_name = 'pgsql checkout spec'"
      },
      {
        options: {logName: "Clear Connection Checkout Name", processListComment: false},
        sql: "RESET application_name"
      }
    ])
  })

  it("sets the session time zone to UTC without process-list comments", async () => {
    const pgsql = new QueryCapturingPgsqlDriver({}, buildConfiguration())

    await pgsql.setSessionTimezoneToUtc()

    expect(pgsql.queries).toEqual([
      {
        options: {logName: "Set Session Time Zone", processListComment: false},
        sql: "SET TIME ZONE 'UTC'"
      }
    ])
  })
})
