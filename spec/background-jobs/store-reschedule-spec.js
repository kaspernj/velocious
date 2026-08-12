// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

class DelayedSerializedStore extends BackgroundJobsStore {
  /** @type {(() => void) | undefined} */
  beforeNextSerializedMutation

  /** @param {import("../../src/database/drivers/base.js").default} db - Database. @param {Function} callback - Mutation callback. */
  async _serializedCountMutation(db, callback) {
    const beforeMutation = this.beforeNextSerializedMutation
    this.beforeNextSerializedMutation = undefined
    beforeMutation?.()
    return await super._serializedCountMutation(db, callback)
  }
}

/** @returns {Promise<BackgroundJobsStore>} - Empty background jobs store. */
async function createStore() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})
  await store.clearAll()
  return store
}

describe("Background jobs - store reschedule", {databaseCleaning: {truncate: true}}, () => {
  it("reschedules the same active handoff without recording a failure and releases concurrency", async () => {
    const store = await createStore()
    const scheduled = await store.replaceScheduled({
      scheduleKey: "refresh:account-1",
      jobName: "RefreshJob",
      args: ["account-1"],
      options: {concurrencyKey: "refresh", maxConcurrency: 1}
    })
    const waitingId = await store.enqueue({
      jobName: "RefreshJob",
      args: ["account-2"],
      options: {concurrencyKey: "refresh", maxConcurrency: 1}
    })
    const handoff = await store.markHandedOff({jobId: scheduled.jobId, workerId: "worker-1"})
    if (!handoff) throw new Error("Expected the scheduled job handoff")
    const before = Date.now()

    const accepted = await store.markRescheduled({
      jobId: scheduled.jobId,
      delayMs: 60_000,
      workerId: "worker-1",
      ...handoff
    })

    const job = await store.getJob(scheduled.jobId)
    expect(accepted).toEqual(true)
    expect(job).toMatchObject({
      id: scheduled.jobId,
      args: ["account-1"],
      attempts: 0,
      lastError: null,
      failedAtMs: null,
      orphanedAtMs: null,
      scheduleKey: "refresh:account-1",
      status: "queued"
    })
    expect(job?.scheduledAtMs).toBeGreaterThanOrEqual(before + 60_000)
    expect(await store.nextAvailableJob()).toMatchObject({id: waitingId})
    expect(await store.nextScheduledJob()).toMatchObject({id: scheduled.jobId})
    expect(await store.markHandedOff({jobId: waitingId, workerId: "worker-2"})).not.toBeNull()
  })

  it("ignores stale and terminal reschedule reports without releasing a newer reservation", async () => {
    const store = await createStore()
    const jobId = await store.enqueue({
      jobName: "RefreshJob",
      args: [],
      options: {concurrencyKey: "refresh", maxConcurrency: 1}
    })
    const first = await store.markHandedOff({jobId, workerId: "worker-1"})
    if (!first) throw new Error("Expected the first handoff")
    await store.markReturnedToQueue({jobId, handoffId: first.handoffId})
    const second = await store.markHandedOff({jobId, workerId: "worker-2"})
    if (!second) throw new Error("Expected the second handoff")

    expect(await store.markRescheduled({jobId, delayMs: 1_000, workerId: "worker-1", ...first})).toEqual(false)
    expect(await store.getJob(jobId)).toMatchObject({status: "handed_off", handoffId: second.handoffId})

    await store.markCompleted({jobId, workerId: "worker-2", ...second})
    expect(await store.markRescheduled({jobId, delayMs: 1_000, workerId: "worker-2", ...second})).toEqual(false)
    expect(await store.markRescheduled({jobId: "missing", delayMs: 1_000, workerId: "worker-2", ...second})).toEqual(false)
    expect(await store.getJob(jobId)).toMatchObject({status: "completed", attempts: 0})
  })

  it("starts the requested delay after waiting to enter the serialized mutation", async () => {
    dummyConfiguration.setCurrent()
    const store = new DelayedSerializedStore({configuration: dummyConfiguration})
    await store.clearAll()
    const jobId = await store.enqueue({jobName: "RefreshJob", args: [], options: {}})
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})
    if (!handoff) throw new Error("Expected job handoff")
    const originalNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    store.beforeNextSerializedMutation = () => { now += 5_000 }

    try {
      await store.markRescheduled({jobId, delayMs: 10_000, workerId: "worker-1", ...handoff})
    } finally {
      Date.now = originalNow
    }

    expect(await store.getJob(jobId)).toMatchObject({scheduledAtMs: 1_015_000})
  })
})
