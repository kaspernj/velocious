import BaseCommand from "../../../../cli/base-command.js"
import BackgroundJobsWorker from "../../../../background-jobs/worker.js"
import commandArguments from "../../../../cli/command-arguments.js"

/**
 * @typedef {object} BackgroundJobsWorkerSignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess} once - Registers one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess} removeListener - Removes one signal listener.
 */

/**
 * Owns process signals before publishing worker readiness.
 * @param {object} args - Shutdown ownership.
 * @param {() => void} args.onReady - Publishes readiness after listeners exist.
 * @param {BackgroundJobsWorkerSignalProcess} [args.processObject] - Signal emitter.
 * @param {number} [args.timeoutMs] - Optional worker drain timeout.
 * @param {{start: () => Promise<void>, stop: (args?: {timeoutMs?: number}) => Promise<void>, waitUntilStopped: () => Promise<void>}} args.worker - Worker lifecycle owner.
 * @returns {Promise<void>} - Resolves once the worker stops.
 */
export async function waitForBackgroundJobsWorkerShutdown({onReady, processObject = process, timeoutMs, worker}) {
  /**
   * Resolves the signal wait.
   * @type {() => void}
   */
  let resolveSignal = () => {}
  const signal = new Promise((resolve) => { resolveSignal = () => resolve(undefined) })
  const onSignal = () => resolveSignal()

  processObject.once("SIGINT", onSignal)
  processObject.once("SIGTERM", onSignal)

  try {
    await worker.start()
    onReady()
    const stopped = worker.waitUntilStopped()
    const shutdownCause = await Promise.race([
      signal.then(() => "signal"),
      stopped.then(() => "stopped")
    ])

    if (shutdownCause === "signal") await worker.stop({timeoutMs})
  } finally {
    processObject.removeListener("SIGINT", onSignal)
    processObject.removeListener("SIGTERM", onSignal)
  }
}

/**
 * Resolves the shutdown drain timeout from
 * `VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS`:
 *   - unset / "indefinite" / "0" → indefinite: wait for in-flight jobs to
 *     finish and never kill a process runner. This is the default so a graceful
 *     stop (e.g. a deploy) does not interrupt long-running jobs such as builds.
 *   - positive integer → that many milliseconds, after which any process runner
 *     still in flight is terminated (SIGTERM, then SIGKILL) instead of orphaned.
 *
 * When a finite cap is used it must be shorter than the supervisor's
 * graceful-stop window so the worker reaps its own children before being
 * force-killed.
 * @returns {number | undefined} - Timeout in ms, or undefined for indefinite.
 */
function resolveShutdownTimeoutMs() {
  const raw = (process.env.VELOCIOUS_BACKGROUND_JOBS_WORKER_SHUTDOWN_TIMEOUT_MS || "").trim().toLowerCase()

  if (!raw || raw === "indefinite" || raw === "0") return undefined

  const parsed = Number.parseInt(raw, 10)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export default class BackgroundJobsWorkerCommand extends BaseCommand {
  async execute() {
    // Identify this process in `ps`/`top` instead of a generic "node" entry.
    process.title = "velocious background-jobs-worker"

    const args = commandArguments({definition: {valueOptions: ["--generation"]}, processArgs: this.processArgs || []})
    const worker = new BackgroundJobsWorker({
      configuration: this.getConfiguration(),
      generationId: typeof args.generation === "string" ? args.generation : undefined
    })

    const timeoutMs = resolveShutdownTimeoutMs()

    await waitForBackgroundJobsWorkerShutdown({
      onReady: () => console.log("Background jobs worker connected"),
      timeoutMs,
      worker
    })
  }
}
