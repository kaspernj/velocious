// @ts-check

import { expect } from "../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"

/**
 * Builds a real file-backed SQLite configuration with independent connections.
 * @param {string} prefix - Temporary directory prefix.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} Configuration and cleanup.
 */
export async function createTransactionalDdlReadinessConfiguration(prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          migrations: false,
          name: "transactional-ddl-readiness",
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
 * Verifies that a rolled-back transaction removed a table on databases whose DDL is transactional.
 * @param {import("../../src/configuration.js").default} configuration - Configuration owning the database.
 * @param {string} connectionName - Diagnostic connection name.
 * @param {string} tableName - Table expected to have rolled back.
 * @returns {Promise<void>} Resolves after verification.
 */
export async function expectTransactionalDdlTableRolledBack(configuration, connectionName, tableName) {
  await configuration.ensureConnections({name: connectionName}, async (dbs) => {
    const db = dbs.default

    if (db.getType() === "mysql") return

    expect(await db.tableExists(tableName)).toEqual(false)
  })
}

/**
 * Whether transactional DDL rollback removes newly created tables for this configuration.
 * @param {import("../../src/configuration.js").default} configuration - Configuration owning the database.
 * @returns {Promise<boolean>} Whether CREATE TABLE rolls back.
 */
export async function supportsTransactionalDdlRollback(configuration) {
  return await configuration.ensureConnections({name: "Transactional DDL capability"}, async (dbs) => dbs.default.getType() !== "mysql")
}
