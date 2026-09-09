export default class VelociousDatabaseQueryJoinTracker {
    _rootModelClass: typeof import("../record/index.js").default;
    _entries: Map<any, any>;
    _tableUsage: Map<any, any>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Root model class.
     */
    constructor({ modelClass }: {
        modelClass: typeof import("../record/index.js").default;
    });
    /**
     * Runs clone.
     * @returns {VelociousDatabaseQueryJoinTracker} - The clone.
     */
    clone(): VelociousDatabaseQueryJoinTracker;
    /**
     * Runs get root model class.
     * @returns {typeof import("../record/index.js").default} - Root model class.
     */
    getRootModelClass(): typeof import("../record/index.js").default;
    /**
     * Runs path key.
     * @param {string[]} path - Join path.
     * @returns {string} - Path key.
     */
    pathKey(path: string[]): string;
    /**
     * Runs get entry.
     * @param {string[]} path - Join path.
     * @returns {{tableName: string, alias: string | undefined} | undefined} - Entry.
     */
    getEntry(path: string[]): {
        tableName: string;
        alias: string | undefined;
    } | undefined;
    /**
     * Runs register path.
     * @param {string[]} path - Join path.
     * @param {string} tableName - Table name.
     * @returns {{tableName: string, alias: string | undefined}} - Entry.
     */
    registerPath(path: string[], tableName: string): {
        tableName: string;
        alias: string | undefined;
    };
    /**
     * Runs build alias.
     * @param {string} tableName - Table name.
     * @param {string[]} path - Join path.
     * @returns {string} - Alias.
     */
    buildAlias(tableName: string, path: string[]): string;
}
//# sourceMappingURL=join-tracker.d.ts.map