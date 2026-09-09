import BaseCommand from "../../base-command.js"

export default class BackgroundJobsRetireCommand extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsBackgroundJobsRetire(this)
  }
}
