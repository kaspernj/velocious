// @ts-check

import { clearBackgroundJobs } from "../helpers/background-jobs-helper.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs - startup handoff store reclaim", {databaseCleaning: {truncate: true}}, () => {
  it("reclaims an exact startup snapshot through orphan lifecycle semantics", async () => {
    const store = await clearBackgroundJobs()
    const concurrency = {concurrencyKey: "startup-planner", maxConcurrency: 1}
    const staleJobId = await store.enqueue({
      args: [],
      jobName: "StalePlannerJob",
      options: {...concurrency, maxRetries: 0}
    })
    const staleHandoff = await store.markHandedOff({jobId: staleJobId, workerId: "dead-worker"})
    const queuedJobId = await store.enqueue({args: [], jobName: "QueuedPlannerJob", options: concurrency})

    if (!staleHandoff) throw new Error("Expected the stale startup handoff")

    const snapshot = await store.snapshotHandedOffJobs()
    const reclaimed = await store.markOrphanedHandoffs({
      error: "Job orphaned after its pre-restart worker did not reconnect",
      handoffs: snapshot
    })

    expect(snapshot).toEqual([{
      handedOffAtMs: staleHandoff.handedOffAtMs,
      handoffId: staleHandoff.handoffId,
      jobId: staleJobId,
      workerId: "dead-worker"
    }])
    expect(reclaimed.map((job) => ({attempts: job.attempts, id: job.id, status: job.status}))).toEqual([
      {attempts: 1, id: staleJobId, status: "orphaned"}
    ])
    expect((await store.countSnapshot()).counts).toMatchObject({handed_off: 0, orphaned: 1, queued: 1})
    expect(await store.markHandedOff({jobId: queuedJobId, workerId: "current-worker"})).toBeTruthy()
  })

  it("fences a changed lease and ignores a handoff created after the snapshot", async () => {
    const store = await clearBackgroundJobs()
    const changedJobId = await store.enqueue({args: [], jobName: "ChangedLeaseJob"})
    const originalHandoff = await store.markHandedOff({jobId: changedJobId, workerId: "old-worker"})

    if (!originalHandoff) throw new Error("Expected the original handoff")

    const snapshot = await store.snapshotHandedOffJobs()

    await store.markReturnedToQueue({jobId: changedJobId, handoffId: originalHandoff.handoffId})
    const newerHandoff = await store.markHandedOff({jobId: changedJobId, workerId: "new-worker"})
    const lateJobId = await store.enqueue({args: [], jobName: "LateHandoffJob"})
    const lateHandoff = await store.markHandedOff({jobId: lateJobId, workerId: "late-worker"})

    if (!newerHandoff || !lateHandoff) throw new Error("Expected replacement and late handoffs")

    expect(await store.markOrphanedHandoffs({error: "startup reclaim", handoffs: snapshot})).toEqual([])
    expect(await store.getJob(changedJobId)).toMatchObject({
      handoffId: newerHandoff.handoffId,
      status: "handed_off",
      workerId: "new-worker"
    })
    expect(await store.getJob(lateJobId)).toMatchObject({
      handoffId: lateHandoff.handoffId,
      status: "handed_off",
      workerId: "late-worker"
    })
  })
})
