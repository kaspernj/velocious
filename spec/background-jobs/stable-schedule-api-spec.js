// @ts-check

import BackgroundJobsClient from "../../src/background-jobs/client.js"
import { startBackgroundJobsMain } from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - stable schedule API", {databaseCleaning: {truncate: true}}, () => {
  it("replaces and cancels a logical schedule through the public job protocol", async () => {
    const {main, store} = await startBackgroundJobsMain()

    dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})

    try {
      const replacement = await TestJob.replaceScheduled({
        scheduleKey: "event:51:reminder:24h",
        args: ["scheduled"],
        options: {executionMode: "inline", scheduledAtMs: Date.now() + 60_000}
      })

      expect(replacement).toEqual({jobId: replacement.jobId, previousJobId: null, previousStatus: null})
      expect(await store.getJob(replacement.jobId)).toMatchObject({
        jobName: "TestJob",
        scheduleKey: "event:51:reminder:24h",
        status: "queued"
      })
      expect(await TestJob.cancelScheduled("event:51:reminder:24h")).toEqual({
        jobId: replacement.jobId,
        outcome: "cancelled"
      })
    } finally {
      await main.stop()
    }
  })

  it("preserves legacy enqueue return contracts beside stable schedules", async () => {
    const {main, store} = await startBackgroundJobsMain()

    dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})

    try {
      const jobId = await TestJob.performLaterWithOptions({
        args: ["legacy"],
        options: {scheduledAtMs: Date.now() + 60_000}
      })

      expect(typeof jobId).toEqual("string")
      expect(await store.getJob(jobId)).toMatchObject({scheduleKey: null, status: "queued"})
    } finally {
      await main.stop()
    }
  })

  it("exposes raw client methods and returns validation errors safely", async () => {
    const {main} = await startBackgroundJobsMain()
    const errorEvents = dummyConfiguration.getErrorEvents()
    let frameworkErrorCount = 0
    const onFrameworkError = () => {
      frameworkErrorCount += 1
    }

    dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})
    errorEvents.on("framework-error", onFrameworkError)

    try {
      const client = new BackgroundJobsClient({configuration: dummyConfiguration})
      const replacement = await client.replaceScheduled({scheduleKey: "client:key", jobName: "TestJob", args: []})

      expect(await client.cancelScheduled({scheduleKey: "client:key"})).toEqual({jobId: replacement.jobId, outcome: "cancelled"})
      await expect(async () => await client.cancelScheduled({scheduleKey: ""})).toThrow(/non-empty string/)
      expect(frameworkErrorCount).toEqual(0)
    } finally {
      errorEvents.off("framework-error", onFrameworkError)
      await main.stop()
    }
  })
})
