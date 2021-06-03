const {digg} = require("@kaspernj/object-digger")
const {EventEmitter} = require("events")
const Request = require("./request.cjs")
const RequestRunner = require("./request-runner.cjs")

module.exports = class VeoliciousHttpServerClient {
  events = new EventEmitter()
  state = "initial"

  constructor({clientCount, onExecuteRequest}) {
    this.clientCount = clientCount
    this.onExecuteRequest = onExecuteRequest
  }

  executeCurrentRequest() {
    console.log("executeCurrentRequest")

    this.state = "response"

    const requestRunner = new RequestRunner(this.currentRequest)

    requestRunner.events.on("done", (requestRunner) => this.sendResponse(requestRunner))
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

  sendResponse(requestRunner) {
    const response = digg(requestRunner, "response")
    const body = response.getBody()

    console.log("send response")

    let headers = ""

    headers += "HTTP/1.1 200 OK\r\n"

    if (body) {
      headers += `Content-Length: ${response.body.length}\r\n`
    }

    for (const headerKey in response.headers) {
      for (const headerValue of response.headers[headerKey]) {
        headers += `${headerKey}: ${headerValue}\r\n`
      }
    }

    this.events.emit("output", headers)
    this.events.emit("output", body)
  }
}
