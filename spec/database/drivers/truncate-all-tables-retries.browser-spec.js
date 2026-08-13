// @ts-check

import Configuration from "../../../src/configuration.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { NamedTestTable, TruncateHarnessDriver } from "../../helpers/truncate-all-tables-test-helper.js"

/** @typedef {import("../../../src/database/drivers/base.js").default} Driver */

class FailingTestTable extends NamedTestTable {
  truncateCalls = 0

  /**
   * @param {object} args - Table setup.
   * @param {Driver} args.driver - Owning driver.
   * @param {Error} args.error - Error raised by truncate.
   * @param {string} args.name - Table name.
   */
  constructor({driver, error, name}) {
    super({driver, name})
    this.error = error
  }

  /** @returns {Promise<[]>} - Rejects with the configured error. */
  async truncate() {
    this.truncateCalls++
    throw this.error
  }
}

describe("database - drivers - truncate all tables - retries", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retries six passes, preserves the first error in a pass, and restores foreign keys after exhaustion", async () => {
    const driver = new TruncateHarnessDriver({}, Configuration.current())
    const firstError = new Error("first truncate failure")
    const firstTable = new FailingTestTable({driver, error: firstError, name: "first"})
    const secondTable = new FailingTestTable({driver, error: new Error("second truncate failure"), name: "second"})

    driver.tableSnapshots = Array.from({length: 6}, () => [firstTable, secondTable])

    await expect(async () => await driver.truncateAllTables()).toThrow(firstError)

    expect(driver.getTablesCalls).toEqual(6)
    expect(driver.clearCalls).toEqual(5)
    expect(driver.disableCalls).toEqual(1)
    expect(driver.enableCalls).toEqual(1)
    expect(driver.flushCalls).toEqual(0)
    expect(firstTable.truncateCalls).toEqual(6)
    expect(secondTable.truncateCalls).toEqual(6)
  })
})
