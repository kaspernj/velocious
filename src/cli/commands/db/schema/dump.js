import BaseCommand from "../../../base-command.js"

/** CLI command for dumping DB structure SQL files. */
export default class DbSchemaDump extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsDbSchemaDump(this)
  }
}
