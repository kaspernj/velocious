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
     * Writes one chunk to an active stream. The chunk is framed and emitted to
     * the client as soon as it is produced.
     * @param {string | Uint8Array} value - Chunk to write.
     * @returns {boolean} - Whether the chunk was accepted; false after the
     * stream was ended or the client disconnected.
     */
    write(value) {
        if (this.transport === null)
            throw new Error("write() requires an active streaming response");
        if (!this.streaming)
            throw new Error("write() requires stream() to be called first");
        if (this.streamEnded || this.streamAborted)
            return false;
        this.transport.writeStreamChunk(value);
        return true;
    }
    /**
     * Finishes an active stream: emits the chunked terminator and releases the
     * response for completion logging.
     * @returns {void} - No return value.
     */
    end() {
        if (this.transport === null)
            throw new Error("end() requires an active streaming response");
        if (!this.streaming)
            throw new Error("end() requires stream() to be called first");
        if (this.streamEnded)
            return;
        this.transport.endStreamResponse(this);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsNkJBQTZCLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFekQ7O29DQUVvQztBQUNwQyxNQUFNLG9CQUFvQixHQUFHO0lBQzNCLFNBQVMsRUFBRSxHQUFHO0lBQ2QsV0FBVyxFQUFFLEdBQUc7SUFDaEIsdUJBQXVCLEVBQUUsR0FBRztDQUM3QixDQUFBO0FBRUQ7O29DQUVvQztBQUNwQyxNQUFNLHdCQUF3QixHQUFHO0lBQy9CLEdBQUcsRUFBRSxVQUFVO0lBQ2YsR0FBRyxFQUFFLHFCQUFxQjtJQUMxQixHQUFHLEVBQUUsWUFBWTtJQUNqQixHQUFHLEVBQUUsYUFBYTtJQUNsQixHQUFHLEVBQUUsSUFBSTtJQUNULEdBQUcsRUFBRSxTQUFTO0lBQ2QsR0FBRyxFQUFFLFVBQVU7SUFDZixHQUFHLEVBQUUsK0JBQStCO0lBQ3BDLEdBQUcsRUFBRSxZQUFZO0lBQ2pCLEdBQUcsRUFBRSxlQUFlO0lBQ3BCLEdBQUcsRUFBRSxpQkFBaUI7SUFDdEIsR0FBRyxFQUFFLGNBQWM7SUFDbkIsR0FBRyxFQUFFLGtCQUFrQjtJQUN2QixHQUFHLEVBQUUsU0FBUztJQUNkLEdBQUcsRUFBRSxrQkFBa0I7SUFDdkIsR0FBRyxFQUFFLG1CQUFtQjtJQUN4QixHQUFHLEVBQUUsT0FBTztJQUNaLEdBQUcsRUFBRSxXQUFXO0lBQ2hCLEdBQUcsRUFBRSxjQUFjO0lBQ25CLEdBQUcsRUFBRSxXQUFXO0lBQ2hCLEdBQUcsRUFBRSxvQkFBb0I7SUFDekIsR0FBRyxFQUFFLG9CQUFvQjtJQUN6QixHQUFHLEVBQUUsYUFBYTtJQUNsQixHQUFHLEVBQUUsY0FBYztJQUNuQixHQUFHLEVBQUUsa0JBQWtCO0lBQ3ZCLEdBQUcsRUFBRSxXQUFXO0lBQ2hCLEdB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LENBQUMsY0FBYztRQUNoQyxJQUFJLE9BQU8sY0FBYyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDMUUsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGNBQWMsQ0FBQTtRQUN6QyxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxTQUFTLENBQUE7UUFDcEMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLDhCQUE4QixFQUFFLENBQUM7WUFDeEMsSUFBSSxDQUFDLDhCQUE4QixDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBQzdELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdDQUFnQyxDQUFDLE9BQU87UUFDdEMsSUFBSSxDQUFDLDhCQUE4QixHQUFHLE9BQU8sQ0FBQTtJQUMvQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtIdHRwUmVzcG9uc2VCb2R5VG9vTGFyZ2VFcnJvcn0gZnJvbSBcIi4vZXJyb3JzLmpzXCJcblxuLyoqXG4gKiBOYW1lZCBzdGF0dXMgYWxpYXNlcy5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuY29uc3QgTkFNRURfU1RBVFVTX0FMSUFTRVMgPSB7XG4gIFwic3VjY2Vzc1wiOiAyMDAsXG4gIFwibm90LWZvdW5kXCI6IDQwNCxcbiAgXCJpbnRlcm5hbC1zZXJ2ZXItZXJyb3JcIjogNTAwXG59XG5cbi8qKlxuICogU3RhbmRhcmQgc3RhdHVzIG1lc3NhZ2VzLlxuICogQHR5cGUge1JlY29yZDxudW1iZXIsIHN0cmluZz59ICovXG5jb25zdCBTVEFOREFSRF9TVEFUVVNfTUVTU0FHRVMgPSB7XG4gIDEwMDogXCJDb250aW51ZVwiLFxuICAxMDE6IFwiU3dpdGNoaW5nIFByb3RvY29sc1wiLFxuICAxMDI6IFwiUHJvY2Vzc2luZ1wiLFxuICAxMDM6IFwiRWFybHkgSGludHNcIixcbiAgMjAwOiBcIk9LXCIsXG4gIDIwMTogXCJDcmVhdGVkXCIsXG4gIDIwMjogXCJBY2NlcHRlZFwiLFxuICAyMDM6IFwiTm9uLUF1dGhvcml0YXRpdmUgSW5mb3JtYXRpb25cIixcbiAgMjA0OiBcIk5vIENvbnRlbnRcIixcbiAgMjA1OiBcIlJlc2V0IENvbnRlbnRcIixcbiAgMjA2OiBcIlBhcnRpYWwgQ29udGVudFwiLFxuICAyMDc6IFwiTXVsdGktU3RhdHVzXCIsXG4gIDIwODogXCJBbHJlYWR5IFJlcG9ydGVkXCIsXG4gIDIyNjogXCJJTSBVc2VkXCIsXG4gIDMwMDogXCJNdWx0aXBsZSBDaG9pY2VzXCIsXG4gIDMwMTogXCJNb3ZlZCBQZXJtYW5lbnRseVwiLFxuICAzMDI6IFwiRm91bmRcIixcbiAgMzAzOiBcIlNlZSBPdGhlclwiLFxuICAzMDQ6IFwiTm90IE1vZGlmaWVkXCIsXG4gIDMwNTogXCJVc2UgUHJveHlcIixcbiAgMzA3OiBcIlRlbXBvcmFyeSBSZWRpcmVjdFwiLFxuICAzMDg6IFwiUGVybWFuZW50IFJlZGlyZWN0XCIsXG4gIDQwMDogXCJCYWQgUmVxdWVzdFwiLFxuICA0MDE6IFwiVW5hdXRob3JpemVkXCIsXG4gIDQwMjogXCJQYXltZW50IFJlcXVpcmVkXCIsXG4gIDQwMzogXCJGb3JiaWRkZW5cIixcbiAgNDA0OiBcIk5vdCBGb3VuZFwiLFxuICA0MDU6IFwiTWV0aG9kIE5vdCBBbGxvd2VkXCIsXG4gIDQwNjogXCJOb3QgQWNjZXB0YWJsZVwiLFxuICA0MDc6IFwiUHJveHkgQXV0aGVudGljYXRpb24gUmVxdWlyZWRcIixcbiAgNDA4OiBcIlJlcXVlc3QgVGltZW91dFwiLFxuICA0MDk6IFwiQ29uZmxpY3RcIixcbiAgNDEwOiBcIkdvbmVcIixcbiAgNDExOiBcIkxlbmd0aCBSZXF1aXJlZFwiLFxuICA0MTI6IFwiUHJlY29uZGl0aW9uIEZhaWxlZFwiLFxuICA0MTM6IFwiUGF5bG9hZCBUb28gTGFyZ2VcIixcbiAgNDE0OiBcIlVSSSBUb28gTG9uZ1wiLFxuICA0MTU6IFwiVW5zdXBwb3J0ZWQgTWVkaWEgVHlwZVwiLFxuICA0MTY6IFwiUmFuZ2UgTm90IFNhdGlzZmlhYmxlXCIsXG4gIDQxNzogXCJFeHBlY3RhdGlvbiBGYWlsZWRcIixcbiAgNDE4OiBcIkknbSBhIHRlYXBvdFwiLFxuICA0MjE6IFwiTWlzZGlyZWN0ZWQgUmVxdWVzdFwiLFxuICA0MjI6IFwiVW5wcm9jZXNzYWJsZSBFbnRpdHlcIixcbiAgNDIzOiBcIkxvY2tlZFwiLFxuICA0MjQ6IFwiRmFpbGVkIERlcGVuZGVuY3lcIixcbiAgNDI1OiBcIlRvbyBFYXJseVwiLFxuICA0MjY6IFwiVXBncmFkZSBSZXF1aXJlZFwiLFxuICA0Mjg6IFwiUHJlY29uZGl0aW9uIFJlcXVpcmVkXCIsXG4gIDQyOTogXCJUb28gTWFueSBSZXF1ZXN0c1wiLFxuICA0MzE6IFwiUmVxdWVzdCBIZWFkZXIgRmllbGRzIFRvbyBMYXJnZVwiLFxuICA0NTE6IFwiVW5hdmFpbGFibGUgRm9yIExlZ2FsIFJlYXNvbnNcIixcbiAgNTAwOiBcIkludGVybmFsIHNlcnZlciBlcnJvclwiLFxuICA1MDE6IFwiTm90IEltcGxlbWVudGVkXCIsXG4gIDUwMjogXCJCYWQgR2F0ZXdheVwiLFxuICA1MDM6IFwiU2VydmljZSBVbmF2YWlsYWJsZVwiLFxuICA1MDQ6IFwiR2F0ZXdheSBUaW1lb3V0XCIsXG4gIDUwNTogXCJIVFRQIFZlcnNpb24gTm90IFN1cHBvcnRlZFwiLFxuICA1MDY6IFwiVmFyaWFudCBBbHNvIE5lZ290aWF0ZXNcIixcbiAgNTA3OiBcIkluc3VmZmljaWVudCBTdG9yYWdlXCIsXG4gIDUwODogXCJMb29wIERldGVjdGVkXCIsXG4gIDUxMDogXCJOb3QgRXh0ZW5kZWRcIixcbiAgNTExOiBcIk5ldHdvcmsgQXV0aGVudGljYXRpb24gUmVxdWlyZWRcIlxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50UmVzcG9uc2Uge1xuICAvKipcbiAgICogQm9keS5cbiAgICogQHR5cGUge3N0cmluZyB8IFVpbnQ4QXJyYXkgfCBudWxsfSAqL1xuICBib2R5ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBGaWxlIHBhdGguXG4gICAqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICBmaWxlUGF0aCA9IG51bGxcblxuICAvKipcbiAgICogRmlsZSByZXNwb25zZSBjb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAdHlwZSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gKi9cbiAgZmlsZU9uRmluaXNoZWQgPSBudWxsXG5cbiAgLyoqXG4gICAqIEhlYWRlcnMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGhlYWRlcnMgPSB7fVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGNvbXByZXNzaW9uIGhhcyBiZWVuIGRpc2FibGVkIGZvciB0aGlzIHNwZWNpZmljIHJlc3BvbnNlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgY29tcHJlc3Npb25EaXNhYmxlZCA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyByZXNwb25zZSBoYXMgYmVlbiBzd2l0Y2hlZCB0byBsaXZlIGNodW5rZWQgc3RyZWFtaW5nLiBPbmNlXG4gICAqIHN0cmVhbWluZyBoYXMgc3RhcnRlZCwgdGhlIHN0YXR1cyBsaW5lIGFuZCBoZWFkZXJzIGFyZSBlbWl0dGVkIHRvIHRoZVxuICAgKiBjbGllbnQgaW1tZWRpYXRlbHkgYW5kIGV2ZXJ5IGB3cml0ZSgpYCBpcyBlbWl0dGVkIGFzIGl0IGhhcHBlbnMsIGluc3RlYWRcbiAgICogb2YgdGhlIHdob2xlIGJvZHkgYmVpbmcgYnVmZmVyZWQgYW5kIHNlbnQgb25jZSBhZnRlciB0aGUgaGFuZGxlclxuICAgKiByZXR1cm5zLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgc3RyZWFtaW5nID0gZmFsc2VcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgc3RyZWFtIGhhcyBiZWVuIGZpbmlzaGVkIHdpdGggYGVuZCgpYCAob3IgZmluYWxpemVkKS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIHN0cmVhbUVuZGVkID0gZmFsc2VcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgY2xpZW50IGNvbm5lY3Rpb24gZHJvcHBlZCB3aGlsZSB0aGUgc3RyZWFtIHdhcyBpbiBmbGlnaHQuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBzdHJlYW1BYm9ydGVkID0gZmFsc2VcblxuICAvKipcbiAgICogVHJhbnNwb3J0IHNpbmsgd2lyZWQgaW4gYnkgdGhlIG93bmluZyBjbGllbnQgc28gdGhlIHJlc3BvbnNlIGNhbiBlbWl0XG4gICAqIGhlYWRlcnMgYW5kIGNodW5rcyB0byB0aGUgc29ja2V0LWJvdW5kIGNvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICB0cmFuc3BvcnQgPSBudWxsXG5cbiAgLyoqXG4gICAqIFRoZSBzb2NrZXQtYm91bmQgcmVxdWVzdCB0aGlzIHJlc3BvbnNlIGJlbG9uZ3MgdG8uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gIHRyYW5zcG9ydFJlcXVlc3QgPSBudWxsXG5cbiAgLyoqXG4gICAqIENhbGxiYWNrcyBmaXJlZCB3aGVuIHRoZSBjbGllbnQgZGlzY29ubmVjdHMgbWlkLXN0cmVhbS5cbiAgICogQHR5cGUge1NldDwoKSA9PiB2b2lkPn0gKi9cbiAgc3RyZWFtQ2xvc2VDYWxsYmFja3MgPSBuZXcgU2V0KClcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXNDaGFuZ2VIYW5kbGVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgaGVhZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gS2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZEhlYWRlcihrZXksIHZhbHVlKSB7XG4gICAgaWYgKCEoa2V5IGluIHRoaXMuaGVhZGVycykpIHtcbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gW11cbiAgICB9XG5cbiAgICB0aGlzLmhlYWRlcnNba2V5XS5wdXNoKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRIZWFkZXIoa2V5LCB2YWx1ZSkge1xuICAgIHRoaXMuaGVhZGVyc1trZXldID0gW3ZhbHVlXVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgZXZlcnkgdmFsdWUgc2V0IGZvciBhIGhlYWRlciwgbWF0Y2hlZCBjYXNlLWluc2Vuc2l0aXZlbHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBIZWFkZXIgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIEhlYWRlciB2YWx1ZXMgaW4gaW5zZXJ0aW9uIG9yZGVyLlxuICAgKi9cbiAgZ2V0SGVhZGVyKGtleSkge1xuICAgIGNvbnN0IGxvd2VyQ2FzZUtleSA9IGtleS50b0xvd2VyQ2FzZSgpXG5cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlcktleSBpbiB0aGlzLmhlYWRlcnMpIHtcbiAgICAgIGlmIChoZWFkZXJLZXkudG9Mb3dlckNhc2UoKSA9PSBsb3dlckNhc2VLZXkpIHtcbiAgICAgICAgdmFsdWVzLnB1c2goLi4udGhpcy5oZWFkZXJzW2hlYWRlcktleV0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgZXZlcnkgdmFsdWUgc2V0IGZvciBhIGhlYWRlciwgbWF0Y2hlZCBjYXNlLWluc2Vuc2l0aXZlbHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBIZWFkZXIgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVtb3ZlSGVhZGVyKGtleSkge1xuICAgIGNvbnN0IGxvd2VyQ2FzZUtleSA9IGtleS50b0xvd2VyQ2FzZSgpXG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlcktleSBpbiB0aGlzLmhlYWRlcnMpIHtcbiAgICAgIGlmIChoZWFkZXJLZXkudG9Mb3dlckNhc2UoKSA9PSBsb3dlckNhc2VLZXkpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuaGVhZGVyc1toZWFkZXJLZXldXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2FibGVzIEhUVFAgcmVzcG9uc2UgY29tcHJlc3Npb24gZm9yIHRoaXMgc3BlY2lmaWMgcmVzcG9uc2UsIGV2ZW4gd2hlbiB0aGVcbiAgICogc2VydmVyIGlzIGNvbmZpZ3VyZWQgdG8gY29tcHJlc3MgYnVmZmVyZWQgcmVzcG9uc2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBkaXNhYmxlQ29tcHJlc3Npb24oKSB7XG4gICAgdGhpcy5jb21wcmVzc2lvbkRpc2FibGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY29tcHJlc3Npb24gZGlzYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgY29tcHJlc3Npb24gaGFzIGJlZW4gZGlzYWJsZWQgZm9yIHRoaXMgcmVzcG9uc2UuXG4gICAqL1xuICBpc0NvbXByZXNzaW9uRGlzYWJsZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29tcHJlc3Npb25EaXNhYmxlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGJvZHkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBVaW50OEFycmF5IHwgbnVsbH0gLSBUaGUgYm9keS5cbiAgICovXG4gIGdldEJvZHkoKSB7XG4gICAgaWYgKHRoaXMuYm9keSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib2R5XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gYm9keSBoYXMgYmVlbiBzZXRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdGF0dXMgY29kZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBnZXRTdGF0dXNDb2RlKCkge1xuICAgIHJldHVybiB0aGlzLnN0YXR1c0NvZGUgfHwgMjAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RhdHVzIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHN0YXR1cyBtZXNzYWdlLlxuICAgKi9cbiAgZ2V0U3RhdHVzTWVzc2FnZSgpIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0dXNNZXNzYWdlIHx8IFwiT0tcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGJvZHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgVWludDhBcnJheX0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEJvZHkodmFsdWUpIHtcbiAgICB0aGlzLmZpbGVQYXRoID0gbnVsbFxuICAgIHRoaXMuZmlsZU9uRmluaXNoZWQgPSBudWxsXG5cbiAgICBjb25zdCBhY3R1YWxCeXRlcyA9IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IEJ1ZmZlci5ieXRlTGVuZ3RoKHZhbHVlLCBcInV0ZjhcIikgOiB2YWx1ZS5ieXRlTGVuZ3RoXG4gICAgY29uc3QgbWF4Qnl0ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlck1heEJ1ZmZlcmVkUmVzcG9uc2VCb2R5Qnl0ZXMoKVxuXG4gICAgaWYgKG1heEJ5dGVzICE9PSB1bmRlZmluZWQgJiYgYWN0dWFsQnl0ZXMgPiBtYXhCeXRlcykge1xuICAgICAgdGhpcy5ib2R5ID0gXCJcIlxuICAgICAgdGhyb3cgbmV3IEh0dHBSZXNwb25zZUJvZHlUb29MYXJnZUVycm9yKHthY3R1YWxCeXRlcywgbWF4Qnl0ZXN9KVxuICAgIH1cblxuICAgIHRoaXMuYm9keSA9IHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIHJlc3BvbnNlIGlzIChvciB3YXMpIGEgbGl2ZSBjaHVua2VkIHN0cmVhbS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdHJlYW1pbmcgaGFzIHN0YXJ0ZWQuXG4gICAqL1xuICBpc1N0cmVhbWluZygpIHtcbiAgICByZXR1cm4gdGhpcy5zdHJlYW1pbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBjbGllbnQgZGlzY29ubmVjdGVkIG1pZC1zdHJlYW0uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHN0cmVhbSB3YXMgYWJvcnRlZCBieSB0aGUgY2xpZW50LlxuICAgKi9cbiAgaXNTdHJlYW1BYm9ydGVkKCkge1xuICAgIHJldHVybiB0aGlzLnN0cmVhbUFib3J0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTd2l0Y2hlcyB0aGlzIHJlc3BvbnNlIHRvIGxpdmUgY2h1bmtlZCBzdHJlYW1pbmcuIFRoZSBzdGF0dXMgbGluZSBhbmRcbiAgICogaGVhZGVycyBhcmUgZW1pdHRlZCB0byB0aGUgY2xpZW50IGltbWVkaWF0ZWx5ICh3aXRoIGFcbiAgICogYFRyYW5zZmVyLUVuY29kaW5nOiBjaHVua2VkYCBmcmFtaW5nIGhlYWRlcikgc28gYHdyaXRlKClgIGNodW5rcyByZWFjaFxuICAgKiB0aGUgY2xpZW50IGFzIHRoZXkgYXJlIHByb2R1Y2VkIOKAlCBpbnN0ZWFkIG9mIHRoZSB3aG9sZSBib2R5IGJlaW5nXG4gICAqIGJ1ZmZlcmVkIGFuZCBlbWl0dGVkIG9uY2UgYWZ0ZXIgdGhlIGhhbmRsZXIgcmV0dXJucy5cbiAgICpcbiAgICogU3RyZWFtaW5nIHJlcXVpcmVzIGEgc29ja2V0LWJvdW5kIEhUVFAgcmVxdWVzdCBhbmQgYW4gSFRUUCB2ZXJzaW9uIHRoYXRcbiAgICogc3VwcG9ydHMgY2h1bmtlZCBmcmFtaW5nLCBhIHN0YXR1cyB0aGF0IG1heSBjYXJyeSBhIGJvZHksIGFuZCBhXG4gICAqIG5vbi1IRUFEIHJlcXVlc3QuIEl0IGNhbm5vdCBiZSBjb21iaW5lZCB3aXRoIGEgYnVmZmVyZWQgYm9keSwgYSBmaWxlXG4gICAqIHJlc3BvbnNlLCBvciBhIHNlY29uZCBgc3RyZWFtKClgIGNhbGwuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0cmVhbSgpIHtcbiAgICBpZiAodGhpcy5zdHJlYW1pbmcpIHRocm93IG5ldyBFcnJvcihcIlRoZSByZXNwb25zZSBpcyBhbHJlYWR5IHN0cmVhbWluZ1wiKVxuICAgIGlmICh0aGlzLmZpbGVQYXRoICE9PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJBIGZpbGUgcmVzcG9uc2UgY2Fubm90IGJlIHN3aXRjaGVkIHRvIHN0cmVhbWluZ1wiKVxuICAgIGlmICh0aGlzLmJvZHkgIT09IG51bGwgJiYgdGhpcy5ib2R5ICE9PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkEgYnVmZmVyZWQgYm9keSB3YXMgYWxyZWFkeSBzZXQ7IGNhbGwgc3RyZWFtKCkgYmVmb3JlIHNldEJvZHkoKSB0byBzdHJlYW0gaW5zdGVhZFwiKVxuICAgIGlmICh0aGlzLnRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKFwiU3RyZWFtaW5nIHJlc3BvbnNlcyByZXF1aXJlIGEgc29ja2V0LWJvdW5kIEhUVFAgcmVxdWVzdFwiKVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IHRoaXMudHJhbnNwb3J0UmVxdWVzdFxuICAgIGlmICghcmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiU3RyZWFtaW5nIHJlc3BvbnNlcyByZXF1aXJlIGEgc29ja2V0LWJvdW5kIEhUVFAgcmVxdWVzdFwiKVxuXG4gICAgaWYgKHJlcXVlc3QuaHR0cE1ldGhvZCgpID09PSBcIkhFQURcIikgdGhyb3cgbmV3IEVycm9yKFwiSEVBRCByZXNwb25zZXMgY2Fubm90IHN0cmVhbSBhIGJvZHlcIilcblxuICAgIGNvbnN0IHN0YXR1c0NvZGUgPSB0aGlzLmdldFN0YXR1c0NvZGUoKVxuICAgIGlmICgoc3RhdHVzQ29kZSA+PSAxMDAgJiYgc3RhdHVzQ29kZSA8IDIwMCkgfHwgc3RhdHVzQ29kZSA9PT0gMjA0IHx8IHN0YXR1c0NvZGUgPT09IDMwNCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTdGF0dXMgJHtzdGF0dXNDb2RlfSBjYW5ub3QgY2FycnkgYSBzdHJlYW1pbmcgYm9keWApXG4gICAgfVxuXG4gICAgdGhpcy5zdHJlYW1pbmcgPSB0cnVlXG4gICAgdGhpcy50cmFuc3BvcnQuYmVnaW5TdHJlYW1SZXNwb25zZSh0aGlzLCByZXF1ZXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyBvbmUgY2h1bmsgdG8gYW4gYWN0aXZlIHN0cmVhbS4gVGhlIGNodW5rIGlzIGZyYW1lZCBhbmQgZW1pdHRlZCB0b1xuICAgKiB0aGUgY2xpZW50IGFzIHNvb24gYXMgaXQgaXMgcHJvZHVjZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgVWludDhBcnJheX0gdmFsdWUgLSBDaHVuayB0byB3cml0ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2h1bmsgd2FzIGFjY2VwdGVkOyBmYWxzZSBhZnRlciB0aGVcbiAgICogc3RyZWFtIHdhcyBlbmRlZCBvciB0aGUgY2xpZW50IGRpc2Nvbm5lY3RlZC5cbiAgICovXG4gIHdyaXRlKHZhbHVlKSB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJ3cml0ZSgpIHJlcXVpcmVzIGFuIGFjdGl2ZSBzdHJlYW1pbmcgcmVzcG9uc2VcIilcbiAgICBpZiAoIXRoaXMuc3RyZWFtaW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJ3cml0ZSgpIHJlcXVpcmVzIHN0cmVhbSgpIHRvIGJlIGNhbGxlZCBmaXJzdFwiKVxuICAgIGlmICh0aGlzLnN0cmVhbUVuZGVkIHx8IHRoaXMuc3RyZWFtQWJvcnRlZCkgcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnRyYW5zcG9ydC53cml0ZVN0cmVhbUNodW5rKHZhbHVlKVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogRmluaXNoZXMgYW4gYWN0aXZlIHN0cmVhbTogZW1pdHMgdGhlIGNodW5rZWQgdGVybWluYXRvciBhbmQgcmVsZWFzZXMgdGhlXG4gICAqIHJlc3BvbnNlIGZvciBjb21wbGV0aW9uIGxvZ2dpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGVuZCgpIHtcbiAgICBpZiAodGhpcy50cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBFcnJvcihcImVuZCgpIHJlcXVpcmVzIGFuIGFjdGl2ZSBzdHJlYW1pbmcgcmVzcG9uc2VcIilcbiAgICBpZiAoIXRoaXMuc3RyZWFtaW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJlbmQoKSByZXF1aXJlcyBzdHJlYW0oKSB0byBiZSBjYWxsZWQgZmlyc3RcIilcbiAgICBpZiAodGhpcy5zdHJlYW1FbmRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLnRyYW5zcG9ydC5lbmRTdHJlYW1SZXNwb25zZSh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIGZpcmVkIHdoZW4gdGhlIGNsaWVudCBkaXNjb25uZWN0cyBtaWQtc3RyZWFtLCBzb1xuICAgKiB0aGUgaGFuZGxlciBjYW4gcmVsZWFzZSB3aGF0ZXZlciB0aGUgaW4tZmxpZ2h0IHdvcmsgcmVzZXJ2ZWQuIEZpcmVkIGF0XG4gICAqIG1vc3Qgb25jZTsgYWxzbyBmaXJlcyB3aGVuIHRoZSBzdHJlYW0gaXMgZmluYWxpemVkIGFmdGVyIHRoZSBjbGllbnQgaXNcbiAgICogYWxyZWFkeSBnb25lLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGNhbGxiYWNrIC0gRGlzY29ubmVjdCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25TdHJlYW1DbG9zZShjYWxsYmFjaykge1xuICAgIHRoaXMuc3RyZWFtQ2xvc2VDYWxsYmFja3MuYWRkKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYW4gYWN0aXZlIHN0cmVhbSBhZnRlciBhIGZyYW1ld29yay1sZXZlbCBmYWlsdXJlICh0aGUgaGFuZGxlclxuICAgKiB0aHJldyBhZnRlciBgc3RyZWFtKClgIHN0YXJ0ZWQpOiBlbWl0cyB0aGUgY2h1bmtlZCB0ZXJtaW5hdG9yIGFuZCBydW5zXG4gICAqIHRoZSBjbG9zZSBjYWxsYmFja3Mgc28gaW4tZmxpZ2h0IHdvcmsgc2V0dGxlcyBpdHMgcmVzb3VyY2VzLiBOby1vcCB3aGVuXG4gICAqIHRoZSBzdHJlYW0gYWxyZWFkeSBlbmRlZCBvciB3YXMgYWJvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWJvcnRTdHJlYW0oKSB7XG4gICAgaWYgKCF0aGlzLnN0cmVhbWluZyB8fCB0aGlzLnN0cmVhbUVuZGVkIHx8IHRoaXMudHJhbnNwb3J0ID09PSBudWxsKSByZXR1cm5cblxuICAgIHRoaXMuc3RyZWFtRW5kZWQgPSB0cnVlXG4gICAgdGhpcy50cmFuc3BvcnQuZW5kU3RyZWFtUmVzcG9uc2UodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEZpbGUgcGF0aC5cbiAgICovXG4gIGdldEZpbGVQYXRoKCkge1xuICAgIHJldHVybiB0aGlzLmZpbGVQYXRoXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgZmlsZSByZXNwb25zZSBjb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gLSBGaWxlIHJlc3BvbnNlIGNvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqL1xuICBnZXRGaWxlT25GaW5pc2hlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlT25GaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gW29uRmluaXNoZWRdIC0gQ29tcGxldGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0RmlsZVBhdGgocGF0aCwgb25GaW5pc2hlZCA9IG51bGwpIHtcbiAgICB0aGlzLmZpbGVQYXRoID0gcGF0aFxuICAgIHRoaXMuZmlsZU9uRmluaXNoZWQgPSBvbkZpbmlzaGVkXG4gICAgdGhpcy5ib2R5ID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVycm9yIGJvZHkuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEVycm9yQm9keShlcnJvcikge1xuICAgIHRoaXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwidGV4dC9wbGFpbjsgY2hhcnNldD1VVEYtOFwiKVxuICAgIHRoaXMuc2V0Qm9keShgJHtlcnJvci5tZXNzYWdlfVxcblxcbiR7ZXJyb3Iuc3RhY2t9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBY2NlcHRzIGEgbnVtZXJpYyBIVFRQIHN0YXR1cyBjb2RlIChlLmcuIGA0MjJgKSBvciBvbmUgb2YgdGhlXG4gICAqIG5hbWVkIGFsaWFzZXMgKGBcInN1Y2Nlc3NcImAsIGBcIm5vdC1mb3VuZFwiYCwgYFwiaW50ZXJuYWwtc2VydmVyLWVycm9yXCJgKS5cbiAgICogTnVtZXJpYyBpbnB1dHMgaW4gdGhlIHN0YW5kYXJkIDF4eC01eHggcmFuZ2UgcmVzb2x2ZSB0aGVpciBvd25cbiAgICogc3RhdHVzIG1lc3NhZ2VzIGZyb20gdGhlIElBTkEgcmVnaXN0cnk7IGFsaWFzZXMga2VlcCB0aGVcbiAgICogYmFjay1jb21wYXRpYmxlIGNvZGUgbWFwcGluZy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmd9IHN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U3RhdHVzKHN0YXR1cykge1xuICAgIGNvbnN0IGFsaWFzQ29kZSA9IE5BTUVEX1NUQVRVU19BTElBU0VTW1N0cmluZyhzdGF0dXMpXVxuICAgIGNvbnN0IG51bWVyaWNTdGF0dXMgPSBhbGlhc0NvZGUgPz8gTnVtYmVyKHN0YXR1cylcblxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihudW1lcmljU3RhdHVzKSB8fCBudW1lcmljU3RhdHVzIDwgMTAwIHx8IG51bWVyaWNTdGF0dXMgPiA1OTkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5oYW5kbGVkIHN0YXR1czogJHtzdGF0dXN9YClcbiAgICB9XG5cbiAgICB0aGlzLnN0YXR1c0NvZGUgPSBudW1lcmljU3RhdHVzXG4gICAgdGhpcy5zdGF0dXNNZXNzYWdlID0gU1RBTkRBUkRfU1RBVFVTX01FU1NBR0VTW251bWVyaWNTdGF0dXNdIHx8IFwiT0tcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlcXVlc3QgdGltZW91dCBtcy5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBSZXF1ZXN0IHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICovXG4gIGdldFJlcXVlc3RUaW1lb3V0TXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByZXF1ZXN0IHRpbWVvdXQgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkIHwgbnVsbH0gdGltZW91dFNlY29uZHMgLSBUaW1lb3V0IGluIHNlY29uZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJlcXVlc3RUaW1lb3V0TXModGltZW91dFNlY29uZHMpIHtcbiAgICBpZiAodHlwZW9mIHRpbWVvdXRTZWNvbmRzID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh0aW1lb3V0U2Vjb25kcykpIHtcbiAgICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSB0aW1lb3V0U2Vjb25kc1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlcXVlc3RUaW1lb3V0TXNDaGFuZ2VIYW5kbGVyKSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlcih0aGlzLl9yZXF1ZXN0VGltZW91dE1zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByZXF1ZXN0IHRpbWVvdXQgbXMgY2hhbmdlIGhhbmRsZXIuXG4gICAqIEBwYXJhbSB7KHRpbWVvdXRTZWNvbmRzOiBudW1iZXIgfCB1bmRlZmluZWQpID0+IHZvaWR9IGhhbmRsZXIgLSBDaGFuZ2UgaGFuZGxlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0UmVxdWVzdFRpbWVvdXRNc0NoYW5nZUhhbmRsZXIoaGFuZGxlcikge1xuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXNDaGFuZ2VIYW5kbGVyID0gaGFuZGxlclxuICB9XG59XG4iXX0=