// @ts-check

import BackgroundJobsScheduler from "../../src/background-jobs/scheduler.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - scheduler overlapping intervals", {databaseCleaning: {truncate: true}}, () => {
  it("keeps one enqueue in flight when another interval tick fires", async () => {
    const originalSetInterval = globalThis.setInterval
    const originalSetTimeout = globalThis.setTimeout
    const originalClearInterval = globalThis.clearInterval
    const originalClearTimeout = globalThis.clearTimeout
    const intervalCallbacks = []
    const timeoutCallbacks = []

    globalThis.setInterval = (callback) => {
      intervalCallbacks.push(callback)
      return /** @type {NodeJS.Timeout} */ ({})
    }
    globalThis.setTimeout = (callback) => {
      timeoutCallbacks.push(callback)
      return /** @type {NodeJS.Timeout} */ ({})
    }
    globalThis.clearInterval = () => {}
    globalThis.clearTimeout = () => {}

    try {
      let enqueueCount = 0
      let finishEnqueue
      const enqueueGate = new Promise((resolve) => {
        finishEnqueue = resolve
      })
      const scheduler = new BackgroundJobsScheduler({
        configuration: {
          async getScheduledBackgroundJobsConfig() {
            return {jobs: {}}
          }
        },
        enqueueJob: async () => {
          enqueueCount += 1
          await enqueueGate
        }
      })

      scheduler.scheduleJob({
        jobConfiguration: {class: TestJob, every: 1},
        jobKey: "scheduledTestJob"
      })

      const timeoutCallback = timeoutCallbacks[0]

      if (!timeoutCallback) throw new Error("Expected the scheduler to register its initial timeout")

      timeoutCallback()

      const intervalCallback = intervalCallbacks[0]

      if (!intervalCallback) throw new Error("Expected the scheduler to register its recurring interval")

      intervalCallback()
      intervalCallback()

      expect(enqueueCount).toEqual(1)

      if (!finishEnqueue) throw new Error("Expected the enqueue gate resolver to be assigned")

      finishEnqueue()
      await scheduler.stop()
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearInterval = originalClearInterval
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})
