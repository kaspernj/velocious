// @ts-check

import { deferred } from "awaitery"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { clearBackgroundJobs, ControllableWorkerSocket } from "../helpers/background-jobs-helper.js"
import { describe, expect, it } from "../../src/testing/test.js"

const MAX_TIMER_MS = 2_147_483_647

// Startup-path waits are fail-fast bounds, not the behavior under test: mssql
// spends seconds in `configuration.initialize` and the schema/reconciliation
// startup steps, so per-driver-tight budgets flake on slow drivers. The
// network-backed drivers (mssql, pgsql, mariadb) get a budget sized for the
// heaviest observed CI shard load (a peak shard run pushed the wait to ~31s) while staying below the test
// runner's 60s default per-test cut, so a stalled startup still fails fast,
// and cleanly, before the runner intervenes; file-backed drivers keep the
// tight bound.
const STARTUP_WAIT_BUDGET_MS =
  ["mssql", "pgsql", "mysql", "mariadb"].includes(dummyConfiguration.getDatabaseType("default"))
    ? 45_000
    : 10_000

// The reclaim path hands recovered work back through the drain; on slow
// drivers under CI load a legitimate mark-handed-off call exceeded the
// production 3 s drain bound (a pg-sql shard run aborted the recovered-lease
// wake-up on that timeout). This file is not about the drain stall bound:
// pin it above slow-driver latency while staying below the runner's 60 s
// per-test cut.
const DRAIN_STORE_OPERATION_TIMEOUT_MS = 15_000

class ManualStartupClock {
  nextTimerId = 1
  /** @type {Map<number, () => void>} */
  timers = new Map()

  /** @param {number} timerId - Timer identifier. @returns {void} */
  clearTimeout(timerId) { this.timers.delete(timerId) }

  /** @returns {number} - Fixed current time. */
  now() { return 1_000 }

  /** @param {() => void} callback - Timer callback. @param {number} delayMs - Timer delay. @returns {number} - Timer identifier. */
  setTimeout(callback, delayMs) {
    void delayMs
    const timerId = this.nextTimerId++

    this.timers.set(timerId, callback)
    return timerId
  }
}

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

class ControlledStartupStore extends BackgroundJobsStore {
  /** @param {ConstructorParameters<typeof BackgroundJobsStore>[0]} args - Store options. */
  constructor(args) {
    super(args)
    this.scheduledLookupStarted = deferred()
    this.scheduledLookupCanFinish = deferred()
  }

  /** @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow | undefined>} - Next scheduled job. */
  async nextScheduledJob() {
    this.scheduledLookupStarted.resolve(undefined)
    await this.scheduledLookupCanFinish.promise
    return await super.nextScheduledJob()
  }
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

/** @returns {Promise<ControlledStartupStore>} - Empty store with a controlled startup lookup. */
async function createControlledStartupStore() {
  await dummyConfiguration.closeBackgroundJobsAdapter()
  dummyConfiguration.setCurrent()
  const store = new ControlledStartupStore({configuration: dummyConfiguration})

  await store.clearAll()
  return store
}

/**
 * @param {import("../../src/background-jobs/store.js").default} store - Startup store.
 * @param {number} workerReconnectGraceMs - Reconnect grace.
 * @param {ManualStartupClock} [clock] - Deterministic lifecycle clock.
 * @returns {Promise<BackgroundJobsMain>} - Started main.
 */
async function startMain(store, workerReconnectGraceMs, clock) {
  // This file exercises the main's default single-release startup path, and its
  // controlled stores deliberately implement only that mode. Pin the generation
  // keys so release-generation state left on the shared dummy configuration by
  // an earlier spec file cannot flip this main into generation mode (whose
  // adapter capability check these stores do not satisfy).
  dummyConfiguration.setBackgroundJobsConfig({
    adapter: store,
    dispatchStrategy: "beacon",
    drainStoreOperationTimeoutMs: DRAIN_STORE_OPERATION_TIMEOUT_MS,
    generationId: undefined,
    initialGenerationState: undefined,
    lifecycleSocketPath: undefined,
    retention: {completedTtlMs: null, failedTtlMs: null}
  })
  const main = new BackgroundJobsMain({
    closeDatabaseConnectionsOnStop: false,
    configuration: dummyConfiguration,
    clock: clock
      ? {
          clearTimeout: (timerId) => clock.clearTimeout(Number(timerId)),
          now: () => clock.now(),
          setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs)
        }
      : undefined,
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
  await timeout({timeout: STARTUP_WAIT_BUDGET_MS}, async () => {
    while (main._startupHandoffReclaimTimer || main._startupHandoffReclaimPromise) await wait(0.01)
  })
}

/** @param {BackgroundJobsMain} main - Main whose startup boundary should run now. @returns {Promise<void>} - Resolves after reclaim. */
async function runStartupReclaimNow(main) {
  if (main._startupHandoffReclaimTimer) clearTimeout(main._startupHandoffReclaimTimer)
  main._startupHandoffReclaimTimer = undefined
  main._startupHandoffAdoptionsAtDeadline = [...main.inflightWorkerHandoffAdoptions]
  main._startupHandoffGraceElapsed = true
  await main._startStartupHandoffReclaim()
}

describe("Background jobs - main startup handoff reclaim", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("starts reconnect grace only after active ownership startup completes", async () => {
    const store = await createControlledStartupStore()
    const jobId = await store.enqueue({args: [], jobName: "StartupBoundaryJob"})
    const handoff = await store.markHandedOff({jobId, workerId: "startup-boundary-worker"})
    const clock = new ManualStartupClock()
    const startup = startMain(store, 100, clock)
    let main

    // Startup intentionally stays pending until the finally block below; without
    // an observer a rejection landing before then would surface as an
    // unhandledRejection that fails the whole file instead of this single test.
    // The race consumes this observer, so a failed startup still fails this test
    // immediately, with the causing error.
    const startupSettledEarly = startup.then(() => {
      throw new Error("Startup settled before the scheduled-job lookup ran")
    })

    try {
      if (!handoff) throw new Error("Expected the startup boundary handoff")

      await timeout({timeout: STARTUP_WAIT_BUDGET_MS}, async () => await Promise.race([
        store.scheduledLookupStarted.promise,
        startupSettledEarly
      ]))
      expect(clock.timers.size).toEqual(0)
    } finally {
      store.scheduledLookupCanFinish.resolve(undefined)
      main = await startup
      await main.stop()
      await dummyConfiguration.closeBackgroundJobsAdapter()
    }
  })

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
    const main = await startMain(store, MAX_TIMER_MS)
    const currentWorker = addReadyWorker(main, "current-worker")
    const orphanEvents = []
    const onOrphan = (payload) => orphanEvents.push(payload)

    dummyConfiguration.getErrorEvents().on("background-job-orphaned", onOrphan)

    try {
      if (!staleHandoff) throw new Error("Expected the stale handoff")

      expect((await store.getJob(staleJobId))?.status).toEqual("handed_off")
      await main._drain()
      expect(currentWorker.receivedJobs).toEqual([])

      await runStartupReclaimNow(main)

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
    const main = await startMain(store, MAX_TIMER_MS)
    const worker = new ControllableWorkerSocket()

    try {
      if (!handoff) throw new Error("Expected the surviving handoff")

      expect(await main._handleRolelessSocketMessage({
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
      await runStartupReclaimNow(main)

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
    const main = await startMain(store, MAX_TIMER_MS)
    const worker = new ControllableWorkerSocket()

    try {
      if (!handoff) throw new Error("Expected the slow adoption handoff")

      expect(await main._handleRolelessSocketMessage({
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
      const startupReclaim = runStartupReclaimNow(main)

      // The reclaim is awaited only after the assertions below; keep it observed
      // in the gap so a rejection cannot surface as an unhandledRejection.
      void startupReclaim.catch(() => {})

      expect(main._startupHandoffGraceElapsed).toEqual(true)
      expect(await store.getJob(jobId)).toMatchObject({
        attempts: 0,
        handoffId: handoff.handoffId,
        status: "handed_off",
        workerId: "slow-adoption-worker"
      })

      store.adoptionCanFinish.resolve(undefined)
      await main._drainWorkerHandoffAdoptions()
      await startupReclaim
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

      expect(await main._handleRolelessSocketMessage({
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
      expect(await main._handleRolelessSocketMessage({
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

      expect(await main._handleRolelessSocketMessage({
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
