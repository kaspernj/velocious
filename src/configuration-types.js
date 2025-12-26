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
 * @property {string} [database] - Description.
 * @property {object} [options] - Description.
 * @property {boolean} [options.encrypt] - Description.
 * @property {boolean} [options.trustServerCertificate] - Description.
 * @property {string} [password] - Description.
 * @property {object} [pool] - Description.
 * @property {number} [pool.max] - Description.
 * @property {number} [pool.min] - Description.
 * @property {number} [pool.idleTimeoutMillis] - Description.
 * @property {string} [server] - Description.
 * @property {string} [user] - Description.
 */

/**
 * @typedef {object} DatabaseConfigurationType
 * @property {string} [database] - Description.
 * @property {typeof import("./database/drivers/base.js").default} [driver] - Description.
 * @property {typeof import("./database/pool/base.js").default} [poolType] - Description.
 * @property {function() : void} [getConnection] - Description.
 * @property {string} [host] - Description.
 * @property {boolean} [migrations] - Description.
 * @property {string} [password] - Description.
 * @property {number} [port] - Description.
 * @property {string} [name] - Description.
 * @property {boolean} [readOnly] - Description.
 * @property {object} [record] - Description.
 * @property {boolean} [record.transactions] - Description.
 * @property {boolean} [reset] - Description.
 * @property {SqlConfig} [sqlConfig] - Description.
 * @property {"mssql" | "mysql" | "pgsql" | "sqlite"} [type] - Description.
 * @property {string} [useDatabase] - Description.
 * @property {string} [username] - Description.
 */

/**
 * @typedef {object} LoggingConfiguration
 * @property {boolean} [console] - Enable/disable console logging for request logging. Defaults to true outside of "test" and for HTTP server logs.
 * @property {boolean} [file] - Enable/disable writing logs to a file. Defaults to true.
 * @property {string} [directory] - Directory where log files are stored. Defaults to "<project>/log".
 * @property {string} [filePath] - Explicit path for the log file. Defaults to "<directory>/<environment>.log".
 * @property {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [levels] - Override which log levels are emitted.
 * @property {boolean} [debugLowLevel] - Convenience flag to include very low-level debug logs.
 */

/**
 * @typedef {Record<string, string[]>} LocaleFallbacksType
 */

/**
 * @typedef {object} ConfigurationArgsType
 * @property {CorsType} [cors] - Description.
 * @property {{[key: string]: {[key: string]: DatabaseConfigurationType}}} database - Description.
 * @property {boolean} [debug] - Description.
 * @property {string} [directory] - Description.
 * @property {string} [environment] - Description.
 * @property {import("./environment-handlers/base.js").default} environmentHandler - Description.
 * @property {LoggingConfiguration} [logging] - Description.
 * @property {function({configuration: import("./configuration.js").default, type: string}) : void} initializeModels - Description.
 * @property {InitializersType} [initializers] - Description.
 * @property {string | function() : string} locale - Description.
 * @property {string[]} locales - Description.
 * @property {LocaleFallbacksType} localeFallbacks - Description.
 * @property {string} [testing] - Description.
 */

export const nothing = {}
