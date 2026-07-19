// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import MysqlDriver from "../../../../../src/database/drivers/mysql/index.js"
import TableData from "../../../../../src/database/table-data/index.js"
import TableForeignKey from "../../../../../src/database/table-data/table-foreign-key.js"
import TableIndex from "../../../../../src/database/table-data/table-index.js"

/** @returns {MysqlDriver} */
function buildDriver() {
  return new MysqlDriver({type: "mysql"})
}

describe("database/drivers/mysql/sql/alter-table", {databaseCleaning: {transaction: true}}, () => {
  it("does not force an algorithm for simple add-column alters", async () => {
    const tableData = new TableData("builds")

    tableData.string("check_run_payload_digest", {maxLength: 64})

    const sqls = await buildDriver().alterTableSQLs(tableData)

    expect(sqls).toEqual([
      "ALTER TABLE `builds` ADD COLUMN `check_run_payload_digest` VARCHAR(64)"
    ])
  })

  it("emits a falsy default of 0 when adding a column", async () => {
    const tableData = new TableData("github_webhooks")

    tableData.integer("attempt_count", {default: 0, null: false})

    const sqls = await buildDriver().alterTableSQLs(tableData)

    expect(sqls).toEqual([
      "ALTER TABLE `github_webhooks` ADD COLUMN `attempt_count` INTEGER DEFAULT 0 NOT NULL"
    ])
  })

  it("adds a column and unique index in the same alter statement", async () => {
    const tableData = new TableData("widgets")

    tableData.integer("id", {autoIncrement: true, null: false})
    tableData.addIndex(new TableIndex(["id"], {name: "index_widgets_on_id", unique: true}))

    expect(await buildDriver().alterTableSQLs(tableData)).toEqual([
      "ALTER TABLE `widgets` ADD COLUMN `id` INTEGER AUTO_INCREMENT NOT NULL, ADD UNIQUE INDEX `index_widgets_on_id` (`id`)"
    ])
  })

  it("does not force an algorithm for foreign-key alters", async () => {
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
    expect(sqls[0]).not.toContain("ALGORITHM=")
  })
})
