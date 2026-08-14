// @ts-check

import {currentConfiguration} from "../current-configuration.js"
import performBackgroundJob from "./perform-job.js"
import BackgroundJobRescheduleSignal from "./reschedule-signal.js"

let inlinePerformanceSequence = 0

/**
 * Rejects options whose semantics require durable queue state.
 * @param {import("./types.js").BackgroundJobOptions | undefined} options - Requested options.
 * @returns {void}
 */
function validateInlineOptions(options) {
  const optionNames = Object.keys(options || {})

  if (optionNames.length > 0) {
    throw new Error(`Background job option ${optionNames[0]} is not supported in inline mode`)
  }
}

/**
 * Builds an ephemeral inline performance id.
 * @returns {string} - Performance id.
 */
function inlineJobId() {
  inlinePerformanceSequence++
  return `inline-${Date.now()}-${inlinePerformanceSequence}`
}

/**
 * Enqueues durably in background mode or performs immediately in inline mode.
 * @param {object} args - Enqueue request.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<string>} - Durable job id or ephemeral inline performance id.
 */
export async function enqueueBackgroundJob({JobClass, jobArgs, jobOptions}) {
  const configuration = currentConfiguration()

  return await enqueueBackgroundJobForConfiguration({configuration, JobClass, jobArgs, jobOptions})
}

/**
 * Enqueues using an explicitly resolved configuration.
 * @param {object} args - Enqueue request.
 * @param {import("../configuration.js").default} args.configuration - Configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<string>} - Durable job id or ephemeral inline performance id.
 */
export async function enqueueBackgroundJobForConfiguration({configuration, JobClass, jobArgs, jobOptions}) {

  if (configuration.getBackgroundJobsConfig().mode === "inline") {
    validateInlineOptions(jobOptions)
    configuration.setCurrent()
    await configuration.initialize({type: "background-jobs-inline"})

    try {
      await performBackgroundJob({
        configuration,
        JobClass,
        jobArgs,
        name: `Background job inline mode: ${JobClass.jobName()}`
      })
    } catch (error) {
      if (error instanceof BackgroundJobRescheduleSignal) {
        throw new Error("rescheduleIn is not supported in inline mode", {cause: error})
      }

      throw error
    }

    return inlineJobId()
  }

  const client = configuration.getEnvironmentHandler().backgroundJobsClient({configuration})

  return await client.enqueue({
    jobName: JobClass.jobName(),
    args: jobArgs,
    options: JobClass._withQueue(jobOptions)
  })
}

/**
 * Replaces a stable durable schedule in background mode.
 * @param {object} args - Replacement request.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {string} args.scheduleKey - Stable schedule key.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
 */
export async function replaceScheduledBackgroundJob({JobClass, scheduleKey, jobArgs, jobOptions}) {
  const configuration = currentConfiguration()

  return await replaceScheduledBackgroundJobForConfiguration({configuration, JobClass, scheduleKey, jobArgs, jobOptions})
}

/**
 * Replaces a stable schedule using an explicitly resolved configuration.
 * @param {object} args - Replacement request.
 * @param {import("../configuration.js").default} args.configuration - Configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {string} args.scheduleKey - Stable schedule key.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
 */
export async function replaceScheduledBackgroundJobForConfiguration({configuration, JobClass, scheduleKey, jobArgs, jobOptions}) {

  if (configuration.getBackgroundJobsConfig().mode === "inline") {
    throw new Error("replaceScheduled is not supported in inline mode")
  }

  const client = configuration.getEnvironmentHandler().backgroundJobsClient({configuration})

  return await client.replaceScheduled({
    scheduleKey,
    jobName: JobClass.jobName(),
    args: jobArgs,
    options: JobClass._withQueue(jobOptions)
  })
}

/**
 * Cancels a stable durable schedule in background mode.
 * @param {string} scheduleKey - Stable schedule key.
 * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
 */
export async function cancelScheduledBackgroundJob(scheduleKey) {
  const configuration = currentConfiguration()

  return await cancelScheduledBackgroundJobForConfiguration({configuration, scheduleKey})
}

/**
 * Cancels a stable schedule using an explicitly resolved configuration.
 * @param {object} args - Cancellation request.
 * @param {import("../configuration.js").default} args.configuration - Configuration.
 * @param {string} args.scheduleKey - Stable logical schedule key.
 * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
 */
export async function cancelScheduledBackgroundJobForConfiguration({configuration, scheduleKey}) {

  if (configuration.getBackgroundJobsConfig().mode === "inline") {
    throw new Error("cancelScheduled is not supported in inline mode")
  }

  const client = configuration.getEnvironmentHandler().backgroundJobsClient({configuration})

  return await client.cancelScheduled({scheduleKey})
}
