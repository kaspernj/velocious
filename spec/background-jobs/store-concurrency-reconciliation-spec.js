// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {clearBackgroundJobs} from "../helpers/background-jobs-helper.js"

/**
 * @param {object} args - Options.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @param {string} args.concurrencyKey - Concurrency key.
 * @returns {Promise<number>} - The persisted active count for the key.
 */
async function readActiveCount({store, concurrencyKey}) {
  const rows = await store._withDb(async (db) =>
    await db.newQuery().from("background_job_concurrency").where({concurrency_key: concurrencyKey}).results()
  )

  if (rows.length === 0) return 0

  return Number(/** @type {{active_count: number | string}} */ (rows[0]).active_count)
}

/**
 * @param {object} args - Options.
 * @param {number} args.activeCount - Persisted active count.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @param {string} args.concurrencyKey - Concurrency key.
 * @returns {Promise<void>} - Resolves after updating the count.
 */
async function writeActiveCount({store, concurrencyKey, activeCount}) {
  await store._withDb(async (db) => await db.update({
    tableName: "background_job_concurrency",
    data: {active_count: activeCount},
    conditions: {concurrency_key: concurrencyKey}
  }))
}

/** A store that records the concurrency keys whose counters are rebuilt. */
class ObservedConcurrencyReconciliationStore extends BackgroundJobsStore {
  /** @param {object} args - Options forwarded to the store constructor. */
  constructor(args) {
    super(args)
    /** @type {string[]} */
    this.reconciledConcurrencyKeys = []
  }

  /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @param {string} concurrencyKey - Counter key. @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobConcurrencyRepair | null>} - Applied repair. */
  async _reconcileConcurrencyKey(db, concurrencyKey) {
    this.reconciledConcurrencyKeys.push(concurrencyKey)
    return await super._reconcileConcurrencyKey(db, concurrencyKey)
  }
}

/** A store that records whether candidate discovery shares a repair transaction. */
class TransactionObservedConcurrencyReconciliationStore extends BackgroundJobsStore {
  /** @param {object} args - Options forwarded to the store constructor. */
  constructor(args) {
    super(args)
    this.reconciliationTransactionDepth = 0
    /** @type {boolean | null} */
    this.snapshotInsideTransaction = null
    this.transactionCount = 0
  }

  /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Transaction callback. @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result. */
  async _transactionResult(db, callback) {
    this.reconciliationTransactionDepth++
    this.transactionCount++

    try {
      return await super._transactionResult(db, callback)
    } finally {
      this.reconciliationTransactionDepth--
    }
  }

  /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @param {{insideTransaction?: boolean}} [options] - Reconciliation options. @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobConcurrencyReconciliation>} - Reconciliation summary. */
  async _reconcileConcurrency(db, options) {
    this.snapshotInsideTransaction = this.reconciliationTransactionDepth > 0

    return await super._reconcileConcurrency(db, options)
  }
}

/** A store that simulates queue-policy adoption between handoff selection and persistence. */
class InterleavedQueuePolicyStore extends BackgroundJobsStore {
  /** @param {object} args - Options forwarded to the store constructor. */
  constructor(args) {
    super(args)
    this.interleaved = false
    /** @type {string | null} */
    this.targetJobId = null
  }

  /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @param {import("../../src/database/drivers/base.js").UpdateSqlArgsType} args - Update options. @returns {Promise<number>} - Affected rows. */
  async _updateAffectedRows(db, args) {
    if (!this.interleaved && args.tableName === "background_jobs" && args.data.status === "handed_off" && args.conditions.id === this.targetJobId) {
      this.interleaved = true
      await db.update({
        tableName: "background_jobs",
        data: {concurrency_key: "queue:builds", max_concurrency: 1},
        conditions: {id: this.targetJobId, status: "queued"}
      })
    }

    return await super._updateAffectedRows(db, args)
  }
}

describe("Background jobs store concurrency reconciliation", {databaseCleaning: {transaction: true}}, () => {
  it("locks only counters whose snapshot count has drifted", async () => {
    const seedStore = await clearBackgroundJobs()

    for (let number = 0; number < 5; number++) {
      await seedStore.enqueue({
        jobName: "TestJob",
        args: [number],
        options: {concurrencyKey: `inactive-${number}`, maxConcurrency: 1}
      })
    }

    const activeJobId = await seedStore.enqueue({
      jobName: "TestJob",
      args: [],
      options: {concurrencyKey: "active", maxConcurrency: 2}
    })
    const handoff = await seedStore.markHandedOff({jobId: activeJobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    await seedStore.enqueue({
      jobName: "TestJob",
      args: [],
      options: {concurrencyKey: "stale", maxConcurrency: 1}
    })
    await writeActiveCount({store: seedStore, concurrencyKey: "stale", activeCount: 7})

    const store = new ObservedConcurrencyReconciliationStore({configuration: dummyConfiguration})
    await store.reconcileQueueConcurrency()

    expect(store.reconciledConcurrencyKeys).toEqual(["stale"])
    expect(await readActiveCount({store, concurrencyKey: "active"})).toEqual(1)
    expect(await readActiveCount({store, concurrencyKey: "stale"})).toEqual(0)
  })

  it("repairs high and low active-count drift without restarting the store", async () => {
    const seedStore = await clearBackgroundJobs()
    const activeJobId = await seedStore.enqueue({
      jobName: "TestJob",
      args: [],
      options: {concurrencyKey: "active", maxConcurrency: 2}
    })
    const handoff = await seedStore.markHandedOff({jobId: activeJobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    await seedStore.enqueue({
      jobName: "TestJob",
      args: [],
      options: {concurrencyKey: "stale", maxConcurrency: 1}
    })
    await writeActiveCount({store: seedStore, concurrencyKey: "active", activeCount: 0})
    await writeActiveCount({store: seedStore, concurrencyKey: "stale", activeCount: 7})

    const store = new ObservedConcurrencyReconciliationStore({configuration: dummyConfiguration})
    const result = await store.reconcileActiveConcurrency()

    expect(result).toEqual({
      candidateCount: 2,
      checkedCount: 2,
      repairedCount: 2,
      repairs: [
        {activeCount: 1, concurrencyKey: "active", previousActiveCount: 0},
        {activeCount: 0, concurrencyKey: "stale", previousActiveCount: 7}
      ],
      repairsTruncatedCount: 0
    })
    expect(store.reconciledConcurrencyKeys).toEqual(["active", "stale"])
    expect(await readActiveCount({store, concurrencyKey: "active"})).toEqual(1)
    expect(await readActiveCount({store, concurrencyKey: "stale"})).toEqual(0)
  })

  it("discovers live repair candidates before opening fresh repair transactions", async () => {
    const seedStore = await clearBackgroundJobs()

    for (const concurrencyKey of ["stale-a", "stale-b"]) {
      await seedStore.enqueue({
        jobName: "TestJob",
        args: [],
        options: {concurrencyKey, maxConcurrency: 1}
      })
      await writeActiveCount({store: seedStore, concurrencyKey, activeCount: 7})
    }

    const store = new TransactionObservedConcurrencyReconciliationStore({configuration: dummyConfiguration})

    expect((await store.reconcileActiveConcurrency()).repairedCount).toEqual(2)
    expect(store.snapshotInsideTransaction).toEqual(false)
    expect(store.transactionCount).toEqual(2)
    expect(await readActiveCount({store, concurrencyKey: "stale-a"})).toEqual(0)
    expect(await readActiveCount({store, concurrencyKey: "stale-b"})).toEqual(0)
  })

  it("does not lock or write healthy active counters during live reconciliation", async () => {
    const seedStore = await clearBackgroundJobs()
    const activeJobId = await seedStore.enqueue({
      jobName: "TestJob",
      args: [],
      options: {concurrencyKey: "healthy", maxConcurrency: 2}
    })
    const handoff = await seedStore.markHandedOff({jobId: activeJobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    const store = new ObservedConcurrencyReconciliationStore({configuration: dummyConfiguration})
    const result = await store.reconcileActiveConcurrency()

    expect(result).toEqual({
      candidateCount: 0,
      checkedCount: 1,
      repairedCount: 0,
      repairs: [],
      repairsTruncatedCount: 0
    })
    expect(store.reconciledConcurrencyKeys).toEqual([])
  })

  it("leaves handed-off jobs on their existing policy while adopting queued jobs", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    const seedStore = await clearBackgroundJobs()
    const activeJobId = await seedStore.enqueue({jobName: "TestJob", args: ["active"], options: {queue: "builds"}})
    const queuedJobId = await seedStore.enqueue({jobName: "TestJob", args: ["queued"], options: {queue: "builds"}})
    const handoff = await seedStore.markHandedOff({jobId: activeJobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    try {
      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 1}}})
      const store = new BackgroundJobsStore({configuration: dummyConfiguration})

      await store.reconcileQueueConcurrency()

      expect((await store.getJob(activeJobId))?.concurrencyKey).toBeNull()
      expect((await store.getJob(queuedJobId))?.concurrencyKey).toEqual("queue:builds")
      expect(await readActiveCount({store, concurrencyKey: "queue:builds"})).toEqual(0)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("rejects a handoff when queue policy changes after the job was selected", async () => {
    await clearBackgroundJobs()
    const store = new InterleavedQueuePolicyStore({configuration: dummyConfiguration})
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {queue: "builds"}})
    store.targetJobId = jobId

    expect(await store.markHandedOff({jobId, workerId: "worker-1"})).toBeNull()
    expect(await store.getJob(jobId)).toMatchObject({concurrencyKey: "queue:builds", status: "queued"})
  })

  it("adopts an added queue cap when an active handoff returns to the queue", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    const store = await clearBackgroundJobs()
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {queue: "builds"}})
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    try {
      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 2}}})
      await store.markReturnedToQueue({handoffId: handoff.handoffId, jobId})

      expect(await store.getJob(jobId)).toMatchObject({
        concurrencyKey: "queue:builds",
        maxConcurrency: 2,
        status: "queued"
      })
      expect(await readActiveCount({store, concurrencyKey: "queue:builds"})).toEqual(0)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("drops a removed queue cap when an active handoff is rescheduled", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 2}}})
    const store = await clearBackgroundJobs()
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {queue: "builds"}})
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    try {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
      expect(await store.markRescheduled({delayMs: 0, jobId, workerId: "worker-1", ...handoff})).toEqual(true)
      expect(await store.getJob(jobId)).toMatchObject({
        concurrencyKey: null,
        maxConcurrency: null,
        status: "queued"
      })
      expect(await readActiveCount({store, concurrencyKey: "queue:builds"})).toEqual(0)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })

  it("adopts a changed queue cap when a failed handoff retries", async () => {
    dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 3}}})
    const store = await clearBackgroundJobs()
    const jobId = await store.enqueue({
      jobName: "TestJob",
      args: [],
      options: {maxRetries: 1, queue: "builds"}
    })
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    try {
      dummyConfiguration.setBackgroundJobsConfig({queues: {builds: {maxConcurrent: 1}}})
      const retriedJob = await store.markFailed({error: "retry", jobId, workerId: "worker-1", ...handoff})

      expect(retriedJob).toMatchObject({
        concurrencyKey: "queue:builds",
        maxConcurrency: 1,
        status: "queued"
      })
      expect(await store.getJob(jobId)).toMatchObject({
        concurrencyKey: "queue:builds",
        maxConcurrency: 1,
        status: "queued"
      })
      expect(await readActiveCount({store, concurrencyKey: "queue:builds"})).toEqual(0)
    } finally {
      dummyConfiguration.setBackgroundJobsConfig({queues: {}})
    }
  })
})
