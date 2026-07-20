// @ts-check

import BackgroundJobsScheduler, {parseScheduledDuration} from "../../src/background-jobs/scheduler.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - scheduler", {databaseCleaning: {truncate: true}}, () => {
  it("parses sidekiq-style duration strings", () => {
    expect(parseScheduledDuration("1m", "example.every")).toEqual(60000)
    expect(parseScheduledDuration("5 seconds", "example.firstIn")).toEqual(5000)
    expect(parseScheduledDuration(250, "example.firstIn")).toEqual(250)
  })

  it("rejects string every intervals that round down below one millisecond", async () => {
    const scheduler = new BackgroundJobsScheduler({
      configuration: {
        async getScheduledBackgroundJobsConfig() {
          return {
            jobs: {
              scheduledTestJob: {
                class: TestJob,
                every: "0.4ms"
              }
            }
          }
        }
      },
      enqueueJob: async () => {}
    })

    let error = null

    try {
      await scheduler.start()
    } catch (newError) {
      error = newError
    }

    expect(error).toBeTruthy()
    expect(error?.message).toEqual("Scheduled background job scheduledTestJob.every must be at least 1 millisecond.")
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
                  every: ["1m", {firstIn: "5s"}],
                  options: {executionMode: "inline"}
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
        options: {
          concurrencyKey: "scheduled:scheduledTestJob",
          deduplicateWhileQueued: true,
          executionMode: "inline",
          maxConcurrency: 1
        }
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

  it("schedules cron jobs and self-reschedules after each fire", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    const originalClearTimeout = globalThis.clearTimeout
    const originalClearInterval = globalThis.clearInterval
    const enqueuedJobs = []
    const timeoutCallbacks = []
    const timeoutDelays = []
    const intervalDelays = []

    globalThis.setTimeout = (callback, delay) => {
      timeoutCallbacks.push(callback)
      timeoutDelays.push(delay)
      return /** @type {NodeJS.Timeout} */ ({})
    }
    globalThis.setInterval = (callback, delay) => {
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
                cronTestJob: {
                  args: ["cron"],
                  class: TestJob,
                  // Every minute — shortest cadence so we don't have
                  // to wait long for the test.
                  cron: "* * * * *",
                  options: {executionMode: "inline"}
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

      // The cron path schedules a setTimeout with a delay between 1ms
      // and 60_000ms (the gap to the next minute boundary for
      // `* * * * *`). The test runner internals can also call
      // setTimeout during the `await` boundary, so we look at the
      // most recent timeout instead of asserting an exact count.
      const lastTimeoutDelay = timeoutDelays[timeoutDelays.length - 1]

      expect(lastTimeoutDelay).toBeGreaterThan(0)
      expect(lastTimeoutDelay).toBeLessThanOrEqual(60_000)

      const beforeFireTimeoutCount = timeoutDelays.length

      await timeoutCallbacks[timeoutCallbacks.length - 1]?.()

      expect(enqueuedJobs).toEqual([{
        args: ["cron"],
        jobClass: TestJob,
        jobKey: "cronTestJob",
        options: {
          concurrencyKey: "scheduled:cronTestJob",
          deduplicateWhileQueued: true,
          executionMode: "inline",
          maxConcurrency: 1
        }
      }])

      // After firing, the cron path uses setTimeout again (NOT
      // setInterval) so each subsequent run is recomputed against
      // wall-clock time.
      expect(intervalDelays).toEqual([])
      expect(timeoutDelays.length).toBeGreaterThan(beforeFireTimeoutCount)

      await timeoutCallbacks[timeoutCallbacks.length - 1]?.()

      expect(enqueuedJobs.length).toEqual(2)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
      globalThis.clearTimeout = originalClearTimeout
      globalThis.clearInterval = originalClearInterval
    }
  })

  it("rejects schedules that define both every and cron", async () => {
    const scheduler = new BackgroundJobsScheduler({
      configuration: {
        async getScheduledBackgroundJobsConfig() {
          return {
            jobs: {
              bothScheduleJob: {
                class: TestJob,
                cron: "0 * * * *",
                every: "1h"
              }
            }
          }
        }
      },
      enqueueJob: async () => {}
    })

    let error = null

    try {
      await scheduler.start()
    } catch (newError) {
      error = newError
    }

    expect(error).toBeTruthy()
    expect(error?.message).toEqual('Scheduled background job bothScheduleJob must define either "every" or "cron", not both.')
  })

  it("does not re-arm a cron schedule when stop() runs during an in-flight enqueue", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    const originalClearTimeout = globalThis.clearTimeout
    const originalClearInterval = globalThis.clearInterval
    const enqueuedJobs = []
    const timeoutCallbacks = []

    globalThis.setTimeout = (callback) => {
      timeoutCallbacks.push(callback)
      return /** @type {NodeJS.Timeout} */ ({})
    }
    globalThis.setInterval = () => /** @type {NodeJS.Timeout} */ ({})
    globalThis.clearTimeout = () => {}
    globalThis.clearInterval = () => {}

    try {
      let resolveEnqueue
      const enqueueGate = new Promise((resolve) => { resolveEnqueue = resolve })
      const scheduler = new BackgroundJobsScheduler({
        configuration: {
          async getScheduledBackgroundJobsConfig() {
            return {
              jobs: {
                stopRaceJob: {
                  class: TestJob,
                  cron: "* * * * *"
                }
              }
            }
          }
        },
        enqueueJob: async (job) => {
          enqueuedJobs.push(job)
          await enqueueGate
        }
      })

      await scheduler.start()

      const initialCallbackCount = timeoutCallbacks.length
      // Fire the cron timeout — its callback is async and awaits the
      // enqueue gate, so it pauses inside the await.
      const firePromise = timeoutCallbacks[timeoutCallbacks.length - 1]?.()

      // While the enqueue is pending, stop the scheduler.
      const stopPromise = scheduler.stop()
      let stopFinished = false
      void stopPromise.then(() => { stopFinished = true })
      await Promise.resolve()
      expect(stopFinished).toBeFalse()
      // Now release the enqueue. The post-await branch must NOT
      // schedule another setTimeout because we're stopped.
      resolveEnqueue?.()
      await Promise.all([firePromise, stopPromise])
      expect(stopFinished).toBeTrue()

      expect(enqueuedJobs.length).toEqual(1)
      // No new setTimeout queued after the stop+release sequence.
      expect(timeoutCallbacks.length).toEqual(initialCallbackCount)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
      globalThis.clearTimeout = originalClearTimeout
      globalThis.clearInterval = originalClearInterval
    }
  })

  it("rejects schedules that have neither every nor cron", async () => {
    const scheduler = new BackgroundJobsScheduler({
      configuration: {
        async getScheduledBackgroundJobsConfig() {
          return {
            jobs: {
              missingScheduleJob: {
                class: TestJob
              }
            }
          }
        }
      },
      enqueueJob: async () => {}
    })

    let error = null

    try {
      await scheduler.start()
    } catch (newError) {
      error = newError
    }

    expect(error).toBeTruthy()
    expect(error?.message).toEqual('Scheduled background job missingScheduleJob must define either "every" or "cron".')
  })

  it("de-duplicates scheduled jobs with a per-schedule concurrency key by default", async () => {
    /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobOptions>} */
    const enqueued = []
    const scheduler = new BackgroundJobsScheduler({
      configuration: {
        async getScheduledBackgroundJobsConfig() {
          return {jobs: {}}
        }
      },
      enqueueJob: async ({options}) => {
        enqueued.push(options)
      }
    })

    await scheduler.enqueueScheduledJob({jobConfiguration: {class: TestJob}, jobKey: "scheduledTestJob"})

    expect(enqueued.length).toEqual(1)
    expect(enqueued[0].deduplicateWhileQueued).toEqual(true)
    expect(enqueued[0].concurrencyKey).toEqual("scheduled:scheduledTestJob")
    expect(enqueued[0].maxConcurrency).toEqual(1)
  })

  it("keeps an explicit concurrencyKey and honours a deduplicateWhileQueued opt-out", async () => {
    /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobOptions>} */
    const enqueued = []
    const scheduler = new BackgroundJobsScheduler({
      configuration: {
        async getScheduledBackgroundJobsConfig() {
          return {jobs: {}}
        }
      },
      enqueueJob: async ({options}) => {
        enqueued.push(options)
      }
    })

    await scheduler.enqueueScheduledJob({
      jobConfiguration: {class: TestJob, options: {concurrencyKey: "custom-key", maxConcurrency: 3, deduplicateWhileQueued: false}},
      jobKey: "scheduledTestJob"
    })

    expect(enqueued[0].concurrencyKey).toEqual("custom-key")
    expect(enqueued[0].maxConcurrency).toEqual(3)
    expect(enqueued[0].deduplicateWhileQueued).toEqual(false)
  })
})
