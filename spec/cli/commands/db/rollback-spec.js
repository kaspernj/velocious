import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import uniqunize from "uniqunize"

describe("Cli - Commands - db:rollback", () => {
  fit("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      directory,
      processArgs: ["db:rollback"],
      testing: true
    })

    await cli.loadConfiguration()

    let defaultDatabaseType, defaultSchemaMigrations = [], projectForeignKey = [], tablesResult = []

    await cli.configuration.ensureConnections(async (dbs) => {
      defaultDatabaseType = dbs.default.getType()

      await cli.execute()

      // It creates foreign keys
      const tasksTable = await dbs.default.getTableByName("tasks")
      const foreignKeys = await tasksTable.getForeignKeys()

      for (const foreignKey of foreignKeys) {
        if (foreignKey.getColumnName() == "project_id") {
          projectForeignKey = foreignKey
        }
      }

      // It creates the correct index
      const authenticationTokensTable = await dbs.default.getTableByName("authentication_tokens")
      const indexes = await authenticationTokensTable.getIndexes()
      const indexesNames = indexes
        .map((index) => index.getName())
        .filter((indexName) => indexName != "authentication_tokens_pkey" && indexName != "PRIMARY" && !indexName.startsWith("PK__"))
        .sort()

      if (defaultDatabaseType == "mysql") {
        expect(indexesNames).toEqual(["index_on_token","user_id"])
      } else if (defaultDatabaseType == "sqlite") {
        expect(indexesNames).toEqual(["index_on_authentication_tokens_token", "index_on_authentication_tokens_user_id"])
      } else {
        expect(indexesNames).toEqual(["index_on_token", "index_on_user_id"])
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
          "project_details",
          "project_translations",
          "projects",
          "schema_migrations",
          "tasks",
          "users"
        ]
      )

      expect(uniqunize(defaultSchemaMigrations.sort())).toEqual([
        "20230728075328",
        "20230728075329",
        "20250605133926",
        "20250903112845",
        "20250912183605",
        "20250912183606",
        "20250915085450",
        "20250916111330",
        "20250921121002"
      ])
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

      expect(defaultSchemaMigrations.sort()).toEqual([
        "20230728075328",
        "20230728075329",
        "20250605133926",
        "20250903112845",
        "20250912183605",
        "20250912183606",
        "20250915085450",
        "20250916111330",
        "20250921121002"
      ])
    }
  })
})
