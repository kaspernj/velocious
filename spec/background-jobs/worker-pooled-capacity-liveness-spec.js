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
 * child actually exits).
 */
class FakePooledChild extends EventEmitter {
  constructor() {
    super()
    this.connected = true
  }

  /**
   * Acknowledges shutdown requests like a drained child would, so the parent
   * proceeds via its grace path instead of signalling immediately.
   * @param {object} message - IPC message.
   * @param {((error: Error | null) => void) | undefined} [callback] - IPC callback.
   * @returns {boolean} - Always true.
   */
  send(message, callback) {
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
 * Casts a fake child to the ChildProcess type the worker API expects.
 * @param {FakePooledChild} child - Fake child.
 * @returns {import("node:child_process").ChildProcess} - Cast child.
 */
function asChild(child) {
  return /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child))
}

/**
 * Adds a fake pooled child with seeded state, without forking a process.
 * createdAtMs is fresh so age-based retirement never fires in these tests.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @param {{inflight?: number}} [args] - Seed state.
 * @returns {FakePooledChild} - The fake child.
 */
function addFakePooledChild(worker, {inflight = 0} = {}) {
  const child = new FakePooledChild()
  /** @type {Map<string, {payload: import("../../src/background-jobs/types.js").BackgroundJobPayload & {id: string}}>} */
  const inflightMap = new Map()

  for (let index = 0; index < inflight; index++) {
    inflightMap.set(`seed-${worker.pooledChildren.size}-${index}`, {payload: fakePayload(`seed-${index}`)})
  }

  worker.pooledChildren.add(child)
  worker.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight: inflightMap, lastDispatchSeq: 0, retiring: false, started: true})

  return child
}

/**
 * Stubs the fork so spawn attempts are counted instead of forking processes,
 * and gives the worker a minimal configuration so the spawn gate is active.
 * The stub mirrors the real `_createPooledChild` cap, including the bounded
 * over-cap option the liveness replacement uses.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @returns {{spawned: () => number}} - Spawn counter.
 */
function stubFork(worker) {
  let spawnCount = 0
  worker.configuration = /** @type {ReturnType<typeof JSON.parse>} */ ({
    getDirectory: () => "/tmp",
    getBackgroundJobsConfig: () => ({jobTimeoutMs: null})
  })
  worker._createPooledChild = function({allowOverCap = false} = {}) {
    if (!allowOverCap && this.pooledChildren.size >= this.pooledRunnerCount) return undefined
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
 * Captures console.error lines for the duration of one call so pooled-capacity
 * events can be asserted without polluting the suite output.
 * @param {() => void} callback - Code under capture.
 * @returns {Array<string>} - Captured lines.
 */
function captureStderr(callback) {
  /** @type {Array<string>} */
  const lines = []
  const original = console.error

  console.error = (...args) => { lines.push(args.map((arg) => String(arg)).join(" ")) }
  try {
    callback()
  } finally {
    console.error = original
  }

  return lines
}

/**
 * Picks the one non-retiring child out of the pool.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @returns {FakePooledChild} - The non-retiring child.
 */
function findWorkingChild(worker) {
  for (const child of worker.pooledChildren) {
    if (!worker.pooledChildStates.get(child)?.retiring) return /** @type {FakePooledChild} */ (/** @type {unknown} */ (child))
  }

  throw new Error("Expected a non-retiring pooled child")
}

describe("Background jobs - pooled capacity liveness", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("spawns one over-cap liveness replacement when a retirement wave empties the working pool", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 3, pooledRunnerConcurrency: 2, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)

    // Three live children, each holding two jobs: pool at the cap. Completing
    // one job per child retires that child (max-jobs threshold) while it keeps
    // draining its second job.
    const children = []

    for (let index = 0; index < 3; index++) children.push(addFakePooledChild(worker, {inflight: 2}))

    // The first two marks still leave a non-retiring child: the cap holds and
    // nothing spawns.
    captureStderr(() => completeFirstJob(worker, asChild(children[0])))
    captureStderr(() => completeFirstJob(worker, asChild(children[1])))
    expect(fork.spawned()).toEqual(0)
    expect(worker.pooledChildren.size).toEqual(3)

    // The third mark empties the working pool: advertised capacity would be
    // zero for the whole drain window. Exactly one bounded over-cap replacement
    // spawns (live children stay at cap + 1) and the event is logged instead of
    // the starvation staying silent.
    const lines = captureStderr(() => completeFirstJob(worker, asChild(children[2])))

    expect(worker.pooledChildStates.get(asChild(children[2]))?.retiring).toBe(true)
    expect(fork.spawned()).toEqual(1)
    expect(worker.pooledChildren.size).toEqual(4)
    // Capacity is advertised again instead of collapsing to zero.
    expect(worker._availablePooledSlots()).toEqual(2)
    expect(lines.some((line) => line.includes("pooled-capacity-liveness-spawn"))).toEqual(true)
  })

  it("reuses the over-cap budget after a draining exit and never exceeds cap + 1", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 2, pooledRunnerConcurrency: 1, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)
    const childA = addFakePooledChild(worker, {inflight: 2})
    const childB = addFakePooledChild(worker, {inflight: 2})

    // childA retires while childB is still working: capped, no spawn.
    captureStderr(() => completeFirstJob(worker, asChild(childA)))
    expect(fork.spawned()).toEqual(0)

    // childB's mark empties the working pool: one bounded over-cap replacement.
    captureStderr(() => completeFirstJob(worker, asChild(childB)))
    expect(fork.spawned()).toEqual(1)
    expect(worker.pooledChildren.size).toEqual(3)

    // childA drains fully and exits: the replacement absorbs its cap slot.
    captureStderr(() => completeFirstJob(worker, asChild(childA)))
    expect(worker.pooledChildren.size).toEqual(2)

    // The replacement retires on its own threshold while childB still drains:
    // the budget is reused — one over-cap child again, never two.
    const replacement = findWorkingChild(worker)
    const replacementState = worker.pooledChildStates.get(asChild(replacement))

    if (!replacementState) throw new Error("Expected replacement state")

    replacementState.inflight.set("replacement-job", {payload: fakePayload("replacement-job")})
    captureStderr(() => completeFirstJob(worker, asChild(replacement)))
    expect(fork.spawned()).toEqual(2)
    expect(worker.pooledChildren.size).toEqual(2)

    // Settle the last tracked job so the suite exits cleanly.
    captureStderr(() => completeFirstJob(worker, asChild(childB)))
    expect(worker.pooledChildren.size).toBeLessThanOrEqual(1)
  })

  it("defers retiring the last working child while the over-cap budget is spent", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 1, pooledRunnerConcurrency: 1, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)
    const child = addFakePooledChild(worker, {inflight: 2})

    // Emptying the single-child pool uses the bounded over-cap replacement.
    const spawnLines = captureStderr(() => completeFirstJob(worker, asChild(child)))

    expect(fork.spawned()).toEqual(1)
    expect(worker.pooledChildren.size).toEqual(2)
    expect(spawnLines.some((line) => line.includes("pooled-capacity-liveness-spawn"))).toEqual(true)

    // The replacement crosses its threshold while the original child still
    // drains. Retiring it would leave the pool at its cap with zero working
    // children — advertised capacity would collapse to zero until the next
    // draining exit, up to the longest in-flight job (tens of minutes with
    // builds). The retirement is deferred instead: the replacement keeps
    // serving and capacity stays advertised.
    const replacement = findWorkingChild(worker)
    const replacementState = worker.pooledChildStates.get(asChild(replacement))

    if (!replacementState) throw new Error("Expected replacement state")

    replacementState.inflight.set("replacement-job", {payload: fakePayload("replacement-job")})
    const deferredLines = captureStderr(() => completeFirstJob(worker, asChild(replacement)))

    expect(replacementState.retiring).toBe(false)
    expect(fork.spawned()).toEqual(1)
    expect(worker.pooledChildren.size).toBeLessThanOrEqual(2)
    expect(deferredLines.some((line) => line.includes("pooled-capacity-retirement-deferred"))).toEqual(true)
    expect(worker._availablePooledSlots()).toBeGreaterThan(0)

    // The original child drains fully and its slot frees. The deferred
    // retirement now retries: the replacement marks and its own bounded
    // replacement spawns, so working capacity still never touches zero.
    captureStderr(() => completeFirstJob(worker, asChild(child)))
    expect(worker.pooledChildren.size).toEqual(1)

    replacementState.inflight.set("replacement-job-2", {payload: fakePayload("replacement-job-2")})
    const retryLines = captureStderr(() => completeFirstJob(worker, asChild(replacement)))

    expect(replacementState.retiring).toBe(true)
    expect(fork.spawned()).toEqual(2)
    expect(retryLines.some((line) => line.includes("pooled-capacity-liveness-spawn"))).toEqual(true)
    expect(worker._availablePooledSlots()).toBeGreaterThan(0)

    // Only the fresh working replacement remains; no tracked jobs are pending.
    expect(worker.pooledChildren.size).toEqual(1)
  })

  it("restores a working child when the absorbed over-cap replacement exits while the wave still drains", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 2, pooledRunnerConcurrency: 1, pooledRunnerMaxJobs: 1})
    const fork = stubFork(worker)
    /** @type {Array<Record<string, unknown>>} */
    const sent = []

    worker.jsonSocket = /** @type {ReturnType<typeof JSON.parse>} */ ({send: (message) => sent.push(message)})

    const childA = addFakePooledChild(worker, {inflight: 2})
    const childB = addFakePooledChild(worker, {inflight: 2})

    // Both originals retire while still draining; the second mark leaves no
    // non-retiring child, so the bounded over-cap replacement spawns.
    captureStderr(() => completeFirstJob(worker, asChild(childA)))
    captureStderr(() => completeFirstJob(worker, asChild(childB)))
    expect(fork.spawned()).toEqual(1)
    expect(worker.pooledChildren.size).toEqual(3)

    // The replacement crosses its threshold while both originals are still
    // draining. Retiring it would collapse advertised capacity to zero until
    // a natural drain exit — the state that starved production dispatch for
    // tens of minutes at a time — so the retirement is deferred and the
    // replacement keeps its capacity advertised.
    const replacement = findWorkingChild(worker)
    const replacementState = worker.pooledChildStates.get(asChild(replacement))

    if (!replacementState) throw new Error("Expected replacement state")

    replacementState.inflight.set("replacement-job", {payload: fakePayload("replacement-job")})
    const deferredLines = captureStderr(() => completeFirstJob(worker, asChild(replacement)))

    expect(replacementState.retiring).toBe(false)
    expect(fork.spawned()).toEqual(1)
    expect(deferredLines.some((line) => line.includes("pooled-capacity-retirement-deferred"))).toEqual(true)
    expect(worker._availablePooledSlots()).toBeGreaterThan(0)

    // The replacement's process dies unexpectedly and its slot is absorbed. No
    // retirement mark or pending observation remains to restore a working
    // child, and at the cap nothing else can spawn lazily. The exit must spawn
    // a fresh bounded replacement and re-advertise its capacity immediately so
    // dispatch resumes instead of starving until the originals' long jobs
    // drain.
    sent.length = 0
    const lines = captureStderr(() => {
      void worker._handlePooledChildFailure({child: asChild(replacement), error: new Error("pooled child exited"), exitCode: 0, origin: "exit", signal: null})
    })

    expect(fork.spawned()).toEqual(2)
    expect(worker.pooledChildren.size).toEqual(3)
    expect(lines.some((line) => line.includes("pooled-capacity-liveness-spawn"))).toEqual(true)
    expect(worker._availablePooledSlots()).toBeGreaterThan(0)
    expect(sent.some((message) => message.type === "ready" && message.acceptsPooled === true && message.availablePooledSlots > 0)).toEqual(true)

    // Settle the last tracked jobs so the suite exits cleanly.
    captureStderr(() => completeFirstJob(worker, asChild(childA)))
    captureStderr(() => completeFirstJob(worker, asChild(childB)))
    expect(worker.pooledChildren.size).toBeLessThanOrEqual(2)
  })
})
