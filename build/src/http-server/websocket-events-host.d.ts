export declare class VelociousHttpServerWebsocketEventsHost {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<import("./worker-handler/index.js").default>} */
    handlers: Set<import("./worker-handler/index.js").default>;
    /**
     * Broadcast handlers grouped by the configuration that owns them.
     * @type {Map<import("../configuration.js").default, Set<import("./worker-handler/index.js").default>>} */
    broadcastHandlersByConfiguration: Map<import("../configuration.js").default, Set<import("./worker-handler/index.js").default>>;
    /**
     * Ordered publish tails keyed by channel. Each channel persists and
     * dispatches behind its own tail so a slow channel cannot head-of-line
     * block unrelated channels. A rejected tail stays in the map so the
     * channel remains poisoned and observable.
     * @type {Map<string, Promise<void>>} */
    publishQueuesByChannel: Map<string, Promise<void>>;
    constructor();
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
    awaitPendingBroadcasts(): Promise<void>;
    /**
     * Runs register.
     * @param {import("./worker-handler/index.js").default} handler - Handler instance.
     * @returns {() => void} - The register.
     */
    register(handler: import("./worker-handler/index.js").default): () => void;
    /**
     * Runs publish.
     * @param {object | string} channelOrArgs - Channel name or options object.
     * @param {ReturnType<typeof JSON.parse>} [payloadArg] - Payload data when channel is passed separately.
     * @returns {void} - No return value.
     */
    publish(channelOrArgs: object | string, payloadArg?: ReturnType<typeof JSON.parse>): void;
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
    broadcastV2({ body, broadcastParams, channel, configuration }: {
        channel: string;
        broadcastParams: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
        configuration: import("../configuration.js").default;
    }): void;
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
    _queuePublish({ callback, channel, errorMessage, originatingConfiguration }: {
        callback: () => Promise<void>;
        channel: string;
        errorMessage: string;
        originatingConfiguration?: import("../configuration.js").default;
    }): void;
    /**
     * Runs persist v2 event if needed.
     * @param {object} args - Options.
     * @param {ReturnType<typeof JSON.parse>} args.body - Event body.
     * @param {string} args.channel - Channel name.
     * @param {import("../configuration.js").default} args.configuration - Originating configuration.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata when storage is enabled.
     */
    _persistV2EventIfNeeded({ body, channel, configuration }: {
        body: ReturnType<typeof JSON.parse>;
        channel: string;
        configuration: import("../configuration.js").default;
    }): Promise<{
        createdAt: string;
        id: string;
    } | null>;
    /**
     * Runs persist event if needed.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
     */
    _persistEventIfNeeded({ channel, payload }: {
        channel: string;
        payload: ReturnType<typeof JSON.parse>;
    }): Promise<{
        createdAt: string;
        id: string;
    } | null>;
    /**
     * Runs persist channel event if needed.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Payload data.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the event store.
     * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
     */
    _persistChannelEventIfNeeded({ channel, payload, configuration }: {
        channel: string;
        payload: ReturnType<typeof JSON.parse>;
        configuration?: import("../configuration.js").default;
    }): Promise<{
        createdAt: string;
        id: string;
    } | null>;
}
declare const websocketEventsHost: VelociousHttpServerWebsocketEventsHost;
export default websocketEventsHost;
//# sourceMappingURL=websocket-events-host.d.ts.map