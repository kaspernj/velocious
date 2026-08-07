// @ts-check

import Configuration from "../../src/configuration.js"
import ConnectionSqlJs from "../../src/database/drivers/sqlite/connection-sql-js.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteWebDriver from "../../src/database/drivers/sqlite/index.web.js"
import TenantHandle from "../../src/tenants/tenant-handle.js"
import {deferred, wait, waitFor} from "awaitery"
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
/** @type {Promise<void> | undefined} */
let operationSqlJsConnectGate
let operationSqlJsConnectStarted = () => {}

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

    operationSqlJsConnectStarted()
    if (operationSqlJsConnectGate) await operationSqlJsConnectGate

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
  /**
   * Builds an isolated configuration using the real SQL.js connection wrapper.
   * @returns {Promise<Configuration>} - SQL.js configuration.
   */
  async function createOperationSqlJsConfiguration() {
    operationSqlJsModule = await initSqlJs({
      locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)
    })
    operationSqlJsPersistence = new OperationSqlJsPersistence()
    operationSqlJsConnectionCount = 0
    operationSqlJsConnectGate = undefined
    operationSqlJsConnectStarted = () => {}

    return new Configuration({
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
  }

  it("deduplicates an in-flight normal and captured checkout onto one SQL.js image", async () => {
    const configuration = await createOperationSqlJsConfiguration()
    const handle = new TenantHandle({configuration, tenant: {slug: "alpha"}})
    const connectCanFinish = deferred()
    const connectStarted = deferred()
    const tableReady = deferred()

    operationSqlJsConnectGate = connectCanFinish.promise
    operationSqlJsConnectStarted = () => connectStarted.resolve(undefined)

    const handlePromise = handle.databaseOperation({databaseIdentifier: "default"}, async (operation) => {
      await operation.connection().query("CREATE TABLE operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
      await operation.connection().query("INSERT INTO operation_items(name) VALUES ('captured')", {processListComment: false})
      tableReady.resolve(undefined)
    })

    try {
      await connectStarted.promise

      const normalPromise = configuration.withConnections(async (dbs) => {
        await tableReady.promise

        return await dbs.default.query("SELECT name FROM operation_items ORDER BY id", {processListComment: false})
      })

      connectCanFinish.resolve(undefined)

      expect(await normalPromise).toEqual([{name: "captured"}])
      await handlePromise
      expect(operationSqlJsConnectionCount).toEqual(1)
    } finally {
      connectCanFinish.resolve(undefined)
      tableReady.resolve(undefined)
      await handlePromise
      await configuration.closeDatabaseConnections()
      operationSqlJsConnectGate = undefined
      operationSqlJsConnectStarted = () => {}
      operationSqlJsModule = undefined
      operationSqlJsPersistence = undefined
    }
  })

  it("serializes overlapping same-database handles on one SQL.js image", async () => {
    const configuration = await createOperationSqlJsConfiguration()
    const handle = new TenantHandle({configuration, tenant: {slug: "alpha"}})
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const secondStarted = deferred()
    let configurationClosed = false

    try {
      await configuration.withConnections(async (dbs) => {
        await dbs.default.query("CREATE TABLE operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
        await dbs.default.flushPendingWrites()
      })

      const firstPromise = handle.databaseOperation({databaseIdentifier: "default"}, async (operation) => {
        await operation.connection().query("INSERT INTO operation_items(name) VALUES ('first')", {processListComment: false})
        firstStarted.resolve(undefined)
        await firstCanFinish.promise
      })

      await firstStarted.promise
      const secondPromise = handle.databaseOperation({databaseIdentifier: "default"}, async (operation) => {
        await operation.connection().query("INSERT INTO operation_items(name) VALUES ('second')", {processListComment: false})
        secondStarted.resolve(undefined)
      })

      const checkoutMode = await waitFor({wait: 1}, () => {
        const snapshot = configuration.getDatabasePool("default").getDebugSnapshot()

        if (snapshot.pendingCheckoutCount === 1) return "queued"
        if (operationSqlJsConnectionCount >= 3) return "independent"

        throw new Error("Second SQL.js handle has not entered pool ownership yet")
      })
      const waitingSnapshot = configuration.getDatabasePool("default").getDebugSnapshot()

      if (checkoutMode === "independent") {
        await secondStarted.promise
        await secondPromise
        firstCanFinish.resolve(undefined)
        await firstPromise
      } else {
        firstCanFinish.resolve(undefined)
        await firstPromise
        await secondStarted.promise
        await secondPromise
      }

      await configuration.closeDatabaseConnections()
      configurationClosed = true

      const persistedBytes = await operationSqlJsPersistence.load()

      if (!persistedBytes || !operationSqlJsModule) throw new Error("SQL.js database bytes were not persisted")

      const reopenedDatabase = new operationSqlJsModule.Database(persistedBytes)

      try {
        expect(await queryWeb(reopenedDatabase, "SELECT name FROM operation_items ORDER BY id")).toEqual([{name: "first"}, {name: "second"}])
        expect(waitingSnapshot.pendingCheckoutCount).toEqual(1)
        expect(operationSqlJsConnectionCount).toEqual(1)
      } finally {
        reopenedDatabase.close()
      }
    } finally {
      firstCanFinish.resolve(undefined)
      if (!configurationClosed) await configuration.closeDatabaseConnections()
      operationSqlJsModule = undefined
      operationSqlJsPersistence = undefined
    }
  })

  it("shares unflushed normal pooled SQL.js writes with a captured handle", async () => {
    const configuration = await createOperationSqlJsConfiguration()
    const handle = new TenantHandle({configuration, tenant: {slug: "alpha"}})

    try {
      await configuration.withConnections(async (dbs) => {
        await dbs.default.query("CREATE TABLE operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
        await dbs.default.flushPendingWrites()
      })

      await configuration.withConnections(async (dbs) => {
        await dbs.default.query("INSERT INTO operation_items(name) VALUES ('normal pooled write')")

        await handle.databaseOperation({databaseIdentifier: "default"}, async (operation) => {
          expect(await operation.connection().query("SELECT name FROM operation_items ORDER BY id", {processListComment: false})).toEqual([{name: "normal pooled write"}])
        })
      })

      expect(operationSqlJsConnectionCount).toEqual(1)
    } finally {
      await configuration.closeDatabaseConnections()
      operationSqlJsModule = undefined
      operationSqlJsPersistence = undefined
    }
  })

  it("lets closeAll reject queued SQL.js handle operations and close their owned image", async () => {
    const configuration = await createOperationSqlJsConfiguration()
    const handle = new TenantHandle({configuration, tenant: {slug: "alpha"}})
    const firstCanFinish = deferred()
    const firstStarted = deferred()

    const firstPromise = handle.databaseOperation({databaseIdentifier: "default"}, async () => {
      firstStarted.resolve(undefined)
      await firstCanFinish.promise
    })

    try {
      await firstStarted.promise

      const secondPromise = handle.databaseOperation({databaseIdentifier: "default"}, async () => {})
      const pool = configuration.getDatabasePool("default")

      await waitFor({wait: 1}, () => {
        expect(pool.getDebugSnapshot().pendingCheckoutCount).toEqual(1)
      })

      const secondExpectation = expect(async () => await secondPromise).toThrowError("Database pool was closed before checkout completed.")

      await pool.closeAll()
      await secondExpectation
      expect(pool.getDebugSnapshot().connections).toEqual([])

      firstCanFinish.resolve(undefined)
      await firstPromise
    } finally {
      firstCanFinish.resolve(undefined)
      await firstPromise
      await configuration.closeDatabaseConnections()
      operationSqlJsModule = undefined
      operationSqlJsPersistence = undefined
    }
  })

  it("defers real ConnectionSqlJs export across rollback and persists only the survivor", async () => {
    const configuration = await createOperationSqlJsConfiguration()
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
