import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
export type FrontendModelLifecycleBroadcastBody = {
    action?: string;
    id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
    matchedEventFilterKeys?: string[];
    previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
    record?: import("./query.js").FrontendModelTransportValue;
    [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined;
};
export type FrontendModelWebsocketUpgradeRequest = {
    headers?: () => Record<string, string | string[] | undefined>;
    remoteAddress?: () => string | undefined;
};
export type FrontendModelWebsocketSyntheticRequest = {
    headers: () => Record<string, string | string[] | undefined>;
    header: (name: string) => string | string[] | undefined;
    metadata: (key?: string) => Record<string, import("./query.js").FrontendModelTransportValue> | import("./query.js").FrontendModelTransportValue | undefined;
    path: () => string;
    httpMethod: () => string;
    remoteAddress: () => string | undefined;
    origin: () => string | string[] | undefined;
};
/**
 * Per-session channel subscription for frontend-model lifecycle events.
 * Replaces the legacy `FrontendModelWebsocketChannel` (Phase 3).
 *
 * Auth model: subscribe-time only. `canSubscribe` resolves the caller's
 * ability once, checks that at least one `allow` rule exists for
 * `read` on the requested model class, and then delivers future
 * lifecycle broadcasts for that model without re-authorizing per event.
 * This matches the explicit design decision in Phase 3 to trade
 * per-record visibility guarantees for massively cheaper broadcast fan-out.
 * Subscriber-provided event filters can still narrow which create/update
 * events are delivered, but they are matching predicates rather than
 * per-record authorization checks.
 *
 * Wire: subscribe with `subscribeChannel("frontend-models", {params: {model: ModelName}})`.
 * Backend publishes `{action, id, record}` via
 * `configuration.broadcastToChannel("frontend-models", {model: ModelName}, body)`;
 * `matches()` routes by model name.
 */
export default class FrontendModelWebsocketChannel extends VelociousWebsocketChannel {
    /**
     * Ability.
     * @type {import("../authorization/ability.js").default | null} */
    _ability: import("../authorization/ability.js").default | null;
    /**
     * Runs can subscribe.
     * @returns {Promise<boolean>} Whether the frontend-model subscription is authorized.
     */
    canSubscribe(): Promise<boolean>;
    /**
     * Resolves a subscription name through frontend resources before falling back to a backing model name.
     * @param {string} modelName - Frontend resource name.
     * @returns {typeof import("../database/record/index.js").default | undefined} - Backing model class.
     */
    _modelClass(modelName: string): typeof import("../database/record/index.js").default | undefined;
    /**
     * Runs deliver broadcast.
     * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
     * @param {{eventId?: string}} [meta] - Optional event metadata.
     * @returns {Promise<void>} Resolves after delivery.
     */
    deliverBroadcast(body: FrontendModelLifecycleBroadcastBody, meta?: {
        eventId?: string;
    }): Promise<void>;
    /**
     * Runs deliver broadcast.
     * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
     * @param {{eventId?: string}} [meta] - Optional event metadata.
     * @returns {Promise<void>} Resolves after delivery.
     */
    _deliverBroadcast(body: FrontendModelLifecycleBroadcastBody, meta?: {
        eventId?: string;
    }): Promise<void>;
    /**
     * Runs matches.
     * @param {Record<string, import("./query.js").FrontendModelTransportValue>} broadcastParams - Params from `broadcastToChannel`.
     * @returns {boolean} Whether the broadcast matches this subscriber's model.
     */
    matches(broadcastParams: Record<string, import("./query.js").FrontendModelTransportValue>): boolean;
    /**
     * Runs debug snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
     */
    debugSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs model name.
     * @returns {string | null} - Requested frontend-model name or null.
     */
    _modelName(): string | null;
    /**
     * Runs has projection params.
     * @returns {boolean} - Whether this subscription requested per-event record projection.
     */
    _hasProjectionParams(): boolean;
    /**
     * Runs has event filter params.
     * @returns {boolean} - Whether this subscription requested event query filters.
     */
    _hasEventFilterParams(): boolean;
    /**
     * Runs has unfiltered event delivery.
     * @returns {boolean} - Whether unfiltered callbacks should receive every event.
     */
    _hasUnfilteredEventDelivery(): boolean;
    /**
     * Runs has destroy event delivery.
     * @returns {boolean} - Whether id-only destroy events should be delivered with event filters.
     */
    _hasDestroyEventDelivery(): boolean;
    /**
     * Runs event filters.
     * @returns {import("./query.js").FrontendModelEventFilterPayloadEntry[]} - Valid event filters.
     */
    _eventFilters(): import("./query.js").FrontendModelEventFilterPayloadEntry[];
    /**
     * Runs frontend model controller class.
     * @returns {Promise<typeof import("../frontend-model-controller.js").default>} - Frontend model controller class.
     */
    _frontendModelControllerClass(): Promise<typeof import("../frontend-model-controller.js").default>;
    /**
     * Runs frontend model controller.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [params] - Optional params override.
     * @returns {import("../frontend-model-controller.js").default} - Synthetic controller used for resource serialization.
     */
    _frontendModelController(FrontendModelController: typeof import("../frontend-model-controller.js").default, params?: Record<string, ReturnType<typeof JSON.parse>>): import("../frontend-model-controller.js").default;
    /**
     * Resolves tenant for event.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolved tenant.
     */
    _resolveEventTenant(id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Resolves the subscriber's tenant for the broadcast record and runs `callback` inside that tenant
     * context. Broadcast delivery runs in whatever ambient tenant context the publisher left behind. For
     * multi-tenant records that ambient tenant may have been resolved without the subscriber's request
     * (e.g. a relay endpoint or background job mutating the row), so it lacks the subscriber's per-record
     * access flags and the per-event authorization query wrongly finds nothing. Re-resolving the tenant
     * from the event record id plus the subscriber's request makes the authorization queries run against
     * the subscriber's own tenant/ability scope. When no tenant resolves (non-multitenant configs), the
     * callback runs directly so the ambient context is preserved.
     * @template T
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {() => Promise<T>} callback - Authorized-query callback.
     * @returns {Promise<T>} - Callback result.
     */
    _withEventTenant<T>(id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, callback: () => Promise<T>): Promise<T>;
    /**
     * Whether the broadcast record is within the subscriber's authenticated ability scope. Used to gate
     * unfiltered/unprojected create/update delivery so a scoped token never receives a record it cannot read.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<boolean>} True when the record is readable by this subscription.
     */
    _eventIsAccessible(id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, FrontendModelController: typeof import("../frontend-model-controller.js").default): Promise<boolean>;
    /**
     * Runs matched event filter keys for event id.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<string[]>} - Event filter keys matched by the record.
     */
    _matchedEventFilterKeysForEventId(id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, FrontendModelController: typeof import("../frontend-model-controller.js").default): Promise<string[]>;
    /**
     * Runs event matches filter.
     * @param {object} args - Filter args.
     * @param {typeof import("../frontend-model-controller.js").default} args.FrontendModelController - Server-side frontend-model controller class.
     * @param {import("./query.js").FrontendModelEventFilterPayloadEntry} args.eventFilter - Event filter payload.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Event record id.
     * @returns {Promise<boolean>} Whether the record matches the filter.
     */
    _eventMatchesFilter({ FrontendModelController, eventFilter, id }: {
        FrontendModelController: typeof import("../frontend-model-controller.js").default;
        eventFilter: import("./query.js").FrontendModelEventFilterPayloadEntry;
        id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
    }): Promise<boolean>;
    /**
     * Runs projected record for event id.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>} - Serialized projected record.
     */
    _projectedRecordForEventId(id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, FrontendModelController: typeof import("../frontend-model-controller.js").default): Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>;
    /**
     * Minimal Request-like stub used only for ability resolution. Avoids
     * importing `WebsocketRequest` here because its `node:querystring`
     * dependency would pull server-only code into browser bundles via
     * the `configuration → logger → websocket-publishers` import chain.
     * Header names are normalized to lowercase so `header("cookie")`
     * finds a value regardless of whether the upgrade-request headers
     * map uses `"Cookie"` or `"cookie"`. Session metadata stays separate
     * from headers and is exposed through `metadata(...)` for ability
     * resolvers that need websocket-delivered session data.
     * @returns {FrontendModelWebsocketSyntheticRequest} Request-like object for ability resolution.
     */
    _syntheticRequest(): FrontendModelWebsocketSyntheticRequest;
}
//# sourceMappingURL=websocket-channel.d.ts.map