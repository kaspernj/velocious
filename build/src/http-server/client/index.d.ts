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
     * Runs send response.
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
     * Runs should close connection.
     * @param {import("./request.js").default | import("./websocket-request.js").default} request - Request object.
     * @returns {boolean} - Whether the connection should be closed.
     */
    shouldCloseConnection(request: import("./request.js").default | import("./websocket-request.js").default): boolean;
}
//# sourceMappingURL=index.d.ts.map