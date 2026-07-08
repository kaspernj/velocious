import DatabaseDriversMysql from "../../../../src/database/drivers/mysql/index.js"
import configuration from "../../../dummy/src/config/configuration.js"
import { digg } from "diggerize"

const mysqlConfig = digg(configuration, "database", "test", "default")

class QueryCapturingMysqlDriver extends DatabaseDriversMysql {
  /** @type {Array<{options: import("../../../../src/database/drivers/base.js").QueryOptions, sql: string}>} */
  queries = []

  /** @type {string[]} */
  actualQueries = []

  /**
   * @param {string} sql - SQL string.
   * @param {import("../../../../src/database/drivers/base.js").QueryOptions} [options] - Query options.
   * @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async query(sql, options = {}) {
    this.queries.push({options, sql})

    return []
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(sql) {
    this.actualQueries.push(sql)

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
        options: {logName: "Set Connection Checkout Name", processListComment: false, sessionTimeZone: false},
        sql: "SET @velocious_connection_checkout_name = 'mysql checkout spec'"
      },
      {
        options: {logName: "Clear Connection Checkout Name", processListComment: false, sessionTimeZone: false},
        sql: "SET @velocious_connection_checkout_name = NULL"
      }
    ])
  })

  it("sets the session time zone once before a query sequence", async () => {
    const mysql = new QueryCapturingMysqlDriver(mysqlConfig, configuration)

    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 1")
    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 2")

    expect(mysql.actualQueries).toEqual([
      "SET time_zone = '+00:00'",
      "SELECT 1",
      "SELECT 2"
    ])
  })

  it("does not reset the session time zone on connection checkout", async () => {
    const mysql = new QueryCapturingMysqlDriver(mysqlConfig, configuration)

    await mysql.setConnectionCheckoutName("first checkout")
    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 1")
    await mysql.clearConnectionCheckoutName()
    await mysql.setConnectionCheckoutName("second checkout")
    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 2")

    expect(mysql.actualQueries).toEqual([
      "SET time_zone = '+00:00'",
      '/* velocious checkout="first checkout" */ SELECT 1',
      '/* velocious checkout="second checkout" */ SELECT 2'
    ])
  })

  it("sets the session time zone lazily when the desired time zone changed", async () => {
    const mysql = new QueryCapturingMysqlDriver(mysqlConfig, configuration)

    mysql.setDesiredSessionTimeZone("+00:00")
    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 1")
    mysql.setDesiredSessionTimeZone("+01:00")
    await mysql.setConnectionCheckoutName("timezone changed checkout")
    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 2")
    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT 3")

    expect(mysql.actualQueries).toEqual([
      "SET time_zone = '+00:00'",
      "SELECT 1",
      "SET time_zone = '+01:00'",
      '/* velocious checkout="timezone changed checkout" */ SELECT 2',
      '/* velocious checkout="timezone changed checkout" */ SELECT 3'
    ])
  })

  it("sets the session time zone before retried queries after reconnect", async () => {
    class RetryMysqlDriver extends QueryCapturingMysqlDriver {
      attempts = 0

      /** @returns {Promise<void>} - Resolves when complete. */
      async reconnect() {
        // Simulate the base reconnect behavior without touching a real MySQL pool.
        this.resetCurrentSessionTimeZone()
      }

      /**
       * @param {string} sql - SQL string.
       * @returns {Promise<import("../../../../src/database/drivers/base.js").QueryResultType>} - Query result.
       */
      async _queryActual(sql) {
        this.actualQueries.push(sql)

        if (sql == "SELECT retry_me") {
          this.attempts++
          if (this.attempts == 1) {
            const error = new Error("Connection lost during query")
            // @ts-expect-error error code is provided by the mysql package at runtime.
            error.code = "PROTOCOL_CONNECTION_LOST"
            throw error
          }
        }

        return []
      }
    }

    const mysql = new RetryMysqlDriver(mysqlConfig, configuration)

    await DatabaseDriversMysql.prototype.query.call(mysql, "SELECT retry_me")

    expect(mysql.actualQueries).toEqual([
      "SET time_zone = '+00:00'",
      "SELECT retry_me",
      "SET time_zone = '+00:00'",
      "SELECT retry_me"
    ])
  })

  it("destroys pool connections during advisory-lock hold-timeout cleanup", async () => {
    const mysql = new DatabaseDriversMysql(mysqlConfig, configuration)
    const destroyedConnections = []
    let endCalled = false

    mysql.setDesiredSessionTimeZone("+01:00")
    mysql.pool = {
      _allConnections: [
        {destroy: () => destroyedConnections.push("first")},
        {destroy: () => destroyedConnections.push("second")}
      ],

      end: () => {
        endCalled = true
      }
    }

    await mysql.releaseAdvisoryLockAfterHoldTimeout("mysql-advisory-lock-timeout")

    expect(destroyedConnections).toEqual(["first", "second"])
    expect(endCalled).toBe(false)
    expect(mysql.pool).toBe(undefined)
    expect(mysql.getCurrentSessionTimeZone()).toBe(null)
  })
})
