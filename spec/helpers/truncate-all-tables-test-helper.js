// @ts-check

import BaseDriver from "../../src/database/drivers/base.js"
import BaseTable from "../../src/database/drivers/base-table.js"

/** @typedef {import("../../src/database/drivers/base.js").default} Driver */

export class NamedTestTable extends BaseTable {
  /**
   * @param {object} args - Table setup.
   * @param {Driver} args.driver - Owning driver.
   * @param {string} args.name - Table name.
   */
  constructor({driver, name}) {
    super()
    this.driver = driver
    this.name = name
  }

  /** @returns {string} - Table name. */
  getName() { return this.name }
}

export class TruncateHarnessDriver extends BaseDriver {
  /** @type {BaseTable[][]} */
  tableSnapshots = []
  getTablesCalls = 0
  disableCalls = 0
  enableCalls = 0
  flushCalls = 0
  clearCalls = 0

  /** @returns {Promise<BaseTable[]>} - Next table snapshot. */
  async getTables() {
    const snapshot = this.tableSnapshots[Math.min(this.getTablesCalls, this.tableSnapshots.length - 1)] || []
    this.getTablesCalls++
    return snapshot
  }

  /** @returns {Promise<void>} - Resolves after recording the toggle. */
  async disableForeignKeys() { this.disableCalls++ }

  /** @returns {Promise<void>} - Resolves after recording the toggle. */
  async enableForeignKeys() { this.enableCalls++ }

  /** @returns {Promise<void>} - Resolves after recording the flush. */
  async flushPendingWrites() { this.flushCalls++ }

  /** @returns {void} - Records cache invalidation. */
  clearSchemaCache() { this.clearCalls++ }
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string[]} tableNames - Tables to drop in dependency order.
 * @returns {Promise<void>} - Resolves when tables are absent.
 */
export async function dropTables(driver, tableNames) {
  for (const tableName of tableNames) {
    await driver.dropTable(tableName, {cascade: true, ifExists: true})
  }
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string} tableName - Table name.
 * @returns {Promise<number>} - Row count.
 */
export async function tableRowCount(driver, tableName) {
  const rows = await driver.query(`SELECT COUNT(*) AS count FROM ${driver.quoteTable(tableName)}`)
  const count = rows[0]?.count

  if (typeof count !== "number" && typeof count !== "string") {
    throw new Error(`Expected numeric count for ${tableName}`)
  }

  return Number(count)
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string[]} tableNames - Tables expected in cleanup SQL.
 * @param {string} message - SQL log message.
 * @returns {boolean} - Whether this is a cleanup request for one of the tables.
 */
export function isCleanupRequest(driver, tableNames, message) {
  const cleanupSql = message.includes("TRUNCATE TABLE") || message.includes("DELETE FROM")
  return cleanupSql && tableNames.some((tableName) => message.includes(driver.quoteTable(tableName)))
}
