import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import TableData from "../../../database/table-data/index.js"

export default class DbCreate extends BaseCommand{
  async execute() {
    this.databasePool = this.configuration.getDatabasePool()
    this.newConfiguration = Object.assign({}, this.databasePool.getConfiguration())

    if (this.args.testing) this.result = []

    // Use a database known to exist. Since we are creating the database, it shouldn't actually exist which would make connecting fail.
    this.newConfiguration.database = this.newConfiguration.useDatabase || "mysql"

    this.databaseConnection = await this.databasePool.spawnConnectionWithConfiguration(this.newConfiguration)
    await this.databaseConnection.connect()

    this.createDatabase()
    await this.createSchemaMigrationsTable()

    await this.databaseConnection.close()

    if (this.args.testing) return this.result
  }

  async createDatabase() {
    const databaseName = digg(this.databasePool.getConfiguration(), "database")
    const sql = this.databaseConnection.createDatabaseSql(databaseName, {ifNotExists: true})

    if (this.args.testing) {
      this.result.push({databaseName, sql})
    } else {
      await this.databaseConnection.query(sql)
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
