class Response {
  constructor(fetchResponse) {
    this.fetchResponse = fetchResponse
  }

  /**
   * @returns {void}
   */
  async parse() {
    this._body = await this.fetchResponse.text()

    if (this.statusCode() != 200) throw new Error(`Request failed with code ${this.statusCode()} and body: ${this.body()}`)
  }

  /**
   * @returns {string}
   */
  body() { return this._body }

  /**
   * @returns {string}
   */
  contentType() { return this.fetchResponse.headers.get("content-type") }

  /**
   * @returns {string}
   */
  statusCode() { return this.fetchResponse.status }
}

export default class RequestClient {
  host = "localhost"
  port = 31006

  /**
   * @param {string} path
   * @returns {Response}
   */
  async get(path) {
    const fetchResponse = await fetch(`http://${this.host}:${this.port}${path}`)
    const response = new Response(fetchResponse)

    await response.parse()

    return response
  }

  /**
   * @param {string} path
   * @param {Object} data
   * @returns {Response}
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
