// @ts-check

import timeout from "awaitery/build/timeout.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import {startGenerationMain} from "../helpers/background-jobs-generation-harness.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {waitForJobCompleted} from "../helpers/background-jobs-helper.js"

describe("Background jobs release generation pooled drain", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("keeps a retiring pooled child alive until all concurrent jobs report durably", async () => {
    const barrier = await createBackgroundJobsSocketBarrier(2)
    const retireMessage = promiseBarrier()
    const workerReady = promiseBarrier()
    const {main, store} = await startGenerationMain({
      generationId: "pooled-release-a",
      initialGenerationState: "active",
      onWorkerReady: workerReady.entered
    })
    const worker = new BackgroundJobsWorker({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      generationId: "pooled-release-a",
      host: "127.0.0.1",
      onRetireMessage: retireMessage.entered,
      pooledRunnerConcurrency: 2,
      pooledRunnerCount: 1,
      port: main.getPort(),
      workerInstanceId: "c6ebd6d8-3ce4-411c-8608-1765d34cdf96"
    })

    try {
      await worker.start()
      await workerReady.waiting

      const jobIds = []
      for (let index = 0; index < 2; index += 1) {
        jobIds.push(await store.enqueue({
          args: [barrier.port],
          jobName: "SocketBarrierTestJob",
          options: {executionMode: "pooled"}
        }))
      }
      await main._drain()
      await barrier.waiting

      const child = [...worker.pooledChildren][0]
      if (!child) throw new Error("Expected one pooled child")
      expect(worker.pooledChildStates.get(child)?.inflight.size).toEqual(2)

      await main.retire()
      await timeout({errorMessage: "Worker did not enter generation retirement", timeout: 2000}, async () => {
        await retireMessage.waiting
      })

      expect(child.exitCode).toEqual(null)
      expect(worker.pooledChildStates.get(child)?.inflight.size).toEqual(2)

      barrier.release()
      await Promise.all(jobIds.map(async (jobId) => await waitForJobCompleted({jobId, store})))
      await worker.waitUntilStopped()
      await main.waitUntilStopped()

      expect(child.exitCode === null && child.signalCode === null).toBeFalse()
      expect(main.getLifecycleState()).toEqual("stopped")
    } finally {
      barrier.release()
      await worker.stop()
      await main.stop()
      await barrier.close()
    }
  })
})
