// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import fs from "fs/promises"
import os from "os"
import path from "path"

class DeadlockClassifyingSqliteDriver extends SqliteDriver {
  /**
   * Treats the focused after-commit error like MySQL's deadlock classifier.
   * @param {Error} error - Candidate database error.
   * @returns {import("../../src/database/drivers/base.js").RetryableDatabaseErrorResult} - Retry classification.
   */
  retryableDatabaseError(error) {
    if (error.message.includes("ER_LOCK_DEADLOCK_AFTER_COMMIT")) {
      return {deadlock: true, reconnect: false, retry: false, waitMs: 1}
    }

    return super.retryableDatabaseError(error)
  }
}

describe("database - operation-scoped transactions - afterCommit retry boundary", () => {
  it("does not retry a durable operation when afterCommit raises a deadlock-shaped error", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-operation-after-commit-retry-"))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            deadlockMaxRetries: 2,
            driver: DeadlockClassifyingSqliteDriver,
            migrations: false,
            name: "operation-after-commit-retry",
            poolType: SingleMultiUsePool,
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
    let callbackRuns = 0
    let afterCommitRuns = 0

    try {
      await configuration.withConnections(async (dbs) => {
        await dbs.default.query("CREATE TABLE operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
      })

      await expect(async () => {
        await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
          callbackRuns++
          await operation
            .connection()
            .query("INSERT INTO operation_items(name) VALUES ('durable once')")
          await operation.afterCommit(() => {
            afterCommitRuns++
            throw new Error("ER_LOCK_DEADLOCK_AFTER_COMMIT")
          })
        })
      }).toThrowError("ER_LOCK_DEADLOCK_AFTER_COMMIT")

      await configuration.withConnections(async (dbs) => {
        expect(await dbs.default.query("SELECT name FROM operation_items ORDER BY id")).toEqual([{name: "durable once"}])
      })
      expect(callbackRuns).toEqual(1)
      expect(afterCommitRuns).toEqual(1)
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
