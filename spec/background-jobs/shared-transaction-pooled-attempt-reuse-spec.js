// @ts-check

import { afterAll, beforeAll, describe, expect, it } from "../../src/testing/test.js"
import { outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson } from "../helpers/background-jobs-helper.js"
import Project from "../dummy/src/models/project.js"
import SharedTransactionTestJob from "../dummy/src/jobs/shared-transaction-test-job.js"

/** @type {Awaited<ReturnType<typeof startBackgroundJobs>> | undefined} */
let backgroundJobs
/** @type {number | undefined} */
let firstAttemptPid
const markerPrefix = `shared-transaction-pooled-attempts-${process.pid}-${Date.now()}`

describe("Background jobs - pooled broker attempt reuse", {tags: ["dummy"], databaseCleaning: {transaction: true, truncate: false}}, () => {
  beforeAll(async () => {
    backgroundJobs = await startBackgroundJobs({workerOptions: {pooledRunnerConcurrency: 2, pooledRunnerCount: 1, pooledRunnerMaxJobs: 10}})
    backgroundJobs.worker._createPooledChild()
  })

  afterAll(async () => {
    if (!backgroundJobs) return
    await backgroundJobs.worker.stop({timeoutMs: 3000})
    await backgroundJobs.main.stop()
  })

  it("uses dispatch-time broker coordinates in a child created before broker activation", async () => {
    if (!backgroundJobs) throw new Error("Expected background jobs to be started")
    const parentMarker = `${markerPrefix}-parent-first`
    const childMarker = `${markerPrefix}-child-first`
    const outputPath = await outputPathFor("shared-transaction-preexisting-pool")
    await Project.create({creatingUserReference: parentMarker})
    const jobId = await SharedTransactionTestJob.performLaterWithOptions({args: [parentMarker, childMarker, outputPath], options: {executionMode: "pooled"}})

    await waitForJobCompleted({jobId, store: backgroundJobs.store, timeoutSeconds: 10})
    const result = await waitForOutputJson({outputPath, timeoutSeconds: 10})
    expect(result.parentCount).toEqual(1)
    expect(result.childCount).toEqual(1)
    firstAttemptPid = result.pid
  })

  it("runs concurrent jobs sharing the new attempt capability in the reused process", async () => {
    if (!backgroundJobs || firstAttemptPid === undefined) throw new Error("Expected first pooled attempt to complete")
    const parentMarker = `${markerPrefix}-parent-second`
    const childMarkers = [`${markerPrefix}-child-second-a`, `${markerPrefix}-child-second-b`]
    const outputPaths = await Promise.all([
      outputPathFor("shared-transaction-next-attempt-a"),
      outputPathFor("shared-transaction-next-attempt-b")
    ])
    await Project.create({creatingUserReference: parentMarker})
    const jobIds = await Promise.all(childMarkers.map(async (childMarker, index) => {
      return await SharedTransactionTestJob.performLaterWithOptions({args: [parentMarker, childMarker, outputPaths[index]], options: {executionMode: "pooled"}})
    }))

    await Promise.all(jobIds.map(async (jobId) => await waitForJobCompleted({jobId, store: backgroundJobs.store, timeoutSeconds: 10})))
    const results = await Promise.all(outputPaths.map(async (outputPath) => await waitForOutputJson({outputPath, timeoutSeconds: 10})))
    expect(results.map((result) => result.pid)).toEqual([firstAttemptPid, firstAttemptPid])
    expect(results.map((result) => result.parentCount)).toEqual([1, 1])
    expect(results.map((result) => result.childCount)).toEqual([1, 1])
  })
})
