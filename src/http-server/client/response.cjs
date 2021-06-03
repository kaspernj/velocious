module.exports = class VelociousHttpServerClientResponse {
  body = undefined
  headers = {}

  addHeader(key, value) {
    if (!(key in this.headers)) {
      this.headers[key] = []
    }

    this.headers[key].push(value)
  }

  setBody(value) {
    this.body = value
  }
}
