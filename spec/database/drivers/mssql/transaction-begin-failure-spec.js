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
})
