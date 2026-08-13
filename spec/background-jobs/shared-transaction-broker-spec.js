// @ts-check

import { outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson } from "../helpers/background-jobs-helper.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import SharedTransactionTestJob from "../dummy/src/jobs/shared-transaction-test-job.js"

const markerPrefix = `shared-transaction-broker-${process.pid}-${Date.now()}`
const childCompletionTimeoutSeconds = 30
/** @type {string[]} */
const jobIds = []

describe("Background jobs - shared test transaction broker", {tags: ["dummy"], databaseCleaning: {transaction: true, truncate: false}}, () => {
  it("shares parent rollback state with forked, reused pooled, and spawned child runners", async () => {
    const parentMarker = `${markerPrefix}-parent`
    await Project.create({creatingUserReference: parentMarker})
    const {main, store, worker} = await startBackgroundJobs({workerOptions: {pooledRunnerCount: 1, pooledRunnerMaxJobs: 10}})

    try {
      const modes = ["forked", "pooled", "pooled", "spawned"]
      /** @type {number[]} */
      const pooledPids = []

      for (const [index, executionMode] of modes.entries()) {
        const childMarker = `${markerPrefix}-child-${index}`
        const outputPath = await outputPathFor(`shared-transaction-${executionMode}-${index}`)
        const jobId = await SharedTransactionTestJob.performLaterWithOptions({
          args: [parentMarker, childMarker, outputPath],
          options: {executionMode}
        })
        jobIds.push(jobId)
        await waitForJobCompleted({jobId, store, timeoutSeconds: childCompletionTimeoutSeconds})
        const result = await waitForOutputJson({outputPath, timeoutSeconds: childCompletionTimeoutSeconds})

        expect(result.parentCount).toEqual(1)
        expect(result.childCount).toEqual(1)
        const parentVisibleChildCount = await store._withDb(async () => {
          return await Project.where({creatingUserReference: childMarker}).count()
        })
        expect(parentVisibleChildCount).toEqual(1)
        if (executionMode === "pooled") pooledPids.push(result.pid)
      }

      expect(pooledPids).toHaveLength(2)
      expect(pooledPids[0]).toEqual(pooledPids[1])
    } finally {
      await worker.stop({timeoutMs: 3000})
      await main.stop()
    }
  })

  it("sees neither child markers nor background-job rows after parent rollback", async () => {
    expect(await Project.where({creatingUserReference: ["like", `${markerPrefix}%`]}).count()).toEqual(0)
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})

    for (const jobId of jobIds) expect(await store.getJob(jobId)).toEqual(undefined)
  })
})
