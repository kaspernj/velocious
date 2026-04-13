import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

describe("Cli - Commands - db:create", () => {
  it("generates SQL to create a new database", async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:create"],
      testing: true
    })

    const result = await cli.execute()

    if (cli.getConfiguration().getDatabaseType() == "sqlite") {
      expect(result).toEqual(
        [
          {
            createSchemaMigrationsTableSql: 'CREATE TABLE IF NOT EXISTS `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL)'
          }
        ]
      )
    } else if (cli.getConfiguration().getDatabaseType() == "mssql") {
      expect(result).toEqual(
        [
          {
            databaseName: 'velocious_test',
            sql: "IF NOT EXISTS(SELECT * FROM [sys].[databases] WHERE [name] = N'velocious_test') BEGIN CREATE DATABASE [velocious_test] END"
          },
          {
            createSchemaMigrationsTableSql: "IF NOT EXISTS(SELECT * FROM [sysobjects] WHERE [name] = N'schema_migrations' AND [xtype] = 'U') BEGIN CREATE TABLE [schema_migrations] ([version] NVARCHAR(255) PRIMARY KEY NOT NULL) END"
          }
        ]
      )
    } else if (cli.getConfiguration().getDatabaseType() == "pgsql") {
      expect(result[2]).toEqual(
        {
          createSchemaMigrationsTableSql: 'CREATE TABLE IF NOT EXISTS "schema_migrations" ("version" VARCHAR(255) PRIMARY KEY NOT NULL)'
        }
      )
    } else {
      expect(result).toEqual(
        [
          {
            databaseName: 'velocious_test',
            sql: 'CREATE DATABASE IF NOT EXISTS `velocious_test`'
          },
          {
            createSchemaMigrationsTableSql: 'CREATE TABLE IF NOT EXISTS `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
          }
        ]
      )
    }
  })
})
