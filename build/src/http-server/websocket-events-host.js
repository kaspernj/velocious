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
                const persistedEvent = await this._persistV2EventIfNeeded({ body, broadcastParams, channel, configuration });
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
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing filter params.
     * @param {string} args.channel - Channel name.
     * @param {import("../configuration.js").default} args.configuration - Originating configuration.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata when storage is enabled.
     */
    async _persistV2EventIfNeeded({ body, broadcastParams, channel, configuration }) {
        return await this._persistChannelEventIfNeeded({ broadcastParams, channel, configuration, payload: body });
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
     * Runs persist channel event if needed. Persists the broadcast's routing
     * params (sanitized through the channel class's
     * `replayableBroadcastParams`) so replay can re-apply `matches()` per
     * stream instead of delivering the whole channel's log.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [args.broadcastParams] - Broadcast params to persist for stream-scoped replay.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the event store.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
     */
    async _persistChannelEventIfNeeded({ broadcastParams = null, channel, configuration, payload }) {
        const handler = this.handlers.values().next().value;
        const eventConfiguration = configuration || handler?.configuration;
        if (!eventConfiguration)
            return null;
        const websocketEventLogStore = websocketEventLogStoreForConfiguration(eventConfiguration);
        const shouldPersist = await websocketEventLogStore.shouldPersistChannel(channel);
        if (!shouldPersist)
            return null;
        const ChannelClass = eventConfiguration.getWebsocketChannelClass(channel);
        const params = ChannelClass ? ChannelClass.replayableBroadcastParams(broadcastParams) : broadcastParams;
        const persistedEvent = await websocketEventLogStore.appendEvent({ channel, params, payload });
        return {
            createdAt: persistedEvent.createdAt,
            id: persistedEvent.id
        };
    }
}
const websocketEventsHost = new VelociousHttpServerWebsocketEventsHost();
export default websocketEventsHost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWV2ZW50cy1ob3N0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2h0dHAtc2VydmVyL3dlYnNvY2tldC1ldmVudHMtaG9zdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLHNDQUFzQyxFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFFckYsTUFBTSxPQUFPLHNDQUFzQztJQUNqRDtRQUNFOztzRUFFOEQ7UUFDOUQsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3pCOztrSEFFMEc7UUFDMUcsSUFBSSxDQUFDLGdDQUFnQyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDakQ7Ozs7O2dEQUt3QztRQUN4QyxJQUFJLENBQUMsc0JBQXNCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQjtRQUMxQixNQUFNLFFBQVEsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUE7UUFDMUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRWxELEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7WUFDN0IsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLFVBQVU7Z0JBQUUsTUFBTSxNQUFNLENBQUMsTUFBTSxDQUFBO1FBQ3ZELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFFBQVEsQ0FBQyxPQUFPO1FBQ2QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDMUIsSUFBSSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUU1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QUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQTtRQUNuRCxNQUFNLGtCQUFrQixHQUFHLGFBQWEsSUFBSSxPQUFPLEVBQUUsYUFBYSxDQUFBO1FBRWxFLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVwQyxNQUFNLHNCQUFzQixHQUFHLHNDQUFzQyxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFDekYsTUFBTSxhQUFhLEdBQUcsTUFBTSxzQkFBc0IsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUVoRixJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRS9CLE1BQU0sWUFBWSxHQUFHLGtCQUFrQixDQUFDLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ3pFLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLHlCQUF5QixDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUE7UUFFdkcsTUFBTSxjQUFjLEdBQUcsTUFBTSxzQkFBc0IsQ0FBQyxXQUFXLENBQUMsRUFBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFFM0YsT0FBTztZQUNMLFNBQVMsRUFBRSxjQUFjLENBQUMsU0FBUztZQUNuQyxFQUFFLEVBQUUsY0FBYyxDQUFDLEVBQUU7U0FDdEIsQ0FBQTtJQUNILENBQUM7Q0FDRjtBQUVELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxzQ0FBc0MsRUFBRSxDQUFBO0FBRXhFLGVBQWUsbUJBQW1CLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHt3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbn0gZnJvbSBcIi4vd2Vic29ja2V0LWV2ZW50LWxvZy1zdG9yZS5qc1wiXG5cbmV4cG9ydCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyV2Vic29ja2V0RXZlbnRzSG9zdCB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vd29ya2VyLWhhbmRsZXIvaW5kZXguanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5oYW5kbGVycyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEJyb2FkY2FzdCBoYW5kbGVycyBncm91cGVkIGJ5IHRoZSBjb25maWd1cmF0aW9uIHRoYXQgb3ducyB0aGVtLlxuICAgICAqIEB0eXBlIHtNYXA8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBTZXQ8aW1wb3J0KFwiLi93b3JrZXItaGFuZGxlci9pbmRleC5qc1wiKS5kZWZhdWx0Pj59ICovXG4gICAgdGhpcy5icm9hZGNhc3RIYW5kbGVyc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE9yZGVyZWQgcHVibGlzaCB0YWlscyBrZXllZCBieSBjaGFubmVsLiBFYWNoIGNoYW5uZWwgcGVyc2lzdHMgYW5kXG4gICAgICogZGlzcGF0Y2hlcyBiZWhpbmQgaXRzIG93biB0YWlsIHNvIGEgc2xvdyBjaGFubmVsIGNhbm5vdCBoZWFkLW9mLWxpbmVcbiAgICAgKiBibG9jayB1bnJlbGF0ZWQgY2hhbm5lbHMuIEEgcmVqZWN0ZWQgdGFpbCBzdGF5cyBpbiB0aGUgbWFwIHNvIHRoZVxuICAgICAqIGNoYW5uZWwgcmVtYWlucyBwb2lzb25lZCBhbmQgb2JzZXJ2YWJsZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5wdWJsaXNoUXVldWVzQnlDaGFubmVsID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHByb21pc2UgdGhhdCBzZXR0bGVzIHdoZW4gZXZlcnkgY2hhbm5lbCB0YWlsIHBlbmRpbmcgYXQgY2FsbFxuICAgKiB0aW1lIGhhcyBzZXR0bGVkIChpbmNsdWRpbmcgZXZlbnQtbG9nIHBlcnNpc3RlbmNlKS4gVXNlZnVsIHdoZW4gYVxuICAgKiByZXF1ZXN0IGhhbmRsZXIgbmVlZHMgdG8gZ3VhcmFudGVlIGl0cyBicm9hZGNhc3QgaXMgcGVyc2lzdGVkIGJlZm9yZVxuICAgKiByZXNwb25kaW5nIOKAlCB3aXRob3V0IHRoaXMsIHRoZSBIVFRQIHJlc3BvbnNlIGNhbiByZXR1cm4gYmVmb3JlIHRoZVxuICAgKiBhc3luYyBldmVudC1sb2cgd3JpdGUgZmluaXNoZXMuIFRoaXMgaXMgYSBzbmFwc2hvdCBiYXJyaWVyOiB3b3JrXG4gICAqIGVucXVldWVkIGFmdGVyIHRoZSBzbmFwc2hvdCBpcyBub3QgYXdhaXRlZCwgYW5kIHRoZSBmaXJzdCByZWplY3Rpb24gaW5cbiAgICogc25hcHNob3Qgb3JkZXIgaXMgcmV0aHJvd24gYWZ0ZXIgZXZlcnkgc25hcHNob3R0ZWQgdGFpbCBoYXMgc2V0dGxlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzKCkge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gWy4uLnRoaXMucHVibGlzaFF1ZXVlc0J5Q2hhbm5lbC52YWx1ZXMoKV1cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHNuYXBzaG90KVxuXG4gICAgZm9yIChjb25zdCByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikgdGhyb3cgcmVzdWx0LnJlYXNvblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vd29ya2VyLWhhbmRsZXIvaW5kZXguanNcIikuZGVmYXVsdH0gaGFuZGxlciAtIEhhbmRsZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIFRoZSByZWdpc3Rlci5cbiAgICovXG4gIHJlZ2lzdGVyKGhhbmRsZXIpIHtcbiAgICB0aGlzLmhhbmRsZXJzLmFkZChoYW5kbGVyKVxuICAgIGxldCBjb25maWd1cmF0aW9uSGFuZGxlcnMgPSB0aGlzLmJyb2FkY2FzdEhhbmRsZXJzQnlDb25maWd1cmF0aW9uLmdldChoYW5kbGVyLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb25IYW5kbGVycykge1xuICAgICAgY29uZmlndXJhdGlvbkhhbmRsZXJzID0gbmV3IFNldCgpXG4gICAgICB0aGlzLmJyb2FkY2FzdEhhbmRsZXJzQnlDb25maWd1cmF0aW9uLnNldChoYW5kbGVyLmNvbmZpZ3VyYXRpb24sIGNvbmZpZ3VyYXRpb25IYW5kbGVycylcbiAgICB9XG5cbiAgICBjb25maWd1cmF0aW9uSGFuZGxlcnMuYWRkKGhhbmRsZXIpXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUoaGFuZGxlcilcbiAgICAgIGNvbmZpZ3VyYXRpb25IYW5kbGVycy5kZWxldGUoaGFuZGxlcilcblxuICAgICAgaWYgKGNvbmZpZ3VyYXRpb25IYW5kbGVycy5zaXplID09PSAwKSB7XG4gICAgICAgIHRoaXMuYnJvYWRjYXN0SGFuZGxlcnNCeUNvbmZpZ3VyYXRpb24uZGVsZXRlKGhhbmRsZXIuY29uZmlndXJhdGlvbilcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwdWJsaXNoLlxuICAgKiBAcGFyYW0ge29iamVjdCB8IHN0cmluZ30gY2hhbm5lbE9yQXJncyAtIENoYW5uZWwgbmFtZSBvciBvcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW3BheWxvYWRBcmddIC0gUGF5bG9hZCBkYXRhIHdoZW4gY2hhbm5lbCBpcyBwYXNzZWQgc2VwYXJhdGVseS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHVibGlzaChjaGFubmVsT3JBcmdzLCBwYXlsb2FkQXJnKSB7XG4gICAgY29uc3QgcHVibGlzaEFyZ3MgPSB0eXBlb2YgY2hhbm5lbE9yQXJncyA9PT0gXCJzdHJpbmdcIlxuICAgICAgPyB7Y2hhbm5lbDogY2hhbm5lbE9yQXJncywgcGF5bG9hZDogcGF5bG9hZEFyZ31cbiAgICAgIDogLyoqIEB0eXBlIHt7Y2hhbm5lbDogc3RyaW5nLCBwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChjaGFubmVsT3JBcmdzKVxuICAgIGNvbnN0IGNoYW5uZWwgPSBwdWJsaXNoQXJncy5jaGFubmVsXG4gICAgY29uc3QgcGF5bG9hZCA9IHB1Ymxpc2hBcmdzLnBheWxvYWRcblxuICAgIHRoaXMuX3F1ZXVlUHVibGlzaCh7XG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBwZXJzaXN0ZWRFdmVudCA9IGF3YWl0IHRoaXMuX3BlcnNpc3RFdmVudElmTmVlZGVkKHtjaGFubmVsLCBwYXlsb2FkfSlcblxuICAgICAgICBmb3IgKGNvbnN0IGhhbmRsZXIgb2YgdGhpcy5oYW5kbGVycykge1xuICAgICAgICAgIGhhbmRsZXIuZGlzcGF0Y2hXZWJzb2NrZXRFdmVudCh7XG4gICAgICAgICAgICBjaGFubmVsLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBwZXJzaXN0ZWRFdmVudD8uY3JlYXRlZEF0LFxuICAgICAgICAgICAgZXZlbnRJZDogcGVyc2lzdGVkRXZlbnQ/LmlkLFxuICAgICAgICAgICAgcGF5bG9hZFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBjaGFubmVsLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIkZhaWxlZCB0byBwdWJsaXNoIHdlYnNvY2tldCBldmVudFwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGYW4gYSBWMiBjaGFubmVsIGJyb2FkY2FzdCBvdXQgdG8gZXZlcnkgcmVnaXN0ZXJlZCB3b3JrZXIgaGFuZGxlci5cbiAgICogUGVyc2lzdHMgdGhlIGV2ZW50IHRvIHRoZSBldmVudC1sb2cgc3RvcmUgKGlmIHRoZSBjaGFubmVsIGlzIG1hcmtlZFxuICAgKiBpbnRlcmVzdGVkKSBzbyBjbGllbnRzIGNhbiByZXN1bWUgZnJvbSBhIGBsYXN0RXZlbnRJZGAgY2hlY2twb2ludC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYnJvYWRjYXN0UGFyYW1zIC0gUm91dGluZyBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmJvZHkgLSBNZXNzYWdlIGJvZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPcmlnaW5hdGluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJyb2FkY2FzdFYyKHtib2R5LCBicm9hZGNhc3RQYXJhbXMsIGNoYW5uZWwsIGNvbmZpZ3VyYXRpb259KSB7XG4gICAgLy8gQ2hhaW4gb250byB0aGUgY2hhbm5lbCdzIG93biBwdWJsaXNoIHRhaWwgc28gcGVyc2lzdGVuY2UgY29tcGxldGVzXG4gICAgLy8gYmVmb3JlIHRoZSBuZXh0IGJyb2FkY2FzdCBvbiB0aGF0IHNhbWUgY2hhbm5lbCDigJQgd2l0aG91dCB0aGlzLCBhXG4gICAgLy8gc3Vic2NyaWJlciB0aGF0IGNvbm5lY3RzIGltbWVkaWF0ZWx5IGFmdGVyIGEgYnJvYWRjYXN0IGNvdWxkIG1pc3MgdGhlXG4gICAgLy8ganVzdC1wZXJzaXN0ZWQgZXZlbnQgd2hlbiByZXBsYXlpbmcgZnJvbSBsYXN0RXZlbnRJZCBvbiBhIHNsb3cgREIuXG4gICAgLy8gT3RoZXIgY2hhbm5lbHMgY2hhaW4gb250byB0aGVpciBvd24gdGFpbHMgYW5kIGFyZSBub3QgZGVsYXllZC5cbiAgICB0aGlzLl9xdWV1ZVB1Ymxpc2goe1xuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcGVyc2lzdGVkRXZlbnQgPSBhd2FpdCB0aGlzLl9wZXJzaXN0VjJFdmVudElmTmVlZGVkKHtib2R5LCBicm9hZGNhc3RQYXJhbXMsIGNoYW5uZWwsIGNvbmZpZ3VyYXRpb259KVxuICAgICAgICBjb25zdCBkaXNwYXRjaGVkVGFyZ2V0cyA9IG5ldyBTZXQoKVxuXG4gICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiB0aGlzLmJyb2FkY2FzdEhhbmRsZXJzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKSB8fCBbXSkge1xuICAgICAgICAgIGNvbnN0IGRpc3BhdGNoS2V5ID0gaGFuZGxlci53ZWJzb2NrZXRWMkJyb2FkY2FzdERpc3BhdGNoS2V5KClcblxuICAgICAgICAgIGlmIChkaXNwYXRjaGVkVGFyZ2V0cy5oYXMoZGlzcGF0Y2hLZXkpKSBjb250aW51ZVxuXG4gICAgICAgICAgZGlzcGF0Y2hlZFRhcmdldHMuYWRkKGRpc3BhdGNoS2V5KVxuICAgICAgICAgIGhhbmRsZXIuZGlzcGF0Y2hXZWJzb2NrZXRWMkJyb2FkY2FzdCh7XG4gICAgICAgICAgICBib2R5LFxuICAgICAgICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgICAgIGV2ZW50SWQ6IHBlcnNpc3RlZEV2ZW50Py5pZCxcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogcGVyc2lzdGVkRXZlbnQ/LmNyZWF0ZWRBdFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBjaGFubmVsLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIkZhaWxlZCB0byBwZXJzaXN0L2Jyb2FkY2FzdCBWMiBldmVudFwiLFxuICAgICAgb3JpZ2luYXRpbmdDb25maWd1cmF0aW9uOiBjb25maWd1cmF0aW9uXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgcHVibGlzaCB3b3JrIGJlaGluZCB0aGUgY2hhbm5lbCdzIG93biBvcmRlcmVkIHRhaWwgc28gb25seSB3b3JrXG4gICAqIGZvciB0aGUgc2FtZSBjaGFubmVsIHNlcmlhbGl6ZXMg4oCUIGEgc2xvdyBvciBmYWlsZWQgY2hhbm5lbCBuZXZlclxuICAgKiBoZWFkLW9mLWxpbmUgYmxvY2tzIHVucmVsYXRlZCBjaGFubmVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLmNhbGxiYWNrIC0gUHVibGlzaCB3b3JrIHRvIHJ1biBpbiBjaGFubmVsIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCB3aG9zZSBvcmRlcmVkIHRhaWwgdGhlIHdvcmsgY2hhaW5zIG9udG8uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmVycm9yTWVzc2FnZSAtIE1lc3NhZ2UgbG9nZ2VkIHdoZW4gcHVibGlzaCB3b3JrIGZhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3Mub3JpZ2luYXRpbmdDb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gd2hvc2UgY29udGV4dCBvd25zIHRoZSB3b3JrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9xdWV1ZVB1Ymxpc2goe2NhbGxiYWNrLCBjaGFubmVsLCBlcnJvck1lc3NhZ2UsIG9yaWdpbmF0aW5nQ29uZmlndXJhdGlvbn0pIHtcbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5oYW5kbGVycy52YWx1ZXMoKS5uZXh0KCkudmFsdWVcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gb3JpZ2luYXRpbmdDb25maWd1cmF0aW9uIHx8IGhhbmRsZXI/LmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBwcmV2aW91c1RhaWwgPSB0aGlzLnB1Ymxpc2hRdWV1ZXNCeUNoYW5uZWwuZ2V0KGNoYW5uZWwpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgbGV0IHF1ZXVlZFB1Ymxpc2hcblxuICAgIGlmIChjb25maWd1cmF0aW9uKSB7XG4gICAgICBxdWV1ZWRQdWJsaXNoID0gcHJldmlvdXNUYWlsLnRoZW4oKCkgPT4gY29uZmlndXJhdGlvbi53aXRob3V0Q3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIGNvbmZpZ3VyYXRpb24ud2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dHMoKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGNhbGxiYWNrKVxuICAgICAgICB9KVxuICAgICAgfSkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXVlZFB1Ymxpc2ggPSBwcmV2aW91c1RhaWwudGhlbihjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCB0YWlsID0gcXVldWVkUHVibGlzaFxuICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yTWVzc2FnZSwgZXJyb3IpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9KVxuXG4gICAgdGhpcy5wdWJsaXNoUXVldWVzQnlDaGFubmVsLnNldChjaGFubmVsLCB0YWlsKVxuXG4gICAgLy8gUmVtb3ZlIHRoZSB0YWlsIG9uY2UgaXQgc2V0dGxlcyBzdWNjZXNzZnVsbHksIGJ1dCBvbmx5IHdoZW4gaXQgaXNcbiAgICAvLyBzdGlsbCB0aGUgbmV3ZXN0IHRhaWwg4oCUIGFuIG9sZGVyIHNldHRsZWQgdGFpbCBtdXN0IG5ldmVyIGRlbGV0ZSBhXG4gICAgLy8gbmV3ZXIgb25lLiBBIHJlamVjdGVkIHRhaWwgc3RheXMgaW4gdGhlIG1hcCBzbyB0aGUgY2hhbm5lbCByZW1haW5zXG4gICAgLy8gcG9pc29uZWQgYW5kIG9ic2VydmFibGUgdGhyb3VnaCBhd2FpdFBlbmRpbmdCcm9hZGNhc3RzLlxuICAgIHRhaWwudGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMucHVibGlzaFF1ZXVlc0J5Q2hhbm5lbC5nZXQoY2hhbm5lbCkgPT09IHRhaWwpIHtcbiAgICAgICAgICB0aGlzLnB1Ymxpc2hRdWV1ZXNCeUNoYW5uZWwuZGVsZXRlKGNoYW5uZWwpXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICAoKSA9PiB1bmRlZmluZWRcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJzaXN0IHYyIGV2ZW50IGlmIG5lZWRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmJvZHkgLSBFdmVudCBib2R5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5icm9hZGNhc3RQYXJhbXMgLSBSb3V0aW5nIGZpbHRlciBwYXJhbXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPcmlnaW5hdGluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y3JlYXRlZEF0OiBzdHJpbmcsIGlkOiBzdHJpbmd9IHwgbnVsbD59IC0gUGVyc2lzdGVkIGV2ZW50IG1ldGFkYXRhIHdoZW4gc3RvcmFnZSBpcyBlbmFibGVkLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RWMkV2ZW50SWZOZWVkZWQoe2JvZHksIGJyb2FkY2FzdFBhcmFtcywgY2hhbm5lbCwgY29uZmlndXJhdGlvbn0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGVyc2lzdENoYW5uZWxFdmVudElmTmVlZGVkKHticm9hZGNhc3RQYXJhbXMsIGNoYW5uZWwsIGNvbmZpZ3VyYXRpb24sIHBheWxvYWQ6IGJvZHl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdCBldmVudCBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWRBdDogc3RyaW5nLCBpZDogc3RyaW5nfSB8IG51bGw+fSAtIFBlcnNpc3RlZCBldmVudCBtZXRhZGF0YS5cbiAgICovXG4gIGFzeW5jIF9wZXJzaXN0RXZlbnRJZk5lZWRlZCh7Y2hhbm5lbCwgcGF5bG9hZH0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGVyc2lzdENoYW5uZWxFdmVudElmTmVlZGVkKHtjaGFubmVsLCBwYXlsb2FkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgY2hhbm5lbCBldmVudCBpZiBuZWVkZWQuIFBlcnNpc3RzIHRoZSBicm9hZGNhc3QncyByb3V0aW5nXG4gICAqIHBhcmFtcyAoc2FuaXRpemVkIHRocm91Z2ggdGhlIGNoYW5uZWwgY2xhc3Mnc1xuICAgKiBgcmVwbGF5YWJsZUJyb2FkY2FzdFBhcmFtc2ApIHNvIHJlcGxheSBjYW4gcmUtYXBwbHkgYG1hdGNoZXMoKWAgcGVyXG4gICAqIHN0cmVhbSBpbnN0ZWFkIG9mIGRlbGl2ZXJpbmcgdGhlIHdob2xlIGNoYW5uZWwncyBsb2cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW2FyZ3MuYnJvYWRjYXN0UGFyYW1zXSAtIEJyb2FkY2FzdCBwYXJhbXMgdG8gcGVyc2lzdCBmb3Igc3RyZWFtLXNjb3BlZCByZXBsYXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIGV2ZW50IHN0b3JlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y3JlYXRlZEF0OiBzdHJpbmcsIGlkOiBzdHJpbmd9IHwgbnVsbD59IC0gUGVyc2lzdGVkIGV2ZW50IG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RDaGFubmVsRXZlbnRJZk5lZWRlZCh7YnJvYWRjYXN0UGFyYW1zID0gbnVsbCwgY2hhbm5lbCwgY29uZmlndXJhdGlvbiwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5oYW5kbGVycy52YWx1ZXMoKS5uZXh0KCkudmFsdWVcbiAgICBjb25zdCBldmVudENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IGhhbmRsZXI/LmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghZXZlbnRDb25maWd1cmF0aW9uKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgd2Vic29ja2V0RXZlbnRMb2dTdG9yZSA9IHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uKGV2ZW50Q29uZmlndXJhdGlvbilcbiAgICBjb25zdCBzaG91bGRQZXJzaXN0ID0gYXdhaXQgd2Vic29ja2V0RXZlbnRMb2dTdG9yZS5zaG91bGRQZXJzaXN0Q2hhbm5lbChjaGFubmVsKVxuXG4gICAgaWYgKCFzaG91bGRQZXJzaXN0KSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgQ2hhbm5lbENsYXNzID0gZXZlbnRDb25maWd1cmF0aW9uLmdldFdlYnNvY2tldENoYW5uZWxDbGFzcyhjaGFubmVsKVxuICAgIGNvbnN0IHBhcmFtcyA9IENoYW5uZWxDbGFzcyA/IENoYW5uZWxDbGFzcy5yZXBsYXlhYmxlQnJvYWRjYXN0UGFyYW1zKGJyb2FkY2FzdFBhcmFtcykgOiBicm9hZGNhc3RQYXJhbXNcblxuICAgIGNvbnN0IHBlcnNpc3RlZEV2ZW50ID0gYXdhaXQgd2Vic29ja2V0RXZlbnRMb2dTdG9yZS5hcHBlbmRFdmVudCh7Y2hhbm5lbCwgcGFyYW1zLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiB7XG4gICAgICBjcmVhdGVkQXQ6IHBlcnNpc3RlZEV2ZW50LmNyZWF0ZWRBdCxcbiAgICAgIGlkOiBwZXJzaXN0ZWRFdmVudC5pZFxuICAgIH1cbiAgfVxufVxuXG5jb25zdCB3ZWJzb2NrZXRFdmVudHNIb3N0ID0gbmV3IFZlbG9jaW91c0h0dHBTZXJ2ZXJXZWJzb2NrZXRFdmVudHNIb3N0KClcblxuZXhwb3J0IGRlZmF1bHQgd2Vic29ja2V0RXZlbnRzSG9zdFxuIl19