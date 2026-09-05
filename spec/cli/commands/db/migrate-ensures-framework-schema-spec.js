// @ts-check

import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

describe("Cli - Commands - db:migrate framework schema", () => {
  it("creates framework schema during db:migrate instead of waiting for runtime stores", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
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
        await dbs.default.dropTable("background_job_schedule_keys", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_job_concurrency", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_jobs", {cascade: true, ifExists: true})
        await dbs.default.dropTable("velocious_attachments", {cascade: true, ifExists: true})
      })

      await cli.execute()

      const backgroundJobsTable = await dbs.default.getTableByName("background_jobs")

      if (!backgroundJobsTable) throw new Error("db:migrate didn't create the background_jobs table")

      const executionModeColumn = await backgroundJobsTable.getColumnByName("execution_mode")

      if (!executionModeColumn) throw new Error("db:migrate didn't create the execution_mode column")

      expect(executionModeColumn.getName()).toEqual("execution_mode")

      const scheduleKeyColumn = await backgroundJobsTable.getColumnByName("schedule_key")

      if (!scheduleKeyColumn) throw new Error("db:migrate didn't create the schedule_key column")

      expect(scheduleKeyColumn.getName()).toEqual("schedule_key")

      const scheduleKeysTable = await dbs.default.getTableByName("background_job_schedule_keys")

      if (!scheduleKeysTable) throw new Error("db:migrate didn't create the background_job_schedule_keys table")

      expect(scheduleKeysTable.getName()).toEqual("background_job_schedule_keys")

      const concurrencyTable = await dbs.default.getTableByName("background_job_concurrency")

      if (!concurrencyTable) throw new Error("db:migrate didn't create the background_job_concurrency table")

      expect(concurrencyTable.getName()).toEqual("background_job_concurrency")
      expect(await dbs.default.tableExists("velocious_attachments")).toEqual(true)
    })
  })

  it("creates attachment schema for each migrated database while leaving background-job database selection to its adapter", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
    const handler = new EnvironmentHandlerNode()

    handler.setConfiguration(dummyConfiguration)

    await dummyConfiguration.ensureConnections(async (dbs) => {
      // Drop the framework tables, then call the hook the way `db:tenants:migrate`
      // does: with only tenant databases in `dbs`, never the background-job
      // adapter's "default" DB. Attachment schema belongs on every migrated database,
      // while background-job reconciliation must not open a separate default checkout.
      await dbs.default.withDisabledForeignKeys(async () => {
        await dbs.default.dropTable("background_job_schedule_keys", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_job_concurrency", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_jobs", {cascade: true, ifExists: true})
        await dbs.default.dropTable("velocious_attachments", {cascade: true, ifExists: true})
      })

      await handler.ensureFrameworkSchema({dbs: {projectTenant: dbs.default}})

      expect(await dbs.default.tableExists("background_jobs")).toEqual(false)
      expect(await dbs.default.tableExists("velocious_attachments")).toEqual(true)

      // With the default DB present in the set it also restores background-job schema
      // so later specs sharing this database keep working.
      await handler.ensureFrameworkSchema({dbs: {default: dbs.default}})

      expect(await dbs.default.tableExists("background_jobs")).toEqual(true)
      expect(await dbs.default.tableExists("velocious_attachments")).toEqual(true)
    })
  })

  it("does not create framework schema on databases with migrations disabled", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
    const directory = dummyDirectory()
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })
    const databaseConfigurations = Object.values(dummyConfiguration.getDatabaseConfiguration())
    const migrationSettings = databaseConfigurations.map((databaseConfiguration) => databaseConfiguration.migrations)

    await cli.getConfiguration().ensureConnections(async (dbs) => {
      await dbs.default.withDisabledForeignKeys(async () => {
        await dbs.default.dropTable("background_job_schedule_keys", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_job_concurrency", {cascade: true, ifExists: true})
        await dbs.default.dropTable("background_jobs", {cascade: true, ifExists: true})
        await dbs.default.dropTable("velocious_attachments", {cascade: true, ifExists: true})
      })

      for (const databaseConfiguration of databaseConfigurations) databaseConfiguration.migrations = false

      try {
        await cli.execute()

        expect(await dbs.default.tableExists("background_jobs")).toEqual(false)
        expect(await dbs.default.tableExists("velocious_attachments")).toEqual(false)
      } finally {
        for (let index = 0; index < databaseConfigurations.length; index++) {
          databaseConfigurations[index].migrations = migrationSettings[index]
        }

        const handler = new EnvironmentHandlerNode()

        handler.setConfiguration(dummyConfiguration)
        await handler.ensureFrameworkSchema({dbs: {default: dbs.default}})
      }
    })
  })
})
