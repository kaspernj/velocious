// @ts-check

import MysqlStructureSql from "../../src/database/drivers/mysql/structure-sql.js"
import PgsqlStructureSql from "../../src/database/drivers/pgsql/structure-sql.js"
import MssqlStructureSql from "../../src/database/drivers/mssql/structure-sql.js"

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
})

/**
 * @param {object} args
 * @param {Array<{table_name: string, table_type: string}>} args.tables
 * @param {Record<string, Array<Record<string, any>>>} args.columns
 * @param {Record<string, string[]>} args.primaryKeys
 * @param {Record<string, string>} args.views
 * @returns {import("../../src/database/drivers/base.js").default}
 */
function buildPgDb({tables, columns, primaryKeys, views}) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    quote(/** @type {string} */ value) {
      return `'${value}'`
    },
    quoteTable(/** @type {string} */ name) {
      return `"${name}"`
    },
    quoteColumn(/** @type {string} */ name) {
      return `"${name}"`
    },
    async query(/** @type {string} */ sql) {
      if (sql.startsWith("SELECT table_name, table_type FROM information_schema.tables")) {
        return tables
      }

      if (sql.startsWith("SELECT column_name, data_type")) {
        const tableName = extractQuotedName(sql)

        return tableName ? (columns[tableName] || []) : []
      }

      if (sql.startsWith("SELECT kcu.column_name FROM information_schema.table_constraints")) {
        const tableName = extractQuotedName(sql)
        const keys = tableName ? (primaryKeys[tableName] || []) : []

        return keys.map((columnName) => ({column_name: columnName}))
      }

      if (sql.startsWith("SELECT pg_get_viewdef")) {
        const tableName = extractQuotedName(sql)

        if (!tableName || !(tableName in views)) return []

        return [{viewdef: views[tableName]}]
      }

      return []
    }
  }))
}

describe("Drivers - structure sql - pgsql", () => {
  it("builds structure sql for pgsql tables and views", async () => {
    const db = buildPgDb({
      tables: [
        {table_name: "users", table_type: "BASE TABLE"},
        {table_name: "active_users", table_type: "VIEW"}
      ],
      columns: {
        users: [
          {column_name: "id", data_type: "integer", is_nullable: "NO"},
          {column_name: "email", data_type: "character varying", character_maximum_length: 255, is_nullable: "NO"}
        ]
      },
      primaryKeys: {
        users: ["id"]
      },
      views: {
        active_users: "SELECT 1"
      }
    })

    const result = await new PgsqlStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE TABLE \"users\" (\"id\" integer NOT NULL, \"email\" varchar(255) NOT NULL, PRIMARY KEY (\"id\"));\n\nCREATE VIEW \"active_users\" AS SELECT 1;\n")
  })
})

/**
 * @param {object} args
 * @param {Array<{table_name: string, table_type: string}>} args.tables
 * @param {Record<string, Array<Record<string, any>>>} args.columns
 * @param {Record<string, string[]>} args.primaryKeys
 * @param {Record<string, string>} args.views
 * @returns {import("../../src/database/drivers/base.js").default}
 */
function buildMssqlDb({tables, columns, primaryKeys, views}) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    quote(/** @type {string} */ value) {
      return `'${value}'`
    },
    quoteTable(/** @type {string} */ name) {
      return `[${name}]`
    },
    quoteColumn(/** @type {string} */ name) {
      return `[${name}]`
    },
    async query(/** @type {string} */ sql) {
      if (sql.startsWith("SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type")) {
        return tables
      }

      if (sql.startsWith("SELECT COLUMN_NAME AS column_name")) {
        const tableName = extractQuotedName(sql)

        return tableName ? (columns[tableName] || []) : []
      }

      if (sql.startsWith("SELECT kcu.COLUMN_NAME AS column_name")) {
        const tableName = extractQuotedName(sql)
        const keys = tableName ? (primaryKeys[tableName] || []) : []

        return keys.map((columnName) => ({column_name: columnName}))
      }

      if (sql.startsWith("SELECT m.definition AS definition")) {
        const tableName = extractQuotedName(sql)

        if (!tableName || !(tableName in views)) return []

        return [{definition: views[tableName]}]
      }

      return []
    }
  }))
}

describe("Drivers - structure sql - mssql", () => {
  it("builds structure sql for mssql tables and views", async () => {
    const db = buildMssqlDb({
      tables: [
        {table_name: "users", table_type: "BASE TABLE"},
        {table_name: "active_users", table_type: "VIEW"}
      ],
      columns: {
        users: [
          {column_name: "id", data_type: "int", is_nullable: "NO"},
          {column_name: "name", data_type: "nvarchar", character_maximum_length: 50, is_nullable: "YES"}
        ]
      },
      primaryKeys: {
        users: ["id"]
      },
      views: {
        active_users: "SELECT 1"
      }
    })

    const result = await new MssqlStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE TABLE [users] ([id] int NOT NULL, [name] nvarchar(50), PRIMARY KEY ([id]));\n\nCREATE VIEW [active_users] AS SELECT 1;\n")
  })
})
