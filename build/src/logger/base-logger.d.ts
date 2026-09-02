/**
 * Base logger interface for custom logger implementations.
 */
export default class BaseLogger {
    /**
     * Convert the logger into an output config.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default | undefined} [args.configuration] - Configuration instance.
     * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
     */
    toOutputConfig(args: {
        configuration?: import("../configuration.js").default | undefined;
    }): import("../configuration-types.js").LoggingOutputConfig;
    /**
     * Write a log payload.
     * @param {import("../configuration-types.js").LoggingOutputPayload} payload - Log payload.
     * @returns {Promise<void> | void} - Resolves when complete.
     */
    write(payload: import("../configuration-types.js").LoggingOutputPayload): Promise<void> | void;
}
//# sourceMappingURL=base-logger.d.ts.map