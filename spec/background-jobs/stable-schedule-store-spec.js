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
 * @param {BackgroundJobsStore} store - Store.
 * @param {string} jobId - Job id.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow>} - Job.
 */
async function getJobOrFail(store, jobId) {
  const job = await store.getJob(jobId)

  if (!job) throw new Error(`Expected background job to exist: ${jobId}`)

  return job
}

describe("Background jobs - stable schedule store", {databaseCleaning: {truncate: true}}, () => {
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

    await store._serializedCountMutation(/** @type {import("../../src/database/drivers/base.js").default} */ ({}), async () => {
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
      const tableData = new TableData("background_jobs")

      tableData.addColumn("schedule_key", {dropColumn: true})
      for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)
      db.clearSchemaCache()
    })

    await store.ensureReady()
    await store.ensureReady()

    await pool.withConnection({name: "Background jobs inspect upgraded stable schedule schema"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")

      expect((await jobsTable.getColumnByName("schedule_key"))?.getName()).toEqual("schedule_key")
      expect((await db.getTableByName("background_job_schedule_keys"))?.getName()).toEqual("background_job_schedule_keys")
    })
  })

  it("atomically replaces the queued owner while retaining keyed history", async () => {
    const store = await createClearedStore()
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
    const store = await createClearedStore()
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

  it("reports handed-off replacement without claiming the running job stopped", async () => {
    const store = await createClearedStore()
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
    const store = await createClearedStore()
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
    const store = await createClearedStore()
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
    const store = await createClearedStore()
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
    const firstStore = await createClearedStore()
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
    const store = await createClearedStore()

    await expect(async () => await store.replaceScheduled({scheduleKey: "", jobName: "TestJob", args: []})).toThrow(/non-empty string/)
    await expect(async () => await store.cancelScheduled("x".repeat(256))).toThrow(/at most 255/)
  })
})
