import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
/**
 * Framework-owned websocket channel for synced resources
 * ({@link VELOCIOUS_SYNC_CHANNEL}).
 *
 * Subscribe params mirror a declared pull scope — `{resourceType, conditions}`
 * plus the client-injected `authenticationToken` — and subscribe-time
 * authorization delegates to the app sync resource's existing
 * `authorizeChanges({params, scope})` (the `sync.api.resourceClass`), so apps
 * hook in through the authorization they already declared instead of writing
 * their own channel classes. Broadcast routing matches the publisher's
 * scoping params against the subscription's scope conditions.
 */
export default class SyncWebsocketChannel extends VelociousWebsocketChannel {
    /**
     * Scope the subscription was authorized for, set by {@link SyncWebsocketChannel#canSubscribe}.
     * @type {import("./sync-resource-base.js").SerializedChangesScope | null}
     */
    _scope: import("./sync-resource-base.js").SerializedChangesScope | null;
    /**
     * Registers the framework sync channel on a configuration declaring a
     * `sync.api` block (guarded so repeated server boots with the same
     * configuration register it only once). No-op without `sync.api` — the
     * channel authorizes through the app's sync resource class.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {void}
     */
    static registerFromConfiguration(configuration: import("../configuration.js").default): void;
    /**
     * Authorizes the subscription through the app sync resource: the subscribe
     * params are parsed into the same serialized scope the changes endpoint
     * consumes and passed to the resource's `authorizeChanges({params, scope})`.
     * Denials and malformed scopes throw, rejecting the subscription.
     * @returns {Promise<boolean>} Whether the subscription is allowed.
     */
    canSubscribe(): Promise<boolean>;
    /**
     * Builds the app sync resource authorizing this subscription, mirroring the
     * sync transport controller's resource construction with the ability
     * resolved from the subscribe params (which carry the client-injected
     * authenticationToken).
     * @returns {Promise<import("./sync-resource-base.js").default>} App sync resource instance.
     */
    buildSyncResource(): Promise<import("./sync-resource-base.js").default>;
    /**
     * Routes a publisher broadcast to this subscription when the published
     * resource type equals the type the subscription was authorized for and the
     * scoping params satisfy every scope condition: each condition key must be
     * present in the broadcast params and match by string comparison (array
     * conditions match by membership). Broadcasts without a resource type and
     * conditions the publisher's scoping params do not carry never match, so a
     * subscription cannot receive changes outside its authorized scope.
     *
     * The all-types (user) scope declares no single resource type - it subscribes
     * once for every type it can apply, listed in `scope.resourceTypes` - so it
     * matches a broadcast of any of those types. Types outside that list are
     * dropped here, by this cheap check, and never reach the per-delivery access
     * re-check in {@link SyncWebsocketChannel#_userScopeDeliverableBody}: that
     * re-check checks out a database connection and runs a query per matched
     * broadcast, so matching every type would put DB work on every broadcast for
     * every subscribed device. A broadcast carrying no resource type at all still
     * never matches.
     * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} broadcastParams - Publisher scoping params (the published resourceType plus the change's scope-partition values).
     * @returns {boolean} Whether the broadcast belongs to this subscription's scope.
     */
    matches(broadcastParams: import("../http-server/websocket-channel.js").WebsocketJsonValue): boolean;
    /**
     * Delivers a matched broadcast. Scoped subscriptions (with explicit
     * conditions) already routed through {@link SyncWebsocketChannel#matches}, so
     * the change is in scope and delivers unchanged. User-scope subscriptions
     * (empty conditions, "everything my ability can see") match every broadcast
     * of the resource type, so each published change is re-checked against the
     * subscriber's ability at fan-out through the app sync resource's
     * `changeDeliverable`; only accessible changes are delivered, and a broadcast
     * with no accessible change is dropped.
     * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body (sync envelope).
     * @param {{eventId?: string}} [meta] - Optional event metadata.
     * @returns {Promise<void>}
     */
    deliverBroadcast(body: import("../http-server/websocket-channel.js").WebsocketJsonValue, meta?: {
        eventId?: string;
    }): Promise<void>;
    /**
     * Whether this subscription is a user scope: authorized with empty conditions
     * ("everything my ability can see").
     * @returns {boolean} Whether the subscription is a user scope.
     */
    _isUserScope(): boolean;
    /**
     * Filters a user-scope broadcast to the sync entries the subscriber's ability
     * can access, re-checking each through the app sync resource's
     * `changeDeliverable`. Returns the broadcast narrowed to accessible entries,
     * or null when none are accessible. Non-envelope bodies and entries without a
     * resource id are dropped (fail closed).
     * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body.
     * @returns {Promise<import("../http-server/websocket-channel.js").WebsocketJsonValue | null>} Deliverable body, or null.
     */
    _userScopeDeliverableBody(body: import("../http-server/websocket-channel.js").WebsocketJsonValue): Promise<import("../http-server/websocket-channel.js").WebsocketJsonValue | null>;
    /**
     * Returns the authorized scope for debug snapshots.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
     */
    debugSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=sync-websocket-channel.d.ts.map