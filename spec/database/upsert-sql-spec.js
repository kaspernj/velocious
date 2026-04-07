// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import MssqlUpsert from "../../src/database/drivers/mssql/sql/upsert.js"
import MysqlUpsert from "../../src/database/drivers/mysql/sql/upsert.js"
import PgsqlUpsert from "../../src/database/drivers/pgsql/sql/upsert.js"
import SqliteUpsert from "../../src/database/drivers/sqlite/sql/upsert.js"

/**
 * @param {object} args - Options object.
 * @param {(name: string) => string} args.quoteColumn - Column quoting function.
 * @param {(value: any) => string | number} args.quoteValue - Value quoting function.
 * @param {(name: string) => string} args.quoteTable - Table quoting function.
 * @returns {import("../../src/database/drivers/base.js").default} - Driver-like object for SQL generation.
 */
function buildDriver({quoteColumn, quoteTable, quoteValue}) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    options() {
      return {
        quote: quoteValue,
        quoteColumnName: quoteColumn
      }
    },
    quoteTable
  }))
}

describe("database - drivers - upsert sql", () => {
  it("generates mysql upsert sql", () => {
    const sql = new MysqlUpsert({
      conflictColumns: ["channel"],
      data: {channel: "news", interested_until: "2026-04-07 08:00:00.000"},
      driver: buildDriver({
        quoteColumn: (name) => `\`${name}\``,
        quoteTable: (name) => `\`${name}\``,
        quoteValue: (value) => `'${value}'`
      }),
      tableName: "websocket_replay_channels",
      updateColumns: ["interested_until"]
    }).toSql()

    expect(sql).toEqual("INSERT INTO `websocket_replay_channels` (`channel`, `interested_until`) VALUES ('news', '2026-04-07 08:00:00.000') ON DUPLICATE KEY UPDATE `interested_until` = VALUES(`interested_until`)")
  })

  it("generates pgsql upsert sql", () => {
    const sql = new PgsqlUpsert({
      conflictColumns: ["channel"],
      data: {channel: "news", interested_until: "2026-04-07 08:00:00.000"},
      driver: buildDriver({
        quoteColumn: (name) => `"${name}"`,
        quoteTable: (name) => `"${name}"`,
        quoteValue: (value) => `'${value}'`
      }),
      tableName: "websocket_replay_channels",
      updateColumns: ["interested_until"]
    }).toSql()

    expect(sql).toEqual("INSERT INTO \"websocket_replay_channels\" (\"channel\", \"interested_until\") VALUES ('news', '2026-04-07 08:00:00.000') ON CONFLICT (\"channel\") DO UPDATE SET \"interested_until\" = excluded.\"interested_until\"")
  })

  it("generates sqlite upsert sql", () => {
    const sql = new SqliteUpsert({
      conflictColumns: ["channel"],
      data: {channel: "news", interested_until: "2026-04-07 08:00:00.000"},
      driver: buildDriver({
        quoteColumn: (name) => `\`${name}\``,
        quoteTable: (name) => `\`${name}\``,
        quoteValue: (value) => `'${value}'`
      }),
      tableName: "websocket_replay_channels",
      updateColumns: ["interested_until"]
    }).toSql()

    expect(sql).toEqual("INSERT INTO `websocket_replay_channels` (`channel`, `interested_until`) VALUES ('news', '2026-04-07 08:00:00.000') ON CONFLICT (`channel`) DO UPDATE SET `interested_until` = excluded.`interested_until`")
  })

  it("generates mssql upsert sql", () => {
    const sql = new MssqlUpsert({
      conflictColumns: ["channel"],
      data: {channel: "news", interested_until: "2026-04-07 08:00:00.000"},
      driver: buildDriver({
        quoteColumn: (name) => `[${name}]`,
        quoteTable: (name) => `[${name}]`,
        quoteValue: (value) => `'${value}'`
      }),
      tableName: "websocket_replay_channels",
      updateColumns: ["interested_until"]
    }).toSql()

    expect(sql).toEqual("MERGE [websocket_replay_channels] AS target USING (SELECT 'news' AS [channel], '2026-04-07 08:00:00.000' AS [interested_until]) AS source ON target.[channel] = source.[channel] WHEN MATCHED THEN UPDATE SET [interested_until] = source.[interested_until] WHEN NOT MATCHED THEN INSERT ([channel], [interested_until]) VALUES (source.[channel], source.[interested_until]);")
  })
})
