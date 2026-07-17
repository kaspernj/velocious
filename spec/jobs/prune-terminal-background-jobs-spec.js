// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import PruneTerminalBackgroundJobsJob from "../../src/jobs/prune-terminal-background-jobs.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("PruneTerminalBackgroundJobsJob", {databaseCleaning: {truncate: true}}, () => {
  it("uses a reserved job name that an app job cannot shadow via the class name", () => {
    expect(PruneTerminalBackgroundJobsJob.jobName()).toEqual("velocious:prune-terminal-background-jobs")
    expect(PruneTerminalBackgroundJobsJob.jobName()).not.toEqual(PruneTerminalBackgroundJobsJob.name)
  })

  it("returns a schedule configuration when retention is enabled", () => {
    const config = PruneTerminalBackgroundJobsJob.scheduleConfiguration({
      completedTtlMs: 604800000,
      failedTtlMs: null,
      batchSize: 1000,
      sweepIntervalMs: 3600000
    })

    expect(config?.class).toEqual(PruneTerminalBackgroundJobsJob)
    expect(config?.every).toEqual(3600000)
    expect(config?.options).toEqual({concurrencyKey: "velocious-prune-terminal-background-jobs", maxConcurrency: 1, deduplicateWhileQueued: true})
  })

  it("returns null when retention is fully disabled", () => {
    expect(PruneTerminalBackgroundJobsJob.scheduleConfiguration({completedTtlMs: null, failedTtlMs: null, batchSize: 1000, sweepIntervalMs: 3600000})).toEqual(null)
    expect(PruneTerminalBackgroundJobsJob.scheduleConfiguration({completedTtlMs: 0, failedTtlMs: 0, batchSize: 1000, sweepIntervalMs: 3600000})).toEqual(null)
  })

  it("prunes completed rows past the retention window when performed", async () => {
    dummyConfiguration.setCurrent()
    dummyConfiguration.setBackgroundJobsConfig({retention: {completedTtlMs: 7 * 24 * 60 * 60 * 1000}})

    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})
    const handoff = await store.markHandedOff({jobId, workerId: "w"})
    if (!handoff) throw new Error("Expected the job to be handed off")
    await store.markCompleted({jobId, workerId: "w", ...handoff})

    // Age the completion past the 7-day window.
    await store._withDb(async (db) => {
      await db.query(`UPDATE background_jobs SET completed_at_ms = ${db.quote(Date.now() - 10 * 24 * 60 * 60 * 1000)} WHERE id = ${db.quote(jobId)}`)
    })

    await new PruneTerminalBackgroundJobsJob().perform()

    expect(await store.getJob(jobId)).toEqual(null)
  })
})
