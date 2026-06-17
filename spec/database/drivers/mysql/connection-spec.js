import DatabaseDriversMysql from "../../../../src/database/drivers/mysql/index.js"
import configuration from "../../../dummy/src/config/configuration.js"
import { digg } from "diggerize"

const mysqlConfig = digg(configuration, "database", "test", "default")

class QueryCapturingMysqlDriver extends DatabaseDriversMysql {
  /** @type {Array<{options: import("../../../../src/database/drivers/base.js").QueryOptions, sql: string}>} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @param {import("../../../../src/database/drivers/base.js").QueryOptions} [options] - Query options.
   * @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async query(sql, options = {}) {
    this.queries.push({options, sql})

    return []
  }
}

/**
 * @param {(mysql: DatabaseDriversMysql) => Promise<void>} callback - Callback that receives a connected driver.
 * @returns {Promise<void>} - Resolves when the driver has been closed.
 */
async function withMysqlConnection(callback) {
  if (configuration.getDatabaseType() == "sqlite" || configuration.getDatabaseType() == "mssql" || configuration.getDatabaseType() == "pgsql") return

  const mysql = new DatabaseDriversMysql(mysqlConfig, configuration)

  try {
    await mysql.connect()
    await callback(mysql)
  } finally {
    await mysql.close()
  }
}

describe("Database - Drivers - Mysql - Connection", {databaseCleaning: {transaction: true}}, () => {
  it("connects", async () => {
    await withMysqlConnection(async (mysql) => {
      const result = await mysql.query("SELECT \"1\" AS test1, \"2\" AS test2")

      expect(result).toEqual([{
        test1: "1",
        test2: "2"
      }])
    })
  })

  it("stores the active checkout name in a session variable", async () => {
    await withMysqlConnection(async (mysql) => {
      await mysql.setConnectionCheckoutName("mysql checkout spec")

      let result = await mysql.query("SELECT @velocious_connection_checkout_name AS checkout_name")

      expect(result).toEqual([{checkout_name: "mysql checkout spec"}])

      await mysql.clearConnectionCheckoutName()
      result = await mysql.query("SELECT @velocious_connection_checkout_name AS checkout_name")

      expect(result).toEqual([{checkout_name: null}])
    })
  })

  it("does not tag checkout-name session variable queries with process-list comments", async () => {
    const mysql = new QueryCapturingMysqlDriver(mysqlConfig, configuration)

    await mysql.setConnectionCheckoutName("mysql checkout spec")
    await mysql.clearConnectionCheckoutName()

    expect(mysql.queries).toEqual([
      {
        options: {logName: "Set Connection Checkout Name", processListComment: false},
        sql: "SET @velocious_connection_checkout_name = 'mysql checkout spec'"
      },
      {
        options: {logName: "Clear Connection Checkout Name", processListComment: false},
        sql: "SET @velocious_connection_checkout_name = NULL"
      }
    ])
  })

  it("sets the session time zone to UTC without process-list comments", async () => {
    const mysql = new QueryCapturingMysqlDriver(mysqlConfig, configuration)

    await mysql.setSessionTimezoneToUtc()

    expect(mysql.queries).toEqual([
      {
        options: {logName: "Set Session Time Zone", processListComment: false},
        sql: "SET time_zone = '+00:00'"
      }
    ])
  })
})
