import DbBaseCommand from "./base-command.js";
export default class DbCreate extends DbBaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | Array<object>>} - Resolves with SQL statements when running in dry mode.
     */
    execute(): Promise<void | Array<object>>;
    /**
     * Runs create database.
     * @param {string} databaseIdentifier - Database identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    createDatabase(databaseIdentifier: string): Promise<void>;
    /**
     * Runs create schema migrations table.
     * @returns {Promise<void>} - Resolves when complete.
     */
    createSchemaMigrationsTable(): Promise<void>;
}
//# sourceMappingURL=create.d.ts.map