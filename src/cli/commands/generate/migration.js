import BaseCommand from "../../base-command.js"

export default class DbGenerateMigration extends BaseCommand {
  async execute() {
    await this.getConfiguration().getEnvironmentHandler().cliCommandsMigrationGenerate(this)
  }
}
