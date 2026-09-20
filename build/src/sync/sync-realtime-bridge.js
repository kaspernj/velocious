// @ts-check
import recordChanges from "../database/record-changes.js";
import { mergeRemoteRequestContext } from "../remote-request-context.js";
import SyncApiClient from "./sync-api-client.js";
import { VELOCIOUS_SYNC_CHANNEL } from "./sync-channel-name.js";
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
    /**
     * Builds the bridge for a sync client.
     * @param {{syncClient: import("./sync-client.js").default}} args - Bridge args.
     */
    constructor({ syncClient }) {
        this.syncClient = syncClient;
        /** @type {Array<{channel: string, resourceType: string | null, subscription: import("../configuration-types.js").VelociousSyncRealtimeSubscription}>} */
        this._channels = [];
        /** @type {VelociousSyncRealtimeWebsocketClient | null} */
        this._client = null;
        /** @type {boolean} Whether the bridge created its own client (deprecated per-cycle path) and must disconnect it on unsubscribe. A shared connection is never owned. */
        this._ownsClient = false;
        /** @type {Promise<void>} */
        this._applyPromise = Promise.resolve();
        /** @type {number} Subscription generation - bumped by unsubscribe so in-flight subscribes detect they became stale. */
        this._generation = 0;
        /** @type {Promise<void> | null} */
        this._scheduledPull = null;
        /** @type {Promise<void> | null} */
        this._subscribePromise = null;
        /** @type {"subscribed" | "subscribing" | "unsubscribed"} */
        this._state = "unsubscribed";
    }
    /**
     * Subscribes the derived realtime channels (idempotent and single-flighted):
     * an active subscription is kept as-is and a concurrent subscribe awaits the
     * in-flight attempt. Call `unsubscribe()` first to change the context.
     * @param {ReturnType<typeof JSON.parse>} [context] - App context passed to the deprecated `sync.client.realtime.channels` callback (runtime scope values).
     * @param {{signal?: AbortSignal}} [options] - Subscription lifecycle options.
     * @returns {Promise<void>}
     */
    async subscribe(context, { signal } = {}) {
        if (this._state === "subscribed")
            return;
        if (!this._subscribePromise) {
            this._subscribePromise = this._subscribe(context, signal).finally(() => {
                this._subscribePromise = null;
            });
        }
        await this._subscribePromise;
    }
    /**
     * Connects the websocket client, subscribes every derived channel, and waits
     * for each subscription's server acknowledgement before the gap-closing pull,
     * so no change can land between the pull and the subscriptions going live.
     * Locally created resources are only promoted to the bridge once everything
     * is live; an unsubscribe arriving during any await marks this attempt stale
     * and it tears its own resources down instead of resubscribing.
     * @param {ReturnType<typeof JSON.parse>} context - App context passed to the channels callback.
     * @param {AbortSignal | undefined} signal - Subscription lifecycle signal.
     * @returns {Promise<void>}
     */
    async _subscribe(context, signal) {
        const generation = this._generation;
        this._state = "subscribing";
        /** @type {Array<{channel: string, resourceType: string | null, subscription: import("../configuration-types.js").VelociousSyncRealtimeSubscription}>} */
        const channels = [];
        /** @type {VelociousSyncRealtimeWebsocketClient | null} */
        let client = null;
        /** @type {boolean} Whether this attempt created its own client and must disconnect it on teardown. */
        let ownsClient = false;
        /**
         * Tears down everything this stale/failed subscribe attempt created itself:
         * always closes its channel subscriptions, and disconnects the websocket
         * only when the bridge owns it (deprecated per-cycle path); a shared
         * connection stays open.
         * @returns {Promise<void>}
         */
        const teardown = async () => {
            for (const { subscription } of channels) {
                subscription.close();
            }
            if (client && ownsClient)
                await client.disconnectAndStopReconnect();
        };
        try {
            throwIfAborted(signal);
            const sharedClient = this.syncClient.syncConnection();
            const realtime = this.requireClientSource(sharedClient);
            const channelDescriptors = await this.channelDescriptors(context);
            throwIfAborted(signal);
            if (generation !== this._generation)
                return;
            if (sharedClient) {
                client = sharedClient;
            }
            else {
                // requireClientSource guaranteed realtime.createClient when there is no shared connection.
                client = await /** @type {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration} */ (realtime).createClient();
                ownsClient = true;
            }
            if (generation !== this._generation) {
                await teardown();
                return;
            }
            await client.connect({ signal });
            throwIfAborted(signal);
            if (generation !== this._generation) {
                await teardown();
                return;
            }
            const authenticationToken = await this.syncClient.config.authenticationToken();
            throwIfAborted(signal);
            if (generation !== this._generation) {
                await teardown();
                return;
            }
            for (const channelDescriptor of channelDescriptors) {
                if (channelDescriptor.params && "authenticationToken" in channelDescriptor.params) {
                    throw new Error(`Realtime channel "${channelDescriptor.channel}" params must not include authenticationToken - the framework injects the sync.client authenticationToken automatically`);
                }
                const resourceType = channelDescriptor.resourceType ?? null;
                const params = mergeRemoteRequestContext({
                    context: this.syncClient.config.requestContext,
                    label: "Sync client request context",
                    params: { ...channelDescriptor.params, authenticationToken }
                });
                const subscription = client.subscribeChannel(channelDescriptor.channel, {
                    onMessage: (body) => this.enqueueApply({ body, generation, resourceType }),
                    onResume: () => this.schedulePull(generation),
                    params
                });
                channels.push({ channel: channelDescriptor.channel, resourceType, subscription });
            }
            await Promise.all(channels.map(({ subscription }) => subscription.waitForReady({ signal })));
            throwIfAborted(signal);
            if (generation !== this._generation) {
                await teardown();
                return;
            }
            this._channels = channels;
            this._client = client;
            this._ownsClient = ownsClient;
            this._state = "subscribed";
            this.schedulePull(generation);
        }
        catch (error) {
            await teardown();
            if (generation === this._generation)
                this._state = "unsubscribed";
            throw error;
        }
    }
    /**
     * Closes every channel subscription (idempotent). The websocket is
     * disconnected only when the bridge owns it (deprecated per-cycle
     * `realtime.createClient` path); a shared app-lifetime connection stays open
     * so unsubscribing drops subscriptions without tearing down the socket. Also
     * marks any in-flight subscribe attempt stale so it tears itself down instead
     * of finishing the subscription afterwards.
     * @returns {Promise<void>}
     */
    async unsubscribe() {
        this._generation += 1;
        const channels = this._channels;
        const client = this._client;
        const ownsClient = this._ownsClient;
        this._channels = [];
        this._client = null;
        this._ownsClient = false;
        this._state = "unsubscribed";
        for (const { subscription } of channels) {
            subscription.close();
        }
        if (client && ownsClient)
            await client.disconnectAndStopReconnect();
    }
    /**
     * Reports the bridge subscription state and per-channel readiness.
     * @returns {{channels: Array<{channel: string, ready: boolean, resourceType: string | null}>, state: "subscribed" | "subscribing" | "unsubscribed"}} Realtime status.
     */
    status() {
        return {
            channels: this._channels.map(({ channel, resourceType, subscription }) => ({ channel, ready: subscription.isReady(), resourceType })),
            state: this._state
        };
    }
    /**
     * Awaits all enqueued message applies and any scheduled pull (tests, shutdown flows).
     * @returns {Promise<void>}
     */
    async waitForApplied() {
        await this._applyPromise;
        if (this._scheduledPull)
            await this._scheduledPull;
    }
    /**
     * Resolves the realtime configuration block, or null when the app declared
     * none (valid when a shared connection is configured).
     * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null} Realtime configuration, or null.
     */
    realtimeConfiguration() {
        return this.syncClient.config.realtime || null;
    }
    /**
     * Resolves the realtime configuration and asserts a websocket client source
     * exists: a shared connection rides its own lifecycle, otherwise the
     * deprecated per-cycle `realtime.createClient` must be configured.
     * @param {import("../configuration-types.js").VelociousSyncRealtimeWebsocketClient | null} sharedClient - Shared connection, or null.
     * @returns {import("../configuration-types.js").VelociousSyncClientRealtimeConfiguration | null} Realtime configuration, or null.
     */
    requireClientSource(sharedClient) {
        const realtime = this.realtimeConfiguration();
        if (!sharedClient && typeof realtime?.createClient !== "function") {
            throw new Error("subscribeRealtime requires a shared connection (sync.client.websocketUrl or sync.client.websocketClient) or the deprecated sync.client.realtime.createClient callback");
        }
        return realtime;
    }
    /**
     * Derives the channel descriptors to subscribe: one framework sync channel
     * subscription per declared pull scope (the params mirror the scope's
     * `{resourceType, conditions}`), plus the deprecated legacy paths —
     * model-level static realtime declarations and the config channels callback.
     * Fails loudly when nothing is subscribable.
     * @param {ReturnType<typeof JSON.parse>} context - App context passed to the deprecated channels callback.
     * @returns {Promise<Array<VelociousSyncRealtimeChannelDescriptor>>} Channel descriptors.
     */
    async channelDescriptors(context) {
        const realtime = this.realtimeConfiguration();
        /** @type {Array<VelociousSyncRealtimeChannelDescriptor>} */
        const channelDescriptors = [];
        for (const scopeRow of await this.syncClient.scopeStore().activeScopes()) {
            channelDescriptors.push({
                channel: VELOCIOUS_SYNC_CHANNEL,
                params: {
                    conditions: this.attributeNamedConditions(scopeRow),
                    resourceType: scopeRow.resourceType,
                    // Only the all-types scope carries the type list; a type-declared scope needs none.
                    ...(scopeRow.resourceType === null ? { resourceTypes: this.syncClient.userScopeResourceTypes() } : {})
                }
            });
        }
        for (const [resourceType, resourceConfig] of Object.entries(this.syncClient.config.resources)) {
            if (!resourceConfig.realtime)
                continue;
            channelDescriptors.push({ channel: resourceConfig.realtime.channel, params: resourceConfig.realtime.params, resourceType });
        }
        if (realtime?.channels) {
            channelDescriptors.push(...await realtime.channels(context));
        }
        if (channelDescriptors.length === 0) {
            throw new Error("subscribeRealtime found no channels to subscribe - declare a sync scope (syncClient().sync(query)) so its framework sync channel subscription can be derived, or the deprecated sync.client.realtime.channels callback");
        }
        return channelDescriptors;
    }
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
    attributeNamedConditions(scopeRow) {
        if (scopeRow.resourceType === null)
            return {};
        const resourceConfig = this.syncClient.config.resources[scopeRow.resourceType];
        if (!resourceConfig) {
            throw new Error(`subscribeRealtime can't derive attribute names for the sync scope declared on ${scopeRow.resourceType} - declare static sync on that model so its resource is registered`);
        }
        const columnNameToAttributeName = resourceConfig.metadataModelClass.getColumnNameToAttributeNameMap();
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const conditions = {};
        for (const [conditionName, conditionValue] of Object.entries(scopeRow.conditions)) {
            conditions[columnNameToAttributeName[conditionName] || conditionName] = conditionValue;
        }
        return conditions;
    }
    /**
     * Chains one pushed message onto the serialized apply queue so changes apply
     * in arrival order; failures go to the sync client's error reporting.
     * @param {{body: ReturnType<typeof JSON.parse>, generation?: number, resourceType: string | null}} args - Message args.
     * @returns {void}
     */
    enqueueApply({ body, generation = this._generation, resourceType }) {
        this._applyPromise = this._applyPromise.then(async () => {
            if (generation !== this._generation)
                return;
            try {
                await this.applyMessage({ body, resourceType });
            }
            catch (error) {
                this.syncClient.reportError(/** @type {Error} */ (error));
            }
        });
    }
    /**
     * Applies one pushed message through the derived resource applier: drops
     * own-device messages by echo origin, defaults the channel's resourceType onto
     * envelopes without one, and fails loudly on unknown resource types.
     * @param {{body: ReturnType<typeof JSON.parse>, resourceType: string | null}} args - Message args.
     * @returns {Promise<void>}
     */
    async applyMessage({ body, resourceType }) {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error(`Realtime sync messages must be envelope objects, got: ${JSON.stringify(body)}`);
        }
        const realtime = this.realtimeConfiguration();
        if (realtime?.localOrigin && body.echoOrigin !== undefined && body.echoOrigin !== null) {
            const localOrigin = String(await realtime.localOrigin());
            if (String(body.echoOrigin) === localOrigin)
                return;
        }
        const syncPayloads = Array.isArray(body.syncs) ? body.syncs : [body];
        const applySync = this.syncClient.remoteApplySync({ source: "remote change" });
        // Coalesce record-change events across the pushed batch so it triggers one live-query re-run.
        await recordChanges.batch(async () => {
            for (const syncPayload of syncPayloads) {
                const sync = SyncApiClient.syncEnvelopeFromPayload({ resourceType, ...syncPayload });
                await applySync(sync);
            }
        });
    }
    /**
     * Schedules a coalesced background pull closing offline gaps after
     * (re)subscription readiness. Resumes arriving while a pull is already
     * scheduled or in flight coalesce into that pull instead of stacking.
     * @param {number} [generation] - Subscription generation owning the resume/readiness callback.
     * @returns {void}
     */
    schedulePull(generation = this._generation) {
        if (generation !== this._generation)
            return;
        if (this.realtimeConfiguration()?.pullOnReconnect === false)
            return;
        const coordinatorRun = this.syncClient.requestCoordinatorSync("realtime");
        if (coordinatorRun) {
            this._scheduledPull ||= coordinatorRun.finally(() => {
                this._scheduledPull = null;
            });
            return;
        }
        this._scheduledPull ||= (async () => {
            try {
                await this.syncClient.pull();
            }
            catch (error) {
                if (!this.syncClient.isLifecycleAbort(error)) {
                    this.syncClient.reportError(/** @type {Error} */ (error));
                }
            }
            finally {
                this._scheduledPull = null;
            }
        })();
    }
}
/**
 * Throws the lifecycle abort reason when the subscription is no longer owned.
 * @param {AbortSignal | undefined} signal - Subscription lifecycle signal.
 * @returns {void}
 */
function throwIfAborted(signal) {
    if (!signal?.aborted)
        return;
    throw signal.reason instanceof Error ? signal.reason : new Error("Sync realtime subscription was aborted");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZWFsdGltZS1icmlkZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXJlYWx0aW1lLWJyaWRnZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sK0JBQStCLENBQUE7QUFDekQsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFFdEUsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFFN0QsbUlBQW1JO0FBQ25JLCtIQUErSDtBQUUvSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGtCQUFrQjtJQUNyQzs7O09BR0c7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFDO1FBQ3RCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLHlKQUF5SjtRQUN6SixJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUNuQiwwREFBMEQ7UUFDMUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFDbkIsdUtBQXVLO1FBQ3ZLLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFBO1FBQ3hCLDRCQUE0QjtRQUM1QixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN0Qyx1SEFBdUg7UUFDdkgsSUFBSSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUE7UUFDcEIsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1FBQzFCLG1DQUFtQztRQUNuQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFBO1FBQzdCLDREQUE0RDtRQUM1RCxJQUFJLENBQUMsTUFBTSxHQUFHLGNBQWMsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNI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LENBQUMsSUFBSSxFQUFFLENBQUE7WUFDOUIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztvQkFDN0MsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO2dCQUMzRCxDQUFDO1lBQ0gsQ0FBQztvQkFBUyxDQUFDO2dCQUNULElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1lBQzVCLENBQUM7UUFDSCxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQ04sQ0FBQztDQUNGO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsY0FBYyxDQUFDLE1BQU07SUFDNUIsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPO1FBQUUsT0FBTTtJQUU1QixNQUFNLE1BQU0sQ0FBQyxNQUFNLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFBO0FBQzVHLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlY29yZENoYW5nZXMgZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC1jaGFuZ2VzLmpzXCJcbmltcG9ydCB7bWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuXG5pbXBvcnQgU3luY0FwaUNsaWVudCBmcm9tIFwiLi9zeW5jLWFwaS1jbGllbnQuanNcIlxuaW1wb3J0IHtWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSBmcm9tIFwiLi9zeW5jLWNoYW5uZWwtbmFtZS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVDaGFubmVsRGVzY3JpcHRvcn0gVmVsb2Npb3VzU3luY1JlYWx0aW1lQ2hhbm5lbERlc2NyaXB0b3IgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVXZWJzb2NrZXRDbGllbnR9IFZlbG9jaW91c1N5bmNSZWFsdGltZVdlYnNvY2tldENsaWVudCAqL1xuXG4vKipcbiAqIERlcml2ZWQgcmVhbHRpbWUgcHVzaCBicmlkZ2UgZm9yIHRoZSBzeW5jIGNsaWVudC4gU3Vic2NyaWJlcyBldmVyeSBkZWNsYXJlZFxuICogcHVsbCBzY29wZSB0byB0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCAoe0BsaW5rIFZFTE9DSU9VU19TWU5DX0NIQU5ORUx9KVxuICogYXV0b21hdGljYWxseSDigJQgdGhlIHN1YnNjcmliZSBwYXJhbXMgbWlycm9yIHRoZSBzY29wZSdzXG4gKiBge3Jlc291cmNlVHlwZSwgY29uZGl0aW9uc31gIHNvIHRoZSBzZXJ2ZXIgYXV0aG9yaXplcyB0aGVtIHRocm91Z2ggdGhlIHNhbWVcbiAqIHN5bmMgcmVzb3VyY2UgYXV0aG9yaXphdGlvbiBhcyBwdWxscyDigJQgcGx1cyBhbnkgZGVwcmVjYXRlZCBsZWdhY3kgY2hhbm5lbHNcbiAqIChjb25maWcgYHN5bmMuY2xpZW50LnJlYWx0aW1lLmNoYW5uZWxzYCBjYWxsYmFjayBhbmQgbW9kZWwtbGV2ZWxcbiAqIGBzdGF0aWMgc3luYyA9IHtyZWFsdGltZToge2NoYW5uZWx9fWAgZGVjbGFyYXRpb25zKS4gUHVzaGVkIGNoYW5nZXMgYXBwbHlcbiAqIHRocm91Z2ggdGhlIHNhbWUgZGVyaXZlZCByZXNvdXJjZSBhcHBsaWVyIGFzIHB1bGxzICh3aXRoIGVjaG8gc3VwcHJlc3Npb25cbiAqIGFnYWluc3QgdHJhY2tlZCByZS1xdWV1ZWluZyksIG93bi1kZXZpY2UgbWVzc2FnZXMgYXJlIGRyb3BwZWQgYnkgZWNob1xuICogb3JpZ2luLCBhbmQgYSBjb2FsZXNjZWQgYHB1bGwoKWAgZmlyZXMgd2hlbiBzdWJzY3JpcHRpb25zIGJlY29tZSByZWFkeSBvclxuICogcmVzdW1lIHNvIG9mZmxpbmUgZ2FwcyBjbG9zZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY1JlYWx0aW1lQnJpZGdlIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYnJpZGdlIGZvciBhIHN5bmMgY2xpZW50LlxuICAgKiBAcGFyYW0ge3tzeW5jQ2xpZW50OiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQnJpZGdlIGFyZ3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7c3luY0NsaWVudH0pIHtcbiAgICB0aGlzLnN5bmNDbGllbnQgPSBzeW5jQ2xpZW50XG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2hhbm5lbDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGwsIHN1YnNjcmlwdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVTdWJzY3JpcHRpb259Pn0gKi9cbiAgICB0aGlzLl9jaGFubmVscyA9IFtdXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNTeW5jUmVhbHRpbWVXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xuICAgIHRoaXMuX2NsaWVudCA9IG51bGxcbiAgICAvKiogQHR5cGUge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGJyaWRnZSBjcmVhdGVkIGl0cyBvd24gY2xpZW50IChkZXByZWNhdGVkIHBlci1jeWNsZSBwYXRoKSBhbmQgbXVzdCBkaXNjb25uZWN0IGl0IG9uIHVuc3Vic2NyaWJlLiBBIHNoYXJlZCBjb25uZWN0aW9uIGlzIG5ldmVyIG93bmVkLiAqL1xuICAgIHRoaXMuX293bnNDbGllbnQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLl9hcHBseVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIC8qKiBAdHlwZSB7bnVtYmVyfSBTdWJzY3JpcHRpb24gZ2VuZXJhdGlvbiAtIGJ1bXBlZCBieSB1bnN1YnNjcmliZSBzbyBpbi1mbGlnaHQgc3Vic2NyaWJlcyBkZXRlY3QgdGhleSBiZWNhbWUgc3RhbGUuICovXG4gICAgdGhpcy5fZ2VuZXJhdGlvbiA9IDBcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3NjaGVkdWxlZFB1bGwgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zdWJzY3JpYmVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7XCJzdWJzY3JpYmVkXCIgfCBcInN1YnNjcmliaW5nXCIgfCBcInVuc3Vic2NyaWJlZFwifSAqL1xuICAgIHRoaXMuX3N0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdGhlIGRlcml2ZWQgcmVhbHRpbWUgY2hhbm5lbHMgKGlkZW1wb3RlbnQgYW5kIHNpbmdsZS1mbGlnaHRlZCk6XG4gICAqIGFuIGFjdGl2ZSBzdWJzY3JpcHRpb24gaXMga2VwdCBhcy1pcyBhbmQgYSBjb25jdXJyZW50IHN1YnNjcmliZSBhd2FpdHMgdGhlXG4gICAqIGluLWZsaWdodCBhdHRlbXB0LiBDYWxsIGB1bnN1YnNjcmliZSgpYCBmaXJzdCB0byBjaGFuZ2UgdGhlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtjb250ZXh0XSAtIEFwcCBjb250ZXh0IHBhc3NlZCB0byB0aGUgZGVwcmVjYXRlZCBgc3luYy5jbGllbnQucmVhbHRpbWUuY2hhbm5lbHNgIGNhbGxiYWNrIChydW50aW1lIHNjb3BlIHZhbHVlcykuXG4gICAqIEBwYXJhbSB7e3NpZ25hbD86IEFib3J0U2lnbmFsfX0gW29wdGlvbnNdIC0gU3Vic2NyaXB0aW9uIGxpZmVjeWNsZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN1YnNjcmliZShjb250ZXh0LCB7c2lnbmFsfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuX3N0YXRlID09PSBcInN1YnNjcmliZWRcIikgcmV0dXJuXG5cbiAgICBpZiAoIXRoaXMuX3N1YnNjcmliZVByb21pc2UpIHtcbiAgICAgIHRoaXMuX3N1YnNjcmliZVByb21pc2UgPSB0aGlzLl9zdWJzY3JpYmUoY29udGV4dCwgc2lnbmFsKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZSA9IG51bGxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRoZSB3ZWJzb2NrZXQgY2xpZW50LCBzdWJzY3JpYmVzIGV2ZXJ5IGRlcml2ZWQgY2hhbm5lbCwgYW5kIHdhaXRzXG4gICAqIGZvciBlYWNoIHN1YnNjcmlwdGlvbidzIHNlcnZlciBhY2tub3dsZWRnZW1lbnQgYmVmb3JlIHRoZSBnYXAtY2xvc2luZyBwdWxsLFxuICAgKiBzbyBubyBjaGFuZ2UgY2FuIGxhbmQgYmV0d2VlbiB0aGUgcHVsbCBhbmQgdGhlIHN1YnNjcmlwdGlvbnMgZ29pbmcgbGl2ZS5cbiAgICogTG9jYWxseSBjcmVhdGVkIHJlc291cmNlcyBhcmUgb25seSBwcm9tb3RlZCB0byB0aGUgYnJpZGdlIG9uY2UgZXZlcnl0aGluZ1xuICAgKiBpcyBsaXZlOyBhbiB1bnN1YnNjcmliZSBhcnJpdmluZyBkdXJpbmcgYW55IGF3YWl0IG1hcmtzIHRoaXMgYXR0ZW1wdCBzdGFsZVxuICAgKiBhbmQgaXQgdGVhcnMgaXRzIG93biByZXNvdXJjZXMgZG93biBpbnN0ZWFkIG9mIHJlc3Vic2NyaWJpbmcuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbnRleHQgLSBBcHAgY29udGV4dCBwYXNzZWQgdG8gdGhlIGNoYW5uZWxzIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSBzaWduYWwgLSBTdWJzY3JpcHRpb24gbGlmZWN5Y2xlIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc3Vic2NyaWJlKGNvbnRleHQsIHNpZ25hbCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9nZW5lcmF0aW9uXG5cbiAgICB0aGlzLl9zdGF0ZSA9IFwic3Vic2NyaWJpbmdcIlxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2hhbm5lbDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGwsIHN1YnNjcmlwdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVTdWJzY3JpcHRpb259Pn0gKi9cbiAgICBjb25zdCBjaGFubmVscyA9IFtdXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNTeW5jUmVhbHRpbWVXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xuICAgIGxldCBjbGllbnQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtib29sZWFufSBXaGV0aGVyIHRoaXMgYXR0ZW1wdCBjcmVhdGVkIGl0cyBvd24gY2xpZW50IGFuZCBtdXN0IGRpc2Nvbm5lY3QgaXQgb24gdGVhcmRvd24uICovXG4gICAgbGV0IG93bnNDbGllbnQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFRlYXJzIGRvd24gZXZlcnl0aGluZyB0aGlzIHN0YWxlL2ZhaWxlZCBzdWJzY3JpYmUgYXR0ZW1wdCBjcmVhdGVkIGl0c2VsZjpcbiAgICAgKiBhbHdheXMgY2xvc2VzIGl0cyBjaGFubmVsIHN1YnNjcmlwdGlvbnMsIGFuZCBkaXNjb25uZWN0cyB0aGUgd2Vic29ja2V0XG4gICAgICogb25seSB3aGVuIHRoZSBicmlkZ2Ugb3ducyBpdCAoZGVwcmVjYXRlZCBwZXItY3ljbGUgcGF0aCk7IGEgc2hhcmVkXG4gICAgICogY29ubmVjdGlvbiBzdGF5cyBvcGVuLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIGNvbnN0IHRlYXJkb3duID0gYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCB7c3Vic2NyaXB0aW9ufSBvZiBjaGFubmVscykge1xuICAgICAgICBzdWJzY3JpcHRpb24uY2xvc2UoKVxuICAgICAgfVxuXG4gICAgICBpZiAoY2xpZW50ICYmIG93bnNDbGllbnQpIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHRocm93SWZBYm9ydGVkKHNpZ25hbClcblxuICAgICAgY29uc3Qgc2hhcmVkQ2xpZW50ID0gdGhpcy5zeW5jQ2xpZW50LnN5bmNDb25uZWN0aW9uKClcbiAgICAgIGNvbnN0IHJlYWx0aW1lID0gdGhpcy5yZXF1aXJlQ2xpZW50U291cmNlKHNoYXJlZENsaWVudClcbiAgICAgIGNvbnN0IGNoYW5uZWxEZXNjcmlwdG9ycyA9IGF3YWl0IHRoaXMuY2hhbm5lbERlc2NyaXB0b3JzKGNvbnRleHQpXG5cbiAgICAgIHRocm93SWZBYm9ydGVkKHNpZ25hbClcbiAgICAgIGlmIChnZW5lcmF0aW9uICE9PSB0aGlzLl9nZW5lcmF0aW9uKSByZXR1cm5cblxuICAgICAgaWYgKHNoYXJlZENsaWVudCkge1xuICAgICAgICBjbGllbnQgPSBzaGFyZWRDbGllbnRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIHJlcXVpcmVDbGllbnRTb3VyY2UgZ3VhcmFudGVlZCByZWFsdGltZS5jcmVhdGVDbGllbnQgd2hlbiB0aGVyZSBpcyBubyBzaGFyZWQgY29ubmVjdGlvbi5cbiAgICAgICAgY2xpZW50ID0gYXdhaXQgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRSZWFsdGltZUNvbmZpZ3VyYXRpb259ICovIChyZWFsdGltZSkuY3JlYXRlQ2xpZW50KClcbiAgICAgICAgb3duc0NsaWVudCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgaWYgKGdlbmVyYXRpb24gIT09IHRoaXMuX2dlbmVyYXRpb24pIHtcbiAgICAgICAgYXdhaXQgdGVhcmRvd24oKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3Qoe3NpZ25hbH0pXG5cbiAgICAgIHRocm93SWZBYm9ydGVkKHNpZ25hbClcbiAgICAgIGlmIChnZW5lcmF0aW9uICE9PSB0aGlzLl9nZW5lcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRlYXJkb3duKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF1dGhlbnRpY2F0aW9uVG9rZW4gPSBhd2FpdCB0aGlzLnN5bmNDbGllbnQuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKVxuXG4gICAgICB0aHJvd0lmQWJvcnRlZChzaWduYWwpXG4gICAgICBpZiAoZ2VuZXJhdGlvbiAhPT0gdGhpcy5fZ2VuZXJhdGlvbikge1xuICAgICAgICBhd2FpdCB0ZWFyZG93bigpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNoYW5uZWxEZXNjcmlwdG9yIG9mIGNoYW5uZWxEZXNjcmlwdG9ycykge1xuICAgICAgICBpZiAoY2hhbm5lbERlc2NyaXB0b3IucGFyYW1zICYmIFwiYXV0aGVudGljYXRpb25Ub2tlblwiIGluIGNoYW5uZWxEZXNjcmlwdG9yLnBhcmFtcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVhbHRpbWUgY2hhbm5lbCBcIiR7Y2hhbm5lbERlc2NyaXB0b3IuY2hhbm5lbH1cIiBwYXJhbXMgbXVzdCBub3QgaW5jbHVkZSBhdXRoZW50aWNhdGlvblRva2VuIC0gdGhlIGZyYW1ld29yayBpbmplY3RzIHRoZSBzeW5jLmNsaWVudCBhdXRoZW50aWNhdGlvblRva2VuIGF1dG9tYXRpY2FsbHlgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gY2hhbm5lbERlc2NyaXB0b3IucmVzb3VyY2VUeXBlID8/IG51bGxcbiAgICAgICAgY29uc3QgcGFyYW1zID0gbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dCh7XG4gICAgICAgICAgY29udGV4dDogdGhpcy5zeW5jQ2xpZW50LmNvbmZpZy5yZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgICAgICBwYXJhbXM6IHsuLi5jaGFubmVsRGVzY3JpcHRvci5wYXJhbXMsIGF1dGhlbnRpY2F0aW9uVG9rZW59XG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKGNoYW5uZWxEZXNjcmlwdG9yLmNoYW5uZWwsIHtcbiAgICAgICAgICBvbk1lc3NhZ2U6IChib2R5KSA9PiB0aGlzLmVucXVldWVBcHBseSh7Ym9keSwgZ2VuZXJhdGlvbiwgcmVzb3VyY2VUeXBlfSksXG4gICAgICAgICAgb25SZXN1bWU6ICgpID0+IHRoaXMuc2NoZWR1bGVQdWxsKGdlbmVyYXRpb24pLFxuICAgICAgICAgIHBhcmFtc1xuICAgICAgICB9KVxuXG4gICAgICAgIGNoYW5uZWxzLnB1c2goe2NoYW5uZWw6IGNoYW5uZWxEZXNjcmlwdG9yLmNoYW5uZWwsIHJlc291cmNlVHlwZSwgc3Vic2NyaXB0aW9ufSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoY2hhbm5lbHMubWFwKCh7c3Vic2NyaXB0aW9ufSkgPT4gc3Vic2NyaXB0aW9uLndhaXRGb3JSZWFkeSh7c2lnbmFsfSkpKVxuXG4gICAgICB0aHJvd0lmQWJvcnRlZChzaWduYWwpXG4gICAgICBpZiAoZ2VuZXJhdGlvbiAhPT0gdGhpcy5fZ2VuZXJhdGlvbikge1xuICAgICAgICBhd2FpdCB0ZWFyZG93bigpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9jaGFubmVscyA9IGNoYW5uZWxzXG4gICAgICB0aGlzLl9jbGllbnQgPSBjbGllbnRcbiAgICAgIHRoaXMuX293bnNDbGllbnQgPSBvd25zQ2xpZW50XG4gICAgICB0aGlzLl9zdGF0ZSA9IFwic3Vic2NyaWJlZFwiXG4gICAgICB0aGlzLnNjaGVkdWxlUHVsbChnZW5lcmF0aW9uKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0ZWFyZG93bigpXG5cbiAgICAgIGlmIChnZW5lcmF0aW9uID09PSB0aGlzLl9nZW5lcmF0aW9uKSB0aGlzLl9zdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGV2ZXJ5IGNoYW5uZWwgc3Vic2NyaXB0aW9uIChpZGVtcG90ZW50KS4gVGhlIHdlYnNvY2tldCBpc1xuICAgKiBkaXNjb25uZWN0ZWQgb25seSB3aGVuIHRoZSBicmlkZ2Ugb3ducyBpdCAoZGVwcmVjYXRlZCBwZXItY3ljbGVcbiAgICogYHJlYWx0aW1lLmNyZWF0ZUNsaWVudGAgcGF0aCk7IGEgc2hhcmVkIGFwcC1saWZldGltZSBjb25uZWN0aW9uIHN0YXlzIG9wZW5cbiAgICogc28gdW5zdWJzY3JpYmluZyBkcm9wcyBzdWJzY3JpcHRpb25zIHdpdGhvdXQgdGVhcmluZyBkb3duIHRoZSBzb2NrZXQuIEFsc29cbiAgICogbWFya3MgYW55IGluLWZsaWdodCBzdWJzY3JpYmUgYXR0ZW1wdCBzdGFsZSBzbyBpdCB0ZWFycyBpdHNlbGYgZG93biBpbnN0ZWFkXG4gICAqIG9mIGZpbmlzaGluZyB0aGUgc3Vic2NyaXB0aW9uIGFmdGVyd2FyZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zdWJzY3JpYmUoKSB7XG4gICAgdGhpcy5fZ2VuZXJhdGlvbiArPSAxXG5cbiAgICBjb25zdCBjaGFubmVscyA9IHRoaXMuX2NoYW5uZWxzXG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5fY2xpZW50XG4gICAgY29uc3Qgb3duc0NsaWVudCA9IHRoaXMuX293bnNDbGllbnRcblxuICAgIHRoaXMuX2NoYW5uZWxzID0gW11cbiAgICB0aGlzLl9jbGllbnQgPSBudWxsXG4gICAgdGhpcy5fb3duc0NsaWVudCA9IGZhbHNlXG4gICAgdGhpcy5fc3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG5cbiAgICBmb3IgKGNvbnN0IHtzdWJzY3JpcHRpb259IG9mIGNoYW5uZWxzKSB7XG4gICAgICBzdWJzY3JpcHRpb24uY2xvc2UoKVxuICAgIH1cblxuICAgIGlmIChjbGllbnQgJiYgb3duc0NsaWVudCkgYXdhaXQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIHRoZSBicmlkZ2Ugc3Vic2NyaXB0aW9uIHN0YXRlIGFuZCBwZXItY2hhbm5lbCByZWFkaW5lc3MuXG4gICAqIEByZXR1cm5zIHt7Y2hhbm5lbHM6IEFycmF5PHtjaGFubmVsOiBzdHJpbmcsIHJlYWR5OiBib29sZWFuLCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGx9Piwgc3RhdGU6IFwic3Vic2NyaWJlZFwiIHwgXCJzdWJzY3JpYmluZ1wiIHwgXCJ1bnN1YnNjcmliZWRcIn19IFJlYWx0aW1lIHN0YXR1cy5cbiAgICovXG4gIHN0YXR1cygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY2hhbm5lbHM6IHRoaXMuX2NoYW5uZWxzLm1hcCgoe2NoYW5uZWwsIHJlc291cmNlVHlwZSwgc3Vic2NyaXB0aW9ufSkgPT4gKHtjaGFubmVsLCByZWFkeTogc3Vic2NyaXB0aW9uLmlzUmVhZHkoKSwgcmVzb3VyY2VUeXBlfSkpLFxuICAgICAgc3RhdGU6IHRoaXMuX3N0YXRlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhbGwgZW5xdWV1ZWQgbWVzc2FnZSBhcHBsaWVzIGFuZCBhbnkgc2NoZWR1bGVkIHB1bGwgKHRlc3RzLCBzaHV0ZG93biBmbG93cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FpdEZvckFwcGxpZWQoKSB7XG4gICAgYXdhaXQgdGhpcy5fYXBwbHlQcm9taXNlXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFB1bGwpIGF3YWl0IHRoaXMuX3NjaGVkdWxlZFB1bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgcmVhbHRpbWUgY29uZmlndXJhdGlvbiBibG9jaywgb3IgbnVsbCB3aGVuIHRoZSBhcHAgZGVjbGFyZWRcbiAgICogbm9uZSAodmFsaWQgd2hlbiBhIHNoYXJlZCBjb25uZWN0aW9uIGlzIGNvbmZpZ3VyZWQpLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50UmVhbHRpbWVDb25maWd1cmF0aW9uIHwgbnVsbH0gUmVhbHRpbWUgY29uZmlndXJhdGlvbiwgb3IgbnVsbC5cbiAgICovXG4gIHJlYWx0aW1lQ29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5zeW5jQ2xpZW50LmNvbmZpZy5yZWFsdGltZSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJlYWx0aW1lIGNvbmZpZ3VyYXRpb24gYW5kIGFzc2VydHMgYSB3ZWJzb2NrZXQgY2xpZW50IHNvdXJjZVxuICAgKiBleGlzdHM6IGEgc2hhcmVkIGNvbm5lY3Rpb24gcmlkZXMgaXRzIG93biBsaWZlY3ljbGUsIG90aGVyd2lzZSB0aGVcbiAgICogZGVwcmVjYXRlZCBwZXItY3ljbGUgYHJlYWx0aW1lLmNyZWF0ZUNsaWVudGAgbXVzdCBiZSBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY1JlYWx0aW1lV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gc2hhcmVkQ2xpZW50IC0gU2hhcmVkIGNvbm5lY3Rpb24sIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRSZWFsdGltZUNvbmZpZ3VyYXRpb24gfCBudWxsfSBSZWFsdGltZSBjb25maWd1cmF0aW9uLCBvciBudWxsLlxuICAgKi9cbiAgcmVxdWlyZUNsaWVudFNvdXJjZShzaGFyZWRDbGllbnQpIHtcbiAgICBjb25zdCByZWFsdGltZSA9IHRoaXMucmVhbHRpbWVDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghc2hhcmVkQ2xpZW50ICYmIHR5cGVvZiByZWFsdGltZT8uY3JlYXRlQ2xpZW50ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN1YnNjcmliZVJlYWx0aW1lIHJlcXVpcmVzIGEgc2hhcmVkIGNvbm5lY3Rpb24gKHN5bmMuY2xpZW50LndlYnNvY2tldFVybCBvciBzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnQpIG9yIHRoZSBkZXByZWNhdGVkIHN5bmMuY2xpZW50LnJlYWx0aW1lLmNyZWF0ZUNsaWVudCBjYWxsYmFja1wiKVxuICAgIH1cblxuICAgIHJldHVybiByZWFsdGltZVxuICB9XG5cbiAgLyoqXG4gICAqIERlcml2ZXMgdGhlIGNoYW5uZWwgZGVzY3JpcHRvcnMgdG8gc3Vic2NyaWJlOiBvbmUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbFxuICAgKiBzdWJzY3JpcHRpb24gcGVyIGRlY2xhcmVkIHB1bGwgc2NvcGUgKHRoZSBwYXJhbXMgbWlycm9yIHRoZSBzY29wZSdzXG4gICAqIGB7cmVzb3VyY2VUeXBlLCBjb25kaXRpb25zfWApLCBwbHVzIHRoZSBkZXByZWNhdGVkIGxlZ2FjeSBwYXRocyDigJRcbiAgICogbW9kZWwtbGV2ZWwgc3RhdGljIHJlYWx0aW1lIGRlY2xhcmF0aW9ucyBhbmQgdGhlIGNvbmZpZyBjaGFubmVscyBjYWxsYmFjay5cbiAgICogRmFpbHMgbG91ZGx5IHdoZW4gbm90aGluZyBpcyBzdWJzY3JpYmFibGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbnRleHQgLSBBcHAgY29udGV4dCBwYXNzZWQgdG8gdGhlIGRlcHJlY2F0ZWQgY2hhbm5lbHMgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFZlbG9jaW91c1N5bmNSZWFsdGltZUNoYW5uZWxEZXNjcmlwdG9yPj59IENoYW5uZWwgZGVzY3JpcHRvcnMuXG4gICAqL1xuICBhc3luYyBjaGFubmVsRGVzY3JpcHRvcnMoY29udGV4dCkge1xuICAgIGNvbnN0IHJlYWx0aW1lID0gdGhpcy5yZWFsdGltZUNvbmZpZ3VyYXRpb24oKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8VmVsb2Npb3VzU3luY1JlYWx0aW1lQ2hhbm5lbERlc2NyaXB0b3I+fSAqL1xuICAgIGNvbnN0IGNoYW5uZWxEZXNjcmlwdG9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlUm93IG9mIGF3YWl0IHRoaXMuc3luY0NsaWVudC5zY29wZVN0b3JlKCkuYWN0aXZlU2NvcGVzKCkpIHtcbiAgICAgIGNoYW5uZWxEZXNjcmlwdG9ycy5wdXNoKHtcbiAgICAgICAgY2hhbm5lbDogVkVMT0NJT1VTX1NZTkNfQ0hBTk5FTCxcbiAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgY29uZGl0aW9uczogdGhpcy5hdHRyaWJ1dGVOYW1lZENvbmRpdGlvbnMoc2NvcGVSb3cpLFxuICAgICAgICAgIHJlc291cmNlVHlwZTogc2NvcGVSb3cucmVzb3VyY2VUeXBlLFxuICAgICAgICAgIC8vIE9ubHkgdGhlIGFsbC10eXBlcyBzY29wZSBjYXJyaWVzIHRoZSB0eXBlIGxpc3Q7IGEgdHlwZS1kZWNsYXJlZCBzY29wZSBuZWVkcyBub25lLlxuICAgICAgICAgIC4uLihzY29wZVJvdy5yZXNvdXJjZVR5cGUgPT09IG51bGwgPyB7cmVzb3VyY2VUeXBlczogdGhpcy5zeW5jQ2xpZW50LnVzZXJTY29wZVJlc291cmNlVHlwZXMoKX0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnN5bmNDbGllbnQuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgIGlmICghcmVzb3VyY2VDb25maWcucmVhbHRpbWUpIGNvbnRpbnVlXG5cbiAgICAgIGNoYW5uZWxEZXNjcmlwdG9ycy5wdXNoKHtjaGFubmVsOiByZXNvdXJjZUNvbmZpZy5yZWFsdGltZS5jaGFubmVsLCBwYXJhbXM6IHJlc291cmNlQ29uZmlnLnJlYWx0aW1lLnBhcmFtcywgcmVzb3VyY2VUeXBlfSlcbiAgICB9XG5cbiAgICBpZiAocmVhbHRpbWU/LmNoYW5uZWxzKSB7XG4gICAgICBjaGFubmVsRGVzY3JpcHRvcnMucHVzaCguLi5hd2FpdCByZWFsdGltZS5jaGFubmVscyhjb250ZXh0KSlcbiAgICB9XG5cbiAgICBpZiAoY2hhbm5lbERlc2NyaXB0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3Vic2NyaWJlUmVhbHRpbWUgZm91bmQgbm8gY2hhbm5lbHMgdG8gc3Vic2NyaWJlIC0gZGVjbGFyZSBhIHN5bmMgc2NvcGUgKHN5bmNDbGllbnQoKS5zeW5jKHF1ZXJ5KSkgc28gaXRzIGZyYW1ld29yayBzeW5jIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGNhbiBiZSBkZXJpdmVkLCBvciB0aGUgZGVwcmVjYXRlZCBzeW5jLmNsaWVudC5yZWFsdGltZS5jaGFubmVscyBjYWxsYmFja1wiKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFubmVsRGVzY3JpcHRvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2xhdGVzIGEgcGVyc2lzdGVkIHNjb3BlJ3MgY29uZGl0aW9uIGtleXMgdG8gdGhlIG1vZGVsJ3MgYXR0cmlidXRlXG4gICAqIG5hbWVzIHNvIHRoZSBmcmFtZXdvcmsgY2hhbm5lbCBzdWJzY3JpcHRpb24gbWF0Y2hlcyB0aGUgcHVibGlzaGVyJ3NcbiAgICogYXR0cmlidXRlLW5hbWVkIHNjb3BpbmcgcGFyYW1zOiBgc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5YCBwZXJzaXN0cyB0aGVcbiAgICogcXVlcnkncyBtb2RlbC1ub3JtYWxpemVkIGNvbHVtbiBuYW1lcyAoZm9yIGV4YW1wbGUgYHByb2plY3RfaWRgKSwgd2hpbGVcbiAgICogc2NvcGUtcGFydGl0aW9uIGJyb2FkY2FzdHMgY2FycnkgYXR0cmlidXRlIG5hbWVzIChgcHJvamVjdElkYCkuIEtleXNcbiAgICogd2l0aG91dCBhIGNvbHVtbiBtYXBwaW5nIGFyZSBhbHJlYWR5IGF0dHJpYnV0ZSBuYW1lcyBhbmQgcGFzcyB0aHJvdWdoO1xuICAgKiBzY29wZXMgb24gbW9kZWxzIHdpdGhvdXQgYSBkZWNsYXJlZCBzeW5jIHJlc291cmNlIGZhaWwgbG91ZGx5IGJlY2F1c2Ugbm9cbiAgICogYXR0cmlidXRlIG1hcHBpbmcgZXhpc3RzIGZvciB0aGVtLlxuICAgKlxuICAgKiBUaGUgYWxsLXR5cGVzICh1c2VyKSBzY29wZSBoYXMgbm8gcmVzb3VyY2UgdHlwZSBhbmQgbm8gY29uZGl0aW9ucyAtIGl0XG4gICAqIGNvdmVycyBldmVyeXRoaW5nIHRoZSBzZXJ2ZXIgYXV0aG9yaXplcyBmb3IgdGhlIGNhbGxlciAtIHNvIHRoZXJlIGlzXG4gICAqIG5vdGhpbmcgdG8gbWFwLlxuICAgKiBAcGFyYW0ge3tjb25kaXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlc291cmNlVHlwZTogc3RyaW5nIHwgbnVsbH19IHNjb3BlUm93IC0gQWN0aXZlIHNjb3BlIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQXR0cmlidXRlLW5hbWVkIHNjb3BlIGNvbmRpdGlvbnMuXG4gICAqL1xuICBhdHRyaWJ1dGVOYW1lZENvbmRpdGlvbnMoc2NvcGVSb3cpIHtcbiAgICBpZiAoc2NvcGVSb3cucmVzb3VyY2VUeXBlID09PSBudWxsKSByZXR1cm4ge31cblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5zeW5jQ2xpZW50LmNvbmZpZy5yZXNvdXJjZXNbc2NvcGVSb3cucmVzb3VyY2VUeXBlXVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzdWJzY3JpYmVSZWFsdGltZSBjYW4ndCBkZXJpdmUgYXR0cmlidXRlIG5hbWVzIGZvciB0aGUgc3luYyBzY29wZSBkZWNsYXJlZCBvbiAke3Njb3BlUm93LnJlc291cmNlVHlwZX0gLSBkZWNsYXJlIHN0YXRpYyBzeW5jIG9uIHRoYXQgbW9kZWwgc28gaXRzIHJlc291cmNlIGlzIHJlZ2lzdGVyZWRgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSByZXNvdXJjZUNvbmZpZy5tZXRhZGF0YU1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtjb25kaXRpb25OYW1lLCBjb25kaXRpb25WYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSb3cuY29uZGl0aW9ucykpIHtcbiAgICAgIGNvbmRpdGlvbnNbY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb25kaXRpb25OYW1lXSB8fCBjb25kaXRpb25OYW1lXSA9IGNvbmRpdGlvblZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbmRpdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGFpbnMgb25lIHB1c2hlZCBtZXNzYWdlIG9udG8gdGhlIHNlcmlhbGl6ZWQgYXBwbHkgcXVldWUgc28gY2hhbmdlcyBhcHBseVxuICAgKiBpbiBhcnJpdmFsIG9yZGVyOyBmYWlsdXJlcyBnbyB0byB0aGUgc3luYyBjbGllbnQncyBlcnJvciByZXBvcnRpbmcuXG4gICAqIEBwYXJhbSB7e2JvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBnZW5lcmF0aW9uPzogbnVtYmVyLCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGx9fSBhcmdzIC0gTWVzc2FnZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVucXVldWVBcHBseSh7Ym9keSwgZ2VuZXJhdGlvbiA9IHRoaXMuX2dlbmVyYXRpb24sIHJlc291cmNlVHlwZX0pIHtcbiAgICB0aGlzLl9hcHBseVByb21pc2UgPSB0aGlzLl9hcHBseVByb21pc2UudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoZ2VuZXJhdGlvbiAhPT0gdGhpcy5fZ2VuZXJhdGlvbikgcmV0dXJuXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwbHlNZXNzYWdlKHtib2R5LCByZXNvdXJjZVR5cGV9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5zeW5jQ2xpZW50LnJlcG9ydEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBwdXNoZWQgbWVzc2FnZSB0aHJvdWdoIHRoZSBkZXJpdmVkIHJlc291cmNlIGFwcGxpZXI6IGRyb3BzXG4gICAqIG93bi1kZXZpY2UgbWVzc2FnZXMgYnkgZWNobyBvcmlnaW4sIGRlZmF1bHRzIHRoZSBjaGFubmVsJ3MgcmVzb3VyY2VUeXBlIG9udG9cbiAgICogZW52ZWxvcGVzIHdpdGhvdXQgb25lLCBhbmQgZmFpbHMgbG91ZGx5IG9uIHVua25vd24gcmVzb3VyY2UgdHlwZXMuXG4gICAqIEBwYXJhbSB7e2JvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGx9fSBhcmdzIC0gTWVzc2FnZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGFwcGx5TWVzc2FnZSh7Ym9keSwgcmVzb3VyY2VUeXBlfSkge1xuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGJvZHkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlYWx0aW1lIHN5bmMgbWVzc2FnZXMgbXVzdCBiZSBlbnZlbG9wZSBvYmplY3RzLCBnb3Q6ICR7SlNPTi5zdHJpbmdpZnkoYm9keSl9YClcbiAgICB9XG5cbiAgICBjb25zdCByZWFsdGltZSA9IHRoaXMucmVhbHRpbWVDb25maWd1cmF0aW9uKClcblxuICAgIGlmIChyZWFsdGltZT8ubG9jYWxPcmlnaW4gJiYgYm9keS5lY2hvT3JpZ2luICE9PSB1bmRlZmluZWQgJiYgYm9keS5lY2hvT3JpZ2luICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBsb2NhbE9yaWdpbiA9IFN0cmluZyhhd2FpdCByZWFsdGltZS5sb2NhbE9yaWdpbigpKVxuXG4gICAgICBpZiAoU3RyaW5nKGJvZHkuZWNob09yaWdpbikgPT09IGxvY2FsT3JpZ2luKSByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBzeW5jUGF5bG9hZHMgPSBBcnJheS5pc0FycmF5KGJvZHkuc3luY3MpID8gYm9keS5zeW5jcyA6IFtib2R5XVxuICAgIGNvbnN0IGFwcGx5U3luYyA9IHRoaXMuc3luY0NsaWVudC5yZW1vdGVBcHBseVN5bmMoe3NvdXJjZTogXCJyZW1vdGUgY2hhbmdlXCJ9KVxuXG4gICAgLy8gQ29hbGVzY2UgcmVjb3JkLWNoYW5nZSBldmVudHMgYWNyb3NzIHRoZSBwdXNoZWQgYmF0Y2ggc28gaXQgdHJpZ2dlcnMgb25lIGxpdmUtcXVlcnkgcmUtcnVuLlxuICAgIGF3YWl0IHJlY29yZENoYW5nZXMuYmF0Y2goYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBzeW5jUGF5bG9hZCBvZiBzeW5jUGF5bG9hZHMpIHtcbiAgICAgICAgY29uc3Qgc3luYyA9IFN5bmNBcGlDbGllbnQuc3luY0VudmVsb3BlRnJvbVBheWxvYWQoe3Jlc291cmNlVHlwZSwgLi4uc3luY1BheWxvYWR9KVxuXG4gICAgICAgIGF3YWl0IGFwcGx5U3luYyhzeW5jKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2NoZWR1bGVzIGEgY29hbGVzY2VkIGJhY2tncm91bmQgcHVsbCBjbG9zaW5nIG9mZmxpbmUgZ2FwcyBhZnRlclxuICAgKiAocmUpc3Vic2NyaXB0aW9uIHJlYWRpbmVzcy4gUmVzdW1lcyBhcnJpdmluZyB3aGlsZSBhIHB1bGwgaXMgYWxyZWFkeVxuICAgKiBzY2hlZHVsZWQgb3IgaW4gZmxpZ2h0IGNvYWxlc2NlIGludG8gdGhhdCBwdWxsIGluc3RlYWQgb2Ygc3RhY2tpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbZ2VuZXJhdGlvbl0gLSBTdWJzY3JpcHRpb24gZ2VuZXJhdGlvbiBvd25pbmcgdGhlIHJlc3VtZS9yZWFkaW5lc3MgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2NoZWR1bGVQdWxsKGdlbmVyYXRpb24gPSB0aGlzLl9nZW5lcmF0aW9uKSB7XG4gICAgaWYgKGdlbmVyYXRpb24gIT09IHRoaXMuX2dlbmVyYXRpb24pIHJldHVyblxuICAgIGlmICh0aGlzLnJlYWx0aW1lQ29uZmlndXJhdGlvbigpPy5wdWxsT25SZWNvbm5lY3QgPT09IGZhbHNlKSByZXR1cm5cblxuICAgIGNvbnN0IGNvb3JkaW5hdG9yUnVuID0gdGhpcy5zeW5jQ2xpZW50LnJlcXVlc3RDb29yZGluYXRvclN5bmMoXCJyZWFsdGltZVwiKVxuXG4gICAgaWYgKGNvb3JkaW5hdG9yUnVuKSB7XG4gICAgICB0aGlzLl9zY2hlZHVsZWRQdWxsIHx8PSBjb29yZGluYXRvclJ1bi5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVkUHVsbCA9IG51bGxcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9zY2hlZHVsZWRQdWxsIHx8PSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnB1bGwoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCF0aGlzLnN5bmNDbGllbnQuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikpIHtcbiAgICAgICAgICB0aGlzLnN5bmNDbGllbnQucmVwb3J0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVkUHVsbCA9IG51bGxcbiAgICAgIH1cbiAgICB9KSgpXG4gIH1cbn1cblxuLyoqXG4gKiBUaHJvd3MgdGhlIGxpZmVjeWNsZSBhYm9ydCByZWFzb24gd2hlbiB0aGUgc3Vic2NyaXB0aW9uIGlzIG5vIGxvbmdlciBvd25lZC5cbiAqIEBwYXJhbSB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IHNpZ25hbCAtIFN1YnNjcmlwdGlvbiBsaWZlY3ljbGUgc2lnbmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHRocm93SWZBYm9ydGVkKHNpZ25hbCkge1xuICBpZiAoIXNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuXG5cbiAgdGhyb3cgc2lnbmFsLnJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gc2lnbmFsLnJlYXNvbiA6IG5ldyBFcnJvcihcIlN5bmMgcmVhbHRpbWUgc3Vic2NyaXB0aW9uIHdhcyBhYm9ydGVkXCIpXG59XG4iXX0=