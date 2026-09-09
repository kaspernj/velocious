import BaseCommand from "../../../base-command.js";
/** CLI command for dumping DB structure SQL files. */
export default class DbSchemaDump extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=dump.d.ts.map