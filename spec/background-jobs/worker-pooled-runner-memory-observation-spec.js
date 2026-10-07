// @ts-check

import {EventEmitter} from "node:events"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * A fake pooled child modelling the IPC surface the worker uses for memory
 * observations. `kill` records the signal without emitting exit (tests decide
 * when, if ever, the child actually exits), and `send` records the parent's
 * requests.
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
 * Adds a fake pooled child to the worker's live pool, without forking a
 * process. createdAtMs is fresh so age-based retirement never fires.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @returns {FakePooledChild} - The fake child.
 */
function addFakePooledChild(worker) {
  const child = new FakePooledChild()

  worker.pooledChildren.add(child)
  worker.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), lastDispatchSeq: 0, retiring: false, started: true})

  return child
}

/**
 * A valid pooled-child memory observation in the exact shape the child sends
 * over IPC (see collectMemoryObservation in pooled-runner-child.js).
 * @param {Partial<ReturnType<typeof JSON.parse>>} [overrides] - Field overrides.
 * @returns {ReturnType<typeof JSON.parse>} - Observation message.
 */
function memoryObservation(overrides = {}) {
  return {
    activeJobIds: ["job-a", "job-b"],
    activeJobIdsTruncatedCount: 0,
    childInstanceId: "child-instance-1",
    childPid: 4242,
    childUptimeMs: 120000,
    heapStatistics: {
      total_heap_size: 268435456,
      total_available_size: 536870912,
      used_heap_size: 134217728,
      heap_size_limit: 2147483648,
      malloced_memory: 1048576,
      peak_malloced_memory: 2097152,
      does_zap_garbage: 0,
      number_of_native_contexts: 1,
      number_of_detached_contexts: 0
    },
    jobCount: 2,
    memoryUsage: {rss: 536870912, heapTotal: 268435456, heapUsed: 134217728, external: 10485760, arrayBuffers: 5242880},
    observedAtMs: 1760000000000,
    rssBytes: 536870912,
    type: "pooled-child-memory",
    uptimeMs: 120000,
    ...overrides
  }
}

describe("Background jobs - pooled runner memory observation", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("forwards a child memory observation to the hook and records it on the child state", () => {
    /** @type {Array<ReturnType<typeof JSON.parse>>} */
    const observed = []
    const worker = new BackgroundJobsWorker({onPooledRunnerMemoryObservation: (observation) => { observed.push(observation) }})
    const child = addFakePooledChild(worker)

    worker._handlePooledChildMessage({child: /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)), message: memoryObservation()})

    expect(observed.length).toEqual(1)
    expect(observed[0]?.rssBytes).toEqual(536870912)
    expect(observed[0]?.jobCount).toEqual(2)
    expect(observed[0]?.activeJobIds).toEqual(["job-a", "job-b"])
    expect(observed[0]?.heapStatistics?.used_heap_size).toEqual(134217728)

    const state = worker.pooledChildStates.get(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))
    expect(state?.lastMemoryObservation?.rssBytes).toEqual(536870912)
  })

  it("ignores a malformed memory observation instead of forwarding it", () => {
    /** @type {Array<ReturnType<typeof JSON.parse>>} */
    const observed = []
    const worker = new BackgroundJobsWorker({onPooledRunnerMemoryObservation: (observation) => { observed.push(observation) }})
    const child = addFakePooledChild(worker)

    // Missing the heap-statistics breakdown — not a valid observation.
    worker._handlePooledChildMessage({child: /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)), message: memoryObservation({heapStatistics: undefined})})
    // A job-outcome message must not be mistaken for an observation.
    worker._handlePooledChildMessage({child: /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)), message: {type: "job-outcome", jobId: "job-a", acknowledged: true, rssBytes: 1000}})

    expect(observed.length).toEqual(0)
  })

  it("survives a throwing hook so the worker and its jobs keep running", () => {
    const worker = new BackgroundJobsWorker({
      onPooledRunnerMemoryObservation: () => {
        throw new Error("hook exploded")
      }
    })
    const child = addFakePooledChild(worker)

    expect(() => {
      worker._handlePooledChildMessage({child: /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)), message: memoryObservation()})
    }).not.toThrow()

    const state = worker.pooledChildStates.get(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))
    expect(state?.lastMemoryObservation?.rssBytes).toEqual(536870912)
  })

  it("requests an on-demand memory observation from a connected child", () => {
    const worker = new BackgroundJobsWorker()
    const child = addFakePooledChild(worker)

    worker.requestPooledChildMemoryObservation(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))

    expect(child.sentMessages).toEqual([{type: "memory-observation-request"}])
  })

  it("does not request a memory observation from a disconnected child", () => {
    const worker = new BackgroundJobsWorker()
    const child = new FakePooledChild({connected: false})

    worker.pooledChildren.add(child)
    worker.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), lastDispatchSeq: 0, retiring: false, started: true})
    worker.requestPooledChildMemoryObservation(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))

    expect(child.sentMessages.length).toEqual(0)
  })
})
