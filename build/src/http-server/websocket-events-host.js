// @ts-check
import { websocketEventLogStoreForConfiguration } from "./websocket-event-log-store.js";
export class VelociousHttpServerWebsocketEventsHost {
    constructor() {
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<import("./worker-handler/index.js").default>} */
        this.handlers = new Set();
        /**
         * Broadcast handlers grouped by the configuration that owns them.
         * @type {Map<import("../configuration.js").default, Set<import("./worker-handler/index.js").default>>} */
        this.broadcastHandlersByConfiguration = new Map();
        /**
         * Ordered publish tails keyed by channel. Each channel persists and
         * dispatches behind its own tail so a slow channel cannot head-of-line
         * block unrelated channels. A rejected tail stays in the map so the
         * channel remains poisoned and observable.
         * @type {Map<string, Promise<void>>} */
        this.publishQueuesByChannel = new Map();
    }
    /**
     * Returns a promise that settles when every channel tail pending at call
     * time has settled (including event-log persistence). Useful when a
     * request handler needs to guarantee its broadcast is persisted before
     * responding — without this, the HTTP response can return before the
     * async event-log write finishes. This is a snapshot barrier: work
     * enqueued after the snapshot is not awaited, and the first rejection in
     * snapshot order is rethrown after every snapshotted tail has settled.
     * @returns {Promise<void>}
     */
    async awaitPendingBroadcasts() {
        const snapshot = [...this.publishQueuesByChannel.values()];
        const results = await Promise.allSettled(snapshot);
        for (const result of results) {
            if (result.status === "rejected")
                throw result.reason;
        }
    }
    /**
     * Runs register.
     * @param {import("./worker-handler/index.js").default} handler - Handler instance.
     * @returns {() => void} - The register.
     */
    register(handler) {
        this.handlers.add(handler);
        let configurationHandlers = this.broadcastHandlersByConfiguration.get(handler.configuration);
        if (!configurationHandlers) {
            configurationHandlers = new Set();
            this.broadcastHandlersByConfiguration.set(handler.configuration, configurationHandlers);
        }
        configurationHandlers.add(handler);
        return () => {
            this.handlers.delete(handler);
            configurationHandlers.delete(handler);
            if (configurationHandlers.size === 0) {
                this.broadcastHandlersByConfiguration.delete(handler.configuration);
            }
        };
    }
    /**
     * Runs publish.
     * @param {object | string} channelOrArgs - Channel name or options object.
     * @param {ReturnType<typeof JSON.parse>} [payloadArg] - Payload data when channel is passed separately.
     * @returns {void} - No return value.
     */
    publish(channelOrArgs, payloadArg) {
        const publishArgs = typeof channelOrArgs === "string"
            ? { channel: channelOrArgs, payload: payloadArg }
            : /** @type {{channel: string, payload: ReturnType<typeof JSON.parse>}} */ (channelOrArgs);
        const channel = publishArgs.channel;
        const payload = publishArgs.payload;
        this._queuePublish({
            callback: async () => {
                const persistedEvent = await this._persistEventIfNeeded({ channel, payload });
                for (const handler of this.handlers) {
                    handler.dispatchWebsocketEvent({
                        channel,
                        createdAt: persistedEvent?.createdAt,
                        eventId: persistedEvent?.id,
                        payload
                    });
                }
            },
            channel,
            errorMessage: "Failed to publish websocket event"
        });
    }
    /**
     * Fan a V2 channel broadcast out to every registered worker handler.
     * Persists the event to the event-log store (if the channel is marked
     * interested) so clients can resume from a `lastEventId` checkpoint.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing filter params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @param {import("../configuration.js").default} args.configuration - Originating configuration.
     * @returns {void}
     */
    broadcastV2({ body, broadcastParams, channel, configuration }) {
        // Chain onto the channel's own publish tail so persistence completes
        // before the next broadcast on that same channel — without this, a
        // subscriber that connects immediately after a broadcast could miss the
        // just-persisted event when replaying from lastEventId on a slow DB.
        // Other channels chain onto their own tails and are not delayed.
        this._queuePublish({
            callback: async () => {
                const persistedEvent = await this._persistV2EventIfNeeded({ body, channel, configuration });
                const dispatchedTargets = new Set();
                for (const handler of this.broadcastHandlersByConfiguration.get(configuration) || []) {
                    const dispatchKey = handler.websocketV2BroadcastDispatchKey();
                    if (dispatchedTargets.has(dispatchKey))
                        continue;
                    dispatchedTargets.add(dispatchKey);
                    handler.dispatchWebsocketV2Broadcast({
                        body,
                        broadcastParams,
                        channel,
                        eventId: persistedEvent?.id,
                        createdAt: persistedEvent?.createdAt
                    });
                }
            },
            channel,
            errorMessage: "Failed to persist/broadcast V2 event",
            originatingConfiguration: configuration
        });
    }
    /**
     * Queues publish work behind the channel's own ordered tail so only work
     * for the same channel serializes — a slow or failed channel never
     * head-of-line blocks unrelated channels.
     * @param {object} args - Options object.
     * @param {() => Promise<void>} args.callback - Publish work to run in channel order.
     * @param {string} args.channel - Channel whose ordered tail the work chains onto.
     * @param {string} args.errorMessage - Message logged when publish work fails.
     * @param {import("../configuration.js").default} [args.originatingConfiguration] - Configuration whose context owns the work.
     * @returns {void}
     */
    _queuePublish({ callback, channel, errorMessage, originatingConfiguration }) {
        const handler = this.handlers.values().next().value;
        const configuration = originatingConfiguration || handler?.configuration;
        const previousTail = this.publishQueuesByChannel.get(channel) || Promise.resolve();
        let queuedPublish;
        if (configuration) {
            queuedPublish = previousTail.then(() => configuration.withoutCurrentTestDatabaseAccessScope(() => {
                return configuration.withoutCurrentConnectionContexts(() => {
                    return configuration.runWithTestSharedConnectionContexts(callback);
                });
            }));
        }
        else {
            queuedPublish = previousTail.then(callback);
        }
        const tail = queuedPublish
            .catch((error) => {
            console.error(errorMessage, error);
            throw error;
        });
        this.publishQueuesByChannel.set(channel, tail);
        // Remove the tail once it settles successfully, but only when it is
        // still the newest tail — an older settled tail must never delete a
        // newer one. A rejected tail stays in the map so the channel remains
        // poisoned and observable through awaitPendingBroadcasts.
        tail.then(() => {
            if (this.publishQueuesByChannel.get(channel) === tail) {
                this.publishQueuesByChannel.delete(channel);
            }
        }, () => undefined);
    }
    /**
     * Runs persist v2 event if needed.
     * @param {object} args - Options.
     * @param {ReturnType<typeof JSON.parse>} args.body - Event body.
     * @param {string} args.channel - Channel name.
     * @param {import("../configuration.js").default} args.configuration - Originating configuration.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata when storage is enabled.
     */
    async _persistV2EventIfNeeded({ body, channel, configuration }) {
        return await this._persistChannelEventIfNeeded({ channel, payload: body, configuration });
    }
    /**
     * Runs persist event if needed.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
     */
    async _persistEventIfNeeded({ channel, payload }) {
        return await this._persistChannelEventIfNeeded({ channel, payload });
    }
    /**
     * Runs persist channel event if needed.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the event store.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
     */
    async _persistChannelEventIfNeeded({ channel, payload, configuration }) {
        const handler = this.handlers.values().next().value;
        const eventConfiguration = configuration || handler?.configuration;
        if (!eventConfiguration)
            return null;
        const websocketEventLogStore = websocketEventLogStoreForConfiguration(eventConfiguration);
        const shouldPersist = await websocketEventLogStore.shouldPersistChannel(channel);
        if (!shouldPersist)
            return null;
        const persistedEvent = await websocketEventLogStore.appendEvent({ channel, payload });
        return {
            createdAt: persistedEvent.createdAt,
            id: persistedEvent.id
        };
    }
}
const websocketEventsHost = new VelociousHttpServerWebsocketEventsHost();
export default websocketEventsHost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWV2ZW50cy1ob3N0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMtaG9zdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLHNDQUFzQyxFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFFckYsTUFBTSxPQUFPLHNDQUFzQztJQUNqRDtRQUNFOztzRUFFOEQ7UUFDOUQsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3pCOztrSEFFMEc7UUFDMUcsSUFBSSxDQUFDLGdDQUFnQyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDakQ7Ozs7O2dEQUt3QztRQUN4QyxJQUFJLENBQUMsc0JBQXNCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQjtRQUMxQixNQUFNLFFBQVEsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUE7UUFDMUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRWxELEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7WUFDN0IsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLFVBQVU7Z0JBQUUsTUFBTSxNQUFNLENBQUMsTUFBTSxDQUFBO1FBQ3ZELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFFBQVEsQ0FBQyxPQUFPO1FBQ2QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDMUIsSUFBSSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUU1RixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUMzQixxQkFBcUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1lBQ2pDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxxQkFBcUIsQ0FBQyxDQUFBO1FBQ3pGLENBQUM7UUFFRCxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFbEMsT0FBTyxHQUFHLEVBQUU7WUFDVixJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUM3QixxQkFBcUIsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUE7WUFFckMsSUFBSSxxQkFBcUIsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3JDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1lBQ3JFLENBQUM7UUFDSCxDQUFDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxPQUFPLENBQUMsYUFBYSxFQUFFLFVBQVU7UUFDL0IsTUFBTSxXQUFXLEdBQUcsT0FBTyxhQUFhLEtBQUssUUFBUTtZQUNuRCxDQUFDLENBQUMsRUFBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUM7WUFDL0MsQ0FBQyxDQUFDLHdFQUF3RSxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDNUYsTUFBTSxPQUFPLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FBQTtRQUNuQyxNQUFNLE9BQU8sR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFBO1FBRW5DLElBQUksQ0FBQyxhQUFhLENBQUM7WUFDakIsUUFBUSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNuQixNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO2dCQUUzRSxLQUFLLE1BQU0sT0FBTyxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztvQkFDcEMsT0FBTyxDQUFDLHNCQUFzQixDQUFDO3dCQUM3QixPQUFPO3dCQUNQLFNBQVMsRUFBRSxjQUFjLEVBQUUsU0FBUzt3QkFDcEMsT0FBTyxFQUFFLGNBQWMsRUFBRSxFQUFFO3dCQUMzQixPQUFPO3FCQUNSLENBQUMsQ0FBQTtnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUNELE9BQU87WUFDUCxZQUFZLEVBQUUsbUNBQW1DO1NBQ2xELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsV0FBVyxDQUFDLEVBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFDO1FBQ3pELHFFQUFxRTtRQUNyRSxtRUFBbUU7UUFDbkUsd0VBQXdFO1FBQ3hFLHFFQUFxRTtRQUNyRSxpRUFBaUU7UUFDakUsSUFBSSxDQUFDLGFBQWEsQ0FBQztZQUNqQixRQUFRLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ25CLE1BQU0sY0FBYyxHQUFHLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO2dCQUN6RixNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7Z0JBRW5DLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztvQkFDckYsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLCtCQUErQixFQUFFLENBQUE7b0JBRTdELElBQUksaUJBQWlCLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQzt3QkFBRSxTQUFRO29CQUVoRCxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUE7b0JBQ2xDLE9BQU8sQ0FBQyw0QkFBNEIsQ0FBQzt3QkFDbkMsSUFBSTt3QkFDSixlQUFlO3dCQUNmLE9BQU87d0JBQ1AsT0FBTyxFQUFFLGNBQWMsRUFBRSxFQUFFO3dCQUMzQixTQUFTLEVBQUUsY0FBYyxFQUFFLFNBQVM7cUJBQ3JDLENBQUMsQ0FBQTtnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUNELE9BQU87WUFDUCxZQUFZLEVBQUUsc0NBQXNDO1lBQ3BELHdCQUF3QixFQUFFLGFBQWE7U0FDeEMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxhQUFhLENBQUMsRUFBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSx3QkFBd0IsRUFBQztRQUN2RSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQTtRQUNuRCxNQUFNLGFBQWEsR0FBRyx3QkFBd0IsSUFBSSxPQUFPLEVBQUUsYUFBYSxDQUFBO1FBQ3hFLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ2xGLElBQUksYUFBYSxDQUFBO1FBRWpCLElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsYUFBYSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsYUFBYSxDQUFDLHFDQUFxQyxDQUFDLEdBQUcsRUFBRTtnQkFDL0YsT0FBTyxhQUFhLENBQUMsZ0NBQWdDLENBQUMsR0FBRyxFQUFFO29CQUN6RCxPQUFPLGFBQWEsQ0FBQyxtQ0FBbUMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDcEUsQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDTixhQUFhLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUM3QyxDQUFDO1FBRUQsTUFBTSxJQUFJLEdBQUcsYUFBYTthQUN2QixLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQ2xDLE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQyxDQUFDLENBQUE7UUFFSixJQUFJLENBQUMsc0JBQXNCLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUU5QyxvRUFBb0U7UUFDcEUsb0VBQW9FO1FBQ3BFLHFFQUFxRTtRQUNyRSwwREFBMEQ7UUFDMUQsSUFBSSxDQUFDLElBQUksQ0FDUCxHQUFHLEVBQUU7WUFDSCxJQUFJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQ3RELElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDN0MsQ0FBQztRQUNILENBQUMsRUFDRCxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQ2hCLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFDO1FBQzFELE9BQU8sTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsRUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO0lBQ3pGLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsRUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFDO1FBQzVDLE9BQU8sTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsRUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtJQUNwRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFDO1FBQ2xFLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFBO1FBQ25ELE1BQU0sa0JBQWtCLEdBQUcsYUFBYSxJQUFJLE9BQU8sRUFBRSxhQUFhLENBQUE7UUFFbEUsSUFBSSxDQUFDLGtCQUFrQjtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXBDLE1BQU0sc0JBQXNCLEdBQUcsc0NBQXNDLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUN6RixNQUFNLGFBQWEsR0FBRyxNQUFNLHNCQUFzQixDQUFDLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRWhGLElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFL0IsTUFBTSxjQUFjLEdBQUcsTUFBTSxzQkFBc0IsQ0FBQyxXQUFXLENBQUMsRUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtRQUVuRixPQUFPO1lBQ0wsU0FBUyxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ25DLEVBQUUsRUFBRSxjQUFjLENBQUMsRUFBRTtTQUN0QixDQUFBO0lBQ0gsQ0FBQztDQUNGO0FBRUQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLHNDQUFzQyxFQUFFLENBQUE7QUFFeEUsZUFBZSxtQkFBbUIsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3dlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9ufSBmcm9tIFwiLi93ZWJzb2NrZXQtZXZlbnQtbG9nLXN0b3JlLmpzXCJcblxuZXhwb3J0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJXZWJzb2NrZXRFdmVudHNIb3N0IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi93b3JrZXItaGFuZGxlci9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLmhhbmRsZXJzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogQnJvYWRjYXN0IGhhbmRsZXJzIGdyb3VwZWQgYnkgdGhlIGNvbmZpZ3VyYXRpb24gdGhhdCBvd25zIHRoZW0uXG4gICAgICogQHR5cGUge01hcDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIFNldDxpbXBvcnQoXCIuL3dvcmtlci1oYW5kbGVyL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICB0aGlzLmJyb2FkY2FzdEhhbmRsZXJzQnlDb25maWd1cmF0aW9uID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogT3JkZXJlZCBwdWJsaXNoIHRhaWxzIGtleWVkIGJ5IGNoYW5uZWwuIEVhY2ggY2hhbm5lbCBwZXJzaXN0cyBhbmRcbiAgICAgKiBkaXNwYXRjaGVzIGJlaGluZCBpdHMgb3duIHRhaWwgc28gYSBzbG93IGNoYW5uZWwgY2Fubm90IGhlYWQtb2YtbGluZVxuICAgICAqIGJsb2NrIHVucmVsYXRlZCBjaGFubmVscy4gQSByZWplY3RlZCB0YWlsIHN0YXlzIGluIHRoZSBtYXAgc28gdGhlXG4gICAgICogY2hhbm5lbCByZW1haW5zIHBvaXNvbmVkIGFuZCBvYnNlcnZhYmxlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLnB1Ymxpc2hRdWV1ZXNCeUNoYW5uZWwgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHNldHRsZXMgd2hlbiBldmVyeSBjaGFubmVsIHRhaWwgcGVuZGluZyBhdCBjYWxsXG4gICAqIHRpbWUgaGFzIHNldHRsZWQgKGluY2x1ZGluZyBldmVudC1sb2cgcGVyc2lzdGVuY2UpLiBVc2VmdWwgd2hlbiBhXG4gICAqIHJlcXVlc3QgaGFuZGxlciBuZWVkcyB0byBndWFyYW50ZWUgaXRzIGJyb2FkY2FzdCBpcyBwZXJzaXN0ZWQgYmVmb3JlXG4gICAqIHJlc3BvbmRpbmcg4oCUIHdpdGhvdXQgdGhpcywgdGhlIEhUVFAgcmVzcG9uc2UgY2FuIHJldHVybiBiZWZvcmUgdGhlXG4gICAqIGFzeW5jIGV2ZW50LWxvZyB3cml0ZSBmaW5pc2hlcy4gVGhpcyBpcyBhIHNuYXBzaG90IGJhcnJpZXI6IHdvcmtcbiAgICogZW5xdWV1ZWQgYWZ0ZXIgdGhlIHNuYXBzaG90IGlzIG5vdCBhd2FpdGVkLCBhbmQgdGhlIGZpcnN0IHJlamVjdGlvbiBpblxuICAgKiBzbmFwc2hvdCBvcmRlciBpcyByZXRocm93biBhZnRlciBldmVyeSBzbmFwc2hvdHRlZCB0YWlsIGhhcyBzZXR0bGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKSB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBbLi4udGhpcy5wdWJsaXNoUXVldWVzQnlDaGFubmVsLnZhbHVlcygpXVxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc25hcHNob3QpXG5cbiAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKSB0aHJvdyByZXN1bHQucmVhc29uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi93b3JrZXItaGFuZGxlci9pbmRleC5qc1wiKS5kZWZhdWx0fSBoYW5kbGVyIC0gSGFuZGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IC0gVGhlIHJlZ2lzdGVyLlxuICAgKi9cbiAgcmVnaXN0ZXIoaGFuZGxlcikge1xuICAgIHRoaXMuaGFuZGxlcnMuYWRkKGhhbmRsZXIpXG4gICAgbGV0IGNvbmZpZ3VyYXRpb25IYW5kbGVycyA9IHRoaXMuYnJvYWRjYXN0SGFuZGxlcnNCeUNvbmZpZ3VyYXRpb24uZ2V0KGhhbmRsZXIuY29uZmlndXJhdGlvbilcblxuICAgIGlmICghY29uZmlndXJhdGlvbkhhbmRsZXJzKSB7XG4gICAgICBjb25maWd1cmF0aW9uSGFuZGxlcnMgPSBuZXcgU2V0KClcbiAgICAgIHRoaXMuYnJvYWRjYXN0SGFuZGxlcnNCeUNvbmZpZ3VyYXRpb24uc2V0KGhhbmRsZXIuY29uZmlndXJhdGlvbiwgY29uZmlndXJhdGlvbkhhbmRsZXJzKVxuICAgIH1cblxuICAgIGNvbmZpZ3VyYXRpb25IYW5kbGVycy5hZGQoaGFuZGxlcilcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShoYW5kbGVyKVxuICAgICAgY29uZmlndXJhdGlvbkhhbmRsZXJzLmRlbGV0ZShoYW5kbGVyKVxuXG4gICAgICBpZiAoY29uZmlndXJhdGlvbkhhbmRsZXJzLnNpemUgPT09IDApIHtcbiAgICAgICAgdGhpcy5icm9hZGNhc3RIYW5kbGVyc0J5Q29uZmlndXJhdGlvbi5kZWxldGUoaGFuZGxlci5jb25maWd1cmF0aW9uKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHB1Ymxpc2guXG4gICAqIEBwYXJhbSB7b2JqZWN0IHwgc3RyaW5nfSBjaGFubmVsT3JBcmdzIC0gQ2hhbm5lbCBuYW1lIG9yIG9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbcGF5bG9hZEFyZ10gLSBQYXlsb2FkIGRhdGEgd2hlbiBjaGFubmVsIGlzIHBhc3NlZCBzZXBhcmF0ZWx5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwdWJsaXNoKGNoYW5uZWxPckFyZ3MsIHBheWxvYWRBcmcpIHtcbiAgICBjb25zdCBwdWJsaXNoQXJncyA9IHR5cGVvZiBjaGFubmVsT3JBcmdzID09PSBcInN0cmluZ1wiXG4gICAgICA/IHtjaGFubmVsOiBjaGFubmVsT3JBcmdzLCBwYXlsb2FkOiBwYXlsb2FkQXJnfVxuICAgICAgOiAvKiogQHR5cGUge3tjaGFubmVsOiBzdHJpbmcsIHBheWxvYWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKGNoYW5uZWxPckFyZ3MpXG4gICAgY29uc3QgY2hhbm5lbCA9IHB1Ymxpc2hBcmdzLmNoYW5uZWxcbiAgICBjb25zdCBwYXlsb2FkID0gcHVibGlzaEFyZ3MucGF5bG9hZFxuXG4gICAgdGhpcy5fcXVldWVQdWJsaXNoKHtcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHBlcnNpc3RlZEV2ZW50ID0gYXdhaXQgdGhpcy5fcGVyc2lzdEV2ZW50SWZOZWVkZWQoe2NoYW5uZWwsIHBheWxvYWR9KVxuXG4gICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiB0aGlzLmhhbmRsZXJzKSB7XG4gICAgICAgICAgaGFuZGxlci5kaXNwYXRjaFdlYnNvY2tldEV2ZW50KHtcbiAgICAgICAgICAgIGNoYW5uZWwsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IHBlcnNpc3RlZEV2ZW50Py5jcmVhdGVkQXQsXG4gICAgICAgICAgICBldmVudElkOiBwZXJzaXN0ZWRFdmVudD8uaWQsXG4gICAgICAgICAgICBwYXlsb2FkXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGNoYW5uZWwsXG4gICAgICBlcnJvck1lc3NhZ2U6IFwiRmFpbGVkIHRvIHB1Ymxpc2ggd2Vic29ja2V0IGV2ZW50XCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZhbiBhIFYyIGNoYW5uZWwgYnJvYWRjYXN0IG91dCB0byBldmVyeSByZWdpc3RlcmVkIHdvcmtlciBoYW5kbGVyLlxuICAgKiBQZXJzaXN0cyB0aGUgZXZlbnQgdG8gdGhlIGV2ZW50LWxvZyBzdG9yZSAoaWYgdGhlIGNoYW5uZWwgaXMgbWFya2VkXG4gICAqIGludGVyZXN0ZWQpIHNvIGNsaWVudHMgY2FuIHJlc3VtZSBmcm9tIGEgYGxhc3RFdmVudElkYCBjaGVja3BvaW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5icm9hZGNhc3RQYXJhbXMgLSBSb3V0aW5nIGZpbHRlciBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuYm9keSAtIE1lc3NhZ2UgYm9keS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE9yaWdpbmF0aW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYnJvYWRjYXN0VjIoe2JvZHksIGJyb2FkY2FzdFBhcmFtcywgY2hhbm5lbCwgY29uZmlndXJhdGlvbn0pIHtcbiAgICAvLyBDaGFpbiBvbnRvIHRoZSBjaGFubmVsJ3Mgb3duIHB1Ymxpc2ggdGFpbCBzbyBwZXJzaXN0ZW5jZSBjb21wbGV0ZXNcbiAgICAvLyBiZWZvcmUgdGhlIG5leHQgYnJvYWRjYXN0IG9uIHRoYXQgc2FtZSBjaGFubmVsIOKAlCB3aXRob3V0IHRoaXMsIGFcbiAgICAvLyBzdWJzY3JpYmVyIHRoYXQgY29ubmVjdHMgaW1tZWRpYXRlbHkgYWZ0ZXIgYSBicm9hZGNhc3QgY291bGQgbWlzcyB0aGVcbiAgICAvLyBqdXN0LXBlcnNpc3RlZCBldmVudCB3aGVuIHJlcGxheWluZyBmcm9tIGxhc3RFdmVudElkIG9uIGEgc2xvdyBEQi5cbiAgICAvLyBPdGhlciBjaGFubmVscyBjaGFpbiBvbnRvIHRoZWlyIG93biB0YWlscyBhbmQgYXJlIG5vdCBkZWxheWVkLlxuICAgIHRoaXMuX3F1ZXVlUHVibGlzaCh7XG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBwZXJzaXN0ZWRFdmVudCA9IGF3YWl0IHRoaXMuX3BlcnNpc3RWMkV2ZW50SWZOZWVkZWQoe2JvZHksIGNoYW5uZWwsIGNvbmZpZ3VyYXRpb259KVxuICAgICAgICBjb25zdCBkaXNwYXRjaGVkVGFyZ2V0cyA9IG5ldyBTZXQoKVxuXG4gICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiB0aGlzLmJyb2FkY2FzdEhhbmRsZXJzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKSB8fCBbXSkge1xuICAgICAgICAgIGNvbnN0IGRpc3BhdGNoS2V5ID0gaGFuZGxlci53ZWJzb2NrZXRWMkJyb2FkY2FzdERpc3BhdGNoS2V5KClcblxuICAgICAgICAgIGlmIChkaXNwYXRjaGVkVGFyZ2V0cy5oYXMoZGlzcGF0Y2hLZXkpKSBjb250aW51ZVxuXG4gICAgICAgICAgZGlzcGF0Y2hlZFRhcmdldHMuYWRkKGRpc3BhdGNoS2V5KVxuICAgICAgICAgIGhhbmRsZXIuZGlzcGF0Y2hXZWJzb2NrZXRWMkJyb2FkY2FzdCh7XG4gICAgICAgICAgICBib2R5LFxuICAgICAgICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgICAgIGV2ZW50SWQ6IHBlcnNpc3RlZEV2ZW50Py5pZCxcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogcGVyc2lzdGVkRXZlbnQ/LmNyZWF0ZWRBdFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBjaGFubmVsLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIkZhaWxlZCB0byBwZXJzaXN0L2Jyb2FkY2FzdCBWMiBldmVudFwiLFxuICAgICAgb3JpZ2luYXRpbmdDb25maWd1cmF0aW9uOiBjb25maWd1cmF0aW9uXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgcHVibGlzaCB3b3JrIGJlaGluZCB0aGUgY2hhbm5lbCdzIG93biBvcmRlcmVkIHRhaWwgc28gb25seSB3b3JrXG4gICAqIGZvciB0aGUgc2FtZSBjaGFubmVsIHNlcmlhbGl6ZXMg4oCUIGEgc2xvdyBvciBmYWlsZWQgY2hhbm5lbCBuZXZlclxuICAgKiBoZWFkLW9mLWxpbmUgYmxvY2tzIHVucmVsYXRlZCBjaGFubmVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLmNhbGxiYWNrIC0gUHVibGlzaCB3b3JrIHRvIHJ1biBpbiBjaGFubmVsIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCB3aG9zZSBvcmRlcmVkIHRhaWwgdGhlIHdvcmsgY2hhaW5zIG9udG8uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmVycm9yTWVzc2FnZSAtIE1lc3NhZ2UgbG9nZ2VkIHdoZW4gcHVibGlzaCB3b3JrIGZhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3Mub3JpZ2luYXRpbmdDb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gd2hvc2UgY29udGV4dCBvd25zIHRoZSB3b3JrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9xdWV1ZVB1Ymxpc2goe2NhbGxiYWNrLCBjaGFubmVsLCBlcnJvck1lc3NhZ2UsIG9yaWdpbmF0aW5nQ29uZmlndXJhdGlvbn0pIHtcbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5oYW5kbGVycy52YWx1ZXMoKS5uZXh0KCkudmFsdWVcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gb3JpZ2luYXRpbmdDb25maWd1cmF0aW9uIHx8IGhhbmRsZXI/LmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBwcmV2aW91c1RhaWwgPSB0aGlzLnB1Ymxpc2hRdWV1ZXNCeUNoYW5uZWwuZ2V0KGNoYW5uZWwpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgbGV0IHF1ZXVlZFB1Ymxpc2hcblxuICAgIGlmIChjb25maWd1cmF0aW9uKSB7XG4gICAgICBxdWV1ZWRQdWJsaXNoID0gcHJldmlvdXNUYWlsLnRoZW4oKCkgPT4gY29uZmlndXJhdGlvbi53aXRob3V0Q3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIGNvbmZpZ3VyYXRpb24ud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKVxuICAgICAgICB9KVxuICAgICAgfSkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXVlZFB1Ymxpc2ggPSBwcmV2aW91c1RhaWwudGhlbihjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCB0YWlsID0gcXVldWVkUHVibGlzaFxuICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yTWVzc2FnZSwgZXJyb3IpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9KVxuXG4gICAgdGhpcy5wdWJsaXNoUXVldWVzQnlDaGFubmVsLnNldChjaGFubmVsLCB0YWlsKVxuXG4gICAgLy8gUmVtb3ZlIHRoZSB0YWlsIG9uY2UgaXQgc2V0dGxlcyBzdWNjZXNzZnVsbHksIGJ1dCBvbmx5IHdoZW4gaXQgaXNcbiAgICAvLyBzdGlsbCB0aGUgbmV3ZXN0IHRhaWwg4oCUIGFuIG9sZGVyIHNldHRsZWQgdGFpbCBtdXN0IG5ldmVyIGRlbGV0ZSBhXG4gICAgLy8gbmV3ZXIgb25lLiBBIHJlamVjdGVkIHRhaWwgc3RheXMgaW4gdGhlIG1hcCBzbyB0aGUgY2hhbm5lbCByZW1haW5zXG4gICAgLy8gcG9pc29uZWQgYW5kIG9ic2VydmFibGUgdGhyb3VnaCBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzLlxuICAgIHRhaWwudGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMucHVibGlzaFF1ZXVlc0J5Q2hhbm5lbC5nZXQoY2hhbm5lbCkgPT09IHRhaWwpIHtcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hRdWV1ZXNCeUNoYW5uZWwuZGVsZXRlKGNoYW5uZWwpXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICAoKSA9PiB1bmRlZmluZWRcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJzaXN0IHYyIGV2ZW50IGlmIG5lZWRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmJvZHkgLSBFdmVudCBib2R5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gT3JpZ2luYXRpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWRBdDogc3RyaW5nLCBpZDogc3RyaW5nfSB8IG51bGw+fSAtIFBlcnNpc3RlZCBldmVudCBtZXRhZGF0YSB3aGVuIHN0b3JhZ2UgaXMgZW5hYmxlZC5cbiAgICovXG4gIGFzeW5jIF9wZXJzaXN0VjJFdmVudElmTmVlZGVkKHtib2R5LCBjaGFubmVsLCBjb25maWd1cmF0aW9ufSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9wZXJzaXN0Q2hhbm5lbEV2ZW50SWZOZWVkZWQoe2NoYW5uZWwsIHBheWxvYWQ6IGJvZHksIGNvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdCBldmVudCBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWRBdDogc3RyaW5nLCBpZDogc3RyaW5nfSB8IG51bGw+fSAtIFBlcnNpc3RlZCBldmVudCBtZXRhZGF0YS5cbiAgICovXG4gIGFzeW5jIF9wZXJzaXN0RXZlbnRJZk5lZWRlZCh7Y2hhbm5lbCwgcGF5bG9hZH0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGVyc2lzdENoYW5uZWxFdmVudElmTmVlZGVkKHtjaGFubmVsLCBwYXlsb2FkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgY2hhbm5lbCBldmVudCBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIGV2ZW50IHN0b3JlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y3JlYXRlZEF0OiBzdHJpbmcsIGlkOiBzdHJpbmd9IHwgbnVsbD59IC0gUGVyc2lzdGVkIGV2ZW50IG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RDaGFubmVsRXZlbnRJZk5lZWRlZCh7Y2hhbm5lbCwgcGF5bG9hZCwgY29uZmlndXJhdGlvbn0pIHtcbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5oYW5kbGVycy52YWx1ZXMoKS5uZXh0KCkudmFsdWVcbiAgICBjb25zdCBldmVudENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IGhhbmRsZXI/LmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghZXZlbnRDb25maWd1cmF0aW9uKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRMb2dTdG9yZSA9IHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uKGV2ZW50Q29uZmlndXJhdGlvbilcbiAgICBjb25zdCBzaG91bGRQZXJzaXN0ID0gYXdhaXQgd2Vic29ja2V0RXZlbnRMb2dTdG9yZS5zaG91bGRQZXJzaXN0Q2hhbm5lbChjaGFubmVsKVxuXG4gICAgaWYgKCFzaG91bGRQZXJzaXN0KSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcGVyc2lzdGVkRXZlbnQgPSBhd2FpdCB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlLmFwcGVuZEV2ZW50KHtjaGFubmVsLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiB7XG4gICAgICBjcmVhdGVkQXQ6IHBlcnNpc3RlZEV2ZW50LmNyZWF0ZWRBdCxcbiAgICAgIGlkOiBwZXJzaXN0ZWRFdmVudC5pZFxuICAgIH1cbiAgfVxufVxuXG5jb25zdCB3ZWJzb2NrZXRFdmVudHNIb3N0ID0gbmV3IFZlbG9jaW91c0h0dHBTZXJ2ZXJXZWJzb2NrZXRFdmVudHNIb3N0KClcblxuZXhwb3J0IGRlZmF1bHQgd2Vic29ja2V0RXZlbnRzSG9zdFxuIl19