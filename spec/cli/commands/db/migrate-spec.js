import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import uniqunize from "uniqunize"

describe("Cli - Commands - db:migrate", () => {
  it("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      directory,
      processArgs: ["db:migrate"],
      testing: true
    })

    await cli.loadConfiguration()

    let defaultDatabaseType, defaultSchemaMigrations = [], projectForeignKey = [], tablesResult = []

    await cli.configuration.ensureConnections(async (dbs) => {
      defaultDatabaseType = dbs.default.getType()

      const tableNames = ["accounts", "authentication_tokens", "tasks", "project_translations", "projects", "schema_migrations", "users"]

      for (const tableName of tableNames) {
        await dbs.default.dropTable(tableName, {cascade: true, ifExists: true})

        if (dbs.default.getType() != "mssql") {
          await dbs.mssql.dropTable(tableName, {cascade: true, ifExists: true})
        }
      }

      await cli.execute()

      // It creates foreign keys
      const tasksTable = await dbs.default.getTableByName("tasks")
      const foreignKeys = await tasksTable.getForeignKeys()

      for (const foreignKey of foreignKeys) {
        if (foreignKey.getColumnName() == "project_id") {
          projectForeignKey = foreignKey
        }
      }

      // It creates unique indexes
      const authenticationTokensTable = await dbs.default.getTableByName("authentication_tokens")
      const tokenColumn = await authenticationTokensTable.getColumnByName("token")
      const tokenIndex = await tokenColumn.getIndexByName("index_on_token")

      expect(tokenIndex.getName()).toEqual("index_on_token")
      expect(tokenIndex.isPrimaryKey()).toBeFalse()
      expect(tokenIndex.isUnique()).toBeTrue()

      for (const db of Object.values(dbs)) {
        const schemaMigrations = await db.query("SELECT * FROM schema_migrations ORDER BY version")

        for (const schemaMigration of schemaMigrations) {
          defaultSchemaMigrations.push(schemaMigration.version)
        }

        const tables = await db.getTables()

        for (const table of tables) {
          tablesResult.push(table.getName())
        }
      }
    })



    expect(projectForeignKey.getTableName()).toEqual("tasks")
    expect(projectForeignKey.getColumnName()).toEqual("project_id")
    expect(projectForeignKey.getReferencedTableName()).toEqual("projects")
    expect(projectForeignKey.getReferencedColumnName()).toEqual("id")

    if (defaultDatabaseType == "mssql") {
      expect(uniqunize(tablesResult.sort())).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "project_translations",
          "projects",
          "schema_migrations",
          "tasks",
          "users"
        ]
      )

      expect(uniqunize(defaultSchemaMigrations.sort())).toEqual(["20230728075328", "20230728075329", "20250605133926", "20250903112845", "20250912183605", "20250912183606"])
    } else {
      expect(tablesResult.sort()).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "project_translations",
          "projects",
          "schema_migrations",
          "schema_migrations",
          "tasks",
          "users"
        ]
      )

      expect(defaultSchemaMigrations.sort()).toEqual(["20230728075328", "20230728075329", "20250605133926", "20250903112845", "20250912183605", "20250912183606"])
    }
  })
})
