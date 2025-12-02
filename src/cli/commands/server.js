import BaseCommand from "../base-command.js"

export default class VelociousCliCommandsServer extends BaseCommand{
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsServer(this)
  }
}
