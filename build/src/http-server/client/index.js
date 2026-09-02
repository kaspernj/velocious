// @ts-check
import crypto from "crypto";
import fs from "node:fs/promises";
import { digg } from "diggerize";
import { ensureError } from "typanic";
import EventEmitter from "../../utils/event-emitter.js";
import Logger from "../../logger.js";
import Request from "./request.js";
import RequestRunner from "./request-runner.js";
import { applyResponseCompression } from "./response-compression.js";
import WebsocketSession from "./websocket-session.js";
/**
 * Runs bad request details.
 * @param {Error & {velociousContext?: Record<string, ReturnType<typeof JSON.parse>>}} error - Error instance.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Safe bad-request details for logs.
 */
function badRequestDetails(error) {
    return {
        errorClass: error.name,
        message: error.message,
        velociousContext: error.velociousContext
    };
}
export default class VeoliciousHttpServerClient {
    events = new EventEmitter();
    state = "initial";
    /**
     * Whether a done-requests drain is currently sending responses for this client.
     * @type {boolean} */
    _doneRequestsDrainActive = false;
    /**
     * Whether another drain was requested while one was already active.
     * @type {boolean} */
    _doneRequestsDrainPending = false;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {number} args.clientCount - Client count.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} [args.remoteAddress] - Remote address.
     */
    constructor({ clientCount, configuration, remoteAddress }) {
        if (!configuration)
            throw new Error("No configuration given");
        this.logger = new Logger(this);
        this.clientCount = clientCount;
        this.configuration = configuration;
        this.remoteAddress = remoteAddress;
        /**
         * Narrows the runtime value to the documented type.
         * @type {RequestRunner[]} */
        this.requestRunners = [];
        /** @type {Set<(result: "completed" | "aborted") => Promise<void>>} */
        this.pendingFileResponses = new Set();
    }
    /**
     * Runs send bad upgrade response.
     * @param {string} message - Message text.
     * @returns {void} - No return value.
     */
    _sendBadUpgradeResponse(message) {
        const httpVersion = this.currentRequest?.httpVersion() || "1.1";
        const body = `${message}\n`;
        const headers = [
            `HTTP/${httpVersion} 400 Bad Request`,
            "Connection: Close",
            "Content-Type: text/plain; charset=UTF-8",
            `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
            "",
            body
        ].join("\r\n");
        this.events.emit("output", headers);
        this.events.emit("close");
    }
    /**
     * Runs send bad request response.
     * @param {string} message - Response message.
     * @returns {void} - No return value.
     */
    _sendBadRequestResponse(message) {
        const httpVersion = this.currentRequest?.httpVersion() || "1.1";
        const body = `${message}\n`;
        const headers = [
            `HTTP/${httpVersion} 400 Bad Request`,
            "Connection: Close",
            "Content-Type: text/plain; charset=UTF-8",
            `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
            "",
            body
        ].join("\r\n");
        this.events.emit("output", headers);
        this.events.emit("close");
    }
    /**
     * Runs handle bad request.
     * @param {Error} error - Error instance.
     * @returns {void} - No return value.
     */
    handleBadRequest(error) {
        this.logger.warn(() => ["Failed to parse HTTP request", badRequestDetails(/** @type {Error & {velociousContext?: Record<string, ReturnType<typeof JSON.parse>>}} */ (error))]);
        if (this.currentRequest && "getRequestParser" in this.currentRequest) {
            const httpRequest = /** @type {import("./request.js").default} */ (this.currentRequest);
            httpRequest.getRequestParser().destroy();
        }
        this.currentRequest = undefined;
        this.state = "initial";
        this._sendBadRequestResponse("Bad Request");
    }
    executeCurrentRequest = () => {
        this.logger.debug("executeCurrentRequest");
        const currentRequest = this.currentRequest;
        if (!currentRequest)
            throw new Error("No current request");
        const redactor = this.configuration.getLogRedactor();
        const sensitiveValues = redactor.requestSensitiveValues(currentRequest);
        this.logger.debug(() => ["executeCurrentRequest request", {
                clientCount: this.clientCount,
                httpMethod: currentRequest.httpMethod(),
                httpVersion: currentRequest.httpVersion(),
                path: redactor.redactPath(currentRequest.path(), sensitiveValues),
                queueLength: this.requestRunners.length
            }]);
        if (this._isWebsocketUpgrade(currentRequest)) {
            this._upgradeToWebsocket();
            return;
        }
        // We are done parsing the given request and can theoretically start parsing a new one, before the current request is done - so reset the state.
        this.state = "initial";
        const requestRunner = new RequestRunner({
            configuration: this.configuration,
            request: currentRequest
        });
        this.requestRunners.push(requestRunner);
        requestRunner.events.on("done", this.requestDone);
        requestRunner.run();
    };
    /**
     * Runs on write.
     * @param {Buffer} data - Data payload.
     * @returns {void} - No return value.
     */
    onWrite(data) {
        this.logger.debug(() => ["onWrite start", {
                clientCount: this.clientCount,
                length: data.length,
                state: this.state,
            }]);
        if (this.websocketSession) {
            this.websocketSession.onData(data);
            return;
        }
        try {
            /**
             * Remaining.
             * @type {Buffer | undefined} */
            let remaining = data;
            while (remaining) {
                if (remaining.length <= 0)
                    break;
                if (this.state == "initial") {
                    const remainingLength = remaining.length;
                    this.logger.debug(() => ["onWrite creating request parser", { clientCount: this.clientCount, remainingLength }]);
                    this.currentRequest = new Request({ client: this, configuration: this.configuration });
                    this.currentRequest.requestParser.events.on("done", this.executeCurrentRequest);
                    this.state = "requestStarted";
                }
                else if (this.state != "requestStarted") {
                    throw new Error(`Unknown state for client: ${this.state}`);
                }
                if (!this.currentRequest)
                    throw new Error("No current request");
                remaining = this.currentRequest.feed(remaining);
                this.logger.debug(() => ["onWrite fed parser", {
                        clientCount: this.clientCount,
                        hasRemaining: Boolean(remaining?.length),
                        remainingLength: remaining?.length || 0,
                        parserCompleted: this.currentRequest?.getRequestParser().hasCompleted
                    }]);
                if (remaining && remaining.length > 0) {
                    const requestParser = this.currentRequest.getRequestParser();
                    if (!requestParser.hasCompleted) {
                        const remainingLength = remaining.length;
                        this.logger.debug(() => ["onWrite waiting for more data", { clientCount: this.clientCount, remainingLength }]);
                        break;
                    }
                    this.state = "initial";
                    const remainingLength = remaining.length;
                    this.logger.debug(() => ["onWrite parser completed with remaining bytes", { clientCount: this.clientCount, remainingLength }]);
                }
            }
            this.logger.debug(() => ["onWrite end", { clientCount: this.clientCount, state: this.state, queueLength: this.requestRunners.length }]);
        }
        catch (error) {
            this.handleBadRequest(ensureError(error));
        }
    }
    /**
     * Runs is websocket upgrade.
     * @param {import("./request.js").default} request - Request object.
     * @returns {boolean} - Whether websocket upgrade.
     */
    _isWebsocketUpgrade(request) {
        const upgradeHeader = request.header("upgrade")?.toLowerCase();
        const connectionHeader = request.header("connection")?.toLowerCase();
        return Boolean(upgradeHeader == "websocket" && connectionHeader?.includes("upgrade"));
    }
    /**
     * Runs upgrade to websocket.
     * @returns {void} - No return value.
     */
    _upgradeToWebsocket() {
        if (!this.currentRequest)
            throw new Error("No current request");
        const secWebsocketKey = this.currentRequest.header("sec-websocket-key");
        if (!secWebsocketKey) {
            this._sendBadUpgradeResponse("Missing Sec-WebSocket-Key header");
            return;
        }
        const websocketAcceptKey = crypto.createHash("sha1")
            .update(`${secWebsocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, "binary")
            .digest("base64");
        const httpVersion = this.currentRequest.httpVersion() || "1.1";
        const responseLines = [
            `HTTP/${httpVersion} 101 Switching Protocols`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${websocketAcceptKey}`,
            "",
            ""
        ];
        const response = responseLines.join("\r\n");
        const messageHandlerResolver = this.configuration.getWebsocketMessageHandlerResolver?.();
        let messageHandler;
        let messageHandlerPromise;
        if (messageHandlerResolver) {
            const resolvedHandler = messageHandlerResolver({
                client: this,
                configuration: this.configuration,
                request: this.currentRequest
            });
            const resolvedThenable = /** @type {{then?: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>}} */ (resolvedHandler);
            if (resolvedThenable?.then) {
                messageHandlerPromise = /** @type {Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>} */ (resolvedHandler);
            }
            else if (resolvedHandler) {
                messageHandler = /** @type {import("../../configuration-types.js").WebsocketMessageHandler} */ (resolvedHandler);
            }
        }
        this.websocketSession = new WebsocketSession({
            client: this,
            configuration: this.configuration,
            upgradeRequest: this.currentRequest,
            messageHandler: messageHandler,
            messageHandlerPromise: messageHandlerPromise
        });
        this.websocketSession.events.on("close", () => {
            // Paused sessions survive the socket close; don't destroy().
            // The grace-expiry path (_finalizeGraceExpiry) will destroy
            // them permanently if resume doesn't happen in time.
            if (!this.websocketSession?.isPaused()) {
                this.websocketSession?.destroy();
            }
            this.websocketSession = undefined;
            this.events.emit("close");
        });
        this.websocketSession.events.on("ownershipClaimed", ({ sessionId }) => {
            this.events.emit("websocketSessionOwned", { sessionId });
        });
        this.websocketSession.events.on("ownershipReleased", ({ sessionId }) => {
            this.events.emit("websocketSessionReleased", { sessionId });
        });
        this.state = "websocket";
        this.events.emit("output", response);
        void this.websocketSession.initializeChannel();
        this.websocketSession.sendSessionEstablished();
    }
    requestDone = () => {
        this.logger.debug(() => ["requestDone", { clientCount: this.clientCount, queueLength: this.requestRunners.length }]);
        return this._drainDoneRequests().catch((error) => {
            this.logger.warn("Failed while sending done requests", error);
            this.events.emit("close");
        });
    };
    /**
     * Drains done requests one at a time. A runner is shifted out of the queue before
     * its response finishes sending (async compression, file transfer), so an
     * overlapping drain would otherwise pick up the next runner and reorder pipelined
     * socket writes. Calls that arrive while a drain is active are folded into it.
     * @returns {Promise<void>} - Resolves when every done response has been sent.
     */
    async _drainDoneRequests() {
        if (this._doneRequestsDrainActive) {
            this._doneRequestsDrainPending = true;
            return;
        }
        this._doneRequestsDrainActive = true;
        try {
            do {
                this._doneRequestsDrainPending = false;
                await this.sendDoneRequests();
            } while (this._doneRequestsDrainPending);
        }
        finally {
            this._doneRequestsDrainActive = false;
        }
    }
    async sendDoneRequests() {
        while (true) {
            const requestRunner = this.requestRunners[0];
            const request = requestRunner?.getRequest();
            if (requestRunner?.getState() == "done") {
                const httpVersion = request.httpVersion();
                const connectionHeader = request.header("connection")?.toLowerCase()?.trim();
                const shouldCloseConnection = this.shouldCloseConnection(request);
                this.requestRunners.shift();
                this.logger.debug(() => ["sendDoneRequests shifted queue", { clientCount: this.clientCount, queueLength: this.requestRunners.length }]);
                try {
                    await this.sendResponse(requestRunner);
                }
                catch (error) {
                    this.logger.error(() => [`Velocious client ${this.clientCount} failed while sending response`, error]);
                    throw error;
                }
                if (this.currentRequest === request && this.state === "initial")
                    this.currentRequest = undefined;
                this.logger.debug(() => ["sendDoneRequests", { clientCount: this.clientCount, connectionHeader, httpVersion }]);
                if (shouldCloseConnection) {
                    this.logger.debug(() => [`Closing the connection because ${httpVersion} and connection header ${connectionHeader}`, { clientCount: this.clientCount }]);
                    this.events.emit("close");
                }
            }
            else {
                break;
            }
        }
    }
    /**
     * Runs send response.
     * @param {RequestRunner} requestRunner - Request runner.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async sendResponse(requestRunner) {
        const response = digg(requestRunner, "response");
        const request = requestRunner.getRequest();
        const filePath = response.getFilePath();
        const fileOnFinished = response.getFileOnFinished();
        const date = new Date();
        const connectionHeader = request.header("connection")?.toLowerCase()?.trim();
        const httpVersion = request.httpVersion();
        const shouldCloseConnection = this.shouldCloseConnection(request);
        const hasFilePath = typeof filePath === "string" && filePath.length > 0;
        const body = hasFilePath ? null : response.getBody();
        const bodyIsString = typeof body === "string";
        const bodyIsBinary = body instanceof Uint8Array;
        if (!hasFilePath && !bodyIsString && !bodyIsBinary) {
            throw new Error(`Expected response body to be a string or Uint8Array, got ${typeof body}`);
        }
        this.logger.debug("sendResponse", { clientCount: this.clientCount, connectionHeader, httpVersion });
        this.logger.debug(() => ["sendResponse payload", {
                clientCount: this.clientCount,
                hasFilePath,
                filePath,
                bodyIsBinary,
                bodyIsString
            }]);
        if (shouldCloseConnection) {
            response.setHeader("Connection", "Close");
        }
        else if (httpVersion == "1.0" && connectionHeader == "keep-alive") {
            response.setHeader("Connection", "Keep-Alive");
        }
        // Per RFC 7230 §3.3.3, responses with status codes 1xx, 204, and 304
        // MUST NOT carry a message body and MUST NOT include Content-Length
        // (with a narrow 304 exception we don't lean on). Sending one would
        // desynchronize keep-alive clients waiting for bytes that never
        // arrive — drop the body entirely for those codes.
        const isBodylessStatus = isNoBodyStatusCode(response.getStatusCode());
        // HEAD responses select and compute the exact same representation headers as the
        // equivalent GET (including Content-Length and any negotiated Content-Encoding),
        // but no buffered or file body is emitted below.
        const isHeadRequest = request.httpMethod() == "HEAD";
        /** @type {string | Uint8Array | null} */
        let bodyToEmit = body;
        if (!isBodylessStatus) {
            let contentLength;
            if (hasFilePath) {
                const stats = await fs.stat(filePath);
                contentLength = stats.size;
            }
            else {
                // String bodies are UTF-8 framed, so the buffered bytes are the UTF-8 encoding;
                // Uint8Array bodies are already the exact wire bytes.
                const bodyBuffer = bodyIsString ? Buffer.from(body, "utf8") : Buffer.from(body);
                const compressionResult = await applyResponseCompression({
                    bodyBuffer,
                    compression: this.configuration.getHttpServerCompression(),
                    request,
                    response
                });
                if (compressionResult.outcome == "not-acceptable") {
                    // The client forbids identity and no supported coding is acceptable: answer
                    // with an empty 406 instead of an unacceptable representation.
                    response.setStatus(406);
                    response.setBody("");
                    bodyToEmit = "";
                    contentLength = 0;
                }
                else if (compressionResult.outcome == "compressed") {
                    bodyToEmit = compressionResult.body;
                    contentLength = compressionResult.body.length;
                }
                else {
                    contentLength = bodyBuffer.length;
                }
            }
            // Remove any application pre-set Content-Length (any casing) so exactly one
            // recomputed value goes on the wire.
            response.removeHeader("Content-Length");
            response.setHeader("Content-Length", contentLength);
        }
        response.setHeader("Date", date.toUTCString());
        response.setHeader("Server", "Velocious");
        let headers = "";
        headers += `HTTP/${request.httpVersion()} ${response.getStatusCode()} ${response.getStatusMessage()}\r\n`;
        for (const headerKey in response.headers) {
            for (const headerValue of response.headers[headerKey]) {
                headers += `${headerKey}: ${headerValue}\r\n`;
            }
        }
        headers += "\r\n";
        this.events.emit("output", headers);
        this.logger.debug(() => ["sendResponse headers emitted", { clientCount: this.clientCount, headersLength: headers.length }]);
        if (isBodylessStatus) {
            this.logger.debug(() => ["sendResponse body suppressed for no-body status", { clientCount: this.clientCount, statusCode: response.getStatusCode() }]);
            if (hasFilePath)
                await this.sendFileOutput(filePath, false, fileOnFinished);
        }
        else if (isHeadRequest) {
            this.logger.debug(() => ["sendResponse body suppressed for HEAD request", { clientCount: this.clientCount }]);
            if (hasFilePath)
                await this.sendFileOutput(filePath, false, fileOnFinished);
        }
        else if (hasFilePath) {
            await this.sendFileOutput(filePath, true, fileOnFinished);
        }
        else {
            this.events.emit("output", bodyToEmit);
            this.logger.debug(() => ["sendResponse body emitted", { clientCount: this.clientCount, bodyLength: bodyToEmit ? bodyToEmit.length : 0 }]);
        }
        await requestRunner.logCompletedRequest();
        if ("getRequestParser" in request) {
            const httpRequest = /** @type {import("./request.js").default} */ (request);
            httpRequest.getRequestParser().destroy();
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
        this.logger.debug(() => ["sendFileOutput start", { clientCount: this.clientCount, filePath }]);
        const result = await new Promise((resolve) => {
            /** @type {Promise<void> | null} */
            let settlement = null;
            const settle = (/** @type {"completed" | "aborted"} */ transferResult) => {
                if (settlement)
                    return settlement;
                this.pendingFileResponses.delete(settle);
                settlement = this.runFileOnFinished({ filePath, onFinished, result: transferResult })
                    .finally(() => resolve(transferResult));
                return settlement;
            };
            this.pendingFileResponses.add(settle);
            this.events.emit("file", { filePath, sendBody, settle });
        });
        this.logger.debug(() => ["sendFileOutput done", { clientCount: this.clientCount, filePath, result }]);
    }
    /**
     * Runs a file completion callback without allowing cleanup failures to replace the committed response.
     * @param {object} args - Completion details.
     * @param {string} args.filePath - File path.
     * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} args.onFinished - Completion callback.
     * @param {"completed" | "aborted"} args.result - Transfer result.
     * @returns {Promise<void>} - Resolves after callback cleanup and error reporting finish.
     */
    async runFileOnFinished({ filePath, onFinished, result }) {
        if (!onFinished)
            return;
        try {
            await onFinished(result);
        }
        catch (caughtError) {
            const error = ensureError(caughtError);
            await this.logger.error(() => ["File response onFinished callback failed", { clientCount: this.clientCount, filePath, result }, error]);
            const errorPayload = {
                context: { clientCount: this.clientCount, filePath, result, stage: "send-file-on-finished" },
                error
            };
            this.configuration.getErrorEvents().emit("framework-error", errorPayload);
            this.configuration.getErrorEvents().emit("all-error", { ...errorPayload, errorType: "framework-error" });
        }
    }
    /**
     * Aborts all file responses awaiting transport acknowledgement.
     * @returns {Promise<void>} - Resolves after pending callbacks settle.
     */
    async abortPendingFileResponses() {
        await Promise.all([...this.pendingFileResponses].map((settle) => settle("aborted")));
    }
    /**
     * Runs should close connection.
     * @param {import("./request.js").default | import("./websocket-request.js").default} request - Request object.
     * @returns {boolean} - Whether the connection should be closed.
     */
    shouldCloseConnection(request) {
        const httpVersion = request.httpVersion();
        const connectionHeader = request.header("connection")?.toLowerCase()?.trim();
        const connectionTokens = connectionHeader
            ? connectionHeader.split(",").map((token) => token.trim()).filter(Boolean)
            : [];
        if (httpVersion == "websocket")
            return false;
        if (connectionTokens.includes("close"))
            return true;
        if (httpVersion == "1.0" && connectionHeader != "keep-alive")
            return true;
        return false;
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
    return (statusCode >= 100 && statusCode < 200) || statusCode === 204 || statusCode === 304;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUE7QUFDM0IsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sT0FBTyxNQUFNLGNBQWMsQ0FBQTtBQUNsQyxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLEVBQUMsd0JBQXdCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUNsRSxPQUFPLGdCQUFnQixNQUFNLHdCQUF3QixDQUFBO0FBRXJEOzs7O0dBSUc7QUFDSCxTQUFTLGlCQUFpQixDQUFDLEtBQUs7SUFDOUIsT0FBTztRQUNMLFVBQVUsRUFBRSxLQUFLLENBQUMsSUFBSTtRQUN0QixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87UUFDdEIsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLGdCQUFnQjtLQUN6QyxDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sMEJBQTBCO0lBQzdDLE1BQU0sR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFBO0lBQzNCLEtBQUssR0FBRyxTQUFTLENBQUE7SUFFakI7O3lCQUVxQjtJQUNyQix3QkFBd0IsR0FBRyxLQUFLLENBQUE7SUFFaEM7O3lCQUVxQjtJQUNyQix5QkFBeUIsR0FBRyxLQUFLLENBQUE7SUFFakM7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLFdBQVcsRUFBRSxhQUFhLEVBQUUsYUFBYSxFQUFD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QUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFBO1FBQzVFLE1BQU0sZ0JBQWdCLEdBQUcsZ0JBQWdCO1lBQ3ZDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDO1lBQzFFLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFTixJQUFJLFdBQVcsSUFBSSxXQUFXO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFDNUMsSUFBSSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFbkQsSUFBSSxXQUFXLElBQUksS0FBSyxJQUFJLGdCQUFnQixJQUFJLFlBQVk7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV6RSxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7Q0FDRjtBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsa0JBQWtCLENBQUMsVUFBVTtJQUNwQyxPQUFPLENBQUMsVUFBVSxJQUFJLEdBQUcsSUFBSSxVQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksVUFBVSxLQUFLLEdBQUcsSUFBSSxVQUFVLEtBQUssR0FBRyxDQUFBO0FBQzVGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IHtlbnN1cmVFcnJvcn0gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFJlcXVlc3QgZnJvbSBcIi4vcmVxdWVzdC5qc1wiXG5pbXBvcnQgUmVxdWVzdFJ1bm5lciBmcm9tIFwiLi9yZXF1ZXN0LXJ1bm5lci5qc1wiXG5pbXBvcnQge2FwcGx5UmVzcG9uc2VDb21wcmVzc2lvbn0gZnJvbSBcIi4vcmVzcG9uc2UtY29tcHJlc3Npb24uanNcIlxuaW1wb3J0IFdlYnNvY2tldFNlc3Npb24gZnJvbSBcIi4vd2Vic29ja2V0LXNlc3Npb24uanNcIlxuXG4vKipcbiAqIFJ1bnMgYmFkIHJlcXVlc3QgZGV0YWlscy5cbiAqIEBwYXJhbSB7RXJyb3IgJiB7dmVsb2Npb3VzQ29udGV4dD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNhZmUgYmFkLXJlcXVlc3QgZGV0YWlscyBmb3IgbG9ncy5cbiAqL1xuZnVuY3Rpb24gYmFkUmVxdWVzdERldGFpbHMoZXJyb3IpIHtcbiAgcmV0dXJuIHtcbiAgICBlcnJvckNsYXNzOiBlcnJvci5uYW1lLFxuICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgdmVsb2Npb3VzQ29udGV4dDogZXJyb3IudmVsb2Npb3VzQ29udGV4dFxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlb2xpY2lvdXNIdHRwU2VydmVyQ2xpZW50IHtcbiAgZXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG4gIHN0YXRlID0gXCJpbml0aWFsXCJcblxuICAvKipcbiAgICogV2hldGhlciBhIGRvbmUtcmVxdWVzdHMgZHJhaW4gaXMgY3VycmVudGx5IHNlbmRpbmcgcmVzcG9uc2VzIGZvciB0aGlzIGNsaWVudC5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW5vdGhlciBkcmFpbiB3YXMgcmVxdWVzdGVkIHdoaWxlIG9uZSB3YXMgYWxyZWFkeSBhY3RpdmUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfZG9uZVJlcXVlc3RzRHJhaW5QZW5kaW5nID0gZmFsc2VcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY2xpZW50Q291bnQgLSBDbGllbnQgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucmVtb3RlQWRkcmVzc10gLSBSZW1vdGUgYWRkcmVzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbGllbnRDb3VudCwgY29uZmlndXJhdGlvbiwgcmVtb3RlQWRkcmVzc30pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuY2xpZW50Q291bnQgPSBjbGllbnRDb3VudFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlbW90ZUFkZHJlc3MgPSByZW1vdGVBZGRyZXNzXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlcXVlc3RSdW5uZXJbXX0gKi9cbiAgICB0aGlzLnJlcXVlc3RSdW5uZXJzID0gW11cblxuICAgIC8qKiBAdHlwZSB7U2V0PChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlcyA9IG5ldyBTZXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBiYWQgdXBncmFkZSByZXNwb25zZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBNZXNzYWdlIHRleHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZW5kQmFkVXBncmFkZVJlc3BvbnNlKG1lc3NhZ2UpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3Q/Lmh0dHBWZXJzaW9uKCkgfHwgXCIxLjFcIlxuICAgIGNvbnN0IGJvZHkgPSBgJHttZXNzYWdlfVxcbmBcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgYEhUVFAvJHtodHRwVmVyc2lvbn0gNDAwIEJhZCBSZXF1ZXN0YCxcbiAgICAgIFwiQ29ubmVjdGlvbjogQ2xvc2VcIixcbiAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PVVURi04XCIsXG4gICAgICBgQ29udGVudC1MZW5ndGg6ICR7QnVmZmVyLmJ5dGVMZW5ndGgoYm9keSwgXCJ1dGY4XCIpfWAsXG4gICAgICBcIlwiLFxuICAgICAgYm9keVxuICAgIF0uam9pbihcIlxcclxcblwiKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBiYWQgcmVxdWVzdCByZXNwb25zZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBSZXNwb25zZSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2VuZEJhZFJlcXVlc3RSZXNwb25zZShtZXNzYWdlKSB7XG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSB0aGlzLmN1cnJlbnRSZXF1ZXN0Py5odHRwVmVyc2lvbigpIHx8IFwiMS4xXCJcbiAgICBjb25zdCBib2R5ID0gYCR7bWVzc2FnZX1cXG5gXG4gICAgY29uc3QgaGVhZGVycyA9IFtcbiAgICAgIGBIVFRQLyR7aHR0cFZlcnNpb259IDQwMCBCYWQgUmVxdWVzdGAsXG4gICAgICBcIkNvbm5lY3Rpb246IENsb3NlXCIsXG4gICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpbjsgY2hhcnNldD1VVEYtOFwiLFxuICAgICAgYENvbnRlbnQtTGVuZ3RoOiAke0J1ZmZlci5ieXRlTGVuZ3RoKGJvZHksIFwidXRmOFwiKX1gLFxuICAgICAgXCJcIixcbiAgICAgIGJvZHlcbiAgICBdLmpvaW4oXCJcXHJcXG5cIilcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgaGVhZGVycylcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBiYWQgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgaGFuZGxlQmFkUmVxdWVzdChlcnJvcikge1xuICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIHBhcnNlIEhUVFAgcmVxdWVzdFwiLCBiYWRSZXF1ZXN0RGV0YWlscygvKiogQHR5cGUge0Vycm9yICYge3ZlbG9jaW91c0NvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqLyAoZXJyb3IpKV0pXG5cbiAgICBpZiAodGhpcy5jdXJyZW50UmVxdWVzdCAmJiBcImdldFJlcXVlc3RQYXJzZXJcIiBpbiB0aGlzLmN1cnJlbnRSZXF1ZXN0KSB7XG4gICAgICBjb25zdCBodHRwUmVxdWVzdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLmN1cnJlbnRSZXF1ZXN0KVxuXG4gICAgICBodHRwUmVxdWVzdC5nZXRSZXF1ZXN0UGFyc2VyKCkuZGVzdHJveSgpXG4gICAgfVxuXG4gICAgdGhpcy5jdXJyZW50UmVxdWVzdCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuc3RhdGUgPSBcImluaXRpYWxcIlxuXG4gICAgdGhpcy5fc2VuZEJhZFJlcXVlc3RSZXNwb25zZShcIkJhZCBSZXF1ZXN0XCIpXG4gIH1cblxuICBleGVjdXRlQ3VycmVudFJlcXVlc3QgPSAoKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoXCJleGVjdXRlQ3VycmVudFJlcXVlc3RcIilcblxuICAgIGNvbnN0IGN1cnJlbnRSZXF1ZXN0ID0gdGhpcy5jdXJyZW50UmVxdWVzdFxuXG4gICAgaWYgKCFjdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG4gICAgY29uc3QgcmVkYWN0b3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnJlcXVlc3RTZW5zaXRpdmVWYWx1ZXMoY3VycmVudFJlcXVlc3QpXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJleGVjdXRlQ3VycmVudFJlcXVlc3QgcmVxdWVzdFwiLCB7XG4gICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgIGh0dHBNZXRob2Q6IGN1cnJlbnRSZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgIGh0dHBWZXJzaW9uOiBjdXJyZW50UmVxdWVzdC5odHRwVmVyc2lvbigpLFxuICAgICAgcGF0aDogcmVkYWN0b3IucmVkYWN0UGF0aChjdXJyZW50UmVxdWVzdC5wYXRoKCksIHNlbnNpdGl2ZVZhbHVlcyksXG4gICAgICBxdWV1ZUxlbmd0aDogdGhpcy5yZXF1ZXN0UnVubmVycy5sZW5ndGhcbiAgICB9XSlcblxuICAgIGlmICh0aGlzLl9pc1dlYnNvY2tldFVwZ3JhZGUoY3VycmVudFJlcXVlc3QpKSB7XG4gICAgICB0aGlzLl91cGdyYWRlVG9XZWJzb2NrZXQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gV2UgYXJlIGRvbmUgcGFyc2luZyB0aGUgZ2l2ZW4gcmVxdWVzdCBhbmQgY2FuIHRoZW9yZXRpY2FsbHkgc3RhcnQgcGFyc2luZyBhIG5ldyBvbmUsIGJlZm9yZSB0aGUgY3VycmVudCByZXF1ZXN0IGlzIGRvbmUgLSBzbyByZXNldCB0aGUgc3RhdGUuXG4gICAgdGhpcy5zdGF0ZSA9IFwiaW5pdGlhbFwiXG5cbiAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gbmV3IFJlcXVlc3RSdW5uZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgcmVxdWVzdDogY3VycmVudFJlcXVlc3RcbiAgICB9KVxuXG4gICAgdGhpcy5yZXF1ZXN0UnVubmVycy5wdXNoKHJlcXVlc3RSdW5uZXIpXG5cbiAgICByZXF1ZXN0UnVubmVyLmV2ZW50cy5vbihcImRvbmVcIiwgdGhpcy5yZXF1ZXN0RG9uZSlcbiAgICByZXF1ZXN0UnVubmVyLnJ1bigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbiB3cml0ZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uV3JpdGUoZGF0YSkge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgc3RhcnRcIiwge1xuICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsXG4gICAgICBsZW5ndGg6IGRhdGEubGVuZ3RoLFxuICAgICAgc3RhdGU6IHRoaXMuc3RhdGUsXG4gICAgfV0pXG5cbiAgICBpZiAodGhpcy53ZWJzb2NrZXRTZXNzaW9uKSB7XG4gICAgICB0aGlzLndlYnNvY2tldFNlc3Npb24ub25EYXRhKGRhdGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLyoqXG4gICAgICAgKiBSZW1haW5pbmcuXG4gICAgICAgKiBAdHlwZSB7QnVmZmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IHJlbWFpbmluZyA9IGRhdGFcblxuICAgICAgd2hpbGUgKHJlbWFpbmluZykge1xuICAgICAgICBpZiAocmVtYWluaW5nLmxlbmd0aCA8PSAwKSBicmVha1xuXG4gICAgICAgIGlmICh0aGlzLnN0YXRlID09IFwiaW5pdGlhbFwiKSB7XG4gICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBjcmVhdGluZyByZXF1ZXN0IHBhcnNlclwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3QgPSBuZXcgUmVxdWVzdCh7Y2xpZW50OiB0aGlzLCBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3QucmVxdWVzdFBhcnNlci5ldmVudHMub24oXCJkb25lXCIsIHRoaXMuZXhlY3V0ZUN1cnJlbnRSZXF1ZXN0KVxuICAgICAgICAgIHRoaXMuc3RhdGUgPSBcInJlcXVlc3RTdGFydGVkXCJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlICE9IFwicmVxdWVzdFN0YXJ0ZWRcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBzdGF0ZSBmb3IgY2xpZW50OiAke3RoaXMuc3RhdGV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5jdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG5cbiAgICAgICAgcmVtYWluaW5nID0gdGhpcy5jdXJyZW50UmVxdWVzdC5mZWVkKHJlbWFpbmluZylcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBmZWQgcGFyc2VyXCIsIHtcbiAgICAgICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgICAgICBoYXNSZW1haW5pbmc6IEJvb2xlYW4ocmVtYWluaW5nPy5sZW5ndGgpLFxuICAgICAgICAgIHJlbWFpbmluZ0xlbmd0aDogcmVtYWluaW5nPy5sZW5ndGggfHwgMCxcbiAgICAgICAgICBwYXJzZXJDb21wbGV0ZWQ6IHRoaXMuY3VycmVudFJlcXVlc3Q/LmdldFJlcXVlc3RQYXJzZXIoKS5oYXNDb21wbGV0ZWRcbiAgICAgICAgfV0pXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZyAmJiByZW1haW5pbmcubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IHJlcXVlc3RQYXJzZXIgPSB0aGlzLmN1cnJlbnRSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKVxuXG4gICAgICAgICAgaWYgKCFyZXF1ZXN0UGFyc2VyLmhhc0NvbXBsZXRlZCkge1xuICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHdhaXRpbmcgZm9yIG1vcmUgZGF0YVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLnN0YXRlID0gXCJpbml0aWFsXCJcbiAgICAgICAgICBjb25zdCByZW1haW5pbmdMZW5ndGggPSByZW1haW5pbmcubGVuZ3RoXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHBhcnNlciBjb21wbGV0ZWQgd2l0aCByZW1haW5pbmcgYnl0ZXNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCByZW1haW5pbmdMZW5ndGh9XSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBlbmRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBzdGF0ZTogdGhpcy5zdGF0ZSwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlQmFkUmVxdWVzdChlbnN1cmVFcnJvcihlcnJvcikpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgd2Vic29ja2V0IHVwZ3JhZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IHJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB3ZWJzb2NrZXQgdXBncmFkZS5cbiAgICovXG4gIF9pc1dlYnNvY2tldFVwZ3JhZGUocmVxdWVzdCkge1xuICAgIGNvbnN0IHVwZ3JhZGVIZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcInVwZ3JhZGVcIik/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gQm9vbGVhbih1cGdyYWRlSGVhZGVyID09IFwid2Vic29ja2V0XCIgJiYgY29ubmVjdGlvbkhlYWRlcj8uaW5jbHVkZXMoXCJ1cGdyYWRlXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBncmFkZSB0byB3ZWJzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF91cGdyYWRlVG9XZWJzb2NrZXQoKSB7XG4gICAgaWYgKCF0aGlzLmN1cnJlbnRSZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3RcIilcblxuICAgIGNvbnN0IHNlY1dlYnNvY2tldEtleSA9IHRoaXMuY3VycmVudFJlcXVlc3QuaGVhZGVyKFwic2VjLXdlYnNvY2tldC1rZXlcIilcblxuICAgIGlmICghc2VjV2Vic29ja2V0S2V5KSB7XG4gICAgICB0aGlzLl9zZW5kQmFkVXBncmFkZVJlc3BvbnNlKFwiTWlzc2luZyBTZWMtV2ViU29ja2V0LUtleSBoZWFkZXJcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHdlYnNvY2tldEFjY2VwdEtleSA9IGNyeXB0by5jcmVhdGVIYXNoKFwic2hhMVwiKVxuICAgICAgLnVwZGF0ZShgJHtzZWNXZWJzb2NrZXRLZXl9MjU4RUFGQTUtRTkxNC00N0RBLTk1Q0EtQzVBQjBEQzg1QjExYCwgXCJiaW5hcnlcIilcbiAgICAgIC5kaWdlc3QoXCJiYXNlNjRcIilcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3QuaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgcmVzcG9uc2VMaW5lcyA9IFtcbiAgICAgIGBIVFRQLyR7aHR0cFZlcnNpb259IDEwMSBTd2l0Y2hpbmcgUHJvdG9jb2xzYCxcbiAgICAgIFwiVXBncmFkZTogd2Vic29ja2V0XCIsXG4gICAgICBcIkNvbm5lY3Rpb246IFVwZ3JhZGVcIixcbiAgICAgIGBTZWMtV2ViU29ja2V0LUFjY2VwdDogJHt3ZWJzb2NrZXRBY2NlcHRLZXl9YCxcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiXG4gICAgXVxuICAgIGNvbnN0IHJlc3BvbnNlID0gcmVzcG9uc2VMaW5lcy5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICBjb25zdCBtZXNzYWdlSGFuZGxlclJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXI/LigpXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGVyXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGVyUHJvbWlzZVxuXG4gICAgaWYgKG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkSGFuZGxlciA9IG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIoe1xuICAgICAgICBjbGllbnQ6IHRoaXMsXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgcmVxdWVzdDogdGhpcy5jdXJyZW50UmVxdWVzdFxuICAgICAgfSlcblxuICAgICAgY29uc3QgcmVzb2x2ZWRUaGVuYWJsZSA9IC8qKiBAdHlwZSB7e3RoZW4/OiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChyZXNvbHZlZEhhbmRsZXIpXG5cbiAgICAgIGlmIChyZXNvbHZlZFRoZW5hYmxlPy50aGVuKSB7XG4gICAgICAgIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZSA9IC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyIHwgdm9pZD59ICovIChyZXNvbHZlZEhhbmRsZXIpXG4gICAgICB9IGVsc2UgaWYgKHJlc29sdmVkSGFuZGxlcikge1xuICAgICAgICBtZXNzYWdlSGFuZGxlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlcn0gKi8gKHJlc29sdmVkSGFuZGxlcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24gPSBuZXcgV2Vic29ja2V0U2Vzc2lvbih7XG4gICAgICBjbGllbnQ6IHRoaXMsXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICB1cGdyYWRlUmVxdWVzdDogdGhpcy5jdXJyZW50UmVxdWVzdCxcbiAgICAgIG1lc3NhZ2VIYW5kbGVyOiBtZXNzYWdlSGFuZGxlcixcbiAgICAgIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZTogbWVzc2FnZUhhbmRsZXJQcm9taXNlXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgLy8gUGF1c2VkIHNlc3Npb25zIHN1cnZpdmUgdGhlIHNvY2tldCBjbG9zZTsgZG9uJ3QgZGVzdHJveSgpLlxuICAgICAgLy8gVGhlIGdyYWNlLWV4cGlyeSBwYXRoIChfZmluYWxpemVHcmFjZUV4cGlyeSkgd2lsbCBkZXN0cm95XG4gICAgICAvLyB0aGVtIHBlcm1hbmVudGx5IGlmIHJlc3VtZSBkb2Vzbid0IGhhcHBlbiBpbiB0aW1lLlxuICAgICAgaWYgKCF0aGlzLndlYnNvY2tldFNlc3Npb24/LmlzUGF1c2VkKCkpIHtcbiAgICAgICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uPy5kZXN0cm95KClcbiAgICAgIH1cbiAgICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbiA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwib3duZXJzaGlwQ2xhaW1lZFwiLCAoe3Nlc3Npb25JZH0pID0+IHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJ3ZWJzb2NrZXRTZXNzaW9uT3duZWRcIiwge3Nlc3Npb25JZH0pXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwib3duZXJzaGlwUmVsZWFzZWRcIiwgKHtzZXNzaW9uSWR9KSA9PiB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwid2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkXCIsIHtzZXNzaW9uSWR9KVxuICAgIH0pXG4gICAgdGhpcy5zdGF0ZSA9IFwid2Vic29ja2V0XCJcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIHJlc3BvbnNlKVxuICAgIHZvaWQgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLmluaXRpYWxpemVDaGFubmVsKClcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uc2VuZFNlc3Npb25Fc3RhYmxpc2hlZCgpXG4gIH1cblxuICByZXF1ZXN0RG9uZSA9ICgpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJyZXF1ZXN0RG9uZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHF1ZXVlTGVuZ3RoOiB0aGlzLnJlcXVlc3RSdW5uZXJzLmxlbmd0aH1dKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RyYWluRG9uZVJlcXVlc3RzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHdoaWxlIHNlbmRpbmcgZG9uZSByZXF1ZXN0c1wiLCBlcnJvcilcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGRvbmUgcmVxdWVzdHMgb25lIGF0IGEgdGltZS4gQSBydW5uZXIgaXMgc2hpZnRlZCBvdXQgb2YgdGhlIHF1ZXVlIGJlZm9yZVxuICAgKiBpdHMgcmVzcG9uc2UgZmluaXNoZXMgc2VuZGluZyAoYXN5bmMgY29tcHJlc3Npb24sIGZpbGUgdHJhbnNmZXIpLCBzbyBhblxuICAgKiBvdmVybGFwcGluZyBkcmFpbiB3b3VsZCBvdGhlcndpc2UgcGljayB1cCB0aGUgbmV4dCBydW5uZXIgYW5kIHJlb3JkZXIgcGlwZWxpbmVkXG4gICAqIHNvY2tldCB3cml0ZXMuIENhbGxzIHRoYXQgYXJyaXZlIHdoaWxlIGEgZHJhaW4gaXMgYWN0aXZlIGFyZSBmb2xkZWQgaW50byBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSBkb25lIHJlc3BvbnNlIGhhcyBiZWVuIHNlbnQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Eb25lUmVxdWVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlKSB7XG4gICAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBkbyB7XG4gICAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluUGVuZGluZyA9IGZhbHNlXG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZERvbmVSZXF1ZXN0cygpXG4gICAgICB9IHdoaWxlICh0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlID0gZmFsc2VcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZW5kRG9uZVJlcXVlc3RzKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gdGhpcy5yZXF1ZXN0UnVubmVyc1swXVxuICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVlc3RSdW5uZXI/LmdldFJlcXVlc3QoKVxuXG4gICAgICBpZiAocmVxdWVzdFJ1bm5lcj8uZ2V0U3RhdGUoKSA9PSBcImRvbmVcIikge1xuICAgICAgICBjb25zdCBodHRwVmVyc2lvbiA9IHJlcXVlc3QuaHR0cFZlcnNpb24oKVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpPy50cmltKClcbiAgICAgICAgY29uc3Qgc2hvdWxkQ2xvc2VDb25uZWN0aW9uID0gdGhpcy5zaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdClcblxuICAgICAgICB0aGlzLnJlcXVlc3RSdW5uZXJzLnNoaWZ0KClcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZERvbmVSZXF1ZXN0cyBzaGlmdGVkIHF1ZXVlXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kUmVzcG9uc2UocmVxdWVzdFJ1bm5lcilcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFZlbG9jaW91cyBjbGllbnQgJHt0aGlzLmNsaWVudENvdW50fSBmYWlsZWQgd2hpbGUgc2VuZGluZyByZXNwb25zZWAsIGVycm9yXSlcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnRSZXF1ZXN0ID09PSByZXF1ZXN0ICYmIHRoaXMuc3RhdGUgPT09IFwiaW5pdGlhbFwiKSB0aGlzLmN1cnJlbnRSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmREb25lUmVxdWVzdHNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBjb25uZWN0aW9uSGVhZGVyLCBodHRwVmVyc2lvbn1dKVxuXG4gICAgICAgIGlmIChzaG91bGRDbG9zZUNvbm5lY3Rpb24pIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbYENsb3NpbmcgdGhlIGNvbm5lY3Rpb24gYmVjYXVzZSAke2h0dHBWZXJzaW9ufSBhbmQgY29ubmVjdGlvbiBoZWFkZXIgJHtjb25uZWN0aW9uSGVhZGVyfWAsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudH1dKVxuICAgICAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7UmVxdWVzdFJ1bm5lcn0gcmVxdWVzdFJ1bm5lciAtIFJlcXVlc3QgcnVubmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2VuZFJlc3BvbnNlKHJlcXVlc3RSdW5uZXIpIHtcbiAgICBjb25zdCByZXNwb25zZSA9IGRpZ2cocmVxdWVzdFJ1bm5lciwgXCJyZXNwb25zZVwiKVxuICAgIGNvbnN0IHJlcXVlc3QgPSByZXF1ZXN0UnVubmVyLmdldFJlcXVlc3QoKVxuICAgIGNvbnN0IGZpbGVQYXRoID0gcmVzcG9uc2UuZ2V0RmlsZVBhdGgoKVxuICAgIGNvbnN0IGZpbGVPbkZpbmlzaGVkID0gcmVzcG9uc2UuZ2V0RmlsZU9uRmluaXNoZWQoKVxuICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKT8udHJpbSgpXG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSByZXF1ZXN0Lmh0dHBWZXJzaW9uKClcbiAgICBjb25zdCBzaG91bGRDbG9zZUNvbm5lY3Rpb24gPSB0aGlzLnNob3VsZENsb3NlQ29ubmVjdGlvbihyZXF1ZXN0KVxuICAgIGNvbnN0IGhhc0ZpbGVQYXRoID0gdHlwZW9mIGZpbGVQYXRoID09PSBcInN0cmluZ1wiICYmIGZpbGVQYXRoLmxlbmd0aCA+IDBcbiAgICBjb25zdCBib2R5ID0gaGFzRmlsZVBhdGggPyBudWxsIDogcmVzcG9uc2UuZ2V0Qm9keSgpXG4gICAgY29uc3QgYm9keUlzU3RyaW5nID0gdHlwZW9mIGJvZHkgPT09IFwic3RyaW5nXCJcbiAgICBjb25zdCBib2R5SXNCaW5hcnkgPSBib2R5IGluc3RhbmNlb2YgVWludDhBcnJheVxuXG4gICAgaWYgKCFoYXNGaWxlUGF0aCAmJiAhYm9keUlzU3RyaW5nICYmICFib2R5SXNCaW5hcnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcmVzcG9uc2UgYm9keSB0byBiZSBhIHN0cmluZyBvciBVaW50OEFycmF5LCBnb3QgJHt0eXBlb2YgYm9keX1gKVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2VuZFJlc3BvbnNlXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgY29ubmVjdGlvbkhlYWRlciwgaHR0cFZlcnNpb259KVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBwYXlsb2FkXCIsIHtcbiAgICAgIGNsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LFxuICAgICAgaGFzRmlsZVBhdGgsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGJvZHlJc0JpbmFyeSxcbiAgICAgIGJvZHlJc1N0cmluZ1xuICAgIH1dKVxuXG4gICAgaWYgKHNob3VsZENsb3NlQ29ubmVjdGlvbikge1xuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29ubmVjdGlvblwiLCBcIkNsb3NlXCIpXG4gICAgfSBlbHNlIGlmIChodHRwVmVyc2lvbiA9PSBcIjEuMFwiICYmIGNvbm5lY3Rpb25IZWFkZXIgPT0gXCJrZWVwLWFsaXZlXCIpIHtcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbm5lY3Rpb25cIiwgXCJLZWVwLUFsaXZlXCIpXG4gICAgfVxuXG4gICAgLy8gUGVyIFJGQyA3MjMwIMKnMy4zLjMsIHJlc3BvbnNlcyB3aXRoIHN0YXR1cyBjb2RlcyAxeHgsIDIwNCwgYW5kIDMwNFxuICAgIC8vIE1VU1QgTk9UIGNhcnJ5IGEgbWVzc2FnZSBib2R5IGFuZCBNVVNUIE5PVCBpbmNsdWRlIENvbnRlbnQtTGVuZ3RoXG4gICAgLy8gKHdpdGggYSBuYXJyb3cgMzA0IGV4Y2VwdGlvbiB3ZSBkb24ndCBsZWFuIG9uKS4gU2VuZGluZyBvbmUgd291bGRcbiAgICAvLyBkZXN5bmNocm9uaXplIGtlZXAtYWxpdmUgY2xpZW50cyB3YWl0aW5nIGZvciBieXRlcyB0aGF0IG5ldmVyXG4gICAgLy8gYXJyaXZlIOKAlCBkcm9wIHRoZSBib2R5IGVudGlyZWx5IGZvciB0aG9zZSBjb2Rlcy5cbiAgICBjb25zdCBpc0JvZHlsZXNzU3RhdHVzID0gaXNOb0JvZHlTdGF0dXNDb2RlKHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKSlcblxuICAgIC8vIEhFQUQgcmVzcG9uc2VzIHNlbGVjdCBhbmQgY29tcHV0ZSB0aGUgZXhhY3Qgc2FtZSByZXByZXNlbnRhdGlvbiBoZWFkZXJzIGFzIHRoZVxuICAgIC8vIGVxdWl2YWxlbnQgR0VUIChpbmNsdWRpbmcgQ29udGVudC1MZW5ndGggYW5kIGFueSBuZWdvdGlhdGVkIENvbnRlbnQtRW5jb2RpbmcpLFxuICAgIC8vIGJ1dCBubyBidWZmZXJlZCBvciBmaWxlIGJvZHkgaXMgZW1pdHRlZCBiZWxvdy5cbiAgICBjb25zdCBpc0hlYWRSZXF1ZXN0ID0gcmVxdWVzdC5odHRwTWV0aG9kKCkgPT0gXCJIRUFEXCJcblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgVWludDhBcnJheSB8IG51bGx9ICovXG4gICAgbGV0IGJvZHlUb0VtaXQgPSBib2R5XG5cbiAgICBpZiAoIWlzQm9keWxlc3NTdGF0dXMpIHtcbiAgICAgIGxldCBjb250ZW50TGVuZ3RoXG5cbiAgICAgIGlmIChoYXNGaWxlUGF0aCkge1xuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoZmlsZVBhdGgpXG4gICAgICAgIGNvbnRlbnRMZW5ndGggPSBzdGF0cy5zaXplXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTdHJpbmcgYm9kaWVzIGFyZSBVVEYtOCBmcmFtZWQsIHNvIHRoZSBidWZmZXJlZCBieXRlcyBhcmUgdGhlIFVURi04IGVuY29kaW5nO1xuICAgICAgICAvLyBVaW50OEFycmF5IGJvZGllcyBhcmUgYWxyZWFkeSB0aGUgZXhhY3Qgd2lyZSBieXRlcy5cbiAgICAgICAgY29uc3QgYm9keUJ1ZmZlciA9IGJvZHlJc1N0cmluZyA/IEJ1ZmZlci5mcm9tKGJvZHksIFwidXRmOFwiKSA6IEJ1ZmZlci5mcm9tKGJvZHkpXG4gICAgICAgIGNvbnN0IGNvbXByZXNzaW9uUmVzdWx0ID0gYXdhaXQgYXBwbHlSZXNwb25zZUNvbXByZXNzaW9uKHtcbiAgICAgICAgICBib2R5QnVmZmVyLFxuICAgICAgICAgIGNvbXByZXNzaW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlckNvbXByZXNzaW9uKCksXG4gICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICByZXNwb25zZVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChjb21wcmVzc2lvblJlc3VsdC5vdXRjb21lID09IFwibm90LWFjY2VwdGFibGVcIikge1xuICAgICAgICAgIC8vIFRoZSBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBhbmQgbm8gc3VwcG9ydGVkIGNvZGluZyBpcyBhY2NlcHRhYmxlOiBhbnN3ZXJcbiAgICAgICAgICAvLyB3aXRoIGFuIGVtcHR5IDQwNiBpbnN0ZWFkIG9mIGFuIHVuYWNjZXB0YWJsZSByZXByZXNlbnRhdGlvbi5cbiAgICAgICAgICByZXNwb25zZS5zZXRTdGF0dXMoNDA2KVxuICAgICAgICAgIHJlc3BvbnNlLnNldEJvZHkoXCJcIilcbiAgICAgICAgICBib2R5VG9FbWl0ID0gXCJcIlxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSAwXG4gICAgICAgIH0gZWxzZSBpZiAoY29tcHJlc3Npb25SZXN1bHQub3V0Y29tZSA9PSBcImNvbXByZXNzZWRcIikge1xuICAgICAgICAgIGJvZHlUb0VtaXQgPSBjb21wcmVzc2lvblJlc3VsdC5ib2R5XG4gICAgICAgICAgY29udGVudExlbmd0aCA9IGNvbXByZXNzaW9uUmVzdWx0LmJvZHkubGVuZ3RoXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29udGVudExlbmd0aCA9IGJvZHlCdWZmZXIubGVuZ3RoXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUmVtb3ZlIGFueSBhcHBsaWNhdGlvbiBwcmUtc2V0IENvbnRlbnQtTGVuZ3RoIChhbnkgY2FzaW5nKSBzbyBleGFjdGx5IG9uZVxuICAgICAgLy8gcmVjb21wdXRlZCB2YWx1ZSBnb2VzIG9uIHRoZSB3aXJlLlxuICAgICAgcmVzcG9uc2UucmVtb3ZlSGVhZGVyKFwiQ29udGVudC1MZW5ndGhcIilcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtTGVuZ3RoXCIsIGNvbnRlbnRMZW5ndGgpXG4gICAgfVxuXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiRGF0ZVwiLCBkYXRlLnRvVVRDU3RyaW5nKCkpXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiU2VydmVyXCIsIFwiVmVsb2Npb3VzXCIpXG5cbiAgICBsZXQgaGVhZGVycyA9IFwiXCJcblxuICAgIGhlYWRlcnMgKz0gYEhUVFAvJHtyZXF1ZXN0Lmh0dHBWZXJzaW9uKCl9ICR7cmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpfSAke3Jlc3BvbnNlLmdldFN0YXR1c01lc3NhZ2UoKX1cXHJcXG5gXG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlcktleSBpbiByZXNwb25zZS5oZWFkZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IGhlYWRlclZhbHVlIG9mIHJlc3BvbnNlLmhlYWRlcnNbaGVhZGVyS2V5XSkge1xuICAgICAgICBoZWFkZXJzICs9IGAke2hlYWRlcktleX06ICR7aGVhZGVyVmFsdWV9XFxyXFxuYFxuICAgICAgfVxuICAgIH1cblxuICAgIGhlYWRlcnMgKz0gXCJcXHJcXG5cIlxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBoZWFkZXJzIGVtaXR0ZWRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBoZWFkZXJzTGVuZ3RoOiBoZWFkZXJzLmxlbmd0aH1dKVxuXG4gICAgaWYgKGlzQm9keWxlc3NTdGF0dXMpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IHN1cHByZXNzZWQgZm9yIG5vLWJvZHkgc3RhdHVzXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgc3RhdHVzQ29kZTogcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpfV0pXG4gICAgICBpZiAoaGFzRmlsZVBhdGgpIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIGZhbHNlLCBmaWxlT25GaW5pc2hlZClcbiAgICB9IGVsc2UgaWYgKGlzSGVhZFJlcXVlc3QpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IHN1cHByZXNzZWQgZm9yIEhFQUQgcmVxdWVzdFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnR9XSlcbiAgICAgIGlmIChoYXNGaWxlUGF0aCkgYXdhaXQgdGhpcy5zZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgZmFsc2UsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSBpZiAoaGFzRmlsZVBhdGgpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIHRydWUsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGJvZHlUb0VtaXQpXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgYm9keSBlbWl0dGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgYm9keUxlbmd0aDogYm9keVRvRW1pdCA/IGJvZHlUb0VtaXQubGVuZ3RoIDogMH1dKVxuICAgIH1cblxuICAgIGF3YWl0IHJlcXVlc3RSdW5uZXIubG9nQ29tcGxldGVkUmVxdWVzdCgpXG5cbiAgICBpZiAoXCJnZXRSZXF1ZXN0UGFyc2VyXCIgaW4gcmVxdWVzdCkge1xuICAgICAgY29uc3QgaHR0cFJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAocmVxdWVzdClcbiAgICAgIGh0dHBSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKS5kZXN0cm95KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGZpbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gc2VuZEJvZHkgLSBXaGV0aGVyIHRoZSBmaWxlIGJvZHkgc2hvdWxkIGJlIHNlbnQuXG4gICAqIEBwYXJhbSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gb25GaW5pc2hlZCAtIENvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgc2VuZEJvZHksIG9uRmluaXNoZWQpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kRmlsZU91dHB1dCBzdGFydFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRofV0pXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICAgIGxldCBzZXR0bGVtZW50ID0gbnVsbFxuICAgICAgY29uc3Qgc2V0dGxlID0gKC8qKiBAdHlwZSB7XCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwifSAqLyB0cmFuc2ZlclJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlbWVudCkgcmV0dXJuIHNldHRsZW1lbnRcblxuICAgICAgICB0aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzLmRlbGV0ZShzZXR0bGUpXG4gICAgICAgIHNldHRsZW1lbnQgPSB0aGlzLnJ1bkZpbGVPbkZpbmlzaGVkKHtmaWxlUGF0aCwgb25GaW5pc2hlZCwgcmVzdWx0OiB0cmFuc2ZlclJlc3VsdH0pXG4gICAgICAgICAgLmZpbmFsbHkoKCkgPT4gcmVzb2x2ZSh0cmFuc2ZlclJlc3VsdCkpXG5cbiAgICAgICAgcmV0dXJuIHNldHRsZW1lbnRcbiAgICAgIH1cblxuICAgICAgdGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlcy5hZGQoc2V0dGxlKVxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImZpbGVcIiwge2ZpbGVQYXRoLCBzZW5kQm9keSwgc2V0dGxlfSlcbiAgICB9KVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZEZpbGVPdXRwdXQgZG9uZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHR9XSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgZmlsZSBjb21wbGV0aW9uIGNhbGxiYWNrIHdpdGhvdXQgYWxsb3dpbmcgY2xlYW51cCBmYWlsdXJlcyB0byByZXBsYWNlIHRoZSBjb21taXR0ZWQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29tcGxldGlvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHsoKHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBudWxsfSBhcmdzLm9uRmluaXNoZWQgLSBDb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIn0gYXJncy5yZXN1bHQgLSBUcmFuc2ZlciByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNhbGxiYWNrIGNsZWFudXAgYW5kIGVycm9yIHJlcG9ydGluZyBmaW5pc2guXG4gICAqL1xuICBhc3luYyBydW5GaWxlT25GaW5pc2hlZCh7ZmlsZVBhdGgsIG9uRmluaXNoZWQsIHJlc3VsdH0pIHtcbiAgICBpZiAoIW9uRmluaXNoZWQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG9uRmluaXNoZWQocmVzdWx0KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IGVuc3VyZUVycm9yKGNhdWdodEVycm9yKVxuXG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGaWxlIHJlc3BvbnNlIG9uRmluaXNoZWQgY2FsbGJhY2sgZmFpbGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGgsIHJlc3VsdH0sIGVycm9yXSlcblxuICAgICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgICBjb250ZXh0OiB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHQsIHN0YWdlOiBcInNlbmQtZmlsZS1vbi1maW5pc2hlZFwifSxcbiAgICAgICAgZXJyb3JcbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5lcnJvclBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFib3J0cyBhbGwgZmlsZSByZXNwb25zZXMgYXdhaXRpbmcgdHJhbnNwb3J0IGFja25vd2xlZGdlbWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVuZGluZyBjYWxsYmFja3Mgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRQZW5kaW5nRmlsZVJlc3BvbnNlcygpIHtcbiAgICBhd2FpdCBQcm9taXNlLmFsbChbLi4udGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlc10ubWFwKChzZXR0bGUpID0+IHNldHRsZShcImFib3J0ZWRcIikpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIGNsb3NlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IHJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29ubmVjdGlvbiBzaG91bGQgYmUgY2xvc2VkLlxuICAgKi9cbiAgc2hvdWxkQ2xvc2VDb25uZWN0aW9uKHJlcXVlc3QpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHJlcXVlc3QuaHR0cFZlcnNpb24oKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25IZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImNvbm5lY3Rpb25cIik/LnRvTG93ZXJDYXNlKCk/LnRyaW0oKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25Ub2tlbnMgPSBjb25uZWN0aW9uSGVhZGVyXG4gICAgICA/IGNvbm5lY3Rpb25IZWFkZXIuc3BsaXQoXCIsXCIpLm1hcCgodG9rZW4pID0+IHRva2VuLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pXG4gICAgICA6IFtdXG5cbiAgICBpZiAoaHR0cFZlcnNpb24gPT0gXCJ3ZWJzb2NrZXRcIikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGNvbm5lY3Rpb25Ub2tlbnMuaW5jbHVkZXMoXCJjbG9zZVwiKSkgcmV0dXJuIHRydWVcblxuICAgIGlmIChodHRwVmVyc2lvbiA9PSBcIjEuMFwiICYmIGNvbm5lY3Rpb25IZWFkZXIgIT0gXCJrZWVwLWFsaXZlXCIpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBmb3IgdGhlIHN0YXR1cyBjb2RlcyB0aGF0IFJGQyA3MjMwIMKnMy4zLjMgZGVjbGFyZXNcbiAqIGNhbm5vdCBjYXJyeSBhIG1lc3NhZ2UgYm9keTogZXZlcnkgMXh4IGluZm9ybWF0aW9uYWwsIDIwNCBOb1xuICogQ29udGVudCwgYW5kIDMwNCBOb3QgTW9kaWZpZWQuXG4gKiBAcGFyYW0ge251bWJlcn0gc3RhdHVzQ29kZSAtIEhUVFAgc3RhdHVzIGNvZGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBzdGF0dXMgY29kZSBmb3JiaWRzIGEgcmVzcG9uc2UgYm9keS5cbiAqL1xuZnVuY3Rpb24gaXNOb0JvZHlTdGF0dXNDb2RlKHN0YXR1c0NvZGUpIHtcbiAgcmV0dXJuIChzdGF0dXNDb2RlID49IDEwMCAmJiBzdGF0dXNDb2RlIDwgMjAwKSB8fCBzdGF0dXNDb2RlID09PSAyMDQgfHwgc3RhdHVzQ29kZSA9PT0gMzA0XG59XG4iXX0=