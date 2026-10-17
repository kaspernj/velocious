// @ts-check

import {spawn} from "node:child_process"
import os from "node:os"
import {evaluateBackgroundJobOwnerLiveness, isProcessAlive} from "../../src/background-jobs/owner-liveness.js"

/**
 * Starts a node process, waits for it to exit, and returns its pid.
 * @returns {Promise<number>} - Pid known to have exited.
 */
async function exitedPid() {
  const child = spawn(process.execPath, ["-e", ""], {stdio: "ignore"})
  const pid = child.pid

  if (!pid) throw new Error("Expected the spawned child to have a pid")

  await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })

  return pid
}

/**
 * Runs a callback with `process.kill` replaced by a throwing stub.
 * @param {NodeJS.ErrnoException} error - Error the stub throws.
 * @param {() => void} callback - Callback to run.
 * @returns {void}
 */
function withProcessKillThrowing(error, callback) {
  const originalProcessKill = process.kill

  Object.defineProperty(process, "kill", {
    configurable: true,
    value: () => {
      throw error
    }
  })

  try {
    callback()
  } finally {
    Object.defineProperty(process, "kill", {configurable: true, value: originalProcessKill})
  }
}

describe("Background job owner liveness", () => {
  it("reports a live local pid as alive", () => {
    const result = evaluateBackgroundJobOwnerLiveness({
      childInstanceId: "child-1",
      childPid: process.pid,
      runnerHostname: os.hostname()
    })

    expect(result).toEqual({
      childInstanceId: "child-1",
      childPid: process.pid,
      reason: "local_pid_alive",
      runnerHostname: os.hostname(),
      status: "alive"
    })
  })

  it("reports an exited local pid as dead", async () => {
    const childPid = await exitedPid()
    const result = evaluateBackgroundJobOwnerLiveness({childPid, runnerHostname: os.hostname()})

    expect(result.status).toEqual("dead")
    expect(result.reason).toEqual("local_pid_missing")
  })

  it("answers unknown for a runner recorded on another host", () => {
    const result = evaluateBackgroundJobOwnerLiveness({
      childPid: process.pid,
      currentHostname: "other-host",
      runnerHostname: "builder-1"
    })

    expect(result.status).toEqual("unknown")
    expect(result.reason).toEqual("remote_runner_host")
  })

  it("answers unknown when the job predates runner hostnames", () => {
    const result = evaluateBackgroundJobOwnerLiveness({childPid: process.pid})

    expect(result.status).toEqual("unknown")
    expect(result.reason).toEqual("runner_hostname_unrecorded")
  })

  it("answers unknown when no pid was recorded", () => {
    const result = evaluateBackgroundJobOwnerLiveness({runnerHostname: os.hostname()})

    expect(result.status).toEqual("unknown")
    expect(result.reason).toEqual("child_pid_unrecorded")
  })

  it("treats EPERM as an existing process", () => {
    const error = new Error("not permitted")
    error.code = "EPERM"

    withProcessKillThrowing(error, () => {
      expect(isProcessAlive(4242)).toEqual(true)
    })
  })

  it("treats ESRCH as a missing process", () => {
    const error = new Error("no such process")
    error.code = "ESRCH"

    withProcessKillThrowing(error, () => {
      expect(isProcessAlive(4242)).toEqual(false)
    })
  })

  it("rethrows unexpected probe failures", () => {
    const error = new Error("io failure")
    error.code = "EIO"

    withProcessKillThrowing(error, () => {
      expect(() => isProcessAlive(4242)).toThrow("io failure")
    })
  })

  it("rejects invalid pids without probing", () => {
    expect(isProcessAlive(0)).toEqual(false)
    expect(isProcessAlive(-1)).toEqual(false)
    expect(isProcessAlive(1.5)).toEqual(false)
  })
})
