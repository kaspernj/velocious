import Client from "../client/index.js";
import ClientDeliveryQueue from "../client-delivery-queue.js";
import Logger from "../../logger.js";
/**
 * In-process worker handler that processes HTTP requests in the main thread
 * instead of spawning a Worker thread. This allows the test runner's database
 * connection context to be shared with HTTP request handlers, so model-created
 * records in tests are visible to HTTP endpoints.
 */
export default class VelociousHttpServerInProcessHandler {
    configuration: import("../../configuration.js").default;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, {deliveryQueue: ClientDeliveryQueue, httpClient: Client, serverClient: import("../server-client.js").default}>} */
    clients: Record<number, {
        deliveryQueue: ClientDeliveryQueue;
        httpClient: Client;
        serverClient: import("../server-client.js").default;
    }>;
    /** @type {Set<Promise<void>>} */
    pendingClientCloseCleanups: Set<Promise<void>>;
    logger: Logger;
    workerCount: number;
    unregisterFromEventsHost: () => void;
    _stopping: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {number} args.workerCount - Worker count.
     */
    constructor({ configuration, workerCount }: {
        configuration: import("../../configuration.js").default;
        workerCount: number;
    });
    /**
     * Runs start.
     * @returns {Promise<void>} */
    start(): Promise<void>;
    /**
     * Runs add socket connection.
     * @param {import("../server-client.js").default} serverClient - Server client instance.
     * @returns {void}
     */
    addSocketConnection(serverClient: import("../server-client.js").default): void;
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
     * Runs stop.
     * @returns {Promise<void>} */
    stop(): Promise<void>;
    /**
     * In-process handler path for V2 channel broadcasts. No worker
     * boundary to cross — dispatch directly to any matching live
     * subscriptions on the shared configuration.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing filter params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @param {string} [args.eventId] - Persisted event id for replay.
     * @returns {void}
     */
    dispatchWebsocketV2Broadcast({ body, broadcastParams, channel, eventId }: {
        channel: string;
        broadcastParams: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
        eventId?: string;
    }): void;
    /**
     * Gets the configuration-wide V2 broadcast target shared by in-process handlers.
     * @returns {import("../../configuration.js").default} - Shared configuration target.
     */
    websocketV2BroadcastDispatchKey(): import("../../configuration.js").default;
    /**
     * Runs dispatch websocket event.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {string} [args.createdAt] - Event creation time.
     * @param {string} [args.eventId] - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {void}
     */
    dispatchWebsocketEvent({ channel, createdAt, eventId, payload }: {
        channel: string;
        createdAt?: string;
        eventId?: string;
        payload: ReturnType<typeof JSON.parse>;
    }): void;
}
//# sourceMappingURL=in-process.d.ts.map