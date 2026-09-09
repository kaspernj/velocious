import BaseCommand from "../base-command.js"

export default class BackgroundJobsMainCommand extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsBackgroundJobsMain(this)
  }
}
