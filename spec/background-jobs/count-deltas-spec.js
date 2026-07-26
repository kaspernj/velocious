// @ts-check

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
 * @param {Array<Record<string, ?>>} args.events - Recorded deltas.
 * @param {Set<string>} args.ids - Shared persisted job ids.
 * @param {{value: number}} args.revision - Shared durable revision.
 * @param {() => Promise<void>} args.selectBarrier - Waits until both stores selected.
 * @returns {BackgroundJobsStore} Store.
 */
function buildConcurrentPruneStore({events, ids, revision, selectBarrier}) {
  const query = {
    from: () => query,
    limit: () => query,
    select: () => query,
    where: () => query,
    results: async () => {
      const selected = Array.from(ids).map((id) => ({id}))

      await selectBarrier()
      return selected
    }
  }
  const db = /** @type {import("../../src/database/drivers/base.js").default} */ ({
    affectedRows: async () => {
      const deleted = ids.size

      ids.clear()
      return deleted
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

    /** @param {Function} callback - Database callback. @returns {Promise<?>} Callback result. */
    async _withDb(callback) {
      return await callback(db)
    }

    /** @param {?} _db - Database. @param {Function} callback - Transaction callback. @returns {Promise<?>} Callback result. */
    async _serializedCountMutation(_db, callback) {
      return await callback()
    }

    /** @param {?} _db - Database. @param {Record<string, number>} deltas - Deltas. @returns {Promise<void>} Resolves after recording. */
    async _recordCountDelta(_db, deltas) {
      if (Object.values(deltas).some((value) => value !== 0)) {
        revision.value += 1
        events.push({deltas, revision: revision.value})
      }
    }
  }()
}

/**
 * @returns {Promise<{events: Array<Record<string, ?>>, revision: number, store: BackgroundJobsStore}>} Empty store and captured count events.
 */
async function setupStore() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})

  await store.clearAll()
  const {revision} = await store.countSnapshot()

  /** @type {Array<Record<string, ?>>} */
  const events = []
  const subscription = /** @type {import("../../src/http-server/websocket-channel.js").default} */ ({
    deliverBroadcast: (/** @type {Record<string, ?>} */ body) => events.push(body),
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
    /** @type {Array<Record<string, ?>>} */
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
})
