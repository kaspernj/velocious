import BaseCommand from "../../base-command.js"

export default class DbGenerateMigration extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsMigrationGenerate(this)
  }
}
