import BaseCommand from "../base-command.js"

export default class VelociousCliCommandsRoutes extends BaseCommand{
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsRoutes(this)
  }
}
