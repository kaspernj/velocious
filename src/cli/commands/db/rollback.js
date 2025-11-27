import BaseCommand from "../../base-command.js"
import Migrator from "../../../database/migrator.js"

export default class DbRollback extends BaseCommand {
  async execute() {
    const migrationsFinder = digg(this, "args", "migrationsFinder")
    const migrationsRequire = digg(this, "args", "migrationsRequire")

    if (!migrationsFinder) throw new Error("migrationsFinder is required")
    if (!migrationsRequire) throw new Error("migrationsRequire is required")

    const migrations = await migrationsFinder({configuration: this.getConfiguration()})

    const migrator = new Migrator({configuration: this.configuration})

    await this.getConfiguration().ensureConnections(async () => {
      await migrator.prepare()
      await migrator.rollback(migrations, migrationsRequire)
    })
  }
}
