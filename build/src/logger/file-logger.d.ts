import BaseLogger from "./base-logger.js";
/** File logger configuration wrapper. */
export default class FileLogger extends BaseLogger {
    path: string;
    levels: ("debug" | "debug-low-level" | "error" | "info" | "warn")[] | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.path - File path to write to.
     * @param {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [args.levels] - Levels to emit.
     */
    constructor({ path, levels }: {
        path: string;
        levels?: Array<"debug-low-level" | "debug" | "info" | "warn" | "error">;
    });
    /**
     * Runs to output config.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default | undefined} [args.configuration] - Configuration instance.
     * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
     */
    toOutputConfig({ configuration }?: {
        configuration?: import("../configuration.js").default | undefined;
    }): import("../configuration-types.js").LoggingOutputConfig;
}
//# sourceMappingURL=file-logger.d.ts.map