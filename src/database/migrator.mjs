import {digg} from "diggerize"
import TableData from "./table-data/index"

export default class VelociousDatabaseMigrator {
  constructor({configuration}) {
    this.configuration = configuration
  }

  async prepare() {
    const exists = await this.migrationsTableExist()

    if (!exists) await this.createMigrationsTable()

    await this.loadMigrationsVersions()
  }

  async createMigrationsTable() {
    const schemaMigrationsTable = new TableData("schema_migrations", {ifNotExists: true})

    schemaMigrationsTable.string("version", {null: false, primaryKey: true})

    await this.configuration.getDatabasePool().withConnection(async (db) => {
      const createSchemaMigrationsTableSql = db.createTableSql(schemaMigrationsTable)

      await db.query(createSchemaMigrationsTableSql)
    })
  }

  hasRunMigrationVersion(version) {
    if (!this.migrationsVersions) {
      throw new Error("Migrations versions hasn't been loaded yet")
    }

    if (version in this.migrationsVersions) {
      return true
    }

    return false
  }

  async loadMigrationsVersions() {
    const db = this.configuration.getDatabasePool()

    this.migrationsVersions = {}

    await db.withConnection(async () => {
      const rows = await db.select("schema_migrations")

      for (const row of rows) {
        const version = digg(row, "version")

        this.migrationsVersions[version] = true
      }
    })
  }

  async migrationsTableExist() {
    let exists = false

    await this.configuration.getDatabasePool().withConnection(async (db) => {
      const tables = await db.getTables()

      for (const table of tables) {
        if (table.getName() == "schema_migrations") {
          exists = true
          break
        }
      }
    })

    return exists
  }
}
