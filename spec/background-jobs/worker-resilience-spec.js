// @ts-check

import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import {startBackgroundJobsMain} from "../helpers/background-jobs-helper.js"

describe("Background jobs - worker resilience", {databaseCleaning: {truncate: true}}, () => {
  it("frees the forked slot on child exit even when the failure report hangs, and bounds the report", async () => {
    const worker = new BackgroundJobsWorker({})
    let reportArgs = /** @type {any} */ (null)

    worker.statusReporter = /** @type {any} */ ({
      reportWithRetry: async (/** @type {any} */ args) => {
        reportArgs = args
        await new Promise(() => {}) // never resolves — simulates the main being unreachable
      }
    })

    const child = /** @type {any} */ ({})
    worker.inflightProcessChildren.add(child)
    let resolved = false

    // A crashed child (non-clean exit) whose failure report hangs must still
    // free its slot immediately, or leaked slots eventually wedge the worker.
    void worker._handleForkedChildExit({
      child,
      code: 1,
      signal: null,
      payload: /** @type {any} */ ({id: "job-1"}),
      resolve: () => { resolved = true }
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(resolved).toEqual(true)
    expect(worker.inflightProcessChildren.has(child)).toEqual(false)
    expect(typeof reportArgs?.maxDurationMs).toEqual("number")
  })

  it("sends periodic liveness heartbeats", async () => {
    const worker = new BackgroundJobsWorker({heartbeatIntervalMs: 5})
    /** @type {Array<{type: string}>} */
    const sent = []

    worker.jsonSocket = /** @type {any} */ ({send: (/** @type {{type: string}} */ message) => sent.push(message)})
    worker._startHeartbeat()

    await new Promise((resolve) => setTimeout(resolve, 40))
    worker._stopHeartbeat()

    expect(sent.some((message) => message.type === "heartbeat")).toEqual(true)
  })

  it("drops a stale worker and releases its leases", async () => {
    const {main} = await startBackgroundJobsMain()

    try {
      let released = /** @type {any} */ (null)
      main.store.markReturnedToQueue = async (/** @type {any} */ args) => { released = args }

      const staleWorker = /** @type {any} */ ({
        workerId: "stale",
        lastSeenAt: Date.now() - 10 * 60 * 1000,
        close: () => {},
        send: () => {}
      })

      main.workers.add(staleWorker)
      main.workerHandoffs.set(staleWorker, new Map([["job-1", "handoff-1"]]))

      await main._sweepStaleWorkers()

      expect(main.workers.has(staleWorker)).toEqual(false)
      expect(released).toEqual({jobId: "job-1", handoffId: "handoff-1"})
    } finally {
      await main.stop()
    }
  })
})
