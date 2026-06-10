import BaseCommand from "../base-command.js"

/** Velocious console command. */
export default class VelociousCliCommandsConsole extends BaseCommand{
  /**
 * Runs execute.
 * @returns {Promise<?>} - Resolves with the command result. */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsConsole(this)
  }
}
