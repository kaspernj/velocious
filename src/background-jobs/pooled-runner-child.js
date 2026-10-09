// @ts-check

import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import v8 from "node:v8"
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
/** Sampling cadence for the memory observation sampler. */
const MEMORY_OBSERVATION_INTERVAL_MS = 10000
/** Bound on in-flight job ids carried in a memory observation. */
const MEMORY_OBSERVATION_JOB_ID_LIMIT = 32

/**
 * Reads this process's peak resident set size (the kernel high-water mark,
 * `VmHWM` in `/proc/self/status`). Unlike a point-in-time RSS sample, this is
 * monotonic for the life of the process: once a burst ratchets the working set
 * up, `VmHWM` remembers it even after garbage collection returns the pages.
 * That makes it the honest signal for recycling a pooled child — a child that
 * spiked to several gigabytes during a build burst keeps its ratcheted floor
 * and must be replaced, even though its settled RSS at job-outcome time looks
 * modest. A read failure (no `/proc`) degrades to the current RSS sample so the
 * observation is never blocked on it.
 * @returns {number} Peak RSS in bytes, or the current RSS sample when unreadable.
 */
function readPeakRssBytes() {
  const fallbackBytes = process.memoryUsage().rss
  try {
    const status = readFileSync("/proc/self/status", "utf8")
    const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status)
    if (!match) return fallbackBytes
    const kibibytes = Number(match[1])
    return Number.isFinite(kibibytes) && kibibytes > 0 ? kibibytes * 1024 : fallbackBytes
  } catch {
    return fallbackBytes
  }
}

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
 * Collects a bounded diagnostic snapshot of this child's memory state. The
 * pooled child's stdio is ignored by the worker fork, so IPC is the only channel
 * to the worker's log surface — this snapshot (sent periodically and on demand)
 * is how a memory problem names itself in production. The V8 heap-stat
 * breakdown (not a full heap snapshot, which would be far too expensive while a
 * child runs 25 concurrent jobs) distinguishes a V8 heap-growth leak from
 * external/array-buffer (native resource) growth, and the in-flight job ids
 * tie the observation to the work that was running.
 * @returns {{activeJobIds: string[], activeJobIdsTruncatedCount: number, childInstanceId: string, childPid: number, childUptimeMs: number, heapStatistics: ReturnType<typeof v8.getHeapStatistics>, jobCount: number, memoryUsage: ReturnType<typeof process.memoryUsage>, observedAtMs: number, peakRssBytes: number, rssBytes: number, type: "pooled-child-memory", uptimeMs: number}} - Bounded memory observation for this child.
 */
function collectMemoryObservation() {
  const jobIds = [...runningJobIds]
  const activeJobIds = jobIds.slice(0, MEMORY_OBSERVATION_JOB_ID_LIMIT)
  const memoryUsage = process.memoryUsage()

  return {
    activeJobIds,
    activeJobIdsTruncatedCount: Math.max(0, jobIds.length - activeJobIds.length),
    childInstanceId,
    childPid: process.pid,
    childUptimeMs: Math.floor(process.uptime() * 1000),
    heapStatistics: v8.getHeapStatistics(),
    jobCount: jobIds.length,
    memoryUsage,
    observedAtMs: Date.now(),
    peakRssBytes: readPeakRssBytes(),
    rssBytes: memoryUsage.rss,
    type: "pooled-child-memory",
    uptimeMs: Math.floor(process.uptime() * 1000)
  }
}

/**
 * Sends a memory observation to the worker. Sampling is cheap (process + V8
 * heap stats) and only runs while jobs are in flight; a closed IPC channel is
 * terminal for this child (the disconnect handler owns shutdown), so a failed
 * send is swallowed.
 * @returns {void}
 */
function sendMemoryObservation() {
  if (!process.send || runningJobIds.size === 0) return

  try {
    process.send(collectMemoryObservation())
  } catch {
    // The IPC channel is already gone; the disconnect handler owns shutdown.
  }
}

/** @type {ReturnType<typeof setInterval> | undefined} */
let memoryObservationTimer

/**
 * Checks whether an IPC value requests this child to send a memory observation.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "memory-observation-request"}} - Whether the message requests one.
 */
function isMemoryObservationRequestMessage(message) {
  return message !== null
    && typeof message === "object"
    && message.type === "memory-observation-request"
}

/**
 * Starts the periodic memory observation sampler if it is not already running.
 * @returns {void}
 */
function startMemoryObservationSampling() {
  if (memoryObservationTimer || !process.send) return

  memoryObservationTimer = setInterval(() => {
    sendMemoryObservation()
  }, MEMORY_OBSERVATION_INTERVAL_MS)
  memoryObservationTimer.unref()
}

/**
 * Stops the periodic memory observation sampler.
 * @returns {void}
 */
function stopMemoryObservationSampling() {
  if (!memoryObservationTimer) return

  clearInterval(memoryObservationTimer)
  memoryObservationTimer = undefined
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
      peakRssBytes: readPeakRssBytes(),
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

    if (runningJobIds.size === 0) {
      stopMemoryObservationSampling()
    }
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

  if (isMemoryObservationRequestMessage(message)) {
    sendMemoryObservation()
    return
  }

  if (!isJobMessage(message) || runningJobIds.has(message.payload.id)) return

  runningJobIds.add(message.payload.id)
  updateProcessTitle()
  sendChildAcceptance("job-received", message.payload, Date.now())
  startMemoryObservationSampling()
  void runJob(message.payload, message.sharedTransactionBroker || {expected: false})
}

process.on("message", (message) => handleMessage(message))
process.once("disconnect", () => void shutdownRunner({exitCode: 0, reason: "ipc_disconnect"}))
process.once("SIGTERM", () => void shutdownRunner({exitCode: 1, reason: "signal_sigterm", signal: "SIGTERM"}))
process.once("SIGINT", () => void shutdownRunner({exitCode: 1, reason: "signal_sigint", signal: "SIGINT"}))
if (process.send) process.send({childInstanceId, childPid: process.pid, type: "ready"})
