import Configuration from "../configuration.mjs"
import * as inflection from "inflection"

export default class VelociousDatabaseMigrateFromRequireContext {
  constructor(configuration) {
    this.configuration = configuration || Configuration.current()
  }

  async execute(requireContext) {
    const files = requireContext.keys()
      .map((file) => {
        const match = file.match(/^\.\/(\d{14})-(.+)\.mjs$/)

        if (!match) return null

        const date = parseInt(match[1])
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName)

        return {
          file,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    for (const migration of files) {
      await this.runMigrationFile(migration, requireContext)
    }
  }

  async runMigrationFile(migration, requireContext) {
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
}
