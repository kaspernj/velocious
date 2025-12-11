/**
 * @typedef {object} MigrationObjectType
 * @property {number} date
 * @property {string} file
 * @property {string} [fullPath]
 * @property {string} migrationClassName
 */

/**
 * @typedef {function() : typeof import("../migration/index.js").default} ImportCallbackType
 */

/**
 * @typedef {function(string) : Promise<typeof import("../migration/index.js").default>} ImportFullpathCallbackType
 */

/**
 * @typedef {() => Promise<typeof import("../migration/index.js").default>} RequireMigrationType
 */

/**
 * @typedef {(id: string) => {default: typeof import("../migration/index.js").default}} RequireMigrationContextRequireType
 * @typedef {RequireMigrationContextRequireType & {
 *   keys: () => string[],
 *   id: string
 * }} RequireMigrationContextType
 */

export {}
