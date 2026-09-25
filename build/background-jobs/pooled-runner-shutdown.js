// @ts-check

import { constants } from "node:os"

/** Maximum job ids copied into a pooled-child shutdown observation or failure snapshot. */
export const POOLED_RUNNER_INFLIGHT_JOB_ID_LIMIT = 100

/** @type {readonly import("./types.js").PooledChildShutdownReason[]} */
export const POOLED_CHILD_SHUTDOWN_REASONS = Object.freeze([
  "parent_retire_drained",
  "job_timeout",
  "worker_stop",
  "signal_sigterm",
  "signal_sigint",
  "signal_sigkill",
  "signal_other",
  "ipc_disconnect",
  "process_error",
  "unexpected_exit"
])

/**
 * Checks one dynamic IPC reason against the complete shutdown contract.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate shutdown reason.
 * @returns {value is import("./types.js").PooledChildShutdownReason} - Whether the value is a known reason.
 */
export function isPooledChildShutdownReason(value) {
  if (typeof value !== "string") return false

  return POOLED_CHILD_SHUTDOWN_REASONS.some((reason) => reason === value)
}

/**
 * Checks one dynamic IPC value against Node's named process signals.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate signal.
 * @returns {value is import("node:child_process").ChildProcess["signalCode"]} - Whether the value is null or a named signal.
 */
export function isPooledChildShutdownSignal(value) {
  return value === null || (typeof value === "string" && Object.hasOwn(constants.signals, value))
}

/**
 * Sorts, deduplicates, and bounds job ids before they cross IPC/report boundaries.
 * @param {Iterable<string>} jobIds - In-flight durable job ids.
 * @returns {{inflightJobIds: string[], inflightJobIdsTruncatedCount: number}} - Bounded snapshot.
 */
export function boundedPooledRunnerInflightJobIds(jobIds) {
  const sortedJobIds = [...new Set(jobIds)].sort((left, right) => left.localeCompare(right))
  const inflightJobIds = sortedJobIds.slice(0, POOLED_RUNNER_INFLIGHT_JOB_ID_LIMIT)

  return {
    inflightJobIds,
    inflightJobIdsTruncatedCount: sortedJobIds.length - inflightJobIds.length
  }
}
