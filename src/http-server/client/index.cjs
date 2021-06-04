const {digg} = require("@kaspernj/object-digger")
const {EventEmitter} = require("events")
const logger = require("../../logger.cjs")
const Request = require("./request.cjs")
const RequestRunner = require("./request-runner.cjs")

module.exports = class VeoliciousHttpServerClient {
  events = new EventEmitter()
  state = "initial"

  constructor({clientCount, debug, directory, onExecuteRequest}) {
    if (!directory) throw new Error("No directory given")

    // Every client need to make their own routes because they probably can't be shared across different worker threads
    const {routes} = require(`${directory}/src/routes.cjs`)

    this.clientCount = clientCount
    this.debug = debug
    this.directory = directory
    this.onExecuteRequest = onExecuteRequest
    this.routes = routes
  }

  executeCurrentRequest() {
    logger(this, "executeCurrentRequest")

    this.state = "response"

    const requestRunner = new RequestRunner({
      debug: this.debug,
      request: this.currentRequest,
      routes: this.routes
    })

    requestRunner.events.on("done", (requestRunner) => this.sendResponse(requestRunner))
    requestRunner.run()
  }

  onWrite(data) {
    if (this.state == "initial") {
      this.currentRequest = new Request({
        debug: this.debug
      })
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
    const date = new Date()

    response.addHeader("Connection", "keep-alive")
    response.addHeader("Content-Length", response.body.length)
    response.addHeader("Date", date.toUTCString())
    response.addHeader("Server", "Velocious")

    let headers = ""

    headers += "HTTP/1.1 200 OK\r\n"

    for (const headerKey in response.headers) {
      for (const headerValue of response.headers[headerKey]) {
        headers += `${headerKey}: ${headerValue}\r\n`
      }
    }

    headers += "\r\n"

    this.events.emit("output", headers)
    this.events.emit("output", body)
  }
}
