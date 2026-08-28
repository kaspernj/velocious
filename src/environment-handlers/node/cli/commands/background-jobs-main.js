import BaseCommand from "../../../../cli/base-command.js"
import BackgroundJobsMain from "../../../../background-jobs/main.js"
import commandArguments from "../../../../cli/command-arguments.js"

export default class BackgroundJobsMainCommand extends BaseCommand {
  async execute() {
    // Identify this process in `ps`/`top` instead of a generic "node" entry.
    process.title = "velocious background-jobs-main"

    const args = commandArguments({
      definition: {valueOptions: ["--generation", "--initial-generation-state", "--lifecycle-socket"]},
      processArgs: this.processArgs || []
    })
    const initialGenerationState = typeof args["initial-generation-state"] === "string"
      ? /** @type {import("../../../../background-jobs/types.js").BackgroundJobsGenerationInitialState} */ (args["initial-generation-state"])
      : undefined
    const main = new BackgroundJobsMain({
      configuration: this.getConfiguration(),
      generationId: typeof args.generation === "string" ? args.generation : undefined,
      initialGenerationState,
      lifecycleSocketPath: typeof args["lifecycle-socket"] === "string" ? args["lifecycle-socket"] : undefined
    })
    await main.start()

    console.log(`Background jobs main listening on ${main.host}:${main.getPort()}`)

    await new Promise((resolve, reject) => {
      const shutdown = async () => {
        try {
          await main.stop()
          resolve(undefined)
        } catch (error) {
          reject(error)
        }
      }

      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
      void main.waitUntilStopped().then(() => resolve(undefined), reject)
    })
  }
}
