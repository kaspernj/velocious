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
