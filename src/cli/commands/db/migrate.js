import BaseCommand from "../../base-command.js"
import fs from "node:fs/promises"
import * as inflection from "inflection"
import Migrator from "../../../database/migrator.js"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = this.configuration.getDirectory()
    const migrationsPath = `${projectPath}/src/database/migrations`
    let files = await fs.readdir(migrationsPath)

    this.migrator = new Migrator({configuration: this.configuration})

    await this.migrator.prepare()

    files = files
      .map((file) => {
        const match = file.match(/^(\d{14})-(.+)\.js$/)

        if (!match) return null

        const date = parseInt(match[1])
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

        return {
          file,
          fullPath: `${migrationsPath}/${file}`,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    for (const migration of files) {
      if (!this.migrator.hasRunMigrationVersion(migration.date)) {
        await this.runMigrationFile(migration)
      }
    }
  }

  async executeRequireContext(requireContext) {
    const migrationFiles = requireContext.keys()

    files = migrationFiles
      .map((file) => {
        const match = file.match(/^(\d{14})-(.+)\.js$/)

        if (!match) return null

        const date = parseInt(match[1])
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName)

        return {
          file,
          fullPath: `${migrationsPath}/${file}`,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    for (const migration of files) {
      if (!this.migrator.hasRunMigrationVersion(migration.date)) {
        await this.runMigrationFileFromRequireContext(migration, requireContext)
      }
    }
  }

  async runMigrationFileFromRequireContext(migration, requireContext) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()

    await this.configuration.getDatabasePool().withConnection(async (db) => {
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

      await db.insert({tableName: "schema_migrations", data: {version: migration.date}})
    })
  }

  async runMigrationFile(migration) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()

    await this.configuration.getDatabasePool().withConnection(async (db) => {
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

      await db.insert({tableName: "schema_migrations", data: {version: migration.date}})
    })
  }
}
