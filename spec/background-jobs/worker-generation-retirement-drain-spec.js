// @ts-check

import timeout from "awaitery/build/timeout.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import { startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import controlledClock from "../helpers/controlled-clock.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs worker generation retirement drain", () => {
  it("keeps heartbeats and exact reconnect alive until one accepted job reports once", async () => {
    const clock = controlledClock()
    const workerReady = promiseBarrier()
    const heartbeat = promiseBarrier()
    const disconnected = promiseBarrier()
    const retired = promiseBarrier()
    const reaccepted = promiseBarrier()
    const secondRetire = promiseBarrier()
    const updated = promiseBarrier()
    const jobBarrier = await createBackgroundJobsSocketBarrier(1)
    let acceptedCount = 0
    let retireCount = 0
    let updateCount = 0
    const {main, store} = await startGenerationMain({
      clock,
      generationId: "release-worker-drain",
      initialGenerationState: "active",
      onJobUpdated: ({accepted, status}) => {
        if (accepted && status === "completed") {
          updateCount += 1
          updated.entered()
        }
      },
      onWorkerDisconnected: disconnected.entered,
      onWorkerHeartbeat: heartbeat.entered,
      onWorkerReady: workerReady.entered,
      workerReconnectGraceMs: 1000,
      workerStaleTimeoutMs: 100
    })
    const worker = new BackgroundJobsWorker({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      generationHandshakeTimeoutMs: 100,
      generationId: "release-worker-drain",
      heartbeatIntervalMs: 2_147_483_647,
      host: "127.0.0.1",
      maxConcurrentInlineJobs: 1,
      onGenerationAccepted: () => {
        acceptedCount += 1
        if (acceptedCount === 2) reaccepted.entered()
      },
      onRetireMessage: () => {
        retireCount += 1
        if (retireCount === 1) retired.entered()
        if (retireCount === 2) secondRetire.entered()
      },
      port: main.getPort(),
      reconnectDelayMs: 0,
      workerInstanceId: "32ebfc46-8d1f-459c-814f-f982c56a51ad"
    })

    try {
      await worker.start()
      await workerReady.waiting
      const jobId = await store.enqueue({
        jobName: "SocketBarrierTestJob",
        args: [jobBarrier.port],
        options: {executionMode: "inline"}
      })
      await main._drain()
      await jobBarrier.waiting

      await main.retire()
      await timeout({errorMessage: "Worker did not enter generation retirement drain", timeout: 250}, async () => await retired.waiting)
      expect(worker.isRetiring).toEqual(true)
      expect(worker._heartbeatTimer).toBeTruthy()

      clock.advance(101)
      worker._sendHeartbeat()
      await timeout({errorMessage: "Retiring worker heartbeat was not received", timeout: 250}, async () => await heartbeat.waiting)
      await main._sweepStaleWorkers()
      expect(main.workers.size).toEqual(1)
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")

      worker.jsonSocket?.destroy()
      await disconnected.waiting
      await timeout({errorMessage: "Retiring worker did not reconnect", timeout: 250}, async () => await reaccepted.waiting)
      await timeout({errorMessage: "Reconnected worker was not immediately re-retired", timeout: 250}, async () => await secondRetire.waiting)
      expect(main.readyWorkers.size).toEqual(0)
      expect(main.candidateReadyWorkers.size).toEqual(0)
      clock.runAll()
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")

      jobBarrier.release()
      await updated.waiting
      await worker.waitUntilStopped()
      await main.waitUntilStopped()
      expect(updateCount).toEqual(1)
      expect((await store.getJob(jobId))?.status).toEqual("completed")
    } finally {
      jobBarrier.release()
      await worker.stop()
      await main.stop()
      await jobBarrier.close()
    }
  })
})
