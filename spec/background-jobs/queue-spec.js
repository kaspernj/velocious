// @ts-check

import fs from "fs/promises"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import {outputPathFor, startBackgroundJobs, waitForOutputJson} from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import AppendJob from "../dummy/src/jobs/append-job.js"
import DelayedJob from "../dummy/src/jobs/delayed-job.js"
import FailingJob from "../dummy/src/jobs/failing-job.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"

/**
 * @param {string} outputPath - Output path.
 * @returns {Promise<any[]>} - Inline append output.
 */
async function appendInlineAndWait(outputPath) {
  await AppendJob.performLaterWithOptions({
    args: ["inline", outputPath],
    options: {forked: false}
  })

  return await waitForOutputJson({
    outputPath,
    predicate: (value) => Array.isArray(value) && value.length === 1
  })
}

describe("Background jobs - queue", {databaseCleaning: {truncate: true}}, () => {
  it("processes inline jobs in order", async () => {
    const {main, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("queue")

    await AppendJob.performLaterWithOptions({
      args: ["first", outputPath],
      options: {forked: false}
    })
    await AppendJob.performLaterWithOptions({
      args: ["second", outputPath],
      options: {forked: false}
    })

    const entries = await waitForOutputJson({
      outputPath,
      predicate: (value) => Array.isArray(value) && value.length === 2
    })

    expect(entries).toEqual(["first", "second"])

    await worker.stop()
    await main.stop()
  })

  it("does not block the worker when running forked jobs", async () => {
    const {main, worker} = await startBackgroundJobs()
    const forkedPath = await outputPathFor("forked")
    const inlinePath = await outputPathFor("inline")

    await DelayedJob.performLater("forked", forkedPath)
    const inlineResult = await appendInlineAndWait(inlinePath)

    expect(inlineResult).toEqual(["inline"])

    let forkedExists = true

    try {
      await fs.readFile(forkedPath, "utf8")
    } catch {
      forkedExists = false
    }

    expect(forkedExists).toBeFalse()

    const forkedResult = await waitForOutputJson({
      outputPath: forkedPath,
      predicate: (value) => value?.value === "forked",
      timeoutSeconds: 6
    })

    expect(forkedResult).toEqual({value: "forked"})

    await worker.stop()
    await main.stop()
  })

  it("limits forked runner concurrency without blocking inline job capacity", async () => {
    const {main, worker} = await startBackgroundJobs({workerOptions: {
      maxConcurrentForkedJobs: 1,
      maxConcurrentInlineJobs: 4
    }})
    const firstForkedPath = await outputPathFor("forked-limit-first")
    const secondForkedPath = await outputPathFor("forked-limit-second")
    const inlinePath = await outputPathFor("forked-limit-inline")

    await SlowTestJob.performLater("first", firstForkedPath, 1)
    await SlowTestJob.performLater("second", secondForkedPath, 0.01)
    const inlineResult = await appendInlineAndWait(inlinePath)

    let secondForkedExists = true

    try {
      await fs.readFile(secondForkedPath, "utf8")
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error

      secondForkedExists = false
    }

    expect(secondForkedExists).toBeFalse()

    const [firstForkedResult, secondForkedResult] = await Promise.all([
      waitForOutputJson({outputPath: firstForkedPath, timeoutSeconds: 5}),
      waitForOutputJson({outputPath: secondForkedPath, timeoutSeconds: 5})
    ])

    expect(inlineResult).toEqual(["inline"])
    expect(firstForkedResult).toEqual({message: "first"})
    expect(secondForkedResult).toEqual({message: "second"})

    await worker.stop()
    await main.stop()
  })

  it("runs multiple inline jobs in parallel up to maxConcurrentInlineJobs", async () => {
    // Pre-fix: a single slow inline job (e.g. a 135 s docker alive
    // check) blocked every other inline job. The worker now accepts
    // up to `maxConcurrentInlineJobs` in parallel — slower jobs share
    // the worker process via async I/O concurrency rather than
    // serializing one another.
    const {main, worker} = await startBackgroundJobs({workerOptions: {maxConcurrentInlineJobs: 4}})
    const outPath1 = await outputPathFor("parallel1")
    const outPath2 = await outputPathFor("parallel2")
    const outPath3 = await outputPathFor("parallel3")
    const startedAt = Date.now()

    await DelayedJob.performLaterWithOptions({args: ["a", outPath1], options: {forked: false}})
    await DelayedJob.performLaterWithOptions({args: ["b", outPath2], options: {forked: false}})
    await DelayedJob.performLaterWithOptions({args: ["c", outPath3], options: {forked: false}})

    await Promise.all([
      waitForOutputJson({outputPath: outPath1, timeoutSeconds: 4}),
      waitForOutputJson({outputPath: outPath2, timeoutSeconds: 4}),
      waitForOutputJson({outputPath: outPath3, timeoutSeconds: 4})
    ])

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
    const {main, worker} = await startBackgroundJobs()
    const failureEvents = []
    const onFailure = (payload) => {
      failureEvents.push(payload)
    }

    dummyConfiguration.getErrorEvents().on("background-job-failed", onFailure)

    try {
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
