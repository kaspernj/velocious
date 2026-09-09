import BaseCommand from "../../base-command.js"

export default class BackgroundJobsActivateCommand extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsBackgroundJobsActivate(this)
  }
}
