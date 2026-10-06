// @ts-check

import {EventEmitter} from "node:events"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {string} id
 * @returns {import("../../src/background-jobs/types.js").BackgroundJobPayload & {id: string}}
 */
function fakePayload(id) {
  return /** @type {import("../../src/background-jobs/types.js").BackgroundJobPayload & {id: string}} */ (/** @type {unknown} */ ({id}))
}

/**
 * A fake pooled child modelling the IPC surface the worker uses. `kill`
 * records the signal without emitting exit (tests decide when, if ever, the
 * child actually exits), and `send` records job dispatches.
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
   * Records the message; shutdown-request gets the same ack a drained child
   * would send, so the parent proceeds to signal it.
   * @param {object} message - IPC message.
   * @param {((error: Error | null) => void) | undefined} [callback] - IPC callback.
   * @returns {boolean} - Always true.
   */
  send(message, callback) {
    this.sentMessages.push(message)

    if (message && message.type === "shutdown-request" && typeof callback === "function") {
      callback(null)
    }

    return true
  }

  /**
   * Records the signal; tests emit "exit" explicitly to model process death.
   * @param {string} signal - Signal name.
   * @returns {boolean} - Always true.
   */
  kill(signal) {
    if (signal === "SIGTERM" || signal === "SIGKILL") this.connected = false

    return true
  }
}

/**
 * Adds a fake pooled child with seeded state, without forking a process.
 * createdAtMs is fresh so age-based retirement never fires in these tests.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @param {{inflight?: number, lastDispatchSeq?: number, retiring?: boolean, started?: boolean}} [args] - Seed state.
 * @returns {FakePooledChild} - The fake child.
 */
function addFakePooledChild(worker, {inflight = 0, lastDispatchSeq = 0, retiring = false, started = true} = {}) {
  const child = new FakePooledChild()
  /** @type {Map<string, {payload: import("../../src/background-jobs/types.js").BackgroundJobPayload & {id: string}}>} */
  const inflightMap = new Map()

  for (let index = 0; index < inflight; index++) {
    inflightMap.set(`seed-${worker.pooledChildren.size}-${index}`, {payload: fakePayload(`seed-${index}`)})
  }

  worker.pooledChildren.add(child)
  worker.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight: inflightMap, lastDispatchSeq, retiring, started})

  return child
}

/**
 * Stubs the fork so spawn attempts are counted instead of forking processes,
 * and gives the worker a minimal configuration so the spawn gate is active.
 * The stubbed _createPooledChild enforces the same hard cap the real one does
 * (total live children, draining included).
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @returns {{spawned: () => number}} - Spawn counter.
 */
function stubFork(worker) {
  let spawnCount = 0
  worker.configuration = /** @type {ReturnType<typeof JSON.parse>} */ ({
    getDirectory: () => "/tmp",
    getBackgroundJobsConfig: () => ({jobTimeoutMs: null})
  })
  worker._createPooledChild = function() {
    if (this.pooledChildren.size >= this.pooledRunnerCount) return undefined
    spawnCount += 1
    return addFakePooledChild(this)
  }

  return {spawned: () => spawnCount}
}

/**
 * Reports one job outcome for the child's first in-flight job, like the real
 * child would after a job finishes.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @param {import("node:child_process").ChildProcess} child - Child to report for.
 * @returns {void}
 */
function completeFirstJob(worker, child) {
  const state = worker.pooledChildStates.get(child)
  if (!state || state.inflight.size === 0) throw new Error("Child has no in-flight job to complete")
  const jobId = [...state.inflight.keys()][0]

  worker._handlePooledChildMessage({child, message: {type: "job-outcome", jobId, acknowledged: true, rssBytes: 1000}})
}

/**
 * @param {number} ms - Delay in ms.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("Background jobs - pooled runner hard cap", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps total live children (working + draining) at the hard cap through a retirement wave", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 4, pooledRunnerConcurrency: 2, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)

    // Four live children, each holding two jobs: pool at the cap. Completing
    // one job per child retires the child (max-jobs threshold) but the child
    // keeps draining — it still holds one in-flight job.
    const children = []

    for (let index = 0; index < 4; index++) children.push(addFakePooledChild(worker, {inflight: 2}))
    expect(worker.pooledChildren.size).toEqual(4)
    expect(fork.spawned()).toEqual(0)

    // Retirement wave: the old code eagerly spawned a 1-for-1 replacement for
    // every retiring child while the old one was still alive (4 → 8 → 16 → 27
    // under repeated waves). With the cap, no replacement may spawn while the
    // pool is at its size — the live count stays bounded.
    for (const child of children) completeFirstJob(worker, /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))

    // All four are retiring and still draining (one in-flight job each).
    for (const child of children) {
      const state = worker.pooledChildStates.get(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child)))
      expect(state?.retiring).toBe(true)
      expect(state?.inflight.size).toEqual(1)
    }
    expect(worker.pooledChildren.size).toBeLessThanOrEqual(4)
    expect(worker.pooledChildStates.size).toBeLessThanOrEqual(4)
    expect(fork.spawned()).toEqual(0)
  })

  it("defers a replacement spawn until the draining child actually exits at the cap", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 2, pooledRunnerConcurrency: 1, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)
    const childA = addFakePooledChild(worker, {inflight: 2})
    const childB = addFakePooledChild(worker, {inflight: 1})
    expect(worker.pooledChildren.size).toEqual(2)

    // childA's job completes → max-jobs threshold → retire. The eager
    // replacement spawn must be refused: childA is still live (draining) and
    // counts against the cap until it exits.
    completeFirstJob(worker, /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (childA)))
    expect(worker.pooledChildStates.get(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (childA)))?.retiring).toBe(true)
    expect(worker.pooledChildren.size).toEqual(2)
    expect(fork.spawned()).toEqual(0)

    // Once the last in-flight job on childA completes, it drains and leaves
    // the live set — the replacement is NOT eagerly spawned (the cap was met
    // the whole time); the next dispatch spawns lazily exactly then.
    completeFirstJob(worker, /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (childA)))
    expect(worker.pooledChildren.has(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (childA)))).toBe(false)
    expect(worker.pooledChildren.size).toBeLessThanOrEqual(2)
    expect(fork.spawned()).toEqual(0)

    // The next dispatch (or the deferred spawn gate) can now add one child.
    const replacement = worker._createPooledChild()
    expect(replacement).toBeDefined()
    expect(worker.pooledChildren.size).toEqual(2)
    expect(fork.spawned()).toEqual(1)
    expect(worker.pooledChildStates.has(childB)).toBe(true)
  })

  it("waits for a slot instead of spawning over the cap, then dispatches once one frees", async () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 1, pooledRunnerConcurrency: 1})
    const fork = stubFork(worker)

    // One child, busy with a job: at the cap and full.
    const busy = addFakePooledChild(worker, {inflight: 1})

    // This job must wait — not spawn a second child.
    const queuedJob = worker._runPooledJob(fakePayload("queued"))
    await delay(50)
    expect(worker.pooledChildren.size).toEqual(1)
    expect(fork.spawned()).toEqual(0)

    // The busy job completes → slot frees → the queued job is dispatched to
    // the same child.
    completeFirstJob(worker, /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (busy)))
    await delay(50)
    const state = worker.pooledChildStates.get(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (busy)))
    expect(state?.inflight.has("queued")).toBe(true)

    // Settle the tracked job so the suite exits cleanly.
    worker._handlePooledChildMessage({child: /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (busy)), message: {type: "job-outcome", jobId: "queued", acknowledged: true, rssBytes: 1000}})
    await queuedJob
    expect(fork.spawned()).toEqual(0)
  })

  it("advertises no spawnable slots while a draining child occupies a cap slot", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 2, pooledRunnerConcurrency: 4})
    const draining = addFakePooledChild(worker, {retiring: true})
    const working = addFakePooledChild(worker, {inflight: 4})

    // Two live children (one draining) = at the cap: zero spawnable, so the
    // advertised slots are exactly what live children can serve (the working
    // child is full → 0) — no phantom capacity for a third child.
    expect(worker._spawnablePooledChildren()).toEqual(0)
    expect(worker._availablePooledSlots()).toEqual(0)

    // When the draining child retires (its slot frees), capacity comes back.
    worker._retirePooledChild(/** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (draining)))
    expect(worker._spawnablePooledChildren()).toEqual(1)
    expect(worker._availablePooledSlots()).toEqual(4)

    void working
  })

  it("wakes a waiting job when a retiring child drains at the cap", async () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 2, pooledRunnerConcurrency: 2, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)
    const childA = addFakePooledChild(worker, {inflight: 1})
    const childB = addFakePooledChild(worker, {inflight: 2})

    // Pool at the cap, no free slot → job 3 must wait.
    const waiting = worker._runPooledJob(fakePayload("job-3"))
    await delay(50)
    expect(worker.pooledChildren.size).toEqual(2)
    expect(fork.spawned()).toEqual(0)

    // childA's job completes → it hits the max-jobs threshold, retires,
    // drains, and frees a slot — the waiter is woken and dispatched.
    completeFirstJob(worker, /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (childA)))
    await delay(50)

    expect(worker.pooledChildren.size).toBeLessThanOrEqual(2)
    const landed = [...worker.pooledChildStates.values()].some((state) => state.inflight.has("job-3"))
    expect(landed).toBe(true)

    // Settle the tracked job: report its outcome on whichever child hosts it.
    for (const [child, state] of worker.pooledChildStates.entries()) {
      if (state.inflight.has("job-3")) {
        worker._handlePooledChildMessage({child, message: {type: "job-outcome", jobId: "job-3", acknowledged: true, rssBytes: 1000}})
      }
    }
    await waiting
    void childB
  })
})
