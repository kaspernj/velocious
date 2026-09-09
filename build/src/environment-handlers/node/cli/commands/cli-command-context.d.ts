/**
 * CliCommandContext type.
 * @typedef {object} CliCommandContext
 * @property {import("../../../../configuration.js").default} configuration - Configuration instance.
 * @property {import("../../../../database/drivers/base.js").default | undefined} db - Default database connection.
 * @property {Record<string, import("../../../../database/drivers/base.js").default>} dbs - Database connections keyed by identifier.
 * @property {string[]} args - CLI args after command-specific leading arguments.
 */
export type CliCommandContext = {
    /**
     * - Configuration instance.
     */
    configuration: import("../../../../configuration.js").default;
    /**
     * - Default database connection.
     */
    db: import("../../../../database/drivers/base.js").default | undefined;
    /**
     * - Database connections keyed by identifier.
     */
    dbs: Record<string, import("../../../../database/drivers/base.js").default>;
    /**
     * - CLI args after command-specific leading arguments.
     */
    args: string[];
};
/**
 * Runs build cli command context.
 * @param {import("../../../../cli/base-command.js").default} command - Command building the context.
 * @param {number} argsOffset - Number of process args to omit.
 * @returns {CliCommandContext} - Runtime context passed to CLI command scripts.
 */
export default function buildCliCommandContext(command: import("../../../../cli/base-command.js").default, argsOffset: number): CliCommandContext;
//# sourceMappingURL=cli-command-context.d.ts.map