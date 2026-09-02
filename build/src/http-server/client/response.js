// @ts-check
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
        this.body = value;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7b0NBRW9DO0FBQ3BDLE1BQU0sb0JBQW9CLEdBQUc7SUFDM0IsU0FBUyxFQUFFLEdBQUc7SUFDZCxXQUFXLEVBQUUsR0FBRztJQUNoQix1QkFBdUIsRUFBRSxHQUFHO0NBQzdCLENBQUE7QUFFRDs7b0NBRW9DO0FBQ3BDLE1BQU0sd0JBQXdCLEdBQUc7SUFDL0IsR0FBRyxFQUFFLFVBQVU7SUFDZixHQUFHLEVBQUUscUJBQXFCO0lBQzFCLEdBQUcsRUFBRSxZQUFZO0lBQ2pCLEdBQUcsRUFBRSxhQUFhO0lBQ2xCLEdBQUcsRUFBRSxJQUFJO0lBQ1QsR0FBRyxFQUFFLFNBQVM7SUFDZCxHQUFHLEVBQUUsVUFBVTtJQUNmLEdBQUcsRUFBRSwrQkFBK0I7SUFDcEMsR0FBRyxFQUFFLFlBQVk7SUFDakIsR0FBRyxFQUFFLGVBQWU7SUFDcEIsR0FBRyxFQUFFLGlCQUFpQjtJQUN0QixHQUFHLEVBQUUsY0FBYztJQUNuQixHQUFHLEVBQUUsa0JBQWtCO0lBQ3ZCLEdBQUcsRUFBRSxTQUFTO0lBQ2QsR0FBRyxFQUFFLGtCQUFrQjtJQUN2QixHQUFHLEVBQUUsbUJBQW1CO0lBQ3hCLEdBQUcsRUFBRSxPQUFPO0lBQ1osR0FBRyxFQUFFLFdBQVc7SUFDaEIsR0FBRyxFQUFFLGNBQWM7SUFDbkIsR0FBRyxFQUFFLFdBQVc7SUFDaEIsR0FBRyxFQUFFLG9CQUFvQjtJQUN6QixHQUFHLEVBQUUsb0JBQW9CO0lBQ3pCLEdBQUcsRUFBRSxhQUFhO0lBQ2xCLEdBQUcsRUFBRSxjQUFjO0lBQ25CLEdBQUcsRUFBRSxrQkFBa0I7SUFDdkIsR0FBRyxFQUFFLFdBQVc7SUFDaEIsR0FBRyxFQUFFLFdBQVc7SUFDaEIsR0FBRyxFQUFFLG9CQUFvQjtJQUN6QixH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QyxJQUFJLElBQUksQ0FBQTtJQUN0RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFBO0lBQy9CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsbUJBQW1CLENBQUMsY0FBYztRQUNoQyxJQUFJLE9BQU8sY0FBYyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDMUUsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGNBQWMsQ0FBQTtRQUN6QyxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxTQUFTLENBQUE7UUFDcEMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLDhCQUE4QixFQUFFLENBQUM7WUFDeEMsSUFBSSxDQUFDLDhCQUE4QixDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBQzdELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdDQUFnQyxDQUFDLE9BQU87UUFDdEMsSUFBSSxDQUFDLDhCQUE4QixHQUFHLE9BQU8sQ0FBQTtJQUMvQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBOYW1lZCBzdGF0dXMgYWxpYXNlcy5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuY29uc3QgTkFNRURfU1RBVFVTX0FMSUFTRVMgPSB7XG4gIFwic3VjY2Vzc1wiOiAyMDAsXG4gIFwibm90LWZvdW5kXCI6IDQwNCxcbiAgXCJpbnRlcm5hbC1zZXJ2ZXItZXJyb3JcIjogNTAwXG59XG5cbi8qKlxuICogU3RhbmRhcmQgc3RhdHVzIG1lc3NhZ2VzLlxuICogQHR5cGUge1JlY29yZDxudW1iZXIsIHN0cmluZz59ICovXG5jb25zdCBTVEFOREFSRF9TVEFUVVNfTUVTU0FHRVMgPSB7XG4gIDEwMDogXCJDb250aW51ZVwiLFxuICAxMDE6IFwiU3dpdGNoaW5nIFByb3RvY29sc1wiLFxuICAxMDI6IFwiUHJvY2Vzc2luZ1wiLFxuICAxMDM6IFwiRWFybHkgSGludHNcIixcbiAgMjAwOiBcIk9LXCIsXG4gIDIwMTogXCJDcmVhdGVkXCIsXG4gIDIwMjogXCJBY2NlcHRlZFwiLFxuICAyMDM6IFwiTm9uLUF1dGhvcml0YXRpdmUgSW5mb3JtYXRpb25cIixcbiAgMjA0OiBcIk5vIENvbnRlbnRcIixcbiAgMjA1OiBcIlJlc2V0IENvbnRlbnRcIixcbiAgMjA2OiBcIlBhcnRpYWwgQ29udGVudFwiLFxuICAyMDc6IFwiTXVsdGktU3RhdHVzXCIsXG4gIDIwODogXCJBbHJlYWR5IFJlcG9ydGVkXCIsXG4gIDIyNjogXCJJTSBVc2VkXCIsXG4gIDMwMDogXCJNdWx0aXBsZSBDaG9pY2VzXCIsXG4gIDMwMTogXCJNb3ZlZCBQZXJtYW5lbnRseVwiLFxuICAzMDI6IFwiRm91bmRcIixcbiAgMzAzOiBcIlNlZSBPdGhlclwiLFxuICAzMDQ6IFwiTm90IE1vZGlmaWVkXCIsXG4gIDMwNTogXCJVc2UgUHJveHlcIixcbiAgMzA3OiBcIlRlbXBvcmFyeSBSZWRpcmVjdFwiLFxuICAzMDg6IFwiUGVybWFuZW50IFJlZGlyZWN0XCIsXG4gIDQwMDogXCJCYWQgUmVxdWVzdFwiLFxuICA0MDE6IFwiVW5hdXRob3JpemVkXCIsXG4gIDQwMjogXCJQYXltZW50IFJlcXVpcmVkXCIsXG4gIDQwMzogXCJGb3JiaWRkZW5cIixcbiAgNDA0OiBcIk5vdCBGb3VuZFwiLFxuICA0MDU6IFwiTWV0aG9kIE5vdCBBbGxvd2VkXCIsXG4gIDQwNjogXCJOb3QgQWNjZXB0YWJsZVwiLFxuICA0MDc6IFwiUHJveHkgQXV0aGVudGljYXRpb24gUmVxdWlyZWRcIixcbiAgNDA4OiBcIlJlcXVlc3QgVGltZW91dFwiLFxuICA0MDk6IFwiQ29uZmxpY3RcIixcbiAgNDEwOiBcIkdvbmVcIixcbiAgNDExOiBcIkxlbmd0aCBSZXF1aXJlZFwiLFxuICA0MTI6IFwiUHJlY29uZGl0aW9uIEZhaWxlZFwiLFxuICA0MTM6IFwiUGF5bG9hZCBUb28gTGFyZ2VcIixcbiAgNDE0OiBcIlVSSSBUb28gTG9uZ1wiLFxuICA0MTU6IFwiVW5zdXBwb3J0ZWQgTWVkaWEgVHlwZVwiLFxuICA0MTY6IFwiUmFuZ2UgTm90IFNhdGlzZmlhYmxlXCIsXG4gIDQxNzogXCJFeHBlY3RhdGlvbiBGYWlsZWRcIixcbiAgNDE4OiBcIkknbSBhIHRlYXBvdFwiLFxuICA0MjE6IFwiTWlzZGlyZWN0ZWQgUmVxdWVzdFwiLFxuICA0MjI6IFwiVW5wcm9jZXNzYWJsZSBFbnRpdHlcIixcbiAgNDIzOiBcIkxvY2tlZFwiLFxuICA0MjQ6IFwiRmFpbGVkIERlcGVuZGVuY3lcIixcbiAgNDI1OiBcIlRvbyBFYXJseVwiLFxuICA0MjY6IFwiVXBncmFkZSBSZXF1aXJlZFwiLFxuICA0Mjg6IFwiUHJlY29uZGl0aW9uIFJlcXVpcmVkXCIsXG4gIDQyOTogXCJUb28gTWFueSBSZXF1ZXN0c1wiLFxuICA0MzE6IFwiUmVxdWVzdCBIZWFkZXIgRmllbGRzIFRvbyBMYXJnZVwiLFxuICA0NTE6IFwiVW5hdmFpbGFibGUgRm9yIExlZ2FsIFJlYXNvbnNcIixcbiAgNTAwOiBcIkludGVybmFsIHNlcnZlciBlcnJvclwiLFxuICA1MDE6IFwiTm90IEltcGxlbWVudGVkXCIsXG4gIDUwMjogXCJCYWQgR2F0ZXdheVwiLFxuICA1MDM6IFwiU2VydmljZSBVbmF2YWlsYWJsZVwiLFxuICA1MDQ6IFwiR2F0ZXdheSBUaW1lb3V0XCIsXG4gIDUwNTogXCJIVFRQIFZlcnNpb24gTm90IFN1cHBvcnRlZFwiLFxuICA1MDY6IFwiVmFyaWFudCBBbHNvIE5lZ290aWF0ZXNcIixcbiAgNTA3OiBcIkluc3VmZmljaWVudCBTdG9yYWdlXCIsXG4gIDUwODogXCJMb29wIERldGVjdGVkXCIsXG4gIDUxMDogXCJOb3QgRXh0ZW5kZWRcIixcbiAgNTExOiBcIk5ldHdvcmsgQXV0aGVudGljYXRpb24gUmVxdWlyZWRcIlxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50UmVzcG9uc2Uge1xuICAvKipcbiAgICogQm9keS5cbiAgICogQHR5cGUge3N0cmluZyB8IFVpbnQ4QXJyYXkgfCBudWxsfSAqL1xuICBib2R5ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBGaWxlIHBhdGguXG4gICAqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICBmaWxlUGF0aCA9IG51bGxcblxuICAvKipcbiAgICogRmlsZSByZXNwb25zZSBjb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAdHlwZSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gKi9cbiAgZmlsZU9uRmluaXNoZWQgPSBudWxsXG5cbiAgLyoqXG4gICAqIEhlYWRlcnMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGhlYWRlcnMgPSB7fVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGNvbXByZXNzaW9uIGhhcyBiZWVuIGRpc2FibGVkIGZvciB0aGlzIHNwZWNpZmljIHJlc3BvbnNlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgY29tcHJlc3Npb25EaXNhYmxlZCA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX3JlcXVlc3RUaW1lb3V0TXMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGhlYWRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRIZWFkZXIoa2V5LCB2YWx1ZSkge1xuICAgIGlmICghKGtleSBpbiB0aGlzLmhlYWRlcnMpKSB7XG4gICAgICB0aGlzLmhlYWRlcnNba2V5XSA9IFtdXG4gICAgfVxuXG4gICAgdGhpcy5oZWFkZXJzW2tleV0ucHVzaCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBoZWFkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBLZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SGVhZGVyKGtleSwgdmFsdWUpIHtcbiAgICB0aGlzLmhlYWRlcnNba2V5XSA9IFt2YWx1ZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGV2ZXJ5IHZhbHVlIHNldCBmb3IgYSBoZWFkZXIsIG1hdGNoZWQgY2FzZS1pbnNlbnNpdGl2ZWx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gSGVhZGVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBIZWFkZXIgdmFsdWVzIGluIGluc2VydGlvbiBvcmRlci5cbiAgICovXG4gIGdldEhlYWRlcihrZXkpIHtcbiAgICBjb25zdCBsb3dlckNhc2VLZXkgPSBrZXkudG9Mb3dlckNhc2UoKVxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB2YWx1ZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gdGhpcy5oZWFkZXJzKSB7XG4gICAgICBpZiAoaGVhZGVyS2V5LnRvTG93ZXJDYXNlKCkgPT0gbG93ZXJDYXNlS2V5KSB7XG4gICAgICAgIHZhbHVlcy5wdXNoKC4uLnRoaXMuaGVhZGVyc1toZWFkZXJLZXldKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGV2ZXJ5IHZhbHVlIHNldCBmb3IgYSBoZWFkZXIsIG1hdGNoZWQgY2FzZS1pbnNlbnNpdGl2ZWx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gSGVhZGVyIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlbW92ZUhlYWRlcihrZXkpIHtcbiAgICBjb25zdCBsb3dlckNhc2VLZXkgPSBrZXkudG9Mb3dlckNhc2UoKVxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gdGhpcy5oZWFkZXJzKSB7XG4gICAgICBpZiAoaGVhZGVyS2V5LnRvTG93ZXJDYXNlKCkgPT0gbG93ZXJDYXNlS2V5KSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmhlYWRlcnNbaGVhZGVyS2V5XVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlcyBIVFRQIHJlc3BvbnNlIGNvbXByZXNzaW9uIGZvciB0aGlzIHNwZWNpZmljIHJlc3BvbnNlLCBldmVuIHdoZW4gdGhlXG4gICAqIHNlcnZlciBpcyBjb25maWd1cmVkIHRvIGNvbXByZXNzIGJ1ZmZlcmVkIHJlc3BvbnNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZGlzYWJsZUNvbXByZXNzaW9uKCkge1xuICAgIHRoaXMuY29tcHJlc3Npb25EaXNhYmxlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNvbXByZXNzaW9uIGRpc2FibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNvbXByZXNzaW9uIGhhcyBiZWVuIGRpc2FibGVkIGZvciB0aGlzIHJlc3BvbnNlLlxuICAgKi9cbiAgaXNDb21wcmVzc2lvbkRpc2FibGVkKCkge1xuICAgIHJldHVybiB0aGlzLmNvbXByZXNzaW9uRGlzYWJsZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBib2R5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgVWludDhBcnJheSB8IG51bGx9IC0gVGhlIGJvZHkuXG4gICAqL1xuICBnZXRCb2R5KCkge1xuICAgIGlmICh0aGlzLmJvZHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHRoaXMuYm9keVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGJvZHkgaGFzIGJlZW4gc2V0XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc3RhdHVzIGNvZGUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgZ2V0U3RhdHVzQ29kZSgpIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0dXNDb2RlIHx8IDIwMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN0YXR1cyBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBzdGF0dXMgbWVzc2FnZS5cbiAgICovXG4gIGdldFN0YXR1c01lc3NhZ2UoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdHVzTWVzc2FnZSB8fCBcIk9LXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBib2R5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IFVpbnQ4QXJyYXl9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRCb2R5KHZhbHVlKSB7XG4gICAgdGhpcy5maWxlUGF0aCA9IG51bGxcbiAgICB0aGlzLmZpbGVPbkZpbmlzaGVkID0gbnVsbFxuICAgIHRoaXMuYm9keSA9IHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBGaWxlIHBhdGguXG4gICAqL1xuICBnZXRGaWxlUGF0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlUGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGZpbGUgcmVzcG9uc2UgY29tcGxldGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IC0gRmlsZSByZXNwb25zZSBjb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKi9cbiAgZ2V0RmlsZU9uRmluaXNoZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsZU9uRmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcGFyYW0geygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IFtvbkZpbmlzaGVkXSAtIENvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEZpbGVQYXRoKHBhdGgsIG9uRmluaXNoZWQgPSBudWxsKSB7XG4gICAgdGhpcy5maWxlUGF0aCA9IHBhdGhcbiAgICB0aGlzLmZpbGVPbkZpbmlzaGVkID0gb25GaW5pc2hlZFxuICAgIHRoaXMuYm9keSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlcnJvciBib2R5LlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRFcnJvckJvZHkoZXJyb3IpIHtcbiAgICB0aGlzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIilcbiAgICB0aGlzLnNldEJvZHkoYCR7ZXJyb3IubWVzc2FnZX1cXG5cXG4ke2Vycm9yLnN0YWNrfWApXG4gIH1cblxuICAvKipcbiAgICogQWNjZXB0cyBhIG51bWVyaWMgSFRUUCBzdGF0dXMgY29kZSAoZS5nLiBgNDIyYCkgb3Igb25lIG9mIHRoZVxuICAgKiBuYW1lZCBhbGlhc2VzIChgXCJzdWNjZXNzXCJgLCBgXCJub3QtZm91bmRcImAsIGBcImludGVybmFsLXNlcnZlci1lcnJvclwiYCkuXG4gICAqIE51bWVyaWMgaW5wdXRzIGluIHRoZSBzdGFuZGFyZCAxeHgtNXh4IHJhbmdlIHJlc29sdmUgdGhlaXIgb3duXG4gICAqIHN0YXR1cyBtZXNzYWdlcyBmcm9tIHRoZSBJQU5BIHJlZ2lzdHJ5OyBhbGlhc2VzIGtlZXAgdGhlXG4gICAqIGJhY2stY29tcGF0aWJsZSBjb2RlIG1hcHBpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSBzdGF0dXMgLSBTdGF0dXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFN0YXR1cyhzdGF0dXMpIHtcbiAgICBjb25zdCBhbGlhc0NvZGUgPSBOQU1FRF9TVEFUVVNfQUxJQVNFU1tTdHJpbmcoc3RhdHVzKV1cbiAgICBjb25zdCBudW1lcmljU3RhdHVzID0gYWxpYXNDb2RlID8/IE51bWJlcihzdGF0dXMpXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIobnVtZXJpY1N0YXR1cykgfHwgbnVtZXJpY1N0YXR1cyA8IDEwMCB8fCBudW1lcmljU3RhdHVzID4gNTk5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuaGFuZGxlZCBzdGF0dXM6ICR7c3RhdHVzfWApXG4gICAgfVxuXG4gICAgdGhpcy5zdGF0dXNDb2RlID0gbnVtZXJpY1N0YXR1c1xuICAgIHRoaXMuc3RhdHVzTWVzc2FnZSA9IFNUQU5EQVJEX1NUQVRVU19NRVNTQUdFU1tudW1lcmljU3RhdHVzXSB8fCBcIk9LXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXF1ZXN0IHRpbWVvdXQgbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gUmVxdWVzdCB0aW1lb3V0IGluIHNlY29uZHMuXG4gICAqL1xuICBnZXRSZXF1ZXN0VGltZW91dE1zKCkge1xuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0VGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVxdWVzdCB0aW1lb3V0IG1zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZCB8IG51bGx9IHRpbWVvdXRTZWNvbmRzIC0gVGltZW91dCBpbiBzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRSZXF1ZXN0VGltZW91dE1zKHRpbWVvdXRTZWNvbmRzKSB7XG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0U2Vjb25kcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dFNlY29uZHMpKSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zID0gdGltZW91dFNlY29uZHNcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNcyA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlcikge1xuICAgICAgdGhpcy5fcmVxdWVzdFRpbWVvdXRNc0NoYW5nZUhhbmRsZXIodGhpcy5fcmVxdWVzdFRpbWVvdXRNcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVxdWVzdCB0aW1lb3V0IG1zIGNoYW5nZSBoYW5kbGVyLlxuICAgKiBAcGFyYW0geyh0aW1lb3V0U2Vjb25kczogbnVtYmVyIHwgdW5kZWZpbmVkKSA9PiB2b2lkfSBoYW5kbGVyIC0gQ2hhbmdlIGhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFJlcXVlc3RUaW1lb3V0TXNDaGFuZ2VIYW5kbGVyKGhhbmRsZXIpIHtcbiAgICB0aGlzLl9yZXF1ZXN0VGltZW91dE1zQ2hhbmdlSGFuZGxlciA9IGhhbmRsZXJcbiAgfVxufVxuIl19