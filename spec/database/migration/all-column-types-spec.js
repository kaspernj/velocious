// @ts-check

import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - column types", () => {
  it("creates all supported column types including bigint", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        const migration = new Migration({
          configuration: dummyConfiguration,
          databaseIdentifier: "default",
          db: dbs.default
        })

        await migration.createTable("all_column_types", (table) => {
          table.bigint("bigint_column")
          table.blob("blob_column")
          table.boolean("boolean_column")
          table.datetime("datetime_column")
          table.integer("integer_column")
          table.json("json_column")
          table.string("string_column")
          table.text("text_column")
          table.tinyint("tinyint_column")
          table.uuid("uuid_column")
          table.references("reference_column")
          table.timestamps()
        })

        const expectedColumns = [
          "id",
          "big_integer_column",
          "bigint_column",
          "blob_column",
          "boolean_column",
          "datetime_column",
          "integer_column",
          "json_column",
          "string_column",
          "text_column",
          "tinyint_column",
          "uuid_column",
          "reference_column_id",
          "created_at",
          "updated_at"
        ]

        for (const columnName of expectedColumns) {
          const exists = await migration.columnExists("all_column_types", columnName)
          expect(exists).toBe(true)
        }

        await migration.dropTable("all_column_types")
      })
    })
  })
})
