import BaseCommand from "../../base-command.js"

export default class DbDestroyMigration extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsMigrationDestroy(this)
  }
}
