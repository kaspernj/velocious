// @ts-check

class Response {
  /**
   * @param {globalThis.Response} fetchResponse
   */
  constructor(fetchResponse) {
    this.fetchResponse = fetchResponse
  }

  /**
   * @returns {Promise<void>} - Result.
   */
  async parse() {
    this._body = await this.fetchResponse.text()

    if (this.statusCode() != 200) throw new Error(`Request failed with code ${this.statusCode()} and body: ${this.body()}`)
  }

  /** @returns {string} - Result.  */
  body() {
    if (!this._body) throw new Error("Response body not parsed yet. Call parse() first.")

    return this._body
  }

  /** @returns {string | null} - Result.  */
  contentType() {
    return this.fetchResponse.headers.get("content-type")
  }

  /** @returns {number} - Result.  */
  statusCode() { return this.fetchResponse.status }
}

export default class RequestClient {
  host = "localhost"
  port = 31006

  /**
   * @param {string} path
   * @returns {Promise<Response>} - Result.
   */
  async get(path) {
    const fetchResponse = await fetch(`http://${this.host}:${this.port}${path}`)
    const response = new Response(fetchResponse)

    await response.parse()

    return response
  }

  /**
   * @param {string} path
   * @param {object} data
   * @returns {Promise<Response>} - Result.
   */
  async post(path, data) {
    const fetchResponse = await fetch(
      `http://${this.host}:${this.port}${path}`,
      {
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: AbortSignal.timeout(5000)
      }
    )

    const response = new Response(fetchResponse)

    await response.parse()

    return response
  }
}
