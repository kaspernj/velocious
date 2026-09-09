export type LoggingOutputPayload = import("../../configuration-types.js").LoggingOutputPayload;
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
/** Logger console output. */
export default class LoggerConsoleOutput {
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    write({ level, message }: LoggingOutputPayload): Promise<void>;
}
//# sourceMappingURL=console-output.d.ts.map