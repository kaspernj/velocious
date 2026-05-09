// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - addColumn on referenced table", {tags: ["dummy"]}, () => {
  it("adds a column to a parent table that is already referenced by a child foreign key", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await dropAddColumnReferencedTableFixtures(driver)

        await migration.createTable("fk_add_column_parents", {id: {type: "uuid"}}, (table) => {
          table.string("name", {null: false})
        })
        await migration.createTable("fk_add_column_children", {id: {type: "uuid"}}, (table) => {
          table.uuid("fk_add_column_parent_id", {null: true})
        })
        await migration.addForeignKey("fk_add_column_children", "fk_add_column_parent")

        await migration.addColumn("fk_add_column_parents", "payload_digest", "string", {maxLength: 64})

        const table = await driver.getTableByNameOrFail("fk_add_column_parents")
        const addedColumn = await table.getColumnByNameOrFail("payload_digest")

        expect(addedColumn.getMaxLength()).toEqual(64)
      } finally {
        await dropAddColumnReferencedTableFixtures(driver)
      }
    })
  })
})

/**
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @returns {Promise<void>}
 */
async function dropAddColumnReferencedTableFixtures(driver) {
  for (const tableName of ["fk_add_column_children", "fk_add_column_parents"]) {
    await driver.dropTable(tableName, {cascade: true, ifExists: true})
  }
}
