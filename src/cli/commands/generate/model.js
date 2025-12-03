import BaseCommand from "../../base-command.js"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsGenerateModel(this)
  }
}
