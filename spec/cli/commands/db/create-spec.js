import Cli from "../../../../src/cli/index.js"
import DbCreate from "../../../../src/cli/commands/db/create.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

class FakeCreateDriver {
  static instances = []
  static failConnect = false

  constructor() {
    this.closed = false
    this.connected = false
    FakeCreateDriver.instances.push(this)
  }

  async connect() {
    this.connected = true

    if (FakeCreateDriver.failConnect) throw new Error("Connect failed")
  }

  async close() { this.closed = true }
  createDatabaseSql() { return ["CREATE DATABASE fake"] }
  async createTableSql() { return ["CREATE TABLE fake"] }

  static reset() {
    this.failConnect = false
    this.instances = []
  }
}

function fakeMssqlCreateConfiguration() {
  return {
    getDatabaseConfiguration: () => ({default: {database: "velocious_test"}}),
    getDatabaseIdentifiers: () => ["default"],
    getDatabasePool: () => ({
      getConfiguration: () => ({
        driver: FakeCreateDriver,
        sqlConfig: {database: "velocious_test"},
        type: "mssql",
        useDatabase: "master"
      })
    }),
    getDatabaseType: () => "mssql",
    getEnvironmentHandler: () => ({})
  }
}

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

  it("closes direct MSSQL connections after generating SQL", async () => {
    FakeCreateDriver.reset()
    const command = new DbCreate({
      args: {
        configuration: /** @type {import("../../../../src/configuration.js").default} */ (fakeMssqlCreateConfiguration()),
        testing: true
      },
      cli: /** @type {import("../../../../src/cli/index.js").default} */ ({})
    })

    await command.execute()

    expect(FakeCreateDriver.instances.length).toEqual(1)
    expect(FakeCreateDriver.instances[0].connected).toBe(true)
    expect(FakeCreateDriver.instances[0].closed).toBe(true)
  })

  it("closes direct MSSQL connections when connect fails", async () => {
    FakeCreateDriver.reset()
    FakeCreateDriver.failConnect = true
    const command = new DbCreate({
      args: {
        configuration: /** @type {import("../../../../src/configuration.js").default} */ (fakeMssqlCreateConfiguration()),
        testing: true
      },
      cli: /** @type {import("../../../../src/cli/index.js").default} */ ({})
    })

    const error = await command.execute().then(
      () => undefined,
      (caughtError) => caughtError
    )

    expect(error.message).toEqual("Connect failed")
    expect(FakeCreateDriver.instances.length).toEqual(1)
    expect(FakeCreateDriver.instances[0].connected).toBe(true)
    expect(FakeCreateDriver.instances[0].closed).toBe(true)
  })
})
