// @ts-check

import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"

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
        const match = sql.match(/`(.+?)`/)
        const tableName = match?.[1]

        if (!tableName || !creates[tableName]) return []

        return [{"Create Table": creates[tableName].sql}]
      }

      if (sql.startsWith("SHOW CREATE VIEW")) {
        const match = sql.match(/`(.+?)`/)
        const tableName = match?.[1]

        if (!tableName || !creates[tableName]) return []

        return [{"Create View": creates[tableName].sql}]
      }

      return []
    }
  }))
}

describe("Environment handler - Node - structure sql - mysql", () => {
  it("builds structure sql for mysql tables and views", {focus: true}, async () => {
    const handler = new EnvironmentHandlerNode()

    handler.setConfiguration(/** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ ({
      getDatabaseType() { return "mysql" }
    })))

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

    const result = await handler._mysqlStructureSqlByIdentifier({dbs: {default: db}})

    expect(result).toEqual({
      default: "CREATE TABLE `users` (`id` int);\n\nCREATE VIEW `active_users` AS SELECT 1;\n"
    })
  })

  it("treats MariaDB system views as views", async () => {
    const handler = new EnvironmentHandlerNode()

    handler.setConfiguration(/** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ ({
      getDatabaseType() { return "mysql" }
    })))

    const db = buildMysqlDb({
      version: "10.4.0-MariaDB",
      tables: [
        {table_name: "system_users", table_type: "SYSTEM VIEW"}
      ],
      creates: {
        system_users: {type: "view", sql: "CREATE VIEW `system_users` AS SELECT 1"}
      }
    })

    const result = await handler._mysqlStructureSqlByIdentifier({dbs: {default: db}})

    expect(result).toEqual({
      default: "CREATE VIEW `system_users` AS SELECT 1;\n"
    })
  })
})
