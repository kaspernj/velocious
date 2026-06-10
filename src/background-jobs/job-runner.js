// @ts-check

import configurationResolver from "../configuration-resolver.js"
import BackgroundJobRegistry from "./job-registry.js"
import BackgroundJobsStatusReporter from "./status-reporter.js"

const BEACON_READY_TIMEOUT_MS = 5000

/**
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
 * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
 * @returns {Promise<void>} - Resolves when complete.
 */
export default async function runJobPayload(payload) {
  const configuration = await configurationResolver()
  configuration.setCurrent()
  await configuration.initialize({type: "background-jobs-runner"})
  await connectBeacon(configuration)
  const reporter = new BackgroundJobsStatusReporter({configuration})

  const registry = new BackgroundJobRegistry({configuration})
  await registry.load()
  const JobClass = registry.getJobByName(payload.jobName)
  const jobInstance = new JobClass()
  /** @type {(...args: Array<?>) => Promise<void>} */
  const perform = jobInstance.perform

  try {
    try {
      await configuration.withConnections({name: `Background job runner: ${payload.jobName}`}, async () => {
        await perform.apply(jobInstance, payload.args || [])
      })

      if (payload.id) {
        await reporter.reportWithRetry({
          jobId: payload.id,
          status: "completed",
          workerId: payload.workerId,
          handedOffAtMs: payload.handedOffAtMs,
          maxDurationMs: 30000
        })
      }
    } catch (error) {
      if (payload.id) {
        await reporter.reportWithRetry({
          jobId: payload.id,
          status: "failed",
          error,
          workerId: payload.workerId,
          handedOffAtMs: payload.handedOffAtMs,
          maxDurationMs: 30000
        })
      }

      throw error
    }
  } finally {
    try {
      await configuration.disconnectBeacon()
    } finally {
      await configuration.closeDatabaseConnections()
    }
  }
}
