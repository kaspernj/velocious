// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SqliteStructureSql from "../../src/database/drivers/sqlite/structure-sql.js"

/**
 * @param {object} args
 * @param {Array<{type: string, name: string, sql: string}>} args.entries
 * @returns {import("../../src/database/drivers/base.js").default}
 */
function buildSqliteDb({entries}) {
  return /** @type {import("../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    async query() {
      return entries
    }
  }))
}

describe("Drivers - structure sql - sqlite", () => {
  it("orders tables before indexes", async () => {
    const db = buildSqliteDb({
      entries: [
        {type: "index", name: "index_on_artist_id", sql: "CREATE INDEX `index_on_artist_id` ON `artist_translations` (`artist_id`)"},
        {type: "table", name: "artist_translations", sql: "CREATE TABLE `artist_translations` (`id` INTEGER PRIMARY KEY NOT NULL)"},
        {type: "index", name: "index_on_artist_locale", sql: "CREATE UNIQUE INDEX `index_on_artist_locale` ON `artist_translations` (`artist_id`, `locale`)"}
      ]
    })

    const result = await new SqliteStructureSql({driver: db}).toSql()

    expect(result).toEqual("CREATE TABLE `artist_translations` (`id` INTEGER PRIMARY KEY NOT NULL);\n\nCREATE INDEX `index_on_artist_id` ON `artist_translations` (`artist_id`);\n\nCREATE UNIQUE INDEX `index_on_artist_locale` ON `artist_translations` (`artist_id`, `locale`);\n")
  })
})
