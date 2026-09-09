/** Stable framework error for a database pool checkout that exceeded its wait limit. */
export default class DatabasePoolCheckoutTimeoutError extends Error {
    code: string;
    /**
     * Builds a database pool checkout timeout error.
     * @param {string} message - Detailed sanitized pool timeout message.
     * @param {{cause?: unknown}} [args] - Error options.
     */
    constructor(message: string, { cause }?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=checkout-timeout-error.d.ts.map