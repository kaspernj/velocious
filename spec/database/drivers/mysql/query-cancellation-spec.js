import DatabaseDriversMysql from "../../../../src/database/drivers/mysql/index.js"
import QueryAbortedError from "../../../../src/database/query-aborted-error.js"
import configuration from "../../../dummy/src/config/configuration.js"
import {digg} from "diggerize"

const mysqlConfig = digg(configuration, "database", "test", "default")

/**
 * Runs `callback` with a freshly connected mysql driver, skipping on non-mysql
 * databases so the suite is a no-op under the sqlite/mssql/pgsql dummy configs.
 * @param {(mysql: DatabaseDriversMysql) => Promise<void>} callback - Receives the connected driver.
 * @returns {Promise<void>} - Resolves once the driver is closed.
 */
async function withMysqlConnection(callback) {
  if (configuration.getDatabaseType() != "mysql") return

  const mysql = new DatabaseDriversMysql(mysqlConfig, configuration)

  try {
    await mysql.connect()
    await callback(mysql)
  } finally {
    await mysql.close()
  }
}

/**
 * Counts the running `SELECT SLEEP(...)` statements from a separate observer
 * connection, proving whether the aborted query is truly gone server-side.
 * @param {DatabaseDriversMysql} observer - A second connected driver.
 * @returns {Promise<number>} - Number of matching running statements.
 */
async function runningSleepCount(observer) {
  const rows = await observer.query("SELECT COUNT(*) AS running FROM information_schema.PROCESSLIST WHERE INFO LIKE 'SELECT SLEEP(30)%'")

  return Number(rows[0].running)
}

describe("Database - Drivers - Mysql - Query cancellation", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("kills an in-flight query on abort, releases it server-side, and recovers the pool", async () => {
    await withMysqlConnection(async (mysql) => {
      const observer = new DatabaseDriversMysql(mysqlConfig, configuration)

      await observer.connect()

      try {
        const controller = new AbortController()
        const startedAt = Date.now()
        const queryPromise = mysql.query("SELECT SLEEP(30)", {signal: controller.signal})

        // Let the SLEEP register server-side, confirm it is running, then abort.
        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(await runningSleepCount(observer) >= 1).toEqual(true)

        controller.abort()

        let caught
        try {
          await queryPromise
        } catch (error) {
          caught = error
        }

        expect(caught instanceof QueryAbortedError).toEqual(true)
        // Rejected on the deadline, not after the 30s SLEEP would have finished.
        expect(Date.now() - startedAt < 5000).toEqual(true)

        // KILL QUERY released the statement server-side (not merely abandoned the client).
        await new Promise((resolve) => setTimeout(resolve, 800))
        expect(await runningSleepCount(observer)).toEqual(0)

        // The pool recovered: a subsequent query succeeds on a fresh connection.
        expect(await mysql.query("SELECT 1 AS one")).toEqual([{one: 1}])
      } finally {
        await observer.close()
      }
    })
  })

  it("does not retry an aborted query", async () => {
    await withMysqlConnection(async (mysql) => {
      const controller = new AbortController()
      const queryPromise = mysql.query("SELECT SLEEP(30)", {signal: controller.signal})

      await new Promise((resolve) => setTimeout(resolve, 300))
      controller.abort()

      // A raw destroyed connection surfaces as a fatal PROTOCOL_CONNECTION_LOST,
      // which the retry loop would otherwise reconnect+retry — re-running the
      // cancelled query. QueryAbortedError must short-circuit that.
      let caught
      try {
        await queryPromise
      } catch (error) {
        caught = error
      }

      expect(caught instanceof QueryAbortedError).toEqual(true)
    })
  })
})
