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

  setHeader(key, value) {
    this.headers[key] = [value]
  }

  getBody() {
    if (this.body !== undefined) {
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

  setErrorBody(error) {
    this.setHeader("Content-Type", "text/plain; charset=UTF-8")
    this.setBody(`${error.message}\n\n${error.stack}`)
  }

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
