// @ts-check

import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs/test-job.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson} from "../helpers/background-jobs-helper.js"

describe("Background jobs - custom adapter Node wake-up", {databaseCleaning: {truncate: true}}, () => {
  it("routes an explicit SQL adapter producer through main so an idle worker wakes", async () => {
    const {main, store, worker} = await startBackgroundJobs({
      backgroundJobsConfig: {
        adapter: ({configuration}) => new SqlBackgroundJobsAdapter({configuration}),
        dispatchStrategy: "beacon",
        mode: "background"
      }
    })
    const outputPath = await outputPathFor("custom-adapter-wake")

    try {
      await timeout({timeout: 1000}, async () => {
        while (main.readyWorkers.size !== 1 || main._draining) await wait(0.01)
      })
      await main._drain()

      const jobId = await TestJob.performLater("custom-adapter", outputPath)

      expect(await waitForOutputJson({outputPath, timeoutSeconds: 1})).toEqual({message: "custom-adapter"})
      await waitForJobCompleted({jobId, store})
    } finally {
      await worker.stop()
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })
})
