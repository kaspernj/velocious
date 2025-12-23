import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - drivers - getTableByNameOrFail", () => {
  it("returns an existing table", async () => {
    await dummyConfiguration.ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("projects")

      expect(table.getName()).toBe("projects")
    })
  })

  it("throws when the table is missing", async () => {
    await dummyConfiguration.ensureConnections(async (dbs) => {
      await expect(async () => {
        await dbs.default.getTableByNameOrFail("non_existing_table_name")
      }).toThrowError(`Couldn't find a table by that name "non_existing_table_name" in: authentication_tokens, project_details, project_translations, projects, schema_migrations, tasks, users, uuid_items`)
    })
  })
})
