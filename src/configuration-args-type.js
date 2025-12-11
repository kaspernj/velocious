/**
 * @module types
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
 * @property {function({configuration: VelociousConfiguration, type: string}) : void} initializeModels
 * @property {InitializersType} initializers
 * @property {string | function() : string} locale
 * @property {string[]} locales
 * @property {object} localeFallbacks
 * @property {string} testing
 */

export const nothing = {}
