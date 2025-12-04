import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import Migrator from "../../../database/migrator.js"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const migrations = await this.getEnvironmentHandler().findMigrations()
    const migrator = new Migrator({configuration: this.getConfiguration()})

    console.log(`Running ${migrations.length} migrations`)

    await this.getConfiguration().ensureConnections(async () => {
      await migrator.prepare()
      await migrator.migrateFiles(migrations, digg(this.getEnvironmentHandler(), "requireMigration"))
    })
  }
}
