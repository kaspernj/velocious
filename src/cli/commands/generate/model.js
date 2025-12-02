import BaseCommand from "../../base-command.js"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    await this.getConfiguration().getEnvironmentHandler().cliCommandsModelGenerate(this)
  }
}
