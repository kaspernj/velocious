import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"

/**
 * SignalProcess type.
 * @typedef {object} SignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess} once - Register one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess} removeListener - Remove one signal listener.
 */

/**
 * SignalShutdownApplication type.
 * @typedef {object} SignalShutdownApplication
 * @property {() => Promise<void>} stop - Stop the application gracefully.
 * @property {() => Promise<void>} wait - Wait until the application closes.
 */

/**
 * Waits for the HTTP application to close, stopping it gracefully when the
 * process receives SIGINT or SIGTERM.
 * @param {object} args - Wait options.
 * @param {SignalShutdownApplication} args.application - Running application.
 * @param {SignalProcess} [args.processObject] - Process-like signal emitter.
 * @returns {Promise<void>} - Resolves when the application has stopped.
 */
export function waitForApplicationWithSignalShutdown({application, processObject = process}) {
  return new Promise((resolve, reject) => {
    let finished = false
    let stopping = false

    /**
 * Cleanup.
 * @returns {void} - Remove installed signal handlers. */
    const cleanup = () => {
      processObject.removeListener("SIGINT", onSignal)
      processObject.removeListener("SIGTERM", onSignal)
    }

    /**
     * Completes the wait promise once.
     * @param {?} [error] - Optional rejection reason.
     * @returns {void}
     */
    const finish = (error) => {
      if (finished) return

      finished = true
      cleanup()

      if (error) {
        reject(error)
      } else {
        resolve(undefined)
      }
    }

    /**
 * Stop application.
 * @returns {Promise<void>} - Stops the application once. */
    const stopApplication = async () => {
      if (stopping || finished) return

      stopping = true

      try {
        await application.stop()
      } catch (error) {
        finish(error)
      }
    }

    /**
 * On signal.
 * @returns {void} - Handles one shutdown signal. */
    const onSignal = () => {
      void stopApplication()
    }

    processObject.once("SIGINT", onSignal)
    processObject.once("SIGTERM", onSignal)

    application.wait().then(() => finish()).catch((error) => finish(error))
  })
}

/**
 * Runs first configured value.
 * @template T
 * @param {...(T | undefined)} values - Candidate values in priority order.
 * @returns {T | undefined} - First configured value.
 */
function firstConfiguredValue(...values) {
  return values.find((value) => value !== undefined)
}

/**
 * Runs http server workers from arg.
 * @param {string | number | boolean | undefined} workersArg - Worker count argument.
 * @returns {number | undefined} - Normalized worker count.
 */
function httpServerWorkersFromArg(workersArg) {
  if (workersArg === undefined) return undefined
  if (typeof workersArg === "boolean") throw new Error("--workers must be a positive integer")

  const workers = Number(workersArg)

  if (!Number.isInteger(workers) || workers < 1) throw new Error("--workers must be a positive integer")

  return workers
}

/**
 * Documents this API.
 * @param {Record<string, string | number | boolean | undefined>} parsedProcessArgs - Parsed CLI args.
 * @param {import("../../../../configuration-types.js").HttpServerConfiguration} [defaults] - Default HTTP server config.
 * @returns {{host: string, port: number, workers?: number}} - HTTP server config.
 */
export function httpServerConfigFromParsedArgs(parsedProcessArgs = {}, defaults = {}) {
  const host = String(firstConfiguredValue(parsedProcessArgs.h, parsedProcessArgs.host, defaults.host, "127.0.0.1"))
  const port = Number(firstConfiguredValue(parsedProcessArgs.p, parsedProcessArgs.port, defaults.port, 3006))
  const workers = httpServerWorkersFromArg(firstConfiguredValue(parsedProcessArgs.workers, defaults.workers))

  if (workers === undefined) return {host, port}
  return {host, port, workers}
}

export default class VelociousCliCommandsServer extends BaseCommand{
  /**
 * Runs execute.
 * @returns {Promise<void>} - Starts the HTTP server and waits until it stops. */
  async execute() {
    const parsedProcessArgs = this.args?.parsedProcessArgs || {}
    const configuration = this.getConfiguration()
    const httpServer = httpServerConfigFromParsedArgs(parsedProcessArgs, configuration.httpServer)
    const application = new Application({
      configuration,
      httpServer,
      type: "server"
    })
    const environment = configuration.getEnvironment()

    await application.initialize()
    await application.startHttpServer()
    console.log(`Started Velocious HTTP server on ${httpServer.host}:${httpServer.port} in ${environment} environment`)
    await waitForApplicationWithSignalShutdown({application})
  }
}
