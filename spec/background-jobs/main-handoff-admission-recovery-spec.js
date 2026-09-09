// @ts-check

import net from "net"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import { describe, expect, it } from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { startBackgroundJobsMain } from "../helpers/background-jobs-helper.js"

class HandoffRecoveryTestAdapter extends SqlBackgroundJobsAdapter {
  /** @param {ConstructorParameters<typeof SqlBackgroundJobsAdapter>[0]} args - Adapter options. */
  constructor(args) {
    super(args)
    /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobHandoffRequest>} */
    this.handoffRequests = []
    /** @type {Array<{handoffId: string, jobId: string}>} */
    this.returnRequests = []
    /** @type {"before-commit" | "after-commit" | null} */
    this.nextHandoffFailure = null
    /** @type {"before-return" | "after-return" | null} */
    this.nextReturnFailure = null
    /** @type {{reached: () => void, released: Promise<void>} | null} */
    this.handoffPause = null
  }

  /** @param {"before-commit" | "after-commit"} stage - Failure stage. @returns {void} */
  failNextHandoff(stage) { this.nextHandoffFailure = stage }

  /** @param {"before-return" | "after-return"} stage - Failure stage. @returns {void} */
  failNextReturn(stage) { this.nextReturnFailure = stage }

  /**
   * Pauses the next claim after its transaction commits but before its caller
   * receives the result.
   * @returns {{reached: Promise<void>, release: () => void}} - Pause control.
   */
  pauseNextHandoffAfterCommit() {
    let markReached = () => {}
    let release = () => {}
    const reached = new Promise((resolve) => { markReached = () => resolve(undefined) })
    const released = new Promise((resolve) => { release = () => resolve(undefined) })

    this.handoffPause = {reached: markReached, released}

    return {reached, release}
  }

  /**
   * Claims with explicit fault points around the real SQL transaction.
   * @param {import("../../src/background-jobs/types.js").BackgroundJobHandoffRequest} args - Claim request.
   * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobHandoff | null>} - Claim result.
   */
  async markHandedOff(args) {
    this.handoffRequests.push({...args})
    const failure = this.nextHandoffFailure

    this.nextHandoffFailure = null
    if (failure === "before-commit") throw new Error("handoff failed before commit")

    const handoff = await super.markHandedOff(args)
    const pause = this.handoffPause

    if (pause) {
      this.handoffPause = null
      pause.reached()
      await pause.released
    }

    if (failure === "after-commit") throw new Error("handoff acknowledgement lost after commit")

    return handoff
  }

  /**
   * Releases with explicit fault points around the real fenced SQL transition.
   * @param {{handoffId: string, jobId: string}} args - Exact release request.
   * @returns {Promise<void>} - Resolves when acknowledged.
   */
  async markReturnedToQueue(args) {
    this.returnRequests.push({...args})
    const failure = this.nextReturnFailure

    this.nextReturnFailure = null
    if (failure === "before-return") throw new Error("handoff recovery read failed")

    await super.markReturnedToQueue(args)

    if (failure === "after-return") throw new Error("handoff recovery acknowledgement lost")
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

/**
 * Starts a main with long error cadence so tests explicitly drive retries.
 * @returns {Promise<{adapter: HandoffRecoveryTestAdapter, main: import("../../src/background-jobs/main.js").default}>} - Started test services.
 */
async function startRecoveryMain() {
  const adapter = new HandoffRecoveryTestAdapter({configuration: dummyConfiguration})
  const {main} = await startBackgroundJobsMain({
    backgroundJobsConfig: {adapter, pollIntervalMs: 60000}
  })

  return {adapter, main}
}

/**
 * Adds one exact-capacity pooled worker without triggering an automatic drain.
 * @param {import("../../src/background-jobs/main.js").default} main - Owning main.
 * @param {string} workerId - Stable worker id.
 * @returns {ControllableWorkerSocket} - Ready worker.
 */
function addReadyPooledWorker(main, workerId) {
  const worker = new ControllableWorkerSocket()

  worker.workerId = workerId
  worker.supportsHandoffIdReporting = true
  worker.acceptsForkedJobs = false
  worker.acceptsInlineJobs = false
  worker.acceptsPooledJobs = true
  worker.acceptsSpawnedJobs = false
  worker.availablePooledSlots = 1
  worker.usesPooledCapacityCredits = true
  worker.readinessVersion = 1
  main.workers.add(worker)
  main.readyWorkers.add(worker)
  main.workerHandoffs.set(worker, new Map())

  return worker
}

/** @param {HandoffRecoveryTestAdapter} adapter - Store. @returns {Promise<string>} - Job id. */
async function enqueuePooledJob(adapter) {
  return await adapter.enqueue({
    args: [],
    jobName: "TestJob",
    options: {concurrencyKey: "handoff-recovery", executionMode: "pooled", maxConcurrency: 1}
  })
}

describe("Background jobs - main handoff admission recovery", {databaseCleaning: {truncate: true}}, () => {
  it("dispatches the queue policy reconciled during handoff", async () => {
    const {adapter, main} = await startRecoveryMain()
    const worker = addReadyPooledWorker(main, "queue-policy-worker")

    try {
      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 3}}})
      const jobId = await adapter.enqueue({
        args: [],
        jobName: "TestJob",
        options: {executionMode: "pooled", queue: "builds"}
      })

      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 1}}})
      await main._drain()

      expect(await adapter.getJob(jobId)).toMatchObject({
        concurrencyKey: "queue:builds",
        maxConcurrency: 1,
        status: "handed_off"
      })
      expect(worker.receivedJobs).toMatchObject([{
        id: jobId,
        options: {
          concurrencyKey: "queue:builds",
          maxConcurrency: 1
        }
      }])
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
      await main.stop()
    }
  })

  it("restores worker admission when persistence throws before commit", async () => {
    const {adapter, main} = await startRecoveryMain()
    const worker = addReadyPooledWorker(main, "before-commit-worker")

    try {
      const jobId = await enqueuePooledJob(adapter)

      adapter.failNextHandoff("before-commit")
      await main._drain()

      const failedHandoffId = adapter.handoffRequests[0]?.handoffId

      expect(failedHandoffId).toBeTruthy()
      expect(adapter.returnRequests).toEqual([{handoffId: failedHandoffId, jobId}])
      expect((await adapter.getJob(jobId))?.status).toEqual("queued")
      expect(main.pendingHandoffRecoveries.size).toEqual(0)
      expect(worker.availablePooledSlots).toEqual(1)
      expect(main.readyWorkers.has(worker)).toEqual(true)
      expect(worker.receivedJobs).toEqual([])

      await main._drain()

      expect(worker.receivedJobs.length).toEqual(1)
      expect(worker.receivedJobs[0]?.handoffId === failedHandoffId).toEqual(false)
    } finally {
      await main.stop()
    }
  })

  it("returns only the caller-generated lease after commit acknowledgement loss", async () => {
    const {adapter, main} = await startRecoveryMain()
    const worker = addReadyPooledWorker(main, "after-commit-worker")

    try {
      const jobId = await enqueuePooledJob(adapter)

      adapter.failNextHandoff("after-commit")
      await main._drain()

      const failedHandoffId = adapter.handoffRequests[0]?.handoffId
      const recoveredJob = await adapter.getJob(jobId)

      expect(failedHandoffId).toBeTruthy()
      expect(adapter.returnRequests).toEqual([{handoffId: failedHandoffId, jobId}])
      expect(recoveredJob?.status).toEqual("queued")
      expect(recoveredJob?.handoffId).toEqual(null)
      expect(main.pendingHandoffRecoveries.size).toEqual(0)
      expect(worker.availablePooledSlots).toEqual(1)
      expect(main.readyWorkers.has(worker)).toEqual(true)

      await main._drain()

      expect(worker.receivedJobs.length).toEqual(1)
      expect(worker.receivedJobs[0]?.handoffId === failedHandoffId).toEqual(false)
    } finally {
      await main.stop()
    }
  })

  it("returns a committed claim without readmitting a worker that drained during persistence", async () => {
    const {adapter, main} = await startRecoveryMain()
    const worker = addReadyPooledWorker(main, "draining-worker")

    try {
      const jobId = await enqueuePooledJob(adapter)
      const pause = adapter.pauseNextHandoffAfterCommit()
      const drain = main._drain()

      await pause.reached
      main._handleWorkerDraining({jsonSocket: worker})
      pause.release()
      await drain

      expect((await adapter.getJob(jobId))?.status).toEqual("queued")
      expect(adapter.returnRequests[0]?.handoffId).toEqual(adapter.handoffRequests[0]?.handoffId)
      expect(main.pendingHandoffRecoveries.size).toEqual(0)
      expect(worker.availablePooledSlots).toEqual(0)
      expect(main.readyWorkers.has(worker)).toEqual(false)
      expect(worker.receivedJobs).toEqual([])

      main._handleWorkerReady({
        jsonSocket: worker,
        message: {type: "ready", acceptsPooled: true, availablePooledSlots: 1}
      })
      expect(main.readyWorkers.has(worker)).toEqual(false)
    } finally {
      await main.stop()
    }
  })

  it("retains a failed exact-lease return and retries it through dispatcher recovery", async () => {
    const {adapter, main} = await startRecoveryMain()
    const worker = addReadyPooledWorker(main, "recovery-retry-worker")
    const frameworkErrors = []
    const onFrameworkError = (payload) => frameworkErrors.push(payload)

    dummyConfiguration.getErrorEvents().on("framework-error", onFrameworkError)

    try {
      const jobId = await enqueuePooledJob(adapter)

      adapter.failNextHandoff("after-commit")
      adapter.failNextReturn("before-return")
      await main._drain()

      const ambiguousHandoffId = adapter.handoffRequests[0]?.handoffId
      const strandedJob = await adapter.getJob(jobId)

      expect(strandedJob?.status).toEqual("handed_off")
      expect(strandedJob?.handoffId).toEqual(ambiguousHandoffId)
      expect(main.pendingHandoffRecoveries.get(ambiguousHandoffId || "")).toEqual(jobId)
      expect(main._errorRetryTimer).toBeTruthy()
      expect(worker.availablePooledSlots).toEqual(1)
      expect(frameworkErrors[0]?.context.stage).toEqual("background-job-handoff-admission-recovery")

      await main._retryAfterError()

      const retriedJob = await adapter.getJob(jobId)

      expect(adapter.returnRequests).toEqual([
        {handoffId: ambiguousHandoffId, jobId},
        {handoffId: ambiguousHandoffId, jobId}
      ])
      expect(main.pendingHandoffRecoveries.size).toEqual(0)
      expect(worker.receivedJobs.length).toEqual(1)
      expect(worker.receivedJobs[0]?.handoffId === ambiguousHandoffId).toEqual(false)
      expect(retriedJob?.status).toEqual("handed_off")
      expect(retriedJob?.handoffId).toEqual(worker.receivedJobs[0]?.handoffId)
      expect(worker.availablePooledSlots).toEqual(0)
    } finally {
      dummyConfiguration.getErrorEvents().off("framework-error", onFrameworkError)
      await main.stop()
    }
  })

  it("fences a retained recovery from a newer lease adopted on reconnect", async () => {
    const {adapter, main} = await startRecoveryMain()
    const originalWorker = addReadyPooledWorker(main, "ambiguous-worker")

    try {
      const jobId = await enqueuePooledJob(adapter)

      adapter.failNextHandoff("after-commit")
      adapter.failNextReturn("after-return")
      await main._drain()

      const ambiguousHandoffId = adapter.handoffRequests[0]?.handoffId
      const newerHandoff = await adapter.markHandedOff({
        handoffId: "newer-reconnect-handoff",
        jobId,
        workerId: "reconnecting-worker"
      })

      if (!newerHandoff) throw new Error("Expected a newer handoff")

      const reconnectingWorker = new ControllableWorkerSocket()

      reconnectingWorker.workerId = "reconnecting-worker"
      reconnectingWorker.supportsHandoffIdReporting = true
      main.workers.add(reconnectingWorker)
      main.workerHandoffs.set(reconnectingWorker, new Map())
      await main._adoptWorkerHandoffs(reconnectingWorker)

      expect(main.workerHandoffs.get(reconnectingWorker)?.get(jobId)).toEqual(newerHandoff.handoffId)
      expect(main.pendingHandoffRecoveries.get(ambiguousHandoffId || "")).toEqual(jobId)

      await main._retryAfterError()

      const fencedJob = await adapter.getJob(jobId)

      expect(adapter.returnRequests.at(-1)).toEqual({handoffId: ambiguousHandoffId, jobId})
      expect(main.pendingHandoffRecoveries.size).toEqual(0)
      expect(fencedJob?.status).toEqual("handed_off")
      expect(fencedJob?.handoffId).toEqual(newerHandoff.handoffId)
      expect(main.workerHandoffs.get(reconnectingWorker)?.get(jobId)).toEqual(newerHandoff.handoffId)
      expect(originalWorker.receivedJobs).toEqual([])
      expect(reconnectingWorker.receivedJobs).toEqual([])
    } finally {
      await main.stop()
    }
  })
})
