import BaseCommand from "../base-command.js"

export default class VelociousCliCommandsMcp extends BaseCommand{
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsMcp(this)
  }
}
