// @ts-check

import runJobPayload from "./job-runner.js"

let finishing = false

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
  process.once(signal, () => process.exit(1))
}

process.once("disconnect", () => {
  if (!finishing) process.exit(0)
})

process.once("message", (message) => {
  void handleJobMessage(message)
})
