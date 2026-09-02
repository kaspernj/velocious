import BaseCommand from "../base-command.js";
/** CLI command for loading and running a user-provided script file. */
export default class RunScriptCommand extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=run-script.d.ts.map