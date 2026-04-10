// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql transaction recovery", () => {
  it("nulls _currentTransaction after rollback", async () => {
    const originalTransaction = mssql.Transaction
    const originalRequest = mssql.Request

    class FakeTransaction {
      async begin() {}
    }

    class FakeRequest {
      constructor() {}

      async query() { return {recordsets: []} }
    }

    mssql.Transaction = FakeTransaction
    mssql.Request = FakeRequest

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})

      driver.connection = {}
      await driver.startTransaction()
      expect(driver._currentTransaction).toBeInstanceOf(FakeTransaction)

      await driver.rollbackTransaction()
      expect(driver._currentTransaction).toBeNull()
    } finally {
      mssql.Transaction = originalTransaction
      mssql.Request = originalRequest
    }
  })

  it("decrements _transactionsCount after rollback", async () => {
    const originalTransaction = mssql.Transaction
    const originalRequest = mssql.Request

    class FakeTransaction {
      async begin() {}
    }

    class FakeRequest {
      constructor() {}

      async query() { return {recordsets: []} }
    }

    mssql.Transaction = FakeTransaction
    mssql.Request = FakeRequest

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})

      driver.connection = {}
      await driver.startTransaction()
      expect(driver._transactionsCount).toBe(1)

      await driver.rollbackTransaction()
      expect(driver._transactionsCount).toBe(0)
    } finally {
      mssql.Transaction = originalTransaction
      mssql.Request = originalRequest
    }
  })

  it("issues a raw IF @@TRANCOUNT > 0 ROLLBACK on the connection", async () => {
    const originalTransaction = mssql.Transaction
    const originalRequest = mssql.Request

    /** @type {string | undefined} */
    let executedSql

    class FakeTransaction {
      async begin() {}
    }

    class FakeRequest {
      constructor() {}

      /** @param {string} sql */
      async query(sql) {
        executedSql = sql
        return {recordsets: []}
      }
    }

    mssql.Transaction = FakeTransaction
    mssql.Request = FakeRequest

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})

      driver.connection = {}
      await driver.startTransaction()
      await driver.rollbackTransaction()

      expect(executedSql).toEqual("IF @@TRANCOUNT > 0 ROLLBACK")
    } finally {
      mssql.Transaction = originalTransaction
      mssql.Request = originalRequest
    }
  })

  it("nulls _currentTransaction even when the raw ROLLBACK query throws", async () => {
    const originalTransaction = mssql.Transaction
    const originalRequest = mssql.Request

    class FakeTransaction {
      async begin() {}
    }

    class FakeRequest {
      constructor() {}

      async query() { throw new Error("Connection lost") }
    }

    mssql.Transaction = FakeTransaction
    mssql.Request = FakeRequest

    try {
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})

      driver.connection = {}
      await driver.startTransaction()

      try {
        await driver.rollbackTransaction()
      } catch {
        // Expected — the raw ROLLBACK failed.
      }

      expect(driver._currentTransaction).toBeNull()
      expect(driver._transactionsCount).toBe(0)
    } finally {
      mssql.Transaction = originalTransaction
      mssql.Request = originalRequest
    }
  })
})
