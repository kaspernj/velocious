import Configuration from "../../../src/configuration.js"

describe("Migration - SQLite UUID default", {tags: ["dummy"]}, () => {
  it("does not set UUID() as default for UUID primary keys on SQLite", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const sqlite = dbs.default

      if (sqlite.getType() !== "sqlite") {
        // Skip when default DB isn't SQLite in this environment
        return
      }

      await sqlite.query("DROP TABLE IF EXISTS uuid_default_test")
      await sqlite.query("CREATE TABLE uuid_default_test(id UUID PRIMARY KEY, name TEXT)")

      const table = await sqlite.getTableByNameOrFail("uuid_default_test")
      const columns = await table.getColumns()
      const idColumn = columns.find((column) => column.getName() === "id")

      if (!idColumn) throw new Error("id column not found")

      // SQLite driver should not set a database-side UUID() default; insert must supply the value
      const defaultValue = idColumn.getDefault()

      // Should not set database-side UUID() default; SQLite reports null when no default is present
      expect(defaultValue).toBeNull()
    })
  })
})
