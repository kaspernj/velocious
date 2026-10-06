// @ts-check
import { HttpResponseBodyTooLargeError } from "./errors.js";
/**
 * Named status aliases.
 * @type {Record<string, number>} */
const NAMED_STATUS_ALIASES = {
    "success": 200,
    "not-found": 404,
    "internal-server-error": 500
};
/**
 * Standard status messages.
 * @type {Record<number, string>} */
const STANDARD_STATUS_MESSAGES = {
    100: "Continue",
    101: "Switching Protocols",
    102: "Processing",
    103: "Early Hints",
    200: "OK",
    201: "Created",
    202: "Accepted",
    203: "Non-Authoritative Information",
    204: "No Content",
    205: "Reset Content",
    206: "Partial Content",
    207: "Multi-Status",
    208: "Already Reported",
    226: "IM Used",
    300: "Multiple Choices",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    305: "Use Proxy",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    407: "Proxy Authentication Required",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    411: "Length Required",
    412: "Precondition Failed",
    413: "Payload Too Large",
    414: "URI Too Long",
    415: "Unsupported Media Type",
    416: "Range Not Satisfiable",
    417: "Expectation Failed",
    418: "I'm a teapot",
    421: "Misdirected Request",
    422: "Unprocessable Entity",
    423: "Locked",
    424: "Failed Dependency",
    425: "Too Early",
    426: "Upgrade Required",
    428: "Precondition Required",
    429: "Too Many Requests",
    431: "Request Header Fields Too Large",
    451: "Unavailable For Legal Reasons",
    500: "Internal server error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
    505: "HTTP Version Not Supported",
    506: "Variant Also Negotiates",
    507: "Insufficient Storage",
    508: "Loop Detected",
    510: "Not Extended",
    511: "Network Authentication Required"
};
export default class VelociousHttpServerClientResponse {
    /**
     * Body.
     * @type {string | Uint8Array | null} */
    body = null;
    /**
     * File path.
     * @type {string | null} */
    filePath = null;
    /**
     * File response completion callback.
     * @type {((result: "completed" | "aborted") => void | Promise<void>) | null} */
    fileOnFinished = null;
    /**
     * Headers.
     * @type {Record<string, string[]>} */
    headers = {};
    /**
     * Whether compression has been disabled for this specific response.
     * @type {boolean} */
    compressionDisabled = false;
    /**
     * Whether this response has been switched to live chunked streaming. Once
     * streaming has started, the status line and headers are emitted to the
     * client immediately and every `write()` is emitted as it happens, instead
     * of the whole body being buffered and sent once after the handler
     * returns.
     * @type {boolean} */
    streaming = false;
    /**
     * Whether the stream has been finished with `end()` (or finalized).
     * @type {boolean} */
    streamEnded = false;
    /**
     * Whether the client connection dropped while the stream was in flight.
     * @type {boolean} */
    streamAborted = false;
    /**
     * Transport sink wired in by the owning client so the response can emit
     * headers and chunks to the socket-bound connection.
     * @type {import("./index.js").default | null} */
    transport = null;
    /**
     * The socket-bound request this response belongs to.
     * @type {import("./request.js").default | null} */
    transportRequest = null;
    /**
     * Callbacks fired when the client disconnects mid-stream.
     * @type {Set<() => void>} */
    streamCloseCallbacks = new Set();
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     */
    constructor({ configuration }) {
        this.configuration = configuration;
        this._requestTimeoutMs = undefined;
        this._requestTimeoutMsChangeHandler = undefined;
    }
    /**
     * Runs add header.
     * @param {string} key - Key.
     * @param {string} value - Value to use.
     * @returns {void} - No return value.
     */
    addHeader(key, value) {
        if (!(key in this.headers)) {
            this.headers[key] = [];
        }
        this.headers[key].push(value);
    }
    /**
     * Runs set header.
     * @param {string} key - Key.
     * @param {string} value - Value to use.
     * @returns {void} - No return value.
     */
    setHeader(key, value) {
        this.headers[key] = [value];
    }
    /**
     * Returns every value set for a header, matched case-insensitively.
     * @param {string} key - Header name.
     * @returns {string[]} - Header values in insertion order.
     */
    getHeader(key) {
        const lowerCaseKey = key.toLowerCase();
        /** @type {string[]} */
        const values = [];
        for (const headerKey in this.headers) {
            if (headerKey.toLowerCase() == lowerCaseKey) {
                values.push(...this.headers[headerKey]);
            }
        }
        return values;
    }
    /**
     * Removes every value set for a header, matched case-insensitively.
     * @param {string} key - Header name.
     * @returns {void} - No return value.
     */
    removeHeader(key) {
        const lowerCaseKey = key.toLowerCase();
        for (const headerKey in this.headers) {
            if (headerKey.toLowerCase() == lowerCaseKey) {
                delete this.headers[headerKey];
            }
        }
    }
    /**
     * Disables HTTP response compression for this specific response, even when the
     * server is configured to compress buffered responses.
     * @returns {void} - No return value.
     */
    disableCompression() {
        this.compressionDisabled = true;
    }
    /**
     * Runs is compression disabled.
     * @returns {boolean} - Whether compression has been disabled for this response.
     */
    isCompressionDisabled() {
        return this.compressionDisabled;
    }
    /**
     * Runs get body.
     * @returns {string | Uint8Array | null} - The body.
     */
    getBody() {
        if (this.body !== undefined) {
            return this.body;
        }
        throw new Error("No body has been set");
    }
    /**
     * Runs get status code.
     * @returns {number} - The status code.
     */
    getStatusCode() {
        return this.statusCode || 200;
    }
    /**
     * Runs get status message.
     * @returns {string} - The status message.
     */
    getStatusMessage() {
        return this.statusMessage || "OK";
    }
    /**
     * Runs set body.
     * @param {string | Uint8Array} value - Value to use.
     * @returns {void} - No return value.
     */
    setBody(value) {
        this.filePath = null;
        this.fileOnFinished = null;
        const actualBytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
        const maxBytes = this.configuration.getHttpServerMaxBufferedResponseBodyBytes();
        if (maxBytes !== undefined && actualBytes > maxBytes) {
            this.body = "";
            throw new HttpResponseBodyTooLargeError({ actualBytes, maxBytes });
        }
        this.body = value;
    }
    /**
     * Whether this response is (or was) a live chunked stream.
     * @returns {boolean} - Whether streaming has started.
     */
    isStreaming() {
        return this.streaming;
    }
    /**
     * Whether the client disconnected mid-stream.
     * @returns {boolean} - Whether the stream was aborted by the client.
     */
    isStreamAborted() {
        return this.streamAborted;
    }
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
    stream() {
        if (this.streaming)
            throw new Error("The response is already streaming");
        if (this.filePath !== null)
            throw new Error("A file response cannot be switched to streaming");
        if (this.body !== null && this.body !== undefined)
            throw new Error("A buffered body was already set; call stream() before setBody() to stream instead");
        if (this.transport === null)
            throw new Error("Streaming responses require a socket-bound HTTP request");
        const request = this.transportRequest;
        if (!request)
            throw new Error("Streaming responses require a socket-bound HTTP request");
        if (request.httpMethod() === "HEAD")
            throw new Error("HEAD responses cannot stream a body");
        const statusCode = this.getStatusCode();
        if ((statusCode >= 100 && statusCode < 200) || statusCode === 204 || statusCode === 304) {
            throw new Error(`Status ${statusCode} cannot carry a streaming body`);
        }
        this.streaming = true;
        this.transport.beginStreamResponse(this, request);
    }
    /**
     * Emits one chunk to the client as soon as it is produced. Returns a
     * promise that settles once the chunk has been delivered to the socket, so
     * a relay loop can `await response.write(chunk)` and get socket
     * backpressure without an ad-hoc drain wait. Rejects when the stream has
     * ended or been aborted, or when the outbound delivery queue cannot accept
     * the chunk (a stalled client).
     * @param {string | Uint8Array} value - Chunk to emit.
     * @returns {Promise<void>} - Settles after the chunk is delivered.
     */
    async write(value) {
        if (this.transport === null)
            throw new Error("write() requires an active streaming response");
        if (!this.streaming)
            throw new Error("write() requires stream() to be called first");
        if (this.streamEnded || this.streamAborted)
            return;
        await this.transport.writeStreamChunk(value);
    }
    /**
     * Finishes an active stream: emits the chunked terminator and releases the
     * response for completion logging. Settles after the terminator has been
     * delivered to the socket.
     * @returns {Promise<void>} - Settles after the stream is finished.
     */
    async end() {
        if (this.transport === null)
            throw new Error("end() requires an active streaming response");
        if (!this.streaming)
            throw new Error("end() requires stream() to be called first");
        if (this.streamEnded)
            return;
        await this.transport.endStreamResponse(this);
    }
    /**
     * Registers a callback fired when the client disconnects mid-stream, so
     * the handler can release whatever the in-flight work reserved. Fired at
     * most once; also fires when the stream is finalized after the client is
     * already gone.
     * @param {() => void} callback - Disconnect callback.
     * @returns {void} - No return value.
     */
    onStreamClose(callback) {
        this.streamCloseCallbacks.add(callback);
    }
    /**
     * Terminates an active stream after a framework-level failure (the handler
     * threw after `stream()` started): emits the chunked terminator and runs
     * the close callbacks so in-flight work settles its resources. No-op when
     * the stream already ended or was aborted.
     * @returns {void} - No return value.
     */
    abortStream() {
        if (!this.streaming || this.streamEnded || this.transport === null)
            return;
        this.streamEnded = true;
        this.transport.endStreamResponse(this);
    }
    /**
     * Runs get file path.
     * @returns {string | null} - File path.
     */
    getFilePath() {
        return this.filePath;
    }
    /**
     * Gets the file response completion callback.
     * @returns {((result: "completed" | "aborted") => void | Promise<void>) | null} - File response completion callback.
     */
    getFileOnFinished() {
        return this.fileOnFinished;
    }
    /**
     * Runs set file path.
     * @param {string} path - File path.
     * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} [onFinished] - Completion callback.
     * @returns {void} - No return value.
     */
    setFilePath(path, onFinished = null) {
        this.filePath = path;
        this.fileOnFinished = onFinished;
        this.body = null;
    }
    /**
     * Runs set error body.
     * @param {Error} error - Error instance.
     * @returns {void} - No return value.
     */
    setErrorBody(error) {
        this.setHeader("Content-Type", "text/plain; charset=UTF-8");
        this.setBody(`${error.message}\n\n${error.stack}`);
    }
    /**
     * Accepts a numeric HTTP status code (e.g. `422`) or one of the
     * named aliases (`"success"`, `"not-found"`, `"internal-server-error"`).
     * Numeric inputs in the standard 1xx-5xx range resolve their own
     * status messages from the IANA registry; aliases keep the
     * back-compatible code mapping.
     * @param {number | string} status - Status.
     * @returns {void} - No return value.
     */
    setStatus(status) {
        const aliasCode = NAMED_STATUS_ALIASES[String(status)];
        const numericStatus = aliasCode ?? Number(status);
        if (!Number.isInteger(numericStatus) || numericStatus < 100 || numericStatus > 599) {
            throw new Error(`Unhandled status: ${status}`);
        }
        this.statusCode = numericStatus;
        this.statusMessage = STANDARD_STATUS_MESSAGES[numericStatus] || "OK";
    }
    /**
     * Runs get request timeout ms.
     * @returns {number | undefined} - Request timeout in seconds.
     */
    getRequestTimeoutMs() {
        return this._requestTimeoutMs;
    }
    /**
     * Runs set request timeout ms.
     * @param {number | undefined | null} timeoutSeconds - Timeout in seconds.
     * @returns {void} - No return value.
     */
    setRequestTimeoutMs(timeoutSeconds) {
        if (typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds)) {
            this._requestTimeoutMs = timeoutSeconds;
        }
        else {
            this._requestTimeoutMs = undefined;
        }
        if (this._requestTimeoutMsChangeHandler) {
            this._requestTimeoutMsChangeHandler(this._requestTimeoutMs);
        }
    }
    /**
     * Runs set request timeout ms change handler.
     * @param {(timeoutSeconds: number | undefined) => void} handler - Change handler.
     * @returns {void} - No return value.
     */
    setRequestTimeoutMsChangeHandler(handler) {
        this._requestTimeoutMsChangeHandler = handler;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsNkJBQTZCLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFekQ7O29DQUVvQztBQUNwQyxNQUFNLG9CQUFvQixHQUFHO0lBQzNCLFNBQVMsRUFBRSxHQUFHO0lBQ2QsV0FBVyxFQUFFLEdBQUc7SUFDaEIsdUJBQXVCLEVBQUUsR0FBRztDQUM3QixDQUFBO0FBRUQ7O29DQUVvQztBQUNwQyxNQUFNLHdCQUF3QixHQUFHO0lBQy9CLEdBQUcsRUFBRSxVQUFVO0lBQ2YsR0FBRyxFQUFFLHFCQUFxQjtJQUMxQixHQUFHLEVBQUUsWUFBWTtJQUNqQixHQUFHLEVBQUUsYUFBYTtJQUNsQixHQUFHLEVBQUUsSUFBSTtJQUNULEdBQUcsRUFBRSxTQUFTO0lBQ2QsR0FBRyxFQUFFLFVBQVU7SUFDZixHQUFHLEVBQUUsK0JBQStCO0lBQ3BDLEdBQUcsRUFBRSxZQUFZO0lBQ2pCLEdBQUcsRUFBRSxlQUFlO0lBQ3BCLEdBQUcsRUFBRSxpQkFBaUI7SUFDdEIsR0FBRyxFQUFFLGNBQWM7SUFDbkIsR0FBRyxFQUFFLGtCQUFrQjtJQUN2QixHQUFHLEVBQUUsU0FBUztJQUNkLEdBQUcsRUFBRSxrQkFBa0I7SUFDdkIsR0FBRyxFQUFFLG1CQUFtQjtJQUN4QixHQUFHLEVBQUUsT0FBTztJQUNaLEdBQUcsRUFBRSxXQUFXO0lBQ2hCLEdBQUcsRUFBRSxjQUFjO0lBQ25CLEdBQUcsRUFBRSxXQUFXO0lBQ2hCLEdBQUcsRUFBRSxvQkFBb0I7SUFDekIsR0FBRyxFQUFFLG9CQUFvQjtJQUN6QixHQUFHLEVBQUUsYUFBYTtJQUNsQixHQUFHLEVBQUUsY0FBYztJQUNuQixHQUFHLEVBQUUsa0JBQWtCO0lBQ3ZCLEdBQUcsRUFBRSxXQUFXO0lBQ2hCLEdB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QUFtQixDQUFDLGNBQWM7UUFDaEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQzFFLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxjQUFjLENBQUE7UUFDekMsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsaUJBQWlCLEdBQUcsU0FBUyxDQUFBO1FBQ3BDLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxDQUFDO1lBQ3hDLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUM3RCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQ0FBZ0MsQ0FBQyxPQUFPO1FBQ3RDLElBQUksQ0FBQyw4QkFBOEIsR0FBRyxPQUFPLENBQUE7SUFDL0MsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7SHR0cFJlc3BvbnNlQm9keVRvb0xhcmdlRXJyb3J9IGZyb20gXCIuL2Vycm9ycy5qc1wiXG5cbi8qKlxuICogTmFtZWQgc3RhdHVzIGFsaWFzZXMuXG4gKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbmNvbnN0IE5BTUVEX1NUQVRVU19BTElBU0VTID0ge1xuICBcInN1Y2Nlc3NcIjogMjAwLFxuICBcIm5vdC1mb3VuZFwiOiA0MDQsXG4gIFwiaW50ZXJuYWwtc2VydmVyLWVycm9yXCI6IDUwMFxufVxuXG4vKipcbiAqIFN0YW5kYXJkIHN0YXR1cyBtZXNzYWdlcy5cbiAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyLCBzdHJpbmc+fSAqL1xuY29uc3QgU1RBTkRBUkRfU1RBVFVTX01FU1NBR0VTID0ge1xuICAxMDA6IFwiQ29udGludWVcIixcbiAgMTAxOiBcIlN3aXRjaGluZyBQcm90b2NvbHNcIixcbiAgMTAyOiBcIlByb2Nlc3NpbmdcIixcbiAgMTAzOiBcIkVhcmx5IEhpbnRzXCIsXG4gIDIwMDogXCJPS1wiLFxuICAyMDE6IFwiQ3JlYXRlZFwiLFxuICAyMDI6IFwiQWNjZXB0ZWRcIixcbiAgMjAzOiBcIk5vbi1BdXRob3JpdGF0aXZlIEluZm9ybWF0aW9uXCIsXG4gIDIwNDogXCJObyBDb250ZW50XCIsXG4gIDIwNTogXCJSZXNldCBDb250ZW50XCIsXG4gIDIwNjogXCJQYXJ0aWFsIENvbnRlbnRcIixcbiAgMjA3OiBcIk11bHRpLVN0YXR1c1wiLFxuICAyMDg6IFwiQWxyZWFkeSBSZXBvcnRlZFwiLFxuICAyMjY6IFwiSU0gVXNlZFwiLFxuICAzMDA6IFwiTXVsdGlwbGUgQ2hvaWNlc1wiLFxuICAzMDE6IFwiTW92ZWQgUGVybWFuZW50bHlcIixcbiAgMzAyOiBcIkZvdW5kXCIsXG4gIDMwMzogXCJTZWUgT3RoZXJcIixcbiAgMzA0OiBcIk5vdCBNb2RpZmllZFwiLFxuICAzMDU6IFwiVXNlIFByb3h5XCIsXG4gIDMwNzogXCJUZW1wb3JhcnkgUmVkaXJlY3RcIixcbiAgMzA4OiBcIlBlcm1hbmVudCBSZWRpcmVjdFwiLFxuICA0MDA6IFwiQmFkIFJlcXVlc3RcIixcbiAgNDAxOiBcIlVuYXV0aG9yaXplZFwiLFxuICA0MDI6IFwiUGF5bWVudCBSZXF1aXJlZFwiLFxuICA0MDM6IFwiRm9yYmlkZGVuXCIsXG4gIDQwNDogXCJOb3QgRm91bmRcIixcbiAgNDA1OiBcIk1ldGhvZCBOb3QgQWxsb3dlZFwiLFxuICA0MDY6IFwiTm90IEFjY2VwdGFibGVcIixcbiAgNDA3OiBcIlByb3h5IEF1dGhlbnRpY2F0aW9uIFJlcXVpcmVkXCIsXG4gIDQwODogXCJSZXF1ZXN0IFRpbWVvdXRcIixcbiAgNDA5OiBcIkNvbmZsaWN0XCIsXG4gIDQxMDogXCJHb25lXCIsXG4gIDQxMTogXCJMZW5ndGggUmVxdWlyZWRcIixcbiAgNDEyOiBcIlByZWNvbmRpdGlvbiBGYWlsZWRcIixcbiAgNDEzOiBcIlBheWxvYWQgVG9vIExhcmdlXCIsXG4gIDQxNDogXCJVUkkgVG9vIExvbmdcIixcbiAgNDE1OiBcIlVuc3VwcG9ydGVkIE1lZGlhIFR5cGVcIixcbiAgNDE2OiBcIlJhbmdlIE5vdCBTYXRpc2ZpYWJsZVwiLFxuICA0MTc6IFwiRXhwZWN0YXRpb24gRmFpbGVkXCIsXG4gIDQxODogXCJJJ20gYSB0ZWFwb3RcIixcbiAgNDIxOiBcIk1pc2RpcmVjdGVkIFJlcXVlc3RcIixcbiAgNDIyOiBcIlVucHJvY2Vzc2FibGUgRW50aXR5XCIsXG4gIDQyMzogXCJMb2NrZWRcIixcbiAgNDI0OiBcIkZhaWxlZCBEZXBlbmRlbmN5XCIsXG4gIDQyNTogXCJUb28gRWFybHlcIixcbiAgNDI2OiBcIlVwZ3JhZGUgUmVxdWlyZWRcIixcbiAgNDI4OiBcIlByZWNvbmRpdGlvbiBSZXF1aXJlZFwiLFxuICA0Mjk6IFwiVG9vIE1hbnkgUmVxdWVzdHNcIixcbiAgNDMxOiBcIlJlcXVlc3QgSGVhZGVyIEZpZWxkcyBUb28gTGFyZ2VcIixcbiAgNDUxOiBcIlVuYXZhaWxhYmxlIEZvciBMZWdhbCBSZWFzb25zXCIsXG4gIDUwMDogXCJJbnRlcm5hbCBzZXJ2ZXIgZXJyb3JcIixcbiAgNTAxOiBcIk5vdCBJbXBsZW1lbnRlZFwiLFxuICA1MDI6IFwiQmFkIEdhdGV3YXlcIixcbiAgNTAzOiBcIlNlcnZpY2UgVW5hdmFpbGFibGVcIixcbiAgNTA0OiBcIkdhdGV3YXkgVGltZW91dFwiLFxuICA1MDU6IFwiSFRUUCBWZXJzaW9uIE5vdCBTdXBwb3J0ZWRcIixcbiAgNTA2OiBcIlZhcmlhbnQgQWxzbyBOZWdvdGlhdGVzXCIsXG4gIDUwNzogXCJJbnN1ZmZpY2llbnQgU3RvcmFnZVwiLFxuICA1MDg6IFwiTG9vcCBEZXRlY3RlZFwiLFxuICA1MTA6IFwiTm90IEV4dGVuZGVkXCIsXG4gIDUxMTogXCJOZXR3b3JrIEF1dGhlbnRpY2F0aW9uIFJlcXVpcmVkXCJcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFJlc3BvbnNlIHtcbiAgLyoqXG4gICAqIEJvZHkuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCBVaW50OEFycmF5IHwgbnVsbH0gKi9cbiAgYm9keSA9IG51bGxcblxuICAvKipcbiAgICogRmlsZSBwYXRoLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgZmlsZVBhdGggPSBudWxsXG5cbiAgLyoqXG4gICAqIEZpbGUgcmVzcG9uc2UgY29tcGxldGlvbiBjYWxsYmFjay5cbiAgICogQHR5cGUgeygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9ICovXG4gIGZpbGVPbkZpbmlzaGVkID0gbnVsbFxuXG4gIC8qKlxuICAgKiBIZWFkZXJzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICBoZWFkZXJzID0ge31cblxuICAvKipcbiAgICogV2hldGhlciBjb21wcmVzc2lvbiBoYXMgYmVlbiBkaXNhYmxlZCBmb3IgdGhpcyBzcGVjaWZpYyByZXNwb25zZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIGNvbXByZXNzaW9uRGlzYWJsZWQgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgcmVzcG9uc2UgaGFzIGJlZW4gc3dpdGNoZWQgdG8gbGl2ZSBjaHVua2VkIHN0cmVhbWluZy4gT25jZVxuICAgKiBzdHJlYW1pbmcgaGFzIHN0YXJ0ZWQsIHRoZSBzdGF0dXMgbGluZSBhbmQgaGVhZGVycyBhcmUgZW1pdHRlZCB0byB0aGVcbiAgICogY2xpZW50IGltbWVkaWF0ZWx5IGFuZCBldmVyeSBgd3JpdGUoKWAgaXMgZW1pdHRlZCBhcyBpdCBoYXBwZW5zLCBpbnN0ZWFkXG4gICAqIG9mIHRoZSB3aG9sZSBib2R5IGJlaW5nIGJ1ZmZlcmVkIGFuZCBzZW50IG9uY2UgYWZ0ZXIgdGhlIGhhbmRsZXJcbiAgICogcmV0dXJucy5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIHN0cmVhbWluZyA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHN0cmVhbSBoYXMgYmVlbiBmaW5pc2hlZCB3aXRoIGBlbmQoKWAgKG9yIGZpbmFsaXplZCkuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBzdHJlYW1FbmRlZCA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGNsaWVudCBjb25uZWN0aW9uIGRyb3BwZWQgd2hpbGUgdGhlIHN0cmVhbSB3YXMgaW4gZmxpZ2h0LlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgc3RyZWFtQWJvcnRlZCA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFRyYW5zcG9ydCBzaW5rIHdpcmVkIGluIGJ5IHRoZSBvd25pbmcgY2xpZW50IHNvIHRoZSByZXNwb25zZSBjYW4gZW1pdFxuICAgKiBoZWFkZXJzIGFuZCBjaHVua3MgdG8gdGhlIHNvY2tldC1ib3VuZCBjb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgdHJhbnNwb3J0ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBUaGUgc29ja2V0LWJvdW5kIHJlcXVlc3QgdGhpcyByZXNwb25zZSBiZWxvbmdzIHRvLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICB0cmFuc3BvcnRSZXF1ZXN0ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBDYWxsYmFja3MgZmlyZWQgd2hlbiB0aGUgY2xpZW50IGRpc2Nvbm5lY3RzIG1pZC1zdHJlYW0uXG4gICAqIEB0eXBlIHtTZXQ8KCkgPT4gdm9pZD59ICovXG4gIHN0cmVhbUNsb3NlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRIZWFkZXIoa2V5LCB2YWx1ZSkge1xuICAgIGlmICghKGtleSBpbiB0aGlzLmhlYWRlcnMpKSB7XG4gICAgICB0aGlzLmhlYWRlcnNba2V5XSA9IFtdXG4gICAgfVxuXG4gICAgdGhpcy5oZWFkZXJzW2tleV0ucHVzaCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBLZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SGVhZGVyKGtleSwgdmFsdWUpIHtcbiAgICB0aGlzLmhlYWRlcnNba2V5XSA9IFt2YWx1ZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGV2ZXJ5IHZhbHVlIHNldCBmb3IgYSBoZWFkZXIsIG1hdGNoZWQgY2FzZS1pbnNlbnNpdGl2ZWx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gSGVhZGVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBIZWFkZXIgdmFsdWVzIGluIGluc2VydGlvbiBvcmRlci5cbiAgICovXG4gIGdldEhlYWRlcihrZXkpIHtcbiAgICBjb25zdCBsb3dlckNhc2VLZXkgPSBrZXkudG9Mb3dlckNhc2UoKVxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB2YWx1ZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gdGhpcy5oZWFkZXJzKSB7XG4gICAgICBpZiAoaGVhZGVyS2V5LnRvTG93ZXJDYXNlKCkgPT0gbG93ZXJDYXNlS2V5KSB7XG4gICAgICAgIHZhbHVlcy5wdXNoKC4uLnRoaXMuaGVhZGVyc1toZWFkZXJLZXldKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGV2ZXJ5IHZhbHVlIHNldCBmb3IgYSBoZWFkZXIsIG1hdGNoZWQgY2FzZS1pbnNlbnNpdGl2ZWx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gSGVhZGVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlbW92ZUhlYWRlcihrZXkpIHtcbiAgICBjb25zdCBsb3dlckNhc2VLZXkgPSBrZXkudG9Mb3dlckNhc2UoKVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gdGhpcy5oZWFkZXJzKSB7XG4gICAgICBpZiAoaGVhZGVyS2V5LnRvTG93ZXJDYXNlKCkgPT0gbG93ZXJDYXNlS2V5KSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmhlYWRlcnNbaGVhZGVyS2V5XVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlcyBIVFRQIHJlc3BvbnNlIGNvbXByZXNzaW9uIGZvciB0aGlzIHNwZWNpZmljIHJlc3BvbnNlLCBldmVuIHdoZW4gdGhlXG4gICAqIHNlcnZlciBpcyBjb25maWd1cmVkIHRvIGNvbXByZXNzIGJ1ZmZlcmVkIHJlc3BvbnNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZGlzYWJsZUNvbXByZXNzaW9uKCkge1xuICAgIHRoaXMuY29tcHJlc3Npb25EaXNhYmxlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNvbXByZXNzaW9uIGRpc2FibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNvbXByZXNzaW9uIGhhcyBiZWVuIGRpc2FibGVkIGZvciB0aGlzIHJlc3BvbnNlLlxuICAgKi9cbiAgaXNDb21wcmVzc2lvbkRpc2FibGVkKCkge1xuICAgIHJldHVybiB0aGlzLmNvbXByZXNzaW9uRGlzYWJsZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBib2R5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgVWludDhBcnJheSB8IG51bGx9IC0gVGhlIGJvZHkuXG4gICAqL1xuICBnZXRCb2R5KCkge1xuICAgIGlmICh0aGlzLmJvZHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHRoaXMuYm9keVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGJvZHkgaGFzIGJlZW4gc2V0XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RhdHVzIGNvZGUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgZ2V0U3RhdHVzQ29kZSgpIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0dXNDb2RlIHx8IDIwMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN0YXR1cyBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBzdGF0dXMgbWVzc2FnZS5cbiAgICovXG4gIGdldFN0YXR1c01lc3NhZ2UoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdHVzTWVzc2FnZSB8fCBcIk9LXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBib2R5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IFVpbnQ4QXJyYXl9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRCb2R5KHZhbHVlKSB7XG4gICAgdGhpcy5maWxlUGF0aCA9IG51bGxcbiAgICB0aGlzLmZpbGVPbkZpbmlzaGVkID0gbnVsbFxuXG4gICAgY29uc3QgYWN0dWFsQnl0ZXMgPSB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyBCdWZmZXIuYnl0ZUxlbmd0aCh2YWx1ZSwgXCJ1dGY4XCIpIDogdmFsdWUuYnl0ZUxlbmd0aFxuICAgIGNvbnN0IG1heEJ5dGVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEh0dHBTZXJ2ZXJNYXhCdWZmZXJlZFJlc3BvbnNlQm9keUJ5dGVzKClcblxuICAgIGlmIChtYXhCeXRlcyAhPT0gdW5kZWZpbmVkICYmIGFjdHVhbEJ5dGVzID4gbWF4Qnl0ZXMpIHtcbiAgICAgIHRoaXMuYm9keSA9IFwiXCJcbiAgICAgIHRocm93IG5ldyBIdHRwUmVzcG9uc2VCb2R5VG9vTGFyZ2VFcnJvcih7YWN0dWFsQnl0ZXMsIG1heEJ5dGVzfSlcbiAgICB9XG5cbiAgICB0aGlzLmJvZHkgPSB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyByZXNwb25zZSBpcyAob3Igd2FzKSBhIGxpdmUgY2h1bmtlZCBzdHJlYW0uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3RyZWFtaW5nIGhhcyBzdGFydGVkLlxuICAgKi9cbiAgaXNTdHJlYW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3RyZWFtaW5nXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgY2xpZW50IGRpc2Nvbm5lY3RlZCBtaWQtc3RyZWFtLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBzdHJlYW0gd2FzIGFib3J0ZWQgYnkgdGhlIGNsaWVudC5cbiAgICovXG4gIGlzU3RyZWFtQWJvcnRlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5zdHJlYW1BYm9ydGVkXG4gIH1cblxuICAvKipcbiAgICogU3dpdGNoZXMgdGhpcyByZXNwb25zZSB0byBsaXZlIGNodW5rZWQgc3RyZWFtaW5nLiBUaGUgc3RhdHVzIGxpbmUgYW5kXG4gICAqIGhlYWRlcnMgYXJlIGVtaXR0ZWQgdG8gdGhlIGNsaWVudCBpbW1lZGlhdGVseSAod2l0aCBhXG4gICAqIGBUcmFuc2Zlci1FbmNvZGluZzogY2h1bmtlZGAgZnJhbWluZyBoZWFkZXIpIHNvIGB3cml0ZSgpYCBjaHVua3MgcmVhY2hcbiAgICogdGhlIGNsaWVudCBhcyB0aGV5IGFyZSBwcm9kdWNlZCDigJQgaW5zdGVhZCBvZiB0aGUgd2hvbGUgYm9keSBiZWluZ1xuICAgKiBidWZmZXJlZCBhbmQgZW1pdHRlZCBvbmNlIGFmdGVyIHRoZSBoYW5kbGVyIHJldHVybnMuXG4gICAqXG4gICAqIFN0cmVhbWluZyByZXF1aXJlcyBhIHNvY2tldC1ib3VuZCBIVFRQIHJlcXVlc3QgYW5kIGFuIEhUVFAgdmVyc2lvbiB0aGF0XG4gICAqIHN1cHBvcnRzIGNodW5rZWQgZnJhbWluZywgYSBzdGF0dXMgdGhhdCBtYXkgY2FycnkgYSBib2R5LCBhbmQgYVxuICAgKiBub24tSEVBRCByZXF1ZXN0LiBJdCBjYW5ub3QgYmUgY29tYmluZWQgd2l0aCBhIGJ1ZmZlcmVkIGJvZHksIGEgZmlsZVxuICAgKiByZXNwb25zZSwgb3IgYSBzZWNvbmQgYHN0cmVhbSgpYCBjYWxsLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdHJlYW0oKSB7XG4gICAgaWYgKHRoaXMuc3RyZWFtaW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgcmVzcG9uc2UgaXMgYWxyZWFkeSBzdHJlYW1pbmdcIilcbiAgICBpZiAodGhpcy5maWxlUGF0aCAhPT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKFwiQSBmaWxlIHJlc3BvbnNlIGNhbm5vdCBiZSBzd2l0Y2hlZCB0byBzdHJlYW1pbmdcIilcbiAgICBpZiAodGhpcy5ib2R5ICE9PSBudWxsICYmIHRoaXMuYm9keSAhPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJBIGJ1ZmZlcmVkIGJvZHkgd2FzIGFscmVhZHkgc2V0OyBjYWxsIHN0cmVhbSgpIGJlZm9yZSBzZXRCb2R5KCkgdG8gc3RyZWFtIGluc3RlYWRcIilcbiAgICBpZiAodGhpcy50cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBFcnJvcihcIlN0cmVhbWluZyByZXNwb25zZXMgcmVxdWlyZSBhIHNvY2tldC1ib3VuZCBIVFRQIHJlcXVlc3RcIilcblxuICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLnRyYW5zcG9ydFJlcXVlc3RcbiAgICBpZiAoIXJlcXVlc3QpIHRocm93IG5ldyBFcnJvcihcIlN0cmVhbWluZyByZXNwb25zZXMgcmVxdWlyZSBhIHNvY2tldC1ib3VuZCBIVFRQIHJlcXVlc3RcIilcblxuICAgIGlmIChyZXF1ZXN0Lmh0dHBNZXRob2QoKSA9PT0gXCJIRUFEXCIpIHRocm93IG5ldyBFcnJvcihcIkhFQUQgcmVzcG9uc2VzIGNhbm5vdCBzdHJlYW0gYSBib2R5XCIpXG5cbiAgICBjb25zdCBzdGF0dXNDb2RlID0gdGhpcy5nZXRTdGF0dXNDb2RlKClcbiAgICBpZiAoKHN0YXR1c0NvZGUgPj0gMTAwICYmIHN0YXR1c0NvZGUgPCAyMDApIHx8IHN0YXR1c0NvZGUgPT09IDIwNCB8fCBzdGF0dXNDb2RlID09PSAzMDQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3RhdHVzICR7c3RhdHVzQ29kZX0gY2Fubm90IGNhcnJ5IGEgc3RyZWFtaW5nIGJvZHlgKVxuICAgIH1cblxuICAgIHRoaXMuc3RyZWFtaW5nID0gdHJ1ZVxuICAgIHRoaXMudHJhbnNwb3J0LmJlZ2luU3RyZWFtUmVzcG9uc2UodGhpcywgcmVxdWVzdClcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBvbmUgY2h1bmsgdG8gdGhlIGNsaWVudCBhcyBzb29uIGFzIGl0IGlzIHByb2R1Y2VkLiBSZXR1cm5zIGFcbiAgICogcHJvbWlzZSB0aGF0IHNldHRsZXMgb25jZSB0aGUgY2h1bmsgaGFzIGJlZW4gZGVsaXZlcmVkIHRvIHRoZSBzb2NrZXQsIHNvXG4gICAqIGEgcmVsYXkgbG9vcCBjYW4gYGF3YWl0IHJlc3BvbnNlLndyaXRlKGNodW5rKWAgYW5kIGdldCBzb2NrZXRcbiAgICogYmFja3ByZXNzdXJlIHdpdGhvdXQgYW4gYWQtaG9jIGRyYWluIHdhaXQuIFJlamVjdHMgd2hlbiB0aGUgc3RyZWFtIGhhc1xuICAgKiBlbmRlZCBvciBiZWVuIGFib3J0ZWQsIG9yIHdoZW4gdGhlIG91dGJvdW5kIGRlbGl2ZXJ5IHF1ZXVlIGNhbm5vdCBhY2NlcHRcbiAgICogdGhlIGNodW5rIChhIHN0YWxsZWQgY2xpZW50KS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBVaW50OEFycmF5fSB2YWx1ZSAtIENodW5rIHRvIGVtaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNldHRsZXMgYWZ0ZXIgdGhlIGNodW5rIGlzIGRlbGl2ZXJlZC5cbiAgICovXG4gIGFzeW5jIHdyaXRlKHZhbHVlKSB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJ3cml0ZSgpIHJlcXVpcmVzIGFuIGFjdGl2ZSBzdHJlYW1pbmcgcmVzcG9uc2VcIilcbiAgICBpZiAoIXRoaXMuc3RyZWFtaW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJ3cml0ZSgpIHJlcXVpcmVzIHN0cmVhbSgpIHRvIGJlIGNhbGxlZCBmaXJzdFwiKVxuICAgIGlmICh0aGlzLnN0cmVhbUVuZGVkIHx8IHRoaXMuc3RyZWFtQWJvcnRlZCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLnRyYW5zcG9ydC53cml0ZVN0cmVhbUNodW5rKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmlzaGVzIGFuIGFjdGl2ZSBzdHJlYW06IGVtaXRzIHRoZSBjaHVua2VkIHRlcm1pbmF0b3IgYW5kIHJlbGVhc2VzIHRoZVxuICAgKiByZXNwb25zZSBmb3IgY29tcGxldGlvbiBsb2dnaW5nLiBTZXR0bGVzIGFmdGVyIHRoZSB0ZXJtaW5hdG9yIGhhcyBiZWVuXG4gICAqIGRlbGl2ZXJlZCB0byB0aGUgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTZXR0bGVzIGFmdGVyIHRoZSBzdHJlYW0gaXMgZmluaXNoZWQuXG4gICAqL1xuICBhc3luYyBlbmQoKSB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJlbmQoKSByZXF1aXJlcyBhbiBhY3RpdmUgc3RyZWFtaW5nIHJlc3BvbnNlXCIpXG4gICAgaWYgKCF0aGlzLnN0cmVhbWluZykgdGhyb3cgbmV3IEVycm9yKFwiZW5kKCkgcmVxdWlyZXMgc3RyZWFtKCkgdG8gYmUgY2FsbGVkIGZpcnN0XCIpXG4gICAgaWYgKHRoaXMuc3RyZWFtRW5kZWQpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy50cmFuc3BvcnQuZW5kU3RyZWFtUmVzcG9uc2UodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBjYWxsYmFjayBmaXJlZCB3aGVuIHRoZSBjbGllbnQgZGlzY29ubmVjdHMgbWlkLXN0cmVhbSwgc29cbiAgICogdGhlIGhhbmRsZXIgY2FuIHJlbGVhc2Ugd2hhdGV2ZXIgdGhlIGluLWZsaWdodCB3b3JrIHJlc2VydmVkLiBGaXJlZCBhdFxuICAgKiBtb3N0IG9uY2U7IGFsc28gZmlyZXMgd2hlbiB0aGUgc3RyZWFtIGlzIGZpbmFsaXplZCBhZnRlciB0aGUgY2xpZW50IGlzXG4gICAqIGFscmVhZHkgZ29uZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBjYWxsYmFjayAtIERpc2Nvbm5lY3QgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uU3RyZWFtQ2xvc2UoY2FsbGJhY2spIHtcbiAgICB0aGlzLnN0cmVhbUNsb3NlQ2FsbGJhY2tzLmFkZChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGFuIGFjdGl2ZSBzdHJlYW0gYWZ0ZXIgYSBmcmFtZXdvcmstbGV2ZWwgZmFpbHVyZSAodGhlIGhhbmRsZXJcbiAgICogdGhyZXcgYWZ0ZXIgYHN0cmVhbSgpYCBzdGFydGVkKTogZW1pdHMgdGhlIGNodW5rZWQgdGVybWluYXRvciBhbmQgcnVuc1xuICAgKiB0aGUgY2xvc2UgY2FsbGJhY2tzIHNvIGluLWZsaWdodCB3b3JrIHNldHRsZXMgaXRzIHJlc291cmNlcy4gTm8tb3Agd2hlblxuICAgKiB0aGUgc3RyZWFtIGFscmVhZHkgZW5kZWQgb3Igd2FzIGFib3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFib3J0U3RyZWFtKCkge1xuICAgIGlmICghdGhpcy5zdHJlYW1pbmcgfHwgdGhpcy5zdHJlYW1FbmRlZCB8fCB0aGlzLnRyYW5zcG9ydCA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICB0aGlzLnN0cmVhbUVuZGVkID0gdHJ1ZVxuICAgIHRoaXMudHJhbnNwb3J0LmVuZFN0cmVhbVJlc3BvbnNlKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBGaWxlIHBhdGguXG4gICAqL1xuICBnZXRGaWxlUGF0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlUGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGZpbGUgcmVzcG9uc2UgY29tcGxldGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gRmlsZSByZXNwb25zZSBjb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKi9cbiAgZ2V0RmlsZU9uRmluaXNoZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsZU9uRmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcGFyYW0geygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IFtvbkZpbmlzaGVkXSAtIENvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEZpbGVQYXRoKHBhdGgsIG9uRmluaXNoZWQgPSBudWxsKSB7XG4gICAgdGhpcy5maWxlUGF0aCA9IHBhdGhcbiAgICB0aGlzLmZpbGVPbkZpbmlzaGVkID0gb25GaW5pc2hlZFxuICAgIHRoaXMuYm9keSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlcnJvciBib2R5LlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRFcnJvckJvZHkoZXJyb3IpIHtcbiAgICB0aGlzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIilcbiAgICB0aGlzLnNldEJvZHkoYCR7ZXJyb3IubWVzc2FnZX1cXG5cXG4ke2Vycm9yLnN0YWNrfWApXG4gIH1cblxuICAvKipcbiAgICogQWNjZXB0cyBhIG51bWVyaWMgSFRUUCBzdGF0dXMgY29kZSAoZS5nLiBgNDIyYCkgb3Igb25lIG9mIHRoZVxuICAgKiBuYW1lZCBhbGlhc2VzIChgXCJzdWNjZXNzXCJgLCBgXCJub3QtZm91bmRcImAsIGBcImludGVybmFsLXNlcnZlci1lcnJvclwiYCkuXG4gICAqIE51bWVyaWMgaW5wdXRzIGluIHRoZSBzdGFuZGFyZCAxeHgtNXh4IHJhbmdlIHJlc29sdmUgdGhlaXIgb3duXG4gICAqIHN0YXR1cyBtZXNzYWdlcyBmcm9tIHRoZSBJQU5BIHJlZ2lzdHJ5OyBhbGlhc2VzIGtlZXAgdGhlXG4gICAqIGJhY2stY29tcGF0aWJsZSBjb2RlIG1hcHBpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSBzdGF0dXMgLSBTdGF0dXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFN0YXR1cyhzdGF0dXMpIHtcbiAgICBjb25zdCBhbGlhc0NvZGUgPSBOQU1FRF9TVEFUVVNfQUxJQVNFU1tTdHJpbmcoc3RhdHVzKV1cbiAgICBjb25zdCBudW1lcmljU3RhdHVzID0gYWxpYXNDb2RlID8/IE51bWJlcihzdGF0dXMpXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIobnVtZXJpY1N0YXR1cykgfHwgbnVtZXJpY1N0YXR1cyA8IDEwMCB8fCBudW1lcmljU3RhdHVzID4gNTk5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuaGFuZGxlZCBzdGF0dXM6ICR7c3RhdHVzfWApXG4gICAgfVxuXG4gICAgdGhpcy5zdGF0dXNDb2RlID0gbnVtZXJpY1N0YXR1c1xuICAgIHRoaXMuc3RhdHVzTWVzc2FnZSA9IFNUQU5EQVJEX1NUQVRVU19NRVNTQUdFU1tudW1lcmljU3RhdHVzXSB8fCBcIk9LXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXF1ZXN0IHRpbWVvdXQgbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gUmVxdWVzdCB0aW1lb3V0IGluIHNlY29uZHMuXG4gICAqL1xuICBnZXRSZXF1ZXN0VGltZW91dE1zKCkge1xuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVxdWVzdCB0aW1lb3V0IG1zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZCB8IG51bGx9IHRpbWVvdXRTZWNvbmRzIC0gVGltZW91dCBpbiBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRSZXF1ZXN0VGltZW91dE1zKHRpbWVvdXRTZWNvbmRzKSB7XG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0U2Vjb25kcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dFNlY29uZHMpKSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID0gdGltZW91dFNlY29uZHNcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlcikge1xuICAgICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNc0NoYW5nZUhhbmRsZXIodGhpcy5fcmVxdWVzdFRpbWVvdXRNcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVxdWVzdCB0aW1lb3V0IG1zIGNoYW5nZSBoYW5kbGVyLlxuICAgKiBAcGFyYW0geyh0aW1lb3V0U2Vjb25kczogbnVtYmVyIHwgdW5kZWZpbmVkKSA9PiB2b2lkfSBoYW5kbGVyIC0gQ2hhbmdlIGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJlcXVlc3RUaW1lb3V0TXNDaGFuZ2VIYW5kbGVyKGhhbmRsZXIpIHtcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlciA9IGhhbmRsZXJcbiAgfVxufVxuIl19