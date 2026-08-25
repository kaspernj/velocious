// @ts-check

import net from "node:net"
import { deferred } from "awaitery"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { clearBackgroundJobs } from "../helpers/background-jobs-helper.js"
import { describe, expect, it } from "../../src/testing/test.js"

class ControlledAdoptionStore extends BackgroundJobsStore {
  /** @param {ConstructorParameters<typeof BackgroundJobsStore>[0]} args - Store options. */
  constructor(args) {
    super(args)
    this.adoptionStarted = deferred()
    this.adoptionCanFinish = deferred()
    /** @type {Error | undefined} */
    this.adoptionError = undefined
  }

  /** @param {{workerId: string}} args - Worker lookup. @returns {Promise<{jobId: string, handoffId: string}[]>} - Active worker handoffs. */
  async handedOffJobsForWorker(args) {
    const handoffs = await super.handedOffJobsForWorker(args)

    this.adoptionStarted.resolve(undefined)
    await this.adoptionCanFinish.promise
    if (this.adoptionError) throw this.adoptionError

    return handoffs
  }
}

class ControllableWorkerSocket extends JsonSocket {
  constructor() {
    super(new net.Socket())
    /** @type {import("../../src/background-jobs/types.js").BackgroundJobPayload[]} */
    this.receivedJobs = []
  }

  /** @param {import("../../src/background-jobs/types.js").BackgroundJobSocketMessage} message - Main message. @returns {void} */
  send(message) {
    if (message.type === "job") this.receivedJobs.push(message.payload)
  }

  /** @returns {void} */
  close() {}
}

/** @returns {Promise<import("../../src/background-jobs/store.js").default>} - Empty SQL background-jobs store. */
async function createStore() {
  await dummyConfiguration.closeBackgroundJobsAdapter()
  return await clearBackgroundJobs()
}

/** @returns {Promise<ControlledAdoptionStore>} - Empty store with a controlled adoption query. */
async function createControlledAdoptionStore() {
  await dummyConfiguration.closeBackgroundJobsAdapter()
  dummyConfiguration.setCurrent()
  const store = new ControlledAdoptionStore({configuration: dummyConfiguration})

  await store.clearAll()
  return store
}

/**
 * @param {import("../../src/background-jobs/store.js").default} store - Startup store.
 * @param {number} workerReconnectGraceMs - Reconnect grace.
 * @returns {Promise<BackgroundJobsMain>} - Started main.
 */
async function startMain(store, workerReconnectGraceMs) {
  dummyConfiguration.setBackgroundJobsConfig({
    adapter: store,
    dispatchStrategy: "beacon",
    retention: {completedTtlMs: null, failedTtlMs: null}
  })
  const main = new BackgroundJobsMain({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    host: "127.0.0.1",
    port: 0,
    workerReconnectGraceMs
  })

  await main.start()
  return main
}

/**
 * Adds a current-generation worker without a network transport.
 * @param {BackgroundJobsMain} main - Owning main.
 * @param {string} workerId - Stable worker id.
 * @returns {ControllableWorkerSocket} - Ready worker.
 */
function addReadyWorker(main, workerId) {
  const worker = new ControllableWorkerSocket()

  worker.workerId = workerId
  worker.supportsHandoffIdReporting = true
  worker.acceptsForkedJobs = true
  worker.acceptsInlineJobs = true
  worker.acceptsPooledJobs = true
  worker.acceptsSpawnedJobs = true
  worker.availablePooledSlots = 1
  worker.usesPooledCapacityCredits = true
  worker.readinessVersion = 1
  main.workers.add(worker)
  main.readyWorkers.add(worker)
  main.workerHandoffs.set(worker, new Map())

  return worker
}

/** @param {BackgroundJobsMain} main - Main whose startup reclaim should finish. @returns {Promise<void>} - Resolves after the grace pass. */
async function waitForStartupReclaim(main) {
  await timeout({timeout: 1000}, async () => {
    while (main._startupHandoffReclaimTimer || main._startupHandoffReclaimPromise) await wait(0.01)
  })
}

describe("Background jobs - main startup handoff reclaim", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("reclaims an unchanged pre-start lease after grace and wakes concurrency-blocked work", async () => {
    const store = await createStore()
    const concurrency = {concurrencyKey: "run-queued-builds", maxConcurrency: 1}
    const staleJobId = await store.enqueue({
      args: [],
      jobName: "RunQueuedBuildsJob",
      options: {...concurrency, maxRetries: 1}
    })
    const staleHandoff = await store.markHandedOff({jobId: staleJobId, workerId: "dead-deploy-worker"})
    const queuedJobId = await store.enqueue({args: [], jobName: "RunQueuedBuildsJob", options: concurrency})
    const main = await startMain(store, 200)
    const currentWorker = addReadyWorker(main, "current-worker")
    const orphanEvents = []
    const onOrphan = (payload) => orphanEvents.push(payload)

    dummyConfiguration.getErrorEvents().on("background-job-orphaned", onOrphan)

    try {
      if (!staleHandoff) throw new Error("Expected the stale handoff")

      expect((await store.getJob(staleJobId))?.status).toEqual("handed_off")
      await main._drain()
      expect(currentWorker.receivedJobs).toEqual([])

      await waitForStartupReclaim(main)

      expect(await store.getJob(staleJobId)).toMatchObject({
        attempts: 1,
        handoffId: staleHandoff.handoffId,
        status: "queued",
        workerId: null
      })
      expect(currentWorker.receivedJobs.map((job) => job.id)).toEqual([queuedJobId])
      expect(await store.getJob(queuedJobId)).toMatchObject({
        handoffId: currentWorker.receivedJobs[0]?.handoffId,
        status: "handed_off",
        workerId: "current-worker"
      })
      expect(orphanEvents.map((event) => ({jobId: event.context.jobId, willRetry: event.context.willRetry}))).toEqual([
        {jobId: staleJobId, willRetry: true}
      ])
    } finally {
      dummyConfiguration.getErrorEvents().off("background-job-orphaned", onOrphan)
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("preserves and adopts a startup lease only after the same worker successfully reconnects within grace", async () => {
    const store = await createControlledAdoptionStore()
    const jobId = await store.enqueue({args: [], jobName: "SurvivingJob"})
    const handoff = await store.markHandedOff({jobId, workerId: "surviving-worker"})
    const main = await startMain(store, 100)
    const worker = new ControllableWorkerSocket()

    try {
      if (!handoff) throw new Error("Expected the surviving handoff")

      expect(main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {
          role: "worker",
          supportsHandoffIdReporting: true,
          supportsHeartbeat: true,
          type: "hello",
          workerId: "surviving-worker"
        }
      })).toEqual("worker")
      await store.adoptionStarted.promise
      expect(main.reconnectedWorkerIds.has("surviving-worker")).toEqual(false)

      store.adoptionCanFinish.resolve(undefined)
      await main._drainWorkerHandoffAdoptions()
      expect(main.reconnectedWorkerIds.has("surviving-worker")).toEqual(true)
      await waitForStartupReclaim(main)

      expect(main.workerHandoffs.get(worker)?.get(jobId)).toEqual(handoff.handoffId)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 0,
        handoffId: handoff.handoffId,
        status: "handed_off",
        workerId: "surviving-worker"
      })

      await main._handleWorkerSocketClosed(worker)
      expect(await store.getJob(jobId)).toMatchObject({
        handoffId: null,
        status: "queued",
        workerId: null
      })
    } finally {
      store.adoptionCanFinish.resolve(undefined)
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("waits for a live worker adoption begun before grace expires", async () => {
    const store = await createControlledAdoptionStore()
    const jobId = await store.enqueue({args: [], jobName: "SlowAdoptionJob"})
    const handoff = await store.markHandedOff({jobId, workerId: "slow-adoption-worker"})
    const main = await startMain(store, 200)
    const worker = new ControllableWorkerSocket()

    try {
      if (!handoff) throw new Error("Expected the slow adoption handoff")

      expect(main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {
          role: "worker",
          supportsHandoffIdReporting: true,
          supportsHeartbeat: true,
          type: "hello",
          workerId: "slow-adoption-worker"
        }
      })).toEqual("worker")
      await store.adoptionStarted.promise
      expect(main._startupHandoffGraceElapsed).toEqual(false)
      await timeout({timeout: 1000}, async () => {
        while (!main._startupHandoffGraceElapsed) await wait(1)
      })
      await wait(25)

      expect(main._startupHandoffGraceElapsed).toEqual(true)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 0,
        handoffId: handoff.handoffId,
        status: "handed_off",
        workerId: "slow-adoption-worker"
      })

      store.adoptionCanFinish.resolve(undefined)
      await main._drainWorkerHandoffAdoptions()
      await waitForStartupReclaim(main)
      expect(main.reconnectedWorkerIds.has("slow-adoption-worker")).toEqual(true)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 0,
        handoffId: handoff.handoffId,
        status: "handed_off",
        workerId: "slow-adoption-worker"
      })
    } finally {
      store.adoptionCanFinish.resolve(undefined)
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("bounds the deadline wait when an adoption query stays stuck", async () => {
    const store = await createControlledAdoptionStore()
    const jobId = await store.enqueue({args: [], jobName: "StuckAdoptionJob", options: {maxRetries: 0}})
    const handoff = await store.markHandedOff({jobId, workerId: "stuck-adoption-worker"})
    const main = await startMain(store, 20)
    const worker = new ControllableWorkerSocket()

    try {
      if (!handoff) throw new Error("Expected the stuck adoption handoff")

      expect(main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {
          role: "worker",
          supportsHandoffIdReporting: true,
          supportsHeartbeat: true,
          type: "hello",
          workerId: "stuck-adoption-worker"
        }
      })).toEqual("worker")
      await store.adoptionStarted.promise
      await waitForStartupReclaim(main)

      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 1,
        handoffId: handoff.handoffId,
        status: "orphaned",
        workerId: null
      })

      await main._handleWorkerSocketClosed(worker)
      store.adoptionCanFinish.resolve(undefined)
      await main._drainWorkerHandoffAdoptions()
      expect(main.reconnectedWorkerIds.has("stuck-adoption-worker")).toEqual(false)
    } finally {
      store.adoptionCanFinish.resolve(undefined)
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("reclaims a startup lease when the reconnect adoption query rejects", async () => {
    const store = await createControlledAdoptionStore()
    const jobId = await store.enqueue({args: [], jobName: "RejectedAdoptionJob", options: {maxRetries: 0}})
    const handoff = await store.markHandedOff({jobId, workerId: "rejected-worker"})
    const main = await startMain(store, 100)
    const worker = new ControllableWorkerSocket()
    const frameworkErrors = []
    const onFrameworkError = (payload) => frameworkErrors.push(payload)

    dummyConfiguration.getErrorEvents().on("framework-error", onFrameworkError)

    try {
      if (!handoff) throw new Error("Expected the rejected handoff")

      store.adoptionError = new Error("Adoption query failed")
      expect(main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {
          role: "worker",
          supportsHandoffIdReporting: true,
          supportsHeartbeat: true,
          type: "hello",
          workerId: "rejected-worker"
        }
      })).toEqual("worker")
      await store.adoptionStarted.promise
      store.adoptionCanFinish.resolve(undefined)
      await main._drainWorkerHandoffAdoptions()

      expect(main.reconnectedWorkerIds.has("rejected-worker")).toEqual(false)
      expect(frameworkErrors).toMatchObject([{context: {stage: "background-job-handoff-adopt"}, error: {message: "Adoption query failed"}}])
      await waitForStartupReclaim(main)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 1,
        handoffId: handoff.handoffId,
        status: "orphaned",
        workerId: null
      })
    } finally {
      store.adoptionCanFinish.resolve(undefined)
      dummyConfiguration.getErrorEvents().off("framework-error", onFrameworkError)
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("reclaims a startup lease when the worker disconnects during adoption", async () => {
    const store = await createControlledAdoptionStore()
    const jobId = await store.enqueue({args: [], jobName: "DisconnectedAdoptionJob", options: {maxRetries: 0}})
    const handoff = await store.markHandedOff({jobId, workerId: "disconnecting-worker"})
    const main = await startMain(store, 100)
    const worker = new ControllableWorkerSocket()

    try {
      if (!handoff) throw new Error("Expected the disconnecting handoff")

      expect(main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {
          role: "worker",
          supportsHandoffIdReporting: true,
          supportsHeartbeat: true,
          type: "hello",
          workerId: "disconnecting-worker"
        }
      })).toEqual("worker")
      await store.adoptionStarted.promise
      await main._handleWorkerSocketClosed(worker)
      store.adoptionCanFinish.resolve(undefined)
      await main._drainWorkerHandoffAdoptions()

      expect(main.reconnectedWorkerIds.has("disconnecting-worker")).toEqual(false)
      await waitForStartupReclaim(main)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 1,
        handoffId: handoff.handoffId,
        status: "orphaned",
        workerId: null
      })
    } finally {
      store.adoptionCanFinish.resolve(undefined)
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("does not snapshot a current-generation handoff", async () => {
    const store = await createStore()
    const main = await startMain(store, 20)

    try {
      const jobId = await store.enqueue({args: [], jobName: "CurrentGenerationJob"})
      const handoff = await store.markHandedOff({jobId, workerId: "current-worker"})

      if (!handoff) throw new Error("Expected the current-generation handoff")

      await wait(0.05)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 0,
        handoffId: handoff.handoffId,
        status: "handed_off",
        workerId: "current-worker"
      })
    } finally {
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

  it("unrefs the grace timer and clears it during shutdown", async () => {
    const store = await createStore()
    const jobId = await store.enqueue({args: [], jobName: "TimerCleanupJob"})
    const handoff = await store.markHandedOff({jobId, workerId: "missing-worker"})
    const main = await startMain(store, 60_000)

    try {
      if (!handoff) throw new Error("Expected the startup handoff")

      expect(main._startupHandoffReclaimTimer).toBeTruthy()
      expect(main._startupHandoffReclaimTimer?.hasRef()).toEqual(false)
    } finally {
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }

    expect(main._startupHandoffReclaimTimer).toBeUndefined()
  })
})
