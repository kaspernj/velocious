import {digg} from "diggerize"
import {EventEmitter} from "events"
import logger from "../../logger.mjs"
import Request from "./request.mjs"
import RequestRunner from "./request-runner.mjs"

export default class VeoliciousHttpServerClient {
  events = new EventEmitter()
  state = "initial"

  constructor({clientCount, configuration, onExecuteRequest}) {
    if (!configuration) throw new Error("No configuration given")

    this.clientCount = clientCount
    this.configuration = configuration
    this.onExecuteRequest = onExecuteRequest
  }

  executeCurrentRequest = () => {
    logger(this, "executeCurrentRequest")

    this.state = "response"

    const requestRunner = new RequestRunner({
      configuration: this.configuration,
      request: this.currentRequest,
      routes: this.routes
    })

    requestRunner.events.on("done", this.sendResponse)
    requestRunner.run()
  }

  onWrite(data) {
    if (this.state == "initial") {
      this.currentRequest = new Request({
        configuration: this.configuration
      })
      this.currentRequest.requestParser.events.on("done", this.executeCurrentRequest)
      this.currentRequest.feed(data)
      this.state = "requestStarted"
    } else if (this.state == "requestStarted") {
      this.currentRequest.feed(data)
    } else {
      throw new Error(`Unknown state: ${this.state}`)
    }
  }

  sendResponse = (requestRunner) => {
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
