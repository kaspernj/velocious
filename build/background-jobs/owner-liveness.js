// @ts-check

import os from "node:os"

/**
 * Liveness verdict for the process recorded on a background job.
 * @typedef {"alive" | "dead" | "unknown"} BackgroundJobOwnerLivenessStatus
 */

/**
 * Verdict describing whether the process that accepted a background job can
 * still be running.
 * @typedef {object} BackgroundJobOwnerLivenessResult
 * @property {string | null} childInstanceId - Recorded pooled-child identity, when available.
 * @property {number | null} childPid - Recorded OS pid, when available.
 * @property {string} reason - Machine-readable reason for the verdict.
 * @property {string | null} runnerHostname - Recorded runner hostname, when available.
 * @property {BackgroundJobOwnerLivenessStatus} status - Liveness verdict.
 */

/**
 * Probes a local pid without signalling the target process. `EPERM` means the
 * process exists but belongs to another user, so it counts as alive; `ESRCH`
 * means it is gone. Any other error is unexpected and is rethrown rather than
 * silently reported as "dead".
 * @param {number} pid - Process id to probe.
 * @returns {boolean} - Whether a process with that pid exists.
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = /** @type {{code?: string}} */ (error).code

    if (code === "EPERM") return true
    if (code === "ESRCH") return false

    throw error
  }
}

/**
 * Evaluates whether the process recorded on a background job is still alive.
 *
 * Only the local host can be answered from a PID: when the job was accepted on
 * another machine the result is `unknown`, because liveness there needs a
 * heartbeat or instance registry rather than a local probe. A pid alone can be
 * recycled by the OS after a process exits, so treat `alive` as "a process with
 * that pid exists now", not proof that it is the same process; pair it with
 * `childStartedAtMs` when that distinction matters.
 * @param {object} [args] - Options.
 * @param {string | null} [args.childInstanceId] - Recorded pooled-child identity.
 * @param {number | null} [args.childPid] - Recorded OS pid.
 * @param {string} [args.currentHostname] - Hostname of this process, defaults to `os.hostname()`.
 * @param {(pid: number) => boolean} [args.probe] - Process probe, injectable for tests.
 * @param {string | null} [args.runnerHostname] - Hostname recorded with the job.
 * @returns {BackgroundJobOwnerLivenessResult} - Liveness verdict with its reason.
 */
export function evaluateBackgroundJobOwnerLiveness({
  childInstanceId = null,
  childPid = null,
  currentHostname = os.hostname(),
  probe = isProcessAlive,
  runnerHostname = null
} = {}) {
  const owner = {
    childInstanceId: typeof childInstanceId === "string" ? childInstanceId : null,
    childPid: typeof childPid === "number" ? childPid : null,
    runnerHostname: typeof runnerHostname === "string" ? runnerHostname : null
  }

  if (!owner.runnerHostname) {
    return {...owner, reason: "runner_hostname_unrecorded", status: "unknown"}
  }

  if (owner.runnerHostname !== currentHostname) {
    return {...owner, reason: "remote_runner_host", status: "unknown"}
  }

  if (!Number.isInteger(owner.childPid) || owner.childPid === null || owner.childPid <= 0) {
    return {...owner, reason: "child_pid_unrecorded", status: "unknown"}
  }

  const probedPid = /** @type {number} */ (owner.childPid)

  return probe(probedPid)
    ? {...owner, reason: "local_pid_alive", status: "alive"}
    : {...owner, reason: "local_pid_missing", status: "dead"}
}
