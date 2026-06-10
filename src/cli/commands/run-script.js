import BaseCommand from "../base-command.js"

/** CLI command for loading and running a user-provided script file. */
export default class RunScriptCommand extends BaseCommand {
  /**
 * Runs execute.
 * @returns {Promise<?>} - Resolves with the command result. */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsRunScript(this)
  }
}
