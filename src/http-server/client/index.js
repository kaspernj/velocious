import {digg} from "diggerize"
import {EventEmitter} from "events"
import {Logger} from "../../logger.js"
import Request from "./request.js"
import RequestRunner from "./request-runner.js"

export default class VeoliciousHttpServerClient {
  events = new EventEmitter()
  state = "initial"

  constructor({clientCount, configuration, onExecuteRequest}) {
    if (!configuration) throw new Error("No configuration given")

    this.logger = new Logger(this)
    this.clientCount = clientCount
    this.configuration = configuration
    this.onExecuteRequest = onExecuteRequest
    this.requestRunners = []
  }

  executeCurrentRequest = () => {
    this.logger.debug("executeCurrentRequest")

    // We are done parsing the given request and can theoretically start parsing a new one, before the current request is done - so reset the state.
    this.state = "initial"

    const requestRunner = new RequestRunner({
      configuration: this.configuration,
      request: this.currentRequest,
      routes: this.routes
    })

    this.requestRunners.push(requestRunner)

    requestRunner.events.on("done", this.requestDone)
    requestRunner.run()
  }

  onWrite(data) {
    if (this.state == "initial") {
      this.currentRequest = new Request({client: this, configuration: this.configuration})
      this.currentRequest.requestParser.events.on("done", this.executeCurrentRequest)
      this.currentRequest.feed(data)
      this.state = "requestStarted"
    } else if (this.state == "requestStarted") {
      this.currentRequest.feed(data)
    } else {
      throw new Error(`Unknown state for client: ${this.state}`)
    }
  }

  requestDone = () => {
    this.sendDoneRequests()
  }

  sendDoneRequests() {
    while (true) {
      const requestRunner = this.requestRunners[0]
      const request = requestRunner?.getRequest()

      if (requestRunner?.getState() == "done") {
        const httpVersion = request.httpVersion()
        const connectionHeader = request.header("connection")?.toLowerCase()?.trim()

        this.requestRunners.shift()
        this.sendResponse(requestRunner)
        this.logger.debug(() => ["sendDoneRequests", {clientCount: this.clientCount, connectionHeader, httpVersion}])

        if (httpVersion == "1.0" && connectionHeader != "keep-alive") {
          this.logger.debug(() => [`Closing the connection because ${httpVersion} and connection header ${connectionHeader}`, {clientCount: this.clientCount}])
          this.events.emit("close")
        }
      } else {
        break
      }
    }
  }

  sendResponse(requestRunner) {
    const response = digg(requestRunner, "response")
    const request = requestRunner.getRequest()
    const body = response.getBody()
    const date = new Date()
    const connectionHeader = request.header("connection")?.toLowerCase()?.trim()
    const httpVersion = request.httpVersion()

    this.logger.debug("sendResponse", {clientCount: this.clientCount, connectionHeader, httpVersion})

    if (httpVersion == "1.0" && connectionHeader == "keep-alive") {
      response.addHeader("Connection", "Keep-Alive")
    } else {
      response.addHeader("Connection", "Close")
    }

    const textEncoded = new TextEncoder().encode(body)

    response.addHeader("Content-Length", textEncoded.length)
    response.addHeader("Date", date.toUTCString())
    response.addHeader("Server", "Velocious")

    let headers = ""

    headers += `HTTP/${this.currentRequest.httpVersion()} ${response.getStatusCode()} ${response.getStatusMessage()}\r\n`

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
