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
        const targetDatabaseName = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier, "database")

        // Connect to a known-existing system database: the target is about to
        // be dropped (so we can't be connected to it), Postgres rejects
        // DROP DATABASE while connected to it, and configured `useDatabase`
        // may happen to equal the target — in that case fall through to the
        // driver's system default.
        const configuredFallback = newConfiguration.useDatabase
        const useConfiguredFallback = typeof configuredFallback == "string" && configuredFallback.length > 0 && configuredFallback != targetDatabaseName

        newConfiguration.database = useConfiguredFallback
          ? configuredFallback
          : this.systemFallbackDatabaseName(databaseType)

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
   * @param {string} databaseType - Database type.
   * @returns {string} - System/maintenance database name for that driver.
   */
  systemFallbackDatabaseName(databaseType) {
    if (databaseType == "pgsql") return "postgres"
    if (databaseType == "mssql") return "master"

    return "mysql"
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
