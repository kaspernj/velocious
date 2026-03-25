// @ts-check

import Cli from "../../../../../src/cli/index.js"
import Configuration from "../../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../../../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../../../../src/database/drivers/sqlite/index.js"
import fs from "fs/promises"
import os from "os"
import path from "path"

describe("Cli - Commands - db:schema:load", () => {
  it("loads the configured structure sql file into the database", {databaseCleaning: {transaction: false}}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-db-schema-load-"))
    const dbDir = path.join(directory, "db")
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            poolType: SingleMultiUsePool,
            type: "sqlite",
            name: "schema-load-test",
            migrations: true
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode()
    })
    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:schema:load"],
      testing: true
    })

    try {
      await fs.mkdir(dbDir, {recursive: true})
      await fs.writeFile(
        path.join(dbDir, "structure-default.sql"),
        [
          "CREATE TABLE `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL);",
          "CREATE TABLE `tasks` (`id` INTEGER PRIMARY KEY NOT NULL, `title` TEXT);"
        ].join("\n\n")
      )

      await cli.execute()

      await cli.getConfiguration().ensureConnections(async (dbs) => {
        expect(await dbs.default.tableExists("schema_migrations")).toEqual(true)
        expect(await dbs.default.tableExists("tasks")).toEqual(true)
      })
    } finally {
      await cli.getConfiguration().closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
