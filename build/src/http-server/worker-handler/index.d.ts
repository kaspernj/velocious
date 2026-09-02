import Logger from "../../logger.js";
import ClientDeliveryQueue from "../client-delivery-queue.js";
import { Worker } from "worker_threads";
export default class VelociousHttpServerWorker {
    configuration: import("../../configuration.js").default;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, import("../server-client.js").default>} */
    clients: Record<number, import("../server-client.js").default>;
    logger: Logger;
    workerCount: number;
    onWebsocketSessionOwned: ((args: {
        sessionId: string;
        workerHandler: VelociousHttpServerWorker;
    }) => void) | undefined;
    onWebsocketSessionReleased: ((args: {
        sessionId: string;
        workerHandler: VelociousHttpServerWorker;
    }) => void) | undefined;
    onWorkerStopped: ((args: {
        workerHandler: VelociousHttpServerWorker;
    }) => void) | undefined;
    workerStarted: boolean;
    _stopping: boolean;
    _debugRequestId: number;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<number, {resolve: (snapshot: Record<string, ReturnType<typeof JSON.parse>>) => void}>} */
    _debugSnapshotRequests: Map<number, {
        resolve: (snapshot: Record<string, ReturnType<typeof JSON.parse>>) => void;
    }>;
    /** @type {Map<number, ClientDeliveryQueue>} */
    _clientDeliveryQueues: Map<number, ClientDeliveryQueue>;
    onStartCallback: ((value: any) => void) | null | undefined;
    worker: Worker | undefined;
    _hasExited: boolean | undefined;
    _stopResolve: ((value: void | PromiseLike<void>) => void) | null | undefined;
    unregisterFromEventsHost: (() => void) | null | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {number} args.workerCount - Worker count.
     * @param {(args: {sessionId: string, workerHandler: VelociousHttpServerWorker}) => void} [args.onWebsocketSessionOwned] - Session ownership callback.
     * @param {(args: {sessionId: string, workerHandler: VelociousHttpServerWorker}) => void} [args.onWebsocketSessionReleased] - Session ownership release callback.
     * @param {(args: {workerHandler: VelociousHttpServerWorker}) => void} [args.onWorkerStopped] - Worker lifecycle callback.
     */
    constructor({ configuration, onWebsocketSessionOwned, onWebsocketSessionReleased, onWorkerStopped, workerCount }: {
        configuration: import("../../configuration.js").default;
        workerCount: number;
        onWebsocketSessionOwned?: (args: {
            sessionId: string;
            workerHandler: VelociousHttpServerWorker;
        }) => void;
        onWebsocketSessionReleased?: (args: {
            sessionId: string;
            workerHandler: VelociousHttpServerWorker;
        }) => void;
        onWorkerStopped?: (args: {
            workerHandler: VelociousHttpServerWorker;
        }) => void;
    });
    start(): Promise<any>;
    _spawnWorker(): Promise<void>;
    /**
     * Runs add socket connection.
     * @param {import("../server-client.js").default} client - Client instance.
     * @returns {void} - No return value.
     */
    addSocketConnection(client: import("../server-client.js").default): void;
    /**
     * Propagates a parent-side socket close and clears all parent state for the client.
     * @param {number} clientCount - Client count.
     * @returns {void}
     */
    handleClientAbort(clientCount: number): void;
    /**
     * On worker error.
     * @param {ReturnType<typeof JSON.parse>} error - Error instance.
     */
    onWorkerError: (error: ReturnType<typeof JSON.parse>) => never;
    /**
     * On worker exit.
     * @param {number} code - Code.
     * @returns {void} - No return value.
     */
    onWorkerExit: (code: number) => void;
    /**
     * Runs close all clients.
     * @returns {void} - No return value.
     */
    _closeAllClients(): void;
    /**
     * On worker message.
     * @param {object} data - Data payload.
     * @param {string} data.command - Command.
     * @param {number} [data.clientCount] - Client count.
     * @param {string | Uint8Array} [data.output] - Output.
     * @param {string} [data.filePath] - File path.
     * @param {boolean} [data.sendBody] - Whether to send the file body.
     * @param {number} [data.transferId] - File transfer id.
     * @param {boolean} [data.websocketFrame] - Whether output is a completed WebSocket frame.
     * @param {string} [data.channel] - Channel name.
     * @param {string} [data.sessionId] - WebSocket session identity.
     * @param {number} [data.requestId] - Debug request id.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [data.snapshot] - Worker debug snapshot.
     * @param {ReturnType<typeof JSON.parse>} [data.payload] - Payload data.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [data.broadcastParams] - V2 broadcast filter params.
     * @param {ReturnType<typeof JSON.parse>} [data.body] - V2 broadcast body.
     * @returns {void} - No return value.
     */
    onWorkerMessage: (data: {
        command: string;
        clientCount?: number;
        output?: string | Uint8Array;
        filePath?: string;
        sendBody?: boolean;
        transferId?: number;
        websocketFrame?: boolean;
        channel?: string;
        sessionId?: string;
        requestId?: number;
        snapshot?: Record<string, ReturnType<typeof JSON.parse>>;
        payload?: ReturnType<typeof JSON.parse>;
        broadcastParams?: Record<string, ReturnType<typeof JSON.parse>>;
        body?: ReturnType<typeof JSON.parse>;
    }) => void;
    /**
     * Preserves socket output ordering for one client.
     * @param {import("../server-client.js").default} client - Client instance.
     * @param {string | Uint8Array} output - Complete output buffer.
     * @returns {Promise<void>} - Queued delivery.
     */
    enqueueClientFrame(client: import("../server-client.js").default, output: string | Uint8Array): Promise<void>;
    /**
     * Preserves ordering for a delivery that retains no complete output frame.
     * @param {import("../server-client.js").default} client - Client instance.
     * @param {() => Promise<void>} delivery - Delivery operation.
     * @returns {Promise<void>} - Queued delivery.
     */
    enqueueClientControl(client: import("../server-client.js").default, delivery: () => Promise<void>): Promise<void>;
    /**
     * Gets or creates one client's delivery queue.
     * @param {import("../server-client.js").default} client - Client instance.
     * @returns {ClientDeliveryQueue} - Client-owned delivery queue.
     */
    _deliveryQueueFor(client: import("../server-client.js").default): ClientDeliveryQueue;
    /**
     * Reports a per-client outbound queue overflow.
     * @param {object} args - Overflow details.
     * @param {number} args.clientCount - Affected client.
     * @param {Error} args.error - Overflow error.
     * @returns {void}
     */
    _reportOutboundQueueOverflow({ clientCount, error }: {
        clientCount: number;
        error: Error;
    }): void;
    /**
     * Runs get debug snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Worker-local debug snapshot.
     */
    getDebugSnapshot(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when stopped.
     */
    stop(): Promise<void>;
    /**
     * Runs dispatch websocket event.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {string} [args.createdAt] - Event creation time.
     * @param {string} [args.eventId] - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {void} - No return value.
     */
    dispatchWebsocketEvent({ channel, createdAt, eventId, payload }: {
        channel: string;
        createdAt?: string;
        eventId?: string;
        payload: ReturnType<typeof JSON.parse>;
    }): void;
    /**
     * Forwards a V2 channel broadcast to this worker's thread so it can
     * dispatch to any locally-registered V2 subscriptions.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing filter params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @param {string} [args.eventId] - Persisted event id for replay.
     * @param {string} [args.createdAt] - Event creation timestamp.
     * @returns {void}
     */
    dispatchWebsocketV2Broadcast({ body, broadcastParams, channel, eventId, createdAt }: {
        channel: string;
        broadcastParams: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
        eventId?: string;
        createdAt?: string;
    }): void;
    /**
     * Gets this worker's isolated V2 broadcast target.
     * @returns {VelociousHttpServerWorker} - This worker handler.
     */
    websocketV2BroadcastDispatchKey(): VelociousHttpServerWorker;
    /**
     * Runs register with events host.
     * @returns {void} */
    registerWithEventsHost(): void;
    /**
     * Runs unregister from events host if needed.
     * @returns {void} */
    unregisterFromEventsHostIfNeeded(): void;
}
//# sourceMappingURL=index.d.ts.map