// @ts-check

export class HttpRequestBodyTooLargeError extends Error {
  /**
   * Creates a request-body limit error.
   * @param {object} args - Size details.
   * @param {number} args.actualBytes - Declared or accumulated body size.
   * @param {number} args.maxBytes - Configured maximum body size.
   */
  constructor({actualBytes, maxBytes}) {
    super(`HTTP request body exceeds ${maxBytes} bytes (received or declared ${actualBytes})`)
    this.name = "HttpRequestBodyTooLargeError"
  }
}

export class HttpResponseBodyTooLargeError extends Error {
  /**
   * Creates a buffered-response limit error.
   * @param {object} args - Size details.
   * @param {number} args.actualBytes - Buffered response body size.
   * @param {number} args.maxBytes - Configured maximum body size.
   */
  constructor({actualBytes, maxBytes}) {
    super(`Buffered HTTP response body exceeds ${maxBytes} bytes (received ${actualBytes})`)
    this.name = "HttpResponseBodyTooLargeError"
  }
}
