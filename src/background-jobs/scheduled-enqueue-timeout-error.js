// @ts-check

import {TimeoutError} from "awaitery/build/timeout.js"

/** Typed failure for a scheduled background-job enqueue that never settled within its bound. */
export default class ScheduledBackgroundJobEnqueueTimeoutError extends TimeoutError {
  /**
   * Builds a scheduled-enqueue timeout error without job arguments or connection details.
   * @param {object} args - Safe timeout context.
   * @param {string} args.jobKey - Schedule key whose enqueue stalled.
   * @param {string} args.jobName - Resolved job class name.
   * @param {number} args.scheduledEnqueueTimeoutMs - Configured bound that expired.
   * @param {TimeoutError} [args.cause] - Original watchdog timeout.
   */
  constructor({jobKey, jobName, scheduledEnqueueTimeoutMs, cause}) {
    super(`Scheduled background job enqueue did not settle within ${scheduledEnqueueTimeoutMs}ms`, cause ? {cause} : undefined)

    this.name = "ScheduledBackgroundJobEnqueueTimeoutError"
    /** @type {"BACKGROUND_JOB_SCHEDULED_ENQUEUE_TIMEOUT"} */
    this.code = "BACKGROUND_JOB_SCHEDULED_ENQUEUE_TIMEOUT"
    this.jobKey = jobKey
    this.jobName = jobName
    this.scheduledEnqueueTimeoutMs = scheduledEnqueueTimeoutMs
  }
}
