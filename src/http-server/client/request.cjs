const RequestParser = require("./request-parser.cjs")

module.exports = class VelociousHttpServerClientRequest {
  constructor(data) {
    this.requestParser = new RequestParser(data)
    this.state = "statusLine"
    this.parse()
  }

  feed(data) {
    this.requestParser.feed(data)
  }

  parse() {
    if (this.state == "statusLine") {
      this.status = this.requestParser.parseStatusLine()
      this.headers = this.requestParser.parseHeaders()

      console.log("Done with status and headers")

      this.executeRequest()
    } else {
      throw new Error(`Unknown state: ${this.state}`)
    }
  }
}
