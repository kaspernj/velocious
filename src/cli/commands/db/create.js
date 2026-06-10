import DbBaseCommand from "./base-command.js"
import {digg} from "diggerize"
import {incorporate} from "incorporator"
import TableData from "../../../database/table-data/index.js"

export default class DbCreate extends DbBaseCommand{
  /**
   * Runs execute.
   * @returns {Promise<void | Array<object>>} - Resolves with SQL statements when running in dry mode.
   */
  async execute() {
    for (const databaseIdentifier of this.getConfiguration().getDatabaseIdentifiers()) {
      const databaseType = this.getConfiguration().getDatabaseType(databaseIdentifier)
      const databasePool = this.getConfiguration().getDatabasePool(databaseIdentifier)
      const newConfiguration = incorporate({}, databasePool.getConfiguration())

      if (this.args.testing) this.result = []

      // Use a database known to exist. Since we are creating the database, it shouldn't actually exist which would make connecting fail.
      newConfiguration.database = newConfiguration.useDatabase || "mysql"

      // Login can fail because given db name doesn't exist, which it might not because we are trying to create it right now.
      if (databaseType == "mssql" && newConfiguration.sqlConfig?.database) {
        delete newConfiguration.sqlConfig.database
      }

      await this.withDirectDatabaseConnection(newConfiguration, async () => {
        if (databaseType != "sqlite") {
          await this.createDatabase(databaseIdentifier)
        }

        await this.createSchemaMigrationsTable()
      })

      if (this.args.testing) return this.result
    }
  }

  /**
   * Runs create database.
   * @param {string} databaseIdentifier - Database identifier.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createDatabase(databaseIdentifier) {
    const databaseConfiguration = digg(this.getConfiguration().getDatabaseConfiguration(), databaseIdentifier)
    const databaseName = digg(databaseConfiguration, "database")
    const {databaseCharset, databaseCollation} = databaseConfiguration
    const sqls = this.getDatabaseConnection().createDatabaseSql(databaseName, {ifNotExists: true, databaseCharset, databaseCollation})
    await this.queryOrCollectSqls(sqls, (sql) => ({databaseName, sql}))
  }

  /**
   * Runs create schema migrations table.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createSchemaMigrationsTable() {
    const schemaMigrationsTable = new TableData("schema_migrations", {ifNotExists: true})

    schemaMigrationsTable.string("version", {null: false, primaryKey: true})

    const createSchemaMigrationsTableSqls = await this.getDatabaseConnection().createTableSql(schemaMigrationsTable)
    await this.queryOrCollectSqls(createSchemaMigrationsTableSqls, (createSchemaMigrationsTableSql) => ({createSchemaMigrationsTableSql}))
  }
}
