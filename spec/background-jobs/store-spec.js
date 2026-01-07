// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("Background jobs - store", () => {
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

    await store.markHandedOff({jobId, workerId: "worker-1"})

    const before = Date.now()
    await store.markFailed({jobId, error: "boom"})

    let job = await store.getJob(jobId)

    expect(job?.status).toEqual("queued")
    expect(job?.attempts).toEqual(1)
    expect(job?.scheduledAtMs).toBeGreaterThan(before + 9000)

    await store.markFailed({jobId, error: "boom again"})

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
})
