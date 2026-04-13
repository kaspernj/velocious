// @ts-check

import Logger from "../logger.js"
import {nextCronFireDate, parseCronExpression} from "./cron-expression.js"

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
/** @typedef {keyof typeof DURATION_MULTIPLIERS} DurationUnit */

/**
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
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {function({args: any[], jobClass: typeof import("./job.js").default, jobKey: string, options: import("./types.js").BackgroundJobOptions}) : Promise<void>} args.enqueueJob - Enqueue callback.
   */
  constructor({configuration, enqueueJob}) {
    this.configuration = configuration
    this.enqueueJob = enqueueJob
    this.logger = new Logger(this)
    /** @type {Array<ReturnType<typeof setInterval>>} */
    this.intervalIds = []
    /** @type {Array<ReturnType<typeof setTimeout>>} */
    this.timeoutIds = []
    /** @type {boolean} - True between stop() and the next start(); cron self-rescheduler checks this so a stop() during an in-flight enqueue doesn't immediately re-arm. */
    this.stopped = false
  }

  /** @returns {Promise<void>} */
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

  /** @returns {void} */
  stop() {
    this.stopped = true

    for (const intervalId of this.intervalIds) {
      clearInterval(intervalId)
    }

    for (const timeoutId of this.timeoutIds) {
      clearTimeout(timeoutId)
    }

    this.intervalIds = []
    this.timeoutIds = []
  }

  /**
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
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {void}
   */
  scheduleEveryJob({jobConfiguration, jobKey}) {
    const everyConfig = /** @type {NonNullable<typeof jobConfiguration.every>} */ (jobConfiguration.every)
    const {everyValue, firstInValue} = this.normalizeEvery(everyConfig)
    const intervalMs = parseScheduledDuration(everyValue, `${jobKey}.every`)
    const firstInMs = firstInValue !== undefined ? parseScheduledDuration(firstInValue, `${jobKey}.first_in`) : intervalMs

    if (intervalMs < 1) {
      throw new Error(`Scheduled background job ${jobKey}.every must be at least 1 millisecond.`)
    }

    const timeoutId = setTimeout(() => {
      void this.enqueueScheduledJob({jobConfiguration, jobKey})

      const intervalId = setInterval(() => {
        void this.enqueueScheduledJob({jobConfiguration, jobKey})
      }, intervalMs)

      this.intervalIds.push(intervalId)
    }, firstInMs)

    this.timeoutIds.push(timeoutId)
  }

  /**
   * Crontab schedules don't have a constant interval (`0 9 * * 1-5`
   * fires once per weekday at 9 AM, with gaps of varying length), so
   * we self-reschedule with `setTimeout` after every fire instead of
   * using `setInterval`.
   *
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

        await this.enqueueScheduledJob({jobConfiguration, jobKey})

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
   * @param {object} args - Options.
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
   * @param {string} args.jobKey - Job key.
   * @returns {Promise<void>}
   */
  async enqueueScheduledJob({jobConfiguration, jobKey}) {
    try {
      await this.enqueueJob({
        args: Array.isArray(jobConfiguration.args) ? jobConfiguration.args : [],
        jobClass: jobConfiguration.class,
        jobKey,
        options: jobConfiguration.options || {}
      })
    } catch (error) {
      await this.logger.error(() => ["Failed to enqueue scheduled background job", {jobKey, jobName: jobConfiguration.class.jobName()}, error])
    }
  }

  /**
   * @param {NonNullable<import("../configuration-types.js").ScheduledBackgroundJobConfiguration["every"]>} every - Every config (caller must guarantee not undefined).
   * @returns {{everyValue: number | string, firstInValue?: number | string}} - Normalized interval and first-run delay values.
   */
  normalizeEvery(every) {
    if (Array.isArray(every)) {
      const [everyValue, everyOptions] = every

      if (!everyOptions || typeof everyOptions !== "object" || Array.isArray(everyOptions)) {
        return {everyValue}
      }

      return {everyValue, firstInValue: everyOptions.firstIn ?? everyOptions.first_in}
    }

    return {everyValue: every}
  }
}
