// @ts-check

import {HttpResponseBodyTooLargeError} from "./errors.js"

/**
 * Named status aliases.
 * @type {Record<string, number>} */
const NAMED_STATUS_ALIASES = {
  "success": 200,
  "not-found": 404,
  "internal-server-error": 500
}

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
}

export default class VelociousHttpServerClientResponse {
  /**
   * Body.
   * @type {string | Uint8Array | null} */
  body = null

  /**
   * File path.
   * @type {string | null} */
  filePath = null

  /**
   * File response completion callback.
   * @type {((result: "completed" | "aborted") => void | Promise<void>) | null} */
  fileOnFinished = null

  /**
   * Headers.
   * @type {Record<string, string[]>} */
  headers = {}

  /**
   * Whether compression has been disabled for this specific response.
   * @type {boolean} */
  compressionDisabled = false

  /**
   * Whether this response has been switched to live chunked streaming. Once
   * streaming has started, the status line and headers are emitted to the
   * client immediately and every `write()` is emitted as it happens, instead
   * of the whole body being buffered and sent once after the handler
   * returns.
   * @type {boolean} */
  streaming = false

  /**
   * Whether the stream has been finished with `end()` (or finalized).
   * @type {boolean} */
  streamEnded = false

  /**
   * Whether the client connection dropped while the stream was in flight.
   * @type {boolean} */
  streamAborted = false

  /**
   * Transport sink wired in by the owning client so the response can emit
   * headers and chunks to the socket-bound connection.
   * @type {import("./index.js").default | null} */
  transport = null

  /**
   * The socket-bound request this response belongs to.
   * @type {import("./request.js").default | null} */
  transportRequest = null

  /**
   * Callbacks fired when the client disconnects mid-stream.
   * @type {Set<() => void>} */
  streamCloseCallbacks = new Set()

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   */
  constructor({configuration}) {
    this.configuration = configuration
    this._requestTimeoutMs = undefined
    this._requestTimeoutMsChangeHandler = undefined
  }

  /**
   * Runs add header.
   * @param {string} key - Key.
   * @param {string} value - Value to use.
   * @returns {void} - No return value.
   */
  addHeader(key, value) {
    if (!(key in this.headers)) {
      this.headers[key] = []
    }

    this.headers[key].push(value)
  }

  /**
   * Runs set header.
   * @param {string} key - Key.
   * @param {string} value - Value to use.
   * @returns {void} - No return value.
   */
  setHeader(key, value) {
    this.headers[key] = [value]
  }

  /**
   * Returns every value set for a header, matched case-insensitively.
   * @param {string} key - Header name.
   * @returns {string[]} - Header values in insertion order.
   */
  getHeader(key) {
    const lowerCaseKey = key.toLowerCase()

    /** @type {string[]} */
    const values = []

    for (const headerKey in this.headers) {
      if (headerKey.toLowerCase() == lowerCaseKey) {
        values.push(...this.headers[headerKey])
      }
    }

    return values
  }

  /**
   * Removes every value set for a header, matched case-insensitively.
   * @param {string} key - Header name.
   * @returns {void} - No return value.
   */
  removeHeader(key) {
    const lowerCaseKey = key.toLowerCase()

    for (const headerKey in this.headers) {
      if (headerKey.toLowerCase() == lowerCaseKey) {
        delete this.headers[headerKey]
      }
    }
  }

  /**
   * Disables HTTP response compression for this specific response, even when the
   * server is configured to compress buffered responses.
   * @returns {void} - No return value.
   */
  disableCompression() {
    this.compressionDisabled = true
  }

  /**
   * Runs is compression disabled.
   * @returns {boolean} - Whether compression has been disabled for this response.
   */
  isCompressionDisabled() {
    return this.compressionDisabled
  }

  /**
   * Runs get body.
   * @returns {string | Uint8Array | null} - The body.
   */
  getBody() {
    if (this.body !== undefined) {
      return this.body
    }

    throw new Error("No body has been set")
  }

  /**
   * Runs get status code.
   * @returns {number} - The status code.
   */
  getStatusCode() {
    return this.statusCode || 200
  }

  /**
   * Runs get status message.
   * @returns {string} - The status message.
   */
  getStatusMessage() {
    return this.statusMessage || "OK"
  }

  /**
   * Runs set body.
   * @param {string | Uint8Array} value - Value to use.
   * @returns {void} - No return value.
   */
  setBody(value) {
    this.filePath = null
    this.fileOnFinished = null

    const actualBytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength
    const maxBytes = this.configuration.getHttpServerMaxBufferedResponseBodyBytes()

    if (maxBytes !== undefined && actualBytes > maxBytes) {
      this.body = ""
      throw new HttpResponseBodyTooLargeError({actualBytes, maxBytes})
    }

    this.body = value
  }

  /**
   * Whether this response is (or was) a live chunked stream.
   * @returns {boolean} - Whether streaming has started.
   */
  isStreaming() {
    return this.streaming
  }

  /**
   * Whether the client disconnected mid-stream.
   * @returns {boolean} - Whether the stream was aborted by the client.
   */
  isStreamAborted() {
    return this.streamAborted
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
    if (this.streaming) throw new Error("The response is already streaming")
    if (this.filePath !== null) throw new Error("A file response cannot be switched to streaming")
    if (this.body !== null && this.body !== undefined) throw new Error("A buffered body was already set; call stream() before setBody() to stream instead")
    if (this.transport === null) throw new Error("Streaming responses require a socket-bound HTTP request")

    const request = this.transportRequest
    if (!request) throw new Error("Streaming responses require a socket-bound HTTP request")

    if (request.httpMethod() === "HEAD") throw new Error("HEAD responses cannot stream a body")

    const statusCode = this.getStatusCode()
    if ((statusCode >= 100 && statusCode < 200) || statusCode === 204 || statusCode === 304) {
      throw new Error(`Status ${statusCode} cannot carry a streaming body`)
    }

    this.streaming = true
    this.transport.beginStreamResponse(this, request)
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
    if (this.transport === null) throw new Error("write() requires an active streaming response")
    if (!this.streaming) throw new Error("write() requires stream() to be called first")
    if (this.streamEnded || this.streamAborted) return

    await this.transport.writeStreamChunk(value)
  }

  /**
   * Finishes an active stream: emits the chunked terminator and releases the
   * response for completion logging. Settles after the terminator has been
   * delivered to the socket.
   * @returns {Promise<void>} - Settles after the stream is finished.
   */
  async end() {
    if (this.transport === null) throw new Error("end() requires an active streaming response")
    if (!this.streaming) throw new Error("end() requires stream() to be called first")
    if (this.streamEnded) return

    await this.transport.endStreamResponse(this)
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
    this.streamCloseCallbacks.add(callback)
  }

  /**
   * Terminates an active stream after a framework-level failure (the handler
   * threw after `stream()` started): emits the chunked terminator and runs
   * the close callbacks so in-flight work settles its resources. No-op when
   * the stream already ended or was aborted.
   * @returns {void} - No return value.
   */
  abortStream() {
    if (!this.streaming || this.streamEnded || this.transport === null) return

    this.streamEnded = true
    this.transport.endStreamResponse(this)
  }

  /**
   * Runs get file path.
   * @returns {string | null} - File path.
   */
  getFilePath() {
    return this.filePath
  }

  /**
   * Gets the file response completion callback.
   * @returns {((result: "completed" | "aborted") => void | Promise<void>) | null} - File response completion callback.
   */
  getFileOnFinished() {
    return this.fileOnFinished
  }

  /**
   * Runs set file path.
   * @param {string} path - File path.
   * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} [onFinished] - Completion callback.
   * @returns {void} - No return value.
   */
  setFilePath(path, onFinished = null) {
    this.filePath = path
    this.fileOnFinished = onFinished
    this.body = null
  }

  /**
   * Runs set error body.
   * @param {Error} error - Error instance.
   * @returns {void} - No return value.
   */
  setErrorBody(error) {
    this.setHeader("Content-Type", "text/plain; charset=UTF-8")
    this.setBody(`${error.message}\n\n${error.stack}`)
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
    const aliasCode = NAMED_STATUS_ALIASES[String(status)]
    const numericStatus = aliasCode ?? Number(status)

    if (!Number.isInteger(numericStatus) || numericStatus < 100 || numericStatus > 599) {
      throw new Error(`Unhandled status: ${status}`)
    }

    this.statusCode = numericStatus
    this.statusMessage = STANDARD_STATUS_MESSAGES[numericStatus] || "OK"
  }

  /**
   * Runs get request timeout ms.
   * @returns {number | undefined} - Request timeout in seconds.
   */
  getRequestTimeoutMs() {
    return this._requestTimeoutMs
  }

  /**
   * Runs set request timeout ms.
   * @param {number | undefined | null} timeoutSeconds - Timeout in seconds.
   * @returns {void} - No return value.
   */
  setRequestTimeoutMs(timeoutSeconds) {
    if (typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds)) {
      this._requestTimeoutMs = timeoutSeconds
    } else {
      this._requestTimeoutMs = undefined
    }

    if (this._requestTimeoutMsChangeHandler) {
      this._requestTimeoutMsChangeHandler(this._requestTimeoutMs)
    }
  }

  /**
   * Runs set request timeout ms change handler.
   * @param {(timeoutSeconds: number | undefined) => void} handler - Change handler.
   * @returns {void} - No return value.
   */
  setRequestTimeoutMsChangeHandler(handler) {
    this._requestTimeoutMsChangeHandler = handler
  }
}
