import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"

export default class DbBaseCommand extends BaseCommand {
  /** @type {import("../../../database/drivers/base.js").default | undefined} */
  databaseConnection

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
}
