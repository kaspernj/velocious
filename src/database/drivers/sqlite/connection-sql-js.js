// @ts-check

import debounce from "debounce"
import queryWeb from "./query.web.js"

export default class VelociousDatabaseDriversSqliteConnectionSqlJs {
  /**
   * @param {import("../base.js").default} driver
   * @param {import("sql.js").Database} connection
   */
  constructor(driver, connection) {
    this.connection = connection
    this.driver = driver
  }

  async close() {
    await this.saveDatabase()
    await this.connection.close()
  }

  async disconnect() { await this.saveDatabase() }

  /**
   * @param {string} sql
   * @returns {Promise<Record<string, any>[]>} - Result.
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
    const localStorageContent = this.connection.export()

    // @ts-expect-error
    await this.driver.betterLocalStorage.set(this.driver.localStorageName(), localStorageContent)
  }

  saveDatabaseDebounce = debounce(this.saveDatabase, 500)
}
