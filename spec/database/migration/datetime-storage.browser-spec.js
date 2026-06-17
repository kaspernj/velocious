// @ts-check

import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - datetime storage", {tags: ["dummy"]}, () => {
  it("converts legacy local SQLite datetime rows to UTC storage", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const tableName = "legacy_datetime_storage_records"
      const migration = new Migration({configuration: Configuration.current(), db})

      if (db.getType() != "sqlite") {
        // Only SQLite preserves legacy local values as timezone-less strings.
        return
      }

      if (await migration.tableExists(tableName)) {
        await migration.dropTable(tableName)
      }

      await migration.createTable(tableName, {id: false}, (table) => {
        table.integer("id", {null: false, primaryKey: true})
        table.datetime("created_at")
        table.datetime("already_utc_at")
      })

      try {
        await db.query(`
          INSERT INTO ${db.quoteTable(tableName)}
          (${db.quoteColumn("id")}, ${db.quoteColumn("created_at")}, ${db.quoteColumn("already_utc_at")})
          VALUES (${db.quote(1)}, ${db.quote("2025-06-12 14:34:56.789")}, ${db.quote("2025-06-12T12:34:56.789Z")})
        `)

        await migration.migrateLegacyLocalDateTimesToUtcStorage({
          tables: [tableName],
          columnsByTable: {
            [tableName]: ["created_at", "already_utc_at"]
          },
          legacyLocalOffsetMinutes: -120
        })

        const rows = await db.query(`SELECT * FROM ${db.quoteTable(tableName)}`)

        expect(rows[0].created_at).toEqual("2025-06-12T12:34:56.789Z")
        expect(rows[0].already_utc_at).toEqual("2025-06-12T12:34:56.789Z")
      } finally {
        await migration.dropTable(tableName)
      }
    })
  })
})
