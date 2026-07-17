import BaseCommand from "../../../../cli/base-command.js"
import BackgroundJobsMain from "../../../../background-jobs/main.js"

export default class BackgroundJobsMainCommand extends BaseCommand {
  async execute() {
    // Identify this process in `ps`/`top` instead of a generic "node" entry.
    process.title = "velocious background-jobs-main"

    const main = new BackgroundJobsMain({configuration: this.getConfiguration()})
    await main.start()

    console.log(`Background jobs main listening on ${main.host}:${main.getPort()}`)

    await new Promise((resolve) => {
      const shutdown = async () => {
        await main.stop()
        resolve(undefined)
      }

      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    })
  }
}
