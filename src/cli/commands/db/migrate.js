import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import Migrator from "../../../database/migrator.js"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const migrationsFinder = digg(this, "args", "migrationsFinder")
    const migrationsRequire = digg(this, "args", "migrationsRequire")

    if (!migrationsFinder) throw new Error("migrationsFinder is required")
    if (!migrationsRequire) throw new Error("migrationsRequire is required")

    const migrations = await migrationsFinder({configuration: this.getConfiguration()})
    const migrator = new Migrator({configuration: this.getConfiguration()})

    await this.configuration.ensureConnections(async () => {
      await migrator.prepare()
      await migrator.migrateFiles(migrations, migrationsRequire)
    })
  }
}
