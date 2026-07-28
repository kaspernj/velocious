// @ts-check

import Configuration from "../../src/configuration.js"
import ConnectionSqlJs from "../../src/database/drivers/sqlite/connection-sql-js.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteWebDriver from "../../src/database/drivers/sqlite/index.web.js"
import { wait } from "awaitery"
import initSqlJs from "sql.js"
import path from "path"
import queryWeb from "../../src/database/drivers/sqlite/query.web.js"
import { fileURLToPath } from "url"

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..")
/** @type {import("sql.js").SqlJsStatic | undefined} */
let operationSqlJsModule
/** @type {OperationSqlJsPersistence | undefined} */
let operationSqlJsPersistence
let operationSqlJsConnectionCount = 0

class OperationSqlJsPersistence {
  /** @type {"localstorage"} */
  name = "localstorage"
  /** @type {Uint8Array | undefined} */
  bytes = undefined
  activeSaves = 0
  maxActiveSaves = 0
  saveCount = 0

  /** @returns {Promise<void>} - Deletes persisted bytes. */
  async delete() {
    this.bytes = undefined
  }

  /** @returns {Promise<Uint8Array | undefined>} - Loads persisted bytes. */
  async load() {
    return this.bytes ? new Uint8Array(this.bytes) : undefined
  }

  /**
   * Saves database bytes.
   * @param {Uint8Array} content - Exported database bytes.
   * @returns {Promise<void>} - Resolves when saved.
   */
  async save(content) {
    this.activeSaves++
    this.maxActiveSaves = Math.max(this.maxActiveSaves, this.activeSaves)

    try {
      await Promise.resolve()
      this.bytes = new Uint8Array(content)
      this.saveCount++
    } finally {
      this.activeSaves--
    }
  }

  /** @returns {void} - Resets persistence measurements. */
  resetMeasurements() {
    this.maxActiveSaves = 0
    this.saveCount = 0
  }
}

class OperationSqlJsDriver extends SqliteWebDriver {
  /** @returns {Promise<void>} - Connects a real ConnectionSqlJs wrapper. */
  async connect() {
    if (!operationSqlJsModule || !operationSqlJsPersistence) {
      throw new Error("Operation SQL.js test driver was not configured")
    }

    this.args = this.getArgs()
    const databaseContent = await operationSqlJsPersistence.load()

    this._connection = new ConnectionSqlJs(
      this,
      new operationSqlJsModule.Database(databaseContent),
      operationSqlJsPersistence
    )
    operationSqlJsConnectionCount++
  }
}

describe("database - operation-scoped transactions - SQL.js persistence", () => {
  it("defers real ConnectionSqlJs export across rollback and persists only the survivor", async () => {
    operationSqlJsModule = await initSqlJs({
      locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)
    })
    operationSqlJsPersistence = new OperationSqlJsPersistence()
    operationSqlJsConnectionCount = 0
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: OperationSqlJsDriver,
            migrations: false,
            name: "operation-sqljs-persistence",
            poolType: SingleMultiUsePool,
            type: "sqlite"
          }
        }
      },
      directory: path.join(projectRoot, "spec/dummy"),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    /** @type {Promise<void> | undefined} */
    let survivorPromise

    try {
      await configuration.withConnections(async (dbs) => {
        await dbs.default.query("CREATE TABLE operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
        await dbs.default.flushPendingWrites()
      })
      operationSqlJsPersistence.resetMeasurements()

      await expect(async () => {
        await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
          await operation
            .connection()
            .query("INSERT INTO operation_items(name) VALUES ('must roll back')", {processListComment: false})

          await wait(650)
          expect(operationSqlJsPersistence?.saveCount).toEqual(0)

          survivorPromise = configuration.withConnections(async (dbs) => {
            await dbs.default.query("INSERT INTO operation_items(name) VALUES ('must survive')", {processListComment: false})
          })

          throw new Error("ROLLBACK_REAL_SQLJS_OPERATION")
        })
      }).toThrowError("ROLLBACK_REAL_SQLJS_OPERATION")

      if (!survivorPromise) throw new Error("SQL.js survivor write was not started")

      await survivorPromise
      await configuration.withConnections(async (dbs) => {
        await dbs.default.flushPendingWrites()
      })

      const persistedBytes = await operationSqlJsPersistence.load()

      if (!persistedBytes) throw new Error("SQL.js database bytes were not persisted")

      const reopenedDatabase = new operationSqlJsModule.Database(persistedBytes)

      try {
        expect(await queryWeb(reopenedDatabase, "SELECT name FROM operation_items ORDER BY id")).toEqual([{name: "must survive"}])
        expect(operationSqlJsConnectionCount).toEqual(1)
        expect(operationSqlJsPersistence.maxActiveSaves).toEqual(1)
        expect(operationSqlJsPersistence.saveCount).toEqual(2)
      } finally {
        reopenedDatabase.close()
      }
    } finally {
      await configuration.closeDatabaseConnections()
      operationSqlJsModule = undefined
      operationSqlJsPersistence = undefined
    }
  })
})
