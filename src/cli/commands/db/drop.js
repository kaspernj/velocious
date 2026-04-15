import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import {incorporate} from "incorporator"

export default class DbDrop extends BaseCommand {
  /** @type {Array<{databaseName: string, sql: string}> | undefined} */
  result

  /**
   * @returns {Promise<void | Array<{databaseName: string, sql: string}>>} - Resolves with SQL statements when running in dry mode.
   */
  async execute() {
    const environment = this.getConfiguration().getEnvironment()

    if (environment != "development" && environment != "test") {
      throw new Error(`This command should only be executed on development and test environments and not: ${environment}`)
    }

    for (const databaseIdentifier of this.getConfiguration().getDatabaseIdentifiers()) {
      const databaseType = this.getConfiguration().getDatabaseType(databaseIdentifier)

      if (this.args.testing) this.result = []

      if (databaseType != "sqlite") {
        const databasePool = this.getConfiguration().getDatabasePool(databaseIdentifier)
        const newConfiguration = incorporate({}, databasePool.getConfiguration())
        const DriverClass = digg(newConfiguration, "driver")

        // Connect to a known-existing database since the target may be the only
        // one configured and will be dropped.
        newConfiguration.database = newConfiguration.useDatabase || "mysql"

        if (databaseType == "mssql" && newConfiguration.sqlConfig?.database) {
          delete newConfiguration.sqlConfig.database
        }

        this.databaseConnection = new DriverClass(newConfiguration, this.getConfiguration())

        await this.databaseConnection.connect()

        try {
          await this.dropDatabase(databaseIdentifier)
        } finally {
          if (databaseType != "mssql") {
            await this.databaseConnection.close()
          }
        }
      }

      if (this.args.testing) return this.result
    }
  }

  /**
   * @param {string} databaseIdentifier - Database identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async dropDatabase(databaseIdentifier) {
    const databaseName = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier, "database")
    const sqls = this.databaseConnection.dropDatabaseSql(databaseName, {ifExists: true})

    if (this.args.testing && !this.result) {
      throw new Error("Expected test result collection to be initialized")
    }

    const result = /** @type {Array<{databaseName: string, sql: string}>} */ (this.result)

    for (const sql of sqls) {
      if (this.args.testing) {
        result.push({databaseName, sql})
      } else {
        await this.databaseConnection.query(sql)
      }
    }
  }
}
