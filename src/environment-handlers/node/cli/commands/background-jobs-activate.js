// @ts-check

import BaseCommand from "../../../../cli/base-command.js"
import commandArguments from "../../../../cli/command-arguments.js"
import BackgroundJobsLifecycleClient from "../../../../background-jobs/lifecycle-client.js"

export default class BackgroundJobsActivateCommand extends BaseCommand {
  async execute() {
    const args = commandArguments({definition: {valueOptions: ["--generation", "--socket", "--timeout-ms"]}, processArgs: this.processArgs || []})
    const client = new BackgroundJobsLifecycleClient({
      configuration: this.getConfiguration(),
      generationId: typeof args.generation === "string" ? args.generation : undefined,
      requestTimeoutMs: typeof args["timeout-ms"] === "string" ? Number(args["timeout-ms"]) : undefined,
      socketPath: typeof args.socket === "string" ? args.socket : undefined
    })

    return await client.activate()
  }
}
