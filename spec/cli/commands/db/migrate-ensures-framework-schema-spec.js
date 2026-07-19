// @ts-check

import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

describe("Cli - Commands - db:migrate framework schema", () => {
  it("creates the background-jobs schema during db:migrate (not only on store boot)", {databaseCleaning: {transaction: false}}, async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })

    await cli.getConfiguration().ensureConnections(async (dbs) => {
      // Drop the framework tables so only db:migrate — via the ensureFrameworkSchema
      // hook — can recreate them (no runtime store boots in this test).
      await dbs.default.withDisabledForeignKeys(async () => {
        await dbs.default.dropTable("background_job_concurrency", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_jobs", {cascade: true, ifExists: true})
      })

      await cli.execute()

      const backgroundJobsTable = await dbs.default.getTableByName("background_jobs")

      if (!backgroundJobsTable) throw new Error("db:migrate didn't create the background_jobs table")

      const executionModeColumn = await backgroundJobsTable.getColumnByName("execution_mode")

      if (!executionModeColumn) throw new Error("db:migrate didn't create the execution_mode column")

      expect(executionModeColumn.getName()).toEqual("execution_mode")

      const concurrencyTable = await dbs.default.getTableByName("background_job_concurrency")

      if (!concurrencyTable) throw new Error("db:migrate didn't create the background_job_concurrency table")

      expect(concurrencyTable.getName()).toEqual("background_job_concurrency")
    })
  })
})
