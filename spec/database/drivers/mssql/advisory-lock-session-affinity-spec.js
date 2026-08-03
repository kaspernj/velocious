// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

/**
 * Builds an offline MSSQL driver that exposes every request parent and
 * transaction cleanup event.
 * @param {object} [args] - Harness options.
 * @param {boolean} [args.failRelease] - Whether sp_releaseapplock should fail.
 * @returns {{driver: MssqlDriver, pool: FakePool, queries: Array<{parent: FakeTransaction, sql: string}>, restore: () => void, transactions: FakeTransaction[]}} Harness.
 */
function buildOfflineDriver({failRelease = false} = {}) {
  const originalRequest = mssql.Request
  const originalTransaction = mssql.Transaction
  const queries = []
  const transactions = []

  class FakePool {
    closeCount = 0

    /** @returns {Promise<void>} - Resolves after recording the close. */
    async close() {
      this.closeCount++
    }
  }

  class FakeTransaction {
    /**
     * @param {FakePool} pool - Owning pool.
     */
    constructor(pool) {
      this.events = []
      this.pool = pool
      transactions.push(this)
    }

    /** @returns {Promise<void>} - Resolves after recording begin. */
    async begin() { this.events.push("begin") }

    /** @returns {Promise<void>} - Resolves after recording rollback. */
    async rollback() { this.events.push("rollback") }
  }

  class FakeRequest {
    /**
     * @param {FakeTransaction} parent - Session-affine request parent.
     */
    constructor(parent) {
      this.parent = parent
    }

    /**
     * @param {string} sql - SQL to record.
     * @returns {Promise<{recordsets: Array<Array<{velocious_advisory_lock_result: number}>>}>} Query result.
     */
    async query(sql) {
      queries.push({parent: this.parent, sql})

      if (failRelease && sql.includes("sp_releaseapplock")) throw new Error("release failed")

      return {recordsets: [[{velocious_advisory_lock_result: 0}]]}
    }
  }

  // Narrows the test doubles at the external node-mssql boundary.
  mssql.Request = /** @type {typeof mssql.Request} */ (/** @type {never} */ (FakeRequest))
  mssql.Transaction = /** @type {typeof mssql.Transaction} */ (/** @type {never} */ (FakeTransaction))

  const configuration = /** @type {ConstructorParameters<typeof MssqlDriver>[1]} */ ({
    debug: false,
    getCurrentRequestTiming: () => undefined,
    getQueryLoggingEnabled: () => false
  })
  const driver = new MssqlDriver({sqlConfig: {}}, configuration)
  const pool = new FakePool()

  // Narrows the fake pool at the external node-mssql boundary.
  driver.connection = /** @type {import("mssql").ConnectionPool} */ (/** @type {never} */ (pool))

  return {
    driver,
    pool,
    queries,
    restore: () => {
      mssql.Request = originalRequest
      mssql.Transaction = originalTransaction
    },
    transactions
  }
}

describe("Database - drivers - MSSQL advisory-lock session affinity", () => {
  it("acquires and releases on one transaction-owned physical session, then closes cleanly", async () => {
    const {driver, pool, queries, restore, transactions} = buildOfflineDriver()

    try {
      expect(await driver.tryAcquireAdvisoryLock("resource-lock")).toBe(true)
      expect(await driver.releaseAdvisoryLock("resource-lock")).toBe(true)
      await driver.close()

      expect(transactions).toHaveLength(1)
      expect(transactions[0].events).toEqual(["begin", "rollback"])
      expect(queries).toHaveLength(2)
      expect(queries[0].parent).toBe(transactions[0])
      expect(queries[1].parent).toBe(transactions[0])
      expect(pool.closeCount).toBe(1)
    } finally {
      restore()
    }
  })

  it("releases the affinity session and closes the pool when lock release fails", async () => {
    const {driver, pool, queries, restore, transactions} = buildOfflineDriver({failRelease: true})

    try {
      expect(await driver.tryAcquireAdvisoryLock("resource-lock-error")).toBe(true)
      await expect(async () => await driver.close()).toThrow(/release failed/u)

      expect(transactions).toHaveLength(1)
      expect(transactions[0].events).toEqual(["begin", "rollback"])
      expect(queries).toHaveLength(2)
      expect(queries[0].parent).toBe(transactions[0])
      expect(queries[1].parent).toBe(transactions[0])
      expect(pool.closeCount).toBe(1)
    } finally {
      restore()
    }
  })
})
