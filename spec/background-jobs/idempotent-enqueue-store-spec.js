// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/** @returns {BackgroundJobsStore} - Cleared background jobs store. */
async function createStore() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})

  await store.clearAll()
  return store
}

/**
 * Hands off one job or fails the spec.
 * @param {BackgroundJobsStore} store - Owning store.
 * @param {string} jobId - Job id.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobHandoff>} - Handoff.
 */
async function handOff(store, jobId) {
  const handoff = await store.markHandedOff({jobId, workerId: "idempotent-enqueue-spec"})

  if (!handoff) throw new Error(`Expected background job handoff: ${jobId}`)
  return handoff
}

describe("Background jobs - idempotent enqueue store", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  /** @type {BackgroundJobsStore | null} */
  let store = null

  beforeEach(async () => {
    store = await createStore()
  })

  afterEach(async () => {
    await store?.clearAll()
  })

  it("converges concurrent identical enqueues through durable ownership", async () => {
    if (!store) throw new Error("Expected store")
    const request = {
      args: [{projectId: 42, taskId: 7}],
      jobName: "IdempotentTestJob",
      options: {executionMode: "inline", idempotencyKey: "task-mail:42:7", maxRetries: 3}
    }
    const jobIds = await Promise.all(Array.from({length: 8}, async () => await store.enqueue(request)))

    expect(new Set(jobIds).size).toEqual(1)
    expect(await store.countJobs({jobName: "IdempotentTestJob"})).toEqual(1)
  })

  it("returns the original id in every state and after terminal pruning", async () => {
    if (!store) throw new Error("Expected store")

    const replay = async (key, args = [key]) => {
      const request = {args, jobName: "IdempotentStateJob", options: {executionMode: "inline", idempotencyKey: key, maxRetries: 0}}
      const jobId = await store.enqueue(request)

      expect(await store.enqueue(request)).toEqual(jobId)
      return {jobId, request}
    }

    const queued = await replay("state:queued")

    expect((await store.getJob(queued.jobId))?.status).toEqual("queued")

    const handedOff = await replay("state:handed-off")
    await handOff(store, handedOff.jobId)
    expect(await store.enqueue(handedOff.request)).toEqual(handedOff.jobId)

    const completed = await replay("state:completed")
    const completedHandoff = await handOff(store, completed.jobId)
    await store.markCompleted({jobId: completed.jobId, workerId: "idempotent-enqueue-spec", ...completedHandoff})
    expect(await store.enqueue(completed.request)).toEqual(completed.jobId)

    const failed = await replay("state:failed")
    const failedHandoff = await handOff(store, failed.jobId)
    await store.markFailed({jobId: failed.jobId, error: "expected failure", workerId: "idempotent-enqueue-spec", ...failedHandoff})
    expect(await store.enqueue(failed.request)).toEqual(failed.jobId)

    const cancelled = await replay("state:cancelled")
    await store.cancel(cancelled.jobId)
    expect(await store.enqueue(cancelled.request)).toEqual(cancelled.jobId)

    const orphaned = await replay("state:orphaned")
    await handOff(store, orphaned.jobId)
    await store.markOrphanedJobs({orphanedAfterMs: 0})
    expect(await store.enqueue(orphaned.request)).toEqual(orphaned.jobId)

    await store._withDb(async (db) => {
      await db.update({tableName: "background_jobs", data: {completed_at_ms: 1}, conditions: {id: completed.jobId}})
    })
    await store.pruneTerminalJobs({batchSize: 10, completedTtlMs: 1})

    expect(await store.getJob(completed.jobId)).toEqual(null)
    expect(await store.enqueue(completed.request)).toEqual(completed.jobId)
    expect(await store.getJob(completed.jobId)).toEqual(null)
  })

  it("rejects key reuse when canonical arguments or behavior options change", async () => {
    if (!store) throw new Error("Expected store")
    const base = {
      args: [{accountId: 9, event: "created"}],
      jobName: "IdempotentConflictJob",
      options: {concurrencyKey: "account:9", executionMode: "inline", idempotencyKey: "event:9", maxConcurrency: 1, maxRetries: 2}
    }

    await store.enqueue(base)

    await expect(async () => await store.enqueue({...base, args: [{accountId: 9, event: "updated"}]}))
      .toThrow(/idempotency key.*different/i)
    await expect(async () => await store.enqueue({...base, options: {...base.options, maxRetries: 3}}))
      .toThrow(/idempotency key.*different/i)
    await expect(async () => await store.enqueue({...base, options: {...base.options, maxConcurrency: 2}}))
      .toThrow(/idempotency key.*different/i)
  })

  it("creates and restores durable ownership schema", async () => {
    if (!store) throw new Error("Expected store")

    await store._withDb(async (db) => {
      expect((await db.getTableByName("background_job_idempotency_keys"))?.getName()).toEqual("background_job_idempotency_keys")
      expect((await db.getTableByName("mailer_delivery_operations"))?.getName()).toEqual("mailer_delivery_operations")
      await db.dropTable("background_job_idempotency_keys", {cascade: true, ifExists: true})
      await db.dropTable("mailer_delivery_operations", {cascade: true, ifExists: true})
      db.clearSchemaCache()
    })

    await store.ensureReady()

    await store._withDb(async (db) => {
      expect((await db.getTableByName("background_job_idempotency_keys"))?.getName()).toEqual("background_job_idempotency_keys")
      expect((await db.getTableByName("mailer_delivery_operations"))?.getName()).toEqual("mailer_delivery_operations")
    })
  })

  it("keeps ordinary enqueue and queued-only deduplication distinct", async () => {
    if (!store) throw new Error("Expected store")

    const ordinaryFirst = await store.enqueue({args: [1], jobName: "OrdinaryJob"})
    const ordinarySecond = await store.enqueue({args: [1], jobName: "OrdinaryJob"})
    const deduplicatedFirst = await store.enqueue({args: [2], jobName: "OrdinaryJob", options: {deduplicateWhileQueued: true}})
    const deduplicatedSecond = await store.enqueue({args: [2], jobName: "OrdinaryJob", options: {deduplicateWhileQueued: true}})

    expect(ordinarySecond).not.toEqual(ordinaryFirst)
    expect(deduplicatedSecond).toEqual(deduplicatedFirst)
  })

  it("clears durable idempotency ownership with the test reset", async () => {
    if (!store) throw new Error("Expected store")
    const request = {
      args: ["reset"],
      jobName: "IdempotentResetJob",
      options: {idempotencyKey: "reset:1"}
    }
    const firstJobId = await store.enqueue(request)

    await store.clearAll()

    const secondJobId = await store.enqueue(request)

    expect(secondJobId).not.toEqual(firstJobId)
    expect(await store.countJobs({jobName: "IdempotentResetJob"})).toEqual(1)
  })
})
