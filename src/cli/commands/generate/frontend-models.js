import BaseCommand from "../../base-command.js"

/** Frontend model generator command wrapper. */
export default class DbGenerateFrontendModels extends BaseCommand {
  /** @returns {Promise<unknown>} - Command execution result. */
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsGenerateFrontendModels(this)
  }
}
