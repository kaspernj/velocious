// @ts-check

import fs from "fs/promises"
import net from "net"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs", () => {
  it("enqueues and runs a job in a worker", async () => {
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
    const outputPath = path.join(tmpDir, `job-${Date.now()}.json`)

    const jobId = await TestJob.performLaterWithOptions({
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

    await timeout({timeout: 2000}, async () => {
      while (true) {
        const job = await store.getJob(jobId)
        if (job?.status === "completed") break
        await wait(0.05)
      }
    })

    await worker.stop()
    await main.stop()
  })

  it("enqueues scheduled jobs from the background jobs main process", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const tmpDir = path.join(dummyConfiguration.getDirectory(), "tmp")
    await fs.mkdir(tmpDir, {recursive: true})
    const outputPath = path.join(tmpDir, `scheduled-job-${Date.now()}.json`)
    dummyConfiguration.setScheduledBackgroundJobsConfig({
      jobs: {
        scheduledTestJob: {
          args: ["scheduled", outputPath],
          class: TestJob,
          every: ["1 hour", {first_in: "25ms"}],
          options: {forked: false}
        }
      }
    })

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    dummyConfiguration.setBackgroundJobsConfig({
      host: "127.0.0.1",
      port: main.getPort()
    })

    const worker = new BackgroundJobsWorker({configuration: dummyConfiguration})
    await worker.start()

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

    expect(result).toEqual({message: "scheduled"})

    dummyConfiguration.setScheduledBackgroundJobsConfig(undefined)
    await worker.stop()
    await main.stop()
  })

  it("cleans up its listener and scheduled timers when scheduler startup fails", async () => {
    dummyConfiguration.setCurrent()
    const reservedServer = net.createServer()
    await new Promise((resolve, reject) => {
      reservedServer.once("error", reject)
      reservedServer.listen(0, "127.0.0.1", () => resolve(undefined))
    })
    const reservedAddress = reservedServer.address()

    if (!reservedAddress || typeof reservedAddress !== "object") {
      throw new Error("Expected reserved server address to be available.")
    }

    const reservedPort = reservedAddress.port
    await new Promise((resolve) => reservedServer.close(() => resolve(undefined)))

    dummyConfiguration.setScheduledBackgroundJobsConfig({
      jobs: {
        validScheduledTestJob: {
          class: TestJob,
          every: ["1 hour", {first_in: "25ms"}],
          options: {forked: false}
        },
        invalidScheduledTestJob: {
          every: "1m"
        }
      }
    })

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: reservedPort})

    let error = null

    try {
      await main.start()
    } catch (newError) {
      error = newError
    }

    expect(error).toBeTruthy()

    expect(main.scheduler?.timeoutIds).toEqual([])
    expect(main.scheduler?.intervalIds).toEqual([])

    const rebindingServer = net.createServer()

    try {
      await new Promise((resolve, reject) => {
        rebindingServer.once("error", reject)
        rebindingServer.listen(reservedPort, "127.0.0.1", () => resolve(undefined))
      })
    } finally {
      await new Promise((resolve) => rebindingServer.close(() => resolve(undefined)))
      dummyConfiguration.setScheduledBackgroundJobsConfig(undefined)
    }
  })

  it("waits for in-flight inline jobs to finish during a graceful stop", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})

    const worker = new BackgroundJobsWorker({configuration: dummyConfiguration})
    await worker.start()

    const tmpDir = path.join(dummyConfiguration.getDirectory(), "tmp")
    await fs.mkdir(tmpDir, {recursive: true})
    const outputPath = path.join(tmpDir, `slow-job-${Date.now()}.json`)

    const jobId = await SlowTestJob.performLaterWithOptions({
      args: ["graceful", outputPath, 0.4],
      options: {forked: false}
    })

    // Wait until the worker has actually picked the job up; otherwise
    // stop() might race ahead before there's anything in flight.
    await timeout({timeout: 2000}, async () => {
      while (worker.inflightInlineJobs.size === 0) {
        await wait(0.01)
      }
    })

    const stopStartedAtMs = Date.now()

    await worker.stop()

    const stopElapsedMs = Date.now() - stopStartedAtMs

    // The job pauses for 400ms inside `perform`, so a graceful stop should
    // have waited at least that long before resolving.
    expect(stopElapsedMs).toBeGreaterThanOrEqual(300)

    // The job should have written its output and been marked completed.
    const result = JSON.parse(await fs.readFile(outputPath, "utf8"))
    expect(result).toEqual({message: "graceful"})

    await timeout({timeout: 2000}, async () => {
      while (true) {
        const job = await store.getJob(jobId)
        if (job?.status === "completed") break
        await wait(0.05)
      }
    })

    await main.stop()
  })
})
