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
        /**
         * Streams that have started but have not finished or been aborted yet.
         * @type {Map<import("./response.js").default, {clientCount: number, request: import("./request.js").default}>} */
        this._activeStreamResponses = new Map();
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
        // A streaming response emits its headers and chunks to the client while
        // the request is still running, so the response needs the owning client
        // as its transport sink before the handler runs. Sub-requests (e.g.
        // websocket request payloads) have no socket and keep transport null;
        // their responses fail loudly if they attempt to stream.
        const socketRequest = currentRequest;
        requestRunner.response.transport = this;
        requestRunner.response.transportRequest = socketRequest;
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
        // A streaming response already emitted its status line, headers, every
        // chunk, and the chunked terminator to the client while the request was
        // running. Nothing left to send here — just log the completed request.
        if (response.isStreaming()) {
            await requestRunner.logCompletedRequest();
            return;
        }
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
     * Sink the owning worker handler wires in for stream output. The
     * in-process handler resolves it after the framed output has been enqueued
     * for delivery to the socket, so stream chunks share the bounded, ordered
     * delivery path (byte/frame limits and socket backpressure) instead of
     * being buffered unboundedly for a stalled client. The worker-thread
     * handler keeps null: its output crosses to the parent over IPC and no
     * per-chunk acknowledgement is available.
     * @type {((output: string) => Promise<void>) | null} */
    streamOutputSink = null;
    /**
     * Narrows the response to the documented streaming transport shape.
     * @param {import("./response.js").default} response - Response to stream.
     * @returns {{streaming: boolean, streamEnded: boolean, streamAborted: boolean, headers: Record<string, string[]>, getStatusCode: () => number, getStatusMessage: () => string, streamCloseCallbacks: Set<() => void>}} - Streaming view of the response.
     */
    _streamingResponse(response) {
        return response;
    }
    /**
     * Starts a live chunked stream for a socket-bound response: emits the
     * status line and headers (with `Transfer-Encoding: chunked`) to the
     * client immediately so subsequent `write()` chunks reach the client as
     * they are produced.
     * @param {import("./response.js").default} response - Response to stream.
     * @param {import("./request.js").default} request - Socket-bound request.
     * @returns {void} - No return value.
     */
    beginStreamResponse(response, request) {
        this._activeStreamResponses.set(response, { clientCount: this.clientCount, request });
        const httpVersion = request.httpVersion();
        // HTTP/1.0 has no chunked transfer encoding: terminate the stream with a
        // connection close instead of a zero-length chunk.
        if (httpVersion == "1.0" && !this.shouldCloseConnection(request)) {
            response.setHeader("Connection", "Close");
        }
        // The chunked framing owns the body length; a Content-Length header set
        // by the application before stream() would desynchronize the framing.
        response.removeHeader("Content-Length");
        if (response.getHeader("Transfer-Encoding").length === 0) {
            response.setHeader("Transfer-Encoding", "chunked");
        }
        response.setHeader("Date", new Date().toUTCString());
        response.setHeader("Server", "Velocious");
        const responseView = this._streamingResponse(response);
        let headers = "";
        headers += `HTTP/${httpVersion} ${responseView.getStatusCode()} ${responseView.getStatusMessage()}\r\n`;
        for (const headerKey in responseView.headers) {
            for (const headerValue of responseView.headers[headerKey]) {
                headers += `${headerKey}: ${headerValue}\r\n`;
            }
        }
        headers += "\r\n";
        this.events.emit("output", headers);
    }
    /**
     * Emits one chunked-encoded body chunk for an active stream.
     * @param {string | Uint8Array} chunk - Chunk to emit.
     * @returns {Promise<void>} - Settles after the chunk has been delivered to
     * the client.
     */
    async writeStreamChunk(chunk) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
        const frame = `${bytes.length.toString(16)}\r\n${bytes}\r\n`;
        if (this.streamOutputSink === null) {
            this.events.emit("output", frame);
            return;
        }
        await this.streamOutputSink(frame);
    }
    /**
     * Emits the zero-length chunked terminator for a stream that finished on a
     * live connection, then runs its close callbacks.
     * @param {import("./response.js").default} response - Response to finish.
     * @returns {Promise<void>} - Settles after the terminator was delivered and
     * the close callbacks ran.
     */
    async endStreamResponse(response) {
        if (response.streamEnded)
            return;
        response.streamEnded = true;
        this._activeStreamResponses.delete(response);
        if (this.streamOutputSink === null) {
            this.events.emit("output", "0\r\n\r\n");
        }
        else {
            await this.streamOutputSink("0\r\n\r\n");
        }
        await this._runStreamCloseCallbacks(response);
    }
    /**
     * Aborts every stream whose client connection went away: marks the stream
     * aborted and runs the close callbacks so in-flight work can settle its
     * resources. No terminator is emitted — the connection is already gone.
     * @returns {Promise<void>} - Resolves after every stream settled.
     */
    async abortStreamResponses() {
        for (const response of [...this._activeStreamResponses.keys()]) {
            if (response.streamAborted)
                continue;
            response.streamAborted = true;
            this._activeStreamResponses.delete(response);
            await this._runStreamCloseCallbacks(response);
        }
    }
    /**
     * Marks every in-flight request as client-disconnected and runs its
     * disconnect callbacks. The worker handler calls this when the underlying
     * socket tears down, so a handler whose response is still buffered (e.g.
     * waiting in an admission queue) can observe the client leaving without
     * waiting for the response to be sent.
     * @returns {void}
     */
    notifyClientDisconnect() {
        for (const requestRunner of this.requestRunners) {
            if (requestRunner.getState() !== "running")
                continue;
            requestRunner.getRequest().markClientDisconnected();
        }
    }
    /**
     * Runs the close callbacks of a finished or aborted stream exactly once.
     * @param {import("./response.js").default} response - Finished stream.
     * @returns {Promise<void>} - Resolves after every callback ran.
     */
    async _runStreamCloseCallbacks(response) {
        if (response.streamCloseCallbacks.size === 0)
            return;
        for (const callback of response.streamCloseCallbacks) {
            try {
                callback();
            }
            catch (error) {
                const errorPayload = {
                    context: { clientCount: this.clientCount, stage: "stream-close-callback" },
                    error
                };
                this.configuration.getErrorEvents().emit("framework-error", errorPayload);
                this.configuration.getErrorEvents().emit("all-error", { ...errorPayload, errorType: "framework-error" });
            }
        }
        response.streamCloseCallbacks.clear();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUE7QUFDM0IsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sRUFBQyw0QkFBNEIsRUFBQyxNQUFNLGFBQWEsQ0FBQTtBQUN4RCxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLHVCQUF1QixFQUFFLHdCQUF3QixFQUFFLHdCQUF3QixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDckgsT0FBTyxnQkFBZ0IsTUFBTSx3QkFBd0IsQ0FBQTtBQUVyRDs7OztHQUlHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxLQUFLO0lBQzlCLE9BQU87UUFDTCxVQUFVLEVBQUUsS0FBSyxDQUFDLElBQUk7UUFDdEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLGdCQUFnQixFQUFFLEtBQUssQ0FBQyxnQkFBZ0I7S0FDekMsQ0FBQTtBQUNILENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3QyxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUMzQixLQUFLLEdBQUcsU0FBUyxDQUFBO0lBRWpCOzt5QkFFcUI7SUFDckIsd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0lBRWhDOzt5QkFFcUI7SUFDckIseUJBQXlCLEdBQUcsS0FBSyxDQUFBO0lBRWpDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxXQUFXLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBQztRQUNyRCxJQUFJLENBQUMsYUFBYTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtRQUU3RCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQzlCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBRWxDOztxQ0FFNkI7UUFDN0IsSUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFFeEIsc0VBQXNFO1FBQ3RFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXJDOzswSEFFa0g7UUFDbEgsSUFBSSxDQUFDLHNCQUFzQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFDekMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx1QkFBdUIsQ0FBQyxPQUFPO1FBQzdCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFBO1FBQy9ELE1BQU0sSUFBSSxHQUFHLEdBQUcsT0FBTyxJQUFJLENBQUE7UUFDM0IsTUFBTSxPQUFPLEdBQUc7WUFDZCxRQUFRLFdBQVcsa0JBQWtCO1lBQ3JDLG1CQUFtQjtZQUNuQix5Q0FBeUM7WUFDekMsbUJBQW1CLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFO1lBQ3BELEVBQUU7WUFDRixJQUFJO1NBQ0wsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFZCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx1QkFBdUIsQ0FBQyxPQUFPO1FBQzdCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFBO1FBQy9ELE1BQU0sSUFBSSxHQUFHLEdBQUcsT0FBTyxJQUFJLENBQUE7UUFDM0IsTUFBTSxPQUFPLEdBQUc7WUFDZCxRQUFRLFdBQVcsa0JBQWtCO1lBQ3JDLG1CQUFtQjtZQUNuQix5Q0FBeUM7WUFDekMsbUJBQW1CLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFO1lBQ3BELEVBQUU7WUFDRixJQUFJO1NBQ0wsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFZCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILDRCQUE0QjtRQUMxQixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLFdBQVcsRUFBRSxJQUFJLEtBQUssQ0FBQTtRQUMvRCxNQUFNLElBQUksR0FBRyxxQkFBcUIsQ0FBQTtRQUNsQyxNQUFNLE9BQU8sR0FBRztZQUNkLFFBQVEsV0FBVyx3QkFBd0I7WUFDM0MsbUJBQW1CO1lBQ25CLHlDQUF5QztZQUN6QyxtQkFBbUIsTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEVBQUU7WUFDcEQsRUFBRTtZQUNGLElBQUk7U0FDTCxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVkLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdCQUFnQixDQUFDLEtBQUs7UUFDcEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyw4QkFBOEIsRUFBRSxpQkFBaUIsQ0FBQyx5RkFBeUYsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTlLLElBQUksSUFBSSxDQUFDLGNBQWMsSUFBSSxrQkFBa0IsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDckUsTUFBTSxXQUFXLEdBQUcsNkNBQTZDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7WUFFdkYsV0FBVyxDQUFDLGdCQUFnQixFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDMUMsQ0FBQztRQUVELElBQUksQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO1FBQy9CLElBQUksQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFBO1FBRXRCLElBQUksS0FBSyxZQUFZLDRCQUE0QixFQUFFLENBQUM7WUFDbEQsSUFBSSxDQUFDLDRCQUE0QixFQUFFLENBQUE7UUFDckMsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsdUJBQXVCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDN0MsQ0FBQztJQUNILENBQUM7SUFFRCxxQkFBcUIsR0FBRyxHQUFHLEVBQUU7UUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtRQUUxQyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFBO1FBRTFDLElBQUksQ0FBQyxjQUFjO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBQzFELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFDcEQsTUFBTSxlQUFlLEdBQUcsUUFBUSxDQUFDLHNCQUFzQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsK0JBQStCLEVBQUU7Z0JBQ3hELFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztnQkFDN0IsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVLEVBQUU7Z0JBQ3ZDLFdBQVcsRUFBRSxjQUFjLENBQUMsV0FBVyxFQUFFO2dCQUN6QyxJQUFJLEVBQUUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEVBQUUsZUFBZSxDQUFDO2dCQUNqRSxXQUFXLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNO2FBQ3hDLENBQUMsQ0FBQyxDQUFBO1FBRUgsSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUMxQixPQUFNO1FBQ1IsQ0FBQztRQUVELGdKQUFnSjtRQUNoSixJQUFJLENBQUMsS0FBSyxHQUFHLFNBQVMsQ0FBQTtRQUV0QixNQUFNLGFBQWEsR0FBRyxJQUFJLGFBQWEsQ0FBQztZQUN0QyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsT0FBTyxFQUFFLGNBQWM7U0FDeEIsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFdkMsd0VBQXdFO1FBQ3hFLHdFQUF3RTtRQUN4RSxvRUFBb0U7UUFDcEUsc0VBQXNFO1FBQ3RFLHlEQUF5RDtRQUN6RCxNQUFNLGFBQWEsR0FBRyxjQUFjLENBQUE7UUFDcEMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFBO1FBQ3ZDLGFBQWEsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLEdBQUcsYUFBYSxDQUFBO1FBRXZELGFBQWEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDakQsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFBO0lBQ3JCLENBQUMsQ0FBQTtJQUVEOzs7O09BSUc7SUFDSCxPQUFPLENBQUMsSUFBSTtRQUNWLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZUFBZSxFQUFFO2dCQUN4QyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7Z0JBQzdCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtnQkFDbkIsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO2FBQ2xCLENBQUMsQ0FBQyxDQUFBO1FBRUgsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUMxQixJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ2xDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0g7OzRDQUVnQztZQUNoQyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUE7WUFFcEIsT0FBTyxTQUFTLEVBQUUsQ0FBQztnQkFDakIsSUFBSSxTQUFTLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQUUsTUFBSztnQkFFaEMsSUFBSSxJQUFJLENBQUMsS0FBSyxJQUFJLFNBQVMsRUFBRSxDQUFDO29CQUM1QixNQUFNLGVBQWUsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFBO29CQUV4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGlDQUFpQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQyxDQUFBO29CQUM5RyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksT0FBTyxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7b0JBQ3BGLElBQUksQ0FBQyxjQUFjLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO29CQUMvRSxJQUFJLENBQUMsS0FBSyxHQUFHLGdCQUFnQixDQUFBO2dCQUMvQixDQUFDO3FCQUFNLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO29CQUMxQyxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtnQkFDNUQsQ0FBQztnQkFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO2dCQUUvRCxTQUFTLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQy9DLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsb0JBQW9CLEVBQUU7d0JBQzdDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVzt3QkFDN0IsWUFBWSxFQUFFLE9BQU8sQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO3dCQUN4QyxlQUFlLEVBQUUsU0FBUyxFQUFFLE1BQU0sSUFBSSxDQUFDO3dCQUN2QyxlQUFlLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDLFlBQVk7cUJBQ3RFLENBQUMsQ0FBQyxDQUFBO2dCQUVILElBQUksU0FBUyxJQUFJLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3RDLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtvQkFFNUQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsQ0FBQzt3QkFDaEMsTUFBTSxlQUFlLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQTt3QkFFeEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQkFBK0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLGVBQWUsRUFBQyxDQUFDLENBQUMsQ0FBQTt3QkFDNUcsTUFBSztvQkFDUCxDQUFDO29CQUVELElBQUksQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFBO29CQUN0QixNQUFNLGVBQWUsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFBO29CQUV4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtDQUErQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUM5SCxDQUFDO1lBQ0gsQ0FBQztZQUNELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsYUFBYSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3ZJLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQzNDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLE9BQU87UUFDekIsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxXQUFXLEVBQUUsQ0FBQTtRQUM5RCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLENBQUE7UUFFcEUsT0FBTyxPQUFPLENBQUMsYUFBYSxJQUFJLFdBQVcsSUFBSSxnQkFBZ0IsRUFBRSxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtJQUN2RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtRQUUvRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsdUJBQXVCLENBQUMsa0NBQWtDLENBQUMsQ0FBQTtZQUNoRSxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7YUFDakQsTUFBTSxDQUFDLEdBQUcsZUFBZSxzQ0FBc0MsRUFBRSxRQUFRLENBQUM7YUFDMUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ25CLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFBO1FBQzlELE1BQU0sYUFBYSxHQUFHO1lBQ3BCLFFBQVEsV0FBVywwQkFBMEI7WUFDN0Msb0JBQW9CO1lBQ3BCLHFCQUFxQjtZQUNyQix5QkFBeUIsa0JBQWtCLEVBQUU7WUFDN0MsRUFBRTtZQUNGLEVBQUU7U0FDSCxDQUFBO1FBQ0QsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUzQyxNQUFNLHNCQUFzQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsa0NBQWtDLEVBQUUsRUFBRSxDQUFBO1FBQ3hGLElBQUksY0FBYyxDQUFBO1FBQ2xCLElBQUkscUJBQXFCLENBQUE7UUFFekIsSUFBSSxzQkFBc0IsRUFBRSxDQUFDO1lBQzNCLE1BQU0sZUFBZSxHQUFHLHNCQUFzQixDQUFDO2dCQUM3QyxNQUFNLEVBQUUsSUFBSTtnQkFDWixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQ2pDLE9BQU8sRUFBRSxJQUFJLENBQUMsY0FBYzthQUM3QixDQUFDLENBQUE7WUFFRixNQUFNLGdCQUFnQixHQUFHLHdHQUF3RyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUE7WUFFbkosSUFBSSxnQkFBZ0IsRUFBRSxJQUFJLEVBQUUsQ0FBQztnQkFDM0IscUJBQXFCLEdBQUcsNkZBQTZGLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQTtZQUN6SSxDQUFDO2lCQUFNLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQzNCLGNBQWMsR0FBRyw2RUFBNkUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBQ2xILENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksZ0JBQWdCLENBQUM7WUFDM0MsTUFBTSxFQUFFLElBQUk7WUFDWixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjO1lBQ25DLGNBQWMsRUFBRSxjQUFjO1lBQzlCLHFCQUFxQixFQUFFLHFCQUFxQjtTQUM3QyxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFO1lBQzVDLDZEQUE2RDtZQUM3RCw0REFBNEQ7WUFDNUQscURBQXFEO1lBQ3JELElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLEVBQUUsQ0FBQztnQkFDdkMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLE9BQU8sRUFBRSxDQUFBO1lBQ2xDLENBQUM7WUFDRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1lBQ2pDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzNCLENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxFQUFDLFNBQVMsRUFBQyxFQUFFLEVBQUU7WUFDbEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsRUFBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQ3hELENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxFQUFDLFNBQVMsRUFBQyxFQUFFLEVBQUU7WUFDbkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsMEJBQTBCLEVBQUUsRUFBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQzNELENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLEtBQUssR0FBRyxXQUFXLENBQUE7UUFDeEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ3BDLEtBQUssSUFBSSxDQUFDLGdCQUFnQixDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDOUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixFQUFFLENBQUE7SUFDaEQsQ0FBQztJQUVELFdBQVcsR0FBRyxHQUFHLEVBQUU7UUFDakIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxhQUFhLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFFbEgsT0FBTyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUMvQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUM3RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMzQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUMsQ0FBQTtJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztZQUNsQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsSUFBSSxDQUFBO1lBQ3JDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLHdCQUF3QixHQUFHLElBQUksQ0FBQTtRQUVwQyxJQUFJLENBQUM7WUFDSCxHQUFHLENBQUM7Z0JBQ0YsSUFBSSxDQUFDLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtnQkFDdEMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtZQUMvQixDQUFDLFFBQVEsSUFBSSxDQUFDLHlCQUF5QixFQUFDO1FBQzFDLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyx3QkFBd0IsR0FBRyxLQUFLLENBQUE7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCO1FBQ3BCLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDWixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQzVDLE1BQU0sT0FBTyxHQUFHLGFBQWEsRUFBRSxVQUFVLEVBQUUsQ0FBQTtZQUUzQyxJQUFJLGFBQWEsRUFBRSxRQUFRLEVBQUUsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDeEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFBO2dCQUN6QyxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUE7Z0JBQzVFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUVqRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFBO2dCQUMzQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGdDQUFnQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUNySSxJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsQ0FBQyxDQUFBO2dCQUN4QyxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxvQkFBb0IsSUFBSSxDQUFDLFdBQVcsZ0NBQWdDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtvQkFDdEcsTUFBTSxLQUFLLENBQUE7Z0JBQ2IsQ0FBQztnQkFDRCxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssT0FBTyxJQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztvQkFBRSxJQUFJLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQTtnQkFDaEcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUMsQ0FBQTtnQkFFN0csSUFBSSxxQkFBcUIsRUFBRSxDQUFDO29CQUMxQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxXQUFXLDBCQUEwQixnQkFBZ0IsRUFBRSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUE7b0JBQ3JKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUMzQixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQUs7WUFDUCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLGFBQWE7UUFDOUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUVoRCx1RUFBdUU7UUFDdkUsd0VBQXdFO1FBQ3hFLHVFQUF1RTtRQUN2RSxJQUFJLFFBQVEsQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQzNCLE1BQU0sYUFBYSxDQUFDLG1CQUFtQixFQUFFLENBQUE7WUFDekMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDMUMsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3ZDLE1BQU0sY0FBYyxHQUFHLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ25ELE1BQU0sSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUE7UUFDdkIsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFBO1FBQzVFLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNqRSxNQUFNLFdBQVcsR0FBRyxPQUFPLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUE7UUFDdkUsTUFBTSxJQUFJLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwRCxNQUFNLFlBQVksR0FBRyxPQUFPLElBQUksS0FBSyxRQUFRLENBQUE7UUFDN0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLFVBQVUsQ0FBQTtRQUUvQyxJQUFJLENBQUMsV0FBVyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDbkQsTUFBTSxJQUFJLEtBQUssQ0FBQyw0REFBNEQsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQzVGLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxnQkFBZ0IsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQ2pHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsc0JBQXNCLEVBQUU7Z0JBQy9DLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztnQkFDN0IsV0FBVztnQkFDWCxRQUFRO2dCQUNSLFlBQVk7Z0JBQ1osWUFBWTthQUNiLENBQUMsQ0FBQyxDQUFBO1FBRUgsSUFBSSxxQkFBcUIsRUFBRSxDQUFDO1lBQzFCLFFBQVEsQ0FBQyxTQUFTLENBQUMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzNDLENBQUM7YUFBTSxJQUFJLFdBQVcsSUFBSSxLQUFLLElBQUksZ0JBQWdCLElBQUksWUFBWSxFQUFFLENBQUM7WUFDcEUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxZQUFZLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDaEQsQ0FBQztRQUVELHFFQUFxRTtRQUNyRSxvRUFBb0U7UUFDcEUsb0VBQW9FO1FBQ3BFLGdFQUFnRTtRQUNoRSxtREFBbUQ7UUFDbkQsTUFBTSxnQkFBZ0IsR0FBRyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQTtRQUVyRSxpRkFBaUY7UUFDakYsaUZBQWlGO1FBQ2pGLGlEQUFpRDtRQUNqRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsVUFBVSxFQUFFLElBQUksTUFBTSxDQUFBO1FBRXBELHlDQUF5QztRQUN6QyxJQUFJLFVBQVUsR0FBRyxJQUFJLENBQUE7UUFFckIsMEVBQTBFO1FBQzFFLHNFQUFzRTtRQUN0RSxxRUFBcUU7UUFDckUsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBQ2pFLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDaEgsbUVBQW1FO1FBQ25FLDBFQUEwRTtRQUMxRSx3RUFBd0U7UUFDeEUseUVBQXlFO1FBQ3pFLHVDQUF1QztRQUN2QyxNQUFNLDZCQUE2QixHQUFHLFFBQVEsQ0FBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZGLHlFQUF5RTtRQUN6RSwwRUFBMEU7UUFDMUUsc0VBQXNFO1FBQ3RFLHFFQUFxRTtRQUNyRSwyRUFBMkU7UUFDM0UsTUFBTSxtQkFBbUIsR0FBRyxXQUFXLElBQUksQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDLGVBQWUsSUFBSSxVQUFVLElBQUksVUFBVSxDQUFDLGtCQUFrQixLQUFLLEtBQUssQ0FBQyxJQUFJLDZCQUE2QixLQUFLLEtBQUssSUFBSSxDQUFDLGdCQUFnQixDQUFBO1FBRXJNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RCLElBQUksYUFBYSxDQUFBO1lBRWpCLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2hCLElBQUksbUJBQW1CLEVBQUUsQ0FBQztvQkFDeEIscUVBQXFFO29CQUNyRSxpRUFBaUU7b0JBQ2pFLG9FQUFvRTtvQkFDcEUsc0RBQXNEO29CQUN0RCxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFBO29CQUN2QixRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBO29CQUNwQixVQUFVLEdBQUcsRUFBRSxDQUFBO29CQUNmLGFBQWEsR0FBRyxDQUFDLENBQUE7Z0JBQ25CLENBQUM7cUJBQU0sQ0FBQztvQkFDTixNQUFNLEtBQUssR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7b0JBQ3JDLGFBQWEsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFBO2dCQUM1QixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGdGQUFnRjtnQkFDaEYsc0RBQXNEO2dCQUN0RCxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUMvRSxNQUFNLGlCQUFpQixHQUFHLE1BQU0sd0JBQXdCLENBQUM7b0JBQ3ZELFVBQVU7b0JBQ1YsV0FBVyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsd0JBQXdCLEVBQUU7b0JBQzFELE9BQU87b0JBQ1AsUUFBUTtpQkFDVCxDQUFDLENBQUE7Z0JBRUYsSUFBSSxpQkFBaUIsQ0FBQyxPQUFPLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztvQkFDbEQsNEVBQTRFO29CQUM1RSwrREFBK0Q7b0JBQy9ELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUE7b0JBQ3ZCLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUE7b0JBQ3BCLFVBQVUsR0FBRyxFQUFFLENBQUE7b0JBQ2YsYUFBYSxHQUFHLENBQUMsQ0FBQTtnQkFDbkIsQ0FBQztxQkFBTSxJQUFJLGlCQUFpQixDQUFDLE9BQU8sSUFBSSxZQUFZLEVBQUUsQ0FBQztvQkFDckQsVUFBVSxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBQTtvQkFDbkMsYUFBYSxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUE7Z0JBQy9DLENBQUM7cUJBQU0sQ0FBQztvQkFDTixhQUFhLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBQTtnQkFDbkMsQ0FBQztZQUNILENBQUM7WUFFRCw0RUFBNEU7WUFDNUUscUNBQXFDO1lBQ3JDLFFBQVEsQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtZQUN2QyxRQUFRLENBQUMsU0FBUyxDQUFDLGdCQUFnQixFQUFFLGFBQWEsQ0FBQyxDQUFBO1FBQ3JELENBQUM7UUFFRCx3RUFBd0U7UUFDeEUsd0VBQXdFO1FBQ3hFLGtFQUFrRTtRQUNsRSxnRUFBZ0U7UUFDaEUsMkVBQTJFO1FBQzNFLDJFQUEyRTtRQUMzRSwyRUFBMkU7UUFDM0UsNEVBQTRFO1FBQzVFLElBQUksVUFBVSxJQUFJLENBQUMsZ0JBQWdCLElBQUksNkJBQTZCLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDL0UsdUJBQXVCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDbkMsQ0FBQztRQUVELFFBQVEsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFBO1FBQzlDLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1FBRXpDLElBQUksT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUVoQixPQUFPLElBQUksUUFBUSxPQUFPLENBQUMsV0FBVyxFQUFFLElBQUksUUFBUSxDQUFDLGFBQWEsRUFBRSxJQUFJLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxNQUFNLENBQUE7UUFFekcsS0FBSyxNQUFNLFNBQVMsSUFBSSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDekMsS0FBSyxNQUFNLFdBQVcsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELE9BQU8sSUFBSSxHQUFHLFNBQVMsS0FBSyxXQUFXLE1BQU0sQ0FBQTtZQUMvQyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sSUFBSSxNQUFNLENBQUE7UUFFakIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ25DLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxhQUFhLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUV6SCw0RUFBNEU7UUFDNUUseUVBQXlFO1FBQ3pFLDJFQUEyRTtRQUMzRSx3RUFBd0U7UUFDeEUsMEVBQTBFO1FBQzFFLCtCQUErQjtRQUMvQixJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDeEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywyQ0FBMkMsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQTtZQUNqSCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxVQUFVLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQzNGLENBQUM7YUFBTSxJQUFJLGdCQUFnQixFQUFFLENBQUM7WUFDNUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxpREFBaUQsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsYUFBYSxFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFDbkosd0VBQXdFO1lBQ3hFLDJFQUEyRTtZQUMzRSwyRUFBMkU7WUFDM0Usc0VBQXNFO1lBQ3RFLElBQUksV0FBVztnQkFBRSxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxjQUFjLENBQUMsQ0FBQTtRQUM3RSxDQUFDO2FBQU0sSUFBSSxhQUFhLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtDQUErQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFDM0csSUFBSSxXQUFXO2dCQUFFLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBQzdFLENBQUM7YUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBQzNELENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFBO1lBQ3RDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMkJBQTJCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDekksQ0FBQztRQUVELE1BQU0sYUFBYSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFekMsSUFBSSxrQkFBa0IsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNsQyxNQUFNLFdBQVcsR0FBRyw2Q0FBNkMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQzNFLFdBQVcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzFDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLFVBQVU7UUFDakQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxzQkFBc0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUU1RixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDM0MsbUNBQW1DO1lBQ25DLElBQUksVUFBVSxHQUFHLElBQUksQ0FBQTtZQUNyQixNQUFNLE1BQU0sR0FBRyxDQUFDLHNDQUFzQyxDQUFDLGNBQWMsRUFBRSxFQUFFO2dCQUN2RSxJQUFJLFVBQVU7b0JBQUUsT0FBTyxVQUFVLENBQUE7Z0JBRWpDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQ3hDLFVBQVUsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUMsQ0FBQztxQkFDaEYsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFBO2dCQUV6QyxPQUFPLFVBQVUsQ0FBQTtZQUNuQixDQUFDLENBQUE7WUFFRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3JDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN4RCxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMscUJBQXFCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ3JHLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBRXZCLElBQUksQ0FBQztZQUNILE1BQU0sVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzFCLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxXQUFXLENBQUMsQ0FBQTtZQUV0QyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMENBQTBDLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUVySSxNQUFNLFlBQVksR0FBRztnQkFDbkIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUM7Z0JBQzFGLEtBQUs7YUFDTixDQUFBO1lBRUQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsWUFBWSxDQUFDLENBQUE7WUFDekUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxZQUFZLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtRQUN4RyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyx5QkFBeUI7UUFDN0IsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDdEYsQ0FBQztJQUVEOzs7Ozs7Ozs0REFRd0Q7SUFDeEQsZ0JBQWdCLEdBQUcsSUFBSSxDQUFBO0lBRXZCOzs7O09BSUc7SUFDSCxrQkFBa0IsQ0FBQyxRQUFRO1FBQ3pCLE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILG1CQUFtQixDQUFDLFFBQVEsRUFBRSxPQUFPO1FBQ25DLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtRQUVuRixNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFekMseUVBQXlFO1FBQ3pFLG1EQUFtRDtRQUNuRCxJQUFJLFdBQVcsSUFBSSxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNqRSxRQUFRLENBQUMsU0FBUyxDQUFDLFlBQVksRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUMzQyxDQUFDO1FBRUQsd0VBQXdFO1FBQ3hFLHNFQUFzRTtRQUN0RSxRQUFRLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDdkMsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLG1CQUFtQixDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3pELFFBQVEsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDcEQsQ0FBQztRQUVELFFBQVEsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQTtRQUNwRCxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUV6QyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdEQsSUFBSSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBQ2hCLE9BQU8sSUFBSSxRQUFRLFdBQVcsSUFBSSxZQUFZLENBQUMsYUFBYSxFQUFFLElBQUksWUFBWSxDQUFDLGdCQUFnQixFQUFFLE1BQU0sQ0FBQTtRQUV2RyxLQUFLLE1BQU0sU0FBUyxJQUFJLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUM3QyxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDMUQsT0FBTyxJQUFJLEdBQUcsU0FBUyxLQUFLLFdBQVcsTUFBTSxDQUFBO1lBQy9DLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLE1BQU0sQ0FBQTtRQUNqQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQUs7UUFDMUIsTUFBTSxLQUFLLEdBQUcsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN6RixNQUFNLEtBQUssR0FBRyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEtBQUssTUFBTSxDQUFBO1FBQzVELElBQUksSUFBSSxDQUFDLGdCQUFnQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ25DLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUNqQyxPQUFNO1FBQ1IsQ0FBQztRQUNELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsUUFBUTtRQUM5QixJQUFJLFFBQVEsQ0FBQyxXQUFXO1lBQUUsT0FBTTtRQUNoQyxRQUFRLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtRQUMzQixJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQzVDLElBQUksSUFBSSxDQUFDLGdCQUFnQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ25DLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUN6QyxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzFDLENBQUM7UUFDRCxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CO1FBQ3hCLEtBQUssTUFBTSxRQUFRLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDL0QsSUFBSSxRQUFRLENBQUMsYUFBYTtnQkFBRSxTQUFRO1lBQ3BDLFFBQVEsQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO1lBQzdCLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDNUMsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDL0MsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsc0JBQXNCO1FBQ3BCLEtBQUssTUFBTSxhQUFhLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ2hELElBQUksYUFBYSxDQUFDLFFBQVEsRUFBRSxLQUFLLFNBQVM7Z0JBQUUsU0FBUTtZQUNwRCxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUNyRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsd0JBQXdCLENBQUMsUUFBUTtRQUNyQyxJQUFJLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFcEQsS0FBSyxNQUFNLFFBQVEsSUFBSSxRQUFRLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUM7Z0JBQ0gsUUFBUSxFQUFFLENBQUE7WUFDWixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLFlBQVksR0FBRztvQkFDbkIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLHVCQUF1QixFQUFDO29CQUN4RSxLQUFLO2lCQUNOLENBQUE7Z0JBQ0QsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsWUFBWSxDQUFDLENBQUE7Z0JBQ3pFLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsWUFBWSxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7WUFDeEcsQ0FBQztRQUNILENBQUM7UUFDRCxRQUFRLENBQUMsb0JBQW9CLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxPQUFPO1FBQzNCLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUE7UUFDNUUsTUFBTSxnQkFBZ0IsR0FBRyxnQkFBZ0I7WUFDdkMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUM7WUFDMUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVOLElBQUksV0FBVyxJQUFJLFdBQVc7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUM1QyxJQUFJLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVuRCxJQUFJLFdBQVcsSUFBSSxLQUFLLElBQUksZ0JBQWdCLElBQUksWUFBWTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXpFLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztDQUNGO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxVQUFVO0lBQ3BDLE9BQU8sQ0FBQyxVQUFVLElBQUksR0FBRyxJQUFJLFVBQVUsR0FBRyxHQUFHLENBQUMsSUFBSSxVQUFVLEtBQUssR0FBRyxJQUFJLFVBQVUsS0FBSyxHQUFHLENBQUE7QUFDNUYsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgY3J5cHRvIGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQge2Vuc3VyZUVycm9yfSBmcm9tIFwidHlwYW5pY1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi8uLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCB7SHR0cFJlcXVlc3RCb2R5VG9vTGFyZ2VFcnJvcn0gZnJvbSBcIi4vZXJyb3JzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUmVxdWVzdCBmcm9tIFwiLi9yZXF1ZXN0LmpzXCJcbmltcG9ydCBSZXF1ZXN0UnVubmVyIGZyb20gXCIuL3JlcXVlc3QtcnVubmVyLmpzXCJcbmltcG9ydCB7YWRkQWNjZXB0RW5jb2RpbmdUb1ZhcnksIGFwcGx5UmVzcG9uc2VDb21wcmVzc2lvbiwgbmVnb3RpYXRlQ29udGVudEVuY29kaW5nfSBmcm9tIFwiLi9yZXNwb25zZS1jb21wcmVzc2lvbi5qc1wiXG5pbXBvcnQgV2Vic29ja2V0U2Vzc2lvbiBmcm9tIFwiLi93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiXG5cbi8qKlxuICogUnVucyBiYWQgcmVxdWVzdCBkZXRhaWxzLlxuICogQHBhcmFtIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2FmZSBiYWQtcmVxdWVzdCBkZXRhaWxzIGZvciBsb2dzLlxuICovXG5mdW5jdGlvbiBiYWRSZXF1ZXN0RGV0YWlscyhlcnJvcikge1xuICByZXR1cm4ge1xuICAgIGVycm9yQ2xhc3M6IGVycm9yLm5hbWUsXG4gICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICB2ZWxvY2lvdXNDb250ZXh0OiBlcnJvci52ZWxvY2lvdXNDb250ZXh0XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVvbGljaW91c0h0dHBTZXJ2ZXJDbGllbnQge1xuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcbiAgc3RhdGUgPSBcImluaXRpYWxcIlxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgZG9uZS1yZXF1ZXN0cyBkcmFpbiBpcyBjdXJyZW50bHkgc2VuZGluZyByZXNwb25zZXMgZm9yIHRoaXMgY2xpZW50LlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlID0gZmFsc2VcblxuICAvKipcbiAgICogV2hldGhlciBhbm90aGVyIGRyYWluIHdhcyByZXF1ZXN0ZWQgd2hpbGUgb25lIHdhcyBhbHJlYWR5IGFjdGl2ZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jbGllbnRDb3VudCAtIENsaWVudCBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5yZW1vdGVBZGRyZXNzXSAtIFJlbW90ZSBhZGRyZXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NsaWVudENvdW50LCBjb25maWd1cmF0aW9uLCByZW1vdGVBZGRyZXNzfSkge1xuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBnaXZlblwiKVxuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5jbGllbnRDb3VudCA9IGNsaWVudENvdW50XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMucmVtb3RlQWRkcmVzcyA9IHJlbW90ZUFkZHJlc3NcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVxdWVzdFJ1bm5lcltdfSAqL1xuICAgIHRoaXMucmVxdWVzdFJ1bm5lcnMgPSBbXVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8KHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBTdHJlYW1zIHRoYXQgaGF2ZSBzdGFydGVkIGJ1dCBoYXZlIG5vdCBmaW5pc2hlZCBvciBiZWVuIGFib3J0ZWQgeWV0LlxuICAgICAqIEB0eXBlIHtNYXA8aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0LCB7Y2xpZW50Q291bnQ6IG51bWJlciwgcmVxdWVzdDogaW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9Pn0gKi9cbiAgICB0aGlzLl9hY3RpdmVTdHJlYW1SZXNwb25zZXMgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgYmFkIHVwZ3JhZGUgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gTWVzc2FnZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2VuZEJhZFVwZ3JhZGVSZXNwb25zZShtZXNzYWdlKSB7XG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSB0aGlzLmN1cnJlbnRSZXF1ZXN0Py5odHRwVmVyc2lvbigpIHx8IFwiMS4xXCJcbiAgICBjb25zdCBib2R5ID0gYCR7bWVzc2FnZX1cXG5gXG4gICAgY29uc3QgaGVhZGVycyA9IFtcbiAgICAgIGBIVFRQLyR7aHR0cFZlcnNpb259IDQwMCBCYWQgUmVxdWVzdGAsXG4gICAgICBcIkNvbm5lY3Rpb246IENsb3NlXCIsXG4gICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpbjsgY2hhcnNldD1VVEYtOFwiLFxuICAgICAgYENvbnRlbnQtTGVuZ3RoOiAke0J1ZmZlci5ieXRlTGVuZ3RoKGJvZHksIFwidXRmOFwiKX1gLFxuICAgICAgXCJcIixcbiAgICAgIGJvZHlcbiAgICBdLmpvaW4oXCJcXHJcXG5cIilcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgaGVhZGVycylcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgYmFkIHJlcXVlc3QgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gUmVzcG9uc2UgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NlbmRCYWRSZXF1ZXN0UmVzcG9uc2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gdGhpcy5jdXJyZW50UmVxdWVzdD8uaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgYm9keSA9IGAke21lc3NhZ2V9XFxuYFxuICAgIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgICBgSFRUUC8ke2h0dHBWZXJzaW9ufSA0MDAgQmFkIFJlcXVlc3RgLFxuICAgICAgXCJDb25uZWN0aW9uOiBDbG9zZVwiLFxuICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIixcbiAgICAgIGBDb250ZW50LUxlbmd0aDogJHtCdWZmZXIuYnl0ZUxlbmd0aChib2R5LCBcInV0ZjhcIil9YCxcbiAgICAgIFwiXCIsXG4gICAgICBib2R5XG4gICAgXS5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGhlYWRlcnMpXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYSBkZXRlcm1pbmlzdGljIHJlcXVlc3QtYm9keSBsaW1pdCByZXNwb25zZSBhbmQgY2xvc2VzIHRoZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2VuZFBheWxvYWRUb29MYXJnZVJlc3BvbnNlKCkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gdGhpcy5jdXJyZW50UmVxdWVzdD8uaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgYm9keSA9IFwiUGF5bG9hZCBUb28gTGFyZ2VcXG5cIlxuICAgIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgICBgSFRUUC8ke2h0dHBWZXJzaW9ufSA0MTMgUGF5bG9hZCBUb28gTGFyZ2VgLFxuICAgICAgXCJDb25uZWN0aW9uOiBDbG9zZVwiLFxuICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIixcbiAgICAgIGBDb250ZW50LUxlbmd0aDogJHtCdWZmZXIuYnl0ZUxlbmd0aChib2R5LCBcInV0ZjhcIil9YCxcbiAgICAgIFwiXCIsXG4gICAgICBib2R5XG4gICAgXS5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGhlYWRlcnMpXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgYmFkIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGhhbmRsZUJhZFJlcXVlc3QoZXJyb3IpIHtcbiAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBwYXJzZSBIVFRQIHJlcXVlc3RcIiwgYmFkUmVxdWVzdERldGFpbHMoLyoqIEB0eXBlIHtFcnJvciAmIHt2ZWxvY2lvdXNDb250ZXh0PzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKSldKVxuXG4gICAgaWYgKHRoaXMuY3VycmVudFJlcXVlc3QgJiYgXCJnZXRSZXF1ZXN0UGFyc2VyXCIgaW4gdGhpcy5jdXJyZW50UmVxdWVzdCkge1xuICAgICAgY29uc3QgaHR0cFJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5jdXJyZW50UmVxdWVzdClcblxuICAgICAgaHR0cFJlcXVlc3QuZ2V0UmVxdWVzdFBhcnNlcigpLmRlc3Ryb3koKVxuICAgIH1cblxuICAgIHRoaXMuY3VycmVudFJlcXVlc3QgPSB1bmRlZmluZWRcbiAgICB0aGlzLnN0YXRlID0gXCJpbml0aWFsXCJcblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEh0dHBSZXF1ZXN0Qm9keVRvb0xhcmdlRXJyb3IpIHtcbiAgICAgIHRoaXMuX3NlbmRQYXlsb2FkVG9vTGFyZ2VSZXNwb25zZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX3NlbmRCYWRSZXF1ZXN0UmVzcG9uc2UoXCJCYWQgUmVxdWVzdFwiKVxuICAgIH1cbiAgfVxuXG4gIGV4ZWN1dGVDdXJyZW50UmVxdWVzdCA9ICgpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImV4ZWN1dGVDdXJyZW50UmVxdWVzdFwiKVxuXG4gICAgY29uc3QgY3VycmVudFJlcXVlc3QgPSB0aGlzLmN1cnJlbnRSZXF1ZXN0XG5cbiAgICBpZiAoIWN1cnJlbnRSZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3RcIilcbiAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVkYWN0b3IucmVxdWVzdFNlbnNpdGl2ZVZhbHVlcyhjdXJyZW50UmVxdWVzdClcblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcImV4ZWN1dGVDdXJyZW50UmVxdWVzdCByZXF1ZXN0XCIsIHtcbiAgICAgIGNsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LFxuICAgICAgaHR0cE1ldGhvZDogY3VycmVudFJlcXVlc3QuaHR0cE1ldGhvZCgpLFxuICAgICAgaHR0cFZlcnNpb246IGN1cnJlbnRSZXF1ZXN0Lmh0dHBWZXJzaW9uKCksXG4gICAgICBwYXRoOiByZWRhY3Rvci5yZWRhY3RQYXRoKGN1cnJlbnRSZXF1ZXN0LnBhdGgoKSwgc2Vuc2l0aXZlVmFsdWVzKSxcbiAgICAgIHF1ZXVlTGVuZ3RoOiB0aGlzLnJlcXVlc3RSdW5uZXJzLmxlbmd0aFxuICAgIH1dKVxuXG4gICAgaWYgKHRoaXMuX2lzV2Vic29ja2V0VXBncmFkZShjdXJyZW50UmVxdWVzdCkpIHtcbiAgICAgIHRoaXMuX3VwZ3JhZGVUb1dlYnNvY2tldCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBXZSBhcmUgZG9uZSBwYXJzaW5nIHRoZSBnaXZlbiByZXF1ZXN0IGFuZCBjYW4gdGhlb3JldGljYWxseSBzdGFydCBwYXJzaW5nIGEgbmV3IG9uZSwgYmVmb3JlIHRoZSBjdXJyZW50IHJlcXVlc3QgaXMgZG9uZSAtIHNvIHJlc2V0IHRoZSBzdGF0ZS5cbiAgICB0aGlzLnN0YXRlID0gXCJpbml0aWFsXCJcblxuICAgIGNvbnN0IHJlcXVlc3RSdW5uZXIgPSBuZXcgUmVxdWVzdFJ1bm5lcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICByZXF1ZXN0OiBjdXJyZW50UmVxdWVzdFxuICAgIH0pXG5cbiAgICB0aGlzLnJlcXVlc3RSdW5uZXJzLnB1c2gocmVxdWVzdFJ1bm5lcilcblxuICAgIC8vIEEgc3RyZWFtaW5nIHJlc3BvbnNlIGVtaXRzIGl0cyBoZWFkZXJzIGFuZCBjaHVua3MgdG8gdGhlIGNsaWVudCB3aGlsZVxuICAgIC8vIHRoZSByZXF1ZXN0IGlzIHN0aWxsIHJ1bm5pbmcsIHNvIHRoZSByZXNwb25zZSBuZWVkcyB0aGUgb3duaW5nIGNsaWVudFxuICAgIC8vIGFzIGl0cyB0cmFuc3BvcnQgc2luayBiZWZvcmUgdGhlIGhhbmRsZXIgcnVucy4gU3ViLXJlcXVlc3RzIChlLmcuXG4gICAgLy8gd2Vic29ja2V0IHJlcXVlc3QgcGF5bG9hZHMpIGhhdmUgbm8gc29ja2V0IGFuZCBrZWVwIHRyYW5zcG9ydCBudWxsO1xuICAgIC8vIHRoZWlyIHJlc3BvbnNlcyBmYWlsIGxvdWRseSBpZiB0aGV5IGF0dGVtcHQgdG8gc3RyZWFtLlxuICAgIGNvbnN0IHNvY2tldFJlcXVlc3QgPSBjdXJyZW50UmVxdWVzdFxuICAgIHJlcXVlc3RSdW5uZXIucmVzcG9uc2UudHJhbnNwb3J0ID0gdGhpc1xuICAgIHJlcXVlc3RSdW5uZXIucmVzcG9uc2UudHJhbnNwb3J0UmVxdWVzdCA9IHNvY2tldFJlcXVlc3RcblxuICAgIHJlcXVlc3RSdW5uZXIuZXZlbnRzLm9uKFwiZG9uZVwiLCB0aGlzLnJlcXVlc3REb25lKVxuICAgIHJlcXVlc3RSdW5uZXIucnVuKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uIHdyaXRlLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25Xcml0ZShkYXRhKSB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBzdGFydFwiLCB7XG4gICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgIGxlbmd0aDogZGF0YS5sZW5ndGgsXG4gICAgICBzdGF0ZTogdGhpcy5zdGF0ZSxcbiAgICB9XSlcblxuICAgIGlmICh0aGlzLndlYnNvY2tldFNlc3Npb24pIHtcbiAgICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbi5vbkRhdGEoZGF0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvKipcbiAgICAgICAqIFJlbWFpbmluZy5cbiAgICAgICAqIEB0eXBlIHtCdWZmZXIgfCB1bmRlZmluZWR9ICovXG4gICAgICBsZXQgcmVtYWluaW5nID0gZGF0YVxuXG4gICAgICB3aGlsZSAocmVtYWluaW5nKSB7XG4gICAgICAgIGlmIChyZW1haW5pbmcubGVuZ3RoIDw9IDApIGJyZWFrXG5cbiAgICAgICAgaWYgKHRoaXMuc3RhdGUgPT0gXCJpbml0aWFsXCIpIHtcbiAgICAgICAgICBjb25zdCByZW1haW5pbmdMZW5ndGggPSByZW1haW5pbmcubGVuZ3RoXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIGNyZWF0aW5nIHJlcXVlc3QgcGFyc2VyXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcmVtYWluaW5nTGVuZ3RofV0pXG4gICAgICAgICAgdGhpcy5jdXJyZW50UmVxdWVzdCA9IG5ldyBSZXF1ZXN0KHtjbGllbnQ6IHRoaXMsIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG4gICAgICAgICAgdGhpcy5jdXJyZW50UmVxdWVzdC5yZXF1ZXN0UGFyc2VyLmV2ZW50cy5vbihcImRvbmVcIiwgdGhpcy5leGVjdXRlQ3VycmVudFJlcXVlc3QpXG4gICAgICAgICAgdGhpcy5zdGF0ZSA9IFwicmVxdWVzdFN0YXJ0ZWRcIlxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuc3RhdGUgIT0gXCJyZXF1ZXN0U3RhcnRlZFwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHN0YXRlIGZvciBjbGllbnQ6ICR7dGhpcy5zdGF0ZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLmN1cnJlbnRSZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3RcIilcblxuICAgICAgICByZW1haW5pbmcgPSB0aGlzLmN1cnJlbnRSZXF1ZXN0LmZlZWQocmVtYWluaW5nKVxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIGZlZCBwYXJzZXJcIiwge1xuICAgICAgICAgIGNsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LFxuICAgICAgICAgIGhhc1JlbWFpbmluZzogQm9vbGVhbihyZW1haW5pbmc/Lmxlbmd0aCksXG4gICAgICAgICAgcmVtYWluaW5nTGVuZ3RoOiByZW1haW5pbmc/Lmxlbmd0aCB8fCAwLFxuICAgICAgICAgIHBhcnNlckNvbXBsZXRlZDogdGhpcy5jdXJyZW50UmVxdWVzdD8uZ2V0UmVxdWVzdFBhcnNlcigpLmhhc0NvbXBsZXRlZFxuICAgICAgICB9XSlcblxuICAgICAgICBpZiAocmVtYWluaW5nICYmIHJlbWFpbmluZy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgcmVxdWVzdFBhcnNlciA9IHRoaXMuY3VycmVudFJlcXVlc3QuZ2V0UmVxdWVzdFBhcnNlcigpXG5cbiAgICAgICAgICBpZiAoIXJlcXVlc3RQYXJzZXIuaGFzQ29tcGxldGVkKSB7XG4gICAgICAgICAgICBjb25zdCByZW1haW5pbmdMZW5ndGggPSByZW1haW5pbmcubGVuZ3RoXG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgd2FpdGluZyBmb3IgbW9yZSBkYXRhXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcmVtYWluaW5nTGVuZ3RofV0pXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHRoaXMuc3RhdGUgPSBcImluaXRpYWxcIlxuICAgICAgICAgIGNvbnN0IHJlbWFpbmluZ0xlbmd0aCA9IHJlbWFpbmluZy5sZW5ndGhcblxuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgcGFyc2VyIGNvbXBsZXRlZCB3aXRoIHJlbWFpbmluZyBieXRlc1wiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIGVuZFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHN0YXRlOiB0aGlzLnN0YXRlLCBxdWV1ZUxlbmd0aDogdGhpcy5yZXF1ZXN0UnVubmVycy5sZW5ndGh9XSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVCYWRSZXF1ZXN0KGVuc3VyZUVycm9yKGVycm9yKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyB3ZWJzb2NrZXQgdXBncmFkZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdH0gcmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHdlYnNvY2tldCB1cGdyYWRlLlxuICAgKi9cbiAgX2lzV2Vic29ja2V0VXBncmFkZShyZXF1ZXN0KSB7XG4gICAgY29uc3QgdXBncmFkZUhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwidXBncmFkZVwiKT8udG9Mb3dlckNhc2UoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25IZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImNvbm5lY3Rpb25cIik/LnRvTG93ZXJDYXNlKClcblxuICAgIHJldHVybiBCb29sZWFuKHVwZ3JhZGVIZWFkZXIgPT0gXCJ3ZWJzb2NrZXRcIiAmJiBjb25uZWN0aW9uSGVhZGVyPy5pbmNsdWRlcyhcInVwZ3JhZGVcIikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGdyYWRlIHRvIHdlYnNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3VwZ3JhZGVUb1dlYnNvY2tldCgpIHtcbiAgICBpZiAoIXRoaXMuY3VycmVudFJlcXVlc3QpIHRocm93IG5ldyBFcnJvcihcIk5vIGN1cnJlbnQgcmVxdWVzdFwiKVxuXG4gICAgY29uc3Qgc2VjV2Vic29ja2V0S2V5ID0gdGhpcy5jdXJyZW50UmVxdWVzdC5oZWFkZXIoXCJzZWMtd2Vic29ja2V0LWtleVwiKVxuXG4gICAgaWYgKCFzZWNXZWJzb2NrZXRLZXkpIHtcbiAgICAgIHRoaXMuX3NlbmRCYWRVcGdyYWRlUmVzcG9uc2UoXCJNaXNzaW5nIFNlYy1XZWJTb2NrZXQtS2V5IGhlYWRlclwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgd2Vic29ja2V0QWNjZXB0S2V5ID0gY3J5cHRvLmNyZWF0ZUhhc2goXCJzaGExXCIpXG4gICAgICAudXBkYXRlKGAke3NlY1dlYnNvY2tldEtleX0yNThFQUZBNS1FOTE0LTQ3REEtOTVDQS1DNUFCMERDODVCMTFgLCBcImJpbmFyeVwiKVxuICAgICAgLmRpZ2VzdChcImJhc2U2NFwiKVxuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gdGhpcy5jdXJyZW50UmVxdWVzdC5odHRwVmVyc2lvbigpIHx8IFwiMS4xXCJcbiAgICBjb25zdCByZXNwb25zZUxpbmVzID0gW1xuICAgICAgYEhUVFAvJHtodHRwVmVyc2lvbn0gMTAxIFN3aXRjaGluZyBQcm90b2NvbHNgLFxuICAgICAgXCJVcGdyYWRlOiB3ZWJzb2NrZXRcIixcbiAgICAgIFwiQ29ubmVjdGlvbjogVXBncmFkZVwiLFxuICAgICAgYFNlYy1XZWJTb2NrZXQtQWNjZXB0OiAke3dlYnNvY2tldEFjY2VwdEtleX1gLFxuICAgICAgXCJcIixcbiAgICAgIFwiXCJcbiAgICBdXG4gICAgY29uc3QgcmVzcG9uc2UgPSByZXNwb25zZUxpbmVzLmpvaW4oXCJcXHJcXG5cIilcblxuICAgIGNvbnN0IG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0TWVzc2FnZUhhbmRsZXJSZXNvbHZlcj8uKClcbiAgICBsZXQgbWVzc2FnZUhhbmRsZXJcbiAgICBsZXQgbWVzc2FnZUhhbmRsZXJQcm9taXNlXG5cbiAgICBpZiAobWVzc2FnZUhhbmRsZXJSZXNvbHZlcikge1xuICAgICAgY29uc3QgcmVzb2x2ZWRIYW5kbGVyID0gbWVzc2FnZUhhbmRsZXJSZXNvbHZlcih7XG4gICAgICAgIGNsaWVudDogdGhpcyxcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICByZXF1ZXN0OiB0aGlzLmN1cnJlbnRSZXF1ZXN0XG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZXNvbHZlZFRoZW5hYmxlID0gLyoqIEB0eXBlIHt7dGhlbj86ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKHJlc29sdmVkSGFuZGxlcilcblxuICAgICAgaWYgKHJlc29sdmVkVGhlbmFibGU/LnRoZW4pIHtcbiAgICAgICAgbWVzc2FnZUhhbmRsZXJQcm9taXNlID0gLyoqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXIgfCB2b2lkPn0gKi8gKHJlc29sdmVkSGFuZGxlcilcbiAgICAgIH0gZWxzZSBpZiAocmVzb2x2ZWRIYW5kbGVyKSB7XG4gICAgICAgIG1lc3NhZ2VIYW5kbGVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyfSAqLyAocmVzb2x2ZWRIYW5kbGVyKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbiA9IG5ldyBXZWJzb2NrZXRTZXNzaW9uKHtcbiAgICAgIGNsaWVudDogdGhpcyxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIHVwZ3JhZGVSZXF1ZXN0OiB0aGlzLmN1cnJlbnRSZXF1ZXN0LFxuICAgICAgbWVzc2FnZUhhbmRsZXI6IG1lc3NhZ2VIYW5kbGVyLFxuICAgICAgbWVzc2FnZUhhbmRsZXJQcm9taXNlOiBtZXNzYWdlSGFuZGxlclByb21pc2VcbiAgICB9KVxuICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbi5ldmVudHMub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICAvLyBQYXVzZWQgc2Vzc2lvbnMgc3Vydml2ZSB0aGUgc29ja2V0IGNsb3NlOyBkb24ndCBkZXN0cm95KCkuXG4gICAgICAvLyBUaGUgZ3JhY2UtZXhwaXJ5IHBhdGggKF9maW5hbGl6ZUdyYWNlRXhwaXJ5KSB3aWxsIGRlc3Ryb3lcbiAgICAgIC8vIHRoZW0gcGVybWFuZW50bHkgaWYgcmVzdW1lIGRvZXNuJ3QgaGFwcGVuIGluIHRpbWUuXG4gICAgICBpZiAoIXRoaXMud2Vic29ja2V0U2Vzc2lvbj8uaXNQYXVzZWQoKSkge1xuICAgICAgICB0aGlzLndlYnNvY2tldFNlc3Npb24/LmRlc3Ryb3koKVxuICAgICAgfVxuICAgICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uID0gdW5kZWZpbmVkXG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgICB9KVxuICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbi5ldmVudHMub24oXCJvd25lcnNoaXBDbGFpbWVkXCIsICh7c2Vzc2lvbklkfSkgPT4ge1xuICAgICAgdGhpcy5ldmVudHMuZW1pdChcIndlYnNvY2tldFNlc3Npb25Pd25lZFwiLCB7c2Vzc2lvbklkfSlcbiAgICB9KVxuICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbi5ldmVudHMub24oXCJvd25lcnNoaXBSZWxlYXNlZFwiLCAoe3Nlc3Npb25JZH0pID0+IHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJ3ZWJzb2NrZXRTZXNzaW9uUmVsZWFzZWRcIiwge3Nlc3Npb25JZH0pXG4gICAgfSlcbiAgICB0aGlzLnN0YXRlID0gXCJ3ZWJzb2NrZXRcIlxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgcmVzcG9uc2UpXG4gICAgdm9pZCB0aGlzLndlYnNvY2tldFNlc3Npb24uaW5pdGlhbGl6ZUNoYW5uZWwoKVxuICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbi5zZW5kU2Vzc2lvbkVzdGFibGlzaGVkKClcbiAgfVxuXG4gIHJlcXVlc3REb25lID0gKCkgPT4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInJlcXVlc3REb25lXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG5cbiAgICByZXR1cm4gdGhpcy5fZHJhaW5Eb25lUmVxdWVzdHMoKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgd2hpbGUgc2VuZGluZyBkb25lIHJlcXVlc3RzXCIsIGVycm9yKVxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgZG9uZSByZXF1ZXN0cyBvbmUgYXQgYSB0aW1lLiBBIHJ1bm5lciBpcyBzaGlmdGVkIG91dCBvZiB0aGUgcXVldWUgYmVmb3JlXG4gICAqIGl0cyByZXNwb25zZSBmaW5pc2hlcyBzZW5kaW5nIChhc3luYyBjb21wcmVzc2lvbiwgZmlsZSB0cmFuc2ZlciksIHNvIGFuXG4gICAqIG92ZXJsYXBwaW5nIGRyYWluIHdvdWxkIG90aGVyd2lzZSBwaWNrIHVwIHRoZSBuZXh0IHJ1bm5lciBhbmQgcmVvcmRlciBwaXBlbGluZWRcbiAgICogc29ja2V0IHdyaXRlcy4gQ2FsbHMgdGhhdCBhcnJpdmUgd2hpbGUgYSBkcmFpbiBpcyBhY3RpdmUgYXJlIGZvbGRlZCBpbnRvIGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGRvbmUgcmVzcG9uc2UgaGFzIGJlZW4gc2VudC5cbiAgICovXG4gIGFzeW5jIF9kcmFpbkRvbmVSZXF1ZXN0cygpIHtcbiAgICBpZiAodGhpcy5fZG9uZVJlcXVlc3RzRHJhaW5BY3RpdmUpIHtcbiAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluUGVuZGluZyA9IHRydWVcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGRvIHtcbiAgICAgICAgdGhpcy5fZG9uZVJlcXVlc3RzRHJhaW5QZW5kaW5nID0gZmFsc2VcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kRG9uZVJlcXVlc3RzKClcbiAgICAgIH0gd2hpbGUgKHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluUGVuZGluZylcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fZG9uZVJlcXVlc3RzRHJhaW5BY3RpdmUgPSBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNlbmREb25lUmVxdWVzdHMoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IHJlcXVlc3RSdW5uZXIgPSB0aGlzLnJlcXVlc3RSdW5uZXJzWzBdXG4gICAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWVzdFJ1bm5lcj8uZ2V0UmVxdWVzdCgpXG5cbiAgICAgIGlmIChyZXF1ZXN0UnVubmVyPy5nZXRTdGF0ZSgpID09IFwiZG9uZVwiKSB7XG4gICAgICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gcmVxdWVzdC5odHRwVmVyc2lvbigpXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb25IZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImNvbm5lY3Rpb25cIik/LnRvTG93ZXJDYXNlKCk/LnRyaW0oKVxuICAgICAgICBjb25zdCBzaG91bGRDbG9zZUNvbm5lY3Rpb24gPSB0aGlzLnNob3VsZENsb3NlQ29ubmVjdGlvbihyZXF1ZXN0KVxuXG4gICAgICAgIHRoaXMucmVxdWVzdFJ1bm5lcnMuc2hpZnQoKVxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kRG9uZVJlcXVlc3RzIHNoaWZ0ZWQgcXVldWVcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBxdWV1ZUxlbmd0aDogdGhpcy5yZXF1ZXN0UnVubmVycy5sZW5ndGh9XSlcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlbmRSZXNwb25zZShyZXF1ZXN0UnVubmVyKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgVmVsb2Npb3VzIGNsaWVudCAke3RoaXMuY2xpZW50Q291bnR9IGZhaWxlZCB3aGlsZSBzZW5kaW5nIHJlc3BvbnNlYCwgZXJyb3JdKVxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuY3VycmVudFJlcXVlc3QgPT09IHJlcXVlc3QgJiYgdGhpcy5zdGF0ZSA9PT0gXCJpbml0aWFsXCIpIHRoaXMuY3VycmVudFJlcXVlc3QgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZERvbmVSZXF1ZXN0c1wiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGNvbm5lY3Rpb25IZWFkZXIsIGh0dHBWZXJzaW9ufV0pXG5cbiAgICAgICAgaWYgKHNob3VsZENsb3NlQ29ubmVjdGlvbikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtgQ2xvc2luZyB0aGUgY29ubmVjdGlvbiBiZWNhdXNlICR7aHR0cFZlcnNpb259IGFuZCBjb25uZWN0aW9uIGhlYWRlciAke2Nvbm5lY3Rpb25IZWFkZXJ9YCwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50fV0pXG4gICAgICAgICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGEgZmluaXNoZWQgcmVzcG9uc2UgdG8gdGhlIGNsaWVudC4gT3ducyB0aGUgZnJhbWV3b3JrLW93bmVkXG4gICAqIGBWYXJ5OiBBY2NlcHQtRW5jb2RpbmdgIGRpbWVuc2lvbiAoZW1pdHRlZCBmb3IgZXZlcnkgc2VsZWN0ZWRcbiAgICogcmVwcmVzZW50YXRpb24g4oCUIHRyYW5zZm9ybWVkLCBpZGVudGl0eSwgNDA2LCBhbmQgZmlsZSDigJQgYW5kIGZvclxuICAgKiBoZWFkZXItcHJlc2VudCBhbmQgaGVhZGVyLWFic2VudCByZXF1ZXN0cyBhbGlrZSwgc28gaXQgaXMgc3RhYmxlIGFjcm9zc1xuICAgKiByZXF1ZXN0cyBvbiB0aGUgc2FtZSBjb25uZWN0aW9uOyBuZXZlciBhZGRlZCB3aGVuIGNvbXByZXNzaW9uIGlzIGRpc2FibGVkLFxuICAgKiB0aGUgcmVzcG9uc2UgaXMgdHJ1bHkgYm9keWxlc3MsIG9yIHRoZSBhcHBsaWNhdGlvbiBzdXBwbGllZCBhIGZpeGVkXG4gICAqIGBDb250ZW50LUVuY29kaW5nYCkgYW5kIHRoZSBmaWxlIDQwNiBydWxlIChhIHNlbmRGaWxlIHJlc3BvbnNlIHdob3NlXG4gICAqIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IGlzIGFuc3dlcmVkIHdpdGggdGhlIGVtcHR5IDQwNiwgdGhlIGZpbGUgaXMgbmV2ZXJcbiAgICogb3BlbmVkIG9yIHN0cmVhbWVkLCBhbmQgYG9uRmluaXNoZWRgIHNldHRsZXMgb25jZSBhcyBcImNvbXBsZXRlZFwiKS5cbiAgICogQHBhcmFtIHtSZXF1ZXN0UnVubmVyfSByZXF1ZXN0UnVubmVyIC0gUmVxdWVzdCBydW5uZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZW5kUmVzcG9uc2UocmVxdWVzdFJ1bm5lcikge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gZGlnZyhyZXF1ZXN0UnVubmVyLCBcInJlc3BvbnNlXCIpXG5cbiAgICAvLyBBIHN0cmVhbWluZyByZXNwb25zZSBhbHJlYWR5IGVtaXR0ZWQgaXRzIHN0YXR1cyBsaW5lLCBoZWFkZXJzLCBldmVyeVxuICAgIC8vIGNodW5rLCBhbmQgdGhlIGNodW5rZWQgdGVybWluYXRvciB0byB0aGUgY2xpZW50IHdoaWxlIHRoZSByZXF1ZXN0IHdhc1xuICAgIC8vIHJ1bm5pbmcuIE5vdGhpbmcgbGVmdCB0byBzZW5kIGhlcmUg4oCUIGp1c3QgbG9nIHRoZSBjb21wbGV0ZWQgcmVxdWVzdC5cbiAgICBpZiAocmVzcG9uc2UuaXNTdHJlYW1pbmcoKSkge1xuICAgICAgYXdhaXQgcmVxdWVzdFJ1bm5lci5sb2dDb21wbGV0ZWRSZXF1ZXN0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHJlcXVlc3QgPSByZXF1ZXN0UnVubmVyLmdldFJlcXVlc3QoKVxuICAgIGNvbnN0IGZpbGVQYXRoID0gcmVzcG9uc2UuZ2V0RmlsZVBhdGgoKVxuICAgIGNvbnN0IGZpbGVPbkZpbmlzaGVkID0gcmVzcG9uc2UuZ2V0RmlsZU9uRmluaXNoZWQoKVxuICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKT8udHJpbSgpXG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSByZXF1ZXN0Lmh0dHBWZXJzaW9uKClcbiAgICBjb25zdCBzaG91bGRDbG9zZUNvbm5lY3Rpb24gPSB0aGlzLnNob3VsZENsb3NlQ29ubmVjdGlvbihyZXF1ZXN0KVxuICAgIGNvbnN0IGhhc0ZpbGVQYXRoID0gdHlwZW9mIGZpbGVQYXRoID09PSBcInN0cmluZ1wiICYmIGZpbGVQYXRoLmxlbmd0aCA+IDBcbiAgICBjb25zdCBib2R5ID0gaGFzRmlsZVBhdGggPyBudWxsIDogcmVzcG9uc2UuZ2V0Qm9keSgpXG4gICAgY29uc3QgYm9keUlzU3RyaW5nID0gdHlwZW9mIGJvZHkgPT09IFwic3RyaW5nXCJcbiAgICBjb25zdCBib2R5SXNCaW5hcnkgPSBib2R5IGluc3RhbmNlb2YgVWludDhBcnJheVxuXG4gICAgaWYgKCFoYXNGaWxlUGF0aCAmJiAhYm9keUlzU3RyaW5nICYmICFib2R5SXNCaW5hcnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcmVzcG9uc2UgYm9keSB0byBiZSBhIHN0cmluZyBvciBVaW50OEFycmF5LCBnb3QgJHt0eXBlb2YgYm9keX1gKVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic2VuZFJlc3BvbnNlXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgY29ubmVjdGlvbkhlYWRlciwgaHR0cFZlcnNpb259KVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBwYXlsb2FkXCIsIHtcbiAgICAgIGNsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LFxuICAgICAgaGFzRmlsZVBhdGgsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGJvZHlJc0JpbmFyeSxcbiAgICAgIGJvZHlJc1N0cmluZ1xuICAgIH1dKVxuXG4gICAgaWYgKHNob3VsZENsb3NlQ29ubmVjdGlvbikge1xuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29ubmVjdGlvblwiLCBcIkNsb3NlXCIpXG4gICAgfSBlbHNlIGlmIChodHRwVmVyc2lvbiA9PSBcIjEuMFwiICYmIGNvbm5lY3Rpb25IZWFkZXIgPT0gXCJrZWVwLWFsaXZlXCIpIHtcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbm5lY3Rpb25cIiwgXCJLZWVwLUFsaXZlXCIpXG4gICAgfVxuXG4gICAgLy8gUGVyIFJGQyA3MjMwIMKnMy4zLjMsIHJlc3BvbnNlcyB3aXRoIHN0YXR1cyBjb2RlcyAxeHgsIDIwNCwgYW5kIDMwNFxuICAgIC8vIE1VU1QgTk9UIGNhcnJ5IGEgbWVzc2FnZSBib2R5IGFuZCBNVVNUIE5PVCBpbmNsdWRlIENvbnRlbnQtTGVuZ3RoXG4gICAgLy8gKHdpdGggYSBuYXJyb3cgMzA0IGV4Y2VwdGlvbiB3ZSBkb24ndCBsZWFuIG9uKS4gU2VuZGluZyBvbmUgd291bGRcbiAgICAvLyBkZXN5bmNocm9uaXplIGtlZXAtYWxpdmUgY2xpZW50cyB3YWl0aW5nIGZvciBieXRlcyB0aGF0IG5ldmVyXG4gICAgLy8gYXJyaXZlIOKAlCBkcm9wIHRoZSBib2R5IGVudGlyZWx5IGZvciB0aG9zZSBjb2Rlcy5cbiAgICBjb25zdCBpc0JvZHlsZXNzU3RhdHVzID0gaXNOb0JvZHlTdGF0dXNDb2RlKHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKSlcblxuICAgIC8vIEhFQUQgcmVzcG9uc2VzIHNlbGVjdCBhbmQgY29tcHV0ZSB0aGUgZXhhY3Qgc2FtZSByZXByZXNlbnRhdGlvbiBoZWFkZXJzIGFzIHRoZVxuICAgIC8vIGVxdWl2YWxlbnQgR0VUIChpbmNsdWRpbmcgQ29udGVudC1MZW5ndGggYW5kIGFueSBuZWdvdGlhdGVkIENvbnRlbnQtRW5jb2RpbmcpLFxuICAgIC8vIGJ1dCBubyBidWZmZXJlZCBvciBmaWxlIGJvZHkgaXMgZW1pdHRlZCBiZWxvdy5cbiAgICBjb25zdCBpc0hlYWRSZXF1ZXN0ID0gcmVxdWVzdC5odHRwTWV0aG9kKCkgPT0gXCJIRUFEXCJcblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgVWludDhBcnJheSB8IG51bGx9ICovXG4gICAgbGV0IGJvZHlUb0VtaXQgPSBib2R5XG5cbiAgICAvLyBUaGUgcmVzcG9uc2UgcmVwcmVzZW50YXRpb24gY2FuIGRlcGVuZCBvbiB0aGUgY2xpZW50J3MgQWNjZXB0LUVuY29kaW5nOlxuICAgIC8vIHRoZSBzYW1lIHJlcXVlc3QgaXMgYW5zd2VyZWQgd2l0aCBhbiBpZGVudGl0eSBib2R5IChvciBhIGZpbGUpIHdoZW5cbiAgICAvLyBpZGVudGl0eSBpcyBhY2NlcHRhYmxlIGFuZCB3aXRoIGFuIGVtcHR5IDQwNiB3aGVuIGl0IGlzIGZvcmJpZGRlbi5cbiAgICBjb25zdCBjb21wcmVzc2lvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKVxuICAgIGNvbnN0IG5lZ290aWF0ZWQgPSBjb21wcmVzc2lvbi5lbmFibGVkID8gbmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcXVlc3QuaGVhZGVyKFwiYWNjZXB0LWVuY29kaW5nXCIpKSA6IHVuZGVmaW5lZFxuICAgIC8vIEFuIGFwcGxpY2F0aW9uLXN1cHBsaWVkIENvbnRlbnQtRW5jb2RpbmcgaXMgYW4gYXBwbGljYXRpb24tb3duZWRcbiAgICAvLyByZXByZXNlbnRhdGlvbiBjb250cmFjdCwgY2FwdHVyZWQgYmVmb3JlIHRoZSBmcmFtZXdvcmsgbWF5IGFkZCBpdHMgb3duLlxuICAgIC8vIEEgZmlsZSBjYXJyeWluZyBvbmUgaXMgYSBmaXhlZCwgYXBwbGljYXRpb24tb3duZWQgcmVwcmVzZW50YXRpb246IHRoZVxuICAgIC8vIGZyYW1ld29yayBuZWl0aGVyIG5lZ290aWF0ZXMgaXQgbm9yIHJlLWFkdmVydGlzZXMgaXQsIHNvIGl0IGlzIG5ldmVyIGFcbiAgICAvLyBjYW5kaWRhdGUgZm9yIHRoZSBpZGVudGl0eS1vbmx5IDQwNi5cbiAgICBjb25zdCBoYXNBcHBsaWNhdGlvbkNvbnRlbnRFbmNvZGluZyA9IHJlc3BvbnNlLmdldEhlYWRlcihcIkNvbnRlbnQtRW5jb2RpbmdcIikubGVuZ3RoID4gMFxuICAgIC8vIEEgZmlsZSByZXNwb25zZSBvbmx5IGV2ZXIgc2VydmVzIHRoZSBpZGVudGl0eSByZXByZXNlbnRhdGlvbjogd2hlbmV2ZXJcbiAgICAvLyB0aGUgY2xpZW50IGZvcmJpZHMgaWRlbnRpdHkgKGluY2x1ZGluZyB0aGUgbm90LWFjY2VwdGFibGUgY2FzZSB3aGVyZSBub1xuICAgIC8vIGNvZGluZyBhcHBsaWVzKSBhbmQgdGhlIGZpbGUgZG9lcyBub3QgY2FycnkgYW4gYXBwbGljYXRpb24tc3VwcGxpZWRcbiAgICAvLyBDb250ZW50LUVuY29kaW5nLCB0aGUgZmlsZSBpcyByZWplY3RlZCB3aXRoIHRoZSBlbXB0eSA0MDYuIEEgdHJ1bHlcbiAgICAvLyBib2R5bGVzcyBzdGF0dXMgc2VsZWN0cyBubyByZXByZXNlbnRhdGlvbiwgc28gaXQgaXMgbmV2ZXIgcmVqZWN0ZWQgaGVyZS5cbiAgICBjb25zdCBpc0ZpbGVOb3RBY2NlcHRhYmxlID0gaGFzRmlsZVBhdGggJiYgISFuZWdvdGlhdGVkICYmIChcIm5vdEFjY2VwdGFibGVcIiBpbiBuZWdvdGlhdGVkIHx8IG5lZ290aWF0ZWQuaWRlbnRpdHlBY2NlcHRhYmxlID09PSBmYWxzZSkgJiYgaGFzQXBwbGljYXRpb25Db250ZW50RW5jb2RpbmcgPT09IGZhbHNlICYmICFpc0JvZHlsZXNzU3RhdHVzXG5cbiAgICBpZiAoIWlzQm9keWxlc3NTdGF0dXMpIHtcbiAgICAgIGxldCBjb250ZW50TGVuZ3RoXG5cbiAgICAgIGlmIChoYXNGaWxlUGF0aCkge1xuICAgICAgICBpZiAoaXNGaWxlTm90QWNjZXB0YWJsZSkge1xuICAgICAgICAgIC8vIFRoZSBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBhbmQgZmlsZXMgYXJlIG9ubHkgZXZlciBzZW50IGlkZW50aXR5OlxuICAgICAgICAgIC8vIGFuc3dlciB3aXRoIHRoZSBzYW1lIGVtcHR5IDQwNiBldmVyeSBvdGhlciByZXByZXNlbnRhdGlvbiBwYXRoXG4gICAgICAgICAgLy8gdXNlcy4gVGhlIGZpbGUgaXMgbmV2ZXIgb3BlbmVkIG9yIHN0cmVhbWVkOyBvbkZpbmlzaGVkIGlzIHNldHRsZWRcbiAgICAgICAgICAvLyBiZWxvdywgYWZ0ZXIgdGhlIGNvbW1pdHRlZCA0MDYgaGVhZGVycyBhcmUgZW1pdHRlZC5cbiAgICAgICAgICByZXNwb25zZS5zZXRTdGF0dXMoNDA2KVxuICAgICAgICAgIHJlc3BvbnNlLnNldEJvZHkoXCJcIilcbiAgICAgICAgICBib2R5VG9FbWl0ID0gXCJcIlxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSAwXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKVxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSBzdGF0cy5zaXplXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFN0cmluZyBib2RpZXMgYXJlIFVURi04IGZyYW1lZCwgc28gdGhlIGJ1ZmZlcmVkIGJ5dGVzIGFyZSB0aGUgVVRGLTggZW5jb2Rpbmc7XG4gICAgICAgIC8vIFVpbnQ4QXJyYXkgYm9kaWVzIGFyZSBhbHJlYWR5IHRoZSBleGFjdCB3aXJlIGJ5dGVzLlxuICAgICAgICBjb25zdCBib2R5QnVmZmVyID0gYm9keUlzU3RyaW5nID8gQnVmZmVyLmZyb20oYm9keSwgXCJ1dGY4XCIpIDogQnVmZmVyLmZyb20oYm9keSlcbiAgICAgICAgY29uc3QgY29tcHJlc3Npb25SZXN1bHQgPSBhd2FpdCBhcHBseVJlc3BvbnNlQ29tcHJlc3Npb24oe1xuICAgICAgICAgIGJvZHlCdWZmZXIsXG4gICAgICAgICAgY29tcHJlc3Npb246IHRoaXMuY29uZmlndXJhdGlvbi5nZXRIdHRwU2VydmVyQ29tcHJlc3Npb24oKSxcbiAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgIHJlc3BvbnNlXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGNvbXByZXNzaW9uUmVzdWx0Lm91dGNvbWUgPT0gXCJub3QtYWNjZXB0YWJsZVwiKSB7XG4gICAgICAgICAgLy8gVGhlIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IGFuZCBubyBzdXBwb3J0ZWQgY29kaW5nIGlzIGFjY2VwdGFibGU6IGFuc3dlclxuICAgICAgICAgIC8vIHdpdGggYW4gZW1wdHkgNDA2IGluc3RlYWQgb2YgYW4gdW5hY2NlcHRhYmxlIHJlcHJlc2VudGF0aW9uLlxuICAgICAgICAgIHJlc3BvbnNlLnNldFN0YXR1cyg0MDYpXG4gICAgICAgICAgcmVzcG9uc2Uuc2V0Qm9keShcIlwiKVxuICAgICAgICAgIGJvZHlUb0VtaXQgPSBcIlwiXG4gICAgICAgICAgY29udGVudExlbmd0aCA9IDBcbiAgICAgICAgfSBlbHNlIGlmIChjb21wcmVzc2lvblJlc3VsdC5vdXRjb21lID09IFwiY29tcHJlc3NlZFwiKSB7XG4gICAgICAgICAgYm9keVRvRW1pdCA9IGNvbXByZXNzaW9uUmVzdWx0LmJvZHlcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gY29tcHJlc3Npb25SZXN1bHQuYm9keS5sZW5ndGhcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gYm9keUJ1ZmZlci5sZW5ndGhcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBSZW1vdmUgYW55IGFwcGxpY2F0aW9uIHByZS1zZXQgQ29udGVudC1MZW5ndGggKGFueSBjYXNpbmcpIHNvIGV4YWN0bHkgb25lXG4gICAgICAvLyByZWNvbXB1dGVkIHZhbHVlIGdvZXMgb24gdGhlIHdpcmUuXG4gICAgICByZXNwb25zZS5yZW1vdmVIZWFkZXIoXCJDb250ZW50LUxlbmd0aFwiKVxuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29udGVudC1MZW5ndGhcIiwgY29udGVudExlbmd0aClcbiAgICB9XG5cbiAgICAvLyBGcmFtZXdvcmstb3duZWQgVmFyeSBkaW1lbnNpb246IHdoZW5ldmVyIGNvbXByZXNzaW9uIGlzIGVuYWJsZWQgYW5kIGFcbiAgICAvLyByZXByZXNlbnRhdGlvbiB3YXMgc2VsZWN0ZWQsIHRoZSByZXNwb25zZSBkZXBlbmRzIG9uIEFjY2VwdC1FbmNvZGluZyxcbiAgICAvLyBzbyBjYWNoZXMgbXVzdCBrZXkgb24gaXQuIEFwcGxpZWQgaWRlbnRpY2FsbHkgZm9yIGV2ZXJ5IG91dGNvbWVcbiAgICAvLyAodHJhbnNmb3JtZWQsIGlkZW50aXR5LCA0MDYsIGZpbGUpIGFuZCBmb3IgaGVhZGVyLXByZXNlbnQgYW5kXG4gICAgLy8gaGVhZGVyLWFic2VudCByZXF1ZXN0cyBhbGlrZSwgc28gdGhlIGhlYWRlciBpcyBzdGFibGUgYWNyb3NzIHJlcXVlc3RzIG9uXG4gICAgLy8gdGhlIHNhbWUgY29ubmVjdGlvbi4gQSB0cnVseSBib2R5bGVzcyByZXNwb25zZSBzZWxlY3RzIG5vIHJlcHJlc2VudGF0aW9uXG4gICAgLy8gYW5kIGNhcnJpZXMgbm8gZGltZW5zaW9uOyBhbiBhcHBsaWNhdGlvbi1zdXBwbGllZCBDb250ZW50LUVuY29kaW5nIGtlZXBzXG4gICAgLy8gdGhlIHJlcHJlc2VudGF0aW9uIGNvbnRyYWN0IGFwcGxpY2F0aW9uLW93bmVkIGFuZCBpcyBuZXZlciByZS1hZHZlcnRpc2VkLlxuICAgIGlmIChuZWdvdGlhdGVkICYmICFpc0JvZHlsZXNzU3RhdHVzICYmIGhhc0FwcGxpY2F0aW9uQ29udGVudEVuY29kaW5nID09PSBmYWxzZSkge1xuICAgICAgYWRkQWNjZXB0RW5jb2RpbmdUb1ZhcnkocmVzcG9uc2UpXG4gICAgfVxuXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiRGF0ZVwiLCBkYXRlLnRvVVRDU3RyaW5nKCkpXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiU2VydmVyXCIsIFwiVmVsb2Npb3VzXCIpXG5cbiAgICBsZXQgaGVhZGVycyA9IFwiXCJcblxuICAgIGhlYWRlcnMgKz0gYEhUVFAvJHtyZXF1ZXN0Lmh0dHBWZXJzaW9uKCl9ICR7cmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpfSAke3Jlc3BvbnNlLmdldFN0YXR1c01lc3NhZ2UoKX1cXHJcXG5gXG5cbiAgICBmb3IgKGNvbnN0IGhlYWRlcktleSBpbiByZXNwb25zZS5oZWFkZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IGhlYWRlclZhbHVlIG9mIHJlc3BvbnNlLmhlYWRlcnNbaGVhZGVyS2V5XSkge1xuICAgICAgICBoZWFkZXJzICs9IGAke2hlYWRlcktleX06ICR7aGVhZGVyVmFsdWV9XFxyXFxuYFxuICAgICAgfVxuICAgIH1cblxuICAgIGhlYWRlcnMgKz0gXCJcXHJcXG5cIlxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBoZWFkZXJzIGVtaXR0ZWRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBoZWFkZXJzTGVuZ3RoOiBoZWFkZXJzLmxlbmd0aH1dKVxuXG4gICAgLy8gQSBuZWdvdGlhdGVkIGZpbGUgNDA2IGlzIGNvbW1pdHRlZCBhYm92ZSAoc3RhdHVzIDQwNiwgZW1wdHkgYm9keSkgYW5kIGl0c1xuICAgIC8vIGhlYWRlcnMgd2VyZSBqdXN0IGVtaXR0ZWQ6IHNldHRsZSBvbkZpbmlzaGVkIG5vdywgc28gdGhlIGNhbGxiYWNrIHJ1bnNcbiAgICAvLyBhZnRlciB0aGUgcmVzcG9uc2UgaXMgY29tbWl0dGVkIOKAlCBhIHNsb3cgb3IgYXBwLXN0b3BwaW5nIGNhbGxiYWNrIGNhbm5vdFxuICAgIC8vIGRlbGF5IG9yIGJsb2NrIGRlbGl2ZXJ5IG9mIHRoZSBhbHJlYWR5LWVtaXR0ZWQgNDA2LiBUaGUgZmlsZSBpcyBuZXZlclxuICAgIC8vIG9wZW5lZCwgc3RyZWFtZWQsIG9yIHJlcG9ydGVkIChubyBmaWxlIGV2ZW50KSwgYW5kIHRoZSBjYWxsYmFjayBzZXR0bGVzXG4gICAgLy8gZXhhY3RseSBvbmNlIGFzIFwiY29tcGxldGVkXCIuXG4gICAgaWYgKGlzRmlsZU5vdEFjY2VwdGFibGUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBmaWxlIGJvZHkgc3VwcHJlc3NlZCBmb3IgNDA2XCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGh9XSlcbiAgICAgIGF3YWl0IHRoaXMucnVuRmlsZU9uRmluaXNoZWQoe2ZpbGVQYXRoLCBvbkZpbmlzaGVkOiBmaWxlT25GaW5pc2hlZCwgcmVzdWx0OiBcImNvbXBsZXRlZFwifSlcbiAgICB9IGVsc2UgaWYgKGlzQm9keWxlc3NTdGF0dXMpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IHN1cHByZXNzZWQgZm9yIG5vLWJvZHkgc3RhdHVzXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgc3RhdHVzQ29kZTogcmVzcG9uc2UuZ2V0U3RhdHVzQ29kZSgpfV0pXG4gICAgICAvLyBBIGJvZHlsZXNzIHN0YXR1cyAoMXh4LzIwNC8zMDQpIHNlbGVjdHMgbm8gcmVwcmVzZW50YXRpb24sIHNvIG5vIGZpbGVcbiAgICAgIC8vIGJvZHkgb3IgZnJhbWV3b3JrIFZhcnkgaXMgZW1pdHRlZC4gVGhlIGZpbGUtb3duZXJzaGlwIHBhdGggc3RpbGwgc2V0dGxlc1xuICAgICAgLy8gb25GaW5pc2hlZCBleGFjdGx5IG9uY2UgYXMgXCJjb21wbGV0ZWRcIiAobm90aGluZyB3YXMgYWJvcnRlZCkg4oCUIGV2ZW4gd2hlblxuICAgICAgLy8gdGhlIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IOKAlCBwcmVzZXJ2aW5nIHRoZSBwcmUtY2hhbmdlIHNldHRsZW1lbnQuXG4gICAgICBpZiAoaGFzRmlsZVBhdGgpIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIGZhbHNlLCBmaWxlT25GaW5pc2hlZClcbiAgICB9IGVsc2UgaWYgKGlzSGVhZFJlcXVlc3QpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRSZXNwb25zZSBib2R5IHN1cHByZXNzZWQgZm9yIEhFQUQgcmVxdWVzdFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnR9XSlcbiAgICAgIGlmIChoYXNGaWxlUGF0aCkgYXdhaXQgdGhpcy5zZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgZmFsc2UsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSBpZiAoaGFzRmlsZVBhdGgpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIHRydWUsIGZpbGVPbkZpbmlzaGVkKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGJvZHlUb0VtaXQpXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgYm9keSBlbWl0dGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgYm9keUxlbmd0aDogYm9keVRvRW1pdCA/IGJvZHlUb0VtaXQubGVuZ3RoIDogMH1dKVxuICAgIH1cblxuICAgIGF3YWl0IHJlcXVlc3RSdW5uZXIubG9nQ29tcGxldGVkUmVxdWVzdCgpXG5cbiAgICBpZiAoXCJnZXRSZXF1ZXN0UGFyc2VyXCIgaW4gcmVxdWVzdCkge1xuICAgICAgY29uc3QgaHR0cFJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAocmVxdWVzdClcbiAgICAgIGh0dHBSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKS5kZXN0cm95KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGZpbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gc2VuZEJvZHkgLSBXaGV0aGVyIHRoZSBmaWxlIGJvZHkgc2hvdWxkIGJlIHNlbnQuXG4gICAqIEBwYXJhbSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gb25GaW5pc2hlZCAtIENvbXBsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZW5kRmlsZU91dHB1dChmaWxlUGF0aCwgc2VuZEJvZHksIG9uRmluaXNoZWQpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kRmlsZU91dHB1dCBzdGFydFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRofV0pXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICAgIGxldCBzZXR0bGVtZW50ID0gbnVsbFxuICAgICAgY29uc3Qgc2V0dGxlID0gKC8qKiBAdHlwZSB7XCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwifSAqLyB0cmFuc2ZlclJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlbWVudCkgcmV0dXJuIHNldHRsZW1lbnRcblxuICAgICAgICB0aGlzLnBlbmRpbmdGaWxlUmVzcG9uc2VzLmRlbGV0ZShzZXR0bGUpXG4gICAgICAgIHNldHRsZW1lbnQgPSB0aGlzLnJ1bkZpbGVPbkZpbmlzaGVkKHtmaWxlUGF0aCwgb25GaW5pc2hlZCwgcmVzdWx0OiB0cmFuc2ZlclJlc3VsdH0pXG4gICAgICAgICAgLmZpbmFsbHkoKCkgPT4gcmVzb2x2ZSh0cmFuc2ZlclJlc3VsdCkpXG5cbiAgICAgICAgcmV0dXJuIHNldHRsZW1lbnRcbiAgICAgIH1cblxuICAgICAgdGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlcy5hZGQoc2V0dGxlKVxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImZpbGVcIiwge2ZpbGVQYXRoLCBzZW5kQm9keSwgc2V0dGxlfSlcbiAgICB9KVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZEZpbGVPdXRwdXQgZG9uZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHR9XSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgZmlsZSBjb21wbGV0aW9uIGNhbGxiYWNrIHdpdGhvdXQgYWxsb3dpbmcgY2xlYW51cCBmYWlsdXJlcyB0byByZXBsYWNlIHRoZSBjb21taXR0ZWQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29tcGxldGlvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHsoKHJlc3VsdDogXCJjb21wbGV0ZWRcIiB8IFwiYWJvcnRlZFwiKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBudWxsfSBhcmdzLm9uRmluaXNoZWQgLSBDb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIn0gYXJncy5yZXN1bHQgLSBUcmFuc2ZlciByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNhbGxiYWNrIGNsZWFudXAgYW5kIGVycm9yIHJlcG9ydGluZyBmaW5pc2guXG4gICAqL1xuICBhc3luYyBydW5GaWxlT25GaW5pc2hlZCh7ZmlsZVBhdGgsIG9uRmluaXNoZWQsIHJlc3VsdH0pIHtcbiAgICBpZiAoIW9uRmluaXNoZWQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG9uRmluaXNoZWQocmVzdWx0KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IGVuc3VyZUVycm9yKGNhdWdodEVycm9yKVxuXG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGaWxlIHJlc3BvbnNlIG9uRmluaXNoZWQgY2FsbGJhY2sgZmFpbGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgZmlsZVBhdGgsIHJlc3VsdH0sIGVycm9yXSlcblxuICAgICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgICBjb250ZXh0OiB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHQsIHN0YWdlOiBcInNlbmQtZmlsZS1vbi1maW5pc2hlZFwifSxcbiAgICAgICAgZXJyb3JcbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5lcnJvclBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFib3J0cyBhbGwgZmlsZSByZXNwb25zZXMgYXdhaXRpbmcgdHJhbnNwb3J0IGFja25vd2xlZGdlbWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVuZGluZyBjYWxsYmFja3Mgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRQZW5kaW5nRmlsZVJlc3BvbnNlcygpIHtcbiAgICBhd2FpdCBQcm9taXNlLmFsbChbLi4udGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlc10ubWFwKChzZXR0bGUpID0+IHNldHRsZShcImFib3J0ZWRcIikpKVxuICB9XG5cbiAgLyoqXG4gICAqIFNpbmsgdGhlIG93bmluZyB3b3JrZXIgaGFuZGxlciB3aXJlcyBpbiBmb3Igc3RyZWFtIG91dHB1dC4gVGhlXG4gICAqIGluLXByb2Nlc3MgaGFuZGxlciByZXNvbHZlcyBpdCBhZnRlciB0aGUgZnJhbWVkIG91dHB1dCBoYXMgYmVlbiBlbnF1ZXVlZFxuICAgKiBmb3IgZGVsaXZlcnkgdG8gdGhlIHNvY2tldCwgc28gc3RyZWFtIGNodW5rcyBzaGFyZSB0aGUgYm91bmRlZCwgb3JkZXJlZFxuICAgKiBkZWxpdmVyeSBwYXRoIChieXRlL2ZyYW1lIGxpbWl0cyBhbmQgc29ja2V0IGJhY2twcmVzc3VyZSkgaW5zdGVhZCBvZlxuICAgKiBiZWluZyBidWZmZXJlZCB1bmJvdW5kZWRseSBmb3IgYSBzdGFsbGVkIGNsaWVudC4gVGhlIHdvcmtlci10aHJlYWRcbiAgICogaGFuZGxlciBrZWVwcyBudWxsOiBpdHMgb3V0cHV0IGNyb3NzZXMgdG8gdGhlIHBhcmVudCBvdmVyIElQQyBhbmQgbm9cbiAgICogcGVyLWNodW5rIGFja25vd2xlZGdlbWVudCBpcyBhdmFpbGFibGUuXG4gICAqIEB0eXBlIHsoKG91dHB1dDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+KSB8IG51bGx9ICovXG4gIHN0cmVhbU91dHB1dFNpbmsgPSBudWxsXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJlc3BvbnNlIHRvIHRoZSBkb2N1bWVudGVkIHN0cmVhbWluZyB0cmFuc3BvcnQgc2hhcGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSByZXNwb25zZSAtIFJlc3BvbnNlIHRvIHN0cmVhbS5cbiAgICogQHJldHVybnMge3tzdHJlYW1pbmc6IGJvb2xlYW4sIHN0cmVhbUVuZGVkOiBib29sZWFuLCBzdHJlYW1BYm9ydGVkOiBib29sZWFuLCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4sIGdldFN0YXR1c0NvZGU6ICgpID0+IG51bWJlciwgZ2V0U3RhdHVzTWVzc2FnZTogKCkgPT4gc3RyaW5nLCBzdHJlYW1DbG9zZUNhbGxiYWNrczogU2V0PCgpID0+IHZvaWQ+fX0gLSBTdHJlYW1pbmcgdmlldyBvZiB0aGUgcmVzcG9uc2UuXG4gICAqL1xuICBfc3RyZWFtaW5nUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBsaXZlIGNodW5rZWQgc3RyZWFtIGZvciBhIHNvY2tldC1ib3VuZCByZXNwb25zZTogZW1pdHMgdGhlXG4gICAqIHN0YXR1cyBsaW5lIGFuZCBoZWFkZXJzICh3aXRoIGBUcmFuc2Zlci1FbmNvZGluZzogY2h1bmtlZGApIHRvIHRoZVxuICAgKiBjbGllbnQgaW1tZWRpYXRlbHkgc28gc3Vic2VxdWVudCBgd3JpdGUoKWAgY2h1bmtzIHJlYWNoIHRoZSBjbGllbnQgYXNcbiAgICogdGhleSBhcmUgcHJvZHVjZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSByZXNwb25zZSAtIFJlc3BvbnNlIHRvIHN0cmVhbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdH0gcmVxdWVzdCAtIFNvY2tldC1ib3VuZCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBiZWdpblN0cmVhbVJlc3BvbnNlKHJlc3BvbnNlLCByZXF1ZXN0KSB7XG4gICAgdGhpcy5fYWN0aXZlU3RyZWFtUmVzcG9uc2VzLnNldChyZXNwb25zZSwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCByZXF1ZXN0fSlcblxuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gcmVxdWVzdC5odHRwVmVyc2lvbigpXG5cbiAgICAvLyBIVFRQLzEuMCBoYXMgbm8gY2h1bmtlZCB0cmFuc2ZlciBlbmNvZGluZzogdGVybWluYXRlIHRoZSBzdHJlYW0gd2l0aCBhXG4gICAgLy8gY29ubmVjdGlvbiBjbG9zZSBpbnN0ZWFkIG9mIGEgemVyby1sZW5ndGggY2h1bmsuXG4gICAgaWYgKGh0dHBWZXJzaW9uID09IFwiMS4wXCIgJiYgIXRoaXMuc2hvdWxkQ2xvc2VDb25uZWN0aW9uKHJlcXVlc3QpKSB7XG4gICAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJDb25uZWN0aW9uXCIsIFwiQ2xvc2VcIilcbiAgICB9XG5cbiAgICAvLyBUaGUgY2h1bmtlZCBmcmFtaW5nIG93bnMgdGhlIGJvZHkgbGVuZ3RoOyBhIENvbnRlbnQtTGVuZ3RoIGhlYWRlciBzZXRcbiAgICAvLyBieSB0aGUgYXBwbGljYXRpb24gYmVmb3JlIHN0cmVhbSgpIHdvdWxkIGRlc3luY2hyb25pemUgdGhlIGZyYW1pbmcuXG4gICAgcmVzcG9uc2UucmVtb3ZlSGVhZGVyKFwiQ29udGVudC1MZW5ndGhcIilcbiAgICBpZiAocmVzcG9uc2UuZ2V0SGVhZGVyKFwiVHJhbnNmZXItRW5jb2RpbmdcIikubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJUcmFuc2Zlci1FbmNvZGluZ1wiLCBcImNodW5rZWRcIilcbiAgICB9XG5cbiAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJEYXRlXCIsIG5ldyBEYXRlKCkudG9VVENTdHJpbmcoKSlcbiAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJTZXJ2ZXJcIiwgXCJWZWxvY2lvdXNcIilcblxuICAgIGNvbnN0IHJlc3BvbnNlVmlldyA9IHRoaXMuX3N0cmVhbWluZ1Jlc3BvbnNlKHJlc3BvbnNlKVxuICAgIGxldCBoZWFkZXJzID0gXCJcIlxuICAgIGhlYWRlcnMgKz0gYEhUVFAvJHtodHRwVmVyc2lvbn0gJHtyZXNwb25zZVZpZXcuZ2V0U3RhdHVzQ29kZSgpfSAke3Jlc3BvbnNlVmlldy5nZXRTdGF0dXNNZXNzYWdlKCl9XFxyXFxuYFxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gcmVzcG9uc2VWaWV3LmhlYWRlcnMpIHtcbiAgICAgIGZvciAoY29uc3QgaGVhZGVyVmFsdWUgb2YgcmVzcG9uc2VWaWV3LmhlYWRlcnNbaGVhZGVyS2V5XSkge1xuICAgICAgICBoZWFkZXJzICs9IGAke2hlYWRlcktleX06ICR7aGVhZGVyVmFsdWV9XFxyXFxuYFxuICAgICAgfVxuICAgIH1cblxuICAgIGhlYWRlcnMgKz0gXCJcXHJcXG5cIlxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgaGVhZGVycylcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBvbmUgY2h1bmtlZC1lbmNvZGVkIGJvZHkgY2h1bmsgZm9yIGFuIGFjdGl2ZSBzdHJlYW0uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgVWludDhBcnJheX0gY2h1bmsgLSBDaHVuayB0byBlbWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTZXR0bGVzIGFmdGVyIHRoZSBjaHVuayBoYXMgYmVlbiBkZWxpdmVyZWQgdG9cbiAgICogdGhlIGNsaWVudC5cbiAgICovXG4gIGFzeW5jIHdyaXRlU3RyZWFtQ2h1bmsoY2h1bmspIHtcbiAgICBjb25zdCBieXRlcyA9IHR5cGVvZiBjaHVuayA9PT0gXCJzdHJpbmdcIiA/IEJ1ZmZlci5mcm9tKGNodW5rLCBcInV0ZjhcIikgOiBCdWZmZXIuZnJvbShjaHVuaylcbiAgICBjb25zdCBmcmFtZSA9IGAke2J5dGVzLmxlbmd0aC50b1N0cmluZygxNil9XFxyXFxuJHtieXRlc31cXHJcXG5gXG4gICAgaWYgKHRoaXMuc3RyZWFtT3V0cHV0U2luayA9PT0gbnVsbCkge1xuICAgICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBmcmFtZSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBhd2FpdCB0aGlzLnN0cmVhbU91dHB1dFNpbmsoZnJhbWUpXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgdGhlIHplcm8tbGVuZ3RoIGNodW5rZWQgdGVybWluYXRvciBmb3IgYSBzdHJlYW0gdGhhdCBmaW5pc2hlZCBvbiBhXG4gICAqIGxpdmUgY29ubmVjdGlvbiwgdGhlbiBydW5zIGl0cyBjbG9zZSBjYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSByZXNwb25zZSAtIFJlc3BvbnNlIHRvIGZpbmlzaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2V0dGxlcyBhZnRlciB0aGUgdGVybWluYXRvciB3YXMgZGVsaXZlcmVkIGFuZFxuICAgKiB0aGUgY2xvc2UgY2FsbGJhY2tzIHJhbi5cbiAgICovXG4gIGFzeW5jIGVuZFN0cmVhbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKHJlc3BvbnNlLnN0cmVhbUVuZGVkKSByZXR1cm5cbiAgICByZXNwb25zZS5zdHJlYW1FbmRlZCA9IHRydWVcbiAgICB0aGlzLl9hY3RpdmVTdHJlYW1SZXNwb25zZXMuZGVsZXRlKHJlc3BvbnNlKVxuICAgIGlmICh0aGlzLnN0cmVhbU91dHB1dFNpbmsgPT09IG51bGwpIHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgXCIwXFxyXFxuXFxyXFxuXCIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RyZWFtT3V0cHV0U2luayhcIjBcXHJcXG5cXHJcXG5cIilcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fcnVuU3RyZWFtQ2xvc2VDYWxsYmFja3MocmVzcG9uc2UpXG4gIH1cblxuICAvKipcbiAgICogQWJvcnRzIGV2ZXJ5IHN0cmVhbSB3aG9zZSBjbGllbnQgY29ubmVjdGlvbiB3ZW50IGF3YXk6IG1hcmtzIHRoZSBzdHJlYW1cbiAgICogYWJvcnRlZCBhbmQgcnVucyB0aGUgY2xvc2UgY2FsbGJhY2tzIHNvIGluLWZsaWdodCB3b3JrIGNhbiBzZXR0bGUgaXRzXG4gICAqIHJlc291cmNlcy4gTm8gdGVybWluYXRvciBpcyBlbWl0dGVkIOKAlCB0aGUgY29ubmVjdGlvbiBpcyBhbHJlYWR5IGdvbmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IHN0cmVhbSBzZXR0bGVkLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRTdHJlYW1SZXNwb25zZXMoKSB7XG4gICAgZm9yIChjb25zdCByZXNwb25zZSBvZiBbLi4udGhpcy5fYWN0aXZlU3RyZWFtUmVzcG9uc2VzLmtleXMoKV0pIHtcbiAgICAgIGlmIChyZXNwb25zZS5zdHJlYW1BYm9ydGVkKSBjb250aW51ZVxuICAgICAgcmVzcG9uc2Uuc3RyZWFtQWJvcnRlZCA9IHRydWVcbiAgICAgIHRoaXMuX2FjdGl2ZVN0cmVhbVJlc3BvbnNlcy5kZWxldGUocmVzcG9uc2UpXG4gICAgICBhd2FpdCB0aGlzLl9ydW5TdHJlYW1DbG9zZUNhbGxiYWNrcyhyZXNwb25zZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFya3MgZXZlcnkgaW4tZmxpZ2h0IHJlcXVlc3QgYXMgY2xpZW50LWRpc2Nvbm5lY3RlZCBhbmQgcnVucyBpdHNcbiAgICogZGlzY29ubmVjdCBjYWxsYmFja3MuIFRoZSB3b3JrZXIgaGFuZGxlciBjYWxscyB0aGlzIHdoZW4gdGhlIHVuZGVybHlpbmdcbiAgICogc29ja2V0IHRlYXJzIGRvd24sIHNvIGEgaGFuZGxlciB3aG9zZSByZXNwb25zZSBpcyBzdGlsbCBidWZmZXJlZCAoZS5nLlxuICAgKiB3YWl0aW5nIGluIGFuIGFkbWlzc2lvbiBxdWV1ZSkgY2FuIG9ic2VydmUgdGhlIGNsaWVudCBsZWF2aW5nIHdpdGhvdXRcbiAgICogd2FpdGluZyBmb3IgdGhlIHJlc3BvbnNlIHRvIGJlIHNlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgbm90aWZ5Q2xpZW50RGlzY29ubmVjdCgpIHtcbiAgICBmb3IgKGNvbnN0IHJlcXVlc3RSdW5uZXIgb2YgdGhpcy5yZXF1ZXN0UnVubmVycykge1xuICAgICAgaWYgKHJlcXVlc3RSdW5uZXIuZ2V0U3RhdGUoKSAhPT0gXCJydW5uaW5nXCIpIGNvbnRpbnVlXG4gICAgICByZXF1ZXN0UnVubmVyLmdldFJlcXVlc3QoKS5tYXJrQ2xpZW50RGlzY29ubmVjdGVkKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY2xvc2UgY2FsbGJhY2tzIG9mIGEgZmluaXNoZWQgb3IgYWJvcnRlZCBzdHJlYW0gZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gcmVzcG9uc2UgLSBGaW5pc2hlZCBzdHJlYW0uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNhbGxiYWNrIHJhbi5cbiAgICovXG4gIGFzeW5jIF9ydW5TdHJlYW1DbG9zZUNhbGxiYWNrcyhyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZS5zdHJlYW1DbG9zZUNhbGxiYWNrcy5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgcmVzcG9uc2Uuc3RyZWFtQ2xvc2VDYWxsYmFja3MpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yUGF5bG9hZCA9IHtcbiAgICAgICAgICBjb250ZXh0OiB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHN0YWdlOiBcInN0cmVhbS1jbG9zZS1jYWxsYmFja1wifSxcbiAgICAgICAgICBlcnJvclxuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5lcnJvclBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgICB9XG4gICAgfVxuICAgIHJlc3BvbnNlLnN0cmVhbUNsb3NlQ2FsbGJhY2tzLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBjbG9zZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSByZXF1ZXN0IC0gUmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gc2hvdWxkIGJlIGNsb3NlZC5cbiAgICovXG4gIHNob3VsZENsb3NlQ29ubmVjdGlvbihyZXF1ZXN0KSB7XG4gICAgY29uc3QgaHR0cFZlcnNpb24gPSByZXF1ZXN0Lmh0dHBWZXJzaW9uKClcbiAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpPy50cmltKClcbiAgICBjb25zdCBjb25uZWN0aW9uVG9rZW5zID0gY29ubmVjdGlvbkhlYWRlclxuICAgICAgPyBjb25uZWN0aW9uSGVhZGVyLnNwbGl0KFwiLFwiKS5tYXAoKHRva2VuKSA9PiB0b2tlbi50cmltKCkpLmZpbHRlcihCb29sZWFuKVxuICAgICAgOiBbXVxuXG4gICAgaWYgKGh0dHBWZXJzaW9uID09IFwid2Vic29ja2V0XCIpIHJldHVybiBmYWxzZVxuICAgIGlmIChjb25uZWN0aW9uVG9rZW5zLmluY2x1ZGVzKFwiY2xvc2VcIikpIHJldHVybiB0cnVlXG5cbiAgICBpZiAoaHR0cFZlcnNpb24gPT0gXCIxLjBcIiAmJiBjb25uZWN0aW9uSGVhZGVyICE9IFwia2VlcC1hbGl2ZVwiKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRydWUgZm9yIHRoZSBzdGF0dXMgY29kZXMgdGhhdCBSRkMgNzIzMCDCpzMuMy4zIGRlY2xhcmVzXG4gKiBjYW5ub3QgY2FycnkgYSBtZXNzYWdlIGJvZHk6IGV2ZXJ5IDF4eCBpbmZvcm1hdGlvbmFsLCAyMDQgTm9cbiAqIENvbnRlbnQsIGFuZCAzMDQgTm90IE1vZGlmaWVkLlxuICogQHBhcmFtIHtudW1iZXJ9IHN0YXR1c0NvZGUgLSBIVFRQIHN0YXR1cyBjb2RlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgc3RhdHVzIGNvZGUgZm9yYmlkcyBhIHJlc3BvbnNlIGJvZHkuXG4gKi9cbmZ1bmN0aW9uIGlzTm9Cb2R5U3RhdHVzQ29kZShzdGF0dXNDb2RlKSB7XG4gIHJldHVybiAoc3RhdHVzQ29kZSA+PSAxMDAgJiYgc3RhdHVzQ29kZSA8IDIwMCkgfHwgc3RhdHVzQ29kZSA9PT0gMjA0IHx8IHN0YXR1c0NvZGUgPT09IDMwNFxufVxuIl19