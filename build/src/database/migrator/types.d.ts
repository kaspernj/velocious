export type MigrationObjectType = {
    /**
     * - Migration timestamp parsed from filename.
     */
    date: number;
    /**
     * - Filename for the migration.
     */
    file: string;
    /**
     * - Absolute path to the migration file.
     */
    fullPath?: string;
    /**
     * - Exported migration class name.
     */
    migrationClassName: string;
};
export type ImportCallbackType = () => typeof import("../migration/index.js").default;
export type ImportFullpathCallbackType = (arg: string) => Promise<typeof import("../migration/index.js").default>;
export type RequireMigrationType = () => Promise<typeof import("../migration/index.js").default>;
export type RequireMigrationContextRequireType = (id: string) => {
    default: typeof import("../migration/index.js").default;
};
export type RequireMigrationContextType = RequireMigrationContextRequireType & {
    keys: () => string[];
    id: string;
};
/**
 * @typedef {object} MigrationObjectType
 * @property {number} date - Migration timestamp parsed from filename.
 * @property {string} file - Filename for the migration.
 * @property {string} [fullPath] - Absolute path to the migration file.
 * @property {string} migrationClassName - Exported migration class name.
 */
/**
 * @typedef {() => typeof import("../migration/index.js").default} ImportCallbackType
 */
/**
 * @typedef {(arg: string) => Promise<typeof import("../migration/index.js").default>} ImportFullpathCallbackType
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
export {};
//# sourceMappingURL=types.d.ts.map