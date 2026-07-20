// @ts-check

import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import {fileURLToPath} from "url"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"

export class ConnectionCountingSqliteDriver extends SqliteDriver {
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
export async function createMultiDatabaseConfiguration() {
  const tmpDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tmp")

  await fs.mkdir(tmpDirectory, {recursive: true})

  const directory = await fs.mkdtemp(path.join(tmpDirectory, "selective-connections-"))
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
