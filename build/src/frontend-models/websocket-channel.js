// @ts-check
import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
import Response from "../http-server/client/response.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyConditions } from "../utils/model-primary-key.js";
/**
 * Defines this typedef.
 * @typedef {{action?: string, id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, matchedEventFilterKeys?: string[], record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
 */
/**
 * Defines this typedef.
 * @typedef {{headers?: () => Record<string, string | string[] | undefined>, remoteAddress?: () => string | undefined}} FrontendModelWebsocketUpgradeRequest
 */
/**
 * Defines this typedef.
 * @typedef {{headers: () => Record<string, string | string[] | undefined>, header: (name: string) => string | string[] | undefined, metadata: (key?: string) => Record<string, import("./query.js").FrontendModelTransportValue> | import("./query.js").FrontendModelTransportValue | undefined, path: () => string, httpMethod: () => string, remoteAddress: () => string | undefined, origin: () => string | string[] | undefined}} FrontendModelWebsocketSyntheticRequest
 */
const EVENT_FILTER_KEYS = new Set(["joins", "key", "searches", "where"]);
// Mirrors FRONTEND_MODELS_CHANNEL_NAME in ./websocket-publishers.js, duplicated here
// to avoid the configuration → logger → websocket-publishers import cycle.
const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models";
/**
 * Runs transport serialization options for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {import("./transport-serialization.js").FrontendModelTransportSerializationOptions} - Serialization options.
 */
function transportSerializationOptionsForConfiguration(configuration) {
    return {
        timeZone: configuration.getEnvironmentHandler().getTimeZone(configuration)
    };
}
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
    _ability = null;
    /**
     * Runs can subscribe.
     * @returns {Promise<boolean>} Whether the frontend-model subscription is authorized.
     */
    async canSubscribe() {
        const modelName = this._modelName();
        if (!modelName)
            return false;
        this._eventFilters();
        const configuration = this.session.configuration;
        const modelClasses = configuration.getModelClasses();
        const ModelClass = modelClasses[modelName];
        if (!ModelClass)
            return false;
        const request = /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest());
        const ability = await configuration.resolveAbility({
            // Forward the subscriber's params (e.g. authenticationToken) so token-authenticated clients
            // resolve the same ability they would over HTTP. Without this only session/cookie auth on the
            // upgrade request works, and param-based auth (like a scanner passing an authenticationToken)
            // is dropped — leaving such subscribers with a guest ability and no read rule.
            params: { ...this.params, model: modelName },
            request,
            response: new Response({ configuration })
        });
        if (!ability)
            return false;
        this._ability = ability;
        // Load resource-declared rules for this model class before checking,
        // otherwise `rulesFor` returns empty for abilities whose resources
        // register rules lazily via `abilities()`.
        ability.loadAbilitiesForModelClass(ModelClass);
        const readRules = ability.rulesFor({ action: "read", modelClass: ModelClass });
        return readRules.some((/** @type {{effect: string}} */ rule) => rule.effect === "allow");
    }
    /**
     * Runs deliver broadcast.
     * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
     * @param {{eventId?: string}} [meta] - Optional event metadata.
     * @returns {Promise<void>} Resolves after delivery.
     */
    async deliverBroadcast(body, meta) {
        await this._deliverBroadcast(body, meta);
    }
    /**
     * Runs deliver broadcast.
     * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
     * @param {{eventId?: string}} [meta] - Optional event metadata.
     * @returns {Promise<void>} Resolves after delivery.
     */
    async _deliverBroadcast(body, meta) {
        const hasEventFilters = this._hasEventFilterParams();
        if (!this._hasProjectionParams() && !hasEventFilters) {
            // Even unfiltered subscriptions must respect the subscriber's ability. A create/update carries
            // the record, so only deliver it when the record is within the authenticated ability's scope.
            // Destroys (and bodies without a usable id) carry no record, so pass them through unchanged.
            if (body && typeof body === "object" && (body.action === "create" || body.action === "update") && body.id !== undefined && body.id !== null) {
                const FrontendModelController = await this._frontendModelControllerClass();
                if (!await this._eventIsAccessible(body.id, FrontendModelController))
                    return;
            }
            this.sendMessage(body, meta);
            return;
        }
        if (!body || typeof body !== "object") {
            if (!hasEventFilters || this._hasUnfilteredEventDelivery())
                this.sendMessage(body, meta);
            return;
        }
        if (body.action === "destroy") {
            if (!hasEventFilters || this._hasDestroyEventDelivery() || this._hasUnfilteredEventDelivery())
                this.sendMessage(body, meta);
            return;
        }
        if (body.id === undefined || body.id === null) {
            if (!hasEventFilters || this._hasUnfilteredEventDelivery())
                this.sendMessage(body, meta);
            return;
        }
        const FrontendModelController = await this._frontendModelControllerClass();
        const matchedEventFilterKeys = await this._matchedEventFilterKeysForEventId(body.id, FrontendModelController);
        if (hasEventFilters && matchedEventFilterKeys.length === 0 && !this._hasUnfilteredEventDelivery()) {
            return;
        }
        /**
         * Deliver body.
         * @type {FrontendModelLifecycleBroadcastBody} */
        let deliverBody = body;
        if (this._hasProjectionParams()) {
            const projectedRecord = await this._projectedRecordForEventId(body.id, FrontendModelController);
            if (!projectedRecord) {
                return;
            }
            const configuration = this.session.configuration;
            if (!configuration) {
                throw new Error("Frontend model websocket channel has no configuration for transport serialization");
            }
            deliverBody = {
                ...deliverBody,
                record: /** @type {import("./query.js").FrontendModelTransportValue} */ (serializeFrontendModelTransportValue(projectedRecord, transportSerializationOptionsForConfiguration(configuration)))
            };
        }
        if (hasEventFilters) {
            deliverBody = {
                ...deliverBody,
                matchedEventFilterKeys
            };
        }
        this.sendMessage(deliverBody, meta);
    }
    /**
     * Runs matches.
     * @param {Record<string, import("./query.js").FrontendModelTransportValue>} broadcastParams - Params from `broadcastToChannel`.
     * @returns {boolean} Whether the broadcast matches this subscriber's model.
     */
    matches(broadcastParams) {
        return broadcastParams?.model === this._modelName();
    }
    /**
     * Runs debug snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Debug-safe subscription details.
     */
    debugSnapshot() {
        const eventFilters = this._eventFilters();
        return {
            abilities: this.params.abilities !== undefined,
            eventFilterCount: eventFilters.length,
            destroyEventDelivery: this.params.destroyEventDelivery === true,
            model: this._modelName(),
            preload: this.params.preload !== undefined,
            queryData: this.params.queryData !== undefined,
            select: this.params.select !== undefined,
            selectsExtra: this.params.selectsExtra !== undefined,
            unfilteredEventDelivery: this.params.unfilteredEventDelivery === true,
            withCount: this.params.withCount !== undefined
        };
    }
    /**
     * Runs model name.
     * @returns {string | null} - Requested frontend-model name or null.
     */
    _modelName() {
        return typeof this.params?.model === "string" && this.params.model.length > 0
            ? this.params.model
            : null;
    }
    /**
     * Runs has projection params.
     * @returns {boolean} - Whether this subscription requested per-event record projection.
     */
    _hasProjectionParams() {
        return this.params.select !== undefined
            || this.params.selectsExtra !== undefined
            || this.params.preload !== undefined
            || this.params.withCount !== undefined
            || this.params.abilities !== undefined
            || this.params.queryData !== undefined;
    }
    /**
     * Runs has event filter params.
     * @returns {boolean} - Whether this subscription requested event query filters.
     */
    _hasEventFilterParams() {
        return this._eventFilters().length > 0;
    }
    /**
     * Runs has unfiltered event delivery.
     * @returns {boolean} - Whether unfiltered callbacks should receive every event.
     */
    _hasUnfilteredEventDelivery() {
        return this.params.unfilteredEventDelivery === true;
    }
    /**
     * Runs has destroy event delivery.
     * @returns {boolean} - Whether id-only destroy events should be delivered with event filters.
     */
    _hasDestroyEventDelivery() {
        return this.params.destroyEventDelivery === true;
    }
    /**
     * Runs event filters.
     * @returns {import("./query.js").FrontendModelEventFilterPayloadEntry[]} - Valid event filters.
     */
    _eventFilters() {
        if (this.params.eventFilters === undefined)
            return [];
        if (!Array.isArray(this.params.eventFilters)) {
            throw new Error("Frontend model eventFilters must be an array");
        }
        return this.params.eventFilters.map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                throw new Error("Frontend model eventFilters entries must be objects");
            }
            const eventFilter = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (entry);
            const unknownKeys = Object.keys(eventFilter).filter((key) => !EVENT_FILTER_KEYS.has(key));
            if (unknownKeys.length > 0) {
                throw new Error(`Frontend model eventFilters entries cannot include ${unknownKeys.join(", ")}`);
            }
            if (typeof eventFilter.key !== "string" || eventFilter.key.length === 0) {
                throw new Error("Frontend model eventFilters entries require a key");
            }
            /**
             * Sanitized event filter.
             * @type {import("./query.js").FrontendModelEventFilterPayloadEntry} */
            const sanitizedEventFilter = { key: eventFilter.key };
            if (eventFilter.joins !== undefined) {
                sanitizedEventFilter.joins = /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (eventFilter.joins);
            }
            if (eventFilter.searches !== undefined) {
                sanitizedEventFilter.searches = /** @type {import("./query.js").FrontendModelSearch[]} */ (eventFilter.searches);
            }
            if (eventFilter.where !== undefined) {
                sanitizedEventFilter.where = /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (eventFilter.where);
            }
            return sanitizedEventFilter;
        });
    }
    /**
     * Runs frontend model controller class.
     * @returns {Promise<typeof import("../frontend-model-controller.js").default>} - Frontend model controller class.
     */
    async _frontendModelControllerClass() {
        const frontendModelControllerPath = "../frontend-model-controller.js";
        const { default: FrontendModelController } = await import(frontendModelControllerPath);
        return FrontendModelController;
    }
    /**
     * Runs frontend model controller.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [params] - Optional params override.
     * @returns {import("../frontend-model-controller.js").default} - Synthetic controller used for resource serialization.
     */
    _frontendModelController(FrontendModelController, params = {}) {
        const configuration = this.session.configuration;
        const controller = new FrontendModelController({
            action: "websocketEvent",
            configuration,
            controller: "frontend-models",
            params: {
                abilities: this.params.abilities,
                joins: this.params.joins,
                model: this._modelName(),
                preload: this.params.preload,
                queryData: this.params.queryData,
                searches: this.params.searches,
                select: this.params.select,
                selectsExtra: this.params.selectsExtra,
                where: this.params.where,
                ...params,
                withCount: this.params.withCount
            },
            request: /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
            response: new Response({ configuration }),
            viewPath: "/"
        });
        controller._frontendModelAbilityOverride = this._ability || undefined;
        return controller;
    }
    /**
     * Resolves tenant for event.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolved tenant.
     */
    async _resolveEventTenant(id) {
        const configuration = this.session.configuration;
        return await configuration.ensureConnections({ name: "Frontend model websocket event tenant resolution" }, async () => {
            // Mirror the subscribe-time tenant resolution (`WebsocketSession._resolveTenant`):
            // pass `subscription: {channel, params}` so resolvers that derive scope from the
            // subscription behave the same for broadcasts as they did at `channel-subscribe`.
            // The synthetic request forwards the subscriber's params (e.g. authenticationToken),
            // matching this channel's ability resolution above.
            return await configuration.resolveTenant({
                params: { ...this.params, id, model: this._modelName() },
                request: /** @type {import("../http-server/client/request.js").default} */ (this._syntheticRequest()),
                response: new Response({ configuration }),
                subscription: { channel: FRONTEND_MODELS_CHANNEL_NAME, params: this.params }
            });
        });
    }
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
    async _withEventTenant(id, callback) {
        const configuration = this.session.configuration;
        if (!configuration || typeof configuration.resolveTenant !== "function") {
            return await callback();
        }
        const tenant = await this._resolveEventTenant(id);
        // Always enter `runWithTenant`, even when no tenant resolved. Broadcast fan-out
        // runs in the publisher's ambient tenant context; falling back to `callback()`
        // there would authorize a cross-tenant record against the publisher's tenant and
        // could leak it to a subscriber whose own resolver could not resolve it.
        return await configuration.runWithTenant(tenant, async () => {
            return await configuration.ensureConnections({ name: "Frontend model websocket event tenant" }, callback);
        });
    }
    /**
     * Whether the broadcast record is within the subscriber's authenticated ability scope. Used to gate
     * unfiltered/unprojected create/update delivery so a scoped token never receives a record it cannot read.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<boolean>} True when the record is readable by this subscription.
     */
    async _eventIsAccessible(id, FrontendModelController) {
        return await this._withEventTenant(id, async () => {
            const controller = this._frontendModelController(FrontendModelController);
            await controller.ensureFrontendModelClassInitialized();
            const ModelClass = controller.frontendModelClass();
            const primaryKey = controller.frontendModelPrimaryKey();
            const query = controller.frontendModelAuthorizedQuery("find").where({ [ModelClass.tableName()]: modelPrimaryKeyConditions(primaryKey, id) });
            return Boolean(await query.first());
        });
    }
    /**
     * Runs matched event filter keys for event id.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<string[]>} - Event filter keys matched by the record.
     */
    async _matchedEventFilterKeysForEventId(id, FrontendModelController) {
        /**
         * Matched event filter keys.
         * @type {string[]} */
        const matchedEventFilterKeys = [];
        for (const eventFilter of this._eventFilters()) {
            const matches = await this._eventMatchesFilter({
                FrontendModelController,
                eventFilter,
                id
            });
            if (matches)
                matchedEventFilterKeys.push(eventFilter.key);
        }
        return matchedEventFilterKeys;
    }
    /**
     * Runs event matches filter.
     * @param {object} args - Filter args.
     * @param {typeof import("../frontend-model-controller.js").default} args.FrontendModelController - Server-side frontend-model controller class.
     * @param {import("./query.js").FrontendModelEventFilterPayloadEntry} args.eventFilter - Event filter payload.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Event record id.
     * @returns {Promise<boolean>} Whether the record matches the filter.
     */
    async _eventMatchesFilter({ FrontendModelController, eventFilter, id }) {
        return await this._withEventTenant(id, async () => {
            const controller = this._frontendModelController(FrontendModelController, {
                joins: eventFilter.joins,
                searches: eventFilter.searches,
                where: eventFilter.where
            });
            await controller.ensureFrontendModelClassInitialized();
            const ModelClass = controller.frontendModelClass();
            const primaryKey = controller.frontendModelPrimaryKey();
            const where = controller.frontendModelWhere();
            const joins = controller.frontendModelJoins();
            // Start from the subscriber's authorized scope so a filter can only ever match records the
            // subscription's ability permits to read.
            let query = controller.frontendModelAuthorizedQuery("find").where({ [ModelClass.tableName()]: modelPrimaryKeyConditions(primaryKey, id) });
            if (where)
                controller.applyFrontendModelWhere({ query, where });
            if (joins)
                controller.applyFrontendModelJoins({ joins, query });
            for (const search of controller.frontendModelSearches()) {
                controller.applyFrontendModelSearch({ query, search });
            }
            return Boolean(await query.first());
        });
    }
    /**
     * Runs projected record for event id.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>} - Serialized projected record.
     */
    async _projectedRecordForEventId(id, FrontendModelController) {
        return await this._withEventTenant(id, async () => {
            const controller = this._frontendModelController(FrontendModelController);
            await controller.ensureFrontendModelClassInitialized();
            const ModelClass = controller.frontendModelClass();
            const primaryKey = controller.frontendModelPrimaryKey();
            // Reload through the subscriber's authorized scope so projected records are only ever sent for
            // rows the subscription's ability permits to read.
            let query = controller.frontendModelAuthorizedQuery("find").where({ [ModelClass.tableName()]: modelPrimaryKeyConditions(primaryKey, id) });
            const preload = controller.frontendModelPreload();
            if (preload)
                query = query.preload(preload);
            for (const entry of controller.frontendModelWithCount()) {
                /**
                 * Spec.
                 * @type {Record<string, boolean | {relationship?: string, where?: Record<string, import("./query.js").FrontendModelTransportValue>}>} */
                const spec = {};
                spec[entry.attributeName] = {
                    relationship: entry.relationshipName,
                    where: entry.where ? /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (entry.where) : undefined
                };
                query.withCount(spec);
            }
            const queryData = controller.frontendModelQueryData();
            if (queryData !== null)
                query.queryData(queryData);
            query = controller.applyFrontendModelTranslatedAttributePreloads({ query });
            const model = await query.first();
            if (!model)
                return null;
            if (this.params.abilities !== undefined) {
                await controller.frontendModelComputeAbilities([model]);
            }
            controller._frontendModelAbilityOverride = undefined;
            return await controller.frontendModelResourceInstance().serialize(model, "find");
        });
    }
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
    _syntheticRequest() {
        const upgradeRequest = /** @type {FrontendModelWebsocketUpgradeRequest} */ (this.session.upgradeRequest);
        const rawHeaders = typeof upgradeRequest?.headers === "function" ? upgradeRequest.headers() : {};
        const metadata = typeof this.session.getMetadata === "function" ? this.session.getMetadata() : {};
        const remoteAddress = typeof upgradeRequest?.remoteAddress === "function" ? upgradeRequest.remoteAddress() : undefined;
        /**
         * Header map.
         * @type {Record<string, string | string[] | undefined>} */
        const headerMap = {};
        for (const key of Object.keys(rawHeaders || {})) {
            headerMap[key.toLowerCase()] = rawHeaders[key];
        }
        return {
            headers: () => headerMap,
            header: (name) => headerMap[String(name).toLowerCase()],
            metadata: (key) => key === undefined ? { ...metadata } : metadata[key],
            path: () => "/frontend-models",
            httpMethod: () => "POST",
            remoteAddress: () => remoteAddress,
            origin: () => headerMap.origin
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sUUFBUSxNQUFNLG1DQUFtQyxDQUFBO0FBQ3hELE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRXZFOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO0FBRXhFLHFGQUFxRjtBQUNyRiwyRUFBMkU7QUFDM0UsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUV0RDs7OztHQUlHO0FBQ0gsU0FBUyw2Q0FBNkMsQ0FBQyxhQUFhO0lBQ2xFLE9BQU87UUFDTCxRQUFRLEVBQUUsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQztLQUMzRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDZCQUE4QixTQUFRLHlCQUF5QjtJQUNsRjs7c0VBRWtFO0lBQ2xFLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFFZjs7O09BR0c7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFbkMsSUFBSSxDQUFDLFNBQVM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUM1QixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7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QUM5QixVQUFVLEVBQUUsR0FBRyxFQUFFLENBQUMsTUFBTTtZQUN4QixhQUFhLEVBQUUsR0FBRyxFQUFFLENBQUMsYUFBYTtZQUNsQyxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU07U0FDL0IsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCBmcm9tIFwiLi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9uc30gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YWN0aW9uPzogc3RyaW5nLCBpZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzPzogc3RyaW5nW10sIHJlY29yZD86IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHlcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aGVhZGVycz86ICgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPiwgcmVtb3RlQWRkcmVzcz86ICgpID0+IHN0cmluZyB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRVcGdyYWRlUmVxdWVzdFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3toZWFkZXJzOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD4sIGhlYWRlcjogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQsIG1ldGFkYXRhOiAoa2V5Pzogc3RyaW5nKSA9PiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4gfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IHVuZGVmaW5lZCwgcGF0aDogKCkgPT4gc3RyaW5nLCBodHRwTWV0aG9kOiAoKSA9PiBzdHJpbmcsIHJlbW90ZUFkZHJlc3M6ICgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCwgb3JpZ2luOiAoKSA9PiBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRTeW50aGV0aWNSZXF1ZXN0XG4gKi9cbmNvbnN0IEVWRU5UX0ZJTFRFUl9LRVlTID0gbmV3IFNldChbXCJqb2luc1wiLCBcImtleVwiLCBcInNlYXJjaGVzXCIsIFwid2hlcmVcIl0pXG5cbi8vIE1pcnJvcnMgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSBpbiAuL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzLCBkdXBsaWNhdGVkIGhlcmVcbi8vIHRvIGF2b2lkIHRoZSBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIg4oaSIHdlYnNvY2tldC1wdWJsaXNoZXJzIGltcG9ydCBjeWNsZS5cbmNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBQZXItc2Vzc2lvbiBjaGFubmVsIHN1YnNjcmlwdGlvbiBmb3IgZnJvbnRlbmQtbW9kZWwgbGlmZWN5Y2xlIGV2ZW50cy5cbiAqIFJlcGxhY2VzIHRoZSBsZWdhY3kgYEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsYCAoUGhhc2UgMykuXG4gKlxuICogQXV0aCBtb2RlbDogc3Vic2NyaWJlLXRpbWUgb25seS4gYGNhblN1YnNjcmliZWAgcmVzb2x2ZXMgdGhlIGNhbGxlcidzXG4gKiBhYmlsaXR5IG9uY2UsIGNoZWNrcyB0aGF0IGF0IGxlYXN0IG9uZSBgYWxsb3dgIHJ1bGUgZXhpc3RzIGZvclxuICogYHJlYWRgIG9uIHRoZSByZXF1ZXN0ZWQgbW9kZWwgY2xhc3MsIGFuZCB0aGVuIGRlbGl2ZXJzIGZ1dHVyZVxuICogbGlmZWN5Y2xlIGJyb2FkY2FzdHMgZm9yIHRoYXQgbW9kZWwgd2l0aG91dCByZS1hdXRob3JpemluZyBwZXIgZXZlbnQuXG4gKiBUaGlzIG1hdGNoZXMgdGhlIGV4cGxpY2l0IGRlc2lnbiBkZWNpc2lvbiBpbiBQaGFzZSAzIHRvIHRyYWRlXG4gKiBwZXItcmVjb3JkIHZpc2liaWxpdHkgZ3VhcmFudGVlcyBmb3IgbWFzc2l2ZWx5IGNoZWFwZXIgYnJvYWRjYXN0IGZhbi1vdXQuXG4gKiBTdWJzY3JpYmVyLXByb3ZpZGVkIGV2ZW50IGZpbHRlcnMgY2FuIHN0aWxsIG5hcnJvdyB3aGljaCBjcmVhdGUvdXBkYXRlXG4gKiBldmVudHMgYXJlIGRlbGl2ZXJlZCwgYnV0IHRoZXkgYXJlIG1hdGNoaW5nIHByZWRpY2F0ZXMgcmF0aGVyIHRoYW5cbiAqIHBlci1yZWNvcmQgYXV0aG9yaXphdGlvbiBjaGVja3MuXG4gKlxuICogV2lyZTogc3Vic2NyaWJlIHdpdGggYHN1YnNjcmliZUNoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge3BhcmFtczoge21vZGVsOiBNb2RlbE5hbWV9fSlgLlxuICogQmFja2VuZCBwdWJsaXNoZXMgYHthY3Rpb24sIGlkLCByZWNvcmR9YCB2aWFcbiAqIGBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7bW9kZWw6IE1vZGVsTmFtZX0sIGJvZHkpYDtcbiAqIGBtYXRjaGVzKClgIHJvdXRlcyBieSBtb2RlbCBuYW1lLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbCBleHRlbmRzIFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwge1xuICAvKipcbiAgICogQWJpbGl0eS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgX2FiaWxpdHkgPSBudWxsXG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FuIHN1YnNjcmliZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGZyb250ZW5kLW1vZGVsIHN1YnNjcmlwdGlvbiBpcyBhdXRob3JpemVkLlxuICAgKi9cbiAgYXN5bmMgY2FuU3Vic2NyaWJlKCkge1xuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHRoaXMuX21vZGVsTmFtZSgpXG5cbiAgICBpZiAoIW1vZGVsTmFtZSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fZXZlbnRGaWx0ZXJzKClcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCBNb2RlbENsYXNzID0gbW9kZWxDbGFzc2VzW21vZGVsTmFtZV1cblxuICAgIGlmICghTW9kZWxDbGFzcykgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCByZXF1ZXN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKVxuICAgIGNvbnN0IGFiaWxpdHkgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVBYmlsaXR5KHtcbiAgICAgIC8vIEZvcndhcmQgdGhlIHN1YnNjcmliZXIncyBwYXJhbXMgKGUuZy4gYXV0aGVudGljYXRpb25Ub2tlbikgc28gdG9rZW4tYXV0aGVudGljYXRlZCBjbGllbnRzXG4gICAgICAvLyByZXNvbHZlIHRoZSBzYW1lIGFiaWxpdHkgdGhleSB3b3VsZCBvdmVyIEhUVFAuIFdpdGhvdXQgdGhpcyBvbmx5IHNlc3Npb24vY29va2llIGF1dGggb24gdGhlXG4gICAgICAvLyB1cGdyYWRlIHJlcXVlc3Qgd29ya3MsIGFuZCBwYXJhbS1iYXNlZCBhdXRoIChsaWtlIGEgc2Nhbm5lciBwYXNzaW5nIGFuIGF1dGhlbnRpY2F0aW9uVG9rZW4pXG4gICAgICAvLyBpcyBkcm9wcGVkIOKAlCBsZWF2aW5nIHN1Y2ggc3Vic2NyaWJlcnMgd2l0aCBhIGd1ZXN0IGFiaWxpdHkgYW5kIG5vIHJlYWQgcnVsZS5cbiAgICAgIHBhcmFtczogey4uLnRoaXMucGFyYW1zLCBtb2RlbDogbW9kZWxOYW1lfSxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSlcbiAgICB9KVxuXG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9hYmlsaXR5ID0gYWJpbGl0eVxuXG4gICAgLy8gTG9hZCByZXNvdXJjZS1kZWNsYXJlZCBydWxlcyBmb3IgdGhpcyBtb2RlbCBjbGFzcyBiZWZvcmUgY2hlY2tpbmcsXG4gICAgLy8gb3RoZXJ3aXNlIGBydWxlc0ZvcmAgcmV0dXJucyBlbXB0eSBmb3IgYWJpbGl0aWVzIHdob3NlIHJlc291cmNlc1xuICAgIC8vIHJlZ2lzdGVyIHJ1bGVzIGxhemlseSB2aWEgYGFiaWxpdGllcygpYC5cbiAgICBhYmlsaXR5LmxvYWRBYmlsaXRpZXNGb3JNb2RlbENsYXNzKE1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCByZWFkUnVsZXMgPSBhYmlsaXR5LnJ1bGVzRm9yKHthY3Rpb246IFwicmVhZFwiLCBtb2RlbENsYXNzOiBNb2RlbENsYXNzfSlcblxuICAgIHJldHVybiByZWFkUnVsZXMuc29tZSgoLyoqIEB0eXBlIHt7ZWZmZWN0OiBzdHJpbmd9fSAqLyBydWxlKSA9PiBydWxlLmVmZmVjdCA9PT0gXCJhbGxvd1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt7ZXZlbnRJZD86IHN0cmluZ319IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBkZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpIHtcbiAgICBhd2FpdCB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge3tldmVudElkPzogc3RyaW5nfX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxpdmVyeS5cbiAgICovXG4gIGFzeW5jIF9kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpIHtcbiAgICBjb25zdCBoYXNFdmVudEZpbHRlcnMgPSB0aGlzLl9oYXNFdmVudEZpbHRlclBhcmFtcygpXG5cbiAgICBpZiAoIXRoaXMuX2hhc1Byb2plY3Rpb25QYXJhbXMoKSAmJiAhaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICAvLyBFdmVuIHVuZmlsdGVyZWQgc3Vic2NyaXB0aW9ucyBtdXN0IHJlc3BlY3QgdGhlIHN1YnNjcmliZXIncyBhYmlsaXR5LiBBIGNyZWF0ZS91cGRhdGUgY2Fycmllc1xuICAgICAgLy8gdGhlIHJlY29yZCwgc28gb25seSBkZWxpdmVyIGl0IHdoZW4gdGhlIHJlY29yZCBpcyB3aXRoaW4gdGhlIGF1dGhlbnRpY2F0ZWQgYWJpbGl0eSdzIHNjb3BlLlxuICAgICAgLy8gRGVzdHJveXMgKGFuZCBib2RpZXMgd2l0aG91dCBhIHVzYWJsZSBpZCkgY2Fycnkgbm8gcmVjb3JkLCBzbyBwYXNzIHRoZW0gdGhyb3VnaCB1bmNoYW5nZWQuXG4gICAgICBpZiAoYm9keSAmJiB0eXBlb2YgYm9keSA9PT0gXCJvYmplY3RcIiAmJiAoYm9keS5hY3Rpb24gPT09IFwiY3JlYXRlXCIgfHwgYm9keS5hY3Rpb24gPT09IFwidXBkYXRlXCIpICYmIGJvZHkuaWQgIT09IHVuZGVmaW5lZCAmJiBib2R5LmlkICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IEZyb250ZW5kTW9kZWxDb250cm9sbGVyID0gYXdhaXQgdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpXG5cbiAgICAgICAgaWYgKCFhd2FpdCB0aGlzLl9ldmVudElzQWNjZXNzaWJsZShib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikpIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5KCkgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGJvZHkuaWQgPT09IHVuZGVmaW5lZCB8fCBib2R5LmlkID09PSBudWxsKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBhd2FpdCB0aGlzLl9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgIGlmIChoYXNFdmVudEZpbHRlcnMgJiYgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5sZW5ndGggPT09IDAgJiYgIXRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGl2ZXIgYm9keS5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9ICovXG4gICAgbGV0IGRlbGl2ZXJCb2R5ID0gYm9keVxuXG4gICAgaWYgKHRoaXMuX2hhc1Byb2plY3Rpb25QYXJhbXMoKSkge1xuICAgICAgY29uc3QgcHJvamVjdGVkUmVjb3JkID0gYXdhaXQgdGhpcy5fcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgaWYgKCFwcm9qZWN0ZWRSZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgaGFzIG5vIGNvbmZpZ3VyYXRpb24gZm9yIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uXCIpXG4gICAgICB9XG5cbiAgICAgIGRlbGl2ZXJCb2R5ID0ge1xuICAgICAgICAuLi5kZWxpdmVyQm9keSxcbiAgICAgICAgcmVjb3JkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByb2plY3RlZFJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnNlbmRNZXNzYWdlKGRlbGl2ZXJCb2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IGJyb2FkY2FzdFBhcmFtcyAtIFBhcmFtcyBmcm9tIGBicm9hZGNhc3RUb0NoYW5uZWxgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgYnJvYWRjYXN0IG1hdGNoZXMgdGhpcyBzdWJzY3JpYmVyJ3MgbW9kZWwuXG4gICAqL1xuICBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcykge1xuICAgIHJldHVybiBicm9hZGNhc3RQYXJhbXM/Lm1vZGVsID09PSB0aGlzLl9tb2RlbE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0aWVzOiB0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCxcbiAgICAgIGV2ZW50RmlsdGVyQ291bnQ6IGV2ZW50RmlsdGVycy5sZW5ndGgsXG4gICAgICBkZXN0cm95RXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICBwcmVsb2FkOiB0aGlzLnBhcmFtcy5wcmVsb2FkICE9PSB1bmRlZmluZWQsXG4gICAgICBxdWVyeURhdGE6IHRoaXMucGFyYW1zLnF1ZXJ5RGF0YSAhPT0gdW5kZWZpbmVkLFxuICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWQsXG4gICAgICB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICB3aXRoQ291bnQ6IHRoaXMucGFyYW1zLndpdGhDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVxdWVzdGVkIGZyb250ZW5kLW1vZGVsIG5hbWUgb3IgbnVsbC5cbiAgICovXG4gIF9tb2RlbE5hbWUoKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGlzLnBhcmFtcz8ubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5wYXJhbXMubW9kZWwubGVuZ3RoID4gMFxuICAgICAgPyB0aGlzLnBhcmFtcy5tb2RlbFxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgcHJvamVjdGlvbiBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBzdWJzY3JpcHRpb24gcmVxdWVzdGVkIHBlci1ldmVudCByZWNvcmQgcHJvamVjdGlvbi5cbiAgICovXG4gIF9oYXNQcm9qZWN0aW9uUGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy5zZWxlY3QgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLnByZWxvYWQgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgdGhpcy5wYXJhbXMud2l0aENvdW50ICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCB0aGlzLnBhcmFtcy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGV2ZW50IGZpbHRlciBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBzdWJzY3JpcHRpb24gcmVxdWVzdGVkIGV2ZW50IHF1ZXJ5IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRXZlbnRGaWx0ZXJQYXJhbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2V2ZW50RmlsdGVycygpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB1bmZpbHRlcmVkIGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHVuZmlsdGVyZWQgY2FsbGJhY2tzIHNob3VsZCByZWNlaXZlIGV2ZXJ5IGV2ZW50LlxuICAgKi9cbiAgX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy51bmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGRlc3Ryb3kgZXZlbnQgZGVsaXZlcnkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaWQtb25seSBkZXN0cm95IGV2ZW50cyBzaG91bGQgYmUgZGVsaXZlcmVkIHdpdGggZXZlbnQgZmlsdGVycy5cbiAgICovXG4gIF9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZW50IGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdfSAtIFZhbGlkIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfZXZlbnRGaWx0ZXJzKCkge1xuICAgIGlmICh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyBtdXN0IGJlIG9iamVjdHNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXZlbnRGaWx0ZXIgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KVxuICAgICAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhldmVudEZpbHRlcikuZmlsdGVyKChrZXkpID0+ICFFVkVOVF9GSUxURVJfS0VZUy5oYXMoa2V5KSlcblxuICAgICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyBjYW5ub3QgaW5jbHVkZSAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX1gKVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIGV2ZW50RmlsdGVyLmtleSAhPT0gXCJzdHJpbmdcIiB8fCBldmVudEZpbHRlci5rZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIHJlcXVpcmUgYSBrZXlcIilcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBTYW5pdGl6ZWQgZXZlbnQgZmlsdGVyLlxuICAgICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5fSAqL1xuICAgICAgY29uc3Qgc2FuaXRpemVkRXZlbnRGaWx0ZXIgPSB7a2V5OiBldmVudEZpbHRlci5rZXl9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5qb2lucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLmpvaW5zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChldmVudEZpbHRlci5qb2lucylcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLnNlYXJjaGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIuc2VhcmNoZXMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAqLyAoZXZlbnRGaWx0ZXIuc2VhcmNoZXMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci53aGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLndoZXJlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChldmVudEZpbHRlci53aGVyZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHNhbml0aXplZEV2ZW50RmlsdGVyXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHQ+fSAtIEZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqL1xuICBhc3luYyBfZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsQ29udHJvbGxlclBhdGggPSBcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIlxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsQ29udHJvbGxlcn0gPSBhd2FpdCBpbXBvcnQoZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoKVxuXG4gICAgcmV0dXJuIEZyb250ZW5kTW9kZWxDb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAtIFN5bnRoZXRpYyBjb250cm9sbGVyIHVzZWQgZm9yIHJlc291cmNlIHNlcmlhbGl6YXRpb24uXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIHBhcmFtcyA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBGcm9udGVuZE1vZGVsQ29udHJvbGxlcih7XG4gICAgICBhY3Rpb246IFwid2Vic29ja2V0RXZlbnRcIixcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBjb250cm9sbGVyOiBcImZyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgcGFyYW1zOiB7XG4gICAgICAgIGFiaWxpdGllczogdGhpcy5wYXJhbXMuYWJpbGl0aWVzLFxuICAgICAgICBqb2luczogdGhpcy5wYXJhbXMuam9pbnMsXG4gICAgICAgIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKSxcbiAgICAgICAgcHJlbG9hZDogdGhpcy5wYXJhbXMucHJlbG9hZCxcbiAgICAgICAgcXVlcnlEYXRhOiB0aGlzLnBhcmFtcy5xdWVyeURhdGEsXG4gICAgICAgIHNlYXJjaGVzOiB0aGlzLnBhcmFtcy5zZWFyY2hlcyxcbiAgICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QsXG4gICAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhLFxuICAgICAgICB3aGVyZTogdGhpcy5wYXJhbXMud2hlcmUsXG4gICAgICAgIC4uLnBhcmFtcyxcbiAgICAgICAgd2l0aENvdW50OiB0aGlzLnBhcmFtcy53aXRoQ291bnRcbiAgICAgIH0sXG4gICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpLFxuICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pLFxuICAgICAgdmlld1BhdGg6IFwiL1wiXG4gICAgfSlcblxuICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB0aGlzLl9hYmlsaXR5IHx8IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIGNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0ZW5hbnQgZm9yIGV2ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIF9yZXNvbHZlRXZlbnRUZW5hbnQoaWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBldmVudCB0ZW5hbnQgcmVzb2x1dGlvblwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSBzdWJzY3JpYmUtdGltZSB0ZW5hbnQgcmVzb2x1dGlvbiAoYFdlYnNvY2tldFNlc3Npb24uX3Jlc29sdmVUZW5hbnRgKTpcbiAgICAgIC8vIHBhc3MgYHN1YnNjcmlwdGlvbjoge2NoYW5uZWwsIHBhcmFtc31gIHNvIHJlc29sdmVycyB0aGF0IGRlcml2ZSBzY29wZSBmcm9tIHRoZVxuICAgICAgLy8gc3Vic2NyaXB0aW9uIGJlaGF2ZSB0aGUgc2FtZSBmb3IgYnJvYWRjYXN0cyBhcyB0aGV5IGRpZCBhdCBgY2hhbm5lbC1zdWJzY3JpYmVgLlxuICAgICAgLy8gVGhlIHN5bnRoZXRpYyByZXF1ZXN0IGZvcndhcmRzIHRoZSBzdWJzY3JpYmVyJ3MgcGFyYW1zIChlLmcuIGF1dGhlbnRpY2F0aW9uVG9rZW4pLFxuICAgICAgLy8gbWF0Y2hpbmcgdGhpcyBjaGFubmVsJ3MgYWJpbGl0eSByZXNvbHV0aW9uIGFib3ZlLlxuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCh7XG4gICAgICAgIHBhcmFtczogey4uLnRoaXMucGFyYW1zLCBpZCwgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpfSxcbiAgICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pLFxuICAgICAgICBzdWJzY3JpcHRpb246IHtjaGFubmVsOiBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBwYXJhbXM6IHRoaXMucGFyYW1zfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzdWJzY3JpYmVyJ3MgdGVuYW50IGZvciB0aGUgYnJvYWRjYXN0IHJlY29yZCBhbmQgcnVucyBgY2FsbGJhY2tgIGluc2lkZSB0aGF0IHRlbmFudFxuICAgKiBjb250ZXh0LiBCcm9hZGNhc3QgZGVsaXZlcnkgcnVucyBpbiB3aGF0ZXZlciBhbWJpZW50IHRlbmFudCBjb250ZXh0IHRoZSBwdWJsaXNoZXIgbGVmdCBiZWhpbmQuIEZvclxuICAgKiBtdWx0aS10ZW5hbnQgcmVjb3JkcyB0aGF0IGFtYmllbnQgdGVuYW50IG1heSBoYXZlIGJlZW4gcmVzb2x2ZWQgd2l0aG91dCB0aGUgc3Vic2NyaWJlcidzIHJlcXVlc3RcbiAgICogKGUuZy4gYSByZWxheSBlbmRwb2ludCBvciBiYWNrZ3JvdW5kIGpvYiBtdXRhdGluZyB0aGUgcm93KSwgc28gaXQgbGFja3MgdGhlIHN1YnNjcmliZXIncyBwZXItcmVjb3JkXG4gICAqIGFjY2VzcyBmbGFncyBhbmQgdGhlIHBlci1ldmVudCBhdXRob3JpemF0aW9uIHF1ZXJ5IHdyb25nbHkgZmluZHMgbm90aGluZy4gUmUtcmVzb2x2aW5nIHRoZSB0ZW5hbnRcbiAgICogZnJvbSB0aGUgZXZlbnQgcmVjb3JkIGlkIHBsdXMgdGhlIHN1YnNjcmliZXIncyByZXF1ZXN0IG1ha2VzIHRoZSBhdXRob3JpemF0aW9uIHF1ZXJpZXMgcnVuIGFnYWluc3RcbiAgICogdGhlIHN1YnNjcmliZXIncyBvd24gdGVuYW50L2FiaWxpdHkgc2NvcGUuIFdoZW4gbm8gdGVuYW50IHJlc29sdmVzIChub24tbXVsdGl0ZW5hbnQgY29uZmlncyksIHRoZVxuICAgKiBjYWxsYmFjayBydW5zIGRpcmVjdGx5IHNvIHRoZSBhbWJpZW50IGNvbnRleHQgaXMgcHJlc2VydmVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF1dGhvcml6ZWQtcXVlcnkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRXZlbnRUZW5hbnQoaWQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24gfHwgdHlwZW9mIGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVFdmVudFRlbmFudChpZClcblxuICAgIC8vIEFsd2F5cyBlbnRlciBgcnVuV2l0aFRlbmFudGAsIGV2ZW4gd2hlbiBubyB0ZW5hbnQgcmVzb2x2ZWQuIEJyb2FkY2FzdCBmYW4tb3V0XG4gICAgLy8gcnVucyBpbiB0aGUgcHVibGlzaGVyJ3MgYW1iaWVudCB0ZW5hbnQgY29udGV4dDsgZmFsbGluZyBiYWNrIHRvIGBjYWxsYmFjaygpYFxuICAgIC8vIHRoZXJlIHdvdWxkIGF1dGhvcml6ZSBhIGNyb3NzLXRlbmFudCByZWNvcmQgYWdhaW5zdCB0aGUgcHVibGlzaGVyJ3MgdGVuYW50IGFuZFxuICAgIC8vIGNvdWxkIGxlYWsgaXQgdG8gYSBzdWJzY3JpYmVyIHdob3NlIG93biByZXNvbHZlciBjb3VsZCBub3QgcmVzb2x2ZSBpdC5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudFwifSwgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBicm9hZGNhc3QgcmVjb3JkIGlzIHdpdGhpbiB0aGUgc3Vic2NyaWJlcidzIGF1dGhlbnRpY2F0ZWQgYWJpbGl0eSBzY29wZS4gVXNlZCB0byBnYXRlXG4gICAqIHVuZmlsdGVyZWQvdW5wcm9qZWN0ZWQgY3JlYXRlL3VwZGF0ZSBkZWxpdmVyeSBzbyBhIHNjb3BlZCB0b2tlbiBuZXZlciByZWNlaXZlcyBhIHJlY29yZCBpdCBjYW5ub3QgcmVhZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gVHJ1ZSB3aGVuIHRoZSByZWNvcmQgaXMgcmVhZGFibGUgYnkgdGhpcyBzdWJzY3JpcHRpb24uXG4gICAqL1xuICBhc3luYyBfZXZlbnRJc0FjY2Vzc2libGUoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7W01vZGVsQ2xhc3MudGFibGVOYW1lKCldOiBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKX0pXG5cbiAgICAgIHJldHVybiBCb29sZWFuKGF3YWl0IHF1ZXJ5LmZpcnN0KCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMgZm9yIGV2ZW50IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBFdmVudCBmaWx0ZXIga2V5cyBtYXRjaGVkIGJ5IHRoZSByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c0ZvckV2ZW50SWQoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgLyoqXG4gICAgICogTWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGV2ZW50RmlsdGVyIG9mIHRoaXMuX2V2ZW50RmlsdGVycygpKSB7XG4gICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgdGhpcy5fZXZlbnRNYXRjaGVzRmlsdGVyKHtcbiAgICAgICAgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsXG4gICAgICAgIGV2ZW50RmlsdGVyLFxuICAgICAgICBpZFxuICAgICAgfSlcblxuICAgICAgaWYgKG1hdGNoZXMpIG1hdGNoZWRFdmVudEZpbHRlcktleXMucHVzaChldmVudEZpbHRlci5rZXkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZW50IG1hdGNoZXMgZmlsdGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZpbHRlciBhcmdzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MuRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5fSBhcmdzLmV2ZW50RmlsdGVyIC0gRXZlbnQgZmlsdGVyIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MuaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSByZWNvcmQgbWF0Y2hlcyB0aGUgZmlsdGVyLlxuICAgKi9cbiAgYXN5bmMgX2V2ZW50TWF0Y2hlc0ZpbHRlcih7RnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIGV2ZW50RmlsdGVyLCBpZH0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIHtcbiAgICAgICAgam9pbnM6IGV2ZW50RmlsdGVyLmpvaW5zLFxuICAgICAgICBzZWFyY2hlczogZXZlbnRGaWx0ZXIuc2VhcmNoZXMsXG4gICAgICAgIHdoZXJlOiBldmVudEZpbHRlci53aGVyZVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgICBjb25zdCB3aGVyZSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFdoZXJlKClcbiAgICAgIGNvbnN0IGpvaW5zID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsSm9pbnMoKVxuICAgICAgLy8gU3RhcnQgZnJvbSB0aGUgc3Vic2NyaWJlcidzIGF1dGhvcml6ZWQgc2NvcGUgc28gYSBmaWx0ZXIgY2FuIG9ubHkgZXZlciBtYXRjaCByZWNvcmRzIHRoZVxuICAgICAgLy8gc3Vic2NyaXB0aW9uJ3MgYWJpbGl0eSBwZXJtaXRzIHRvIHJlYWQuXG4gICAgICBsZXQgcXVlcnkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoXCJmaW5kXCIpLndoZXJlKHtbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpfSlcblxuICAgICAgaWYgKHdoZXJlKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgICAgaWYgKGpvaW5zKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuXG4gICAgICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxTZWFyY2hlcygpKSB7XG4gICAgICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJvamVjdGVkIHJlY29yZCBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgbnVsbD59IC0gU2VyaWFsaXplZCBwcm9qZWN0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIC8vIFJlbG9hZCB0aHJvdWdoIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBwcm9qZWN0ZWQgcmVjb3JkcyBhcmUgb25seSBldmVyIHNlbnQgZm9yXG4gICAgICAvLyByb3dzIHRoZSBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1tNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBpZCl9KVxuICAgICAgY29uc3QgcHJlbG9hZCA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuXG4gICAgICBpZiAocHJlbG9hZCkgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHByZWxvYWQpXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2l0aENvdW50KCkpIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNwZWMuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59Pn0gKi9cbiAgICAgICAgY29uc3Qgc3BlYyA9IHt9XG5cbiAgICAgICAgc3BlY1tlbnRyeS5hdHRyaWJ1dGVOYW1lXSA9IHtcbiAgICAgICAgICByZWxhdGlvbnNoaXA6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChlbnRyeS53aGVyZSkgOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBxdWVyeS53aXRoQ291bnQoc3BlYylcbiAgICAgIH1cblxuICAgICAgY29uc3QgcXVlcnlEYXRhID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUXVlcnlEYXRhKClcblxuICAgICAgaWYgKHF1ZXJ5RGF0YSAhPT0gbnVsbCkgcXVlcnkucXVlcnlEYXRhKHF1ZXJ5RGF0YSlcblxuICAgICAgcXVlcnkgPSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgICAgaWYgKCFtb2RlbCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENvbXB1dGVBYmlsaXRpZXMoW21vZGVsXSlcbiAgICAgIH1cblxuICAgICAgY29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHVuZGVmaW5lZFxuXG4gICAgICByZXR1cm4gYXdhaXQgY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnNlcmlhbGl6ZShtb2RlbCwgXCJmaW5kXCIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNaW5pbWFsIFJlcXVlc3QtbGlrZSBzdHViIHVzZWQgb25seSBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLiBBdm9pZHNcbiAgICogaW1wb3J0aW5nIGBXZWJzb2NrZXRSZXF1ZXN0YCBoZXJlIGJlY2F1c2UgaXRzIGBub2RlOnF1ZXJ5c3RyaW5nYFxuICAgKiBkZXBlbmRlbmN5IHdvdWxkIHB1bGwgc2VydmVyLW9ubHkgY29kZSBpbnRvIGJyb3dzZXIgYnVuZGxlcyB2aWFcbiAgICogdGhlIGBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIg4oaSIHdlYnNvY2tldC1wdWJsaXNoZXJzYCBpbXBvcnQgY2hhaW4uXG4gICAqIEhlYWRlciBuYW1lcyBhcmUgbm9ybWFsaXplZCB0byBsb3dlcmNhc2Ugc28gYGhlYWRlcihcImNvb2tpZVwiKWBcbiAgICogZmluZHMgYSB2YWx1ZSByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhlIHVwZ3JhZGUtcmVxdWVzdCBoZWFkZXJzXG4gICAqIG1hcCB1c2VzIGBcIkNvb2tpZVwiYCBvciBgXCJjb29raWVcImAuIFNlc3Npb24gbWV0YWRhdGEgc3RheXMgc2VwYXJhdGVcbiAgICogZnJvbSBoZWFkZXJzIGFuZCBpcyBleHBvc2VkIHRocm91Z2ggYG1ldGFkYXRhKC4uLilgIGZvciBhYmlsaXR5XG4gICAqIHJlc29sdmVycyB0aGF0IG5lZWQgd2Vic29ja2V0LWRlbGl2ZXJlZCBzZXNzaW9uIGRhdGEuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdH0gUmVxdWVzdC1saWtlIG9iamVjdCBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLlxuICAgKi9cbiAgX3N5bnRoZXRpY1JlcXVlc3QoKSB7XG4gICAgY29uc3QgdXBncmFkZVJlcXVlc3QgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRVcGdyYWRlUmVxdWVzdH0gKi8gKHRoaXMuc2Vzc2lvbi51cGdyYWRlUmVxdWVzdClcbiAgICBjb25zdCByYXdIZWFkZXJzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5oZWFkZXJzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5oZWFkZXJzKCkgOiB7fVxuICAgIGNvbnN0IG1ldGFkYXRhID0gdHlwZW9mIHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5zZXNzaW9uLmdldE1ldGFkYXRhKCkgOiB7fVxuICAgIGNvbnN0IHJlbW90ZUFkZHJlc3MgPSB0eXBlb2YgdXBncmFkZVJlcXVlc3Q/LnJlbW90ZUFkZHJlc3MgPT09IFwiZnVuY3Rpb25cIiA/IHVwZ3JhZGVSZXF1ZXN0LnJlbW90ZUFkZHJlc3MoKSA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEhlYWRlciBtYXAuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPn0gKi9cbiAgICBjb25zdCBoZWFkZXJNYXAgPSB7fVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmF3SGVhZGVycyB8fCB7fSkpIHtcbiAgICAgIGhlYWRlck1hcFtrZXkudG9Mb3dlckNhc2UoKV0gPSByYXdIZWFkZXJzW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaGVhZGVyczogKCkgPT4gaGVhZGVyTWFwLFxuICAgICAgaGVhZGVyOiAobmFtZSkgPT4gaGVhZGVyTWFwW1N0cmluZyhuYW1lKS50b0xvd2VyQ2FzZSgpXSxcbiAgICAgIG1ldGFkYXRhOiAoa2V5KSA9PiBrZXkgPT09IHVuZGVmaW5lZCA/IHsuLi5tZXRhZGF0YX0gOiBtZXRhZGF0YVtrZXldLFxuICAgICAgcGF0aDogKCkgPT4gXCIvZnJvbnRlbmQtbW9kZWxzXCIsXG4gICAgICBodHRwTWV0aG9kOiAoKSA9PiBcIlBPU1RcIixcbiAgICAgIHJlbW90ZUFkZHJlc3M6ICgpID0+IHJlbW90ZUFkZHJlc3MsXG4gICAgICBvcmlnaW46ICgpID0+IGhlYWRlck1hcC5vcmlnaW5cbiAgICB9XG4gIH1cbn1cbiJdfQ==