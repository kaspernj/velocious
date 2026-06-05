import Cli from "../../../../src/cli/index.js"
import DbDrop from "../../../../src/cli/commands/db/drop.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

class FakeDropDriver {
  static instances = []

  constructor() {
    this.closed = false
    this.connected = false
    FakeDropDriver.instances.push(this)
  }

  async connect() { this.connected = true }
  async close() { this.closed = true }
  dropDatabaseSql() { return ["DROP DATABASE fake"] }
}

function fakeMssqlDropConfiguration() {
  return {
    getDatabaseConfiguration: () => ({default: {database: "velocious_test"}}),
    getDatabaseIdentifiers: () => ["default"],
    getDatabasePool: () => ({
      getConfiguration: () => ({
        driver: FakeDropDriver,
        sqlConfig: {database: "velocious_test"},
        type: "mssql",
        useDatabase: "master"
      })
    }),
    getDatabaseType: () => "mssql",
    getEnvironment: () => "test",
    getEnvironmentHandler: () => ({})
  }
}

describe("Cli - Commands - db:drop", () => {
  it("generates SQL to drop an existing database", async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:drop"],
      testing: true
    })

    if (cli.getConfiguration().getDatabaseType() == "sqlite") {
      const result = await cli.execute()

      expect(result).toEqual([])
    } else if (cli.getConfiguration().getDatabaseType() == "mssql") {
      const result = await cli.execute()

      expect(result).toEqual(
        [
          {
            databaseName: "velocious_test",
            sql: "IF EXISTS(SELECT * FROM [sys].[databases] WHERE [name] = N'velocious_test') BEGIN DROP DATABASE [velocious_test] END"
          }
        ]
      )
    } else if (cli.getConfiguration().getDatabaseType() == "pgsql") {
      const result = await cli.execute()

      expect(result).toEqual(
        [
          {
            databaseName: "velocious_test",
            sql: 'DROP DATABASE IF EXISTS "velocious_test"'
          }
        ]
      )
    } else {
      const result = await cli.execute()

      expect(result).toEqual(
        [
          {
            databaseName: "velocious_test",
            sql: "DROP DATABASE IF EXISTS `velocious_test`"
          }
        ]
      )
    }
  })

  it("closes direct MSSQL connections after generating SQL", async () => {
    FakeDropDriver.instances = []
    const command = new DbDrop({
      args: {
        configuration: /** @type {import("../../../../src/configuration.js").default} */ (fakeMssqlDropConfiguration()),
        testing: true
      },
      cli: /** @type {import("../../../../src/cli/index.js").default} */ ({})
    })

    await command.execute()

    expect(FakeDropDriver.instances.length).toEqual(1)
    expect(FakeDropDriver.instances[0].connected).toBe(true)
    expect(FakeDropDriver.instances[0].closed).toBe(true)
  })
})
