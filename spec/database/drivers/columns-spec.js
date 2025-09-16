import dummyConfiguration from "../../dummy/src/config/configuration.js"

describe("database - drivers - columns", () => {
  it("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    await dummyConfiguration.ensureConnections(async (dbs) => {
      // Authentication tokens table is important because it will be totally re-created in SQLite because the renaming of the token column to user-column
      const authenticationTokensTable = await dbs.default.getTableByName("authentication_tokens")
      const authenticationTokensIDColumn = await authenticationTokensTable.getColumnByName("id")

      expect(authenticationTokensIDColumn.getAutoIncrement()).toBeTrue()
      expect(authenticationTokensIDColumn.getPrimaryKey()).toBeTrue()
      expect(authenticationTokensIDColumn.getNull()).toBeFalse()

      const projectsTable = await dbs.default.getTableByName("projects")
      const projectsCreatedAtColumn = await projectsTable.getColumnByName("created_at")
      const projectsIDColumn = await projectsTable.getColumnByName("id")

      expect(projectsIDColumn.getAutoIncrement()).toBeTrue()
      expect(projectsIDColumn.getPrimaryKey()).toBeTrue()
      expect(projectsIDColumn.getNull()).toBeFalse()

      expect(projectsCreatedAtColumn.getAutoIncrement()).toBeFalse()
      expect(projectsCreatedAtColumn.getPrimaryKey()).toBeFalse()
      expect(projectsCreatedAtColumn.getNull()).toBeTrue()
    })
  })
})
