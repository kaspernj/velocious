import BaseCommand from "../../../../../cli/base-command.js";
export type RunnerContext = import("../cli-command-context.js").CliCommandContext;
/** Node command for running project database seeds from src/db/seed.js. */
export default class DbSeed extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the seed function result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs initialize runtime.
     * @returns {Promise<void>} - Resolves when runtime initialization is complete.
     */
    initializeRuntime(): Promise<void>;
    /**
     * Runs seed file path.
     * @returns {string} - Absolute path to src/db/seed.js.
     */
    seedFilePath(): string;
    /**
     * Runs build runner context.
     * @returns {RunnerContext} - Runtime context passed to the script function.
     */
    buildRunnerContext(): RunnerContext;
}
//# sourceMappingURL=seed.d.ts.map