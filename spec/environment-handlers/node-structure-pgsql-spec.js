// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import PgsqlStructureSql from "../../src/database/drivers/pgsql/structure-sql.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

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

if (dummyConfiguration.getDatabaseType("default") != "pgsql") {
  console.warn(`Skipping pgsql structure sql specs: default database is ${dummyConfiguration.getDatabaseType("default")}`)
} else {
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
}
