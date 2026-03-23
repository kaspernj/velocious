// @ts-check

import BackgroundJobsScheduler, {parseScheduledDuration} from "../../src/background-jobs/scheduler.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - scheduler", () => {
  it("parses sidekiq-style duration strings", () => {
    expect(parseScheduledDuration("1m", "example.every")).toEqual(60000)
    expect(parseScheduledDuration("5 seconds", "example.first_in")).toEqual(5000)
    expect(parseScheduledDuration(250, "example.first_in")).toEqual(250)
  })

  it("schedules jobs from sidekiq-style every arrays", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    const originalClearTimeout = globalThis.clearTimeout
    const originalClearInterval = globalThis.clearInterval
    const enqueuedJobs = []
    const timeoutCallbacks = []
    const intervalCallbacks = []
    const timeoutDelays = []
    const intervalDelays = []

    globalThis.setTimeout = (callback, delay) => {
      timeoutCallbacks.push(callback)
      timeoutDelays.push(delay)
      return /** @type {NodeJS.Timeout} */ ({})
    }
    globalThis.setInterval = (callback, delay) => {
      intervalCallbacks.push(callback)
      intervalDelays.push(delay)
      return /** @type {NodeJS.Timeout} */ ({})
    }
    globalThis.clearTimeout = () => {}
    globalThis.clearInterval = () => {}

    try {
      const scheduler = new BackgroundJobsScheduler({
        configuration: {
          async getScheduledBackgroundJobsConfig() {
            return {
              jobs: {
                scheduledTestJob: {
                  args: ["hello", "/tmp/out.json"],
                  class: TestJob,
                  every: ["1m", {first_in: "5s"}],
                  options: {forked: false}
                }
              }
            }
          }
        },
        enqueueJob: async (job) => {
          enqueuedJobs.push(job)
        }
      })

      await scheduler.start()

      expect(timeoutDelays.includes(5000)).toBeTrue()

      await timeoutCallbacks[timeoutCallbacks.length - 1]?.()

      expect(intervalDelays).toEqual([60000])
      expect(enqueuedJobs).toEqual([{
        args: ["hello", "/tmp/out.json"],
        jobClass: TestJob,
        jobKey: "scheduledTestJob",
        options: {forked: false}
      }])

      await intervalCallbacks[intervalCallbacks.length - 1]?.()

      expect(enqueuedJobs.length).toEqual(2)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
      globalThis.clearTimeout = originalClearTimeout
      globalThis.clearInterval = originalClearInterval
    }
  })
})
