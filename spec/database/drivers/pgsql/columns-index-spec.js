// @ts-check

import { describe, expect, it } from "../../../../src/testing/test.js"
import PgsqlColumnsIndex from "../../../../src/database/drivers/pgsql/columns-index.js"
import PgsqlDriver from "../../../../src/database/drivers/pgsql/index.js"
import PgsqlTable, { groupPgsqlIndexRows } from "../../../../src/database/drivers/pgsql/table.js"
import { normalizeIndexMetadataRow } from "../../../../src/database/drivers/index-metadata.js"

describe("database/drivers/pgsql/columns-index", {databaseCleaning: {transaction: true}}, () => {
  it("groups ordered metadata rows and exposes complete index columns", () => {
    const indexRows = [
      {column_name: "status", index_name: "index_tasks_on_status_and_category", is_primary_key: false, is_unique: false, table_name: "tasks"},
      {column_name: "category", index_name: "index_tasks_on_status_and_category", is_primary_key: false, is_unique: false, table_name: "tasks"},
      {column_name: "id", index_name: "tasks_pkey", is_primary_key: true, is_unique: true, table_name: "tasks"}
    ].map((row) => normalizeIndexMetadataRow(row))
    const indexData = groupPgsqlIndexRows(indexRows)
    const table = new PgsqlTable(new PgsqlDriver({}), {table_name: "tasks"})
    const compositeIndex = new PgsqlColumnsIndex(table, indexData[0])
    const primaryIndex = new PgsqlColumnsIndex(table, indexData[1])

    expect(indexRows[0]).toEqual({column_name: "status", index_name: "index_tasks_on_status_and_category", is_primary_key: false, is_unique: false, table_name: "tasks"})
    expect(compositeIndex.getColumnNames()).toEqual(["status", "category"])
    expect(compositeIndex.isUnique()).toBe(false)
    expect(compositeIndex.isPrimaryKey()).toBe(false)
    expect(primaryIndex.getColumnNames()).toEqual(["id"])
    expect(primaryIndex.isUnique()).toBe(true)
    expect(primaryIndex.isPrimaryKey()).toBe(true)
  })
})
