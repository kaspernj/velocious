// @ts-check

import crypto from "crypto"
import {digg} from "diggerize"
import {EventEmitter} from "events"
import {Logger} from "../../logger.js"
import Request from "./request.js"
import RequestRunner from "./request-runner.js"
import WebsocketSession from "./websocket-session.js"

export default class VeoliciousHttpServerClient {
  events = new EventEmitter()
  state = "initial"

  /**
   * @param {object} args - Options object.
   * @param {number} args.clientCount - Client count.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.remoteAddress] - Remote address.
   */
  constructor({clientCount, configuration, remoteAddress}) {
    if (!configuration) throw new Error("No configuration given")

    this.logger = new Logger(this)
    this.clientCount = clientCount
    this.configuration = configuration
    this.remoteAddress = remoteAddress

    /** @type {RequestRunner[]} */
    this.requestRunners = []
  }

  /**
   * @param {string} message - Message text.
   * @returns {void} - No return value.
   */
  _sendBadUpgradeResponse(message) {
    const httpVersion = this.currentRequest?.httpVersion() || "1.1"
    const body = `${message}\n`
    const headers = [
      `HTTP/${httpVersion} 400 Bad Request`,
      "Connection: Close",
      "Content-Type: text/plain; charset=UTF-8",
      `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
      "",
      body
    ].join("\r\n")

    this.events.emit("output", headers)
    this.events.emit("close")
  }

  executeCurrentRequest = () => {
    this.logger.debug("executeCurrentRequest")

    if (!this.currentRequest) throw new Error("No current request")

    if (this._isWebsocketUpgrade(this.currentRequest)) {
      this._upgradeToWebsocket()
      return
    }

    // We are done parsing the given request and can theoretically start parsing a new one, before the current request is done - so reset the state.
    this.state = "initial"

    const requestRunner = new RequestRunner({
      configuration: this.configuration,
      request: this.currentRequest
    })

    this.requestRunners.push(requestRunner)

    requestRunner.events.on("done", this.requestDone)
    requestRunner.run()
  }

  /**
   * @param {Buffer} data - Data payload.
   * @returns {void} - No return value.
   */
  onWrite(data) {
    if (this.websocketSession) {
      this.websocketSession.onData(data)
      return
    }

    if (this.state == "initial") {
      this.currentRequest = new Request({client: this, configuration: this.configuration})
      this.currentRequest.requestParser.events.on("done", this.executeCurrentRequest)
      this.currentRequest.feed(data)
      this.state = "requestStarted"
    } else if (this.state == "requestStarted") {
      if (!this.currentRequest) throw new Error("No current request")

      this.currentRequest.feed(data)
    } else {
      throw new Error(`Unknown state for client: ${this.state}`)
    }
  }

  /**
   * @param {import("./request.js").default} request - Request object.
   * @returns {boolean} - Whether websocket upgrade.
   */
  _isWebsocketUpgrade(request) {
    const upgradeHeader = request.header("upgrade")?.toLowerCase()
    const connectionHeader = request.header("connection")?.toLowerCase()

    return Boolean(upgradeHeader == "websocket" && connectionHeader?.includes("upgrade"))
  }

  /** @returns {void} - No return value.  */
  _upgradeToWebsocket() {
    if (!this.currentRequest) throw new Error("No current request")

    const secWebsocketKey = this.currentRequest.header("sec-websocket-key")

    if (!secWebsocketKey) {
      this._sendBadUpgradeResponse("Missing Sec-WebSocket-Key header")
      return
    }

    const websocketAcceptKey = crypto.createHash("sha1")
      .update(`${secWebsocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, "binary")
      .digest("base64")
    const httpVersion = this.currentRequest.httpVersion() || "1.1"
    const responseLines = [
      `HTTP/${httpVersion} 101 Switching Protocols`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${websocketAcceptKey}`,
      "",
      ""
    ]
    const response = responseLines.join("\r\n")

    this.websocketSession = new WebsocketSession({
      client: this,
      configuration: this.configuration
    })
    this.websocketSession.events.on("close", () => {
      this.websocketSession?.destroy()
      this.websocketSession = undefined
      this.events.emit("close")
    })
    this.state = "websocket"
    this.events.emit("output", response)
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

  /**
   * @param {RequestRunner} requestRunner - Request runner.
   * @returns {void} - No return value.
   */
  sendResponse(requestRunner) {
    if (!this.currentRequest) throw new Error("No current request")

    const response = digg(requestRunner, "response")
    const request = requestRunner.getRequest()
    const body = response.getBody()
    const date = new Date()
    const connectionHeader = request.header("connection")?.toLowerCase()?.trim()
    const httpVersion = request.httpVersion()

    this.logger.debug("sendResponse", {clientCount: this.clientCount, connectionHeader, httpVersion})

    if (httpVersion == "1.0" && connectionHeader == "keep-alive") {
      response.setHeader("Connection", "Keep-Alive")
    } else {
      response.setHeader("Connection", "Close")
    }

    const contentLength = new TextEncoder().encode(body).length

    response.setHeader("Content-Length", contentLength)
    response.setHeader("Date", date.toUTCString())
    response.setHeader("Server", "Velocious")

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
