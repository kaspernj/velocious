// @ts-check

import LocalBackgroundJobsAdapter from "../../src/background-jobs/local-adapter.js"
import Configuration from "../../src/configuration.js"
import {RecordingLocalJob, resetLocalBackgroundJobClasses} from "../helpers/local-background-jobs-test-harness.js"

describe("Local background jobs dispatcher - execution", {tags: ["dummy", "browser-only"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("uses the Browser/Expo default adapter and completes queued jobs in process", async () => {
    const configuration = Configuration.current()

    resetLocalBackgroundJobClasses()
    await configuration.closeBackgroundJobsAdapter()
    configuration.setBackgroundJobsConfig({adapter: undefined, jobClasses: [RecordingLocalJob], mode: "background", queues: {}})
    configuration.setCurrent()

    const jobId = await RecordingLocalJob.performLater("browser-local")
    const adapter = await configuration.acquireReadyBackgroundJobsAdapter()

    expect(adapter).toBeInstanceOf(LocalBackgroundJobsAdapter)
    if (!(adapter instanceof LocalBackgroundJobsAdapter)) throw new Error("Expected default local adapter")

    await adapter.waitForIdle()

    expect(RecordingLocalJob.performances).toEqual([["browser-local"]])
    expect((await adapter.getJob(jobId))?.status).toEqual("completed")
    await configuration.closeBackgroundJobsAdapter()
  })

  it("wakes only after commit and leaves rolled-back enqueues invisible", async () => {
    const configuration = Configuration.current()

    resetLocalBackgroundJobClasses()
    await configuration.closeBackgroundJobsAdapter()
    configuration.setBackgroundJobsConfig({adapter: undefined, jobClasses: [RecordingLocalJob], mode: "background", queues: {}})
    configuration.setCurrent()

    let committedJobId = ""

    await configuration.ensureConnections({name: "Local job commit-aware enqueue"}, async (dbs) => {
      await dbs.default.transaction(async () => {
        committedJobId = await RecordingLocalJob.performLater("committed")
        await Promise.resolve()
        expect(RecordingLocalJob.performances).toEqual([])
      })
    })

    const adapter = await configuration.acquireReadyBackgroundJobsAdapter()

    if (!(adapter instanceof LocalBackgroundJobsAdapter)) throw new Error("Expected default local adapter")
    await adapter.waitForIdle()
    expect(RecordingLocalJob.performances).toEqual([["committed"]])

    let rolledBackJobId = ""

    await expect(async () => {
      await configuration.ensureConnections({name: "Local job rollback enqueue"}, async (dbs) => {
        await dbs.default.transaction(async () => {
          rolledBackJobId = await RecordingLocalJob.performLater("rolled-back")
          throw new Error("rollback local enqueue")
        })
      })
    }).toThrow("rollback local enqueue")

    await adapter.waitForIdle()
    expect(RecordingLocalJob.performances).toEqual([["committed"]])
    expect(await adapter.getJob(rolledBackJobId)).toEqual(null)
    expect((await adapter.getJob(committedJobId))?.status).toEqual("completed")
    await configuration.closeBackgroundJobsAdapter()
  })
})
