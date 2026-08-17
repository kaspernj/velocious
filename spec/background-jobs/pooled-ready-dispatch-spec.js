// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import {afterAll, beforeAll, describe, expect, it} from "../../src/testing/test.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"
import {outputPathFor, startBackgroundJobs} from "../helpers/background-jobs-helper.js"

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
    const jobIds = []

    for (let index = 0; index < 5; index += 1) {
      const outputPath = await outputPathFor(`pooled-ready-dispatch-${index}`)
      jobIds.push(await SlowTestJob.performLaterWithOptions({
        args: [`job-${index}`, outputPath, 2000],
        options: {executionMode: "pooled"}
      }))
    }

    await timeout({timeout: 1000}, async () => {
      while (true) {
        const jobs = await Promise.all(jobIds.map(async (jobId) => await backgroundJobs.store.getJob(jobId)))
        if (jobs.every((job) => job?.status === "handed_off")) break
        await wait(0.01)
      }
    })

    expect(backgroundJobs.worker.pooledChildStates.values().next().value?.inflight.size).toEqual(5)
  })
})
