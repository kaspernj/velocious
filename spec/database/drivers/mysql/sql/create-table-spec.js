// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import MysqlDriver from "../../../../../src/database/drivers/mysql/index.js"
import TableData from "../../../../../src/database/table-data/index.js"

/** @returns {MysqlDriver} */
function buildDriver() {
  return new MysqlDriver({type: "mysql"})
}

describe("database/drivers/mysql/sql/create-table", {databaseCleaning: {transaction: true}}, () => {
  it("renders boolean columns as tinyint(1) with a boolean type hint", async () => {
    const tableData = new TableData("feature_flags")

    tableData.boolean("enabled", {null: false})

    const sqls = await buildDriver().createTableSql(tableData)

    expect(sqls).toEqual([
      "CREATE TABLE `feature_flags` (`enabled` TINYINT(1) NOT NULL COMMENT 'velocious:type=boolean') DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ])
  })

  it("renders cloned boolean metadata with maxLength as tinyint(1)", async () => {
    const tableData = new TableData("auth_tokens")

    tableData.addColumn("force_valid_domain", {
      maxLength: 1,
      null: false,
      type: "boolean"
    })

    const sqls = await buildDriver().createTableSql(tableData)

    expect(sqls).toEqual([
      "CREATE TABLE `auth_tokens` (`force_valid_domain` TINYINT(1) NOT NULL COMMENT 'velocious:type=boolean') DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ])
  })

  it("emits a falsy integer default of 0 (truthiness check used to drop it)", async () => {
    const tableData = new TableData("counters")

    tableData.integer("count", {default: 0, null: false})

    const sqls = await buildDriver().createTableSql(tableData)

    expect(sqls).toEqual([
      "CREATE TABLE `counters` (`count` INTEGER DEFAULT 0 NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ])
  })

  it("emits a falsy boolean default of false as 0", async () => {
    const tableData = new TableData("flags")

    tableData.boolean("enabled", {default: false, null: false})

    const sqls = await buildDriver().createTableSql(tableData)

    expect(sqls).toEqual([
      "CREATE TABLE `flags` (`enabled` TINYINT(1) DEFAULT 0 NOT NULL COMMENT 'velocious:type=boolean') DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ])
  })

  it("emits a falsy empty-string default", async () => {
    const tableData = new TableData("notes")

    tableData.string("body", {default: "", null: false})

    const sqls = await buildDriver().createTableSql(tableData)

    expect(sqls).toEqual([
      "CREATE TABLE `notes` (`body` VARCHAR(255) DEFAULT '' NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ])
  })
})
