// @ts-check

import { connectGenerationPeer, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs main retirement admission boundary", () => {
  it("keeps a candidate inert until activation", async () => {
    const ready = promiseBarrier()
    const {main, store} = await startGenerationMain({
      generationId: "release-candidate",
      initialGenerationState: "candidate",
      onWorkerReady: ready.entered
    })
    const peer = await connectGenerationPeer(main.getPort())

    try {
      const jobId = await store.enqueue({jobName: "CandidateFenceJob", args: [], options: {executionMode: "inline"}})
      const accepted = peer.nextMessage()
      peer.jsonSocket.send({
        type: "hello",
        role: "worker",
        generationId: "release-candidate",
        workerId: "release-candidate:49b70c09-7fcf-40ae-b89a-598216013fde",
        supportsHandoffIdReporting: true,
        supportsHeartbeat: true
      })
      expect(await accepted).toEqual({type: "generation-accepted", generationId: "release-candidate", lifecycleState: "candidate"})
      peer.jsonSocket.send({type: "ready", acceptsInline: true, acceptsForked: false, acceptsPooled: false, acceptsSpawned: false})
      await ready.waiting
      await main._drain()
      expect((await store.getJob(jobId))?.status).toEqual("queued")

      const jobMessage = peer.nextMessage()
      await main.activate()
      expect((await jobMessage).type).toEqual("job")
      expect(main.getLifecycleState()).toEqual("active")
    } finally {
      await peer.close()
      await main.stop()
    }
  })

  it("returns a real claim that commits after the synchronous retirement fence", async () => {
    const claim = promiseBarrier()
    const {main, store} = await startGenerationMain({
      afterHandoffClaim: async () => {
        claim.entered()
        await claim.blocked
      },
      generationId: "release-retiring",
      initialGenerationState: "active"
    })
    const peer = await connectGenerationPeer(main.getPort())

    try {
      const jobId = await store.enqueue({jobName: "RetirementFenceJob", args: [], options: {executionMode: "inline"}})
      const accepted = peer.nextMessage()
      peer.jsonSocket.send({
        type: "hello",
        role: "worker",
        generationId: "release-retiring",
        workerId: "release-retiring:3aba5d83-9874-4b26-831d-af9011720842",
        supportsHandoffIdReporting: true,
        supportsHeartbeat: true
      })
      await accepted
      peer.jsonSocket.send({type: "ready", acceptsInline: true, acceptsForked: false, acceptsPooled: false, acceptsSpawned: false})
      await claim.waiting

      const retirement = main.retire()
      const retireMessage = peer.nextMessage()
      expect(main.getLifecycleState()).toEqual("retiring")
      expect(main.readyWorkers.size).toEqual(0)
      claim.release()
      await retirement

      expect((await store.getJob(jobId))?.status).toEqual("queued")
      expect(main.getLifecycleState()).toEqual("retired")
      expect((await retireMessage).type).toEqual("retire")
    } finally {
      await peer.close()
      await main.stop()
    }
  })
})
