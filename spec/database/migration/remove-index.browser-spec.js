// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - removeIndex", {tags: ["dummy"]}, () => {
  it("removes an existing index by name", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await driver.dropTable("remove_index_widgets", {cascade: true, ifExists: true})
        await migration.createTable("remove_index_widgets", (table) => {
          table.string("name", {null: false})
        })
        await migration.addIndex("remove_index_widgets", ["name"], {name: "index_remove_index_widgets_on_name"})

        const tableWithIndex = await driver.getTableByNameOrFail("remove_index_widgets")
        expect((await tableWithIndex.getIndexes()).map((index) => index.getName())).toContain("index_remove_index_widgets_on_name")

        await migration.removeIndex("remove_index_widgets", "index_remove_index_widgets_on_name")

        const tableWithoutIndex = await driver.getTableByNameOrFail("remove_index_widgets")
        expect((await tableWithoutIndex.getIndexes()).map((index) => index.getName())).not.toContain("index_remove_index_widgets_on_name")
      } finally {
        await driver.dropTable("remove_index_widgets", {cascade: true, ifExists: true})
      }
    })
  })
})
