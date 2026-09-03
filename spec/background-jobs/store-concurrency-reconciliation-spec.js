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

  /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @param {string} concurrencyKey - Counter key. @returns {Promise<void>} - Resolves when rebuilt. */
  async _reconcileConcurrencyKey(db, concurrencyKey) {
    this.reconciledConcurrencyKeys.push(concurrencyKey)
    await super._reconcileConcurrencyKey(db, concurrencyKey)
  }
}

describe("Background jobs store concurrency reconciliation", {databaseCleaning: {transaction: true}}, () => {
  it("rebuilds only active or stale concurrency counters", async () => {
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

    expect(store.reconciledConcurrencyKeys.sort()).toEqual(["active", "stale"])
    expect(await readActiveCount({store, concurrencyKey: "active"})).toEqual(1)
    expect(await readActiveCount({store, concurrencyKey: "stale"})).toEqual(0)
  })
})
