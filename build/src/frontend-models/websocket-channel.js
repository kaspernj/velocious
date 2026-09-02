// @ts-check
import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
import Response from "../http-server/client/response.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
/**
 * Defines this typedef.
 * @typedef {{action?: string, id?: string | number, matchedEventFilterKeys?: string[], record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
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
     * @param {string | number} id - Event record id.
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
     * @param {string | number} id - Event record id.
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
     * @param {string | number} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<boolean>} True when the record is readable by this subscription.
     */
    async _eventIsAccessible(id, FrontendModelController) {
        return await this._withEventTenant(id, async () => {
            const controller = this._frontendModelController(FrontendModelController);
            await controller.ensureFrontendModelClassInitialized();
            const ModelClass = controller.frontendModelClass();
            const primaryKey = ModelClass.primaryKey();
            const query = controller.frontendModelAuthorizedQuery("find").where({ [ModelClass.tableName()]: { [primaryKey]: id } });
            return Boolean(await query.first());
        });
    }
    /**
     * Runs matched event filter keys for event id.
     * @param {string | number} id - Event record id.
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
     * @param {string | number} args.id - Event record id.
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
            const primaryKey = ModelClass.primaryKey();
            const where = controller.frontendModelWhere();
            const joins = controller.frontendModelJoins();
            // Start from the subscriber's authorized scope so a filter can only ever match records the
            // subscription's ability permits to read.
            let query = controller.frontendModelAuthorizedQuery("find").where({ [ModelClass.tableName()]: { [primaryKey]: id } });
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
     * @param {string | number} id - Event record id.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<Record<string, import("./query.js").FrontendModelTransportValue> | null>} - Serialized projected record.
     */
    async _projectedRecordForEventId(id, FrontendModelController) {
        return await this._withEventTenant(id, async () => {
            const controller = this._frontendModelController(FrontendModelController);
            await controller.ensureFrontendModelClassInitialized();
            const ModelClass = controller.frontendModelClass();
            const primaryKey = ModelClass.primaryKey();
            // Reload through the subscriber's authorized scope so projected records are only ever sent for
            // rows the subscription's ability permits to read.
            let query = controller.frontendModelAuthorizedQuery("find").where({ [ModelClass.tableName()]: { [primaryKey]: id } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sUUFBUSxNQUFNLG1DQUFtQyxDQUFBO0FBQ3hELE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBRWpGOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO0FBRXhFLHFGQUFxRjtBQUNyRiwyRUFBMkU7QUFDM0UsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUV0RDs7OztHQUlHO0FBQ0gsU0FBUyw2Q0FBNkMsQ0FBQyxhQUFhO0lBQ2xFLE9BQU87UUFDTCxRQUFRLEVBQUUsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQztLQUMzRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDZCQUE4QixTQUFRLHlCQUF5QjtJQUNsRjs7c0VBRWtFO0lBQ2xFLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFFZjs7O09BR0c7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFbkMsSUFBSSxDQUFDLFNBQVM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUM1QixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7UUFFcEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFh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QUFhLEVBQUUsR0FBRyxFQUFFLENBQUMsYUFBYTtZQUNsQyxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU07U0FDL0IsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCBmcm9tIFwiLi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIlxuaW1wb3J0IHtzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YWN0aW9uPzogc3RyaW5nLCBpZD86IHN0cmluZyB8IG51bWJlciwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cz86IHN0cmluZ1tdLCByZWNvcmQ/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgW2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM/OiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD4sIHJlbW90ZUFkZHJlc3M/OiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3RcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aGVhZGVyczogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCBoZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBtZXRhZGF0YTogKGtleT86IHN0cmluZykgPT4gUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCB1bmRlZmluZWQsIHBhdGg6ICgpID0+IHN0cmluZywgaHR0cE1ldGhvZDogKCkgPT4gc3RyaW5nLCByZW1vdGVBZGRyZXNzOiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQsIG9yaWdpbjogKCkgPT4gc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdFxuICovXG5jb25zdCBFVkVOVF9GSUxURVJfS0VZUyA9IG5ldyBTZXQoW1wiam9pbnNcIiwgXCJrZXlcIiwgXCJzZWFyY2hlc1wiLCBcIndoZXJlXCJdKVxuXG4vLyBNaXJyb3JzIEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgaW4gLi93ZWJzb2NrZXQtcHVibGlzaGVycy5qcywgZHVwbGljYXRlZCBoZXJlXG4vLyB0byBhdm9pZCB0aGUgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVycyBpbXBvcnQgY3ljbGUuXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUGVyLXNlc3Npb24gY2hhbm5lbCBzdWJzY3JpcHRpb24gZm9yIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBldmVudHMuXG4gKiBSZXBsYWNlcyB0aGUgbGVnYWN5IGBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbGAgKFBoYXNlIDMpLlxuICpcbiAqIEF1dGggbW9kZWw6IHN1YnNjcmliZS10aW1lIG9ubHkuIGBjYW5TdWJzY3JpYmVgIHJlc29sdmVzIHRoZSBjYWxsZXInc1xuICogYWJpbGl0eSBvbmNlLCBjaGVja3MgdGhhdCBhdCBsZWFzdCBvbmUgYGFsbG93YCBydWxlIGV4aXN0cyBmb3JcbiAqIGByZWFkYCBvbiB0aGUgcmVxdWVzdGVkIG1vZGVsIGNsYXNzLCBhbmQgdGhlbiBkZWxpdmVycyBmdXR1cmVcbiAqIGxpZmVjeWNsZSBicm9hZGNhc3RzIGZvciB0aGF0IG1vZGVsIHdpdGhvdXQgcmUtYXV0aG9yaXppbmcgcGVyIGV2ZW50LlxuICogVGhpcyBtYXRjaGVzIHRoZSBleHBsaWNpdCBkZXNpZ24gZGVjaXNpb24gaW4gUGhhc2UgMyB0byB0cmFkZVxuICogcGVyLXJlY29yZCB2aXNpYmlsaXR5IGd1YXJhbnRlZXMgZm9yIG1hc3NpdmVseSBjaGVhcGVyIGJyb2FkY2FzdCBmYW4tb3V0LlxuICogU3Vic2NyaWJlci1wcm92aWRlZCBldmVudCBmaWx0ZXJzIGNhbiBzdGlsbCBuYXJyb3cgd2hpY2ggY3JlYXRlL3VwZGF0ZVxuICogZXZlbnRzIGFyZSBkZWxpdmVyZWQsIGJ1dCB0aGV5IGFyZSBtYXRjaGluZyBwcmVkaWNhdGVzIHJhdGhlciB0aGFuXG4gKiBwZXItcmVjb3JkIGF1dGhvcml6YXRpb24gY2hlY2tzLlxuICpcbiAqIFdpcmU6IHN1YnNjcmliZSB3aXRoIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbDogTW9kZWxOYW1lfX0pYC5cbiAqIEJhY2tlbmQgcHVibGlzaGVzIGB7YWN0aW9uLCBpZCwgcmVjb3JkfWAgdmlhXG4gKiBgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge21vZGVsOiBNb2RlbE5hbWV9LCBib2R5KWA7XG4gKiBgbWF0Y2hlcygpYCByb3V0ZXMgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwgZXh0ZW5kcyBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIHtcbiAgLyoqXG4gICAqIEFiaWxpdHkuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gIF9hYmlsaXR5ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbiBzdWJzY3JpYmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBmcm9udGVuZC1tb2RlbCBzdWJzY3JpcHRpb24gaXMgYXV0aG9yaXplZC5cbiAgICovXG4gIGFzeW5jIGNhblN1YnNjcmliZSgpIHtcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLl9tb2RlbE5hbWUoKVxuXG4gICAgaWYgKCFtb2RlbE5hbWUpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3Nlc1ttb2RlbE5hbWVdXG5cbiAgICBpZiAoIU1vZGVsQ2xhc3MpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSlcbiAgICBjb25zdCBhYmlsaXR5ID0gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlQWJpbGl0eSh7XG4gICAgICAvLyBGb3J3YXJkIHRoZSBzdWJzY3JpYmVyJ3MgcGFyYW1zIChlLmcuIGF1dGhlbnRpY2F0aW9uVG9rZW4pIHNvIHRva2VuLWF1dGhlbnRpY2F0ZWQgY2xpZW50c1xuICAgICAgLy8gcmVzb2x2ZSB0aGUgc2FtZSBhYmlsaXR5IHRoZXkgd291bGQgb3ZlciBIVFRQLiBXaXRob3V0IHRoaXMgb25seSBzZXNzaW9uL2Nvb2tpZSBhdXRoIG9uIHRoZVxuICAgICAgLy8gdXBncmFkZSByZXF1ZXN0IHdvcmtzLCBhbmQgcGFyYW0tYmFzZWQgYXV0aCAobGlrZSBhIHNjYW5uZXIgcGFzc2luZyBhbiBhdXRoZW50aWNhdGlvblRva2VuKVxuICAgICAgLy8gaXMgZHJvcHBlZCDigJQgbGVhdmluZyBzdWNoIHN1YnNjcmliZXJzIHdpdGggYSBndWVzdCBhYmlsaXR5IGFuZCBubyByZWFkIHJ1bGUuXG4gICAgICBwYXJhbXM6IHsuLi50aGlzLnBhcmFtcywgbW9kZWw6IG1vZGVsTmFtZX0sXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgfSlcblxuICAgIGlmICghYWJpbGl0eSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fYWJpbGl0eSA9IGFiaWxpdHlcblxuICAgIC8vIExvYWQgcmVzb3VyY2UtZGVjbGFyZWQgcnVsZXMgZm9yIHRoaXMgbW9kZWwgY2xhc3MgYmVmb3JlIGNoZWNraW5nLFxuICAgIC8vIG90aGVyd2lzZSBgcnVsZXNGb3JgIHJldHVybnMgZW1wdHkgZm9yIGFiaWxpdGllcyB3aG9zZSByZXNvdXJjZXNcbiAgICAvLyByZWdpc3RlciBydWxlcyBsYXppbHkgdmlhIGBhYmlsaXRpZXMoKWAuXG4gICAgYWJpbGl0eS5sb2FkQWJpbGl0aWVzRm9yTW9kZWxDbGFzcyhNb2RlbENsYXNzKVxuXG4gICAgY29uc3QgcmVhZFJ1bGVzID0gYWJpbGl0eS5ydWxlc0Zvcih7YWN0aW9uOiBcInJlYWRcIiwgbW9kZWxDbGFzczogTW9kZWxDbGFzc30pXG5cbiAgICByZXR1cm4gcmVhZFJ1bGVzLnNvbWUoKC8qKiBAdHlwZSB7e2VmZmVjdDogc3RyaW5nfX0gKi8gcnVsZSkgPT4gcnVsZS5lZmZlY3QgPT09IFwiYWxsb3dcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7e2V2ZW50SWQ/OiBzdHJpbmd9fSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGl2ZXJ5LlxuICAgKi9cbiAgYXN5bmMgZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgYXdhaXQgdGhpcy5fZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt7ZXZlbnRJZD86IHN0cmluZ319IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBfZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgaGFzRXZlbnRGaWx0ZXJzID0gdGhpcy5faGFzRXZlbnRGaWx0ZXJQYXJhbXMoKVxuXG4gICAgaWYgKCF0aGlzLl9oYXNQcm9qZWN0aW9uUGFyYW1zKCkgJiYgIWhhc0V2ZW50RmlsdGVycykge1xuICAgICAgLy8gRXZlbiB1bmZpbHRlcmVkIHN1YnNjcmlwdGlvbnMgbXVzdCByZXNwZWN0IHRoZSBzdWJzY3JpYmVyJ3MgYWJpbGl0eS4gQSBjcmVhdGUvdXBkYXRlIGNhcnJpZXNcbiAgICAgIC8vIHRoZSByZWNvcmQsIHNvIG9ubHkgZGVsaXZlciBpdCB3aGVuIHRoZSByZWNvcmQgaXMgd2l0aGluIHRoZSBhdXRoZW50aWNhdGVkIGFiaWxpdHkncyBzY29wZS5cbiAgICAgIC8vIERlc3Ryb3lzIChhbmQgYm9kaWVzIHdpdGhvdXQgYSB1c2FibGUgaWQpIGNhcnJ5IG5vIHJlY29yZCwgc28gcGFzcyB0aGVtIHRocm91Z2ggdW5jaGFuZ2VkLlxuICAgICAgaWYgKGJvZHkgJiYgdHlwZW9mIGJvZHkgPT09IFwib2JqZWN0XCIgJiYgKGJvZHkuYWN0aW9uID09PSBcImNyZWF0ZVwiIHx8IGJvZHkuYWN0aW9uID09PSBcInVwZGF0ZVwiKSAmJiBib2R5LmlkICE9PSB1bmRlZmluZWQgJiYgYm9keS5pZCAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKVxuXG4gICAgICAgIGlmICghYXdhaXQgdGhpcy5fZXZlbnRJc0FjY2Vzc2libGUoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpKSByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYm9keS5hY3Rpb24gPT09IFwiZGVzdHJveVwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmlkID09PSB1bmRlZmluZWQgfHwgYm9keS5pZCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gYXdhaXQgdGhpcy5fbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c0ZvckV2ZW50SWQoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzICYmIG1hdGNoZWRFdmVudEZpbHRlcktleXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxpdmVyIGJvZHkuXG4gICAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSAqL1xuICAgIGxldCBkZWxpdmVyQm9keSA9IGJvZHlcblxuICAgIGlmICh0aGlzLl9oYXNQcm9qZWN0aW9uUGFyYW1zKCkpIHtcbiAgICAgIGNvbnN0IHByb2plY3RlZFJlY29yZCA9IGF3YWl0IHRoaXMuX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGlmICghcHJvamVjdGVkUmVjb3JkKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgICAgaWYgKCFjb25maWd1cmF0aW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBjaGFubmVsIGhhcyBubyBjb25maWd1cmF0aW9uIGZvciB0cmFuc3BvcnQgc2VyaWFsaXphdGlvblwiKVxuICAgICAgfVxuXG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIHJlY29yZDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwcm9qZWN0ZWRSZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGhhc0V2ZW50RmlsdGVycykge1xuICAgICAgZGVsaXZlckJvZHkgPSB7XG4gICAgICAgIC4uLmRlbGl2ZXJCb2R5LFxuICAgICAgICBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5zZW5kTWVzc2FnZShkZWxpdmVyQm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgZnJvbSBgYnJvYWRjYXN0VG9DaGFubmVsYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGJyb2FkY2FzdCBtYXRjaGVzIHRoaXMgc3Vic2NyaWJlcidzIG1vZGVsLlxuICAgKi9cbiAgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpIHtcbiAgICByZXR1cm4gYnJvYWRjYXN0UGFyYW1zPy5tb2RlbCA9PT0gdGhpcy5fbW9kZWxOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBEZWJ1Zy1zYWZlIHN1YnNjcmlwdGlvbiBkZXRhaWxzLlxuICAgKi9cbiAgZGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBldmVudEZpbHRlcnMgPSB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdGllczogdGhpcy5wYXJhbXMuYWJpbGl0aWVzICE9PSB1bmRlZmluZWQsXG4gICAgICBldmVudEZpbHRlckNvdW50OiBldmVudEZpbHRlcnMubGVuZ3RoLFxuICAgICAgZGVzdHJveUV2ZW50RGVsaXZlcnk6IHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlLFxuICAgICAgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpLFxuICAgICAgcHJlbG9hZDogdGhpcy5wYXJhbXMucHJlbG9hZCAhPT0gdW5kZWZpbmVkLFxuICAgICAgcXVlcnlEYXRhOiB0aGlzLnBhcmFtcy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0ICE9PSB1bmRlZmluZWQsXG4gICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSAhPT0gdW5kZWZpbmVkLFxuICAgICAgdW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk6IHRoaXMucGFyYW1zLnVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID09PSB0cnVlLFxuICAgICAgd2l0aENvdW50OiB0aGlzLnBhcmFtcy53aXRoQ291bnQgIT09IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJlcXVlc3RlZCBmcm9udGVuZC1tb2RlbCBuYW1lIG9yIG51bGwuXG4gICAqL1xuICBfbW9kZWxOYW1lKCkge1xuICAgIHJldHVybiB0eXBlb2YgdGhpcy5wYXJhbXM/Lm1vZGVsID09PSBcInN0cmluZ1wiICYmIHRoaXMucGFyYW1zLm1vZGVsLmxlbmd0aCA+IDBcbiAgICAgID8gdGhpcy5wYXJhbXMubW9kZWxcbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHByb2plY3Rpb24gcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgc3Vic2NyaXB0aW9uIHJlcXVlc3RlZCBwZXItZXZlbnQgcmVjb3JkIHByb2plY3Rpb24uXG4gICAqL1xuICBfaGFzUHJvamVjdGlvblBhcmFtcygpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuc2VsZWN0ICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCB0aGlzLnBhcmFtcy5wcmVsb2FkICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLndpdGhDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCB0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgdGhpcy5wYXJhbXMucXVlcnlEYXRhICE9PSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBldmVudCBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgc3Vic2NyaXB0aW9uIHJlcXVlc3RlZCBldmVudCBxdWVyeSBmaWx0ZXJzLlxuICAgKi9cbiAgX2hhc0V2ZW50RmlsdGVyUGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLl9ldmVudEZpbHRlcnMoKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdW5maWx0ZXJlZCBldmVudCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB1bmZpbHRlcmVkIGNhbGxiYWNrcyBzaG91bGQgcmVjZWl2ZSBldmVyeSBldmVudC5cbiAgICovXG4gIF9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBkZXN0cm95IGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGlkLW9ubHkgZGVzdHJveSBldmVudHMgc2hvdWxkIGJlIGRlbGl2ZXJlZCB3aXRoIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkoKSB7XG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlbXX0gLSBWYWxpZCBldmVudCBmaWx0ZXJzLlxuICAgKi9cbiAgX2V2ZW50RmlsdGVycygpIHtcbiAgICBpZiAodGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzXCIpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV2ZW50RmlsdGVyID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChlbnRyeSlcbiAgICAgIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMoZXZlbnRGaWx0ZXIpLmZpbHRlcigoa2V5KSA9PiAhRVZFTlRfRklMVEVSX0tFWVMuaGFzKGtleSkpXG5cbiAgICAgIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgY2Fubm90IGluY2x1ZGUgJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBldmVudEZpbHRlci5rZXkgIT09IFwic3RyaW5nXCIgfHwgZXZlbnRGaWx0ZXIua2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyByZXF1aXJlIGEga2V5XCIpXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2FuaXRpemVkIGV2ZW50IGZpbHRlci5cbiAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gKi9cbiAgICAgIGNvbnN0IHNhbml0aXplZEV2ZW50RmlsdGVyID0ge2tleTogZXZlbnRGaWx0ZXIua2V5fVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIuam9pbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci5qb2lucyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIuam9pbnMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5zZWFyY2hlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLnNlYXJjaGVzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi8gKGV2ZW50RmlsdGVyLnNlYXJjaGVzKVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIud2hlcmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci53aGVyZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIud2hlcmUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBzYW5pdGl6ZWRFdmVudEZpbHRlclxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0Pn0gLSBGcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoID0gXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCJcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbENvbnRyb2xsZXJ9ID0gYXdhaXQgaW1wb3J0KGZyb250ZW5kTW9kZWxDb250cm9sbGVyUGF0aClcblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQ29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbcGFyYW1zXSAtIE9wdGlvbmFsIHBhcmFtcyBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBTeW50aGV0aWMgY29udHJvbGxlciB1c2VkIGZvciByZXNvdXJjZSBzZXJpYWxpemF0aW9uLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCBwYXJhbXMgPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoe1xuICAgICAgYWN0aW9uOiBcIndlYnNvY2tldEV2ZW50XCIsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgY29udHJvbGxlcjogXCJmcm9udGVuZC1tb2RlbHNcIixcbiAgICAgIHBhcmFtczoge1xuICAgICAgICBhYmlsaXRpZXM6IHRoaXMucGFyYW1zLmFiaWxpdGllcyxcbiAgICAgICAgam9pbnM6IHRoaXMucGFyYW1zLmpvaW5zLFxuICAgICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICAgIHByZWxvYWQ6IHRoaXMucGFyYW1zLnByZWxvYWQsXG4gICAgICAgIHF1ZXJ5RGF0YTogdGhpcy5wYXJhbXMucXVlcnlEYXRhLFxuICAgICAgICBzZWFyY2hlczogdGhpcy5wYXJhbXMuc2VhcmNoZXMsXG4gICAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0LFxuICAgICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSxcbiAgICAgICAgd2hlcmU6IHRoaXMucGFyYW1zLndoZXJlLFxuICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgIHdpdGhDb3VudDogdGhpcy5wYXJhbXMud2l0aENvdW50XG4gICAgICB9LFxuICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgIHZpZXdQYXRoOiBcIi9cIlxuICAgIH0pXG5cbiAgICBjb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gdGhpcy5fYWJpbGl0eSB8fCB1bmRlZmluZWRcblxuICAgIHJldHVybiBjb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGVuYW50IGZvciBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZWQgdGVuYW50LlxuICAgKi9cbiAgYXN5bmMgX3Jlc29sdmVFdmVudFRlbmFudChpZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudCByZXNvbHV0aW9uXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNaXJyb3IgdGhlIHN1YnNjcmliZS10aW1lIHRlbmFudCByZXNvbHV0aW9uIChgV2Vic29ja2V0U2Vzc2lvbi5fcmVzb2x2ZVRlbmFudGApOlxuICAgICAgLy8gcGFzcyBgc3Vic2NyaXB0aW9uOiB7Y2hhbm5lbCwgcGFyYW1zfWAgc28gcmVzb2x2ZXJzIHRoYXQgZGVyaXZlIHNjb3BlIGZyb20gdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24gYmVoYXZlIHRoZSBzYW1lIGZvciBicm9hZGNhc3RzIGFzIHRoZXkgZGlkIGF0IGBjaGFubmVsLXN1YnNjcmliZWAuXG4gICAgICAvLyBUaGUgc3ludGhldGljIHJlcXVlc3QgZm9yd2FyZHMgdGhlIHN1YnNjcmliZXIncyBwYXJhbXMgKGUuZy4gYXV0aGVudGljYXRpb25Ub2tlbiksXG4gICAgICAvLyBtYXRjaGluZyB0aGlzIGNoYW5uZWwncyBhYmlsaXR5IHJlc29sdXRpb24gYWJvdmUuXG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIGlkLCBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCl9LFxuICAgICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpLFxuICAgICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSksXG4gICAgICAgIHN1YnNjcmlwdGlvbjoge2NoYW5uZWw6IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHBhcmFtczogdGhpcy5wYXJhbXN9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN1YnNjcmliZXIncyB0ZW5hbnQgZm9yIHRoZSBicm9hZGNhc3QgcmVjb3JkIGFuZCBydW5zIGBjYWxsYmFja2AgaW5zaWRlIHRoYXQgdGVuYW50XG4gICAqIGNvbnRleHQuIEJyb2FkY2FzdCBkZWxpdmVyeSBydW5zIGluIHdoYXRldmVyIGFtYmllbnQgdGVuYW50IGNvbnRleHQgdGhlIHB1Ymxpc2hlciBsZWZ0IGJlaGluZC4gRm9yXG4gICAqIG11bHRpLXRlbmFudCByZWNvcmRzIHRoYXQgYW1iaWVudCB0ZW5hbnQgbWF5IGhhdmUgYmVlbiByZXNvbHZlZCB3aXRob3V0IHRoZSBzdWJzY3JpYmVyJ3MgcmVxdWVzdFxuICAgKiAoZS5nLiBhIHJlbGF5IGVuZHBvaW50IG9yIGJhY2tncm91bmQgam9iIG11dGF0aW5nIHRoZSByb3cpLCBzbyBpdCBsYWNrcyB0aGUgc3Vic2NyaWJlcidzIHBlci1yZWNvcmRcbiAgICogYWNjZXNzIGZsYWdzIGFuZCB0aGUgcGVyLWV2ZW50IGF1dGhvcml6YXRpb24gcXVlcnkgd3JvbmdseSBmaW5kcyBub3RoaW5nLiBSZS1yZXNvbHZpbmcgdGhlIHRlbmFudFxuICAgKiBmcm9tIHRoZSBldmVudCByZWNvcmQgaWQgcGx1cyB0aGUgc3Vic2NyaWJlcidzIHJlcXVlc3QgbWFrZXMgdGhlIGF1dGhvcml6YXRpb24gcXVlcmllcyBydW4gYWdhaW5zdFxuICAgKiB0aGUgc3Vic2NyaWJlcidzIG93biB0ZW5hbnQvYWJpbGl0eSBzY29wZS4gV2hlbiBubyB0ZW5hbnQgcmVzb2x2ZXMgKG5vbi1tdWx0aXRlbmFudCBjb25maWdzKSwgdGhlXG4gICAqIGNhbGxiYWNrIHJ1bnMgZGlyZWN0bHkgc28gdGhlIGFtYmllbnQgY29udGV4dCBpcyBwcmVzZXJ2ZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF1dGhvcml6ZWQtcXVlcnkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRXZlbnRUZW5hbnQoaWQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24gfHwgdHlwZW9mIGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVFdmVudFRlbmFudChpZClcblxuICAgIC8vIEFsd2F5cyBlbnRlciBgcnVuV2l0aFRlbmFudGAsIGV2ZW4gd2hlbiBubyB0ZW5hbnQgcmVzb2x2ZWQuIEJyb2FkY2FzdCBmYW4tb3V0XG4gICAgLy8gcnVucyBpbiB0aGUgcHVibGlzaGVyJ3MgYW1iaWVudCB0ZW5hbnQgY29udGV4dDsgZmFsbGluZyBiYWNrIHRvIGBjYWxsYmFjaygpYFxuICAgIC8vIHRoZXJlIHdvdWxkIGF1dGhvcml6ZSBhIGNyb3NzLXRlbmFudCByZWNvcmQgYWdhaW5zdCB0aGUgcHVibGlzaGVyJ3MgdGVuYW50IGFuZFxuICAgIC8vIGNvdWxkIGxlYWsgaXQgdG8gYSBzdWJzY3JpYmVyIHdob3NlIG93biByZXNvbHZlciBjb3VsZCBub3QgcmVzb2x2ZSBpdC5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudFwifSwgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBicm9hZGNhc3QgcmVjb3JkIGlzIHdpdGhpbiB0aGUgc3Vic2NyaWJlcidzIGF1dGhlbnRpY2F0ZWQgYWJpbGl0eSBzY29wZS4gVXNlZCB0byBnYXRlXG4gICAqIHVuZmlsdGVyZWQvdW5wcm9qZWN0ZWQgY3JlYXRlL3VwZGF0ZSBkZWxpdmVyeSBzbyBhIHNjb3BlZCB0b2tlbiBuZXZlciByZWNlaXZlcyBhIHJlY29yZCBpdCBjYW5ub3QgcmVhZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFRydWUgd2hlbiB0aGUgcmVjb3JkIGlzIHJlYWRhYmxlIGJ5IHRoaXMgc3Vic2NyaXB0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2V2ZW50SXNBY2Nlc3NpYmxlKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7W01vZGVsQ2xhc3MudGFibGVOYW1lKCldOiB7W3ByaW1hcnlLZXldOiBpZH19KVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEV2ZW50IGZpbHRlciBrZXlzIG1hdGNoZWQgYnkgdGhlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICAvKipcbiAgICAgKiBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gW11cblxuICAgIGZvciAoY29uc3QgZXZlbnRGaWx0ZXIgb2YgdGhpcy5fZXZlbnRGaWx0ZXJzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCB0aGlzLl9ldmVudE1hdGNoZXNGaWx0ZXIoe1xuICAgICAgICBGcm9udGVuZE1vZGVsQ29udHJvbGxlcixcbiAgICAgICAgZXZlbnRGaWx0ZXIsXG4gICAgICAgIGlkXG4gICAgICB9KVxuXG4gICAgICBpZiAobWF0Y2hlcykgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5wdXNoKGV2ZW50RmlsdGVyLmtleSlcbiAgICB9XG5cbiAgICByZXR1cm4gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgbWF0Y2hlcyBmaWx0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmlsdGVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gYXJncy5Gcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnl9IGFyZ3MuZXZlbnRGaWx0ZXIgLSBFdmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGFyZ3MuaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSByZWNvcmQgbWF0Y2hlcyB0aGUgZmlsdGVyLlxuICAgKi9cbiAgYXN5bmMgX2V2ZW50TWF0Y2hlc0ZpbHRlcih7RnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIGV2ZW50RmlsdGVyLCBpZH0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIHtcbiAgICAgICAgam9pbnM6IGV2ZW50RmlsdGVyLmpvaW5zLFxuICAgICAgICBzZWFyY2hlczogZXZlbnRGaWx0ZXIuc2VhcmNoZXMsXG4gICAgICAgIHdoZXJlOiBldmVudEZpbHRlci53aGVyZVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHdoZXJlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2hlcmUoKVxuICAgICAgY29uc3Qgam9pbnMgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxKb2lucygpXG4gICAgICAvLyBTdGFydCBmcm9tIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBhIGZpbHRlciBjYW4gb25seSBldmVyIG1hdGNoIHJlY29yZHMgdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1tNb2RlbENsYXNzLnRhYmxlTmFtZSgpXToge1twcmltYXJ5S2V5XTogaWR9fSlcblxuICAgICAgaWYgKHdoZXJlKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgICAgaWYgKGpvaW5zKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuXG4gICAgICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxTZWFyY2hlcygpKSB7XG4gICAgICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJvamVjdGVkIHJlY29yZCBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPiB8IG51bGw+fSAtIFNlcmlhbGl6ZWQgcHJvamVjdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9wcm9qZWN0ZWRSZWNvcmRGb3JFdmVudElkKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICAgIC8vIFJlbG9hZCB0aHJvdWdoIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBwcm9qZWN0ZWQgcmVjb3JkcyBhcmUgb25seSBldmVyIHNlbnQgZm9yXG4gICAgICAvLyByb3dzIHRoZSBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1tNb2RlbENsYXNzLnRhYmxlTmFtZSgpXToge1twcmltYXJ5S2V5XTogaWR9fSlcbiAgICAgIGNvbnN0IHByZWxvYWQgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcblxuICAgICAgaWYgKHByZWxvYWQpIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpKSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTcGVjLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IHtyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fT59ICovXG4gICAgICAgIGNvbnN0IHNwZWMgPSB7fVxuXG4gICAgICAgIHNwZWNbZW50cnkuYXR0cmlidXRlTmFtZV0gPSB7XG4gICAgICAgICAgcmVsYXRpb25zaGlwOiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZW50cnkud2hlcmUpIDogdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgcXVlcnkud2l0aENvdW50KHNwZWMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpXG5cbiAgICAgIGlmIChxdWVyeURhdGEgIT09IG51bGwpIHF1ZXJ5LnF1ZXJ5RGF0YShxdWVyeURhdGEpXG5cbiAgICAgIHF1ZXJ5ID0gY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxUcmFuc2xhdGVkQXR0cmlidXRlUHJlbG9hZHMoe3F1ZXJ5fSlcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCBxdWVyeS5maXJzdCgpXG5cbiAgICAgIGlmICghbW9kZWwpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKFttb2RlbF0pXG4gICAgICB9XG5cbiAgICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB1bmRlZmluZWRcblxuICAgICAgcmV0dXJuIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5zZXJpYWxpemUobW9kZWwsIFwiZmluZFwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWluaW1hbCBSZXF1ZXN0LWxpa2Ugc3R1YiB1c2VkIG9ubHkgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi4gQXZvaWRzXG4gICAqIGltcG9ydGluZyBgV2Vic29ja2V0UmVxdWVzdGAgaGVyZSBiZWNhdXNlIGl0cyBgbm9kZTpxdWVyeXN0cmluZ2BcbiAgICogZGVwZW5kZW5jeSB3b3VsZCBwdWxsIHNlcnZlci1vbmx5IGNvZGUgaW50byBicm93c2VyIGJ1bmRsZXMgdmlhXG4gICAqIHRoZSBgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVyc2AgaW1wb3J0IGNoYWluLlxuICAgKiBIZWFkZXIgbmFtZXMgYXJlIG5vcm1hbGl6ZWQgdG8gbG93ZXJjYXNlIHNvIGBoZWFkZXIoXCJjb29raWVcIilgXG4gICAqIGZpbmRzIGEgdmFsdWUgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoZSB1cGdyYWRlLXJlcXVlc3QgaGVhZGVyc1xuICAgKiBtYXAgdXNlcyBgXCJDb29raWVcImAgb3IgYFwiY29va2llXCJgLiBTZXNzaW9uIG1ldGFkYXRhIHN0YXlzIHNlcGFyYXRlXG4gICAqIGZyb20gaGVhZGVycyBhbmQgaXMgZXhwb3NlZCB0aHJvdWdoIGBtZXRhZGF0YSguLi4pYCBmb3IgYWJpbGl0eVxuICAgKiByZXNvbHZlcnMgdGhhdCBuZWVkIHdlYnNvY2tldC1kZWxpdmVyZWQgc2Vzc2lvbiBkYXRhLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3R9IFJlcXVlc3QtbGlrZSBvYmplY3QgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi5cbiAgICovXG4gIF9zeW50aGV0aWNSZXF1ZXN0KCkge1xuICAgIGNvbnN0IHVwZ3JhZGVSZXF1ZXN0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3R9ICovICh0aGlzLnNlc3Npb24udXBncmFkZVJlcXVlc3QpXG4gICAgY29uc3QgcmF3SGVhZGVycyA9IHR5cGVvZiB1cGdyYWRlUmVxdWVzdD8uaGVhZGVycyA9PT0gXCJmdW5jdGlvblwiID8gdXBncmFkZVJlcXVlc3QuaGVhZGVycygpIDoge31cbiAgICBjb25zdCBtZXRhZGF0YSA9IHR5cGVvZiB0aGlzLnNlc3Npb24uZ2V0TWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSgpIDoge31cbiAgICBjb25zdCByZW1vdGVBZGRyZXNzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5yZW1vdGVBZGRyZXNzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5yZW1vdGVBZGRyZXNzKCkgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBIZWFkZXIgbWFwLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD59ICovXG4gICAgY29uc3QgaGVhZGVyTWFwID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHJhd0hlYWRlcnMgfHwge30pKSB7XG4gICAgICBoZWFkZXJNYXBba2V5LnRvTG93ZXJDYXNlKCldID0gcmF3SGVhZGVyc1trZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcnM6ICgpID0+IGhlYWRlck1hcCxcbiAgICAgIGhlYWRlcjogKG5hbWUpID0+IGhlYWRlck1hcFtTdHJpbmcobmFtZSkudG9Mb3dlckNhc2UoKV0sXG4gICAgICBtZXRhZGF0YTogKGtleSkgPT4ga2V5ID09PSB1bmRlZmluZWQgPyB7Li4ubWV0YWRhdGF9IDogbWV0YWRhdGFba2V5XSxcbiAgICAgIHBhdGg6ICgpID0+IFwiL2Zyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgaHR0cE1ldGhvZDogKCkgPT4gXCJQT1NUXCIsXG4gICAgICByZW1vdGVBZGRyZXNzOiAoKSA9PiByZW1vdGVBZGRyZXNzLFxuICAgICAgb3JpZ2luOiAoKSA9PiBoZWFkZXJNYXAub3JpZ2luXG4gICAgfVxuICB9XG59XG4iXX0=