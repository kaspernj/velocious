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
 * @param {Array<{referenced_table_name: string, table_name: string}>} [args.foreignKeys]
 * @param {string[]} [args.queries]
 * @returns {import("../../src/database/drivers/base.js").default}
 */
function buildMysqlDb({version, tables, creates, foreignKeys = [], queries = []}) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    quoteTable(/** @type {string} */ name) {
      return `\`${name}\``
    },
    async query(/** @type {string} */ sql) {
      queries.push(sql)

      if (sql == "SELECT VERSION() AS version") return [{version}]

      if (sql.startsWith("SELECT table_name, table_type FROM information_schema.tables")) {
        return tables
      }

      if (sql.startsWith("SELECT table_name, referenced_table_name FROM information_schema.key_column_usage")) {
        return foreignKeys
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

  it("creates referenced audit lookup tables before dependent audit tables", async () => {
    const queries = []
    const db = buildMysqlDb({
      version: "8.0.33",
      tables: [
        {table_name: "audits", table_type: "BASE TABLE"},
        {table_name: "audit_actions", table_type: "BASE TABLE"},
        {table_name: "audit_auditable_types", table_type: "BASE TABLE"}
      ],
      foreignKeys: [
        {table_name: "audits", referenced_table_name: "audit_actions"},
        {table_name: "audits", referenced_table_name: "audit_auditable_types"}
      ],
      queries,
      creates: {
        audit_actions: {type: "table", sql: "CREATE TABLE `audit_actions` (`id` int)"},
        audit_auditable_types: {type: "table", sql: "CREATE TABLE `audit_auditable_types` (`id` int)"},
        audits: {type: "table", sql: "CREATE TABLE `audits` (`id` int, `action_id` int, `auditable_type_id` int, CONSTRAINT `audits_action_id_fk` FOREIGN KEY (`action_id`) REFERENCES `audit_actions` (`id`), CONSTRAINT `audits_auditable_type_id_fk` FOREIGN KEY (`auditable_type_id`) REFERENCES `audit_auditable_types` (`id`))"}
      }
    })

    const result = await new MysqlStructureSql({driver: db}).toSql()

    expect(queries).toContain("SELECT table_name, referenced_table_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_schema = DATABASE() AND referenced_table_name IS NOT NULL")
    expect(result).toEqual("CREATE TABLE `audit_actions` (`id` int);\n\nCREATE TABLE `audit_auditable_types` (`id` int);\n\nCREATE TABLE `audits` (`id` int, `action_id` int, `auditable_type_id` int, CONSTRAINT `audits_action_id_fk` FOREIGN KEY (`action_id`) REFERENCES `audit_actions` (`id`), CONSTRAINT `audits_auditable_type_id_fk` FOREIGN KEY (`auditable_type_id`) REFERENCES `audit_auditable_types` (`id`));\n")
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

  it("does not strip AUTO_INCREMENT from view definitions", async () => {
    const db = buildMysqlDb({
      version: "8.0.33",
      tables: [
        {table_name: "users_with_auto", table_type: "VIEW"}
      ],
      creates: {
        users_with_auto: {type: "view", sql: "CREATE VIEW `users_with_auto` AS SELECT AUTO_INCREMENT FROM information_schema.tables"}
      }
    })

    const result = await new MysqlStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE VIEW `users_with_auto` AS SELECT AUTO_INCREMENT FROM information_schema.tables;\n")
  })
})
