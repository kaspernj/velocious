export default class VelociousHttpServerClientResponse {
    configuration: import("../../configuration.js").default;
    _requestTimeoutMs: number | undefined;
    _requestTimeoutMsChangeHandler: ((timeoutSeconds: number | undefined) => void) | undefined;
    statusCode: number | undefined;
    statusMessage: string | undefined;
    /**
     * Body.
     * @type {string | Uint8Array | null} */
    body: string | Uint8Array | null;
    /**
     * File path.
     * @type {string | null} */
    filePath: string | null;
    /**
     * File response completion callback.
     * @type {((result: "completed" | "aborted") => void | Promise<void>) | null} */
    fileOnFinished: ((result: "completed" | "aborted") => void | Promise<void>) | null;
    /**
     * Headers.
     * @type {Record<string, string[]>} */
    headers: Record<string, string[]>;
    /**
     * Whether compression has been disabled for this specific response.
     * @type {boolean} */
    compressionDisabled: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration }: {
        configuration: import("../../configuration.js").default;
    });
    /**
     * Runs add header.
     * @param {string} key - Key.
     * @param {string} value - Value to use.
     * @returns {void} - No return value.
     */
    addHeader(key: string, value: string): void;
    /**
     * Runs set header.
     * @param {string} key - Key.
     * @param {string} value - Value to use.
     * @returns {void} - No return value.
     */
    setHeader(key: string, value: string): void;
    /**
     * Returns every value set for a header, matched case-insensitively.
     * @param {string} key - Header name.
     * @returns {string[]} - Header values in insertion order.
     */
    getHeader(key: string): string[];
    /**
     * Removes every value set for a header, matched case-insensitively.
     * @param {string} key - Header name.
     * @returns {void} - No return value.
     */
    removeHeader(key: string): void;
    /**
     * Disables HTTP response compression for this specific response, even when the
     * server is configured to compress buffered responses.
     * @returns {void} - No return value.
     */
    disableCompression(): void;
    /**
     * Runs is compression disabled.
     * @returns {boolean} - Whether compression has been disabled for this response.
     */
    isCompressionDisabled(): boolean;
    /**
     * Runs get body.
     * @returns {string | Uint8Array | null} - The body.
     */
    getBody(): string | Uint8Array | null;
    /**
     * Runs get status code.
     * @returns {number} - The status code.
     */
    getStatusCode(): number;
    /**
     * Runs get status message.
     * @returns {string} - The status message.
     */
    getStatusMessage(): string;
    /**
     * Runs set body.
     * @param {string | Uint8Array} value - Value to use.
     * @returns {void} - No return value.
     */
    setBody(value: string | Uint8Array): void;
    /**
     * Runs get file path.
     * @returns {string | null} - File path.
     */
    getFilePath(): string | null;
    /**
     * Gets the file response completion callback.
     * @returns {((result: "completed" | "aborted") => void | Promise<void>) | null} - File response completion callback.
     */
    getFileOnFinished(): ((result: "completed" | "aborted") => void | Promise<void>) | null;
    /**
     * Runs set file path.
     * @param {string} path - File path.
     * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} [onFinished] - Completion callback.
     * @returns {void} - No return value.
     */
    setFilePath(path: string, onFinished?: ((result: "completed" | "aborted") => void | Promise<void>) | null): void;
    /**
     * Runs set error body.
     * @param {Error} error - Error instance.
     * @returns {void} - No return value.
     */
    setErrorBody(error: Error): void;
    /**
     * Accepts a numeric HTTP status code (e.g. `422`) or one of the
     * named aliases (`"success"`, `"not-found"`, `"internal-server-error"`).
     * Numeric inputs in the standard 1xx-5xx range resolve their own
     * status messages from the IANA registry; aliases keep the
     * back-compatible code mapping.
     * @param {number | string} status - Status.
     * @returns {void} - No return value.
     */
    setStatus(status: number | string): void;
    /**
     * Runs get request timeout ms.
     * @returns {number | undefined} - Request timeout in seconds.
     */
    getRequestTimeoutMs(): number | undefined;
    /**
     * Runs set request timeout ms.
     * @param {number | undefined | null} timeoutSeconds - Timeout in seconds.
     * @returns {void} - No return value.
     */
    setRequestTimeoutMs(timeoutSeconds: number | undefined | null): void;
    /**
     * Runs set request timeout ms change handler.
     * @param {(timeoutSeconds: number | undefined) => void} handler - Change handler.
     * @returns {void} - No return value.
     */
    setRequestTimeoutMsChangeHandler(handler: (timeoutSeconds: number | undefined) => void): void;
}
//# sourceMappingURL=response.d.ts.map