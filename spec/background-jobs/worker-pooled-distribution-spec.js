// @ts-check

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
 * Adds a pooled child to a worker without forking a real process, so pooled child
 * selection can be exercised directly.
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @param {{inflight?: number, lastDispatchSeq?: number, retiring?: boolean}} [args] - Seed state.
 * @returns {import("node:child_process").ChildProcess} - The fake child.
 */
function addFakePooledChild(worker, {inflight = 0, lastDispatchSeq = 0, retiring = false} = {}) {
  const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({send() {}}))
  /** @type {Map<string, {payload: import("../../src/background-jobs/types.js").BackgroundJobPayload & {id: string}}>} */
  const inflightMap = new Map()

  for (let index = 0; index < inflight; index++) {
    inflightMap.set(`seed-${worker.pooledChildren.size}-${index}`, {payload: fakePayload(`seed-${index}`)})
  }

  worker.pooledChildren.add(child)
  worker.pooledChildStates.set(child, {createdAtMs: 0, inflight: inflightMap, jobsRun: 0, lastDispatchSeq, retiring})

  return child
}

/**
 * @param {BackgroundJobsWorker} worker - Worker under test.
 * @param {import("node:child_process").ChildProcess} child - Pooled child.
 * @returns {number} - Its in-flight job count.
 */
function inflightSize(worker, child) {
  const state = worker.pooledChildStates.get(child)

  if (!state) throw new Error("Missing pooled child state")

  return state.inflight.size
}

describe("Background jobs - pooled distribution", () => {
  it("spreads jobs evenly across children instead of first-fit packing the earliest", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerConcurrency: 4, pooledRunnerCount: 3})
    const first = addFakePooledChild(worker)
    const second = addFakePooledChild(worker)
    const third = addFakePooledChild(worker)

    for (let index = 0; index < 6; index++) worker._runPooledJob(fakePayload(`job-${index}`))

    // Round-robin: two each. First-fit would have packed [4, 2, 0].
    expect([inflightSize(worker, first), inflightSize(worker, second), inflightSize(worker, third)]).toEqual([2, 2, 2])
  })

  it("does not burst a freshly added child to catch up to already-loaded children", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerConcurrency: 10, pooledRunnerCount: 3})

    worker._pooledDispatchSeq = 2

    const loadedA = addFakePooledChild(worker, {inflight: 2, lastDispatchSeq: 1})
    const loadedB = addFakePooledChild(worker, {inflight: 2, lastDispatchSeq: 2})
    const fresh = addFakePooledChild(worker, {inflight: 0, lastDispatchSeq: 0})

    for (let index = 0; index < 3; index++) worker._runPooledJob(fakePayload(`job-${index}`))

    // The fresh child takes one job as its turn comes up, then the rotation moves on to
    // the others — not a burst of all three to "catch up" (which naive least-loaded,
    // always picking the lowest in-flight, would do).
    expect(inflightSize(worker, fresh)).toEqual(1)
    expect(inflightSize(worker, loadedA)).toEqual(3)
    expect(inflightSize(worker, loadedB)).toEqual(3)
  })

  it("skips retiring children and lazily spawns only when every non-retiring child is full", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerConcurrency: 2, pooledRunnerCount: 4})
    const retiring = addFakePooledChild(worker, {retiring: true})
    const full = addFakePooledChild(worker, {inflight: 2})

    // No non-retiring child has a free slot, so selection returns undefined (the caller
    // then spawns a new child).
    expect(worker._selectPooledChild()).toEqual(undefined)
    // The retiring child is never selected even though it has open slots.
    expect(inflightSize(worker, retiring)).toEqual(0)
    expect(inflightSize(worker, full)).toEqual(2)
  })
})
