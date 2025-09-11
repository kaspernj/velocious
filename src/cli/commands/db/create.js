import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import {incorporate} from "incorporator"
import TableData from "../../../database/table-data/index.js"

export default class DbCreate extends BaseCommand{
  async execute() {
    for (const databaseIdentifier of this.configuration.getDatabaseIdentifiers()) {
      const databaseType = this.configuration.getDatabaseType(databaseIdentifier)

      this.databasePool = this.configuration.getDatabasePool(databaseIdentifier)
      this.newConfiguration = incorporate({}, this.databasePool.getConfiguration())

      if (this.args.testing) this.result = []

      // Use a database known to exist. Since we are creating the database, it shouldn't actually exist which would make connecting fail.
      this.newConfiguration.database = this.newConfiguration.useDatabase || "mysql"

      // Login can fail because given db name doesn't exist, which it might not because we are trying to create it right now.
      if (databaseType == "mssql" && this.newConfiguration.sqlConfig?.database) {
        delete this.newConfiguration.sqlConfig.database
      }

      this.databaseConnection = await this.databasePool.spawnConnectionWithConfiguration(this.newConfiguration)
      await this.databaseConnection.connect()

      if (databaseType != "sqlite") {
        await this.createDatabase(databaseIdentifier)
      }

      await this.createSchemaMigrationsTable()
      await this.databaseConnection.close()

      if (this.args.testing) return this.result
    }
  }

  async createDatabase(databaseIdentifier) {
    const databaseName = digg(this.configuration.getDatabaseConfiguration(), databaseIdentifier, "database")
    const sqls = this.databaseConnection.createDatabaseSql(databaseName, {ifNotExists: true})

    for (const sql of sqls) {
      if (this.args.testing) {
        this.result.push({databaseName, sql})
      } else {
        await this.databaseConnection.query(sql)
      }
    }
  }

  async createSchemaMigrationsTable() {
    const schemaMigrationsTable = new TableData("schema_migrations", {ifNotExists: true})

    schemaMigrationsTable.string("version", {null: false, primaryKey: true})

    const createSchemaMigrationsTableSqls = this.databaseConnection.createTableSql(schemaMigrationsTable)

    for (const createSchemaMigrationsTableSql of createSchemaMigrationsTableSqls) {
      if (this.args.testing) {
        this.result.push({createSchemaMigrationsTableSql})
      } else {
        await this.databaseConnection.query(createSchemaMigrationsTableSql)
      }
    }
  }
}
