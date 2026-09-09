export type LogLevel = "debug-low-level" | "debug" | "info" | "warn" | "error";
/**
 * Runs function or messages.
 * @param {...ReturnType<typeof JSON.parse>|(() => Array<ReturnType<typeof JSON.parse>>)} messages - Messages.
 * @returns {Array<ReturnType<typeof JSON.parse>>} - Either the function result or the messages
 */
declare function functionOrMessages(...messages: (ReturnType<typeof JSON.parse> | (() => Array<ReturnType<typeof JSON.parse>>))[]): Array<ReturnType<typeof JSON.parse>>;
export default class Logger {
    _debug: boolean;
    _configuration: import("./configuration.js").default | undefined;
    _loggingConfiguration: import("./configuration-types.js").LoggingConfiguration | undefined;
    _subject: string;
    _object: object | undefined;
    /**
     * Runs constructor.
     * @param {string | object} object - Object.
     * @param {object} args - Options object.
     * @param {import("./configuration.js").default} [args.configuration] - Configuration instance.
     * @param {boolean} [args.debug] - Whether debug.
     * @param {import("./configuration-types.js").LoggingConfiguration} [args.loggingConfiguration] - Logging configuration.
     */
    constructor(object: string | object, { configuration, debug, loggingConfiguration, ...restArgs }?: {
        configuration?: import("./configuration.js").default;
        debug?: boolean;
        loggingConfiguration?: import("./configuration-types.js").LoggingConfiguration;
    });
    /**
     * Runs get configuration.
     * @returns {import("./configuration.js").default} - The configuration.
     */
    getConfiguration(): import("./configuration.js").default;
    /**
     * Runs safe configuration.
     * @returns {import("./configuration.js").default | undefined} - The safe configuration.
     */
    _safeConfiguration(): import("./configuration.js").default | undefined;
    /**
     * Runs is level enabled.
     * @param {LogLevel} level - Level.
     * @returns {boolean} - Whether any configured output emits this level.
     */
    isLevelEnabled(level: LogLevel): boolean;
    /**
     * Runs debug.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    debug(...messages: Array<ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Runs info.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    info(...messages: Array<ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Runs debug low level.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    debugLowLevel(...messages: Array<ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Runs log.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    log(...messages: Array<ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Runs error.
     * @param {Array<ReturnType<typeof JSON.parse>>} messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    error(...messages: Array<ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Runs set debug.
     * @param {boolean} newValue - New value.
     * @returns {void} - No return value.
     */
    setDebug(newValue: boolean): void;
    /**
     * Runs warn.
     * @type {(...args: Parameters<typeof functionOrMessages>) => Promise<void>}
     */
    warn(...messages: any[]): Promise<void>;
    /**
     * Runs write.
     * @param {object} args - Options object.
     * @param {LogLevel} args.level - Level.
     * @param {Parameters<typeof functionOrMessages>} args.messages - Messages.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _write({ level, messages }: {
        level: LogLevel;
        messages: Parameters<typeof functionOrMessages>;
    }): Promise<void>;
}
export {};
//# sourceMappingURL=logger.d.ts.map