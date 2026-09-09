import Application from "../../application.js";
import Client from "../client/index.js";
import Logger from "../../logger.js";
import WebsocketEvents from "../websocket-events.js";
export default class VelociousHttpServerWorkerHandlerWorkerThread {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, Client>} */
    clients: Record<number, Client>;
    logger: Logger;
    parentPort: import("node:worker_threads").MessagePort;
    workerData: {
        debug: boolean;
        directory: string;
        environment: string;
        workerCount: number;
    };
    workerCount: number;
    fileTransferCount: number;
    /** @type {Map<number, {clientCount: number, settle: (result: "completed" | "aborted") => Promise<void>}>} */
    fileTransfers: Map<number, {
        clientCount: number;
        settle: (result: "completed" | "aborted") => Promise<void>;
    }>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../../configuration.js").default} */
    configuration: import("../../configuration.js").default;
    websocketEvents: WebsocketEvents | undefined;
    application: Application | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("node:worker_threads").MessagePort | null} args.parentPort - Parent port.
     * @param {{debug: boolean, directory: string, environment: string, workerCount: number}} args.workerData - Worker configuration details.
     */
    constructor({ parentPort, workerData }: {
        parentPort: import("node:worker_threads").MessagePort | null;
        workerData: {
            debug: boolean;
            directory: string;
            environment: string;
            workerCount: number;
        };
    });
    /**
     * Runs initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initialize(): Promise<void>;
    /**
     * On command.
     * @param {object} data - Data payload.
     * @param {string} data.command - Command.
     * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
     * @param {string} [data.remoteAddress] - Remote address.
     * @param {number} [data.clientCount] - Client count.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.createdAt] - Event creation time.
     * @param {string} [data.eventId] - Event identifier.
     * @param {number} [data.requestId] - Debug request id.
     * @param {number} [data.transferId] - File transfer id.
     * @param {"completed" | "aborted"} [data.result] - File transfer result.
     * @param {ReturnType<typeof JSON.parse>} [data.payload] - Payload data.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [data.broadcastParams] - V2 broadcast filter params.
     * @param {ReturnType<typeof JSON.parse>} [data.body] - V2 broadcast body.
     */
    onCommand: (data: {
        command: string;
        chunk?: Buffer | Uint8Array | string;
        remoteAddress?: string;
        clientCount?: number;
        channel?: string;
        createdAt?: string;
        eventId?: string;
        requestId?: number;
        transferId?: number;
        result?: "completed" | "aborted";
        payload?: ReturnType<typeof JSON.parse>;
        broadcastParams?: Record<string, ReturnType<typeof JSON.parse>>;
        body?: ReturnType<typeof JSON.parse>;
    }) => Promise<void>;
    /**
     * Runs handle new client.
     * @param {object} data - Data payload.
     * @param {number} [data.clientCount] - Client count.
     * @param {string} [data.remoteAddress] - Remote address.
     * @returns {void}
     */
    handleNewClient(data: {
        clientCount?: number;
        remoteAddress?: string;
    }): void;
    /**
     * Settles a file response after the parent finishes socket delivery.
     * @param {object} data - File result message.
     * @param {number} [data.transferId] - File transfer id.
     * @param {"completed" | "aborted"} [data.result] - File transfer result.
     * @returns {Promise<void>} - Resolves after the worker-side completion callback settles.
     */
    handleClientFileResult(data: {
        transferId?: number;
        result?: "completed" | "aborted";
    }): Promise<void>;
    /**
     * Aborts file responses belonging to a closed parent-side socket.
     * @param {object} data - Client abort message.
     * @param {number} [data.clientCount] - Client count.
     * @returns {Promise<void>} - Resolves after pending completion callbacks settle.
     */
    handleClientAbort(data: {
        clientCount?: number;
    }): Promise<void>;
    /**
     * Runs handle client write.
     * @param {object} data - Data payload.
     * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
     * @param {number} [data.clientCount] - Client count.
     * @returns {Promise<void>} Resolves when the client write is dispatched.
     */
    handleClientWrite(data: {
        chunk?: Buffer | Uint8Array | string;
        clientCount?: number;
    }): Promise<void>;
    /**
     * Runs handle websocket event.
     * @param {object} data - Data payload.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.createdAt] - Event creation time.
     * @param {string} [data.eventId] - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} [data.payload] - Payload data.
     * @returns {Promise<void>} Resolves when the websocket event is dispatched.
     */
    handleWebsocketEvent(data: {
        channel?: string;
        createdAt?: string;
        eventId?: string;
        payload?: ReturnType<typeof JSON.parse>;
    }): Promise<void>;
    /**
     * Runs handle websocket v2 broadcast.
     * @param {object} data - Data payload.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [data.broadcastParams] - V2 broadcast filter params.
     * @param {ReturnType<typeof JSON.parse>} [data.body] - V2 broadcast body.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.eventId] - Event identifier.
     * @returns {void}
     */
    handleWebsocketV2Broadcast(data: {
        broadcastParams?: Record<string, ReturnType<typeof JSON.parse>>;
        body?: ReturnType<typeof JSON.parse>;
        channel?: string;
        eventId?: string;
    }): void;
    /**
     * Runs handle debug snapshot.
     * @param {object} data - Data payload.
     * @param {number} [data.requestId] - Debug request id.
     * @returns {void}
     */
    handleDebugSnapshot(data: {
        requestId?: number;
    }): void;
    /**
     * Runs handle shutdown.
     * @returns {Promise<void>} Resolves after worker shutdown has been requested.
     */
    handleShutdown(): Promise<void>;
    /**
     * Runs broadcast websocket event.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {string | undefined} args.createdAt - Event creation time.
     * @param {string | undefined} args.eventId - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {Promise<void>} - Resolves when complete.
     */
    broadcastWebsocketEvent({ channel, createdAt, eventId, payload }: {
        channel: string;
        createdAt: string | undefined;
        eventId: string | undefined;
        payload: ReturnType<typeof JSON.parse>;
    }): Promise<void>;
}
//# sourceMappingURL=worker-thread.d.ts.map