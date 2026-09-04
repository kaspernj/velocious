// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import AppendJob from "../dummy/src/jobs/append-job.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import BackgroundJobsTestAdapter from "../helpers/background-jobs-test-adapter.js"
import {
  outputPathFor,
  startBackgroundJobs,
  waitForJobCompleted,
  waitForOutputJson,
  withBackgroundJobs
} from "../helpers/background-jobs-helper.js"

class MaintenanceAdapter extends BackgroundJobsTestAdapter {
  /** @param {{reconciliationError?: Error}} [args] - Adapter behavior. */
  constructor({reconciliationError} = {}) {
    super()
    this.reconciliationCount = 0
    this.reconciliationError = reconciliationError
  }

  /** @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow[]>} - No orphans. */
  async markOrphanedJobs() { return [] }

  /** @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobConcurrencyReconciliation>} - Empty result or failure. */
  async reconcileActiveConcurrency() {
    this.reconciliationCount++
    if (this.reconciliationError) throw this.reconciliationError

    return {candidateCount: 0, checkedCount: 0, repairedCount: 0, repairs: [], repairsTruncatedCount: 0}
  }
}

class MainWithMaintenanceAdapter extends BackgroundJobsMain {
  /** @param {ConstructorParameters<typeof BackgroundJobsMain>[0] & {adapter: MaintenanceAdapter}} args - Main options. */
  constructor({adapter, ...args}) {
    super(args)
    this.store = adapter
  }
}

describe("Background jobs - live concurrency reconciliation", {databaseCleaning: {transaction: true}}, () => {
  it("repairs a stale saturated counter and dispatches queued work without restarting the main", async () => {
    try {
      await withBackgroundJobs(async ({main, store}) => {
        const outputPath = await outputPathFor("live-concurrency-reconciliation")

        await store.enqueue({
          jobName: AppendJob.jobName(),
          args: ["future", outputPath],
          options: {executionMode: "inline", queue: "limited", scheduledAtMs: Date.now() + 60000}
        })
        await store._withDb(async (db) => await db.update({
          tableName: "background_job_concurrency",
          data: {active_count: 1},
          conditions: {concurrency_key: "queue:limited"}
        }))
        const jobId = await store.enqueue({
          jobName: AppendJob.jobName(),
          args: ["repaired", outputPath],
          options: {executionMode: "inline", queue: "limited"}
        })

        await main._drain()
        expect(await store.getJob(jobId)).toMatchObject({status: "queued"})

        await main._sweepOrphans()

        expect(await waitForOutputJson({outputPath})).toEqual(["repaired"])
        await waitForJobCompleted({jobId, store})
      }, {
        start: async ({workerOptions}) => await startBackgroundJobs({
          backgroundJobsConfig: {queues: {limited: {maxConcurrent: 1}}},
          workerOptions
        }),
        workerOptions: {maxConcurrentInlineJobs: 1}
      })
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("runs live reconciliation only for the active main", async () => {
    const adapter = new MaintenanceAdapter()
    const main = new MainWithMaintenanceAdapter({adapter, configuration: dummyConfiguration, host: "127.0.0.1", port: 0})

    main.lifecycleState = "candidate"
    await main._sweepOrphans()
    expect(adapter.reconciliationCount).toEqual(0)

    main.lifecycleState = "active"
    await main._sweepOrphans()
    expect(adapter.reconciliationCount).toEqual(1)
  })

  it("reports live reconciliation failures without failing orphan maintenance", async () => {
    const adapter = new MaintenanceAdapter({reconciliationError: new Error("reconciliation failed")})
    const main = new MainWithMaintenanceAdapter({adapter, configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    const frameworkErrors = []
    const allErrors = []
    const errorEvents = dummyConfiguration.getErrorEvents()
    const onFrameworkError = (payload) => frameworkErrors.push(payload)
    const onAllError = (payload) => allErrors.push(payload)

    main.lifecycleState = "active"
    errorEvents.on("framework-error", onFrameworkError)
    errorEvents.on("all-error", onAllError)

    try {
      await main._sweepOrphans()
    } finally {
      errorEvents.off("framework-error", onFrameworkError)
      errorEvents.off("all-error", onAllError)
    }

    expect(frameworkErrors).toMatchObject([{
      context: {stage: "background-job-concurrency-reconciliation"},
      error: {message: "reconciliation failed"}
    }])
    expect(allErrors).toMatchObject([{
      context: {stage: "background-job-concurrency-reconciliation"},
      error: {message: "reconciliation failed"},
      errorType: "framework-error"
    }])
  })
})
