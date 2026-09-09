import BaseCommand from "../../base-command.js"

export default class DbGenerateBaseModels extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsGenerateBaseModels(this)
  }
}
