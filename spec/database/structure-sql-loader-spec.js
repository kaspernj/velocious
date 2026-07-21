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
})
