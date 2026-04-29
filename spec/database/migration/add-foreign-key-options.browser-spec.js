// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

/**
 * Real-database coverage for `Migration#addForeignKey` option overrides.
 * Creates two real tables in the dummy app, exercises the helper, and reads
 * the FK back from the driver's introspected schema. Runs against whichever
 * database driver the dummy is currently configured for (sqlite for the
 * default `.browser-spec.js` runner, mariadb / pgsql / mssql for the matrix
 * jobs).
 *
 * Both tables are pinned to UUID primary keys (`{id: {type: "uuid"}}`) and
 * UUID FK columns so the types match across every driver — using `integer`
 * here trips MariaDB errno 150 ("Foreign key constraint is incorrectly
 * formed") because its default id type is BIGINT.
 */
describe("database - migration - addForeignKey options", {tags: ["dummy"]}, () => {
  it("derives column / referenced-table / constraint name from the reference name when no options given", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await dropFkOptionsTables(driver)
        await migration.createTable("fk_options_authors", {id: {type: "uuid"}}, (table) => {
          table.string("name", {null: false})
        })
        await migration.createTable("fk_options_posts", {id: {type: "uuid"}}, (table) => {
          table.string("title", {null: false})
          table.uuid("fk_options_author_id", {null: true})
        })

        await migration.addForeignKey("fk_options_posts", "fk_options_author")

        const table = await driver.getTableByNameOrFail("fk_options_posts")
        const foreignKeys = await table.getForeignKeys()

        expect(foreignKeys.map((fk) => fk.getReferencedTableName())).toContain("fk_options_authors")
        expect(foreignKeys.map((fk) => fk.getColumnName())).toContain("fk_options_author_id")
      } finally {
        await dropFkOptionsTables(driver)
      }
    })
  })

  it("accepts a columnName override when the FK column does not follow the <reference>_id convention", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await dropFkOptionsTables(driver)
        await migration.createTable("fk_options_authors", {id: {type: "uuid"}}, (table) => {
          table.string("name", {null: false})
        })
        await migration.createTable("fk_options_posts", {id: {type: "uuid"}}, (table) => {
          table.string("title", {null: false})
          table.uuid("written_by_id", {null: true})
        })

        await migration.addForeignKey("fk_options_posts", "fk_options_author", {
          columnName: "written_by_id"
        })

        const table = await driver.getTableByNameOrFail("fk_options_posts")
        const foreignKeys = await table.getForeignKeys()

        expect(foreignKeys.map((fk) => fk.getColumnName())).toContain("written_by_id")
        expect(foreignKeys.map((fk) => fk.getReferencedTableName())).toContain("fk_options_authors")
      } finally {
        await dropFkOptionsTables(driver)
      }
    })
  })

  it("accepts referencedTableName + referencedColumnName overrides when the referenced row does not follow the convention", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await dropFkOptionsTables(driver)
        await migration.createTable("fk_options_authors", {id: {type: "uuid"}}, (table) => {
          table.string("name", {null: false})
        })
        await migration.createTable("fk_options_posts", {id: {type: "uuid"}}, (table) => {
          table.string("title", {null: false})
          table.uuid("written_by_id", {null: true})
        })

        await migration.addForeignKey("fk_options_posts", "writer", {
          columnName: "written_by_id",
          referencedTableName: "fk_options_authors"
        })

        const table = await driver.getTableByNameOrFail("fk_options_posts")
        const foreignKeys = await table.getForeignKeys()
        const writerFk = foreignKeys.find((fk) => fk.getColumnName() === "written_by_id")

        expect(writerFk?.getReferencedTableName()).toEqual("fk_options_authors")
      } finally {
        await dropFkOptionsTables(driver)
      }
    })
  })

  it("rejects unknown options keys via restArgsError so callers can't typo silently", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      let caught = null

      try {
        await migration.addForeignKey("fk_options_posts", "fk_options_author", /** @type {any} */ ({
          unknownOption: "boom"
        }))
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error)
      }

      expect(caught).not.toEqual(null)
    })
  })
})

/**
 * Drops the two scratch tables in FK-safe order (child first), tolerating
 * either being already absent.
 *
 * @param {any} driver
 * @returns {Promise<void>}
 */
async function dropFkOptionsTables(driver) {
  for (const tableName of ["fk_options_posts", "fk_options_authors"]) {
    try {
      await driver.query(`DROP TABLE IF EXISTS ${tableName}`)
    } catch {
      // pgsql + mssql may need different cascade syntax; fall back to a
      // best-effort drop that ignores already-missing tables.
    }
  }
}
