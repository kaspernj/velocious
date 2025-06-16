import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"

describe("Cli - Commands - db:create", () => {
  it("generates SQL to create a new database", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["db:create"],
      testing: true
    })
    const result = await cli.execute()

    if (cli.getConfiguration().getDatabaseType() == "sqlite") {
      expect(result).toEqual(
        [
          {
            createSchemaMigrationsTableSql: 'CREATE TABLE IF NOT EXISTS schema_migrations (`version` VARCHAR(255) PRIMARY KEY NOT NULL)'
          }
        ]
      )
    } else {
      expect(result).toEqual(
        [
          {
            databaseName: 'velocious_test',
            sql: 'CREATE DATABASE IF NOT EXISTS `velocious_test`'
          },
          {
            createSchemaMigrationsTableSql: 'CREATE TABLE IF NOT EXISTS schema_migrations (`version` VARCHAR(255) PRIMARY KEY NOT NULL)'
          }
        ]
      )
    }
  })
})
