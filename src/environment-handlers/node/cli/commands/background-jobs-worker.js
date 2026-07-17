import BaseCommand from "../../../../cli/base-command.js"
import BackgroundJobsWorker from "../../../../background-jobs/worker.js"

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

    const worker = new BackgroundJobsWorker({configuration: this.getConfiguration()})
    await worker.start()

    console.log("Background jobs worker connected")

    const timeoutMs = resolveShutdownTimeoutMs()

    await new Promise((resolve) => {
      const shutdown = async () => {
        await worker.stop({timeoutMs})
        resolve(undefined)
      }

      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    })
  }
}
