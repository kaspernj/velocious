// @ts-check

import runJobPayload, { BackgroundJobPerformedFailure } from "./job-runner.js"
import setRunnerProcessTitle from "./runner-process-title.js"

setRunnerProcessTitle()

/**
 * Ids of jobs currently running in this child. A pooled child runs up to
 * `pooledRunnerConcurrency` jobs at once (the worker only dispatches within that
 * bound); the set dedupes a redelivered job id and lets each job settle
 * independently.
 * @type {Set<string>}
 */
const runningJobIds = new Set()

/**
 * Checks whether an IPC value is a runnable pooled job message.
 * @param {?} message - IPC message.
 * @returns {message is {type: "job", payload: import("./types.js").BackgroundJobPayload & {id: string}}} - Whether this is a valid job message.
 */
function isJobMessage(message) {
  if (!message || typeof message !== "object") return false
  const record = /** @type {{type?: ?, payload?: ?}} */ (message)

  return record.type === "job" && !!record.payload && typeof record.payload === "object" && typeof record.payload.id === "string"
}

/**
 * Sends the terminal outcome after the main/DB report has been acknowledged or rejected.
 * @param {object} args - Outcome.
 * @param {string} args.jobId - Job id.
 * @param {boolean} args.acknowledged - Whether the terminal report was acknowledged.
 * @param {"completed" | "failed"} [args.status] - Acknowledged terminal status.
 * @param {Error} [args.error] - Reporting error when acknowledgement was not obtained.
 * @returns {Promise<void>} - Resolves after IPC accepts the message.
 */
function sendOutcome({jobId, acknowledged, status, error}) {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve(undefined)
      return
    }

    process.send({
      type: "job-outcome",
      jobId,
      acknowledged,
      status,
      rssBytes: process.memoryUsage().rss,
      error: error?.message
    }, () => resolve(undefined))
  })
}

/**
 * Runs one job concurrently with any siblings and reports its own terminal
 * outcome. A single job's unexpected failure reports that job for reclamation
 * (`acknowledged: false`) but does NOT take down the child — its concurrent
 * siblings keep running. Only a process-level fault (which escapes every
 * per-job try/catch) ends the child, which the worker sees as an exit and
 * reclaims for the whole in-flight set.
 * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload.
 * @returns {Promise<void>} - Resolves after reporting.
 */
async function runJob(payload) {
  try {
    await runJobPayload(payload, {closeConnections: false})
    await sendOutcome({jobId: payload.id, acknowledged: true, status: "completed"})
  } catch (error) {
    if (error instanceof BackgroundJobPerformedFailure) {
      await sendOutcome({jobId: payload.id, acknowledged: true, status: "failed"})
    } else {
      const reportError = error instanceof Error ? error : new Error(String(error))
      console.error("Pooled background job runner failed before terminal acknowledgement:", reportError)
      await sendOutcome({jobId: payload.id, acknowledged: false, error: reportError})
    }
  } finally {
    runningJobIds.delete(payload.id)
  }
}

/**
 * Handles a job message, starting it alongside any concurrent siblings.
 * @param {?} message - IPC message.
 * @returns {void}
 */
function handleMessage(message) {
  if (!isJobMessage(message) || runningJobIds.has(message.payload.id)) return

  runningJobIds.add(message.payload.id)
  void runJob(message.payload)
}

process.on("message", (message) => handleMessage(message))
process.once("disconnect", () => process.exit(0))
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => process.exit(1))
