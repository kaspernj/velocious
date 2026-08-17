// @ts-check

import {startBackgroundJobsMain} from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - scheduled enqueue drain boundary", {databaseCleaning: {truncate: true}}, () => {
  it("persists later ticks while an unrelated dispatcher drain remains held", async () => {
    dummyConfiguration.setScheduledBackgroundJobsConfig(undefined)
    const {main, store} = await startBackgroundJobsMain()
    let releaseDrain
    const heldDrain = new Promise((resolve) => { releaseDrain = resolve })

    main._drainPromise = heldDrain

    try {
      const scheduler = main.scheduler

      if (!scheduler) throw new Error("Expected the background jobs scheduler to be started")

      const jobConfiguration = {
        args: ["scheduled", "unused-output-path"],
        class: TestJob,
        every: "10m",
        options: {
          concurrencyKey: "scheduled-single-flight",
          executionMode: /** @type {const} */ ("pooled"),
          maxConcurrency: 1
        }
      }

      await scheduler.runScheduledJob({jobConfiguration, jobKey: "scheduledTestJob"})

      expect(scheduler.pendingEnqueuesByJobKey.has("scheduledTestJob")).toBeFalse()

      await scheduler.runScheduledJob({jobConfiguration, jobKey: "scheduledTestJob"})

      // The second timer occurrence reaches durable enqueue. Store-level
      // deduplication preserves the one queued logical-job contract.
      const jobs = await store.listJobs({jobName: TestJob.jobName(), limit: 10})

      expect(jobs.length).toEqual(1)
      expect(jobs[0]).toMatchObject({
        concurrencyKey: "scheduled-single-flight",
        maxConcurrency: 1,
        status: "queued"
      })
      expect(main._drainPromise).toEqual(heldDrain)
    } finally {
      if (releaseDrain) releaseDrain()
      await heldDrain
      main._drainPromise = undefined
      await main.stop()
    }
  })
})
