// @ts-check

import { outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson } from "../helpers/background-jobs-helper.js"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("Background jobs - job reschedule", {databaseCleaning: {truncate: true}}, () => {
  it("reuses the same row later without failure events in inline and pooled modes", async () => {
    const {main, store, worker} = await startBackgroundJobs({workerOptions: {pooledRunnerCount: 1}})
    const failures = []
    const allErrors = []
    const errorEvents = dummyConfiguration.getErrorEvents()
    const onFailure = (payload) => failures.push(payload)
    const onAllError = (payload) => allErrors.push(payload)
    errorEvents.on("background-job-failed", onFailure)
    errorEvents.on("all-error", onAllError)

    try {
      for (const executionMode of ["inline", "pooled"]) {
        const outputPath = await outputPathFor(`job-reschedule-${executionMode}`)
        const jobId = await store.enqueue({
          jobName: "RescheduleTestJob",
          args: [outputPath, 100],
          options: {executionMode}
        })

        await main._drain()
        await waitForJobCompleted({jobId, store})

        expect(await waitForOutputJson({outputPath})).toEqual({runs: 2})
        expect(await store.getJob(jobId)).toMatchObject({id: jobId, status: "completed", attempts: 0, lastError: null})
      }

      expect(failures).toEqual([])
      expect(allErrors).toEqual([])
    } finally {
      errorEvents.off("background-job-failed", onFailure)
      errorEvents.off("all-error", onAllError)
      await worker.stop({timeoutMs: 1000})
      await main.stop()
    }
  })

  it("treats an invalid delay as an ordinary job failure", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("job-reschedule-invalid")
    const jobId = await store.enqueue({
      jobName: "RescheduleTestJob",
      args: [outputPath, -1],
      options: {executionMode: "inline", maxRetries: 0}
    })

    try {
      await main._drain()
      await waitForOutputJson({outputPath})
      await timeout({timeout: 2000}, async () => {
        while ((await store.getJob(jobId))?.status !== "failed") await wait(0.01)
      })

      expect(await store.getJob(jobId)).toMatchObject({status: "failed", attempts: 1})
    } finally {
      await worker.stop({timeoutMs: 1000})
      await main.stop()
    }
  })
})
