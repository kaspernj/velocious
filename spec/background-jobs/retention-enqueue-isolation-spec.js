// @ts-check

import timeout from "awaitery/build/timeout.js"
import BackgroundJobsStore, {BACKGROUND_JOB_COUNTS_CHANNEL} from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {afterEach, describe, expect, it} from "../../src/testing/test.js"

/** @type {Set<import("../../src/http-server/websocket-channel.js").default>} */
const registeredSubscriptions = new Set()

describe("Background jobs - retention enqueue isolation", {databaseCleaning: {truncate: true}}, () => {
  afterEach(() => {
    for (const subscription of registeredSubscriptions) {
      dummyConfiguration._unregisterWebsocketChannelSubscription(BACKGROUND_JOB_COUNTS_CHANNEL, subscription)
    }

    registeredSubscriptions.clear()
  })

  it("keeps enqueue acknowledgements flowing while a paused prune holds its candidate page", async () => {
    dummyConfiguration.setCurrent()

    const pruneStore = new BackgroundJobsStore({configuration: dummyConfiguration})
    const enqueueStore = new BackgroundJobsStore({configuration: dummyConfiguration})

    await pruneStore.clearAll()

    // Seed one expired completed job.
    const expiredJobId = await pruneStore.enqueue({jobName: "RetentionSeedJob", args: [], options: {executionMode: "inline"}})
    const handoff = await pruneStore.markHandedOff({jobId: expiredJobId, workerId: "w"})
    if (!handoff) throw new Error("Expected the seed job to be handed off")
    await pruneStore.markCompleted({jobId: expiredJobId, workerId: "w", ...handoff})

    // Age the completion past the retention window.
    await pruneStore._withDb(async (db) => {
      await db.query(`UPDATE background_jobs SET completed_at_ms = ${db.quote(Date.now() - 10 * 24 * 60 * 60 * 1000)} WHERE id = ${db.quote(expiredJobId)}`)
    })

    const {revision} = await pruneStore.countSnapshot()

    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const events = []
    const subscription = /** @type {import("../../src/http-server/websocket-channel.js").default} */ ({
      deliverBroadcast: (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ body) => events.push(body),
      isClosed: () => false,
      matches: () => true,
      subscriptionId: "retention-enqueue-isolation"
    })
    dummyConfiguration._registerWebsocketChannelSubscription(BACKGROUND_JOB_COUNTS_CHANNEL, subscription)
    registeredSubscriptions.add(subscription)

    // Pause the sweep after candidate discovery and before the serialized delete.
    let releaseSelected = () => {}
    const candidatesSelected = new Promise((resolve) => {
      releaseSelected = resolve
    })
    let releaseDelete = () => {}
    const deleteGate = new Promise((resolve) => {
      releaseDelete = resolve
    })

    const gatedStore = new BackgroundJobsStore({
      configuration: dummyConfiguration,
      afterPruneCandidatesSelected: async () => {
        releaseSelected()
        await deleteGate
      }
    })

    const prune = gatedStore.pruneTerminalJobs({completedTtlMs: 7 * 24 * 60 * 60 * 1000, failedTtlMs: null, batchSize: 10})

    /** @type {string | undefined} */
    let enqueuedJobId

    try {
      await timeout({errorMessage: "Retention candidate discovery did not complete", timeout: 5000}, () => candidatesSelected)

      const acknowledgedJobId = await timeout({timeout: 1000}, async () => (
        await enqueueStore.enqueue({jobName: "RetentionIsolationJob", args: [], options: {executionMode: "inline"}})
      ))

      expect(typeof acknowledgedJobId).toEqual("string")
      enqueuedJobId = acknowledgedJobId
    } catch (error) {
      // Fail loud, but drain the paused sweep so the process-local mutation chain is not left wedged.
      releaseDelete()
      await timeout({errorMessage: "Retention sweep did not drain after release", timeout: 5000}, () => prune).catch(() => {})

      throw error
    }

    if (enqueuedJobId === undefined) throw new Error("Retention isolation enqueue never acknowledged")

    releaseDelete()
    const deleted = await timeout({errorMessage: "Retention sweep did not complete", timeout: 5000}, () => prune)

    expect(deleted).toEqual(1)
    expect(await enqueueStore.getJob(expiredJobId)).toEqual(null)
    expect(await enqueueStore.getJob(enqueuedJobId)).not.toEqual(null)

    await new Promise((resolve) => setImmediate(resolve))
    expect(events).toEqual([
      {deltas: {all: 1, queued: 1}, revision: revision + 1, type: "background-job-count-delta"},
      {deltas: {all: -1, completed: -1}, revision: revision + 2, type: "background-job-count-delta"}
    ])
  })
})
