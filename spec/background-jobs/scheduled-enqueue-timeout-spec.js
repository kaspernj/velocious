// @ts-check

import EventEmitter from "node:events"

import BackgroundJobsScheduler from "../../src/background-jobs/scheduler.js"
import {DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS} from "../../src/background-jobs/scheduled-enqueue-bound.js"
import ScheduledBackgroundJobEnqueueTimeoutError from "../../src/background-jobs/scheduled-enqueue-timeout-error.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * One framework-error payload captured from a stalled scheduled enqueue.
 * @typedef {object} CapturedFrameworkError
 * @property {{jobKey: string, scheduledEnqueueTimeoutMs: number, stage: string}} context - Reported stall context.
 * @property {Error} error - Reported error.
 */

const SHORT_BOUND_MS = 100
const TEST_GUARD_MS = 5000

/**
 * Job class stand-in for schedule configuration.
 */
class StalledScheduleJob {
  /** @returns {string} - Job name. */
  static jobName() { return "StalledScheduleJob" }

  /** @returns {void} - No-op. */
  static performLaterWithOptions() {}
}

/**
 * Builds a scheduler with a controllable enqueue behaviour.
 * @param {object} args - Options.
 * @param {(context: {attempt: number}) => Promise<void>} args.enqueue - Enqueue implementation.
 * @param {number | null} [args.scheduledEnqueueTimeoutMs] - Configured bound.
 * @returns {{enqueueAttempts: Array<number>, frameworkErrors: Array<CapturedFrameworkError>, scheduler: BackgroundJobsScheduler}} - Scheduler plus observed side effects.
 */
function buildScheduler({enqueue, scheduledEnqueueTimeoutMs}) {
  const errorEvents = new EventEmitter()
  /** @type {Array<CapturedFrameworkError>} */
  const frameworkErrors = []
  /** @type {Array<number>} */
  const enqueueAttempts = []
  let attempt = 0

  errorEvents.on("framework-error", (payload) => { frameworkErrors.push(payload) })

  const configuration = /** @type {any} */ ({
    getBackgroundJobsConfig() {
      return scheduledEnqueueTimeoutMs === undefined ? {} : {scheduledEnqueueTimeoutMs}
    },
    getErrorEvents() { return errorEvents }
  })

  const scheduler = new BackgroundJobsScheduler({
    configuration,
    enqueueJob: async () => {
      attempt += 1
      enqueueAttempts.push(attempt)

      return await enqueue({attempt})
    }
  })

  return {enqueueAttempts, frameworkErrors, scheduler}
}

/**
 * Runs one scheduled enqueue attempt, guarded so a missing bound fails the spec instead of hanging the runner.
 * @param {BackgroundJobsScheduler} scheduler - Scheduler under test.
 * @param {string} jobKey - Schedule key.
 * @returns {Promise<void>} - Resolves after the scheduled enqueue attempt settles.
 */
async function runScheduledJobGuarded(scheduler, jobKey) {
  const settled = new Promise((resolve) => {
    void scheduler.runScheduledJob({
      jobConfiguration: {args: [], class: /** @type {any} */ (StalledScheduleJob)},
      jobKey
    }).then(() => resolve("settled"))
  })
  const outcome = await Promise.race([settled, new Promise((resolve) => { setTimeout(() => resolve("guard-expired"), TEST_GUARD_MS) })])

  if (outcome === "guard-expired") throw new Error(`Scheduled enqueue for ${JSON.stringify(jobKey)} never settled within the ${TEST_GUARD_MS}ms test guard`)
}

describe("Background jobs - scheduled enqueue timeout", {timeoutSeconds: 30}, () => {
  it("bounds a scheduled enqueue that never settles", async () => {
    const {scheduler} = buildScheduler({
      enqueue: () => new Promise(() => {}),
      scheduledEnqueueTimeoutMs: SHORT_BOUND_MS
    })

    await runScheduledJobGuarded(scheduler, "stalledSchedule")

    expect(scheduler.pendingEnqueuesByJobKey.has("stalledSchedule")).toBeFalse()
  })

  it("reports a stalled scheduled enqueue as a framework error", async () => {
    const {frameworkErrors, scheduler} = buildScheduler({
      enqueue: () => new Promise(() => {}),
      scheduledEnqueueTimeoutMs: SHORT_BOUND_MS
    })

    await runScheduledJobGuarded(scheduler, "stalledSchedule")

    expect(frameworkErrors.length).toEqual(1)
    expect(frameworkErrors[0].context.stage).toEqual("background-jobs-scheduled-enqueue-stall")
    expect(frameworkErrors[0].context.jobKey).toEqual("stalledSchedule")
    expect(frameworkErrors[0].context.scheduledEnqueueTimeoutMs).toEqual(SHORT_BOUND_MS)

    const reportedError = frameworkErrors[0].error

    expect(reportedError).toBeInstanceOf(ScheduledBackgroundJobEnqueueTimeoutError)

    const stallError = /** @type {ScheduledBackgroundJobEnqueueTimeoutError} */ (reportedError)

    expect(stallError.code).toEqual("BACKGROUND_JOB_SCHEDULED_ENQUEUE_TIMEOUT")
    expect(stallError.jobName).toEqual("StalledScheduleJob")
  })

  it("lets a later tick enqueue after a stalled enqueue timed out", async () => {
    const {enqueueAttempts, scheduler} = buildScheduler({
      enqueue: ({attempt}) => attempt === 1 ? new Promise(() => {}) : Promise.resolve(),
      scheduledEnqueueTimeoutMs: SHORT_BOUND_MS
    })

    await runScheduledJobGuarded(scheduler, "stalledSchedule")
    await runScheduledJobGuarded(scheduler, "stalledSchedule")

    expect(enqueueAttempts).toEqual([1, 2])
  })

  it("keeps awaiting a scheduled enqueue that settles normally", async () => {
    /** @type {(value: void) => void} - Resolver for the controlled pending enqueue. */
    let resolveEnqueue = () => {}
    const pending = new Promise((resolve) => { resolveEnqueue = resolve })
    const {enqueueAttempts, frameworkErrors, scheduler} = buildScheduler({enqueue: () => pending})

    const running = scheduler.runScheduledJob({
      jobConfiguration: {args: [], class: /** @type {any} */ (StalledScheduleJob)},
      jobKey: "healthySchedule"
    })

    expect(scheduler.pendingEnqueuesByJobKey.has("healthySchedule")).toBeTrue()

    resolveEnqueue()
    await running

    expect(enqueueAttempts).toEqual([1])
    expect(frameworkErrors.length).toEqual(0)
    expect(scheduler.pendingEnqueuesByJobKey.has("healthySchedule")).toBeFalse()
  })

  it("applies a finite default bound when no bound is configured", async () => {
    const {scheduler} = buildScheduler({enqueue: () => Promise.resolve()})

    expect(scheduler.scheduledEnqueueTimeoutMs).toEqual(DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS)
  })

  it("honours a null bound as an intentional opt-out", async () => {
    const {scheduler} = buildScheduler({
      enqueue: () => Promise.resolve(),
      scheduledEnqueueTimeoutMs: null
    })

    expect(scheduler.scheduledEnqueueTimeoutMs).toBeNull()
  })
})
