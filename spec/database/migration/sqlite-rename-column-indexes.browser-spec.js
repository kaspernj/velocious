// @ts-check

import Configuration from "../../../src/configuration.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - SQLite rename column indexes", {tags: ["dummy"]}, () => {
  it("preserves ordinary and unique indexes with their renamed ordered columns", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      if (driver.getType() !== "sqlite") return

      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const tableName = "rename_column_indexes_tasks"

      try {
        await dropRenameColumnIndexesTable(driver, tableName)
        await migration.createTable(tableName, {id: {type: "uuid"}}, (table) => {
          table.string("state", {null: false})
          table.string("category", {null: false})
          table.string("slug", {null: false})
        })
        await migration.addIndex(tableName, ["state", "category"], {name: "index_sqlite_rename_tasks_on_state_and_category"})
        await migration.addIndex(tableName, ["category", "slug"], {name: "index_sqlite_rename_tasks_on_category_and_slug", unique: true})

        await migration.renameColumn(tableName, "state", "status")
        await migration.renameColumn(tableName, "category", "classification")

        const table = await driver.getTableByNameOrFail(tableName)
        const indexes = await table.getIndexes()
        const ordinaryIndex = indexes.find((index) => index.getName() === "index_sqlite_rename_tasks_on_state_and_category")
        const uniqueIndex = indexes.find((index) => index.getName() === "index_sqlite_rename_tasks_on_category_and_slug")

        expect(ordinaryIndex?.getColumnNames()).toEqual(["status", "classification"])
        expect(ordinaryIndex?.isUnique()).toBe(false)
        expect(uniqueIndex?.getColumnNames()).toEqual(["classification", "slug"])
        expect(uniqueIndex?.isUnique()).toBe(true)
      } finally {
        await dropRenameColumnIndexesTable(driver, tableName)
      }
    })
  })
})

/**
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @param {string} tableName - Scratch table name.
 * @returns {Promise<void>}
 */
async function dropRenameColumnIndexesTable(driver, tableName) {
  await driver.dropTable(`${tableName}_velocious_rebuild`, {cascade: true, ifExists: true})
  await driver.dropTable(tableName, {cascade: true, ifExists: true})
}
