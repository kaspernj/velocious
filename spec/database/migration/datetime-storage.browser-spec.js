// @ts-check

import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"
import MysqlDriver from "../../../src/database/drivers/mysql/index.js"
import TableColumn from "../../../src/database/table-data/table-column.js"

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

  it("defaults MySQL datetime columns to millisecond precision while preserving explicit precision", async () => {
    const mysqlDriver = new MysqlDriver({type: "mysql"}, Configuration.current())
    const defaultPrecisionColumn = new TableColumn("recorded_at", {isNewColumn: true, type: "datetime"})
    const explicitPrecisionColumn = new TableColumn("precise_at", {isNewColumn: true, precision: 6, type: "datetime"})

    expect(defaultPrecisionColumn.getSQL({driver: mysqlDriver, forAlterTable: false})).toEqual("`recorded_at` DATETIME(3)")
    expect(explicitPrecisionColumn.getSQL({driver: mysqlDriver, forAlterTable: false})).toEqual("`precise_at` DATETIME(6)")

    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default

      if (db.getType() != "mysql") return

      const tableName = "datetime_millisecond_storage_records"
      const migration = new Migration({configuration: Configuration.current(), db})

      if (await migration.tableExists(tableName)) await migration.dropTable(tableName)

      await migration.createTable(tableName, {id: false}, (table) => {
        table.integer("id", {null: false, primaryKey: true})
        table.datetime("recorded_at", {null: false})
      })

      try {
        const expected = new Date("2026-08-03T12:34:56.123Z")

        await db.query(
          `INSERT INTO ${db.quoteTable(tableName)} (${db.quoteColumn("id")}, ${db.quoteColumn("recorded_at")}) VALUES (${db.quote(1)}, ${db.quote(expected)})`
        )

        const rows = await db.query(`SELECT ${db.quoteColumn("recorded_at")} FROM ${db.quoteTable(tableName)} WHERE ${db.quoteColumn("id")} = ${db.quote(1)}`)
        const recordedAt = rows[0]?.recorded_at

        if (!(recordedAt instanceof Date)) throw new Error(`Expected MySQL datetime result to be a Date, got ${recordedAt}`)

        expect(recordedAt.toISOString()).toEqual(expected.toISOString())
      } finally {
        await migration.dropTable(tableName)
      }
    })
  })
})
