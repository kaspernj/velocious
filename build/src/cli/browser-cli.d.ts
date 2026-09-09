export default class VelociousBrowserCli {
    configuration: import("../configuration.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration, ...restArgs }: {
        configuration: import("../configuration.js").default;
    });
    /**
     * Runs enable.
     * @description Enable the CLI in the global scope. This is useful for debugging and testing.
     * @returns {void} - No return value.
     */
    enable(): void;
    /**
     * Runs run.
     * @description Run a command. This is useful for debugging and testing. This is a wrapper around the Cli class.
     * @param {string} command - Command.
     * @returns {Promise<void>} - Resolves when complete.
     */
    run(command: string): Promise<void>;
}
//# sourceMappingURL=browser-cli.d.ts.map