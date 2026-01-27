// @ts-check

import crypto from "crypto"
import {digg} from "diggerize"
import EventEmitter from "../../utils/event-emitter.js"
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

    /** @type {Buffer | undefined} */
    let remaining = data

    while (remaining && remaining.length > 0) {
      if (this.state == "initial") {
        this.currentRequest = new Request({client: this, configuration: this.configuration})
        this.currentRequest.requestParser.events.on("done", this.executeCurrentRequest)
        this.state = "requestStarted"
      } else if (this.state != "requestStarted") {
        throw new Error(`Unknown state for client: ${this.state}`)
      }

      if (!this.currentRequest) throw new Error("No current request")

      remaining = this.currentRequest.feed(remaining)

      if (remaining && remaining.length > 0) {
        const requestParser = this.currentRequest.getRequestParser()

        if (!requestParser.hasCompleted) break

        this.state = "initial"
      }
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

    const messageHandlerResolver = this.configuration.getWebsocketMessageHandlerResolver?.()
    let messageHandler
    let messageHandlerPromise

    if (messageHandlerResolver) {
      const resolvedHandler = messageHandlerResolver({
        client: this,
        configuration: this.configuration,
        request: this.currentRequest
      })

      const resolvedThenable = /** @type {{then?: Function}} */ (resolvedHandler)

      if (resolvedThenable?.then) {
        messageHandlerPromise = /** @type {Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>} */ (resolvedHandler)
      } else if (resolvedHandler) {
        messageHandler = /** @type {import("../../configuration-types.js").WebsocketMessageHandler} */ (resolvedHandler)
      }
    }

    this.websocketSession = new WebsocketSession({
      client: this,
      configuration: this.configuration,
      upgradeRequest: this.currentRequest,
      messageHandler: messageHandler,
      messageHandlerPromise: messageHandlerPromise
    })
    this.websocketSession.events.on("close", () => {
      this.websocketSession?.destroy()
      this.websocketSession = undefined
      this.events.emit("close")
    })
    this.state = "websocket"
    this.events.emit("output", response)
    void this.websocketSession.initializeChannel()
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
        const shouldCloseConnection = this.shouldCloseConnection(request)

        this.requestRunners.shift()
        this.sendResponse(requestRunner)
        if (this.currentRequest === request && this.state === "initial") this.currentRequest = undefined
        this.logger.debug(() => ["sendDoneRequests", {clientCount: this.clientCount, connectionHeader, httpVersion}])

        if (shouldCloseConnection) {
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
    const shouldCloseConnection = this.shouldCloseConnection(request)

    this.logger.debug("sendResponse", {clientCount: this.clientCount, connectionHeader, httpVersion})

    if (shouldCloseConnection) {
      response.setHeader("Connection", "Close")
    } else if (httpVersion == "1.0" && connectionHeader == "keep-alive") {
      response.setHeader("Connection", "Keep-Alive")
    }

    const contentLength = new TextEncoder().encode(body).length

    response.setHeader("Content-Length", contentLength)
    response.setHeader("Date", date.toUTCString())
    response.setHeader("Server", "Velocious")

    let headers = ""

    headers += `HTTP/${request.httpVersion()} ${response.getStatusCode()} ${response.getStatusMessage()}\r\n`

    for (const headerKey in response.headers) {
      for (const headerValue of response.headers[headerKey]) {
        headers += `${headerKey}: ${headerValue}\r\n`
      }
    }

    headers += "\r\n"

    this.events.emit("output", headers)
    this.events.emit("output", body)

    if ("getRequestParser" in request) {
      const httpRequest = /** @type {import("./request.js").default} */ (request)
      httpRequest.getRequestParser().destroy()
    }
  }

  /**
   * @param {import("./request.js").default | import("./websocket-request.js").default} request - Request object.
   * @returns {boolean} - Whether the connection should be closed.
   */
  shouldCloseConnection(request) {
    const httpVersion = request.httpVersion()
    const connectionHeader = request.header("connection")?.toLowerCase()?.trim()
    const connectionTokens = connectionHeader
      ? connectionHeader.split(",").map((token) => token.trim()).filter(Boolean)
      : []

    if (httpVersion == "websocket") return false
    if (connectionTokens.includes("close")) return true

    if (httpVersion == "1.0" && connectionHeader != "keep-alive") return true

    return false
  }
}
