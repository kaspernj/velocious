import BaseCommand from "../base-command.js";
/** CLI command for evaluating inline JavaScript in app context. */
export default class RunnerCommand extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=runner.d.ts.map