import BaseCommand from "../../../../cli/base-command.js";
export type ConsoleContextArgs = {
    application: import("../../../../application.js").default;
    configuration: import("../../../../configuration.js").default;
};
/** Velocious console command. */
export default class VelociousCliCommandsConsole extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=console.d.ts.map