// @ts-check

import {outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson} from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import DbQueryJob from "../dummy/src/jobs/db-query-job.js"

describe("Background jobs - DB context", {tags: ["dummy"], databaseCleaning: {truncate: true}}, () => {
  it("wraps inline job perform calls in a database connection context", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("db-query-job")

    const originalWithConnections = dummyConfiguration.withConnections.bind(dummyConfiguration)
    let withConnectionsCallsAfterStart = 0
    dummyConfiguration.withConnections = async (...args) => {
      withConnectionsCallsAfterStart++

      return await originalWithConnections(...args)
    }

    let jobId

    try {
      jobId = await DbQueryJob.performLaterWithOptions({
        args: [outputPath],
        options: {forked: false}
      })

      await waitForJobCompleted({jobId, store, timeoutSeconds: 5})
    } finally {
      dummyConfiguration.withConnections = originalWithConnections
    }

    expect(withConnectionsCallsAfterStart).toBeGreaterThan(0)

    const result = await waitForOutputJson({outputPath})

    expect(typeof result.count).toEqual("number")

    await worker.stop()
    await main.stop()
  })
})
