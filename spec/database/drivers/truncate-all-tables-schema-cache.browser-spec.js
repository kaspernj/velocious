// @ts-check

import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"
import { countSqlMessages, isTableListQuery, sqlMessages, withQueryLogOutput } from "../../helpers/query-log-helpers.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { dropTables, isCleanupRequest, tableRowCount } from "../../helpers/truncate-all-tables-test-helper.js"

const CACHE_FIRST_TABLE = "truncate_cache_first"
const CACHE_SECOND_TABLE = "truncate_cache_second"
const STALE_TABLE = "truncate_stale_table"
const STALE_LIVE_TABLE = "truncate_stale_live_table"

describe("database - drivers - truncate all tables - schema cache", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("uses one cold table discovery, reuses a warm cache, and sees tables created after DDL invalidation", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const cleanupOrder = [CACHE_SECOND_TABLE, CACHE_FIRST_TABLE]

      await dropTables(driver, cleanupOrder)

      try {
        await migration.createTable(CACHE_FIRST_TABLE, {id: false}, (table) => table.string("name"))
        driver.clearSchemaCache()

        await withQueryLogOutput(async (arrayOutput) => {
          await driver.truncateAllTables()
          await driver.truncateAllTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toEqual(1)

          await migration.createTable(CACHE_SECOND_TABLE, {id: false}, (table) => table.string("name"))
          await driver.query(`INSERT INTO ${driver.quoteTable(CACHE_SECOND_TABLE)} (${driver.quoteColumn("name")}) VALUES (${driver.quote("created after warm cache")})`)
          await driver.truncateAllTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toEqual(2)
        })

        expect(await tableRowCount(driver, CACHE_SECOND_TABLE)).toEqual(0)
      } finally {
        await dropTables(driver, cleanupOrder)
      }
    })
  })

  it("clears stale table metadata after a failed batch and retries against the live schema", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const cleanupOrder = [STALE_TABLE, STALE_LIVE_TABLE]

      await dropTables(driver, cleanupOrder)

      try {
        await migration.createTable(STALE_TABLE, {id: false}, (table) => table.string("name"))
        await migration.createTable(STALE_LIVE_TABLE, {id: false}, (table) => table.string("name"))
        await driver.query(`INSERT INTO ${driver.quoteTable(STALE_LIVE_TABLE)} (${driver.quoteColumn("name")}) VALUES (${driver.quote("clean me")})`)
        driver.clearSchemaCache()
        await driver.getTables()

        await driver._queryActual(`DROP TABLE ${driver.quoteTable(STALE_TABLE)}`)

        await withQueryLogOutput(async (arrayOutput) => {
          await driver.truncateAllTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toEqual(1)
          const cleanupRequestCount = sqlMessages(arrayOutput)
            .filter((message) => isCleanupRequest(driver, cleanupOrder, message))
            .length

          if (driver.getType() == "mysql" && !driver.getArgs().multipleStatements) {
            expect(cleanupRequestCount).toEqual(2)
          } else {
            expect(cleanupRequestCount).toEqual(1)
          }
        })

        expect(await tableRowCount(driver, STALE_LIVE_TABLE)).toEqual(0)
      } finally {
        await dropTables(driver, cleanupOrder)
      }
    })
  })
})
