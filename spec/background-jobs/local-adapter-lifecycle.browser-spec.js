// @ts-check

import LocalBackgroundJobsAdapter from "../../src/background-jobs/local-adapter.js"
import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
import {GatedLocalJob, ManualBackgroundJobsClock, RecordingLocalJob, gateLocalJob, localBackgroundJobsHarness, resetLocalBackgroundJobClasses} from "../helpers/local-background-jobs-test-harness.js"
import Configuration from "../../src/configuration.js"

describe("Local background jobs adapter - lifecycle", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("coalesces wakes and waits for in-flight acknowledgement before close resolves", async () => {
    resetLocalBackgroundJobClasses()
    const gate = gateLocalJob("close")
    const {adapter, configuration} = await localBackgroundJobsHarness({jobClasses: [GatedLocalJob]})

    await adapter.enqueue({jobName: GatedLocalJob.jobName(), args: ["close"]})
    await gate.started
    adapter.wake()
    adapter.wake()
    adapter.wake()

    let closed = false
    const closePromise = configuration.closeBackgroundJobsAdapter().then(() => { closed = true })

    await Promise.resolve()
    expect(closed).toEqual(false)
    gate.release()
    await closePromise
    expect((await adapter.getJob((await adapter.listJobs())[0].id))?.status).toEqual("completed")
    await adapter.ensureReady()
    expect((await adapter.health()).ready).toEqual(true)
    await adapter.close()
  })

  it("reopens and recovers a persisted abandoned handoff through normal retry planning", async () => {
    resetLocalBackgroundJobClasses()
    const configuration = Configuration.current()
    const clock = new ManualBackgroundJobsClock()

    await configuration.closeBackgroundJobsAdapter()
    configuration.setBackgroundJobsConfig({adapter: undefined, databaseIdentifier: "default", jobClasses: [RecordingLocalJob], mode: "background", queues: {}})

    const store = new LocalBackgroundJobsStore({configuration, clock})
    const jobId = await store.enqueue({jobName: RecordingLocalJob.jobName(), args: ["recovered"], options: {maxRetries: 1}})
    const handoff = await store.markHandedOff({jobId})

    expect(handoff).toBeTruthy()

    const adapter = new LocalBackgroundJobsAdapter({configuration, clock})

    await adapter.ensureReady()
    await adapter.waitForIdle()
    expect((await adapter.getJob(jobId))?.status).toEqual("queued")
    expect((await adapter.getJob(jobId))?.attempts).toEqual(1)
    await clock.advance(10_000)
    await adapter.waitForIdle()
    expect((await adapter.getJob(jobId))?.status).toEqual("completed")
    expect(RecordingLocalJob.performances).toEqual([["recovered"]])
    await adapter.close()
  })
})
