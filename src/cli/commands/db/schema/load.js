import BaseCommand from "../../../base-command.js"

/** CLI command for loading DB structure SQL files. */
export default class DbSchemaLoad extends BaseCommand {
  /**
 * Runs execute.
 * @returns {Promise<?>} - Resolves with the command result. */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsDbSchemaLoad(this)
  }
}
