// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import MssqlDriver from "../../../../../src/database/drivers/mssql/index.js"
import TableData from "../../../../../src/database/table-data/index.js"

/** @returns {MssqlDriver} */
function buildDriver() {
  return new MssqlDriver({sqlConfig: {}})
}

describe("database/drivers/mssql/sql/alter-table", {databaseCleaning: {transaction: true}}, () => {
  it("emits add-column alters without the COLUMN keyword", async () => {
    const tableData = new TableData("builds")

    tableData.string("check_run_payload_digest", {maxLength: 64})

    const sqls = await buildDriver().alterTableSQLs(tableData)

    expect(sqls).toEqual([
      "ALTER TABLE [builds] ADD [check_run_payload_digest] NVARCHAR(64)"
    ])
  })
})
