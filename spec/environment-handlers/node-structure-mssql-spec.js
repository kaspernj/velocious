// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import MssqlStructureSql from "../../src/database/drivers/mssql/structure-sql.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * @param {string} sql
 * @returns {string | null}
 */
function extractQuotedName(sql) {
  const matches = [...sql.matchAll(/["'`]([^"'`]+)["'`]/g)]
  const lastMatch = matches[matches.length - 1]

  return lastMatch ? lastMatch[1] : null
}

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

if (dummyConfiguration.getDatabaseType("default") != "mssql") {
  console.warn(`Skipping mssql structure sql specs: default database is ${dummyConfiguration.getDatabaseType("default")}`)
} else {
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
}
