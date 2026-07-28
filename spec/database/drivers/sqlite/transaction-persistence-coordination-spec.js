// @ts-check

import Configuration from "../../../../src/configuration.js"
import ConnectionSqlJs from "../../../../src/database/drivers/sqlite/connection-sql-js.js"
import SqliteWebDriver from "../../../../src/database/drivers/sqlite/index.web.js"
import {wait} from "awaitery"
import initSqlJs from "sql.js"
import path from "path"
import {fileURLToPath} from "url"

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../")

class PersistenceSaveGate {
  constructor() {
    /**
     * Resolves when the gated save starts.
     * @type {() => void}
     */
    let enter = () => {}
    /**
     * Releases the gated save.
     * @type {() => void}
     */
    let release = () => {}

    this.entered = new Promise((resolve) => {
      enter = () => resolve(undefined)
    })
    this.released = new Promise((resolve) => {
      release = () => resolve(undefined)
    })
    this.enter = enter
    this.release = release
  }
}

class ControlledSqlJsPersistence {
  /** @type {"localstorage"} */
  name = "localstorage"
  /** @type {Uint8Array | undefined} */
  bytes = undefined
  /** @type {SqliteWebDriver | undefined} */
  driver = undefined
  /** @type {PersistenceSaveGate | undefined} */
  nextSaveGate = undefined
  /** @type {string | undefined} */
  nextSaveRejection = undefined
  /** @type {boolean[]} */
  saveTransactionStates = []

  /** @returns {Promise<void>} - Deletes persisted bytes. */
  async delete() {
    this.bytes = undefined
  }

  /** @returns {Promise<Uint8Array | undefined>} - Loads persisted bytes. */
  async load() {
    return this.bytes ? new Uint8Array(this.bytes) : undefined
  }

  /**
   * Saves database bytes under optional deterministic test gates.
   * @param {Uint8Array} content - Exported SQL.js bytes.
   * @returns {Promise<void>} - Resolves when saved.
   */
  async save(content) {
    if (!this.driver) throw new Error("Controlled SQL.js persistence has no driver")

    this.saveTransactionStates.push(this.driver.insideTransaction())

    const saveGate = this.nextSaveGate
    const saveRejection = this.nextSaveRejection

    this.nextSaveGate = undefined
    this.nextSaveRejection = undefined

    if (saveGate) {
      saveGate.enter()
      await saveGate.released
    }

    if (saveRejection) throw new Error(saveRejection)

    this.bytes = new Uint8Array(content)
  }

  /**
   * Gates the next persistence save.
   * @returns {PersistenceSaveGate} - Save gate.
   */
  gateNextSave() {
    const saveGate = new PersistenceSaveGate()

    this.nextSaveGate = saveGate

    return saveGate
  }

  /**
   * Rejects the next persistence save.
   * @param {string} message - Rejection message.
   * @returns {void}
   */
  rejectNextSave(message) {
    this.nextSaveRejection = message
  }
}

/**
 * Builds a real SQL.js driver around controlled persistence.
 * @param {object} args - Driver options.
 * @param {import("sql.js").SqlJsStatic} args.SQL - Initialized SQL.js module.
 * @param {string} args.databaseName - Database name.
 * @param {ControlledSqlJsPersistence} args.persistence - Persistence adapter.
 * @returns {Promise<SqliteWebDriver>} - Connected driver.
 */
async function buildDriver({SQL, databaseName, persistence}) {
  const databaseContent = await persistence.load()
  const driver = new SqliteWebDriver({name: databaseName}, Configuration.current())

  driver.args = driver.getArgs()
  driver._connection = new ConnectionSqlJs(
    driver,
    new SQL.Database(databaseContent),
    persistence
  )
  persistence.driver = driver

  return driver
}

/**
 * Loads the real SQL.js module used by the persistence races.
 * @returns {Promise<import("sql.js").SqlJsStatic>} - Initialized SQL.js module.
 */
async function loadSqlJs() {
  return await initSqlJs({
    locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)
  })
}

describe("database - sqlite web driver - transaction persistence coordination", () => {
  it("drains active and queued saves before BEGIN and never exports an open transaction", async () => {
    const SQL = await loadSqlJs()
    const persistence = new ControlledSqlJsPersistence()
    const databaseName = `sqlite-web-transaction-save-queue-${Date.now()}`
    let driver, reopenedDriver

    try {
      driver = await buildDriver({SQL, databaseName, persistence})
      await driver.query("CREATE TABLE persistence_items(id INTEGER PRIMARY KEY, name TEXT)")
      await driver.flushPendingWrites()
      persistence.saveTransactionStates = []

      await driver.query("INSERT INTO persistence_items(name) VALUES ('before transaction')", {processListComment: false})

      const firstSaveGate = persistence.gateNextSave()
      const firstSave = driver.flushPendingWrites()

      await firstSaveGate.entered

      const secondSave = driver.flushPendingWrites()
      /**
       * Resolves when the transaction callback may perform its operation-owned write.
       * @type {() => void}
       */
      let continueTransaction = () => {}
      /**
       * Resolves when the transaction callback has started.
       * @type {() => void}
       */
      let enterTransaction = () => {}
      const continueTransactionPromise = new Promise((resolve) => {
        continueTransaction = () => resolve(undefined)
      })
      const transactionEntered = new Promise((resolve) => {
        enterTransaction = () => resolve(undefined)
      })
      const transaction = driver.transaction(async () => {
        enterTransaction()
        await continueTransactionPromise
        await driver.query("INSERT INTO persistence_items(name) VALUES ('must roll back')", {processListComment: false})
        throw new Error("ROLLBACK_QUEUED_SQLJS_SAVE")
      })

      await wait(25)
      firstSaveGate.release()
      await Promise.all([firstSave, secondSave])
      await transactionEntered
      continueTransaction()

      let transactionError

      try {
        await transaction
      } catch (error) {
        transactionError = error
      }

      await driver.close()
      driver = undefined
      reopenedDriver = await buildDriver({SQL, databaseName, persistence})

      expect(persistence.saveTransactionStates.filter((insideTransaction) => insideTransaction)).toEqual([])
      expect(transactionError instanceof Error ? transactionError.message : undefined).toEqual("ROLLBACK_QUEUED_SQLJS_SAVE")
      expect(await reopenedDriver.query("SELECT name FROM persistence_items ORDER BY id")).toEqual([{name: "before transaction"}])
    } finally {
      if (reopenedDriver) await reopenedDriver.close()
      if (driver) await driver.close()
    }
  })

  it("does not retain an afterCommit frame when a pre-BEGIN persistence flush fails", async () => {
    const SQL = await loadSqlJs()
    const persistence = new ControlledSqlJsPersistence()
    const databaseName = `sqlite-web-transaction-save-failure-${Date.now()}`
    let driver

    try {
      const connectedDriver = await buildDriver({SQL, databaseName, persistence})

      driver = connectedDriver
      await connectedDriver.query("CREATE TABLE persistence_items(id INTEGER PRIMARY KEY, name TEXT)")
      await connectedDriver.flushPendingWrites()
      await connectedDriver.query("INSERT INTO persistence_items(name) VALUES ('pending flush')", {processListComment: false})

      persistence.rejectNextSave("SQLJS_PRE_BEGIN_PERSISTENCE_FAILED")
      let failedTransactionCallbackRuns = 0

      await expect(async () => {
        await connectedDriver.transaction(async () => {
          failedTransactionCallbackRuns++
        })
      }).toThrowError("SQLJS_PRE_BEGIN_PERSISTENCE_FAILED")

      expect(failedTransactionCallbackRuns).toEqual(0)

      let afterCommitRuns = 0

      await connectedDriver.transaction(async () => {
        await connectedDriver.afterCommit(() => {
          afterCommitRuns++
        })
        await connectedDriver.query("INSERT INTO persistence_items(name) VALUES ('successful transaction')", {processListComment: false})
      })

      expect(afterCommitRuns).toEqual(1)
    } finally {
      if (driver) await driver.close()
    }
  })
})
