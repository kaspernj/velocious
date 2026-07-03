// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import MysqlInsert from "../../src/database/drivers/mysql/sql/insert.js"
import PgsqlInsert from "../../src/database/drivers/pgsql/sql/insert.js"
import SqliteInsert from "../../src/database/drivers/sqlite/sql/insert.js"

/**
 * @param {string} type - Driver type.
 * @returns {import("../../src/database/drivers/base.js").default} - Driver-like object for SQL generation.
 */
function buildDriver(type) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    getType: () => type,
    options() {
      return {
        quote: (/** @type {?} */ value) => `'${value}'`
      }
    },
    quoteColumn: (/** @type {string} */ name) => `"${name}"`,
    quoteTable: (/** @type {string} */ name) => `"${name}"`
  }))
}

describe("database - drivers - insert sql", () => {
  it("generates a default-values insert for empty data on pgsql", () => {
    const sql = new PgsqlInsert({data: {}, driver: buildDriver("pgsql"), tableName: "server_sequences"}).toSql()

    expect(sql).toEqual(`INSERT INTO "server_sequences" DEFAULT VALUES`)
  })

  it("generates a default-values insert for empty data on sqlite", () => {
    const sql = new SqliteInsert({data: {}, driver: buildDriver("sqlite"), tableName: "server_sequences"}).toSql()

    expect(sql).toEqual(`INSERT INTO "server_sequences" DEFAULT VALUES`)
  })

  it("generates an empty-values insert for empty data on mysql", () => {
    const sql = new MysqlInsert({data: {}, driver: buildDriver("mysql"), tableName: "server_sequences"}).toSql()

    expect(sql).toEqual(`INSERT INTO "server_sequences" () VALUES ()`)
  })
})
