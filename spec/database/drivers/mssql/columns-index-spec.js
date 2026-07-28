// @ts-check

import { describe, expect, it } from "../../../../src/testing/test.js"
import MssqlColumnsIndex from "../../../../src/database/drivers/mssql/columns-index.js"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import MssqlTable, { groupMssqlIndexRows } from "../../../../src/database/drivers/mssql/table.js"
import { normalizeIndexMetadataRow } from "../../../../src/database/drivers/index-metadata.js"

describe("database/drivers/mssql/columns-index", {databaseCleaning: {transaction: true}}, () => {
  it("groups ordered metadata rows and exposes complete index columns", () => {
    const indexData = groupMssqlIndexRows([
      {column_name: "status", index_name: "index_tasks_on_status_and_category", is_primary_key: false, is_unique: false, table_name: "tasks"},
      {column_name: "category", index_name: "index_tasks_on_status_and_category", is_primary_key: false, is_unique: false, table_name: "tasks"},
      {column_name: "id", index_name: "PK_tasks", is_primary_key: true, is_unique: true, table_name: "tasks"}
    ].map((row) => normalizeIndexMetadataRow(row)))
    const table = new MssqlTable(new MssqlDriver({sqlConfig: {}}), {TABLE_NAME: "tasks"})
    const compositeIndex = new MssqlColumnsIndex(table, indexData[0])
    const primaryIndex = new MssqlColumnsIndex(table, indexData[1])

    expect(compositeIndex.getColumnNames()).toEqual(["status", "category"])
    expect(compositeIndex.isUnique()).toBe(false)
    expect(compositeIndex.isPrimaryKey()).toBe(false)
    expect(primaryIndex.getColumnNames()).toEqual(["id"])
    expect(primaryIndex.isUnique()).toBe(true)
    expect(primaryIndex.isPrimaryKey()).toBe(true)
  })
})
