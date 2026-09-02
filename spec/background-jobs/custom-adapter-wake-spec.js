// @ts-check

import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
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
      await main._drain()

      const jobId = await TestJob.performLater("custom-adapter", outputPath)

      await waitForJobCompleted({jobId, store})
      expect(await waitForOutputJson({outputPath})).toEqual({message: "custom-adapter"})
    } finally {
      await worker.stop()
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })
})
