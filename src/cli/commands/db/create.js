import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import {incorporate} from "incorporator"
import TableData from "../../../database/table-data/index.js"

export default class DbCreate extends BaseCommand{
  async execute() {
    for (const databaseIdentifier of this.configuration.getDatabaseIdentifiers()) {
      const databaseType = this.configuration.getDatabaseType(databaseIdentifier)
      const databasePool = this.configuration.getDatabasePool(databaseIdentifier)
      const newConfiguration = incorporate({}, databasePool.getConfiguration())
      const DriverClass = digg(newConfiguration, "driver")

      if (this.args.testing) this.result = []

      // Use a database known to exist. Since we are creating the database, it shouldn't actually exist which would make connecting fail.
      newConfiguration.database = newConfiguration.useDatabase || "mysql"

      // Login can fail because given db name doesn't exist, which it might not because we are trying to create it right now.
      if (databaseType == "mssql" && newConfiguration.sqlConfig?.database) {
        delete newConfiguration.sqlConfig.database
      }

      this.databaseConnection = new DriverClass(newConfiguration, this.configuration)

      await this.databaseConnection.connect()

      try {
        if (databaseType != "sqlite") {
          await this.createDatabase(databaseIdentifier)
        }

        await this.createSchemaMigrationsTable()
      } finally {
        if (databaseType != "mssql") {
          await this.databaseConnection.close()
        }
      }

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
