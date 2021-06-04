module.exports = class VelociousHttpServerClientResponse {
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

  setBody(value) {
    this.body = value
  }
}
