import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - drivers - getColumnByNameOrFail", {tags: ["dummy"]}, () => {
  it("returns an existing column", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("projects")
      const column = await table.getColumnByNameOrFail("id")

      expect(column.getName()).toBe("id")
    })
  })

  it("throws when the column is missing", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("projects")

      await expect(async () => {
        await table.getColumnByNameOrFail("non_existing_column_name")
      }).toThrowError(`Couldn't find a column by that name "non_existing_column_name"`)
    })
  })
})
