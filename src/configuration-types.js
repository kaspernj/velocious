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
 * @typedef {object} DatabaseConfigurationType
 * @property {function() : void} [getConnection]
 * @property {string} [host]
 * @property {boolean} [migrations]
 * @property {string} [password]
 * @property {number} [port]
 * @property {string} [name]
 * @property {object} [record]
 * @property {boolean} [record.transactions]
 * @property {boolean} [reset]
 * @property {string} [username]
 */

/**
 * @typedef {Record<string, string[]>} LocaleFallbacksType
 */

/**
 * @typedef {object} ConfigurationArgsType
 * @property {object} args
 * @property {CorsType} [cors]
 * @property {{[key: string]: DatabaseConfigurationType}} database
 * @property {boolean} debug
 * @property {string} directory
 * @property {string} environment
 * @property {import("./environment-handlers/base.js").default} environmentHandler
 * @property {function({configuration: import("./configuration.js").default, type: string}) : void} initializeModels
 * @property {InitializersType} initializers
 * @property {string | function() : string} locale
 * @property {string[]} locales
 * @property {LocaleFallbacksType} localeFallbacks
 * @property {string} testing
 */

export const nothing = {}
