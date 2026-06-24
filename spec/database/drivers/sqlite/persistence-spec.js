// @ts-check

import Configuration from "../../../../src/configuration.js"
import ConnectionSqlJs from "../../../../src/database/drivers/sqlite/connection-sql-js.js"
import SqliteWebDriver from "../../../../src/database/drivers/sqlite/index.web.js"
import initSqlJs from "sql.js"
import path from "path"
import {describe, expect, it} from "../../../../src/testing/test.js"
import {fileURLToPath} from "url"

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../")

/**
 * Test storage implementing the async persistence calls the SQL.js connection uses.
 */
class InMemorySqlJsStorage {
  /** @type {Map<string, Uint8Array>} */
  values = new Map()

  /**
   * @param {string} key - Storage key.
   * @param {Uint8Array} value - Database bytes.
   * @returns {Promise<void>} - Resolves when stored.
   */
  async set(key, value) {
    this.values.set(key, new Uint8Array(value))
  }

  /**
   * @param {string} key - Storage key.
   * @returns {Promise<Uint8Array | undefined>} - Stored database bytes, if present.
   */
  async get(key) {
    const value = this.values.get(key)

    return value ? new Uint8Array(value) : undefined
  }
}

/**
 * @param {string} databaseName - SQL.js local storage database name.
 * @returns {string} - SQL.js local storage key.
 */
function localStorageName(databaseName) {
  return `VelociousDatabaseDriversSqliteWeb---${databaseName}`
}

/**
 * @returns {Promise<import("sql.js").SqlJsStatic>} - SQL.js module.
 */
async function loadSqlJs() {
  return await initSqlJs({
    locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)
  })
}

/**
 * @param {object} args - Driver setup args.
 * @param {import("sql.js").SqlJsStatic} args.SQL - SQL.js module.
 * @param {string} args.databaseName - SQL.js local storage database name.
 * @param {InMemorySqlJsStorage} args.storage - Persistence storage.
 * @returns {Promise<SqliteWebDriver>} - Connected SQLite web driver.
 */
async function buildSqliteWebDriver({SQL, databaseName, storage}) {
  const storageKey = localStorageName(databaseName)
  const persistence = {
    name: "localstorage",
    delete: async () => storage.values.delete(storageKey),
    load: async () => storage.get(storageKey),
    save: async (content) => storage.set(storageKey, content)
  }
  const databaseContent = await persistence.load()
  const driver = new SqliteWebDriver({name: databaseName}, Configuration.current())

  driver.args = driver.getArgs()
  driver._connection = new ConnectionSqlJs(driver, new SQL.Database(databaseContent), persistence)

  return driver
}

/**
 * @param {SqliteWebDriver} driver - SQLite web driver.
 * @returns {Promise<number>} - Persisted test row count.
 */
async function persistedItemsCount(driver) {
  const rows = await driver.query("SELECT COUNT(*) AS count FROM persisted_items")
  const count = rows[0]?.count

  if (typeof count !== "number") {
    throw new Error(`Expected numeric persisted item count, got: ${typeof count}`)
  }

  return count
}

describe("database - sqlite web driver - persistence", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("persists truncateAllTables before it resolves so immediate reloads see reset rows", async () => {
    const SQL = await loadSqlJs()
    const databaseName = `sqlite-web-truncate-flush-${Date.now()}`
    const storage = new InMemorySqlJsStorage()
    let setupDriver, truncateDriver, reloadDriver

    try {
      setupDriver = await buildSqliteWebDriver({SQL, databaseName, storage})
      await setupDriver.query("CREATE TABLE persisted_items(id INTEGER PRIMARY KEY, name TEXT)")
      await setupDriver.query("INSERT INTO persisted_items(name) VALUES ('before truncate')")
      await setupDriver.close()
      setupDriver = undefined

      truncateDriver = await buildSqliteWebDriver({SQL, databaseName, storage})

      expect(await persistedItemsCount(truncateDriver)).toEqual(1)

      await truncateDriver.truncateAllTables()

      reloadDriver = await buildSqliteWebDriver({SQL, databaseName, storage})

      expect(await persistedItemsCount(reloadDriver)).toEqual(0)
    } finally {
      if (reloadDriver) await reloadDriver.close()
      if (truncateDriver) await truncateDriver.close()
      if (setupDriver) await setupDriver.close()
    }
  })
})
