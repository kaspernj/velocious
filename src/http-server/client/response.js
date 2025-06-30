export default class VelociousHttpServerClientResponse {
  body = undefined
  headers = {}

  constructor({configuration}) {
    this.configuration = configuration
  }

  addHeader(key, value) {
    if (!(key in this.headers)) {
      this.headers[key] = []
    }

    this.headers[key].push(value)
  }

  getBody() {
    if (this.body) {
      return this.body
    }

    throw new Error("No body has been set")
  }

  getStatusCode() {
    return this.statusCode || 200
  }

  getStatusMessage() {
    return this.statusMessage || "OK"
  }

  setBody(value) {
    this.body = value
  }

  setStatus(status) {
    if (status == "not-found" || status == 404) {
      this.statusCode = 404
      this.statusMessage = "Not Found"
    } else {
      throw new Error(`Unhandled status: ${status}`)
    }
  }
}
