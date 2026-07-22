// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import StructureSqlLoader from "../../src/database/structure-sql-loader.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Runs `callback(dbs)` against a throwaway sqlite database so each DDL test is
 * isolated (these tests disable transactions and never truncate).
 * @param {(dbs: Record<string, import("../../src/database/drivers/base.js").default>) => Promise<void>} callback
 * @returns {Promise<void>}
 */
async function withFreshDatabase(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-structure-sql-loader-"))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          poolType: SingleMultiUsePool,
          type: "sqlite",
          name: "structure-sql-loader-test",
          migrations: true
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode()
  })

  try {
    await configuration.ensureConnections(async (dbs) => {
      await callback(dbs)
    })
  } finally {
    await configuration.closeDatabaseConnections()
    await fs.rm(directory, {recursive: true, force: true})
  }
}

describe("StructureSqlLoader", () => {
  it("loads a structure dump into the connection", {databaseCleaning: {transaction: false}}, async () => {
    await withFreshDatabase(async (dbs) => {
      await new StructureSqlLoader().load({
        db: dbs.default,
        structureSql: [
          "CREATE TABLE `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL);",
          "CREATE TABLE `tasks` (`id` INTEGER PRIMARY KEY NOT NULL, `title` TEXT);"
        ].join("\n\n")
      })

      expect(await dbs.default.tableExists("schema_migrations")).toEqual(true)
      expect(await dbs.default.tableExists("tasks")).toEqual(true)
    })
  })

  it("invalidates cached schema metadata after loading via the native exec path", {databaseCleaning: {transaction: false}}, async () => {
    await withFreshDatabase(async (dbs) => {
      // Read schema metadata first so the pre-load (empty) table list is cached.
      expect(await dbs.default.tableExists("tasks")).toEqual(false)

      await new StructureSqlLoader().load({
        db: dbs.default,
        structureSql: "CREATE TABLE `tasks` (`id` INTEGER PRIMARY KEY NOT NULL);"
      })

      // The native exec path mutates the schema outside Base#query; without the
      // loader clearing the cache this would still report the stale empty schema.
      expect(await dbs.default.tableExists("tasks")).toEqual(true)
    })
  })

  it("preserves inserted rows from the dump", {databaseCleaning: {transaction: false}}, async () => {
    await withFreshDatabase(async (dbs) => {
      await new StructureSqlLoader().load({
        db: dbs.default,
        structureSql: [
          "CREATE TABLE `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL);",
          "INSERT INTO schema_migrations (version) VALUES ('20260710010000');"
        ].join("\n")
      })

      const rows = await dbs.default.newQuery().from("schema_migrations").results()

      expect(rows.map((row) => row.version)).toEqual(["20260710010000"])
    })
  })

  it("is a no-op for empty structure SQL", {databaseCleaning: {transaction: false}}, async () => {
    await withFreshDatabase(async (dbs) => {
      await new StructureSqlLoader().load({db: dbs.default, structureSql: "   \n  "})

      expect(await dbs.default.tableExists("tasks")).toEqual(false)
    })
  })

  it("uses the driver's single-round-trip batch and skips per-statement execution when execStructureScript returns true", async () => {
    const calls = {batchedSql: /** @type {string[]} */ ([]), queries: 0, fkDisabled: false, fkEnabled: false, cacheCleared: false}
    const db = /** @type {any} */ ({
      async disableForeignKeys() { calls.fkDisabled = true },
      async enableForeignKeys() { calls.fkEnabled = true },
      clearSchemaCache() { calls.cacheCleared = true },
      async execStructureScript(/** @type {string} */ sql) { calls.batchedSql.push(sql); return true },
      async query() { calls.queries++ }
    })

    await new StructureSqlLoader().load({db, structureSql: "CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);"})

    expect(calls.batchedSql.length).toEqual(1)
    expect(calls.queries).toEqual(0)
    expect(calls.fkDisabled).toEqual(true)
    expect(calls.fkEnabled).toEqual(true)
    expect(calls.cacheCleared).toEqual(true)
  })

  it("falls back to per-statement execution when the driver has no batch and no native exec", async () => {
    const executed = /** @type {string[]} */ ([])
    const db = /** @type {any} */ ({
      async disableForeignKeys() {},
      async enableForeignKeys() {},
      clearSchemaCache() {},
      async execStructureScript() { return false },
      async query(/** @type {string} */ sql) { executed.push(sql) }
    })

    await new StructureSqlLoader().load({db, structureSql: "CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);"})

    expect(executed.length).toEqual(2)
  })
})
