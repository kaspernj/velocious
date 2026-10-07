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
        // Streaming responses emit chunks while the request is running. Route
        // their framed output through the counted delivery path so a stalled
        // client cannot buffer engine chunks unboundedly: each chunk settles only
        // after it has been delivered to the socket, which gives the handler
        // backpressure, and the byte/frame limits bound what a silent client can
        // retain before the connection is torn down.
        httpClient.streamOutputSink = (output) => deliveryQueue.enqueueFrame({
            byteLength: Buffer.byteLength(output),
            delivery: () => serverClient.send(output)
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
            const cleanup = Promise.all([
                httpClient.abortPendingFileResponses(),
                httpClient.abortStreamResponses()
            ])
                .then(() => {
                // Buffered responses have no stream to abort, so their in-flight
                // handlers never hear about the socket teardown through the
                // streaming path: notify the running requests directly so they can
                // settle resources (e.g. admission queue positions) in-process.
                httpClient.notifyClientDisconnect();
            })
                .catch((error) => {
                this.logger.warn("Failed to abort responses after client close", error);
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
                httpClient.abortStreamResponses().catch((error) => {
                    this.logger.warn("Failed to abort streaming responses during shutdown", error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW4tcHJvY2Vzcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93b3JrZXItaGFuZGxlci9pbi1wcm9jZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLE1BQU0sTUFBTSxvQkFBb0IsQ0FBQTtBQUN2QyxPQUFPLG1CQUFtQixNQUFNLDZCQUE2QixDQUFBO0FBQzdELE9BQU8sMEJBQTBCLE1BQU0sa0NBQWtDLENBQUE7QUFDekUsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUU3RDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUNBQW1DO0lBQ3REOzs7OztPQUtHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUM7UUFDdEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFFbEM7O21KQUUySTtRQUMzSSxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUVqQixpQ0FBaUM7UUFDakMsSUFBSSxDQUFDLDBCQUEwQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFM0MsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUM5QixJQUFJLENBQUMsd0JBQXdCLEdBQUcsbUJBQW1CLENBQUMsUUFBUSxDQUFDLDRDQUE0QyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUNqSCxJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQTtJQUN4QixDQUFDO0lBRUQ7O2tDQUU4QjtJQUM5QixLQUFLLENBQUMsS0FBSztRQUNULE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsc0JBQXNCLElBQUksQ0FB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S0FBSywwQkFBMEIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDakksQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ2xpZW50IGZyb20gXCIuLi9jbGllbnQvaW5kZXguanNcIlxuaW1wb3J0IENsaWVudERlbGl2ZXJ5UXVldWUgZnJvbSBcIi4uL2NsaWVudC1kZWxpdmVyeS1xdWV1ZS5qc1wiXG5pbXBvcnQgZGlzcGF0Y2hDaGFubmVsU3Vic2NyaWJlcnMgZnJvbSBcIi4vY2hhbm5lbC1zdWJzY3JpYmVyLWRpc3BhdGNoLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgd2Vic29ja2V0RXZlbnRzSG9zdCBmcm9tIFwiLi4vd2Vic29ja2V0LWV2ZW50cy1ob3N0LmpzXCJcblxuLyoqXG4gKiBJbi1wcm9jZXNzIHdvcmtlciBoYW5kbGVyIHRoYXQgcHJvY2Vzc2VzIEhUVFAgcmVxdWVzdHMgaW4gdGhlIG1haW4gdGhyZWFkXG4gKiBpbnN0ZWFkIG9mIHNwYXduaW5nIGEgV29ya2VyIHRocmVhZC4gVGhpcyBhbGxvd3MgdGhlIHRlc3QgcnVubmVyJ3MgZGF0YWJhc2VcbiAqIGNvbm5lY3Rpb24gY29udGV4dCB0byBiZSBzaGFyZWQgd2l0aCBIVFRQIHJlcXVlc3QgaGFuZGxlcnMsIHNvIG1vZGVsLWNyZWF0ZWRcbiAqIHJlY29yZHMgaW4gdGVzdHMgYXJlIHZpc2libGUgdG8gSFRUUCBlbmRwb2ludHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJJblByb2Nlc3NIYW5kbGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy53b3JrZXJDb3VudCAtIFdvcmtlciBjb3VudC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCB3b3JrZXJDb3VudH0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxudW1iZXIsIHtkZWxpdmVyeVF1ZXVlOiBDbGllbnREZWxpdmVyeVF1ZXVlLCBodHRwQ2xpZW50OiBDbGllbnQsIHNlcnZlckNsaWVudDogaW1wb3J0KFwiLi4vc2VydmVyLWNsaWVudC5qc1wiKS5kZWZhdWx0fT59ICovXG4gICAgdGhpcy5jbGllbnRzID0ge31cblxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMucGVuZGluZ0NsaWVudENsb3NlQ2xlYW51cHMgPSBuZXcgU2V0KClcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMud29ya2VyQ291bnQgPSB3b3JrZXJDb3VudFxuICAgIHRoaXMudW5yZWdpc3RlckZyb21FdmVudHNIb3N0ID0gd2Vic29ja2V0RXZlbnRzSG9zdC5yZWdpc3RlcigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgdGhpcy5fc3RvcHBpbmcgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBgSW4tcHJvY2VzcyBoYW5kbGVyICR7dGhpcy53b3JrZXJDb3VudH0gc3RhcnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgc29ja2V0IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vc2VydmVyLWNsaWVudC5qc1wiKS5kZWZhdWx0fSBzZXJ2ZXJDbGllbnQgLSBTZXJ2ZXIgY2xpZW50IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFNvY2tldENvbm5lY3Rpb24oc2VydmVyQ2xpZW50KSB7XG4gICAgY29uc3QgY2xpZW50Q291bnQgPSBzZXJ2ZXJDbGllbnQuY2xpZW50Q291bnRcblxuICAgIGNvbnN0IGh0dHBDbGllbnQgPSBuZXcgQ2xpZW50KHtcbiAgICAgIGNsaWVudENvdW50LFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgcmVtb3RlQWRkcmVzczogc2VydmVyQ2xpZW50LnJlbW90ZUFkZHJlc3NcbiAgICB9KVxuXG4gICAgY29uc3Qge21heEJ5dGVzLCBtYXhGcmFtZXN9ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldE91dGJvdW5kUXVldWVMaW1pdHMoKVxuICAgIGNvbnN0IGRlbGl2ZXJ5UXVldWUgPSBuZXcgQ2xpZW50RGVsaXZlcnlRdWV1ZSh7XG4gICAgICBjbGllbnRDb3VudCxcbiAgICAgIG1heEJ5dGVzLFxuICAgICAgbWF4RnJhbWVzLFxuICAgICAgb25PdmVyZmxvdzogKGVycm9yKSA9PiB7XG4gICAgICAgIGRlbGl2ZXJ5UXVldWUuZGVzdHJveSgpXG4gICAgICAgIHNlcnZlckNsaWVudC5kZXN0cm95KGVycm9yKVxuICAgICAgICB0aGlzLl9yZXBvcnRPdXRib3VuZFF1ZXVlT3ZlcmZsb3coe2NsaWVudENvdW50LCBlcnJvcn0pXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFN0cmVhbWluZyByZXNwb25zZXMgZW1pdCBjaHVua3Mgd2hpbGUgdGhlIHJlcXVlc3QgaXMgcnVubmluZy4gUm91dGVcbiAgICAvLyB0aGVpciBmcmFtZWQgb3V0cHV0IHRocm91Z2ggdGhlIGNvdW50ZWQgZGVsaXZlcnkgcGF0aCBzbyBhIHN0YWxsZWRcbiAgICAvLyBjbGllbnQgY2Fubm90IGJ1ZmZlciBlbmdpbmUgY2h1bmtzIHVuYm91bmRlZGx5OiBlYWNoIGNodW5rIHNldHRsZXMgb25seVxuICAgIC8vIGFmdGVyIGl0IGhhcyBiZWVuIGRlbGl2ZXJlZCB0byB0aGUgc29ja2V0LCB3aGljaCBnaXZlcyB0aGUgaGFuZGxlclxuICAgIC8vIGJhY2twcmVzc3VyZSwgYW5kIHRoZSBieXRlL2ZyYW1lIGxpbWl0cyBib3VuZCB3aGF0IGEgc2lsZW50IGNsaWVudCBjYW5cbiAgICAvLyByZXRhaW4gYmVmb3JlIHRoZSBjb25uZWN0aW9uIGlzIHRvcm4gZG93bi5cbiAgICBodHRwQ2xpZW50LnN0cmVhbU91dHB1dFNpbmsgPSAob3V0cHV0KSA9PiBkZWxpdmVyeVF1ZXVlLmVucXVldWVGcmFtZSh7XG4gICAgICBieXRlTGVuZ3RoOiBCdWZmZXIuYnl0ZUxlbmd0aChvdXRwdXQpLFxuICAgICAgZGVsaXZlcnk6ICgpID0+IHNlcnZlckNsaWVudC5zZW5kKG91dHB1dClcbiAgICB9KVxuXG4gICAgaHR0cENsaWVudC5ldmVudHMub24oXCJvdXRwdXRcIiwgKG91dHB1dCwge3dlYnNvY2tldEZyYW1lID0gZmFsc2V9ID0ge30pID0+IHtcbiAgICAgIGlmIChvdXRwdXQgIT09IG51bGwgJiYgb3V0cHV0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc3QgZGVsaXZlcnkgPSAoKSA9PiBzZXJ2ZXJDbGllbnQuc2VuZChvdXRwdXQpXG4gICAgICAgIGNvbnN0IHF1ZXVlZCA9IHdlYnNvY2tldEZyYW1lXG4gICAgICAgICAgPyBkZWxpdmVyeVF1ZXVlLmVucXVldWVGcmFtZSh7XG4gICAgICAgICAgICBieXRlTGVuZ3RoOiB0eXBlb2Ygb3V0cHV0ID09PSBcInN0cmluZ1wiID8gQnVmZmVyLmJ5dGVMZW5ndGgob3V0cHV0KSA6IG91dHB1dC5ieXRlTGVuZ3RoLFxuICAgICAgICAgICAgZGVsaXZlcnlcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogZGVsaXZlcnlRdWV1ZS5lbnF1ZXVlQ29udHJvbChkZWxpdmVyeSlcblxuICAgICAgICB2b2lkIHF1ZXVlZC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gZGVsaXZlciBjbGllbnQgb3V0cHV0XCIsIHtjbGllbnRDb3VudH0sIGVycm9yXSlcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaHR0cENsaWVudC5ldmVudHMub24oXCJmaWxlXCIsICh7ZmlsZVBhdGgsIHNlbmRCb2R5LCBzZXR0bGV9KSA9PiB7XG4gICAgICB2b2lkIGRlbGl2ZXJ5UXVldWUuZW5xdWV1ZUNvbnRyb2woYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBzZXR0bGUoYXdhaXQgc2VydmVyQ2xpZW50LnNlbmRGaWxlKGZpbGVQYXRoLCBzZW5kQm9keSkpXG4gICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIGRlbGl2ZXIgZmlsZSByZXNwb25zZVwiLCB7Y2xpZW50Q291bnQsIGZpbGVQYXRofSwgZXJyb3JdKVxuICAgICAgICB2b2lkIHNldHRsZShcImFib3J0ZWRcIilcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGh0dHBDbGllbnQuZXZlbnRzLm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgdm9pZCBkZWxpdmVyeVF1ZXVlLmVucXVldWVDb250cm9sKCgpID0+IHNlcnZlckNsaWVudC5lbmQoKSlcbiAgICAgICAgLmZpbmFsbHkoKCkgPT4gZGVsZXRlIHRoaXMuY2xpZW50c1tjbGllbnRDb3VudF0pXG4gICAgfSlcblxuICAgIHNlcnZlckNsaWVudC5ldmVudHMub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICBkZWxpdmVyeVF1ZXVlLmRlc3Ryb3koKVxuICAgICAgY29uc3QgY2xlYW51cCA9IFByb21pc2UuYWxsKFtcbiAgICAgICAgaHR0cENsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCksXG4gICAgICAgIGh0dHBDbGllbnQuYWJvcnRTdHJlYW1SZXNwb25zZXMoKVxuICAgICAgXSlcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIEJ1ZmZlcmVkIHJlc3BvbnNlcyBoYXZlIG5vIHN0cmVhbSB0byBhYm9ydCwgc28gdGhlaXIgaW4tZmxpZ2h0XG4gICAgICAgICAgLy8gaGFuZGxlcnMgbmV2ZXIgaGVhciBhYm91dCB0aGUgc29ja2V0IHRlYXJkb3duIHRocm91Z2ggdGhlXG4gICAgICAgICAgLy8gc3RyZWFtaW5nIHBhdGg6IG5vdGlmeSB0aGUgcnVubmluZyByZXF1ZXN0cyBkaXJlY3RseSBzbyB0aGV5IGNhblxuICAgICAgICAgIC8vIHNldHRsZSByZXNvdXJjZXMgKGUuZy4gYWRtaXNzaW9uIHF1ZXVlIHBvc2l0aW9ucykgaW4tcHJvY2Vzcy5cbiAgICAgICAgICBodHRwQ2xpZW50Lm5vdGlmeUNsaWVudERpc2Nvbm5lY3QoKVxuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBhYm9ydCByZXNwb25zZXMgYWZ0ZXIgY2xpZW50IGNsb3NlXCIsIGVycm9yKVxuICAgICAgICB9KVxuICAgICAgICAuZmluYWxseSgoKSA9PiB7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nQ2xpZW50Q2xvc2VDbGVhbnVwcy5kZWxldGUoY2xlYW51cClcbiAgICAgICAgICBkZWxldGUgdGhpcy5jbGllbnRzW2NsaWVudENvdW50XVxuICAgICAgICB9KVxuXG4gICAgICB0aGlzLnBlbmRpbmdDbGllbnRDbG9zZUNsZWFudXBzLmFkZChjbGVhbnVwKVxuICAgIH0pXG5cbiAgICB0aGlzLmNsaWVudHNbY2xpZW50Q291bnRdID0ge2RlbGl2ZXJ5UXVldWUsIGh0dHBDbGllbnQsIHNlcnZlckNsaWVudH1cblxuICAgIC8vIENyZWF0ZSBhIG1lc3NhZ2UtcG9ydCBzaGltIHNvIFNlcnZlckNsaWVudC5vblNvY2tldERhdGEgY2FuIHJvdXRlIGRhdGFcbiAgICAvLyB0byB0aGUgaW4tcHJvY2VzcyBIVFRQIENsaWVudCB3aXRob3V0IG5lZWRpbmcgYSByZWFsIHdvcmtlciB0aHJlYWQuXG4gICAgY29uc3QgbWVzc2FnZVBvcnRTaGltID0gLyoqIEB0eXBlIHtpbXBvcnQoXCJ3b3JrZXJfdGhyZWFkc1wiKS5Xb3JrZXJ9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoe1xuICAgICAgcG9zdE1lc3NhZ2U6ICgvKiogQHR5cGUge3tjb21tYW5kOiBzdHJpbmcsIGNodW5rPzogQnVmZmVyIHwgVWludDhBcnJheSB8IHN0cmluZywgY2xpZW50Q291bnQ/OiBudW1iZXJ9fSAqLyBkYXRhKSA9PiB7XG4gICAgICAgIGlmIChkYXRhLmNvbW1hbmQgPT09IFwiY2xpZW50V3JpdGVcIiAmJiBkYXRhLmNodW5rKSB7XG4gICAgICAgICAgY29uc3QgY2h1bmsgPSB0eXBlb2YgZGF0YS5jaHVuayA9PT0gXCJzdHJpbmdcIiA/IEJ1ZmZlci5mcm9tKGRhdGEuY2h1bmspIDogQnVmZmVyLmZyb20oZGF0YS5jaHVuaylcblxuICAgICAgICAgIGh0dHBDbGllbnQub25Xcml0ZShjaHVuaylcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pKVxuXG4gICAgc2VydmVyQ2xpZW50LnNldFdvcmtlcihtZXNzYWdlUG9ydFNoaW0pXG4gICAgc2VydmVyQ2xpZW50Lmxpc3RlbigpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIHBlci1jbGllbnQgb3V0Ym91bmQgcXVldWUgb3ZlcmZsb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3ZlcmZsb3cgZGV0YWlscy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY2xpZW50Q291bnQgLSBBZmZlY3RlZCBjbGllbnQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBPdmVyZmxvdyBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0T3V0Ym91bmRRdWV1ZU92ZXJmbG93KHtjbGllbnRDb3VudCwgZXJyb3J9KSB7XG4gICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge2NsaWVudENvdW50LCB3ZWJzb2NrZXRPdXRib3VuZFF1ZXVlT3ZlcmZsb3c6IHRydWUsIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50fSxcbiAgICAgIGVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLmVycm9yUGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBzdG9wKCkge1xuICAgIHRoaXMuX3N0b3BwaW5nID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCB7aHR0cENsaWVudCwgc2VydmVyQ2xpZW50fSBvZiBPYmplY3QudmFsdWVzKHRoaXMuY2xpZW50cykpIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgaHR0cENsaWVudC5hYm9ydFBlbmRpbmdGaWxlUmVzcG9uc2VzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBhYm9ydCBmaWxlIHJlc3BvbnNlcyBkdXJpbmcgc2h1dGRvd25cIiwgZXJyb3IpXG4gICAgICAgIH0pLFxuICAgICAgICBodHRwQ2xpZW50LmFib3J0U3RyZWFtUmVzcG9uc2VzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBhYm9ydCBzdHJlYW1pbmcgcmVzcG9uc2VzIGR1cmluZyBzaHV0ZG93blwiLCBlcnJvcilcbiAgICAgICAgfSksXG4gICAgICAgIHNlcnZlckNsaWVudC5lbmQoKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHRvIGNsb3NlIGNsaWVudCBkdXJpbmcgc2h1dGRvd25cIiwgZXJyb3IpXG4gICAgICAgIH0pXG4gICAgICBdKVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKHRoaXMucGVuZGluZ0NsaWVudENsb3NlQ2xlYW51cHMpXG5cbiAgICB0aGlzLmNsaWVudHMgPSB7fVxuICAgIHRoaXMudW5yZWdpc3RlckZyb21FdmVudHNIb3N0Py4oKVxuICB9XG5cbiAgLyoqXG4gICAqIEluLXByb2Nlc3MgaGFuZGxlciBwYXRoIGZvciBWMiBjaGFubmVsIGJyb2FkY2FzdHMuIE5vIHdvcmtlclxuICAgKiBib3VuZGFyeSB0byBjcm9zcyDigJQgZGlzcGF0Y2ggZGlyZWN0bHkgdG8gYW55IG1hdGNoaW5nIGxpdmVcbiAgICogc3Vic2NyaXB0aW9ucyBvbiB0aGUgc2hhcmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmJyb2FkY2FzdFBhcmFtcyAtIFJvdXRpbmcgZmlsdGVyIHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5ib2R5IC0gTWVzc2FnZSBib2R5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZXZlbnRJZF0gLSBQZXJzaXN0ZWQgZXZlbnQgaWQgZm9yIHJlcGxheS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkaXNwYXRjaFdlYnNvY2tldFYyQnJvYWRjYXN0KHtib2R5LCBicm9hZGNhc3RQYXJhbXMsIGNoYW5uZWwsIGV2ZW50SWR9KSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbi5fYnJvYWRjYXN0VG9DaGFubmVsTG9jYWwoY2hhbm5lbCwgYnJvYWRjYXN0UGFyYW1zLCBib2R5LCB7ZXZlbnRJZH0pXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29uZmlndXJhdGlvbi13aWRlIFYyIGJyb2FkY2FzdCB0YXJnZXQgc2hhcmVkIGJ5IGluLXByb2Nlc3MgaGFuZGxlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gU2hhcmVkIGNvbmZpZ3VyYXRpb24gdGFyZ2V0LlxuICAgKi9cbiAgd2Vic29ja2V0VjJCcm9hZGNhc3REaXNwYXRjaEtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNwYXRjaCB3ZWJzb2NrZXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jcmVhdGVkQXRdIC0gRXZlbnQgY3JlYXRpb24gdGltZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmV2ZW50SWRdIC0gRXZlbnQgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGRpc3BhdGNoV2Vic29ja2V0RXZlbnQoe2NoYW5uZWwsIGNyZWF0ZWRBdCwgZXZlbnRJZCwgcGF5bG9hZH0pIHtcbiAgICBmb3IgKGNvbnN0IHtodHRwQ2xpZW50fSBvZiBPYmplY3QudmFsdWVzKHRoaXMuY2xpZW50cykpIHtcbiAgICAgIGNvbnN0IHNlc3Npb24gPSBodHRwQ2xpZW50LndlYnNvY2tldFNlc3Npb25cblxuICAgICAgaWYgKCFzZXNzaW9uKSBjb250aW51ZVxuXG4gICAgICB2b2lkIHNlc3Npb24uc2VuZEV2ZW50KGNoYW5uZWwsIHBheWxvYWQsIHtjcmVhdGVkQXQsIGV2ZW50SWR9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIC8vIElzb2xhdGUgc3Vic2NyaWJlciBmYWlsdXJlcyBmcm9tIGJyZWFraW5nIHRoZSBpbi1wcm9jZXNzIGhhbmRsZXIsXG4gICAgICAvLyBidXQgc3RpbGwgc3VyZmFjZSB0aGVtIHRvIHRoZSBmcmFtZXdvcmsgZXJyb3IgZXZlbnRzIHNvIGJ1Z1xuICAgICAgLy8gcmVwb3J0ZXJzIGNhbiBwaWNrIHRoZW0gdXAuXG4gICAgICB2b2lkIGRpc3BhdGNoQ2hhbm5lbFN1YnNjcmliZXJzKHtjaGFubmVsLCBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sIGNyZWF0ZWRBdCwgZXZlbnRJZCwgbG9nZ2VyOiB0aGlzLmxvZ2dlciwgcGF5bG9hZH0pXG4gICAgfVxuICB9XG59XG4iXX0=