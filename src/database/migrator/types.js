// @ts-check

/**
 * @typedef {object} MigrationObjectType
 * @property {number} date - Migration timestamp parsed from filename.
 * @property {string} file - Filename for the migration.
 * @property {string} [fullPath] - Absolute path to the migration file.
 * @property {string} migrationClassName - Exported migration class name.
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
