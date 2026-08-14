// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs/test-job.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {outputPathFor, waitForJobCompleted, waitForOutputJson} from "../helpers/background-jobs-helper.js"

describe("Background jobs - main adapter restart", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("acquires a new factory adapter on the same main instance and dispatches with it", async () => {
    await dummyConfiguration.closeBackgroundJobsAdapter()
    const adapters = []

    dummyConfiguration.setBackgroundJobsConfig({
      adapter: ({configuration}) => {
        const adapter = new SqlBackgroundJobsAdapter({configuration})
        adapters.push(adapter)
        return adapter
      },
      mode: "background"
    })

    const main = new BackgroundJobsMain({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      host: "127.0.0.1",
      port: 0
    })
    /** @type {BackgroundJobsWorker | undefined} */
    let worker

    try {
      await main.start()
      expect(main.adapter).toEqual(adapters[0])
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()

      await main.start()

      expect(adapters.length).toEqual(2)
      expect(main.adapter).toEqual(adapters[1])

      worker = new BackgroundJobsWorker({
        closeDatabaseConnectionsOnStop: false,
        configuration: dummyConfiguration,
        host: "127.0.0.1",
        port: main.getPort()
      })
      await worker.start()
      await timeout({timeout: 1000}, async () => {
        while (main.readyWorkers.size !== 1 || main._draining) await wait(0.01)
      })

      const outputPath = await outputPathFor("main-adapter-restart")
      const jobId = await adapters[1].enqueue({
        jobName: TestJob.jobName(),
        args: ["restarted", outputPath],
        options: {executionMode: "inline"}
      })

      await main._drain()
      expect(await waitForOutputJson({outputPath})).toEqual({message: "restarted"})
      await waitForJobCompleted({jobId, store: adapters[1]})
    } finally {
      await worker?.stop({timeoutMs: 1000})
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })
})
