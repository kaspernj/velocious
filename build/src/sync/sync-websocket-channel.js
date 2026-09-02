// @ts-check
import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
import { VELOCIOUS_SYNC_CHANNEL } from "./sync-channel-name.js";
/** Configurations whose framework sync channel has already been registered. */
const registeredConfigurations = new WeakSet();
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
    _scope = null;
    /**
     * Registers the framework sync channel on a configuration declaring a
     * `sync.api` block (guarded so repeated server boots with the same
     * configuration register it only once). No-op without `sync.api` — the
     * channel authorizes through the app's sync resource class.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {void}
     */
    static registerFromConfiguration(configuration) {
        if (!configuration.getSyncConfiguration().api || registeredConfigurations.has(configuration))
            return;
        registeredConfigurations.add(configuration);
        configuration.registerWebsocketChannel(VELOCIOUS_SYNC_CHANNEL, this);
    }
    /**
     * Authorizes the subscription through the app sync resource: the subscribe
     * params are parsed into the same serialized scope the changes endpoint
     * consumes and passed to the resource's `authorizeChanges({params, scope})`.
     * Denials and malformed scopes throw, rejecting the subscription.
     * @returns {Promise<boolean>} Whether the subscription is allowed.
     */
    async canSubscribe() {
        const resource = await this.buildSyncResource();
        const scope = resource.changesScope({ scope: { conditions: this.params.conditions, resourceType: this.params.resourceType, resourceTypes: this.params.resourceTypes } });
        await resource.authorizeChanges({ params: this.params, scope });
        this._scope = scope;
        return true;
    }
    /**
     * Builds the app sync resource authorizing this subscription, mirroring the
     * sync transport controller's resource construction with the ability
     * resolved from the subscribe params (which carry the client-injected
     * authenticationToken).
     * @returns {Promise<import("./sync-resource-base.js").default>} App sync resource instance.
     */
    async buildSyncResource() {
        const configuration = this.session.configuration;
        const api = configuration.getSyncConfiguration().api;
        if (!api) {
            throw new Error(`The ${VELOCIOUS_SYNC_CHANNEL} channel requires a sync.api configuration block with the app's sync resource class`);
        }
        // Narrows the configured resource class to the sync resource contract
        // (changesScope/authorizeChanges) the sync.api validation requires.
        const ResourceClass = /** @type {typeof import("./sync-resource-base.js").default} */ (api.resourceClass);
        // Narrows the websocket subscribe params to the resource params contract.
        const params = /** @type {import("../configuration-types.js").VelociousParams} */ ( /** @type {unknown} */(this.params));
        const request = this.session.upgradeRequest;
        const ability = await configuration.resolveAbility({ params, request });
        return new ResourceClass({
            ability,
            configuration,
            context: {
                ...(ability?.getContext() || {}),
                params,
                request
            },
            locals: ability?.getLocals() || {},
            modelClass: ResourceClass.ModelClass,
            modelName: ResourceClass.ModelClass?.name,
            params,
            resourceConfiguration: /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({
                attributes: ResourceClass.attributes || {},
                sync: { enabled: true }
            })
        });
    }
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
    matches(broadcastParams) {
        const scope = this._scope;
        if (!scope)
            return false;
        const scopingParams = broadcastParams && typeof broadcastParams === "object" && !Array.isArray(broadcastParams)
            ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (broadcastParams)
            : {};
        if (!Object.hasOwn(scopingParams, "resourceType"))
            return false;
        if (scope.resourceType === null) {
            if (scope.resourceTypes && !scope.resourceTypes.some((resourceType) => resourceType === String(scopingParams.resourceType)))
                return false;
        }
        else if (String(scopingParams.resourceType) !== String(scope.resourceType)) {
            return false;
        }
        for (const [conditionName, conditionValue] of Object.entries(scope.conditions)) {
            if (!Object.hasOwn(scopingParams, conditionName))
                return false;
            const scopingValue = scopingParams[conditionName];
            if (Array.isArray(conditionValue)) {
                if (!conditionValue.some((value) => String(value) === String(scopingValue)))
                    return false;
            }
            else if (String(conditionValue) !== String(scopingValue)) {
                return false;
            }
        }
        return true;
    }
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
    async deliverBroadcast(body, meta) {
        if (!this._isUserScope()) {
            this.sendMessage(body, meta);
            return;
        }
        const deliverableBody = await this._userScopeDeliverableBody(body);
        if (deliverableBody !== null)
            this.sendMessage(deliverableBody, meta);
    }
    /**
     * Whether this subscription is a user scope: authorized with empty conditions
     * ("everything my ability can see").
     * @returns {boolean} Whether the subscription is a user scope.
     */
    _isUserScope() {
        return Boolean(this._scope) && Object.keys(/** @type {import("./sync-resource-base.js").SerializedChangesScope} */ (this._scope).conditions).length === 0;
    }
    /**
     * Filters a user-scope broadcast to the sync entries the subscriber's ability
     * can access, re-checking each through the app sync resource's
     * `changeDeliverable`. Returns the broadcast narrowed to accessible entries,
     * or null when none are accessible. Non-envelope bodies and entries without a
     * resource id are dropped (fail closed).
     * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body.
     * @returns {Promise<import("../http-server/websocket-channel.js").WebsocketJsonValue | null>} Deliverable body, or null.
     */
    async _userScopeDeliverableBody(body) {
        if (!body || typeof body !== "object" || Array.isArray(body))
            return null;
        const envelope = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (body);
        const scope = /** @type {import("./sync-resource-base.js").SerializedChangesScope} */ (this._scope);
        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const syncs = Array.isArray(envelope.syncs) ? envelope.syncs : [envelope];
        const configuration = this.session.configuration;
        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const deliverableSyncs = [];
        // Broadcast fan-out runs through `withoutCurrentConnectionContexts` (see
        // Configuration#_broadcastToChannelLocal), so there is no ambient database
        // connection here. Resolve the resource's ability and run the per-delivery
        // access query inside a checked-out connection context, mirroring how other
        // broadcast-time DB work (the frontend-model channel) obtains connections.
        await configuration.ensureConnections({ name: `${VELOCIOUS_SYNC_CHANNEL} user-scope delivery access check` }, async () => {
            const resource = await this.buildSyncResource();
            for (const sync of syncs) {
                const resourceId = sync?.resourceId;
                const resourceType = sync?.resourceType ?? scope.resourceType;
                if (resourceId === undefined || resourceId === null)
                    continue;
                // Pass the complete broadcast entry through so the app's
                // changeDeliverable can authorize by exact-row identity (immutable
                // sync-row id, actor-specific metadata) — concurrent targeted and
                // shared broadcasts for the same resource identity authorize
                // independently. Only resourceId/resourceType are normalized to
                // strings, on a copy so the published entry is never mutated.
                const syncEntry = {
                    ...sync,
                    resourceId: String(resourceId),
                    resourceType: String(resourceType)
                };
                if (await resource.changeDeliverable({ params: this.params, scope, sync: syncEntry })) {
                    deliverableSyncs.push(sync);
                }
            }
        });
        if (deliverableSyncs.length === 0)
            return null;
        if (Array.isArray(envelope.syncs))
            return { ...envelope, syncs: deliverableSyncs };
        return deliverableSyncs[0];
    }
    /**
     * Returns the authorized scope for debug snapshots.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
     */
    debugSnapshot() {
        return { scope: this._scope, userScope: this._isUserScope() };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy13ZWJzb2NrZXQtY2hhbm5lbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtd2Vic29ja2V0LWNoYW5uZWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8seUJBQXlCLE1BQU0scUNBQXFDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFFN0QsK0VBQStFO0FBQy9FLE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUU5Qzs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0JBQXFCLFNBQVEseUJBQXlCO0lBQ3pFOzs7T0FHRztJQUNILE1BQU0sR0FBRyxJQUFJLENBQUE7SUFFYjs7Ozs7OztPQU9HO0lBQ0gsTUFBTSxDQUFDLHlCQUF5QixDQUFDLGFBQWE7UUFDNUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLEdBQUcsSUFBSSx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO1lBQUUsT0FBTTtRQUVwRyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDM0MsYUFBYSxDQUFDLHdCQUF3QixDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQyxDQUFBO0lBQ3RFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQy9DLE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFBQyxLQUFLLEVBQUUsRUFBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsWUFBWSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLGFBQWEsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBQyxFQUFDLENBQUMsQ0FBQTtRQUVwSyxNQUFNLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFN0QsSUFBSSxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUE7UUFFbkIsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQjtRQUNyQixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQTtRQUNoRCxNQUFNLEdBQUcsR0FBRyxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQyxHQUFHLENBQUE7UUFFcEQsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ1QsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLHNCQUFzQixxRkFBcUYsQ0FBQyxDQUFBO1FBQ3JJLENBQUM7UUFFRCxzRUFBc0U7UUFDdEUsb0VBQW9FO1FBQ3BFLE1BQU0sYUFBYSxHQUFHLCtEQUErRCxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQ3pHLDBFQUEwRTtRQUMxRSxNQUFNLE1BQU0sR0FBRyxrRUFBa0UsQ0FBQyxFQUFDLHNCQUF1QixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO1FBQ3hILE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFBO1FBQzNDLE1BQU0sT0FBTyxHQUFHLE1BQU0sYUFBYSxDQUFDLGNBQWMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBRXJFLE9BQU8sSUFBSSxhQUFhLENBQUM7WUFDdkIsT0FBTztZQUNQLGFBQWE7WUFDYixPQUFPLEVBQUU7Z0JBQ1AsR0FBRyxDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLENBQUM7Z0JBQ2hDLE1BQU07Z0JBQ04sT0FBTzthQUNSO1lBQ0QsTUFBTSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFO1lBQ2xDLFVBQVUsRUFBRSxhQUFhLENBQUMsVUFBVTtZQUNwQyxTQUFTLEVBQUUsYUFBYSxDQUFDLFVBQVUsRUFBRSxJQUFJO1lBQ3pDLE1BQU07WUFDTixxQkFBcUIsRUFBRSxxRkFBcUYsQ0FBQyxDQUFDO2dCQUM1RyxVQUFVLEVBQUUsYUFBYSxDQUFDLFVBQVUsSUFBSSxFQUFFO2dCQUMxQyxJQUFJLEVBQUUsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFDO2FBQ3RCLENBQUM7U0FDSCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Bb0JHO0lBQ0gsT0FBTyxDQUFDLGVBQWU7UUFDckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQTtRQUV6QixJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXhCLE1BQU0sYUFBYSxHQUFHLGVBQWUsSUFBSSxPQUFPLGVBQWUsS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQztZQUM3RyxDQUFDLENBQUMsNERBQTRELENBQUMsQ0FBQyxlQUFlLENBQUM7WUFDaEYsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVOLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxjQUFjLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUvRCxJQUFJLEtBQUssQ0FBQyxZQUFZLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDaEMsSUFBSSxLQUFLLENBQUMsYUFBYSxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDLFlBQVksS0FBSyxNQUFNLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUFFLE9BQU8sS0FBSyxDQUFBO1FBQzNJLENBQUM7YUFBTSxJQUFJLE1BQU0sQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLEtBQUssTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1lBQzdFLE9BQU8sS0FBSyxDQUFBO1FBQ2QsQ0FBQztRQUVELEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxjQUFjLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQy9FLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFFOUQsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1lBRWpELElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO2dCQUNsQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztvQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUMzRixDQUFDO2lCQUFNLElBQUksTUFBTSxDQUFDLGNBQWMsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO2dCQUMzRCxPQUFPLEtBQUssQ0FBQTtZQUNkLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxJQUFJO1FBQy9CLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUU1QixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLElBQUksQ0FBQyxDQUFBO1FBRWxFLElBQUksZUFBZSxLQUFLLElBQUk7WUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQVk7UUFDVixPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyx1RUFBdUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFBO0lBQzNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJO1FBQ2xDLElBQUksQ0FBQyxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFekUsTUFBTSxRQUFRLEdBQUcsNERBQTRELENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNwRixNQUFNLEtBQUssR0FBRyx1RUFBdUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNuRyxtRUFBbUU7UUFDbkUsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDekUsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUE7UUFDaEQsbUVBQW1FO1FBQ25FLE1BQU0sZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO1FBRTNCLHlFQUF5RTtRQUN6RSwyRUFBMkU7UUFDM0UsMkVBQTJFO1FBQzNFLDRFQUE0RTtRQUM1RSwyRUFBMkU7UUFDM0UsTUFBTSxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsR0FBRyxzQkFBc0IsbUNBQW1DLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNySCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBRS9DLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ3pCLE1BQU0sVUFBVSxHQUFHLElBQUksRUFBRSxVQUFVLENBQUE7Z0JBQ25DLE1BQU0sWUFBWSxHQUFHLElBQUksRUFBRSxZQUFZLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQTtnQkFFN0QsSUFBSSxVQUFVLEtBQUssU0FBUyxJQUFJLFVBQVUsS0FBSyxJQUFJO29CQUFFLFNBQVE7Z0JBRTdELHlEQUF5RDtnQkFDekQsbUVBQW1FO2dCQUNuRSxrRUFBa0U7Z0JBQ2xFLDZEQUE2RDtnQkFDN0QsZ0VBQWdFO2dCQUNoRSw4REFBOEQ7Z0JBQzlELE1BQU0sU0FBUyxHQUFHO29CQUNoQixHQUFHLElBQUk7b0JBQ1AsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUM7b0JBQzlCLFlBQVksRUFBRSxNQUFNLENBQUMsWUFBWSxDQUFDO2lCQUNuQyxDQUFBO2dCQUVELElBQUksTUFBTSxRQUFRLENBQUMsaUJBQWlCLENBQUMsRUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBQyxDQUFDLEVBQUUsQ0FBQztvQkFDcEYsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUM3QixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxnQkFBZ0IsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQzlDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxFQUFDLEdBQUcsUUFBUSxFQUFFLEtBQUssRUFBRSxnQkFBZ0IsRUFBQyxDQUFBO1FBRWhGLE9BQU8sZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILGFBQWE7UUFDWCxPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUUsRUFBQyxDQUFBO0lBQzdELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCBmcm9tIFwiLi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIlxuaW1wb3J0IHtWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSBmcm9tIFwiLi9zeW5jLWNoYW5uZWwtbmFtZS5qc1wiXG5cbi8qKiBDb25maWd1cmF0aW9ucyB3aG9zZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsIGhhcyBhbHJlYWR5IGJlZW4gcmVnaXN0ZXJlZC4gKi9cbmNvbnN0IHJlZ2lzdGVyZWRDb25maWd1cmF0aW9ucyA9IG5ldyBXZWFrU2V0KClcblxuLyoqXG4gKiBGcmFtZXdvcmstb3duZWQgd2Vic29ja2V0IGNoYW5uZWwgZm9yIHN5bmNlZCByZXNvdXJjZXNcbiAqICh7QGxpbmsgVkVMT0NJT1VTX1NZTkNfQ0hBTk5FTH0pLlxuICpcbiAqIFN1YnNjcmliZSBwYXJhbXMgbWlycm9yIGEgZGVjbGFyZWQgcHVsbCBzY29wZSDigJQgYHtyZXNvdXJjZVR5cGUsIGNvbmRpdGlvbnN9YFxuICogcGx1cyB0aGUgY2xpZW50LWluamVjdGVkIGBhdXRoZW50aWNhdGlvblRva2VuYCDigJQgYW5kIHN1YnNjcmliZS10aW1lXG4gKiBhdXRob3JpemF0aW9uIGRlbGVnYXRlcyB0byB0aGUgYXBwIHN5bmMgcmVzb3VyY2UncyBleGlzdGluZ1xuICogYGF1dGhvcml6ZUNoYW5nZXMoe3BhcmFtcywgc2NvcGV9KWAgKHRoZSBgc3luYy5hcGkucmVzb3VyY2VDbGFzc2ApLCBzbyBhcHBzXG4gKiBob29rIGluIHRocm91Z2ggdGhlIGF1dGhvcml6YXRpb24gdGhleSBhbHJlYWR5IGRlY2xhcmVkIGluc3RlYWQgb2Ygd3JpdGluZ1xuICogdGhlaXIgb3duIGNoYW5uZWwgY2xhc3Nlcy4gQnJvYWRjYXN0IHJvdXRpbmcgbWF0Y2hlcyB0aGUgcHVibGlzaGVyJ3NcbiAqIHNjb3BpbmcgcGFyYW1zIGFnYWluc3QgdGhlIHN1YnNjcmlwdGlvbidzIHNjb3BlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNXZWJzb2NrZXRDaGFubmVsIGV4dGVuZHMgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCB7XG4gIC8qKlxuICAgKiBTY29wZSB0aGUgc3Vic2NyaXB0aW9uIHdhcyBhdXRob3JpemVkIGZvciwgc2V0IGJ5IHtAbGluayBTeW5jV2Vic29ja2V0Q2hhbm5lbCNjYW5TdWJzY3JpYmV9LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLXJlc291cmNlLWJhc2UuanNcIikuU2VyaWFsaXplZENoYW5nZXNTY29wZSB8IG51bGx9XG4gICAqL1xuICBfc2NvcGUgPSBudWxsXG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCBvbiBhIGNvbmZpZ3VyYXRpb24gZGVjbGFyaW5nIGFcbiAgICogYHN5bmMuYXBpYCBibG9jayAoZ3VhcmRlZCBzbyByZXBlYXRlZCBzZXJ2ZXIgYm9vdHMgd2l0aCB0aGUgc2FtZVxuICAgKiBjb25maWd1cmF0aW9uIHJlZ2lzdGVyIGl0IG9ubHkgb25jZSkuIE5vLW9wIHdpdGhvdXQgYHN5bmMuYXBpYCDigJQgdGhlXG4gICAqIGNoYW5uZWwgYXV0aG9yaXplcyB0aHJvdWdoIHRoZSBhcHAncyBzeW5jIHJlc291cmNlIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyRnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICAgIGlmICghY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpLmFwaSB8fCByZWdpc3RlcmVkQ29uZmlndXJhdGlvbnMuaGFzKGNvbmZpZ3VyYXRpb24pKSByZXR1cm5cblxuICAgIHJlZ2lzdGVyZWRDb25maWd1cmF0aW9ucy5hZGQoY29uZmlndXJhdGlvbilcbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbChWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMLCB0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhvcml6ZXMgdGhlIHN1YnNjcmlwdGlvbiB0aHJvdWdoIHRoZSBhcHAgc3luYyByZXNvdXJjZTogdGhlIHN1YnNjcmliZVxuICAgKiBwYXJhbXMgYXJlIHBhcnNlZCBpbnRvIHRoZSBzYW1lIHNlcmlhbGl6ZWQgc2NvcGUgdGhlIGNoYW5nZXMgZW5kcG9pbnRcbiAgICogY29uc3VtZXMgYW5kIHBhc3NlZCB0byB0aGUgcmVzb3VyY2UncyBgYXV0aG9yaXplQ2hhbmdlcyh7cGFyYW1zLCBzY29wZX0pYC5cbiAgICogRGVuaWFscyBhbmQgbWFsZm9ybWVkIHNjb3BlcyB0aHJvdywgcmVqZWN0aW5nIHRoZSBzdWJzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBzdWJzY3JpcHRpb24gaXMgYWxsb3dlZC5cbiAgICovXG4gIGFzeW5jIGNhblN1YnNjcmliZSgpIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IGF3YWl0IHRoaXMuYnVpbGRTeW5jUmVzb3VyY2UoKVxuICAgIGNvbnN0IHNjb3BlID0gcmVzb3VyY2UuY2hhbmdlc1Njb3BlKHtzY29wZToge2NvbmRpdGlvbnM6IHRoaXMucGFyYW1zLmNvbmRpdGlvbnMsIHJlc291cmNlVHlwZTogdGhpcy5wYXJhbXMucmVzb3VyY2VUeXBlLCByZXNvdXJjZVR5cGVzOiB0aGlzLnBhcmFtcy5yZXNvdXJjZVR5cGVzfX0pXG5cbiAgICBhd2FpdCByZXNvdXJjZS5hdXRob3JpemVDaGFuZ2VzKHtwYXJhbXM6IHRoaXMucGFyYW1zLCBzY29wZX0pXG5cbiAgICB0aGlzLl9zY29wZSA9IHNjb3BlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXBwIHN5bmMgcmVzb3VyY2UgYXV0aG9yaXppbmcgdGhpcyBzdWJzY3JpcHRpb24sIG1pcnJvcmluZyB0aGVcbiAgICogc3luYyB0cmFuc3BvcnQgY29udHJvbGxlcidzIHJlc291cmNlIGNvbnN0cnVjdGlvbiB3aXRoIHRoZSBhYmlsaXR5XG4gICAqIHJlc29sdmVkIGZyb20gdGhlIHN1YnNjcmliZSBwYXJhbXMgKHdoaWNoIGNhcnJ5IHRoZSBjbGllbnQtaW5qZWN0ZWRcbiAgICogYXV0aGVudGljYXRpb25Ub2tlbikuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1yZXNvdXJjZS1iYXNlLmpzXCIpLmRlZmF1bHQ+fSBBcHAgc3luYyByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICovXG4gIGFzeW5jIGJ1aWxkU3luY1Jlc291cmNlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGFwaSA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5hcGlcblxuICAgIGlmICghYXBpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSAke1ZFTE9DSU9VU19TWU5DX0NIQU5ORUx9IGNoYW5uZWwgcmVxdWlyZXMgYSBzeW5jLmFwaSBjb25maWd1cmF0aW9uIGJsb2NrIHdpdGggdGhlIGFwcCdzIHN5bmMgcmVzb3VyY2UgY2xhc3NgKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIGNvbmZpZ3VyZWQgcmVzb3VyY2UgY2xhc3MgdG8gdGhlIHN5bmMgcmVzb3VyY2UgY29udHJhY3RcbiAgICAvLyAoY2hhbmdlc1Njb3BlL2F1dGhvcml6ZUNoYW5nZXMpIHRoZSBzeW5jLmFwaSB2YWxpZGF0aW9uIHJlcXVpcmVzLlxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL3N5bmMtcmVzb3VyY2UtYmFzZS5qc1wiKS5kZWZhdWx0fSAqLyAoYXBpLnJlc291cmNlQ2xhc3MpXG4gICAgLy8gTmFycm93cyB0aGUgd2Vic29ja2V0IHN1YnNjcmliZSBwYXJhbXMgdG8gdGhlIHJlc291cmNlIHBhcmFtcyBjb250cmFjdC5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcy5wYXJhbXMpKVxuICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLnNlc3Npb24udXBncmFkZVJlcXVlc3RcbiAgICBjb25zdCBhYmlsaXR5ID0gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlQWJpbGl0eSh7cGFyYW1zLCByZXF1ZXN0fSlcblxuICAgIHJldHVybiBuZXcgUmVzb3VyY2VDbGFzcyh7XG4gICAgICBhYmlsaXR5LFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgLi4uKGFiaWxpdHk/LmdldENvbnRleHQoKSB8fCB7fSksXG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgcmVxdWVzdFxuICAgICAgfSxcbiAgICAgIGxvY2FsczogYWJpbGl0eT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiBSZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MsXG4gICAgICBtb2RlbE5hbWU6IFJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcz8ubmFtZSxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovICh7XG4gICAgICAgIGF0dHJpYnV0ZXM6IFJlc291cmNlQ2xhc3MuYXR0cmlidXRlcyB8fCB7fSxcbiAgICAgICAgc3luYzoge2VuYWJsZWQ6IHRydWV9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGEgcHVibGlzaGVyIGJyb2FkY2FzdCB0byB0aGlzIHN1YnNjcmlwdGlvbiB3aGVuIHRoZSBwdWJsaXNoZWRcbiAgICogcmVzb3VyY2UgdHlwZSBlcXVhbHMgdGhlIHR5cGUgdGhlIHN1YnNjcmlwdGlvbiB3YXMgYXV0aG9yaXplZCBmb3IgYW5kIHRoZVxuICAgKiBzY29waW5nIHBhcmFtcyBzYXRpc2Z5IGV2ZXJ5IHNjb3BlIGNvbmRpdGlvbjogZWFjaCBjb25kaXRpb24ga2V5IG11c3QgYmVcbiAgICogcHJlc2VudCBpbiB0aGUgYnJvYWRjYXN0IHBhcmFtcyBhbmQgbWF0Y2ggYnkgc3RyaW5nIGNvbXBhcmlzb24gKGFycmF5XG4gICAqIGNvbmRpdGlvbnMgbWF0Y2ggYnkgbWVtYmVyc2hpcCkuIEJyb2FkY2FzdHMgd2l0aG91dCBhIHJlc291cmNlIHR5cGUgYW5kXG4gICAqIGNvbmRpdGlvbnMgdGhlIHB1Ymxpc2hlcidzIHNjb3BpbmcgcGFyYW1zIGRvIG5vdCBjYXJyeSBuZXZlciBtYXRjaCwgc28gYVxuICAgKiBzdWJzY3JpcHRpb24gY2Fubm90IHJlY2VpdmUgY2hhbmdlcyBvdXRzaWRlIGl0cyBhdXRob3JpemVkIHNjb3BlLlxuICAgKlxuICAgKiBUaGUgYWxsLXR5cGVzICh1c2VyKSBzY29wZSBkZWNsYXJlcyBubyBzaW5nbGUgcmVzb3VyY2UgdHlwZSAtIGl0IHN1YnNjcmliZXNcbiAgICogb25jZSBmb3IgZXZlcnkgdHlwZSBpdCBjYW4gYXBwbHksIGxpc3RlZCBpbiBgc2NvcGUucmVzb3VyY2VUeXBlc2AgLSBzbyBpdFxuICAgKiBtYXRjaGVzIGEgYnJvYWRjYXN0IG9mIGFueSBvZiB0aG9zZSB0eXBlcy4gVHlwZXMgb3V0c2lkZSB0aGF0IGxpc3QgYXJlXG4gICAqIGRyb3BwZWQgaGVyZSwgYnkgdGhpcyBjaGVhcCBjaGVjaywgYW5kIG5ldmVyIHJlYWNoIHRoZSBwZXItZGVsaXZlcnkgYWNjZXNzXG4gICAqIHJlLWNoZWNrIGluIHtAbGluayBTeW5jV2Vic29ja2V0Q2hhbm5lbCNfdXNlclNjb3BlRGVsaXZlcmFibGVCb2R5fTogdGhhdFxuICAgKiByZS1jaGVjayBjaGVja3Mgb3V0IGEgZGF0YWJhc2UgY29ubmVjdGlvbiBhbmQgcnVucyBhIHF1ZXJ5IHBlciBtYXRjaGVkXG4gICAqIGJyb2FkY2FzdCwgc28gbWF0Y2hpbmcgZXZlcnkgdHlwZSB3b3VsZCBwdXQgREIgd29yayBvbiBldmVyeSBicm9hZGNhc3QgZm9yXG4gICAqIGV2ZXJ5IHN1YnNjcmliZWQgZGV2aWNlLiBBIGJyb2FkY2FzdCBjYXJyeWluZyBubyByZXNvdXJjZSB0eXBlIGF0IGFsbCBzdGlsbFxuICAgKiBuZXZlciBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEpzb25WYWx1ZX0gYnJvYWRjYXN0UGFyYW1zIC0gUHVibGlzaGVyIHNjb3BpbmcgcGFyYW1zICh0aGUgcHVibGlzaGVkIHJlc291cmNlVHlwZSBwbHVzIHRoZSBjaGFuZ2UncyBzY29wZS1wYXJ0aXRpb24gdmFsdWVzKS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGJyb2FkY2FzdCBiZWxvbmdzIHRvIHRoaXMgc3Vic2NyaXB0aW9uJ3Mgc2NvcGUuXG4gICAqL1xuICBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcykge1xuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5fc2NvcGVcblxuICAgIGlmICghc2NvcGUpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgc2NvcGluZ1BhcmFtcyA9IGJyb2FkY2FzdFBhcmFtcyAmJiB0eXBlb2YgYnJvYWRjYXN0UGFyYW1zID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGJyb2FkY2FzdFBhcmFtcylcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChicm9hZGNhc3RQYXJhbXMpXG4gICAgICA6IHt9XG5cbiAgICBpZiAoIU9iamVjdC5oYXNPd24oc2NvcGluZ1BhcmFtcywgXCJyZXNvdXJjZVR5cGVcIikpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKHNjb3BlLnJlc291cmNlVHlwZSA9PT0gbnVsbCkge1xuICAgICAgaWYgKHNjb3BlLnJlc291cmNlVHlwZXMgJiYgIXNjb3BlLnJlc291cmNlVHlwZXMuc29tZSgocmVzb3VyY2VUeXBlKSA9PiByZXNvdXJjZVR5cGUgPT09IFN0cmluZyhzY29waW5nUGFyYW1zLnJlc291cmNlVHlwZSkpKSByZXR1cm4gZmFsc2VcbiAgICB9IGVsc2UgaWYgKFN0cmluZyhzY29waW5nUGFyYW1zLnJlc291cmNlVHlwZSkgIT09IFN0cmluZyhzY29wZS5yZXNvdXJjZVR5cGUpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtjb25kaXRpb25OYW1lLCBjb25kaXRpb25WYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGUuY29uZGl0aW9ucykpIHtcbiAgICAgIGlmICghT2JqZWN0Lmhhc093bihzY29waW5nUGFyYW1zLCBjb25kaXRpb25OYW1lKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGNvbnN0IHNjb3BpbmdWYWx1ZSA9IHNjb3BpbmdQYXJhbXNbY29uZGl0aW9uTmFtZV1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29uZGl0aW9uVmFsdWUpKSB7XG4gICAgICAgIGlmICghY29uZGl0aW9uVmFsdWUuc29tZSgodmFsdWUpID0+IFN0cmluZyh2YWx1ZSkgPT09IFN0cmluZyhzY29waW5nVmFsdWUpKSkgcmV0dXJuIGZhbHNlXG4gICAgICB9IGVsc2UgaWYgKFN0cmluZyhjb25kaXRpb25WYWx1ZSkgIT09IFN0cmluZyhzY29waW5nVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgYSBtYXRjaGVkIGJyb2FkY2FzdC4gU2NvcGVkIHN1YnNjcmlwdGlvbnMgKHdpdGggZXhwbGljaXRcbiAgICogY29uZGl0aW9ucykgYWxyZWFkeSByb3V0ZWQgdGhyb3VnaCB7QGxpbmsgU3luY1dlYnNvY2tldENoYW5uZWwjbWF0Y2hlc30sIHNvXG4gICAqIHRoZSBjaGFuZ2UgaXMgaW4gc2NvcGUgYW5kIGRlbGl2ZXJzIHVuY2hhbmdlZC4gVXNlci1zY29wZSBzdWJzY3JpcHRpb25zXG4gICAqIChlbXB0eSBjb25kaXRpb25zLCBcImV2ZXJ5dGhpbmcgbXkgYWJpbGl0eSBjYW4gc2VlXCIpIG1hdGNoIGV2ZXJ5IGJyb2FkY2FzdFxuICAgKiBvZiB0aGUgcmVzb3VyY2UgdHlwZSwgc28gZWFjaCBwdWJsaXNoZWQgY2hhbmdlIGlzIHJlLWNoZWNrZWQgYWdhaW5zdCB0aGVcbiAgICogc3Vic2NyaWJlcidzIGFiaWxpdHkgYXQgZmFuLW91dCB0aHJvdWdoIHRoZSBhcHAgc3luYyByZXNvdXJjZSdzXG4gICAqIGBjaGFuZ2VEZWxpdmVyYWJsZWA7IG9ubHkgYWNjZXNzaWJsZSBjaGFuZ2VzIGFyZSBkZWxpdmVyZWQsIGFuZCBhIGJyb2FkY2FzdFxuICAgKiB3aXRoIG5vIGFjY2Vzc2libGUgY2hhbmdlIGlzIGRyb3BwZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IGJvZHkgKHN5bmMgZW52ZWxvcGUpLlxuICAgKiBAcGFyYW0ge3tldmVudElkPzogc3RyaW5nfX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgaWYgKCF0aGlzLl9pc1VzZXJTY29wZSgpKSB7XG4gICAgICB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGRlbGl2ZXJhYmxlQm9keSA9IGF3YWl0IHRoaXMuX3VzZXJTY29wZURlbGl2ZXJhYmxlQm9keShib2R5KVxuXG4gICAgaWYgKGRlbGl2ZXJhYmxlQm9keSAhPT0gbnVsbCkgdGhpcy5zZW5kTWVzc2FnZShkZWxpdmVyYWJsZUJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIHN1YnNjcmlwdGlvbiBpcyBhIHVzZXIgc2NvcGU6IGF1dGhvcml6ZWQgd2l0aCBlbXB0eSBjb25kaXRpb25zXG4gICAqIChcImV2ZXJ5dGhpbmcgbXkgYWJpbGl0eSBjYW4gc2VlXCIpLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgc3Vic2NyaXB0aW9uIGlzIGEgdXNlciBzY29wZS5cbiAgICovXG4gIF9pc1VzZXJTY29wZSgpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLl9zY29wZSkgJiYgT2JqZWN0LmtleXMoLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtcmVzb3VyY2UtYmFzZS5qc1wiKS5TZXJpYWxpemVkQ2hhbmdlc1Njb3BlfSAqLyAodGhpcy5fc2NvcGUpLmNvbmRpdGlvbnMpLmxlbmd0aCA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgYSB1c2VyLXNjb3BlIGJyb2FkY2FzdCB0byB0aGUgc3luYyBlbnRyaWVzIHRoZSBzdWJzY3JpYmVyJ3MgYWJpbGl0eVxuICAgKiBjYW4gYWNjZXNzLCByZS1jaGVja2luZyBlYWNoIHRocm91Z2ggdGhlIGFwcCBzeW5jIHJlc291cmNlJ3NcbiAgICogYGNoYW5nZURlbGl2ZXJhYmxlYC4gUmV0dXJucyB0aGUgYnJvYWRjYXN0IG5hcnJvd2VkIHRvIGFjY2Vzc2libGUgZW50cmllcyxcbiAgICogb3IgbnVsbCB3aGVuIG5vbmUgYXJlIGFjY2Vzc2libGUuIE5vbi1lbnZlbG9wZSBib2RpZXMgYW5kIGVudHJpZXMgd2l0aG91dCBhXG4gICAqIHJlc291cmNlIGlkIGFyZSBkcm9wcGVkIChmYWlsIGNsb3NlZCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEpzb25WYWx1ZSB8IG51bGw+fSBEZWxpdmVyYWJsZSBib2R5LCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX3VzZXJTY29wZURlbGl2ZXJhYmxlQm9keShib2R5KSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYm9keSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBlbnZlbG9wZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYm9keSlcbiAgICBjb25zdCBzY29wZSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLXJlc291cmNlLWJhc2UuanNcIikuU2VyaWFsaXplZENoYW5nZXNTY29wZX0gKi8gKHRoaXMuX3Njb3BlKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBzeW5jcyA9IEFycmF5LmlzQXJyYXkoZW52ZWxvcGUuc3luY3MpID8gZW52ZWxvcGUuc3luY3MgOiBbZW52ZWxvcGVdXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGRlbGl2ZXJhYmxlU3luY3MgPSBbXVxuXG4gICAgLy8gQnJvYWRjYXN0IGZhbi1vdXQgcnVucyB0aHJvdWdoIGB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0c2AgKHNlZVxuICAgIC8vIENvbmZpZ3VyYXRpb24jX2Jyb2FkY2FzdFRvQ2hhbm5lbExvY2FsKSwgc28gdGhlcmUgaXMgbm8gYW1iaWVudCBkYXRhYmFzZVxuICAgIC8vIGNvbm5lY3Rpb24gaGVyZS4gUmVzb2x2ZSB0aGUgcmVzb3VyY2UncyBhYmlsaXR5IGFuZCBydW4gdGhlIHBlci1kZWxpdmVyeVxuICAgIC8vIGFjY2VzcyBxdWVyeSBpbnNpZGUgYSBjaGVja2VkLW91dCBjb25uZWN0aW9uIGNvbnRleHQsIG1pcnJvcmluZyBob3cgb3RoZXJcbiAgICAvLyBicm9hZGNhc3QtdGltZSBEQiB3b3JrICh0aGUgZnJvbnRlbmQtbW9kZWwgY2hhbm5lbCkgb2J0YWlucyBjb25uZWN0aW9ucy5cbiAgICBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHtWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSB1c2VyLXNjb3BlIGRlbGl2ZXJ5IGFjY2VzcyBjaGVja2B9LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNvdXJjZSA9IGF3YWl0IHRoaXMuYnVpbGRTeW5jUmVzb3VyY2UoKVxuXG4gICAgICBmb3IgKGNvbnN0IHN5bmMgb2Ygc3luY3MpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VJZCA9IHN5bmM/LnJlc291cmNlSWRcbiAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gc3luYz8ucmVzb3VyY2VUeXBlID8/IHNjb3BlLnJlc291cmNlVHlwZVxuXG4gICAgICAgIGlmIChyZXNvdXJjZUlkID09PSB1bmRlZmluZWQgfHwgcmVzb3VyY2VJZCA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgICAvLyBQYXNzIHRoZSBjb21wbGV0ZSBicm9hZGNhc3QgZW50cnkgdGhyb3VnaCBzbyB0aGUgYXBwJ3NcbiAgICAgICAgLy8gY2hhbmdlRGVsaXZlcmFibGUgY2FuIGF1dGhvcml6ZSBieSBleGFjdC1yb3cgaWRlbnRpdHkgKGltbXV0YWJsZVxuICAgICAgICAvLyBzeW5jLXJvdyBpZCwgYWN0b3Itc3BlY2lmaWMgbWV0YWRhdGEpIOKAlCBjb25jdXJyZW50IHRhcmdldGVkIGFuZFxuICAgICAgICAvLyBzaGFyZWQgYnJvYWRjYXN0cyBmb3IgdGhlIHNhbWUgcmVzb3VyY2UgaWRlbnRpdHkgYXV0aG9yaXplXG4gICAgICAgIC8vIGluZGVwZW5kZW50bHkuIE9ubHkgcmVzb3VyY2VJZC9yZXNvdXJjZVR5cGUgYXJlIG5vcm1hbGl6ZWQgdG9cbiAgICAgICAgLy8gc3RyaW5ncywgb24gYSBjb3B5IHNvIHRoZSBwdWJsaXNoZWQgZW50cnkgaXMgbmV2ZXIgbXV0YXRlZC5cbiAgICAgICAgY29uc3Qgc3luY0VudHJ5ID0ge1xuICAgICAgICAgIC4uLnN5bmMsXG4gICAgICAgICAgcmVzb3VyY2VJZDogU3RyaW5nKHJlc291cmNlSWQpLFxuICAgICAgICAgIHJlc291cmNlVHlwZTogU3RyaW5nKHJlc291cmNlVHlwZSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhd2FpdCByZXNvdXJjZS5jaGFuZ2VEZWxpdmVyYWJsZSh7cGFyYW1zOiB0aGlzLnBhcmFtcywgc2NvcGUsIHN5bmM6IHN5bmNFbnRyeX0pKSB7XG4gICAgICAgICAgZGVsaXZlcmFibGVTeW5jcy5wdXNoKHN5bmMpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaWYgKGRlbGl2ZXJhYmxlU3luY3MubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuICAgIGlmIChBcnJheS5pc0FycmF5KGVudmVsb3BlLnN5bmNzKSkgcmV0dXJuIHsuLi5lbnZlbG9wZSwgc3luY3M6IGRlbGl2ZXJhYmxlU3luY3N9XG5cbiAgICByZXR1cm4gZGVsaXZlcmFibGVTeW5jc1swXVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml6ZWQgc2NvcGUgZm9yIGRlYnVnIHNuYXBzaG90cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gRGVidWctc2FmZSBzdWJzY3JpcHRpb24gZGV0YWlscy5cbiAgICovXG4gIGRlYnVnU25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtzY29wZTogdGhpcy5fc2NvcGUsIHVzZXJTY29wZTogdGhpcy5faXNVc2VyU2NvcGUoKX1cbiAgfVxufVxuIl19