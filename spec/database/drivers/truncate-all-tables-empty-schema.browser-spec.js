// @ts-check

import Configuration from "../../../src/configuration.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { NamedTestTable, TruncateHarnessDriver } from "../../helpers/truncate-all-tables-test-helper.js"

/** @typedef {import("../../../src/database/drivers/base-table.js").default} BaseTable */

class EmptyRefreshTruncateDriver extends TruncateHarnessDriver {
  /** @type {number[]} */
  truncateBatchSizes = []

  /**
   * @param {BaseTable[]} tables - Eligible table snapshot.
   * @returns {Promise<void>} - Always rejects to simulate the stale first batch or invalid empty SQL.
   */
  async truncateTables(tables) {
    this.truncateBatchSizes.push(tables.length)

    if (tables.length == 0) throw new Error("empty truncate batch")

    throw new Error("stale truncate batch")
  }
}

describe("database - drivers - truncate all tables - empty schema", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("returns without foreign-key toggles, batching, or persistence flushing for an empty eligible schema", async () => {
    const driver = new TruncateHarnessDriver({}, Configuration.current())
    driver.tableSnapshots = [[new NamedTestTable({driver, name: "schema_migrations"})]]

    await driver.truncateAllTables()

    expect(driver.getTablesCalls).toEqual(1)
    expect(driver.disableCalls).toEqual(0)
    expect(driver.enableCalls).toEqual(0)
    expect(driver.flushCalls).toEqual(0)
  })

  it("finishes cleanup without an empty batch when refreshed stale metadata has no eligible tables", async () => {
    const driver = new EmptyRefreshTruncateDriver({}, Configuration.current())
    const staleTable = new NamedTestTable({driver, name: "stale_table"})
    const migrationsTable = new NamedTestTable({driver, name: "schema_migrations"})

    driver.tableSnapshots = [[staleTable], [migrationsTable]]

    await driver.truncateAllTables()

    expect(driver.truncateBatchSizes).toEqual([1])
    expect(driver.getTablesCalls).toEqual(2)
    expect(driver.clearCalls).toEqual(1)
    expect(driver.disableCalls).toEqual(1)
    expect(driver.enableCalls).toEqual(1)
    expect(driver.flushCalls).toEqual(1)
  })
})
