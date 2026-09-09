import BaseCommand from "../base-command.js"

export default class BackgroundJobsRunnerCommand extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsBackgroundJobsRunner(this)
  }
}
