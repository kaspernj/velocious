import Header from "./header.js"

export default class Response {
  constructor({method = "GET", onComplete}) {
    if (!method) throw new Error(`Invalid method given: ${method}`)

    this.headers = []
    this.method = method.toUpperCase().trim()
    this.onComplete = onComplete
    this.state = "status-line"

    this.arrayBuffer = new ArrayBuffer()
    this.response = new Uint8Array(this.arrayBuffer)
  }

  feed(data) {
    this.response += data
    this.tryToParse()
  }

  getHeader(name) {
    const compareName = name.toLowerCase().trim()

    for (const header of this.headers) {
      const headerCompareName = header.getName().toLowerCase().trim()

      if (compareName == headerCompareName) {
        return header
      }
    }

    throw new Error(`Header ${name} not found`)
  }

  json() {
    const contentTypeHeader = this.getHeader("Content-Type")?.getValue()?.toLowerCase()?.trim()

    if (!contentTypeHeader.startsWith("application/json")) {
      throw new Error(`Content-Type is not JSON: ${contentTypeHeader}`)
    }

    const body = this.response.toString()
    const json = JSON.parse(body)

    return json
  }

  tryToParse() {
    while (true) {
      if (this.state == "body") {
        const contentLengthValue = this.getHeader("Content-Length")?.value

        if (contentLengthValue === undefined) {
          throw new Error("No content length given")
        }

        const contentLengthNumber = parseInt(contentLengthValue)

        if (this.response.byteLength >= contentLengthNumber) {
          this.completeResponse()
          break
        }
      } else {
        const response = this.response.toString()
        let lineEndIndex = response.indexOf("\r\n")
        let lineEndLength = 2

        if (lineEndIndex === -1) {
          lineEndIndex = response.indexOf("\n")
          lineEndLength = 1
        }

        if (lineEndIndex === -1) {
          break // We need to get fed more to continue reading
        } else {
          const line = response.substring(0, lineEndIndex)

          this.response = this.response.slice(lineEndIndex + lineEndLength)

          if (this.state == "status-line") {
            this.statusLine = line
            this.state = "headers"
          } else if (this.state == "headers") {
            if (line == "") {
              if (this.method == "GET" || this.method == "HEAD") {
                this.completeResponse()
                break
              } else if (this.method == "POST") {
                this.state = "body"
              }
            } else {
              const headerMatch = line.match(/^(.+?):\s*(.+)$/)

              if (!headerMatch) throw new Error(`Invalid header: ${line}`)

              const header = new Header(headerMatch[1], headerMatch[2])

              this.headers.push(header)
            }
          } else {
            throw new Error(`Unexpected state: ${this.state}`)
          }
        }
      }
    }
  }

  completeResponse() {
    this.state = "done"
    this.onComplete()
  }
}
