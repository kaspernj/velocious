const Request = require("./request.cjs")

function byteArrayToString(byteArray) {
  return String.fromCharCode.apply(null, byteArray)
}

module.exports = class VeoliciousHttpServerClient {
  constructor({clientCount}) {
    this.clientCount = clientCount
    this.state = "initial"
  }

  onWrite(data) {
    console.log(`Client ${this.clientCount}: ${byteArrayToString(data)}`)

    if (this.state == "initial") {
      this.currentRequest = new Request(byteArrayToString(data))
      this.state = "requestStarted"
    } else if (this.state == "requestStarted") {
      this.currentRequest.feed(byteArrayToString(data))
    } else {
      throw new Error(`Unknown state: ${this.state}`)
    }
  }
}
