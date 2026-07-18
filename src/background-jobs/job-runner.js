// @ts-check

import configurationResolver from "../configuration-resolver.js"
import BackgroundJobRegistry from "./job-registry.js"
import BackgroundJobsStatusReporter from "./status-reporter.js"

const BEACON_READY_TIMEOUT_MS = 5000

export class BackgroundJobPerformedFailure extends Error {
  /**
   * Creates a performed-job failure after its terminal report is acknowledged.
   * @param {Error} cause - A job perform error whose failed terminal report was acknowledged.
   */
  constructor(cause) {
    super(cause.message, {cause})
    this.name = "BackgroundJobPerformedFailure"
  }
}

/**
 * Runs report beacon ready error.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @param {?} error - Beacon readiness error.
 * @returns {void}
 */
function reportBeaconReadyError(configuration, error) {
  const errorEvents = configuration.getErrorEvents()
  const normalizedError = error instanceof Error ? error : new Error(String(error))
  const payload = {
    context: {peerType: "background-jobs-runner", stage: "beacon-ready"},
    error: normalizedError
  }
  const hasListener = errorEvents.listenerCount("framework-error") > 0
    || errorEvents.listenerCount("all-error") > 0

  errorEvents.emit("framework-error", payload)
  errorEvents.emit("all-error", {...payload, errorType: "framework-error"})

  if (!hasListener) {
    console.error(`[velocious framework-error stage=beacon-ready] ${normalizedError.message}`)
  }
}

/**
 * Runs connect beacon.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {Promise<void>}
 */
async function connectBeacon(configuration) {
  const beaconClient = await configuration.connectBeacon({peerType: "background-jobs-runner"})

  if (!beaconClient) return

  try {
    await beaconClient.waitForReady({timeoutMs: BEACON_READY_TIMEOUT_MS})
  } catch (error) {
    reportBeaconReadyError(configuration, error)
  }
}

/**
 * Resolves the process title to show while a job runs: the job class's declared
 * `static processTitle`, else a `velocious job-runner: <JobName>` fallback.
 * @param {typeof import("./job.js").default} JobClass - Resolved job class.
 * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
 * @returns {string} - Process title.
 */
function runnerProcessTitle(JobClass, payload) {
  const declared = JobClass.processTitle

  if (typeof declared === "string" && declared.length > 0) return declared

  return `velocious job-runner: ${payload.jobName}`
}

/**
 * Runs run job payload.
 * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
 * @param {object} [options] - Runner options.
 * @param {boolean} [options.closeConnections] - Whether to gracefully close framework connections after the job.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default async function runJobPayload(payload, {closeConnections = true} = {}) {
  const configuration = await configurationResolver()
  configuration.setCurrent()
  await configuration.initialize({type: "background-jobs-runner"})
  await connectBeacon(configuration)
  const reporter = new BackgroundJobsStatusReporter({configuration})

  const registry = new BackgroundJobRegistry({configuration})
  await registry.load()
  const JobClass = registry.getJobByName(payload.jobName)
  const jobInstance = new JobClass()
  /**
   * Perform.
   * @type {(...args: Array<?>) => Promise<void>} */
  const perform = jobInstance.perform

  // Name the process after the job it is running so `ps`/`top` show what each
  // runner is doing; restored in the `finally` below when the job finishes.
  const previousTitle = process.title
  process.title = runnerProcessTitle(JobClass, payload)

  try {
    try {
      await configuration.withConnections({name: `Background job runner: ${payload.jobName}`}, async () => {
        await perform.apply(jobInstance, payload.args || [])
      })
    } catch (error) {
      const performedError = error instanceof Error ? error : new Error(String(error))
      if (payload.id) {
        await reporter.reportWithRetry({
          jobId: payload.id,
          status: "failed",
          error: performedError,
          handoffId: payload.handoffId,
          workerId: payload.workerId,
          handedOffAtMs: payload.handedOffAtMs,
          maxDurationMs: 30000
        })
      }

      throw new BackgroundJobPerformedFailure(performedError)
    }

    if (payload.id) {
      await reporter.reportWithRetry({
        jobId: payload.id,
        status: "completed",
        handoffId: payload.handoffId,
        workerId: payload.workerId,
        handedOffAtMs: payload.handedOffAtMs,
        maxDurationMs: 30000
      })
    }
  } finally {
    // Restore the runner's base title so a lingering/idle runner (or a reused
    // one) doesn't misreport a finished job as still running.
    process.title = previousTitle
    if (closeConnections) {
      try {
        await configuration.disconnectBeacon()
      } finally {
        await configuration.closeDatabaseConnections()
      }
    }
  }
}
