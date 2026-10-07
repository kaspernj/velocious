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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUE7QUFDM0IsT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBQ25DLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sRUFBQyw0QkFBNEIsRUFBQyxNQUFNLGFBQWEsQ0FBQTtBQUN4RCxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLHVCQUF1QixFQUFFLHdCQUF3QixFQUFFLHdCQUF3QixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDckgsT0FBTyxnQkFBZ0IsTUFBTSx3QkFBd0IsQ0FBQTtBQUVyRDs7OztHQUlHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxLQUFLO0lBQzlCLE9BQU87UUFDTCxVQUFVLEVBQUUsS0FBSyxDQUFDLElBQUk7UUFDdEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLGdCQUFnQixFQUFFLEtBQUssQ0FBQyxnQkFBZ0I7S0FDekMsQ0FBQTtBQUNILENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3QyxNQUFNLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUMzQixLQUFLLEdBQUcsU0FBUyxDQUFBO0lBRWpCOzt5QkFFcUI7SUFDckIsd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0lBRWhDOzt5QkFFcUI7SUFDckIseUJBQXlCLEdBQUcsS0FBSyxDQUFBO0lBRWpDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxXQUFXLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBQztRQUNyRCxJQUFJLENBQUMsYUFBYTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtRQUU3RCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQzlCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBRWxDOztxQ0FFNkI7UUFDN0IsSUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFFeEIsc0VBQXNFO1FBQ3RFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXJDOzswSEFFa0g7UUFDbEgsSUFBSSxDQUFDLHNCQUFzQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFDekMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx1QkFBdUIsQ0FBQyxPQUFPO1FBQzdCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFBO1FBQy9ELE1BQU0sSUFBSSxHQUFHLEdBQUcsT0FBTyxJQUFJLENBQUE7UUFDM0IsTUFBTSxPQUFPLEdBQUc7WUFDZCxRQUFRLFdBQVcsa0JBQWtCO1lBQ3JDLG1CQUFtQjtZQUNuQix5Q0FBeUM7WUFDekMsbUJBQW1CLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFO1lBQ3BELEVBQUU7WUFDRixJQUFJO1NBQ0wsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFZCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx1QkFBdUIsQ0FBQyxPQUFPO1FBQzdCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFBO1FBQy9ELE1BQU0sSUFBSSxHQUFHLEdBQUcsT0FBTyxJQUFJLENBQUE7UUFDM0IsTUFBTSxPQUFPLEdBQUc7WUFDZCxRQUFRLFdBQVcsa0JBQWtCO1lBQ3JDLG1CQUFtQjtZQUNuQix5Q0FBeUM7WUFDekMsbUJBQW1CLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFO1lBQ3BELEVBQUU7WUFDRixJQUFJO1NBQ0wsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFZCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILDRCQUE0QjtRQUMxQixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLFdBQVcsRUFBRSxJQUFJLEtBQUssQ0FBQTtRQUMvRCxNQUFNLElBQUksR0FBRyxxQkFBcUIsQ0FBQTtRQUNsQyxNQUFNLE9BQU8sR0FBRztZQUNkLFFBQVEsV0FBVyx3QkFBd0I7WUFDM0MsbUJBQW1CO1lBQ25CLHlDQUF5QztZQUN6QyxtQkFBbUIsTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEVBQUU7WUFDcEQsRUFBRTtZQUNGLElBQUk7U0FDTCxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVkLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdCQUFnQixDQUFDLEtBQUs7UUFDcEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyw4QkFBOEIsRUFBRSxpQkFBaUIsQ0FBQyx5RkFBeUYsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTlLLElBQUksSUFBSSxDQUFDLGNBQWMsSUFBSSxrQkFBa0IsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDckUsTUFBTSxXQUFXLEdBQUcsNkNBQTZDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7WUFFdkYsV0FBVyxDQUFDLGdCQUFnQixFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDMUMsQ0FBQztRQUVELElBQUksQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO1FBQy9CLElBQUksQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFBO1FBRXRCLElBQUksS0FBSyxZQUFZLDRCQUE0QixFQUFFLENBQUM7WUFDbEQsSUFBSSxDQUFDLDRCQUE0QixFQUFFLENBQUE7UUFDckMsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsdUJBQXVCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDN0MsQ0FBQztJQUNILENBQUM7SUFFRCxxQkFBcUIsR0FBRyxHQUFHLEVBQUU7UUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtRQUUxQyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFBO1FBRTFDLElBQUksQ0FBQyxjQUFjO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBQzFELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFDcEQsTUFBTSxlQUFlLEdBQUcsUUFBUSxDQUFDLHNCQUFzQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsK0JBQStCLEVBQUU7Z0JBQ3hELFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztnQkFDN0IsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVLEVBQUU7Z0JBQ3ZDLFdBQVcsRUFBRSxjQUFjLENBQUMsV0FBVyxFQUFFO2dCQUN6QyxJQUFJLEVBQUUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEVBQUUsZUFBZSxDQUFDO2dCQUNqRSxXQUFXLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNO2FBQ3hDLENBQUMsQ0FBQyxDQUFBO1FBRUgsSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUMxQixPQUFNO1FBQ1IsQ0FBQztRQUVELGdKQUFnSjtRQUNoSixJQUFJLENBQUMsS0FBSyxHQUFHLFNBQVMsQ0FBQTtRQUV0QixNQUFNLGFBQWEsR0FBRyxJQUFJLGFBQWEsQ0FBQztZQUN0QyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsT0FBTyxFQUFFLGNBQWM7U0FDeEIsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFdkMsd0VBQXdFO1FBQ3hFLHdFQUF3RTtRQUN4RSxvRUFBb0U7UUFDcEUsc0VBQXNFO1FBQ3RFLHlEQUF5RDtRQUN6RCxNQUFNLGFBQWEsR0FBRyxjQUFjLENBQUE7UUFDcEMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFBO1FBQ3ZDLGFBQWEsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLEdBQUcsYUFBYSxDQUFBO1FBRXZELGFBQWEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDakQsYUFBYSxDQUFDLEdBQUcsRUFBRSxDQUFBO0lBQ3JCLENBQUMsQ0FBQTtJQUVEOzs7O09BSUc7SUFDSCxPQUFPLENBQUMsSUFBSTtRQUNWLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZUFBZSxFQUFFO2dCQUN4QyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7Z0JBQzdCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtnQkFDbkIsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO2FBQ2xCLENBQUMsQ0FBQyxDQUFBO1FBRUgsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUMxQixJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ2xDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0g7OzRDQUVnQztZQUNoQyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUE7WUFFcEIsT0FBTyxTQUFTLEVBQUUsQ0FBQztnQkFDakIsSUFBSSxTQUFTLENBQUMsTUFBTSxJQUFJLENBQUM7b0JBQUUsTUFBSztnQkFFaEMsSUFBSSxJQUFJLENBQUMsS0FBSyxJQUFJLFNBQVMsRUFBRSxDQUFDO29CQUM1QixNQUFNLGVBQWUsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFBO29CQUV4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGlDQUFpQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQyxDQUFBO29CQUM5RyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksT0FBTyxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7b0JBQ3BGLElBQUksQ0FBQyxjQUFjLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO29CQUMvRSxJQUFJLENBQUMsS0FBSyxHQUFHLGdCQUFnQixDQUFBO2dCQUMvQixDQUFDO3FCQUFNLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO29CQUMxQyxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtnQkFDNUQsQ0FBQztnQkFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO2dCQUUvRCxTQUFTLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQy9DLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsb0JBQW9CLEVBQUU7d0JBQzdDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVzt3QkFDN0IsWUFBWSxFQUFFLE9BQU8sQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO3dCQUN4QyxlQUFlLEVBQUUsU0FBUyxFQUFFLE1BQU0sSUFBSSxDQUFDO3dCQUN2QyxlQUFlLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDLFlBQVk7cUJBQ3RFLENBQUMsQ0FBQyxDQUFBO2dCQUVILElBQUksU0FBUyxJQUFJLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3RDLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtvQkFFNUQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsQ0FBQzt3QkFDaEMsTUFBTSxlQUFlLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQTt3QkFFeEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQkFBK0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLGVBQWUsRUFBQyxDQUFDLENBQUMsQ0FBQTt3QkFDNUcsTUFBSztvQkFDUCxDQUFDO29CQUVELElBQUksQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFBO29CQUN0QixNQUFNLGVBQWUsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFBO29CQUV4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtDQUErQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUM5SCxDQUFDO1lBQ0gsQ0FBQztZQUNELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsYUFBYSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3ZJLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQzNDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLE9BQU87UUFDekIsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxXQUFXLEVBQUUsQ0FBQTtRQUM5RCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLENBQUE7UUFFcEUsT0FBTyxPQUFPLENBQUMsYUFBYSxJQUFJLFdBQVcsSUFBSSxnQkFBZ0IsRUFBRSxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtJQUN2RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsbUJBQW1CO1FBQ2pCLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtRQUUvRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsdUJBQXVCLENBQUMsa0NBQWtDLENBQUMsQ0FBQTtZQUNoRSxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7YUFDakQsTUFBTSxDQUFDLEdBQUcsZUFBZSxzQ0FBc0MsRUFBRSxRQUFRLENBQUM7YUFDMUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ25CLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsV0FBVyxFQUFFLElBQUksS0FBSyxDQUFBO1FBQzlELE1BQU0sYUFBYSxHQUFHO1lBQ3BCLFFBQVEsV0FBVywwQkFBMEI7WUFDN0Msb0JBQW9CO1lBQ3BCLHFCQUFxQjtZQUNyQix5QkFBeUIsa0JBQWtCLEVBQUU7WUFDN0MsRUFBRTtZQUNGLEVBQUU7U0FDSCxDQUFBO1FBQ0QsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUzQyxNQUFNLHNCQUFzQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsa0NBQWtDLEVBQUUsRUFBRSxDQUFBO1FBQ3hGLElBQUksY0FBYyxDQUFBO1FBQ2xCLElBQUkscUJBQXFCLENBQUE7UUFFekIsSUFBSSxzQkFBc0IsRUFBRSxDQUFDO1lBQzNCLE1BQU0sZUFBZSxHQUFHLHNCQUFzQixDQUFDO2dCQUM3QyxNQUFNLEVBQUUsSUFBSTtnQkFDWixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQ2pDLE9BQU8sRUFBRSxJQUFJLENBQUMsY0FBYzthQUM3QixDQUFDLENBQUE7WUFFRixNQUFNLGdCQUFnQixHQUFHLHdHQUF3RyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUE7WUFFbkosSUFBSSxnQkFBZ0IsRUFBRSxJQUFJLEVBQUUsQ0FBQztnQkFDM0IscUJBQXFCLEdBQUcsNkZBQTZGLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQTtZQUN6SSxDQUFDO2lCQUFNLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQzNCLGNBQWMsR0FBRyw2RUFBNkUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBQ2xILENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksZ0JBQWdCLENBQUM7WUFDM0MsTUFBTSxFQUFFLElBQUk7WUFDWixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjO1lBQ25DLGNBQWMsRUFBRSxjQUFjO1lBQzlCLHFCQUFxQixFQUFFLHFCQUFxQjtTQUM3QyxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFO1lBQzVDLDZEQUE2RDtZQUM3RCw0REFBNEQ7WUFDNUQscURBQXFEO1lBQ3JELElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLEVBQUUsQ0FBQztnQkFDdkMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLE9BQU8sRUFBRSxDQUFBO1lBQ2xDLENBQUM7WUFDRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1lBQ2pDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzNCLENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxFQUFDLFNBQVMsRUFBQyxFQUFFLEVBQUU7WUFDbEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsRUFBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQ3hELENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxFQUFDLFNBQVMsRUFBQyxFQUFFLEVBQUU7WUFDbkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsMEJBQTBCLEVBQUUsRUFBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQzNELENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLEtBQUssR0FBRyxXQUFXLENBQUE7UUFDeEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ3BDLEtBQUssSUFBSSxDQUFDLGdCQUFnQixDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDOUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixFQUFFLENBQUE7SUFDaEQsQ0FBQztJQUVELFdBQVcsR0FBRyxHQUFHLEVBQUU7UUFDakIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxhQUFhLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFFbEgsT0FBTyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUMvQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUM3RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMzQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUMsQ0FBQTtJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztZQUNsQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsSUFBSSxDQUFBO1lBQ3JDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLHdCQUF3QixHQUFHLElBQUksQ0FBQTtRQUVwQyxJQUFJLENBQUM7WUFDSCxHQUFHLENBQUM7Z0JBQ0YsSUFBSSxDQUFDLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtnQkFDdEMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtZQUMvQixDQUFDLFFBQVEsSUFBSSxDQUFDLHlCQUF5QixFQUFDO1FBQzFDLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyx3QkFBd0IsR0FBRyxLQUFLLENBQUE7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCO1FBQ3BCLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDWixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQzVDLE1BQU0sT0FBTyxHQUFHLGFBQWEsRUFBRSxVQUFVLEVBQUUsQ0FBQTtZQUUzQyxJQUFJLGFBQWEsRUFBRSxRQUFRLEVBQUUsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDeEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFBO2dCQUN6QyxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsV0FBVyxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUE7Z0JBQzVFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUVqRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFBO2dCQUMzQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGdDQUFnQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUNySSxJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsQ0FBQyxDQUFBO2dCQUN4QyxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxvQkFBb0IsSUFBSSxDQUFDLFdBQVcsZ0NBQWdDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtvQkFDdEcsTUFBTSxLQUFLLENBQUE7Z0JBQ2IsQ0FBQztnQkFDRCxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssT0FBTyxJQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztvQkFBRSxJQUFJLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQTtnQkFDaEcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxrQkFBa0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUMsQ0FBQTtnQkFFN0csSUFBSSxxQkFBcUIsRUFBRSxDQUFDO29CQUMxQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxXQUFXLDBCQUEwQixnQkFBZ0IsRUFBRSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUE7b0JBQ3JKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUMzQixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQUs7WUFDUCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLGFBQWE7UUFDOUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUVoRCx1RUFBdUU7UUFDdkUsd0VBQXdFO1FBQ3hFLHVFQUF1RTtRQUN2RSxJQUFJLFFBQVEsQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQzNCLE1BQU0sYUFBYSxDQUFDLG1CQUFtQixFQUFFLENBQUE7WUFDekMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDMUMsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3ZDLE1BQU0sY0FBYyxHQUFHLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ25ELE1BQU0sSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUE7UUFDdkIsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFBO1FBQzVFLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNqRSxNQUFNLFdBQVcsR0FBRyxPQUFPLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUE7UUFDdkUsTUFBTSxJQUFJLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwRCxNQUFNLFlBQVksR0FBRyxPQUFPLElBQUksS0FBSyxRQUFRLENBQUE7UUFDN0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLFVBQVUsQ0FBQTtRQUUvQyxJQUFJLENBQUMsV0FBVyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDbkQsTUFBTSxJQUFJLEtBQUssQ0FBQyw0REFBNEQsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBQzVGLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxnQkFBZ0IsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQ2pHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsc0JBQXNCLEVBQUU7Z0JBQy9DLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztnQkFDN0IsV0FBVztnQkFDWCxRQUFRO2dCQUNSLFlBQVk7Z0JBQ1osWUFBWTthQUNiLENBQUMsQ0FBQyxDQUFBO1FBRUgsSUFBSSxxQkFBcUIsRUFBRSxDQUFDO1lBQzFCLFFBQVEsQ0FBQyxTQUFTLENBQUMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzNDLENBQUM7YUFBTSxJQUFJLFdBQVcsSUFBSSxLQUFLLElBQUksZ0JBQWdCLElBQUksWUFBWSxFQUFFLENBQUM7WUFDcEUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxZQUFZLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDaEQsQ0FBQztRQUVELHFFQUFxRTtRQUNyRSxvRUFBb0U7UUFDcEUsb0VBQW9FO1FBQ3BFLGdFQUFnRTtRQUNoRSxtREFBbUQ7UUFDbkQsTUFBTSxnQkFBZ0IsR0FBRyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQTtRQUVyRSxpRkFBaUY7UUFDakYsaUZBQWlGO1FBQ2pGLGlEQUFpRDtRQUNqRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsVUFBVSxFQUFFLElBQUksTUFBTSxDQUFBO1FBRXBELHlDQUF5QztRQUN6QyxJQUFJLFVBQVUsR0FBRyxJQUFJLENBQUE7UUFFckIsMEVBQTBFO1FBQzFFLHNFQUFzRTtRQUN0RSxxRUFBcUU7UUFDckUsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBQ2pFLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDaEgsbUVBQW1FO1FBQ25FLDBFQUEwRTtRQUMxRSx3RUFBd0U7UUFDeEUseUVBQXlFO1FBQ3pFLHVDQUF1QztRQUN2QyxNQUFNLDZCQUE2QixHQUFHLFFBQVEsQ0FBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZGLHlFQUF5RTtRQUN6RSwwRUFBMEU7UUFDMUUsc0VBQXNFO1FBQ3RFLHFFQUFxRTtRQUNyRSwyRUFBMkU7UUFDM0UsTUFBTSxtQkFBbUIsR0FBRyxXQUFXLElBQUksQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDLGVBQWUsSUFBSSxVQUFVLElBQUksVUFBVSxDQUFDLGtCQUFrQixLQUFLLEtBQUssQ0FBQyxJQUFJLDZCQUE2QixLQUFLLEtBQUssSUFBSSxDQUFDLGdCQUFnQixDQUFBO1FBRXJNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RCLElBQUksYUFBYSxDQUFBO1lBRWpCLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2hCLElBQUksbUJBQW1CLEVBQUUsQ0FBQztvQkFDeEIscUVBQXFFO29CQUNyRSxpRUFBaUU7b0JBQ2pFLG9FQUFvRTtvQkFDcEUsc0RBQXNEO29CQUN0RCxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFBO29CQUN2QixRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBO29CQUNwQixVQUFVLEdBQUcsRUFBRSxDQUFBO29CQUNmLGFBQWEsR0FBRyxDQUFDLENBQUE7Z0JBQ25CLENBQUM7cUJBQU0sQ0FBQztvQkFDTixNQUFNLEtBQUssR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7b0JBQ3JDLGFBQWEsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFBO2dCQUM1QixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGdGQUFnRjtnQkFDaEYsc0RBQXNEO2dCQUN0RCxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUMvRSxNQUFNLGlCQUFpQixHQUFHLE1BQU0sd0JBQXdCLENBQUM7b0JBQ3ZELFVBQVU7b0JBQ1YsV0FBVyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsd0JBQXdCLEVBQUU7b0JBQzFELE9BQU87b0JBQ1AsUUFBUTtpQkFDVCxDQUFDLENBQUE7Z0JBRUYsSUFBSSxpQkFBaUIsQ0FBQyxPQUFPLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztvQkFDbEQsNEVBQTRFO29CQUM1RSwrREFBK0Q7b0JBQy9ELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUE7b0JBQ3ZCLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUE7b0JBQ3BCLFVBQVUsR0FBRyxFQUFFLENBQUE7b0JBQ2YsYUFBYSxHQUFHLENBQUMsQ0FBQTtnQkFDbkIsQ0FBQztxQkFBTSxJQUFJLGlCQUFpQixDQUFDLE9BQU8sSUFBSSxZQUFZLEVBQUUsQ0FBQztvQkFDckQsVUFBVSxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBQTtvQkFDbkMsYUFBYSxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUE7Z0JBQy9DLENBQUM7cUJBQU0sQ0FBQztvQkFDTixhQUFhLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBQTtnQkFDbkMsQ0FBQztZQUNILENBQUM7WUFFRCw0RUFBNEU7WUFDNUUscUNBQXFDO1lBQ3JDLFFBQVEsQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtZQUN2QyxRQUFRLENBQUMsU0FBUyxDQUFDLGdCQUFnQixFQUFFLGFBQWEsQ0FBQyxDQUFBO1FBQ3JELENBQUM7UUFFRCx3RUFBd0U7UUFDeEUsd0VBQXdFO1FBQ3hFLGtFQUFrRTtRQUNsRSxnRUFBZ0U7UUFDaEUsMkVBQTJFO1FBQzNFLDJFQUEyRTtRQUMzRSwyRUFBMkU7UUFDM0UsNEVBQTRFO1FBQzVFLElBQUksVUFBVSxJQUFJLENBQUMsZ0JBQWdCLElBQUksNkJBQTZCLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDL0UsdUJBQXVCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDbkMsQ0FBQztRQUVELFFBQVEsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFBO1FBQzlDLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1FBRXpDLElBQUksT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUVoQixPQUFPLElBQUksUUFBUSxPQUFPLENBQUMsV0FBVyxFQUFFLElBQUksUUFBUSxDQUFDLGFBQWEsRUFBRSxJQUFJLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxNQUFNLENBQUE7UUFFekcsS0FBSyxNQUFNLFNBQVMsSUFBSSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDekMsS0FBSyxNQUFNLFdBQVcsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELE9BQU8sSUFBSSxHQUFHLFNBQVMsS0FBSyxXQUFXLE1BQU0sQ0FBQTtZQUMvQyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sSUFBSSxNQUFNLENBQUE7UUFFakIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ25DLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxhQUFhLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUV6SCw0RUFBNEU7UUFDNUUseUVBQXlFO1FBQ3pFLDJFQUEyRTtRQUMzRSx3RUFBd0U7UUFDeEUsMEVBQTBFO1FBQzFFLCtCQUErQjtRQUMvQixJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDeEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywyQ0FBMkMsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQTtZQUNqSCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxVQUFVLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQzNGLENBQUM7YUFBTSxJQUFJLGdCQUFnQixFQUFFLENBQUM7WUFDNUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxpREFBaUQsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsYUFBYSxFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFDbkosd0VBQXdFO1lBQ3hFLDJFQUEyRTtZQUMzRSwyRUFBMkU7WUFDM0Usc0VBQXNFO1lBQ3RFLElBQUksV0FBVztnQkFBRSxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxjQUFjLENBQUMsQ0FBQTtRQUM3RSxDQUFDO2FBQU0sSUFBSSxhQUFhLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtDQUErQyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUE7WUFDM0csSUFBSSxXQUFXO2dCQUFFLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBQzdFLENBQUM7YUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBQzNELENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFBO1lBQ3RDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMkJBQTJCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDekksQ0FBQztRQUVELE1BQU0sYUFBYSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFekMsSUFBSSxrQkFBa0IsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNsQyxNQUFNLFdBQVcsR0FBRyw2Q0FBNkMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQzNFLFdBQVcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzFDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLFVBQVU7UUFDakQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxzQkFBc0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUU1RixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDM0MsbUNBQW1DO1lBQ25DLElBQUksVUFBVSxHQUFHLElBQUksQ0FBQTtZQUNyQixNQUFNLE1BQU0sR0FBRyxDQUFDLHNDQUFzQyxDQUFDLGNBQWMsRUFBRSxFQUFFO2dCQUN2RSxJQUFJLFVBQVU7b0JBQUUsT0FBTyxVQUFVLENBQUE7Z0JBRWpDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQ3hDLFVBQVUsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUMsQ0FBQztxQkFDaEYsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFBO2dCQUV6QyxPQUFPLFVBQVUsQ0FBQTtZQUNuQixDQUFDLENBQUE7WUFFRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3JDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN4RCxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMscUJBQXFCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ3JHLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBRXZCLElBQUksQ0FBQztZQUNILE1BQU0sVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzFCLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxXQUFXLENBQUMsQ0FBQTtZQUV0QyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMENBQTBDLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUVySSxNQUFNLFlBQVksR0FBRztnQkFDbkIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUM7Z0JBQzFGLEtBQUs7YUFDTixDQUFBO1lBRUQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsWUFBWSxDQUFDLENBQUE7WUFDekUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxZQUFZLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtRQUN4RyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyx5QkFBeUI7UUFDN0IsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDdEYsQ0FBQztJQUVEOzs7Ozs7Ozs0REFRd0Q7SUFDeEQsZ0JBQWdCLEdBQUcsSUFBSSxDQUFBO0lBRXZCOzs7O09BSUc7SUFDSCxrQkFBa0IsQ0FBQyxRQUFRO1FBQ3pCLE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILG1CQUFtQixDQUFDLFFBQVEsRUFBRSxPQUFPO1FBQ25DLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtRQUVuRixNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFekMseUVBQXlFO1FBQ3pFLG1EQUFtRDtRQUNuRCxJQUFJLFdBQVcsSUFBSSxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNqRSxRQUFRLENBQUMsU0FBUyxDQUFDLFlBQVksRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUMzQyxDQUFDO1FBRUQsd0VBQXdFO1FBQ3hFLHNFQUFzRTtRQUN0RSxRQUFRLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDdkMsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLG1CQUFtQixDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3pELFFBQVEsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDcEQsQ0FBQztRQUVELFFBQVEsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQTtRQUNwRCxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUV6QyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdEQsSUFBSSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBQ2hCLE9BQU8sSUFBSSxRQUFRLFdBQVcsSUFBSSxZQUFZLENBQUMsYUFBYSxFQUFFLElBQUksWUFBWSxDQUFDLGdCQUFnQixFQUFFLE1BQU0sQ0FBQTtRQUV2RyxLQUFLLE1BQU0sU0FBUyxJQUFJLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUM3QyxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDMUQsT0FBTyxJQUFJLEdBQUcsU0FBUyxLQUFLLFdBQVcsTUFBTSxDQUFBO1lBQy9DLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLE1BQU0sQ0FBQTtRQUNqQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQUs7UUFDMUIsTUFBTSxLQUFLLEdBQUcsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN6RixNQUFNLEtBQUssR0FBRyxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEtBQUssTUFBTSxDQUFBO1FBQzVELElBQUksSUFBSSxDQUFDLGdCQUFnQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ25DLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUNqQyxPQUFNO1FBQ1IsQ0FBQztRQUNELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsUUFBUTtRQUM5QixJQUFJLFFBQVEsQ0FBQyxXQUFXO1lBQUUsT0FBTTtRQUNoQyxRQUFRLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtRQUMzQixJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQzVDLElBQUksSUFBSSxDQUFDLGdCQUFnQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ25DLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUN6QyxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzFDLENBQUM7UUFDRCxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CO1FBQ3hCLEtBQUssTUFBTSxRQUFRLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDL0QsSUFBSSxRQUFRLENBQUMsYUFBYTtnQkFBRSxTQUFRO1lBQ3BDLFFBQVEsQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO1lBQzdCLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDNUMsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDL0MsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLFFBQVE7UUFDckMsSUFBSSxRQUFRLENBQUMsb0JBQW9CLENBQUMsSUFBSSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRXBELEtBQUssTUFBTSxRQUFRLElBQUksUUFBUSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDckQsSUFBSSxDQUFDO2dCQUNILFFBQVEsRUFBRSxDQUFBO1lBQ1osQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxZQUFZLEdBQUc7b0JBQ25CLE9BQU8sRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLEtBQUssRUFBRSx1QkFBdUIsRUFBQztvQkFDeEUsS0FBSztpQkFDTixDQUFBO2dCQUNELElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLFlBQVksQ0FBQyxDQUFBO2dCQUN6RSxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLFlBQVksRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1lBQ3hHLENBQUM7UUFDSCxDQUFDO1FBQ0QsUUFBUSxDQUFDLG9CQUFvQixDQUFDLEtBQUssRUFBRSxDQUFBO0lBQ3ZDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsT0FBTztRQUMzQixNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDekMsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFBO1FBQzVFLE1BQU0sZ0JBQWdCLEdBQUcsZ0JBQWdCO1lBQ3ZDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDO1lBQzFFLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFTixJQUFJLFdBQVcsSUFBSSxXQUFXO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFDNUMsSUFBSSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFbkQsSUFBSSxXQUFXLElBQUksS0FBSyxJQUFJLGdCQUFnQixJQUFJLFlBQVk7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV6RSxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7Q0FDRjtBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsa0JBQWtCLENBQUMsVUFBVTtJQUNwQyxPQUFPLENBQUMsVUFBVSxJQUFJLEdBQUcsSUFBSSxVQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksVUFBVSxLQUFLLEdBQUcsSUFBSSxVQUFVLEtBQUssR0FBRyxDQUFBO0FBQzVGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGNyeXB0byBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IHtlbnN1cmVFcnJvcn0gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQge0h0dHBSZXF1ZXN0Qm9keVRvb0xhcmdlRXJyb3J9IGZyb20gXCIuL2Vycm9ycy5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFJlcXVlc3QgZnJvbSBcIi4vcmVxdWVzdC5qc1wiXG5pbXBvcnQgUmVxdWVzdFJ1bm5lciBmcm9tIFwiLi9yZXF1ZXN0LXJ1bm5lci5qc1wiXG5pbXBvcnQge2FkZEFjY2VwdEVuY29kaW5nVG9WYXJ5LCBhcHBseVJlc3BvbnNlQ29tcHJlc3Npb24sIG5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZ30gZnJvbSBcIi4vcmVzcG9uc2UtY29tcHJlc3Npb24uanNcIlxuaW1wb3J0IFdlYnNvY2tldFNlc3Npb24gZnJvbSBcIi4vd2Vic29ja2V0LXNlc3Npb24uanNcIlxuXG4vKipcbiAqIFJ1bnMgYmFkIHJlcXVlc3QgZGV0YWlscy5cbiAqIEBwYXJhbSB7RXJyb3IgJiB7dmVsb2Npb3VzQ29udGV4dD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNhZmUgYmFkLXJlcXVlc3QgZGV0YWlscyBmb3IgbG9ncy5cbiAqL1xuZnVuY3Rpb24gYmFkUmVxdWVzdERldGFpbHMoZXJyb3IpIHtcbiAgcmV0dXJuIHtcbiAgICBlcnJvckNsYXNzOiBlcnJvci5uYW1lLFxuICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgdmVsb2Npb3VzQ29udGV4dDogZXJyb3IudmVsb2Npb3VzQ29udGV4dFxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlb2xpY2lvdXNIdHRwU2VydmVyQ2xpZW50IHtcbiAgZXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpXG4gIHN0YXRlID0gXCJpbml0aWFsXCJcblxuICAvKipcbiAgICogV2hldGhlciBhIGRvbmUtcmVxdWVzdHMgZHJhaW4gaXMgY3VycmVudGx5IHNlbmRpbmcgcmVzcG9uc2VzIGZvciB0aGlzIGNsaWVudC5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW5vdGhlciBkcmFpbiB3YXMgcmVxdWVzdGVkIHdoaWxlIG9uZSB3YXMgYWxyZWFkeSBhY3RpdmUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfZG9uZVJlcXVlc3RzRHJhaW5QZW5kaW5nID0gZmFsc2VcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY2xpZW50Q291bnQgLSBDbGllbnQgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucmVtb3RlQWRkcmVzc10gLSBSZW1vdGUgYWRkcmVzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbGllbnRDb3VudCwgY29uZmlndXJhdGlvbiwgcmVtb3RlQWRkcmVzc30pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW5cIilcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuY2xpZW50Q291bnQgPSBjbGllbnRDb3VudFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLnJlbW90ZUFkZHJlc3MgPSByZW1vdGVBZGRyZXNzXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlcXVlc3RSdW5uZXJbXX0gKi9cbiAgICB0aGlzLnJlcXVlc3RSdW5uZXJzID0gW11cblxuICAgIC8qKiBAdHlwZSB7U2V0PChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlcyA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogU3RyZWFtcyB0aGF0IGhhdmUgc3RhcnRlZCBidXQgaGF2ZSBub3QgZmluaXNoZWQgb3IgYmVlbiBhYm9ydGVkIHlldC5cbiAgICAgKiBAdHlwZSB7TWFwPGltcG9ydChcIi4vcmVzcG9uc2UuanNcIikuZGVmYXVsdCwge2NsaWVudENvdW50OiBudW1iZXIsIHJlcXVlc3Q6IGltcG9ydChcIi4vcmVxdWVzdC5qc1wiKS5kZWZhdWx0fT59ICovXG4gICAgdGhpcy5fYWN0aXZlU3RyZWFtUmVzcG9uc2VzID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGJhZCB1cGdyYWRlIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIE1lc3NhZ2UgdGV4dC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NlbmRCYWRVcGdyYWRlUmVzcG9uc2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gdGhpcy5jdXJyZW50UmVxdWVzdD8uaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgYm9keSA9IGAke21lc3NhZ2V9XFxuYFxuICAgIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgICBgSFRUUC8ke2h0dHBWZXJzaW9ufSA0MDAgQmFkIFJlcXVlc3RgLFxuICAgICAgXCJDb25uZWN0aW9uOiBDbG9zZVwiLFxuICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9VVRGLThcIixcbiAgICAgIGBDb250ZW50LUxlbmd0aDogJHtCdWZmZXIuYnl0ZUxlbmd0aChib2R5LCBcInV0ZjhcIil9YCxcbiAgICAgIFwiXCIsXG4gICAgICBib2R5XG4gICAgXS5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGhlYWRlcnMpXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGJhZCByZXF1ZXN0IHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFJlc3BvbnNlIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZW5kQmFkUmVxdWVzdFJlc3BvbnNlKG1lc3NhZ2UpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3Q/Lmh0dHBWZXJzaW9uKCkgfHwgXCIxLjFcIlxuICAgIGNvbnN0IGJvZHkgPSBgJHttZXNzYWdlfVxcbmBcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgYEhUVFAvJHtodHRwVmVyc2lvbn0gNDAwIEJhZCBSZXF1ZXN0YCxcbiAgICAgIFwiQ29ubmVjdGlvbjogQ2xvc2VcIixcbiAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PVVURi04XCIsXG4gICAgICBgQ29udGVudC1MZW5ndGg6ICR7QnVmZmVyLmJ5dGVMZW5ndGgoYm9keSwgXCJ1dGY4XCIpfWAsXG4gICAgICBcIlwiLFxuICAgICAgYm9keVxuICAgIF0uam9pbihcIlxcclxcblwiKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGEgZGV0ZXJtaW5pc3RpYyByZXF1ZXN0LWJvZHkgbGltaXQgcmVzcG9uc2UgYW5kIGNsb3NlcyB0aGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NlbmRQYXlsb2FkVG9vTGFyZ2VSZXNwb25zZSgpIHtcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3Q/Lmh0dHBWZXJzaW9uKCkgfHwgXCIxLjFcIlxuICAgIGNvbnN0IGJvZHkgPSBcIlBheWxvYWQgVG9vIExhcmdlXFxuXCJcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgYEhUVFAvJHtodHRwVmVyc2lvbn0gNDEzIFBheWxvYWQgVG9vIExhcmdlYCxcbiAgICAgIFwiQ29ubmVjdGlvbjogQ2xvc2VcIixcbiAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PVVURi04XCIsXG4gICAgICBgQ29udGVudC1MZW5ndGg6ICR7QnVmZmVyLmJ5dGVMZW5ndGgoYm9keSwgXCJ1dGY4XCIpfWAsXG4gICAgICBcIlwiLFxuICAgICAgYm9keVxuICAgIF0uam9pbihcIlxcclxcblwiKVxuXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBoZWFkZXJzKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGJhZCByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBoYW5kbGVCYWRSZXF1ZXN0KGVycm9yKSB7XG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gcGFyc2UgSFRUUCByZXF1ZXN0XCIsIGJhZFJlcXVlc3REZXRhaWxzKC8qKiBAdHlwZSB7RXJyb3IgJiB7dmVsb2Npb3VzQ29udGV4dD86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovIChlcnJvcikpXSlcblxuICAgIGlmICh0aGlzLmN1cnJlbnRSZXF1ZXN0ICYmIFwiZ2V0UmVxdWVzdFBhcnNlclwiIGluIHRoaXMuY3VycmVudFJlcXVlc3QpIHtcbiAgICAgIGNvbnN0IGh0dHBSZXF1ZXN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuY3VycmVudFJlcXVlc3QpXG5cbiAgICAgIGh0dHBSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKS5kZXN0cm95KClcbiAgICB9XG5cbiAgICB0aGlzLmN1cnJlbnRSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5zdGF0ZSA9IFwiaW5pdGlhbFwiXG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBIdHRwUmVxdWVzdEJvZHlUb29MYXJnZUVycm9yKSB7XG4gICAgICB0aGlzLl9zZW5kUGF5bG9hZFRvb0xhcmdlUmVzcG9uc2UoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zZW5kQmFkUmVxdWVzdFJlc3BvbnNlKFwiQmFkIFJlcXVlc3RcIilcbiAgICB9XG4gIH1cblxuICBleGVjdXRlQ3VycmVudFJlcXVlc3QgPSAoKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoXCJleGVjdXRlQ3VycmVudFJlcXVlc3RcIilcblxuICAgIGNvbnN0IGN1cnJlbnRSZXF1ZXN0ID0gdGhpcy5jdXJyZW50UmVxdWVzdFxuXG4gICAgaWYgKCFjdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG4gICAgY29uc3QgcmVkYWN0b3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnJlcXVlc3RTZW5zaXRpdmVWYWx1ZXMoY3VycmVudFJlcXVlc3QpXG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJleGVjdXRlQ3VycmVudFJlcXVlc3QgcmVxdWVzdFwiLCB7XG4gICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgIGh0dHBNZXRob2Q6IGN1cnJlbnRSZXF1ZXN0Lmh0dHBNZXRob2QoKSxcbiAgICAgIGh0dHBWZXJzaW9uOiBjdXJyZW50UmVxdWVzdC5odHRwVmVyc2lvbigpLFxuICAgICAgcGF0aDogcmVkYWN0b3IucmVkYWN0UGF0aChjdXJyZW50UmVxdWVzdC5wYXRoKCksIHNlbnNpdGl2ZVZhbHVlcyksXG4gICAgICBxdWV1ZUxlbmd0aDogdGhpcy5yZXF1ZXN0UnVubmVycy5sZW5ndGhcbiAgICB9XSlcblxuICAgIGlmICh0aGlzLl9pc1dlYnNvY2tldFVwZ3JhZGUoY3VycmVudFJlcXVlc3QpKSB7XG4gICAgICB0aGlzLl91cGdyYWRlVG9XZWJzb2NrZXQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gV2UgYXJlIGRvbmUgcGFyc2luZyB0aGUgZ2l2ZW4gcmVxdWVzdCBhbmQgY2FuIHRoZW9yZXRpY2FsbHkgc3RhcnQgcGFyc2luZyBhIG5ldyBvbmUsIGJlZm9yZSB0aGUgY3VycmVudCByZXF1ZXN0IGlzIGRvbmUgLSBzbyByZXNldCB0aGUgc3RhdGUuXG4gICAgdGhpcy5zdGF0ZSA9IFwiaW5pdGlhbFwiXG5cbiAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gbmV3IFJlcXVlc3RSdW5uZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgcmVxdWVzdDogY3VycmVudFJlcXVlc3RcbiAgICB9KVxuXG4gICAgdGhpcy5yZXF1ZXN0UnVubmVycy5wdXNoKHJlcXVlc3RSdW5uZXIpXG5cbiAgICAvLyBBIHN0cmVhbWluZyByZXNwb25zZSBlbWl0cyBpdHMgaGVhZGVycyBhbmQgY2h1bmtzIHRvIHRoZSBjbGllbnQgd2hpbGVcbiAgICAvLyB0aGUgcmVxdWVzdCBpcyBzdGlsbCBydW5uaW5nLCBzbyB0aGUgcmVzcG9uc2UgbmVlZHMgdGhlIG93bmluZyBjbGllbnRcbiAgICAvLyBhcyBpdHMgdHJhbnNwb3J0IHNpbmsgYmVmb3JlIHRoZSBoYW5kbGVyIHJ1bnMuIFN1Yi1yZXF1ZXN0cyAoZS5nLlxuICAgIC8vIHdlYnNvY2tldCByZXF1ZXN0IHBheWxvYWRzKSBoYXZlIG5vIHNvY2tldCBhbmQga2VlcCB0cmFuc3BvcnQgbnVsbDtcbiAgICAvLyB0aGVpciByZXNwb25zZXMgZmFpbCBsb3VkbHkgaWYgdGhleSBhdHRlbXB0IHRvIHN0cmVhbS5cbiAgICBjb25zdCBzb2NrZXRSZXF1ZXN0ID0gY3VycmVudFJlcXVlc3RcbiAgICByZXF1ZXN0UnVubmVyLnJlc3BvbnNlLnRyYW5zcG9ydCA9IHRoaXNcbiAgICByZXF1ZXN0UnVubmVyLnJlc3BvbnNlLnRyYW5zcG9ydFJlcXVlc3QgPSBzb2NrZXRSZXF1ZXN0XG5cbiAgICByZXF1ZXN0UnVubmVyLmV2ZW50cy5vbihcImRvbmVcIiwgdGhpcy5yZXF1ZXN0RG9uZSlcbiAgICByZXF1ZXN0UnVubmVyLnJ1bigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbiB3cml0ZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uV3JpdGUoZGF0YSkge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIm9uV3JpdGUgc3RhcnRcIiwge1xuICAgICAgY2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsXG4gICAgICBsZW5ndGg6IGRhdGEubGVuZ3RoLFxuICAgICAgc3RhdGU6IHRoaXMuc3RhdGUsXG4gICAgfV0pXG5cbiAgICBpZiAodGhpcy53ZWJzb2NrZXRTZXNzaW9uKSB7XG4gICAgICB0aGlzLndlYnNvY2tldFNlc3Npb24ub25EYXRhKGRhdGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLyoqXG4gICAgICAgKiBSZW1haW5pbmcuXG4gICAgICAgKiBAdHlwZSB7QnVmZmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IHJlbWFpbmluZyA9IGRhdGFcblxuICAgICAgd2hpbGUgKHJlbWFpbmluZykge1xuICAgICAgICBpZiAocmVtYWluaW5nLmxlbmd0aCA8PSAwKSBicmVha1xuXG4gICAgICAgIGlmICh0aGlzLnN0YXRlID09IFwiaW5pdGlhbFwiKSB7XG4gICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBjcmVhdGluZyByZXF1ZXN0IHBhcnNlclwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3QgPSBuZXcgUmVxdWVzdCh7Y2xpZW50OiB0aGlzLCBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgICAgICAgIHRoaXMuY3VycmVudFJlcXVlc3QucmVxdWVzdFBhcnNlci5ldmVudHMub24oXCJkb25lXCIsIHRoaXMuZXhlY3V0ZUN1cnJlbnRSZXF1ZXN0KVxuICAgICAgICAgIHRoaXMuc3RhdGUgPSBcInJlcXVlc3RTdGFydGVkXCJcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlICE9IFwicmVxdWVzdFN0YXJ0ZWRcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBzdGF0ZSBmb3IgY2xpZW50OiAke3RoaXMuc3RhdGV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5jdXJyZW50UmVxdWVzdCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY3VycmVudCByZXF1ZXN0XCIpXG5cbiAgICAgICAgcmVtYWluaW5nID0gdGhpcy5jdXJyZW50UmVxdWVzdC5mZWVkKHJlbWFpbmluZylcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBmZWQgcGFyc2VyXCIsIHtcbiAgICAgICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgICAgICBoYXNSZW1haW5pbmc6IEJvb2xlYW4ocmVtYWluaW5nPy5sZW5ndGgpLFxuICAgICAgICAgIHJlbWFpbmluZ0xlbmd0aDogcmVtYWluaW5nPy5sZW5ndGggfHwgMCxcbiAgICAgICAgICBwYXJzZXJDb21wbGV0ZWQ6IHRoaXMuY3VycmVudFJlcXVlc3Q/LmdldFJlcXVlc3RQYXJzZXIoKS5oYXNDb21wbGV0ZWRcbiAgICAgICAgfV0pXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZyAmJiByZW1haW5pbmcubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IHJlcXVlc3RQYXJzZXIgPSB0aGlzLmN1cnJlbnRSZXF1ZXN0LmdldFJlcXVlc3RQYXJzZXIoKVxuXG4gICAgICAgICAgaWYgKCFyZXF1ZXN0UGFyc2VyLmhhc0NvbXBsZXRlZCkge1xuICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nTGVuZ3RoID0gcmVtYWluaW5nLmxlbmd0aFxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHdhaXRpbmcgZm9yIG1vcmUgZGF0YVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHJlbWFpbmluZ0xlbmd0aH1dKVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLnN0YXRlID0gXCJpbml0aWFsXCJcbiAgICAgICAgICBjb25zdCByZW1haW5pbmdMZW5ndGggPSByZW1haW5pbmcubGVuZ3RoXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJvbldyaXRlIHBhcnNlciBjb21wbGV0ZWQgd2l0aCByZW1haW5pbmcgYnl0ZXNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCByZW1haW5pbmdMZW5ndGh9XSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wib25Xcml0ZSBlbmRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBzdGF0ZTogdGhpcy5zdGF0ZSwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlQmFkUmVxdWVzdChlbnN1cmVFcnJvcihlcnJvcikpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgd2Vic29ja2V0IHVwZ3JhZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IHJlcXVlc3QgLSBSZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB3ZWJzb2NrZXQgdXBncmFkZS5cbiAgICovXG4gIF9pc1dlYnNvY2tldFVwZ3JhZGUocmVxdWVzdCkge1xuICAgIGNvbnN0IHVwZ3JhZGVIZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcInVwZ3JhZGVcIik/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gQm9vbGVhbih1cGdyYWRlSGVhZGVyID09IFwid2Vic29ja2V0XCIgJiYgY29ubmVjdGlvbkhlYWRlcj8uaW5jbHVkZXMoXCJ1cGdyYWRlXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBncmFkZSB0byB3ZWJzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF91cGdyYWRlVG9XZWJzb2NrZXQoKSB7XG4gICAgaWYgKCF0aGlzLmN1cnJlbnRSZXF1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjdXJyZW50IHJlcXVlc3RcIilcblxuICAgIGNvbnN0IHNlY1dlYnNvY2tldEtleSA9IHRoaXMuY3VycmVudFJlcXVlc3QuaGVhZGVyKFwic2VjLXdlYnNvY2tldC1rZXlcIilcblxuICAgIGlmICghc2VjV2Vic29ja2V0S2V5KSB7XG4gICAgICB0aGlzLl9zZW5kQmFkVXBncmFkZVJlc3BvbnNlKFwiTWlzc2luZyBTZWMtV2ViU29ja2V0LUtleSBoZWFkZXJcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHdlYnNvY2tldEFjY2VwdEtleSA9IGNyeXB0by5jcmVhdGVIYXNoKFwic2hhMVwiKVxuICAgICAgLnVwZGF0ZShgJHtzZWNXZWJzb2NrZXRLZXl9MjU4RUFGQTUtRTkxNC00N0RBLTk1Q0EtQzVBQjBEQzg1QjExYCwgXCJiaW5hcnlcIilcbiAgICAgIC5kaWdlc3QoXCJiYXNlNjRcIilcbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHRoaXMuY3VycmVudFJlcXVlc3QuaHR0cFZlcnNpb24oKSB8fCBcIjEuMVwiXG4gICAgY29uc3QgcmVzcG9uc2VMaW5lcyA9IFtcbiAgICAgIGBIVFRQLyR7aHR0cFZlcnNpb259IDEwMSBTd2l0Y2hpbmcgUHJvdG9jb2xzYCxcbiAgICAgIFwiVXBncmFkZTogd2Vic29ja2V0XCIsXG4gICAgICBcIkNvbm5lY3Rpb246IFVwZ3JhZGVcIixcbiAgICAgIGBTZWMtV2ViU29ja2V0LUFjY2VwdDogJHt3ZWJzb2NrZXRBY2NlcHRLZXl9YCxcbiAgICAgIFwiXCIsXG4gICAgICBcIlwiXG4gICAgXVxuICAgIGNvbnN0IHJlc3BvbnNlID0gcmVzcG9uc2VMaW5lcy5qb2luKFwiXFxyXFxuXCIpXG5cbiAgICBjb25zdCBtZXNzYWdlSGFuZGxlclJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldE1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXI/LigpXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGVyXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGVyUHJvbWlzZVxuXG4gICAgaWYgKG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkSGFuZGxlciA9IG1lc3NhZ2VIYW5kbGVyUmVzb2x2ZXIoe1xuICAgICAgICBjbGllbnQ6IHRoaXMsXG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgcmVxdWVzdDogdGhpcy5jdXJyZW50UmVxdWVzdFxuICAgICAgfSlcblxuICAgICAgY29uc3QgcmVzb2x2ZWRUaGVuYWJsZSA9IC8qKiBAdHlwZSB7e3RoZW4/OiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChyZXNvbHZlZEhhbmRsZXIpXG5cbiAgICAgIGlmIChyZXNvbHZlZFRoZW5hYmxlPy50aGVuKSB7XG4gICAgICAgIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZSA9IC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyIHwgdm9pZD59ICovIChyZXNvbHZlZEhhbmRsZXIpXG4gICAgICB9IGVsc2UgaWYgKHJlc29sdmVkSGFuZGxlcikge1xuICAgICAgICBtZXNzYWdlSGFuZGxlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlcn0gKi8gKHJlc29sdmVkSGFuZGxlcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24gPSBuZXcgV2Vic29ja2V0U2Vzc2lvbih7XG4gICAgICBjbGllbnQ6IHRoaXMsXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICB1cGdyYWRlUmVxdWVzdDogdGhpcy5jdXJyZW50UmVxdWVzdCxcbiAgICAgIG1lc3NhZ2VIYW5kbGVyOiBtZXNzYWdlSGFuZGxlcixcbiAgICAgIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZTogbWVzc2FnZUhhbmRsZXJQcm9taXNlXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgLy8gUGF1c2VkIHNlc3Npb25zIHN1cnZpdmUgdGhlIHNvY2tldCBjbG9zZTsgZG9uJ3QgZGVzdHJveSgpLlxuICAgICAgLy8gVGhlIGdyYWNlLWV4cGlyeSBwYXRoIChfZmluYWxpemVHcmFjZUV4cGlyeSkgd2lsbCBkZXN0cm95XG4gICAgICAvLyB0aGVtIHBlcm1hbmVudGx5IGlmIHJlc3VtZSBkb2Vzbid0IGhhcHBlbiBpbiB0aW1lLlxuICAgICAgaWYgKCF0aGlzLndlYnNvY2tldFNlc3Npb24/LmlzUGF1c2VkKCkpIHtcbiAgICAgICAgdGhpcy53ZWJzb2NrZXRTZXNzaW9uPy5kZXN0cm95KClcbiAgICAgIH1cbiAgICAgIHRoaXMud2Vic29ja2V0U2Vzc2lvbiA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwib3duZXJzaGlwQ2xhaW1lZFwiLCAoe3Nlc3Npb25JZH0pID0+IHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJ3ZWJzb2NrZXRTZXNzaW9uT3duZWRcIiwge3Nlc3Npb25JZH0pXG4gICAgfSlcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uZXZlbnRzLm9uKFwib3duZXJzaGlwUmVsZWFzZWRcIiwgKHtzZXNzaW9uSWR9KSA9PiB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwid2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkXCIsIHtzZXNzaW9uSWR9KVxuICAgIH0pXG4gICAgdGhpcy5zdGF0ZSA9IFwid2Vic29ja2V0XCJcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIHJlc3BvbnNlKVxuICAgIHZvaWQgdGhpcy53ZWJzb2NrZXRTZXNzaW9uLmluaXRpYWxpemVDaGFubmVsKClcbiAgICB0aGlzLndlYnNvY2tldFNlc3Npb24uc2VuZFNlc3Npb25Fc3RhYmxpc2hlZCgpXG4gIH1cblxuICByZXF1ZXN0RG9uZSA9ICgpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJyZXF1ZXN0RG9uZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHF1ZXVlTGVuZ3RoOiB0aGlzLnJlcXVlc3RSdW5uZXJzLmxlbmd0aH1dKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RyYWluRG9uZVJlcXVlc3RzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHdoaWxlIHNlbmRpbmcgZG9uZSByZXF1ZXN0c1wiLCBlcnJvcilcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGRvbmUgcmVxdWVzdHMgb25lIGF0IGEgdGltZS4gQSBydW5uZXIgaXMgc2hpZnRlZCBvdXQgb2YgdGhlIHF1ZXVlIGJlZm9yZVxuICAgKiBpdHMgcmVzcG9uc2UgZmluaXNoZXMgc2VuZGluZyAoYXN5bmMgY29tcHJlc3Npb24sIGZpbGUgdHJhbnNmZXIpLCBzbyBhblxuICAgKiBvdmVybGFwcGluZyBkcmFpbiB3b3VsZCBvdGhlcndpc2UgcGljayB1cCB0aGUgbmV4dCBydW5uZXIgYW5kIHJlb3JkZXIgcGlwZWxpbmVkXG4gICAqIHNvY2tldCB3cml0ZXMuIENhbGxzIHRoYXQgYXJyaXZlIHdoaWxlIGEgZHJhaW4gaXMgYWN0aXZlIGFyZSBmb2xkZWQgaW50byBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSBkb25lIHJlc3BvbnNlIGhhcyBiZWVuIHNlbnQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Eb25lUmVxdWVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlKSB7XG4gICAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9kb25lUmVxdWVzdHNEcmFpbkFjdGl2ZSA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBkbyB7XG4gICAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluUGVuZGluZyA9IGZhbHNlXG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZERvbmVSZXF1ZXN0cygpXG4gICAgICB9IHdoaWxlICh0aGlzLl9kb25lUmVxdWVzdHNEcmFpblBlbmRpbmcpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2RvbmVSZXF1ZXN0c0RyYWluQWN0aXZlID0gZmFsc2VcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZW5kRG9uZVJlcXVlc3RzKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gdGhpcy5yZXF1ZXN0UnVubmVyc1swXVxuICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVlc3RSdW5uZXI/LmdldFJlcXVlc3QoKVxuXG4gICAgICBpZiAocmVxdWVzdFJ1bm5lcj8uZ2V0U3RhdGUoKSA9PSBcImRvbmVcIikge1xuICAgICAgICBjb25zdCBodHRwVmVyc2lvbiA9IHJlcXVlc3QuaHR0cFZlcnNpb24oKVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uSGVhZGVyID0gcmVxdWVzdC5oZWFkZXIoXCJjb25uZWN0aW9uXCIpPy50b0xvd2VyQ2FzZSgpPy50cmltKClcbiAgICAgICAgY29uc3Qgc2hvdWxkQ2xvc2VDb25uZWN0aW9uID0gdGhpcy5zaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdClcblxuICAgICAgICB0aGlzLnJlcXVlc3RSdW5uZXJzLnNoaWZ0KClcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZERvbmVSZXF1ZXN0cyBzaGlmdGVkIHF1ZXVlXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcXVldWVMZW5ndGg6IHRoaXMucmVxdWVzdFJ1bm5lcnMubGVuZ3RofV0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kUmVzcG9uc2UocmVxdWVzdFJ1bm5lcilcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYFZlbG9jaW91cyBjbGllbnQgJHt0aGlzLmNsaWVudENvdW50fSBmYWlsZWQgd2hpbGUgc2VuZGluZyByZXNwb25zZWAsIGVycm9yXSlcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmN1cnJlbnRSZXF1ZXN0ID09PSByZXF1ZXN0ICYmIHRoaXMuc3RhdGUgPT09IFwiaW5pdGlhbFwiKSB0aGlzLmN1cnJlbnRSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmREb25lUmVxdWVzdHNcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBjb25uZWN0aW9uSGVhZGVyLCBodHRwVmVyc2lvbn1dKVxuXG4gICAgICAgIGlmIChzaG91bGRDbG9zZUNvbm5lY3Rpb24pIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbYENsb3NpbmcgdGhlIGNvbm5lY3Rpb24gYmVjYXVzZSAke2h0dHBWZXJzaW9ufSBhbmQgY29ubmVjdGlvbiBoZWFkZXIgJHtjb25uZWN0aW9uSGVhZGVyfWAsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudH1dKVxuICAgICAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIGZpbmlzaGVkIHJlc3BvbnNlIHRvIHRoZSBjbGllbnQuIE93bnMgdGhlIGZyYW1ld29yay1vd25lZFxuICAgKiBgVmFyeTogQWNjZXB0LUVuY29kaW5nYCBkaW1lbnNpb24gKGVtaXR0ZWQgZm9yIGV2ZXJ5IHNlbGVjdGVkXG4gICAqIHJlcHJlc2VudGF0aW9uIOKAlCB0cmFuc2Zvcm1lZCwgaWRlbnRpdHksIDQwNiwgYW5kIGZpbGUg4oCUIGFuZCBmb3JcbiAgICogaGVhZGVyLXByZXNlbnQgYW5kIGhlYWRlci1hYnNlbnQgcmVxdWVzdHMgYWxpa2UsIHNvIGl0IGlzIHN0YWJsZSBhY3Jvc3NcbiAgICogcmVxdWVzdHMgb24gdGhlIHNhbWUgY29ubmVjdGlvbjsgbmV2ZXIgYWRkZWQgd2hlbiBjb21wcmVzc2lvbiBpcyBkaXNhYmxlZCxcbiAgICogdGhlIHJlc3BvbnNlIGlzIHRydWx5IGJvZHlsZXNzLCBvciB0aGUgYXBwbGljYXRpb24gc3VwcGxpZWQgYSBmaXhlZFxuICAgKiBgQ29udGVudC1FbmNvZGluZ2ApIGFuZCB0aGUgZmlsZSA0MDYgcnVsZSAoYSBzZW5kRmlsZSByZXNwb25zZSB3aG9zZVxuICAgKiBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBpcyBhbnN3ZXJlZCB3aXRoIHRoZSBlbXB0eSA0MDYsIHRoZSBmaWxlIGlzIG5ldmVyXG4gICAqIG9wZW5lZCBvciBzdHJlYW1lZCwgYW5kIGBvbkZpbmlzaGVkYCBzZXR0bGVzIG9uY2UgYXMgXCJjb21wbGV0ZWRcIikuXG4gICAqIEBwYXJhbSB7UmVxdWVzdFJ1bm5lcn0gcmVxdWVzdFJ1bm5lciAtIFJlcXVlc3QgcnVubmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2VuZFJlc3BvbnNlKHJlcXVlc3RSdW5uZXIpIHtcbiAgICBjb25zdCByZXNwb25zZSA9IGRpZ2cocmVxdWVzdFJ1bm5lciwgXCJyZXNwb25zZVwiKVxuXG4gICAgLy8gQSBzdHJlYW1pbmcgcmVzcG9uc2UgYWxyZWFkeSBlbWl0dGVkIGl0cyBzdGF0dXMgbGluZSwgaGVhZGVycywgZXZlcnlcbiAgICAvLyBjaHVuaywgYW5kIHRoZSBjaHVua2VkIHRlcm1pbmF0b3IgdG8gdGhlIGNsaWVudCB3aGlsZSB0aGUgcmVxdWVzdCB3YXNcbiAgICAvLyBydW5uaW5nLiBOb3RoaW5nIGxlZnQgdG8gc2VuZCBoZXJlIOKAlCBqdXN0IGxvZyB0aGUgY29tcGxldGVkIHJlcXVlc3QuXG4gICAgaWYgKHJlc3BvbnNlLmlzU3RyZWFtaW5nKCkpIHtcbiAgICAgIGF3YWl0IHJlcXVlc3RSdW5uZXIubG9nQ29tcGxldGVkUmVxdWVzdCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWVzdFJ1bm5lci5nZXRSZXF1ZXN0KClcbiAgICBjb25zdCBmaWxlUGF0aCA9IHJlc3BvbnNlLmdldEZpbGVQYXRoKClcbiAgICBjb25zdCBmaWxlT25GaW5pc2hlZCA9IHJlc3BvbnNlLmdldEZpbGVPbkZpbmlzaGVkKClcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25IZWFkZXIgPSByZXF1ZXN0LmhlYWRlcihcImNvbm5lY3Rpb25cIik/LnRvTG93ZXJDYXNlKCk/LnRyaW0oKVxuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gcmVxdWVzdC5odHRwVmVyc2lvbigpXG4gICAgY29uc3Qgc2hvdWxkQ2xvc2VDb25uZWN0aW9uID0gdGhpcy5zaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdClcbiAgICBjb25zdCBoYXNGaWxlUGF0aCA9IHR5cGVvZiBmaWxlUGF0aCA9PT0gXCJzdHJpbmdcIiAmJiBmaWxlUGF0aC5sZW5ndGggPiAwXG4gICAgY29uc3QgYm9keSA9IGhhc0ZpbGVQYXRoID8gbnVsbCA6IHJlc3BvbnNlLmdldEJvZHkoKVxuICAgIGNvbnN0IGJvZHlJc1N0cmluZyA9IHR5cGVvZiBib2R5ID09PSBcInN0cmluZ1wiXG4gICAgY29uc3QgYm9keUlzQmluYXJ5ID0gYm9keSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXlcblxuICAgIGlmICghaGFzRmlsZVBhdGggJiYgIWJvZHlJc1N0cmluZyAmJiAhYm9keUlzQmluYXJ5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHJlc3BvbnNlIGJvZHkgdG8gYmUgYSBzdHJpbmcgb3IgVWludDhBcnJheSwgZ290ICR7dHlwZW9mIGJvZHl9YClcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInNlbmRSZXNwb25zZVwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGNvbm5lY3Rpb25IZWFkZXIsIGh0dHBWZXJzaW9ufSlcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgcGF5bG9hZFwiLCB7XG4gICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgIGhhc0ZpbGVQYXRoLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBib2R5SXNCaW5hcnksXG4gICAgICBib2R5SXNTdHJpbmdcbiAgICB9XSlcblxuICAgIGlmIChzaG91bGRDbG9zZUNvbm5lY3Rpb24pIHtcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbm5lY3Rpb25cIiwgXCJDbG9zZVwiKVxuICAgIH0gZWxzZSBpZiAoaHR0cFZlcnNpb24gPT0gXCIxLjBcIiAmJiBjb25uZWN0aW9uSGVhZGVyID09IFwia2VlcC1hbGl2ZVwiKSB7XG4gICAgICByZXNwb25zZS5zZXRIZWFkZXIoXCJDb25uZWN0aW9uXCIsIFwiS2VlcC1BbGl2ZVwiKVxuICAgIH1cblxuICAgIC8vIFBlciBSRkMgNzIzMCDCpzMuMy4zLCByZXNwb25zZXMgd2l0aCBzdGF0dXMgY29kZXMgMXh4LCAyMDQsIGFuZCAzMDRcbiAgICAvLyBNVVNUIE5PVCBjYXJyeSBhIG1lc3NhZ2UgYm9keSBhbmQgTVVTVCBOT1QgaW5jbHVkZSBDb250ZW50LUxlbmd0aFxuICAgIC8vICh3aXRoIGEgbmFycm93IDMwNCBleGNlcHRpb24gd2UgZG9uJ3QgbGVhbiBvbikuIFNlbmRpbmcgb25lIHdvdWxkXG4gICAgLy8gZGVzeW5jaHJvbml6ZSBrZWVwLWFsaXZlIGNsaWVudHMgd2FpdGluZyBmb3IgYnl0ZXMgdGhhdCBuZXZlclxuICAgIC8vIGFycml2ZSDigJQgZHJvcCB0aGUgYm9keSBlbnRpcmVseSBmb3IgdGhvc2UgY29kZXMuXG4gICAgY29uc3QgaXNCb2R5bGVzc1N0YXR1cyA9IGlzTm9Cb2R5U3RhdHVzQ29kZShyZXNwb25zZS5nZXRTdGF0dXNDb2RlKCkpXG5cbiAgICAvLyBIRUFEIHJlc3BvbnNlcyBzZWxlY3QgYW5kIGNvbXB1dGUgdGhlIGV4YWN0IHNhbWUgcmVwcmVzZW50YXRpb24gaGVhZGVycyBhcyB0aGVcbiAgICAvLyBlcXVpdmFsZW50IEdFVCAoaW5jbHVkaW5nIENvbnRlbnQtTGVuZ3RoIGFuZCBhbnkgbmVnb3RpYXRlZCBDb250ZW50LUVuY29kaW5nKSxcbiAgICAvLyBidXQgbm8gYnVmZmVyZWQgb3IgZmlsZSBib2R5IGlzIGVtaXR0ZWQgYmVsb3cuXG4gICAgY29uc3QgaXNIZWFkUmVxdWVzdCA9IHJlcXVlc3QuaHR0cE1ldGhvZCgpID09IFwiSEVBRFwiXG5cbiAgICAvKiogQHR5cGUge3N0cmluZyB8IFVpbnQ4QXJyYXkgfCBudWxsfSAqL1xuICAgIGxldCBib2R5VG9FbWl0ID0gYm9keVxuXG4gICAgLy8gVGhlIHJlc3BvbnNlIHJlcHJlc2VudGF0aW9uIGNhbiBkZXBlbmQgb24gdGhlIGNsaWVudCdzIEFjY2VwdC1FbmNvZGluZzpcbiAgICAvLyB0aGUgc2FtZSByZXF1ZXN0IGlzIGFuc3dlcmVkIHdpdGggYW4gaWRlbnRpdHkgYm9keSAob3IgYSBmaWxlKSB3aGVuXG4gICAgLy8gaWRlbnRpdHkgaXMgYWNjZXB0YWJsZSBhbmQgd2l0aCBhbiBlbXB0eSA0MDYgd2hlbiBpdCBpcyBmb3JiaWRkZW4uXG4gICAgY29uc3QgY29tcHJlc3Npb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlckNvbXByZXNzaW9uKClcbiAgICBjb25zdCBuZWdvdGlhdGVkID0gY29tcHJlc3Npb24uZW5hYmxlZCA/IG5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhyZXF1ZXN0LmhlYWRlcihcImFjY2VwdC1lbmNvZGluZ1wiKSkgOiB1bmRlZmluZWRcbiAgICAvLyBBbiBhcHBsaWNhdGlvbi1zdXBwbGllZCBDb250ZW50LUVuY29kaW5nIGlzIGFuIGFwcGxpY2F0aW9uLW93bmVkXG4gICAgLy8gcmVwcmVzZW50YXRpb24gY29udHJhY3QsIGNhcHR1cmVkIGJlZm9yZSB0aGUgZnJhbWV3b3JrIG1heSBhZGQgaXRzIG93bi5cbiAgICAvLyBBIGZpbGUgY2Fycnlpbmcgb25lIGlzIGEgZml4ZWQsIGFwcGxpY2F0aW9uLW93bmVkIHJlcHJlc2VudGF0aW9uOiB0aGVcbiAgICAvLyBmcmFtZXdvcmsgbmVpdGhlciBuZWdvdGlhdGVzIGl0IG5vciByZS1hZHZlcnRpc2VzIGl0LCBzbyBpdCBpcyBuZXZlciBhXG4gICAgLy8gY2FuZGlkYXRlIGZvciB0aGUgaWRlbnRpdHktb25seSA0MDYuXG4gICAgY29uc3QgaGFzQXBwbGljYXRpb25Db250ZW50RW5jb2RpbmcgPSByZXNwb25zZS5nZXRIZWFkZXIoXCJDb250ZW50LUVuY29kaW5nXCIpLmxlbmd0aCA+IDBcbiAgICAvLyBBIGZpbGUgcmVzcG9uc2Ugb25seSBldmVyIHNlcnZlcyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50YXRpb246IHdoZW5ldmVyXG4gICAgLy8gdGhlIGNsaWVudCBmb3JiaWRzIGlkZW50aXR5IChpbmNsdWRpbmcgdGhlIG5vdC1hY2NlcHRhYmxlIGNhc2Ugd2hlcmUgbm9cbiAgICAvLyBjb2RpbmcgYXBwbGllcykgYW5kIHRoZSBmaWxlIGRvZXMgbm90IGNhcnJ5IGFuIGFwcGxpY2F0aW9uLXN1cHBsaWVkXG4gICAgLy8gQ29udGVudC1FbmNvZGluZywgdGhlIGZpbGUgaXMgcmVqZWN0ZWQgd2l0aCB0aGUgZW1wdHkgNDA2LiBBIHRydWx5XG4gICAgLy8gYm9keWxlc3Mgc3RhdHVzIHNlbGVjdHMgbm8gcmVwcmVzZW50YXRpb24sIHNvIGl0IGlzIG5ldmVyIHJlamVjdGVkIGhlcmUuXG4gICAgY29uc3QgaXNGaWxlTm90QWNjZXB0YWJsZSA9IGhhc0ZpbGVQYXRoICYmICEhbmVnb3RpYXRlZCAmJiAoXCJub3RBY2NlcHRhYmxlXCIgaW4gbmVnb3RpYXRlZCB8fCBuZWdvdGlhdGVkLmlkZW50aXR5QWNjZXB0YWJsZSA9PT0gZmFsc2UpICYmIGhhc0FwcGxpY2F0aW9uQ29udGVudEVuY29kaW5nID09PSBmYWxzZSAmJiAhaXNCb2R5bGVzc1N0YXR1c1xuXG4gICAgaWYgKCFpc0JvZHlsZXNzU3RhdHVzKSB7XG4gICAgICBsZXQgY29udGVudExlbmd0aFxuXG4gICAgICBpZiAoaGFzRmlsZVBhdGgpIHtcbiAgICAgICAgaWYgKGlzRmlsZU5vdEFjY2VwdGFibGUpIHtcbiAgICAgICAgICAvLyBUaGUgY2xpZW50IGZvcmJpZHMgaWRlbnRpdHkgYW5kIGZpbGVzIGFyZSBvbmx5IGV2ZXIgc2VudCBpZGVudGl0eTpcbiAgICAgICAgICAvLyBhbnN3ZXIgd2l0aCB0aGUgc2FtZSBlbXB0eSA0MDYgZXZlcnkgb3RoZXIgcmVwcmVzZW50YXRpb24gcGF0aFxuICAgICAgICAgIC8vIHVzZXMuIFRoZSBmaWxlIGlzIG5ldmVyIG9wZW5lZCBvciBzdHJlYW1lZDsgb25GaW5pc2hlZCBpcyBzZXR0bGVkXG4gICAgICAgICAgLy8gYmVsb3csIGFmdGVyIHRoZSBjb21taXR0ZWQgNDA2IGhlYWRlcnMgYXJlIGVtaXR0ZWQuXG4gICAgICAgICAgcmVzcG9uc2Uuc2V0U3RhdHVzKDQwNilcbiAgICAgICAgICByZXNwb25zZS5zZXRCb2R5KFwiXCIpXG4gICAgICAgICAgYm9keVRvRW1pdCA9IFwiXCJcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gMFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aClcbiAgICAgICAgICBjb250ZW50TGVuZ3RoID0gc3RhdHMuc2l6ZVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTdHJpbmcgYm9kaWVzIGFyZSBVVEYtOCBmcmFtZWQsIHNvIHRoZSBidWZmZXJlZCBieXRlcyBhcmUgdGhlIFVURi04IGVuY29kaW5nO1xuICAgICAgICAvLyBVaW50OEFycmF5IGJvZGllcyBhcmUgYWxyZWFkeSB0aGUgZXhhY3Qgd2lyZSBieXRlcy5cbiAgICAgICAgY29uc3QgYm9keUJ1ZmZlciA9IGJvZHlJc1N0cmluZyA/IEJ1ZmZlci5mcm9tKGJvZHksIFwidXRmOFwiKSA6IEJ1ZmZlci5mcm9tKGJvZHkpXG4gICAgICAgIGNvbnN0IGNvbXByZXNzaW9uUmVzdWx0ID0gYXdhaXQgYXBwbHlSZXNwb25zZUNvbXByZXNzaW9uKHtcbiAgICAgICAgICBib2R5QnVmZmVyLFxuICAgICAgICAgIGNvbXByZXNzaW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0SHR0cFNlcnZlckNvbXByZXNzaW9uKCksXG4gICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICByZXNwb25zZVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChjb21wcmVzc2lvblJlc3VsdC5vdXRjb21lID09IFwibm90LWFjY2VwdGFibGVcIikge1xuICAgICAgICAgIC8vIFRoZSBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSBhbmQgbm8gc3VwcG9ydGVkIGNvZGluZyBpcyBhY2NlcHRhYmxlOiBhbnN3ZXJcbiAgICAgICAgICAvLyB3aXRoIGFuIGVtcHR5IDQwNiBpbnN0ZWFkIG9mIGFuIHVuYWNjZXB0YWJsZSByZXByZXNlbnRhdGlvbi5cbiAgICAgICAgICByZXNwb25zZS5zZXRTdGF0dXMoNDA2KVxuICAgICAgICAgIHJlc3BvbnNlLnNldEJvZHkoXCJcIilcbiAgICAgICAgICBib2R5VG9FbWl0ID0gXCJcIlxuICAgICAgICAgIGNvbnRlbnRMZW5ndGggPSAwXG4gICAgICAgIH0gZWxzZSBpZiAoY29tcHJlc3Npb25SZXN1bHQub3V0Y29tZSA9PSBcImNvbXByZXNzZWRcIikge1xuICAgICAgICAgIGJvZHlUb0VtaXQgPSBjb21wcmVzc2lvblJlc3VsdC5ib2R5XG4gICAgICAgICAgY29udGVudExlbmd0aCA9IGNvbXByZXNzaW9uUmVzdWx0LmJvZHkubGVuZ3RoXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29udGVudExlbmd0aCA9IGJvZHlCdWZmZXIubGVuZ3RoXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUmVtb3ZlIGFueSBhcHBsaWNhdGlvbiBwcmUtc2V0IENvbnRlbnQtTGVuZ3RoIChhbnkgY2FzaW5nKSBzbyBleGFjdGx5IG9uZVxuICAgICAgLy8gcmVjb21wdXRlZCB2YWx1ZSBnb2VzIG9uIHRoZSB3aXJlLlxuICAgICAgcmVzcG9uc2UucmVtb3ZlSGVhZGVyKFwiQ29udGVudC1MZW5ndGhcIilcbiAgICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkNvbnRlbnQtTGVuZ3RoXCIsIGNvbnRlbnRMZW5ndGgpXG4gICAgfVxuXG4gICAgLy8gRnJhbWV3b3JrLW93bmVkIFZhcnkgZGltZW5zaW9uOiB3aGVuZXZlciBjb21wcmVzc2lvbiBpcyBlbmFibGVkIGFuZCBhXG4gICAgLy8gcmVwcmVzZW50YXRpb24gd2FzIHNlbGVjdGVkLCB0aGUgcmVzcG9uc2UgZGVwZW5kcyBvbiBBY2NlcHQtRW5jb2RpbmcsXG4gICAgLy8gc28gY2FjaGVzIG11c3Qga2V5IG9uIGl0LiBBcHBsaWVkIGlkZW50aWNhbGx5IGZvciBldmVyeSBvdXRjb21lXG4gICAgLy8gKHRyYW5zZm9ybWVkLCBpZGVudGl0eSwgNDA2LCBmaWxlKSBhbmQgZm9yIGhlYWRlci1wcmVzZW50IGFuZFxuICAgIC8vIGhlYWRlci1hYnNlbnQgcmVxdWVzdHMgYWxpa2UsIHNvIHRoZSBoZWFkZXIgaXMgc3RhYmxlIGFjcm9zcyByZXF1ZXN0cyBvblxuICAgIC8vIHRoZSBzYW1lIGNvbm5lY3Rpb24uIEEgdHJ1bHkgYm9keWxlc3MgcmVzcG9uc2Ugc2VsZWN0cyBubyByZXByZXNlbnRhdGlvblxuICAgIC8vIGFuZCBjYXJyaWVzIG5vIGRpbWVuc2lvbjsgYW4gYXBwbGljYXRpb24tc3VwcGxpZWQgQ29udGVudC1FbmNvZGluZyBrZWVwc1xuICAgIC8vIHRoZSByZXByZXNlbnRhdGlvbiBjb250cmFjdCBhcHBsaWNhdGlvbi1vd25lZCBhbmQgaXMgbmV2ZXIgcmUtYWR2ZXJ0aXNlZC5cbiAgICBpZiAobmVnb3RpYXRlZCAmJiAhaXNCb2R5bGVzc1N0YXR1cyAmJiBoYXNBcHBsaWNhdGlvbkNvbnRlbnRFbmNvZGluZyA9PT0gZmFsc2UpIHtcbiAgICAgIGFkZEFjY2VwdEVuY29kaW5nVG9WYXJ5KHJlc3BvbnNlKVxuICAgIH1cblxuICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIkRhdGVcIiwgZGF0ZS50b1VUQ1N0cmluZygpKVxuICAgIHJlc3BvbnNlLnNldEhlYWRlcihcIlNlcnZlclwiLCBcIlZlbG9jaW91c1wiKVxuXG4gICAgbGV0IGhlYWRlcnMgPSBcIlwiXG5cbiAgICBoZWFkZXJzICs9IGBIVFRQLyR7cmVxdWVzdC5odHRwVmVyc2lvbigpfSAke3Jlc3BvbnNlLmdldFN0YXR1c0NvZGUoKX0gJHtyZXNwb25zZS5nZXRTdGF0dXNNZXNzYWdlKCl9XFxyXFxuYFxuXG4gICAgZm9yIChjb25zdCBoZWFkZXJLZXkgaW4gcmVzcG9uc2UuaGVhZGVycykge1xuICAgICAgZm9yIChjb25zdCBoZWFkZXJWYWx1ZSBvZiByZXNwb25zZS5oZWFkZXJzW2hlYWRlcktleV0pIHtcbiAgICAgICAgaGVhZGVycyArPSBgJHtoZWFkZXJLZXl9OiAke2hlYWRlclZhbHVlfVxcclxcbmBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBoZWFkZXJzICs9IFwiXFxyXFxuXCJcblxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgaGVhZGVycylcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgaGVhZGVycyBlbWl0dGVkXCIsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgaGVhZGVyc0xlbmd0aDogaGVhZGVycy5sZW5ndGh9XSlcblxuICAgIC8vIEEgbmVnb3RpYXRlZCBmaWxlIDQwNiBpcyBjb21taXR0ZWQgYWJvdmUgKHN0YXR1cyA0MDYsIGVtcHR5IGJvZHkpIGFuZCBpdHNcbiAgICAvLyBoZWFkZXJzIHdlcmUganVzdCBlbWl0dGVkOiBzZXR0bGUgb25GaW5pc2hlZCBub3csIHNvIHRoZSBjYWxsYmFjayBydW5zXG4gICAgLy8gYWZ0ZXIgdGhlIHJlc3BvbnNlIGlzIGNvbW1pdHRlZCDigJQgYSBzbG93IG9yIGFwcC1zdG9wcGluZyBjYWxsYmFjayBjYW5ub3RcbiAgICAvLyBkZWxheSBvciBibG9jayBkZWxpdmVyeSBvZiB0aGUgYWxyZWFkeS1lbWl0dGVkIDQwNi4gVGhlIGZpbGUgaXMgbmV2ZXJcbiAgICAvLyBvcGVuZWQsIHN0cmVhbWVkLCBvciByZXBvcnRlZCAobm8gZmlsZSBldmVudCksIGFuZCB0aGUgY2FsbGJhY2sgc2V0dGxlc1xuICAgIC8vIGV4YWN0bHkgb25jZSBhcyBcImNvbXBsZXRlZFwiLlxuICAgIGlmIChpc0ZpbGVOb3RBY2NlcHRhYmxlKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgZmlsZSBib2R5IHN1cHByZXNzZWQgZm9yIDQwNlwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRofV0pXG4gICAgICBhd2FpdCB0aGlzLnJ1bkZpbGVPbkZpbmlzaGVkKHtmaWxlUGF0aCwgb25GaW5pc2hlZDogZmlsZU9uRmluaXNoZWQsIHJlc3VsdDogXCJjb21wbGV0ZWRcIn0pXG4gICAgfSBlbHNlIGlmIChpc0JvZHlsZXNzU3RhdHVzKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgYm9keSBzdXBwcmVzc2VkIGZvciBuby1ib2R5IHN0YXR1c1wiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIHN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKX1dKVxuICAgICAgLy8gQSBib2R5bGVzcyBzdGF0dXMgKDF4eC8yMDQvMzA0KSBzZWxlY3RzIG5vIHJlcHJlc2VudGF0aW9uLCBzbyBubyBmaWxlXG4gICAgICAvLyBib2R5IG9yIGZyYW1ld29yayBWYXJ5IGlzIGVtaXR0ZWQuIFRoZSBmaWxlLW93bmVyc2hpcCBwYXRoIHN0aWxsIHNldHRsZXNcbiAgICAgIC8vIG9uRmluaXNoZWQgZXhhY3RseSBvbmNlIGFzIFwiY29tcGxldGVkXCIgKG5vdGhpbmcgd2FzIGFib3J0ZWQpIOKAlCBldmVuIHdoZW5cbiAgICAgIC8vIHRoZSBjbGllbnQgZm9yYmlkcyBpZGVudGl0eSDigJQgcHJlc2VydmluZyB0aGUgcHJlLWNoYW5nZSBzZXR0bGVtZW50LlxuICAgICAgaWYgKGhhc0ZpbGVQYXRoKSBhd2FpdCB0aGlzLnNlbmRGaWxlT3V0cHV0KGZpbGVQYXRoLCBmYWxzZSwgZmlsZU9uRmluaXNoZWQpXG4gICAgfSBlbHNlIGlmIChpc0hlYWRSZXF1ZXN0KSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJzZW5kUmVzcG9uc2UgYm9keSBzdXBwcmVzc2VkIGZvciBIRUFEIHJlcXVlc3RcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50fV0pXG4gICAgICBpZiAoaGFzRmlsZVBhdGgpIGF3YWl0IHRoaXMuc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIGZhbHNlLCBmaWxlT25GaW5pc2hlZClcbiAgICB9IGVsc2UgaWYgKGhhc0ZpbGVQYXRoKSB7XG4gICAgICBhd2FpdCB0aGlzLnNlbmRGaWxlT3V0cHV0KGZpbGVQYXRoLCB0cnVlLCBmaWxlT25GaW5pc2hlZClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBib2R5VG9FbWl0KVxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZFJlc3BvbnNlIGJvZHkgZW1pdHRlZFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGJvZHlMZW5ndGg6IGJvZHlUb0VtaXQgPyBib2R5VG9FbWl0Lmxlbmd0aCA6IDB9XSlcbiAgICB9XG5cbiAgICBhd2FpdCByZXF1ZXN0UnVubmVyLmxvZ0NvbXBsZXRlZFJlcXVlc3QoKVxuXG4gICAgaWYgKFwiZ2V0UmVxdWVzdFBhcnNlclwiIGluIHJlcXVlc3QpIHtcbiAgICAgIGNvbnN0IGh0dHBSZXF1ZXN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHJlcXVlc3QpXG4gICAgICBodHRwUmVxdWVzdC5nZXRSZXF1ZXN0UGFyc2VyKCkuZGVzdHJveSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmaWxlIG91dHB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHNlbmRCb2R5IC0gV2hldGhlciB0aGUgZmlsZSBib2R5IHNob3VsZCBiZSBzZW50LlxuICAgKiBAcGFyYW0geygocmVzdWx0OiBcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCIpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IG51bGx9IG9uRmluaXNoZWQgLSBDb21wbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2VuZEZpbGVPdXRwdXQoZmlsZVBhdGgsIHNlbmRCb2R5LCBvbkZpbmlzaGVkKSB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wic2VuZEZpbGVPdXRwdXQgc3RhcnRcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBmaWxlUGF0aH1dKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgICBsZXQgc2V0dGxlbWVudCA9IG51bGxcbiAgICAgIGNvbnN0IHNldHRsZSA9ICgvKiogQHR5cGUge1wiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIn0gKi8gdHJhbnNmZXJSZXN1bHQpID0+IHtcbiAgICAgICAgaWYgKHNldHRsZW1lbnQpIHJldHVybiBzZXR0bGVtZW50XG5cbiAgICAgICAgdGhpcy5wZW5kaW5nRmlsZVJlc3BvbnNlcy5kZWxldGUoc2V0dGxlKVxuICAgICAgICBzZXR0bGVtZW50ID0gdGhpcy5ydW5GaWxlT25GaW5pc2hlZCh7ZmlsZVBhdGgsIG9uRmluaXNoZWQsIHJlc3VsdDogdHJhbnNmZXJSZXN1bHR9KVxuICAgICAgICAgIC5maW5hbGx5KCgpID0+IHJlc29sdmUodHJhbnNmZXJSZXN1bHQpKVxuXG4gICAgICAgIHJldHVybiBzZXR0bGVtZW50XG4gICAgICB9XG5cbiAgICAgIHRoaXMucGVuZGluZ0ZpbGVSZXNwb25zZXMuYWRkKHNldHRsZSlcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJmaWxlXCIsIHtmaWxlUGF0aCwgc2VuZEJvZHksIHNldHRsZX0pXG4gICAgfSlcblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcInNlbmRGaWxlT3V0cHV0IGRvbmVcIiwge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBmaWxlUGF0aCwgcmVzdWx0fV0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGZpbGUgY29tcGxldGlvbiBjYWxsYmFjayB3aXRob3V0IGFsbG93aW5nIGNsZWFudXAgZmFpbHVyZXMgdG8gcmVwbGFjZSB0aGUgY29tbWl0dGVkIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbXBsZXRpb24gZGV0YWlscy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7KChyZXN1bHQ6IFwiY29tcGxldGVkXCIgfCBcImFib3J0ZWRcIikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gYXJncy5vbkZpbmlzaGVkIC0gQ29tcGxldGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJhYm9ydGVkXCJ9IGFyZ3MucmVzdWx0IC0gVHJhbnNmZXIgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjYWxsYmFjayBjbGVhbnVwIGFuZCBlcnJvciByZXBvcnRpbmcgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcnVuRmlsZU9uRmluaXNoZWQoe2ZpbGVQYXRoLCBvbkZpbmlzaGVkLCByZXN1bHR9KSB7XG4gICAgaWYgKCFvbkZpbmlzaGVkKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBvbkZpbmlzaGVkKHJlc3VsdClcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSBlbnN1cmVFcnJvcihjYXVnaHRFcnJvcilcblxuICAgICAgYXdhaXQgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmlsZSByZXNwb25zZSBvbkZpbmlzaGVkIGNhbGxiYWNrIGZhaWxlZFwiLCB7Y2xpZW50Q291bnQ6IHRoaXMuY2xpZW50Q291bnQsIGZpbGVQYXRoLCByZXN1bHR9LCBlcnJvcl0pXG5cbiAgICAgIGNvbnN0IGVycm9yUGF5bG9hZCA9IHtcbiAgICAgICAgY29udGV4dDoge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBmaWxlUGF0aCwgcmVzdWx0LCBzdGFnZTogXCJzZW5kLWZpbGUtb24tZmluaXNoZWRcIn0sXG4gICAgICAgIGVycm9yXG4gICAgICB9XG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImFsbC1lcnJvclwiLCB7Li4uZXJyb3JQYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBYm9ydHMgYWxsIGZpbGUgcmVzcG9uc2VzIGF3YWl0aW5nIHRyYW5zcG9ydCBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlbmRpbmcgY2FsbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIGFib3J0UGVuZGluZ0ZpbGVSZXNwb25zZXMoKSB7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoWy4uLnRoaXMucGVuZGluZ0ZpbGVSZXNwb25zZXNdLm1hcCgoc2V0dGxlKSA9PiBzZXR0bGUoXCJhYm9ydGVkXCIpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTaW5rIHRoZSBvd25pbmcgd29ya2VyIGhhbmRsZXIgd2lyZXMgaW4gZm9yIHN0cmVhbSBvdXRwdXQuIFRoZVxuICAgKiBpbi1wcm9jZXNzIGhhbmRsZXIgcmVzb2x2ZXMgaXQgYWZ0ZXIgdGhlIGZyYW1lZCBvdXRwdXQgaGFzIGJlZW4gZW5xdWV1ZWRcbiAgICogZm9yIGRlbGl2ZXJ5IHRvIHRoZSBzb2NrZXQsIHNvIHN0cmVhbSBjaHVua3Mgc2hhcmUgdGhlIGJvdW5kZWQsIG9yZGVyZWRcbiAgICogZGVsaXZlcnkgcGF0aCAoYnl0ZS9mcmFtZSBsaW1pdHMgYW5kIHNvY2tldCBiYWNrcHJlc3N1cmUpIGluc3RlYWQgb2ZcbiAgICogYmVpbmcgYnVmZmVyZWQgdW5ib3VuZGVkbHkgZm9yIGEgc3RhbGxlZCBjbGllbnQuIFRoZSB3b3JrZXItdGhyZWFkXG4gICAqIGhhbmRsZXIga2VlcHMgbnVsbDogaXRzIG91dHB1dCBjcm9zc2VzIHRvIHRoZSBwYXJlbnQgb3ZlciBJUEMgYW5kIG5vXG4gICAqIHBlci1jaHVuayBhY2tub3dsZWRnZW1lbnQgaXMgYXZhaWxhYmxlLlxuICAgKiBAdHlwZSB7KChvdXRwdXQ6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAqL1xuICBzdHJlYW1PdXRwdXRTaW5rID0gbnVsbFxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSByZXNwb25zZSB0byB0aGUgZG9jdW1lbnRlZCBzdHJlYW1pbmcgdHJhbnNwb3J0IHNoYXBlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gcmVzcG9uc2UgLSBSZXNwb25zZSB0byBzdHJlYW0uXG4gICAqIEByZXR1cm5zIHt7c3RyZWFtaW5nOiBib29sZWFuLCBzdHJlYW1FbmRlZDogYm9vbGVhbiwgc3RyZWFtQWJvcnRlZDogYm9vbGVhbiwgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+LCBnZXRTdGF0dXNDb2RlOiAoKSA9PiBudW1iZXIsIGdldFN0YXR1c01lc3NhZ2U6ICgpID0+IHN0cmluZywgc3RyZWFtQ2xvc2VDYWxsYmFja3M6IFNldDwoKSA9PiB2b2lkPn19IC0gU3RyZWFtaW5nIHZpZXcgb2YgdGhlIHJlc3BvbnNlLlxuICAgKi9cbiAgX3N0cmVhbWluZ1Jlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgcmV0dXJuIHJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGEgbGl2ZSBjaHVua2VkIHN0cmVhbSBmb3IgYSBzb2NrZXQtYm91bmQgcmVzcG9uc2U6IGVtaXRzIHRoZVxuICAgKiBzdGF0dXMgbGluZSBhbmQgaGVhZGVycyAod2l0aCBgVHJhbnNmZXItRW5jb2Rpbmc6IGNodW5rZWRgKSB0byB0aGVcbiAgICogY2xpZW50IGltbWVkaWF0ZWx5IHNvIHN1YnNlcXVlbnQgYHdyaXRlKClgIGNodW5rcyByZWFjaCB0aGUgY2xpZW50IGFzXG4gICAqIHRoZXkgYXJlIHByb2R1Y2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gcmVzcG9uc2UgLSBSZXNwb25zZSB0byBzdHJlYW0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IHJlcXVlc3QgLSBTb2NrZXQtYm91bmQgcmVxdWVzdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYmVnaW5TdHJlYW1SZXNwb25zZShyZXNwb25zZSwgcmVxdWVzdCkge1xuICAgIHRoaXMuX2FjdGl2ZVN0cmVhbVJlc3BvbnNlcy5zZXQocmVzcG9uc2UsIHtjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCwgcmVxdWVzdH0pXG5cbiAgICBjb25zdCBodHRwVmVyc2lvbiA9IHJlcXVlc3QuaHR0cFZlcnNpb24oKVxuXG4gICAgLy8gSFRUUC8xLjAgaGFzIG5vIGNodW5rZWQgdHJhbnNmZXIgZW5jb2Rpbmc6IHRlcm1pbmF0ZSB0aGUgc3RyZWFtIHdpdGggYVxuICAgIC8vIGNvbm5lY3Rpb24gY2xvc2UgaW5zdGVhZCBvZiBhIHplcm8tbGVuZ3RoIGNodW5rLlxuICAgIGlmIChodHRwVmVyc2lvbiA9PSBcIjEuMFwiICYmICF0aGlzLnNob3VsZENsb3NlQ29ubmVjdGlvbihyZXF1ZXN0KSkge1xuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ29ubmVjdGlvblwiLCBcIkNsb3NlXCIpXG4gICAgfVxuXG4gICAgLy8gVGhlIGNodW5rZWQgZnJhbWluZyBvd25zIHRoZSBib2R5IGxlbmd0aDsgYSBDb250ZW50LUxlbmd0aCBoZWFkZXIgc2V0XG4gICAgLy8gYnkgdGhlIGFwcGxpY2F0aW9uIGJlZm9yZSBzdHJlYW0oKSB3b3VsZCBkZXN5bmNocm9uaXplIHRoZSBmcmFtaW5nLlxuICAgIHJlc3BvbnNlLnJlbW92ZUhlYWRlcihcIkNvbnRlbnQtTGVuZ3RoXCIpXG4gICAgaWYgKHJlc3BvbnNlLmdldEhlYWRlcihcIlRyYW5zZmVyLUVuY29kaW5nXCIpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiVHJhbnNmZXItRW5jb2RpbmdcIiwgXCJjaHVua2VkXCIpXG4gICAgfVxuXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiRGF0ZVwiLCBuZXcgRGF0ZSgpLnRvVVRDU3RyaW5nKCkpXG4gICAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiU2VydmVyXCIsIFwiVmVsb2Npb3VzXCIpXG5cbiAgICBjb25zdCByZXNwb25zZVZpZXcgPSB0aGlzLl9zdHJlYW1pbmdSZXNwb25zZShyZXNwb25zZSlcbiAgICBsZXQgaGVhZGVycyA9IFwiXCJcbiAgICBoZWFkZXJzICs9IGBIVFRQLyR7aHR0cFZlcnNpb259ICR7cmVzcG9uc2VWaWV3LmdldFN0YXR1c0NvZGUoKX0gJHtyZXNwb25zZVZpZXcuZ2V0U3RhdHVzTWVzc2FnZSgpfVxcclxcbmBcblxuICAgIGZvciAoY29uc3QgaGVhZGVyS2V5IGluIHJlc3BvbnNlVmlldy5oZWFkZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IGhlYWRlclZhbHVlIG9mIHJlc3BvbnNlVmlldy5oZWFkZXJzW2hlYWRlcktleV0pIHtcbiAgICAgICAgaGVhZGVycyArPSBgJHtoZWFkZXJLZXl9OiAke2hlYWRlclZhbHVlfVxcclxcbmBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBoZWFkZXJzICs9IFwiXFxyXFxuXCJcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGhlYWRlcnMpXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgb25lIGNodW5rZWQtZW5jb2RlZCBib2R5IGNodW5rIGZvciBhbiBhY3RpdmUgc3RyZWFtLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IFVpbnQ4QXJyYXl9IGNodW5rIC0gQ2h1bmsgdG8gZW1pdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2V0dGxlcyBhZnRlciB0aGUgY2h1bmsgaGFzIGJlZW4gZGVsaXZlcmVkIHRvXG4gICAqIHRoZSBjbGllbnQuXG4gICAqL1xuICBhc3luYyB3cml0ZVN0cmVhbUNodW5rKGNodW5rKSB7XG4gICAgY29uc3QgYnl0ZXMgPSB0eXBlb2YgY2h1bmsgPT09IFwic3RyaW5nXCIgPyBCdWZmZXIuZnJvbShjaHVuaywgXCJ1dGY4XCIpIDogQnVmZmVyLmZyb20oY2h1bmspXG4gICAgY29uc3QgZnJhbWUgPSBgJHtieXRlcy5sZW5ndGgudG9TdHJpbmcoMTYpfVxcclxcbiR7Ynl0ZXN9XFxyXFxuYFxuICAgIGlmICh0aGlzLnN0cmVhbU91dHB1dFNpbmsgPT09IG51bGwpIHtcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgZnJhbWUpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgYXdhaXQgdGhpcy5zdHJlYW1PdXRwdXRTaW5rKGZyYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIHRoZSB6ZXJvLWxlbmd0aCBjaHVua2VkIHRlcm1pbmF0b3IgZm9yIGEgc3RyZWFtIHRoYXQgZmluaXNoZWQgb24gYVxuICAgKiBsaXZlIGNvbm5lY3Rpb24sIHRoZW4gcnVucyBpdHMgY2xvc2UgY2FsbGJhY2tzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gcmVzcG9uc2UgLSBSZXNwb25zZSB0byBmaW5pc2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNldHRsZXMgYWZ0ZXIgdGhlIHRlcm1pbmF0b3Igd2FzIGRlbGl2ZXJlZCBhbmRcbiAgICogdGhlIGNsb3NlIGNhbGxiYWNrcyByYW4uXG4gICAqL1xuICBhc3luYyBlbmRTdHJlYW1SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZS5zdHJlYW1FbmRlZCkgcmV0dXJuXG4gICAgcmVzcG9uc2Uuc3RyZWFtRW5kZWQgPSB0cnVlXG4gICAgdGhpcy5fYWN0aXZlU3RyZWFtUmVzcG9uc2VzLmRlbGV0ZShyZXNwb25zZSlcbiAgICBpZiAodGhpcy5zdHJlYW1PdXRwdXRTaW5rID09PSBudWxsKSB7XG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIFwiMFxcclxcblxcclxcblwiKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnN0cmVhbU91dHB1dFNpbmsoXCIwXFxyXFxuXFxyXFxuXCIpXG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3J1blN0cmVhbUNsb3NlQ2FsbGJhY2tzKHJlc3BvbnNlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFib3J0cyBldmVyeSBzdHJlYW0gd2hvc2UgY2xpZW50IGNvbm5lY3Rpb24gd2VudCBhd2F5OiBtYXJrcyB0aGUgc3RyZWFtXG4gICAqIGFib3J0ZWQgYW5kIHJ1bnMgdGhlIGNsb3NlIGNhbGxiYWNrcyBzbyBpbi1mbGlnaHQgd29yayBjYW4gc2V0dGxlIGl0c1xuICAgKiByZXNvdXJjZXMuIE5vIHRlcm1pbmF0b3IgaXMgZW1pdHRlZCDigJQgdGhlIGNvbm5lY3Rpb24gaXMgYWxyZWFkeSBnb25lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBzdHJlYW0gc2V0dGxlZC5cbiAgICovXG4gIGFzeW5jIGFib3J0U3RyZWFtUmVzcG9uc2VzKCkge1xuICAgIGZvciAoY29uc3QgcmVzcG9uc2Ugb2YgWy4uLnRoaXMuX2FjdGl2ZVN0cmVhbVJlc3BvbnNlcy5rZXlzKCldKSB7XG4gICAgICBpZiAocmVzcG9uc2Uuc3RyZWFtQWJvcnRlZCkgY29udGludWVcbiAgICAgIHJlc3BvbnNlLnN0cmVhbUFib3J0ZWQgPSB0cnVlXG4gICAgICB0aGlzLl9hY3RpdmVTdHJlYW1SZXNwb25zZXMuZGVsZXRlKHJlc3BvbnNlKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuU3RyZWFtQ2xvc2VDYWxsYmFja3MocmVzcG9uc2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNsb3NlIGNhbGxiYWNrcyBvZiBhIGZpbmlzaGVkIG9yIGFib3J0ZWQgc3RyZWFtIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IHJlc3BvbnNlIC0gRmluaXNoZWQgc3RyZWFtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjYWxsYmFjayByYW4uXG4gICAqL1xuICBhc3luYyBfcnVuU3RyZWFtQ2xvc2VDYWxsYmFja3MocmVzcG9uc2UpIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RyZWFtQ2xvc2VDYWxsYmFja3Muc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIHJlc3BvbnNlLnN0cmVhbUNsb3NlQ2FsbGJhY2tzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjYWxsYmFjaygpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBlcnJvclBheWxvYWQgPSB7XG4gICAgICAgICAgY29udGV4dDoge2NsaWVudENvdW50OiB0aGlzLmNsaWVudENvdW50LCBzdGFnZTogXCJzdHJlYW0tY2xvc2UtY2FsbGJhY2tcIn0sXG4gICAgICAgICAgZXJyb3JcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIGVycm9yUGF5bG9hZClcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImFsbC1lcnJvclwiLCB7Li4uZXJyb3JQYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgICAgfVxuICAgIH1cbiAgICByZXNwb25zZS5zdHJlYW1DbG9zZUNhbGxiYWNrcy5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgY2xvc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gcmVxdWVzdCAtIFJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIHNob3VsZCBiZSBjbG9zZWQuXG4gICAqL1xuICBzaG91bGRDbG9zZUNvbm5lY3Rpb24ocmVxdWVzdCkge1xuICAgIGNvbnN0IGh0dHBWZXJzaW9uID0gcmVxdWVzdC5odHRwVmVyc2lvbigpXG4gICAgY29uc3QgY29ubmVjdGlvbkhlYWRlciA9IHJlcXVlc3QuaGVhZGVyKFwiY29ubmVjdGlvblwiKT8udG9Mb3dlckNhc2UoKT8udHJpbSgpXG4gICAgY29uc3QgY29ubmVjdGlvblRva2VucyA9IGNvbm5lY3Rpb25IZWFkZXJcbiAgICAgID8gY29ubmVjdGlvbkhlYWRlci5zcGxpdChcIixcIikubWFwKCh0b2tlbikgPT4gdG9rZW4udHJpbSgpKS5maWx0ZXIoQm9vbGVhbilcbiAgICAgIDogW11cblxuICAgIGlmIChodHRwVmVyc2lvbiA9PSBcIndlYnNvY2tldFwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoY29ubmVjdGlvblRva2Vucy5pbmNsdWRlcyhcImNsb3NlXCIpKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKGh0dHBWZXJzaW9uID09IFwiMS4wXCIgJiYgY29ubmVjdGlvbkhlYWRlciAhPSBcImtlZXAtYWxpdmVcIikgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGZvciB0aGUgc3RhdHVzIGNvZGVzIHRoYXQgUkZDIDcyMzAgwqczLjMuMyBkZWNsYXJlc1xuICogY2Fubm90IGNhcnJ5IGEgbWVzc2FnZSBib2R5OiBldmVyeSAxeHggaW5mb3JtYXRpb25hbCwgMjA0IE5vXG4gKiBDb250ZW50LCBhbmQgMzA0IE5vdCBNb2RpZmllZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBzdGF0dXNDb2RlIC0gSFRUUCBzdGF0dXMgY29kZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHN0YXR1cyBjb2RlIGZvcmJpZHMgYSByZXNwb25zZSBib2R5LlxuICovXG5mdW5jdGlvbiBpc05vQm9keVN0YXR1c0NvZGUoc3RhdHVzQ29kZSkge1xuICByZXR1cm4gKHN0YXR1c0NvZGUgPj0gMTAwICYmIHN0YXR1c0NvZGUgPCAyMDApIHx8IHN0YXR1c0NvZGUgPT09IDIwNCB8fCBzdGF0dXNDb2RlID09PSAzMDRcbn1cbiJdfQ==