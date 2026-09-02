import BaseCommand from "../../base-command.js"
import {digg} from "diggerize"
import Migrator from "../../../database/migrator.js"
import migrationExecutionPhaseArgument from "../../migration-execution-phase-argument.js"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const executionPhase = migrationExecutionPhaseArgument(this.processArgs || [])
    const migrations = await this.getEnvironmentHandler().findMigrations()
    const migrator = new Migrator({configuration: this.getConfiguration(), executionPhase})

    console.log(`Running ${migrations.length} migrations`)

    await this.getConfiguration().ensureConnections({name: "DB migrate"}, async () => {
      await migrator.prepare()
      await migrator.migrateFiles(migrations, digg(this.getEnvironmentHandler(), "requireMigration"))
    })
  }
}
