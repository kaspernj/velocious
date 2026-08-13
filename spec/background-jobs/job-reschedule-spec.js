// @ts-check

import { outputPathFor, startBackgroundJobs, waitForJobCompleted, waitForOutputJson } from "../helpers/background-jobs-helper.js"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Waits for both pooled executions of a rescheduled job at the worker's durable
 * acknowledgement boundary. Cold child bootstrap is intentionally outside a
 * short polling deadline; each captured execution resolves only after main has
 * persisted the reschedule/completion report.
 * @param {object} args - Options.
 * @param {string} args.jobId - Rescheduled job id.
 * @param {import("../../src/background-jobs/worker.js").default} args.worker - Started worker.
 * @returns {Promise<void>} - Resolves after both acknowledged executions.
 */
function waitForPooledRescheduleExecutions({jobId, worker}) {
  const jsonSocket = worker.jsonSocket
  if (!jsonSocket) throw new Error("Background jobs worker socket is not connected")

  return new Promise((resolve, reject) => {
    let completedExecutions = 0
    /** @param {ReturnType<typeof JSON.parse>} message - Worker socket message. */
    const onMessage = (message) => {
      if (message?.type !== "job" || message.payload?.id !== jobId) return

      const [execution] = worker.inflightPooledJobs
      if (worker.inflightPooledJobs.size !== 1 || !execution) {
        jsonSocket.off("message", onMessage)
        reject(new Error(`Expected one tracked pooled execution for job ${jobId}, found: ${worker.inflightPooledJobs.size}`))
        return
      }

      void execution.then(() => {
        completedExecutions += 1
        if (completedExecutions !== 2) return

        jsonSocket.off("message", onMessage)
        resolve(undefined)
      }, (error) => {
        jsonSocket.off("message", onMessage)
        reject(error)
      })
    }

    jsonSocket.on("message", onMessage)
  })
}

describe("Background jobs - job reschedule", {databaseCleaning: {truncate: true}}, () => {
  it("reuses the same row later without failure events in inline and pooled modes", async () => {
    const {main, store, worker} = await startBackgroundJobs({workerOptions: {pooledRunnerCount: 1}})
    const failures = []
    const allErrors = []
    const errorEvents = dummyConfiguration.getErrorEvents()
    const onFailure = (payload) => failures.push(payload)
    const onAllError = (payload) => allErrors.push(payload)
    errorEvents.on("background-job-failed", onFailure)
    errorEvents.on("all-error", onAllError)

    try {
      for (const executionMode of ["inline", "pooled"]) {
        const outputPath = await outputPathFor(`job-reschedule-${executionMode}`)
        const jobId = await store.enqueue({
          jobName: "RescheduleTestJob",
          args: [outputPath, 100],
          options: {executionMode}
        })
        const pooledExecutions = executionMode === "pooled"
          ? waitForPooledRescheduleExecutions({jobId, worker})
          : undefined

        await main._drain()
        if (pooledExecutions) {
          await pooledExecutions
        } else {
          await waitForJobCompleted({jobId, store})
        }

        expect(await waitForOutputJson({outputPath})).toEqual({runs: 2})
        expect(await store.getJob(jobId)).toMatchObject({id: jobId, status: "completed", attempts: 0, lastError: null})
      }

      expect(failures).toEqual([])
      expect(allErrors).toEqual([])
    } finally {
      errorEvents.off("background-job-failed", onFailure)
      errorEvents.off("all-error", onAllError)
      await worker.stop({timeoutMs: 1000})
      await main.stop()
    }
  })

  it("treats an invalid delay as an ordinary job failure", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("job-reschedule-invalid")
    const jobId = await store.enqueue({
      jobName: "RescheduleTestJob",
      args: [outputPath, -1],
      options: {executionMode: "inline", maxRetries: 0}
    })

    try {
      await main._drain()
      await waitForOutputJson({outputPath})
      await timeout({timeout: 2000}, async () => {
        while ((await store.getJob(jobId))?.status !== "failed") await wait(0.01)
      })

      expect(await store.getJob(jobId)).toMatchObject({status: "failed", attempts: 1})
    } finally {
      await worker.stop({timeoutMs: 1000})
      await main.stop()
    }
  })
})
