export type LoggingOutputPayload = import("../../configuration-types.js").LoggingOutputPayload;
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
/** Logger array output. */
export default class LoggerArrayOutput {
    _limit: number;
    /**
     * Levels.
     * @type {import("../../configuration-types.js").LogLevel[]} */
    levels: import("../../configuration-types.js").LogLevel[];
    /**
     * Logs.
     * @type {LoggingOutputPayload[]} */
    _logs: LoggingOutputPayload[];
    /**
     * Runs constructor.
     * @param {object} [args] - Options object.
     * @param {number} [args.limit] - Max number of log entries to keep.
     */
    constructor({ limit }?: {
        limit?: number;
    });
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    write({ level, message, subject, timestamp }: LoggingOutputPayload): Promise<void>;
    /**
     * Runs get logs.
     * @returns {LoggingOutputPayload[]} - Stored log entries.
     */
    getLogs(): LoggingOutputPayload[];
}
//# sourceMappingURL=array-output.d.ts.map