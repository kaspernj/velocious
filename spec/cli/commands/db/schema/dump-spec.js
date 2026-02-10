// @ts-check

import Cli from "../../../../../src/cli/index.js"
import dummyConfiguration from "../../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import path from "path"

describe("Cli - Commands - db:schema:dump", () => {
  it("writes structure sql when structure file is missing", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const migrateCli = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })
    const schemaDumpCli = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:schema:dump"],
      testing: true
    })

    if (schemaDumpCli.getConfiguration().getDatabaseType("default") != "sqlite") {
      console.warn(`Skipping schema dump assertion: default database is ${schemaDumpCli.getConfiguration().getDatabaseType("default")}`)
      return
    }

    await schemaDumpCli.getConfiguration().ensureConnections(async (dbs) => {
      await migrateCli.execute()

      const structurePath = path.join(directory, "db", "structure-default.sql")

      await fs.rm(structurePath, {force: true})
      await schemaDumpCli.execute()

      const expected = await dbs.default.structureSql()
      const actual = await fs.readFile(structurePath, "utf8")

      expect(actual).toEqual(expected)
    })
  })
})
