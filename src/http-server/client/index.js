// @ts-check

import crypto from "crypto"
import fs from "node:fs/promises"
import {createReadStream} from "node:fs"
import {digg} from "diggerize"
import EventEmitter from "../../utils/event-emitter.js"
import ensureError from "../../utils/ensure-error.js"
import Logger from "../../logger.js"
import Request from "./request.js"
import RequestRunner from "./request-runner.js"
import WebsocketSession from "./websocket-session.js"

/**
 * @param {Buffer} data - Incoming request data.
 * @returns {{length: number, preview: string}} - Request data summary.
 */
function summarizeRequestData(data) {
  const preview = data.toString("latin1", 0, Math.min(data.length, 160)).replaceAll("\r", "\\r").replaceAll("\n", "\\n")

  return {length: data.length, preview}
}

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

  /**
   * @param {string} message - Response message.
   * @returns {void} - No return value.
   */
  _sendBadRequestResponse(message) {
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

  /**
   * @param {Error} error - Error instance.
   * @returns {void} - No return value.
   */
  handleBadRequest(error) {
    this.logger.warn(() => ["Failed to parse HTTP request", error])

    if (this.currentRequest && "getRequestParser" in this.currentRequest) {
      const httpRequest = /** @type {import("./request.js").default} */ (this.currentRequest)

      httpRequest.getRequestParser().destroy()
    }

    this.currentRequest = undefined
    this.state = "initial"

    this._sendBadRequestResponse("Bad Request")
  }

  executeCurrentRequest = () => {
    this.logger.debug("executeCurrentRequest")

    if (!this.currentRequest) throw new Error("No current request")
    this.logger.debug(() => ["executeCurrentRequest request", {
      clientCount: this.clientCount,
      httpMethod: this.currentRequest.httpMethod(),
      httpVersion: this.currentRequest.httpVersion(),
      path: this.currentRequest.path(),
      queueLength: this.requestRunners.length
    }])

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
    this.logger.debug(() => ["onWrite start", {
      clientCount: this.clientCount,
      state: this.state,
      ...summarizeRequestData(data)
    }])

    if (this.websocketSession) {
      this.websocketSession.onData(data)
      return
    }

    try {
      /** @type {Buffer | undefined} */
      let remaining = data

      while (remaining && remaining.length > 0) {
        if (this.state == "initial") {
          this.logger.debug(() => ["onWrite creating request parser", {clientCount: this.clientCount, remainingLength: remaining.length}])
          this.currentRequest = new Request({client: this, configuration: this.configuration})
          this.currentRequest.requestParser.events.on("done", this.executeCurrentRequest)
          this.state = "requestStarted"
        } else if (this.state != "requestStarted") {
          throw new Error(`Unknown state for client: ${this.state}`)
        }

        if (!this.currentRequest) throw new Error("No current request")

        remaining = this.currentRequest.feed(remaining)
        this.logger.debug(() => ["onWrite fed parser", {
          clientCount: this.clientCount,
          hasRemaining: Boolean(remaining?.length),
          remainingLength: remaining?.length || 0,
          parserCompleted: this.currentRequest?.getRequestParser().hasCompleted
        }])

        if (remaining && remaining.length > 0) {
          const requestParser = this.currentRequest.getRequestParser()

          if (!requestParser.hasCompleted) {
            this.logger.debug(() => ["onWrite waiting for more data", {clientCount: this.clientCount, remainingLength: remaining.length}])
            break
          }

          this.state = "initial"
          this.logger.debug(() => ["onWrite parser completed with remaining bytes", {clientCount: this.clientCount, remainingLength: remaining.length}])
        }
      }
      this.logger.debug(() => ["onWrite end", {clientCount: this.clientCount, state: this.state, queueLength: this.requestRunners.length}])
    } catch (error) {
      this.handleBadRequest(ensureError(error))
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

      const resolvedThenable = /** @type {{then?: (...args: unknown[]) => unknown}} */ (resolvedHandler)

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
    this.logger.debug(() => ["requestDone", {clientCount: this.clientCount, queueLength: this.requestRunners.length}])
    void this.sendDoneRequests().catch((error) => {
      console.error(`Velocious client ${this.clientCount} failed in sendDoneRequests`, error)
      this.logger.warn("Failed while sending done requests", error)
      this.events.emit("close")
    })
  }

  async sendDoneRequests() {
    while (true) {
      const requestRunner = this.requestRunners[0]
      const request = requestRunner?.getRequest()

      if (requestRunner?.getState() == "done") {
        const httpVersion = request.httpVersion()
        const connectionHeader = request.header("connection")?.toLowerCase()?.trim()
        const shouldCloseConnection = this.shouldCloseConnection(request)

        this.requestRunners.shift()
        this.logger.debug(() => ["sendDoneRequests shifted queue", {clientCount: this.clientCount, queueLength: this.requestRunners.length}])
        try {
          await this.sendResponse(requestRunner)
        } catch (error) {
          console.error(`Velocious client ${this.clientCount} failed while sending response`, error)
          throw error
        }
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
   * @returns {Promise<void>} - Resolves when complete.
   */
  async sendResponse(requestRunner) {
    const response = digg(requestRunner, "response")
    const request = requestRunner.getRequest()
    const filePath = response.getFilePath()
    const date = new Date()
    const connectionHeader = request.header("connection")?.toLowerCase()?.trim()
    const httpVersion = request.httpVersion()
    const shouldCloseConnection = this.shouldCloseConnection(request)
    const hasFilePath = typeof filePath === "string" && filePath.length > 0
    const body = hasFilePath ? null : response.getBody()
    const bodyIsString = typeof body === "string"
    const bodyIsBinary = body instanceof Uint8Array

    if (!hasFilePath && !bodyIsString && !bodyIsBinary) {
      throw new Error(`Expected response body to be a string or Uint8Array, got ${typeof body}`)
    }

    this.logger.debug("sendResponse", {clientCount: this.clientCount, connectionHeader, httpVersion})
    this.logger.debug(() => ["sendResponse payload", {
      clientCount: this.clientCount,
      hasFilePath,
      filePath,
      bodyIsBinary,
      bodyIsString
    }])

    if (shouldCloseConnection) {
      response.setHeader("Connection", "Close")
    } else if (httpVersion == "1.0" && connectionHeader == "keep-alive") {
      response.setHeader("Connection", "Keep-Alive")
    }

    let contentLength

    if (hasFilePath) {
      const stats = await fs.stat(filePath)
      contentLength = stats.size
    } else {
      contentLength = bodyIsString ? new TextEncoder().encode(body).length : body.byteLength
    }

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
    this.logger.debug(() => ["sendResponse headers emitted", {clientCount: this.clientCount, headersLength: headers.length}])

    if (hasFilePath) {
      await this.sendFileOutput(filePath)
    } else {
      this.events.emit("output", body)
      this.logger.debug(() => ["sendResponse body emitted", {clientCount: this.clientCount, bodyLength: bodyIsString ? body.length : body.byteLength}])
    }

    if ("getRequestParser" in request) {
      const httpRequest = /** @type {import("./request.js").default} */ (request)
      httpRequest.getRequestParser().destroy()
    }
  }

  /**
   * @param {string} filePath - File path.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async sendFileOutput(filePath) {
    this.logger.debug(() => ["sendFileOutput start", {clientCount: this.clientCount, filePath}])
    let totalBytes = 0
    let chunkCount = 0

    try {
      for await (const chunk of createReadStream(filePath)) {
        chunkCount += 1
        totalBytes += chunk.length
        this.logger.debug(() => ["sendFileOutput chunk", {clientCount: this.clientCount, chunkCount, chunkLength: chunk.length, totalBytes}])
        this.events.emit("output", chunk)
      }
      this.logger.debug(() => ["sendFileOutput done", {clientCount: this.clientCount, chunkCount, totalBytes}])
    } catch (error) {
      console.error(`Velocious client ${this.clientCount} failed while streaming file output: ${filePath}`, error)
      throw error
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
