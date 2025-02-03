import Cli from "../../../../src/cli/index.mjs"
import dummyDirectory from "../../../dummy/dummy-directory.mjs"

describe("Cli - Commands - db:create", () => {
  it("generates SQL to create a new database", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["db:create"],
      testing: true
    })
    const result = await cli.execute()

    expect(result).toEqual(
      [
        {
          databaseName: 'velocious_test',
          sql: 'CREATE DATABASE IF NOT EXISTS `velocious_test`'
        },
        {
          createSchemaMigrationsTableSql: 'CREATE TABLE IF NOT EXISTS schema_migrations (`version` varchar(255) PRIMARY KEY)'
        }
      ]
    )
  })
})
