import Logger from "../logger.js";
export default class ServerClient {
    configuration: import("../configuration.js").default;
    logger: Logger;
    socket: import("node:net").Socket;
    clientCount: number;
    remoteAddress: string | undefined;
    closeEmitted: boolean;
    worker: import("node:worker_threads").Worker | undefined;
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("net").Socket} args.socket - Socket instance.
     * @param {number} args.clientCount - Client count.
     */
    constructor({ configuration, socket, clientCount }: {
        configuration: import("../configuration.js").default;
        socket: import("net").Socket;
        clientCount: number;
    });
    /**
     * Runs listen.
     * @returns {void} - No return value.
     */
    listen(): void;
    /**
     * Runs end.
     * @returns {Promise<void>} - Resolves when complete.
     */
    end(): Promise<void>;
    /**
     * Immediately destroys the socket and all transport-owned write buffers.
     * @param {Error} error - Destruction reason.
     * @returns {void}
     */
    destroy(error: Error): void;
    /**
     * On socket data.
     * @param {Buffer} chunk - Chunk.
     * @returns {void} - No return value.
     */
    onSocketData: (chunk: Buffer) => void;
    /**
     * On socket end.
     * @returns {void} - No return value.
     */
    onSocketEnd: () => void;
    /**
     * On socket close.
     * @returns {void} - No return value.
     */
    onSocketClose: () => void;
    /**
     * On socket timeout.
     * @returns {void} - No return value.
     */
    onSocketTimeout: () => void;
    /**
     * On socket drain.
     * @returns {void} - No return value.
     */
    onSocketDrain: () => void;
    /**
     * On socket finish.
     * @returns {void} - No return value.
     */
    onSocketFinish: () => void;
    /**
     * On socket error.
     * @param {Error} error - Socket error.
     * @returns {void} - No return value.
     */
    onSocketError: (error: Error) => void;
    /**
     * Runs emit close.
     * @returns {void} - No return value.
     */
    emitClose(): void;
    /**
     * Runs send.
     * @param {string | Uint8Array} data - Data payload.
     * @returns {Promise<void>} - Resolves when complete.
     */
    send(data: string | Uint8Array): Promise<void>;
    /**
     * Streams a file to the socket while respecting socket write backpressure.
     * @param {string} filePath - File path.
     * @param {boolean} [sendBody] - Whether to read and send the file body.
     * @returns {Promise<"completed" | "aborted">} - Transfer result.
     */
    sendFile(filePath: string, sendBody?: boolean): Promise<"completed" | "aborted">;
    /**
     * Writes one file chunk and waits for both write acceptance and drain when required.
     * @param {Buffer | Uint8Array} chunk - File chunk.
     * @returns {Promise<boolean>} - Whether the chunk was accepted before the socket aborted.
     */
    writeFileChunk(chunk: Buffer | Uint8Array): Promise<boolean>;
    /**
     * Runs set worker.
     * @param {import("worker_threads").Worker} newWorker - New worker.
     * @returns {void} - No return value.
     */
    setWorker(newWorker: import("worker_threads").Worker): void;
}
//# sourceMappingURL=server-client.d.ts.map