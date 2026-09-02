// @ts-check
import { ensureError } from "typanic";
import Logger from "../../logger.js";
import ClientDeliveryQueue from "../client-delivery-queue.js";
import { Worker } from "worker_threads";
import websocketEventsHost from "../websocket-events-host.js";
/**
 * Runs summarize worker message.
 * @param {object} data - Worker message payload.
 * @param {string} data.command - Command name.
 * @param {number} [data.clientCount] - Client count.
 * @param {string | Uint8Array} [data.output] - Output chunk.
 * @returns {object} - Log-safe message details.
 */
function summarizeWorkerMessage(data) {
    const { output, ...rest } = data;
    if (output === undefined) {
        return rest;
    }
    const outputType = typeof output;
    const outputLength = typeof output === "string"
        ? output.length
        : (output instanceof Uint8Array ? output.byteLength : undefined);
    return {
        ...rest,
        output: {
            length: outputLength,
            type: outputType
        }
    };
}
export default class VelociousHttpServerWorker {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {number} args.workerCount - Worker count.
     * @param {(args: {sessionId: string, workerHandler: VelociousHttpServerWorker}) => void} [args.onWebsocketSessionOwned] - Session ownership callback.
     * @param {(args: {sessionId: string, workerHandler: VelociousHttpServerWorker}) => void} [args.onWebsocketSessionReleased] - Session ownership release callback.
     * @param {(args: {workerHandler: VelociousHttpServerWorker}) => void} [args.onWorkerStopped] - Worker lifecycle callback.
     */
    constructor({ configuration, onWebsocketSessionOwned, onWebsocketSessionReleased, onWorkerStopped, workerCount }) {
        this.configuration = configuration;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<number, import("../server-client.js").default>} */
        this.clients = {};
        this.logger = new Logger(this);
        this.workerCount = workerCount;
        this.onWebsocketSessionOwned = onWebsocketSessionOwned;
        this.onWebsocketSessionReleased = onWebsocketSessionReleased;
        this.onWorkerStopped = onWorkerStopped;
        this.workerStarted = false;
        this._stopping = false;
        this._debugRequestId = 0;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<number, {resolve: (snapshot: Record<string, ReturnType<typeof JSON.parse>>) => void}>} */
        this._debugSnapshotRequests = new Map();
        /** @type {Map<number, ClientDeliveryQueue>} */
        this._clientDeliveryQueues = new Map();
    }
    start() {
        return new Promise((resolve) => {
            this.onStartCallback = resolve;
            this._spawnWorker();
        });
    }
    async _spawnWorker() {
        const debug = this.configuration.debug;
        const directory = this.configuration.getDirectory();
        const velociousPath = await this.configuration.getEnvironmentHandler().getVelociousPath();
        this.worker = new Worker(`${velociousPath}/src/http-server/worker-handler/worker-script.js`, {
            workerData: {
                debug,
                directory,
                environment: this.configuration.getEnvironment(),
                workerCount: this.workerCount
            }
        });
        this.worker.on("error", this.onWorkerError);
        this.worker.on("exit", this.onWorkerExit);
        this.worker.on("message", this.onWorkerMessage);
    }
    /**
     * Runs add socket connection.
     * @param {import("../server-client.js").default} client - Client instance.
     * @returns {void} - No return value.
     */
    addSocketConnection(client) {
        const clientCount = client.clientCount;
        if (!this.worker)
            throw new Error("Worker not initialized");
        client.setWorker(this.worker);
        client.listen();
        this.clients[clientCount] = client;
        client.events.on("close", () => {
            this.handleClientAbort(clientCount);
        });
        this.worker.postMessage({ command: "newClient", clientCount, remoteAddress: client.remoteAddress });
    }
    /**
     * Propagates a parent-side socket close and clears all parent state for the client.
     * @param {number} clientCount - Client count.
     * @returns {void}
     */
    handleClientAbort(clientCount) {
        if (!this.clients[clientCount] && !this._clientDeliveryQueues.has(clientCount))
            return;
        delete this.clients[clientCount];
        this._clientDeliveryQueues.get(clientCount)?.destroy();
        this._clientDeliveryQueues.delete(clientCount);
        this.worker?.postMessage({ command: "clientAbort", clientCount });
    }
    /**
     * On worker error.
     * @param {ReturnType<typeof JSON.parse>} error - Error instance.
     */
    onWorkerError = (error) => {
        this.logger.error(`Velocious worker ${this.workerCount} error`, error);
        void this._closeAllClients();
        // Preserve Error instances for the original backtrace while wrapping non-Error throwables.
        throw ensureError(error);
    };
    /**
     * On worker exit.
     * @param {number} code - Code.
     * @returns {void} - No return value.
     */
    onWorkerExit = (code) => {
        this._hasExited = true;
        this.workerStarted = false;
        this._closeAllClients();
        if (code !== 0 && !this._stopping) {
            this.logger.error(`Velocious worker ${this.workerCount} exited unexpectedly with code ${code}`);
            throw new Error(`Client worker stopped with exit code ${code}`);
        }
        else {
            this.logger.debug(() => `Client worker stopped with exit code ${code}`);
        }
        this.unregisterFromEventsHostIfNeeded();
        if (this.onWorkerStopped)
            this.onWorkerStopped({ workerHandler: this });
        if (this._stopResolve) {
            this._stopResolve();
        }
        this._stopResolve = null;
    };
    /**
     * Runs close all clients.
     * @returns {void} - No return value.
     */
    _closeAllClients() {
        const clients = Object.values(this.clients);
        this.clients = {};
        const deliveryQueues = this._clientDeliveryQueues;
        this._clientDeliveryQueues = new Map();
        for (const queue of deliveryQueues.values())
            queue.destroy();
        for (const client of clients) {
            try {
                void client.end();
            }
            catch (error) {
                this.logger.warn("Failed to close client after worker exit", error);
            }
        }
    }
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
    onWorkerMessage = (data) => {
        this.logger.debug("Worker message", summarizeWorkerMessage(data));
        const { command } = data;
        if (command == "started") {
            this.workerStarted = true;
            this.registerWithEventsHost();
            if (this.onStartCallback) {
                this.onStartCallback(null);
            }
            this.onStartCallback = null;
        }
        else if (command == "clientOutput") {
            this.logger.debug("CLIENT OUTPUT", summarizeWorkerMessage(data));
            const { clientCount, output } = data;
            const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined;
            if (!client) {
                this.logger.warn(() => [`Velocious worker ${this.workerCount} produced output for missing client ${clientCount}`, data]);
                return;
            }
            if (output !== null && output !== undefined) {
                const outputLength = typeof output === "string" ? output.length : output.byteLength;
                const delivery = data.websocketFrame === true
                    ? this.enqueueClientFrame(client, output)
                    : this.enqueueClientControl(client, () => client.send(output));
                void delivery.then(() => {
                    this.logger.debug(() => ["Client output delivered", {
                            clientCount,
                            outputLength,
                            workerCount: this.workerCount
                        }]);
                }).catch((error) => {
                    this.logger.error(() => ["Failed to deliver client output", {
                            clientCount,
                            workerCount: this.workerCount
                        }, error]);
                });
            }
        }
        else if (command == "clientFile") {
            const { clientCount, filePath, sendBody, transferId } = data;
            const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined;
            if (typeof transferId !== "number")
                throw new Error("clientFile transferId must be a number");
            if (!client || typeof filePath !== "string") {
                this.worker?.postMessage({ command: "clientFileResult", result: "aborted", transferId });
                return;
            }
            void this.enqueueClientControl(client, async () => {
                const result = await client.sendFile(filePath, sendBody !== false);
                this.worker?.postMessage({ command: "clientFileResult", result, transferId });
            }).catch((error) => {
                this.logger.error(() => ["Failed to deliver file response", { clientCount: client.clientCount, filePath }, error]);
                this.worker?.postMessage({ command: "clientFileResult", result: "aborted", transferId });
            });
        }
        else if (command == "clientClose") {
            const { clientCount } = data;
            const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined;
            if (!client) {
                this.logger.error(() => [`Velocious worker ${this.workerCount} requested close for missing client ${clientCount}`, data]);
                return;
            }
            void this.enqueueClientControl(client, () => client.end())
                .finally(() => delete this.clients[client.clientCount]);
        }
        else if (command == "debugSnapshot") {
            const { requestId, snapshot } = data;
            if (typeof requestId !== "number")
                throw new Error("debugSnapshot requestId must be a number");
            const request = this._debugSnapshotRequests.get(requestId);
            if (request) {
                this._debugSnapshotRequests.delete(requestId);
                request.resolve(snapshot || {});
            }
        }
        else if (command == "shutdownComplete") {
            this._stopResolve?.();
            this._stopResolve = null;
        }
        else if (command == "websocketPublish") {
            const { channel, payload } = data;
            if (typeof channel !== "string") {
                throw new Error("Worker websocket publish channel must be a string");
            }
            websocketEventsHost.publish({ channel, payload });
        }
        else if (command == "websocketV2Broadcast") {
            const { body, broadcastParams, channel } = data;
            if (typeof channel !== "string") {
                throw new Error("Worker websocket v2-broadcast channel must be a string");
            }
            websocketEventsHost.broadcastV2({
                body,
                broadcastParams: broadcastParams || {},
                channel,
                configuration: this.configuration
            });
        }
        else if (command == "websocketSessionOwned") {
            if (typeof data.sessionId !== "string")
                throw new Error("Worker websocket session id must be a string");
            if (this.onWebsocketSessionOwned)
                this.onWebsocketSessionOwned({ sessionId: data.sessionId, workerHandler: this });
        }
        else if (command == "websocketSessionReleased") {
            if (typeof data.sessionId !== "string")
                throw new Error("Worker websocket session id must be a string");
            if (this.onWebsocketSessionReleased)
                this.onWebsocketSessionReleased({ sessionId: data.sessionId, workerHandler: this });
        }
        else {
            throw new Error(`Unknown command: ${command}`);
        }
    };
    /**
     * Preserves socket output ordering for one client.
     * @param {import("../server-client.js").default} client - Client instance.
     * @param {string | Uint8Array} output - Complete output buffer.
     * @returns {Promise<void>} - Queued delivery.
     */
    enqueueClientFrame(client, output) {
        const byteLength = typeof output === "string" ? Buffer.byteLength(output) : output.byteLength;
        return this._deliveryQueueFor(client).enqueueFrame({
            byteLength,
            delivery: () => client.send(output)
        });
    }
    /**
     * Preserves ordering for a delivery that retains no complete output frame.
     * @param {import("../server-client.js").default} client - Client instance.
     * @param {() => Promise<void>} delivery - Delivery operation.
     * @returns {Promise<void>} - Queued delivery.
     */
    enqueueClientControl(client, delivery) {
        return this._deliveryQueueFor(client).enqueueControl(delivery);
    }
    /**
     * Gets or creates one client's delivery queue.
     * @param {import("../server-client.js").default} client - Client instance.
     * @returns {ClientDeliveryQueue} - Client-owned delivery queue.
     */
    _deliveryQueueFor(client) {
        const existing = this._clientDeliveryQueues.get(client.clientCount);
        if (existing)
            return existing;
        const { maxBytes, maxFrames } = this.configuration.getWebsocketOutboundQueueLimits();
        const queue = new ClientDeliveryQueue({
            clientCount: client.clientCount,
            maxBytes,
            maxFrames,
            onOverflow: (error) => {
                queue.destroy();
                client.destroy(error);
                this._reportOutboundQueueOverflow({ clientCount: client.clientCount, error });
            }
        });
        this._clientDeliveryQueues.set(client.clientCount, queue);
        return queue;
    }
    /**
     * Reports a per-client outbound queue overflow.
     * @param {object} args - Overflow details.
     * @param {number} args.clientCount - Affected client.
     * @param {Error} args.error - Overflow error.
     * @returns {void}
     */
    _reportOutboundQueueOverflow({ clientCount, error }) {
        const errorPayload = {
            context: { clientCount, websocketOutboundQueueOverflow: true, workerCount: this.workerCount },
            error
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", errorPayload);
        errorEvents.emit("all-error", { ...errorPayload, errorType: "framework-error" });
    }
    /**
     * Runs get debug snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Worker-local debug snapshot.
     */
    getDebugSnapshot() {
        if (!this.workerStarted || !this.worker) {
            return Promise.resolve({ active: false, workerCount: this.workerCount });
        }
        const requestId = ++this._debugRequestId;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this._debugSnapshotRequests.delete(requestId);
                resolve({ active: true, error: "Timed out waiting for worker debug snapshot", workerCount: this.workerCount });
            }, 2000);
            if (typeof timeout.unref === "function")
                timeout.unref();
            const worker = this.worker;
            if (!worker) {
                clearTimeout(timeout);
                resolve({ active: false, workerCount: this.workerCount });
                return;
            }
            this._debugSnapshotRequests.set(requestId, {
                resolve: (snapshot) => {
                    clearTimeout(timeout);
                    resolve({ active: true, snapshot, workerCount: this.workerCount });
                }
            });
            worker.postMessage({ command: "debugSnapshot", requestId });
        });
    }
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when stopped.
     */
    stop() {
        if (!this.worker)
            return Promise.resolve();
        if (this._hasExited)
            return Promise.resolve();
        this._stopping = true;
        this.workerStarted = false;
        this.unregisterFromEventsHostIfNeeded();
        const worker = this.worker;
        if (!worker)
            return Promise.resolve();
        return new Promise((resolve) => {
            this._stopResolve = resolve;
            worker.postMessage({ command: "shutdown" });
        });
    }
    /**
     * Runs dispatch websocket event.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {string} [args.createdAt] - Event creation time.
     * @param {string} [args.eventId] - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {void} - No return value.
     */
    dispatchWebsocketEvent({ channel, createdAt, eventId, payload }) {
        // Test and shutdown paths can leave a registered handler without a live worker-thread transport.
        if (!this.workerStarted)
            return;
        if (!this.worker || typeof this.worker.postMessage !== "function")
            return;
        this.worker.postMessage({ channel, command: "websocketEvent", createdAt, eventId, payload });
    }
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
    dispatchWebsocketV2Broadcast({ body, broadcastParams, channel, eventId, createdAt }) {
        if (!this.workerStarted)
            return;
        if (!this.worker || typeof this.worker.postMessage !== "function")
            return;
        this.worker.postMessage({ body, broadcastParams, channel, command: "websocketV2Broadcast", eventId, createdAt });
    }
    /**
     * Gets this worker's isolated V2 broadcast target.
     * @returns {VelociousHttpServerWorker} - This worker handler.
     */
    websocketV2BroadcastDispatchKey() {
        return this;
    }
    /**
     * Runs register with events host.
     * @returns {void} */
    registerWithEventsHost() {
        if (this.unregisterFromEventsHost)
            return;
        this.unregisterFromEventsHost = websocketEventsHost.register(this);
    }
    /**
     * Runs unregister from events host if needed.
     * @returns {void} */
    unregisterFromEventsHostIfNeeded() {
        if (!this.unregisterFromEventsHost)
            return;
        this.unregisterFromEventsHost();
        this.unregisterFromEventsHost = null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvd29ya2VyLWhhbmRsZXIvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFDbkMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMsTUFBTSxFQUFDLE1BQU0sZ0JBQWdCLENBQUE7QUFDckMsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUU3RDs7Ozs7OztHQU9HO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxJQUFJO0lBQ2xDLE1BQU0sRUFBQyxNQUFNLEVBQUUsR0FBRyxJQUFJLEVBQUMsR0FBRyxJQUFJLENBQUE7SUFFOUIsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDekIsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQsTUFBTSxVQUFVLEdBQUcsT0FBTyxNQUFNLENBQUE7SUFDaEMsTUFBTSxZQUFZLEdBQUcsT0FBTyxNQUFNLEtBQUssUUFBUTtRQUM3QyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU07UUFDZixDQUFDLENBQUMsQ0FBQyxNQUFNLFlBQVksVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUVsRSxPQUFPO1FBQ0wsR0FBRyxJQUFJO1FBQ1AsTUFBTSxFQUFFO1lBQ04sTUFBTSxFQUFFLFlBQVk7WUFDcEIsSUFBSSxFQUFFLFVBQVU7U0FDakI7S0FDRixDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQXlCO0lBQzVDOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSx1QkFBdUIsRUFBRSwwQkFB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ekMsSUFBSSxDQUFDLHdCQUF3QixHQUFHLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNwRSxDQUFDO0lBRUQ7O3lCQUVxQjtJQUNyQixnQ0FBZ0M7UUFDOUIsSUFBSSxDQUFDLElBQUksQ0FBQyx3QkFBd0I7WUFBRSxPQUFNO1FBRTFDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBQy9CLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxJQUFJLENBQUE7SUFDdEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZW5zdXJlRXJyb3J9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgQ2xpZW50RGVsaXZlcnlRdWV1ZSBmcm9tIFwiLi4vY2xpZW50LWRlbGl2ZXJ5LXF1ZXVlLmpzXCJcbmltcG9ydCB7V29ya2VyfSBmcm9tIFwid29ya2VyX3RocmVhZHNcIlxuaW1wb3J0IHdlYnNvY2tldEV2ZW50c0hvc3QgZnJvbSBcIi4uL3dlYnNvY2tldC1ldmVudHMtaG9zdC5qc1wiXG5cbi8qKlxuICogUnVucyBzdW1tYXJpemUgd29ya2VyIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge29iamVjdH0gZGF0YSAtIFdvcmtlciBtZXNzYWdlIHBheWxvYWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gZGF0YS5jb21tYW5kIC0gQ29tbWFuZCBuYW1lLlxuICogQHBhcmFtIHtudW1iZXJ9IFtkYXRhLmNsaWVudENvdW50XSAtIENsaWVudCBjb3VudC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgVWludDhBcnJheX0gW2RhdGEub3V0cHV0XSAtIE91dHB1dCBjaHVuay5cbiAqIEByZXR1cm5zIHtvYmplY3R9IC0gTG9nLXNhZmUgbWVzc2FnZSBkZXRhaWxzLlxuICovXG5mdW5jdGlvbiBzdW1tYXJpemVXb3JrZXJNZXNzYWdlKGRhdGEpIHtcbiAgY29uc3Qge291dHB1dCwgLi4ucmVzdH0gPSBkYXRhXG5cbiAgaWYgKG91dHB1dCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIHJlc3RcbiAgfVxuXG4gIGNvbnN0IG91dHB1dFR5cGUgPSB0eXBlb2Ygb3V0cHV0XG4gIGNvbnN0IG91dHB1dExlbmd0aCA9IHR5cGVvZiBvdXRwdXQgPT09IFwic3RyaW5nXCJcbiAgICA/IG91dHB1dC5sZW5ndGhcbiAgICA6IChvdXRwdXQgaW5zdGFuY2VvZiBVaW50OEFycmF5ID8gb3V0cHV0LmJ5dGVMZW5ndGggOiB1bmRlZmluZWQpXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5yZXN0LFxuICAgIG91dHB1dDoge1xuICAgICAgbGVuZ3RoOiBvdXRwdXRMZW5ndGgsXG4gICAgICB0eXBlOiBvdXRwdXRUeXBlXG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJXb3JrZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLndvcmtlckNvdW50IC0gV29ya2VyIGNvdW50LlxuICAgKiBAcGFyYW0geyhhcmdzOiB7c2Vzc2lvbklkOiBzdHJpbmcsIHdvcmtlckhhbmRsZXI6IFZlbG9jaW91c0h0dHBTZXJ2ZXJXb3JrZXJ9KSA9PiB2b2lkfSBbYXJncy5vbldlYnNvY2tldFNlc3Npb25Pd25lZF0gLSBTZXNzaW9uIG93bmVyc2hpcCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoYXJnczoge3Nlc3Npb25JZDogc3RyaW5nLCB3b3JrZXJIYW5kbGVyOiBWZWxvY2lvdXNIdHRwU2VydmVyV29ya2VyfSkgPT4gdm9pZH0gW2FyZ3Mub25XZWJzb2NrZXRTZXNzaW9uUmVsZWFzZWRdIC0gU2Vzc2lvbiBvd25lcnNoaXAgcmVsZWFzZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoYXJnczoge3dvcmtlckhhbmRsZXI6IFZlbG9jaW91c0h0dHBTZXJ2ZXJXb3JrZXJ9KSA9PiB2b2lkfSBbYXJncy5vbldvcmtlclN0b3BwZWRdIC0gV29ya2VyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBvbldlYnNvY2tldFNlc3Npb25Pd25lZCwgb25XZWJzb2NrZXRTZXNzaW9uUmVsZWFzZWQsIG9uV29ya2VyU3RvcHBlZCwgd29ya2VyQ291bnR9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyLCBpbXBvcnQoXCIuLi9zZXJ2ZXItY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuY2xpZW50cyA9IHt9XG5cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLndvcmtlckNvdW50ID0gd29ya2VyQ291bnRcbiAgICB0aGlzLm9uV2Vic29ja2V0U2Vzc2lvbk93bmVkID0gb25XZWJzb2NrZXRTZXNzaW9uT3duZWRcbiAgICB0aGlzLm9uV2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkID0gb25XZWJzb2NrZXRTZXNzaW9uUmVsZWFzZWRcbiAgICB0aGlzLm9uV29ya2VyU3RvcHBlZCA9IG9uV29ya2VyU3RvcHBlZFxuICAgIHRoaXMud29ya2VyU3RhcnRlZCA9IGZhbHNlXG4gICAgdGhpcy5fc3RvcHBpbmcgPSBmYWxzZVxuICAgIHRoaXMuX2RlYnVnUmVxdWVzdElkID0gMFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPG51bWJlciwge3Jlc29sdmU6IChzbmFwc2hvdDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkfT59ICovXG4gICAgdGhpcy5fZGVidWdTbmFwc2hvdFJlcXVlc3RzID0gbmV3IE1hcCgpXG5cbiAgICAvKiogQHR5cGUge01hcDxudW1iZXIsIENsaWVudERlbGl2ZXJ5UXVldWU+fSAqL1xuICAgIHRoaXMuX2NsaWVudERlbGl2ZXJ5UXVldWVzID0gbmV3IE1hcCgpXG4gIH1cblxuICBzdGFydCgpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMub25TdGFydENhbGxiYWNrID0gcmVzb2x2ZVxuICAgICAgdGhpcy5fc3Bhd25Xb3JrZXIoKVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfc3Bhd25Xb3JrZXIoKSB7XG4gICAgY29uc3QgZGVidWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZGVidWdcbiAgICBjb25zdCBkaXJlY3RvcnkgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcbiAgICBjb25zdCB2ZWxvY2lvdXNQYXRoID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFZlbG9jaW91c1BhdGgoKVxuXG4gICAgdGhpcy53b3JrZXIgPSBuZXcgV29ya2VyKGAke3ZlbG9jaW91c1BhdGh9L3NyYy9odHRwLXNlcnZlci93b3JrZXItaGFuZGxlci93b3JrZXItc2NyaXB0LmpzYCwge1xuICAgICAgd29ya2VyRGF0YToge1xuICAgICAgICBkZWJ1ZyxcbiAgICAgICAgZGlyZWN0b3J5LFxuICAgICAgICBlbnZpcm9ubWVudDogdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICAgIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50XG4gICAgICB9XG4gICAgfSlcbiAgICB0aGlzLndvcmtlci5vbihcImVycm9yXCIsIHRoaXMub25Xb3JrZXJFcnJvcilcbiAgICB0aGlzLndvcmtlci5vbihcImV4aXRcIiwgdGhpcy5vbldvcmtlckV4aXQpXG4gICAgdGhpcy53b3JrZXIub24oXCJtZXNzYWdlXCIsIHRoaXMub25Xb3JrZXJNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHNvY2tldCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3NlcnZlci1jbGllbnQuanNcIikuZGVmYXVsdH0gY2xpZW50IC0gQ2xpZW50IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhZGRTb2NrZXRDb25uZWN0aW9uKGNsaWVudCkge1xuICAgIGNvbnN0IGNsaWVudENvdW50ID0gY2xpZW50LmNsaWVudENvdW50XG5cbiAgICBpZiAoIXRoaXMud29ya2VyKSB0aHJvdyBuZXcgRXJyb3IoXCJXb3JrZXIgbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjbGllbnQuc2V0V29ya2VyKHRoaXMud29ya2VyKVxuICAgIGNsaWVudC5saXN0ZW4oKVxuXG4gICAgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XSA9IGNsaWVudFxuICAgIGNsaWVudC5ldmVudHMub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICB0aGlzLmhhbmRsZUNsaWVudEFib3J0KGNsaWVudENvdW50KVxuICAgIH0pXG4gICAgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwibmV3Q2xpZW50XCIsIGNsaWVudENvdW50LCByZW1vdGVBZGRyZXNzOiBjbGllbnQucmVtb3RlQWRkcmVzc30pXG4gIH1cblxuICAvKipcbiAgICogUHJvcGFnYXRlcyBhIHBhcmVudC1zaWRlIHNvY2tldCBjbG9zZSBhbmQgY2xlYXJzIGFsbCBwYXJlbnQgc3RhdGUgZm9yIHRoZSBjbGllbnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjbGllbnRDb3VudCAtIENsaWVudCBjb3VudC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBoYW5kbGVDbGllbnRBYm9ydChjbGllbnRDb3VudCkge1xuICAgIGlmICghdGhpcy5jbGllbnRzW2NsaWVudENvdW50XSAmJiAhdGhpcy5fY2xpZW50RGVsaXZlcnlRdWV1ZXMuaGFzKGNsaWVudENvdW50KSkgcmV0dXJuXG5cbiAgICBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XVxuICAgIHRoaXMuX2NsaWVudERlbGl2ZXJ5UXVldWVzLmdldChjbGllbnRDb3VudCk/LmRlc3Ryb3koKVxuICAgIHRoaXMuX2NsaWVudERlbGl2ZXJ5UXVldWVzLmRlbGV0ZShjbGllbnRDb3VudClcbiAgICB0aGlzLndvcmtlcj8ucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwiY2xpZW50QWJvcnRcIiwgY2xpZW50Q291bnR9KVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIHdvcmtlciBlcnJvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICovXG4gIG9uV29ya2VyRXJyb3IgPSAoZXJyb3IpID0+IHtcbiAgICB0aGlzLmxvZ2dlci5lcnJvcihgVmVsb2Npb3VzIHdvcmtlciAke3RoaXMud29ya2VyQ291bnR9IGVycm9yYCwgZXJyb3IpXG4gICAgdm9pZCB0aGlzLl9jbG9zZUFsbENsaWVudHMoKVxuICAgIC8vIFByZXNlcnZlIEVycm9yIGluc3RhbmNlcyBmb3IgdGhlIG9yaWdpbmFsIGJhY2t0cmFjZSB3aGlsZSB3cmFwcGluZyBub24tRXJyb3IgdGhyb3dhYmxlcy5cbiAgICB0aHJvdyBlbnN1cmVFcnJvcihlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBPbiB3b3JrZXIgZXhpdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvZGUgLSBDb2RlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvbldvcmtlckV4aXQgPSAoY29kZSkgPT4ge1xuICAgIHRoaXMuX2hhc0V4aXRlZCA9IHRydWVcbiAgICB0aGlzLndvcmtlclN0YXJ0ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2Nsb3NlQWxsQ2xpZW50cygpXG5cbiAgICBpZiAoY29kZSAhPT0gMCAmJiAhdGhpcy5fc3RvcHBpbmcpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBWZWxvY2lvdXMgd29ya2VyICR7dGhpcy53b3JrZXJDb3VudH0gZXhpdGVkIHVuZXhwZWN0ZWRseSB3aXRoIGNvZGUgJHtjb2RlfWApXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENsaWVudCB3b3JrZXIgc3RvcHBlZCB3aXRoIGV4aXQgY29kZSAke2NvZGV9YClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gYENsaWVudCB3b3JrZXIgc3RvcHBlZCB3aXRoIGV4aXQgY29kZSAke2NvZGV9YClcbiAgICB9XG5cbiAgICB0aGlzLnVucmVnaXN0ZXJGcm9tRXZlbnRzSG9zdElmTmVlZGVkKClcbiAgICBpZiAodGhpcy5vbldvcmtlclN0b3BwZWQpIHRoaXMub25Xb3JrZXJTdG9wcGVkKHt3b3JrZXJIYW5kbGVyOiB0aGlzfSlcbiAgICBpZiAodGhpcy5fc3RvcFJlc29sdmUpIHtcbiAgICAgIHRoaXMuX3N0b3BSZXNvbHZlKClcbiAgICB9XG4gICAgdGhpcy5fc3RvcFJlc29sdmUgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBhbGwgY2xpZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2Nsb3NlQWxsQ2xpZW50cygpIHtcbiAgICBjb25zdCBjbGllbnRzID0gT2JqZWN0LnZhbHVlcyh0aGlzLmNsaWVudHMpXG4gICAgdGhpcy5jbGllbnRzID0ge31cbiAgICBjb25zdCBkZWxpdmVyeVF1ZXVlcyA9IHRoaXMuX2NsaWVudERlbGl2ZXJ5UXVldWVzXG4gICAgdGhpcy5fY2xpZW50RGVsaXZlcnlRdWV1ZXMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcXVldWUgb2YgZGVsaXZlcnlRdWV1ZXMudmFsdWVzKCkpIHF1ZXVlLmRlc3Ryb3koKVxuXG4gICAgZm9yIChjb25zdCBjbGllbnQgb2YgY2xpZW50cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdm9pZCBjbGllbnQuZW5kKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgdG8gY2xvc2UgY2xpZW50IGFmdGVyIHdvcmtlciBleGl0XCIsIGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPbiB3b3JrZXIgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhLmNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2RhdGEuY2xpZW50Q291bnRdIC0gQ2xpZW50IGNvdW50LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IFVpbnQ4QXJyYXl9IFtkYXRhLm91dHB1dF0gLSBPdXRwdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5maWxlUGF0aF0gLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2RhdGEuc2VuZEJvZHldIC0gV2hldGhlciB0byBzZW5kIHRoZSBmaWxlIGJvZHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS50cmFuc2ZlcklkXSAtIEZpbGUgdHJhbnNmZXIgaWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2RhdGEud2Vic29ja2V0RnJhbWVdIC0gV2hldGhlciBvdXRwdXQgaXMgYSBjb21wbGV0ZWQgV2ViU29ja2V0IGZyYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2RhdGEuY2hhbm5lbF0gLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YS5zZXNzaW9uSWRdIC0gV2ViU29ja2V0IHNlc3Npb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZGF0YS5yZXF1ZXN0SWRdIC0gRGVidWcgcmVxdWVzdCBpZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtkYXRhLnNuYXBzaG90XSAtIFdvcmtlciBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RhdGEucGF5bG9hZF0gLSBQYXlsb2FkIGRhdGEuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbZGF0YS5icm9hZGNhc3RQYXJhbXNdIC0gVjIgYnJvYWRjYXN0IGZpbHRlciBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtkYXRhLmJvZHldIC0gVjIgYnJvYWRjYXN0IGJvZHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG9uV29ya2VyTWVzc2FnZSA9IChkYXRhKSA9PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoXCJXb3JrZXIgbWVzc2FnZVwiLCBzdW1tYXJpemVXb3JrZXJNZXNzYWdlKGRhdGEpKVxuXG4gICAgY29uc3Qge2NvbW1hbmR9ID0gZGF0YVxuXG5cbiAgICBpZiAoY29tbWFuZCA9PSBcInN0YXJ0ZWRcIikge1xuICAgICAgdGhpcy53b3JrZXJTdGFydGVkID0gdHJ1ZVxuICAgICAgdGhpcy5yZWdpc3RlcldpdGhFdmVudHNIb3N0KClcblxuICAgICAgaWYgKHRoaXMub25TdGFydENhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMub25TdGFydENhbGxiYWNrKG51bGwpXG4gICAgICB9XG5cbiAgICAgIHRoaXMub25TdGFydENhbGxiYWNrID0gbnVsbFxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImNsaWVudE91dHB1dFwiKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNMSUVOVCBPVVRQVVRcIiwgc3VtbWFyaXplV29ya2VyTWVzc2FnZShkYXRhKSlcblxuICAgICAgY29uc3Qge2NsaWVudENvdW50LCBvdXRwdXR9ID0gZGF0YVxuICAgICAgY29uc3QgY2xpZW50ID0gdHlwZW9mIGNsaWVudENvdW50ID09PSBcIm51bWJlclwiID8gdGhpcy5jbGllbnRzW2NsaWVudENvdW50XSA6IHVuZGVmaW5lZFxuXG4gICAgICBpZiAoIWNsaWVudCkge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtgVmVsb2Npb3VzIHdvcmtlciAke3RoaXMud29ya2VyQ291bnR9IHByb2R1Y2VkIG91dHB1dCBmb3IgbWlzc2luZyBjbGllbnQgJHtjbGllbnRDb3VudH1gLCBkYXRhXSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChvdXRwdXQgIT09IG51bGwgJiYgb3V0cHV0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc3Qgb3V0cHV0TGVuZ3RoID0gdHlwZW9mIG91dHB1dCA9PT0gXCJzdHJpbmdcIiA/IG91dHB1dC5sZW5ndGggOiBvdXRwdXQuYnl0ZUxlbmd0aFxuXG4gICAgICAgIGNvbnN0IGRlbGl2ZXJ5ID0gZGF0YS53ZWJzb2NrZXRGcmFtZSA9PT0gdHJ1ZVxuICAgICAgICAgID8gdGhpcy5lbnF1ZXVlQ2xpZW50RnJhbWUoY2xpZW50LCBvdXRwdXQpXG4gICAgICAgICAgOiB0aGlzLmVucXVldWVDbGllbnRDb250cm9sKGNsaWVudCwgKCkgPT4gY2xpZW50LnNlbmQob3V0cHV0KSlcblxuICAgICAgICB2b2lkIGRlbGl2ZXJ5LnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIkNsaWVudCBvdXRwdXQgZGVsaXZlcmVkXCIsIHtcbiAgICAgICAgICAgIGNsaWVudENvdW50LFxuICAgICAgICAgICAgb3V0cHV0TGVuZ3RoLFxuICAgICAgICAgICAgd29ya2VyQ291bnQ6IHRoaXMud29ya2VyQ291bnRcbiAgICAgICAgICB9XSlcbiAgICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIGRlbGl2ZXIgY2xpZW50IG91dHB1dFwiLCB7XG4gICAgICAgICAgICBjbGllbnRDb3VudCxcbiAgICAgICAgICAgIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50XG4gICAgICAgICAgfSwgZXJyb3JdKVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImNsaWVudEZpbGVcIikge1xuICAgICAgY29uc3Qge2NsaWVudENvdW50LCBmaWxlUGF0aCwgc2VuZEJvZHksIHRyYW5zZmVySWR9ID0gZGF0YVxuICAgICAgY29uc3QgY2xpZW50ID0gdHlwZW9mIGNsaWVudENvdW50ID09PSBcIm51bWJlclwiID8gdGhpcy5jbGllbnRzW2NsaWVudENvdW50XSA6IHVuZGVmaW5lZFxuXG4gICAgICBpZiAodHlwZW9mIHRyYW5zZmVySWQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcImNsaWVudEZpbGUgdHJhbnNmZXJJZCBtdXN0IGJlIGEgbnVtYmVyXCIpXG5cbiAgICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBmaWxlUGF0aCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aGlzLndvcmtlcj8ucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwiY2xpZW50RmlsZVJlc3VsdFwiLCByZXN1bHQ6IFwiYWJvcnRlZFwiLCB0cmFuc2ZlcklkfSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHZvaWQgdGhpcy5lbnF1ZXVlQ2xpZW50Q29udHJvbChjbGllbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2xpZW50LnNlbmRGaWxlKGZpbGVQYXRoLCBzZW5kQm9keSAhPT0gZmFsc2UpXG5cbiAgICAgICAgdGhpcy53b3JrZXI/LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcImNsaWVudEZpbGVSZXN1bHRcIiwgcmVzdWx0LCB0cmFuc2ZlcklkfSlcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gZGVsaXZlciBmaWxlIHJlc3BvbnNlXCIsIHtjbGllbnRDb3VudDogY2xpZW50LmNsaWVudENvdW50LCBmaWxlUGF0aH0sIGVycm9yXSlcbiAgICAgICAgdGhpcy53b3JrZXI/LnBvc3RNZXNzYWdlKHtjb21tYW5kOiBcImNsaWVudEZpbGVSZXN1bHRcIiwgcmVzdWx0OiBcImFib3J0ZWRcIiwgdHJhbnNmZXJJZH0pXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImNsaWVudENsb3NlXCIpIHtcbiAgICAgIGNvbnN0IHtjbGllbnRDb3VudH0gPSBkYXRhXG4gICAgICBjb25zdCBjbGllbnQgPSB0eXBlb2YgY2xpZW50Q291bnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdIDogdW5kZWZpbmVkXG5cbiAgICAgIGlmICghY2xpZW50KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgVmVsb2Npb3VzIHdvcmtlciAke3RoaXMud29ya2VyQ291bnR9IHJlcXVlc3RlZCBjbG9zZSBmb3IgbWlzc2luZyBjbGllbnQgJHtjbGllbnRDb3VudH1gLCBkYXRhXSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHZvaWQgdGhpcy5lbnF1ZXVlQ2xpZW50Q29udHJvbChjbGllbnQsICgpID0+IGNsaWVudC5lbmQoKSlcbiAgICAgICAgLmZpbmFsbHkoKCkgPT4gZGVsZXRlIHRoaXMuY2xpZW50c1tjbGllbnQuY2xpZW50Q291bnRdKVxuICAgIH0gZWxzZSBpZiAoY29tbWFuZCA9PSBcImRlYnVnU25hcHNob3RcIikge1xuICAgICAgY29uc3Qge3JlcXVlc3RJZCwgc25hcHNob3R9ID0gZGF0YVxuICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0SWQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcImRlYnVnU25hcHNob3QgcmVxdWVzdElkIG11c3QgYmUgYSBudW1iZXJcIilcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLl9kZWJ1Z1NuYXBzaG90UmVxdWVzdHMuZ2V0KHJlcXVlc3RJZClcblxuICAgICAgaWYgKHJlcXVlc3QpIHtcbiAgICAgICAgdGhpcy5fZGVidWdTbmFwc2hvdFJlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpXG4gICAgICAgIHJlcXVlc3QucmVzb2x2ZShzbmFwc2hvdCB8fCB7fSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGNvbW1hbmQgPT0gXCJzaHV0ZG93bkNvbXBsZXRlXCIpIHtcbiAgICAgIHRoaXMuX3N0b3BSZXNvbHZlPy4oKVxuICAgICAgdGhpcy5fc3RvcFJlc29sdmUgPSBudWxsXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwid2Vic29ja2V0UHVibGlzaFwiKSB7XG4gICAgICBjb25zdCB7Y2hhbm5lbCwgcGF5bG9hZH0gPSBkYXRhXG5cbiAgICAgIGlmICh0eXBlb2YgY2hhbm5lbCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXb3JrZXIgd2Vic29ja2V0IHB1Ymxpc2ggY2hhbm5lbCBtdXN0IGJlIGEgc3RyaW5nXCIpXG4gICAgICB9XG5cbiAgICAgIHdlYnNvY2tldEV2ZW50c0hvc3QucHVibGlzaCh7Y2hhbm5lbCwgcGF5bG9hZH0pXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwid2Vic29ja2V0VjJCcm9hZGNhc3RcIikge1xuICAgICAgY29uc3Qge2JvZHksIGJyb2FkY2FzdFBhcmFtcywgY2hhbm5lbH0gPSBkYXRhXG5cbiAgICAgIGlmICh0eXBlb2YgY2hhbm5lbCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXb3JrZXIgd2Vic29ja2V0IHYyLWJyb2FkY2FzdCBjaGFubmVsIG11c3QgYmUgYSBzdHJpbmdcIilcbiAgICAgIH1cblxuICAgICAgd2Vic29ja2V0RXZlbnRzSG9zdC5icm9hZGNhc3RWMih7XG4gICAgICAgIGJvZHksXG4gICAgICAgIGJyb2FkY2FzdFBhcmFtczogYnJvYWRjYXN0UGFyYW1zIHx8IHt9LFxuICAgICAgICBjaGFubmVsLFxuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICAgIH0pXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwid2Vic29ja2V0U2Vzc2lvbk93bmVkXCIpIHtcbiAgICAgIGlmICh0eXBlb2YgZGF0YS5zZXNzaW9uSWQgIT09IFwic3RyaW5nXCIpIHRocm93IG5ldyBFcnJvcihcIldvcmtlciB3ZWJzb2NrZXQgc2Vzc2lvbiBpZCBtdXN0IGJlIGEgc3RyaW5nXCIpXG4gICAgICBpZiAodGhpcy5vbldlYnNvY2tldFNlc3Npb25Pd25lZCkgdGhpcy5vbldlYnNvY2tldFNlc3Npb25Pd25lZCh7c2Vzc2lvbklkOiBkYXRhLnNlc3Npb25JZCwgd29ya2VySGFuZGxlcjogdGhpc30pXG4gICAgfSBlbHNlIGlmIChjb21tYW5kID09IFwid2Vic29ja2V0U2Vzc2lvblJlbGVhc2VkXCIpIHtcbiAgICAgIGlmICh0eXBlb2YgZGF0YS5zZXNzaW9uSWQgIT09IFwic3RyaW5nXCIpIHRocm93IG5ldyBFcnJvcihcIldvcmtlciB3ZWJzb2NrZXQgc2Vzc2lvbiBpZCBtdXN0IGJlIGEgc3RyaW5nXCIpXG4gICAgICBpZiAodGhpcy5vbldlYnNvY2tldFNlc3Npb25SZWxlYXNlZCkgdGhpcy5vbldlYnNvY2tldFNlc3Npb25SZWxlYXNlZCh7c2Vzc2lvbklkOiBkYXRhLnNlc3Npb25JZCwgd29ya2VySGFuZGxlcjogdGhpc30pXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBjb21tYW5kOiAke2NvbW1hbmR9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJlc2VydmVzIHNvY2tldCBvdXRwdXQgb3JkZXJpbmcgZm9yIG9uZSBjbGllbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vc2VydmVyLWNsaWVudC5qc1wiKS5kZWZhdWx0fSBjbGllbnQgLSBDbGllbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgVWludDhBcnJheX0gb3V0cHV0IC0gQ29tcGxldGUgb3V0cHV0IGJ1ZmZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUXVldWVkIGRlbGl2ZXJ5LlxuICAgKi9cbiAgZW5xdWV1ZUNsaWVudEZyYW1lKGNsaWVudCwgb3V0cHV0KSB7XG4gICAgY29uc3QgYnl0ZUxlbmd0aCA9IHR5cGVvZiBvdXRwdXQgPT09IFwic3RyaW5nXCIgPyBCdWZmZXIuYnl0ZUxlbmd0aChvdXRwdXQpIDogb3V0cHV0LmJ5dGVMZW5ndGhcblxuICAgIHJldHVybiB0aGlzLl9kZWxpdmVyeVF1ZXVlRm9yKGNsaWVudCkuZW5xdWV1ZUZyYW1lKHtcbiAgICAgIGJ5dGVMZW5ndGgsXG4gICAgICBkZWxpdmVyeTogKCkgPT4gY2xpZW50LnNlbmQob3V0cHV0KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUHJlc2VydmVzIG9yZGVyaW5nIGZvciBhIGRlbGl2ZXJ5IHRoYXQgcmV0YWlucyBubyBjb21wbGV0ZSBvdXRwdXQgZnJhbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vc2VydmVyLWNsaWVudC5qc1wiKS5kZWZhdWx0fSBjbGllbnQgLSBDbGllbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gZGVsaXZlcnkgLSBEZWxpdmVyeSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFF1ZXVlZCBkZWxpdmVyeS5cbiAgICovXG4gIGVucXVldWVDbGllbnRDb250cm9sKGNsaWVudCwgZGVsaXZlcnkpIHtcbiAgICByZXR1cm4gdGhpcy5fZGVsaXZlcnlRdWV1ZUZvcihjbGllbnQpLmVucXVldWVDb250cm9sKGRlbGl2ZXJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgb3IgY3JlYXRlcyBvbmUgY2xpZW50J3MgZGVsaXZlcnkgcXVldWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vc2VydmVyLWNsaWVudC5qc1wiKS5kZWZhdWx0fSBjbGllbnQgLSBDbGllbnQgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtDbGllbnREZWxpdmVyeVF1ZXVlfSAtIENsaWVudC1vd25lZCBkZWxpdmVyeSBxdWV1ZS5cbiAgICovXG4gIF9kZWxpdmVyeVF1ZXVlRm9yKGNsaWVudCkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5fY2xpZW50RGVsaXZlcnlRdWV1ZXMuZ2V0KGNsaWVudC5jbGllbnRDb3VudClcbiAgICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZ1xuXG4gICAgY29uc3Qge21heEJ5dGVzLCBtYXhGcmFtZXN9ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldE91dGJvdW5kUXVldWVMaW1pdHMoKVxuICAgIGNvbnN0IHF1ZXVlID0gbmV3IENsaWVudERlbGl2ZXJ5UXVldWUoe1xuICAgICAgY2xpZW50Q291bnQ6IGNsaWVudC5jbGllbnRDb3VudCxcbiAgICAgIG1heEJ5dGVzLFxuICAgICAgbWF4RnJhbWVzLFxuICAgICAgb25PdmVyZmxvdzogKGVycm9yKSA9PiB7XG4gICAgICAgIHF1ZXVlLmRlc3Ryb3koKVxuICAgICAgICBjbGllbnQuZGVzdHJveShlcnJvcilcbiAgICAgICAgdGhpcy5fcmVwb3J0T3V0Ym91bmRRdWV1ZU92ZXJmbG93KHtjbGllbnRDb3VudDogY2xpZW50LmNsaWVudENvdW50LCBlcnJvcn0pXG4gICAgICB9XG4gICAgfSlcblxuICAgIHRoaXMuX2NsaWVudERlbGl2ZXJ5UXVldWVzLnNldChjbGllbnQuY2xpZW50Q291bnQsIHF1ZXVlKVxuICAgIHJldHVybiBxdWV1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwZXItY2xpZW50IG91dGJvdW5kIHF1ZXVlIG92ZXJmbG93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE92ZXJmbG93IGRldGFpbHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNsaWVudENvdW50IC0gQWZmZWN0ZWQgY2xpZW50LlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gT3ZlcmZsb3cgZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydE91dGJvdW5kUXVldWVPdmVyZmxvdyh7Y2xpZW50Q291bnQsIGVycm9yfSkge1xuICAgIGNvbnN0IGVycm9yUGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtjbGllbnRDb3VudCwgd2Vic29ja2V0T3V0Ym91bmRRdWV1ZU92ZXJmbG93OiB0cnVlLCB3b3JrZXJDb3VudDogdGhpcy53b3JrZXJDb3VudH0sXG4gICAgICBlcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIGVycm9yUGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5lcnJvclBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gV29ya2VyLWxvY2FsIGRlYnVnIHNuYXBzaG90LlxuICAgKi9cbiAgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBpZiAoIXRoaXMud29ya2VyU3RhcnRlZCB8fCAhdGhpcy53b3JrZXIpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe2FjdGl2ZTogZmFsc2UsIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50fSlcbiAgICB9XG5cbiAgICBjb25zdCByZXF1ZXN0SWQgPSArK3RoaXMuX2RlYnVnUmVxdWVzdElkXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5fZGVidWdTbmFwc2hvdFJlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpXG4gICAgICAgIHJlc29sdmUoe2FjdGl2ZTogdHJ1ZSwgZXJyb3I6IFwiVGltZWQgb3V0IHdhaXRpbmcgZm9yIHdvcmtlciBkZWJ1ZyBzbmFwc2hvdFwiLCB3b3JrZXJDb3VudDogdGhpcy53b3JrZXJDb3VudH0pXG4gICAgICB9LCAyMDAwKVxuXG4gICAgICBpZiAodHlwZW9mIHRpbWVvdXQudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGltZW91dC51bnJlZigpXG5cbiAgICAgIGNvbnN0IHdvcmtlciA9IHRoaXMud29ya2VyXG5cbiAgICAgIGlmICghd29ya2VyKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KVxuICAgICAgICByZXNvbHZlKHthY3RpdmU6IGZhbHNlLCB3b3JrZXJDb3VudDogdGhpcy53b3JrZXJDb3VudH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9kZWJ1Z1NuYXBzaG90UmVxdWVzdHMuc2V0KHJlcXVlc3RJZCwge1xuICAgICAgICByZXNvbHZlOiAoc25hcHNob3QpID0+IHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dClcbiAgICAgICAgICByZXNvbHZlKHthY3RpdmU6IHRydWUsIHNuYXBzaG90LCB3b3JrZXJDb3VudDogdGhpcy53b3JrZXJDb3VudH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICB3b3JrZXIucG9zdE1lc3NhZ2Uoe2NvbW1hbmQ6IFwiZGVidWdTbmFwc2hvdFwiLCByZXF1ZXN0SWR9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBzdG9wKCkge1xuICAgIGlmICghdGhpcy53b3JrZXIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICh0aGlzLl9oYXNFeGl0ZWQpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuXG4gICAgdGhpcy5fc3RvcHBpbmcgPSB0cnVlXG4gICAgdGhpcy53b3JrZXJTdGFydGVkID0gZmFsc2VcbiAgICB0aGlzLnVucmVnaXN0ZXJGcm9tRXZlbnRzSG9zdElmTmVlZGVkKClcbiAgICBjb25zdCB3b3JrZXIgPSB0aGlzLndvcmtlclxuXG4gICAgaWYgKCF3b3JrZXIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLl9zdG9wUmVzb2x2ZSA9IHJlc29sdmVcbiAgICAgIHdvcmtlci5wb3N0TWVzc2FnZSh7Y29tbWFuZDogXCJzaHV0ZG93blwifSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzcGF0Y2ggd2Vic29ja2V0IGV2ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY3JlYXRlZEF0XSAtIEV2ZW50IGNyZWF0aW9uIHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ldmVudElkXSAtIEV2ZW50IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZGlzcGF0Y2hXZWJzb2NrZXRFdmVudCh7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkLCBwYXlsb2FkfSkge1xuICAgIC8vIFRlc3QgYW5kIHNodXRkb3duIHBhdGhzIGNhbiBsZWF2ZSBhIHJlZ2lzdGVyZWQgaGFuZGxlciB3aXRob3V0IGEgbGl2ZSB3b3JrZXItdGhyZWFkIHRyYW5zcG9ydC5cbiAgICBpZiAoIXRoaXMud29ya2VyU3RhcnRlZCkgcmV0dXJuXG4gICAgaWYgKCF0aGlzLndvcmtlciB8fCB0eXBlb2YgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2UgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZSh7Y2hhbm5lbCwgY29tbWFuZDogXCJ3ZWJzb2NrZXRFdmVudFwiLCBjcmVhdGVkQXQsIGV2ZW50SWQsIHBheWxvYWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcndhcmRzIGEgVjIgY2hhbm5lbCBicm9hZGNhc3QgdG8gdGhpcyB3b3JrZXIncyB0aHJlYWQgc28gaXQgY2FuXG4gICAqIGRpc3BhdGNoIHRvIGFueSBsb2NhbGx5LXJlZ2lzdGVyZWQgVjIgc3Vic2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYnJvYWRjYXN0UGFyYW1zIC0gUm91dGluZyBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmJvZHkgLSBNZXNzYWdlIGJvZHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ldmVudElkXSAtIFBlcnNpc3RlZCBldmVudCBpZCBmb3IgcmVwbGF5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY3JlYXRlZEF0XSAtIEV2ZW50IGNyZWF0aW9uIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkaXNwYXRjaFdlYnNvY2tldFYyQnJvYWRjYXN0KHtib2R5LCBicm9hZGNhc3RQYXJhbXMsIGNoYW5uZWwsIGV2ZW50SWQsIGNyZWF0ZWRBdH0pIHtcbiAgICBpZiAoIXRoaXMud29ya2VyU3RhcnRlZCkgcmV0dXJuXG4gICAgaWYgKCF0aGlzLndvcmtlciB8fCB0eXBlb2YgdGhpcy53b3JrZXIucG9zdE1lc3NhZ2UgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICB0aGlzLndvcmtlci5wb3N0TWVzc2FnZSh7Ym9keSwgYnJvYWRjYXN0UGFyYW1zLCBjaGFubmVsLCBjb21tYW5kOiBcIndlYnNvY2tldFYyQnJvYWRjYXN0XCIsIGV2ZW50SWQsIGNyZWF0ZWRBdH0pXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGlzIHdvcmtlcidzIGlzb2xhdGVkIFYyIGJyb2FkY2FzdCB0YXJnZXQuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNIdHRwU2VydmVyV29ya2VyfSAtIFRoaXMgd29ya2VyIGhhbmRsZXIuXG4gICAqL1xuICB3ZWJzb2NrZXRWMkJyb2FkY2FzdERpc3BhdGNoS2V5KCkge1xuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciB3aXRoIGV2ZW50cyBob3N0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgcmVnaXN0ZXJXaXRoRXZlbnRzSG9zdCgpIHtcbiAgICBpZiAodGhpcy51bnJlZ2lzdGVyRnJvbUV2ZW50c0hvc3QpIHJldHVyblxuXG4gICAgdGhpcy51bnJlZ2lzdGVyRnJvbUV2ZW50c0hvc3QgPSB3ZWJzb2NrZXRFdmVudHNIb3N0LnJlZ2lzdGVyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnJlZ2lzdGVyIGZyb20gZXZlbnRzIGhvc3QgaWYgbmVlZGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgdW5yZWdpc3RlckZyb21FdmVudHNIb3N0SWZOZWVkZWQoKSB7XG4gICAgaWYgKCF0aGlzLnVucmVnaXN0ZXJGcm9tRXZlbnRzSG9zdCkgcmV0dXJuXG5cbiAgICB0aGlzLnVucmVnaXN0ZXJGcm9tRXZlbnRzSG9zdCgpXG4gICAgdGhpcy51bnJlZ2lzdGVyRnJvbUV2ZW50c0hvc3QgPSBudWxsXG4gIH1cbn1cbiJdfQ==