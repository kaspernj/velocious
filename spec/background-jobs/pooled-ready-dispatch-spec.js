// @ts-check

import {deferred} from "awaitery"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import {afterAll, beforeAll, describe, expect, it} from "../../src/testing/test.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import SocketBarrierTestJob from "../dummy/src/jobs/socket-barrier-test-job.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"
import {outputPathFor, startBackgroundJobs, waitForOutputJson} from "../helpers/background-jobs-helper.js"

/** @type {Awaited<ReturnType<typeof startBackgroundJobs>> | undefined} */
let backgroundJobs

describe("Background jobs - pooled ready dispatch", {tags: ["dummy"], databaseCleaning: {truncate: true}}, () => {
  beforeAll(async () => {
    backgroundJobs = await startBackgroundJobs({workerOptions: {pooledRunnerConcurrency: 5, pooledRunnerCount: 1}})
  })

  afterAll(async () => {
    if (!backgroundJobs) return
    await backgroundJobs.worker.stop({timeoutMs: 3000})
    await backgroundJobs.main.stop()
  })

  it("fills every advertised pooled slot without waiting for an earlier job to finish", async () => {
    if (!backgroundJobs) throw new Error("Expected background jobs to be started")
    const barrier = await createBackgroundJobsSocketBarrier(5)
    const jobIds = []

    try {
      for (let index = 0; index < 5; index += 1) {
        jobIds.push(await SocketBarrierTestJob.performLaterWithOptions({
          args: [barrier.port],
          options: {executionMode: "pooled"}
        }))
      }

      await barrier.waiting

      const jobs = await Promise.all(jobIds.map(async (jobId) => await backgroundJobs.store.getJob(jobId)))

      expect(jobs.every((job) => job?.status === "handed_off")).toEqual(true)
      expect(backgroundJobs.worker.pooledChildStates.values().next().value?.inflight.size).toEqual(5)
      const inflightJobs = [...backgroundJobs.worker.inflightPooledJobs]

      barrier.release()
      await Promise.all(inflightJobs)
    } finally {
      await barrier.close()
    }
  })

  it("admits already-queued work after a pooled child exits while its failure report is slow", async () => {
    if (!backgroundJobs) throw new Error("Expected background jobs to be started")
    const firstId = await SlowTestJob.performLaterWithOptions({
      args: ["crashed", await outputPathFor("pooled-ready-crash-first"), 10_000],
      options: {executionMode: "pooled", maxRetries: 0}
    })
    await backgroundJobs.main._drain()

    await timeout({timeout: 2000}, async () => {
      while (backgroundJobs.worker.inflightPooledJobs.size === 0) await wait(0.01)
    })

    const child = [...backgroundJobs.worker.pooledChildren][0]
    if (!child) throw new Error("Expected a pooled child")
    await timeout({timeout: 2000}, async () => {
      while (backgroundJobs.worker.pooledChildStates.get(child)?.started !== true) await wait(0.01)
    })

    const secondOutputPath = await outputPathFor("pooled-ready-crash-second")
    const secondId = await backgroundJobs.store.enqueue({
      args: ["admitted", secondOutputPath],
      jobName: "TestJob",
      options: {executionMode: "pooled"}
    })
    expect((await backgroundJobs.store.getJob(secondId))?.status).toEqual("queued")

    const failureReportStarted = deferred()
    const failureReportCompleted = deferred()
    const releaseFailureReport = deferred()
    const originalReporter = backgroundJobs.worker.statusReporter
    if (!originalReporter) throw new Error("Expected a worker status reporter")
    backgroundJobs.worker.statusReporter = /** @type {import("../../src/background-jobs/status-reporter.js").default} */ (/** @type {unknown} */ ({
      reportWithRetry: async (args) => {
        if (args.status !== "failed" || args.jobId !== firstId) return await originalReporter.reportWithRetry(args)

        failureReportStarted.resolve(undefined)
        await releaseFailureReport.promise
        const result = await originalReporter.reportWithRetry(args)

        failureReportCompleted.resolve(undefined)
        return result
      }
    }))

    try {
      child.kill("SIGKILL")

      await timeout({errorMessage: "Killed pooled job failure report did not start", timeout: 2000}, async () => {
        await failureReportStarted.promise
      })
      await waitForOutputJson({outputPath: secondOutputPath})

      expect((await backgroundJobs.store.getJob(firstId))?.status).toEqual("handed_off")

      releaseFailureReport.resolve(undefined)
      await timeout({errorMessage: "Killed pooled job failure report did not complete", timeout: 2000}, async () => {
        await failureReportCompleted.promise
      })
      expect((await backgroundJobs.store.getJob(firstId))?.status).toEqual("failed")
    } finally {
      releaseFailureReport.resolve(undefined)
      backgroundJobs.worker.statusReporter = originalReporter
    }
  })
})
