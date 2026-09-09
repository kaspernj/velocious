// @ts-check

import VelociousError from "../velocious-error.js"

export const DEFAULT_BACKGROUND_JOB_EXECUTION_MODE = "pooled"
export const DEFAULT_BACKGROUND_JOB_MAX_RETRIES = 10
export const DEFAULT_BACKGROUND_JOB_QUEUE = "default"
export const QUEUE_CONCURRENCY_KEY_PREFIX = "queue:"
/** @type {import("./types.js").BackgroundJobExecutionMode[]} */
export const BACKGROUND_JOB_EXECUTION_MODES = ["inline", "forked", "pooled", "spawned"]

/**
 * Normalizes a job queue.
 * @param {import("./types.js").BackgroundJobOptions} [options] - Job options.
 * @returns {string} - Queue name.
 */
export function normalizeBackgroundJobQueue(options) {
  const queue = options?.queue

  if (typeof queue === "string" && queue.trim().length > 0) return queue.trim()

  return DEFAULT_BACKGROUND_JOB_QUEUE
}

/**
 * Normalizes an explicit execution mode while retaining the Node default.
 * @param {Omit<import("./types.js").BackgroundJobOptions, "executionMode"> & {executionMode?: string}} options - Job options.
 * @param {import("./types.js").BackgroundJobExecutionMode} [defaultExecutionMode] - Default mode.
 * @param {import("./types.js").BackgroundJobExecutionMode[]} [supportedExecutionModes] - Modes accepted by the caller.
 * @returns {import("./types.js").BackgroundJobExecutionMode} - Execution mode.
 */
export function normalizeBackgroundJobExecutionMode(options = {}, defaultExecutionMode = DEFAULT_BACKGROUND_JOB_EXECUTION_MODE, supportedExecutionModes = BACKGROUND_JOB_EXECUTION_MODES) {
  if ("forked" in options) {
    throw new Error("The background job `forked` option was removed; pass `executionMode` (\"inline\", \"forked\", \"pooled\", or \"spawned\") instead")
  }

  const requestedExecutionMode = options.executionMode || defaultExecutionMode
  /** @type {import("./types.js").BackgroundJobExecutionMode | undefined} */
  let executionMode

  for (const candidate of BACKGROUND_JOB_EXECUTION_MODES) {
    if (candidate === requestedExecutionMode) executionMode = candidate
  }

  if (!executionMode) throw new Error(`Invalid background job executionMode: ${requestedExecutionMode}`)

  if (!supportedExecutionModes.includes(executionMode)) {
    throw new Error(`Background job executionMode "${executionMode}" is not supported by the local background-jobs adapter`)
  }

  return executionMode
}

/**
 * Validates and normalizes a retry cap.
 * @param {number | null | undefined} maxRetries - Requested retry cap.
 * @returns {number} - Retry cap.
 */
export function normalizeBackgroundJobMaxRetries(maxRetries) {
  if (typeof maxRetries === "number" && Number.isFinite(maxRetries) && maxRetries >= 0) {
    return Math.floor(maxRetries)
  }

  return DEFAULT_BACKGROUND_JOB_MAX_RETRIES
}

/**
 * Validates an enqueue eligibility timestamp.
 * @param {number | undefined} scheduledAtMs - Requested timestamp.
 * @param {number} defaultScheduledAtMs - Default timestamp.
 * @returns {number} - Eligibility timestamp.
 */
export function normalizeBackgroundJobScheduledAtMs(scheduledAtMs, defaultScheduledAtMs) {
  if (scheduledAtMs === undefined) return defaultScheduledAtMs
  if (Number.isSafeInteger(scheduledAtMs) && scheduledAtMs >= 0) return scheduledAtMs

  throw VelociousError.safe("background job scheduledAtMs must be a non-negative safe integer")
}

/**
 * Validates a reschedule delay and resolves it at persistence time.
 * @param {number} delayMs - Requested delay.
 * @param {number} nowMs - Persistence timestamp.
 * @returns {number} - New eligibility timestamp.
 */
export function rescheduledBackgroundJobAtMs(delayMs, nowMs) {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw VelociousError.safe("background job reschedule delayMs must be a non-negative safe integer")
  }

  const scheduledAtMs = nowMs + delayMs

  if (!Number.isSafeInteger(scheduledAtMs)) {
    throw VelociousError.safe("background job reschedule scheduledAtMs must be a safe integer")
  }

  return scheduledAtMs
}

/**
 * Returns the shared failure backoff.
 * @param {number} retryCount - One-based failed attempt count.
 * @returns {number} - Backoff in milliseconds.
 */
export function retryDelayMs(retryCount) {
  const scheduleSeconds = [10, 60, 600, 3600]

  if (retryCount <= scheduleSeconds.length) return scheduleSeconds[retryCount - 1] * 1000

  return (retryCount - 3) * 60 * 60 * 1000
}

/**
 * Resolves explicit or queue-derived concurrency.
 * @param {object} args - Resolution arguments.
 * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
 * @param {string} args.queue - Normalized queue.
 * @param {Record<string, {maxConcurrent?: number, priority?: number}>} args.queues - Queue configuration.
 * @returns {import("./types.js").ResolvedBackgroundJobConcurrency | null} - Concurrency contract.
 */
export function normalizeBackgroundJobConcurrency({options = {}, queue, queues}) {
  const key = options.concurrencyKey
  const cap = options.maxConcurrency

  if (key !== undefined || cap !== undefined) {
    if (typeof key !== "string" || key.length === 0 || !Number.isInteger(cap) || Number(cap) <= 0) {
      throw new Error("background job concurrencyKey and maxConcurrency must be paired; concurrencyKey must be non-empty and maxConcurrency must be a positive integer")
    }
    if (key.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX)) {
      throw new Error(`background job concurrencyKey must not start with the reserved "${QUEUE_CONCURRENCY_KEY_PREFIX}" prefix, which is reserved for queue-derived concurrency caps`)
    }

    return {concurrencyKey: key, maxConcurrency: Number(cap), queueDerived: false}
  }

  const queueCap = queues[queue]?.maxConcurrent

  if (!Number.isInteger(queueCap) || Number(queueCap) <= 0) return null

  return {
    concurrencyKey: `${QUEUE_CONCURRENCY_KEY_PREFIX}${queue}`,
    maxConcurrency: Number(queueCap),
    queueDerived: true
  }
}
