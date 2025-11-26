import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import uniqunize from "uniqunize"

describe("Cli - Commands - db:rollback", () => {
  fit("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const cliMigrate = new Cli({
      directory,
      processArgs: ["db:migrate"],
      testing: true
    })

    await cliMigrate.loadConfiguration()

    const cliRollback = new Cli({
      directory,
      processArgs: ["db:rollback"],
      testing: true
    })

    await cliRollback.loadConfiguration()

    let defaultDatabaseType, defaultSchemaMigrations = [], projectForeignKey = [], tablesResult = []

    await cliRollback.configuration.ensureConnections(async (dbs) => {
      defaultDatabaseType = dbs.default.getType()

      await cliMigrate.execute()
      await cliRollback.execute()

      for (const dbIdentifier in dbs) {
        const db = dbs[dbIdentifier]
        const tables = await db.getTables()

        for (const table of tables) {
          tablesResult.push(table.getName())
        }

        const schemaMigrationsResult = await db.select("schema_migrations")

        for (const schemaMigrationResult of schemaMigrationsResult) {
          defaultSchemaMigrations.push(schemaMigrationResult.version)
        }
      }
    })

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

      expect(uniqunize(defaultSchemaMigrations.sort())).toEqual([
        "20230728075328",
        "20230728075329",
        "20250605133926",
        "20250903112845",
        "20250912183605",
        "20250912183606",
        "20250915085450",
        "20250916111330"
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
        "20250916111330"
      ])
    }
  })
})
