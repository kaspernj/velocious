import BaseCommand from "../../base-command.js"

/** CLI command for loading and running src/db/seed.js. */
export default class DbSeed extends BaseCommand {
  /** @returns {Promise<unknown>} - Resolves with the command result. */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsDbSeed(this)
  }
}
