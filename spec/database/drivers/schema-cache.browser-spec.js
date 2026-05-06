// @ts-check

import Configuration from "../../../src/configuration.js"
import LoggerArrayOutput from "../../../src/logger/outputs/array-output.js"
import Migration from "../../../src/database/migration/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/** @typedef {import("../../../src/configuration-types.js").LoggingConfiguration} LoggingConfiguration */
/** @typedef {Configuration & {_logging?: LoggingConfiguration}} MutableLoggingConfiguration */
/** @typedef {import("../../../src/database/drivers/base.js").default} Driver */

/**
 * @param {function(LoggerArrayOutput): Promise<void>} callback - Callback with captured query logs.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function withQueryLogOutput(callback) {
  const configuration = /** @type {MutableLoggingConfiguration} */ (Configuration.current())
  const previousLogging = configuration._logging
  const arrayOutput = new LoggerArrayOutput({limit: 10000})

  configuration._logging = {
    console: false,
    file: false,
    outputs: [{output: arrayOutput, levels: ["info"]}],
    queryLogging: true
  }

  try {
    await callback(arrayOutput)
  } finally {
    configuration._logging = previousLogging
  }
}

/**
 * @param {LoggerArrayOutput} arrayOutput - Query log output.
 * @returns {string[]} - SQL log messages.
 */
function sqlMessages(arrayOutput) {
  return arrayOutput
    .getLogs()
    .filter((log) => log.subject == "SQL")
    .map((log) => log.message)
}

/**
 * @param {LoggerArrayOutput} arrayOutput - Query log output.
 * @param {function(string): boolean} callback - Message matcher.
 * @returns {number} - Matching SQL query count.
 */
function countSqlMessages(arrayOutput, callback) {
  return sqlMessages(arrayOutput).filter(callback).length
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string} message - Log message.
 * @returns {boolean} - Whether the query lists database tables.
 */
function isTableListQuery(driver, message) {
  if (driver.getType() == "mysql") return message.includes("SHOW FULL TABLES")
  if (driver.getType() == "pgsql") return message.includes("SELECT * FROM information_schema.tables")
  if (driver.getType() == "sqlite") return message.includes("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  if (driver.getType() == "mssql") return message.includes("[INFORMATION_SCHEMA].[TABLES]")

  throw new Error(`Unknown driver type: ${driver.getType()}`)
}

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
