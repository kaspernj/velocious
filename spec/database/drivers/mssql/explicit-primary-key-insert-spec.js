// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

/**
 * Builds an offline MSSQL driver with a recording fake request layer.
 * @returns {{driver: MssqlDriver, queries: string[], restore: () => void}} Offline driver harness.
 */
function buildOfflineDriver() {
  const originalRequest = mssql.Request

  /** @type {string[]} */
  const queries = []

  class FakeRequest {
    /**
     * Records the SQL and resolves with an empty result.
     * @param {string} sql - SQL to record.
     * @returns {Promise<{recordsets: Array<Array<?>>}>} Empty result.
     */
    async query(sql) {
      queries.push(sql)

      return {recordsets: [[]]}
    }
  }

  mssql.Request = /** @type {typeof mssql.Request} */ (/** @type {?} */ (FakeRequest))

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
    restore: () => {
      mssql.Request = originalRequest
    }
  }
}

describe("Database - drivers - mssql explicit primary key insert", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("wraps the insert callback with SET IDENTITY_INSERT on and off", async () => {
    const {driver, queries, restore} = buildOfflineDriver()

    try {
      expect(driver.requiresIdentityInsertForExplicitPrimaryKey()).toBeTrue()

      const result = await driver.withExplicitPrimaryKeyInsert("tasks", async () => {
        expect(queries).toEqual(["SET IDENTITY_INSERT [tasks] ON"])

        return await driver.query("INSERT INTO [tasks] ([id]) VALUES (123456)")
      })

      expect(result).toEqual([])
      expect(queries).toEqual([
        "SET IDENTITY_INSERT [tasks] ON",
        "INSERT INTO [tasks] ([id]) VALUES (123456)",
        "SET IDENTITY_INSERT [tasks] OFF"
      ])
    } finally {
      restore()
    }
  })

  it("turns IDENTITY_INSERT back off when the insert fails", async () => {
    const {driver, queries, restore} = buildOfflineDriver()

    try {
      await expect(async () => {
        await driver.withExplicitPrimaryKeyInsert("tasks", async () => {
          throw new Error("Insert failed")
        })
      }).toThrow("Insert failed")

      expect(queries).toEqual([
        "SET IDENTITY_INSERT [tasks] ON",
        "SET IDENTITY_INSERT [tasks] OFF"
      ])
    } finally {
      restore()
    }
  })
})
