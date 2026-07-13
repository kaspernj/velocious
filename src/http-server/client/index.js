// @ts-check

import crypto from "crypto"
import fs from "node:fs/promises"
import {digg} from "diggerize"
import {ensureError} from "typanic"
import EventEmitter from "../../utils/event-emitter.js"
import Logger from "../../logger.js"
import Request from "./request.js"
import RequestRunner from "./request-runner.js"
import WebsocketSession from "./websocket-session.js"

/**
 * Runs summarize request data.
 * @param {Buffer} data - Incoming request data.
 * @returns {{length: number, preview: string}} - Request data summary.
 */
function summarizeRequestData(data) {
  const preview = data.toString("latin1", 0, Math.min(data.length, 160)).replaceAll("\r", "\\r").replaceAll("\n", "\\n")

  return {length: data.length, preview}
}

/**
 * Runs bad request details.
 * @param {Error & {velociousContext?: Record<string, ?>}} error - Error instance.
 * @returns {Record<string, ?>} - Safe bad-request details for logs.
 */
function badRequestDetails(error) {
  return {
    errorClass: error.name,
    message: error.message,
    velociousContext: error.velociousContext
  }
}

export default class VeoliciousHttpServerClient {
  events = new EventEmitter()
  state = "initial"

  /**
   * Runs constructor.
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

    /**
     * Narrows the runtime value to the documented type.
     * @type {RequestRunner[]} */
    this.requestRunners = []

    /** @type {Set<(result: "completed" | "aborted") => Promise<void>>} */
    this.pendingFileResponses = new Set()
  }

  /**
   * Runs send bad upgrade response.
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
   * Runs send bad request response.
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
   * Runs handle bad request.
   * @param {Error} error - Error instance.
   * @returns {void} - No return value.
   */
  handleBadRequest(error) {
    this.logger.warn(() => ["Failed to parse HTTP request", badRequestDetails(/** @type {Error & {velociousContext?: Record<string, ?>}} */ (error))])

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

    const currentRequest = this.currentRequest

    if (!currentRequest) throw new Error("No current request")
    this.logger.debug(() => ["executeCurrentRequest request", {
      clientCount: this.clientCount,
      httpMethod: currentRequest.httpMethod(),
      httpVersion: currentRequest.httpVersion(),
      path: currentRequest.path(),
      queueLength: this.requestRunners.length
    }])

    if (this._isWebsocketUpgrade(currentRequest)) {
      this._upgradeToWebsocket()
      return
    }

    // We are done parsing the given request and can theoretically start parsing a new one, before the current request is done - so reset the state.
    this.state = "initial"

    const requestRunner = new RequestRunner({
      configuration: this.configuration,
      request: currentRequest
    })

    this.requestRunners.push(requestRunner)

    requestRunner.events.on("done", this.requestDone)
    requestRunner.run()
  }

  /**
   * Runs on write.
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
      /**
       * Remaining.
       * @type {Buffer | undefined} */
      let remaining = data

      while (remaining) {
        if (remaining.length <= 0) break

        if (this.state == "initial") {
          const remainingLength = remaining.length

          this.logger.debug(() => ["onWrite creating request parser", {clientCount: this.clientCount, remainingLength}])
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
            const remainingLength = remaining.length

            this.logger.debug(() => ["onWrite waiting for more data", {clientCount: this.clientCount, remainingLength}])
            break
          }

          this.state = "initial"
          const remainingLength = remaining.length

          this.logger.debug(() => ["onWrite parser completed with remaining bytes", {clientCount: this.clientCount, remainingLength}])
        }
      }
      this.logger.debug(() => ["onWrite end", {clientCount: this.clientCount, state: this.state, queueLength: this.requestRunners.length}])
    } catch (error) {
      this.handleBadRequest(ensureError(error))
    }
  }

  /**
   * Runs is websocket upgrade.
   * @param {import("./request.js").default} request - Request object.
   * @returns {boolean} - Whether websocket upgrade.
   */
  _isWebsocketUpgrade(request) {
    const upgradeHeader = request.header("upgrade")?.toLowerCase()
    const connectionHeader = request.header("connection")?.toLowerCase()

    return Boolean(upgradeHeader == "websocket" && connectionHeader?.includes("upgrade"))
  }

  /**
   * Runs upgrade to websocket.
   * @returns {void} - No return value.
   */
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

      const resolvedThenable = /** @type {{then?: (...args: Array<?>) => ?}} */ (resolvedHandler)

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
      // Paused sessions survive the socket close; don't destroy().
      // The grace-expiry path (_finalizeGraceExpiry) will destroy
      // them permanently if resume doesn't happen in time.
      if (!this.websocketSession?.isPaused()) {
        this.websocketSession?.destroy()
      }
      this.websocketSession = undefined
      this.events.emit("close")
    })
    this.state = "websocket"
    this.events.emit("output", response)
    void this.websocketSession.initializeChannel()
    this.websocketSession.sendSessionEstablished()
  }

  requestDone = () => {
    this.logger.debug(() => ["requestDone", {clientCount: this.clientCount, queueLength: this.requestRunners.length}])
    void this.sendDoneRequests().catch((error) => {
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
          this.logger.error(() => [`Velocious client ${this.clientCount} failed while sending response`, error])
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
   * Runs send response.
   * @param {RequestRunner} requestRunner - Request runner.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async sendResponse(requestRunner) {
    const response = digg(requestRunner, "response")
    const request = requestRunner.getRequest()
    const filePath = response.getFilePath()
    const fileOnFinished = response.getFileOnFinished()
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

    // Per RFC 7230 §3.3.3, responses with status codes 1xx, 204, and 304
    // MUST NOT carry a message body and MUST NOT include Content-Length
    // (with a narrow 304 exception we don't lean on). Sending one would
    // desynchronize keep-alive clients waiting for bytes that never
    // arrive — drop the body entirely for those codes.
    const isBodylessStatus = isNoBodyStatusCode(response.getStatusCode())

    if (!isBodylessStatus) {
      let contentLength

      if (hasFilePath) {
        const stats = await fs.stat(filePath)
        contentLength = stats.size
      } else {
        contentLength = bodyIsString ? new TextEncoder().encode(body).length : body.byteLength
      }

      response.setHeader("Content-Length", contentLength)
    }

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

    if (isBodylessStatus) {
      this.logger.debug(() => ["sendResponse body suppressed for no-body status", {clientCount: this.clientCount, statusCode: response.getStatusCode()}])
      if (hasFilePath) await this.sendFileOutput(filePath, false, fileOnFinished)
    } else if (hasFilePath) {
      await this.sendFileOutput(filePath, true, fileOnFinished)
    } else {
      this.events.emit("output", body)
      this.logger.debug(() => ["sendResponse body emitted", {clientCount: this.clientCount, bodyLength: bodyIsString ? body.length : body.byteLength}])
    }

    await requestRunner.logCompletedRequest()

    if ("getRequestParser" in request) {
      const httpRequest = /** @type {import("./request.js").default} */ (request)
      httpRequest.getRequestParser().destroy()
    }
  }

  /**
   * Runs send file output.
   * @param {string} filePath - File path.
   * @param {boolean} sendBody - Whether the file body should be sent.
   * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} onFinished - Completion callback.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async sendFileOutput(filePath, sendBody, onFinished) {
    this.logger.debug(() => ["sendFileOutput start", {clientCount: this.clientCount, filePath}])

    const result = await new Promise((resolve) => {
      /** @type {Promise<void> | null} */
      let settlement = null
      const settle = (/** @type {"completed" | "aborted"} */ transferResult) => {
        if (settlement) return settlement

        this.pendingFileResponses.delete(settle)
        settlement = this.runFileOnFinished({filePath, onFinished, result: transferResult})
          .finally(() => resolve(transferResult))

        return settlement
      }

      this.pendingFileResponses.add(settle)
      this.events.emit("file", {filePath, sendBody, settle})
    })

    this.logger.debug(() => ["sendFileOutput done", {clientCount: this.clientCount, filePath, result}])
  }

  /**
   * Runs a file completion callback without allowing cleanup failures to replace the committed response.
   * @param {object} args - Completion details.
   * @param {string} args.filePath - File path.
   * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} args.onFinished - Completion callback.
   * @param {"completed" | "aborted"} args.result - Transfer result.
   * @returns {Promise<void>} - Resolves after callback cleanup and error reporting finish.
   */
  async runFileOnFinished({filePath, onFinished, result}) {
    if (!onFinished) return

    try {
      await onFinished(result)
    } catch (caughtError) {
      const error = ensureError(caughtError)

      await this.logger.error(() => ["File response onFinished callback failed", {clientCount: this.clientCount, filePath, result}, error])

      const errorPayload = {
        context: {clientCount: this.clientCount, filePath, result, stage: "send-file-on-finished"},
        error
      }

      this.configuration.getErrorEvents().emit("framework-error", errorPayload)
      this.configuration.getErrorEvents().emit("all-error", {...errorPayload, errorType: "framework-error"})
    }
  }

  /**
   * Aborts all file responses awaiting transport acknowledgement.
   * @returns {Promise<void>} - Resolves after pending callbacks settle.
   */
  async abortPendingFileResponses() {
    await Promise.all([...this.pendingFileResponses].map((settle) => settle("aborted")))
  }

  /**
   * Runs should close connection.
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

/**
 * Returns true for the status codes that RFC 7230 §3.3.3 declares
 * cannot carry a message body: every 1xx informational, 204 No
 * Content, and 304 Not Modified.
 * @param {number} statusCode - HTTP status code.
 * @returns {boolean} - Whether the status code forbids a response body.
 */
function isNoBodyStatusCode(statusCode) {
  return (statusCode >= 100 && statusCode < 200) || statusCode === 204 || statusCode === 304
}
