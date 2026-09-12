// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import TableData from "../../src/database/table-data/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const SCHEDULE_ORDER_WATERMARK_MIGRATION_KEY = "background_jobs:20260911120000"

/** @returns {BackgroundJobsStore} - Background jobs store. */
function createStore() {
  dummyConfiguration.setCurrent()

  return new BackgroundJobsStore({configuration: dummyConfiguration})
}

/**
 * @param {BackgroundJobsStore} store - Store.
 * @param {string} jobId - Job id.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow>} - Job.
 */
async function getJobOrFail(store, jobId) {
  const job = await store.getJob(jobId)

  if (!job) throw new Error(`Expected background job to exist: ${jobId}`)

  return job
}

describe("Background jobs - stable schedule store", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  beforeEach(async () => {
    await createStore().clearAll()
  })

  afterEach(async () => {
    await createStore().clearAll()
  })

  it("locks the durable count revision before a mutation reads job state", async () => {
    const calls = []

    class LockOrderStore extends BackgroundJobsStore {
      async _lockCountRevision() {
        calls.push("lock")
      }

      async _transactionResult(_db, callback) {
        return await callback()
      }
    }

    const store = new LockOrderStore({configuration: dummyConfiguration})

    await store._serializedCountMutation(async () => {
      calls.push("read")
    })

    expect(calls).toEqual(["lock", "read"])
  })

  it("creates durable stable schedule ownership schema", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})

    await store.ensureReady()

    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs stable schedule schema"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")
      const scheduleKeyColumn = await jobsTable.getColumnByName("schedule_key")
      const scheduleKeysTable = await db.getTableByName("background_job_schedule_keys")

      expect(scheduleKeyColumn?.getName()).toEqual("schedule_key")
      expect(scheduleKeysTable?.getName()).toEqual("background_job_schedule_keys")
    })
  })

  it("idempotently upgrades an existing background jobs schema", async () => {
    dummyConfiguration.setCurrent()
    const store = new BackgroundJobsStore({configuration: dummyConfiguration})

    await store.ensureReady()

    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs remove stable schedule schema"}, async (db) => {
      await db.dropTable("background_job_schedule_keys", {cascade: true, ifExists: true})
      const jobsTable = await db.getTableByNameOrFail("background_jobs")

      for (const index of await jobsTable.getIndexes()) {
        if (!index.getColumnNames().some((columnName) => ["schedule_key", "schedule_order"].includes(columnName))) continue

        for (const sql of await db.removeIndexSQLs({name: index.getName(), tableName: "background_jobs"})) {
          await db.query(sql)
        }
      }

      const tableData = new TableData("background_jobs")

      if (await jobsTable.getColumnByName("schedule_key")) tableData.addColumn("schedule_key", {dropColumn: true})
      if (await jobsTable.getColumnByName("schedule_order")) tableData.addColumn("schedule_order", {dropColumn: true})
      for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)
      db.clearSchemaCache()
    })

    await store.ensureReady()
    await store.ensureReady()

    await pool.withConnection({name: "Background jobs inspect upgraded stable schedule schema"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")
      const indexNames = (await jobsTable.getIndexes()).map((index) => index.getName())

      expect((await jobsTable.getColumnByName("schedule_key"))?.getName()).toEqual("schedule_key")
      expect((await jobsTable.getColumnByName("schedule_order"))?.getName()).toEqual("schedule_order")
      expect(indexNames).toContain("index_background_jobs_schedule_history_order")
      expect((await db.getTableByName("background_job_schedule_keys"))?.getName()).toEqual("background_job_schedule_keys")
    })
  })

  it("backfills durable schedule-order watermarks without losing v3 jobs or owners", async () => {
    const store = createStore()
    const ownedFirst = await store.replaceScheduled({scheduleKey: "migration:owned", jobName: "EventReminderJob", args: ["owned-first"]})
    const ownedSecond = await store.replaceScheduled({scheduleKey: "migration:owned", jobName: "EventReminderJob", args: ["owned-second"]})
    const terminalFirst = await store.replaceScheduled({scheduleKey: "migration:terminal", jobName: "EventReminderJob", args: ["terminal-first"]})
    const terminalSecond = await store.replaceScheduled({scheduleKey: "migration:terminal", jobName: "EventReminderJob", args: ["terminal-second"]})
    const legacy = await store.replaceScheduled({scheduleKey: "migration:legacy", jobName: "EventReminderJob", args: ["legacy"]})

    await store.cancelScheduled("migration:terminal")
    await store.cancelScheduled("migration:legacy")

    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

    await pool.withConnection({name: "Prepare pre-watermark stable schedule schema"}, async (db) => {
      await db.update({
        conditions: {id: legacy.jobId},
        data: {schedule_order: null},
        tableName: "background_jobs"
      })
      await db.dropTable("background_job_schedule_order_watermarks", {cascade: true, ifExists: true})
      await db.delete({
        conditions: {key: SCHEDULE_ORDER_WATERMARK_MIGRATION_KEY},
        tableName: "velocious_internal_migrations"
      })
      db.clearSchemaCache()
    })

    const upgradedStore = new BackgroundJobsStore({configuration: dummyConfiguration})

    await upgradedStore.ensureReady()

    expect(await getJobOrFail(upgradedStore, ownedFirst.jobId)).toMatchObject({scheduleOrder: 1, status: "cancelled"})
    expect(await getJobOrFail(upgradedStore, ownedSecond.jobId)).toMatchObject({scheduleOrder: 2, status: "queued"})
    expect(await getJobOrFail(upgradedStore, terminalFirst.jobId)).toMatchObject({scheduleOrder: 1, status: "cancelled"})
    expect(await getJobOrFail(upgradedStore, terminalSecond.jobId)).toMatchObject({scheduleOrder: 2, status: "cancelled"})
    expect(await getJobOrFail(upgradedStore, legacy.jobId)).toMatchObject({scheduleOrder: null, status: "cancelled"})

    await pool.withConnection({name: "Inspect backfilled schedule-order watermarks"}, async (db) => {
      const table = await db.getTableByNameOrFail("background_job_schedule_order_watermarks")
      const ownerRows = await db
        .newQuery()
        .from("background_job_schedule_keys")
        .where({schedule_key: "migration:owned"})
        .results()
      const watermarkRows = await db
        .newQuery()
        .from("background_job_schedule_order_watermarks")
        .order("schedule_key")
        .results()
      const watermarkKeys = watermarkRows.map((row) => String(row.schedule_key))

      expect((await table.getColumnByName("schedule_key"))?.getPrimaryKey()).toEqual(true)
      expect(ownerRows).toMatchObject([{job_id: ownedSecond.jobId}])
      expect(watermarkKeys).toEqual(["migration:owned", "migration:terminal"])
      expect(await upgradedStore._scheduleOrderWatermark(db, "migration:owned")).toEqual(2)
      expect(await upgradedStore._scheduleOrderWatermark(db, "migration:terminal")).toEqual(2)
    })

    const legacyReplacement = await upgradedStore.replaceScheduled({
      scheduleKey: "migration:legacy",
      jobName: "EventReminderJob",
      args: ["legacy-replacement"]
    })

    expect(await getJobOrFail(upgradedStore, legacyReplacement.jobId)).toMatchObject({scheduleOrder: 1, status: "queued"})
  })

  it("atomically replaces the queued owner while retaining keyed history", async () => {
    const store = createStore()
    const first = await store.replaceScheduled({
      scheduleKey: "event:42:reminder:24h",
      jobName: "EventReminderJob",
      args: [42, 1],
      options: {scheduledAtMs: Date.now() + 60_000}
    })
    const second = await store.replaceScheduled({
      scheduleKey: "event:42:reminder:24h",
      jobName: "EventReminderJob",
      args: [42, 2],
      options: {scheduledAtMs: Date.now() + 120_000}
    })

    expect(first).toEqual({jobId: first.jobId, previousJobId: null, previousStatus: null})
    expect(second).toEqual({jobId: second.jobId, previousJobId: first.jobId, previousStatus: "queued"})
    expect(await getJobOrFail(store, first.jobId)).toMatchObject({
      scheduleKey: "event:42:reminder:24h",
      status: "cancelled"
    })
    expect(await getJobOrFail(store, second.jobId)).toMatchObject({
      args: [42, 2],
      scheduleKey: "event:42:reminder:24h",
      status: "queued"
    })

    const ownerRows = await store._withDb(async (db) =>
      await db.newQuery().from("background_job_schedule_keys").where({schedule_key: "event:42:reminder:24h"}).results()
    )

    expect(ownerRows).toMatchObject([{job_id: second.jobId}])
  })

  it("cancels the queued owner and preserves its keyed history", async () => {
    const store = createStore()
    const replacement = await store.replaceScheduled({
      scheduleKey: "event:43:reminder:24h",
      jobName: "EventReminderJob",
      args: [43, 1],
      options: {scheduledAtMs: Date.now() + 60_000}
    })

    expect(await store.cancelScheduled("event:43:reminder:24h")).toEqual({
      jobId: replacement.jobId,
      outcome: "cancelled"
    })
    expect(await getJobOrFail(store, replacement.jobId)).toMatchObject({
      scheduleKey: "event:43:reminder:24h",
      status: "cancelled"
    })
    expect(await store.cancelScheduled("event:43:reminder:24h")).toEqual({jobId: null, outcome: "not_found"})
  })

  it("reads the current owner and latest normalized terminal history", async () => {
    let nowMs = 1_000
    const store = new BackgroundJobsStore({configuration: dummyConfiguration, clock: {now: () => nowMs}})
    const first = await store.replaceScheduled({
      scheduleKey: "event:readback",
      jobName: "EventReminderJob",
      args: ["first"],
      options: {scheduledAtMs: 60_000}
    })

    nowMs += 1
    const second = await store.replaceScheduled({
      scheduleKey: "event:readback",
      jobName: "EventReminderJob",
      args: ["second"],
      options: {scheduledAtMs: 120_000}
    })
    const scheduled = await store.getScheduledJob("event:readback", {includeLatestTerminal: true})

    expect(scheduled.currentJob).toMatchObject({args: ["second"], id: second.jobId, scheduleKey: "event:readback", status: "queued"})
    expect(scheduled.latestTerminalJob).toMatchObject({args: ["first"], id: first.jobId, scheduleKey: "event:readback", status: "cancelled"})

    expect(await store.cancelScheduled("event:readback")).toEqual({jobId: second.jobId, outcome: "cancelled"})
    expect(await store.getScheduledJob("event:readback", {includeLatestTerminal: true})).toMatchObject({
      currentJob: null,
      latestTerminalJob: {args: ["second"], id: second.jobId, scheduleKey: "event:readback", status: "cancelled"}
    })
  })

  it("orders terminal history by ownership acquired after reversed fixed-clock preparation", async () => {
    const delayedPrepared = Promise.withResolvers()
    const delayedCanAcquire = Promise.withResolvers()

    class OrderedScheduleStore extends BackgroundJobsStore {
      pauseNextScheduleMutation = false

      _prepareJob(args) {
        const preparedJob = super._prepareJob(args)
        const identity = args.args[0]

        return {...preparedJob, jobId: identity === "later-owner" ? "a-later-owner" : "z-earlier-owner"}
      }

      async _serializedCountMutation(callback, options = {}) {
        if (this.pauseNextScheduleMutation && options.advisoryLock) {
          this.pauseNextScheduleMutation = false
          delayedPrepared.resolve()
          await delayedCanAcquire.promise
        }

        return await super._serializedCountMutation(callback, options)
      }
    }

    const clock = {now: () => 1_000}
    const delayedStore = new OrderedScheduleStore({configuration: dummyConfiguration, clock})
    const competingStore = new OrderedScheduleStore({configuration: dummyConfiguration, clock})

    delayedStore.pauseNextScheduleMutation = true

    const laterOwnerPromise = delayedStore.replaceScheduled({
      scheduleKey: "event:ownership-order",
      jobName: "EventReminderJob",
      args: ["later-owner"]
    })

    await delayedPrepared.promise

    const earlierOwner = await competingStore.replaceScheduled({
      scheduleKey: "event:ownership-order",
      jobName: "EventReminderJob",
      args: ["earlier-owner"]
    })

    delayedCanAcquire.resolve()
    const laterOwner = await laterOwnerPromise

    expect(await delayedStore.cancelScheduled("event:ownership-order")).toEqual({jobId: laterOwner.jobId, outcome: "cancelled"})

    const lookup = await delayedStore.getScheduledJob("event:ownership-order", {includeLatestTerminal: true})

    expect(lookup.latestTerminalJob).toMatchObject({args: ["later-owner"], id: laterOwner.jobId, scheduleOrder: 2})
    expect(await delayedStore.getJob(earlierOwner.jobId)).toMatchObject({scheduleOrder: 1, status: "cancelled"})
  })

  it("keeps schedule ownership order monotonic after real terminal retention pruning", async () => {
    const retentionMs = 7 * 24 * 60 * 60 * 1000
    let nowMs = 1_000
    const store = new BackgroundJobsStore({configuration: dummyConfiguration, clock: {now: () => nowMs}})
    const first = await store.replaceScheduled({
      scheduleKey: "event:retained-watermark",
      jobName: "EventReminderJob",
      args: ["first"]
    })
    const firstJob = await getJobOrFail(store, first.jobId)
    const firstOrder = firstJob.scheduleOrder
    const handoff = await store.markHandedOff({jobId: first.jobId, workerId: "retention-worker"})

    if (firstOrder === null) throw new Error("Expected retained-watermark schedule order")
    if (!handoff) throw new Error("Expected retained-watermark handoff")

    expect(await store.markCompleted({jobId: first.jobId, workerId: "retention-worker", ...handoff})).toEqual(true)

    nowMs += retentionMs + 1

    expect(await store.pruneTerminalJobs({batchSize: 100, completedTtlMs: retentionMs})).toEqual(1)
    expect(await store.getJob(first.jobId)).toEqual(null)

    const watermarkAfterPrune = await store._withDb(async (db) =>
      await store._scheduleOrderWatermark(db, "event:retained-watermark")
    )

    expect(watermarkAfterPrune).toEqual(firstOrder)

    const second = await store.replaceScheduled({
      scheduleKey: "event:retained-watermark",
      jobName: "EventReminderJob",
      args: ["second"]
    })
    const secondJob = await getJobOrFail(store, second.jobId)

    expect(secondJob.scheduleOrder).toBeGreaterThan(firstOrder)
  })

  it("wakes only a future queued owner while preserving retry lineage", async () => {
    let nowMs = 1_000
    const store = new BackgroundJobsStore({configuration: dummyConfiguration, clock: {now: () => nowMs}})
    const replacement = await store.replaceScheduled({
      scheduleKey: "event:retry-wake",
      jobName: "EventReminderJob",
      args: ["retry"],
      options: {maxRetries: 1}
    })
    const handoff = await store.markHandedOff({jobId: replacement.jobId, workerId: "wake-worker"})

    if (!handoff) throw new Error("Expected stable retry handoff")

    nowMs += 1_000
    expect(await store.markFailed({jobId: replacement.jobId, error: "planned retry", workerId: "wake-worker", ...handoff})).toMatchObject({
      attempts: 1,
      id: replacement.jobId,
      lastError: "planned retry",
      scheduledAtMs: nowMs + 10_000,
      status: "queued"
    })
    expect(await store.wakeScheduled("event:retry-wake")).toEqual({jobId: replacement.jobId, outcome: "woken"})
    expect(await store.getJob(replacement.jobId)).toMatchObject({
      args: ["retry"],
      attempts: 1,
      id: replacement.jobId,
      lastError: "planned retry",
      scheduleKey: "event:retry-wake",
      scheduledAtMs: nowMs,
      status: "queued"
    })
    expect(await store.wakeScheduled("event:retry-wake")).toEqual({jobId: replacement.jobId, outcome: "already_due"})

    const secondHandoff = await store.markHandedOff({jobId: replacement.jobId, workerId: "wake-worker-2"})

    if (!secondHandoff) throw new Error("Expected woken stable retry handoff")

    expect(await store.wakeScheduled("event:retry-wake")).toEqual({jobId: replacement.jobId, outcome: "handed_off"})
    expect(await store.markCompleted({jobId: replacement.jobId, workerId: "wake-worker-2", ...secondHandoff})).toEqual(true)
    expect(await store.wakeScheduled("event:retry-wake")).toEqual({jobId: null, outcome: "not_found"})

    const rows = await store.listJobs({jobName: "EventReminderJob", limit: 100})

    expect(rows.filter((job) => job.scheduleKey === "event:retry-wake").map((job) => job.id)).toEqual([replacement.jobId])
  })

  it("reports handed-off replacement without claiming the running job stopped", async () => {
    const store = createStore()
    const first = await store.replaceScheduled({
      scheduleKey: "event:44:reminder:24h",
      jobName: "EventReminderJob",
      args: [44, 1]
    })

    const firstHandoff = await store.markHandedOff({jobId: first.jobId, workerId: "worker-1"})

    if (!firstHandoff) throw new Error("Expected replaced job handoff")

    const second = await store.replaceScheduled({
      scheduleKey: "event:44:reminder:24h",
      jobName: "EventReminderJob",
      args: [44, 2]
    })

    expect(second).toEqual({jobId: second.jobId, previousJobId: first.jobId, previousStatus: "handed_off"})
    expect(await getJobOrFail(store, first.jobId)).toMatchObject({status: "handed_off"})
    expect(await getJobOrFail(store, second.jobId)).toMatchObject({status: "queued"})

    expect(await store.markFailed({jobId: first.jobId, error: "retry", workerId: "worker-1", ...firstHandoff})).toMatchObject({status: "queued"})

    const ownerAfterSupersededRetry = await store._withDb(async (db) =>
      await db.newQuery().from("background_job_schedule_keys").where({schedule_key: "event:44:reminder:24h"}).results()
    )

    expect(ownerAfterSupersededRetry).toMatchObject([{job_id: second.jobId}])
  })

  it("detaches a handed-off owner without claiming execution stopped", async () => {
    const store = createStore()
    const replacement = await store.replaceScheduled({
      scheduleKey: "event:45:reminder:24h",
      jobName: "EventReminderJob",
      args: [45]
    })

    expect(await store.markHandedOff({jobId: replacement.jobId, workerId: "worker-1"})).not.toBeNull()
    expect(await store.cancelScheduled("event:45:reminder:24h")).toEqual({
      jobId: replacement.jobId,
      outcome: "handed_off"
    })
    expect(await getJobOrFail(store, replacement.jobId)).toMatchObject({status: "handed_off"})
  })

  it("conditionally releases ownership when jobs become terminal", async () => {
    const store = createStore()
    const first = await store.replaceScheduled({
      scheduleKey: "event:46:reminder:24h",
      jobName: "EventReminderJob",
      args: [46, 1]
    })
    const firstHandoff = await store.markHandedOff({jobId: first.jobId, workerId: "worker-1"})

    if (!firstHandoff) throw new Error("Expected first handoff")

    const second = await store.replaceScheduled({
      scheduleKey: "event:46:reminder:24h",
      jobName: "EventReminderJob",
      args: [46, 2]
    })

    expect(await store.markCompleted({jobId: first.jobId, workerId: "worker-1", ...firstHandoff})).toEqual(true)

    const ownerAfterOldCompletion = await store._withDb(async (db) =>
      await db.newQuery().from("background_job_schedule_keys").where({schedule_key: "event:46:reminder:24h"}).results()
    )

    expect(ownerAfterOldCompletion).toMatchObject([{job_id: second.jobId}])

    const secondHandoff = await store.markHandedOff({jobId: second.jobId, workerId: "worker-2"})

    if (!secondHandoff) throw new Error("Expected second handoff")

    expect(await store.markCompleted({jobId: second.jobId, workerId: "worker-2", ...secondHandoff})).toEqual(true)
    const ownerAfterCurrentCompletion = await store._withDb(async (db) =>
      await db.newQuery().from("background_job_schedule_keys").where({schedule_key: "event:46:reminder:24h"}).results()
    )

    expect(ownerAfterCurrentCompletion).toEqual([])
    expect(await store.cancelScheduled("event:46:reminder:24h")).toEqual({jobId: null, outcome: "not_found"})
    expect(await getJobOrFail(store, second.jobId)).toMatchObject({
      scheduleKey: "event:46:reminder:24h",
      status: "completed"
    })
  })

  it("retains ownership for retries and releases it after terminal failure", async () => {
    const store = createStore()
    const replacement = await store.replaceScheduled({
      scheduleKey: "event:48:reminder:24h",
      jobName: "EventReminderJob",
      args: [48],
      options: {maxRetries: 1}
    })
    const firstHandoff = await store.markHandedOff({jobId: replacement.jobId, workerId: "worker-1"})

    if (!firstHandoff) throw new Error("Expected first failure handoff")

    expect(await store.markFailed({jobId: replacement.jobId, error: "retry", workerId: "worker-1", ...firstHandoff})).toMatchObject({status: "queued"})

    const ownerDuringRetry = await store._withDb(async (db) =>
      await db.newQuery().from("background_job_schedule_keys").where({schedule_key: "event:48:reminder:24h"}).results()
    )

    expect(ownerDuringRetry).toMatchObject([{job_id: replacement.jobId}])

    const secondHandoff = await store.markHandedOff({jobId: replacement.jobId, workerId: "worker-2"})

    if (!secondHandoff) throw new Error("Expected terminal failure handoff")

    expect(await store.markFailed({jobId: replacement.jobId, error: "terminal", workerId: "worker-2", ...secondHandoff})).toMatchObject({
      scheduleKey: "event:48:reminder:24h",
      status: "failed"
    })

    const ownerAfterFailure = await store._withDb(async (db) =>
      await db.newQuery().from("background_job_schedule_keys").where({schedule_key: "event:48:reminder:24h"}).results()
    )

    expect(ownerAfterFailure).toEqual([])
  })

  it("serializes concurrent replacements and persists ownership across store restarts", async () => {
    const firstStore = createStore()
    const secondStore = new BackgroundJobsStore({configuration: dummyConfiguration})
    const scheduleKey = "event:47:reminder:24h"
    const replacements = await Promise.all([
      firstStore.replaceScheduled({scheduleKey, jobName: "EventReminderJob", args: [47, 1]}),
      secondStore.replaceScheduled({scheduleKey, jobName: "EventReminderJob", args: [47, 2]})
    ])
    const jobs = await Promise.all(replacements.map(({jobId}) => getJobOrFail(firstStore, jobId)))

    expect(jobs.map((job) => job.status).sort()).toEqual(["cancelled", "queued"])

    const queuedJob = jobs.find((job) => job.status === "queued")

    if (!queuedJob) throw new Error("Expected one queued replacement")

    expect(await secondStore.cancelScheduled(scheduleKey)).toEqual({jobId: queuedJob.id, outcome: "cancelled"})
  })

  it("rejects invalid stable schedule keys as client-safe errors", async () => {
    const store = createStore()

    await expect(async () => await store.replaceScheduled({scheduleKey: "", jobName: "TestJob", args: []})).toThrow(/non-empty string/)
    await expect(async () => await store.cancelScheduled("x".repeat(256))).toThrow(/at most 255/)
  })
})
