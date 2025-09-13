import debounce from "debounce"
import query from "./query"

export default class VelociousDatabaseDriversSqliteConnectionSqlJs {
  constructor(driver, connection) {
    this.connection = connection
    this.driver = driver
  }

  async close() {
    await this.saveDatabase()
    await this.connection.end()
    this.connection = undefined
  }

  disconnect = async () => await this.saveDatabase()

  async query(sql) {
    const result = await query(this.connection, sql)
    const downcasedSQL = sql.toLowerCase().trim()

    // Auto-save database in local storage in case we can find manipulating instructions in the SQL
    if (downcasedSQL.startsWith("delete ") || downcasedSQL.startsWith("insert into ") || downcasedSQL.startsWith("update ")) {
      this.saveDatabaseDebounce()
    }

    return result
  }

  saveDatabase = async () => {
    const localStorageContent = this.connection.export()

    await this.driver.betterLocalStorage.set(this.driver.localStorageName(), localStorageContent)
  }

  saveDatabaseDebounce = debounce(this.saveDatabase, 500)
}
