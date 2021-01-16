module.exports = class VelociousHttpServerClientRequestParser {
  constructor(data) {
    this.data = data
  }

  feed(data) {
    this.data += data
  }

  matchAndRemove(regex) {
    const match = this.data.match(regex)

    if (!match) {
      return null
    }

    this.data = this.data.replace(regex, "")

    return match
  }

  parseHeaders() {
    console.log("parseHeaders")

    const headers = []

    while (true) {
      if (this.parseHeadersEnded()) {
        break
      }

      const header = this.parseHeader()

      headers.push(header)
    }

    return headers
  }

  parseHeader() {
    const match = this.matchAndRemove(/^(.+): (.+)\r\n/)

    if (!match) {
      throw new Error(`Couldn't match header from: ${this.data}`)
    }

    const name = match[1]
    const value = match[2]

    return {name, value}
  }

  parseHeadersEnded() {
    if (this.matchAndRemove(/^\r\n/)) {
      return true
    }
  }

  parseStatusLine() {
    const match = this.matchAndRemove(/^(GET|POST) (.+) HTTP\/1\.1\r\n/)

    if (!match) {
      throw new Error(`Couldn't match status line from: ${this.data}`)
    }

    const httpMethod = match[1]
    const path = match[2]

    return {httpMethod, path}
  }
}
