// @ts-check

import fs from "fs/promises"
import path from "path"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - dispatch strategy", () => {
  it("does not start a polling interval in the default (beacon) mode", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    try {
      expect(main.dispatchStrategy).toEqual("beacon")
      expect(main._pollTimer).toBeUndefined()
    } finally {
      await main.stop()
    }
  })

  it("starts a polling interval when dispatchStrategy is 'polling'", async () => {
    dummyConfiguration.setCurrent()
    dummyConfiguration.setBackgroundJobsConfig({dispatchStrategy: "polling", pollIntervalMs: 50})
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    try {
      expect(main.dispatchStrategy).toEqual("polling")
      expect(main._pollTimer).toBeTruthy()
    } finally {
      await main.stop()
      dummyConfiguration.setBackgroundJobsConfig({dispatchStrategy: "beacon", pollIntervalMs: 1000})
    }
  })

  it("dispatches enqueued jobs without polling in beacon mode", async () => {
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
    const outputPath = path.join(tmpDir, `beacon-dispatch-${Date.now()}.json`)

    try {
      // Confirm no poll timer is active.
      expect(main._pollTimer).toBeUndefined()

      await TestJob.performLaterWithOptions({
        args: ["beacon-dispatched", outputPath],
        options: {forked: false}
      })

      await timeout({timeout: 2000}, async () => {
        while (true) {
          try {
            await fs.readFile(outputPath, "utf8")
            break
          } catch {
            await wait(0.02)
          }
        }
      })

      const result = JSON.parse(await fs.readFile(outputPath, "utf8"))
      expect(result).toEqual({message: "beacon-dispatched"})
    } finally {
      await worker.stop()
      await main.stop()
    }
  })

  it("arms a scheduled-job timer for future-scheduled work in beacon mode", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    // Pre-create a future-scheduled job so the dispatcher's initial drain
    // calls `_armScheduledTimer` against a real future timestamp.
    const futureJobId = await store.enqueue({jobName: "TestJob", args: ["future"], options: {forked: false, maxRetries: 5}})
    const handedOffAtMs = await store.markHandedOff({jobId: futureJobId, workerId: "worker-z"})
    await store.markFailed({jobId: futureJobId, error: "transient", workerId: "worker-z", handedOffAtMs})

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    try {
      expect(main._scheduledTimer).toBeTruthy()
    } finally {
      await main.stop()
      await store.clearAll()
    }
  })

  it("arms a retry timer when a drain fails and clears it after recovery", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: 0})
    await main.start()

    try {
      const originalNextAvailableJob = main.store.nextAvailableJob.bind(main.store)
      let throwOnce = true
      main.store.nextAvailableJob = async () => {
        if (throwOnce) {
          throwOnce = false
          throw new Error("simulated transient DB failure")
        }
        return await originalNextAvailableJob()
      }

      // Make the store look like it has a ready worker so the drain
      // actually calls `nextAvailableJob()` — the loop is gated on
      // `readyWorkers.size > 0`.
      const fakeWorker = /** @type {any} */ ({workerId: "fake", send: () => {}})
      main.readyWorkers.add(fakeWorker)

      await main._drain()

      expect(main._errorRetryTimer).toBeTruthy()

      // Subsequent successful drain clears the retry timer.
      await main._drain()
      expect(main._errorRetryTimer).toBeUndefined()
    } finally {
      await main.stop()
    }
  })
})
