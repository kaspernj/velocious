import BaseCommand from "../../base-command.js"
import fs from "node:fs/promises"
import * as inflection from "inflection"
import Migrator from "../../../database/migrator.js"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = this.configuration.getDirectory()
    const migrationsPath = `${projectPath}/src/database/migrations`
    let files = await fs.readdir(migrationsPath)

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

    this.migrator = new Migrator({configuration: this.configuration})

    await this.configuration.withConnections(async () => {
      await this.migrator.prepare()
      await this.migrator.migrateFiles(files)
    })
  }
}
