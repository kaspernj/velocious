// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/** @returns {Promise<BackgroundJobsStore>} - Empty background jobs store. */
async function createClearedStore() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})
  await store.clearAll()

  return store
}

/**
 * @param {object} args - Options.
 * @param {string} args.jobId - Job id.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow>} - Job row.
 */
async function getJobOrFail({jobId, store}) {
  const job = await store.getJob(jobId)

  if (!job) throw new Error(`Expected background job to exist: ${jobId}`)

  return job
}

/**
 * @param {object} args - Options.
 * @param {number} args.maxRetries - Job max retries.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow>} - Orphaned job row.
 */
async function createOrphanedJob({maxRetries, store}) {
  const jobId = await store.enqueue({
    jobName: "TestJob",
    args: [],
    options: {
      forked: false,
      maxRetries
    }
  })

  await store.markHandedOff({jobId, workerId: "worker-1"})
  await store.markOrphanedJobs({orphanedAfterMs: 0})

  return await getJobOrFail({jobId, store})
}

describe("Background jobs - store", {databaseCleaning: {truncate: true}}, () => {
  it("requeues failed jobs and honors max retries", async () => {
    const store = await createClearedStore()

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
    const store = await createClearedStore()

    const job = await createOrphanedJob({maxRetries: 1, store})

    expect(job.status).toEqual("queued")
    expect(job.attempts).toEqual(1)
    expect(job.orphanedAtMs).toBeGreaterThan(0)
  })

  it("marks orphaned jobs as orphaned when retries are exhausted", async () => {
    const store = await createClearedStore()

    const job = await createOrphanedJob({maxRetries: 0, store})

    expect(job.status).toEqual("orphaned")
    expect(job.attempts).toEqual(1)
    expect(job.orphanedAtMs).toBeGreaterThan(0)
  })

  it("returns the soonest future-scheduled queued job from nextScheduledJob", async () => {
    const store = await createClearedStore()

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
    const store = await createClearedStore()

    await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})

    const next = await store.nextScheduledJob()

    expect(next).toBeNull()
  })

  it("stores explicit execution modes and keeps forked as a compatibility flag", async () => {
    const store = await createClearedStore()

    const forkedJobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {executionMode: "forked"}
    })
    const spawnedJobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {executionMode: "spawned"}
    })
    const inlineJobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {forked: false}
    })

    const forkedJob = await getJobOrFail({jobId: forkedJobId, store})
    const spawnedJob = await getJobOrFail({jobId: spawnedJobId, store})
    const inlineJob = await getJobOrFail({jobId: inlineJobId, store})

    expect(forkedJob.executionMode).toEqual("forked")
    expect(forkedJob.forked).toEqual(true)
    expect(spawnedJob.executionMode).toEqual("spawned")
    expect(spawnedJob.forked).toEqual(true)
    expect(inlineJob.executionMode).toEqual("inline")
    expect(inlineJob.forked).toEqual(false)
  })

  it("filters next available jobs by execution mode", async () => {
    const store = await createClearedStore()

    await store.enqueue({jobName: "TestJob", args: ["inline"], options: {executionMode: "inline"}})
    const forkedJobId = await store.enqueue({jobName: "TestJob", args: ["forked"], options: {executionMode: "forked"}})
    const spawnedJobId = await store.enqueue({jobName: "TestJob", args: ["spawned"], options: {executionMode: "spawned"}})

    const nextForked = await store.nextAvailableJob({executionMode: "forked"})
    expect(nextForked?.id).toEqual(forkedJobId)

    const nextSpawnedOrForked = await store.nextAvailableJob({executionMode: ["spawned", "forked"]})
    expect(nextSpawnedOrForked?.id).toEqual(forkedJobId)

    await store.markHandedOff({jobId: forkedJobId, workerId: "worker-1"})
    const nextSpawned = await store.nextAvailableJob({executionMode: ["spawned", "forked"]})
    expect(nextSpawned?.id).toEqual(spawnedJobId)
  })

  it("rejects unknown execution modes", async () => {
    const store = await createClearedStore()

    let error

    try {
      await store.enqueue({
        jobName: "TestJob",
        args: [],
        options: /** @type {any} */ ({executionMode: "bad-mode"})
      })
    } catch (newError) {
      error = newError
    }

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toEqual("Invalid background job executionMode: bad-mode")
  })
})
