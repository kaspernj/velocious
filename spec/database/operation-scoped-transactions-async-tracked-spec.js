// @ts-check

import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"

/**
 * Builds an isolated file-backed configuration using the async-tracked pool.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Configuration and cleanup.
 */
async function createOperationConfiguration() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-operation-async-tracked-"))
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          migrations: false,
          name: "operation-async-tracked",
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

describe("database - operation-scoped transactions - AsyncTrackedMultiConnection", () => {
  it("pins a fresh checkout while unrelated work uses another connection", async () => {
    const {cleanup, configuration} = await createOperationConfiguration()

    try {
      await configuration.withConnections(async (dbs) => {
        await dbs.default.query("CREATE TABLE operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
      })

      await configuration.withConnections({name: "enclosing async-tracked checkout"}, async (enclosingDbs) => {
        const enclosingConnectionId = enclosingDbs.default.getIdSeq()

        await expect(async () => {
          await configuration.withTransaction({databaseIdentifier: "default", name: "async-tracked operation"}, async (operation) => {
            const operationConnectionId = operation.connection().getIdSeq()
            let unrelatedConnectionId

            await configuration.withConnections({databaseIdentifiers: ["default"], name: "unrelated async-tracked work"}, async (unrelatedDbs) => {
              unrelatedConnectionId = unrelatedDbs.default.getIdSeq()
              await unrelatedDbs.default.query("INSERT INTO operation_items(name) VALUES ('must survive')")
            })

            expect(operationConnectionId).not.toEqual(enclosingConnectionId)
            expect(unrelatedConnectionId).not.toEqual(operationConnectionId)

            await operation
              .connection()
              .query("INSERT INTO operation_items(name) VALUES ('must roll back')")

            throw new Error("ROLLBACK_ASYNC_TRACKED_OPERATION")
          })
        }).toThrowError("ROLLBACK_ASYNC_TRACKED_OPERATION")
      })

      await configuration.withConnections(async (dbs) => {
        expect(await dbs.default.query("SELECT name FROM operation_items ORDER BY id")).toEqual([{name: "must survive"}])
      })
    } finally {
      await cleanup()
    }
  })
})
