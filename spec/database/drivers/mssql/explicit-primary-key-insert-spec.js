// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

/**
 * Builds an offline MSSQL driver with a recording fake request layer that
 * distinguishes pool-backed requests from transaction-backed requests, so the
 * specs prove ON/INSERT/OFF share one SQL Server session instead of merely
 * asserting SQL order.
 * @returns {{driver: MssqlDriver, queries: Array<{parent: ?, sql: string}>, transactions: Array<?> , restore: () => void}} Offline driver harness.
 */
function buildOfflineDriver() {
  const originalRequest = mssql.Request
  const originalTransaction = mssql.Transaction

  /** @type {Array<{parent: ?, sql: string}>} */
  const queries = []

  /** @type {Array<?>} */
  const transactions = []

  class FakeTransaction {
    /**
     * @param {?} connection - Parent connection.
     */
    constructor(connection) {
      this.connection = connection
      this.events = []

      transactions.push(this)
    }

    /** @returns {Promise<void>} */
    async begin() { this.events.push("begin") }

    /** @returns {Promise<void>} */
    async commit() { this.events.push("commit") }

    /** @returns {Promise<void>} */
    async rollback() { this.events.push("rollback") }
  }

  class FakeRequest {
    /**
     * @param {?} parent - Request parent: the pool connection or a transaction.
     */
    constructor(parent) {
      this.parent = parent
    }

    /**
     * Records the SQL with its request parent and resolves with an empty result.
     * @param {string} sql - SQL to record.
     * @returns {Promise<{recordsets: Array<Array<?>>}>} Empty result.
     */
    async query(sql) {
      queries.push({parent: this.parent, sql})

      return {recordsets: [[]]}
    }
  }

  mssql.Request = /** @type {typeof mssql.Request} */ (/** @type {?} */ (FakeRequest))
  mssql.Transaction = /** @type {typeof mssql.Transaction} */ (/** @type {?} */ (FakeTransaction))

  const configuration = /** @type {any} */ ({
    debug: false,
    getCurrentRequestTiming: () => undefined,
    getQueryLoggingEnabled: () => false
  })
  const driver = new MssqlDriver({sqlConfig: {}}, configuration)

  driver.connection = /** @type {?} */ ({connected: true})

  return {
    driver,
    queries,
    transactions,
    restore: () => {
      mssql.Request = originalRequest
      mssql.Transaction = originalTransaction
    }
  }
}

describe("Database - drivers - mssql explicit primary key insert", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("pins the whole sequence to one transaction session when no transaction is active", async () => {
    const {driver, queries, transactions, restore} = buildOfflineDriver()

    try {
      expect(driver.requiresIdentityInsertForExplicitPrimaryKey()).toBeTrue()

      const result = await driver.withExplicitPrimaryKeyInsert("tasks", async () => {
        return await driver.query("INSERT INTO [tasks] ([id]) VALUES (123456)")
      })

      expect(result).toEqual([])
      expect(queries.map((query) => query.sql)).toEqual([
        "SET IDENTITY_INSERT [tasks] ON",
        "INSERT INTO [tasks] ([id]) VALUES (123456)",
        "SET IDENTITY_INSERT [tasks] OFF"
      ])

      // IDENTITY_INSERT is session-scoped: every request must run on one
      // transaction-bound session, never on pool-backed requests that can hop
      // between physical SQL Server sessions.
      expect(transactions).toHaveLength(1)
      expect(transactions[0].events).toEqual(["begin", "commit"])

      for (const query of queries) {
        expect(query.parent).toBe(transactions[0])
      }
    } finally {
      restore()
    }
  })

  it("reuses the active transaction instead of opening a new one", async () => {
    const {driver, queries, transactions, restore} = buildOfflineDriver()

    try {
      await driver.transaction(async () => {
        await driver.withExplicitPrimaryKeyInsert("tasks", async () => {
          return await driver.query("INSERT INTO [tasks] ([id]) VALUES (123456)")
        })
      })

      expect(transactions).toHaveLength(1)
      expect(transactions[0].events).toEqual(["begin", "commit"])
      expect(queries.map((query) => query.sql)).toEqual([
        "SET IDENTITY_INSERT [tasks] ON",
        "INSERT INTO [tasks] ([id]) VALUES (123456)",
        "SET IDENTITY_INSERT [tasks] OFF"
      ])

      for (const query of queries) {
        expect(query.parent).toBe(transactions[0])
      }
    } finally {
      restore()
    }
  })

  it("turns IDENTITY_INSERT back off on the same session when the insert fails", async () => {
    const {driver, queries, transactions, restore} = buildOfflineDriver()

    try {
      await expect(async () => {
        await driver.withExplicitPrimaryKeyInsert("tasks", async () => {
          throw new Error("Insert failed")
        })
      }).toThrow("Insert failed")

      expect(queries.map((query) => query.sql)).toEqual([
        "SET IDENTITY_INSERT [tasks] ON",
        "SET IDENTITY_INSERT [tasks] OFF"
      ])
      expect(transactions).toHaveLength(1)
      expect(transactions[0].events).toEqual(["begin", "rollback"])

      for (const query of queries) {
        expect(query.parent).toBe(transactions[0])
      }
    } finally {
      restore()
    }
  })
})
