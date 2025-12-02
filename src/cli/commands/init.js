import BaseCommand from "../base-command.js"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsInit(this)
  }
}

const dontLoadConfiguration = true

export {dontLoadConfiguration}
