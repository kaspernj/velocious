export type LoggingOutputPayload = import("../../configuration-types.js").LoggingOutputPayload;
/** Logger stdout/stderr output. */
export default class LoggerStdoutOutput {
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    write({ level, message }: LoggingOutputPayload): Promise<void>;
}
//# sourceMappingURL=stdout-output.d.ts.map