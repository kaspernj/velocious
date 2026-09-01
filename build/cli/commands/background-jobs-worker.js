import BaseCommand from "../base-command.js"

export default class BackgroundJobsWorkerCommand extends BaseCommand {
  async execute() {
    return await this.getConfiguration().getEnvironmentHandler().cliCommandsBackgroundJobsWorker(this)
  }
}
