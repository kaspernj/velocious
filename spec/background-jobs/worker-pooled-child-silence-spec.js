// @ts-check

import { EventEmitter } from "node:events"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"

/**
 * A fake pooled child that models the silent-wedge signature: its IPC channel
 * stays open (send succeeds, no disconnect, no exit) but it stops emitting
 * messages entirely, so only the silence watchdog can free its slot.
 */
class FakeSilentChild extends EventEmitter {
  constructor() {
    super()
    this.pid = 43211
    /** @type {string[]} */
    this.killSignals = []
    this.connected = true
  }

  /**
   * @param {string} signal - Signal name.
   * @returns {boolean} - Always true.
   */
  kill(signal) {
    this.killSignals.push(signal)

    if (signal === "SIGKILL") {
      this.emit("exit", null, "SIGKILL")
    }

    return true
  }

  /**
   * @returns {boolean} - Always true.
   */
  send() {
    return true
  }
}

/**
 * Registers a fake child as a pooled runner with one in-flight job, mirroring
 * `_createPooledChild`'s exit wiring so the watchdog's failure path reports it.
 * @param {BackgroundJobsWorker} worker - Worker.
 * @param {FakeSilentChild} child - Fake silent child.
 * @returns {void}
 */
function registerPooledChildWithInflightJob(worker, child) {
  worker.pooledChildren.add(/** @type {ReturnType<typeof JSON.parse>} */ (child))
  worker.inflightProcessChildren.add(/** @type {ReturnType<typeof JSON.parse>} */ (child))
  const state = /** @type {ReturnType<typeof JSON.parse>} */ ({
    childInstanceId: "silence-child-instance",
    createdAtMs: Date.now(),
    jobsRun: 0,
    inflight: new Map([["silence-job", {payload: {id: "silence-job", jobName: "HangingJob", handoffId: "silence-handoff", workerId: "silence-worker"}}]]),
    lastDispatchSeq: 0,
    retiring: false,
    lastActivityAtMs: Date.now() - 100
  })
  worker.pooledChildStates.set(/** @type {ReturnType<typeof JSON.parse>} */ (child), state)
  child.once("exit", (/** @type {number | null} */ exitCode, /** @type {import("node:child_process").ChildProcess["signalCode"] */ signal) => {
    void worker._handlePooledChildFailure({
      child: /** @type {ReturnType<typeof JSON.parse>} */ (child),
      error: new Error(`Pooled background job runner exited: code=${exitCode} signal=${signal || "none"}`),
      exitCode,
      origin: "exit",
      signal
    })
  })
}

describe("Background jobs - worker pooled child silence watchdog", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("declares a silent in-flight child wedged, reports its jobs failed and signals it away", async () => {
    const worker = new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: 15, forkedChildSigkillGraceMs: 5})
    /** @type {Array<ReturnType<typeof JSON.parse>>} */
    const reports = []
    worker.statusReporter = /** @type {ReturnType<typeof JSON.parse>} */ ({reportWithRetry: async (/** @type {ReturnType<typeof JSON.parse>} */ args) => { reports.push(args) }})

    const child = new FakeSilentChild()
    registerPooledChildWithInflightJob(worker, child)

    // The watchdog arms from the last observed activity; nothing arrives, so it fires.
    worker._armPooledChildSilenceTimer({child: /** @type {ReturnType<typeof JSON.parse>} */ (child), state: /** @type {ReturnType<typeof JSON.parse>} */ (worker.pooledChildStates.get(/** @type {ReturnType<typeof JSON.parse>} */ (child)))})

    await new Promise((resolve) => setTimeout(resolve, 60))

    // Shutdown request under the exact child_silence reason, SIGTERM then SIGKILL
    // after the grace, because a wedged child ignores the polite signal.
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"])
    expect(reports.length).toEqual(1)
    expect(reports[0].jobId).toEqual("silence-job")
    expect(reports[0].status).toEqual("failed")
    expect(String(reports[0].error).includes("went silent")).toEqual(true)
    expect(reports[0].runnerFailure.shutdownReason).toEqual("child_silence")
    expect(reports[0].runnerFailure.shutdownSignal).toEqual("SIGTERM")
    // The failure report is attributed at watchdog-fire time: the observed
    // signal is none then, and the parent request records SIGTERM with the
    // SIGKILL as the grace fallback for the wedged child that ignores it.
    expect(reports[0].runnerFailure.signal).toEqual(null)
    expect(reports[0].runnerFailure.childInstanceId).toEqual("silence-child-instance")
    expect(reports[0].runnerFailure.inflightJobIds).toEqual(["silence-job"])
    expect(worker.pooledChildStates.has(/** @type {ReturnType<typeof JSON.parse>} */ (child))).toEqual(false)
    expect(worker.pooledChildren.has(/** @type {ReturnType<typeof JSON.parse>} */ (child))).toEqual(false)
  })

  it("does not fire when the child keeps proving liveness with observations", async () => {
    const worker = new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: 30, forkedChildSigkillGraceMs: 5})
    const child = new FakeSilentChild()
    registerPooledChildWithInflightJob(worker, child)
    const state = /** @type {ReturnType<typeof JSON.parse>} */ (worker.pooledChildStates.get(/** @type {ReturnType<typeof JSON.parse>} */ (child)))
    worker._armPooledChildSilenceTimer({child: /** @type {ReturnType<typeof JSON.parse>} */ (child), state})

    // Keep stamping activity below the bound: a healthy busy child looks like this.
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 15))
      worker._notePooledChildActivity({child: /** @type {ReturnType<typeof JSON.parse>} */ (child), state})
    }
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(child.killSignals).toEqual([])
    expect(worker.pooledChildStates.has(/** @type {ReturnType<typeof JSON.parse>} */ (child))).toEqual(true)
  })

  it("does not watch children with nothing in flight and disables non-positive bounds", () => {
    expect(new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: 0})._resolvePooledChildSilenceTimeoutMs()).toEqual(null)
    expect(new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: -5})._resolvePooledChildSilenceTimeoutMs()).toEqual(null)
    expect(new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: Infinity})._resolvePooledChildSilenceTimeoutMs()).toEqual(null)
    expect(new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: 120000})._resolvePooledChildSilenceTimeoutMs()).toEqual(120000)

    const worker = new BackgroundJobsWorker({pooledRunnerSilenceTimeoutMs: 15})
    const child = new FakeSilentChild()
    registerPooledChildWithInflightJob(worker, child)
    const state = /** @type {ReturnType<typeof JSON.parse>} */ (worker.pooledChildStates.get(/** @type {ReturnType<typeof JSON.parse>} */ (child)))
    state.inflight.clear()
    worker._notePooledChildActivity({child: /** @type {ReturnType<typeof JSON.parse>} */ (child), state})
    expect(state.silenceTimer).toBeUndefined()
  })
})
