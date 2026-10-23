// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * Flattens a column's readable metadata for comparison.
 * @param {import("../../../src/database/drivers/base-column.js").default} column - Column to describe.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Comparable metadata.
 */
function describeColumn(column) {
  return {
    autoIncrement: column.getAutoIncrement(),
    default: column.getDefault(),
    maxLength: column.getMaxLength(),
    name: column.getName(),
    notes: column.getNotes(),
    null: column.getNull(),
    primaryKey: column.getPrimaryKey(),
    type: column.getType()
  }
}

describe("database - drivers - batched table columns", {databaseCleaning: {transaction: false}, tags: ["dummy"]}, () => {
  it("returns the same column metadata as the per-table read for every table", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = dbs.default
      const tables = await driver.getTables()
      const batchedColumns = await driver.batchTableColumns(tables)

      // SQLite cannot describe several tables in one statement, so the batched
      // path only exists on the MySQL, PostgreSQL and MSSQL matrix legs.
      if (!batchedColumns) return

      expect(batchedColumns.size).toEqual(tables.length)

      for (const table of tables) {
        const perTableColumns = (await table.getColumns()).map(describeColumn)
        const batchedTableColumns = (batchedColumns.get(table.getName()) || []).map(describeColumn)

        expect(batchedTableColumns).toEqual(perTableColumns)
      }
    })
  })
})
