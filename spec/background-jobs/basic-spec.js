// @ts-check

import net from "net"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import {outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson} from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs", {databaseCleaning: {truncate: true}}, () => {
  it("enqueues and runs a job in a worker", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("job")

    const jobId = await TestJob.performLaterWithOptions({
      args: ["hello", outputPath],
      options: {forked: false}
    })

    const result = await waitForOutputJson({outputPath})

    expect(result).toEqual({message: "hello"})

    await waitForJobCompleted({jobId, store})

    await worker.stop()
    await main.stop()
  })

  it("runs a job in a true forked worker child", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("forked-job")

    const jobId = await TestJob.performLaterWithOptions({
      args: ["forked", outputPath],
      options: {executionMode: "forked"}
    })

    const result = await waitForOutputJson({outputPath, timeoutSeconds: 4})

    expect(result).toEqual({message: "forked"})

    await waitForJobCompleted({jobId, store, timeoutSeconds: 4})

    await worker.stop()
    await main.stop()
  })

  it("enqueues scheduled jobs from the background jobs main process", async () => {
    dummyConfiguration.setCurrent()
    const outputPath = await outputPathFor("scheduled-job")
    dummyConfiguration.setScheduledBackgroundJobsConfig({
      jobs: {
        scheduledTestJob: {
          args: ["scheduled", outputPath],
          class: TestJob,
          every: ["1 hour", {firstIn: "25ms"}],
          options: {forked: false}
        }
      }
    })

    const {main, worker} = await startBackgroundJobs()

    const result = await waitForOutputJson({outputPath})

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
          every: ["1 hour", {firstIn: "25ms"}],
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
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("slow-job")

    const jobId = await SlowTestJob.performLaterWithOptions({
      args: ["graceful", outputPath, 400],
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
    const result = await waitForOutputJson({outputPath})
    expect(result).toEqual({message: "graceful"})

    await waitForJobCompleted({jobId, store})

    await main.stop()
  })
})
