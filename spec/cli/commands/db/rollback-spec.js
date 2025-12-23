import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import uniqunize from "uniqunize"

describe("Cli - Commands - db:rollback", () => {
  const runMigrations = async () => {
    const cliMigrate = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })

    await cliMigrate.execute()
  }

  const getTestData = async () => {
    const cliRollback = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:rollback"],
      testing: true
    })

    let defaultDatabaseType, defaultSchemaMigrations = [], tablesResult = []

    await cliRollback.configuration.ensureConnections(async (dbs) => {
      defaultDatabaseType = dbs.default.getType()

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

    return {defaultDatabaseType, defaultSchemaMigrations, tablesResult}
  }

  it("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()

    await runMigrations()

    const cliRollback = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:rollback"],
      testing: true
    })

    await cliRollback.configuration.ensureConnections(async () => {
      await runMigrations()
      await cliRollback.execute()
    })

    const {defaultDatabaseType, defaultSchemaMigrations, tablesResult} = await getTestData()

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
          "users",
          "uuid_items"
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
        "20250921121002",
        "20251223194400"
      ])
    } else {
      expect(tablesResult.sort()).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "project_details",
          "project_translations",
          "projects",
          "schema_migrations",
          "schema_migrations",
          "tasks",
          "users",
          "uuid_items"
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
        "20250921121002",
        "20251223194400"
      ])
    }

    await runMigrations()

    const {defaultSchemaMigrations: newDefaultSchemaMigrations, tablesResult: newTablesResult} = await getTestData()

    if (defaultDatabaseType == "mssql") {
      expect(uniqunize(newTablesResult.sort())).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "interactions",
          "project_details",
          "project_translations",
          "projects",
          "schema_migrations",
          "tasks",
          "users",
          "uuid_items"
        ]
      )

      expect(uniqunize(newDefaultSchemaMigrations.sort())).toEqual([
        "20230728075328",
        "20230728075329",
        "20250605133926",
        "20250903112845",
        "20250912183605",
        "20250912183606",
        "20250915085450",
        "20250916111330",
        "20250921121002",
        "20251223194400",
        "20251223210800"
      ])
    } else {
      expect(newTablesResult.sort()).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "interactions",
          "project_details",
          "project_translations",
          "projects",
          "schema_migrations",
          "schema_migrations",
          "tasks",
          "users",
          "uuid_items"
        ]
      )

      expect(newDefaultSchemaMigrations.sort()).toEqual([
        "20230728075328",
        "20230728075329",
        "20250605133926",
        "20250903112845",
        "20250912183605",
        "20250912183606",
        "20250915085450",
        "20250916111330",
        "20250921121002",
        "20251223194400",
        "20251223210800"
      ])
    }
  })
})
