import BaseCommand from "../../../../cli/base-command.js";
export type RunScriptContext = import("./cli-command-context.js").CliCommandContext;
/** Node command for running a custom script file in initialized app/DB context. */
export default class RunScriptCommand extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the script function result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs initialize runtime.
     * @returns {Promise<void>} - Resolves when runtime initialization is complete.
     */
    initializeRuntime(): Promise<void>;
    /**
     * Runs script file path.
     * @returns {string} - Absolute path to the user-provided script file.
     */
    scriptFilePath(): string;
    /**
     * Runs build run script context.
     * @returns {RunScriptContext} - Runtime context passed to the script function.
     */
    buildRunScriptContext(): RunScriptContext;
}
//# sourceMappingURL=run-script.d.ts.map