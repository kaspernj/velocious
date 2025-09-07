import BaseCommand from "../../base-command.js"
import FilesFinder from "../../../database/migrator/files-finder.js"
import Migrator from "../../../database/migrator.js"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = this.configuration.getDirectory()
    const migrationsPath = `${projectPath}/src/database/migrations`
    const filesFinder = new FilesFinder({path: migrationsPath})
    const files = await filesFinder.findFiles()

    this.migrator = new Migrator({configuration: this.configuration})

    await this.configuration.withConnections(async () => {
      await this.migrator.prepare()
      await this.migrator.migrateFiles(files, async (importPath) => await import(importPath))
    })
  }
}
