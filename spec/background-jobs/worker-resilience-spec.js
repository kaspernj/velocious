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

/**
 * Closes a TCP server after all accepted connections have closed.
 * @param {net.Server} server - Server to close.
 * @returns {Promise<void>} - Resolves after the server closes.
 */
async function closeServer(server) {
  try {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_SERVER_NOT_RUNNING") return
    throw error
  }
}

/**
 * Starts a worker against a minimal configuration and local socket server.
 * @param {ConstructorParameters<typeof BackgroundJobsWorker>[0]} workerOptions - Worker options.
 * @returns {Promise<{server: net.Server, worker: BackgroundJobsWorker}>} - Started worker and server.
 */
async function startConfiguredWorker(workerOptions) {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address")

  const configuration = /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ ({
    setCurrent: () => {},
    initialize: async () => {},
    connectBeacon: async () => {},
    disconnectBeacon: async () => {},
    closeDatabaseConnections: async () => {},
    getBackgroundJobsConfig: () => ({
      host: "127.0.0.1", port: address.port,
      maxConcurrentInlineJobs: 4, maxConcurrentForkedJobs: 4,
      pooledRunnerCount: 7, pooledRunnerMaxJobs: 31,
      pooledRunnerMaxRssBytes: 12345, pooledRunnerMaxLifetimeMs: 67890
    })
  }))
  const worker = new BackgroundJobsWorker({configuration, ...workerOptions})
  try {
    await worker.start()
  } catch (error) {
    await closeServer(server)
    throw error
  }

  return {server, worker}
}

describe("Background jobs - worker resilience", {databaseCleaning: {truncate: true}}, () => {
  it("defaults pooled runner lifecycle bounds", () => {
    const worker = new BackgroundJobsWorker({})

    expect(worker.pooledRunnerCount).toEqual(4)
    expect(worker.pooledRunnerMaxJobs).toEqual(100)
    expect(worker.pooledRunnerMaxRssBytes).toEqual(512 * 1024 * 1024)
    expect(worker.pooledRunnerMaxLifetimeMs).toEqual(60 * 60 * 1000)
  })

  it("falls back to configured pooled bounds for invalid constructor overrides", async () => {
    const {server, worker} = await startConfiguredWorker({
      pooledRunnerCount: 0,
      pooledRunnerMaxJobs: 1.5,
      pooledRunnerMaxRssBytes: Infinity,
      pooledRunnerMaxLifetimeMs: NaN
    })

    try {
      expect(worker.pooledRunnerCount).toEqual(7)
      expect(worker.pooledRunnerMaxJobs).toEqual(31)
      expect(worker.pooledRunnerMaxRssBytes).toEqual(12345)
      expect(worker.pooledRunnerMaxLifetimeMs).toEqual(67890)
    } finally {
      try {
        await worker.stop()
      } finally {
        await closeServer(server)
      }
    }
  })

  it("keeps valid constructor pooled bounds authoritative", async () => {
    const {server, worker} = await startConfiguredWorker({
      pooledRunnerCount: 2,
      pooledRunnerMaxJobs: 3,
      pooledRunnerMaxRssBytes: 4.5,
      pooledRunnerMaxLifetimeMs: 5.5
    })

    try {
      expect(worker.pooledRunnerCount).toEqual(2)
      expect(worker.pooledRunnerMaxJobs).toEqual(3)
      expect(worker.pooledRunnerMaxRssBytes).toEqual(4.5)
      expect(worker.pooledRunnerMaxLifetimeMs).toEqual(5.5)
    } finally {
      try {
        await worker.stop()
      } finally {
        await closeServer(server)
      }
    }
  })

  it("keeps pooled capacity separate and re-announces it after completion", async () => {
    const worker = new BackgroundJobsWorker({maxConcurrentForkedJobs: 1, pooledRunnerCount: 1})
    /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobSocketMessage>} */
    const sent = []
    worker.jsonSocket = /** @type {JsonSocket} */ (/** @type {unknown} */ ({send: (message) => sent.push(message)}))
    // Occupy the single pooled slot with a full child (concurrency defaults to 1).
    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({}))
    const inflight = new Map([["p1", {payload: {id: "p1", jobName: "TestJob"}, resolve: () => {}}]])
    worker.pooledChildren.add(child)
    worker.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight, retiring: false})
    /** @type {() => void} */
    let resolvePooled = () => {}
    worker._trackPooledJob(new Promise((resolve) => { resolvePooled = resolve }))

    const atCapacity = worker._readyMessage()
    expect(atCapacity?.type === "ready" && atCapacity.acceptsPooled).toEqual(false)
    expect(atCapacity?.type === "ready" && atCapacity.acceptsForked).toEqual(true)

    sent.length = 0
    inflight.delete("p1")
    resolvePooled()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent.some((message) => message.type === "ready" && message.acceptsPooled === true)).toEqual(true)
  })

  it("holds pooled capacity until an unhealthy runner fallback report settles", async () => {
    const worker = new BackgroundJobsWorker({})
    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({}))
    let resolved = false
    /** @type {() => void} */
    let resolveReport = () => {}
    /** @type {Array<{jobId: string, status: string}>} */
    const reports = []
    worker.statusReporter = /** @type {import("../../src/background-jobs/status-reporter.js").default} */ (/** @type {unknown} */ ({
      reportWithRetry: async (args) => {
        reports.push(args)
        await new Promise((resolve) => { resolveReport = resolve })
      }
    }))
    worker.pooledChildren.add(child)
    worker.inflightProcessChildren.add(child)
    worker.pooledChildStates.set(child, {
      createdAtMs: Date.now(), jobsRun: 2, retiring: false,
      inflight: new Map([["pooled-failed", {payload: {id: "pooled-failed", jobName: "TestJob"}, resolve: () => { resolved = true }}]])
    })

    void worker._handlePooledChildFailure({child, error: new Error("runner exited")})
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(resolved).toEqual(false)
    expect(worker.pooledChildren.size).toEqual(0)
    expect(reports.map((report) => report.jobId)).toEqual(["pooled-failed"])

    resolveReport()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resolved).toEqual(true)
  })

  it("does not fallback-report an acknowledged failed pooled outcome", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 1})
    let killed = false
    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({kill: () => { killed = true }}))
    let resolved = false
    worker.pooledChildren.add(child)
    worker.pooledChildStates.set(child, {
      createdAtMs: Date.now(), jobsRun: 0, retiring: false,
      inflight: new Map([["acknowledged-failure", {payload: {id: "acknowledged-failure", jobName: "FailingJob"}, resolve: () => { resolved = true }}]])
    })

    worker._handlePooledChildMessage({child, message: {
      type: "job-outcome", jobId: "acknowledged-failure", acknowledged: true,
      status: "failed", rssBytes: 1
    }})

    expect(resolved).toEqual(true)
    expect(worker.pooledChildren.has(child)).toEqual(true)
    expect(killed).toEqual(false)
  })

  for (const threshold of ["jobs", "rss", "age"]) {
    it(`retires a pooled runner after its acknowledged ${threshold} threshold`, () => {
      const worker = new BackgroundJobsWorker({
        pooledRunnerMaxJobs: threshold === "jobs" ? 1 : 10,
        pooledRunnerMaxRssBytes: threshold === "rss" ? 10 : 1000,
        pooledRunnerMaxLifetimeMs: threshold === "age" ? 10 : 1000
      })
      let killed = false
      const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({kill: () => { killed = true }}))
      worker.pooledChildren.add(child)
      worker.inflightProcessChildren.add(child)
      worker.pooledChildStates.set(child, {
        createdAtMs: threshold === "age" ? Date.now() - 20 : Date.now(), jobsRun: 0, retiring: false,
        inflight: new Map([[`threshold-${threshold}`, {payload: {id: `threshold-${threshold}`, jobName: "TestJob"}}]])
      })

      worker._handlePooledChildMessage({child, message: {
        type: "job-outcome", jobId: `threshold-${threshold}`, acknowledged: true,
        status: "completed", rssBytes: threshold === "rss" ? 10 : 1
      }})

      expect(killed).toEqual(true)
      expect(worker.pooledChildren.has(child)).toEqual(false)
    })
  }

  it("runs jobs concurrently on one pooled child up to pooledRunnerConcurrency", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 2, pooledRunnerConcurrency: 3})
    /** @type {Array<{id: string}>} */
    const sends = []
    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({send: (/** @type {{payload: {id: string}}} */ message) => sends.push(message.payload)}))
    worker.pooledChildren.add(child)
    worker.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), retiring: false})

    for (const id of ["a", "b", "c"]) void worker._runPooledJob({id, jobName: "TestJob"})

    // All three ran concurrently on the same child; none spawned a new one.
    expect(sends.map((payload) => payload.id)).toEqual(["a", "b", "c"])
    expect(worker.pooledChildStates.get(child)?.inflight.size).toEqual(3)
    expect(worker.pooledChildren.size).toEqual(1)
    // Capacity: 2 children x 3 concurrency = 6 slots, 3 used, so 3 free (the
    // full child's 0 open slots + one spawnable child's 3).
    expect(worker._availablePooledSlots()).toEqual(3)
  })

  it("eagerly spawns one replacement when a concurrent child retires, terminating it only once drained", () => {
    const worker = new BackgroundJobsWorker({pooledRunnerCount: 1, pooledRunnerConcurrency: 2, pooledRunnerMaxJobs: 1})
    worker.configuration = /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ ({}))
    let spawned = 0
    worker._createPooledChild = () => { spawned += 1; return /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({})) }
    let killed = false
    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({kill: () => { killed = true }}))
    worker.pooledChildren.add(child)
    worker.inflightProcessChildren.add(child)
    worker.pooledChildStates.set(child, {
      createdAtMs: Date.now(), jobsRun: 0, retiring: false,
      inflight: new Map([
        ["j1", {payload: {id: "j1", jobName: "TestJob"}, resolve: () => {}}],
        ["j2", {payload: {id: "j2", jobName: "TestJob"}, resolve: () => {}}]
      ])
    })

    // j1 completes -> jobsRun hits maxJobs(1) -> retire + pre-warm, but j2 is still running.
    worker._handlePooledChildMessage({child, message: {type: "job-outcome", jobId: "j1", acknowledged: true, status: "completed", rssBytes: 1}})
    expect(worker.pooledChildStates.get(child)?.retiring).toEqual(true)
    expect(spawned).toEqual(1)
    expect(killed).toEqual(false)

    // j2 completes -> drained -> terminate the retiring child, no further replacement.
    worker._handlePooledChildMessage({child, message: {type: "job-outcome", jobId: "j2", acknowledged: true, status: "completed", rssBytes: 1}})
    expect(killed).toEqual(true)
    expect(worker.pooledChildren.has(child)).toEqual(false)
    expect(spawned).toEqual(1)
  })

  it("reports every in-flight job when a concurrent pooled child crashes", async () => {
    const worker = new BackgroundJobsWorker({pooledRunnerConcurrency: 3})
    /** @type {Array<{jobId: string, status: string}>} */
    const reports = []
    worker.statusReporter = /** @type {import("../../src/background-jobs/status-reporter.js").default} */ (/** @type {unknown} */ ({
      reportWithRetry: async (/** @type {{jobId: string, status: string}} */ args) => { reports.push(args) }
    }))
    const child = /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ ({}))
    worker.pooledChildren.add(child)
    worker.inflightProcessChildren.add(child)
    worker.pooledChildStates.set(child, {
      createdAtMs: Date.now(), jobsRun: 0, retiring: false,
      inflight: new Map([
        ["c1", {payload: {id: "c1", jobName: "TestJob"}, resolve: () => {}}],
        ["c2", {payload: {id: "c2", jobName: "TestJob"}, resolve: () => {}}]
      ])
    })

    await worker._handlePooledChildFailure({child, error: new Error("runner crashed")})

    expect(reports.map((report) => report.jobId).sort()).toEqual(["c1", "c2"])
    expect(reports.every((report) => report.status === "failed")).toEqual(true)
    expect(worker.pooledChildren.size).toEqual(0)
  })

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
      const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "inline"}})
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
      const ownId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "inline"}})
      const ownHandoff = await store.markHandedOff({jobId: ownId, workerId: "reconnecting-worker"})
      if (!ownHandoff) throw new Error("Expected the reconnecting worker's job to hand off")

      // A job held by a DIFFERENT worker that does not reconnect (e.g. still
      // draining under the old release). It must be left untouched — never
      // reclaimed early into a duplicate attempt.
      const otherId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "inline"}})
      const otherHandoff = await store.markHandedOff({jobId: otherId, workerId: "other-worker"})
      if (!otherHandoff) throw new Error("Expected the other worker's job to hand off")

      // The worker reconnects with its stable id — drive the real hello handler.
      const worker = fakeWorkerSocket()
      main._handleRolelessSocketMessage({
        jsonSocket: worker,
        message: {type: "hello", role: "worker", workerId: "reconnecting-worker", supportsHandoffIdReporting: true, supportsHeartbeat: true}
      })

      // Adoption runs asynchronously off the hello; use the same lifecycle
      // barrier that shutdown uses before it closes database connections.
      await main._drainWorkerHandoffAdoptions()

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

  it("waits for a worker hello's handoff adoption before stopping", async () => {
    const {main} = await startBackgroundJobsMain()
    /** @type {() => void} */
    let releaseAdoption = () => {}
    const adoption = new Promise((resolve) => { releaseAdoption = resolve })
    let adoptionStarted = false
    let stopSettled = false

    main._adoptWorkerHandoffs = async () => {
      adoptionStarted = true
      await adoption
    }

    try {
      const worker = fakeWorkerSocket()
      const role = main._handleSocketMessage({
        jsonSocket: worker,
        message: {type: "hello", role: "worker", workerId: "stopping-worker", supportsHandoffIdReporting: true, supportsHeartbeat: true},
        role: null
      })
      expect(role).toEqual("worker")
      expect(adoptionStarted).toEqual(true)

      const stopPromise = main.stop().then(() => { stopSettled = true })

      try {
        // Give ordinary server shutdown a full event-loop turn. The deferred
        // adoption must still keep stop pending before teardown can finish.
        await new Promise((resolve) => setImmediate(resolve))
        expect(stopSettled).toEqual(false)
        expect(main.inflightWorkerHandoffAdoptions.size).toEqual(1)
      } finally {
        releaseAdoption()
        await stopPromise
      }

      expect(stopSettled).toEqual(true)
      expect(main.inflightWorkerHandoffAdoptions.size).toEqual(0)
    } finally {
      releaseAdoption()
      if (!stopSettled) await main.stop()
    }
  })
})
