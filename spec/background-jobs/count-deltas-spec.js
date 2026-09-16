// @ts-check

import timeout from "awaitery/build/timeout.js"
import BackgroundJobsStore, {BACKGROUND_JOB_COUNTS_CHANNEL} from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {afterEach, describe, expect, it} from "../../src/testing/test.js"

/** @type {Set<import("../../src/http-server/websocket-channel.js").default>} */
const registeredSubscriptions = new Set()

/**
 * Builds one process-like store over shared prune state. Each store has its own
 * connection and bypasses the real process-local SQLite transaction serializer,
 * matching two workers in separate processes.
 * @param {object} args - Options.
 * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} args.events - Recorded deltas.
 * @param {Set<string>} args.ids - Shared persisted job ids.
 * @param {{value: number}} args.revision - Shared durable revision.
 * @param {() => Promise<void>} args.selectBarrier - Waits until both stores selected.
 * @returns {BackgroundJobsStore} Store.
 */
function buildConcurrentPruneStore({events, ids, revision, selectBarrier}) {
  let limit = Number.MAX_SAFE_INTEGER
  const query = {
    from: () => query,
    limit: (/** @type {number} */ value) => {
      limit = value
      return query
    },
    order: () => query,
    select: () => query,
    where: () => query,
    results: async () => {
      // Capture the page before yielding to the barrier so a concurrent actor
      // can make the captured candidates stale between selection and deletion.
      const selected = Array.from(ids).slice(0, limit).map((id) => ({id}))

      await selectBarrier()
      return selected
    }
  }
  const db = /** @type {import("../../src/database/drivers/base.js").default} */ ({
    affectedRows: async (/** @type {string} */ sql) => {
      const deleted = [...ids].filter((id) => sql.includes(`'${id}'`))

      for (const id of deleted) ids.delete(id)

      return deleted.length
    },
    newQuery: () => query,
    query: async () => {
      ids.clear()
      return []
    },
    quote: (/** @type {string} */ value) => `'${value}'`,
    quoteColumn: (/** @type {string} */ value) => value,
    quoteTable: (/** @type {string} */ value) => value
  })

  return new class extends BackgroundJobsStore {
    constructor() {
      super({configuration: dummyConfiguration})
    }

    /** Skips schema setup for the scripted cross-process race. @returns {Promise<void>} Resolves immediately. */
    async ensureReady() {}

    /** @param {Function} callback - Database callback. @returns {Promise<ReturnType<typeof JSON.parse>>} Callback result. */
    async _withDb(callback) {
      return await callback(db)
    }

    /** @param {(db: import("../../src/database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>} callback - Transaction callback. @returns {Promise<ReturnType<typeof JSON.parse>>} Callback result. */
    async _serializedCountMutation(callback) {
      return await callback(db)
    }

    /** @param {ReturnType<typeof JSON.parse>} _db - Database. @param {Record<string, number>} deltas - Deltas. @returns {Promise<void>} Resolves after recording. */
    async _recordCountDelta(_db, deltas) {
      if (Object.values(deltas).some((value) => value !== 0)) {
        revision.value += 1
        events.push({deltas, revision: revision.value})
      }
    }
  }()
}

/**
 * @returns {Promise<{events: Array<Record<string, ReturnType<typeof JSON.parse>>>, revision: number, store: BackgroundJobsStore}>} Empty store and captured count events.
 */
async function setupStore() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})

  await store.clearAll()
  const {revision} = await store.countSnapshot()

  /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
  const events = []
  const subscription = /** @type {import("../../src/http-server/websocket-channel.js").default} */ ({
    deliverBroadcast: (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ body) => events.push(body),
    isClosed: () => false,
    matches: () => true,
    subscriptionId: "count-deltas-spec"
  })

  dummyConfiguration._registerWebsocketChannelSubscription(BACKGROUND_JOB_COUNTS_CHANNEL, subscription)
  registeredSubscriptions.add(subscription)

  return {events, revision, store}
}

describe("Background jobs - count deltas", {databaseCleaning: {truncate: true}}, () => {
  afterEach(() => {
    for (const subscription of registeredSubscriptions) {
      dummyConfiguration._unregisterWebsocketChannelSubscription(BACKGROUND_JOB_COUNTS_CHANNEL, subscription)
    }

    registeredSubscriptions.clear()
  })

  it("returns a canonical snapshot with a durable revision", async () => {
    const {revision, store} = await setupStore()

    await store.enqueue({args: [], jobName: "TestJob"})
    const snapshot = await store.countSnapshot()

    expect(snapshot.counts).toEqual({
      all: 1,
      completed: 0,
      failed: 0,
      handed_off: 0,
      orphaned: 0,
      queued: 1
    })
    expect(snapshot.revision).toEqual(revision + 1)
  })

  it("publishes one committed revision per logical transition with signed deltas", async () => {
    const {events, revision, store} = await setupStore()
    const jobId = await store.enqueue({args: [], jobName: "TestJob"})
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected handoff")

    await store.markCompleted({jobId, workerId: "worker-1", ...handoff})
    await new Promise((resolve) => setImmediate(resolve))

    expect(events).toEqual([
      {deltas: {all: 1, queued: 1}, revision: revision + 1, type: "background-job-count-delta"},
      {deltas: {queued: -1, handed_off: 1}, revision: revision + 2, type: "background-job-count-delta"},
      {deltas: {handed_off: -1, completed: 1}, revision: revision + 3, type: "background-job-count-delta"}
    ])
  })

  it("aggregates pruning into one event per deleted status batch", async () => {
    const {events, store} = await setupStore()
    const ids = []

    for (let index = 0; index < 2; index++) {
      const jobId = await store.enqueue({args: [index], jobName: "TestJob"})
      const handoff = await store.markHandedOff({jobId, workerId: `worker-${index}`})

      if (!handoff) throw new Error("Expected handoff")
      await store.markCompleted({jobId, workerId: `worker-${index}`, ...handoff})
      ids.push(jobId)
    }

    const {revision} = await store.countSnapshot()
    events.length = 0
    await store.pruneTerminalJobs({batchSize: 10, completedTtlMs: 1})
    await new Promise((resolve) => setImmediate(resolve))

    expect(events).toEqual([
      {deltas: {all: -2, completed: -2}, revision: revision + 1, type: "background-job-count-delta"}
    ])
  })

  it("does not advance or publish a rolled-back delta", async () => {
    const {events, revision, store} = await setupStore()

    await expect(async () => {
      await store._withDb(async (db) => {
        await db.transaction(async () => {
          await store._recordCountDelta(db, {all: 1, queued: 1})
          throw new Error("roll back")
        })
      })
    }).toThrow(/roll back/)

    expect(events).toEqual([])
    expect((await store.countSnapshot()).revision).toEqual(revision)
  })

  it("subtracts concurrently pruned rows only once across independent stores", async () => {
    const ids = new Set(["completed-1", "completed-2"])
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const events = []
    const revision = {value: 0}
    let selectedCount = 0
    let releaseSelections = () => {}
    const selectionsReady = new Promise((resolve) => {
      releaseSelections = resolve
    })
    const selectBarrier = async () => {
      selectedCount += 1
      if (selectedCount === 2) releaseSelections()
      await selectionsReady
    }
    const firstStore = buildConcurrentPruneStore({events, ids, revision, selectBarrier})
    const secondStore = buildConcurrentPruneStore({events, ids, revision, selectBarrier})

    const deleted = await Promise.all([
      firstStore.pruneTerminalJobs({batchSize: 10, completedTtlMs: 1}),
      secondStore.pruneTerminalJobs({batchSize: 10, completedTtlMs: 1})
    ])

    expect(deleted.reduce((sum, value) => sum + value, 0)).toEqual(2)
    expect(events).toEqual([{deltas: {all: -2, completed: -2}, revision: 1}])
    expect(revision.value).toEqual(1)
  })

  it("continues the pass after a concurrent actor steals part of a candidate page", async () => {
    const ids = new Set(["job-1", "job-2", "job-3", "job-4"])
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const events = []
    const revision = {value: 0}

    let releaseDelete = () => {}
    const deleteGate = new Promise((resolve) => {
      releaseDelete = resolve
    })
    let releaseSelection = () => {}
    const selected = new Promise((resolve) => {
      releaseSelection = resolve
    })
    let selectCalls = 0
    const selectBarrier = async () => {
      selectCalls += 1
      if (selectCalls > 1) return

      releaseSelection()
      await deleteGate
    }

    const store = buildConcurrentPruneStore({events, ids, revision, selectBarrier})

    const prune = store.pruneTerminalJobs({batchSize: 2, completedTtlMs: 1})
    await timeout({errorMessage: "Retention candidate selection did not complete", timeout: 5000}, () => selected)

    // A concurrent actor deletes one of the two selected candidates before this
    // pruner's delete transaction runs.
    ids.delete("job-1")
    releaseDelete()

    const deleted = await prune

    expect(deleted).toEqual(3)
    expect(ids.size).toEqual(0)
    expect(events).toEqual([
      {deltas: {all: -1, completed: -1}, revision: 1},
      {deltas: {all: -2, completed: -2}, revision: 2}
    ])
    expect(revision.value).toEqual(2)
  })
})
