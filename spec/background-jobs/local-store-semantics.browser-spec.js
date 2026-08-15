// @ts-check

import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
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
    await expect(async () => await store.enqueue({jobName: "UploadJob", args: [], options: {idempotencyKey: "server-only"}})).toThrow(/not supported by the local background-jobs adapter/)
  })
})
