// @ts-check

import BaseCommand from "../base-command.js"
import BackgroundJobsMain from "../../background-jobs/main.js"

export default class BackgroundJobsMainCommand extends BaseCommand {
  async execute() {
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
