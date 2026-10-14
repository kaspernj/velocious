// @ts-check

import {DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS} from "./scheduled-enqueue-bound.js"
import ScheduledBackgroundJobEnqueueTimeoutError from "./scheduled-enqueue-timeout-error.js"

import Logger from "../logger.js"
import {nextCronFireDate, parseCronExpression} from "./cron-expression.js"

/**
 * DurationUnit type.
 * @typedef {keyof typeof DURATION_MULTIPLIERS} DurationUnit */
const DURATION_MULTIPLIERS = {
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  m: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  ms: 1,
  s: 1000,
  second: 1000,
  seconds: 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000
}

// The watchdog below is internal machinery, not a schedule timer. Capturing the
// platform timers at module load keeps them out of a caller's schedule-timer
// observation, so bounding an enqueue never appears as an extra scheduled job.
const armWatchdogTimer = globalThis.setTimeout
const cancelWatchdogTimer = globalThis.clearTimeout

/**
 * Runs the parseScheduledDuration helper.
 * @param {number | string} value - Duration value.
 * @param {string} fieldName - Field name for errors.
 * @returns {number} - Duration in milliseconds.
 */
export function parseScheduledDuration(value, fieldName) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1) {
      throw new Error(`Scheduled background job ${fieldName} must be a positive number of milliseconds.`)
    }

    return value
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Scheduled background job ${fieldName} must be a non-empty string or number.`)
  }

  const normalizedValue = value.trim().toLowerCase()
  const match = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|second|seconds|minute|minutes|hour|hours|day|days|week|weeks)$/)

  if (!match) {
    throw new Error(`Invalid scheduled background job ${fieldName}: ${value}`)
  }

  const numericValue = Number(match[1])
  const multiplier = DURATION_MULTIPLIERS[/** @type {DurationUnit} */ (match[2])]

  if (!multiplier) {
    throw new Error(`Invalid scheduled background job ${fieldName}: ${value}`)
  }

  return Math.round(numericValue * multiplier)
}

/** Runs configured recurring background job schedules. */
export default class BackgroundJobsScheduler {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {(args: {args: Array<ReturnType<typeof JSON.parse>>, jobClass: typeof import("./job.js").default, jobKey: string, options: import("./types.js").BackgroundJobOptions}) => Promise<void>} args.enqueueJob - Enqueue callback.
   */
  constructor({configuration, enqueueJob}) {
    this.configuration = configuration
    this.enqueueJob = enqueueJob
    this.logger = new Logger(this)
    /** @type {number | null} - Bound (ms) for one scheduled enqueue attempt; `null` disables the bound. */
    this.scheduledEnqueueTimeoutMs = this._resolveScheduledEnqueueTimeoutMs()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<ReturnType<typeof setInterval>>} */
    this.intervalIds = []
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<ReturnType<typeof setTimeout>>} */
    this.timeoutIds = []
    /** @type {Map<string, Promise<void>>} - In-flight scheduled enqueues by schedule key that shutdown must drain. */
    this.pendingEnqueuesByJobKey = new Map()
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} - True between stop() and the next start(); cron self-rescheduler checks this so a stop() during an in-flight enqueue doesn't immediately re-arm.
     */
    this.stopped = false
  }

  /**
   * Runs start.
   * @returns {Promise<void>} */
  async start() {
    this.stopped = false

    const scheduledBackgroundJobsConfig = await this.configuration.getScheduledBackgroundJobsConfig()

    if (!scheduledBackgroundJobsConfig?.jobs) {
      return
    }

    for (const jobKey of Object.keys(scheduledBackgroundJobsConfig.jobs)) {
      const jobConfiguration = scheduledBackgroundJobsConfig.jobs[jobKey]

      if (!jobConfiguration || jobConfiguration.enabled === false) {
        continue
      }

      this.scheduleJob({jobConfiguration, jobKey})
    }
  }

  /**
   * Runs stop.
   * @returns {Promise<void>} Resolves after in-flight scheduled enqueues finish.
   */
  async stop() {
    this.stopped = true

    for (const intervalId of this.intervalIds) {
      clearInterval(intervalId)
    }

    for (const timeoutId of this.timeoutIds) {
      clearTimeout(timeoutId)
    }

    this.intervalIds = []
    this.timeoutIds = []

    await Promise.all(this.pendingEnqueuesByJobKey.values())
  }

  /**
   * Runs schedule job.
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {void}
   */
  scheduleJob({jobConfiguration, jobKey}) {
    if (!jobConfiguration.class || typeof jobConfiguration.class.performLaterWithOptions !== "function") {
      throw new Error(`Scheduled background job ${jobKey} must define a job class.`)
    }

    if (jobConfiguration.cron !== undefined && jobConfiguration.every !== undefined) {
      throw new Error(`Scheduled background job ${jobKey} must define either "every" or "cron", not both.`)
    }

    if (jobConfiguration.cron !== undefined) {
      this.scheduleCronJob({jobConfiguration, jobKey})

      return
    }

    if (jobConfiguration.every === undefined) {
      throw new Error(`Scheduled background job ${jobKey} must define either "every" or "cron".`)
    }

    this.scheduleEveryJob({jobConfiguration, jobKey})
  }

  /**
   * Runs schedule every job.
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {void}
   */
  scheduleEveryJob({jobConfiguration, jobKey}) {
    const everyConfig = /** @type {NonNullable<typeof jobConfiguration.every>} */ (jobConfiguration.every)
    const {everyValue, firstInValue} = this.normalizeEvery(everyConfig)
    const intervalMs = parseScheduledDuration(everyValue, `${jobKey}.every`)
    const firstInMs = firstInValue !== undefined ? parseScheduledDuration(firstInValue, `${jobKey}.firstIn`) : intervalMs

    if (intervalMs < 1) {
      throw new Error(`Scheduled background job ${jobKey}.every must be at least 1 millisecond.`)
    }

    const timeoutId = setTimeout(() => {
      const scheduledEnqueue = this.runScheduledJob({jobConfiguration, jobKey})

      const intervalId = setInterval(() => {
        return this.runScheduledJob({jobConfiguration, jobKey})
      }, intervalMs)

      this.intervalIds.push(intervalId)

      return scheduledEnqueue
    }, firstInMs)

    this.timeoutIds.push(timeoutId)
  }

  /**
   * Crontab schedules don't have a constant interval (`0 9 * * 1-5`
   * fires once per weekday at 9 AM, with gaps of varying length), so
   * we self-reschedule with `setTimeout` after every fire instead of
   * using `setInterval`.
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {void}
   */
  scheduleCronJob({jobConfiguration, jobKey}) {
    const cronExpression = jobConfiguration.cron

    if (typeof cronExpression !== "string") {
      throw new Error(`Scheduled background job ${jobKey}.cron must be a string.`)
    }

    const parsed = parseCronExpression(cronExpression)
    const scheduleNext = () => {
      if (this.stopped) return

      const nextDate = nextCronFireDate(parsed, new Date())
      const delayMs = Math.max(1, nextDate.getTime() - Date.now())
      const timeoutId = setTimeout(async () => {
        if (this.stopped) return

        await this.runScheduledJob({jobConfiguration, jobKey})

        // The await above can yield to a stop() call. Re-check before
        // re-arming so we don't keep firing after shutdown.
        if (this.stopped) return

        scheduleNext()
      }, delayMs)

      this.timeoutIds.push(timeoutId)
    }

    scheduleNext()
  }

  /**
   * Tracks a scheduled enqueue so stop() cannot return while it can still mutate the store.
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {Promise<void>} - Resolves after the enqueue attempt finishes.
   */
  async runScheduledJob({jobConfiguration, jobKey}) {
    if (this.stopped || this.pendingEnqueuesByJobKey.has(jobKey)) return

    const pendingEnqueue = this.enqueueScheduledJob({jobConfiguration, jobKey})
    this.pendingEnqueuesByJobKey.set(jobKey, pendingEnqueue)

    try {
      await pendingEnqueue
    } finally {
      this.pendingEnqueuesByJobKey.delete(jobKey)
    }
  }

  /**
   * Runs enqueue scheduled job.
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {Promise<void>}
   */
  async enqueueScheduledJob({jobConfiguration, jobKey}) {
    try {
      // De-duplicate scheduled enqueues by default: a periodic job still pending from an earlier
      // tick is not enqueued again, which is what let the background_jobs table fill with thousands
      // of identical scheduled jobs when the queue backed up. Dedup is by job identity (see the
      // store), so the job keeps its queue-derived concurrency cap. A schedule can opt out with
      // `deduplicateWhileQueued: false`.
      await this._withScheduledEnqueueTimeout({
        jobKey,
        jobName: jobConfiguration.class.jobName(),
        run: async () => {
          await this.enqueueJob({
            args: Array.isArray(jobConfiguration.args) ? jobConfiguration.args : [],
            jobClass: jobConfiguration.class,
            jobKey,
            options: {deduplicateWhileQueued: true, ...(jobConfiguration.options || {})}
          })
        }
      })
    } catch (error) {
      if (error instanceof ScheduledBackgroundJobEnqueueTimeoutError) {
        this._reportScheduledEnqueueStall({error, jobKey})

        return
      }

      await this.logger.error(() => ["Failed to enqueue scheduled background job", {jobKey, jobName: jobConfiguration.class.jobName()}, error])
    }
  }

  /**
   * Runs one durable enqueue attempt under the scheduled-enqueue bound.
   *
   * The bound is applied with a local race rather than `awaitery`'s `timeout()`:
   * that helper starts its callback through `Promise.resolve().then(...)`, which
   * would defer every scheduled enqueue by a microtask and change the tick
   * semantics callers rely on. Here the attempt starts synchronously, and the
   * watchdog uses the module-captured timers so it is never observable as a
   * schedule timer. Only the watchdog raises the typed timeout error, so a
   * timeout raised inside the enqueue itself keeps its own error path.
   * @param {object} args - Options.
   * @param {string} args.jobKey - Schedule key.
   * @param {string} args.jobName - Resolved job class name.
   * @param {() => Promise<void>} args.run - Enqueue attempt.
   * @returns {Promise<void>} - Resolves when the attempt settles within the bound.
   */
  async _withScheduledEnqueueTimeout({jobKey, jobName, run}) {
    const timeoutMs = this.scheduledEnqueueTimeoutMs
    /** @type {Promise<void>} */
    let attempt

    try {
      attempt = Promise.resolve(run())
    } catch (error) {
      attempt = Promise.reject(/** @type {Error} */ (error))
    }

    if (timeoutMs === null) return await attempt

    /**
     * Rejects the watchdog promise when the bound expires.
     * @type {(error: Error) => void} */
    let rejectScheduledEnqueueTimeout = () => {}
    const watchdog = new Promise((_, reject) => { rejectScheduledEnqueueTimeout = reject })
    /**
     * Watchdog timer handle.
     * @type {ReturnType<typeof armWatchdogTimer>} */
    const watchdogId = armWatchdogTimer(() => {
      rejectScheduledEnqueueTimeout(new ScheduledBackgroundJobEnqueueTimeoutError({
        jobKey,
        jobName,
        scheduledEnqueueTimeoutMs: timeoutMs
      }))
    }, timeoutMs)

    try {
      return await Promise.race([attempt, watchdog])
    } finally {
      cancelWatchdogTimer(watchdogId)
    }
  }

  /**
   * Surfaces a scheduled enqueue whose store call never settled. Without this report the only
   * symptom is a schedule that silently stops enqueueing after one wedged call.
   * @param {object} args - Options.
   * @param {Error} args.error - Timeout error.
   * @param {string} args.jobKey - Schedule key.
   * @returns {void}
   */
  _reportScheduledEnqueueStall({error, jobKey}) {
    const payload = {
      context: {
        jobKey,
        scheduledEnqueueTimeoutMs: this.scheduledEnqueueTimeoutMs,
        stage: "background-jobs-scheduled-enqueue-stall"
      },
      error
    }

    void this.logger.error(() => ["Scheduled background job enqueue stalled", payload.context, error])

    const errorEvents = typeof this.configuration?.getErrorEvents === "function" ? this.configuration.getErrorEvents() : undefined

    if (!errorEvents) return

    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Resolves the scheduled-enqueue bound from configuration.
   * @returns {number | null} - Bound in milliseconds, or `null` for an unbounded wait.
   */
  _resolveScheduledEnqueueTimeoutMs() {
    const backgroundJobsConfig = typeof this.configuration?.getBackgroundJobsConfig === "function" ? this.configuration.getBackgroundJobsConfig() : undefined
    const configured = backgroundJobsConfig?.scheduledEnqueueTimeoutMs

    if (configured === null) return null
    if (typeof configured === "number" && configured > 0) return configured

    return DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS
  }

  /**
   * Runs normalize every.
   * @param {NonNullable<import("../configuration-types.js").ScheduledBackgroundJobConfiguration["every"]>} every - Every config (caller must guarantee not undefined).
   * @returns {{everyValue: number | string, firstInValue?: number | string}} - Normalized interval and first-run delay values.
   */
  normalizeEvery(every) {
    if (Array.isArray(every)) {
      const [everyValue, everyOptions] = every

      if (!everyOptions || typeof everyOptions !== "object" || Array.isArray(everyOptions)) {
        return {everyValue}
      }

      return {everyValue, firstInValue: everyOptions.firstIn}
    }

    return {everyValue: every}
  }
}
