import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"

export default class DbBaseCommand extends BaseCommand {
  /** @type {import("../../../database/drivers/base.js").default | undefined} */
  databaseConnection

  /** @type {Array<object> | undefined} */
  result

  /**
   * @param {object} driverConfiguration - Driver configuration.
   * @param {() => Promise<void>} callback - Callback to run while the connection is open.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async withDirectDatabaseConnection(driverConfiguration, callback) {
    const DriverClass = digg(driverConfiguration, "driver")
    const databaseConnection = new DriverClass(driverConfiguration, this.getConfiguration())
    this.databaseConnection = databaseConnection

    try {
      await databaseConnection.connect()
      await callback()
    } finally {
      await databaseConnection.close()
    }
  }

  /**
   * @returns {import("../../../database/drivers/base.js").default} - Active database connection.
   */
  getDatabaseConnection() {
    if (!this.databaseConnection) throw new Error("Database connection was not initialized")

    return this.databaseConnection
  }

  /**
   * @param {string[]} sqls - SQL statements.
   * @param {(sql: string) => object} resultEntryForSql - Test result entry builder.
   * @returns {Promise<void>} - Resolves when SQLs have been collected or executed.
   */
  async queryOrCollectSqls(sqls, resultEntryForSql) {
    if (this.args.testing) {
      this.collectSqlResults(sqls, resultEntryForSql)
    } else {
      await this.querySqls(sqls)
    }
  }

  /**
   * @param {string[]} sqls - SQL statements.
   * @param {(sql: string) => object} resultEntryForSql - Test result entry builder.
   * @returns {void}
   */
  collectSqlResults(sqls, resultEntryForSql) {
    if (!this.result) throw new Error("Expected test result collection to be initialized")

    for (const sql of sqls) {
      this.result.push(resultEntryForSql(sql))
    }
  }

  /**
   * @param {string[]} sqls - SQL statements.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async querySqls(sqls) {
    for (const sql of sqls) {
      await this.getDatabaseConnection().query(sql)
    }
  }
}
