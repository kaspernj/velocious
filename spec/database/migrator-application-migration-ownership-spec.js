// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import Migration from "../../src/database/migration/index.js"
import Migrator from "../../src/database/migrator.js"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"

describe("Database migrator application migration ownership", () => {
  /**
   * Builds an isolated migration-enabled SQLite configuration.
   * @param {string} prefix - Temporary directory prefix.
   * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test context.
   */
  async function buildConfiguration(prefix) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: true,
            name: `${prefix}-default`,
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    return {
      cleanup: async () => {
        await configuration.closeDatabaseConnections()
        await fs.rm(directory, {force: true, recursive: true})
      },
      configuration
    }
  }

  /**
   * Builds a require context with one table-creating migration.
   * @param {typeof Migration} MigrationClass - Migration class to register.
   * @returns {import("../../src/database/migrator/types.js").RequireMigrationContextType} - Require context.
   */
  function buildRequireContext(MigrationClass) {
    return buildFrontendMigrationContext({
      "20260902000100-create-ownership-table.js": MigrationClass
    })
  }

  it("skips application migrations in an HTTP worker thread lifecycle", async () => {
    const {cleanup, configuration} = await buildConfiguration("velocious-migrator-worker-ownership")

    class CreateWorkerGuardTable extends Migration {
      async change() {
        await this.execute("CREATE TABLE worker_guard_items(id integer PRIMARY KEY)")
      }
    }
    class CreateWorkerGuardSecondTable extends Migration {
      async change() {
        await this.execute("CREATE TABLE worker_guard_second_items(id integer PRIMARY KEY)")
      }
    }

    const migrations = buildRequireContext(CreateWorkerGuardTable)
    const files = [{
      date: 20260902000200,
      file: "20260902000200-create-worker-guard-second-table.js",
      fullPath: "/create-worker-guard-second-table.js",
      migrationClassName: "CreateWorkerGuardSecondTable"
    }]

    try {
      await configuration.initialize({type: "worker-handler"})

      await configuration.ensureConnections(async (dbs) => {
        const migrator = new Migrator({configuration})

        await migrator.prepare()
        await migrator.migrateFilesFromRequireContext(migrations)

        const appliedByFileList = await migrator.migrateFiles(files, async () => ({default: CreateWorkerGuardSecondTable}))

        expect(appliedByFileList).toEqual(0)
        expect(await dbs.default.tableExists("worker_guard_items")).toEqual(false)
        expect(await dbs.default.tableExists("worker_guard_second_items")).toEqual(false)
        expect(await dbs.default.query("SELECT version FROM schema_migrations")).toEqual([])
      })
    } finally {
      await cleanup()
    }
  })

  it("applies application migrations in the schema-owning server lifecycle", async () => {
    const {cleanup, configuration} = await buildConfiguration("velocious-migrator-server-ownership")

    class CreateServerOwnedTable extends Migration {
      async change() {
        await this.execute("CREATE TABLE server_owned_items(id integer PRIMARY KEY)")
      }
    }

    const migrations = buildRequireContext(CreateServerOwnedTable)

    try {
      await configuration.initialize({type: "server"})

      await configuration.ensureConnections(async (dbs) => {
        const migrator = new Migrator({configuration})

        await migrator.prepare()
        await migrator.migrateFilesFromRequireContext(migrations)

        expect(await dbs.default.tableExists("server_owned_items")).toEqual(true)
        expect(await dbs.default.query("SELECT version FROM schema_migrations")).toEqual([
          {version: "20260902000100"}
        ])
      })
    } finally {
      await cleanup()
    }
  })
})
