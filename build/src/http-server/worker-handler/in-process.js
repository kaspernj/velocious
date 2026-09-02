// @ts-check
import Client from "../client/index.js";
import ClientDeliveryQueue from "../client-delivery-queue.js";
import dispatchChannelSubscribers from "./channel-subscriber-dispatch.js";
import Logger from "../../logger.js";
import websocketEventsHost from "../websocket-events-host.js";
/**
 * In-process worker handler that processes HTTP requests in the main thread
 * instead of spawning a Worker thread. This allows the test runner's database
 * connection context to be shared with HTTP request handlers, so model-created
 * records in tests are visible to HTTP endpoints.
 */
export default class VelociousHttpServerInProcessHandler {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {number} args.workerCount - Worker count.
     */
    constructor({ configuration, workerCount }) {
        this.configuration = configuration;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<number, {deliveryQueue: ClientDeliveryQueue, httpClient: Client, serverClient: import("../server-client.js").default}>} */
        this.clients = {};
        /** @type {Set<Promise<void>>} */
        this.pendingClientCloseCleanups = new Set();
        this.logger = new Logger(this);
        this.workerCount = workerCount;
        this.unregisterFromEventsHost = websocketEventsHost.register(/** @type {ReturnType<typeof JSON.parse>} */ (this));
        this._stopping = false;
    }
    /**
     * Runs start.
     * @returns {Promise<void>} */
    async start() {
        await this.logger.debug(() => `In-process handler ${this.workerCount} started`);
    }
    /**
     * Runs add socket connection.
     * @param {import("../server-client.js").default} serverClient - Server client instance.
     * @returns {void}
     */
    addSocketConnection(serverClient) {
        const clientCount = serverClient.clientCount;
        const httpClient = new Client({
            clientCount,
            configuration: this.configuration,
            remoteAddress: serverClient.remoteAddress
        });
        const { maxBytes, maxFrames } = this.configuration.getWebsocketOutboundQueueLimits();
        const deliveryQueue = new ClientDeliveryQueue({
            clientCount,
            maxBytes,
            maxFrames,
            onOverflow: (error) => {
                deliveryQueue.destroy();
                serverClient.destroy(error);
                this._reportOutboundQueueOverflow({ clientCount, error });
            }
        });
        httpClient.events.on("output", (output, { websocketFrame = false } = {}) => {
            if (output !== null && output !== undefined) {
                const delivery = () => serverClient.send(output);
                const queued = websocketFrame
                    ? deliveryQueue.enqueueFrame({
                        byteLength: typeof output === "string" ? Buffer.byteLength(output) : output.byteLength,
                        delivery
                    })
                    : deliveryQueue.enqueueControl(delivery);
                void queued.catch((error) => {
                    this.logger.error(() => ["Failed to deliver client output", { clientCount }, error]);
                });
            }
        });
        httpClient.events.on("file", ({ filePath, sendBody, settle }) => {
            void deliveryQueue.enqueueControl(async () => {
                await settle(await serverClient.sendFile(filePath, sendBody));
            }).catch((error) => {
                this.logger.error(() => ["Failed to deliver file response", { clientCount, filePath }, error]);
                void settle("aborted");
            });
        });
        httpClient.events.on("close", () => {
            void deliveryQueue.enqueueControl(() => serverClient.end())
                .finally(() => delete this.clients[clientCount]);
        });
        serverClient.events.on("close", () => {
            deliveryQueue.destroy();
            const cleanup = httpClient.abortPendingFileResponses()
                .catch((error) => {
                this.logger.warn("Failed to abort file responses after client close", error);
            })
                .finally(() => {
                this.pendingClientCloseCleanups.delete(cleanup);
                delete this.clients[clientCount];
            });
            this.pendingClientCloseCleanups.add(cleanup);
        });
        this.clients[clientCount] = { deliveryQueue, httpClient, serverClient };
        // Create a message-port shim so ServerClient.onSocketData can route data
        // to the in-process HTTP Client without needing a real worker thread.
        const messagePortShim = /** @type {import("worker_threads").Worker} */ ( /** @type {ReturnType<typeof JSON.parse>} */({
            postMessage: (/** @type {{command: string, chunk?: Buffer | Uint8Array | string, clientCount?: number}} */ data) => {
                if (data.command === "clientWrite" && data.chunk) {
                    const chunk = typeof data.chunk === "string" ? Buffer.from(data.chunk) : Buffer.from(data.chunk);
                    httpClient.onWrite(chunk);
                }
            }
        }));
        serverClient.setWorker(messagePortShim);
        serverClient.listen();
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
     * Runs stop.
     * @returns {Promise<void>} */
    async stop() {
        this._stopping = true;
        for (const { httpClient, serverClient } of Object.values(this.clients)) {
            await Promise.all([
                httpClient.abortPendingFileResponses().catch((error) => {
                    this.logger.warn("Failed to abort file responses during shutdown", error);
                }),
                serverClient.end().catch((error) => {
                    this.logger.warn("Failed to close client during shutdown", error);
                })
            ]);
        }
        await Promise.all(this.pendingClientCloseCleanups);
        this.clients = {};
        this.unregisterFromEventsHost?.();
    }
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
    dispatchWebsocketV2Broadcast({ body, broadcastParams, channel, eventId }) {
        if (!this.configuration)
            return;
        return this.configuration._broadcastToChannelLocal(channel, broadcastParams, body, { eventId });
    }
    /**
     * Gets the configuration-wide V2 broadcast target shared by in-process handlers.
     * @returns {import("../../configuration.js").default} - Shared configuration target.
     */
    websocketV2BroadcastDispatchKey() {
        return this.configuration;
    }
    /**
     * Runs dispatch websocket event.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {string} [args.createdAt] - Event creation time.
     * @param {string} [args.eventId] - Event identifier.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {void}
     */
    dispatchWebsocketEvent({ channel, createdAt, eventId, payload }) {
        for (const { httpClient } of Object.values(this.clients)) {
            const session = httpClient.websocketSession;
            if (!session)
                continue;
            void session.sendEvent(channel, payload, { createdAt, eventId });
        }
        if (this.configuration) {
            // Isolate subscriber failures from breaking the in-process handler,
            // but still surface them to the framework error events so bug
            // reporters can pick them up.
            void dispatchChannelSubscribers({ channel, configuration: this.configuration, createdAt, eventId, logger: this.logger, payload });
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW4tcHJvY2Vzcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93b3JrZXItaGFuZGxlci9pbi1wcm9jZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxvQkFBb0IsQ0FBQTtBQUN2QyxPQUFPLG1CQUFtQixNQUFNLDZCQUE2QixDQUFBO0FBQzdELE9BQU8sMEJBQTBCLE1BQU0sa0NBQWtDLENBQUE7QUFDekUsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUU3RDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUNBQW1DO0lBQ3REOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUM7UUFDdEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFFbEM7O21KQUUySTtRQUMzSSxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUVqQixpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLDBCQUEwQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFM0MsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUM5QixJQUFJLENBQUMsd0JBQXdCLEdBQUcsbUJBQW1CLENBQUMsUUFBUSxDQUFDLDRDQUE0QyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUNqSCxJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQTtJQUN4QixDQUFDO0lBRUQ7O2tDQUU4QjtJQUM5QixLQUFLLENBQUMsS0FBSztRQUNULE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsc0JBQXNCLElBQUksQ0FB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QUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3ZELE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQTtZQUUzQyxJQUFJLENBQUMsT0FBTztnQkFBRSxTQUFRO1lBRXRCLEtBQUssT0FBTyxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLEVBQUMsU0FBUyxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDaEUsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ3ZCLG9FQUFvRTtZQUNwRSw4REFBOEQ7WUFDOUQsOEJBQThCO1lBQzlCLEtBQUssMEJBQTBCLENBQUMsRUFBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBQ2pJLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENsaWVudCBmcm9tIFwiLi4vY2xpZW50L2luZGV4LmpzXCJcbmltcG9ydCBDbGllbnREZWxpdmVyeVF1ZXVlIGZyb20gXCIuLi9jbGllbnQtZGVsaXZlcnktcXVldWUuanNcIlxuaW1wb3J0IGRpc3BhdGNoQ2hhbm5lbFN1YnNjcmliZXJzIGZyb20gXCIuL2NoYW5uZWwtc3Vic2NyaWJlci1kaXNwYXRjaC5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IHdlYnNvY2tldEV2ZW50c0hvc3QgZnJvbSBcIi4uL3dlYnNvY2tldC1ldmVudHMtaG9zdC5qc1wiXG5cbi8qKlxuICogSW4tcHJvY2VzcyB3b3JrZXIgaGFuZGxlciB0aGF0IHByb2Nlc3NlcyBIVFRQIHJlcXVlc3RzIGluIHRoZSBtYWluIHRocmVhZFxuICogaW5zdGVhZCBvZiBzcGF3bmluZyBhIFdvcmtlciB0aHJlYWQuIFRoaXMgYWxsb3dzIHRoZSB0ZXN0IHJ1bm5lcidzIGRhdGFiYXNlXG4gKiBjb25uZWN0aW9uIGNvbnRleHQgdG8gYmUgc2hhcmVkIHdpdGggSFRUUCByZXF1ZXN0IGhhbmRsZXJzLCBzbyBtb2RlbC1jcmVhdGVkXG4gKiByZWNvcmRzIGluIHRlc3RzIGFyZSB2aXNpYmxlIHRvIEhUVFAgZW5kcG9pbnRzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVySW5Qcm9jZXNzSGFuZGxlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mud29ya2VyQ291bnQgLSBXb3JrZXIgY291bnQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgd29ya2VyQ291bnR9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyLCB7ZGVsaXZlcnlRdWV1ZTogQ2xpZW50RGVsaXZlcnlRdWV1ZSwgaHR0cENsaWVudDogQ2xpZW50LCBzZXJ2ZXJDbGllbnQ6IGltcG9ydChcIi4uL3NlcnZlci1jbGllbnQuanNcIikuZGVmYXVsdH0+fSAqL1xuICAgIHRoaXMuY2xpZW50cyA9IHt9XG5cbiAgICAvKiogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLnBlbmRpbmdDbGllbnRDbG9zZUNsZWFudXBzID0gbmV3IFNldCgpXG5cbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLndvcmtlckNvdW50ID0gd29ya2VyQ291bnRcbiAgICB0aGlzLnVucmVnaXN0ZXJGcm9tRXZlbnRzSG9zdCA9IHdlYnNvY2tldEV2ZW50c0hvc3QucmVnaXN0ZXIoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgIHRoaXMuX3N0b3BwaW5nID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gYEluLXByb2Nlc3MgaGFuZGxlciAke3RoaXMud29ya2VyQ291bnR9IHN0YXJ0ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHNvY2tldCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3NlcnZlci1jbGllbnQuanNcIikuZGVmYXVsdH0gc2VydmVyQ2xpZW50IC0gU2VydmVyIGNsaWVudCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRTb2NrZXRDb25uZWN0aW9uKHNlcnZlckNsaWVudCkge1xuICAgIGNvbnN0IGNsaWVudENvdW50ID0gc2VydmVyQ2xpZW50LmNsaWVudENvdW50XG5cbiAgICBjb25zdCBodHRwQ2xpZW50ID0gbmV3IENsaWVudCh7XG4gICAgICBjbGllbnRDb3VudCxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIHJlbW90ZUFkZHJlc3M6IHNlcnZlckNsaWVudC5yZW1vdGVBZGRyZXNzXG4gICAgfSlcblxuICAgIGNvbnN0IHttYXhCeXRlcywgbWF4RnJhbWVzfSA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRPdXRib3VuZFF1ZXVlTGltaXRzKClcbiAgICBjb25zdCBkZWxpdmVyeVF1ZXVlID0gbmV3IENsaWVudERlbGl2ZXJ5UXVldWUoe1xuICAgICAgY2xpZW50Q291bnQsXG4gICAgICBtYXhCeXRlcyxcbiAgICAgIG1heEZyYW1lcyxcbiAgICAgIG9uT3ZlcmZsb3c6IChlcnJvcikgPT4ge1xuICAgICAgICBkZWxpdmVyeVF1ZXVlLmRlc3Ryb3koKVxuICAgICAgICBzZXJ2ZXJDbGllbnQuZGVzdHJveShlcnJvcilcbiAgICAgICAgdGhpcy5fcmVwb3J0T3V0Ym91bmRRdWV1ZU92ZXJmbG93KHtjbGllbnRDb3VudCwgZXJyb3J9KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBodHRwQ2xpZW50LmV2ZW50cy5vbihcIm91dHB1dFwiLCAob3V0cHV0LCB7d2Vic29ja2V0RnJhbWUgPSBmYWxzZX0gPSB7fSkgPT4ge1xuICAgICAgaWYgKG91dHB1dCAhPT0gbnVsbCAmJiBvdXRwdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBkZWxpdmVyeSA9ICgpID0+IHNlcnZlckNsaWVudC5zZW5kKG91dHB1dClcbiAgICAgICAgY29uc3QgcXVldWVkID0gd2Vic29ja2V0RnJhbWVcbiAgICAgICAgICA/IGRlbGl2ZXJ5UXVldWUuZW5xdWV1ZUZyYW1lKHtcbiAgICAgICAgICAgIGJ5dGVMZW5ndGg6IHR5cGVvZiBvdXRwdXQgPT09IFwic3RyaW5nXCIgPyBCdWZmZXIuYnl0ZUxlbmd0aChvdXRwdXQpIDogb3V0cHV0LmJ5dGVMZW5ndGgsXG4gICAgICAgICAgICBkZWxpdmVyeVxuICAgICAgICAgIH0pXG4gICAgICAgICAgOiBkZWxpdmVyeVF1ZXVlLmVucXVldWVDb250cm9sKGRlbGl2ZXJ5KVxuXG4gICAgICAgIHZvaWQgcXVldWVkLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byBkZWxpdmVyIGNsaWVudCBvdXRwdXRcIiwge2NsaWVudENvdW50fSwgZXJyb3JdKVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBodHRwQ2xpZW50LmV2ZW50cy5vbihcImZpbGVcIiwgKHtmaWxlUGF0aCwgc2VuZEJvZHksIHNldHRsZX0pID0+IHtcbiAgICAgIHZvaWQgZGVsaXZlcnlRdWV1ZS5lbnF1ZXVlQ29udHJvbChhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHNldHRsZShhd2FpdCBzZXJ2ZXJDbGllbnQuc2VuZEZpbGUoZmlsZVBhdGgsIHNlbmRCb2R5KSlcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gZGVsaXZlciBmaWxlIHJlc3BvbnNlXCIsIHtjbGllbnRDb3VudCwgZmlsZVBhdGh9LCBlcnJvcl0pXG4gICAgICAgIHZvaWQgc2V0dGxlKFwiYWJvcnRlZFwiKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaHR0cENsaWVudC5ldmVudHMub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICB2b2lkIGRlbGl2ZXJ5UXVldWUuZW5xdWV1ZUNvbnRyb2woKCkgPT4gc2VydmVyQ2xpZW50LmVuZCgpKVxuICAgICAgICAuZmluYWxseSgoKSA9PiBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XSlcbiAgICB9KVxuXG4gICAgc2VydmVyQ2xpZW50LmV2ZW50cy5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIGRlbGl2ZXJ5UXVldWUuZGVzdHJveSgpXG4gICAgICBjb25zdCBjbGVhbnVwID0gaHR0cENsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKClcbiAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgdG8gYWJvcnQgZmlsZSByZXNwb25zZXMgYWZ0ZXIgY2xpZW50IGNsb3NlXCIsIGVycm9yKVxuICAgICAgICB9KVxuICAgICAgICAuZmluYWxseSgoKSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nQ2xpZW50Q2xvc2VDbGVhbnVwcy5kZWxldGUoY2xlYW51cClcbiAgICAgICAgICBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XVxuICAgICAgICB9KVxuXG4gICAgICB0aGlzLnBlbmRpbmdDbGllbnRDbG9zZUNsZWFudXBzLmFkZChjbGVhbnVwKVxuICAgIH0pXG5cbiAgICB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdID0ge2RlbGl2ZXJ5UXVldWUsIGh0dHBDbGllbnQsIHNlcnZlckNsaWVudH1cblxuICAgIC8vIENyZWF0ZSBhIG1lc3NhZ2UtcG9ydCBzaGltIHNvIFNlcnZlckNsaWVudC5vblNvY2tldERhdGEgY2FuIHJvdXRlIGRhdGFcbiAgICAvLyB0byB0aGUgaW4tcHJvY2VzcyBIVFRQIENsaWVudCB3aXRob3V0IG5lZWRpbmcgYSByZWFsIHdvcmtlciB0aHJlYWQuXG4gICAgY29uc3QgbWVzc2FnZVBvcnRTaGltID0gLyoqIEB0eXBlIHtpbXBvcnQoXCJ3b3JrZXJfdGhyZWFkc1wiKS5Xb3JrZXJ9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoe1xuICAgICAgcG9zdE1lc3NhZ2U6ICgvKiogQHR5cGUge3tjb21tYW5kOiBzdHJpbmcsIGNodW5rPzogQnVmZmVyIHwgVWludDhBcnJheSB8IHN0cmluZywgY2xpZW50Q291bnQ/OiBudW1iZXJ9fSAqLyBkYXRhKSA9PiB7XG4gICAgICAgIGlmIChkYXRhLmNvbW1hbmQgPT09IFwiY2xpZW50V3JpdGVcIiAmJiBkYXRhLmNodW5rKSB7XG4gICAgICAgICAgY29uc3QgY2h1bmsgPSB0eXBlb2YgZGF0YS5jaHVuayA9PT0gXCJzdHJpbmdcIiA/IEJ1ZmZlci5mcm9tKGRhdGEuY2h1bmspIDogQnVmZmVyLmZyb20oZGF0YS5jaHVuaylcblxuICAgICAgICAgIGh0dHBDbGllbnQub25Xcml0ZShjaHVuaylcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pKVxuXG4gICAgc2VydmVyQ2xpZW50LnNldFdvcmtlcihtZXNzYWdlUG9ydFNoaW0pXG4gICAgc2VydmVyQ2xpZW50Lmxpc3RlbigpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIHBlci1jbGllbnQgb3V0Ym91bmQgcXVldWUgb3ZlcmZsb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3ZlcmZsb3cgZGV0YWlscy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY2xpZW50Q291bnQgLSBBZmZlY3RlZCBjbGllbnQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBPdmVyZmxvdyBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0T3V0Ym91bmRRdWV1ZU92ZXJmbG93KHtjbGllbnRDb3VudCwgZXJyb3J9KSB7XG4gICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge2NsaWVudENvdW50LCB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlT3ZlcmZsb3c6IHRydWUsIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50fSxcbiAgICAgIGVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLmVycm9yUGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBzdG9wKCkge1xuICAgIHRoaXMuX3N0b3BwaW5nID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCB7aHR0cENsaWVudCwgc2VydmVyQ2xpZW50fSBvZiBPYmplY3QudmFsdWVzKHRoaXMuY2xpZW50cykpIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgaHR0cENsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBhYm9ydCBmaWxlIHJlc3BvbnNlcyBkdXJpbmcgc2h1dGRvd25cIiwgZXJyb3IpXG4gICAgICAgIH0pLFxuICAgICAgICBzZXJ2ZXJDbGllbnQuZW5kKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBjbG9zZSBjbGllbnQgZHVyaW5nIHNodXRkb3duXCIsIGVycm9yKVxuICAgICAgICB9KVxuICAgICAgXSlcbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLnBlbmRpbmdDbGllbnRDbG9zZUNsZWFudXBzKVxuXG4gICAgdGhpcy5jbGllbnRzID0ge31cbiAgICB0aGlzLnVucmVnaXN0ZXJGcm9tRXZlbnRzSG9zdD8uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbi1wcm9jZXNzIGhhbmRsZXIgcGF0aCBmb3IgVjIgY2hhbm5lbCBicm9hZGNhc3RzLiBObyB3b3JrZXJcbiAgICogYm91bmRhcnkgdG8gY3Jvc3Mg4oCUIGRpc3BhdGNoIGRpcmVjdGx5IHRvIGFueSBtYXRjaGluZyBsaXZlXG4gICAqIHN1YnNjcmlwdGlvbnMgb24gdGhlIHNoYXJlZCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5icm9hZGNhc3RQYXJhbXMgLSBSb3V0aW5nIGZpbHRlciBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuYm9keSAtIE1lc3NhZ2UgYm9keS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmV2ZW50SWRdIC0gUGVyc2lzdGVkIGV2ZW50IGlkIGZvciByZXBsYXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZGlzcGF0Y2hXZWJzb2NrZXRWMkJyb2FkY2FzdCh7Ym9keSwgYnJvYWRjYXN0UGFyYW1zLCBjaGFubmVsLCBldmVudElkfSkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKGNoYW5uZWwsIGJyb2FkY2FzdFBhcmFtcywgYm9keSwge2V2ZW50SWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGNvbmZpZ3VyYXRpb24td2lkZSBWMiBicm9hZGNhc3QgdGFyZ2V0IHNoYXJlZCBieSBpbi1wcm9jZXNzIGhhbmRsZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFNoYXJlZCBjb25maWd1cmF0aW9uIHRhcmdldC5cbiAgICovXG4gIHdlYnNvY2tldFYyQnJvYWRjYXN0RGlzcGF0Y2hLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzcGF0Y2ggd2Vic29ja2V0IGV2ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY3JlYXRlZEF0XSAtIEV2ZW50IGNyZWF0aW9uIHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ldmVudElkXSAtIEV2ZW50IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkaXNwYXRjaFdlYnNvY2tldEV2ZW50KHtjaGFubmVsLCBjcmVhdGVkQXQsIGV2ZW50SWQsIHBheWxvYWR9KSB7XG4gICAgZm9yIChjb25zdCB7aHR0cENsaWVudH0gb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmNsaWVudHMpKSB7XG4gICAgICBjb25zdCBzZXNzaW9uID0gaHR0cENsaWVudC53ZWJzb2NrZXRTZXNzaW9uXG5cbiAgICAgIGlmICghc2Vzc2lvbikgY29udGludWVcblxuICAgICAgdm9pZCBzZXNzaW9uLnNlbmRFdmVudChjaGFubmVsLCBwYXlsb2FkLCB7Y3JlYXRlZEF0LCBldmVudElkfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uKSB7XG4gICAgICAvLyBJc29sYXRlIHN1YnNjcmliZXIgZmFpbHVyZXMgZnJvbSBicmVha2luZyB0aGUgaW4tcHJvY2VzcyBoYW5kbGVyLFxuICAgICAgLy8gYnV0IHN0aWxsIHN1cmZhY2UgdGhlbSB0byB0aGUgZnJhbWV3b3JrIGVycm9yIGV2ZW50cyBzbyBidWdcbiAgICAgIC8vIHJlcG9ydGVycyBjYW4gcGljayB0aGVtIHVwLlxuICAgICAgdm9pZCBkaXNwYXRjaENoYW5uZWxTdWJzY3JpYmVycyh7Y2hhbm5lbCwgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCBjcmVhdGVkQXQsIGV2ZW50SWQsIGxvZ2dlcjogdGhpcy5sb2dnZXIsIHBheWxvYWR9KVxuICAgIH1cbiAgfVxufVxuIl19