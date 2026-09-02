export default class VelociousInitializer {
    _configuration: import("./configuration.js").default;
    _processContext: import("./configuration-types.js").ApplicationProcessContext | undefined;
    _type: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {import("./configuration-types.js").ApplicationProcessContext} [args.processContext] - Framework-owned application process context.
     * @param {string} args.type - Type identifier.
     */
    constructor({ configuration, processContext, type, ...restArgs }: {
        configuration: import("./configuration.js").default;
        processContext?: import("./configuration-types.js").ApplicationProcessContext;
        type: string;
    });
    /**
     * Runs get configuration.
     * @returns {import("./configuration.js").default} - The configuration.
     */
    getConfiguration(): import("./configuration.js").default;
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType(): string;
    /**
     * Gets the immutable context for this application process lifecycle.
     * @returns {import("./configuration-types.js").ApplicationProcessContext} - Shared process context.
     */
    getProcessContext(): import("./configuration-types.js").ApplicationProcessContext;
    /**
     * Runs run.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    run(): Promise<void>;
    /**
     * Tears down application-owned process resources.
     * @returns {Promise<void>} - Resolves after optional application cleanup.
     */
    teardown(): Promise<void>;
}
//# sourceMappingURL=initializer.d.ts.map