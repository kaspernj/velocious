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
     * Whether this response has been switched to live chunked streaming. Once
     * streaming has started, the status line and headers are emitted to the
     * client immediately and every `write()` is emitted as it happens, instead
     * of the whole body being buffered and sent once after the handler
     * returns.
     * @type {boolean} */
    streaming: boolean;
    /**
     * Whether the stream has been finished with `end()` (or finalized).
     * @type {boolean} */
    streamEnded: boolean;
    /**
     * Whether the client connection dropped while the stream was in flight.
     * @type {boolean} */
    streamAborted: boolean;
    /**
     * Transport sink wired in by the owning client so the response can emit
     * headers and chunks to the socket-bound connection.
     * @type {import("./index.js").default | null} */
    transport: import("./index.js").default | null;
    /**
     * The socket-bound request this response belongs to.
     * @type {import("./request.js").default | null} */
    transportRequest: import("./request.js").default | null;
    /**
     * Callbacks fired when the client disconnects mid-stream.
     * @type {Set<() => void>} */
    streamCloseCallbacks: Set<() => void>;
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
     * Whether this response is (or was) a live chunked stream.
     * @returns {boolean} - Whether streaming has started.
     */
    isStreaming(): boolean;
    /**
     * Whether the client disconnected mid-stream.
     * @returns {boolean} - Whether the stream was aborted by the client.
     */
    isStreamAborted(): boolean;
    /**
     * Switches this response to live chunked streaming. The status line and
     * headers are emitted to the client immediately (with a
     * `Transfer-Encoding: chunked` framing header) so `write()` chunks reach
     * the client as they are produced — instead of the whole body being
     * buffered and emitted once after the handler returns.
     *
     * Streaming requires a socket-bound HTTP request and an HTTP version that
     * supports chunked framing, a status that may carry a body, and a
     * non-HEAD request. It cannot be combined with a buffered body, a file
     * response, or a second `stream()` call.
     * @returns {void} - No return value.
     */
    stream(): void;
    /**
     * Writes one chunk to an active stream. The chunk is framed and emitted to
     * the client as soon as it is produced.
     * @param {string | Uint8Array} value - Chunk to write.
     * @returns {boolean} - Whether the chunk was accepted; false after the
     * stream was ended or the client disconnected.
     */
    write(value: string | Uint8Array): boolean;
    /**
     * Finishes an active stream: emits the chunked terminator and releases the
     * response for completion logging.
     * @returns {void} - No return value.
     */
    end(): void;
    /**
     * Registers a callback fired when the client disconnects mid-stream, so
     * the handler can release whatever the in-flight work reserved. Fired at
     * most once; also fires when the stream is finalized after the client is
     * already gone.
     * @param {() => void} callback - Disconnect callback.
     * @returns {void} - No return value.
     */
    onStreamClose(callback: () => void): void;
    /**
     * Terminates an active stream after a framework-level failure (the handler
     * threw after `stream()` started): emits the chunked terminator and runs
     * the close callbacks so in-flight work settles its resources. No-op when
     * the stream already ended or was aborted.
     * @returns {void} - No return value.
     */
    abortStream(): void;
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