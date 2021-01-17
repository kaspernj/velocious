const {EventEmitter} = require("events")
const Request = require("./request.cjs")
const RequestRunner = require("./request-runner.cjs")

module.exports = class VeoliciousHttpServerClient {
  constructor({clientCount, onExecuteRequest}) {
    this.clientCount = clientCount
    this.events = new EventEmitter()
    this.onExecuteRequest = onExecuteRequest
    this.state = "initial"
  }

  executeCurrentRequest() {
    console.log("executeCurrentRequest")

    this.state = "response"

    const requestRunner = new RequestRunner(this.currentRequest)

    requestRunner.run()
  }

  onWrite(data) {
    if (this.state == "initial") {
      this.currentRequest = new Request()
      this.currentRequest.requestParser.events.on("done", () => this.executeCurrentRequest())
      this.currentRequest.feed(data)
      this.state = "requestStarted"
    } else if (this.state == "requestStarted") {
      this.currentRequest.feed(data)
    } else {
      throw new Error(`Unknown state: ${this.state}`)
    }
  }
}
