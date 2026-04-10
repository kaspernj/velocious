// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql transaction recovery", () => {
  it("nulls _currentTransaction even when rollback throws", async () => {
    const originalTransaction = mssql.Transaction

    class FakeTransaction {
      async begin() {}

      async rollback() {
        throw new Error("Transaction has been aborted.")
      }
    }

    mssql.Transaction = FakeTransaction

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})

      driver.connection = {}

      await driver.startTransaction()
      expect(driver._currentTransaction).toBeInstanceOf(FakeTransaction)

      try {
        await driver.rollbackTransaction()
      } catch {
        // Expected — the rollback itself failed.
      }

      expect(driver._currentTransaction).toBeNull()
    } finally {
      mssql.Transaction = originalTransaction
    }
  })

  it("decrements _transactionsCount even when rollback throws", async () => {
    const originalTransaction = mssql.Transaction

    class FakeTransaction {
      async begin() {}

      async rollback() {
        throw new Error("Transaction has been aborted.")
      }
    }

    mssql.Transaction = FakeTransaction

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})

      driver.connection = {}

      await driver.startTransaction()
      expect(driver._transactionsCount).toBe(1)

      try {
        await driver.rollbackTransaction()
      } catch {
        // Expected.
      }

      expect(driver._transactionsCount).toBe(0)
    } finally {
      mssql.Transaction = originalTransaction
    }
  })

  it("issues a raw ROLLBACK to clear SQL Server session state when Transaction.rollback() fails", async () => {
    const originalTransaction = mssql.Transaction
    const originalRequest = mssql.Request
    let rawRollbackIssued = false
    /** @type {string | undefined} */
    let rawRollbackSql

    class FakeTransaction {
      async begin() {}

      async rollback() {
        throw new Error("Transaction has been aborted.")
      }
    }

    class FakeRequest {
      /** @param {unknown} _connection */
      constructor(_connection) {}

      /** @param {string} sql */
      async query(sql) {
        rawRollbackIssued = true
        rawRollbackSql = sql
        return {recordsets: []}
      }
    }

    mssql.Transaction = FakeTransaction
    mssql.Request = FakeRequest

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})
      const fakeConnection = {connected: true}

      driver.connection = fakeConnection

      await driver.startTransaction()

      try {
        await driver.rollbackTransaction()
      } catch {
        // Expected.
      }

      expect(rawRollbackIssued).toBeTrue()
      expect(rawRollbackSql).toEqual("IF @@TRANCOUNT > 0 ROLLBACK")
      // Connection should still be the same object — not closed or replaced.
      expect(driver.connection).toBe(fakeConnection)
    } finally {
      mssql.Transaction = originalTransaction
      mssql.Request = originalRequest
    }
  })
})
