class Response {
  constructor(fetchResponse) {
    this.fetchResponse = fetchResponse
  }

  async parse() {
    this._body = await this.fetchResponse.text()
  }

  body = () => this._body
  contentType = () => this.fetchResponse.headers.get("content-type")
  statusCode = () => this.fetchResponse.status
}

export default class RequestClient {
  host = "localhost"
  port = 31006

  get() {
    throw new Error("get stub")
  }

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
