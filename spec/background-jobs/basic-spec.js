// @ts-check

import fs from "fs/promises"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs-directory/test-job.js"

describe("Background jobs", () => {
  it("enqueues and runs a job in a worker", async () => {
    dummyConfiguration.setCurrent()

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
    const outputPath = path.join(tmpDir, `job-${Date.now()}.json`)

    await TestJob.performLaterWithOptions({
      args: ["hello", outputPath],
      options: {forked: false}
    })

    await timeout({timeout: 2000}, async () => {
      while (true) {
        try {
          await fs.readFile(outputPath, "utf8")
          break
        } catch {
          await wait(0.05)
        }
      }
    })

    const result = JSON.parse(await fs.readFile(outputPath, "utf8"))

    expect(result).toEqual({message: "hello"})

    await worker.stop()
    await main.stop()
  })
})
