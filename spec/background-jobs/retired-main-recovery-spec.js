// @ts-check

import { connectGenerationPeer, emptyGenerationStore, registerGenerationWorker, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import controlledClock from "../helpers/controlled-clock.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import { describe, expect, it } from "../../src/testing/test.js"

const WORKER_A_ID = "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"
const WORKER_A_OTHER_ID = "release-a:ad5497b6-f91c-4216-bdbb-ea54c7bb4136"

describe("Background jobs retired-main recovery", () => {
  it("retains one startup-reclaim timer when an active recovery main retires", async () => {
    const clock = controlledClock()
    const store = await emptyGenerationStore()
    const jobId = await store.enqueue({jobName: "ActiveRecoveryJob", args: [], options: {executionMode: "inline"}})
    const handoff = await store.markHandedOff({jobId, workerId: WORKER_A_ID})
    if (!handoff) throw new Error("Expected active generation handoff")
    const {main} = await startGenerationMain({
      clock,
      generationId: "release-a",
      initialGenerationState: "active",
      store,
      workerReconnectGraceMs: 1000
    })

    try {
      expect(clock.pendingCount()).toEqual(1)
      await main.retire()
      expect(clock.pendingCount()).toEqual(1)
    } finally {
      await main.stop()
    }

    expect(clock.pendingCount()).toEqual(0)
  })

  it("recovers only exact same-generation durable handoffs without dispatch", async () => {
    const released = promiseBarrier()
    const clock = controlledClock()
    const store = await emptyGenerationStore()
    const jobId = await store.enqueue({jobName: "RetiredRecoveryJob", args: [], options: {executionMode: "inline"}})
    const handoff = await store.markHandedOff({jobId, workerId: WORKER_A_ID})
    if (!handoff) throw new Error("Expected retired generation handoff")
    const {main} = await startGenerationMain({
      clock,
      generationId: "release-a",
      initialGenerationState: "retired",
      onWorkerHandoffsReleased: released.entered,
      store,
      workerReconnectGraceMs: 0
    })
    const wrongPeer = await connectGenerationPeer(main.getPort())
    const recoveringPeer = await connectGenerationPeer(main.getPort())

    try {
      expect(await registerGenerationWorker(wrongPeer, "release-a", WORKER_A_OTHER_ID)).toEqual({
        type: "generation-rejected",
        reason: "worker-has-no-recoverable-handoffs"
      })
      expect(await registerGenerationWorker(recoveringPeer, "release-a", WORKER_A_ID)).toMatchObject({
        type: "generation-accepted",
        lifecycleState: "retired"
      })
      expect(await recoveringPeer.nextMessage()).toEqual({type: "retire", generationId: "release-a"})
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")

      await recoveringPeer.close()
      clock.runAll()
      await released.waiting
      await main.waitUntilStopped()
      expect((await store.getJob(jobId))?.status).toEqual("queued")
    } finally {
      await wrongPeer.close()
      await recoveringPeer.close()
      await main.stop()
    }
  })
})
