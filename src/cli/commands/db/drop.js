import BaseCommand from "../../base-command.js"
import FilesFinder from "../../../database/migrator/files-finder.js"
import Migrator from "../../../database/migrator.js"

export default class DbDrop extends BaseCommand {
  async execute() {
    const environment = this.configuration.getEnvironment()

    if (environment != "development" && environment != "test") {
      throw new Error(`This command should only be executed on development and test environments and not: ${environment}`)
    }

    this.migrator = new Migrator({configuration: this.configuration})

    await this.configuration.withConnections(async () => {
      await this.migrator.dropDatabase()
    })
  }
}
