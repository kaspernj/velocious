// @ts-check

import BrowserEnvironmentHandler from "../../src/environment-handlers/browser.js"
import Configuration from "../../src/configuration.js"
import initSqlJs from "sql.js"
import {fileURLToPath} from "node:url"
import path from "node:path"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteWebDriver from "../../src/database/drivers/sqlite/index.web.js"
import SqljsTestDatabase from "../../src/testing/sqljs-test-database.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("SqljsTestDatabase", () => {
  it("recreates a quarantined connection from the captured schema baseline", async () => {
    const sqlJsDistPath = fileURLToPath(new URL("../../node_modules/sql.js/dist/", import.meta.url))
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(sqlJsDistPath, file)
    })
    const testDatabase = new SqljsTestDatabase({createDatabase: (data) => new SQL.Database(data)})
    const baselineConnection = testDatabase.connection()

    await baselineConnection.query("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
    testDatabase.captureBaseline()
    const configuration = new Configuration({
      database: {test: {default: {
        driver: SqliteWebDriver,
        getConnection: () => testDatabase.connection(),
        migrations: false,
        name: "recreatable-browser-test",
        poolType: SingleMultiUsePool,
        type: "sqlite"
      }}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new BrowserEnvironmentHandler(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const pool = configuration.getDatabasePool("default")
    const firstConnection = await pool.checkout()

    await firstConnection.query("INSERT INTO widgets (name) VALUES ('timed-out write')")
    await pool.discard(firstConnection)

    const replacementConnection = await pool.checkout()

    expect(replacementConnection).not.toBe(firstConnection)
    await expect(async () => {
      await firstConnection.query("INSERT INTO widgets (name) VALUES ('stale write')")
    }).toThrowError("SQL.js test database connection is closed")
    expect(await replacementConnection.query("SELECT * FROM widgets")).toEqual([])

    await pool.checkin(replacementConnection)
    await pool.closeAll()
  })
})
