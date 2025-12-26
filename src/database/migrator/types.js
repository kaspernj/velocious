// @ts-check

/**
 * @typedef {object} MigrationObjectType
 * @property {number} date - Description.
 * @property {string} file - Description.
 * @property {string} [fullPath] - Description.
 * @property {string} migrationClassName - Description.
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
