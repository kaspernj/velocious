// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import {afterAll, beforeAll, describe, expect, it} from "../../src/testing/test.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import SocketBarrierTestJob from "../dummy/src/jobs/socket-barrier-test-job.js"
import TestJob from "../dummy/src/jobs/test-job.js"
import {outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson} from "../helpers/background-jobs-helper.js"

/** @type {Awaited<ReturnType<typeof startBackgroundJobs>> | undefined} */
let backgroundJobs

describe("Background jobs - pooled child acceptance", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  beforeAll(async () => {
    backgroundJobs = await startBackgroundJobs({workerOptions: {pooledRunnerConcurrency: 1, pooledRunnerCount: 1}})
  })

  afterAll(async () => {
    if (!backgroundJobs) return
    await backgroundJobs.worker.stop({timeoutMs: 3000})
    await backgroundJobs.main.stop()
  })

  it("persists pooled child identity and ordered acceptance evidence for a completed job", async () => {
    if (!backgroundJobs) throw new Error("Expected background jobs to be started")
    const outputPath = await outputPathFor("pooled-child-acceptance")
    const jobId = await TestJob.performLaterWithOptions({
      args: ["accepted", outputPath],
      options: {executionMode: "pooled"}
    })

    await waitForOutputJson({outputPath, timeoutSeconds: 15})
    await waitForJobCompleted({jobId, store: backgroundJobs.store, timeoutSeconds: 15})

    const job = await backgroundJobs.store.getJob(jobId)
    if (!job) throw new Error(`Expected background job to exist: ${jobId}`)

    expect(job.status).toEqual("completed")
    expect(job.childInstanceId).not.toBeNull()
    expect(job.childPid).not.toBeNull()
    expect(job.childReceivedAtMs).not.toBeNull()
    expect(job.childStartedAtMs).not.toBeNull()
    expect(job.handedOffAtMs).not.toBeNull()

    if (job.childPid === null || job.childReceivedAtMs === null || job.childStartedAtMs === null || job.handedOffAtMs === null) {
      throw new Error("Expected complete child acceptance evidence")
    }

    expect(job.childReceivedAtMs).toBeGreaterThanOrEqual(job.handedOffAtMs)
    expect(job.childStartedAtMs).toBeGreaterThanOrEqual(job.childReceivedAtMs)

    const childPids = [...backgroundJobs.worker.pooledChildren].map((child) => child.pid).filter((pid) => typeof pid === "number")

    expect(childPids).toContain(job.childPid)
  })

  it("exposes accepted runner evidence while the job is still running in the child", async () => {
    if (!backgroundJobs) throw new Error("Expected background jobs to be started")
    const barrier = await createBackgroundJobsSocketBarrier(1)

    try {
      const jobId = await SocketBarrierTestJob.performLaterWithOptions({
        args: [barrier.port],
        options: {executionMode: "pooled"}
      })

      await barrier.waiting

      let job
      await timeout({timeout: 5000}, async () => {
        while (true) {
          job = await backgroundJobs.store.getJob(jobId)
          if (job?.childStartedAtMs) break
          await wait(0.01)
        }
      })

      if (!job) throw new Error(`Expected background job to exist: ${jobId}`)
      if (job.childInstanceId === null || job.childPid === null || job.childReceivedAtMs === null || job.childStartedAtMs === null) {
        throw new Error("Expected complete child acceptance evidence while running")
      }

      expect(job.status).toEqual("handed_off")
      expect(job.childInstanceId).not.toBeNull()
      expect(job.childPid).not.toBeNull()
      expect(job.childStartedAtMs).toBeGreaterThanOrEqual(job.childReceivedAtMs)
    } finally {
      barrier.release()
      await barrier.close()
    }
  })
})
