import BaseCommand from "../base-command.js"

export default class BeaconCommand extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsBeacon(this)
  }
}
