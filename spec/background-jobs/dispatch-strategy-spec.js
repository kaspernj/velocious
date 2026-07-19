// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import {outputPathFor, startBackgroundJobs, startBackgroundJobsMain, waitForOutputJson} from "../helpers/background-jobs-helper.js"
import PruneTerminalBackgroundJobsJob from "../../src/jobs/prune-terminal-background-jobs.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import QueuedTestJob from "../dummy/src/jobs/queued-test-job.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - dispatch strategy", {databaseCleaning: {truncate: true}}, () => {
  it("does not start a polling interval in the default (beacon) mode", async () => {
    const {main} = await startBackgroundJobsMain()

    try {
      expect(main.dispatchStrategy).toEqual("beacon")
      expect(main._pollTimer).toBeUndefined()
    } finally {
      await main.stop()
    }
  })

  it("starts a polling interval when dispatchStrategy is 'polling'", async () => {
    const {main} = await startBackgroundJobsMain({backgroundJobsConfig: {dispatchStrategy: "polling", pollIntervalMs: 50}})

    try {
      expect(main.dispatchStrategy).toEqual("polling")
      expect(main._pollTimer).toBeTruthy()
    } finally {
      await main.stop()
      dummyConfiguration.setBackgroundJobsConfig({dispatchStrategy: "beacon", pollIntervalMs: 1000})
    }
  })

  it("dispatches enqueued jobs without polling in beacon mode", async () => {
    const {main, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("beacon-dispatch")

    try {
      // Confirm no poll timer is active.
      expect(main._pollTimer).toBeUndefined()

      await TestJob.performLaterWithOptions({
        args: ["beacon-dispatched", outputPath],
        options: {executionMode: "inline"}
      })

      const result = await waitForOutputJson({outputPath})
      expect(result).toEqual({message: "beacon-dispatched"})
    } finally {
      await worker.stop()
      await main.stop()
    }
  })

  it("arms a scheduled-job timer for future-scheduled work in beacon mode", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    // Pre-create a future-scheduled job so the dispatcher's initial drain
    // calls `_armScheduledTimer` against a real future timestamp.
    const futureJobId = await store.enqueue({jobName: "TestJob", args: ["future"], options: {executionMode: "inline", maxRetries: 5}})
    const handoff = await store.markHandedOff({jobId: futureJobId, workerId: "worker-z"})
    if (!handoff) throw new Error("Expected the future job to be handed off")
    await store.markFailed({jobId: futureJobId, error: "transient", workerId: "worker-z", ...handoff})

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    try {
      expect(main._scheduledTimer).toBeTruthy()
    } finally {
      await main.stop()
      await store.clearAll()
    }
  })

  it("arms a retry timer when a drain fails and clears it after recovery", async () => {
    const {main} = await startBackgroundJobsMain()

    try {
      const originalNextAvailableJob = main.store.nextAvailableJob.bind(main.store)
      let throwOnce = true
      main.store.nextAvailableJob = async () => {
        if (throwOnce) {
          throwOnce = false
          throw new Error("simulated transient DB failure")
        }
        return await originalNextAvailableJob()
      }

      // Make the store look like it has a ready worker so the drain
      // actually calls `nextAvailableJob()` — the loop is gated on
      // `readyWorkers.size > 0`.
      const fakeWorker = /** @type {any} */ ({
        workerId: "fake",
        send: () => {},
        supportsHandoffIdReporting: true
      })
      main.readyWorkers.add(fakeWorker)

      await main._drain()

      expect(main._errorRetryTimer).toBeTruthy()

      // Subsequent successful drain clears the retry timer.
      await main._drain()
      expect(main._errorRetryTimer).toBeUndefined()
    } finally {
      await main.stop()
    }
  })

  it("registers retention pruning as a normal scheduled job on the scheduler", async () => {
    const {main, store} = await startBackgroundJobsMain({
      backgroundJobsConfig: {retention: {sweepIntervalMs: 50, completedTtlMs: 1000}}
    })

    try {
      let prunedJobRow = /** @type {Record<string, ?> | null} */ (null)
      const deadline = Date.now() + 3000

      while (Date.now() < deadline) {
        const rows = await store._withDb(async (db) =>
          await db.newQuery().from("background_jobs").where({job_name: PruneTerminalBackgroundJobsJob.jobName()}).limit(1).results()
        )

        if (rows.length > 0) {
          prunedJobRow = rows[0]
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      expect(prunedJobRow).toBeTruthy()
      expect(String(prunedJobRow?.status)).toEqual("queued")
    } finally {
      await main.stop()
      dummyConfiguration.setBackgroundJobsConfig({dispatchStrategy: "beacon", pollIntervalMs: 1000})
    }
  })

  it("applies a scheduled job's static queue when enqueuing", async () => {
    const {main, store} = await startBackgroundJobsMain()

    try {
      main.scheduler.scheduleJob({jobConfiguration: {class: QueuedTestJob, every: 50}, jobKey: "queuedTestJob"})

      let enqueuedRow = /** @type {Record<string, ?> | null} */ (null)
      const deadline = Date.now() + 3000

      while (Date.now() < deadline) {
        const rows = await store._withDb(async (db) =>
          await db.newQuery().from("background_jobs").where({job_name: QueuedTestJob.jobName()}).limit(1).results()
        )

        if (rows.length > 0) {
          enqueuedRow = rows[0]
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      expect(enqueuedRow).toBeTruthy()
      expect(String(enqueuedRow?.queue)).toEqual("builds")
    } finally {
      await main.stop()
    }
  })
})
