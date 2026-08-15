// @ts-check

import { deferred } from "awaitery"
import LocalBackgroundJobsDispatcher from "../../src/background-jobs/local-dispatcher.js"
import LocalBackgroundJobRegistry from "../../src/background-jobs/local-job-registry.js"
import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
import Configuration from "../../src/configuration.js"
import {
  ManualBackgroundJobsClock,
  RecordingLocalJob,
  ReschedulingLocalJob,
  RetryingLocalJob,
  resetLocalBackgroundJobClasses
} from "../helpers/local-background-jobs-test-harness.js"

/** Local store that deterministically rejects selected acknowledgements before their transactions begin. */
class RejectAcknowledgementStore extends LocalBackgroundJobsStore {
  /**
   * @param {object} args - Store options.
   * @param {"markCompleted" | "markFailed" | "markRescheduled"} args.acknowledgementMethod - Method to reject.
   * @param {number} args.acknowledgementRejections - Number of attempts to reject.
   * @param {ManualBackgroundJobsClock} args.clock - Dispatcher clock.
   * @param {Configuration} args.configuration - Owning configuration.
   * @param {() => void} args.onCommittedEnqueue - Commit-aware dispatcher wake.
   */
  constructor({ acknowledgementMethod, acknowledgementRejections, clock, configuration, onCommittedEnqueue }) {
    super({ clock, configuration, onCommittedEnqueue })
    this.acknowledgementMethod = acknowledgementMethod
    this.acknowledgementAttempts = 0
    this.acknowledgementRejections = acknowledgementRejections
    this.rejectionsObserved = deferred()
  }

  /**
   * Rejects the configured number of selected acknowledgement attempts.
   * @param {"markCompleted" | "markFailed" | "markRescheduled"} acknowledgementMethod - Attempted method.
   * @returns {void} - No return value.
   */
  _rejectConfiguredAttempts(acknowledgementMethod) {
    if (acknowledgementMethod !== this.acknowledgementMethod) return

    this.acknowledgementAttempts++
    if (this.acknowledgementRejections === 0) return

    this.acknowledgementRejections--
    const error = new Error(`Planned ${acknowledgementMethod} database failure`)

    if (this.acknowledgementRejections === 0) this.rejectionsObserved.resolve(error)
    throw error
  }

  /** @param {{jobId: string, handoffId?: string}} args - Completion report. @returns {Promise<boolean>} - Whether accepted. */
  async markCompleted(args) {
    this._rejectConfiguredAttempts("markCompleted")
    return await super.markCompleted(args)
  }

  /**
   * @param {{jobId: string, handoffId?: string, error: ReturnType<typeof JSON.parse>}} args - Failure report.
   * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow | null>} - Accepted transition.
   */
  async markFailed(args) {
    this._rejectConfiguredAttempts("markFailed")
    return await super.markFailed(args)
  }

  /**
   * @param {{jobId: string, handoffId?: string, delayMs: number}} args - Reschedule report.
   * @returns {Promise<boolean>} - Whether accepted.
   */
  async markRescheduled(args) {
    this._rejectConfiguredAttempts("markRescheduled")
    return await super.markRescheduled(args)
  }
}

/**
 * Creates a real local dispatcher/store pair with one rejected acknowledgement.
 * @param {object} args - Harness options.
 * @param {"markCompleted" | "markFailed" | "markRescheduled"} args.acknowledgementMethod - Method to reject.
 * @param {number} [args.acknowledgementRejections] - Number of attempts to reject.
 * @param {Array<typeof import("../../src/background-jobs/platform-job.js").default>} args.jobClasses - Registered job classes.
 * @returns {Promise<{clock: ManualBackgroundJobsClock, configuration: Configuration, dispatcher: LocalBackgroundJobsDispatcher, store: RejectAcknowledgementStore}>} - Ready harness.
 */
async function acknowledgementRecoveryHarness({ acknowledgementMethod, acknowledgementRejections = 1, jobClasses }) {
  const configuration = Configuration.current()
  const clock = new ManualBackgroundJobsClock()
  /** @type {LocalBackgroundJobsDispatcher} */
  let dispatcher

  await configuration.closeBackgroundJobsAdapter()
  configuration.setBackgroundJobsConfig({
    adapter: undefined,
    databaseIdentifier: "default",
    jobClasses,
    maxConcurrentInlineJobs: 2,
    mode: "background",
    queues: {}
  })
  configuration.setCurrent()

  const store = new RejectAcknowledgementStore({
    acknowledgementMethod,
    acknowledgementRejections,
    clock,
    configuration,
    onCommittedEnqueue: () => dispatcher.wake()
  })
  const registry = new LocalBackgroundJobRegistry({ jobClasses })

  dispatcher = new LocalBackgroundJobsDispatcher({ clock, configuration, registry, store })
  await dispatcher.start()

  return { clock, configuration, dispatcher, store }
}

const cappedOptions = { concurrencyKey: "acknowledgement-recovery", maxConcurrency: 1 }

describe("Local background jobs dispatcher - acknowledgement recovery", { tags: ["dummy"], databaseCleaning: { transaction: false, truncate: true } }, () => {
  it("retains completion acknowledgement ownership until the durable claim is released", async () => {
    resetLocalBackgroundJobClasses()
    const { configuration, dispatcher, store } = await acknowledgementRecoveryHarness({
      acknowledgementMethod: "markCompleted",
      jobClasses: [RecordingLocalJob]
    })
    /** @type {Array<{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error}>} */
    const frameworkErrors = []
    /** @type {Array<{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error, errorType: string}>} */
    const allErrors = []
    const onFrameworkError = (payload) => frameworkErrors.push(payload)
    const onAllError = (payload) => allErrors.push(payload)

    configuration.getErrorEvents().on("framework-error", onFrameworkError)
    configuration.getErrorEvents().on("all-error", onAllError)

    try {
      const firstJobId = await store.enqueue({ jobName: RecordingLocalJob.jobName(), args: ["first"], options: cappedOptions })

      await store.rejectionsObserved.promise
      const secondJobId = await store.enqueue({ jobName: RecordingLocalJob.jobName(), args: ["second"], options: cappedOptions })

      await dispatcher.waitForIdle()
      expect((await store.getJob(firstJobId))?.status).toEqual("completed")
      expect((await store.getJob(secondJobId))?.status).toEqual("completed")
      expect(RecordingLocalJob.performances).toEqual([["first"], ["second"]])
      expect(frameworkErrors.length).toEqual(1)
      expect(frameworkErrors[0].context).toMatchObject({
        acknowledgementType: "completed",
        jobId: firstJobId,
        stage: "local-background-jobs-acknowledgement"
      })
      expect(allErrors.length).toEqual(1)
      expect(allErrors[0].errorType).toEqual("framework-error")
    } finally {
      configuration.getErrorEvents().off("framework-error", onFrameworkError)
      configuration.getErrorEvents().off("all-error", onAllError)
      await dispatcher.stop()
    }
  })

  it("retains failure acknowledgement ownership until exhaustion releases the durable claim", async () => {
    resetLocalBackgroundJobClasses()
    const { dispatcher, store } = await acknowledgementRecoveryHarness({
      acknowledgementMethod: "markFailed",
      jobClasses: [RetryingLocalJob]
    })

    try {
      const failedJobId = await store.enqueue({
        jobName: RetryingLocalJob.jobName(),
        args: ["failed", 1],
        options: { ...cappedOptions, maxRetries: 0 }
      })

      await store.rejectionsObserved.promise
      const followingJobId = await store.enqueue({
        jobName: RetryingLocalJob.jobName(),
        args: ["following", 0],
        options: cappedOptions
      })

      await dispatcher.waitForIdle()
      expect((await store.getJob(failedJobId))?.status).toEqual("failed")
      expect((await store.getJob(failedJobId))?.attempts).toEqual(1)
      expect((await store.getJob(followingJobId))?.status).toEqual("completed")
      expect(RetryingLocalJob.attempts.get("following")).toEqual(1)
    } finally {
      await dispatcher.stop()
    }
  })

  it("retains reschedule acknowledgement ownership until the future handoff releases its durable claim", async () => {
    resetLocalBackgroundJobClasses()
    const { clock, dispatcher, store } = await acknowledgementRecoveryHarness({
      acknowledgementMethod: "markRescheduled",
      jobClasses: [RecordingLocalJob, ReschedulingLocalJob]
    })

    try {
      const rescheduledJobId = await store.enqueue({ jobName: ReschedulingLocalJob.jobName(), args: [], options: cappedOptions })

      await store.rejectionsObserved.promise
      const followingJobId = await store.enqueue({ jobName: RecordingLocalJob.jobName(), args: ["following"], options: cappedOptions })

      await dispatcher.waitForIdle()
      expect((await store.getJob(rescheduledJobId))?.status).toEqual("queued")
      expect((await store.getJob(rescheduledJobId))?.scheduledAtMs).toEqual(clock.now() + 500)
      expect((await store.getJob(followingJobId))?.status).toEqual("completed")
      await clock.advance(500)
      await dispatcher.waitForIdle()
      expect((await store.getJob(rescheduledJobId))?.status).toEqual("completed")
      expect(ReschedulingLocalJob.attempts).toEqual(2)
    } finally {
      await dispatcher.stop()
    }
  })

  it("schedules bounded recovery when the immediate acknowledgement retry also fails", async () => {
    resetLocalBackgroundJobClasses()
    const { clock, configuration, dispatcher, store } = await acknowledgementRecoveryHarness({
      acknowledgementMethod: "markCompleted",
      acknowledgementRejections: 2,
      jobClasses: [RecordingLocalJob]
    })
    /** @type {Array<{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error}>} */
    const frameworkErrors = []
    /** @type {Array<{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error, errorType: string}>} */
    const allErrors = []
    const repeatedErrorObserved = deferred()
    const onFrameworkError = (payload) => {
      frameworkErrors.push(payload)
      if (frameworkErrors.length === 2) repeatedErrorObserved.resolve(undefined)
    }
    const onAllError = (payload) => allErrors.push(payload)

    configuration.getErrorEvents().on("framework-error", onFrameworkError)
    configuration.getErrorEvents().on("all-error", onAllError)

    try {
      const jobId = await store.enqueue({ jobName: RecordingLocalJob.jobName(), args: ["recovered-by-timer"], options: cappedOptions })

      await repeatedErrorObserved.promise
      expect(store.acknowledgementAttempts).toEqual(2)
      expect([...clock.timers.values()].map((timer) => timer.scheduledAtMs)).toEqual([clock.now() + 1_000])
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")
      await clock.advance(1_000)
      await dispatcher.waitForIdle()
      expect(store.acknowledgementAttempts).toEqual(3)
      expect((await store.getJob(jobId))?.status).toEqual("completed")
      expect(RecordingLocalJob.performances).toEqual([["recovered-by-timer"]])
      expect(frameworkErrors.length).toEqual(2)
      expect(allErrors.map((payload) => payload.errorType)).toEqual(["framework-error", "framework-error"])
    } finally {
      configuration.getErrorEvents().off("framework-error", onFrameworkError)
      configuration.getErrorEvents().off("all-error", onAllError)
      await dispatcher.stop()
    }
  })
})
