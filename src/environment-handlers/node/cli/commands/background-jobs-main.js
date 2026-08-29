import BaseCommand from "../../../../cli/base-command.js"
import BackgroundJobsMain from "../../../../background-jobs/main.js"
import commandArguments from "../../../../cli/command-arguments.js"

/**
 * BackgroundJobsMainSignalProcess type.
 * @typedef {object} BackgroundJobsMainSignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess} once - Registers one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess} removeListener - Removes one signal listener.
 */

/**
 * BackgroundJobsMainShutdownOwner type.
 * @typedef {object} BackgroundJobsMainShutdownOwner
 * @property {() => Promise<void>} stop - Stops the main gracefully.
 * @property {() => Promise<void>} waitUntilStopped - Waits until the main has stopped.
 */

/**
 * Owns process shutdown signals before publishing the main's readiness boundary.
 * @param {object} args - Shutdown ownership options.
 * @param {BackgroundJobsMainShutdownOwner} args.main - Running background-jobs main.
 * @param {() => void} args.onReady - Publishes readiness after signal ownership exists.
 * @param {BackgroundJobsMainSignalProcess} [args.processObject] - Process-like signal emitter.
 * @returns {Promise<void>} - Resolves when the main stops.
 */
export async function waitForBackgroundJobsMainShutdown({main, onReady, processObject = process}) {
  /**
   * Resolves the first process shutdown signal.
   * @type {() => void}
   */
  let resolveSignal = () => {}
  const signal = new Promise((resolve) => { resolveSignal = () => resolve(undefined) })

  /**
   * Resolves the shared shutdown signal once.
   * @returns {void} - Nothing.
   */
  const onSignal = () => resolveSignal()

  processObject.once("SIGINT", onSignal)
  processObject.once("SIGTERM", onSignal)
  const stopped = main.waitUntilStopped()

  try {
    onReady()
    await Promise.race([stopped, signal.then(async () => await main.stop())])
  } finally {
    processObject.removeListener("SIGINT", onSignal)
    processObject.removeListener("SIGTERM", onSignal)
  }
}

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

    await waitForBackgroundJobsMainShutdown({
      main,
      onReady: () => console.log(`Background jobs main listening on ${main.host}:${main.getPort()}`)
    })
  }
}
