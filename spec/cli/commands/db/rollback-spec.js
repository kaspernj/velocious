import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import uniqunize from "uniqunize"

describe("Cli - Commands - db:rollback", () => {
  const internalTables = new Set([
    "background_job_concurrency",
    "background_jobs",
    "velocious_attachments",
    "velocious_internal_migrations",
    "velocious_server_sequences",
    "velocious_sync_scopes",
    "websocket_channel_events",
    "websocket_replay_channels"
  ])
  const dropExtraTables = async (configuration) => {
    await configuration.ensureConnections(async (dbs) => {
      const tableNames = ["autoindex_test", "uuid_default_test"]

      const dropTables = async (db) => {
        await db.withDisabledForeignKeys(async () => {
          for (const tableName of tableNames) {
            await db.dropTable(tableName, {cascade: true, ifExists: true})
          }
        })
      }

      for (const db of Object.values(dbs)) {
        await dropTables(db)
      }
    })
  }

  const runMigrations = async () => {
    const cliMigrate = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })

    await dropExtraTables(cliMigrate.configuration)
    await cliMigrate.execute()
  }

  // This test rolls the shared dummy DB back (dropping tables). Always restore it
  // afterwards — even if an assertion throws before the in-test re-migrate — so a
  // rolled-back DB never poisons later tests' truncate cleanup (missing-table cascade).
  afterEach(async () => {
    await runMigrations()
  })

  const getTestData = async () => {
    const cliRollback = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:rollback"],
      testing: true
    })

    let defaultSchemaMigrations = [], tablesResult = [], databaseIdentifiers = []

    await cliRollback.configuration.ensureConnections(async (dbs) => {
      databaseIdentifiers = Object.keys(dbs)

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

    return {databaseIdentifiers, defaultSchemaMigrations, tablesResult}
  }

  const syncEntriesColumnNames = async (configuration) => {
    let columnNames = []

    await configuration.ensureConnections(async (dbs) => {
      const syncEntriesTable = await dbs.default.getTableByName("sync_entries")

      if (!syncEntriesTable) throw new Error("sync_entries table not found")

      columnNames = (await syncEntriesTable.getColumns()).map((column) => column.getName())
    })

    return columnNames
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

    const {databaseIdentifiers, defaultSchemaMigrations, tablesResult} = await getTestData()

    const filteredTables = tablesResult.filter((tableName) => !internalTables.has(tableName))
    const expectedRolledBackTables = [
      ...(databaseIdentifiers.includes("mssql") ? ["accounts"] : []),
      "acts_as_list_items",
      "audit_actions",
      "audit_auditable_types",
      "audits",
      "authentication_tokens",
      "comments",
      "interactions",
      "project_details",
      "project_translations",
      "projects",
      "schema_migrations",
      "string_subject_interactions",
      "string_subjects",
      "sync_entries",
      "tasks",
      "users",
      "uuid_interactions",
      "uuid_items"
    ]
    const expectedRolledBackMigrations = [
      "20230728075328",
      "20230728075329",
      "20250605133926",
      ...(databaseIdentifiers.includes("mssql") ? ["20250903112845"] : []),
      "20250912183605",
      "20250912183606",
      "20250915085450",
      "20250916111330",
      "20250921121002",
      "20251223194400",
      "20251223210800",
      "20251223214200",
      "20251225230806",
      "20251228090000",
      "20251228090010",
      "20260418090000",
      "20260601052206",
      "20260629160000",
      "20260702150000"
    ]

    expect(uniqunize(filteredTables.sort())).toEqual(expectedRolledBackTables)

    expect(uniqunize(defaultSchemaMigrations.sort())).toEqual(expectedRolledBackMigrations)

    // Rolling back one step reverts 20260706120000-add-project-id-to-sync-entries: the table stays, the column goes.
    expect(await syncEntriesColumnNames(cliRollback.configuration)).not.toContain("project_id")

    await runMigrations()

    const {defaultSchemaMigrations: newDefaultSchemaMigrations, tablesResult: newTablesResult} = await getTestData()
    const filteredNewTablesResult = newTablesResult.filter((tableName) => !internalTables.has(tableName))
    const expectedMigratedTables = [...expectedRolledBackTables].sort()
    const expectedMigratedMigrations = [...expectedRolledBackMigrations, "20260706120000"].sort()

    expect(uniqunize(filteredNewTablesResult.sort())).toEqual(expectedMigratedTables)

    expect(uniqunize(newDefaultSchemaMigrations.sort())).toEqual(expectedMigratedMigrations)

    expect(await syncEntriesColumnNames(cliRollback.configuration)).toContain("project_id")
  })
})
