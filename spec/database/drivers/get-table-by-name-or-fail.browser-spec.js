import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - drivers - getTableByNameOrFail", {tags: ["dummy"]}, () => {
  it("returns an existing table", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("projects")

      expect(table.getName()).toBe("projects")
    })
  })

  it("throws when the table is missing", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      let error

      try {
        await dbs.default.getTableByNameOrFail("non_existing_table_name")
      } catch (err) {
        error = err
      }

      expect(error).toBeDefined()

      if (error instanceof Error) {
        expect(error.message).toMatch(/Couldn't find a table by that name/)
        expect(error.message).toMatch(/non_existing_table_name/)
      } else {
        throw new Error(`Expected an Error but got: ${typeof error}`)
      }
    })
  })
})
