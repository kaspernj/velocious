import BaseCommand from "../base-command.js"

export default class VelociousCliCommandsTest extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsTest(this)
  }
}
