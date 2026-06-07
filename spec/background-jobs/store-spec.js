// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import TableData from "../../src/database/table-data/index.js"
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

/** @returns {Promise<BackgroundJobsStore>} - Store with a legacy jobs table missing execution_mode. */
async function createStoreWithLegacyJobsSchema() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})
  const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

  await pool.withConnection({name: "Background jobs legacy store schema"}, async (db) => {
    await db.dropTable("background_jobs", {cascade: true, ifExists: true})
    await db.dropTable("velocious_internal_migrations", {cascade: true, ifExists: true})
    db.clearSchemaCache()

    const migrationsTable = new TableData("velocious_internal_migrations")
    migrationsTable.string("key", {null: false, primaryKey: true})
    migrationsTable.string("scope", {null: false})
    migrationsTable.string("version", {null: false})
    migrationsTable.bigint("applied_at_ms", {null: false})
    await db.createTable(migrationsTable)

    const jobsTable = new TableData("background_jobs")
    jobsTable.string("id", {primaryKey: true})
    jobsTable.string("job_name", {null: false, index: true})
    jobsTable.text("args_json", {null: false})
    jobsTable.boolean("forked", {null: false})
    jobsTable.integer("max_retries", {null: false})
    jobsTable.integer("attempts", {null: false})
    jobsTable.string("status", {null: false, index: true})
    jobsTable.bigint("scheduled_at_ms", {null: false, index: true})
    jobsTable.bigint("created_at_ms", {null: false, index: true})
    jobsTable.bigint("handed_off_at_ms", {null: true, index: true})
    jobsTable.bigint("completed_at_ms", {null: true})
    jobsTable.bigint("failed_at_ms", {null: true})
    jobsTable.bigint("orphaned_at_ms", {null: true, index: true})
    jobsTable.string("worker_id", {null: true})
    jobsTable.text("last_error", {null: true})
    await db.createTable(jobsTable)
    db.clearSchemaCache()

    await db.insert({
      tableName: "velocious_internal_migrations",
      data: {
        key: "background_jobs:20250215000000",
        scope: "background_jobs",
        version: "20250215000000",
        applied_at_ms: Date.now()
      }
    })

    const now = Date.now()

    await db.insert({
      tableName: "background_jobs",
      data: {
        id: "legacy-forked-job",
        job_name: "TestJob",
        args_json: "[]",
        forked: true,
        max_retries: 10,
        attempts: 0,
        status: "queued",
        scheduled_at_ms: now,
        created_at_ms: now
      }
    })
    await db.insert({
      tableName: "background_jobs",
      data: {
        id: "legacy-inline-job",
        job_name: "TestJob",
        args_json: "[]",
        forked: false,
        max_retries: 10,
        attempts: 0,
        status: "queued",
        scheduled_at_ms: now + 1,
        created_at_ms: now + 1
      }
    })
  })

  return store
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

  it("backfills execution modes for legacy queued jobs", async () => {
    const store = await createStoreWithLegacyJobsSchema()

    await store.ensureReady()

    const forkedJob = await getJobOrFail({jobId: "legacy-forked-job", store})
    const inlineJob = await getJobOrFail({jobId: "legacy-inline-job", store})

    expect(forkedJob.executionMode).toEqual("forked")
    expect(inlineJob.executionMode).toEqual("inline")

    const nextForked = await store.nextAvailableJob({executionMode: "forked"})
    expect(nextForked?.id).toEqual("legacy-forked-job")

    const nextInline = await store.nextAvailableJob({executionMode: "inline"})
    expect(nextInline?.id).toEqual("legacy-inline-job")
  })

  it("records legacy execution mode backfill as a one-time migration", async () => {
    const store = await createStoreWithLegacyJobsSchema()

    await store.ensureReady()

    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs reset execution modes"}, async (db) => {
      const migrations = await db
        .newQuery()
        .from("velocious_internal_migrations")
        .where({key: "background_jobs:20260607131010"})
        .results()

      expect(migrations.length).toEqual(1)

      await db.update({
        tableName: "background_jobs",
        data: {execution_mode: null},
        conditions: {id: "legacy-forked-job"}
      })
      await db.update({
        tableName: "background_jobs",
        data: {execution_mode: null},
        conditions: {id: "legacy-inline-job"}
      })
    })

    await store.ensureReady()

    await pool.withConnection({name: "Background jobs verify execution modes"}, async (db) => {
      const rows = await db
        .newQuery()
        .from("background_jobs")
        .select("id")
        .select("execution_mode")
        .where({id: ["legacy-forked-job", "legacy-inline-job"]})
        .results()

      expect(rows.length).toEqual(2)

      for (const row of rows) {
        expect(row.execution_mode).toBeNull()
      }
    })
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
