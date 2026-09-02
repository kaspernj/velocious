export default class VelociousCli {
    args: {
        configuration?: import("../configuration.js").default;
        directory?: string;
        environmentHandler?: import("../environment-handlers/base.js").default;
        parsedProcessArgs?: Record<string, string | number | boolean | undefined>;
        processArgs?: string[];
        testing?: boolean;
    };
    configuration: import("../configuration.js").default;
    environmentHandler: import("../environment-handlers/base.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
     * @param {string} [args.directory] - Directory path.
     * @param {import("../environment-handlers/base.js").default} [args.environmentHandler] - Environment handler.
     * @param {Record<string, string | number | boolean | undefined>} [args.parsedProcessArgs] - Parsed process args.
     * @param {string[]} [args.processArgs] - Process args.
     * @param {boolean} [args.testing] - Whether testing.
     */
    constructor(args?: {
        configuration?: import("../configuration.js").default;
        directory?: string;
        environmentHandler?: import("../environment-handlers/base.js").default;
        parsedProcessArgs?: Record<string, string | number | boolean | undefined>;
        processArgs?: string[];
        testing?: boolean;
    });
    /**
     * Runs execute.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the final command result.
     */
    execute(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs execute command.
     * @param {string[]} processArgs - Process args for a single command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    executeCommand(processArgs: string[]): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs command groups.
     * @returns {Promise<string[][]>} - Command groups with process args for each command.
     */
    commandGroups(): Promise<string[][]>;
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} configuration
     */
    getConfiguration(): import("../configuration.js").default;
    /**
     * Runs has current database connections.
     * @returns {boolean} - Whether the current async context already has database connections.
     */
    hasCurrentDatabaseConnections(): boolean;
    /**
     * Runs get testing.
     * @returns {boolean} - Whether testing.
     */
    getTesting(): boolean;
}
//# sourceMappingURL=index.d.ts.map