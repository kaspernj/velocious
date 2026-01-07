// @ts-check

import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import path from "path"
import uniqunize from "uniqunize"

describe("Cli - Commands - db:migrate", () => {
  /**
   * @param {string} statement
   * @returns {string}
   */
  function normalizeSqlStatement(statement) {
    const trimmed = statement.trim()

    if (!trimmed) return ""

    if (trimmed.endsWith(";")) return trimmed

    return `${trimmed};`
  }

  it("runs migrations", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })

    let defaultDatabaseType

    /** @type {string[]} */
    const defaultSchemaMigrations = []

    /** @type {string[]} */
    const tablesResult = []

    /** @type {import("../../../../src/database/drivers/base-foreign-key.js").default | undefined} */
    let projectForeignKey

    await cli.getConfiguration().ensureConnections(async (dbs) => {
      defaultDatabaseType = dbs.default.getType()

      const tableNames = [
        "accounts",
        "authentication_tokens",
        "autoindex_test",
        "comments",
        "interactions",
        "project_details",
        "project_translations",
        "projects",
        "schema_migrations",
        "string_subject_interactions",
        "string_subjects",
        "tasks",
        "users",
        "uuid_default_test",
        "uuid_interactions",
        "uuid_items"
      ]

      for (const tableName of tableNames) {
        await dbs.default.dropTable(tableName, {cascade: true, ifExists: true})

        if (dbs.default.getType() != "mssql") {
          await dbs.mssql.dropTable(tableName, {cascade: true, ifExists: true})
        }
      }

      await cli.execute()

      // It creates foreign keys
      const tasksTable = await dbs.default.getTableByName("tasks")

      if (!tasksTable) throw new Error("tasks table not found")

      const foreignKeys = await tasksTable.getForeignKeys()

      for (const foreignKey of foreignKeys) {
        if (foreignKey.getColumnName() == "project_id") {
          projectForeignKey = foreignKey
        }
      }

      // It creates the correct index
      const authenticationTokensTable = await dbs.default.getTableByName("authentication_tokens")

      if (!authenticationTokensTable) throw new Error("authentication_tokens table not found")

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

      // It creates unique indexes
      let tokenIndexName

      if (defaultDatabaseType == "sqlite") {
        tokenIndexName = "index_on_authentication_tokens_token"
      } else {
        tokenIndexName = "index_on_token"
      }

      const tokenColumn = await authenticationTokensTable.getColumnByName("user_token")

      if (!tokenColumn) throw new Error("Token column not found")

      const tokenIndex = await tokenColumn.getIndexByName(tokenIndexName)

      if (!tokenIndex) throw new Error("Token index not found")

      expect(tokenIndex.getName()).toEqual(tokenIndexName)
      expect(tokenIndex.isPrimaryKey()).toBeFalse()
      expect(tokenIndex.isUnique()).toBeTrue()

      // It creates foreign keys
      const authTokensTableForeignKeys = await authenticationTokensTable.getForeignKeys()

      expect(authTokensTableForeignKeys.length).toEqual(1)

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

    if (!projectForeignKey) throw new Error("Project foreign key not found")

    expect(projectForeignKey.getTableName()).toEqual("tasks")
    expect(projectForeignKey.getColumnName()).toEqual("project_id")
    expect(projectForeignKey.getReferencedTableName()).toEqual("projects")
    expect(projectForeignKey.getReferencedColumnName()).toEqual("id")

    if (defaultDatabaseType == "mssql") {
      expect(uniqunize(tablesResult.sort())).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "comments",
          "interactions",
          "project_details",
          "project_translations",
          "projects",
          "schema_migrations",
          "string_subject_interactions",
          "string_subjects",
          "tasks",
          "users",
          "uuid_interactions",
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
        "20251223194400",
        "20251223210800",
        "20251223214200",
        "20251225230806",
        "20251228090000",
        "20251228090010"
      ])
    } else {
      expect(tablesResult.sort()).toEqual(
        [
          "accounts",
          "authentication_tokens",
          "comments",
          "interactions",
          "project_details",
          "project_translations",
          "projects",
          "schema_migrations",
          "schema_migrations",
          "string_subject_interactions",
          "string_subjects",
          "tasks",
          "users",
          "uuid_interactions",
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
        "20251223194400",
        "20251223210800",
        "20251223214200",
        "20251225230806",
        "20251228090000",
        "20251228090010"
      ])
    }
  })

  it("writes structure sql for sqlite", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })

    if (cli.getConfiguration().getDatabaseType("default") != "sqlite") {
      console.warn(`Skipping structure sql assertion: default database is ${cli.getConfiguration().getDatabaseType("default")}`)
      return
    }

    await cli.getConfiguration().ensureConnections(async (dbs) => {
      await cli.execute()

      const structurePath = path.join(directory, "db", "structure-default.sql")
      const actual = await fs.readFile(structurePath, "utf8")
      const rows = await dbs.default.query("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
      const expected = rows
        .map((row) => row.sql)
        .filter((statement) => Boolean(statement))
        .map((statement) => normalizeSqlStatement(statement))
        .filter((statement) => Boolean(statement))
        .join("\n\n") + "\n"

      expect(actual).toEqual(expected)
    })
  })
})
