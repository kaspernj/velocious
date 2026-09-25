// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import { fileURLToPath } from "node:url"
import { fork } from "node:child_process"
import BackgroundJobsStatusReporter from "../../src/background-jobs/status-reporter.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

const POOLED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("../../src/background-jobs/pooled-runner-child.js", import.meta.url))

class RecordingStatusReporter extends BackgroundJobsStatusReporter {
  constructor() {
    super({configuration: dummyConfiguration, host: "127.0.0.1", port: 1})
    /** @type {Array<Parameters<BackgroundJobsStatusReporter["reportWithRetry"]>[0]>} */
    this.reports = []
  }

  /**
   * @param {Parameters<BackgroundJobsStatusReporter["reportWithRetry"]>[0]} args - Failure report.
   * @returns {Promise<void>}
   */
  async reportWithRetry(args) {
    this.reports.push(args)
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @param {string} type - Expected IPC message type.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Matching message.
 */
async function waitForMessage(child, type) {
  /** @type {(message: ReturnType<typeof JSON.parse>) => void} */
  let listener = () => {}

  try {
    return await timeout({errorMessage: `Timed out waiting for pooled child ${type}`, timeout: 2000}, async () => {
      return await new Promise((resolve) => {
        listener = (message) => {
          if (!message || typeof message !== "object" || message.type !== type) return

          resolve(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (message))
        }
        child.on("message", listener)
      })
    })
  } finally {
    child.off("message", listener)
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null}>} - Exit observation.
 */
async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return {code: child.exitCode, signal: child.signalCode}
  }

  return await timeout({errorMessage: "Timed out waiting for pooled child exit", timeout: 3000}, async () => {
    return await new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({code, signal}))
    })
  })
}

/**
 * @returns {{child: import("node:child_process").ChildProcess, worker: BackgroundJobsWorker}} - Started child and owning worker.
 */
async function startPooledChild() {
  const worker = new BackgroundJobsWorker({configuration: dummyConfiguration, host: "127.0.0.1", port: 1})

  worker.configuration = dummyConfiguration
  const child = worker._createPooledChild()

  await timeout({errorMessage: "Pooled child did not become ready", timeout: 2000}, async () => {
    while (worker.pooledChildStates.get(child)?.started !== true) await wait(0.01)
  })

  return {child, worker}
}

/**
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @returns {Promise<void>} - Resolves after the child exits.
 */
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = waitForExit(child)
  child.kill("SIGKILL")
  await exited
}

describe("Background jobs pooled-runner shutdown provenance", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("reports parent_retire_drained before a normal recycled child closes with zero in-flight jobs", async () => {
    const {child, worker} = await startPooledChild()
    const state = worker.pooledChildStates.get(child)
    if (!state) throw new Error("Expected pooled child state")
    state.retiring = true
    const observation = waitForMessage(child, "shutdown-observation")
    const exited = waitForExit(child)

    try {
      worker._retirePooledChild(child)

      const message = await observation
      expect(message.childInstanceId).toEqual(state.childInstanceId)
      expect(message.reason).toEqual("parent_retire_drained")
      expect(message.signal).toEqual("SIGTERM")
      expect(typeof message.shutdownRequestedAtMs).toEqual("number")
      expect(message.shutdownObservedAtMs).toBeGreaterThanOrEqual(message.shutdownRequestedAtMs)
      expect(message.inflightJobIds).toEqual([])
      expect(message.inflightJobIdsTruncatedCount).toEqual(0)
      await exited
    } finally {
      await stopChild(child)
    }
  })

  it("projects an unexpected SIGTERM distinctly from drained retirement", async () => {
    const {child, worker} = await startPooledChild()
    const reporter = new RecordingStatusReporter()
    const state = worker.pooledChildStates.get(child)
    if (!state) throw new Error("Expected pooled child state")
    worker.statusReporter = reporter
    state.inflight.set("signal-job", {
      payload: {
        id: "signal-job",
        handedOffAtMs: 1234,
        handoffId: "signal-handoff",
        jobName: "SignalJob",
        workerId: "signal-worker"
      }
    })
    const observation = waitForMessage(child, "shutdown-observation")
    const exited = waitForExit(child)

    try {
      child.kill("SIGTERM")
      const message = await observation
      await exited
      await timeout({errorMessage: "SIGTERM failure report was not recorded", timeout: 2000}, async () => {
        while (reporter.reports.length === 0) await wait(0.01)
      })

      const runnerFailure = reporter.reports[0].runnerFailure
      if (!runnerFailure) throw new Error("Expected pooled runner failure provenance")
      expect(message.reason).toEqual("signal_sigterm")
      // This focused child has no real dispatched job; the parent-only entry
      // below proves the durable failure snapshot independently.
      expect(message.inflightJobIds).toEqual([])
      expect(runnerFailure.shutdownReason).toEqual("signal_sigterm")
      expect(runnerFailure.shutdownReason).not.toEqual("parent_retire_drained")
      expect(runnerFailure.childInstanceId).toEqual(message.childInstanceId)
      expect(runnerFailure.inflightJobIds).toEqual(["signal-job"])
      expect(runnerFailure.exitCode).toEqual(1)
      expect(runnerFailure.signal).toEqual(null)
      expect(runnerFailure.shutdownSignal).toEqual("SIGTERM")
    } finally {
      await stopChild(child)
    }
  })

  it("classifies a real parent IPC disconnect when the child cannot send an observation", async () => {
    const {child, worker} = await startPooledChild()
    const reporter = new RecordingStatusReporter()
    const state = worker.pooledChildStates.get(child)
    if (!state) throw new Error("Expected pooled child state")
    worker.statusReporter = reporter
    state.inflight.set("disconnect-job", {
      payload: {
        id: "disconnect-job",
        handedOffAtMs: 2345,
        handoffId: "disconnect-handoff",
        jobName: "DisconnectJob",
        workerId: "disconnect-worker"
      }
    })
    const exited = waitForExit(child)

    try {
      child.disconnect()
      await exited
      await timeout({errorMessage: "IPC-disconnect failure report was not recorded", timeout: 2000}, async () => {
        while (reporter.reports.length === 0) await wait(0.01)
      })

      const runnerFailure = reporter.reports[0].runnerFailure
      if (!runnerFailure) throw new Error("Expected pooled runner failure provenance")
      expect(runnerFailure.shutdownReason).toEqual("ipc_disconnect")
      expect(runnerFailure.shutdownReason).not.toEqual("parent_retire_drained")
      expect(runnerFailure.childInstanceId).toEqual(state.childInstanceId)
      expect(runnerFailure.inflightJobIds).toEqual(["disconnect-job"])
      expect(runnerFailure.shutdownRequestedAtMs).toEqual(null)
    } finally {
      await stopChild(child)
    }
  })

  it("fails loudly instead of signalling a normally retired child with tracked work", async () => {
    const {child, worker} = await startPooledChild()
    const state = worker.pooledChildStates.get(child)
    if (!state) throw new Error("Expected pooled child state")
    state.retiring = true
    state.inflight.set("still-running", {payload: {id: "still-running", jobName: "StillRunningJob"}})

    try {
      expect(() => worker._retirePooledChild(child)).toThrowError("Cannot retire pooled child while 1 job remains in flight")
      expect(child.killed).toEqual(false)
    } finally {
      state.inflight.clear()
      await stopChild(child)
    }
  })

  it("bounds in-flight job ids in the shared runner-failure snapshot", async () => {
    const {child, worker} = await startPooledChild()
    const state = worker.pooledChildStates.get(child)
    if (!state) throw new Error("Expected pooled child state")

    for (let index = 0; index < 105; index += 1) {
      const jobId = `bounded-${String(index).padStart(3, "0")}`
      state.inflight.set(jobId, {payload: {id: jobId, jobName: "BoundedJob"}})
    }

    try {
      const runnerFailure = worker._pooledRunnerFailure({child, exitCode: 1, origin: "process-error", signal: null, state})

      expect(runnerFailure.inflightJobIds.length).toEqual(100)
      expect(runnerFailure.inflightJobIdsTruncatedCount).toEqual(5)
      expect(runnerFailure.inflightJobIds[0]).toEqual("bounded-000")
      expect(runnerFailure.inflightJobIds[99]).toEqual("bounded-099")
    } finally {
      state.inflight.clear()
      await stopChild(child)
    }
  })

  it("preserves worker_stop and active handoff provenance through forced child reaping", async () => {
    const {child, worker} = await startPooledChild()
    const reporter = new RecordingStatusReporter()
    const state = worker.pooledChildStates.get(child)
    if (!state) throw new Error("Expected pooled child state")
    worker.statusReporter = reporter
    worker.forkedChildSigkillGraceMs = 100
    worker.shouldStop = true
    state.inflight.set("worker-stop-job", {
      payload: {
        id: "worker-stop-job",
        handedOffAtMs: 3456,
        handoffId: "worker-stop-handoff",
        jobName: "WorkerStopJob",
        workerId: "worker-stop-owner"
      }
    })

    try {
      await worker._terminateProcessChildren()
      await timeout({errorMessage: "Worker-stop failure report was not recorded", timeout: 2000}, async () => {
        while (reporter.reports.length === 0) await wait(0.01)
      })

      const runnerFailure = reporter.reports[0].runnerFailure
      if (!runnerFailure) throw new Error("Expected pooled runner failure provenance")
      expect(runnerFailure.shutdownReason).toEqual("worker_stop")
      expect(typeof runnerFailure.shutdownRequestedAtMs).toEqual("number")
      expect(runnerFailure.shutdownSignal).toEqual("SIGTERM")
      expect(runnerFailure.inflightJobIds).toEqual(["worker-stop-job"])
      expect(runnerFailure.activeJobs).toMatchObject([{
        handedOffAtMs: 3456,
        handoffId: "worker-stop-handoff",
        jobId: "worker-stop-job",
        workerId: "worker-stop-owner"
      }])
    } finally {
      await stopChild(child)
    }
  })

  it("emits an IPC observation before teardown for a direct parent shutdown request", async () => {
    const child = fork(POOLED_RUNNER_ENTRY_PATH, [], {execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"]})
    const requestedAtMs = Date.now()
    const observation = waitForMessage(child, "shutdown-observation")
    const exited = waitForExit(child)

    try {
      child.send({
        type: "shutdown-request",
        reason: "parent_retire_drained",
        signal: "SIGTERM",
        shutdownRequestedAtMs: requestedAtMs
      })

      const message = await observation
      expect(message.reason).toEqual("parent_retire_drained")
      expect(message.shutdownRequestedAtMs).toEqual(requestedAtMs)
      expect(message.inflightJobIds).toEqual([])
      await exited
    } finally {
      await stopChild(child)
    }
  })
})
