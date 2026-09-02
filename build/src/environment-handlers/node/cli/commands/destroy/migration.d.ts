import BaseCommand from "../../../../../cli/base-command.js";
export type DestroyMigrationResult = {
    destroyed: string[];
};
/**
 * DbDestroyMigration class.
 * @typedef {{destroyed: string[]}} DestroyMigrationResult
 */
export default class DbDestroyMigration extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | DestroyMigrationResult>} - Resolves with the execute.
     */
    execute(): Promise<void | DestroyMigrationResult>;
}
//# sourceMappingURL=migration.d.ts.map