// @ts-check

/**
 * @module types
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default, response: import("./http-server/client/response.js").default}): Promise<void>} CorsType
 */

/**
 * @typedef {(id: string) => {default: typeof import("./initializer.js").default}} InitializersRequireContextType
 * @typedef {InitializersRequireContextType & {
 *   keys: () => string[],
 *   id: string
 * }} WebpackRequireContext
 * @typedef {{requireContext: WebpackRequireContext}} InitializersExportType
 * @typedef {function({configuration: import("./configuration.js").default}) : Promise<InitializersExportType>} InitializersType
 */

/**
 * @typedef {object} SqlConfig
 * @property {string} [database]
 * @property {object} [options]
 * @property {boolean} [options.encrypt]
 * @property {boolean} [options.trustServerCertificate]
 * @property {string} [password]
 * @property {object} [pool]
 * @property {number} [pool.max]
 * @property {number} [pool.min]
 * @property {number} [pool.idleTimeoutMillis]
 * @property {string} [server]
 * @property {string} [user]
 */

/**
 * @typedef {object} DatabaseConfigurationType
 * @property {string} [database]
 * @property {typeof import("./database/drivers/base.js").default} [driver]
 * @property {typeof import("./database/pool/base.js").default} [poolType]
 * @property {function() : void} [getConnection]
 * @property {string} [host]
 * @property {boolean} [migrations]
 * @property {string} [password]
 * @property {number} [port]
 * @property {string} [name]
 * @property {object} [record]
 * @property {boolean} [record.transactions]
 * @property {boolean} [reset]
 * @property {SqlConfig} [sqlConfig]
 * @property {"mssql" | "mysql" | "pgsql" | "sqlite"} [type]
 * @property {string} [useDatabase]
 * @property {string} [username]
 */

/**
 * @typedef {object} LoggingConfiguration
 * @property {boolean} [console] - Enable/disable console logging. Defaults to true outside of "test".
 * @property {boolean} [file] - Enable/disable writing logs to a file. Defaults to true.
 * @property {string} [directory] - Directory where log files are stored. Defaults to "<project>/log".
 * @property {string} [filePath] - Explicit path for the log file. Defaults to "<directory>/<environment>.log".
 */

/**
 * @typedef {Record<string, string[]>} LocaleFallbacksType
 */

/**
 * @typedef {object} ConfigurationArgsType
 * @property {CorsType} [cors]
 * @property {{[key: string]: {[key: string]: DatabaseConfigurationType}}} database
 * @property {boolean} [debug]
 * @property {string} [directory]
 * @property {string} [environment]
 * @property {import("./environment-handlers/base.js").default} environmentHandler
 * @property {LoggingConfiguration} [logging]
 * @property {function({configuration: import("./configuration.js").default, type: string}) : void} initializeModels
 * @property {InitializersType} [initializers]
 * @property {string | function() : string} locale
 * @property {string[]} locales
 * @property {LocaleFallbacksType} localeFallbacks
 * @property {string} [testing]
 */

export const nothing = {}
