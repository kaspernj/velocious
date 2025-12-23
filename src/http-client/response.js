// @ts-check

import Header from "./header.js"

export default class Response {
  /**
   * @param {object} args
   * @param {string} args.method
   * @param {function() : void} args.onComplete
   */
  constructor({method = "GET", onComplete}) {
    if (!method) throw new Error(`Invalid method given: ${method}`)

    /** @type {Header[]} */
    this.headers = []

    this.method = method.toUpperCase().trim()
    this.onComplete = onComplete
    this.state = "status-line"

    /** @type {Buffer} */
    this.response = Buffer.alloc(0);
  }

  /** @param {Buffer} data */
  feed(data) {
    this.response = Buffer.concat([this.response, data])
    this.tryToParse()
  }

  /**
   * @param {string} name
   * @returns {Header}
   */
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
    const contentTypeHeader = this.getHeader("Content-Type")?.getValue()

    if (typeof contentTypeHeader != "string") throw new Error(`Content-Type wasn't a string: ${contentTypeHeader}`)

    if (!contentTypeHeader.toLowerCase().trim().startsWith("application/json")) {
      throw new Error(`Content-Type is not JSON: ${contentTypeHeader}`)
    }

    const body = this.response.toString()
    const json = JSON.parse(body)

    return json
  }

  tryToParse() {
    while (true) {
      if (this.state == "body") {
        const contentLengthNumber = this._contentLengthNumber()

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
              const contentLengthNumber = this._contentLengthNumber()

              if (!contentLengthNumber) {
                this.completeResponse()
                break
              } else {
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

  /**
   * @returns {number}
   */
  _contentLengthNumber() {
    const header = this.headers.find((currentHeader) => currentHeader.getName().toLowerCase() == "content-length")

    if (!header) return 0

    const contentLengthValue = header.getValue()

    if (typeof contentLengthValue === "number") return contentLengthValue
    if (typeof contentLengthValue === "string") return parseInt(contentLengthValue)

    throw new Error(`Content-Length is not a number: ${contentLengthValue}`)
  }
}
