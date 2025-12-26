// @ts-check

export default class VelociousHttpServerClientResponse {
  /** @type {string | null} */
  body = null

  /** @type {Record<string, string[]>} */
  headers = {}

  /**
   * @param {object} args
   * @param {import("../../configuration.js").default} args.configuration
   */
  constructor({configuration}) {
    this.configuration = configuration
  }

  /**
   * @param {string} key
   * @param {string} value
   * @returns {void} - Result.
   */
  addHeader(key, value) {
    if (!(key in this.headers)) {
      this.headers[key] = []
    }

    this.headers[key].push(value)
  }

  /**
   * @param {string} key
   * @param {string} value
   * @returns {void} - Result.
   */
  setHeader(key, value) {
    this.headers[key] = [value]
  }

  /**
   * @returns {string | null} - Result.
   */
  getBody() {
    if (this.body !== undefined) {
      return this.body
    }

    throw new Error("No body has been set")
  }

  /**
   * @returns {number} - Result.
   */
  getStatusCode() {
    return this.statusCode || 200
  }

  /**
   * @returns {string} - Result.
   */
  getStatusMessage() {
    return this.statusMessage || "OK"
  }

  /**
   * @param {string} value
   * @returns {void} - Result.
   */
  setBody(value) {
    this.body = value
  }

  /**
   * @param {Error} error
   * @returns {void} - Result.
   */
  setErrorBody(error) {
    this.setHeader("Content-Type", "text/plain; charset=UTF-8")
    this.setBody(`${error.message}\n\n${error.stack}`)
  }

  /**
   * @param {number | string} status
   * @returns {void} - Result.
   */
  setStatus(status) {
    if (status == "success" || status == 200) {
      this.statusCode = 200
      this.statusMessage = "OK"
    } else if (status == "not-found" || status == 404) {
      this.statusCode = 404
      this.statusMessage = "Not Found"
    } else if (status == "internal-server-error" || status == 500) {
      this.statusCode = 500
      this.statusMessage = "Internal server error"
    } else {
      throw new Error(`Unhandled status: ${status}`)
    }
  }
}
