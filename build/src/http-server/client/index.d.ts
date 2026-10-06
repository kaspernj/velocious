import Logger from "../../logger.js";
import Request from "./request.js";
import RequestRunner from "./request-runner.js";
import WebsocketSession from "./websocket-session.js";
export default class VeoliciousHttpServerClient {
    logger: Logger;
    clientCount: number;
    configuration: import("../../configuration.js").default;
    remoteAddress: string | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {RequestRunner[]} */
    requestRunners: RequestRunner[];
    /** @type {Set<(result: "completed" | "aborted") => Promise<void>>} */
    pendingFileResponses: Set<(result: "completed" | "aborted") => Promise<void>>;
    /**
     * Streams that have started but have not finished or been aborted yet.
     * @type {Map<import("./response.js").default, {clientCount: number, request: import("./request.js").default}>} */
    _activeStreamResponses: Map<import("./response.js").default, {
        clientCount: number;
        request: import("./request.js").default;
    }>;
    currentRequest: Request | undefined;
    websocketSession: WebsocketSession | undefined;
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    state: string;
    /**
     * Whether a done-requests drain is currently sending responses for this client.
     * @type {boolean} */
    _doneRequestsDrainActive: boolean;
    /**
     * Whether another drain was requested while one was already active.
     * @type {boolean} */
    _doneRequestsDrainPending: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {number} args.clientCount - Client count.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} [args.remoteAddress] - Remote address.
     */
    constructor({ clientCount, configuration, remoteAddress }: {
        clientCount: number;
        configuration: import("../../configuration.js").default;
        remoteAddress?: string;
    });
    /**
     * Runs send bad upgrade response.
     * @param {string} message - Message text.
     * @returns {void} - No return value.
     */
    _sendBadUpgradeResponse(message: string): void;
    /**
     * Runs send bad request response.
     * @param {string} message - Response message.
     * @returns {void} - No return value.
     */
    _sendBadRequestResponse(message: string): void;
    /**
     * Sends a deterministic request-body limit response and closes the connection.
     * @returns {void} - No return value.
     */
    _sendPayloadTooLargeResponse(): void;
    /**
     * Runs handle bad request.
     * @param {Error} error - Error instance.
     * @returns {void} - No return value.
     */
    handleBadRequest(error: Error): void;
    executeCurrentRequest: () => void;
    /**
     * Runs on write.
     * @param {Buffer} data - Data payload.
     * @returns {void} - No return value.
     */
    onWrite(data: Buffer): void;
    /**
     * Runs is websocket upgrade.
     * @param {import("./request.js").default} request - Request object.
     * @returns {boolean} - Whether websocket upgrade.
     */
    _isWebsocketUpgrade(request: import("./request.js").default): boolean;
    /**
     * Runs upgrade to websocket.
     * @returns {void} - No return value.
     */
    _upgradeToWebsocket(): void;
    requestDone: () => Promise<void>;
    /**
     * Drains done requests one at a time. A runner is shifted out of the queue before
     * its response finishes sending (async compression, file transfer), so an
     * overlapping drain would otherwise pick up the next runner and reorder pipelined
     * socket writes. Calls that arrive while a drain is active are folded into it.
     * @returns {Promise<void>} - Resolves when every done response has been sent.
     */
    _drainDoneRequests(): Promise<void>;
    sendDoneRequests(): Promise<void>;
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
    sendResponse(requestRunner: RequestRunner): Promise<void>;
    /**
     * Runs send file output.
     * @param {string} filePath - File path.
     * @param {boolean} sendBody - Whether the file body should be sent.
     * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} onFinished - Completion callback.
     * @returns {Promise<void>} - Resolves when complete.
     */
    sendFileOutput(filePath: string, sendBody: boolean, onFinished: ((result: "completed" | "aborted") => void | Promise<void>) | null): Promise<void>;
    /**
     * Runs a file completion callback without allowing cleanup failures to replace the committed response.
     * @param {object} args - Completion details.
     * @param {string} args.filePath - File path.
     * @param {((result: "completed" | "aborted") => void | Promise<void>) | null} args.onFinished - Completion callback.
     * @param {"completed" | "aborted"} args.result - Transfer result.
     * @returns {Promise<void>} - Resolves after callback cleanup and error reporting finish.
     */
    runFileOnFinished({ filePath, onFinished, result }: {
        filePath: string;
        onFinished: ((result: "completed" | "aborted") => void | Promise<void>) | null;
        result: "completed" | "aborted";
    }): Promise<void>;
    /**
     * Aborts all file responses awaiting transport acknowledgement.
     * @returns {Promise<void>} - Resolves after pending callbacks settle.
     */
    abortPendingFileResponses(): Promise<void>;
    /**
     * Sink the owning worker handler wires in for stream output. The
     * in-process handler resolves it after the framed output has been enqueued
     * for delivery to the socket, so stream chunks share the bounded, ordered
     * delivery path (byte/frame limits and socket backpressure) instead of
     * being buffered unboundedly for a stalled client. The worker-thread
     * handler keeps null: its output crosses to the parent over IPC and no
     * per-chunk acknowledgement is available.
     * @type {((output: string) => Promise<void>) | null} */
    streamOutputSink: ((output: string) => Promise<void>) | null;
    /**
     * Narrows the response to the documented streaming transport shape.
     * @param {import("./response.js").default} response - Response to stream.
     * @returns {{streaming: boolean, streamEnded: boolean, streamAborted: boolean, headers: Record<string, string[]>, getStatusCode: () => number, getStatusMessage: () => string, streamCloseCallbacks: Set<() => void>}} - Streaming view of the response.
     */
    _streamingResponse(response: import("./response.js").default): {
        streaming: boolean;
        streamEnded: boolean;
        streamAborted: boolean;
        headers: Record<string, string[]>;
        getStatusCode: () => number;
        getStatusMessage: () => string;
        streamCloseCallbacks: Set<() => void>;
    };
    /**
     * Starts a live chunked stream for a socket-bound response: emits the
     * status line and headers (with `Transfer-Encoding: chunked`) to the
     * client immediately so subsequent `write()` chunks reach the client as
     * they are produced.
     * @param {import("./response.js").default} response - Response to stream.
     * @param {import("./request.js").default} request - Socket-bound request.
     * @returns {void} - No return value.
     */
    beginStreamResponse(response: import("./response.js").default, request: import("./request.js").default): void;
    /**
     * Emits one chunked-encoded body chunk for an active stream.
     * @param {string | Uint8Array} chunk - Chunk to emit.
     * @returns {Promise<void>} - Settles after the chunk has been delivered to
     * the client.
     */
    writeStreamChunk(chunk: string | Uint8Array): Promise<void>;
    /**
     * Emits the zero-length chunked terminator for a stream that finished on a
     * live connection, then runs its close callbacks.
     * @param {import("./response.js").default} response - Response to finish.
     * @returns {Promise<void>} - Settles after the terminator was delivered and
     * the close callbacks ran.
     */
    endStreamResponse(response: import("./response.js").default): Promise<void>;
    /**
     * Aborts every stream whose client connection went away: marks the stream
     * aborted and runs the close callbacks so in-flight work can settle its
     * resources. No terminator is emitted — the connection is already gone.
     * @returns {Promise<void>} - Resolves after every stream settled.
     */
    abortStreamResponses(): Promise<void>;
    /**
     * Runs the close callbacks of a finished or aborted stream exactly once.
     * @param {import("./response.js").default} response - Finished stream.
     * @returns {Promise<void>} - Resolves after every callback ran.
     */
    _runStreamCloseCallbacks(response: import("./response.js").default): Promise<void>;
    /**
     * Runs should close connection.
     * @param {import("./request.js").default | import("./websocket-request.js").default} request - Request object.
     * @returns {boolean} - Whether the connection should be closed.
     */
    shouldCloseConnection(request: import("./request.js").default | import("./websocket-request.js").default): boolean;
}
//# sourceMappingURL=index.d.ts.map