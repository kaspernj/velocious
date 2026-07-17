// @ts-check

import net from "node:net"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import {startBackgroundJobsMain} from "../helpers/background-jobs-helper.js"

/**
 * A control socket the main can track without a real connection. `close()` calls
 * `socket.end()`, which is a no-op on an unconnected socket.
 * @returns {JsonSocket} - Test worker socket.
 */
function fakeWorkerSocket() {
  return new JsonSocket(new net.Socket())
}

describe("Background jobs - worker resilience", {databaseCleaning: {truncate: true}}, () => {
  it("frees the forked slot on child exit and reports durably in the background", async () => {
    const worker = new BackgroundJobsWorker({})
    /** @type {Array<{jobId: string, status: string}>} */
    const reportCalls = []

    worker.statusReporter = /** @type {import("../../src/background-jobs/status-reporter.js").default} */ (/** @type {unknown} */ ({
      reportWithRetry: async (/** @type {{jobId: string, status: string}} */ args) => {
        reportCalls.push(args)
        await new Promise(() => {}) // durable retry that never lands (main unreachable)
      }
    }))

    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({}))
    let resolved = false

    // A crashed child (non-clean exit) whose report cannot land must still free
    // its slot immediately — leaked slots are what silently wedge the worker.
    worker._handleForkedChildExit({
      child,
      code: 1,
      signal: null,
      payload: {id: "job-1", jobName: "TestJob"},
      resolve: () => { resolved = true }
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(resolved).toEqual(true)
    expect(reportCalls.map((call) => call.jobId)).toEqual(["job-1"])
    // The report is tracked (durable), not abandoned.
    expect(worker.inflightReports.size).toEqual(1)
  })

  it("sends periodic liveness heartbeats", async () => {
    const worker = new BackgroundJobsWorker({heartbeatIntervalMs: 5})
    /** @type {Array<{type: string}>} */
    const sent = []

    worker.jsonSocket = /** @type {JsonSocket} */ (/** @type {unknown} */ ({
      send: (/** @type {{type: string}} */ message) => sent.push(message)
    }))
    worker._startHeartbeat()

    await new Promise((resolve) => setTimeout(resolve, 40))
    worker._stopHeartbeat()

    expect(sent.some((message) => message.type === "heartbeat")).toEqual(true)
  })

  it("drops a stale heartbeat-capable worker and returns its lease to the queue", async () => {
    const {main, store} = await startBackgroundJobsMain()

    try {
      const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})
      const handoff = await store.markHandedOff({jobId, workerId: "stale"})
      if (!handoff) throw new Error("Expected the job to be handed off")

      const staleWorker = fakeWorkerSocket()
      staleWorker.workerId = "stale"
      staleWorker.supportsHeartbeat = true
      staleWorker.lastSeenAt = Date.now() - 10 * 60 * 1000
      main.workers.add(staleWorker)
      main.workerHandoffs.set(staleWorker, new Map([[jobId, handoff.handoffId]]))

      await main._sweepStaleWorkers()

      expect(main.workers.has(staleWorker)).toEqual(false)
      expect((await store.getJob(jobId))?.status).toEqual("queued")
    } finally {
      await main.stop()
    }
  })

  it("does not evict a legacy worker that never advertised heartbeat support", async () => {
    const {main} = await startBackgroundJobsMain()

    try {
      const legacyWorker = fakeWorkerSocket()
      legacyWorker.workerId = "legacy"
      legacyWorker.supportsHeartbeat = false
      legacyWorker.lastSeenAt = Date.now() - 10 * 60 * 1000
      main.workers.add(legacyWorker)
      main.workerHandoffs.set(legacyWorker, new Map())

      await main._sweepStaleWorkers()

      expect(main.workers.has(legacyWorker)).toEqual(true)
    } finally {
      await main.stop()
    }
  })

  it("re-announces forked readiness on every completion, not just the cap-1 edge", async () => {
    const worker = new BackgroundJobsWorker({maxConcurrentForkedJobs: 2})
    /** @type {Array<{type: string, acceptsForked?: boolean}>} */
    const sent = []

    worker.jsonSocket = /** @type {JsonSocket} */ (/** @type {unknown} */ ({
      send: (/** @type {{type: string, acceptsForked?: boolean}} */ message) => sent.push(message)
    }))

    /** @type {() => void} */
    let resolveFirst = () => {}
    /** @type {() => void} */
    let resolveSecond = () => {}
    const first = new Promise((resolve) => { resolveFirst = resolve })
    const second = new Promise((resolve) => { resolveSecond = resolve })

    // Fill both forked slots to capacity.
    worker._trackProcessJob(first)
    worker._trackProcessJob(second)

    // Ignore the messages emitted while filling up; assert only on what the
    // worker announces as slots free again.
    sent.length = 0

    resolveFirst()
    resolveSecond()
    await new Promise((resolve) => setTimeout(resolve, 10))

    const forkedReady = sent.filter((message) => message.type === "ready" && message.acceptsForked === true)

    // The pre-fix knife-edge (`size === cap - 1`) announced readiness only on the
    // first completion; the second freed slot went silent and could leave the
    // worker out of the main's ready set — wedging dispatch. Both completions
    // must now re-announce. Because each fires on a genuinely freed slot, this
    // never advertises capacity that a pending handoff will consume.
    expect(forkedReady.length).toEqual(2)
  })

  it("adopts a reconnecting worker's handoffs on hello and releases them if it later disconnects", async () => {
    const {main, store} = await startBackgroundJobsMain()

    try {
      // A job the worker was running before the main restarted.
      const ownId = await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})
      const ownHandoff = await store.markHandedOff({jobId: ownId, workerId: "reconnecting-worker"})
      if (!ownHandoff) throw new Error("Expected the reconnecting worker's job to hand off")

      // A job held by a DIFFERENT worker that does not reconnect (e.g. still
      // draining under the old release). It must be left untouched — never
      // reclaimed early into a duplicate attempt.
      const otherId = await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})
      const otherHandoff = await store.markHandedOff({jobId: otherId, workerId: "other-worker"})
      if (!otherHandoff) throw new Error("Expected the other worker's job to hand off")

      // The worker reconnects with its stable id — drive the real hello handler.
      const worker = fakeWorkerSocket()
      main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {type: "hello", role: "worker", workerId: "reconnecting-worker", supportsHandoffIdReporting: true, supportsHeartbeat: true}
      })

      // Adoption runs asynchronously off the hello; wait for it to populate the map.
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(main.workerHandoffs.get(worker)?.get(ownId)).toEqual(ownHandoff.handoffId)
      // The other worker's job is neither adopted nor reclaimed.
      expect(main.workerHandoffs.get(worker)?.has(otherId)).toEqual(false)
      expect((await store.getJob(otherId))?.status).toEqual("handed_off")

      // When the reconnected worker later disconnects, only its adopted handoff returns to the queue.
      await main._handleWorkerSocketClosed(worker)

      expect((await store.getJob(ownId))?.status).toEqual("queued")
      expect((await store.getJob(otherId))?.status).toEqual("handed_off")
    } finally {
      await main.stop()
    }
  })
})
