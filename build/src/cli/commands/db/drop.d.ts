import DbBaseCommand from "./base-command.js";
export default class DbDrop extends DbBaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | Array<object>>} - Resolves with SQL statements when running in dry mode.
     */
    execute(): Promise<void | Array<object>>;
    /**
     * Runs system fallback database name.
     * @param {string} databaseType - Database type.
     * @returns {string} - System/maintenance database name for that driver.
     */
    systemFallbackDatabaseName(databaseType: string): string;
    /**
     * Runs drop database.
     * @param {string} databaseIdentifier - Database identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    dropDatabase(databaseIdentifier: string): Promise<void>;
}
//# sourceMappingURL=drop.d.ts.map