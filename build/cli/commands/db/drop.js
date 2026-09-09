import DbBaseCommand from "./base-command.js"
import {digg} from "diggerize"
import {incorporate} from "incorporator"

export default class DbDrop extends DbBaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<void | Array<object>>} - Resolves with SQL statements when running in dry mode.
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
        const targetDatabaseName = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier, "database")

        // Connect to a known-existing system database: the target is about to
        // be dropped (so we can't be connected to it), Postgres rejects
        // DROP DATABASE while connected to it, and configured `useDatabase`
        // may happen to equal the target — in that case fall through to the
        // driver's system default.
        const configuredFallback = newConfiguration.useDatabase
        const useConfiguredFallback = typeof configuredFallback == "string" && configuredFallback.length > 0 && configuredFallback != targetDatabaseName

        if (useConfiguredFallback) {
          newConfiguration.database = configuredFallback
        } else if (databaseType == "mysql") {
          delete newConfiguration.database
        } else {
          newConfiguration.database = this.systemFallbackDatabaseName(databaseType)
        }

        if (databaseType == "mssql" && newConfiguration.sqlConfig?.database) {
          delete newConfiguration.sqlConfig.database
        }

        await this.withDirectDatabaseConnection(newConfiguration, async () => {
          await this.dropDatabase(databaseIdentifier)
        })
      }

      if (this.args.testing) return this.result
    }
  }

  /**
   * Runs system fallback database name.
   * @param {string} databaseType - Database type.
   * @returns {string} - System/maintenance database name for that driver.
   */
  systemFallbackDatabaseName(databaseType) {
    if (databaseType == "pgsql") return "postgres"
    if (databaseType == "mssql") return "master"

    return "mysql"
  }

  /**
   * Runs drop database.
   * @param {string} databaseIdentifier - Database identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async dropDatabase(databaseIdentifier) {
    const databaseName = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier, "database")
    const sqls = this.getDatabaseConnection().dropDatabaseSql(databaseName, {ifExists: true})

    await this.queryOrCollectSqls(sqls, (sql) => ({databaseName, sql}))
  }
}
