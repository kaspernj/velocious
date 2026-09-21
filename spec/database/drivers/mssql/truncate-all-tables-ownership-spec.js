// @ts-check

import Configuration from "../../../../src/configuration.js"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import { describe, expect, it } from "../../../../src/testing/test.js"
import { NamedTestTable } from "../../../helpers/truncate-all-tables-test-helper.js"

class CleanupHarnessDriver extends MssqlDriver {
  /** @type {string[]} */
  queries = []

  /** @type {Array<import("../../../../src/database/drivers/base-table.js").default>} */
  tables = []

  /** @returns {Promise<Array<import("../../../../src/database/drivers/base-table.js").default>>} Cleanup table snapshot. */
  async getTables() { return this.tables }

  /**
   * Records one logical SQL Server request without opening a network connection.
   * @param {string} sql - SQL request.
   * @returns {Promise<[]>} Empty rows.
   */
  async query(sql) {
    this.queries.push(sql)

    return []
  }
}

describe("Database - drivers - MSSQL truncate-all-tables ownership", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("owns constraint disable, cleanup, and fail-loud restoration in one request", async () => {
    const driver = new CleanupHarnessDriver({}, Configuration.current())

    driver.tables = [
      new NamedTestTable({driver, name: "cleanup_children"}),
      new NamedTestTable({driver, name: "cleanup_parents"})
    ]

    await driver.truncateAllTables()

    expect(driver.queries).toHaveLength(1)

    const batch = driver.queries[0]
    const disableIndex = batch.indexOf("NOCHECK CONSTRAINT all")
    const childIndex = batch.indexOf("TRUNCATE TABLE [cleanup_children]")
    const parentIndex = batch.indexOf("TRUNCATE TABLE [cleanup_parents]")
    const enableIndex = batch.indexOf("WITH CHECK CHECK CONSTRAINT all")

    expect(disableIndex).toBeGreaterThanOrEqual(0)
    expect(childIndex).toBeGreaterThan(disableIndex)
    expect(parentIndex).toBeGreaterThan(childIndex)
    expect(enableIndex).toBeGreaterThan(parentIndex)
    expect(batch).toContain("BEGIN CATCH")
    expect(batch).toContain("THROW;")
    expect(batch.split("WITH CHECK CHECK CONSTRAINT all")).toHaveLength(3)
  })
})
