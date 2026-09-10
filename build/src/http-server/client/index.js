// @ts-check
import crypto from "crypto";
import fs from "node:fs/promises";
import { digg } from "diggerize";
import { ensureError } from "typanic";
import EventEmitter from "../../utils/event-emitter.js";
import { HttpRequestBodyTooLargeError } from "./errors.js";
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
     * Sends a deterministic request-body limit response and closes the connection.
     * @returns {void} - No return value.
     */
    _sendPayloadTooLargeResponse() {
        const httpVersion = this.currentRequest?.httpVersion() || "1.1";
        const body = "Payload Too Large\n";
        const headers = [
            `HTTP/${httpVersion} 413 Payload Too Large`,
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
        if (error instanceof HttpRequestBodyTooLargeError) {
            this._sendPayloadTooLargeResponse();
        }
        else {
            this._sendBadRequestResponse("Bad Request");
        }
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
                    // uses. The file is never opened or streamed; onFinished is settled
                    // below, after the committed 406 headers are emitted.
                    response.setStatus(406);
                    response.setBody("");
                    bodyToEmit = "";
                    contentLength = 0;
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
        // A negotiated file 406 is committed above (status 406, empty body) and its
        // headers were just emitted: settle onFinished now, so the callback runs
        // after the response is committed — a slow or app-stopping callback cannot
        // delay or block delivery of the already-emitted 406. The file is never
        // opened, streamed, or reported (no file event), and the callback settles
        // exactly once as "completed".
        if (isFileNotAcceptable) {
            this.logger.debug(() => ["sendResponse file body suppressed for 406", { clientCount: this.clientCount, filePath }]);
            await this.runFileOnFinished({ filePath, onFinished: fileOnFinished, result: "completed" });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUE7QUFDM0IsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sRUFBQyw0QkFBNEIsRUFBQyxNQUFNLGFBQWEsQ0FBQTtBQUN4RCxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLHVCQUF1QixFQUFFLHdCQUF3QixFQUFFLHdCQUF3QixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDckgsT0FBTyxnQkFBZ0IsTUFBTSx3QkFBd0IsQ0FBQTtBQUVyRDs7OztHQUlHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxLQUFLO0lBQzlCLE9BQU87UUFDTCxVQUFVLEVBQUUsS0FBSyxDQUFDLElBQUk7UUFDdEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLGdCQUFnQixFQUFFLEtBQUssQ0FBQyxnQkFBZ0I7S0FDekMsQ0FBQTtBQUNILENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3QyxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUMzQixLQUFLLEdBQUcsU0FBUyxDQUFBO0lBRWpCOzt5QkFFcUI7SUFDckIsd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0lBRWhDOzt5QkFFcUI7SUFDckIseUJBQXlCLEdBQUcsS0FB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a1xuXG5pbXBvcnQgY3J5cHRvIGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQge2Vuc3VyZUVycm9yfSBmcm9tIFwidHlwYW5pY1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi8uLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCB7SHR0cFJlcXVlc3RCb2R5VG9vTGFyZ2VFcnJvcn0gZnJvbSBcIi4vZXJyb3JzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUmVxdWVzdCBmcm9tIFwiLi9yZXF1ZXN0LmpzXCJcbmltcG9ydCBSZXF1ZXN0UnVubmVyIGZyb20gXCIuL3JlcXVlc3QtcnVubmVyLmpzXCJcbmltcG9ydCB7YWRkQWNjZXB0RW5jb2RpbmdUb1ZhcnksIGFwcGx5UmVzcG9uc2VDb21wcmVzc2lvbiwgbmVnb3RpYXRlQ29udGVudEVuY29kaW5nfSBmcm9tIFwiLi9yZXNwb25zZS1jb21wcmVzc2lvbi5qc1wiXG5pbXBvcnQgV2Vic29ja2V0U2Vzc2lvbiBmcm9tIFwiLi93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiXG5cbi8qKlxuICogUnVucyBiYWQgcmVxdWVzdCBkZXRhaWxzLlxuICogQHBhcmFtIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2FmZSBiYWQtcmVxdWVzdCBkZXRhaWxzIGZvciBsb2dzLlxuICovXG5mdW5jdGlvbiBiYWRSZXF1ZXN0RGV0YWlscyhlcnJvcikge1xuICByZXR1cm4ge1xuICAgIGVycm9yQ2xhc3M6IGVycm9yLm5hbWUsXG4gICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICB2ZWxvY2lvdXNDb250ZXh0OiBlcnJvci52ZWxvY2lvdXNDb250ZXh0XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVvbGljaW91c0h0dHBTZXJ2ZXJDbGllbnQge1xuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcbiAgc3RhdGUgPSBcImluaXRpYWxcIlxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgZG9uZS1yZXF1ZXN0cyBkcmFpbiBpcyBjdXJyZW50bHkgc2VuZGluZyByZXNwb25zZXMgZm9yIHRoaXMgY2xpZW50LlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlID0gZmFsc2VcblxuICAvKipcbiAgICogV2hldGhlciBhbm90aGVyIGRyYWluIHdhcyByZXF1ZXN0ZWQgd2hpbGUgb25lIHdhcyBhbHJlYWR5IGFjdGl2ZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jbGllbnRDb3VudCAtIENsaWVudCBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5yZW1vdGVBZGRyZXNzXSAtIFJlbW90ZSBhZGRyZXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NsaWVudENvdW50LCBjb25maWd1cmF0aW9uLCByZW1vdGVBZGRyZXNzfSkge1xuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBnaXZlblwiKVxuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5jbGllbnRDb3VudCA9IGNsaWVudENvdW50XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMucmVtb3RlQWRkcmVzcyA9IHJlbW90ZUFkZHJlc3NcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVxdWVzdFJ1bm5lcltdfSAqL1xuICAgIHRoaXMucmVxdWVzdFJ1bm5lcnMgPSBbXVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8KHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzID0gbmV3IFNldCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGJhZCB1cGdyYWRlIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIE1lc3NhZ2UgdGV4dC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NlbmRCYWRVcGdyYWRlUmVzcG9uc2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gdGhpcy5jdXJyZW50UmVxdWVzdD8uaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgYm9keSA9IGAke21lc3NhZ2V9XFxuYFxuICAgIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgICBgSFRUUC8ke2h0dHBWZXJzaW9ufSA0MDAgQmFkIFJlcXVlc3RgLFxuICAgICAgXCJDb25uZWN0aW9uOiBDbG9zZVwiLFxuICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIixcbiAgICAgIGBDb250ZW50LUxlbmd0aDogJHtCdWZmZXIuYnl0ZUxlbmd0aChib2R5LCBcInV0ZjhcIil9YCxcbiAgICAgIFwiXCIsXG4gICAgICBib2R5XG4gICAgXS5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGhlYWRlcnMpXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGJhZCByZXF1ZXN0IHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFJlc3BvbnNlIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZW5kQmFkUmVxdWVzdFJlc3BvbnNlKG1lc3NhZ2UpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3Q/Lmh0dHBWZXJzaW9uKCkgfHwgXCIxLjFcIlxuICAgIGNvbnN0IGJvZHkgPSBgJHttZXNzYWdlfVxcbmBcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgYEhUVFAvJHtodHRwVmVyc2lvbn0gNDAwIEJhZCBSZXF1ZXN0YCxcbiAgICAgIFwiQ29ubmVjdGlvbjogQ2xvc2VcIixcbiAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PVVURi04XCIsXG4gICAgICBgQ29udGVudC1MZW5ndGg6ICR7QnVmZmVyLmJ5dGVMZW5ndGgoYm9keSwgXCJ1dGY4XCIpfWAsXG4gICAgICBcIlwiLFxuICAgICAgYm9keVxuICAgIF0uam9pbihcIlxcclxcblwiKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGEgZGV0ZXJtaW5pc3RpYyByZXF1ZXN0LWJvZHkgbGltaXQgcmVzcG9uc2UgYW5kIGNsb3NlcyB0aGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NlbmRQYXlsb2FkVG9vTGFyZ2VSZXNwb25zZSgpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3Q/Lmh0dHBWZXJzaW9uKCkgfHwgXCIxLjFcIlxuICAgIGNvbnN0IGJvZHkgPSBcIlBheWxvYWQgVG9vIExhcmdlXFxuXCJcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgYEhUVFAvJHtodHRwVmVyc2lvbn0gNDEzIFBheWxvYWQgVG9vIExhcmdlYCxcbiAgICAgIFwiQ29ubmVjdGlvbjogQ2xvc2VcIixcbiAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PVVURi04XCIsXG4gICAgICBgQ29udGVudC1MZW5ndGg6ICR7QnVmZmVyLmJ5dGVMZW5ndGgoYm9keSwgXCJ1dGY4XCIpfWAsXG4gICAgICBcIlwiLFxuICAgICAgYm9keVxuICAgIF0uam9pbihcIlxcclxcblwiKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGJhZCByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBoYW5kbGVCYWRSZXF1ZXN0KGVycm9yKSB7XG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gcGFyc2UgSFRUUCByZXF1ZXN0XCIsIGJhZFJlcXVlc3REZXRhaWxzKC8qKiBAdHlwZSB7RXJyb3IgJiB7dmVsb2Npb3VzQ29udGV4dD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovIChlcnJvcikpXSlcblxuICAgIGlmICh0aGlzLmN1cnJlbnRSZXF1ZXN0ICYmIFwiZ2V0UmVxdWVzdFBhcnNlclwiIGluIHRoaXMuY3VycmVudFJlcXVlc3QpIHtcbiAgICAgIGNvbnN0IGh0dHBSZXF1ZXN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuY3VycmVudFJlcXVlc3QpXG5cbiAgICAgIGh0dHBSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKS5kZXN0cm95KClcbiAgICB9XG5cbiAgICB0aGlzLmN1cnJlbnRSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5zdGF0ZSA9IFwiaW5pdGlhbFwiXG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBIdHRwUmVxdWVzdEJvZHlUb29MYXJnZUVycm9yKSB7XG4gICAgICB0aGlzLl9zZW5kUGF5bG9hZFRvb0xhcmdlUmVzcG9uc2UoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zZW5kQmFkUmVxdWVzdFJlc3BvbnNlKFwiQmFkIFJlcXVlc3RcIilcbiAgICB9XG4gIH1cblxuICBleGVjdXRlQ3VycmVudFJlcXVlc3QgPSAoKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoXCJleGVjdXRlQ3VycmVudFJlcXVlc3RcIilcblxuICAgIGNvbnN0IGN1cnJlbnRSZXF1ZXN0ID0gdGhpcy5jdXJyZW50UmVxdWVzdFxuXG4gICAgaWYgKCFjdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG4gICAgY29uc3QgcmVkYWN0b3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnJlcXVlc3RTZW5zaXRpdmVWYWx1ZXMoY3VycmVudFJlcXVlc3QpXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJleGVjdXRlQ3VycmVudFJlcXVlc3QgcmVxdWVzdFwiLCB7XG4gICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgIGh0dHBNZXRob2Q6IGN1cnJlbnRSZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgIGh0dHBWZXJzaW9uOiBjdXJyZW50UmVxdWVzdC5odHRwVmVyc2lvbigpLFxuICAgICAgcGF0aDogcmVkYWN0b3IucmVkYWN0UGF0aChjdXJyZW50UmVxdWVzdC5wYXRoKCksIHNlbnNpdGl2ZVZhbHVlcyksXG4gICAgICBxdWV1ZUxlbmd0aDogdGhpcy5yZXF1ZXN0UnVubmVycy5sZW5ndGhcbiAgICB9XSlcblxuICAgIGlmICh0aGlzLl9pc1dlYnNvY2tldFVwZ3JhZGUoY3VycmVudFJlcXVlc3QpKSB7XG4gICAgICB0aGlzLl91cGdyYWRlVG9XZWJzb2NrZXQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gV2UgYXJlIGRvbmUgcGFyc2luZyB0aGUgZ2l2ZW4gcmVxdWVzdCBhbmQgY2FuIHRoZW9yZXRpY2FsbHkgc3RhcnQgcGFyc2luZyBhIG5ldyBvbmUsIGJlZm9yZSB0aGUgY3VycmVudCByZXF1ZXN0IGlzIGRvbmUgLSBzbyByZXNldCB0aGUgc3RhdGUuXG4gICAgdGhpcy5zdGF0ZSA9IFwiaW5pdGlhbFwiXG5cbiAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gbmV3IFJlcXVlc3RSdW5uZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgcmVxdWVzdDogY3VycmVudFJlcXVlc3RcbiAgICB9KVxuXG4gICAgdGhpcy5yZXF1ZXN0UnVubmVycy5wdXNoKHJlcXVlc3RSdW5uZXIpXG5cbiAgICByZXF1ZXN0UnVubmVyLmV2ZW50cy5vbihcImRvbmVcIiwgdGhpcy5yZXF1ZXN0RG9uZSlcbiAgICByZXF1ZXN0UnVubmVyLnJ1bigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbiB3cml0ZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uV3JpdGUoZGF0YSkge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgc3RhcnRcIiwge1xuICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsXG4gICAgICBsZW5ndGg6IGRhdGEubGVuZ3RoLFxuICAgICAgc3RhdGU6IHRoaXMuc3RhdGUsXG4gICAgfV0pXG5cbiAgICBpZiAodGhpcy53ZWJzb2NrZXRTZXNzaW9uKSB7XG4gICAgICB0aGlzLndlYnNvY2tldFNlc3Npb24ub25EYXRhKGRhdGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLyoqXG4gICAgICAgKiBSZW1haW5pbmcuXG4gICAgICAgKiBAdHlwZSB7QnVmZmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IHJlbWFpbmluZyA9IGRhdGFcblxuICAgICAgd2hpbGUgKHJlbWFpbmluZykge1xuICAgICAgICBpZiAocmVtYWluaW5nLmxlbmd0aCA8PSAwKSBicmVha1xuXG4gICAgICAgIGlmICh0aGlzLnN0YXRlID09IFwiaW5pdGlhbFwiKSB7XG4gICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBjcmVhdGluZyByZXF1ZXN0IHBhcnNlclwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3QgPSBuZXcgUmVxdWVzdCh7Y2xpZW50OiB0aGlzLCBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3QucmVxdWVzdFBhcnNlci5ldmVudHMub24oXCJkb25lXCIsIHRoaXMuZXhlY3V0ZUN1cnJlbnRSZXF1ZXN0KVxuICAgICAgICAgIHRoaXMuc3RhdGUgPSBcInJlcXVlc3RTdGFydGVkXCJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlICE9IFwicmVxdWVzdFN0YXJ0ZWRcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBzdGF0ZSBmb3IgY2xpZW50OiAke3RoaXMuc3RhdGV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5jdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG5cbiAgICAgICAgcmVtYWluaW5nID0gdGhpcy5jdXJyZW50UmVxdWVzdC5mZWVkKHJlbWFpbmluZylcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBmZWQgcGFyc2VyXCIsIHtcbiAgICAgICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgICAgICBoYXNSZW1haW5pbmc6IEJvb2xlYW4ocmVtYWluaW5nPy5sZW5ndGgpLFxuICAgICAgICAgIHJlbWFpbmluZ0xlbmd0aDogcmVtYWluaW5nPy5sZW5ndGggfHwgMCxcbiAgICAgICAgICBwYXJzZXJDb21wbGV0ZWQ6IHRoaXMuY3VycmVudFJlcXVlc3Q/LmdldFJlcXVlc3RQYXJzZXIoKS5oYXNDb21wbGV0ZWRcbiAgICAgICAgfV0pXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZyAmJiByZW1haW5pbmcubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IHJlcXVlc3RQYXJzZXIgPSB0aGlzLmN1cnJlbnRSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKVxuXG4gICAgICAgICAgaWYgKCFyZXF1ZXN0UGFyc2VyLmhhc0NvbXBsZXRlZCkge1xuICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHdhaXRpbmcgZm9yIG1vcmUgZGF0YVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLnN0YXRlID0gXCJpbml0aWFsXCJcbiAgICAgICAgICBjb25zdCByZW1haW5pbmdMZW5ndGggPSByZW1haW5pbmcubGVuZ3RoXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHBhcnNlciBjb21wbGV0ZWQgd2l0aCByZW1haW5pbmcgYnl0ZXNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCByZW1haW5pbmdMZW5ndGh9XSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBlbmRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBzdGF0ZTogdGhpcy5zdGF0ZSwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlQmFkUmVxdWVzdChlbnN1cmVFcnJvcihlcnJvcikpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgd2Vic29ja2V0IHVwZ3JhZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IHJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB3ZWJzb2NrZXQgdXBncmFkZS5cbiAgICovXG4gIF9pc1dlYnNvY2tldFVwZ3JhZGUocmVxdWVzdCkge1xuICAgIGNvbnN0IHVwZ3JhZGVIZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcInVwZ3JhZGVcIik/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gQm9vbGVhbih1cGdyYWRlSGVhZGVyID09IFwid2Vic29ja2V0XCIgJiYgY29ubmVjdGlvbkhlYWRlcj8uaW5jbHVkZXMoXCJ1cGdyYWRlXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBncmFkZSB0byB3ZWJzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF91cGdyYWRlVG9XZWJzb2NrZXQoKSB7XG4gICAgaWYgKCF0aGlzLmN1cnJlbnRSZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3RcIilcblxuICAgIGNvbnN0IHNlY1dlYnNvY2tldEtleSA9IHRoaXMuY3VycmVudFJlcXVlc3QuaGVhZGVyKFwic2VjLXdlYnNvY2tldC1rZXlcIilcblxuICAgIGlmICghc2VjV2Vic29ja2V0S2V5KSB7XG4gICAgICB0aGlzLl9zZW5kQmFkVXBncmFkZVJlc3BvbnNlKFwiTWlzc2luZyBTZWMtV2ViU29ja2V0LUtleSBoZWFkZXJcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHdlYnNvY2tldEFjY2VwdEtleSA9IGNyeXB0by5jcmVhdGVIYXNoKFwic2hhMVwiKVxuICAgICAgLnVwZGF0ZShgJHtzZWNXZWJzb2NrZXRLZXl9MjU4RUFGQTUtRTkxNC00N0RBLTk1Q0EtQzVBQjBEQzg1QjExYCwgXCJiaW5hcnlcIilcbiAgICAgIC5kaWdlc3QoXCJiYXNlNjRcIilcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3QuaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgcmVzcG9uc2VMaW5lcyA9IFtcbiAgICAgIGBIVFRQLyR7aHR0cFZlcnNpb259IDEwMSBTd2l0Y2hpbmcgUHJvdG9jb2xzYCxcbiAgICAgIFwiVXBncmFkZTogd2Vic29ja2V0XCIsXG4gICAgICBcIkNvbm5lY3Rpb246IFVwZ3JhZGVcIixcbiAgICAgIGBTZWMtV2ViU29ja2V0LUFjY2VwdDogJHt3ZWJzb2NrZXRBY2NlcHRLZXl9YCxcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiXG4gICAgXVxuICAgIGNvbnN0IHJlc3BvbnNlID0gcmVzcG9uc2VMaW5lcy5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICBjb25zdCBtZXNzYWdlSGFuZGxlclJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXI/LigpXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGVyXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGVyUHJvbWlzZVxuXG4gICAgaWYgKG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkSGFuZGxlciA9IG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIoe1xuICAgICAgICBjbGllbnQ6IHRoaXMsXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgcmVxdWVzdDogdGhpcy5jdXJyZW50UmVxdWVzdFxuICAgICAgfSlcblxuICAgICAgY29uc3QgcmVzb2x2ZWRUaGVuYWJsZSA9IC8qKiBAdHlwZSB7e3RoZW4/OiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChyZXNvbHZlZEhhbmRsZXIpXG5cbiAgICAgIGlmIChyZXNvbHZlZFRoZW5hYmxlPy50aGVuKSB7XG4gICAgICAgIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZSA9IC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyIHwgdm9pZD59ICovIChyZXNvbHZlZEhhbmRsZXIpXG4gICAgICB9IGVsc2UgaWYgKHJlc29sdmVkSGFuZGxlcikge1xuICAgICAgICBtZXNzYWdlSGFuZGxlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlcn0gKi8gKHJlc29sdmVkSGFuZGxlcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24gPSBuZXcgV2Vic29ja2V0U2Vzc2lvbih7XG4gICAgICBjbGllbnQ6IHRoaXMsXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICB1cGdyYWRlUmVxdWVzdDogdGhpcy5jdXJyZW50UmVxdWVzdCxcbiAgICAgIG1lc3NhZ2VIYW5kbGVyOiBtZXNzYWdlSGFuZGxlcixcbiAgICAgIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZTogbWVzc2FnZUhhbmRsZXJQcm9taXNlXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgLy8gUGF1c2VkIHNlc3Npb25zIHN1cnZpdmUgdGhlIHNvY2tldCBjbG9zZTsgZG9uJ3QgZGVzdHJveSgpLlxuICAgICAgLy8gVGhlIGdyYWNlLWV4cGlyeSBwYXRoIChfZmluYWxpemVHcmFjZUV4cGlyeSkgd2lsbCBkZXN0cm95XG4gICAgICAvLyB0aGVtIHBlcm1hbmVudGx5IGlmIHJlc3VtZSBkb2Vzbid0IGhhcHBlbiBpbiB0aW1lLlxuICAgICAgaWYgKCF0aGlzLndlYnNvY2tldFNlc3Npb24/LmlzUGF1c2VkKCkpIHtcbiAgICAgICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uPy5kZXN0cm95KClcbiAgICAgIH1cbiAgICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbiA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwib3duZXJzaGlwQ2xhaW1lZFwiLCAoe3Nlc3Npb25JZH0pID0+IHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJ3ZWJzb2NrZXRTZXNzaW9uT3duZWRcIiwge3Nlc3Npb25JZH0pXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwib3duZXJzaGlwUmVsZWFzZWRcIiwgKHtzZXNzaW9uSWR9KSA9PiB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwid2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkXCIsIHtzZXNzaW9uSWR9KVxuICAgIH0pXG4gICAgdGhpcy5zdGF0ZSA9IFwid2Vic29ja2V0XCJcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIHJlc3BvbnNlKVxuICAgIHZvaWQgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLmluaXRpYWxpemVDaGFubmVsKClcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uc2VuZFNlc3Npb25Fc3RhYmxpc2hlZCgpXG4gIH1cblxuICByZXF1ZXN0RG9uZSA9ICgpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJyZXF1ZXN0RG9uZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHF1ZXVlTGVuZ3RoOiB0aGlzLnJlcXVlc3RSdW5uZXJzLmxlbmd0aH1dKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RyYWluRG9uZVJlcXVlc3RzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHdoaWxlIHNlbmRpbmcgZG9uZSByZXF1ZXN0c1wiLCBlcnJvcilcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGRvbmUgcmVxdWVzdHMgb25lIGF0IGEgdGltZS4gQSBydW5uZXIgaXMgc2hpZnRlZCBvdXQgb2YgdGhlIHF1ZXVlIGJlZm9yZVxuICAgKiBpdHMgcmVzcG9uc2UgZmluaXNoZXMgc2VuZGluZyAoYXN5bmMgY29tcHJlc3Npb24sIGZpbGUgdHJhbnNmZXIpLCBzbyBhblxuICAgKiBvdmVybGFwcGluZyBkcmFpbiB3b3VsZCBvdGhlcndpc2UgcGljayB1cCB0aGUgbmV4dCBydW5uZXIgYW5kIHJlb3JkZXIgcGlwZWxpbmVkXG4gICAqIHNvY2tldCB3cml0ZXMuIENhbGxzIHRoYXQgYXJyaXZlIHdoaWxlIGEgZHJhaW4gaXMgYWN0aXZlIGFyZSBmb2xkZWQgaW50byBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSBkb25lIHJlc3BvbnNlIGhhcyBiZWVuIHNlbnQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Eb25lUmVxdWVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlKSB7XG4gICAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBkbyB7XG4gICAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluUGVuZGluZyA9IGZhbHNlXG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZERvbmVSZXF1ZXN0cygpXG4gICAgICB9IHdoaWxlICh0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlID0gZmFsc2VcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZW5kRG9uZVJlcXVlc3RzKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gdGhpcy5yZXF1ZXN0UnVubmVyc1swXVxuICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVlc3RSdW5uZXI/LmdldFJlcXVlc3QoKVxuXG4gICAgICBpZiAocmVxdWVzdFJ1bm5lcj8uZ2V0U3RhdGUoKSA9PSBcImRvbmVcIikge1xuICAgICAgICBjb25zdCBodHRwVmVyc2lvbiA9IHJlcXVlc3QuaHR0cFZlcnNpb24oKVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpPy50cmltKClcbiAgICAgICAgY29uc3Qgc2hvdWxkQ2xvc2VDb25uZWN0aW9uID0gdGhpcy5zaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdClcblxuICAgICAgICB0aGlzLnJlcXVlc3RSdW5uZXJzLnNoaWZ0KClcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZERvbmVSZXF1ZXN0cyBzaGlmdGVkIHF1ZXVlXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kUmVzcG9uc2UocmVxdWVzdFJ1bm5lcilcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFZlbG9jaW91cyBjbGllbnQgJHt0aGlzLmNsaWVudENvdW50fSBmYWlsZWQgd2hpbGUgc2VuZGluZyByZXNwb25zZWAsIGVycm9yXSlcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnRSZXF1ZXN0ID09PSByZXF1ZXN0ICYmIHRoaXMuc3RhdGUgPT09IFwiaW5pdGlhbFwiKSB0aGlzLmN1cnJlbnRSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmREb25lUmVxdWVzdHNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBjb25uZWN0aW9uSGVhZGVyLCBodHRwVmVyc2lvbn1dKVxuXG4gICAgICAgIGlmIChzaG91bGRDbG9zZUNvbm5lY3Rpb24pIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbYENsb3NpbmcgdGhlIGNvbm5lY3Rpb24gYmVjYXVzZSAke2h0dHBWZXJzaW9ufSBhbmQgY29ubmVjdGlvbiBoZWFkZXIgJHtjb25uZWN0aW9uSGVhZGVyfWAsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudH1dKVxuICAgICAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIGZpbmlzaGVkIHJlc3BvbnNlIHRvIHRoZSBjbGllbnQuIE93bnMgdGhlIGZyYW1ld29yay1vd25lZFxuICAgKiBgVmFyeTogQWNjZXB0LUVuY29kaW5nYCBkaW1lbnNpb24gKGVtaXR0ZWQgZm9yIGV2ZXJ5IHNlbGVjdGVkXG4gICAqIHJlcHJlc2VudGF0aW9uIOKAlCB0cmFuc2Zvcm1lZCwgaWRlbnRpdHksIDQwNiwgYW5kIGZpbGUg4oCUIGFuZCBmb3JcbiAgICogaGVhZGVyLXByZXNlbnQgYW5kIGhlYWRlci1hYnNlbnQgcmVxdWVzdHMgYWxpa2UsIHNvIGl0IGlzIHN0YWJsZSBhY3Jvc3NcbiAgICogcmVxdWVzdHMgb24gdGhlIHNhbWUgY29ubmVjdGlvbjsgbmV2ZXIgYWRkZWQgd2hlbiBjb21wcmVzc2lvbiBpcyBkaXNhYmxlZCxcbiAgICogdGhlIHJlc3BvbnNlIGlzIHRydWx5IGJvZHlsZXNzLCBvciB0aGUgYXBwbGljYXRpb24gc3VwcGxpZWQgYSBmaXhlZFxuICAgKiBgQ29udGVudC1FbmNvZGluZ2ApIGFuZCB0aGUgZmlsZSA0MDYgcnVsZSAoYSBzZW5kRmlsZSByZXNwb25zZSB3aG9zZVxuICAgKiBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBpcyBhbnN3ZXJlZCB3aXRoIHRoZSBlbXB0eSA0MDYsIHRoZSBmaWxlIGlzIG5ldmVyXG4gICAqIG9wZW5lZCBvciBzdHJlYW1lZCwgYW5kIGBvbkZpbmlzaGVkYCBzZXR0bGVzIG9uY2UgYXMgXCJjb21wbGV0ZWRcIikuXG4gICAqIEBwYXJhbSB7UmVxdWVzdFJ1bm5lcn0gcmVxdWVzdFJ1bm5lciAtIFJlcXVlc3QgcnVubmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2VuZFJlc3BvbnNlKHJlcXVlc3RSdW5uZXIpIHtcbiAgICBjb25zdCByZXNwb25zZSA9IGRpZ2cocmVxdWVzdFJ1bm5lciwgXCJyZXNwb25zZVwiKVxuICAgIGNvbnN0IHJlcXVlc3QgPSByZXF1ZXN0UnVubmVyLmdldFJlcXVlc3QoKVxuICAgIGNvbnN0IGZpbGVQYXRoID0gcmVzcG9uc2UuZ2V0RmlsZVBhdGgoKVxuICAgIGNvbnN0IGZpbGVPbkZpbmlzaGVkID0gcmVzcG9uc2UuZ2V0RmlsZU9uRmluaXNoZWQoKVxuICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKT8udHJpbSgpXG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSByZXF1ZXN0Lmh0dHBWZXJzaW9uKClcbiAgICBjb25zdCBzaG91bGRDbG9zZUNvbm5lY3Rpb24gPSB0aGlzLnNob3VsZENsb3NlQ29ubmVjdGlvbihyZXF1ZXN0KVxuICAgIGNvbnN0IGhhc0ZpbGVQYXRoID0gdHlwZW9mIGZpbGVQYXRoID09PSBcInN0cmluZ1wiICYmIGZpbGVQYXRoLmxlbmd0aCA+IDBcbiAgICBjb25zdCBib2R5ID0gaGFzRmlsZVBhdGggPyBudWxsIDogcmVzcG9uc2UuZ2V0Qm9keSgpXG4gICAgY29uc3QgYm9keUlzU3RyaW5nID0gdHlwZW9mIGJvZHkgPT09IFwic3RyaW5nXCJcbiAgICBjb25zdCBib2R5SXNCaW5hcnkgPSBib2R5IGluc3RhbmNlb2YgVWludDhBcnJheVxuXG4gICAgaWYgKCFoYXNGaWxlUGF0aCAmJiAhYm9keUlzU3RyaW5nICYmICFib2R5SXNCaW5hcnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcmVzcG9uc2UgYm9keSB0byBiZSBhIHN0cmluZyBvciBVaW50OEFycmF5LCBnb3QgJHt0eXBlb2YgYm9keX1gKVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2VuZFJlc3BvbnNlXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgY29ubmVjdGlvbkhlYWRlciwgaHR0cFZlcnNpb259KVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBwYXlsb2FkXCIsIHtcbiAgICAgIGNsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LFxuICAgICAgaGFzRmlsZVBhdGgsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGJvZHlJc0JpbmFyeSxcbiAgICAgIGJvZHlJc1N0cmluZ1xuICAgIH1dKVxuXG4gICAgaWYgKHNob3VsZENsb3NlQ29ubmVjdGlvbikge1xuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29ubmVjdGlvblwiLCBcIkNsb3NlXCIpXG4gICAgfSBlbHNlIGlmIChodHRwVmVyc2lvbiA9PSBcIjEuMFwiICYmIGNvbm5lY3Rpb25IZWFkZXIgPT0gXCJrZWVwLWFsaXZlXCIpIHtcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbm5lY3Rpb25cIiwgXCJLZWVwLUFsaXZlXCIpXG4gICAgfVxuXG4gICAgLy8gUGVyIFJGQyA3MjMwIMKnMy4zLjMsIHJlc3BvbnNlcyB3aXRoIHN0YXR1cyBjb2RlcyAxeHgsIDIwNCwgYW5kIDMwNFxuICAgIC8vIE1VU1QgTk9UIGNhcnJ5IGEgbWVzc2FnZSBib2R5IGFuZCBNVVNUIE5PVCBpbmNsdWRlIENvbnRlbnQtTGVuZ3RoXG4gICAgLy8gKHdpdGggYSBuYXJyb3cgMzA0IGV4Y2VwdGlvbiB3ZSBkb24ndCBsZWFuIG9uKS4gU2VuZGluZyBvbmUgd291bGRcbiAgICAvLyBkZXN5bmNocm9uaXplIGtlZXAtYWxpdmUgY2xpZW50cyB3YWl0aW5nIGZvciBieXRlcyB0aGF0IG5ldmVyXG4gICAgLy8gYXJyaXZlIOKAlCBkcm9wIHRoZSBib2R5IGVudGlyZWx5IGZvciB0aG9zZSBjb2Rlcy5cbiAgICBjb25zdCBpc0JvZHlsZXNzU3RhdHVzID0gaXNOb0JvZHlTdGF0dXNDb2RlKHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKSlcblxuICAgIC8vIEhFQUQgcmVzcG9uc2VzIHNlbGVjdCBhbmQgY29tcHV0ZSB0aGUgZXhhY3Qgc2FtZSByZXByZXNlbnRhdGlvbiBoZWFkZXJzIGFzIHRoZVxuICAgIC8vIGVxdWl2YWxlbnQgR0VUIChpbmNsdWRpbmcgQ29udGVudC1MZW5ndGggYW5kIGFueSBuZWdvdGlhdGVkIENvbnRlbnQtRW5jb2RpbmcpLFxuICAgIC8vIGJ1dCBubyBidWZmZXJlZCBvciBmaWxlIGJvZHkgaXMgZW1pdHRlZCBiZWxvdy5cbiAgICBjb25zdCBpc0hlYWRSZXF1ZXN0ID0gcmVxdWVzdC5odHRwTWV0aG9kKCkgPT0gXCJIRUFEXCJcblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgVWludDhBcnJheSB8IG51bGx9ICovXG4gICAgbGV0IGJvZHlUb0VtaXQgPSBib2R5XG5cbiAgICAvLyBUaGUgcmVzcG9uc2UgcmVwcmVzZW50YXRpb24gY2FuIGRlcGVuZCBvbiB0aGUgY2xpZW50J3MgQWNjZXB0LUVuY29kaW5nOlxuICAgIC8vIHRoZSBzYW1lIHJlcXVlc3QgaXMgYW5zd2VyZWQgd2l0aCBhbiBpZGVudGl0eSBib2R5IChvciBhIGZpbGUpIHdoZW5cbiAgICAvLyBpZGVudGl0eSBpcyBhY2NlcHRhYmxlIGFuZCB3aXRoIGFuIGVtcHR5IDQwNiB3aGVuIGl0IGlzIGZvcmJpZGRlbi5cbiAgICBjb25zdCBjb21wcmVzc2lvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKVxuICAgIGNvbnN0IG5lZ290aWF0ZWQgPSBjb21wcmVzc2lvbi5lbmFibGVkID8gbmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcXVlc3QuaGVhZGVyKFwiYWNjZXB0LWVuY29kaW5nXCIpKSA6IHVuZGVmaW5lZFxuICAgIC8vIEFuIGFwcGxpY2F0aW9uLXN1cHBsaWVkIENvbnRlbnQtRW5jb2RpbmcgaXMgYW4gYXBwbGljYXRpb24tb3duZWRcbiAgICAvLyByZXByZXNlbnRhdGlvbiBjb250cmFjdCwgY2FwdHVyZWQgYmVmb3JlIHRoZSBmcmFtZXdvcmsgbWF5IGFkZCBpdHMgb3duLlxuICAgIC8vIEEgZmlsZSBjYXJyeWluZyBvbmUgaXMgYSBmaXhlZCwgYXBwbGljYXRpb24tb3duZWQgcmVwcmVzZW50YXRpb246IHRoZVxuICAgIC8vIGZyYW1ld29yayBuZWl0aGVyIG5lZ290aWF0ZXMgaXQgbm9yIHJlLWFkdmVydGlzZXMgaXQsIHNvIGl0IGlzIG5ldmVyIGFcbiAgICAvLyBjYW5kaWRhdGUgZm9yIHRoZSBpZGVudGl0eS1vbmx5IDQwNi5cbiAgICBjb25zdCBoYXNBcHBsaWNhdGlvbkNvbnRlbnRFbmNvZGluZyA9IHJlc3BvbnNlLmdldEhlYWRlcihcIkNvbnRlbnQtRW5jb2RpbmdcIikubGVuZ3RoID4gMFxuICAgIC8vIEEgZmlsZSByZXNwb25zZSBvbmx5IGV2ZXIgc2VydmVzIHRoZSBpZGVudGl0eSByZXByZXNlbnRhdGlvbjogd2hlbmV2ZXJcbiAgICAvLyB0aGUgY2xpZW50IGZvcmJpZHMgaWRlbnRpdHkgKGluY2x1ZGluZyB0aGUgbm90LWFjY2VwdGFibGUgY2FzZSB3aGVyZSBub1xuICAgIC8vIGNvZGluZyBhcHBsaWVzKSBhbmQgdGhlIGZpbGUgZG9lcyBub3QgY2FycnkgYW4gYXBwbGljYXRpb24tc3VwcGxpZWRcbiAgICAvLyBDb250ZW50LUVuY29kaW5nLCB0aGUgZmlsZSBpcyByZWplY3RlZCB3aXRoIHRoZSBlbXB0eSA0MDYuIEEgdHJ1bHlcbiAgICAvLyBib2R5bGVzcyBzdGF0dXMgc2VsZWN0cyBubyByZXByZXNlbnRhdGlvbiwgc28gaXQgaXMgbmV2ZXIgcmVqZWN0ZWQgaGVyZS5cbiAgICBjb25zdCBpc0ZpbGVOb3RBY2NlcHRhYmxlID0gaGFzRmlsZVBhdGggJiYgISFuZWdvdGlhdGVkICYmIChcIm5vdEFjY2VwdGFibGVcIiBpbiBuZWdvdGlhdGVkIHx8IG5lZ290aWF0ZWQuaWRlbnRpdHlBY2NlcHRhYmxlID09PSBmYWxzZSkgJiYgaGFzQXBwbGljYXRpb25Db250ZW50RW5jb2RpbmcgPT09IGZhbHNlICYmICFpc0JvZHlsZXNzU3RhdHVzXG5cbiAgICBpZiAoIWlzQm9keWxlc3NTdGF0dXMpIHtcbiAgICAgIGxldCBjb250ZW50TGVuZ3RoXG5cbiAgICAgIGlmIChoYXNGaWxlUGF0aCkge1xuICAgICAgICBpZiAoaXNGaWxlTm90QWNjZXB0YWJsZSkge1xuICAgICAgICAgIC8vIFRoZSBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBhbmQgZmlsZXMgYXJlIG9ubHkgZXZlciBzZW50IGlkZW50aXR5OlxuICAgICAgICAgIC8vIGFuc3dlciB3aXRoIHRoZSBzYW1lIGVtcHR5IDQwNiBldmVyeSBvdGhlciByZXByZXNlbnRhdGlvbiBwYXRoXG4gICAgICAgICAgLy8gdXNlcy4gVGhlIGZpbGUgaXMgbmV2ZXIgb3BlbmVkIG9yIHN0cmVhbWVkOyBvbkZpbmlzaGVkIGlzIHNldHRsZWRcbiAgICAgICAgICAvLyBiZWxvdywgYWZ0ZXIgdGhlIGNvbW1pdHRlZCA0MDYgaGVhZGVycyBhcmUgZW1pdHRlZC5cbiAgICAgICAgICByZXNwb25zZS5zZXRTdGF0dXMoNDA2KVxuICAgICAgICAgIHJlc3BvbnNlLnNldEJvZHkoXCJcIilcbiAgICAgICAgICBib2R5VG9FbWl0ID0gXCJcIlxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSAwXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKVxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSBzdGF0cy5zaXplXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFN0cmluZyBib2RpZXMgYXJlIFVURi04IGZyYW1lZCwgc28gdGhlIGJ1ZmZlcmVkIGJ5dGVzIGFyZSB0aGUgVVRGLTggZW5jb2Rpbmc7XG4gICAgICAgIC8vIFVpbnQ4QXJyYXkgYm9kaWVzIGFyZSBhbHJlYWR5IHRoZSBleGFjdCB3aXJlIGJ5dGVzLlxuICAgICAgICBjb25zdCBib2R5QnVmZmVyID0gYm9keUlzU3RyaW5nID8gQnVmZmVyLmZyb20oYm9keSwgXCJ1dGY4XCIpIDogQnVmZmVyLmZyb20oYm9keSlcbiAgICAgICAgY29uc3QgY29tcHJlc3Npb25SZXN1bHQgPSBhd2FpdCBhcHBseVJlc3BvbnNlQ29tcHJlc3Npb24oe1xuICAgICAgICAgIGJvZHlCdWZmZXIsXG4gICAgICAgICAgY29tcHJlc3Npb246IHRoaXMuY29uZmlndXJhdGlvbi5nZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKSxcbiAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgIHJlc3BvbnNlXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGNvbXByZXNzaW9uUmVzdWx0Lm91dGNvbWUgPT0gXCJub3QtYWNjZXB0YWJsZVwiKSB7XG4gICAgICAgICAgLy8gVGhlIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IGFuZCBubyBzdXBwb3J0ZWQgY29kaW5nIGlzIGFjY2VwdGFibGU6IGFuc3dlclxuICAgICAgICAgIC8vIHdpdGggYW4gZW1wdHkgNDA2IGluc3RlYWQgb2YgYW4gdW5hY2NlcHRhYmxlIHJlcHJlc2VudGF0aW9uLlxuICAgICAgICAgIHJlc3BvbnNlLnNldFN0YXR1cyg0MDYpXG4gICAgICAgICAgcmVzcG9uc2Uuc2V0Qm9keShcIlwiKVxuICAgICAgICAgIGJvZHlUb0VtaXQgPSBcIlwiXG4gICAgICAgICAgY29udGVudExlbmd0aCA9IDBcbiAgICAgICAgfSBlbHNlIGlmIChjb21wcmVzc2lvblJlc3VsdC5vdXRjb21lID09IFwiY29tcHJlc3NlZFwiKSB7XG4gICAgICAgICAgYm9keVRvRW1pdCA9IGNvbXByZXNzaW9uUmVzdWx0LmJvZHlcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gY29tcHJlc3Npb25SZXN1bHQuYm9keS5sZW5ndGhcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gYm9keUJ1ZmZlci5sZW5ndGhcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBSZW1vdmUgYW55IGFwcGxpY2F0aW9uIHByZS1zZXQgQ29udGVudC1MZW5ndGggKGFueSBjYXNpbmcpIHNvIGV4YWN0bHkgb25lXG4gICAgICAvLyByZWNvbXB1dGVkIHZhbHVlIGdvZXMgb24gdGhlIHdpcmUuXG4gICAgICByZXNwb25zZS5yZW1vdmVIZWFkZXIoXCJDb250ZW50LUxlbmd0aFwiKVxuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29udGVudC1MZW5ndGhcIiwgY29udGVudExlbmd0aClcbiAgICB9XG5cbiAgICAvLyBGcmFtZXdvcmstb3duZWQgVmFyeSBkaW1lbnNpb246IHdoZW5ldmVyIGNvbXByZXNzaW9uIGlzIGVuYWJsZWQgYW5kIGFcbiAgICAvLyByZXByZXNlbnRhdGlvbiB3YXMgc2VsZWN0ZWQsIHRoZSByZXNwb25zZSBkZXBlbmRzIG9uIEFjY2VwdC1FbmNvZGluZyxcbiAgICAvLyBzbyBjYWNoZXMgbXVzdCBrZXkgb24gaXQuIEFwcGxpZWQgaWRlbnRpY2FsbHkgZm9yIGV2ZXJ5IG91dGNvbWVcbiAgICAvLyAodHJhbnNmb3JtZWQsIGlkZW50aXR5LCA0MDYsIGZpbGUpIGFuZCBmb3IgaGVhZGVyLXByZXNlbnQgYW5kXG4gICAgLy8gaGVhZGVyLWFic2VudCByZXF1ZXN0cyBhbGlrZSwgc28gdGhlIGhlYWRlciBpcyBzdGFibGUgYWNyb3NzIHJlcXVlc3RzIG9uXG4gICAgLy8gdGhlIHNhbWUgY29ubmVjdGlvbi4gQSB0cnVseSBib2R5bGVzcyByZXNwb25zZSBzZWxlY3RzIG5vIHJlcHJlc2VudGF0aW9uXG4gICAgLy8gYW5kIGNhcnJpZXMgbm8gZGltZW5zaW9uOyBhbiBhcHBsaWNhdGlvbi1zdXBwbGllZCBDb250ZW50LUVuY29kaW5nIGtlZXBzXG4gICAgLy8gdGhlIHJlcHJlc2VudGF0aW9uIGNvbnRyYWN0IGFwcGxpY2F0aW9uLW93bmVkIGFuZCBpcyBuZXZlciByZS1hZHZlcnRpc2VkLlxuICAgIGlmIChuZWdvdGlhdGVkICYmICFpc0JvZHlsZXNzU3RhdHVzICYmIGhhc0FwcGxpY2F0aW9uQ29udGVudEVuY29kaW5nID09PSBmYWxzZSkge1xuICAgICAgYWRkQWNjZXB0RW5jb2RpbmdUb1ZhcnkocmVzcG9uc2UpXG4gICAgfVxuXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiRGF0ZVwiLCBkYXRlLnRvVVRDU3RyaW5nKCkpXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiU2VydmVyXCIsIFwiVmVsb2Npb3VzXCIpXG5cbiAgICBsZXQgaGVhZGVycyA9IFwiXCJcblxuICAgIGhlYWRlcnMgKz0gYEhUVFAvJHtyZXF1ZXN0Lmh0dHBWZXJzaW9uKCl9ICR7cmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpfSAke3Jlc3BvbnNlLmdldFN0YXR1c01lc3NhZ2UoKX1cXHJcXG5gXG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlcktleSBpbiByZXNwb25zZS5oZWFkZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IGhlYWRlclZhbHVlIG9mIHJlc3BvbnNlLmhlYWRlcnNbaGVhZGVyS2V5XSkge1xuICAgICAgICBoZWFkZXJzICs9IGAke2hlYWRlcktleX06ICR7aGVhZGVyVmFsdWV9XFxyXFxuYFxuICAgICAgfVxuICAgIH1cblxuICAgIGhlYWRlcnMgKz0gXCJcXHJcXG5cIlxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBoZWFkZXJzIGVtaXR0ZWRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBoZWFkZXJzTGVuZ3RoOiBoZWFkZXJzLmxlbmd0aH1dKVxuXG4gICAgLy8gQSBuZWdvdGlhdGVkIGZpbGUgNDA2IGlzIGNvbW1pdHRlZCBhYm92ZSAoc3RhdHVzIDQwNiwgZW1wdHkgYm9keSkgYW5kIGl0c1xuICAgIC8vIGhlYWRlcnMgd2VyZSBqdXN0IGVtaXR0ZWQ6IHNldHRsZSBvbkZpbmlzaGVkIG5vdywgc28gdGhlIGNhbGxiYWNrIHJ1bnNcbiAgICAvLyBhZnRlciB0aGUgcmVzcG9uc2UgaXMgY29tbWl0dGVkIOKAlCBhIHNsb3cgb3IgYXBwLXN0b3BwaW5nIGNhbGxiYWNrIGNhbm5vdFxuICAgIC8vIGRlbGF5IG9yIGJsb2NrIGRlbGl2ZXJ5IG9mIHRoZSBhbHJlYWR5LWVtaXR0ZWQgNDA2LiBUaGUgZmlsZSBpcyBuZXZlclxuICAgIC8vIG9wZW5lZCwgc3RyZWFtZWQsIG9yIHJlcG9ydGVkIChubyBmaWxlIGV2ZW50KSwgYW5kIHRoZSBjYWxsYmFjayBzZXR0bGVzXG4gICAgLy8gZXhhY3RseSBvbmNlIGFzIFwiY29tcGxldGVkXCIuXG4gICAgaWYgKGlzRmlsZU5vdEFjY2VwdGFibGUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBmaWxlIGJvZHkgc3VwcHJlc3NlZCBmb3IgNDA2XCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGh9XSlcbiAgICAgIGF3YWl0IHRoaXMucnVuRmlsZU9uRmluaXNoZWQoe2ZpbGVQYXRoLCBvbkZpbmlzaGVkOiBmaWxlT25GaW5pc2hlZCwgcmVzdWx0OiBcImNvbXBsZXRlZFwifSlcbiAgICB9IGVsc2UgaWYgKGlzQm9keWxlc3NTdGF0dXMpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IHN1cHByZXNzZWQgZm9yIG5vLWJvZHkgc3RhdHVzXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgc3RhdHVzQ29kZTogcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpfV0pXG4gICAgICAvLyBBIGJvZHlsZXNzIHN0YXR1cyAoMXh4LzIwNC8zMDQpIHNlbGVjdHMgbm8gcmVwcmVzZW50YXRpb24sIHNvIG5vIGZpbGVcbiAgICAgIC8vIGJvZHkgb3IgZnJhbWV3b3JrIFZhcnkgaXMgZW1pdHRlZC4gVGhlIGZpbGUtb3duZXJzaGlwIHBhdGggc3RpbGwgc2V0dGxlc1xuICAgICAgLy8gb25GaW5pc2hlZCBleGFjdGx5IG9uY2UgYXMgXCJjb21wbGV0ZWRcIiAobm90aGluZyB3YXMgYWJvcnRlZCkg4oCUIGV2ZW4gd2hlblxuICAgICAgLy8gdGhlIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IOKAlCBwcmVzZXJ2aW5nIHRoZSBwcmUtY2hhbmdlIHNldHRsZW1lbnQuXG4gICAgICBpZiAoaGFzRmlsZVBhdGgpIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIGZhbHNlLCBmaWxlT25GaW5pc2hlZClcbiAgICB9IGVsc2UgaWYgKGlzSGVhZFJlcXVlc3QpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IHN1cHByZXNzZWQgZm9yIEhFQUQgcmVxdWVzdFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnR9XSlcbiAgICAgIGlmIChoYXNGaWxlUGF0aCkgYXdhaXQgdGhpcy5zZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgZmFsc2UsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSBpZiAoaGFzRmlsZVBhdGgpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIHRydWUsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGJvZHlUb0VtaXQpXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgYm9keSBlbWl0dGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgYm9keUxlbmd0aDogYm9keVRvRW1pdCA/IGJvZHlUb0VtaXQubGVuZ3RoIDogMH1dKVxuICAgIH1cblxuICAgIGF3YWl0IHJlcXVlc3RSdW5uZXIubG9nQ29tcGxldGVkUmVxdWVzdCgpXG5cbiAgICBpZiAoXCJnZXRSZXF1ZXN0UGFyc2VyXCIgaW4gcmVxdWVzdCkge1xuICAgICAgY29uc3QgaHR0cFJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAocmVxdWVzdClcbiAgICAgIGh0dHBSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKS5kZXN0cm95KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGZpbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gc2VuZEJvZHkgLSBXaGV0aGVyIHRoZSBmaWxlIGJvZHkgc2hvdWxkIGJlIHNlbnQuXG4gICAqIEBwYXJhbSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gb25GaW5pc2hlZCAtIENvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgc2VuZEJvZHksIG9uRmluaXNoZWQpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kRmlsZU91dHB1dCBzdGFydFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRofV0pXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICAgIGxldCBzZXR0bGVtZW50ID0gbnVsbFxuICAgICAgY29uc3Qgc2V0dGxlID0gKC8qKiBAdHlwZSB7XCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwifSAqLyB0cmFuc2ZlclJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlbWVudCkgcmV0dXJuIHNldHRsZW1lbnRcblxuICAgICAgICB0aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzLmRlbGV0ZShzZXR0bGUpXG4gICAgICAgIHNldHRsZW1lbnQgPSB0aGlzLnJ1bkZpbGVPbkZpbmlzaGVkKHtmaWxlUGF0aCwgb25GaW5pc2hlZCwgcmVzdWx0OiB0cmFuc2ZlclJlc3VsdH0pXG4gICAgICAgICAgLmZpbmFsbHkoKCkgPT4gcmVzb2x2ZSh0cmFuc2ZlclJlc3VsdCkpXG5cbiAgICAgICAgcmV0dXJuIHNldHRsZW1lbnRcbiAgICAgIH1cblxuICAgICAgdGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlcy5hZGQoc2V0dGxlKVxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImZpbGVcIiwge2ZpbGVQYXRoLCBzZW5kQm9keSwgc2V0dGxlfSlcbiAgICB9KVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZEZpbGVPdXRwdXQgZG9uZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHR9XSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgZmlsZSBjb21wbGV0aW9uIGNhbGxiYWNrIHdpdGhvdXQgYWxsb3dpbmcgY2xlYW51cCBmYWlsdXJlcyB0byByZXBsYWNlIHRoZSBjb21taXR0ZWQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29tcGxldGlvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHsoKHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBudWxsfSBhcmdzLm9uRmluaXNoZWQgLSBDb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIn0gYXJncy5yZXN1bHQgLSBUcmFuc2ZlciByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNhbGxiYWNrIGNsZWFudXAgYW5kIGVycm9yIHJlcG9ydGluZyBmaW5pc2guXG4gICAqL1xuICBhc3luYyBydW5GaWxlT25GaW5pc2hlZCh7ZmlsZVBhdGgsIG9uRmluaXNoZWQsIHJlc3VsdH0pIHtcbiAgICBpZiAoIW9uRmluaXNoZWQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG9uRmluaXNoZWQocmVzdWx0KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IGVuc3VyZUVycm9yKGNhdWdodEVycm9yKVxuXG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGaWxlIHJlc3BvbnNlIG9uRmluaXNoZWQgY2FsbGJhY2sgZmFpbGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGgsIHJlc3VsdH0sIGVycm9yXSlcblxuICAgICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgICBjb250ZXh0OiB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHQsIHN0YWdlOiBcInNlbmQtZmlsZS1vbi1maW5pc2hlZFwifSxcbiAgICAgICAgZXJyb3JcbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5lcnJvclBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFib3J0cyBhbGwgZmlsZSByZXNwb25zZXMgYXdhaXRpbmcgdHJhbnNwb3J0IGFja25vd2xlZGdlbWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVuZGluZyBjYWxsYmFja3Mgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRQZW5kaW5nRmlsZVJlc3BvbnNlcygpIHtcbiAgICBhd2FpdCBQcm9taXNlLmFsbChbLi4udGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlc10ubWFwKChzZXR0bGUpID0+IHNldHRsZShcImFib3J0ZWRcIikpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIGNsb3NlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IHJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29ubmVjdGlvbiBzaG91bGQgYmUgY2xvc2VkLlxuICAgKi9cbiAgc2hvdWxkQ2xvc2VDb25uZWN0aW9uKHJlcXVlc3QpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHJlcXVlc3QuaHR0cFZlcnNpb24oKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25IZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImNvbm5lY3Rpb25cIik/LnRvTG93ZXJDYXNlKCk/LnRyaW0oKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25Ub2tlbnMgPSBjb25uZWN0aW9uSGVhZGVyXG4gICAgICA/IGNvbm5lY3Rpb25IZWFkZXIuc3BsaXQoXCIsXCIpLm1hcCgodG9rZW4pID0+IHRva2VuLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pXG4gICAgICA6IFtdXG5cbiAgICBpZiAoaHR0cFZlcnNpb24gPT0gXCJ3ZWJzb2NrZXRcIikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGNvbm5lY3Rpb25Ub2tlbnMuaW5jbHVkZXMoXCJjbG9zZVwiKSkgcmV0dXJuIHRydWVcblxuICAgIGlmIChodHRwVmVyc2lvbiA9PSBcIjEuMFwiICYmIGNvbm5lY3Rpb25IZWFkZXIgIT0gXCJrZWVwLWFsaXZlXCIpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBmb3IgdGhlIHN0YXR1cyBjb2RlcyB0aGF0IFJGQyA3MjMwIMKnMy4zLjMgZGVjbGFyZXNcbiAqIGNhbm5vdCBjYXJyeSBhIG1lc3NhZ2UgYm9keTogZXZlcnkgMXh4IGluZm9ybWF0aW9uYWwsIDIwNCBOb1xuICogQ29udGVudCwgYW5kIDMwNCBOb3QgTW9kaWZpZWQuXG4gKiBAcGFyYW0ge251bWJlcn0gc3RhdHVzQ29kZSAtIEhUVFAgc3RhdHVzIGNvZGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBzdGF0dXMgY29kZSBmb3JiaWRzIGEgcmVzcG9uc2UgYm9keS5cbiAqL1xuZnVuY3Rpb24gaXNOb0JvZHlTdGF0dXNDb2RlKHN0YXR1c0NvZGUpIHtcbiAgcmV0dXJuIChzdGF0dXNDb2RlID49IDEwMCAmJiBzdGF0dXNDb2RlIDwgMjAwKSB8fCBzdGF0dXNDb2RlID09PSAyMDQgfHwgc3RhdHVzQ29kZSA9PT0gMzA0XG59XG4iXX0=