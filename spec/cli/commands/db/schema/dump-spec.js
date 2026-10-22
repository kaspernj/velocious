// @ts-check

import Cli from "../../../../../src/cli/index.js"
import Configuration from "../../../../../src/configuration.js"
import dummyConfiguration from "../../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../../src/environment-handlers/node.js"
import MigrationsLedger from "../../../../../src/database/migrations-ledger.js"
import fs from "fs/promises"
import os from "os"
import path from "path"

describe("Cli - Commands - db:schema:dump", () => {
  /**
   * Builds a configuration that shares the dummy database but writes structure
   * files into its own temporary directory. `db:schema:dump` resolves its output
   * path from the configuration directory, so writing through the dummy
   * configuration would overwrite the canonical checked-in snapshot that other
   * specs (db:schema:load) read.
   * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration, directory: string}>} - Isolated dump configuration.
   */
  async function buildDumpConfiguration() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-db-schema-dump-"))
    const configuration = new Configuration({
      database: {test: dummyConfiguration.getDatabaseConfiguration()},
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode()
    })

    return {
      cleanup: async () => {
        await configuration.closeDatabaseConnections()
        await fs.rm(directory, {force: true, recursive: true})
      },
      configuration,
      directory
    }
  }

  it("writes structure sql when structure file is missing", {databaseCleaning: {transaction: false}}, async () => {
    const {cleanup, configuration, directory} = await buildDumpConfiguration()
    const migrateCli = new Cli({
      configuration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:migrate"],
      testing: true
    })
    const schemaDumpCli = new Cli({
      configuration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:schema:dump"],
      testing: true
    })

    if (configuration.getDatabaseType("default") != "sqlite") {
      console.warn(`Skipping schema dump assertion: default database is ${configuration.getDatabaseType("default")}`)
      return
    }

    try {
      await configuration.ensureConnections(async (dbs) => {
        await migrateCli.execute()

        const structurePath = path.join(directory, "db", "structure-default.sql")

        await fs.rm(structurePath, {force: true})
        await schemaDumpCli.execute()

        const structureDdl = await dbs.default.structureSql()
        const actual = await fs.readFile(structurePath, "utf8")

        const ddlOnly = actual.split("\n").filter((l) => !l.startsWith("INSERT INTO schema_migrations")).join("\n")

        expect(ddlOnly.trimEnd()).toEqual(structureDdl.trimEnd())
      })
    } finally {
      await cleanup()
    }
  })

  it("includes applied schema_migrations version rows in the structure dump",
    {databaseCleaning: {transaction: false}},
    async () => {
      const {cleanup, configuration, directory} = await buildDumpConfiguration()
      const migrateCli = new Cli({
        configuration,
        directory: dummyDirectory(),
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["db:migrate"],
        testing: true
      })
      const schemaDumpCli = new Cli({
        configuration,
        directory: dummyDirectory(),
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["db:schema:dump"],
        testing: true
      })

      if (configuration.getDatabaseType("default") != "sqlite") {
        console.warn(`Skipping schema_migrations in dump assertion: default database is ${configuration.getDatabaseType("default")}`)
        return
      }

      try {
        await configuration.ensureConnections(async (dbs) => {
          await migrateCli.execute()

          const appliedVersions = await MigrationsLedger.appliedVersions(dbs.default)

          if (appliedVersions.length == 0) {
            console.warn("Skipping schema_migrations in dump assertion: no migrations applied")
            return
          }

          const structurePath = path.join(directory, "db", "structure-default.sql")

          await fs.rm(structurePath, {force: true})
          await schemaDumpCli.execute()

          const structureFile = await fs.readFile(structurePath, "utf8")

          expect(structureFile).toInclude("INSERT INTO schema_migrations (version) VALUES (")

          for (const version of appliedVersions) {
            expect(structureFile).toInclude(`INSERT INTO schema_migrations (version) VALUES ('${version}');`)
          }
        })
      } finally {
        await cleanup()
      }
    }
  )
})
