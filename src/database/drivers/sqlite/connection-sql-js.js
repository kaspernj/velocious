// @ts-check

import debounce from "debounce"
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
    this.driver = driver
    this.persistence = persistence
  }

  async close() {
    await this.saveDatabase()
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
   * Runs query.
   * @param {string} sql - SQL string.
   * @returns {Promise<Record<string, ?>[]>} - Resolves with the query.
   */
  async query(sql) {
    const result = await queryWeb(this.connection, sql)
    const downcasedSQL = sql.toLowerCase().trim()

    // Auto-save database in local storage in case we can find manipulating instructions in the SQL
    if (downcasedSQL.startsWith("delete ") || downcasedSQL.startsWith("insert into ") || downcasedSQL.startsWith("update ")) {
      this.saveDatabaseDebounce()
    }

    return result
  }

  saveDatabase = async () => {
    const databaseContent = this.connection.export()

    await this.persistence.save(databaseContent)
  }

  saveDatabaseDebounce = debounce(this.saveDatabase, 500)
}
