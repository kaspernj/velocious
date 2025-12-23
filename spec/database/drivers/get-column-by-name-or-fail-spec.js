import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - drivers - getColumnByNameOrFail", () => {
  it("returns an existing column", async () => {
    await dummyConfiguration.ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("projects")
      const column = await table.getColumnByNameOrFail("id")

      expect(column.getName()).toBe("id")
    })
  })

  it("throws when the column is missing", async () => {
    await dummyConfiguration.ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("projects")

      await expect(async () => {
        await table.getColumnByNameOrFail("non_existing_column_name")
      }).toThrowError(`Couldn't find a column by that name "non_existing_column_name"`)
    })
  })
})
