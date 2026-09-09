// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import controlledClock from "../helpers/controlled-clock.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

/**
 * @typedef {object} OwnedEnqueueFixture
 * @property {ReturnType<typeof controlledClock>} clock - Controlled store clock.
 * @property {string} parentJobId - Owned producer job id.
 * @property {import("../../src/background-jobs/types.js").BackgroundJobProducerProof} producerProof - Exact producer lease.
 * @property {BackgroundJobsStore} store - Real SQL store.
 */

const WORKER_ID = "owned-enqueue-release-a:6fef4bb1-8b4f-470c-a854-e1c72478e9ab"

/**
 * @param {object} [args] - Fixture controls.
 * @param {ConstructorParameters<typeof BackgroundJobsStore>[0]["afterOwnedProducerValidation"]} [args.afterOwnedProducerValidation] - Validation barrier.
 * @returns {Promise<OwnedEnqueueFixture>} - Exact handed-off producer fixture.
 */
async function ownedEnqueueFixture({afterOwnedProducerValidation} = {}) {
  const clock = controlledClock(1_000)
  const store = new BackgroundJobsStore({
    afterOwnedProducerValidation,
    clock,
    configuration: dummyConfiguration
  })

  await store.clearAll()
  const parentJobId = await store.enqueue({
    args: [],
    jobName: "OwnedEnqueueParentJob",
    options: {executionMode: "pooled"}
  })
  const handoff = await store.markHandedOff({jobId: parentJobId, workerId: WORKER_ID})

  if (!handoff) throw new Error("Expected owned producer handoff")

  return {
    clock,
    parentJobId,
    producerProof: {
      handedOffAtMs: handoff.handedOffAtMs,
      handoffId: handoff.handoffId,
      jobId: parentJobId,
      workerId: WORKER_ID
    },
    store
  }
}

describe("Background jobs owned enqueue store", {databaseCleaning: {transaction: true}}, () => {
  it("preserves options, replays one invocation, and keeps identical invocations distinct", async () => {
    const {producerProof, store} = await ownedEnqueueFixture()
    const request = {
      args: [{event: "terminal", projectId: 42}],
      jobName: "OwnedEnqueueChildJob",
      options: {
        concurrencyKey: "project:42",
        executionMode: /** @type {const} */ ("forked"),
        maxConcurrency: 1,
        maxRetries: 7,
        queue: "critical",
        scheduledAtMs: 9_000,
        timeoutMs: 12_000
      },
      producerProof,
      producerInvocationId: "owned-options-invocation-1"
    }
    const firstJobId = await store.enqueueFromOwnedHandoff(request)
    const replayedJobId = await store.enqueueFromOwnedHandoff(request)
    const secondJobId = await store.enqueueFromOwnedHandoff({...request, producerInvocationId: "owned-options-invocation-2"})

    expect(replayedJobId).toEqual(firstJobId)
    expect(secondJobId).not.toEqual(firstJobId)
    expect(await store.getJob(firstJobId)).toMatchObject({
      args: [{event: "terminal", projectId: 42}],
      concurrencyKey: "project:42",
      executionMode: "forked",
      maxConcurrency: 1,
      maxRetries: 7,
      queue: "critical",
      scheduledAtMs: 9_000,
      status: "queued",
      timeoutMs: 12_000
    })
    expect(await store.countJobs({jobName: "OwnedEnqueueChildJob"})).toEqual(2)
  })

  it("rejects missing, malformed, and tampered producer proofs", async () => {
    const {parentJobId, producerProof, store} = await ownedEnqueueFixture()
    const request = {args: [], jobName: "RejectedOwnedChildJob", options: {deduplicateWhileQueued: true}}
    const rejectedProofs = [
      undefined,
      {},
      {...producerProof, jobId: ""},
      {...producerProof, jobId: "not-the-parent"},
      {...producerProof, handoffId: "wrong-handoff"},
      {...producerProof, workerId: "owned-enqueue-release-a:wrong-worker"},
      {...producerProof, handedOffAtMs: producerProof.handedOffAtMs + 1},
      {...producerProof, unexpected: "field"}
    ]

    for (const rejectedProof of rejectedProofs) {
      await expect(async () => await store.enqueueFromOwnedHandoff({
        ...request,
        producerProof: /** @type {import("../../src/background-jobs/types.js").BackgroundJobProducerProof} */ (rejectedProof),
        producerInvocationId: "rejected-proof-invocation"
      })).toThrow(/producer (proof is invalid|handoff is no longer owned)/i)
    }

    expect((await store.getJob(parentJobId))?.status).toEqual("handed_off")
    expect(await store.countJobs({jobName: "RejectedOwnedChildJob"})).toEqual(0)
  })

  it("validates ownership before returning a queued duplicate or replay", async () => {
    const {parentJobId, producerProof, store} = await ownedEnqueueFixture()
    const request = {
      args: ["same-event"],
      jobName: "StaleOwnedChildJob",
      options: {deduplicateWhileQueued: true},
      producerProof,
      producerInvocationId: "stale-invocation"
    }
    const childJobId = await store.enqueueFromOwnedHandoff(request)

    expect(await store.markCompleted({jobId: parentJobId, ...producerProof})).toEqual(true)
    await expect(async () => await store.enqueueFromOwnedHandoff(request)).toThrow(/producer handoff is no longer owned/i)
    expect(await store.countJobs({jobName: "StaleOwnedChildJob"})).toEqual(1)
    expect((await store.getJob(childJobId))?.status).toEqual("queued")
  })

  it("deduplicates covering queued work and permits a later event after it is handed off", async () => {
    const {clock, producerProof, store} = await ownedEnqueueFixture()
    const firstJobId = await store.enqueueFromOwnedHandoff({
      args: ["build-42"],
      jobName: "DedupeOwnedChildJob",
      options: {deduplicateWhileQueued: true, scheduledAtMs: 5_000},
      producerProof,
      producerInvocationId: "dedupe-invocation-1"
    })
    const coveredJobId = await store.enqueueFromOwnedHandoff({
      args: ["build-42"],
      jobName: "DedupeOwnedChildJob",
      options: {deduplicateWhileQueued: true, scheduledAtMs: 6_000},
      producerProof,
      producerInvocationId: "dedupe-invocation-2"
    })

    expect(coveredJobId).toEqual(firstJobId)
    clock.advance(4_000)
    expect(await store.markHandedOff({jobId: firstJobId, workerId: "owned-enqueue-release-b:worker"})).not.toEqual(null)

    const laterJobId = await store.enqueueFromOwnedHandoff({
      args: ["build-42"],
      jobName: "DedupeOwnedChildJob",
      options: {deduplicateWhileQueued: true, scheduledAtMs: 7_000},
      producerProof,
      producerInvocationId: "dedupe-invocation-3"
    })

    expect(laterJobId).not.toEqual(firstJobId)
    expect(await store.countJobs({jobName: "DedupeOwnedChildJob"})).toEqual(2)
  })

  it("preserves explicit idempotency across distinct producer invocations", async () => {
    const {producerProof, store} = await ownedEnqueueFixture()
    const request = {
      args: ["logical-event"],
      jobName: "IdempotentOwnedChildJob",
      options: {idempotencyKey: "logical-event-1"},
      producerProof
    }
    const firstJobId = await store.enqueueFromOwnedHandoff({...request, producerInvocationId: "idempotent-invocation-1"})
    const replayedJobId = await store.enqueueFromOwnedHandoff({...request, producerInvocationId: "idempotent-invocation-2"})

    expect(replayedJobId).toEqual(firstJobId)
    expect(await store.countJobs({jobName: "IdempotentOwnedChildJob"})).toEqual(1)
  })

  it("lets an insertion that owns the transaction commit before producer completion", async () => {
    const validated = promiseBarrier()
    const {parentJobId, producerProof, store} = await ownedEnqueueFixture({
      afterOwnedProducerValidation: async () => {
        validated.entered()
        await validated.blocked
      }
    })
    const enqueue = store.enqueueFromOwnedHandoff({
      args: [],
      jobName: "RacingOwnedChildJob",
      producerProof,
      producerInvocationId: "racing-invocation"
    })

    await validated.waiting
    let completionSettled = false
    const completion = store.markCompleted({jobId: parentJobId, ...producerProof})
      .then((accepted) => {
        completionSettled = true
        return accepted
      })

    expect(completionSettled).toBeFalse()
    validated.release()
    const childJobId = await enqueue

    expect(await completion).toEqual(true)
    expect((await store.getJob(childJobId))?.status).toEqual("queued")
  })

  it("rejects insertion after producer completion wins", async () => {
    const {parentJobId, producerProof, store} = await ownedEnqueueFixture()

    expect(await store.markCompleted({jobId: parentJobId, ...producerProof})).toEqual(true)
    await expect(async () => await store.enqueueFromOwnedHandoff({
      args: [],
      jobName: "LosingOwnedChildJob",
      producerProof,
      producerInvocationId: "losing-invocation"
    })).toThrow(/producer handoff is no longer owned/i)
    expect(await store.countJobs({jobName: "LosingOwnedChildJob"})).toEqual(0)
  })
})
