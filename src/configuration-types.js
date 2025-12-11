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
 * @typedef {object} ConfigurationArgsType
 * @property {object} args
 * @property {CorsType} [cors]
 * @property {{[key: string]: object}} database
 * @property {boolean} debug
 * @property {string} directory
 * @property {string} environment
 * @property {import("./environment-handlers/base.js").default} environmentHandler
 * @property {function({configuration: import("./configuration.js").default, type: string}) : void} initializeModels
 * @property {InitializersType} initializers
 * @property {string | function() : string} locale
 * @property {string[]} locales
 * @property {object} localeFallbacks
 * @property {string} testing
 */

export const nothing = {}
