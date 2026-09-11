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

  it("emits one ADD clause for a background-jobs multi-column schema upgrade", async () => {
    const tableData = new TableData("background_jobs")

    tableData.bigint("child_received_at_ms", {null: true})
    tableData.bigint("child_started_at_ms", {null: true})
    tableData.string("child_instance_id", {null: true})
    tableData.integer("child_pid", {null: true})

    const sqls = await buildDriver().alterTableSQLs(tableData)

    expect(sqls).toEqual([
      "ALTER TABLE [background_jobs] ADD [child_received_at_ms] BIGINT, [child_started_at_ms] BIGINT, [child_instance_id] NVARCHAR(255), [child_pid] INTEGER"
    ])
  })
})
