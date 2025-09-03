import {digg} from "diggerize"
import TableData from "./table-data/index.js"
import { table } from "node:console"

export default class VelociousDatabaseMigrator {
  constructor({configuration}) {
    this.configuration = configuration
  }

  async prepare() {
    await this.createMigrationsTable()
    await this.loadMigrationsVersions()
  }

  async createMigrationsTable() {
    await this.configuration.withConnections(async (dbs) => {
      for (const db of Object.values(dbs)) {
        if (await this.migrationsTableExist(db)) continue

        const schemaMigrationsTable = new TableData("schema_migrations", {ifNotExists: true})

        schemaMigrationsTable.string("version", {null: false, primaryKey: true})

        const createSchemaMigrationsTableSqls = db.createTableSql(schemaMigrationsTable)

        for (const createSchemaMigrationsTableSql of createSchemaMigrationsTableSqls) {
          await db.query(createSchemaMigrationsTableSql)
        }
      }
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
    this.migrationsVersions = {}

    await this.configuration.withConnections(async (dbs) => {
      for (const db of Object.values(dbs)) {
        const rows = await db.select("schema_migrations")

        for (const row of rows) {
          const version = digg(row, "version")

          this.migrationsVersions[version] = true
        }
      }
    })
  }

  async migrationsTableExist(db) {
    const tables = await db.getTables()
    const schemaTable = tables.find((table) => table.getName() == "schema_migrations")

    if (!schemaTable) return false

    return true
  }

  async runMigrationFileFromRequireContext(migration, requireContext) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()

    await this.configuration.withConnections(async (dbs) => {
      const MigrationClass = requireContext(migration.file).default
      const migrationInstance = new MigrationClass({
        configuration: this.configuration
      })

      if (migrationInstance.change) {
        await migrationInstance.change()
      } else if (migrationInstance.up) {
        await migrationInstance.up()
      } else {
        throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`)
      }

      for (const db of Object.values(dbs)) {
        await db.insert({tableName: "schema_migrations", data: {version: migration.date}})
      }
    })
  }

  async runMigrationFile(migration) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()

    await this.configuration.withConnections(async (dbs) => {
      const migrationImport = await import(migration.fullPath)
      const MigrationClass = migrationImport.default
      const migrationInstance = new MigrationClass({
        configuration: this.configuration
      })

      if (migrationInstance.change) {
        await migrationInstance.change()
      } else if (migrationInstance.up) {
        await migrationInstance.up()
      } else {
        throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`)
      }

      for (const db of Object.values(dbs)) {
        const dateString = migration.date
        const existingSchemaMigrations = await db.newQuery()
          .from("schema_migrations")
          .where({version: dateString})
          .results()

        if (existingSchemaMigrations.length == 0) {
          await db.insert({tableName: "schema_migrations", data: {version: dateString}})
        }
      }
    })
  }
}
