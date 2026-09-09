// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql transaction", () => {
  it("clears the current transaction when begin fails", async () => {
    const originalTransaction = mssql.Transaction

    class FakeTransaction {
      async begin() {
        throw new Error("begin failed")
      }
    }

    mssql.Transaction = FakeTransaction

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})
      driver.connection = {}

      await expect(async () => driver.startTransaction()).toThrowError("begin failed")
      expect(driver._currentTransaction).toBeNull()
    } finally {
      mssql.Transaction = originalTransaction
    }
  })

  it("reconnects before starting a transaction when disconnected", async () => {
    const originalTransaction = mssql.Transaction

    class FakeTransaction {
      constructor(connection) {
        this.connection = connection
      }

      async begin() {}
    }

    mssql.Transaction = FakeTransaction

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})
      let didConnect = false

      driver.connect = async () => {
        didConnect = true
        driver.connection = {connected: true}
      }

      await driver.startTransaction()

      expect(didConnect).toBeTrue()
      expect(driver._currentTransaction).toBeInstanceOf(FakeTransaction)
      expect(driver._currentTransaction.connection).toEqual(driver.connection)
    } finally {
      mssql.Transaction = originalTransaction
    }
  })

  it("clears a stale physical transaction without underflowing logical transaction depth", async () => {
    class FakeTransaction {
      rollbackCalls = 0

      async rollback() {
        this.rollbackCalls++
      }
    }

    const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})
    const transaction = new FakeTransaction()

    driver.connection = {}
    driver._currentTransaction = /** @type {import("mssql").Transaction} */ (transaction)

    await driver.rollbackTransaction()

    expect(transaction.rollbackCalls).toEqual(1)
    expect(driver._currentTransaction).toBeNull()
    expect(driver._transactionsCount).toEqual(0)
  })
})
