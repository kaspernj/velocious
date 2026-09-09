import BaseCommand from "../../base-command.js";
/** Lints model relationships (e.g. belongs-to relationships missing an inverse on the target model). */
export default class VelociousCliCommandsLintRelationships extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=relationships.d.ts.map