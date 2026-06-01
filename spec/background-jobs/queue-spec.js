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
import FailingJob from "../dummy/src/jobs/failing-job.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"

describe("Background jobs - queue", {databaseCleaning: {transaction: true}}, () => {
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

  it("limits forked runner concurrency without blocking inline job capacity", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    dummyConfiguration.setBackgroundJobsConfig({
      host: "127.0.0.1",
      port: main.getPort()
    })

    const worker = new BackgroundJobsWorker({
      configuration: dummyConfiguration,
      maxConcurrentForkedJobs: 1,
      maxConcurrentInlineJobs: 4
    })
    await worker.start()

    const tmpDir = path.join(dummyConfiguration.getDirectory(), "tmp")
    await fs.mkdir(tmpDir, {recursive: true})
    const firstForkedPath = path.join(tmpDir, `forked-limit-first-${Date.now()}.json`)
    const secondForkedPath = path.join(tmpDir, `forked-limit-second-${Date.now()}.json`)
    const inlinePath = path.join(tmpDir, `forked-limit-inline-${Date.now()}.json`)

    await SlowTestJob.performLater("first", firstForkedPath, 1)
    await SlowTestJob.performLater("second", secondForkedPath, 0.01)
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

    let secondForkedExists = true

    try {
      await fs.readFile(secondForkedPath, "utf8")
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error

      secondForkedExists = false
    }

    expect(secondForkedExists).toBeFalse()

    await timeout({timeout: 5000}, async () => {
      while (true) {
        try {
          const [firstContents, secondContents] = await Promise.all([
            fs.readFile(firstForkedPath, "utf8"),
            fs.readFile(secondForkedPath, "utf8")
          ])

          if (firstContents && secondContents) break
        } catch {
          // Ignore missing files.
        }

        await wait(0.05)
      }
    })

    expect(JSON.parse(await fs.readFile(inlinePath, "utf8"))).toEqual(["inline"])
    expect(JSON.parse(await fs.readFile(firstForkedPath, "utf8"))).toEqual({message: "first"})
    expect(JSON.parse(await fs.readFile(secondForkedPath, "utf8"))).toEqual({message: "second"})

    await worker.stop()
    await main.stop()
  })

  it("runs multiple inline jobs in parallel up to maxConcurrentInlineJobs", async () => {
    // Pre-fix: a single slow inline job (e.g. a 135 s docker alive
    // check) blocked every other inline job. The worker now accepts
    // up to `maxConcurrentInlineJobs` in parallel — slower jobs share
    // the worker process via async I/O concurrency rather than
    // serializing one another.
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})

    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})

    await main.start()

    dummyConfiguration.setBackgroundJobsConfig({
      host: "127.0.0.1",
      port: main.getPort()
    })

    const worker = new BackgroundJobsWorker({configuration: dummyConfiguration, maxConcurrentInlineJobs: 4})

    await worker.start()

    const tmpDir = path.join(dummyConfiguration.getDirectory(), "tmp")

    await fs.mkdir(tmpDir, {recursive: true})

    const outPath1 = path.join(tmpDir, `parallel1-${Date.now()}.json`)
    const outPath2 = path.join(tmpDir, `parallel2-${Date.now()}.json`)
    const outPath3 = path.join(tmpDir, `parallel3-${Date.now()}.json`)
    const startedAt = Date.now()

    await DelayedJob.performLaterWithOptions({args: ["a", outPath1], options: {forked: false}})
    await DelayedJob.performLaterWithOptions({args: ["b", outPath2], options: {forked: false}})
    await DelayedJob.performLaterWithOptions({args: ["c", outPath3], options: {forked: false}})

    await timeout({timeout: 4000}, async () => {
      while (true) {
        try {
          const [c1, c2, c3] = await Promise.all([
            fs.readFile(outPath1, "utf8"),
            fs.readFile(outPath2, "utf8"),
            fs.readFile(outPath3, "utf8")
          ])

          if (c1 && c2 && c3) break
        } catch {
          // Ignore missing files.
        }

        await wait(0.05)
      }
    })

    const elapsedMs = Date.now() - startedAt

    // DelayedJob waits 0.5s. Sequential floor would be ~1.5s; parallel
    // should clock around 0.5s plus framework overhead. 1100ms is
    // comfortably below the sequential floor and high enough to
    // tolerate CI noise.
    expect(elapsedMs < 1100).toEqual(true)

    await worker.stop()
    await main.stop()
  })

  it("emits background-job-failed after an accepted job failure report", async () => {
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
    const failureEvents = []
    const onFailure = (payload) => {
      failureEvents.push(payload)
    }

    dummyConfiguration.getErrorEvents().on("background-job-failed", onFailure)

    try {
      await worker.start()

      const jobId = await FailingJob.performLaterWithOptions({
        args: ["planned failure"],
        options: {forked: false, maxRetries: 0}
      })

      await timeout({timeout: 2000}, async () => {
        while (true) {
          if (failureEvents.length >= 1) break

          await wait(0.05)
        }
      })

      expect(failureEvents.length).toEqual(1)
      expect(failureEvents[0].context.jobId).toEqual(jobId)
      expect(failureEvents[0].context.jobName).toEqual("FailingJob")
      expect(failureEvents[0].context.jobArgs).toEqual(["planned failure"])
      expect(failureEvents[0].context.attempts).toEqual(1)
      expect(failureEvents[0].context.terminal).toEqual(true)
      expect(failureEvents[0].context.willRetry).toEqual(false)
      expect(failureEvents[0].error.message).toEqual("Error: planned failure")
      expect(String(failureEvents[0].error.stack)).toContain("planned failure")
    } finally {
      dummyConfiguration.getErrorEvents().off("background-job-failed", onFailure)
      await worker.stop()
      await main.stop()
    }
  })
})
