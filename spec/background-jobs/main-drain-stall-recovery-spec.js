// @ts-check

import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import { describe, expect, it } from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { addReadyPooledWorker, startBackgroundJobsMain } from "../helpers/background-jobs-helper.js"

class StallControllableAdapter extends SqlBackgroundJobsAdapter {
  /** @param {ConstructorParameters<typeof SqlBackgroundJobsAdapter>[0]} args - Adapter options. */
  constructor(args) {
    super(args)

    this.stallNextJobLookup = false
    this.stallNextHandoff = false
    /** @type {Array<{handoffId: string, jobId: string}>} */
    this.returnRequests = []
  }

  /**
   * @param {object} [args] - Options.
   * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow | null>} - Next job.
   */
  async nextAvailableJob(args = {}) {
    if (this.stallNextJobLookup) {
      this.stallNextJobLookup = false

      return await new Promise(() => {})
    }

    return await super.nextAvailableJob(args)
  }

  /**
   * @param {import("../../src/background-jobs/types.js").BackgroundJobHandoffRequest} args - Claim request.
   * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobHandoff | null>} - Claim result.
   */
  async markHandedOff(args) {
    if (this.stallNextHandoff) {
      this.stallNextHandoff = false

      return await new Promise(() => {})
    }

    return await super.markHandedOff(args)
  }

  /**
   * @param {{handoffId: string, jobId: string}} args - Exact release request.
   * @returns {Promise<void>} - Resolves when acknowledged.
   */
  async markReturnedToQueue(args) {
    this.returnRequests.push({...args})
    await super.markReturnedToQueue(args)
  }
}

/**
 * Starts a main whose drain store operations time out quickly so tests can
 * drive a never-settling store call to the bounded stall path.
 * @returns {Promise<{adapter: StallControllableAdapter, main: import("../../src/background-jobs/main.js").default}>} - Started test services.
 */
async function startStallRecoveryMain() {
  const adapter = new StallControllableAdapter({configuration: dummyConfiguration})
  const {main} = await startBackgroundJobsMain({
    backgroundJobsConfig: {adapter, drainStoreOperationTimeoutMs: 50, pollIntervalMs: 60000}
  })

  return {adapter, main}
}

/** @param {StallControllableAdapter} adapter - Store. @returns {Promise<string>} - Job id. */
async function enqueuePooledJob(adapter) {
  return await adapter.enqueue({
    args: [],
    jobName: "TestJob",
    options: {concurrencyKey: "drain-stall", executionMode: "pooled", maxConcurrency: 1}
  })
}

describe("Background jobs - main drain stall recovery", {databaseCleaning: {truncate: true}}, () => {
  it("bounds a never-settling job lookup, reports the stall, and resumes dispatching", async () => {
    const {adapter, main} = await startStallRecoveryMain()
    const worker = addReadyPooledWorker(main, "stall-recovery-worker")
    const frameworkErrors = []
    const onFrameworkError = (payload) => frameworkErrors.push(payload)

    dummyConfiguration.getErrorEvents().on("framework-error", onFrameworkError)

    try {
      const jobId = await enqueuePooledJob(adapter)

      adapter.stallNextJobLookup = true
      await main._drain()

      expect(frameworkErrors).toMatchObject([{
        context: {
          drainStoreOperationTimeoutMs: 50,
          stage: "background-jobs-drain-stall"
        },
        error: {message: "Background jobs drain store operation timed out after 50ms: next-available-job"}
      }])
      expect(main._drainPromise).toEqual(undefined)
      expect(worker.receivedJobs).toEqual([])

      await main._drain()

      expect(worker.receivedJobs).toMatchObject([{id: jobId}])
      expect((await adapter.getJob(jobId))?.status).toEqual("handed_off")
    } finally {
      dummyConfiguration.getErrorEvents().off("framework-error", onFrameworkError)
      await main.stop()
    }
  })

  it("bounds a never-settling handoff claim and recovers the lease through dispatcher recovery", async () => {
    const {adapter, main} = await startStallRecoveryMain()
    const worker = addReadyPooledWorker(main, "stalled-claim-worker")

    try {
      const jobId = await enqueuePooledJob(adapter)

      adapter.stallNextHandoff = true
      await main._drain()

      expect(adapter.returnRequests.length).toEqual(1)
      expect(adapter.returnRequests[0]?.jobId).toEqual(jobId)
      expect((await adapter.getJob(jobId))?.status).toEqual("queued")
      expect(main.pendingHandoffRecoveries.size).toEqual(0)
      expect(worker.availablePooledSlots).toEqual(1)
      expect(main.readyWorkers.has(worker)).toEqual(true)
      expect(worker.receivedJobs).toEqual([])

      await main._drain()

      expect(worker.receivedJobs.length).toEqual(1)
      expect(worker.receivedJobs[0]?.id).toEqual(jobId)
    } finally {
      await main.stop()
    }
  })
})
