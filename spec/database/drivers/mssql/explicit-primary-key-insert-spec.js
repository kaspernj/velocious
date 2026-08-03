// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

/**
 * Builds an offline MSSQL driver with a recording fake request layer.
 * @param {object} [args] - Harness args.
 * @param {(sql: string) => boolean} [args.failWhen] - Optional predicate; matching SQL rejects with a marked error.
 * @returns {{driver: MssqlDriver, queries: string[], restore: () => void}} Offline driver harness.
 */
function buildOfflineDriver({failWhen} = {}) {
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

      if (failWhen && failWhen(sql)) throw new Error("Cannot insert explicit value for identity column")

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

const INSERT_SQL = "INSERT INTO [tasks] ([id], [name]) OUTPUT INSERTED.[id], INSERTED.[name] VALUES (123456, 'Explicit')"

describe("Database - drivers - mssql explicit primary key insert", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("runs the explicit primary-key insert as a single batch request", async () => {
    const {driver, queries, restore} = buildOfflineDriver()

    try {
      const result = await driver.insertWithExplicitPrimaryKey({
        options: {logName: "Task Create"},
        sql: INSERT_SQL,
        tableName: "tasks"
      })

      expect(result).toEqual([])
      expect(queries).toHaveLength(1)

      const batch = queries[0]
      const onIndex = batch.indexOf("SET IDENTITY_INSERT [tasks] ON")
      const insertIndex = batch.indexOf(INSERT_SQL)
      const offIndex = batch.indexOf("SET IDENTITY_INSERT [tasks] OFF")
      const catchIndex = batch.indexOf("BEGIN CATCH")
      const throwIndex = batch.indexOf("THROW")

      // One request keeps SQL Server on one session by construction: enable,
      // insert, disable on success, and a CATCH that disables and rethrows.
      expect(onIndex).toBeGreaterThanOrEqual(0)
      expect(insertIndex).toBeGreaterThan(onIndex)
      expect(offIndex).toBeGreaterThan(insertIndex)
      expect(batch).toContain("BEGIN TRY")
      expect(catchIndex).toBeGreaterThan(offIndex)
      expect(batch.lastIndexOf("SET IDENTITY_INSERT [tasks] OFF")).toBeGreaterThan(catchIndex)
      expect(throwIndex).toBeGreaterThan(catchIndex)
    } finally {
      restore()
    }
  })

  it("propagates the original insert error through the standard query path", async () => {
    const {driver, queries, restore} = buildOfflineDriver({failWhen: (sql) => sql.includes(INSERT_SQL)})

    try {
      await expect(async () => {
        await driver.insertWithExplicitPrimaryKey({
          options: {logName: "Task Create"},
          sql: INSERT_SQL,
          tableName: "tasks"
        })
      }).toThrow(/Cannot insert explicit value for identity column/)

      expect(queries).toHaveLength(1)
    } finally {
      restore()
    }
  })
})
