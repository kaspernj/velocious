import Dummy from "../../../dummy/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"

describe("SQLite driver - ignore auto indexes", () => {
  it("filters out sqlite_autoindex_* entries", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        const sqlite = dbs.default

        if (sqlite.getType() !== "sqlite") {
          // Skip when default DB isn't SQLite in this environment
          return
        }

        // Create a table with a unique index to provoke an autoindex entry
        await sqlite.query("DROP TABLE IF EXISTS autoindex_test")
        await sqlite.query("CREATE TABLE autoindex_test(id INTEGER PRIMARY KEY, name TEXT UNIQUE)")

        const table = await sqlite.getTableByName("autoindex_test")

        if (!table) throw new Error("autoindex_test table not found")

        const indexes = await table.getIndexes()
        const names = indexes.map((index) => index.getName())

        // Only the explicit UNIQUE index should be returned (no sqlite_autoindex_*)
        expect(names.every((name) => !name.startsWith("sqlite_autoindex_"))).toBeTrue()
      })
    })
  })
})
