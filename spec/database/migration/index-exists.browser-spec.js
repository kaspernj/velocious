// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - indexExists", {tags: ["dummy"]}, () => {
  it("checks if an index exists", async () => {
    const configuration = Configuration.current()
    await configuration.ensureConnections(async (dbs) => {
      const migration = new Migration({
        configuration,
        databaseIdentifier: "default",
        db: dbs.default
      })

      // Resolve a real index name through the driver so the assertion holds
      // across databases with different auto-generated index names.
      const table = await dbs.default.getTableByNameOrFail("authentication_tokens")
      const indexes = await table.getIndexes()

      expect(indexes.length).toBeGreaterThan(0)

      const existingIndexExists = await migration.indexExists("authentication_tokens", indexes[0].getName())

      expect(existingIndexExists).toBe(true)

      const missingIndexExists = await migration.indexExists("authentication_tokens", "some_non_existing_index")

      expect(missingIndexExists).toBe(false)

      const missingTableIndexExists = await migration.indexExists("some_non_existing_table", "some_non_existing_index")

      expect(missingTableIndexExists).toBe(false)
    })
  })
})
