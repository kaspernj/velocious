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

  it("applies current queue caps before recovered handoffs become eligible", async () => {
    resetLocalBackgroundJobClasses()
    const configuration = Configuration.current()
    const clock = new ManualBackgroundJobsClock()
    const first = gateLocalJob("recovered-first")
    const second = gateLocalJob("recovered-second")
    const sentinel = gateLocalJob("recovery-admission-sentinel")

    await configuration.closeBackgroundJobsAdapter()
    configuration.setBackgroundJobsConfig({
      adapter: undefined,
      databaseIdentifier: "default",
      jobClasses: [GatedLocalJob],
      maxConcurrentInlineJobs: 3,
      mode: "background",
      queues: {}
    })

    const store = new LocalBackgroundJobsStore({configuration, clock})
    const options = {executionMode: "inline", maxRetries: 1, queue: "recovered-serial"}
    const firstJobId = await store.enqueue({jobName: GatedLocalJob.jobName(), args: ["recovered-first"], options})

    await clock.advance(1)
    const secondJobId = await store.enqueue({jobName: GatedLocalJob.jobName(), args: ["recovered-second"], options})

    expect(await store.markHandedOff({jobId: firstJobId})).toBeTruthy()
    expect(await store.markHandedOff({jobId: secondJobId})).toBeTruthy()

    configuration.setBackgroundJobsConfig({queues: {"recovered-serial": {maxConcurrent: 1}}})
    await clock.advance(1)
    await store.enqueue({
      jobName: GatedLocalJob.jobName(),
      args: ["recovery-admission-sentinel"],
      options: {executionMode: "inline", maxRetries: 0, queue: "uncapped", scheduledAtMs: clock.now() + 10_000}
    })

    const adapter = new LocalBackgroundJobsAdapter({configuration, clock})
    let secondStarted = false

    void second.started.then(() => { secondStarted = true })

    try {
      await adapter.ensureReady()
      await adapter.waitForIdle()
      await clock.advance(10_000)
      await first.started
      await sentinel.started
      expect(secondStarted).toEqual(false)
      expect((await adapter.getJob(firstJobId))?.concurrencyKey).toEqual("queue:recovered-serial")
      expect((await adapter.getJob(secondJobId))?.status).toEqual("queued")
      first.release()
      await second.started
      second.release()
      sentinel.release()
      await adapter.waitForIdle()
      expect((await adapter.getJob(firstJobId))?.status).toEqual("completed")
      expect((await adapter.getJob(secondJobId))?.status).toEqual("completed")
    } finally {
      first.release()
      second.release()
      sentinel.release()
      await adapter.close()
    }
  })
})
