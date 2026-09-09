import BaseCommand from "../../../../../cli/base-command.js";
export type DbGenerateMigrationReturnType = {
    date: Date;
    migrationContent: string;
    migrationName: string;
    migrationNameCamelized: string;
    migrationNumber: string;
    migrationPath: string;
};
/**
 * DbGenerateMigration class.
 * @typedef {{date: Date, migrationContent: string, migrationName: string, migrationNameCamelized: string, migrationNumber: string, migrationPath: string}} DbGenerateMigrationReturnType
 */
export default class DbGenerateMigration extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | DbGenerateMigrationReturnType>} - Resolves with the execute.
     */
    execute(): Promise<void | DbGenerateMigrationReturnType>;
}
//# sourceMappingURL=migration.d.ts.map