// @ts-check

import Configuration from "../../../src/configuration.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - removeForeignKey", {tags: ["dummy"]}, () => {
  it("removes the requested foreign key without removing its column or ordinary index", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const parentTableName = "remove_foreign_key_custom_writers"
      const childTableName = "remove_foreign_key_custom_articles"

      try {
        await dropRemoveForeignKeyTables(driver, childTableName, [parentTableName])
        await migration.createTable(parentTableName, {id: {type: "uuid"}})
        await migration.createTable(childTableName, {id: {type: "uuid"}}, (table) => {
          table.uuid("writer_id", {null: true})
        })
        await migration.addIndex(childTableName, ["writer_id"], {name: "index_remove_foreign_key_custom_articles_on_writer_id"})
        await migration.addForeignKey(childTableName, "author", {
          columnName: "writer_id",
          name: "fk_custom_writer",
          referencedColumnName: "id",
          referencedTableName: parentTableName
        })

        const tableWithForeignKey = await driver.getTableByNameOrFail(childTableName)
        const foreignKeys = await tableWithForeignKey.getForeignKeys()

        expect(foreignKeys.map((foreignKey) => foreignKey.getColumnName())).toContain("writer_id")

        await migration.removeForeignKey(childTableName, "author", {columnName: "writer_id"})

        const tableWithoutForeignKey = await driver.getTableByNameOrFail(childTableName)
        const columnNames = (await tableWithoutForeignKey.getColumns()).map((column) => column.getName())
        const indexNames = (await tableWithoutForeignKey.getIndexes()).map((index) => index.getName())
        const remainingForeignKeys = await tableWithoutForeignKey.getForeignKeys()

        expect(columnNames).toContain("writer_id")
        expect(indexNames).toContain("index_remove_foreign_key_custom_articles_on_writer_id")
        expect(remainingForeignKeys.map((foreignKey) => foreignKey.getColumnName())).not.toContain("writer_id")
      } finally {
        await dropRemoveForeignKeyTables(driver, childTableName, [parentTableName])
      }
    })
  })

  it("removes every foreign key on the requested column after each SQLite rebuild", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const authorTableName = "remove_foreign_key_multi_authors"
      const editorTableName = "remove_foreign_key_multi_editors"
      const childTableName = "remove_foreign_key_multi_articles"

      try {
        await dropRemoveForeignKeyTables(driver, childTableName, [authorTableName, editorTableName])
        await migration.createTable(authorTableName, {id: {type: "uuid"}})
        await migration.createTable(editorTableName, {id: {type: "uuid"}})
        await migration.createTable(childTableName, {id: {type: "uuid"}}, (table) => {
          table.uuid("writer_id", {null: true})
        })
        await migration.addForeignKey(childTableName, "author", {
          columnName: "writer_id",
          name: "fk_remove_foreign_key_multi_author",
          referencedTableName: authorTableName
        })
        await migration.addForeignKey(childTableName, "editor", {
          columnName: "writer_id",
          name: "fk_remove_foreign_key_multi_editor",
          referencedTableName: editorTableName
        })

        const tableWithForeignKeys = await driver.getTableByNameOrFail(childTableName)

        expect((await tableWithForeignKeys.getForeignKeys()).filter((foreignKey) => foreignKey.getColumnName() === "writer_id")).toHaveLength(2)

        await migration.removeForeignKey(childTableName, "author", {columnName: "writer_id"})

        const tableWithoutForeignKeys = await driver.getTableByNameOrFail(childTableName)
        const remainingForeignKeys = await tableWithoutForeignKeys.getForeignKeys()

        expect(remainingForeignKeys.map((foreignKey) => foreignKey.getColumnName())).not.toContain("writer_id")
      } finally {
        await dropRemoveForeignKeyTables(driver, childTableName, [authorTableName, editorTableName])
      }
    })
  })
})

/**
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @param {string} childTableName - Child table name.
 * @param {string[]} parentTableNames - Parent table names.
 * @returns {Promise<void>}
 */
async function dropRemoveForeignKeyTables(driver, childTableName, parentTableNames) {
  await driver.dropTable(`${childTableName}_velocious_rebuild`, {cascade: true, ifExists: true})
  await driver.dropTable(childTableName, {cascade: true, ifExists: true})

  for (const parentTableName of parentTableNames) {
    await driver.dropTable(parentTableName, {cascade: true, ifExists: true})
  }
}
