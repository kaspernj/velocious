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
})
