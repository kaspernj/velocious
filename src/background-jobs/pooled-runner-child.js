// @ts-check

import { randomUUID } from "node:crypto"
import timeout from "awaitery/build/timeout.js"
import runJobPayload, { BackgroundJobPerformedFailure } from "./job-runner.js"
import { boundedPooledRunnerInflightJobIds, isPooledChildShutdownReason, isPooledChildShutdownSignal } from "./pooled-runner-shutdown.js"
import { closeRunnerConnections, closeRunnerFrameworkConnections, currentConfigurationOrNull } from "./runner-graceful-shutdown.js"
import setRunnerProcessTitle from "./runner-process-title.js"
import PooledRunnerBrokerIdentity from "./pooled-runner-broker-identity.js"
import { runWithSharedTransactionBrokerConfig } from "../testing/shared-transaction-proxy-driver.js"

const BASE_PROCESS_TITLE = "velocious background-jobs-runner"
/** A shutdown observation may delay resource teardown only for this bounded IPC send. */
const SHUTDOWN_OBSERVATION_SEND_TIMEOUT_MS = 100
/** Stable identity of this pooled child process for the life of the process. */
const childInstanceId = randomUUID()

setRunnerProcessTitle()

/** @type {Promise<void> | undefined} */
let shutdownPromise

/**
 * Closes the runner's connections — releasing any advisory lock a killed-mid-pass
 * job still holds — before exiting, instead of leaving a half-open session that
 * keeps the lock until the DB server's `wait_timeout`.
 * @param {object} args - Shutdown observation.
 * @param {number} args.exitCode - Process exit code.
 * @param {import("./types.js").PooledChildShutdownReason} args.reason - Exact shutdown reason observed by the child.
 * @param {number | null} [args.shutdownRequestedAtMs] - Parent request timestamp when supplied over IPC.
 * @param {import("node:child_process").ChildProcess["signalCode"]} [args.signal] - Requested or observed signal.
 * @returns {Promise<void>}
 */
function shutdownRunner({exitCode, reason, shutdownRequestedAtMs = null, signal = null}) {
  if (shutdownPromise) return shutdownPromise

  shutdownPromise = (async () => {
    await sendShutdownObservation({reason, shutdownRequestedAtMs, signal})
    await closeRunnerConnections(currentConfigurationOrNull())
    process.exit(exitCode)
  })()

  return shutdownPromise
}

/**
 * Ids of jobs currently running in this child. A pooled child runs up to
 * `pooledRunnerConcurrency` jobs at once (the worker only dispatches within that
 * bound); the set dedupes a redelivered job id and lets each job settle
 * independently.
 * @type {Set<string>}
 */
const runningJobIds = new Set()
const brokerIdentity = new PooledRunnerBrokerIdentity({
  closeConnections: async () => await closeRunnerFrameworkConnections(currentConfigurationOrNull())
})

/**
 * Sets an aggregate process title from the current in-flight count. A child runs
 * jobs concurrently, so a per-job title (which `runJobPayload` would snapshot and
 * restore around a single job) cannot represent the process — interleaved
 * completions would leave a stale label. Recomputing from `runningJobIds.size` is
 * concurrency-safe and honest: `ps`/`top` show how many jobs the child is running.
 * @returns {void}
 */
function updateProcessTitle() {
  const count = runningJobIds.size

  process.title = count > 0 ? `${BASE_PROCESS_TITLE}: ${count} ${count === 1 ? "job" : "jobs"}` : BASE_PROCESS_TITLE
}

/**
 * Sends one bounded lifecycle observation before application/framework teardown.
 * A closed IPC channel is expected for `ipc_disconnect`; other send failures are
 * surfaced on stderr but never hold connection cleanup past the fixed bound.
 * @param {object} args - Shutdown observation.
 * @param {import("./types.js").PooledChildShutdownReason} args.reason - Shutdown reason.
 * @param {number | null} args.shutdownRequestedAtMs - Parent request timestamp.
 * @param {import("node:child_process").ChildProcess["signalCode"]} args.signal - Requested or observed signal.
 * @returns {Promise<void>} - Resolves after IPC accepts the observation or the bound expires.
 */
async function sendShutdownObservation({reason, shutdownRequestedAtMs, signal}) {
  if (!process.send || !process.connected) return

  const boundedInflight = boundedPooledRunnerInflightJobIds(runningJobIds)
  /** @type {import("./types.js").PooledChildShutdownObservation & {type: "shutdown-observation"}} */
  const message = {
    childInstanceId,
    ...boundedInflight,
    reason,
    shutdownObservedAtMs: Date.now(),
    shutdownRequestedAtMs,
    signal,
    type: "shutdown-observation"
  }

  try {
    await timeout({timeout: SHUTDOWN_OBSERVATION_SEND_TIMEOUT_MS}, async () => {
      await new Promise((resolve, reject) => {
        try {
          process.send?.(message, (error) => {
            if (error) {
              reject(error)
            } else {
              resolve(undefined)
            }
          })
        } catch (error) {
          reject(error)
        }
      })
    })
  } catch (error) {
    console.error("Pooled background job runner could not send its shutdown observation:", error)
  }
}

/**
 * Reports one acceptance observation (job received / perform started) to the
 * worker over IPC. The message carries the job's exact handoff lease so the
 * worker can persist it fenced without any other lookup. Send failures are
 * swallowed: a dead IPC channel is terminal for this child (the disconnect
 * handler owns shutdown), and losing acceptance evidence must never fail the
 * job itself.
 * @param {"job-received" | "job-started"} type - Observation kind.
 * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload carrying the handoff lease.
 * @param {number} observedAtMs - Epoch ms of the observation.
 * @returns {void}
 */
function sendChildAcceptance(type, payload, observedAtMs) {
  if (!process.send) return

  const message = {
    childInstanceId,
    childPid: process.pid,
    handedOffAtMs: payload.handedOffAtMs,
    handoffId: payload.handoffId,
    jobId: payload.id,
    type,
    workerId: payload.workerId,
    ...(type === "job-received" ? {receivedAtMs: observedAtMs} : {startedAtMs: observedAtMs})
  }

  try {
    process.send(message)
  } catch {
    // The IPC channel is already gone; the disconnect handler owns shutdown.
  }
}

/**
 * Checks whether an IPC value is a runnable pooled job message.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "job", payload: import("./types.js").BackgroundJobPayload & {id: string}, sharedTransactionBroker?: import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig}} - Whether this is a valid job message.
 */
function isJobMessage(message) {
  if (!message || typeof message !== "object") return false
  const record = /** @type {{type?: ReturnType<typeof JSON.parse>, payload?: ReturnType<typeof JSON.parse>, sharedTransactionBroker?: ReturnType<typeof JSON.parse>}} */ (message)

  return record.type === "job" && !!record.payload && typeof record.payload === "object" && typeof record.payload.id === "string"
}

/**
 * Checks whether an IPC value requests a typed pooled-child shutdown.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "shutdown-request", reason: import("./types.js").PooledChildShutdownReason, shutdownRequestedAtMs: number, signal: import("node:child_process").ChildProcess["signalCode"]}} - Whether this is a valid parent shutdown request.
 */
function isShutdownRequestMessage(message) {
  if (!message || typeof message !== "object") return false
  const record = /** @type {{type?: ReturnType<typeof JSON.parse>, reason?: ReturnType<typeof JSON.parse>, shutdownRequestedAtMs?: ReturnType<typeof JSON.parse>, signal?: ReturnType<typeof JSON.parse>}} */ (message)

  return record.type === "shutdown-request"
    && isPooledChildShutdownReason(record.reason)
    && typeof record.shutdownRequestedAtMs === "number"
    && Number.isFinite(record.shutdownRequestedAtMs)
    && isPooledChildShutdownSignal(record.signal)
}

/**
 * Sends the terminal outcome after the main/DB report has been acknowledged or rejected.
 * @param {object} args - Outcome.
 * @param {string} args.jobId - Job id.
 * @param {boolean} args.acknowledged - Whether the terminal report was acknowledged.
 * @param {"completed" | "failed" | "rescheduled"} [args.status] - Acknowledged outcome.
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
 * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} sharedTransactionBroker - Per-job broker configuration.
 * @returns {Promise<void>} - Resolves after reporting.
 */
async function runJob(payload, sharedTransactionBroker) {
  try {
    const status = await runWithSharedTransactionBrokerConfig(sharedTransactionBroker, async () => {
      return await brokerIdentity.run(sharedTransactionBroker, async () => {
        return await runJobPayload(payload, {
          closeConnections: false,
          manageProcessTitle: false,
          onPerformStart: () => sendChildAcceptance("job-started", payload, Date.now()),
          processType: "background-jobs-pooled-runner"
        })
      })
    })
    await sendOutcome({jobId: payload.id, acknowledged: true, status})
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
    updateProcessTitle()
  }
}

/**
 * Handles a job message, starting it alongside any concurrent siblings.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {void}
 */
function handleMessage(message) {
  if (isShutdownRequestMessage(message)) {
    void shutdownRunner({
      exitCode: message.reason === "parent_retire_drained" ? 0 : 1,
      reason: message.reason,
      shutdownRequestedAtMs: message.shutdownRequestedAtMs,
      signal: message.signal
    })
    return
  }

  if (!isJobMessage(message) || runningJobIds.has(message.payload.id)) return

  runningJobIds.add(message.payload.id)
  updateProcessTitle()
  sendChildAcceptance("job-received", message.payload, Date.now())
  void runJob(message.payload, message.sharedTransactionBroker || {expected: false})
}

process.on("message", (message) => handleMessage(message))
process.once("disconnect", () => void shutdownRunner({exitCode: 0, reason: "ipc_disconnect"}))
process.once("SIGTERM", () => void shutdownRunner({exitCode: 1, reason: "signal_sigterm", signal: "SIGTERM"}))
process.once("SIGINT", () => void shutdownRunner({exitCode: 1, reason: "signal_sigint", signal: "SIGINT"}))
if (process.send) process.send({childInstanceId, childPid: process.pid, type: "ready"})
