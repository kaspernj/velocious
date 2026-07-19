// @ts-check

import {EventEmitter} from "node:events"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"

/**
 * A fake forked child. It records the signals it is sent and only actually
 * "dies" (emits exit) on SIGKILL — modelling a genuinely-hung runner that
 * ignores the polite SIGTERM.
 */
class FakeHungChild extends EventEmitter {
  constructor() {
    super()
    this.killed = false
    /** @type {string[]} */
    this.killSignals = []
  }

  /**
   * @param {string} signal - Signal name.
   * @returns {boolean} - Always true.
   */
  kill(signal) {
    this.killSignals.push(signal)

    if (signal === "SIGKILL") {
      this.killed = true
      this.emit("exit", null, "SIGKILL")
    }

    return true
  }

  /**
   * Records a job send (pooled path); a hung runner never reports an outcome.
   * @returns {boolean} - Always true.
   */
  send() {
    return true
  }
}

describe("Background jobs - worker forked job timeout", () => {
  it("terminates and reports a forked job that overruns the configured timeout", async () => {
    const worker = new BackgroundJobsWorker({jobTimeoutMs: 15, forkedChildSigkillGraceMs: 5})
    /** @type {Array<{jobId: string, status: string, error?: ?}>} */
    const reports = []

    worker.statusReporter = /** @type {?} */ ({
      reportWithRetry: async (/** @type {{jobId: string, status: string, error?: ?}} */ args) => { reports.push(args) }
    })

    const child = new FakeHungChild()
    worker.inflightProcessChildren.add(/** @type {?} */ (child))

    const finished = worker._waitForForkedChild({
      child: /** @type {?} */ (child),
      payload: {id: "job-1", jobName: "HangingJob"}
    })

    await finished

    // SIGTERM first for a clean-ish shutdown, then SIGKILL after the grace since
    // the hung child ignored SIGTERM.
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"])
    expect(reports.length).toEqual(1)
    expect(reports[0].jobId).toEqual("job-1")
    expect(reports[0].status).toEqual("failed")
    expect(String(reports[0].error).includes("timed out")).toEqual(true)
    expect(worker.inflightProcessChildren.has(/** @type {?} */ (child))).toEqual(false)
  })

  it("disables non-finite/non-positive timeouts and clamps huge finite ones to Node's timer max", () => {
    // Infinity / <= 0 disable the backstop; a value beyond Node's ~24.8-day timer
    // range is clamped to the max instead of being coerced to a ~1ms delay (which
    // would terminate every forked job almost immediately).
    expect(new BackgroundJobsWorker({jobTimeoutMs: Infinity})._resolveJobTimeoutMs()).toEqual(null)
    expect(new BackgroundJobsWorker({jobTimeoutMs: 0})._resolveJobTimeoutMs()).toEqual(null)
    expect(new BackgroundJobsWorker({jobTimeoutMs: -5})._resolveJobTimeoutMs()).toEqual(null)
    expect(new BackgroundJobsWorker({jobTimeoutMs: 5_000_000_000})._resolveJobTimeoutMs()).toEqual(2_147_483_647)
    expect(new BackgroundJobsWorker({jobTimeoutMs: 15})._resolveJobTimeoutMs()).toEqual(15)
  })

  it("does not arm a timeout when jobTimeoutMs is not configured", async () => {
    const worker = new BackgroundJobsWorker({})
    const child = new FakeHungChild()

    const finished = worker._waitForForkedChild({
      child: /** @type {?} */ (child),
      payload: {id: "job-2", jobName: "QuickJob"}
    })

    child.emit("exit", 0, null)
    await finished

    expect(child.killSignals).toEqual([])
  })

  it("does not terminate a forked job that finishes before the timeout", async () => {
    const worker = new BackgroundJobsWorker({jobTimeoutMs: 15, forkedChildSigkillGraceMs: 5})
    /** @type {Array<?>} */
    const reports = []

    worker.statusReporter = /** @type {?} */ ({
      reportWithRetry: async (/** @type {?} */ args) => { reports.push(args) }
    })

    const child = new FakeHungChild()

    const finished = worker._waitForForkedChild({
      child: /** @type {?} */ (child),
      payload: {id: "job-3", jobName: "QuickJob"}
    })

    // Clean exit before the 15ms timeout could fire.
    child.emit("exit", 0, null)
    await finished

    // Wait past the timeout window to prove the armed timer was cleared on exit.
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(child.killSignals).toEqual([])
    // A clean exit reports nothing — the child reports its own success.
    expect(reports.length).toEqual(0)
  })
})

describe("Background jobs - worker pooled job timeout", () => {
  /**
   * Registers a fake child as a pooled runner, mirroring `_createPooledChild`'s
   * exit wiring so a kill reports its in-flight jobs failed.
   * @param {BackgroundJobsWorker} worker - Worker.
   * @param {FakeHungChild} child - Fake pooled child.
   * @returns {void}
   */
  function registerPooledChild(worker, child) {
    worker.pooledChildren.add(/** @type {?} */ (child))
    worker.inflightProcessChildren.add(/** @type {?} */ (child))
    worker.pooledChildStates.set(/** @type {?} */ (child), {createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), retiring: false})
    child.once("exit", (/** @type {?} */ code, /** @type {?} */ signal) => {
      void worker._handlePooledChildFailure({child: /** @type {?} */ (child), error: new Error(`Pooled background job runner exited: code=${code} signal=${signal || "none"}`)})
    })
  }

  it("terminates the child and reports a pooled job that overruns the timeout", async () => {
    const worker = new BackgroundJobsWorker({jobTimeoutMs: 15, forkedChildSigkillGraceMs: 5})
    /** @type {Array<{jobId: string, status: string, error?: ?}>} */
    const reports = []
    worker.statusReporter = /** @type {?} */ ({reportWithRetry: async (/** @type {{jobId: string, status: string, error?: ?}} */ args) => { reports.push(args) }})

    const child = new FakeHungChild()
    registerPooledChild(worker, child)

    // A hung child never reports a job-outcome, so only the wall-clock backstop
    // can free the slot. It SIGTERMs, then SIGKILLs after the grace.
    await worker._runPooledJob(/** @type {?} */ ({id: "pooled-1", jobName: "HangingJob"}))

    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"])
    expect(reports.length).toEqual(1)
    expect(reports[0].jobId).toEqual("pooled-1")
    expect(reports[0].status).toEqual("failed")
    expect(worker.pooledChildren.has(/** @type {?} */ (child))).toEqual(false)
  })

  it("does not terminate a pooled job that reports its outcome before the timeout", async () => {
    const worker = new BackgroundJobsWorker({jobTimeoutMs: 15, forkedChildSigkillGraceMs: 5})
    /** @type {Array<?>} */
    const reports = []
    worker.statusReporter = /** @type {?} */ ({reportWithRetry: async (/** @type {?} */ args) => { reports.push(args) }})

    const child = new FakeHungChild()
    registerPooledChild(worker, child)

    const finished = worker._runPooledJob(/** @type {?} */ ({id: "pooled-2", jobName: "QuickJob"}))
    worker._handlePooledChildMessage({child: /** @type {?} */ (child), message: {type: "job-outcome", jobId: "pooled-2", acknowledged: true, rssBytes: 1000}})
    await finished

    // Wait past the timeout window to prove the armed timer was cleared on outcome.
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(child.killSignals).toEqual([])
    expect(reports.length).toEqual(0)
  })
})
