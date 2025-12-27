// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import MysqlStructureSql from "../../src/database/drivers/mysql/structure-sql.js"

/**
 * @param {string} sql
 * @returns {string | null}
 */
function extractQuotedName(sql) {
  const match = sql.match(/["'`]([^"'`]+)["'`]/)

  return match ? match[1] : null
}

/**
 * @param {object} args
 * @param {string} args.version
 * @param {Array<{table_name: string, table_type: string}>} args.tables
 * @param {Record<string, {type: "table" | "view", sql: string}>} args.creates
 * @returns {import("../../src/database/drivers/base.js").default}
 */
function buildMysqlDb({version, tables, creates}) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    quoteTable(/** @type {string} */ name) {
      return `\`${name}\``
    },
    async query(/** @type {string} */ sql) {
      if (sql == "SELECT VERSION() AS version") return [{version}]

      if (sql.startsWith("SELECT table_name, table_type FROM information_schema.tables")) {
        return tables
      }

      if (sql.startsWith("SHOW CREATE TABLE")) {
        const tableName = extractQuotedName(sql)

        if (!tableName || !creates[tableName]) return []

        return [{"Create Table": creates[tableName].sql}]
      }

      if (sql.startsWith("SHOW CREATE VIEW")) {
        const tableName = extractQuotedName(sql)

        if (!tableName || !creates[tableName]) return []

        return [{"Create View": creates[tableName].sql}]
      }

      return []
    }
  }))
}

describe("Drivers - structure sql - mysql", () => {
  it("builds structure sql for mysql tables and views", async () => {
    const db = buildMysqlDb({
      version: "8.0.33",
      tables: [
        {table_name: "users", table_type: "BASE TABLE"},
        {table_name: "active_users", table_type: "VIEW"}
      ],
      creates: {
        users: {type: "table", sql: "CREATE TABLE `users` (`id` int)"},
        active_users: {type: "view", sql: "CREATE VIEW `active_users` AS SELECT 1"}
      }
    })

    const result = await new MysqlStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE TABLE `users` (`id` int);\n\nCREATE VIEW `active_users` AS SELECT 1;\n")
  })

  it("treats MariaDB system views as views", async () => {
    const db = buildMysqlDb({
      version: "10.4.0-MariaDB",
      tables: [
        {table_name: "system_users", table_type: "SYSTEM VIEW"}
      ],
      creates: {
        system_users: {type: "view", sql: "CREATE VIEW `system_users` AS SELECT 1"}
      }
    })

    const result = await new MysqlStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE VIEW `system_users` AS SELECT 1;\n")
  })

  it("strips AUTO_INCREMENT from create statements", async () => {
    const db = buildMysqlDb({
      version: "8.0.33",
      tables: [
        {table_name: "users", table_type: "BASE TABLE"}
      ],
      creates: {
        users: {type: "table", sql: "CREATE TABLE `users` (`id` int) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4"}
      }
    })

    const result = await new MysqlStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE TABLE `users` (`id` int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n")
  })
})
