export default class VelociousDatabaseMigratorFilesFinder {
    path: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.path - Path.
     */
    constructor({ path, ...restArgs }: {
        path: string;
    });
    /**
     * Runs find files.
     * @returns {Promise<Array<import("./types.js").MigrationObjectType>>} - Resolves with the files.
     */
    findFiles(): Promise<Array<import("./types.js").MigrationObjectType>>;
}
//# sourceMappingURL=files-finder.d.ts.map