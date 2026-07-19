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
      maxRetries
    }
  })

  await store.markHandedOff({jobId, workerId: "worker-1"})
  await store.markOrphanedJobs({orphanedAfterMs: 0})

  return await getJobOrFail({jobId, store})
}

class ScriptedBackgroundJobsStore extends BackgroundJobsStore {
  /**
   * @param {object} args - Options.
   * @param {import("../../src/database/drivers/base.js").default} args.db - Scripted database connection.
   * @param {import("../../src/background-jobs/types.js").BackgroundJobRow} args.job - Scripted job row.
   */
  constructor({db, job}) {
    super({configuration: dummyConfiguration})
    this.scriptedDb = db
    this.scriptedJob = job
  }

  /** @returns {Promise<void>} - Resolves immediately. */
  async ensureReady() {}

  /** @param {Function} callback - Database callback. */
  async _withDb(callback) {
    return await callback(this.scriptedDb)
  }

  /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @param {Function} callback - Transaction callback. */
  async _transactionResult(db, callback) {
    void db
    return await callback()
  }

  /** @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow>} - Scripted job. */
  async _getJobRowById() {
    return this.scriptedJob
  }
}

/** @returns {import("../../src/background-jobs/types.js").BackgroundJobRow} - Active concurrency-limited job. */
function activeConcurrencyJob() {
  return {
    id: "concurrent-job",
    jobName: "TestJob",
    args: [],
    executionMode: "inline",
    status: "handed_off",
    attempts: 0,
    maxRetries: 0,
    scheduledAtMs: 1,
    createdAtMs: 1,
    handedOffAtMs: 2,
    handoffId: "handoff-1",
    completedAtMs: null,
    failedAtMs: null,
    orphanedAtMs: null,
    workerId: "worker-1",
    lastError: null,
    concurrencyKey: "shared-key",
    maxConcurrency: 2
  }
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
  it("validates paired concurrency options and rejects conflicting caps", async () => {
    const store = await createClearedStore()
    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: "account:1"}})).toThrow(/must be paired/)
    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: "", maxConcurrency: 1}})).toThrow(/must be paired/)
    await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: "account:1", maxConcurrency: 2}})
    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: "account:1", maxConcurrency: 3}})).toThrow(/Conflicting maxConcurrency/)
  })

  it("claims atomically, skips saturated keys, and releases reservations", async () => {
    const store = await createClearedStore()
    const firstId = await store.enqueue({jobName: "TestJob", args: ["first"], options: {concurrencyKey: "serial", maxConcurrency: 1}})
    const blockedId = await store.enqueue({jobName: "TestJob", args: ["blocked"], options: {concurrencyKey: "serial", maxConcurrency: 1}})
    const freeId = await store.enqueue({jobName: "TestJob", args: ["free"], options: {concurrencyKey: "other", maxConcurrency: 1}})
    const firstHandoff = await store.markHandedOff({jobId: firstId, workerId: "worker-1"})
    if (!firstHandoff) throw new Error("Expected first job claim")

    expect((await store.nextAvailableJob())?.id).toEqual(freeId)
    expect(await store.markHandedOff({jobId: blockedId, workerId: "worker-2"})).toBeNull()

    await store.markCompleted({jobId: firstId, workerId: "worker-1", ...firstHandoff})
    expect((await store.nextAvailableJob())?.id).toEqual(blockedId)
  })

  it("allows only the cap across workers and releases on cancellation", async () => {
    const store = await createClearedStore()
    const ids = await Promise.all([1, 2].map(async (number) => await store.enqueue({jobName: "TestJob", args: [number], options: {concurrencyKey: "one-at-a-time", maxConcurrency: 1}})))
    const claims = []
    for (const [index, jobId] of ids.entries()) claims.push(await store.markHandedOff({jobId, workerId: `worker-${index}`}))
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claimedIndex = claims.findIndex(Boolean)
    expect(await store.cancel(ids[claimedIndex])).toEqual(true)
    expect(await store.markHandedOff({jobId: ids[1 - claimedIndex], workerId: "replacement"})).not.toBeNull()
  })

  it("routes queue-configured jobs onto a cluster-wide per-queue concurrency cap", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 2}}})

    try {
      const store = await createClearedStore()
      const first = await store.enqueue({jobName: "TestJob", args: [1], options: {queue: "builds"}})
      const second = await store.enqueue({jobName: "TestJob", args: [2], options: {queue: "builds"}})
      const third = await store.enqueue({jobName: "TestJob", args: [3], options: {queue: "builds"}})
      const firstRow = await getJobOrFail({jobId: first, store})

      expect(firstRow.queue).toEqual("builds")
      expect(firstRow.concurrencyKey).toEqual("queue:builds")
      expect(firstRow.maxConcurrency).toEqual(2)

      const claim1 = await store.markHandedOff({jobId: first, workerId: "w1"})
      const claim2 = await store.markHandedOff({jobId: second, workerId: "w2"})

      if (!claim1 || !claim2) throw new Error("Expected the first two queued jobs to claim")

      expect(await store.markHandedOff({jobId: third, workerId: "w3"})).toBeNull()

      await store.markCompleted({jobId: first, workerId: "w1", ...claim1})

      expect(await store.markHandedOff({jobId: third, workerId: "w3"})).not.toBeNull()
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("lets an explicit concurrencyKey override the queue-derived cap", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 5}}})

    try {
      const store = await createClearedStore()
      const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {queue: "builds", concurrencyKey: "account:1", maxConcurrency: 1}})
      const row = await getJobOrFail({jobId, store})

      expect(row.queue).toEqual("builds")
      expect(row.concurrencyKey).toEqual("account:1")
      expect(row.maxConcurrency).toEqual(1)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("leaves jobs on unconfigured queues uncapped", async () => {
    const store = await createClearedStore()
    const first = await store.enqueue({jobName: "TestJob", args: [1], options: {queue: "adhoc"}})
    const second = await store.enqueue({jobName: "TestJob", args: [2], options: {queue: "adhoc"}})
    const firstRow = await getJobOrFail({jobId: first, store})

    expect(firstRow.queue).toEqual("adhoc")
    expect(firstRow.concurrencyKey).toBeNull()
    expect(await store.markHandedOff({jobId: first, workerId: "w1"})).not.toBeNull()
    expect(await store.markHandedOff({jobId: second, workerId: "w2"})).not.toBeNull()
  })

  it("updates a queue's stored cap when the configured cap changes instead of throwing", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 1}}})

    try {
      const store = await createClearedStore()

      await store.enqueue({jobName: "TestJob", args: [1], options: {queue: "builds"}})
      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 3}}})
      const jobId = await store.enqueue({jobName: "TestJob", args: [2], options: {queue: "builds"}})
      const row = await getJobOrFail({jobId, store})

      expect(row.maxConcurrency).toEqual(3)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("dispatches a higher-priority queue before a lower-priority one regardless of enqueue order", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {urgent: {priority: 10}}})

    try {
      const store = await createClearedStore()
      // Enqueue the default-priority job first, so pure FIFO would pick it — priority must override that.
      const lowId = await store.enqueue({jobName: "TestJob", args: ["low"], options: {queue: "default"}})
      const highId = await store.enqueue({jobName: "TestJob", args: ["high"], options: {queue: "urgent"}})

      expect((await store.nextAvailableJob())?.id).toEqual(highId)

      const highClaim = await store.markHandedOff({jobId: highId, workerId: "w1"})
      if (!highClaim) throw new Error("Expected the high-priority job to claim")

      expect((await store.nextAvailableJob())?.id).toEqual(lowId)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("skips a higher-priority queue that is at its cap and dispatches the lower-priority job instead", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {urgent: {priority: 10, maxConcurrent: 1}}})

    try {
      const store = await createClearedStore()
      const firstUrgent = await store.enqueue({jobName: "TestJob", args: ["urgent-1"], options: {queue: "urgent"}})
      const secondUrgent = await store.enqueue({jobName: "TestJob", args: ["urgent-2"], options: {queue: "urgent"}})
      const lowId = await store.enqueue({jobName: "TestJob", args: ["low"], options: {queue: "default"}})

      // Fill the urgent queue's cap of 1.
      const claim = await store.markHandedOff({jobId: firstUrgent, workerId: "w1"})
      if (!claim) throw new Error("Expected the first urgent job to claim")

      // The second urgent job is blocked by the cap, so priority ordering must fall through to the low-priority job.
      expect((await store.nextAvailableJob())?.id).toEqual(lowId)

      // Freeing the cap lets the queued urgent job win again on priority.
      await store.markCompleted({jobId: firstUrgent, workerId: "w1", ...claim})

      expect((await store.nextAvailableJob())?.id).toEqual(secondUrgent)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("lets a negative priority sink a queue below the default queue", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {sweep: {priority: -5}}})

    try {
      const store = await createClearedStore()
      // Enqueue the sunk-priority job first; the later default job must still win on priority.
      const sweepId = await store.enqueue({jobName: "TestJob", args: ["sweep"], options: {queue: "sweep"}})
      const defaultId = await store.enqueue({jobName: "TestJob", args: ["default"], options: {queue: "default"}})

      expect((await store.nextAvailableJob())?.id).toEqual(defaultId)

      const claim = await store.markHandedOff({jobId: defaultId, workerId: "w1"})
      if (!claim) throw new Error("Expected the default job to claim")

      expect((await store.nextAvailableJob())?.id).toEqual(sweepId)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("defaults an unspecified queue to \"default\"", async () => {
    const store = await createClearedStore()
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {}})
    const row = await getJobOrFail({jobId, store})

    expect(row.queue).toEqual("default")
  })

  it("rejects an explicit concurrencyKey that uses the reserved queue: prefix", async () => {
    const store = await createClearedStore()
    let error = /** @type {Error | null} */ (null)

    try {
      await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: "queue:builds", maxConcurrency: 2}})
    } catch (newError) {
      error = /** @type {Error} */ (newError)
    }

    expect(error).toBeTruthy()
    expect(error?.message).toContain("reserved")
  })

  it("reconciles queue caps against the persisted backlog on startup", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    const store = await createClearedStore()
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {queue: "builds"}})

    // No cap configured yet, so the queued job carries no concurrency key.
    expect((await getJobOrFail({jobId, store})).concurrencyKey).toEqual(null)

    try {
      // Adding a cap adopts the existing backlog onto the queue key on startup.
      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 2}}})
      const adoptStore = new BackgroundJobsStore({configuration: dummyConfiguration})
      await adoptStore.ensureReady()
      const adopted = await getJobOrFail({jobId, store: adoptStore})

      expect(adopted.concurrencyKey).toEqual("queue:builds")
      expect(adopted.maxConcurrency).toEqual(2)

      // Removing the cap releases the backlog from the queue key on startup.
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
      const releaseStore = new BackgroundJobsStore({configuration: dummyConfiguration})
      await releaseStore.ensureReady()

      expect((await getJobOrFail({jobId, store: releaseStore})).concurrencyKey).toEqual(null)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("coalesces deduplicateWhileQueued enqueues onto a still-queued job", async () => {
    const store = await createClearedStore()
    const options = {concurrencyKey: "recurring-key", maxConcurrency: 1, deduplicateWhileQueued: true}

    const firstId = await store.enqueue({jobName: "TestJob", args: [], options})
    const secondId = await store.enqueue({jobName: "TestJob", args: [], options})

    // The second enqueue coalesces onto the still-queued first job.
    expect(secondId).toEqual(firstId)

    const rows = await store._withDb(async (db) =>
      await db.newQuery().from("background_jobs").where({concurrency_key: "recurring-key"}).results()
    )

    expect(rows.length).toEqual(1)

    // Once the first is no longer queued (handed off), a fresh enqueue is allowed.
    await store.markHandedOff({jobId: firstId, workerId: "w"})
    const thirdId = await store.enqueue({jobName: "TestJob", args: [], options})

    expect(thirdId).not.toEqual(firstId)
  })

  it("releases a concurrency reservation when a competing queued claim loses", async () => {
    let activeCount = 0
    const db = {
      affectedRows: async (sql) => {
        if (sql.includes("active_count + 1")) {
          activeCount += 1
          return 1
        }

        return 0
      },
      query: async (sql) => {
        if (sql.includes("active_count - 1")) activeCount -= 1
        return []
      },
      quoteColumn: (value) => value,
      quoteTable: (value) => value,
      quote: (value) => `'${value}'`,
      updateSql: () => "UPDATE background_jobs SET status = 'handed_off' WHERE status = 'queued'"
    }
    const queuedJob = activeConcurrencyJob()
    queuedJob.status = "queued"
    queuedJob.handoffId = null
    queuedJob.handedOffAtMs = null
    const scriptedDb = /** @type {import("../../src/database/drivers/base.js").default} */ (db)
    const store = new ScriptedBackgroundJobsStore({db: scriptedDb, job: queuedJob})

    expect(await store.markHandedOff({jobId: queuedJob.id, workerId: "claim-loser"})).toBeNull()
    expect(activeCount).toEqual(0)
  })

  it("releases capacity only for the competing terminal transition that wins", async () => {
    let activeCount = 1
    let terminalUpdates = 0
    let releases = 0
    const db = {
      affectedRows: async (sql) => {
        if (sql.includes("active_count + 1")) {
          activeCount += 1
          return 1
        }

        terminalUpdates += 1
        return terminalUpdates === 1 ? 1 : 0
      },
      query: async (sql) => {
        if (sql.includes("active_count - 1")) {
          activeCount -= 1
          releases += 1
        }
        return []
      },
      quoteColumn: (value) => value,
      quoteTable: (value) => value,
      quote: (value) => `'${value}'`,
      updateSql: () => "UPDATE background_jobs SET status = 'completed' WHERE status = 'handed_off'"
    }
    const job = activeConcurrencyJob()
    const scriptedDb = /** @type {import("../../src/database/drivers/base.js").default} */ (db)
    const store = new ScriptedBackgroundJobsStore({db: scriptedDb, job})
    const report = {jobId: job.id, handoffId: job.handoffId || undefined, workerId: job.workerId || undefined, handedOffAtMs: job.handedOffAtMs || undefined}

    expect(await Promise.all([store.markCompleted(report), store.markCompleted(report)])).toEqual([true, false])
    expect(releases).toEqual(1)

    expect(await store._reserveConcurrency(scriptedDb, job.concurrencyKey || "")).toEqual(true)
    expect(activeCount).toEqual(1)
  })

  it("uses each conditional update result instead of a shared claim token", async () => {
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})
    let updateCount = 0
    let sharedToken = null
    let secondUpdateFinished
    const secondUpdate = new Promise((resolve) => { secondUpdateFinished = resolve })
    const db = {
      affectedRows: async () => 1,
      query: async (sql) => {
        updateCount += 1
        sharedToken = sql.match(/reservation_token = '([^']+)'/)?.[1] || null
        if (updateCount === 1) await secondUpdate
        else secondUpdateFinished()
        return []
      },
      newQuery: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({results: async () => [{reservation_token: sharedToken}]})
          })
        })
      }),
      quoteColumn: (value) => value,
      quoteTable: (value) => value,
      quote: (value) => `'${value}'`
    }

    const claims = await Promise.all([
      store._reserveConcurrency(/** @type {import("../../src/database/drivers/base.js").default} */ (db), "two-at-a-time"),
      store._reserveConcurrency(/** @type {import("../../src/database/drivers/base.js").default} */ (db), "two-at-a-time")
    ])

    expect(claims).toEqual([true, true])
  })

  it("releases concurrency capacity for retries and orphan recovery", async () => {
    const store = await createClearedStore()
    const retryId = await store.enqueue({jobName: "TestJob", args: ["retry"], options: {concurrencyKey: "lifecycle", maxConcurrency: 1, maxRetries: 1}})
    const waitingId = await store.enqueue({jobName: "TestJob", args: ["waiting"], options: {concurrencyKey: "lifecycle", maxConcurrency: 1}})
    const retryHandoff = await store.markHandedOff({jobId: retryId, workerId: "worker-1"})
    if (!retryHandoff) throw new Error("Expected retry job claim")
    await store.markFailed({jobId: retryId, error: "retry", workerId: "worker-1", ...retryHandoff})
    const waitingHandoff = await store.markHandedOff({jobId: waitingId, workerId: "worker-2"})
    if (!waitingHandoff) throw new Error("Expected waiting job claim")
    await store.markOrphanedJobs({orphanedAfterMs: 0})

    expect(await store.markHandedOff({jobId: retryId, workerId: "worker-3"})).not.toBeNull()
  })

  it("fences stale completion and failure reports after a handoff is requeued", async () => {
    const store = await createClearedStore()
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {}})
    const firstHandoff = await store.markHandedOff({jobId, workerId: "shared-worker-id"})

    if (!firstHandoff) throw new Error("Expected the first handoff to be claimed")

    await store.markReturnedToQueue({jobId, handoffId: firstHandoff.handoffId})

    const secondHandoff = await store.markHandedOff({jobId, workerId: "shared-worker-id"})

    if (!secondHandoff) throw new Error("Expected the second handoff to be claimed")

    await store.markCompleted({
      jobId,
      handoffId: firstHandoff.handoffId,
      workerId: "shared-worker-id",
      handedOffAtMs: firstHandoff.handedOffAtMs
    })
    await store.markFailed({
      jobId,
      error: "late failure",
      handoffId: firstHandoff.handoffId,
      workerId: "shared-worker-id",
      handedOffAtMs: firstHandoff.handedOffAtMs
    })

    const job = await getJobOrFail({jobId, store})

    expect(job.status).toEqual("handed_off")
    expect(job.handoffId).toEqual(secondHandoff.handoffId)
    expect(job.attempts).toEqual(0)
    expect(job.lastError).toBeNull()
  })

  it("requeues failed jobs and honors max retries", async () => {
    const store = await createClearedStore()

    const jobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {
        maxRetries: 1
      }
    })

    let handoff = await store.markHandedOff({jobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    const before = Date.now()
    await store.markFailed({jobId, error: "boom", workerId: "worker-1", ...handoff})

    let job = await store.getJob(jobId)

    expect(job?.status).toEqual("queued")
    expect(job?.attempts).toEqual(1)
    expect(job?.scheduledAtMs).toBeGreaterThan(before + 9000)

    handoff = await store.markHandedOff({jobId, workerId: "worker-1"})
    if (!handoff) throw new Error("Expected the retried job to be handed off")
    await store.markFailed({jobId, error: "boom again", workerId: "worker-1", ...handoff})

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

  it("reclaims handed-off jobs whose handoff_id is null (older-velocious legacy rows)", async () => {
    const store = await createClearedStore()

    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {maxRetries: 1}})
    await store.markHandedOff({jobId, workerId: "worker-1"})

    // Simulate a row handed off by an older velocious that never populated
    // handoff_id. The old orphan sweep matched `{handoff_id: null}`, which
    // renders as `handoff_id = NULL` and strands such rows forever.
    await store._withDb(async (db) => {
      await db.query(`UPDATE background_jobs SET handoff_id = NULL WHERE id = ${db.quote(jobId)}`)
    })

    const orphanedJobs = await store.markOrphanedJobs({orphanedAfterMs: 0})
    const job = await getJobOrFail({jobId, store})

    expect(orphanedJobs.length).toEqual(1)
    expect(job.status).toEqual("queued")
    expect(job.attempts).toEqual(1)
    expect(job.orphanedAtMs).toBeGreaterThan(0)
  })

  it("fences orphan reclamation to the selected handoff timestamp so a re-handed-off lease is not clobbered", async () => {
    // A handed-off row the sweep selected at an old cutoff-era timestamp.
    const rawRow = {
      id: "stranded-1",
      job_name: "TestJob",
      args_json: "[]",
      execution_mode: "forked",
      max_retries: 10,
      attempts: 0,
      status: "handed_off",
      scheduled_at_ms: 1,
      created_at_ms: 1,
      handed_off_at_ms: 1000,
      handoff_id: null,
      worker_id: "dead-worker",
      completed_at_ms: null,
      failed_at_ms: null,
      orphaned_at_ms: null,
      last_error: null,
      concurrency_key: null,
      max_concurrency: null,
      queue: "default"
    }
    let capturedConditions = null
    let releaseCalls = 0
    const db = {
      newQuery: () => ({from: () => ({where: () => ({where: () => ({results: async () => [rawRow]})})})}),
      updateSql: (/** @type {{conditions: Record<string, ?>}} */ args) => {
        capturedConditions = args.conditions

        return "UPDATE background_jobs SET status = 'orphaned' WHERE fenced"
      },
      // Simulate the row having been re-handed-off after the SELECT: the stale
      // cutoff-era timestamp fence now matches no rows.
      affectedRows: async () => 0,
      query: async (/** @type {string} */ sql) => {
        if (sql.includes("active_count - 1")) releaseCalls += 1

        return []
      },
      quote: (/** @type {?} */ value) => (value === null ? "NULL" : `'${value}'`),
      quoteColumn: (/** @type {string} */ value) => value,
      quoteTable: (/** @type {string} */ value) => value
    }
    const scriptedDb = /** @type {import("../../src/database/drivers/base.js").default} */ (db)
    const store = new ScriptedBackgroundJobsStore({db: scriptedDb, job: /** @type {?} */ (rawRow)})

    const orphanedJobs = await store.markOrphanedJobs({orphanedAfterMs: 0})

    expect(orphanedJobs.length).toEqual(0)
    expect(capturedConditions).toEqual({id: "stranded-1", status: "handed_off", handed_off_at_ms: 1000})
    expect(releaseCalls).toEqual(0)
  })

  it("prunes completed rows past the retention window and keeps recent and non-terminal rows", async () => {
    const store = await createClearedStore()

    const oldCompletedId = await store.enqueue({jobName: "TestJob", args: ["old"], options: {}})
    const oldHandoff = await store.markHandedOff({jobId: oldCompletedId, workerId: "w"})
    if (!oldHandoff) throw new Error("Expected the old job to be handed off")
    await store.markCompleted({jobId: oldCompletedId, workerId: "w", ...oldHandoff})

    const recentCompletedId = await store.enqueue({jobName: "TestJob", args: ["recent"], options: {}})
    const recentHandoff = await store.markHandedOff({jobId: recentCompletedId, workerId: "w"})
    if (!recentHandoff) throw new Error("Expected the recent job to be handed off")
    await store.markCompleted({jobId: recentCompletedId, workerId: "w", ...recentHandoff})

    const queuedId = await store.enqueue({jobName: "TestJob", args: ["queued"], options: {}})

    // Age the old row's completion 10 days into the past.
    await store._withDb(async (db) => {
      await db.query(`UPDATE background_jobs SET completed_at_ms = ${db.quote(Date.now() - 10 * 24 * 60 * 60 * 1000)} WHERE id = ${db.quote(oldCompletedId)}`)
    })

    const deleted = await store.pruneTerminalJobs({completedTtlMs: 7 * 24 * 60 * 60 * 1000, batchSize: 100})

    expect(deleted).toEqual(1)
    expect(await store.getJob(oldCompletedId)).toEqual(null)
    expect((await getJobOrFail({jobId: recentCompletedId, store})).status).toEqual("completed")
    expect((await getJobOrFail({jobId: queuedId, store})).status).toEqual("queued")
  })

  it("prunes failed and orphaned rows past the failed retention window", async () => {
    const store = await createClearedStore()

    const orphaned = await createOrphanedJob({maxRetries: 0, store})

    const failedId = await store.enqueue({jobName: "TestJob", args: [], options: {maxRetries: 0}})
    const failedHandoff = await store.markHandedOff({jobId: failedId, workerId: "w"})
    if (!failedHandoff) throw new Error("Expected the failing job to be handed off")
    await store.markFailed({jobId: failedId, error: "boom", workerId: "w", ...failedHandoff})

    // Age both terminal timestamps 60 days into the past.
    await store._withDb(async (db) => {
      const past = db.quote(Date.now() - 60 * 24 * 60 * 60 * 1000)
      await db.query(`UPDATE background_jobs SET orphaned_at_ms = ${past} WHERE id = ${db.quote(orphaned.id)}`)
      await db.query(`UPDATE background_jobs SET failed_at_ms = ${past} WHERE id = ${db.quote(failedId)}`)
    })

    const deleted = await store.pruneTerminalJobs({failedTtlMs: 30 * 24 * 60 * 60 * 1000, batchSize: 100})

    expect(deleted).toEqual(2)
    expect(await store.getJob(orphaned.id)).toEqual(null)
    expect(await store.getJob(failedId)).toEqual(null)
  })

  it("returns the soonest future-scheduled queued job from nextScheduledJob", async () => {
    const store = await createClearedStore()

    // Job 1: immediately eligible — should NOT come back from nextScheduledJob.
    await store.enqueue({jobName: "TestJob", args: ["now"], options: {}})

    // Job 2: build a future-scheduled job by re-queueing a failed job with backoff.
    const futureJobId = await store.enqueue({jobName: "TestJob", args: ["later"], options: {maxRetries: 5}})
    const handoff = await store.markHandedOff({jobId: futureJobId, workerId: "worker-x"})
    if (!handoff) throw new Error("Expected the future job to be handed off")
    await store.markFailed({jobId: futureJobId, error: "transient", workerId: "worker-x", ...handoff})

    const next = await store.nextScheduledJob()

    expect(next?.id).toEqual(futureJobId)
    expect(next?.scheduledAtMs).toBeGreaterThan(Date.now())
  })

  it("enqueues a job for an explicit future scheduledAtMs", async () => {
    const store = await createClearedStore()
    const laterScheduledAtMs = Date.now() + 60000
    const soonerScheduledAtMs = laterScheduledAtMs - 30000
    const laterJobId = await store.enqueue({
      jobName: "TestJob",
      args: ["later"],
      options: {scheduledAtMs: laterScheduledAtMs}
    })
    const soonerJobId = await store.enqueue({
      jobName: "TestJob",
      args: ["sooner"],
      options: {scheduledAtMs: soonerScheduledAtMs}
    })

    expect((await getJobOrFail({jobId: laterJobId, store})).scheduledAtMs).toEqual(laterScheduledAtMs)
    expect(await store.nextAvailableJob()).toBeNull()
    expect((await store.nextScheduledJob())?.id).toEqual(soonerJobId)
  })

  it("rejects invalid scheduledAtMs enqueue options", async () => {
    const store = await createClearedStore()

    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: {scheduledAtMs: -1}})).toThrow(/scheduledAtMs/)
    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: {scheduledAtMs: Number.POSITIVE_INFINITY}})).toThrow(/scheduledAtMs/)
  })

  it("returns null from nextScheduledJob when no future-scheduled jobs exist", async () => {
    const store = await createClearedStore()

    await store.enqueue({jobName: "TestJob", args: [], options: {}})

    const next = await store.nextScheduledJob()

    expect(next).toBeNull()
  })

  it("stores explicit execution modes", async () => {
    const store = await createClearedStore()

    const forkedJobId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "forked"}})
    const spawnedJobId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "spawned"}})
    const inlineJobId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "inline"}})
    const pooledJobId = await store.enqueue({jobName: "TestJob", args: []})

    expect((await getJobOrFail({jobId: forkedJobId, store})).executionMode).toEqual("forked")
    expect((await getJobOrFail({jobId: spawnedJobId, store})).executionMode).toEqual("spawned")
    expect((await getJobOrFail({jobId: inlineJobId, store})).executionMode).toEqual("inline")
    expect((await getJobOrFail({jobId: pooledJobId, store})).executionMode).toEqual("pooled")
  })

  it("persists pooled jobs as execution_mode \"pooled\" with no handoff marker", async () => {
    const store = await createClearedStore()
    const pooledJobId = await store.enqueue({jobName: "TestJob", args: []})
    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs verify pooled row"}, async (db) => {
      const rows = await db
        .newQuery()
        .from("background_jobs")
        .where({id: pooledJobId})
        .results()

      // execution_mode is the single source of truth: pooled persists directly,
      // with no legacy forked vocabulary and no queued handoff marker.
      expect(String(rows[0]?.execution_mode)).toEqual("pooled")
      expect(rows[0]?.handoff_id ?? null).toEqual(null)
    })

    expect((await getJobOrFail({jobId: pooledJobId, store})).executionMode).toEqual("pooled")

    const nextForked = await store.nextAvailableJob({executionMode: "forked"})
    const nextPooled = await store.nextAvailableJob({executionMode: "pooled"})
    expect(nextForked).toBeNull()
    expect(nextPooled?.id).toEqual(pooledJobId)
  })

  it("keeps a failed pooled job pooled when it returns to the queue", async () => {
    const store = await createClearedStore()
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {maxRetries: 1}})
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})
    if (!handoff) throw new Error("Expected pooled job handoff")

    await store.markFailed({jobId, error: "retry", workerId: "worker-1", ...handoff})

    const job = await getJobOrFail({jobId, store})
    expect(job.executionMode).toEqual("pooled")
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

    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())
    await pool.withConnection({name: "Background jobs verify concurrency migration"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")
      const concurrencyTable = await db.getTableByNameOrFail("background_job_concurrency")
      expect(await jobsTable.getColumnByName("concurrency_key")).not.toBeNull()
      expect(await jobsTable.getColumnByName("max_concurrency")).not.toBeNull()
      expect(await concurrencyTable.getColumnByName("reservation_token")).toEqual(undefined)
    })
  })

  it("serializes and rechecks concurrent legacy concurrency-column migrations", async () => {
    const firstStore = await createStoreWithLegacyJobsSchema()
    const pool = dummyConfiguration.getDatabasePool(firstStore.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs prepare concurrency-only legacy schema"}, async (db) => {
      for (const columnName of ["execution_mode", "handoff_id"]) {
        const tableData = new TableData("background_jobs")
        tableData.string(columnName, {null: true})
        for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)
      }

      db.clearSchemaCache()
    })

    const secondStore = new BackgroundJobsStore({configuration: dummyConfiguration})

    await Promise.all([firstStore.ensureReady(), secondStore.ensureReady()])

    await pool.withConnection({name: "Background jobs verify concurrent concurrency migration"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")
      expect(await jobsTable.getColumnByName("concurrency_key")).not.toBeNull()
      expect(await jobsTable.getColumnByName("max_concurrency")).not.toBeNull()
    })
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

  it("rejects the removed `forked` option instead of silently defaulting to pooled", async () => {
    const store = await createClearedStore()

    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: /** @type {any} */ ({forked: false})})).toThrow(/`forked` option was removed/)
    await expect(async () => await store.enqueue({jobName: "TestJob", args: [], options: /** @type {any} */ ({forked: true})})).toThrow(/`forked` option was removed/)
  })
})
