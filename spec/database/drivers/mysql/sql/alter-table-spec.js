// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import MysqlDriver from "../../../../../src/database/drivers/mysql/index.js"
import TableData from "../../../../../src/database/table-data/index.js"
import TableForeignKey from "../../../../../src/database/table-data/table-foreign-key.js"

/** @returns {MysqlDriver} */
function buildDriver() {
  return new MysqlDriver({type: "mysql"})
}

describe("database/drivers/mysql/sql/alter-table", () => {
  it("uses the in-place algorithm for simple add-column alters", async () => {
    const tableData = new TableData("builds")

    tableData.string("check_run_payload_digest", {maxLength: 64})

    const sqls = await buildDriver().alterTableSQLs(tableData)

    expect(sqls).toEqual([
      "ALTER TABLE `builds` ADD COLUMN `check_run_payload_digest` VARCHAR(64), ALGORITHM=INPLACE"
    ])
  })

  it("does not force the in-place algorithm for foreign-key alters", async () => {
    const tableData = new TableData("build_artifacts")

    tableData.addForeignKey(new TableForeignKey({
      columnName: "build_id",
      isNewForeignKey: true,
      referencedColumnName: "id",
      referencedTableName: "builds",
      tableName: "build_artifacts"
    }))

    const sqls = await buildDriver().alterTableSQLs(tableData)

    expect(sqls[0]).toContain("ADD FOREIGN KEY")
    expect(sqls[0]).not.toContain("ALGORITHM=INPLACE")
  })
})
