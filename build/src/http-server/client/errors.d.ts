export declare class HttpRequestBodyTooLargeError extends Error {
    /**
     * Creates a request-body limit error.
     * @param {object} args - Size details.
     * @param {number} args.actualBytes - Declared or accumulated body size.
     * @param {number} args.maxBytes - Configured maximum body size.
     */
    constructor({ actualBytes, maxBytes }: {
        actualBytes: number;
        maxBytes: number;
    });
}
export declare class HttpResponseBodyTooLargeError extends Error {
    /**
     * Creates a buffered-response limit error.
     * @param {object} args - Size details.
     * @param {number} args.actualBytes - Buffered response body size.
     * @param {number} args.maxBytes - Configured maximum body size.
     */
    constructor({ actualBytes, maxBytes }: {
        actualBytes: number;
        maxBytes: number;
    });
}
//# sourceMappingURL=errors.d.ts.map