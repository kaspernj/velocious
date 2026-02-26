// @ts-check

import fs from "fs/promises"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import AppendJob from "../dummy/src/jobs/append-job.js"
import DelayedJob from "../dummy/src/jobs/delayed-job.js"

describe("Background jobs - queue", () => {
  it("processes inline jobs in order", async () => {
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
    const outputPath = path.join(tmpDir, `queue-${Date.now()}.json`)

    await AppendJob.performLaterWithOptions({
      args: ["first", outputPath],
      options: {forked: false}
    })
    await AppendJob.performLaterWithOptions({
      args: ["second", outputPath],
      options: {forked: false}
    })

    await timeout({timeout: 2000}, async () => {
      while (true) {
        try {
          const contents = await fs.readFile(outputPath, "utf8")
          if (JSON.parse(contents).length === 2) break
        } catch {
          // Ignore missing file.
        }

        await wait(0.05)
      }
    })

    const entries = JSON.parse(await fs.readFile(outputPath, "utf8"))

    expect(entries).toEqual(["first", "second"])

    await worker.stop()
    await main.stop()
  })

  it("does not block the worker when running forked jobs", async () => {
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
    const forkedPath = path.join(tmpDir, `forked-${Date.now()}.json`)
    const inlinePath = path.join(tmpDir, `inline-${Date.now()}.json`)

    await DelayedJob.performLater("forked", forkedPath)
    await AppendJob.performLaterWithOptions({
      args: ["inline", inlinePath],
      options: {forked: false}
    })

    await timeout({timeout: 2000}, async () => {
      while (true) {
        try {
          const contents = await fs.readFile(inlinePath, "utf8")
          if (JSON.parse(contents).length === 1) break
        } catch {
          // Ignore missing file.
        }

        await wait(0.05)
      }
    })

    const inlineResult = JSON.parse(await fs.readFile(inlinePath, "utf8"))

    expect(inlineResult).toEqual(["inline"])

    let forkedExists = true

    try {
      await fs.readFile(forkedPath, "utf8")
    } catch {
      forkedExists = false
    }

    expect(forkedExists).toBeFalse()

    let forkedResult = null

    await timeout({timeout: 6000}, async () => {
      while (true) {
        try {
          const contents = await fs.readFile(forkedPath, "utf8")
          const parsed = JSON.parse(contents)

          if (parsed && parsed.value === "forked") {
            forkedResult = parsed
            break
          }
        } catch {
          await wait(0.05)
        }
      }
    })

    expect(forkedResult).toEqual({value: "forked"})

    await worker.stop()
    await main.stop()
  })
})
