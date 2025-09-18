export default class Request {
  constructor({body, method = "GET", headers = [], path, version = "1.1"}) {
    this.body = body
    this.headers = headers
    this.method = method
    this.path = path
    this.version = version
  }

  asString() {
    let requestString = ""

    this.stream((chunk) => {
      requestString += chunk
    })

    return requestString
  }

  getHeader(key) {
    const compareName = key.toLowerCase().trim()

    for (const header of this.headers) {
      const headerCompareName = header.key.toLowerCase().trim()

      if (compareName == headerCompareName) {
        return header
      }
    }

    throw new Error(`Header ${key} not found`)
  }

  prepare() {
    if (this.body) {
      this.addHeader("Content-Length", this.body.byteLength)
    }
  }

  stream(callback) {
    this.prepare()

    const requestString = `${this.method} ${this.path} HTTP/${this.version}\r\n`

    callback(requestString)

    for (const header of this.headers) {
      callback(`${header.toString()}\r\n`)
    }

    callback(`\r\n`)

    if (this.body) {
      callback(this.body)
    }
  }
}
