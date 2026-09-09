// @ts-check
import crypto from "crypto";
import fs from "node:fs/promises";
import { digg } from "diggerize";
import { ensureError } from "typanic";
import EventEmitter from "../../utils/event-emitter.js";
import Logger from "../../logger.js";
import Request from "./request.js";
import RequestRunner from "./request-runner.js";
import { addAcceptEncodingToVary, applyResponseCompression, negotiateContentEncoding } from "./response-compression.js";
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
     * Sends a finished response to the client. Owns the framework-owned
     * `Vary: Accept-Encoding` dimension (emitted for every selected
     * representation — transformed, identity, 406, and file — and for
     * header-present and header-absent requests alike, so it is stable across
     * requests on the same connection; never added when compression is disabled,
     * the response is truly bodyless, or the application supplied a fixed
     * `Content-Encoding`) and the file 406 rule (a sendFile response whose
     * client forbids identity is answered with the empty 406, the file is never
     * opened or streamed, and `onFinished` settles once as "completed").
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
        // The response representation can depend on the client's Accept-Encoding:
        // the same request is answered with an identity body (or a file) when
        // identity is acceptable and with an empty 406 when it is forbidden.
        const compression = this.configuration.getHttpServerCompression();
        const negotiated = compression.enabled ? negotiateContentEncoding(request.header("accept-encoding")) : undefined;
        // An application-supplied Content-Encoding is an application-owned
        // representation contract, captured before the framework may add its own.
        // A file carrying one is a fixed, application-owned representation: the
        // framework neither negotiates it nor re-advertises it, so it is never a
        // candidate for the identity-only 406.
        const hasApplicationContentEncoding = response.getHeader("Content-Encoding").length > 0;
        // A file response only ever serves the identity representation: whenever
        // the client forbids identity (including the not-acceptable case where no
        // coding applies) and the file does not carry an application-supplied
        // Content-Encoding, the file is rejected with the empty 406. A truly
        // bodyless status selects no representation, so it is never rejected here.
        const isFileNotAcceptable = hasFilePath && !!negotiated && ("notAcceptable" in negotiated || negotiated.identityAcceptable === false) && hasApplicationContentEncoding === false && !isBodylessStatus;
        if (!isBodylessStatus) {
            let contentLength;
            if (hasFilePath) {
                if (isFileNotAcceptable) {
                    // The client forbids identity and files are only ever sent identity:
                    // answer with the same empty 406 every other representation path
                    // uses. The file is never opened or streamed; the committed 406
                    // still settles onFinished as "completed" so application cleanup runs
                    // exactly once.
                    response.setStatus(406);
                    response.setBody("");
                    bodyToEmit = "";
                    contentLength = 0;
                    await this.runFileOnFinished({ filePath, onFinished: fileOnFinished, result: "completed" });
                }
                else {
                    const stats = await fs.stat(filePath);
                    contentLength = stats.size;
                }
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
        // Framework-owned Vary dimension: whenever compression is enabled and a
        // representation was selected, the response depends on Accept-Encoding,
        // so caches must key on it. Applied identically for every outcome
        // (transformed, identity, 406, file) and for header-present and
        // header-absent requests alike, so the header is stable across requests on
        // the same connection. A truly bodyless response selects no representation
        // and carries no dimension; an application-supplied Content-Encoding keeps
        // the representation contract application-owned and is never re-advertised.
        if (negotiated && !isBodylessStatus && hasApplicationContentEncoding === false) {
            addAcceptEncodingToVary(response);
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
        // A negotiated file 406 is fully committed above (status 406, empty body)
        // and its onFinished already settled once as "completed": every file-output
        // branch below is bypassed so no file event is emitted and the callback is
        // never settled a second time. This holds for both GET and HEAD.
        if (isFileNotAcceptable) {
            this.logger.debug(() => ["sendResponse file body suppressed for 406", { clientCount: this.clientCount, filePath }]);
        }
        else if (isBodylessStatus) {
            this.logger.debug(() => ["sendResponse body suppressed for no-body status", { clientCount: this.clientCount, statusCode: response.getStatusCode() }]);
            // A bodyless status (1xx/204/304) selects no representation, so no file
            // body or framework Vary is emitted. The file-ownership path still settles
            // onFinished exactly once as "completed" (nothing was aborted) — even when
            // the client forbids identity — preserving the pre-change settlement.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUE7QUFDM0IsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sT0FBTyxNQUFNLGNBQWMsQ0FBQTtBQUNsQyxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLEVBQUMsdUJBQXVCLEVBQUUsd0JBQXdCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUNySCxPQUFPLGdCQUFnQixNQUFNLHdCQUF3QixDQUFBO0FBRXJEOzs7O0dBSUc7QUFDSCxTQUFTLGlCQUFpQixDQUFDLEtBQUs7SUFDOUIsT0FBTztRQUNMLFVBQVUsRUFBRSxLQUFLLENBQUMsSUFBSTtRQUN0QixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87UUFDdEIsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLGdCQUFnQjtLQUN6QyxDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sMEJBQTBCO0lBQzdDLE1BQU0sR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFBO0lBQzNCLEtBQUssR0FBRyxTQUFTLENBQUE7SUFFakI7O3lCQUVxQjtJQUNyQix3QkFBd0IsR0FBRyxLQUFLLENBQUE7SUFFaEM7O3lCQUVxQjtJQUNyQix5QkFBeUIsR0FBRyxLQUFLLENBQUE7SUFFakM7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLFdBQVcs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QU8sQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRW5ELElBQUksV0FBVyxJQUFJLEtBQUssSUFBSSxnQkFBZ0IsSUFBSSxZQUFZO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFekUsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0NBQ0Y7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLFVBQVU7SUFDcEMsT0FBTyxDQUFDLFVBQVUsSUFBSSxHQUFHLElBQUksVUFBVSxHQUFHLEdBQUcsQ0FBQyxJQUFJLFVBQVUsS0FBSyxHQUFHLElBQUksVUFBVSxLQUFLLEdBQUcsQ0FBQTtBQUM1RixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBjcnlwdG8gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCB7ZW5zdXJlRXJyb3J9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBSZXF1ZXN0IGZyb20gXCIuL3JlcXVlc3QuanNcIlxuaW1wb3J0IFJlcXVlc3RSdW5uZXIgZnJvbSBcIi4vcmVxdWVzdC1ydW5uZXIuanNcIlxuaW1wb3J0IHthZGRBY2NlcHRFbmNvZGluZ1RvVmFyeSwgYXBwbHlSZXNwb25zZUNvbXByZXNzaW9uLCBuZWdvdGlhdGVDb250ZW50RW5jb2Rpbmd9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbXByZXNzaW9uLmpzXCJcbmltcG9ydCBXZWJzb2NrZXRTZXNzaW9uIGZyb20gXCIuL3dlYnNvY2tldC1zZXNzaW9uLmpzXCJcblxuLyoqXG4gKiBSdW5zIGJhZCByZXF1ZXN0IGRldGFpbHMuXG4gKiBAcGFyYW0ge0Vycm9yICYge3ZlbG9jaW91c0NvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBTYWZlIGJhZC1yZXF1ZXN0IGRldGFpbHMgZm9yIGxvZ3MuXG4gKi9cbmZ1bmN0aW9uIGJhZFJlcXVlc3REZXRhaWxzKGVycm9yKSB7XG4gIHJldHVybiB7XG4gICAgZXJyb3JDbGFzczogZXJyb3IubmFtZSxcbiAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgIHZlbG9jaW91c0NvbnRleHQ6IGVycm9yLnZlbG9jaW91c0NvbnRleHRcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZW9saWNpb3VzSHR0cFNlcnZlckNsaWVudCB7XG4gIGV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuICBzdGF0ZSA9IFwiaW5pdGlhbFwiXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBkb25lLXJlcXVlc3RzIGRyYWluIGlzIGN1cnJlbnRseSBzZW5kaW5nIHJlc3BvbnNlcyBmb3IgdGhpcyBjbGllbnQuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfZG9uZVJlcXVlc3RzRHJhaW5BY3RpdmUgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFub3RoZXIgZHJhaW4gd2FzIHJlcXVlc3RlZCB3aGlsZSBvbmUgd2FzIGFscmVhZHkgYWN0aXZlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX2RvbmVSZXF1ZXN0c0RyYWluUGVuZGluZyA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNsaWVudENvdW50IC0gQ2xpZW50IGNvdW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnJlbW90ZUFkZHJlc3NdIC0gUmVtb3RlIGFkZHJlc3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y2xpZW50Q291bnQsIGNvbmZpZ3VyYXRpb24sIHJlbW90ZUFkZHJlc3N9KSB7XG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25maWd1cmF0aW9uIGdpdmVuXCIpXG5cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLmNsaWVudENvdW50ID0gY2xpZW50Q291bnRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5yZW1vdGVBZGRyZXNzID0gcmVtb3RlQWRkcmVzc1xuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXF1ZXN0UnVubmVyW119ICovXG4gICAgdGhpcy5yZXF1ZXN0UnVubmVycyA9IFtdXG5cbiAgICAvKiogQHR5cGUge1NldDwocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMucGVuZGluZ0ZpbGVSZXNwb25zZXMgPSBuZXcgU2V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgYmFkIHVwZ3JhZGUgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gTWVzc2FnZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2VuZEJhZFVwZ3JhZGVSZXNwb25zZShtZXNzYWdlKSB7XG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSB0aGlzLmN1cnJlbnRSZXF1ZXN0Py5odHRwVmVyc2lvbigpIHx8IFwiMS4xXCJcbiAgICBjb25zdCBib2R5ID0gYCR7bWVzc2FnZX1cXG5gXG4gICAgY29uc3QgaGVhZGVycyA9IFtcbiAgICAgIGBIVFRQLyR7aHR0cFZlcnNpb259IDQwMCBCYWQgUmVxdWVzdGAsXG4gICAgICBcIkNvbm5lY3Rpb246IENsb3NlXCIsXG4gICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpbjsgY2hhcnNldD1VVEYtOFwiLFxuICAgICAgYENvbnRlbnQtTGVuZ3RoOiAke0J1ZmZlci5ieXRlTGVuZ3RoKGJvZHksIFwidXRmOFwiKX1gLFxuICAgICAgXCJcIixcbiAgICAgIGJvZHlcbiAgICBdLmpvaW4oXCJcXHJcXG5cIilcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgaGVhZGVycylcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgYmFkIHJlcXVlc3QgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gUmVzcG9uc2UgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NlbmRCYWRSZXF1ZXN0UmVzcG9uc2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gdGhpcy5jdXJyZW50UmVxdWVzdD8uaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgYm9keSA9IGAke21lc3NhZ2V9XFxuYFxuICAgIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgICBgSFRUUC8ke2h0dHBWZXJzaW9ufSA0MDAgQmFkIFJlcXVlc3RgLFxuICAgICAgXCJDb25uZWN0aW9uOiBDbG9zZVwiLFxuICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIixcbiAgICAgIGBDb250ZW50LUxlbmd0aDogJHtCdWZmZXIuYnl0ZUxlbmd0aChib2R5LCBcInV0ZjhcIil9YCxcbiAgICAgIFwiXCIsXG4gICAgICBib2R5XG4gICAgXS5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGhlYWRlcnMpXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgYmFkIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGhhbmRsZUJhZFJlcXVlc3QoZXJyb3IpIHtcbiAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBwYXJzZSBIVFRQIHJlcXVlc3RcIiwgYmFkUmVxdWVzdERldGFpbHMoLyoqIEB0eXBlIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKSldKVxuXG4gICAgaWYgKHRoaXMuY3VycmVudFJlcXVlc3QgJiYgXCJnZXRSZXF1ZXN0UGFyc2VyXCIgaW4gdGhpcy5jdXJyZW50UmVxdWVzdCkge1xuICAgICAgY29uc3QgaHR0cFJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5jdXJyZW50UmVxdWVzdClcblxuICAgICAgaHR0cFJlcXVlc3QuZ2V0UmVxdWVzdFBhcnNlcigpLmRlc3Ryb3koKVxuICAgIH1cblxuICAgIHRoaXMuY3VycmVudFJlcXVlc3QgPSB1bmRlZmluZWRcbiAgICB0aGlzLnN0YXRlID0gXCJpbml0aWFsXCJcblxuICAgIHRoaXMuX3NlbmRCYWRSZXF1ZXN0UmVzcG9uc2UoXCJCYWQgUmVxdWVzdFwiKVxuICB9XG5cbiAgZXhlY3V0ZUN1cnJlbnRSZXF1ZXN0ID0gKCkgPT4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiZXhlY3V0ZUN1cnJlbnRSZXF1ZXN0XCIpXG5cbiAgICBjb25zdCBjdXJyZW50UmVxdWVzdCA9IHRoaXMuY3VycmVudFJlcXVlc3RcblxuICAgIGlmICghY3VycmVudFJlcXVlc3QpIHRocm93IG5ldyBFcnJvcihcIk5vIGN1cnJlbnQgcmVxdWVzdFwiKVxuICAgIGNvbnN0IHJlZGFjdG9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZWRhY3Rvci5yZXF1ZXN0U2Vuc2l0aXZlVmFsdWVzKGN1cnJlbnRSZXF1ZXN0KVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wiZXhlY3V0ZUN1cnJlbnRSZXF1ZXN0IHJlcXVlc3RcIiwge1xuICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsXG4gICAgICBodHRwTWV0aG9kOiBjdXJyZW50UmVxdWVzdC5odHRwTWV0aG9kKCksXG4gICAgICBodHRwVmVyc2lvbjogY3VycmVudFJlcXVlc3QuaHR0cFZlcnNpb24oKSxcbiAgICAgIHBhdGg6IHJlZGFjdG9yLnJlZGFjdFBhdGgoY3VycmVudFJlcXVlc3QucGF0aCgpLCBzZW5zaXRpdmVWYWx1ZXMpLFxuICAgICAgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RoXG4gICAgfV0pXG5cbiAgICBpZiAodGhpcy5faXNXZWJzb2NrZXRVcGdyYWRlKGN1cnJlbnRSZXF1ZXN0KSkge1xuICAgICAgdGhpcy5fdXBncmFkZVRvV2Vic29ja2V0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIFdlIGFyZSBkb25lIHBhcnNpbmcgdGhlIGdpdmVuIHJlcXVlc3QgYW5kIGNhbiB0aGVvcmV0aWNhbGx5IHN0YXJ0IHBhcnNpbmcgYSBuZXcgb25lLCBiZWZvcmUgdGhlIGN1cnJlbnQgcmVxdWVzdCBpcyBkb25lIC0gc28gcmVzZXQgdGhlIHN0YXRlLlxuICAgIHRoaXMuc3RhdGUgPSBcImluaXRpYWxcIlxuXG4gICAgY29uc3QgcmVxdWVzdFJ1bm5lciA9IG5ldyBSZXF1ZXN0UnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIHJlcXVlc3Q6IGN1cnJlbnRSZXF1ZXN0XG4gICAgfSlcblxuICAgIHRoaXMucmVxdWVzdFJ1bm5lcnMucHVzaChyZXF1ZXN0UnVubmVyKVxuXG4gICAgcmVxdWVzdFJ1bm5lci5ldmVudHMub24oXCJkb25lXCIsIHRoaXMucmVxdWVzdERvbmUpXG4gICAgcmVxdWVzdFJ1bm5lci5ydW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb24gd3JpdGUuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvbldyaXRlKGRhdGEpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHN0YXJ0XCIsIHtcbiAgICAgIGNsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LFxuICAgICAgbGVuZ3RoOiBkYXRhLmxlbmd0aCxcbiAgICAgIHN0YXRlOiB0aGlzLnN0YXRlLFxuICAgIH1dKVxuXG4gICAgaWYgKHRoaXMud2Vic29ja2V0U2Vzc2lvbikge1xuICAgICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLm9uRGF0YShkYXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8qKlxuICAgICAgICogUmVtYWluaW5nLlxuICAgICAgICogQHR5cGUge0J1ZmZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIGxldCByZW1haW5pbmcgPSBkYXRhXG5cbiAgICAgIHdoaWxlIChyZW1haW5pbmcpIHtcbiAgICAgICAgaWYgKHJlbWFpbmluZy5sZW5ndGggPD0gMCkgYnJlYWtcblxuICAgICAgICBpZiAodGhpcy5zdGF0ZSA9PSBcImluaXRpYWxcIikge1xuICAgICAgICAgIGNvbnN0IHJlbWFpbmluZ0xlbmd0aCA9IHJlbWFpbmluZy5sZW5ndGhcblxuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgY3JlYXRpbmcgcmVxdWVzdCBwYXJzZXJcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCByZW1haW5pbmdMZW5ndGh9XSlcbiAgICAgICAgICB0aGlzLmN1cnJlbnRSZXF1ZXN0ID0gbmV3IFJlcXVlc3Qoe2NsaWVudDogdGhpcywgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICAgICAgICB0aGlzLmN1cnJlbnRSZXF1ZXN0LnJlcXVlc3RQYXJzZXIuZXZlbnRzLm9uKFwiZG9uZVwiLCB0aGlzLmV4ZWN1dGVDdXJyZW50UmVxdWVzdClcbiAgICAgICAgICB0aGlzLnN0YXRlID0gXCJyZXF1ZXN0U3RhcnRlZFwiXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5zdGF0ZSAhPSBcInJlcXVlc3RTdGFydGVkXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gc3RhdGUgZm9yIGNsaWVudDogJHt0aGlzLnN0YXRlfWApXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuY3VycmVudFJlcXVlc3QpIHRocm93IG5ldyBFcnJvcihcIk5vIGN1cnJlbnQgcmVxdWVzdFwiKVxuXG4gICAgICAgIHJlbWFpbmluZyA9IHRoaXMuY3VycmVudFJlcXVlc3QuZmVlZChyZW1haW5pbmcpXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgZmVkIHBhcnNlclwiLCB7XG4gICAgICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsXG4gICAgICAgICAgaGFzUmVtYWluaW5nOiBCb29sZWFuKHJlbWFpbmluZz8ubGVuZ3RoKSxcbiAgICAgICAgICByZW1haW5pbmdMZW5ndGg6IHJlbWFpbmluZz8ubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgcGFyc2VyQ29tcGxldGVkOiB0aGlzLmN1cnJlbnRSZXF1ZXN0Py5nZXRSZXF1ZXN0UGFyc2VyKCkuaGFzQ29tcGxldGVkXG4gICAgICAgIH1dKVxuXG4gICAgICAgIGlmIChyZW1haW5pbmcgJiYgcmVtYWluaW5nLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCByZXF1ZXN0UGFyc2VyID0gdGhpcy5jdXJyZW50UmVxdWVzdC5nZXRSZXF1ZXN0UGFyc2VyKClcblxuICAgICAgICAgIGlmICghcmVxdWVzdFBhcnNlci5oYXNDb21wbGV0ZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbWFpbmluZ0xlbmd0aCA9IHJlbWFpbmluZy5sZW5ndGhcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSB3YWl0aW5nIGZvciBtb3JlIGRhdGFcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCByZW1haW5pbmdMZW5ndGh9XSlcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhpcy5zdGF0ZSA9IFwiaW5pdGlhbFwiXG4gICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBwYXJzZXIgY29tcGxldGVkIHdpdGggcmVtYWluaW5nIGJ5dGVzXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcmVtYWluaW5nTGVuZ3RofV0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgZW5kXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgc3RhdGU6IHRoaXMuc3RhdGUsIHF1ZXVlTGVuZ3RoOiB0aGlzLnJlcXVlc3RSdW5uZXJzLmxlbmd0aH1dKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmhhbmRsZUJhZFJlcXVlc3QoZW5zdXJlRXJyb3IoZXJyb3IpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHdlYnNvY2tldCB1cGdyYWRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSByZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgd2Vic29ja2V0IHVwZ3JhZGUuXG4gICAqL1xuICBfaXNXZWJzb2NrZXRVcGdyYWRlKHJlcXVlc3QpIHtcbiAgICBjb25zdCB1cGdyYWRlSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJ1cGdyYWRlXCIpPy50b0xvd2VyQ2FzZSgpXG4gICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIEJvb2xlYW4odXBncmFkZUhlYWRlciA9PSBcIndlYnNvY2tldFwiICYmIGNvbm5lY3Rpb25IZWFkZXI/LmluY2x1ZGVzKFwidXBncmFkZVwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZ3JhZGUgdG8gd2Vic29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfdXBncmFkZVRvV2Vic29ja2V0KCkge1xuICAgIGlmICghdGhpcy5jdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG5cbiAgICBjb25zdCBzZWNXZWJzb2NrZXRLZXkgPSB0aGlzLmN1cnJlbnRSZXF1ZXN0LmhlYWRlcihcInNlYy13ZWJzb2NrZXQta2V5XCIpXG5cbiAgICBpZiAoIXNlY1dlYnNvY2tldEtleSkge1xuICAgICAgdGhpcy5fc2VuZEJhZFVwZ3JhZGVSZXNwb25zZShcIk1pc3NpbmcgU2VjLVdlYlNvY2tldC1LZXkgaGVhZGVyXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB3ZWJzb2NrZXRBY2NlcHRLZXkgPSBjcnlwdG8uY3JlYXRlSGFzaChcInNoYTFcIilcbiAgICAgIC51cGRhdGUoYCR7c2VjV2Vic29ja2V0S2V5fTI1OEVBRkE1LUU5MTQtNDdEQS05NUNBLUM1QUIwREM4NUIxMWAsIFwiYmluYXJ5XCIpXG4gICAgICAuZGlnZXN0KFwiYmFzZTY0XCIpXG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSB0aGlzLmN1cnJlbnRSZXF1ZXN0Lmh0dHBWZXJzaW9uKCkgfHwgXCIxLjFcIlxuICAgIGNvbnN0IHJlc3BvbnNlTGluZXMgPSBbXG4gICAgICBgSFRUUC8ke2h0dHBWZXJzaW9ufSAxMDEgU3dpdGNoaW5nIFByb3RvY29sc2AsXG4gICAgICBcIlVwZ3JhZGU6IHdlYnNvY2tldFwiLFxuICAgICAgXCJDb25uZWN0aW9uOiBVcGdyYWRlXCIsXG4gICAgICBgU2VjLVdlYlNvY2tldC1BY2NlcHQ6ICR7d2Vic29ja2V0QWNjZXB0S2V5fWAsXG4gICAgICBcIlwiLFxuICAgICAgXCJcIlxuICAgIF1cbiAgICBjb25zdCByZXNwb25zZSA9IHJlc3BvbnNlTGluZXMuam9pbihcIlxcclxcblwiKVxuXG4gICAgY29uc3QgbWVzc2FnZUhhbmRsZXJSZXNvbHZlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRNZXNzYWdlSGFuZGxlclJlc29sdmVyPy4oKVxuICAgIGxldCBtZXNzYWdlSGFuZGxlclxuICAgIGxldCBtZXNzYWdlSGFuZGxlclByb21pc2VcblxuICAgIGlmIChtZXNzYWdlSGFuZGxlclJlc29sdmVyKSB7XG4gICAgICBjb25zdCByZXNvbHZlZEhhbmRsZXIgPSBtZXNzYWdlSGFuZGxlclJlc29sdmVyKHtcbiAgICAgICAgY2xpZW50OiB0aGlzLFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIHJlcXVlc3Q6IHRoaXMuY3VycmVudFJlcXVlc3RcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlc29sdmVkVGhlbmFibGUgPSAvKiogQHR5cGUge3t0aGVuPzogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAocmVzb2x2ZWRIYW5kbGVyKVxuXG4gICAgICBpZiAocmVzb2x2ZWRUaGVuYWJsZT8udGhlbikge1xuICAgICAgICBtZXNzYWdlSGFuZGxlclByb21pc2UgPSAvKiogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlciB8IHZvaWQ+fSAqLyAocmVzb2x2ZWRIYW5kbGVyKVxuICAgICAgfSBlbHNlIGlmIChyZXNvbHZlZEhhbmRsZXIpIHtcbiAgICAgICAgbWVzc2FnZUhhbmRsZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJ9ICovIChyZXNvbHZlZEhhbmRsZXIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uID0gbmV3IFdlYnNvY2tldFNlc3Npb24oe1xuICAgICAgY2xpZW50OiB0aGlzLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgdXBncmFkZVJlcXVlc3Q6IHRoaXMuY3VycmVudFJlcXVlc3QsXG4gICAgICBtZXNzYWdlSGFuZGxlcjogbWVzc2FnZUhhbmRsZXIsXG4gICAgICBtZXNzYWdlSGFuZGxlclByb21pc2U6IG1lc3NhZ2VIYW5kbGVyUHJvbWlzZVxuICAgIH0pXG4gICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLmV2ZW50cy5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIC8vIFBhdXNlZCBzZXNzaW9ucyBzdXJ2aXZlIHRoZSBzb2NrZXQgY2xvc2U7IGRvbid0IGRlc3Ryb3koKS5cbiAgICAgIC8vIFRoZSBncmFjZS1leHBpcnkgcGF0aCAoX2ZpbmFsaXplR3JhY2VFeHBpcnkpIHdpbGwgZGVzdHJveVxuICAgICAgLy8gdGhlbSBwZXJtYW5lbnRseSBpZiByZXN1bWUgZG9lc24ndCBoYXBwZW4gaW4gdGltZS5cbiAgICAgIGlmICghdGhpcy53ZWJzb2NrZXRTZXNzaW9uPy5pc1BhdXNlZCgpKSB7XG4gICAgICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbj8uZGVzdHJveSgpXG4gICAgICB9XG4gICAgICB0aGlzLndlYnNvY2tldFNlc3Npb24gPSB1bmRlZmluZWRcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgIH0pXG4gICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLmV2ZW50cy5vbihcIm93bmVyc2hpcENsYWltZWRcIiwgKHtzZXNzaW9uSWR9KSA9PiB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwid2Vic29ja2V0U2Vzc2lvbk93bmVkXCIsIHtzZXNzaW9uSWR9KVxuICAgIH0pXG4gICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLmV2ZW50cy5vbihcIm93bmVyc2hpcFJlbGVhc2VkXCIsICh7c2Vzc2lvbklkfSkgPT4ge1xuICAgICAgdGhpcy5ldmVudHMuZW1pdChcIndlYnNvY2tldFNlc3Npb25SZWxlYXNlZFwiLCB7c2Vzc2lvbklkfSlcbiAgICB9KVxuICAgIHRoaXMuc3RhdGUgPSBcIndlYnNvY2tldFwiXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCByZXNwb25zZSlcbiAgICB2b2lkIHRoaXMud2Vic29ja2V0U2Vzc2lvbi5pbml0aWFsaXplQ2hhbm5lbCgpXG4gICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLnNlbmRTZXNzaW9uRXN0YWJsaXNoZWQoKVxuICB9XG5cbiAgcmVxdWVzdERvbmUgPSAoKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wicmVxdWVzdERvbmVcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBxdWV1ZUxlbmd0aDogdGhpcy5yZXF1ZXN0UnVubmVycy5sZW5ndGh9XSlcblxuICAgIHJldHVybiB0aGlzLl9kcmFpbkRvbmVSZXF1ZXN0cygpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB3aGlsZSBzZW5kaW5nIGRvbmUgcmVxdWVzdHNcIiwgZXJyb3IpXG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBkb25lIHJlcXVlc3RzIG9uZSBhdCBhIHRpbWUuIEEgcnVubmVyIGlzIHNoaWZ0ZWQgb3V0IG9mIHRoZSBxdWV1ZSBiZWZvcmVcbiAgICogaXRzIHJlc3BvbnNlIGZpbmlzaGVzIHNlbmRpbmcgKGFzeW5jIGNvbXByZXNzaW9uLCBmaWxlIHRyYW5zZmVyKSwgc28gYW5cbiAgICogb3ZlcmxhcHBpbmcgZHJhaW4gd291bGQgb3RoZXJ3aXNlIHBpY2sgdXAgdGhlIG5leHQgcnVubmVyIGFuZCByZW9yZGVyIHBpcGVsaW5lZFxuICAgKiBzb2NrZXQgd3JpdGVzLiBDYWxscyB0aGF0IGFycml2ZSB3aGlsZSBhIGRyYWluIGlzIGFjdGl2ZSBhcmUgZm9sZGVkIGludG8gaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgZG9uZSByZXNwb25zZSBoYXMgYmVlbiBzZW50LlxuICAgKi9cbiAgYXN5bmMgX2RyYWluRG9uZVJlcXVlc3RzKCkge1xuICAgIGlmICh0aGlzLl9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSkge1xuICAgICAgdGhpcy5fZG9uZVJlcXVlc3RzRHJhaW5QZW5kaW5nID0gdHJ1ZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fZG9uZVJlcXVlc3RzRHJhaW5BY3RpdmUgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgZG8ge1xuICAgICAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcgPSBmYWxzZVxuICAgICAgICBhd2FpdCB0aGlzLnNlbmREb25lUmVxdWVzdHMoKVxuICAgICAgfSB3aGlsZSAodGhpcy5fZG9uZVJlcXVlc3RzRHJhaW5QZW5kaW5nKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSA9IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2VuZERvbmVSZXF1ZXN0cygpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgcmVxdWVzdFJ1bm5lciA9IHRoaXMucmVxdWVzdFJ1bm5lcnNbMF1cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSByZXF1ZXN0UnVubmVyPy5nZXRSZXF1ZXN0KClcblxuICAgICAgaWYgKHJlcXVlc3RSdW5uZXI/LmdldFN0YXRlKCkgPT0gXCJkb25lXCIpIHtcbiAgICAgICAgY29uc3QgaHR0cFZlcnNpb24gPSByZXF1ZXN0Lmh0dHBWZXJzaW9uKClcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKT8udHJpbSgpXG4gICAgICAgIGNvbnN0IHNob3VsZENsb3NlQ29ubmVjdGlvbiA9IHRoaXMuc2hvdWxkQ2xvc2VDb25uZWN0aW9uKHJlcXVlc3QpXG5cbiAgICAgICAgdGhpcy5yZXF1ZXN0UnVubmVycy5zaGlmdCgpXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmREb25lUmVxdWVzdHMgc2hpZnRlZCBxdWV1ZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHF1ZXVlTGVuZ3RoOiB0aGlzLnJlcXVlc3RSdW5uZXJzLmxlbmd0aH1dKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZFJlc3BvbnNlKHJlcXVlc3RSdW5uZXIpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BWZWxvY2lvdXMgY2xpZW50ICR7dGhpcy5jbGllbnRDb3VudH0gZmFpbGVkIHdoaWxlIHNlbmRpbmcgcmVzcG9uc2VgLCBlcnJvcl0pXG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5jdXJyZW50UmVxdWVzdCA9PT0gcmVxdWVzdCAmJiB0aGlzLnN0YXRlID09PSBcImluaXRpYWxcIikgdGhpcy5jdXJyZW50UmVxdWVzdCA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kRG9uZVJlcXVlc3RzXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgY29ubmVjdGlvbkhlYWRlciwgaHR0cFZlcnNpb259XSlcblxuICAgICAgICBpZiAoc2hvdWxkQ2xvc2VDb25uZWN0aW9uKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW2BDbG9zaW5nIHRoZSBjb25uZWN0aW9uIGJlY2F1c2UgJHtodHRwVmVyc2lvbn0gYW5kIGNvbm5lY3Rpb24gaGVhZGVyICR7Y29ubmVjdGlvbkhlYWRlcn1gLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnR9XSlcbiAgICAgICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYSBmaW5pc2hlZCByZXNwb25zZSB0byB0aGUgY2xpZW50LiBPd25zIHRoZSBmcmFtZXdvcmstb3duZWRcbiAgICogYFZhcnk6IEFjY2VwdC1FbmNvZGluZ2AgZGltZW5zaW9uIChlbWl0dGVkIGZvciBldmVyeSBzZWxlY3RlZFxuICAgKiByZXByZXNlbnRhdGlvbiDigJQgdHJhbnNmb3JtZWQsIGlkZW50aXR5LCA0MDYsIGFuZCBmaWxlIOKAlCBhbmQgZm9yXG4gICAqIGhlYWRlci1wcmVzZW50IGFuZCBoZWFkZXItYWJzZW50IHJlcXVlc3RzIGFsaWtlLCBzbyBpdCBpcyBzdGFibGUgYWNyb3NzXG4gICAqIHJlcXVlc3RzIG9uIHRoZSBzYW1lIGNvbm5lY3Rpb247IG5ldmVyIGFkZGVkIHdoZW4gY29tcHJlc3Npb24gaXMgZGlzYWJsZWQsXG4gICAqIHRoZSByZXNwb25zZSBpcyB0cnVseSBib2R5bGVzcywgb3IgdGhlIGFwcGxpY2F0aW9uIHN1cHBsaWVkIGEgZml4ZWRcbiAgICogYENvbnRlbnQtRW5jb2RpbmdgKSBhbmQgdGhlIGZpbGUgNDA2IHJ1bGUgKGEgc2VuZEZpbGUgcmVzcG9uc2Ugd2hvc2VcbiAgICogY2xpZW50IGZvcmJpZHMgaWRlbnRpdHkgaXMgYW5zd2VyZWQgd2l0aCB0aGUgZW1wdHkgNDA2LCB0aGUgZmlsZSBpcyBuZXZlclxuICAgKiBvcGVuZWQgb3Igc3RyZWFtZWQsIGFuZCBgb25GaW5pc2hlZGAgc2V0dGxlcyBvbmNlIGFzIFwiY29tcGxldGVkXCIpLlxuICAgKiBAcGFyYW0ge1JlcXVlc3RSdW5uZXJ9IHJlcXVlc3RSdW5uZXIgLSBSZXF1ZXN0IHJ1bm5lci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNlbmRSZXNwb25zZShyZXF1ZXN0UnVubmVyKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBkaWdnKHJlcXVlc3RSdW5uZXIsIFwicmVzcG9uc2VcIilcbiAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWVzdFJ1bm5lci5nZXRSZXF1ZXN0KClcbiAgICBjb25zdCBmaWxlUGF0aCA9IHJlc3BvbnNlLmdldEZpbGVQYXRoKClcbiAgICBjb25zdCBmaWxlT25GaW5pc2hlZCA9IHJlc3BvbnNlLmdldEZpbGVPbkZpbmlzaGVkKClcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25IZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImNvbm5lY3Rpb25cIik/LnRvTG93ZXJDYXNlKCk/LnRyaW0oKVxuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gcmVxdWVzdC5odHRwVmVyc2lvbigpXG4gICAgY29uc3Qgc2hvdWxkQ2xvc2VDb25uZWN0aW9uID0gdGhpcy5zaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdClcbiAgICBjb25zdCBoYXNGaWxlUGF0aCA9IHR5cGVvZiBmaWxlUGF0aCA9PT0gXCJzdHJpbmdcIiAmJiBmaWxlUGF0aC5sZW5ndGggPiAwXG4gICAgY29uc3QgYm9keSA9IGhhc0ZpbGVQYXRoID8gbnVsbCA6IHJlc3BvbnNlLmdldEJvZHkoKVxuICAgIGNvbnN0IGJvZHlJc1N0cmluZyA9IHR5cGVvZiBib2R5ID09PSBcInN0cmluZ1wiXG4gICAgY29uc3QgYm9keUlzQmluYXJ5ID0gYm9keSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXlcblxuICAgIGlmICghaGFzRmlsZVBhdGggJiYgIWJvZHlJc1N0cmluZyAmJiAhYm9keUlzQmluYXJ5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJlc3BvbnNlIGJvZHkgdG8gYmUgYSBzdHJpbmcgb3IgVWludDhBcnJheSwgZ290ICR7dHlwZW9mIGJvZHl9YClcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNlbmRSZXNwb25zZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGNvbm5lY3Rpb25IZWFkZXIsIGh0dHBWZXJzaW9ufSlcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgcGF5bG9hZFwiLCB7XG4gICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgIGhhc0ZpbGVQYXRoLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBib2R5SXNCaW5hcnksXG4gICAgICBib2R5SXNTdHJpbmdcbiAgICB9XSlcblxuICAgIGlmIChzaG91bGRDbG9zZUNvbm5lY3Rpb24pIHtcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbm5lY3Rpb25cIiwgXCJDbG9zZVwiKVxuICAgIH0gZWxzZSBpZiAoaHR0cFZlcnNpb24gPT0gXCIxLjBcIiAmJiBjb25uZWN0aW9uSGVhZGVyID09IFwia2VlcC1hbGl2ZVwiKSB7XG4gICAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJDb25uZWN0aW9uXCIsIFwiS2VlcC1BbGl2ZVwiKVxuICAgIH1cblxuICAgIC8vIFBlciBSRkMgNzIzMCDCpzMuMy4zLCByZXNwb25zZXMgd2l0aCBzdGF0dXMgY29kZXMgMXh4LCAyMDQsIGFuZCAzMDRcbiAgICAvLyBNVVNUIE5PVCBjYXJyeSBhIG1lc3NhZ2UgYm9keSBhbmQgTVVTVCBOT1QgaW5jbHVkZSBDb250ZW50LUxlbmd0aFxuICAgIC8vICh3aXRoIGEgbmFycm93IDMwNCBleGNlcHRpb24gd2UgZG9uJ3QgbGVhbiBvbikuIFNlbmRpbmcgb25lIHdvdWxkXG4gICAgLy8gZGVzeW5jaHJvbml6ZSBrZWVwLWFsaXZlIGNsaWVudHMgd2FpdGluZyBmb3IgYnl0ZXMgdGhhdCBuZXZlclxuICAgIC8vIGFycml2ZSDigJQgZHJvcCB0aGUgYm9keSBlbnRpcmVseSBmb3IgdGhvc2UgY29kZXMuXG4gICAgY29uc3QgaXNCb2R5bGVzc1N0YXR1cyA9IGlzTm9Cb2R5U3RhdHVzQ29kZShyZXNwb25zZS5nZXRTdGF0dXNDb2RlKCkpXG5cbiAgICAvLyBIRUFEIHJlc3BvbnNlcyBzZWxlY3QgYW5kIGNvbXB1dGUgdGhlIGV4YWN0IHNhbWUgcmVwcmVzZW50YXRpb24gaGVhZGVycyBhcyB0aGVcbiAgICAvLyBlcXVpdmFsZW50IEdFVCAoaW5jbHVkaW5nIENvbnRlbnQtTGVuZ3RoIGFuZCBhbnkgbmVnb3RpYXRlZCBDb250ZW50LUVuY29kaW5nKSxcbiAgICAvLyBidXQgbm8gYnVmZmVyZWQgb3IgZmlsZSBib2R5IGlzIGVtaXR0ZWQgYmVsb3cuXG4gICAgY29uc3QgaXNIZWFkUmVxdWVzdCA9IHJlcXVlc3QuaHR0cE1ldGhvZCgpID09IFwiSEVBRFwiXG5cbiAgICAvKiogQHR5cGUge3N0cmluZyB8IFVpbnQ4QXJyYXkgfCBudWxsfSAqL1xuICAgIGxldCBib2R5VG9FbWl0ID0gYm9keVxuXG4gICAgLy8gVGhlIHJlc3BvbnNlIHJlcHJlc2VudGF0aW9uIGNhbiBkZXBlbmQgb24gdGhlIGNsaWVudCdzIEFjY2VwdC1FbmNvZGluZzpcbiAgICAvLyB0aGUgc2FtZSByZXF1ZXN0IGlzIGFuc3dlcmVkIHdpdGggYW4gaWRlbnRpdHkgYm9keSAob3IgYSBmaWxlKSB3aGVuXG4gICAgLy8gaWRlbnRpdHkgaXMgYWNjZXB0YWJsZSBhbmQgd2l0aCBhbiBlbXB0eSA0MDYgd2hlbiBpdCBpcyBmb3JiaWRkZW4uXG4gICAgY29uc3QgY29tcHJlc3Npb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlckNvbXByZXNzaW9uKClcbiAgICBjb25zdCBuZWdvdGlhdGVkID0gY29tcHJlc3Npb24uZW5hYmxlZCA/IG5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhyZXF1ZXN0LmhlYWRlcihcImFjY2VwdC1lbmNvZGluZ1wiKSkgOiB1bmRlZmluZWRcbiAgICAvLyBBbiBhcHBsaWNhdGlvbi1zdXBwbGllZCBDb250ZW50LUVuY29kaW5nIGlzIGFuIGFwcGxpY2F0aW9uLW93bmVkXG4gICAgLy8gcmVwcmVzZW50YXRpb24gY29udHJhY3QsIGNhcHR1cmVkIGJlZm9yZSB0aGUgZnJhbWV3b3JrIG1heSBhZGQgaXRzIG93bi5cbiAgICAvLyBBIGZpbGUgY2Fycnlpbmcgb25lIGlzIGEgZml4ZWQsIGFwcGxpY2F0aW9uLW93bmVkIHJlcHJlc2VudGF0aW9uOiB0aGVcbiAgICAvLyBmcmFtZXdvcmsgbmVpdGhlciBuZWdvdGlhdGVzIGl0IG5vciByZS1hZHZlcnRpc2VzIGl0LCBzbyBpdCBpcyBuZXZlciBhXG4gICAgLy8gY2FuZGlkYXRlIGZvciB0aGUgaWRlbnRpdHktb25seSA0MDYuXG4gICAgY29uc3QgaGFzQXBwbGljYXRpb25Db250ZW50RW5jb2RpbmcgPSByZXNwb25zZS5nZXRIZWFkZXIoXCJDb250ZW50LUVuY29kaW5nXCIpLmxlbmd0aCA+IDBcbiAgICAvLyBBIGZpbGUgcmVzcG9uc2Ugb25seSBldmVyIHNlcnZlcyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50YXRpb246IHdoZW5ldmVyXG4gICAgLy8gdGhlIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IChpbmNsdWRpbmcgdGhlIG5vdC1hY2NlcHRhYmxlIGNhc2Ugd2hlcmUgbm9cbiAgICAvLyBjb2RpbmcgYXBwbGllcykgYW5kIHRoZSBmaWxlIGRvZXMgbm90IGNhcnJ5IGFuIGFwcGxpY2F0aW9uLXN1cHBsaWVkXG4gICAgLy8gQ29udGVudC1FbmNvZGluZywgdGhlIGZpbGUgaXMgcmVqZWN0ZWQgd2l0aCB0aGUgZW1wdHkgNDA2LiBBIHRydWx5XG4gICAgLy8gYm9keWxlc3Mgc3RhdHVzIHNlbGVjdHMgbm8gcmVwcmVzZW50YXRpb24sIHNvIGl0IGlzIG5ldmVyIHJlamVjdGVkIGhlcmUuXG4gICAgY29uc3QgaXNGaWxlTm90QWNjZXB0YWJsZSA9IGhhc0ZpbGVQYXRoICYmICEhbmVnb3RpYXRlZCAmJiAoXCJub3RBY2NlcHRhYmxlXCIgaW4gbmVnb3RpYXRlZCB8fCBuZWdvdGlhdGVkLmlkZW50aXR5QWNjZXB0YWJsZSA9PT0gZmFsc2UpICYmIGhhc0FwcGxpY2F0aW9uQ29udGVudEVuY29kaW5nID09PSBmYWxzZSAmJiAhaXNCb2R5bGVzc1N0YXR1c1xuXG4gICAgaWYgKCFpc0JvZHlsZXNzU3RhdHVzKSB7XG4gICAgICBsZXQgY29udGVudExlbmd0aFxuXG4gICAgICBpZiAoaGFzRmlsZVBhdGgpIHtcbiAgICAgICAgaWYgKGlzRmlsZU5vdEFjY2VwdGFibGUpIHtcbiAgICAgICAgICAvLyBUaGUgY2xpZW50IGZvcmJpZHMgaWRlbnRpdHkgYW5kIGZpbGVzIGFyZSBvbmx5IGV2ZXIgc2VudCBpZGVudGl0eTpcbiAgICAgICAgICAvLyBhbnN3ZXIgd2l0aCB0aGUgc2FtZSBlbXB0eSA0MDYgZXZlcnkgb3RoZXIgcmVwcmVzZW50YXRpb24gcGF0aFxuICAgICAgICAgIC8vIHVzZXMuIFRoZSBmaWxlIGlzIG5ldmVyIG9wZW5lZCBvciBzdHJlYW1lZDsgdGhlIGNvbW1pdHRlZCA0MDZcbiAgICAgICAgICAvLyBzdGlsbCBzZXR0bGVzIG9uRmluaXNoZWQgYXMgXCJjb21wbGV0ZWRcIiBzbyBhcHBsaWNhdGlvbiBjbGVhbnVwIHJ1bnNcbiAgICAgICAgICAvLyBleGFjdGx5IG9uY2UuXG4gICAgICAgICAgcmVzcG9uc2Uuc2V0U3RhdHVzKDQwNilcbiAgICAgICAgICByZXNwb25zZS5zZXRCb2R5KFwiXCIpXG4gICAgICAgICAgYm9keVRvRW1pdCA9IFwiXCJcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gMFxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5ydW5GaWxlT25GaW5pc2hlZCh7ZmlsZVBhdGgsIG9uRmluaXNoZWQ6IGZpbGVPbkZpbmlzaGVkLCByZXN1bHQ6IFwiY29tcGxldGVkXCJ9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aClcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gc3RhdHMuc2l6ZVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTdHJpbmcgYm9kaWVzIGFyZSBVVEYtOCBmcmFtZWQsIHNvIHRoZSBidWZmZXJlZCBieXRlcyBhcmUgdGhlIFVURi04IGVuY29kaW5nO1xuICAgICAgICAvLyBVaW50OEFycmF5IGJvZGllcyBhcmUgYWxyZWFkeSB0aGUgZXhhY3Qgd2lyZSBieXRlcy5cbiAgICAgICAgY29uc3QgYm9keUJ1ZmZlciA9IGJvZHlJc1N0cmluZyA/IEJ1ZmZlci5mcm9tKGJvZHksIFwidXRmOFwiKSA6IEJ1ZmZlci5mcm9tKGJvZHkpXG4gICAgICAgIGNvbnN0IGNvbXByZXNzaW9uUmVzdWx0ID0gYXdhaXQgYXBwbHlSZXNwb25zZUNvbXByZXNzaW9uKHtcbiAgICAgICAgICBib2R5QnVmZmVyLFxuICAgICAgICAgIGNvbXByZXNzaW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlckNvbXByZXNzaW9uKCksXG4gICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICByZXNwb25zZVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChjb21wcmVzc2lvblJlc3VsdC5vdXRjb21lID09IFwibm90LWFjY2VwdGFibGVcIikge1xuICAgICAgICAgIC8vIFRoZSBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBhbmQgbm8gc3VwcG9ydGVkIGNvZGluZyBpcyBhY2NlcHRhYmxlOiBhbnN3ZXJcbiAgICAgICAgICAvLyB3aXRoIGFuIGVtcHR5IDQwNiBpbnN0ZWFkIG9mIGFuIHVuYWNjZXB0YWJsZSByZXByZXNlbnRhdGlvbi5cbiAgICAgICAgICByZXNwb25zZS5zZXRTdGF0dXMoNDA2KVxuICAgICAgICAgIHJlc3BvbnNlLnNldEJvZHkoXCJcIilcbiAgICAgICAgICBib2R5VG9FbWl0ID0gXCJcIlxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSAwXG4gICAgICAgIH0gZWxzZSBpZiAoY29tcHJlc3Npb25SZXN1bHQub3V0Y29tZSA9PSBcImNvbXByZXNzZWRcIikge1xuICAgICAgICAgIGJvZHlUb0VtaXQgPSBjb21wcmVzc2lvblJlc3VsdC5ib2R5XG4gICAgICAgICAgY29udGVudExlbmd0aCA9IGNvbXByZXNzaW9uUmVzdWx0LmJvZHkubGVuZ3RoXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29udGVudExlbmd0aCA9IGJvZHlCdWZmZXIubGVuZ3RoXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUmVtb3ZlIGFueSBhcHBsaWNhdGlvbiBwcmUtc2V0IENvbnRlbnQtTGVuZ3RoIChhbnkgY2FzaW5nKSBzbyBleGFjdGx5IG9uZVxuICAgICAgLy8gcmVjb21wdXRlZCB2YWx1ZSBnb2VzIG9uIHRoZSB3aXJlLlxuICAgICAgcmVzcG9uc2UucmVtb3ZlSGVhZGVyKFwiQ29udGVudC1MZW5ndGhcIilcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtTGVuZ3RoXCIsIGNvbnRlbnRMZW5ndGgpXG4gICAgfVxuXG4gICAgLy8gRnJhbWV3b3JrLW93bmVkIFZhcnkgZGltZW5zaW9uOiB3aGVuZXZlciBjb21wcmVzc2lvbiBpcyBlbmFibGVkIGFuZCBhXG4gICAgLy8gcmVwcmVzZW50YXRpb24gd2FzIHNlbGVjdGVkLCB0aGUgcmVzcG9uc2UgZGVwZW5kcyBvbiBBY2NlcHQtRW5jb2RpbmcsXG4gICAgLy8gc28gY2FjaGVzIG11c3Qga2V5IG9uIGl0LiBBcHBsaWVkIGlkZW50aWNhbGx5IGZvciBldmVyeSBvdXRjb21lXG4gICAgLy8gKHRyYW5zZm9ybWVkLCBpZGVudGl0eSwgNDA2LCBmaWxlKSBhbmQgZm9yIGhlYWRlci1wcmVzZW50IGFuZFxuICAgIC8vIGhlYWRlci1hYnNlbnQgcmVxdWVzdHMgYWxpa2UsIHNvIHRoZSBoZWFkZXIgaXMgc3RhYmxlIGFjcm9zcyByZXF1ZXN0cyBvblxuICAgIC8vIHRoZSBzYW1lIGNvbm5lY3Rpb24uIEEgdHJ1bHkgYm9keWxlc3MgcmVzcG9uc2Ugc2VsZWN0cyBubyByZXByZXNlbnRhdGlvblxuICAgIC8vIGFuZCBjYXJyaWVzIG5vIGRpbWVuc2lvbjsgYW4gYXBwbGljYXRpb24tc3VwcGxpZWQgQ29udGVudC1FbmNvZGluZyBrZWVwc1xuICAgIC8vIHRoZSByZXByZXNlbnRhdGlvbiBjb250cmFjdCBhcHBsaWNhdGlvbi1vd25lZCBhbmQgaXMgbmV2ZXIgcmUtYWR2ZXJ0aXNlZC5cbiAgICBpZiAobmVnb3RpYXRlZCAmJiAhaXNCb2R5bGVzc1N0YXR1cyAmJiBoYXNBcHBsaWNhdGlvbkNvbnRlbnRFbmNvZGluZyA9PT0gZmFsc2UpIHtcbiAgICAgIGFkZEFjY2VwdEVuY29kaW5nVG9WYXJ5KHJlc3BvbnNlKVxuICAgIH1cblxuICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkRhdGVcIiwgZGF0ZS50b1VUQ1N0cmluZygpKVxuICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIlNlcnZlclwiLCBcIlZlbG9jaW91c1wiKVxuXG4gICAgbGV0IGhlYWRlcnMgPSBcIlwiXG5cbiAgICBoZWFkZXJzICs9IGBIVFRQLyR7cmVxdWVzdC5odHRwVmVyc2lvbigpfSAke3Jlc3BvbnNlLmdldFN0YXR1c0NvZGUoKX0gJHtyZXNwb25zZS5nZXRTdGF0dXNNZXNzYWdlKCl9XFxyXFxuYFxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gcmVzcG9uc2UuaGVhZGVycykge1xuICAgICAgZm9yIChjb25zdCBoZWFkZXJWYWx1ZSBvZiByZXNwb25zZS5oZWFkZXJzW2hlYWRlcktleV0pIHtcbiAgICAgICAgaGVhZGVycyArPSBgJHtoZWFkZXJLZXl9OiAke2hlYWRlclZhbHVlfVxcclxcbmBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBoZWFkZXJzICs9IFwiXFxyXFxuXCJcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgaGVhZGVycylcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgaGVhZGVycyBlbWl0dGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgaGVhZGVyc0xlbmd0aDogaGVhZGVycy5sZW5ndGh9XSlcblxuICAgIC8vIEEgbmVnb3RpYXRlZCBmaWxlIDQwNiBpcyBmdWxseSBjb21taXR0ZWQgYWJvdmUgKHN0YXR1cyA0MDYsIGVtcHR5IGJvZHkpXG4gICAgLy8gYW5kIGl0cyBvbkZpbmlzaGVkIGFscmVhZHkgc2V0dGxlZCBvbmNlIGFzIFwiY29tcGxldGVkXCI6IGV2ZXJ5IGZpbGUtb3V0cHV0XG4gICAgLy8gYnJhbmNoIGJlbG93IGlzIGJ5cGFzc2VkIHNvIG5vIGZpbGUgZXZlbnQgaXMgZW1pdHRlZCBhbmQgdGhlIGNhbGxiYWNrIGlzXG4gICAgLy8gbmV2ZXIgc2V0dGxlZCBhIHNlY29uZCB0aW1lLiBUaGlzIGhvbGRzIGZvciBib3RoIEdFVCBhbmQgSEVBRC5cbiAgICBpZiAoaXNGaWxlTm90QWNjZXB0YWJsZSkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZFJlc3BvbnNlIGZpbGUgYm9keSBzdXBwcmVzc2VkIGZvciA0MDZcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBmaWxlUGF0aH1dKVxuICAgIH0gZWxzZSBpZiAoaXNCb2R5bGVzc1N0YXR1cykge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZFJlc3BvbnNlIGJvZHkgc3VwcHJlc3NlZCBmb3Igbm8tYm9keSBzdGF0dXNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBzdGF0dXNDb2RlOiByZXNwb25zZS5nZXRTdGF0dXNDb2RlKCl9XSlcbiAgICAgIC8vIEEgYm9keWxlc3Mgc3RhdHVzICgxeHgvMjA0LzMwNCkgc2VsZWN0cyBubyByZXByZXNlbnRhdGlvbiwgc28gbm8gZmlsZVxuICAgICAgLy8gYm9keSBvciBmcmFtZXdvcmsgVmFyeSBpcyBlbWl0dGVkLiBUaGUgZmlsZS1vd25lcnNoaXAgcGF0aCBzdGlsbCBzZXR0bGVzXG4gICAgICAvLyBvbkZpbmlzaGVkIGV4YWN0bHkgb25jZSBhcyBcImNvbXBsZXRlZFwiIChub3RoaW5nIHdhcyBhYm9ydGVkKSDigJQgZXZlbiB3aGVuXG4gICAgICAvLyB0aGUgY2xpZW50IGZvcmJpZHMgaWRlbnRpdHkg4oCUIHByZXNlcnZpbmcgdGhlIHByZS1jaGFuZ2Ugc2V0dGxlbWVudC5cbiAgICAgIGlmIChoYXNGaWxlUGF0aCkgYXdhaXQgdGhpcy5zZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgZmFsc2UsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSBpZiAoaXNIZWFkUmVxdWVzdCkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZFJlc3BvbnNlIGJvZHkgc3VwcHJlc3NlZCBmb3IgSEVBRCByZXF1ZXN0XCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudH1dKVxuICAgICAgaWYgKGhhc0ZpbGVQYXRoKSBhd2FpdCB0aGlzLnNlbmRGaWxlT3V0cHV0KGZpbGVQYXRoLCBmYWxzZSwgZmlsZU9uRmluaXNoZWQpXG4gICAgfSBlbHNlIGlmIChoYXNGaWxlUGF0aCkge1xuICAgICAgYXdhaXQgdGhpcy5zZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgdHJ1ZSwgZmlsZU9uRmluaXNoZWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgYm9keVRvRW1pdClcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IGVtaXR0ZWRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBib2R5TGVuZ3RoOiBib2R5VG9FbWl0ID8gYm9keVRvRW1pdC5sZW5ndGggOiAwfV0pXG4gICAgfVxuXG4gICAgYXdhaXQgcmVxdWVzdFJ1bm5lci5sb2dDb21wbGV0ZWRSZXF1ZXN0KClcblxuICAgIGlmIChcImdldFJlcXVlc3RQYXJzZXJcIiBpbiByZXF1ZXN0KSB7XG4gICAgICBjb25zdCBodHRwUmVxdWVzdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovIChyZXF1ZXN0KVxuICAgICAgaHR0cFJlcXVlc3QuZ2V0UmVxdWVzdFBhcnNlcigpLmRlc3Ryb3koKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgZmlsZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtib29sZWFufSBzZW5kQm9keSAtIFdoZXRoZXIgdGhlIGZpbGUgYm9keSBzaG91bGQgYmUgc2VudC5cbiAgICogQHBhcmFtIHsoKHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBudWxsfSBvbkZpbmlzaGVkIC0gQ29tcGxldGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNlbmRGaWxlT3V0cHV0KGZpbGVQYXRoLCBzZW5kQm9keSwgb25GaW5pc2hlZCkge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRGaWxlT3V0cHV0IHN0YXJ0XCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGh9XSlcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgICAgbGV0IHNldHRsZW1lbnQgPSBudWxsXG4gICAgICBjb25zdCBzZXR0bGUgPSAoLyoqIEB0eXBlIHtcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCJ9ICovIHRyYW5zZmVyUmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVtZW50KSByZXR1cm4gc2V0dGxlbWVudFxuXG4gICAgICAgIHRoaXMucGVuZGluZ0ZpbGVSZXNwb25zZXMuZGVsZXRlKHNldHRsZSlcbiAgICAgICAgc2V0dGxlbWVudCA9IHRoaXMucnVuRmlsZU9uRmluaXNoZWQoe2ZpbGVQYXRoLCBvbkZpbmlzaGVkLCByZXN1bHQ6IHRyYW5zZmVyUmVzdWx0fSlcbiAgICAgICAgICAuZmluYWxseSgoKSA9PiByZXNvbHZlKHRyYW5zZmVyUmVzdWx0KSlcblxuICAgICAgICByZXR1cm4gc2V0dGxlbWVudFxuICAgICAgfVxuXG4gICAgICB0aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzLmFkZChzZXR0bGUpXG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiZmlsZVwiLCB7ZmlsZVBhdGgsIHNlbmRCb2R5LCBzZXR0bGV9KVxuICAgIH0pXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kRmlsZU91dHB1dCBkb25lXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGgsIHJlc3VsdH1dKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBmaWxlIGNvbXBsZXRpb24gY2FsbGJhY2sgd2l0aG91dCBhbGxvd2luZyBjbGVhbnVwIGZhaWx1cmVzIHRvIHJlcGxhY2UgdGhlIGNvbW1pdHRlZCByZXNwb25zZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb21wbGV0aW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcGFyYW0geygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IGFyZ3Mub25GaW5pc2hlZCAtIENvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwifSBhcmdzLnJlc3VsdCAtIFRyYW5zZmVyIHJlc3VsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2FsbGJhY2sgY2xlYW51cCBhbmQgZXJyb3IgcmVwb3J0aW5nIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIHJ1bkZpbGVPbkZpbmlzaGVkKHtmaWxlUGF0aCwgb25GaW5pc2hlZCwgcmVzdWx0fSkge1xuICAgIGlmICghb25GaW5pc2hlZCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgb25GaW5pc2hlZChyZXN1bHQpXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gZW5zdXJlRXJyb3IoY2F1Z2h0RXJyb3IpXG5cbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZpbGUgcmVzcG9uc2Ugb25GaW5pc2hlZCBjYWxsYmFjayBmYWlsZWRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBmaWxlUGF0aCwgcmVzdWx0fSwgZXJyb3JdKVxuXG4gICAgICBjb25zdCBlcnJvclBheWxvYWQgPSB7XG4gICAgICAgIGNvbnRleHQ6IHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGgsIHJlc3VsdCwgc3RhZ2U6IFwic2VuZC1maWxlLW9uLWZpbmlzaGVkXCJ9LFxuICAgICAgICBlcnJvclxuICAgICAgfVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIGVycm9yUGF5bG9hZClcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLmVycm9yUGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWJvcnRzIGFsbCBmaWxlIHJlc3BvbnNlcyBhd2FpdGluZyB0cmFuc3BvcnQgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZW5kaW5nIGNhbGxiYWNrcyBzZXR0bGUuXG4gICAqL1xuICBhc3luYyBhYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCkge1xuICAgIGF3YWl0IFByb21pc2UuYWxsKFsuLi50aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzXS5tYXAoKHNldHRsZSkgPT4gc2V0dGxlKFwiYWJvcnRlZFwiKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgY2xvc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gcmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIHNob3VsZCBiZSBjbG9zZWQuXG4gICAqL1xuICBzaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdCkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gcmVxdWVzdC5odHRwVmVyc2lvbigpXG4gICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKT8udHJpbSgpXG4gICAgY29uc3QgY29ubmVjdGlvblRva2VucyA9IGNvbm5lY3Rpb25IZWFkZXJcbiAgICAgID8gY29ubmVjdGlvbkhlYWRlci5zcGxpdChcIixcIikubWFwKCh0b2tlbikgPT4gdG9rZW4udHJpbSgpKS5maWx0ZXIoQm9vbGVhbilcbiAgICAgIDogW11cblxuICAgIGlmIChodHRwVmVyc2lvbiA9PSBcIndlYnNvY2tldFwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoY29ubmVjdGlvblRva2Vucy5pbmNsdWRlcyhcImNsb3NlXCIpKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKGh0dHBWZXJzaW9uID09IFwiMS4wXCIgJiYgY29ubmVjdGlvbkhlYWRlciAhPSBcImtlZXAtYWxpdmVcIikgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGZvciB0aGUgc3RhdHVzIGNvZGVzIHRoYXQgUkZDIDcyMzAgwqczLjMuMyBkZWNsYXJlc1xuICogY2Fubm90IGNhcnJ5IGEgbWVzc2FnZSBib2R5OiBldmVyeSAxeHggaW5mb3JtYXRpb25hbCwgMjA0IE5vXG4gKiBDb250ZW50LCBhbmQgMzA0IE5vdCBNb2RpZmllZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBzdGF0dXNDb2RlIC0gSFRUUCBzdGF0dXMgY29kZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHN0YXR1cyBjb2RlIGZvcmJpZHMgYSByZXNwb25zZSBib2R5LlxuICovXG5mdW5jdGlvbiBpc05vQm9keVN0YXR1c0NvZGUoc3RhdHVzQ29kZSkge1xuICByZXR1cm4gKHN0YXR1c0NvZGUgPj0gMTAwICYmIHN0YXR1c0NvZGUgPCAyMDApIHx8IHN0YXR1c0NvZGUgPT09IDIwNCB8fCBzdGF0dXNDb2RlID09PSAzMDRcbn1cbiJdfQ==