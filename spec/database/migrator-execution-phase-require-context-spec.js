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

describe("Database migrator execution-phase selection for require contexts", () => {
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

  it("runs only matching ambient require-context migrations in timestamp order", async () => {
    const {cleanup, configuration} = await buildConfiguration("velocious-migrator-phase-context")

    class CreatePreRuntimeTable extends Migration {
      async change() {
        await this.execute("CREATE TABLE pre_runtime_context_items(id integer PRIMARY KEY)")
      }
    }
    class CreatePostPublicationOrder extends Migration {
      async change() {
        await this.execute("CREATE TABLE post_publication_context_order(position integer NOT NULL, name varchar(255) NOT NULL)")
        await this.execute("INSERT INTO post_publication_context_order(position, name) VALUES (1, 'first')")
      }
    }
    class AppendPostPublicationOrder extends Migration {
      async change() {
        await this.execute("INSERT INTO post_publication_context_order(position, name) VALUES (2, 'second')")
      }
    }

    CreatePostPublicationOrder.runInPhase("post-publication")
    AppendPostPublicationOrder.runInPhase("post-publication")

    const migrations = buildFrontendMigrationContext({
      "20260901000100-create-pre-runtime-table.js": CreatePreRuntimeTable,
      "20260901000300-append-post-publication-order.js": AppendPostPublicationOrder,
      "20260901000200-create-post-publication-order.js": CreatePostPublicationOrder
    })

    try {
      await configuration.ensureConnections(async (dbs) => {
        const migrator = new Migrator({configuration, executionPhase: "post-publication"})

        await migrator.prepare()
        await migrator.migrateFilesFromRequireContext(migrations)

        expect(await dbs.default.tableExists("pre_runtime_context_items")).toEqual(false)
        expect(await dbs.default.query("SELECT name FROM post_publication_context_order ORDER BY position")).toEqual([
          {name: "first"},
          {name: "second"}
        ])
        expect(await dbs.default.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
          {version: "20260901000200"},
          {version: "20260901000300"}
        ])
      })
    } finally {
      await cleanup()
    }
  })

  it("applies the same selection to a captured physical database", async () => {
    const {cleanup, configuration} = await buildConfiguration("velocious-migrator-phase-captured")

    class CreateCapturedPreRuntimeTable extends Migration {
      async change() {
        await this.execute("CREATE TABLE captured_pre_runtime_items(id integer PRIMARY KEY)")
      }
    }
    class CreateCapturedPostPublicationTable extends Migration {
      async change() {
        await this.execute("CREATE TABLE captured_post_publication_items(id integer PRIMARY KEY)")
      }
    }

    CreateCapturedPostPublicationTable.runInPhase("post-publication")

    const migrations = buildFrontendMigrationContext({
      "20260901001100-create-captured-pre-runtime-table.js": CreateCapturedPreRuntimeTable,
      "20260901001200-create-captured-post-publication-table.js": CreateCapturedPostPublicationTable
    })

    try {
      await configuration.ensureConnections(async (dbs) => {
        const migrator = new Migrator({configuration, executionPhase: "post-publication"})

        expect(await migrator.migrateRequireContextForDatabase({
          databaseConfiguration: configuration.getDatabaseIdentifier("default"),
          databaseIdentifier: "default",
          db: dbs.default,
          requireContext: migrations
        })).toEqual(1)
        expect(await dbs.default.tableExists("captured_pre_runtime_items")).toEqual(false)
        expect(await dbs.default.tableExists("captured_post_publication_items")).toEqual(true)
        expect(await dbs.default.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
          {version: "20260901001200"}
        ])
      })
    } finally {
      await cleanup()
    }
  })
})
