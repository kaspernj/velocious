import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

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
})
