// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql rollback failure", () => {
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

      // rollbackTransaction should not throw — the base driver catches
      // the error from _rollbackTransactionAction and re-throws it, but
      // _currentTransaction must still be nulled.
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
})
