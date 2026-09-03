// @ts-check

import {deferred} from "awaitery"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import {afterAll, beforeAll, describe, expect, it} from "../../src/testing/test.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import SocketBarrierTestJob from "../dummy/src/jobs/socket-barrier-test-job.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {outputPathFor, startBackgroundJobs, waitForOutputJson} from "../helpers/background-jobs-helper.js"

/** @type {Awaited<ReturnType<typeof startBackgroundJobs>> | undefined} */
let backgroundJobs

describe("Background jobs - pooled ready dispatch", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
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

  it("emits one shared runner-exit provenance snapshot for every job lost with a pooled child", async () => {
    if (!backgroundJobs) throw new Error("Expected background jobs to be started")
    const barrier = await createBackgroundJobsSocketBarrier(2)
    const failureEvents = []
    const failuresReceived = deferred()
    const jobIds = []
    const onFailure = (payload) => {
      if (!jobIds.includes(payload.context.jobId)) return

      failureEvents.push(payload)
      if (failureEvents.length === 2) failuresReceived.resolve(undefined)
    }

    dummyConfiguration.getErrorEvents().on("background-job-failed", onFailure)

    try {
      for (let index = 0; index < 2; index += 1) {
        jobIds.push(await SocketBarrierTestJob.performLaterWithOptions({
          args: [barrier.port],
          options: {executionMode: "pooled", maxRetries: 0}
        }))
      }

      await barrier.waiting

      const childEntry = [...backgroundJobs.worker.pooledChildStates]
        .find(([, state]) => jobIds.every((jobId) => state.inflight.has(jobId)))
      if (!childEntry) throw new Error("Expected both jobs to share one pooled child")
      const [child] = childEntry
      const runnerPid = child.pid
      if (!runnerPid) throw new Error("Expected pooled child pid")

      child.kill("SIGKILL")
      await timeout({errorMessage: "Killed pooled jobs did not report both failures", timeout: 2000}, async () => {
        await failuresReceived.promise
      })

      const failedJobs = await Promise.all(jobIds.map(async (jobId) => await backgroundJobs.store.getJob(jobId)))
      const runnerFailures = failureEvents.map((event) => event.context.runnerFailure)

      expect(failedJobs.map((job) => job?.status)).toEqual(["failed", "failed"])
      expect(runnerFailures[0]).toEqual(runnerFailures[1])
      expect(runnerFailures.map((failure) => failure.activeJobs.map((job) => job.jobId))).toEqual([
        [...jobIds].sort(),
        [...jobIds].sort()
      ])

      for (const failure of runnerFailures) {
        expect(failure.exitCode).toEqual(null)
        expect(failure.generationId).toEqual(null)
        expect(failure.oomKilled).toEqual(null)
        expect(failure.origin).toEqual("exit")
        expect(failure.runnerDetached).toEqual(false)
        expect(failure.runnerLifecycle).toEqual("running")
        expect(failure.runnerPid).toEqual(runnerPid)
        expect(failure.signal).toEqual("SIGKILL")
        expect(failure.terminationReason).toEqual("unexpected")
        expect(failure.workerId).toEqual(backgroundJobs.worker.workerId)
        expect(failure.workerLifecycle).toEqual("running")
        expect(failure.workerPid).toEqual(process.pid)
        expect(failure.activeJobs.every((job) => typeof job.handoffId === "string")).toEqual(true)
        expect(failure.activeJobs.every((job) => typeof job.handedOffAtMs === "number")).toEqual(true)
        expect(failure.activeJobs.every((job) => job.workerId === backgroundJobs.worker.workerId)).toEqual(true)
      }
    } finally {
      dummyConfiguration.getErrorEvents().off("background-job-failed", onFailure)
      barrier.release()
      await barrier.close()
    }
  })
})
