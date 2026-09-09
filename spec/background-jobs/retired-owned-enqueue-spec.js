// @ts-check

import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsClient from "../../src/background-jobs/client.js"
import controlledClock from "../helpers/controlled-clock.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import { createBackgroundJobUpdateObserver } from "../helpers/background-jobs-helper.js"
import { emptyGenerationStore, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

/**
 * Proves one Node worker execution lane keeps its exact producer context after
 * generation retirement.
 * @param {object} args - Lane input.
 * @param {import("../../src/background-jobs/types.js").BackgroundJobExecutionMode} args.executionMode - Parent execution lane.
 * @param {number} [args.expectedChildCount] - Expected durable child rows.
 * @param {boolean} [args.retireBeforeRelease] - Whether A retires while the parent is blocked.
 * @param {Array<{args: Array<ReturnType<typeof JSON.parse>>, options?: import("../../src/background-jobs/types.js").BackgroundJobOptions}>} [args.requests] - Child enqueue requests.
 * @param {string} args.suffix - Unique generation suffix.
 * @param {boolean} [args.verifyRetiredBoundaries] - Whether to exercise retired client rejection boundaries.
 * @param {string} args.workerInstanceId - Stable worker UUID.
 * @returns {Promise<void>} - Resolves after the follow-up is verified.
 */
async function verifyExecutionLane({executionMode, expectedChildCount = 1, retireBeforeRelease = true, requests, suffix, verifyRetiredBoundaries = false, workerInstanceId}) {
  const parentBarrier = await createBackgroundJobsSocketBarrier(1)
  const workerReady = promiseBarrier()
  /** @type {ReturnType<typeof createBackgroundJobUpdateObserver> | null} */
  let updates = null
  const generationA = `owned-enqueue-${suffix}-a`
  const generationB = `owned-enqueue-${suffix}-b`
  const {main: mainA, store} = await startGenerationMain({
    generationId: generationA,
    initialGenerationState: "active",
    onJobUpdated: (update) => updates?.onJobUpdated(update),
    onWorkerReady: workerReady.entered
  })
  updates = createBackgroundJobUpdateObserver({store})
  const {main: mainB} = await startGenerationMain({generationId: generationB, initialGenerationState: "candidate", store})
  dummyConfiguration.setBackgroundJobsConfig({generationId: generationA, host: "127.0.0.1", port: mainA.getPort()})
  const workerA = new BackgroundJobsWorker({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    generationId: generationA,
    host: "127.0.0.1",
    pooledRunnerConcurrency: 1,
    pooledRunnerCount: 1,
    port: mainA.getPort(),
    workerInstanceId
  })

  try {
    await workerA.start()
    await workerReady.waiting
    const parentJobId = await store.enqueue({
      args: requests ? [parentBarrier.port, requests] : [parentBarrier.port],
      jobName: "RetiredOwnedFollowUpTestJob",
      options: {executionMode}
    })

    await mainA._drain()
    await parentBarrier.waiting
    if (retireBeforeRelease) {
      await mainA.retire()
      await mainA._retirementPromise
    }
    if (retireBeforeRelease && verifyRetiredBoundaries) {
      const retiredClient = new BackgroundJobsClient({configuration: dummyConfiguration, generationId: generationA})

      await expect(async () => await retiredClient.enqueue({args: [], jobName: "RetiredOrdinaryEnqueueJob"})).toThrow("Background jobs generation is retired")
      await expect(async () => await retiredClient.replaceScheduled({args: [], jobName: "RetiredOrdinaryEnqueueJob", scheduleKey: "retired-schedule"})).toThrow("Background jobs generation is retired")
      await expect(async () => await retiredClient.cancelScheduled({scheduleKey: "retired-schedule"})).toThrow("Background jobs generation is retired")
      await expect(async () => await retiredClient.enqueue({
        args: [],
        jobName: "RetiredMalformedOwnedEnqueueJob",
        producerProof: /** @type {import("../../src/background-jobs/types.js").BackgroundJobProducerProof} */ ({})
      })).toThrow("Background job producer proof is invalid.")
      expect(await store.countJobs({jobName: "RetiredOrdinaryEnqueueJob"})).toEqual(0)
      expect(await store.countJobs({jobName: "RetiredMalformedOwnedEnqueueJob"})).toEqual(0)
    }
    if (retireBeforeRelease) await mainB.activate()
    if (retireBeforeRelease && verifyRetiredBoundaries) {
      const foreignWorkerId = `${generationB}:a89fa5a0-0a13-405f-897e-6fb845de0390`
      const foreignProducerId = await store.enqueue({args: [], jobName: "ForeignGenerationProducerJob", options: {executionMode: "pooled"}})
      const foreignHandoff = await store.markHandedOff({jobId: foreignProducerId, workerId: foreignWorkerId})

      if (!foreignHandoff) throw new Error("Expected foreign generation producer handoff")

      const retiredClient = new BackgroundJobsClient({configuration: dummyConfiguration, generationId: generationA})
      await expect(async () => await retiredClient.enqueue({
        args: [],
        jobName: "ForeignGenerationFollowUpJob",
        producerProof: {
          handedOffAtMs: foreignHandoff.handedOffAtMs,
          handoffId: foreignHandoff.handoffId,
          jobId: foreignProducerId,
          workerId: foreignWorkerId
        }
      })).toThrow(/producer handoff belongs to another generation/i)
      expect(await store.countJobs({jobName: "ForeignGenerationFollowUpJob"})).toEqual(0)
    }
    parentBarrier.release()
    await updates.waitForUpdate(parentJobId)

    const childJobs = await store.listJobs({jobName: "RetiredOwnedFollowUpTestChildJob", limit: 10})

    expect(childJobs).toHaveLength(expectedChildCount)
    expect(new Set(childJobs.map(({id}) => id)).size).toEqual(expectedChildCount)
    if (retireBeforeRelease) {
      for (const childJob of childJobs) expect(childJob).toMatchObject({status: "queued", workerId: null})
    }
  } finally {
    parentBarrier.release()
    await workerA.stop()
    await mainA.stop()
    await mainB.stop()
    await parentBarrier.close()
  }
}

describe("Background jobs retired owned enqueue", {databaseCleaning: {transaction: true}}, () => {
  it("keeps identical active-generation performLater invocations distinct", async () => {
    await verifyExecutionLane({
      executionMode: "pooled",
      expectedChildCount: 2,
      requests: [{args: ["repeated follow-up"]}, {args: ["repeated follow-up"]}],
      retireBeforeRelease: false,
      suffix: "repeated-active",
      workerInstanceId: "16b8153c-0c13-465a-a188-e49157b882b5"
    })
  })

  it("keeps identical retired-generation performLater invocations distinct", async () => {
    await verifyExecutionLane({
      executionMode: "pooled",
      expectedChildCount: 2,
      requests: [{args: ["repeated follow-up"]}, {args: ["repeated follow-up"]}],
      suffix: "repeated-retired",
      workerInstanceId: "418fb56e-d0a5-4b32-8a7a-bbd3f36cb02e"
    })
  })

  it("accepts a pooled parent's follow-up after its generation retires without dispatching it", async () => {
    await verifyExecutionLane({
      executionMode: "pooled",
      suffix: "pooled",
      verifyRetiredBoundaries: true,
      workerInstanceId: "d69a7687-63dd-4fe8-80ca-8c572a370d38"
    })
  })

  it("carries exact ownership through inline, forked, and spawned execution", async () => {
    const lanes = [
      {executionMode: /** @type {const} */ ("inline"), suffix: "inline", workerInstanceId: "74e4a32e-16fa-4308-8be1-70be4e819760"},
      {executionMode: /** @type {const} */ ("forked"), suffix: "forked", workerInstanceId: "ac1fdcfe-01fd-48af-8466-5f77b8caed4f"},
      {executionMode: /** @type {const} */ ("spawned"), suffix: "spawned", workerInstanceId: "8e61ff45-a1c0-4f63-b2ce-2d36a7df6192"}
    ]

    for (const lane of lanes) await verifyExecutionLane(lane)
  })

  it("leaves a future deduplicated follow-up for generation C when B retires before it is due", async () => {
    const clock = controlledClock(1_000)
    const store = await emptyGenerationStore({clock})
    const parentBarrier = await createBackgroundJobsSocketBarrier(1)
    const readyA = promiseBarrier()
    const readyB = promiseBarrier()
    const readyC = promiseBarrier()
    /** @type {ReturnType<typeof createBackgroundJobUpdateObserver> | null} */
    let updatesA = null
    /** @type {ReturnType<typeof createBackgroundJobUpdateObserver> | null} */
    let updatesC = null
    const {main: mainA} = await startGenerationMain({clock, generationId: "future-release-a", initialGenerationState: "active", onJobUpdated: (update) => updatesA?.onJobUpdated(update), onWorkerReady: readyA.entered, store})
    const {main: mainB} = await startGenerationMain({clock, generationId: "future-release-b", initialGenerationState: "candidate", onWorkerReady: readyB.entered, store})
    const {main: mainC} = await startGenerationMain({clock, generationId: "future-release-c", initialGenerationState: "candidate", onJobUpdated: (update) => updatesC?.onJobUpdated(update), onWorkerReady: readyC.entered, store})
    updatesA = createBackgroundJobUpdateObserver({store})
    updatesC = createBackgroundJobUpdateObserver({store})
    const workers = [
      new BackgroundJobsWorker({closeDatabaseConnectionsOnStop: false, configuration: dummyConfiguration, generationId: "future-release-a", host: "127.0.0.1", pooledRunnerCount: 1, port: mainA.getPort(), workerInstanceId: "61b851fb-e2cd-4653-b985-fc62876d87e2"}),
      new BackgroundJobsWorker({closeDatabaseConnectionsOnStop: false, configuration: dummyConfiguration, generationId: "future-release-b", host: "127.0.0.1", port: mainB.getPort(), workerInstanceId: "58005123-97d7-4e10-946b-03ebdc2c26f7"}),
      new BackgroundJobsWorker({closeDatabaseConnectionsOnStop: false, configuration: dummyConfiguration, generationId: "future-release-c", host: "127.0.0.1", port: mainC.getPort(), workerInstanceId: "a7c04405-781f-41a6-a7ed-0313ddfaebef"})
    ]

    try {
      for (const worker of workers) await worker.start()
      await Promise.all([readyA.waiting, readyB.waiting, readyC.waiting])
      const requests = [
        {args: ["future follow-up"], options: {deduplicateWhileQueued: true, executionMode: /** @type {const} */ ("inline"), scheduledAtMs: 2_000}},
        {args: ["future follow-up"], options: {deduplicateWhileQueued: true, executionMode: /** @type {const} */ ("inline"), scheduledAtMs: 3_000}}
      ]
      const parentJobId = await store.enqueue({args: [parentBarrier.port, requests], jobName: "RetiredOwnedFollowUpTestJob", options: {executionMode: "pooled"}})

      await mainA._drain()
      await parentBarrier.waiting
      await mainA.retire()
      await mainA._retirementPromise
      await mainB.activate()
      parentBarrier.release()
      await updatesA.waitForUpdate(parentJobId)

      const queuedChildren = await store.listJobs({jobName: "RetiredOwnedFollowUpTestChildJob", limit: 10})

      expect(queuedChildren).toHaveLength(1)
      expect(queuedChildren[0]).toMatchObject({scheduledAtMs: 2_000, status: "queued", workerId: null})
      expect(mainA.scheduler).toEqual(undefined)
      expect(mainA.readyWorkers.size).toEqual(0)
      await mainB._drain()
      expect((await store.getJob(queuedChildren[0].id))?.status).toEqual("queued")

      await mainB.retire()
      await mainB._retirementPromise
      await mainC.activate()
      clock.advance(1_000)
      await mainC._drain()
      await updatesC.waitForUpdate(queuedChildren[0].id)

      expect(await store.getJob(queuedChildren[0].id)).toMatchObject({status: "completed", workerId: workers[2].workerId})
      expect(await store.countJobs({jobName: "RetiredOwnedFollowUpTestChildJob"})).toEqual(1)
    } finally {
      parentBarrier.release()
      for (const worker of workers) await worker.stop()
      await mainA.stop()
      await mainB.stop()
      await mainC.stop()
      await parentBarrier.close()
    }
  })
})
