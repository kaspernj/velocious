// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"

/**
 * A two-party rendezvous: both callers block until both have arrived, then both proceed. Used to
 * hold each transaction's first row-lock at the same time so InnoDB is forced into an AB-BA
 * deadlock rather than serializing the two transactions.
 * @returns {() => Promise<void>} - Arrive-and-wait function.
 */
function createRendezvous() {
  let arrived = 0
  /** @type {Array<() => void>} */
  const waiters = []

  return () => {
    arrived++

    if (arrived >= 2) {
      for (const release of waiters) release()

      return Promise.resolve()
    }

    return new Promise((resolve) => waiters.push(resolve))
  }
}

/**
 * @param {object} args - Options.
 * @param {BackgroundJobsStore} args.store - Background jobs store.
 * @param {string} args.concurrencyKey - Concurrency key.
 * @returns {Promise<number>} - The persisted `active_count` for the key (0 when the row is absent).
 */
async function readActiveCount({store, concurrencyKey}) {
  const rows = await store._withDb(async (db) =>
    await db.newQuery().from("background_job_concurrency").where({concurrency_key: concurrencyKey}).results()
  )

  if (rows.length === 0) return 0

  return Number(/** @type {{active_count: number | string}} */ (rows[0]).active_count)
}

describe("background jobs store - concurrency counter deadlocks", {tags: ["dummy"], databaseCleaning: {truncate: true}}, () => {
  it("absorbs an AB-BA deadlock on the concurrency counter and keeps the counter consistent", async () => {
    const configuration = Configuration.current()
    const store = new BackgroundJobsStore({configuration})
    await store.clearAll()

    const pool = configuration.getDatabasePool(store.getDatabaseIdentifier())
    const engineType = await pool.withConnection({name: "deadlock engine probe"}, async (db) => db.getArgs().type)

    // A real row-level deadlock needs an engine with row locking and two independent connections.
    // SQLite serializes writers on one shared connection, so it cannot reproduce this; only the
    // MySQL/MariaDB CI lane exercises the real deadlock. Skip cleanly everywhere else.
    if (engineType !== "mysql") return

    const keyA = "deadlock-a"
    const keyB = "deadlock-b"

    // enqueue seeds one concurrency-counter row per key (active_count 0, nothing reserved yet).
    await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: keyA, maxConcurrency: 4}})
    await store.enqueue({jobName: "TestJob", args: [], options: {concurrencyKey: keyB, maxConcurrency: 4}})

    const rendezvous = createRendezvous()

    /**
     * Locks two counter rows in the given order inside one transaction. Two of these running
     * concurrently in opposite orders deadlock; the store's hardened transaction retry must absorb
     * the deadlock instead of letting it escape.
     * @param {import("../../src/database/drivers/base.js").default} db - Connection.
     * @param {string} firstKey - Key locked first.
     * @param {string} secondKey - Key locked second.
     * @returns {Promise<number>} - Transaction attempts made (>= 2 means it deadlocked and retried).
     */
    const contend = async (db, firstKey, secondKey) => {
      let attempts = 0

      await db.transaction(async () => {
        attempts++
        await store._lockConcurrencyRow(db, firstKey)

        // Rendezvous only on the first attempt, so both transactions hold their first row-lock at
        // once and deadlock. The retry skips it, letting the surviving transaction commit first and
        // this one then complete.
        if (attempts === 1) await rendezvous()

        await store._lockConcurrencyRow(db, secondKey)
      })

      return attempts
    }

    const attempts = await Promise.all([
      pool.withConnection({name: "deadlock-contender-a"}, async (db) => await contend(db, keyA, keyB)),
      pool.withConnection({name: "deadlock-contender-b"}, async (db) => await contend(db, keyB, keyA))
    ])

    // Neither call rejected (the deadlock did not escape), and one contender was the deadlock
    // victim that retried — proving the hardened transaction retry absorbed a real deadlock.
    expect(Math.max(...attempts)).toBeGreaterThanOrEqual(2)

    // The lock is value-preserving, so both counters remain at their seeded value of 0.
    expect(await readActiveCount({store, concurrencyKey: keyA})).toEqual(0)
    expect(await readActiveCount({store, concurrencyKey: keyB})).toEqual(0)
  })
})
