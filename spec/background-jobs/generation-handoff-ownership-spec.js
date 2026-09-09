// @ts-check

import { emptyGenerationStore, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import { describe, expect, it } from "../../src/testing/test.js"

const WORKER_A_ID = "release-a:7e725e43-1887-4f19-a711-4731fe6caab2"

describe("Background jobs generation handoff ownership", () => {
  it("never reclaims another generation by startup identity or orphan age, while the owner can", async () => {
    const store = await emptyGenerationStore()
    const jobId = await store.enqueue({jobName: "GenerationOwnershipJob", args: [], options: {executionMode: "inline", maxRetries: 0}})
    const handoff = await store.markHandedOff({jobId, workerId: WORKER_A_ID})
    if (!handoff) throw new Error("Expected generation A handoff")
    const futureClock = {now: () => handoff.handedOffAtMs + 7 * 60 * 60 * 1000}
    const {main: mainB} = await startGenerationMain({
      clock: futureClock,
      generationId: "release-b",
      initialGenerationState: "active",
      store
    })

    try {
      expect(mainB.startupHandoffSnapshot).toEqual([])
      await mainB._sweepOrphans()
      expect(await store.getJob(jobId)).toMatchObject({status: "handed_off", workerId: WORKER_A_ID})
    } finally {
      await mainB.stop()
    }

    const {main: mainA} = await startGenerationMain({
      clock: futureClock,
      generationId: "release-a",
      initialGenerationState: "active",
      store,
      workerReconnectGraceMs: 2_147_483_647
    })

    try {
      expect(mainA.startupHandoffSnapshot).toEqual([{
        handedOffAtMs: handoff.handedOffAtMs,
        handoffId: handoff.handoffId,
        jobId,
        workerId: WORKER_A_ID
      }])
      await mainA._sweepOrphans()
      expect((await store.getJob(jobId))?.status).toEqual("orphaned")
    } finally {
      await mainA.stop()
    }
  })
})
