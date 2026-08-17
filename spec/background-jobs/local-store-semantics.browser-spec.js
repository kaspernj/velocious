// @ts-check

import LocalBackgroundJobsStore, {LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE} from "../../src/background-jobs/local-store.js"
import Configuration from "../../src/configuration.js"

describe("Local background jobs store - queue semantics", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("atomically enforces queue caps, queued deduplication, claims, and fenced acknowledgements", async () => {
    const configuration = Configuration.current()

    configuration.setBackgroundJobsConfig({queues: {uploads: {maxConcurrent: 1}}})

    const store = new LocalBackgroundJobsStore({configuration})
    const options = {deduplicateWhileQueued: true, executionMode: "inline", queue: "uploads"}
    const firstId = await store.enqueue({jobName: "UploadJob", args: [1], options})
    const duplicateId = await store.enqueue({jobName: "UploadJob", args: [1], options})

    expect(duplicateId).toEqual(firstId)

    const firstHandoff = await store.markHandedOff({jobId: firstId})

    if (!firstHandoff) throw new Error("Expected first local handoff")

    const secondId = await store.enqueue({jobName: "UploadJob", args: [1], options})

    expect(secondId === firstId).toEqual(false)
    expect(await store.nextAvailableJob()).toEqual(null)
    expect(await store.markCompleted({jobId: firstId, handoffId: "stale-handoff"})).toEqual(false)
    expect(await store.markCompleted({jobId: firstId, ...firstHandoff})).toEqual(true)
    expect((await store.nextAvailableJob())?.id).toEqual(secondId)

    await store.clearAll()

    const concurrentIds = await Promise.all([
      store.enqueue({jobName: "UploadJob", args: [2], options}),
      store.enqueue({jobName: "UploadJob", args: [2], options})
    ])

    expect(concurrentIds[0]).toEqual(concurrentIds[1])
    await configuration.ensureConnections({name: "Local background jobs concurrency ownership verification"}, async (dbs) => {
      const rows = await dbs.default
        .newQuery()
        .from(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
        .where({concurrency_key: "queue:uploads"})
        .results()

      expect(rows).toHaveLength(1)
    })
    await expect(async () => await store.enqueue({jobName: "UploadJob", args: [], options: {idempotencyKey: "server-only"}})).toThrow(/not supported by the local background-jobs adapter/)
  })

  it("reconciles changed and removed queue-derived caps for queued work", async () => {
    const configuration = Configuration.current()

    configuration.setBackgroundJobsConfig({queues: {uploads: {maxConcurrent: 2}}})

    const store = new LocalBackgroundJobsStore({configuration})
    const jobId = await store.enqueue({jobName: "UploadJob", args: ["reconcile"], options: {queue: "uploads"}})

    expect((await store.getJob(jobId))?.maxConcurrency).toEqual(2)
    configuration.setBackgroundJobsConfig({queues: {uploads: {maxConcurrent: 1}}})
    await store.reconcileQueueConcurrency()
    expect((await store.getJob(jobId))?.maxConcurrency).toEqual(1)
    configuration.setBackgroundJobsConfig({queues: {}})
    await store.reconcileQueueConcurrency()
    expect((await store.getJob(jobId))?.concurrencyKey).toEqual(null)
    expect((await store.getJob(jobId))?.maxConcurrency).toEqual(null)
  })

  it("serializes one deduplication identity without blocking unrelated jobs", async () => {
    const store = new LocalBackgroundJobsStore({configuration: Configuration.current()})
    const matchingJob = store._prepareJob({args: [1], jobName: "UploadJob", options: {queue: "uploads"}})
    const unrelatedJob = store._prepareJob({args: [2], jobName: "UploadJob", options: {queue: "uploads"}})
    let releaseFirst = () => {}
    let markFirstEntered = () => {}
    const firstEntered = new Promise((resolve) => { markFirstEntered = resolve })
    /** @type {Promise<void>} */
    const holdFirst = new Promise((resolve) => { releaseFirst = resolve })
    let matchingEntered = false
    let unrelatedEntered = false
    const first = store._serializeDeduplicatedEnqueue(matchingJob, async (holdUntil) => {
      markFirstEntered()
      holdUntil(holdFirst)
    })

    await firstEntered
    await first

    const matching = store._serializeDeduplicatedEnqueue(matchingJob, async () => { matchingEntered = true })
    const unrelated = store._serializeDeduplicatedEnqueue(unrelatedJob, async () => { unrelatedEntered = true })

    await unrelated
    expect(unrelatedEntered).toEqual(true)
    expect(matchingEntered).toEqual(false)
    releaseFirst()
    await matching
    expect(matchingEntered).toEqual(true)
  })
})
