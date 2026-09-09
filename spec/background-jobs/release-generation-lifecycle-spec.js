// @ts-check

import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import createBackgroundJobsSocketBarrier from "../helpers/background-jobs-socket-barrier.js"
import { startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs release generation lifecycle", () => {
  it("drains generation A through A while active generation B handles global queued work", async () => {
    const aReady = promiseBarrier()
    const bReady = promiseBarrier()
    const aUpdated = promiseBarrier()
    const bUpdated = promiseBarrier()
    const barrierA = await createBackgroundJobsSocketBarrier(1)
    const barrierB = await createBackgroundJobsSocketBarrier(1)
    const {main: mainA, store} = await startGenerationMain({
      generationId: "release-a",
      initialGenerationState: "active",
      onJobUpdated: ({accepted, status}) => {
        if (accepted && status === "completed") aUpdated.entered()
      },
      onWorkerReady: aReady.entered
    })
    const {main: mainB} = await startGenerationMain({
      generationId: "release-b",
      initialGenerationState: "candidate",
      onJobUpdated: ({accepted, status}) => {
        if (accepted && status === "completed") bUpdated.entered()
      },
      onWorkerReady: bReady.entered,
      store
    })
    const workerA = new BackgroundJobsWorker({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      generationId: "release-a",
      host: "127.0.0.1",
      maxConcurrentInlineJobs: 1,
      port: mainA.getPort(),
      workerInstanceId: "7e725e43-1887-4f19-a711-4731fe6caab2"
    })
    const workerB = new BackgroundJobsWorker({
      closeDatabaseConnectionsOnStop: false,
      configuration: dummyConfiguration,
      generationId: "release-b",
      host: "127.0.0.1",
      maxConcurrentInlineJobs: 1,
      port: mainB.getPort(),
      workerInstanceId: "22705b08-65e6-4815-951b-2dd486ad295f"
    })

    try {
      await workerA.start()
      await workerB.start()
      await aReady.waiting
      await bReady.waiting

      const jobAId = await store.enqueue({
        jobName: "SocketBarrierTestJob",
        args: [barrierA.port],
        options: {executionMode: "inline"}
      })
      await mainA._drain()
      await barrierA.waiting
      const jobBId = await store.enqueue({
        jobName: "SocketBarrierTestJob",
        args: [barrierB.port],
        options: {executionMode: "inline"}
      })
      await mainA._drain()
      expect((await store.getJob(jobBId))?.status).toEqual("queued")
      expect(mainB.getLifecycleState()).toEqual("candidate")

      await mainA.retire()
      await mainB.activate()
      await barrierB.waiting
      expect((await store.getJob(jobAId))?.workerId).toEqual(workerA.workerId)
      expect((await store.getJob(jobBId))?.workerId).toEqual(workerB.workerId)

      barrierB.release()
      await bUpdated.waiting
      expect((await store.getJob(jobBId))?.status).toEqual("completed")
      expect(mainB.getLifecycleState()).toEqual("active")
      expect(mainB.server?.listening).toEqual(true)

      barrierA.release()
      await aUpdated.waiting
      await workerA.waitUntilStopped()
      await mainA.waitUntilStopped()
      expect((await store.getJob(jobAId))?.status).toEqual("completed")
      expect(mainA.getLifecycleState()).toEqual("stopped")
      expect(mainB.getLifecycleState()).toEqual("active")
    } finally {
      barrierA.release()
      barrierB.release()
      await workerA.stop()
      await workerB.stop()
      await mainA.stop()
      await mainB.stop()
      await barrierA.close()
      await barrierB.close()
    }
  })
})
