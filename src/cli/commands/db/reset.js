import BaseCommand from "../../base-command.js"
import FilesFinder from "../../../database/migrator/files-finder.js"
import Migrator from "../../../database/migrator.js"

export default class DbReset extends BaseCommand {
  async execute() {
    const environment = this.configuration.getEnvironment()

    if (environment != "development" && environment != "test") {
      throw new Error(`This command should only be executed on development and test environments and not: ${environment}`)
    }

    const projectPath = this.configuration.getDirectory()
    const migrationsPath = `${projectPath}/src/database/migrations`
    const filesFinder = new FilesFinder({path: migrationsPath})
    const files = await filesFinder.findFiles()

    this.migrator = new Migrator({configuration: this.configuration})

    await this.configuration.ensureConnections(async () => {
      await this.migrator.reset()
      await this.migrator.prepare()
      await this.migrator.migrateFiles(files, async (importPath) => await import(importPath))
    })
  }
}
