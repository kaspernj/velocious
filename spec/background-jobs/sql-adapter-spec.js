// @ts-check

import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Background jobs - SQL adapter", {databaseCleaning: {truncate: true}}, () => {
  it("preserves the store's durable handoff and fenced completion semantics", async () => {
    const adapter = new SqlBackgroundJobsAdapter({configuration: dummyConfiguration})
    await adapter.clearAll()

    const jobId = await adapter.enqueue({jobName: "TestJob", args: [], options: {executionMode: "inline"}})
    const candidate = await adapter.nextAvailableJob()
    const handoff = await adapter.markHandedOff({jobId, workerId: "sql-adapter-worker"})

    expect(candidate?.id).toEqual(jobId)
    expect(handoff).toBeTruthy()
    if (!handoff) throw new Error("Expected SQL adapter handoff")

    expect(await adapter.markCompleted({jobId, workerId: "wrong-worker", ...handoff})).toBeFalse()
    expect(await adapter.markCompleted({jobId, workerId: "sql-adapter-worker", ...handoff})).toBeTrue()
    expect((await adapter.getJob(jobId))?.status).toEqual("completed")
    expect(await adapter.health()).toEqual({ready: true})
  })
})
