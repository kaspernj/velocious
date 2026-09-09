export type VelociousCliCommandArgs = {
    /**
     * - Configuration instance for the CLI.
     */
    configuration?: import("../configuration.js").default;
    /**
     * - Parsed CLI arguments.
     */
    parsedProcessArgs?: Record<string, string | number | boolean | undefined>;
    /**
     * - Raw CLI arguments array.
     */
    processArgs?: string[];
    /**
     * - Whether the CLI is running in test mode.
     */
    testing?: boolean;
};
/**
 * VelociousCliCommandArgs type.
 * @typedef {object} VelociousCliCommandArgs
 * @property {import("../configuration.js").default} [configuration] - Configuration instance for the CLI.
 * @property {Record<string, string | number | boolean | undefined>} [parsedProcessArgs] - Parsed CLI arguments.
 * @property {string[]} [processArgs] - Raw CLI arguments array.
 * @property {boolean} [testing] - Whether the CLI is running in test mode.
 */
export default class VelociousCliBaseCommand {
    args: VelociousCliCommandArgs;
    cli: import("./index.js").default;
    _configuration: import("../configuration.js").default;
    _environmentHandler: import("../environment-handlers/base.js").default;
    processArgs: string[] | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {VelociousCliCommandArgs} args.args - Options object.
     * @param {import("./index.js").default} args.cli - Cli.
     */
    constructor({ args, cli, ...restArgs }: {
        args: VelociousCliCommandArgs;
        cli: import("./index.js").default;
    });
    /**
     * Runs directory.
     * @returns {string} - The directory.
     */
    directory(): string;
    /**
     * Runs execute.
     * @abstract
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the execute.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration(): import("../configuration.js").default;
    /**
     * Runs get environment handler.
     * @returns {import("../environment-handlers/base.js").default} - The environment handler.
     */
    getEnvironmentHandler(): import("../environment-handlers/base.js").default;
    /**
     * Runs initialize.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    initialize(): Promise<void>;
}
//# sourceMappingURL=base-command.d.ts.map