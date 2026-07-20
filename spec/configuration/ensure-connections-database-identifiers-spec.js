// @ts-check

import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

class ConnectionCountingSqliteDriver extends SqliteDriver {
  /** @type {number} */
  static connectionAttempts = 0

  /** @returns {Promise<void>} - Resolves after connecting. */
  async connect() {
    ConnectionCountingSqliteDriver.connectionAttempts++
    await super.connect()
  }
}

/**
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Isolated multi-database configuration.
 */
async function createMultiDatabaseConfiguration() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-selective-connections-"))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          migrations: false,
          name: "selective-connections-default",
          poolType: AsyncTrackedMultiConnection,
          type: "sqlite"
        },
        secondary: {
          driver: ConnectionCountingSqliteDriver,
          migrations: false,
          name: "selective-connections-secondary",
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

  ConnectionCountingSqliteDriver.connectionAttempts = 0

  return {
    cleanup: async () => {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration
  }
}

describe("Configuration connection database identifiers", () => {
  it("checks out only requested identifiers through withConnections", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      await configuration.withConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        expect(Object.keys(dbs)).toEqual(["default"])
      })

      expect(ConnectionCountingSqliteDriver.connectionAttempts).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("checks out only requested database identifiers", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        expect(Object.keys(dbs)).toEqual(["default"])
        await dbs.default.query("SELECT 1")
      })

      expect(ConnectionCountingSqliteDriver.connectionAttempts).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("returns only requested connections when reusing an existing scope", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      await configuration.withConnections(async (outerDbs) => {
        await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
          expect(Object.keys(dbs)).toEqual(["default"])
          expect(dbs.default).toBe(outerDbs.default)
        })
      })
    } finally {
      await cleanup()
    }
  })
})
