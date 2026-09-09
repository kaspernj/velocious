import BaseLogger from "./base-logger.js";
/** Console logger configuration wrapper. */
export default class ConsoleLogger extends BaseLogger {
    levels: ("debug" | "debug-low-level" | "error" | "info" | "warn")[] | undefined;
    /**
     * Runs constructor.
     * @param {object} [args] - Options object.
     * @param {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [args.levels] - Levels to emit.
     */
    constructor({ levels }?: {
        levels?: Array<"debug-low-level" | "debug" | "info" | "warn" | "error">;
    });
    /**
     * Runs to output config.
     * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
     */
    toOutputConfig(): import("../configuration-types.js").LoggingOutputConfig;
}
//# sourceMappingURL=console-logger.d.ts.map