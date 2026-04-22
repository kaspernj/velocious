// @ts-check

import fs from "fs/promises"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import DbQueryJob from "../dummy/src/jobs/db-query-job.js"

describe("Background jobs - DB context", {tags: ["dummy"]}, () => {
  it("wraps inline job perform calls in a database connection context", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    dummyConfiguration.setBackgroundJobsConfig({
      host: "127.0.0.1",
      port: main.getPort()
    })

    const worker = new BackgroundJobsWorker({configuration: dummyConfiguration})
    await worker.start()

    const tmpDir = path.join(dummyConfiguration.getDirectory(), "tmp")
    await fs.mkdir(tmpDir, {recursive: true})
    const outputPath = path.join(tmpDir, `db-query-job-${Date.now()}.json`)

    const originalWithConnections = dummyConfiguration.withConnections.bind(dummyConfiguration)
    let withConnectionsCallsAfterStart = 0
    dummyConfiguration.withConnections = async (callback) => {
      withConnectionsCallsAfterStart++

      return await originalWithConnections(callback)
    }

    let jobId

    try {
      jobId = await DbQueryJob.performLaterWithOptions({
        args: [outputPath],
        options: {forked: false}
      })

      await timeout({timeout: 5000}, async () => {
        while (true) {
          const job = await store.getJob(jobId)

          if (job?.status === "completed") break
          if (job?.status === "failed") throw new Error(`Job failed: ${job.lastError}`)

          await wait(0.05)
        }
      })
    } finally {
      dummyConfiguration.withConnections = originalWithConnections
    }

    expect(withConnectionsCallsAfterStart).toBeGreaterThan(0)

    const result = JSON.parse(await fs.readFile(outputPath, "utf8"))

    expect(typeof result.count).toEqual("number")

    await worker.stop()
    await main.stop()
  })
})
