import BaseCommand from "../../base-command.mjs"
import {digg} from "diggerize"
import fs from "node:fs/promises"
import inflection from "inflection"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = this.configuration.getDirectory()
    const migrationsPath = `${projectPath}/src/database/migrations`
    let files = await fs.readdir(migrationsPath)

    files = files
      .map((file) => {
        const match = file.match(/^(\d{14})-(.+)\.mjs$/)

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
      await this.runMigrationFile(migration)
    }
  }

  async executeRequireContext(requireContext) {
    const migrationFiles = requireContext.keys()

    files = migrationFiles
      .map((file) => {
        const match = file.match(/^(\d{14})-(.+)\.mjs$/)

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
      await this.runMigrationFileFromRequireContext(migration, requireContext)
    }
  }

  async runMigrationFileFromRequireContext(migration, requireContext) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()

    await this.configuration.getDatabasePool().withConnection(async () => {
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
    })
  }

  async runMigrationFile(migration) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()

    await this.configuration.getDatabasePool().withConnection(async () => {
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
    })
  }
}
