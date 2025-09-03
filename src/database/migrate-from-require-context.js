import Configuration from "../configuration.js"
import * as inflection from "inflection"
import Migrator from "./migrator.js"

export default class VelociousDatabaseMigrateFromRequireContext {
  constructor(configuration) {
    this.configuration = configuration || Configuration.current()
    this.migrator = new Migrator({configuration: this.configuration})
  }

  async execute(requireContext) {
    await this.migrator.prepare()

    const files = requireContext.keys()
      .map((file) => {
        // "13,14" because somes "require-context"-npm-module deletes first character!?
        const match = file.match(/(\d{13,14})-(.+)\.js$/)

        if (!match) return null

        // Fix require-context-npm-module deletes first character
        let fileName = file
        let dateNumber = match[1]

        if (dateNumber.length == 13) {
          dateNumber = `2${dateNumber}`
          fileName = `2${fileName}`
        }

        // Parse regex
        const date = parseInt(dateNumber)
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

        return {
          file: fileName,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    for (const migration of files) {
      if (!this.migrator.hasRunMigrationVersion(migration.date)) {
        await this.runMigrationFile(migration, requireContext)
      }
    }
  }

  async runMigrationFile(migration, requireContext) {
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
}
