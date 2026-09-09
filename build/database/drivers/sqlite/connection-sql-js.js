// @ts-check

import debounce from "debounce"
import Mutex from "epic-locks/build/mutex.js"
import queryWeb from "./query.web.js"

export default class VelociousDatabaseDriversSqliteConnectionSqlJs {
  /**
   * Runs constructor.
   * @param {import("../base.js").default} driver - Database driver instance.
   * @param {import("sql.js").Database} connection - Connection.
   * @param {import("./web-persistence.js").SqliteWebPersistence} persistence - Database persistence adapter.
   */
  constructor(driver, connection, persistence) {
    this.connection = connection
    this.databaseSaveDeferred = false
    this.databaseSaveMutex = new Mutex()
    this.databaseTransactionStarting = false
    this.driver = driver
    this.persistence = persistence
  }

  async close() {
    await this.flushDatabaseSave()
    await this.connection.close()
  }

  /**
   * Flushes any debounced database save and waits until persistence is complete.
   * @returns {Promise<void>} - Resolves when the current database bytes are stored.
   */
  async flushDatabaseSave() {
    this.saveDatabaseDebounce.clear()
    await this.saveDatabase()
  }

  /**
   * Flushes only when a mutation save is pending or was deferred by a transaction.
   * @returns {Promise<void>} - Resolves when pending database bytes are stored.
   */
  async flushPendingDatabaseSave() {
    if (!this.saveDatabaseDebounce.isPending && !this.databaseSaveDeferred) return

    await this.flushDatabaseSave()
  }

  hasPendingDatabaseSave() {
    return Boolean(this.saveDatabaseDebounce.isPending || this.databaseSaveDeferred)
  }

  /**
   * Drains active and queued persistence before atomically starting an outer transaction.
   * @param {() => Promise<void>} callback - Starts the SQL transaction.
   * @returns {Promise<void>} - Resolves after BEGIN succeeds.
   */
  async withTransactionStart(callback) {
    if (this.saveDatabaseDebounce.isPending) {
      this.saveDatabaseDebounce.clear()
      this.databaseSaveDeferred = true
    }

    await this.databaseSaveMutex.sync(async () => {
      if (this.databaseSaveDeferred) {
        this.databaseSaveDeferred = false
        const databaseContent = this.connection.export()

        await this.persistence.save(databaseContent)
      }

      this.databaseTransactionStarting = true

      try {
        await callback()
      } catch (error) {
        this.databaseTransactionStarting = false
        throw error
      }
    })
  }

  /**
   * Marks successful outer transaction admission complete after driver state is updated.
   * @returns {void}
   */
  completeTransactionStart() {
    this.databaseTransactionStarting = false
  }

  /**
   * Runs query.
   * @param {string} sql - SQL string.
   * @param {{mutation?: boolean}} [options] - Internal query classification options.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query.
   */
  async query(sql, {mutation = false} = {}) {
    const result = await queryWeb(this.connection, sql)
    const downcasedSQL = sql.toLowerCase().trim()

    // Auto-save database in local storage in case we can find manipulating instructions in the SQL
    if (mutation || downcasedSQL.startsWith("delete ") || downcasedSQL.startsWith("insert into ") || downcasedSQL.startsWith("update ")) {
      this.saveDatabaseDebounce()
    }

    return result
  }

  /**
   * Executes a mutation with affected-row metadata.
   * @param {string} sql - Mutation SQL.
   * @returns {Promise<number>} - Affected row count.
   */
  async affectedRows(sql) {
    await this.query(sql)
    const connection = /** @type {import("sql.js").Database & {getRowsModified: () => number}} */ (this.connection)
    return connection.getRowsModified()
  }

  saveDatabase = async () => {
    await this.databaseSaveMutex.sync(async () => {
      if (this.driver.insideTransaction() || this.databaseTransactionStarting) {
        this.databaseSaveDeferred = true
        return
      }

      this.databaseSaveDeferred = false
      const databaseContent = this.connection.export()

      await this.persistence.save(databaseContent)
    })
  }

  saveDatabaseDebounce = debounce(this.saveDatabase, 500)
}
