// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("Background jobs - store", {databaseCleaning: {transaction: true}}, () => {
  it("requeues failed jobs and honors max retries", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const jobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {
        forked: false,
        maxRetries: 1
      }
    })

    let handedOffAtMs = await store.markHandedOff({jobId, workerId: "worker-1"})

    const before = Date.now()
    await store.markFailed({jobId, error: "boom", workerId: "worker-1", handedOffAtMs})

    let job = await store.getJob(jobId)

    expect(job?.status).toEqual("queued")
    expect(job?.attempts).toEqual(1)
    expect(job?.scheduledAtMs).toBeGreaterThan(before + 9000)

    handedOffAtMs = await store.markHandedOff({jobId, workerId: "worker-1"})
    await store.markFailed({jobId, error: "boom again", workerId: "worker-1", handedOffAtMs})

    job = await store.getJob(jobId)

    expect(job?.status).toEqual("failed")
    expect(job?.attempts).toEqual(2)
  })

  it("marks orphaned jobs and requeues when retries remain", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const jobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {
        forked: false,
        maxRetries: 1
      }
    })

    await store.markHandedOff({jobId, workerId: "worker-1"})
    await store.markOrphanedJobs({orphanedAfterMs: 0})

    const job = await store.getJob(jobId)

    expect(job?.status).toEqual("queued")
    expect(job?.attempts).toEqual(1)
    expect(job?.orphanedAtMs).toBeGreaterThan(0)
  })

  it("marks orphaned jobs as orphaned when retries are exhausted", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    const jobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {
        forked: false,
        maxRetries: 0
      }
    })

    await store.markHandedOff({jobId, workerId: "worker-1"})
    await store.markOrphanedJobs({orphanedAfterMs: 0})

    const job = await store.getJob(jobId)

    expect(job?.status).toEqual("orphaned")
    expect(job?.attempts).toEqual(1)
    expect(job?.orphanedAtMs).toBeGreaterThan(0)
  })

  it("returns the soonest future-scheduled queued job from nextScheduledJob", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    // Job 1: immediately eligible — should NOT come back from nextScheduledJob.
    await store.enqueue({jobName: "TestJob", args: ["now"], options: {forked: false}})

    // Job 2: build a future-scheduled job by re-queueing a failed job with backoff.
    const futureJobId = await store.enqueue({jobName: "TestJob", args: ["later"], options: {forked: false, maxRetries: 5}})
    const handedOffAtMs = await store.markHandedOff({jobId: futureJobId, workerId: "worker-x"})
    await store.markFailed({jobId: futureJobId, error: "transient", workerId: "worker-x", handedOffAtMs})

    const next = await store.nextScheduledJob()

    expect(next?.id).toEqual(futureJobId)
    expect(next?.scheduledAtMs).toBeGreaterThan(Date.now())
  })

  it("returns null from nextScheduledJob when no future-scheduled jobs exist", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    await store.clearAll()

    await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})

    const next = await store.nextScheduledJob()

    expect(next).toBeNull()
  })
})
