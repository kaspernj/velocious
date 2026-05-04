// @ts-check

/** @type {Record<string, number>} */
const NAMED_STATUS_ALIASES = {
  "success": 200,
  "not-found": 404,
  "internal-server-error": 500
}

/** @type {Record<number, string>} */
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
  /** @type {string | Uint8Array | null} */
  body = null

  /** @type {string | null} */
  filePath = null

  /** @type {Record<string, string[]>} */
  headers = {}

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   */
  constructor({configuration}) {
    this.configuration = configuration
    this._requestTimeoutMs = undefined
    this._requestTimeoutMsChangeHandler = undefined
  }

  /**
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
   * @param {string} key - Key.
   * @param {string} value - Value to use.
   * @returns {void} - No return value.
   */
  setHeader(key, value) {
    this.headers[key] = [value]
  }

  /**
   * @returns {string | Uint8Array | null} - The body.
   */
  getBody() {
    if (this.body !== undefined) {
      return this.body
    }

    throw new Error("No body has been set")
  }

  /**
   * @returns {number} - The status code.
   */
  getStatusCode() {
    return this.statusCode || 200
  }

  /**
   * @returns {string} - The status message.
   */
  getStatusMessage() {
    return this.statusMessage || "OK"
  }

  /**
   * @param {string | Uint8Array} value - Value to use.
   * @returns {void} - No return value.
   */
  setBody(value) {
    this.filePath = null
    this.body = value
  }

  /**
   * @returns {string | null} - File path.
   */
  getFilePath() {
    return this.filePath
  }

  /**
   * @param {string} path - File path.
   * @returns {void} - No return value.
   */
  setFilePath(path) {
    this.filePath = path
    this.body = null
  }

  /**
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
   *
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
   * @returns {number | undefined} - Request timeout in seconds.
   */
  getRequestTimeoutMs() {
    return this._requestTimeoutMs
  }

  /**
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
   * @param {(timeoutSeconds: number | undefined) => void} handler - Change handler.
   * @returns {void} - No return value.
   */
  setRequestTimeoutMsChangeHandler(handler) {
    this._requestTimeoutMsChangeHandler = handler
  }
}
