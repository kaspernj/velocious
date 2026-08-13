// @ts-check

import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import {countSqlMessages, isTableListQuery, sqlMessages, withQueryLogOutput} from "../../helpers/query-log-helpers.js"

/** @typedef {import("../../../src/database/drivers/base.js").default} Driver */

/**
 * @param {Driver} driver - Database driver.
 * @param {string} tableName - Table name.
 * @param {string} message - Log message.
 * @returns {boolean} - Whether the query introspects table columns.
 */
function isColumnListQuery(driver, tableName, message) {
  if (driver.getType() == "mysql") return message.includes(`SHOW FULL COLUMNS FROM \`${tableName}\``)
  if (driver.getType() == "pgsql") return message.includes("information_schema.columns AS columns") && message.includes(`columns.table_name = '${tableName}'`)
  if (driver.getType() == "sqlite") return message.includes(`PRAGMA table_info('${tableName}')`)
  if (driver.getType() == "mssql") return message.includes("[INFORMATION_SCHEMA].[COLUMNS]") && message.includes(tableName)

  throw new Error(`Unknown driver type: ${driver.getType()}`)
}

/**
 * @param {object} args - Options object.
 * @param {Configuration} args.configuration - Configuration instance.
 * @param {Driver} args.driver - Database driver.
 * @param {string} args.tableName - Table name.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function createSchemaCacheTable({configuration, driver, tableName}) {
  const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

  await migration.createTable(tableName, {id: false}, (table) => {
    table.string("name")
  })
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string} tableName - Table name.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function dropSchemaCacheTable(driver, tableName) {
  await driver.dropTable(tableName, {cascade: true, ifExists: true})
  driver.clearSchemaCache()
}

describe("database - drivers - schema cache", {tags: ["dummy"]}, () => {
  it("reuses cached table list metadata for repeated lookups", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = dbs.default

      driver.clearSchemaCache()

      await withQueryLogOutput(async (arrayOutput) => {
        const tables = await driver.getTables()

        tables.length = 0

        expect((await driver.getTables()).length).toBeGreaterThan(0)
        await driver.getTableByNameOrFail("projects")

        expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toBe(1)
      })
    })
  })

  it("reuses cached table column metadata", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = dbs.default
      const table = await driver.getTableByNameOrFail("projects")

      driver.clearSchemaCache()

      await withQueryLogOutput(async (arrayOutput) => {
        await table.getColumns()
        await table.getColumns()

        expect(countSqlMessages(arrayOutput, (message) => isColumnListQuery(driver, "projects", message))).toBe(1)
      })
    })
  })

  it("invalidates cached table metadata after schema changes", async () => {
    const configuration = Configuration.current()
    const tableName = "schema_cache_probe"

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      await dropSchemaCacheTable(driver, tableName)
      driver.clearSchemaCache()

      try {
        await withQueryLogOutput(async (arrayOutput) => {
          expect(await driver.tableExists(tableName)).toBe(false)
          expect(await driver.tableExists(tableName)).toBe(false)
          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toBe(1)

          await createSchemaCacheTable({configuration, driver, tableName})

          expect(await driver.tableExists(tableName)).toBe(true)
          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toBe(2)
        })
      } finally {
        await dropSchemaCacheTable(driver, tableName)
      }
    })
  })

  it("reuses cached structure sql until schema changes", async () => {
    const configuration = Configuration.current()
    const tableName = "schema_cache_structure_probe"

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      await dropSchemaCacheTable(driver, tableName)
      driver.clearSchemaCache()

      try {
        await withQueryLogOutput(async (arrayOutput) => {
          await driver.structureSql()

          const afterFirstStructureSql = sqlMessages(arrayOutput).length

          expect(afterFirstStructureSql).toBeGreaterThan(0)

          await driver.structureSql()

          expect(sqlMessages(arrayOutput).length).toBe(afterFirstStructureSql)

          await createSchemaCacheTable({configuration, driver, tableName})

          const afterCreateTable = sqlMessages(arrayOutput).length

          await driver.structureSql()

          expect(sqlMessages(arrayOutput).length).toBeGreaterThan(afterCreateTable)
        })
      } finally {
        await dropSchemaCacheTable(driver, tableName)
      }
    })
  })

  it("can disable schema cache usage through the driver args", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = dbs.default
      const args = driver.getArgs()
      const previousSchemaCache = args.schemaCache

      args.schemaCache = false
      driver.clearSchemaCache()

      try {
        await withQueryLogOutput(async (arrayOutput) => {
          await driver.getTables()
          await driver.getTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toBe(2)
        })
      } finally {
        if (previousSchemaCache === undefined) {
          delete args.schemaCache
        } else {
          args.schemaCache = previousSchemaCache
        }

        driver.clearSchemaCache()
      }
    })
  })
})
