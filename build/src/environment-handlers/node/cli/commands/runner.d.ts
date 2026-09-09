import BaseCommand from "../../../../cli/base-command.js";
export type RunnerContext = import("./cli-command-context.js").CliCommandContext;
/**
 * RunnerContext type.
 * @typedef {import("./cli-command-context.js").CliCommandContext} RunnerContext
 */
/** Node command for evaluating inline JavaScript in initialized app/DB context. */
export default class RunnerCommand extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the evaluated code result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs initialize runtime.
     * @returns {Promise<void>} - Resolves when runtime initialization is complete.
     */
    initializeRuntime(): Promise<void>;
    /**
     * Runs runner code.
     * @returns {string} - Inline JavaScript code to evaluate.
     */
    runnerCode(): string;
    /**
     * Runs build runner context.
     * @returns {RunnerContext} - Runtime context passed to evaluated code.
     */
    buildRunnerContext(): RunnerContext;
    /**
     * Runs evaluate code.
     * @param {string} code - JavaScript code to evaluate.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Evaluated code result.
     */
    evaluateCode(code: string): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=runner.d.ts.map