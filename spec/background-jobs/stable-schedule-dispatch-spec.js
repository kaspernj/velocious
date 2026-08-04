// @ts-check

import fs from "fs/promises"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import { outputPathFor, startBackgroundJobs, startBackgroundJobsMain, waitForOutputJson } from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import TestJob from "../dummy/src/jobs/test-job.js"

describe("Background jobs - stable schedule dispatch", {databaseCleaning: {truncate: true}}, () => {
  it("re-arms dispatch when replacement moves a schedule earlier", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("stable-schedule-rearm")
    const scheduleKey = "event:52:reminder:24h"

    try {
      const first = await TestJob.replaceScheduled({
        scheduleKey,
        args: ["late", outputPath],
        options: {executionMode: "inline", scheduledAtMs: Date.now() + 5000}
      })
      const second = await TestJob.replaceScheduled({
        scheduleKey,
        args: ["early", outputPath],
        options: {executionMode: "inline", scheduledAtMs: Date.now() + 100}
      })

      expect(second).toEqual({jobId: second.jobId, previousJobId: first.jobId, previousStatus: "queued"})
      expect(await waitForOutputJson({outputPath, timeoutSeconds: 2})).toEqual({message: "early"})
      expect(await store.getJob(first.jobId)).toMatchObject({status: "cancelled"})
    } finally {
      await worker.stop()
      await main.stop()
    }
  })

  it("re-arms after cancellation and never dispatches the cancelled owner", async () => {
    const {main, worker} = await startBackgroundJobs()
    const cancelledOutputPath = await outputPathFor("stable-schedule-cancelled")
    const keptOutputPath = await outputPathFor("stable-schedule-kept")

    try {
      await TestJob.replaceScheduled({
        scheduleKey: "event:53:reminder:24h",
        args: ["cancelled", cancelledOutputPath],
        options: {executionMode: "inline", scheduledAtMs: Date.now() + 1000}
      })
      await TestJob.replaceScheduled({
        scheduleKey: "event:54:reminder:24h",
        args: ["kept", keptOutputPath],
        options: {executionMode: "inline", scheduledAtMs: Date.now() + 1200}
      })
      await main._drain()
      await timeout({timeout: 500}, async () => {
        while (main._draining || !main._scheduledTimer) await wait(0.01)
      })

      const timerBeforeCancellation = main._scheduledTimer

      expect(await TestJob.cancelScheduled("event:53:reminder:24h")).toMatchObject({outcome: "cancelled"})
      await timeout({timeout: 500}, async () => {
        while (main._scheduledTimer === timerBeforeCancellation) await wait(0.01)
      })
      expect(await waitForOutputJson({outputPath: keptOutputPath, timeoutSeconds: 2})).toEqual({message: "kept"})
      await expect(async () => await fs.access(cancelledOutputPath)).toThrow(/ENOENT/)
    } finally {
      await worker.stop()
      await main.stop()
    }
  })

  it("dispatches the latest durable owner after main restart", async () => {
    const {main: firstMain} = await startBackgroundJobsMain()
    const outputPath = await outputPathFor("stable-schedule-restart")
    const scheduleKey = "event:55:reminder:24h"

    dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: firstMain.getPort()})

    await TestJob.replaceScheduled({
      scheduleKey,
      args: ["stale", outputPath],
      options: {executionMode: "inline", scheduledAtMs: Date.now() + 5000}
    })
    await TestJob.replaceScheduled({
      scheduleKey,
      args: ["latest", outputPath],
      options: {executionMode: "inline", scheduledAtMs: Date.now() + 500}
    })
    await firstMain.stop()

    const main = new BackgroundJobsMain({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      host: "127.0.0.1",
      port: 0
    })
    let worker

    try {
      await main.start()
      dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})
      worker = new BackgroundJobsWorker({closeDatabaseConnectionsOnStop: false, configuration: dummyConfiguration})
      await worker.start()

      expect(await waitForOutputJson({outputPath, timeoutSeconds: 2})).toEqual({message: "latest"})
    } finally {
      await worker?.stop()
      await main.stop()
    }
  })
})
