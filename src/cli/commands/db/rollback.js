import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import Migrator from "../../../database/migrator.js"

export default class DbRollback extends BaseCommand {
  async execute() {
    const migrations = await this.getEnvironmentHandler().findMigrations()
    const migrator = new Migrator({configuration: this.getConfiguration()})

    await this.getConfiguration().ensureConnections(async () => {
      await migrator.prepare()
      await migrator.rollback(migrations, digg(this.getEnvironmentHandler(), "requireMigration"))
    })
  }
}
