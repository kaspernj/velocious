import BaseCommand from "../../base-command.js"
import Migrator from "../../../database/migrator.js"

export default class DbDrop extends BaseCommand {
  async execute() {
    const environment = this.configuration.getEnvironment()

    if (environment != "development" && environment != "test") {
      throw new Error(`This command should only be executed on development and test environments and not: ${environment}`)
    }

    const migrator = new Migrator({configuration: this.configuration})

    await this.configuration.ensureConnections(async () => {
      await migrator.dropDatabase()
    })
  }
}
