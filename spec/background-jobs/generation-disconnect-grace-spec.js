// @ts-check

import { connectGenerationPeer, registerGenerationWorker, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import controlledClock from "../helpers/controlled-clock.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import { describe, expect, it } from "../../src/testing/test.js"

const WORKER_A_ID = "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"
const WORKER_A_OTHER_ID = "release-a:ad5497b6-f91c-4216-bdbb-ea54c7bb4136"
const WORKER_B_ID = "release-b:22705b08-65e6-4815-951b-2dd486ad295f"

describe("Background jobs generation disconnect grace", () => {
  it("preserves a live handoff through an exact same-worker reconnect", async () => {
    const disconnected = promiseBarrier()
    const {main, store} = await startGenerationMain({
      generationId: "release-a",
      initialGenerationState: "active",
      onWorkerDisconnected: disconnected.entered,
      workerReconnectGraceMs: 2_147_483_647
    })
    const firstPeer = await connectGenerationPeer(main.getPort())
    const secondPeer = await connectGenerationPeer(main.getPort())

    try {
      expect(await registerGenerationWorker(firstPeer, "release-a", WORKER_A_ID, true)).toMatchObject({type: "generation-accepted"})
      const jobMessage = firstPeer.nextMessage()
      const jobId = await store.enqueue({jobName: "ReconnectOwnershipJob", args: [], options: {executionMode: "inline"}})
      await main._drain()
      const delivered = await jobMessage
      if (delivered.type !== "job") throw new Error("Expected a delivered job")

      await firstPeer.close()
      await disconnected.waiting
      expect((await store.getJob(jobId))?.status).toEqual("handed_off")
      expect(await registerGenerationWorker(secondPeer, "release-a", WORKER_A_ID)).toMatchObject({type: "generation-accepted"})
      const updated = secondPeer.nextMessage()
      secondPeer.jsonSocket.send({
        type: "job-complete",
        jobId,
        handoffId: delivered.payload.handoffId,
        handedOffAtMs: delivered.payload.handedOffAtMs,
        workerId: WORKER_A_ID
      })

      expect(await updated).toEqual({type: "job-updated", jobId})
      expect((await store.getJob(jobId))?.status).toEqual("completed")
    } finally {
      await firstPeer.close()
      await secondPeer.close()
      await main.stop()
    }
  })

  it("returns an expired disconnect exactly and fences its late report after generation B reclaims the queue", async () => {
    const disconnected = promiseBarrier()
    const released = promiseBarrier()
    const clock = controlledClock()
    const {main: mainA, store} = await startGenerationMain({
      clock,
      generationId: "release-a",
      initialGenerationState: "active",
      onWorkerDisconnected: disconnected.entered,
      onWorkerHandoffsReleased: released.entered,
      workerReconnectGraceMs: 0
    })
    const peerA = await connectGenerationPeer(mainA.getPort())
    /** @type {Awaited<ReturnType<typeof startGenerationMain>>["main"] | undefined} */
    let mainB
    /** @type {Awaited<ReturnType<typeof connectGenerationPeer>> | undefined} */
    let peerB

    try {
      await registerGenerationWorker(peerA, "release-a", WORKER_A_ID, true)
      const firstDelivery = peerA.nextMessage()
      const jobId = await store.enqueue({jobName: "DisconnectExpiryJob", args: [], options: {executionMode: "inline"}})
      await mainA._drain()
      const oldLease = await firstDelivery
      if (oldLease.type !== "job") throw new Error("Expected generation A delivery")

      await peerA.close()
      await disconnected.waiting
      clock.runAll()
      await released.waiting
      expect((await store.getJob(jobId))?.status).toEqual("queued")

      const startedB = await startGenerationMain({generationId: "release-b", initialGenerationState: "active", store})
      mainB = startedB.main
      peerB = await connectGenerationPeer(mainB.getPort())
      await registerGenerationWorker(peerB, "release-b", WORKER_B_ID, true)
      const secondDelivery = peerB.nextMessage()
      await mainB._drain()
      const newLease = await secondDelivery
      if (newLease.type !== "job") throw new Error("Expected generation B delivery")

      const reporterA = await connectGenerationPeer(mainA.getPort())
      try {
        await registerGenerationWorker(reporterA, "release-a", WORKER_A_OTHER_ID)
        const lateResult = reporterA.nextMessage()
        reporterA.jsonSocket.send({
          type: "job-complete",
          jobId,
          handoffId: oldLease.payload.handoffId,
          handedOffAtMs: oldLease.payload.handedOffAtMs,
          workerId: WORKER_A_ID
        })
        expect(await lateResult).toEqual({type: "job-updated", jobId})
      } finally {
        await reporterA.close()
      }
      expect(await store.getJob(jobId)).toMatchObject({
        handoffId: newLease.payload.handoffId,
        status: "handed_off",
        workerId: WORKER_B_ID
      })
    } finally {
      await peerA.close()
      await peerB?.close()
      await mainB?.stop()
      await mainA.stop()
    }
  })
})
