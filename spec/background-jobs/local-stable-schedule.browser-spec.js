// @ts-check

import {
  GatedLocalJob,
  RecordingLocalJob,
  RetryingLocalJob,
  gateLocalJob,
  localBackgroundJobsHarness,
  resetLocalBackgroundJobClasses
} from "../helpers/local-background-jobs-test-harness.js"
import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"

/**
 * Clears local queue state before one focused stable-schedule example.
 * @param {Parameters<typeof localBackgroundJobsHarness>[0]} [options] - Harness options.
 * @returns {Promise<Awaited<ReturnType<typeof localBackgroundJobsHarness>>>} - Clean harness.
 */
async function stableScheduleHarness(options) {
  resetLocalBackgroundJobClasses()
  const harness = await localBackgroundJobsHarness(options)

  await harness.adapter.store.clearAll()
  return harness
}

/**
 * Closes dispatch before deleting focused local queue state.
 * @param {Awaited<ReturnType<typeof localBackgroundJobsHarness>>} harness - Owned harness.
 * @returns {Promise<void>} - Resolves after cleanup.
 */
async function closeHarness(harness) {
  await harness.configuration.closeBackgroundJobsAdapter()
  await harness.adapter.store.clearAll()
}

describe("Local background jobs - stable schedules", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("replaces one queued owner while retaining keyed history", async () => {
    const harness = await stableScheduleHarness()
    const {adapter, clock} = harness

    try {
      const first = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:replace",
        args: ["first"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })
      const second = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:replace",
        args: ["second"],
        options: {scheduledAtMs: clock.now() + 120_000}
      })

      expect(second).toEqual({jobId: second.jobId, previousJobId: first.jobId, previousStatus: "queued"})
      expect(await adapter.getJob(first.jobId)).toMatchObject({scheduleKey: "local:replace", status: "cancelled"})
      expect(await adapter.getJob(second.jobId)).toMatchObject({scheduleKey: "local:replace", status: "queued"})
    } finally {
      await closeHarness(harness)
    }
  })

  it("returns not_found when cancellation has no stable owner", async () => {
    const harness = await stableScheduleHarness()

    try {
      expect(await RecordingLocalJob.cancelScheduled("local:missing")).toEqual({jobId: null, outcome: "not_found"})
      expect(await RecordingLocalJob.wakeScheduled("local:missing")).toEqual({jobId: null, outcome: "not_found"})
    } finally {
      await closeHarness(harness)
    }
  })

  it("cancels a queued owner while retaining terminal history", async () => {
    const harness = await stableScheduleHarness()
    const {adapter, clock} = harness

    try {
      const replacement = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:cancel",
        args: ["cancelled"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })

      expect(await RecordingLocalJob.cancelScheduled("local:cancel")).toEqual({jobId: replacement.jobId, outcome: "cancelled"})
      expect(await adapter.getJob(replacement.jobId)).toMatchObject({scheduleKey: "local:cancel", status: "cancelled"})
      expect(await RecordingLocalJob.getScheduledJob("local:cancel", {includeLatestTerminal: true})).toMatchObject({
        currentJob: null,
        latestTerminalJob: {id: replacement.jobId, status: "cancelled"}
      })
    } finally {
      await closeHarness(harness)
    }
  })

  it("keeps a replacement owner when its detached handed-off predecessor completes", async () => {
    const harness = await stableScheduleHarness({jobClasses: [GatedLocalJob, RecordingLocalJob]})
    const {adapter, clock} = harness
    const predecessor = gateLocalJob("stable-replacement-predecessor")

    try {
      const first = await GatedLocalJob.replaceScheduled({
        scheduleKey: "local:handed-off-replacement",
        args: ["stable-replacement-predecessor"]
      })

      await predecessor.started

      const second = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:handed-off-replacement",
        args: ["replacement"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })

      expect(second).toEqual({jobId: second.jobId, previousJobId: first.jobId, previousStatus: "handed_off"})

      predecessor.release()
      await adapter.waitForIdle()

      expect(await RecordingLocalJob.getScheduledJob("local:handed-off-replacement", {includeLatestTerminal: true})).toMatchObject({
        currentJob: {id: second.jobId, status: "queued"},
        latestTerminalJob: {id: first.jobId, status: "completed"}
      })
    } finally {
      predecessor.release()
      await closeHarness(harness)
    }
  })

  it("detaches a handed-off owner without claiming its execution stopped", async () => {
    const harness = await stableScheduleHarness({jobClasses: [GatedLocalJob]})
    const {adapter} = harness
    const running = gateLocalJob("stable-cancellation-handoff")

    try {
      const replacement = await GatedLocalJob.replaceScheduled({
        scheduleKey: "local:handed-off-cancellation",
        args: ["stable-cancellation-handoff"]
      })

      await running.started

      expect(await GatedLocalJob.wakeScheduled("local:handed-off-cancellation")).toEqual({
        jobId: replacement.jobId,
        outcome: "handed_off"
      })
      expect(await GatedLocalJob.cancelScheduled("local:handed-off-cancellation")).toEqual({
        jobId: replacement.jobId,
        outcome: "handed_off"
      })
      expect(await GatedLocalJob.getScheduledJob("local:handed-off-cancellation", {includeLatestTerminal: true})).toEqual({
        currentJob: null,
        latestTerminalJob: null
      })

      running.release()
      await adapter.waitForIdle()

      expect(await GatedLocalJob.getScheduledJob("local:handed-off-cancellation", {includeLatestTerminal: true})).toMatchObject({
        currentJob: null,
        latestTerminalJob: {id: replacement.jobId, status: "completed"}
      })
    } finally {
      running.release()
      await closeHarness(harness)
    }
  })

  it("reads current and latest terminal schedule jobs after close and reopen", async () => {
    const harness = await stableScheduleHarness()
    const {clock, configuration} = harness

    try {
      const first = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:reopen",
        args: ["first"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })
      const second = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:reopen",
        args: ["second"],
        options: {scheduledAtMs: clock.now() + 120_000}
      })

      await configuration.closeBackgroundJobsAdapter()
      await configuration.acquireReadyBackgroundJobsAdapter()

      const scheduled = await RecordingLocalJob.getScheduledJob("local:reopen", {includeLatestTerminal: true})

      expect(scheduled.currentJob).toMatchObject({args: ["second"], id: second.jobId, status: "queued"})
      expect(scheduled.latestTerminalJob).toMatchObject({args: ["first"], id: first.jobId, status: "cancelled"})
    } finally {
      await closeHarness(harness)
    }
  })

  it("orders terminal history by ownership acquired after reversed fixed-clock preparation", async () => {
    const harness = await stableScheduleHarness()
    const {clock, configuration} = harness
    const delayedPrepared = Promise.withResolvers()
    const delayedCanAcquire = Promise.withResolvers()

    class OrderedLocalStore extends LocalBackgroundJobsStore {
      pauseNextConnection = false

      _prepareJob(args) {
        const preparedJob = super._prepareJob(args)
        const identity = args.args[0]

        return {...preparedJob, jobId: identity === "later-owner" ? "a-local-later-owner" : "z-local-earlier-owner"}
      }

      async _withDb(callback) {
        if (this.pauseNextConnection) {
          this.pauseNextConnection = false
          delayedPrepared.resolve()
          await delayedCanAcquire.promise
        }

        return await super._withDb(callback)
      }
    }

    const delayedStore = new OrderedLocalStore({configuration, clock})
    const competingStore = new OrderedLocalStore({configuration, clock})

    try {
      await delayedStore.ensureReady()
      await competingStore.ensureReady()
      delayedStore.pauseNextConnection = true

      const laterOwnerPromise = delayedStore.replaceScheduled({
        scheduleKey: "local:ownership-order",
        jobName: RecordingLocalJob.jobName(),
        args: ["later-owner"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })

      await delayedPrepared.promise

      const earlierOwner = await competingStore.replaceScheduled({
        scheduleKey: "local:ownership-order",
        jobName: RecordingLocalJob.jobName(),
        args: ["earlier-owner"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })

      delayedCanAcquire.resolve()
      const laterOwner = await laterOwnerPromise

      expect(await delayedStore.cancelScheduled("local:ownership-order")).toEqual({jobId: laterOwner.jobId, outcome: "cancelled"})

      const lookup = await delayedStore.getScheduledJob("local:ownership-order", {includeLatestTerminal: true})

      expect(lookup.latestTerminalJob).toMatchObject({args: ["later-owner"], id: laterOwner.jobId, scheduleOrder: 2})
      expect(await delayedStore.getJob(earlierOwner.jobId)).toMatchObject({scheduleOrder: 1, status: "cancelled"})
    } finally {
      delayedCanAcquire.resolve()
      await closeHarness(harness)
    }
  })

  it("wakes a future retry without changing its job or attempt lineage", async () => {
    const harness = await stableScheduleHarness({jobClasses: [RetryingLocalJob]})
    const {adapter, clock} = harness

    try {
      const replacement = await RetryingLocalJob.replaceScheduled({
        scheduleKey: "local:retry-wake",
        args: ["retry-wake", 1],
        options: {maxRetries: 1}
      })

      await adapter.waitForIdle()

      const beforeWake = await adapter.getJob(replacement.jobId)

      expect(beforeWake).toMatchObject({attempts: 1, id: replacement.jobId, status: "queued"})
      expect(beforeWake?.scheduledAtMs).toEqual(clock.now() + 10_000)
      expect(await RetryingLocalJob.wakeScheduled("local:retry-wake")).toEqual({jobId: replacement.jobId, outcome: "woken"})
      await adapter.waitForIdle()

      const afterWake = await adapter.getJob(replacement.jobId)
      const scheduleRows = (await adapter.listJobs()).filter((job) => job.scheduleKey === "local:retry-wake")

      expect(afterWake).toMatchObject({attempts: 1, id: replacement.jobId, lastError: beforeWake?.lastError, status: "completed"})
      expect(scheduleRows.map((job) => job.id)).toEqual([replacement.jobId])
    } finally {
      await closeHarness(harness)
    }
  })

  it("coalesces repeated wake requests onto one stable job row", async () => {
    const harness = await stableScheduleHarness({jobClasses: [GatedLocalJob, RecordingLocalJob], maxConcurrentInlineJobs: 1})
    const {adapter, clock} = harness
    const sentinel = gateLocalJob("stable-wake-sentinel")

    try {
      await adapter.enqueue({jobName: GatedLocalJob.jobName(), args: ["stable-wake-sentinel"]})
      await sentinel.started

      const replacement = await RecordingLocalJob.replaceScheduled({
        scheduleKey: "local:repeated-wake",
        args: ["stable"],
        options: {scheduledAtMs: clock.now() + 60_000}
      })
      const firstWake = await RecordingLocalJob.wakeScheduled("local:repeated-wake")
      const secondWake = await RecordingLocalJob.wakeScheduled("local:repeated-wake")
      const scheduled = await RecordingLocalJob.getScheduledJob("local:repeated-wake", {includeLatestTerminal: true})
      const scheduleRows = (await adapter.listJobs()).filter((job) => job.scheduleKey === "local:repeated-wake")

      expect(firstWake).toEqual({jobId: replacement.jobId, outcome: "woken"})
      expect(secondWake).toEqual({jobId: replacement.jobId, outcome: "already_due"})
      expect(scheduled.currentJob).toMatchObject({attempts: 0, id: replacement.jobId, status: "queued"})
      expect(scheduled.latestTerminalJob).toEqual(null)
      expect(scheduleRows.map((job) => job.id)).toEqual([replacement.jobId])

      sentinel.release()
      await adapter.waitForIdle()
      expect(await adapter.getJob(replacement.jobId)).toMatchObject({attempts: 0, status: "completed"})
    } finally {
      sentinel.release()
      await closeHarness(harness)
    }
  })
})
