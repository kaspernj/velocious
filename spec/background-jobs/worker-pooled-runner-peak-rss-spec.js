// @ts-check
import {EventEmitter} from "node:events"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * A fake pooled child modelling the IPC surface the worker uses. `kill` records
 * the signal without emitting exit (tests decide when, if ever, the child
 * actually exits), and `send` records the parent's requests.
 */
class FakePooledChild extends EventEmitter {
  /**
   * @param {boolean} [args.connected] - Whether IPC is up (default true).
   */
  constructor({connected = true} = {}) {
    super()
    this.connected = connected
    /** @type {Array<{type?: ReturnType<typeof JSON.parse>}>} */
    this.sentMessages = []
  }

  /**
   * @param {object} message - IPC message.
   * @param {((error: Error | null) => void) | undefined} [callback] - IPC callback.
   * @returns {boolean} - Always true.
   */
  send(message, callback) {
    this.sentMessages.push(message)

    if (typeof callback === "function") callback(null)

    return true
  }

  /**
   * @param {string} signal - Signal name.
   * @returns {boolean} - Always true.
   */
  kill(signal) {
    if (signal === "SIGTERM" || signal === "SIGKILL") this.connected = false

    return true
  }
}

/**
 * Adds a fake pooled child with one in-flight job so a job-outcome report can
 * drive the retirement gate. createdAtMs is fresh so age-based retirement
 * never fires.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @returns {FakePooledChild} - The fake child.
 */
function addFakePooledChild(worker) {
  const child = new FakePooledChild()

  worker.pooledChildren.add(child)
  worker.pooledChildStates.set(child, {
    createdAtMs: Date.now(),
    jobsRun: 0,
    inflight: new Map([["job", {payload: {id: "job"}}]]),
    lastDispatchSeq: 0,
    retiring: false,
    started: true
  })

  return child
}

/** @param {BackgroundJobsWorker} worker - Worker under test. @param {FakePooledChild} child - Child. */
function stateOf(worker, child) {
  return worker.pooledChildStates.get(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))
}

describe("Background jobs - pooled runner peak RSS retirement", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retires a child whose peak RSS crosses the limit even though its settled RSS is modest", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerMaxRssBytes: 1610612736, pooledRunnerMaxJobs: 1000})
    const child = addFakePooledChild(worker)
    const cast = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child))

    // The ratchet: the child spiked to 2.5 GB during a burst, then settled to
    // 800 MB by the time the job outcome is reported. The gate must retire on
    // the peak (2.5 GB > 1.5 GiB), not the settled sample.
    worker._handlePooledChildMessage({child: cast, message: {type: "job-outcome", jobId: "job", acknowledged: true, rssBytes: 838860800, peakRssBytes: 2684354560}})

    expect(stateOf(worker, child)?.retiring).toBe(true)
  })

  it("does not retire a child whose peak RSS stays under the limit", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerMaxRssBytes: 1610612736, pooledRunnerMaxJobs: 1000})
    const child = addFakePooledChild(worker)
    const cast = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child))

    // Peak 1.2 GB is under the 1.5 GiB limit: the child keeps running.
    worker._handlePooledChildMessage({child: cast, message: {type: "job-outcome", jobId: "job", acknowledged: true, rssBytes: 500000000, peakRssBytes: 1288490188}})

    expect(stateOf(worker, child)?.retiring).toBe(false)
  })

  it("retires when peak RSS is missing and the settled RSS already crosses the limit", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerMaxRssBytes: 1610612736, pooledRunnerMaxJobs: 1000})
    const child = addFakePooledChild(worker)
    const cast = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child))

    // A legacy child without peak support: the gate falls back to the settled
    // sample, which here is already over the limit.
    worker._handlePooledChildMessage({child: cast, message: {type: "job-outcome", jobId: "job", acknowledged: true, rssBytes: 1717986918}})

    expect(stateOf(worker, child)?.retiring).toBe(true)
  })
})
