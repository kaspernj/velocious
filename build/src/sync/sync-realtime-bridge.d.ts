export type VelociousSyncRealtimeChannelDescriptor = import("../configuration-types.js").VelociousSyncRealtimeChannelDescriptor;
export type VelociousSyncRealtimeWebsocketClient = import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient;
/** @typedef {import("../configuration-types.js").VelociousSyncRealtimeChannelDescriptor} VelociousSyncRealtimeChannelDescriptor */
/** @typedef {import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient} VelociousSyncRealtimeWebsocketClient */
/**
 * Derived realtime push bridge for the sync client. Subscribes every declared
 * pull scope to the framework sync channel ({@link VELOCIOUS_SYNC_CHANNEL})
 * automatically — the subscribe params mirror the scope's
 * `{resourceType, conditions}` so the server authorizes them through the same
 * sync resource authorization as pulls — plus any deprecated legacy channels
 * (config `sync.client.realtime.channels` callback and model-level
 * `static sync = {realtime: {channel}}` declarations). Pushed changes apply
 * through the same derived resource applier as pulls (with echo suppression
 * against tracked re-queueing), own-device messages are dropped by echo
 * origin, and a coalesced `pull()` fires when subscriptions become ready or
 * resume so offline gaps close.
 */
export default class SyncRealtimeBridge {
    syncClient: import("./sync-client.js").default;
    /** @type {Array<{channel: string, resourceType: string | null, subscription: import("../configuration-types.js").VelociousSyncRealtimeSubscription}>} */
    _channels: Array<{
        channel: string;
        resourceType: string | null;
        subscription: import("../configuration-types.js").VelociousSyncRealtimeSubscription;
    }>;
    /** @type {VelociousSyncRealtimeWebsocketClient | null} */
    _client: VelociousSyncRealtimeWebsocketClient | null;
    /** @type {boolean} Whether the bridge created its own client (deprecated per-cycle path) and must disconnect it on unsubscribe. A shared connection is never owned. */
    _ownsClient: boolean;
    /** @type {Promise<void>} */
    _applyPromise: Promise<void>;
    /** @type {number} Subscription generation - bumped by unsubscribe so in-flight subscribes detect they became stale. */
    _generation: number;
    /** @type {Promise<void> | null} */
    _scheduledPull: Promise<void> | null;
    /** @type {Promise<void> | null} */
    _subscribePromise: Promise<void> | null;
    /** @type {"subscribed" | "subscribing" | "unsubscribed"} */
    _state: "subscribed" | "subscribing" | "unsubscribed";
    /**
     * Builds the bridge for a sync client.
     * @param {{syncClient: import("./sync-client.js").default}} args - Bridge args.
     */
    constructor({ syncClient }: {
        syncClient: import("./sync-client.js").default;
    });
    /**
     * Subscribes the derived realtime channels (idempotent and single-flighted):
     * an active subscription is kept as-is and a concurrent subscribe awaits the
     * in-flight attempt. Call `unsubscribe()` first to change the context.
     * @param {ReturnType<typeof JSON.parse>} [context] - App context passed to the deprecated `sync.client.realtime.channels` callback (runtime scope values).
     * @returns {Promise<void>}
     */
    subscribe(context?: ReturnType<typeof JSON.parse>): Promise<void>;
    /**
     * Connects the websocket client, subscribes every derived channel, and waits
     * for each subscription's server acknowledgement before the gap-closing pull,
     * so no change can land between the pull and the subscriptions going live.
     * Locally created resources are only promoted to the bridge once everything
     * is live; an unsubscribe arriving during any await marks this attempt stale
     * and it tears its own resources down instead of resubscribing.
     * @param {ReturnType<typeof JSON.parse>} context - App context passed to the channels callback.
     * @returns {Promise<void>}
     */
    _subscribe(context: ReturnType<typeof JSON.parse>): Promise<void>;
    /**
     * Closes every channel subscription (idempotent). The websocket is
     * disconnected only when the bridge owns it (deprecated per-cycle
     * `realtime.createClient` path); a shared app-lifetime connection stays open
     * so unsubscribing drops subscriptions without tearing down the socket. Also
     * marks any in-flight subscribe attempt stale so it tears itself down instead
     * of finishing the subscription afterwards.
     * @returns {Promise<void>}
     */
    unsubscribe(): Promise<void>;
    /**
     * Reports the bridge subscription state and per-channel readiness.
     * @returns {{channels: Array<{channel: string, ready: boolean, resourceType: string | null}>, state: "subscribed" | "subscribing" | "unsubscribed"}} Realtime status.
     */
    status(): {
        channels: Array<{
            channel: string;
            ready: boolean;
            resourceType: string | null;
        }>;
        state: "subscribed" | "subscribing" | "unsubscribed";
    };
    /**
     * Awaits all enqueued message applies and any scheduled pull (tests, shutdown flows).
     * @returns {Promise<void>}
     */
    waitForApplied(): Promise<void>;
    /**
     * Resolves the realtime configuration block, or null when the app declared
     * none (valid when a shared connection is configured).
     * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null} Realtime configuration, or null.
     */
    realtimeConfiguration(): import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null;
    /**
     * Resolves the realtime configuration and asserts a websocket client source
     * exists: a shared connection rides its own lifecycle, otherwise the
     * deprecated per-cycle `realtime.createClient` must be configured.
     * @param {import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient | null} sharedClient - Shared connection, or null.
     * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null} Realtime configuration, or null.
     */
    requireClientSource(sharedClient: import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient | null): import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null;
    /**
     * Derives the channel descriptors to subscribe: one framework sync channel
     * subscription per declared pull scope (the params mirror the scope's
     * `{resourceType, conditions}`), plus the deprecated legacy paths —
     * model-level static realtime declarations and the config channels callback.
     * Fails loudly when nothing is subscribable.
     * @param {ReturnType<typeof JSON.parse>} context - App context passed to the deprecated channels callback.
     * @returns {Promise<Array<VelociousSyncRealtimeChannelDescriptor>>} Channel descriptors.
     */
    channelDescriptors(context: ReturnType<typeof JSON.parse>): Promise<Array<VelociousSyncRealtimeChannelDescriptor>>;
    /**
     * Translates a persisted scope's condition keys to the model's attribute
     * names so the framework channel subscription matches the publisher's
     * attribute-named scoping params: `serializedScopeFromQuery` persists the
     * query's model-normalized column names (for example `project_id`), while
     * scope-partition broadcasts carry attribute names (`projectId`). Keys
     * without a column mapping are already attribute names and pass through;
     * scopes on models without a declared sync resource fail loudly because no
     * attribute mapping exists for them.
     *
     * The all-types (user) scope has no resource type and no conditions - it
     * covers everything the server authorizes for the caller - so there is
     * nothing to map.
     * @param {{conditions: Record<string, ReturnType<typeof JSON.parse>>, resourceType: string | null}} scopeRow - Active scope row.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Attribute-named scope conditions.
     */
    attributeNamedConditions(scopeRow: {
        conditions: Record<string, ReturnType<typeof JSON.parse>>;
        resourceType: string | null;
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Chains one pushed message onto the serialized apply queue so changes apply
     * in arrival order; failures go to the sync client's error reporting.
     * @param {{body: ReturnType<typeof JSON.parse>, resourceType: string | null}} args - Message args.
     * @returns {void}
     */
    enqueueApply({ body, resourceType }: {
        body: ReturnType<typeof JSON.parse>;
        resourceType: string | null;
    }): void;
    /**
     * Applies one pushed message through the derived resource applier: drops
     * own-device messages by echo origin, defaults the channel's resourceType onto
     * envelopes without one, and fails loudly on unknown resource types.
     * @param {{body: ReturnType<typeof JSON.parse>, resourceType: string | null}} args - Message args.
     * @returns {Promise<void>}
     */
    applyMessage({ body, resourceType }: {
        body: ReturnType<typeof JSON.parse>;
        resourceType: string | null;
    }): Promise<void>;
    /**
     * Schedules a coalesced background pull closing offline gaps after
     * (re)subscription readiness. Resumes arriving while a pull is already
     * scheduled or in flight coalesce into that pull instead of stacking.
     * @returns {void}
     */
    schedulePull(): void;
}
//# sourceMappingURL=sync-realtime-bridge.d.ts.map