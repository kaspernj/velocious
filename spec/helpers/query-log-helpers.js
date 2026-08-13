// @ts-check

import Configuration from "../../src/configuration.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"

/** @typedef {import("../../src/configuration-types.js").LoggingConfiguration} LoggingConfiguration */
/** @typedef {Configuration & {_logging?: LoggingConfiguration}} MutableLoggingConfiguration */
/** @typedef {import("../../src/database/drivers/base.js").default} Driver */

/**
 * @param {(arg: LoggerArrayOutput) => Promise<void>} callback - Callback with captured query logs.
 * @returns {Promise<void>} - Resolves when complete.
 */
export async function withQueryLogOutput(callback) {
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
export function sqlMessages(arrayOutput) {
  return arrayOutput
    .getLogs()
    .filter((log) => log.subject == "SQL")
    .map((log) => log.message)
}

/**
 * @param {LoggerArrayOutput} arrayOutput - Query log output.
 * @param {(arg: string) => boolean} callback - Message matcher.
 * @returns {number} - Matching SQL query count.
 */
export function countSqlMessages(arrayOutput, callback) {
  return sqlMessages(arrayOutput).filter(callback).length
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string} message - Log message.
 * @returns {boolean} - Whether the query lists database tables.
 */
export function isTableListQuery(driver, message) {
  if (driver.getType() == "mysql") return message.includes("SHOW FULL TABLES")
  if (driver.getType() == "pgsql") return message.includes("SELECT * FROM information_schema.tables")
  if (driver.getType() == "sqlite") return message.includes("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  if (driver.getType() == "mssql") return message.includes("[INFORMATION_SCHEMA].[TABLES]")

  throw new Error(`Unknown driver type: ${driver.getType()}`)
}
