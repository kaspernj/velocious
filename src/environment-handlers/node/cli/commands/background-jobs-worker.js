import BaseCommand from "../../../../cli/base-command.js"
import BackgroundJobsWorker from "../../../../background-jobs/worker.js"

export default class BackgroundJobsWorkerCommand extends BaseCommand {
  async execute() {
    const worker = new BackgroundJobsWorker({configuration: this.getConfiguration()})
    await worker.start()

    console.log("Background jobs worker connected")

    await new Promise((resolve) => {
      const shutdown = async () => {
        await worker.stop()
        resolve(undefined)
      }

      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    })
  }
}
