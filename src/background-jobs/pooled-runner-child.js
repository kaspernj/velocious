// @ts-check

import runJobPayload, { BackgroundJobPerformedFailure } from "./job-runner.js"
import setRunnerProcessTitle from "./runner-process-title.js"

setRunnerProcessTitle()
let running = false

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
 * Handles one serial job message.
 * @param {?} message - IPC message.
 * @returns {Promise<void>} - Resolves after reporting.
 */
async function handleMessage(message) {
  if (running || !isJobMessage(message)) return

  running = true
  try {
    await runJobPayload(message.payload, {closeConnections: false})
    await sendOutcome({jobId: message.payload.id, acknowledged: true, status: "completed"})
  } catch (error) {
    if (error instanceof BackgroundJobPerformedFailure) {
      await sendOutcome({jobId: message.payload.id, acknowledged: true, status: "failed"})
    } else {
      const reportError = error instanceof Error ? error : new Error(String(error))
      console.error("Pooled background job runner failed before terminal acknowledgement:", reportError)
      await sendOutcome({jobId: message.payload.id, acknowledged: false, error: reportError})
      process.exitCode = 1
      if (process.disconnect) process.disconnect()
      setImmediate(() => process.exit(1))
    }
  } finally {
    running = false
  }
}

process.on("message", (message) => { void handleMessage(message) })
process.once("disconnect", () => process.exit(0))
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => process.exit(1))
