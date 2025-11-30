import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import Migrator from "../../../database/migrator.js"

export default class DbReset extends BaseCommand {
  async execute() {
    const environment = this.getConfiguration().getEnvironment()

    if (environment != "development" && environment != "test") {
      throw new Error(`This command should only be executed on development and test environments and not: ${environment}`)
    }

    const migrations = await this.getEnvironmentHandler().findMigrations()
    const migrator = new Migrator({configuration: this.getConfiguration()})

    await this.getConfiguration().ensureConnections(async () => {
      await migrator.reset()
      await migrator.prepare()
      await migrator.migrateFiles(migrations, digg(this.getEnvironmentHandler(), "requireMigration"))
    })
  }
}
