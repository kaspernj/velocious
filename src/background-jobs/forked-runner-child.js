// @ts-check

import runJobPayload from "./job-runner.js"
import { closeRunnerConnections, currentConfigurationOrNull } from "./runner-graceful-shutdown.js"
import setRunnerProcessTitle from "./runner-process-title.js"

// Name the process so `ps`/`top`/`htop` can identify forked job runners at a
// glance instead of a wall of generic "node" entries. Updated to the specific
// job name once one arrives (see runJobMessage), so operators can see exactly
// which jobs are running, how many of each, and which are eating resources.
setRunnerProcessTitle()

let finishing = false
let shuttingDown = false

/**
 * Closes the runner's connections — releasing any advisory lock a killed-mid-job
 * job still holds — before exiting on shutdown, instead of leaving a half-open
 * session that keeps the lock until the DB server's `wait_timeout`. Normal
 * completion (`finish`) already released its locks via the job's own lock scope.
 * @param {number} exitCode - Process exit code.
 * @returns {Promise<void>}
 */
async function shutdownRunner(exitCode) {
  if (shuttingDown || finishing) return
  shuttingDown = true

  await closeRunnerConnections(currentConfigurationOrNull())
  process.exit(exitCode)
}

/**
 * Runs is job message.
 * @param {?} message - IPC message.
 * @returns {message is {type: "job", payload: import("./types.js").BackgroundJobPayload}} - Whether this is a job message.
 */
function isJobMessage(message) {
  if (!message || typeof message !== "object") return false

  const messageRecord = /** @type {{type?: ?, payload?: ?}} */ (message)

  return messageRecord.type === "job" && Object.hasOwn(messageRecord, "payload")
}

/**
 * Runs finish.
 * @param {number} exitCode - Process exit code.
 * @returns {void}
 */
function finish(exitCode) {
  finishing = true
  process.exitCode = exitCode

  if (process.connected && process.disconnect) {
    process.disconnect()
  }

  setImmediate(() => process.exit(exitCode))
}

/**
 * Runs report job finished.
 * @returns {void}
 */
function reportJobFinished() {
  if (process.send) process.send({type: "job-reported"})
}

/**
 * Runs run job message.
 * @param {?} message - IPC message.
 * @returns {Promise<void>} - Resolves after the payload has run.
 */
async function runJobMessage(message) {
  if (!isJobMessage(message)) {
    throw new Error("Forked background job runner received invalid payload")
  }

  // The per-job process title (and its restore) is set inside runJobPayload,
  // which reads the job class's `static processTitle`. This process boots with
  // the base "velocious background-jobs-runner" title set at module load above.
  await runJobPayload(message.payload, {closeConnections: false})
}

/**
 * Runs handle job message.
 * @param {?} message - IPC message.
 * @returns {Promise<void>} - Resolves after completion is reported.
 */
async function handleJobMessage(message) {
  try {
    await runJobMessage(message)
    reportJobFinished()
    finish(0)
  } catch (error) {
    reportJobFinished()
    console.error("Forked background job runner failed:", error)
    finish(1)
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => void shutdownRunner(1))
}

process.once("disconnect", () => {
  if (!finishing) void shutdownRunner(0)
})

process.once("message", (message) => {
  void handleJobMessage(message)
})
