/**
 * Thrown when a query is aborted via its `AbortSignal`/deadline. This is a
 * terminal, non-retryable outcome whether cancellation happened before checkout
 * or after an in-flight connection had to be destroyed.
 */
export default class QueryAbortedError extends Error {
    code: string;
    connectionDestroyed: boolean;
    sql: string | undefined;
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {unknown} [args.cause] - Error cause.
     * @param {boolean} [args.connectionDestroyed] - Whether cancellation destroyed an in-flight connection.
     * @param {string} [args.sql] - The SQL that was aborted.
     */
    constructor({ cause, connectionDestroyed, sql }?: {
        cause?: unknown;
        connectionDestroyed?: boolean;
        sql?: string;
    });
}
//# sourceMappingURL=query-aborted-error.d.ts.map