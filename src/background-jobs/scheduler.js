// @ts-check

import Logger from "../logger.js"

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
  const multiplier = DURATION_MULTIPLIERS[match[2]]

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
  }

  /** @returns {Promise<void>} */
  async start() {
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
    const {everyValue, firstInValue} = this.normalizeEvery(jobConfiguration.every)
    const intervalMs = parseScheduledDuration(everyValue, `${jobKey}.every`)
    const firstInMs = firstInValue !== undefined ? parseScheduledDuration(firstInValue, `${jobKey}.first_in`) : intervalMs

    if (!jobConfiguration.class || typeof jobConfiguration.class.performLaterWithOptions !== "function") {
      throw new Error(`Scheduled background job ${jobKey} must define a job class.`)
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
   * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration["every"]} every - Every config.
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
