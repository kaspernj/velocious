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
     * @returns {Promise<void>}
     */
    async subscribe(context) {
        if (this._state === "subscribed")
            return;
        if (!this._subscribePromise) {
            this._subscribePromise = this._subscribe(context).finally(() => {
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
     * @returns {Promise<void>}
     */
    async _subscribe(context) {
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
            const sharedClient = this.syncClient.syncConnection();
            const realtime = this.requireClientSource(sharedClient);
            const channelDescriptors = await this.channelDescriptors(context);
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
            await client.connect();
            if (generation !== this._generation) {
                await teardown();
                return;
            }
            const authenticationToken = await this.syncClient.config.authenticationToken();
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
                    onMessage: (body) => this.enqueueApply({ body, resourceType }),
                    onResume: () => this.schedulePull(),
                    params
                });
                channels.push({ channel: channelDescriptor.channel, resourceType, subscription });
            }
            await Promise.all(channels.map(({ subscription }) => subscription.waitForReady()));
            if (generation !== this._generation) {
                await teardown();
                return;
            }
            this._channels = channels;
            this._client = client;
            this._ownsClient = ownsClient;
            this._state = "subscribed";
            this.schedulePull();
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
     * @param {{body: ReturnType<typeof JSON.parse>, resourceType: string | null}} args - Message args.
     * @returns {void}
     */
    enqueueApply({ body, resourceType }) {
        this._applyPromise = this._applyPromise.then(async () => {
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
     * @returns {void}
     */
    schedulePull() {
        if (this.realtimeConfiguration()?.pullOnReconnect === false)
            return;
        this._scheduledPull ||= (async () => {
            try {
                await this.syncClient.pull();
            }
            catch (error) {
                this.syncClient.reportError(/** @type {Error} */ (error));
            }
            finally {
                this._scheduledPull = null;
            }
        })();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZWFsdGltZS1icmlkZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXJlYWx0aW1lLWJyaWRnZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sK0JBQStCLENBQUE7QUFDekQsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFFdEUsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFFN0QsbUlBQW1JO0FBQ25JLCtIQUErSDtBQUUvSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGtCQUFrQjtJQUNyQzs7O09BR0c7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFDO1FBQ3RCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLHlKQUF5SjtRQUN6SixJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUNuQiwwREFBMEQ7UUFDMUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFDbkIsdUtBQXVLO1FBQ3ZLLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFBO1FBQ3hCLDRCQUE0QjtRQUM1QixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN0Qyx1SEFBdUg7UUFDdkgsSUFBSSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUE7UUFDcEIsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1FBQzFCLG1DQUFtQztRQUNuQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFBO1FBQzdCLDREQUE0RDtRQUM1RCxJQUFJLENBQUMsTUFBTSxHQUFHLGNBQWMsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gs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TSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDdkIsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsWUFBWTtRQUNWLElBQUksSUFBSSxDQUFDLHFCQUFxQixFQUFFLEVBQUUsZUFBZSxLQUFLLEtBQUs7WUFBRSxPQUFNO1FBRW5FLElBQUksQ0FBQyxjQUFjLEtBQUssQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNsQyxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxDQUFBO1lBQzlCLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLG9CQUFvQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUMzRCxDQUFDO29CQUFTLENBQUM7Z0JBQ1QsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUE7WUFDNUIsQ0FBQztRQUNILENBQUMsQ0FBQyxFQUFFLENBQUE7SUFDTixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlY29yZENoYW5nZXMgZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC1jaGFuZ2VzLmpzXCJcbmltcG9ydCB7bWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuXG5pbXBvcnQgU3luY0FwaUNsaWVudCBmcm9tIFwiLi9zeW5jLWFwaS1jbGllbnQuanNcIlxuaW1wb3J0IHtWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSBmcm9tIFwiLi9zeW5jLWNoYW5uZWwtbmFtZS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVDaGFubmVsRGVzY3JpcHRvcn0gVmVsb2Npb3VzU3luY1JlYWx0aW1lQ2hhbm5lbERlc2NyaXB0b3IgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVXZWJzb2NrZXRDbGllbnR9IFZlbG9jaW91c1N5bmNSZWFsdGltZVdlYnNvY2tldENsaWVudCAqL1xuXG4vKipcbiAqIERlcml2ZWQgcmVhbHRpbWUgcHVzaCBicmlkZ2UgZm9yIHRoZSBzeW5jIGNsaWVudC4gU3Vic2NyaWJlcyBldmVyeSBkZWNsYXJlZFxuICogcHVsbCBzY29wZSB0byB0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCAoe0BsaW5rIFZFTE9DSU9VU19TWU5DX0NIQU5ORUx9KVxuICogYXV0b21hdGljYWxseSDigJQgdGhlIHN1YnNjcmliZSBwYXJhbXMgbWlycm9yIHRoZSBzY29wZSdzXG4gKiBge3Jlc291cmNlVHlwZSwgY29uZGl0aW9uc31gIHNvIHRoZSBzZXJ2ZXIgYXV0aG9yaXplcyB0aGVtIHRocm91Z2ggdGhlIHNhbWVcbiAqIHN5bmMgcmVzb3VyY2UgYXV0aG9yaXphdGlvbiBhcyBwdWxscyDigJQgcGx1cyBhbnkgZGVwcmVjYXRlZCBsZWdhY3kgY2hhbm5lbHNcbiAqIChjb25maWcgYHN5bmMuY2xpZW50LnJlYWx0aW1lLmNoYW5uZWxzYCBjYWxsYmFjayBhbmQgbW9kZWwtbGV2ZWxcbiAqIGBzdGF0aWMgc3luYyA9IHtyZWFsdGltZToge2NoYW5uZWx9fWAgZGVjbGFyYXRpb25zKS4gUHVzaGVkIGNoYW5nZXMgYXBwbHlcbiAqIHRocm91Z2ggdGhlIHNhbWUgZGVyaXZlZCByZXNvdXJjZSBhcHBsaWVyIGFzIHB1bGxzICh3aXRoIGVjaG8gc3VwcHJlc3Npb25cbiAqIGFnYWluc3QgdHJhY2tlZCByZS1xdWV1ZWluZyksIG93bi1kZXZpY2UgbWVzc2FnZXMgYXJlIGRyb3BwZWQgYnkgZWNob1xuICogb3JpZ2luLCBhbmQgYSBjb2FsZXNjZWQgYHB1bGwoKWAgZmlyZXMgd2hlbiBzdWJzY3JpcHRpb25zIGJlY29tZSByZWFkeSBvclxuICogcmVzdW1lIHNvIG9mZmxpbmUgZ2FwcyBjbG9zZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY1JlYWx0aW1lQnJpZGdlIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYnJpZGdlIGZvciBhIHN5bmMgY2xpZW50LlxuICAgKiBAcGFyYW0ge3tzeW5jQ2xpZW50OiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQnJpZGdlIGFyZ3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7c3luY0NsaWVudH0pIHtcbiAgICB0aGlzLnN5bmNDbGllbnQgPSBzeW5jQ2xpZW50XG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2hhbm5lbDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGwsIHN1YnNjcmlwdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVTdWJzY3JpcHRpb259Pn0gKi9cbiAgICB0aGlzLl9jaGFubmVscyA9IFtdXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNTeW5jUmVhbHRpbWVXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xuICAgIHRoaXMuX2NsaWVudCA9IG51bGxcbiAgICAvKiogQHR5cGUge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGJyaWRnZSBjcmVhdGVkIGl0cyBvd24gY2xpZW50IChkZXByZWNhdGVkIHBlci1jeWNsZSBwYXRoKSBhbmQgbXVzdCBkaXNjb25uZWN0IGl0IG9uIHVuc3Vic2NyaWJlLiBBIHNoYXJlZCBjb25uZWN0aW9uIGlzIG5ldmVyIG93bmVkLiAqL1xuICAgIHRoaXMuX293bnNDbGllbnQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLl9hcHBseVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIC8qKiBAdHlwZSB7bnVtYmVyfSBTdWJzY3JpcHRpb24gZ2VuZXJhdGlvbiAtIGJ1bXBlZCBieSB1bnN1YnNjcmliZSBzbyBpbi1mbGlnaHQgc3Vic2NyaWJlcyBkZXRlY3QgdGhleSBiZWNhbWUgc3RhbGUuICovXG4gICAgdGhpcy5fZ2VuZXJhdGlvbiA9IDBcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3NjaGVkdWxlZFB1bGwgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zdWJzY3JpYmVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7XCJzdWJzY3JpYmVkXCIgfCBcInN1YnNjcmliaW5nXCIgfCBcInVuc3Vic2NyaWJlZFwifSAqL1xuICAgIHRoaXMuX3N0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdGhlIGRlcml2ZWQgcmVhbHRpbWUgY2hhbm5lbHMgKGlkZW1wb3RlbnQgYW5kIHNpbmdsZS1mbGlnaHRlZCk6XG4gICAqIGFuIGFjdGl2ZSBzdWJzY3JpcHRpb24gaXMga2VwdCBhcy1pcyBhbmQgYSBjb25jdXJyZW50IHN1YnNjcmliZSBhd2FpdHMgdGhlXG4gICAqIGluLWZsaWdodCBhdHRlbXB0LiBDYWxsIGB1bnN1YnNjcmliZSgpYCBmaXJzdCB0byBjaGFuZ2UgdGhlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtjb250ZXh0XSAtIEFwcCBjb250ZXh0IHBhc3NlZCB0byB0aGUgZGVwcmVjYXRlZCBgc3luYy5jbGllbnQucmVhbHRpbWUuY2hhbm5lbHNgIGNhbGxiYWNrIChydW50aW1lIHNjb3BlIHZhbHVlcykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3Vic2NyaWJlKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5fc3RhdGUgPT09IFwic3Vic2NyaWJlZFwiKSByZXR1cm5cblxuICAgIGlmICghdGhpcy5fc3Vic2NyaWJlUHJvbWlzZSkge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZSA9IHRoaXMuX3N1YnNjcmliZShjb250ZXh0KS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZSA9IG51bGxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRoZSB3ZWJzb2NrZXQgY2xpZW50LCBzdWJzY3JpYmVzIGV2ZXJ5IGRlcml2ZWQgY2hhbm5lbCwgYW5kIHdhaXRzXG4gICAqIGZvciBlYWNoIHN1YnNjcmlwdGlvbidzIHNlcnZlciBhY2tub3dsZWRnZW1lbnQgYmVmb3JlIHRoZSBnYXAtY2xvc2luZyBwdWxsLFxuICAgKiBzbyBubyBjaGFuZ2UgY2FuIGxhbmQgYmV0d2VlbiB0aGUgcHVsbCBhbmQgdGhlIHN1YnNjcmlwdGlvbnMgZ29pbmcgbGl2ZS5cbiAgICogTG9jYWxseSBjcmVhdGVkIHJlc291cmNlcyBhcmUgb25seSBwcm9tb3RlZCB0byB0aGUgYnJpZGdlIG9uY2UgZXZlcnl0aGluZ1xuICAgKiBpcyBsaXZlOyBhbiB1bnN1YnNjcmliZSBhcnJpdmluZyBkdXJpbmcgYW55IGF3YWl0IG1hcmtzIHRoaXMgYXR0ZW1wdCBzdGFsZVxuICAgKiBhbmQgaXQgdGVhcnMgaXRzIG93biByZXNvdXJjZXMgZG93biBpbnN0ZWFkIG9mIHJlc3Vic2NyaWJpbmcuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbnRleHQgLSBBcHAgY29udGV4dCBwYXNzZWQgdG8gdGhlIGNoYW5uZWxzIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9zdWJzY3JpYmUoY29udGV4dCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLl9nZW5lcmF0aW9uXG5cbiAgICB0aGlzLl9zdGF0ZSA9IFwic3Vic2NyaWJpbmdcIlxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2hhbm5lbDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGwsIHN1YnNjcmlwdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jUmVhbHRpbWVTdWJzY3JpcHRpb259Pn0gKi9cbiAgICBjb25zdCBjaGFubmVscyA9IFtdXG4gICAgLyoqIEB0eXBlIHtWZWxvY2lvdXNTeW5jUmVhbHRpbWVXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xuICAgIGxldCBjbGllbnQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtib29sZWFufSBXaGV0aGVyIHRoaXMgYXR0ZW1wdCBjcmVhdGVkIGl0cyBvd24gY2xpZW50IGFuZCBtdXN0IGRpc2Nvbm5lY3QgaXQgb24gdGVhcmRvd24uICovXG4gICAgbGV0IG93bnNDbGllbnQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFRlYXJzIGRvd24gZXZlcnl0aGluZyB0aGlzIHN0YWxlL2ZhaWxlZCBzdWJzY3JpYmUgYXR0ZW1wdCBjcmVhdGVkIGl0c2VsZjpcbiAgICAgKiBhbHdheXMgY2xvc2VzIGl0cyBjaGFubmVsIHN1YnNjcmlwdGlvbnMsIGFuZCBkaXNjb25uZWN0cyB0aGUgd2Vic29ja2V0XG4gICAgICogb25seSB3aGVuIHRoZSBicmlkZ2Ugb3ducyBpdCAoZGVwcmVjYXRlZCBwZXItY3ljbGUgcGF0aCk7IGEgc2hhcmVkXG4gICAgICogY29ubmVjdGlvbiBzdGF5cyBvcGVuLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIGNvbnN0IHRlYXJkb3duID0gYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCB7c3Vic2NyaXB0aW9ufSBvZiBjaGFubmVscykge1xuICAgICAgICBzdWJzY3JpcHRpb24uY2xvc2UoKVxuICAgICAgfVxuXG4gICAgICBpZiAoY2xpZW50ICYmIG93bnNDbGllbnQpIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHNoYXJlZENsaWVudCA9IHRoaXMuc3luY0NsaWVudC5zeW5jQ29ubmVjdGlvbigpXG4gICAgICBjb25zdCByZWFsdGltZSA9IHRoaXMucmVxdWlyZUNsaWVudFNvdXJjZShzaGFyZWRDbGllbnQpXG4gICAgICBjb25zdCBjaGFubmVsRGVzY3JpcHRvcnMgPSBhd2FpdCB0aGlzLmNoYW5uZWxEZXNjcmlwdG9ycyhjb250ZXh0KVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbiAhPT0gdGhpcy5fZ2VuZXJhdGlvbikgcmV0dXJuXG5cbiAgICAgIGlmIChzaGFyZWRDbGllbnQpIHtcbiAgICAgICAgY2xpZW50ID0gc2hhcmVkQ2xpZW50XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyByZXF1aXJlQ2xpZW50U291cmNlIGd1YXJhbnRlZWQgcmVhbHRpbWUuY3JlYXRlQ2xpZW50IHdoZW4gdGhlcmUgaXMgbm8gc2hhcmVkIGNvbm5lY3Rpb24uXG4gICAgICAgIGNsaWVudCA9IGF3YWl0IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50UmVhbHRpbWVDb25maWd1cmF0aW9ufSAqLyAocmVhbHRpbWUpLmNyZWF0ZUNsaWVudCgpXG4gICAgICAgIG93bnNDbGllbnQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChnZW5lcmF0aW9uICE9PSB0aGlzLl9nZW5lcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRlYXJkb3duKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcblxuICAgICAgaWYgKGdlbmVyYXRpb24gIT09IHRoaXMuX2dlbmVyYXRpb24pIHtcbiAgICAgICAgYXdhaXQgdGVhcmRvd24oKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgYXV0aGVudGljYXRpb25Ub2tlbiA9IGF3YWl0IHRoaXMuc3luY0NsaWVudC5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpXG5cbiAgICAgIGlmIChnZW5lcmF0aW9uICE9PSB0aGlzLl9nZW5lcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRlYXJkb3duKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2hhbm5lbERlc2NyaXB0b3Igb2YgY2hhbm5lbERlc2NyaXB0b3JzKSB7XG4gICAgICAgIGlmIChjaGFubmVsRGVzY3JpcHRvci5wYXJhbXMgJiYgXCJhdXRoZW50aWNhdGlvblRva2VuXCIgaW4gY2hhbm5lbERlc2NyaXB0b3IucGFyYW1zKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWFsdGltZSBjaGFubmVsIFwiJHtjaGFubmVsRGVzY3JpcHRvci5jaGFubmVsfVwiIHBhcmFtcyBtdXN0IG5vdCBpbmNsdWRlIGF1dGhlbnRpY2F0aW9uVG9rZW4gLSB0aGUgZnJhbWV3b3JrIGluamVjdHMgdGhlIHN5bmMuY2xpZW50IGF1dGhlbnRpY2F0aW9uVG9rZW4gYXV0b21hdGljYWxseWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBjaGFubmVsRGVzY3JpcHRvci5yZXNvdXJjZVR5cGUgPz8gbnVsbFxuICAgICAgICBjb25zdCBwYXJhbXMgPSBtZXJnZVJlbW90ZVJlcXVlc3RDb250ZXh0KHtcbiAgICAgICAgICBjb250ZXh0OiB0aGlzLnN5bmNDbGllbnQuY29uZmlnLnJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIGxhYmVsOiBcIlN5bmMgY2xpZW50IHJlcXVlc3QgY29udGV4dFwiLFxuICAgICAgICAgIHBhcmFtczogey4uLmNoYW5uZWxEZXNjcmlwdG9yLnBhcmFtcywgYXV0aGVudGljYXRpb25Ub2tlbn1cbiAgICAgICAgfSlcbiAgICAgICAgY29uc3Qgc3Vic2NyaXB0aW9uID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoY2hhbm5lbERlc2NyaXB0b3IuY2hhbm5lbCwge1xuICAgICAgICAgIG9uTWVzc2FnZTogKGJvZHkpID0+IHRoaXMuZW5xdWV1ZUFwcGx5KHtib2R5LCByZXNvdXJjZVR5cGV9KSxcbiAgICAgICAgICBvblJlc3VtZTogKCkgPT4gdGhpcy5zY2hlZHVsZVB1bGwoKSxcbiAgICAgICAgICBwYXJhbXNcbiAgICAgICAgfSlcblxuICAgICAgICBjaGFubmVscy5wdXNoKHtjaGFubmVsOiBjaGFubmVsRGVzY3JpcHRvci5jaGFubmVsLCByZXNvdXJjZVR5cGUsIHN1YnNjcmlwdGlvbn0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKGNoYW5uZWxzLm1hcCgoe3N1YnNjcmlwdGlvbn0pID0+IHN1YnNjcmlwdGlvbi53YWl0Rm9yUmVhZHkoKSkpXG5cbiAgICAgIGlmIChnZW5lcmF0aW9uICE9PSB0aGlzLl9nZW5lcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRlYXJkb3duKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX2NoYW5uZWxzID0gY2hhbm5lbHNcbiAgICAgIHRoaXMuX2NsaWVudCA9IGNsaWVudFxuICAgICAgdGhpcy5fb3duc0NsaWVudCA9IG93bnNDbGllbnRcbiAgICAgIHRoaXMuX3N0YXRlID0gXCJzdWJzY3JpYmVkXCJcbiAgICAgIHRoaXMuc2NoZWR1bGVQdWxsKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgdGVhcmRvd24oKVxuXG4gICAgICBpZiAoZ2VuZXJhdGlvbiA9PT0gdGhpcy5fZ2VuZXJhdGlvbikgdGhpcy5fc3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBldmVyeSBjaGFubmVsIHN1YnNjcmlwdGlvbiAoaWRlbXBvdGVudCkuIFRoZSB3ZWJzb2NrZXQgaXNcbiAgICogZGlzY29ubmVjdGVkIG9ubHkgd2hlbiB0aGUgYnJpZGdlIG93bnMgaXQgKGRlcHJlY2F0ZWQgcGVyLWN5Y2xlXG4gICAqIGByZWFsdGltZS5jcmVhdGVDbGllbnRgIHBhdGgpOyBhIHNoYXJlZCBhcHAtbGlmZXRpbWUgY29ubmVjdGlvbiBzdGF5cyBvcGVuXG4gICAqIHNvIHVuc3Vic2NyaWJpbmcgZHJvcHMgc3Vic2NyaXB0aW9ucyB3aXRob3V0IHRlYXJpbmcgZG93biB0aGUgc29ja2V0LiBBbHNvXG4gICAqIG1hcmtzIGFueSBpbi1mbGlnaHQgc3Vic2NyaWJlIGF0dGVtcHQgc3RhbGUgc28gaXQgdGVhcnMgaXRzZWxmIGRvd24gaW5zdGVhZFxuICAgKiBvZiBmaW5pc2hpbmcgdGhlIHN1YnNjcmlwdGlvbiBhZnRlcndhcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVuc3Vic2NyaWJlKCkge1xuICAgIHRoaXMuX2dlbmVyYXRpb24gKz0gMVxuXG4gICAgY29uc3QgY2hhbm5lbHMgPSB0aGlzLl9jaGFubmVsc1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuX2NsaWVudFxuICAgIGNvbnN0IG93bnNDbGllbnQgPSB0aGlzLl9vd25zQ2xpZW50XG5cbiAgICB0aGlzLl9jaGFubmVscyA9IFtdXG4gICAgdGhpcy5fY2xpZW50ID0gbnVsbFxuICAgIHRoaXMuX293bnNDbGllbnQgPSBmYWxzZVxuICAgIHRoaXMuX3N0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuXG4gICAgZm9yIChjb25zdCB7c3Vic2NyaXB0aW9ufSBvZiBjaGFubmVscykge1xuICAgICAgc3Vic2NyaXB0aW9uLmNsb3NlKClcbiAgICB9XG5cbiAgICBpZiAoY2xpZW50ICYmIG93bnNDbGllbnQpIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB0aGUgYnJpZGdlIHN1YnNjcmlwdGlvbiBzdGF0ZSBhbmQgcGVyLWNoYW5uZWwgcmVhZGluZXNzLlxuICAgKiBAcmV0dXJucyB7e2NoYW5uZWxzOiBBcnJheTx7Y2hhbm5lbDogc3RyaW5nLCByZWFkeTogYm9vbGVhbiwgcmVzb3VyY2VUeXBlOiBzdHJpbmcgfCBudWxsfT4sIHN0YXRlOiBcInN1YnNjcmliZWRcIiB8IFwic3Vic2NyaWJpbmdcIiB8IFwidW5zdWJzY3JpYmVkXCJ9fSBSZWFsdGltZSBzdGF0dXMuXG4gICAqL1xuICBzdGF0dXMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNoYW5uZWxzOiB0aGlzLl9jaGFubmVscy5tYXAoKHtjaGFubmVsLCByZXNvdXJjZVR5cGUsIHN1YnNjcmlwdGlvbn0pID0+ICh7Y2hhbm5lbCwgcmVhZHk6IHN1YnNjcmlwdGlvbi5pc1JlYWR5KCksIHJlc291cmNlVHlwZX0pKSxcbiAgICAgIHN0YXRlOiB0aGlzLl9zdGF0ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIGVucXVldWVkIG1lc3NhZ2UgYXBwbGllcyBhbmQgYW55IHNjaGVkdWxlZCBwdWxsICh0ZXN0cywgc2h1dGRvd24gZmxvd3MpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JBcHBsaWVkKCkge1xuICAgIGF3YWl0IHRoaXMuX2FwcGx5UHJvbWlzZVxuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRQdWxsKSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRQdWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJlYWx0aW1lIGNvbmZpZ3VyYXRpb24gYmxvY2ssIG9yIG51bGwgd2hlbiB0aGUgYXBwIGRlY2xhcmVkXG4gICAqIG5vbmUgKHZhbGlkIHdoZW4gYSBzaGFyZWQgY29ubmVjdGlvbiBpcyBjb25maWd1cmVkKS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudFJlYWx0aW1lQ29uZmlndXJhdGlvbiB8IG51bGx9IFJlYWx0aW1lIGNvbmZpZ3VyYXRpb24sIG9yIG51bGwuXG4gICAqL1xuICByZWFsdGltZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuc3luY0NsaWVudC5jb25maWcucmVhbHRpbWUgfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSByZWFsdGltZSBjb25maWd1cmF0aW9uIGFuZCBhc3NlcnRzIGEgd2Vic29ja2V0IGNsaWVudCBzb3VyY2VcbiAgICogZXhpc3RzOiBhIHNoYXJlZCBjb25uZWN0aW9uIHJpZGVzIGl0cyBvd24gbGlmZWN5Y2xlLCBvdGhlcndpc2UgdGhlXG4gICAqIGRlcHJlY2F0ZWQgcGVyLWN5Y2xlIGByZWFsdGltZS5jcmVhdGVDbGllbnRgIG11c3QgYmUgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNSZWFsdGltZVdlYnNvY2tldENsaWVudCB8IG51bGx9IHNoYXJlZENsaWVudCAtIFNoYXJlZCBjb25uZWN0aW9uLCBvciBudWxsLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50UmVhbHRpbWVDb25maWd1cmF0aW9uIHwgbnVsbH0gUmVhbHRpbWUgY29uZmlndXJhdGlvbiwgb3IgbnVsbC5cbiAgICovXG4gIHJlcXVpcmVDbGllbnRTb3VyY2Uoc2hhcmVkQ2xpZW50KSB7XG4gICAgY29uc3QgcmVhbHRpbWUgPSB0aGlzLnJlYWx0aW1lQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIXNoYXJlZENsaWVudCAmJiB0eXBlb2YgcmVhbHRpbWU/LmNyZWF0ZUNsaWVudCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdWJzY3JpYmVSZWFsdGltZSByZXF1aXJlcyBhIHNoYXJlZCBjb25uZWN0aW9uIChzeW5jLmNsaWVudC53ZWJzb2NrZXRVcmwgb3Igc3luYy5jbGllbnQud2Vic29ja2V0Q2xpZW50KSBvciB0aGUgZGVwcmVjYXRlZCBzeW5jLmNsaWVudC5yZWFsdGltZS5jcmVhdGVDbGllbnQgY2FsbGJhY2tcIilcbiAgICB9XG5cbiAgICByZXR1cm4gcmVhbHRpbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXJpdmVzIHRoZSBjaGFubmVsIGRlc2NyaXB0b3JzIHRvIHN1YnNjcmliZTogb25lIGZyYW1ld29yayBzeW5jIGNoYW5uZWxcbiAgICogc3Vic2NyaXB0aW9uIHBlciBkZWNsYXJlZCBwdWxsIHNjb3BlICh0aGUgcGFyYW1zIG1pcnJvciB0aGUgc2NvcGUnc1xuICAgKiBge3Jlc291cmNlVHlwZSwgY29uZGl0aW9uc31gKSwgcGx1cyB0aGUgZGVwcmVjYXRlZCBsZWdhY3kgcGF0aHMg4oCUXG4gICAqIG1vZGVsLWxldmVsIHN0YXRpYyByZWFsdGltZSBkZWNsYXJhdGlvbnMgYW5kIHRoZSBjb25maWcgY2hhbm5lbHMgY2FsbGJhY2suXG4gICAqIEZhaWxzIGxvdWRseSB3aGVuIG5vdGhpbmcgaXMgc3Vic2NyaWJhYmxlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb250ZXh0IC0gQXBwIGNvbnRleHQgcGFzc2VkIHRvIHRoZSBkZXByZWNhdGVkIGNoYW5uZWxzIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxWZWxvY2lvdXNTeW5jUmVhbHRpbWVDaGFubmVsRGVzY3JpcHRvcj4+fSBDaGFubmVsIGRlc2NyaXB0b3JzLlxuICAgKi9cbiAgYXN5bmMgY2hhbm5lbERlc2NyaXB0b3JzKGNvbnRleHQpIHtcbiAgICBjb25zdCByZWFsdGltZSA9IHRoaXMucmVhbHRpbWVDb25maWd1cmF0aW9uKClcbiAgICAvKiogQHR5cGUge0FycmF5PFZlbG9jaW91c1N5bmNSZWFsdGltZUNoYW5uZWxEZXNjcmlwdG9yPn0gKi9cbiAgICBjb25zdCBjaGFubmVsRGVzY3JpcHRvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzY29wZVJvdyBvZiBhd2FpdCB0aGlzLnN5bmNDbGllbnQuc2NvcGVTdG9yZSgpLmFjdGl2ZVNjb3BlcygpKSB7XG4gICAgICBjaGFubmVsRGVzY3JpcHRvcnMucHVzaCh7XG4gICAgICAgIGNoYW5uZWw6IFZFTE9DSU9VU19TWU5DX0NIQU5ORUwsXG4gICAgICAgIHBhcmFtczoge1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuYXR0cmlidXRlTmFtZWRDb25kaXRpb25zKHNjb3BlUm93KSxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6IHNjb3BlUm93LnJlc291cmNlVHlwZSxcbiAgICAgICAgICAvLyBPbmx5IHRoZSBhbGwtdHlwZXMgc2NvcGUgY2FycmllcyB0aGUgdHlwZSBsaXN0OyBhIHR5cGUtZGVjbGFyZWQgc2NvcGUgbmVlZHMgbm9uZS5cbiAgICAgICAgICAuLi4oc2NvcGVSb3cucmVzb3VyY2VUeXBlID09PSBudWxsID8ge3Jlc291cmNlVHlwZXM6IHRoaXMuc3luY0NsaWVudC51c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCl9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5zeW5jQ2xpZW50LmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBpZiAoIXJlc291cmNlQ29uZmlnLnJlYWx0aW1lKSBjb250aW51ZVxuXG4gICAgICBjaGFubmVsRGVzY3JpcHRvcnMucHVzaCh7Y2hhbm5lbDogcmVzb3VyY2VDb25maWcucmVhbHRpbWUuY2hhbm5lbCwgcGFyYW1zOiByZXNvdXJjZUNvbmZpZy5yZWFsdGltZS5wYXJhbXMsIHJlc291cmNlVHlwZX0pXG4gICAgfVxuXG4gICAgaWYgKHJlYWx0aW1lPy5jaGFubmVscykge1xuICAgICAgY2hhbm5lbERlc2NyaXB0b3JzLnB1c2goLi4uYXdhaXQgcmVhbHRpbWUuY2hhbm5lbHMoY29udGV4dCkpXG4gICAgfVxuXG4gICAgaWYgKGNoYW5uZWxEZXNjcmlwdG9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN1YnNjcmliZVJlYWx0aW1lIGZvdW5kIG5vIGNoYW5uZWxzIHRvIHN1YnNjcmliZSAtIGRlY2xhcmUgYSBzeW5jIHNjb3BlIChzeW5jQ2xpZW50KCkuc3luYyhxdWVyeSkpIHNvIGl0cyBmcmFtZXdvcmsgc3luYyBjaGFubmVsIHN1YnNjcmlwdGlvbiBjYW4gYmUgZGVyaXZlZCwgb3IgdGhlIGRlcHJlY2F0ZWQgc3luYy5jbGllbnQucmVhbHRpbWUuY2hhbm5lbHMgY2FsbGJhY2tcIilcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbm5lbERlc2NyaXB0b3JzXG4gIH1cblxuICAvKipcbiAgICogVHJhbnNsYXRlcyBhIHBlcnNpc3RlZCBzY29wZSdzIGNvbmRpdGlvbiBrZXlzIHRvIHRoZSBtb2RlbCdzIGF0dHJpYnV0ZVxuICAgKiBuYW1lcyBzbyB0aGUgZnJhbWV3b3JrIGNoYW5uZWwgc3Vic2NyaXB0aW9uIG1hdGNoZXMgdGhlIHB1Ymxpc2hlcidzXG4gICAqIGF0dHJpYnV0ZS1uYW1lZCBzY29waW5nIHBhcmFtczogYHNlcmlhbGl6ZWRTY29wZUZyb21RdWVyeWAgcGVyc2lzdHMgdGhlXG4gICAqIHF1ZXJ5J3MgbW9kZWwtbm9ybWFsaXplZCBjb2x1bW4gbmFtZXMgKGZvciBleGFtcGxlIGBwcm9qZWN0X2lkYCksIHdoaWxlXG4gICAqIHNjb3BlLXBhcnRpdGlvbiBicm9hZGNhc3RzIGNhcnJ5IGF0dHJpYnV0ZSBuYW1lcyAoYHByb2plY3RJZGApLiBLZXlzXG4gICAqIHdpdGhvdXQgYSBjb2x1bW4gbWFwcGluZyBhcmUgYWxyZWFkeSBhdHRyaWJ1dGUgbmFtZXMgYW5kIHBhc3MgdGhyb3VnaDtcbiAgICogc2NvcGVzIG9uIG1vZGVscyB3aXRob3V0IGEgZGVjbGFyZWQgc3luYyByZXNvdXJjZSBmYWlsIGxvdWRseSBiZWNhdXNlIG5vXG4gICAqIGF0dHJpYnV0ZSBtYXBwaW5nIGV4aXN0cyBmb3IgdGhlbS5cbiAgICpcbiAgICogVGhlIGFsbC10eXBlcyAodXNlcikgc2NvcGUgaGFzIG5vIHJlc291cmNlIHR5cGUgYW5kIG5vIGNvbmRpdGlvbnMgLSBpdFxuICAgKiBjb3ZlcnMgZXZlcnl0aGluZyB0aGUgc2VydmVyIGF1dGhvcml6ZXMgZm9yIHRoZSBjYWxsZXIgLSBzbyB0aGVyZSBpc1xuICAgKiBub3RoaW5nIHRvIG1hcC5cbiAgICogQHBhcmFtIHt7Y29uZGl0aW9uczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXNvdXJjZVR5cGU6IHN0cmluZyB8IG51bGx9fSBzY29wZVJvdyAtIEFjdGl2ZSBzY29wZSByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEF0dHJpYnV0ZS1uYW1lZCBzY29wZSBjb25kaXRpb25zLlxuICAgKi9cbiAgYXR0cmlidXRlTmFtZWRDb25kaXRpb25zKHNjb3BlUm93KSB7XG4gICAgaWYgKHNjb3BlUm93LnJlc291cmNlVHlwZSA9PT0gbnVsbCkgcmV0dXJuIHt9XG5cbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMuc3luY0NsaWVudC5jb25maWcucmVzb3VyY2VzW3Njb3BlUm93LnJlc291cmNlVHlwZV1cblxuICAgIGlmICghcmVzb3VyY2VDb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3Vic2NyaWJlUmVhbHRpbWUgY2FuJ3QgZGVyaXZlIGF0dHJpYnV0ZSBuYW1lcyBmb3IgdGhlIHN5bmMgc2NvcGUgZGVjbGFyZWQgb24gJHtzY29wZVJvdy5yZXNvdXJjZVR5cGV9IC0gZGVjbGFyZSBzdGF0aWMgc3luYyBvbiB0aGF0IG1vZGVsIHNvIGl0cyByZXNvdXJjZSBpcyByZWdpc3RlcmVkYClcbiAgICB9XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gcmVzb3VyY2VDb25maWcubWV0YWRhdGFNb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbY29uZGl0aW9uTmFtZSwgY29uZGl0aW9uVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlUm93LmNvbmRpdGlvbnMpKSB7XG4gICAgICBjb25kaXRpb25zW2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbY29uZGl0aW9uTmFtZV0gfHwgY29uZGl0aW9uTmFtZV0gPSBjb25kaXRpb25WYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBjb25kaXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQ2hhaW5zIG9uZSBwdXNoZWQgbWVzc2FnZSBvbnRvIHRoZSBzZXJpYWxpemVkIGFwcGx5IHF1ZXVlIHNvIGNoYW5nZXMgYXBwbHlcbiAgICogaW4gYXJyaXZhbCBvcmRlcjsgZmFpbHVyZXMgZ28gdG8gdGhlIHN5bmMgY2xpZW50J3MgZXJyb3IgcmVwb3J0aW5nLlxuICAgKiBAcGFyYW0ge3tib2R5OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VUeXBlOiBzdHJpbmcgfCBudWxsfX0gYXJncyAtIE1lc3NhZ2UgYXJncy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnF1ZXVlQXBwbHkoe2JvZHksIHJlc291cmNlVHlwZX0pIHtcbiAgICB0aGlzLl9hcHBseVByb21pc2UgPSB0aGlzLl9hcHBseVByb21pc2UudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcGx5TWVzc2FnZSh7Ym9keSwgcmVzb3VyY2VUeXBlfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuc3luY0NsaWVudC5yZXBvcnRFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgcHVzaGVkIG1lc3NhZ2UgdGhyb3VnaCB0aGUgZGVyaXZlZCByZXNvdXJjZSBhcHBsaWVyOiBkcm9wc1xuICAgKiBvd24tZGV2aWNlIG1lc3NhZ2VzIGJ5IGVjaG8gb3JpZ2luLCBkZWZhdWx0cyB0aGUgY2hhbm5lbCdzIHJlc291cmNlVHlwZSBvbnRvXG4gICAqIGVudmVsb3BlcyB3aXRob3V0IG9uZSwgYW5kIGZhaWxzIGxvdWRseSBvbiB1bmtub3duIHJlc291cmNlIHR5cGVzLlxuICAgKiBAcGFyYW0ge3tib2R5OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VUeXBlOiBzdHJpbmcgfCBudWxsfX0gYXJncyAtIE1lc3NhZ2UgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhcHBseU1lc3NhZ2Uoe2JvZHksIHJlc291cmNlVHlwZX0pIHtcbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShib2R5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWFsdGltZSBzeW5jIG1lc3NhZ2VzIG11c3QgYmUgZW52ZWxvcGUgb2JqZWN0cywgZ290OiAke0pTT04uc3RyaW5naWZ5KGJvZHkpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVhbHRpbWUgPSB0aGlzLnJlYWx0aW1lQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAocmVhbHRpbWU/LmxvY2FsT3JpZ2luICYmIGJvZHkuZWNob09yaWdpbiAhPT0gdW5kZWZpbmVkICYmIGJvZHkuZWNob09yaWdpbiAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgbG9jYWxPcmlnaW4gPSBTdHJpbmcoYXdhaXQgcmVhbHRpbWUubG9jYWxPcmlnaW4oKSlcblxuICAgICAgaWYgKFN0cmluZyhib2R5LmVjaG9PcmlnaW4pID09PSBsb2NhbE9yaWdpbikgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgc3luY1BheWxvYWRzID0gQXJyYXkuaXNBcnJheShib2R5LnN5bmNzKSA/IGJvZHkuc3luY3MgOiBbYm9keV1cbiAgICBjb25zdCBhcHBseVN5bmMgPSB0aGlzLnN5bmNDbGllbnQucmVtb3RlQXBwbHlTeW5jKHtzb3VyY2U6IFwicmVtb3RlIGNoYW5nZVwifSlcblxuICAgIC8vIENvYWxlc2NlIHJlY29yZC1jaGFuZ2UgZXZlbnRzIGFjcm9zcyB0aGUgcHVzaGVkIGJhdGNoIHNvIGl0IHRyaWdnZXJzIG9uZSBsaXZlLXF1ZXJ5IHJlLXJ1bi5cbiAgICBhd2FpdCByZWNvcmRDaGFuZ2VzLmJhdGNoKGFzeW5jICgpID0+IHtcbiAgICAgIGZvciAoY29uc3Qgc3luY1BheWxvYWQgb2Ygc3luY1BheWxvYWRzKSB7XG4gICAgICAgIGNvbnN0IHN5bmMgPSBTeW5jQXBpQ2xpZW50LnN5bmNFbnZlbG9wZUZyb21QYXlsb2FkKHtyZXNvdXJjZVR5cGUsIC4uLnN5bmNQYXlsb2FkfSlcblxuICAgICAgICBhd2FpdCBhcHBseVN5bmMoc3luYylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNjaGVkdWxlcyBhIGNvYWxlc2NlZCBiYWNrZ3JvdW5kIHB1bGwgY2xvc2luZyBvZmZsaW5lIGdhcHMgYWZ0ZXJcbiAgICogKHJlKXN1YnNjcmlwdGlvbiByZWFkaW5lc3MuIFJlc3VtZXMgYXJyaXZpbmcgd2hpbGUgYSBwdWxsIGlzIGFscmVhZHlcbiAgICogc2NoZWR1bGVkIG9yIGluIGZsaWdodCBjb2FsZXNjZSBpbnRvIHRoYXQgcHVsbCBpbnN0ZWFkIG9mIHN0YWNraW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlUHVsbCgpIHtcbiAgICBpZiAodGhpcy5yZWFsdGltZUNvbmZpZ3VyYXRpb24oKT8ucHVsbE9uUmVjb25uZWN0ID09PSBmYWxzZSkgcmV0dXJuXG5cbiAgICB0aGlzLl9zY2hlZHVsZWRQdWxsIHx8PSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zeW5jQ2xpZW50LnB1bGwoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5zeW5jQ2xpZW50LnJlcG9ydEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9zY2hlZHVsZWRQdWxsID0gbnVsbFxuICAgICAgfVxuICAgIH0pKClcbiAgfVxufVxuIl19