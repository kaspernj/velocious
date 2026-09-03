// @ts-check
import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
import Response from "../http-server/client/response.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceClassFromDefinition } from "./resource-definition.js";
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
 * Resolves frontend resource identity attributes to backing database columns.
 * @param {typeof import("../database/record/index.js").default} ModelClass - Backing model class.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} primaryKey - Frontend resource identity definition.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Frontend resource identity.
 * @returns {Record<string, import("../utils/model-primary-key.js").ModelPrimaryKeyScalar>} - Backing column conditions.
 */
function frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id) {
    const resourceConditions = modelPrimaryKeyConditions(primaryKey, id);
    /** @type {Record<string, import("../utils/model-primary-key.js").ModelPrimaryKeyScalar>} */
    const databaseConditions = {};
    for (const [attributeName, value] of Object.entries(resourceConditions)) {
        databaseConditions[ModelClass.getColumnNameForAttributeName(attributeName)] = value;
    }
    return databaseConditions;
}
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
        const ModelClass = this._modelClass(modelName);
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
     * Resolves a subscription name through frontend resources before falling back to a backing model name.
     * @param {string} modelName - Frontend resource name.
     * @returns {typeof import("../database/record/index.js").default | undefined} - Backing model class.
     */
    _modelClass(modelName) {
        const configuration = this.session.configuration;
        for (const backendProject of configuration.getBackendProjects()) {
            const resourceDefinition = frontendModelResourcesWithBuiltInsForBackendProject(backendProject)[modelName];
            const resourceClass = resourceDefinition ? frontendModelResourceClassFromDefinition(resourceDefinition) : null;
            if (resourceClass?.ModelClass)
                return resourceClass.modelClass();
        }
        return configuration.getModelClasses()[modelName];
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
            const query = controller.frontendModelAuthorizedQuery("find").where({
                [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
            });
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
            let query = controller.frontendModelAuthorizedQuery("find").where({
                [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
            });
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
            let query = controller.frontendModelAuthorizedQuery("find").where({
                [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
            });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sUUFBUSxNQUFNLG1DQUFtQyxDQUFBO0FBQ3hELE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQ2pGLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRXZFOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO0FBRXhFLHFGQUFxRjtBQUNyRiwyRUFBMkU7QUFDM0UsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUV0RDs7Ozs7O0dBTUc7QUFDSCxTQUFTLHlDQUF5QyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRTtJQUMzRSxNQUFNLGtCQUFrQixHQUFHLHlCQUF5QixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUNwRSw0RkFBNEY7SUFDNUYsTUFBTSxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFN0IsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1FBQ3hFLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyw2QkFBNkIsQ0FBQyxhQUFhLENBQUMs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QVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNO1lBQ3hCLGFBQWEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhO1lBQ2xDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTTtTQUMvQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIGZyb20gXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiXG5pbXBvcnQgUmVzcG9uc2UgZnJvbSBcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbn0gZnJvbSBcIi4vcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3NlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3Rpb24/OiBzdHJpbmcsIGlkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1hdGNoZWRFdmVudEZpbHRlcktleXM/OiBzdHJpbmdbXSwgcmVjb3JkPzogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIFtrZXk6IHN0cmluZ106IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3toZWFkZXJzPzogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCByZW1vdGVBZGRyZXNzPzogKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFVwZ3JhZGVSZXF1ZXN0XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPiwgaGVhZGVyOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgbWV0YWRhdGE6IChrZXk/OiBzdHJpbmcpID0+IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPiB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgdW5kZWZpbmVkLCBwYXRoOiAoKSA9PiBzdHJpbmcsIGh0dHBNZXRob2Q6ICgpID0+IHN0cmluZywgcmVtb3RlQWRkcmVzczogKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkLCBvcmlnaW46ICgpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3RcbiAqL1xuY29uc3QgRVZFTlRfRklMVEVSX0tFWVMgPSBuZXcgU2V0KFtcImpvaW5zXCIsIFwia2V5XCIsIFwic2VhcmNoZXNcIiwgXCJ3aGVyZVwiXSlcblxuLy8gTWlycm9ycyBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FIGluIC4vd2Vic29ja2V0LXB1Ymxpc2hlcnMuanMsIGR1cGxpY2F0ZWQgaGVyZVxuLy8gdG8gYXZvaWQgdGhlIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlciDihpIgd2Vic29ja2V0LXB1Ymxpc2hlcnMgaW1wb3J0IGN5Y2xlLlxuY29uc3QgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSA9IFwiZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqXG4gKiBSZXNvbHZlcyBmcm9udGVuZCByZXNvdXJjZSBpZGVudGl0eSBhdHRyaWJ1dGVzIHRvIGJhY2tpbmcgZGF0YWJhc2UgY29sdW1ucy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gcHJpbWFyeUtleSAtIEZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5IGRlZmluaXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59IC0gQmFja2luZyBjb2x1bW4gY29uZGl0aW9ucy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpIHtcbiAgY29uc3QgcmVzb3VyY2VDb25kaXRpb25zID0gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBpZClcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAqL1xuICBjb25zdCBkYXRhYmFzZUNvbmRpdGlvbnMgPSB7fVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZUNvbmRpdGlvbnMpKSB7XG4gICAgZGF0YWJhc2VDb25kaXRpb25zW01vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSldID0gdmFsdWVcbiAgfVxuXG4gIHJldHVybiBkYXRhYmFzZUNvbmRpdGlvbnNcbn1cblxuLyoqXG4gKiBSdW5zIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uIG9wdGlvbnMgZm9yIGEgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc30gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gIHJldHVybiB7XG4gICAgdGltZVpvbmU6IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbilcbiAgfVxufVxuXG4vKipcbiAqIFBlci1zZXNzaW9uIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGZvciBmcm9udGVuZC1tb2RlbCBsaWZlY3ljbGUgZXZlbnRzLlxuICogUmVwbGFjZXMgdGhlIGxlZ2FjeSBgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWxgIChQaGFzZSAzKS5cbiAqXG4gKiBBdXRoIG1vZGVsOiBzdWJzY3JpYmUtdGltZSBvbmx5LiBgY2FuU3Vic2NyaWJlYCByZXNvbHZlcyB0aGUgY2FsbGVyJ3NcbiAqIGFiaWxpdHkgb25jZSwgY2hlY2tzIHRoYXQgYXQgbGVhc3Qgb25lIGBhbGxvd2AgcnVsZSBleGlzdHMgZm9yXG4gKiBgcmVhZGAgb24gdGhlIHJlcXVlc3RlZCBtb2RlbCBjbGFzcywgYW5kIHRoZW4gZGVsaXZlcnMgZnV0dXJlXG4gKiBsaWZlY3ljbGUgYnJvYWRjYXN0cyBmb3IgdGhhdCBtb2RlbCB3aXRob3V0IHJlLWF1dGhvcml6aW5nIHBlciBldmVudC5cbiAqIFRoaXMgbWF0Y2hlcyB0aGUgZXhwbGljaXQgZGVzaWduIGRlY2lzaW9uIGluIFBoYXNlIDMgdG8gdHJhZGVcbiAqIHBlci1yZWNvcmQgdmlzaWJpbGl0eSBndWFyYW50ZWVzIGZvciBtYXNzaXZlbHkgY2hlYXBlciBicm9hZGNhc3QgZmFuLW91dC5cbiAqIFN1YnNjcmliZXItcHJvdmlkZWQgZXZlbnQgZmlsdGVycyBjYW4gc3RpbGwgbmFycm93IHdoaWNoIGNyZWF0ZS91cGRhdGVcbiAqIGV2ZW50cyBhcmUgZGVsaXZlcmVkLCBidXQgdGhleSBhcmUgbWF0Y2hpbmcgcHJlZGljYXRlcyByYXRoZXIgdGhhblxuICogcGVyLXJlY29yZCBhdXRob3JpemF0aW9uIGNoZWNrcy5cbiAqXG4gKiBXaXJlOiBzdWJzY3JpYmUgd2l0aCBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWw6IE1vZGVsTmFtZX19KWAuXG4gKiBCYWNrZW5kIHB1Ymxpc2hlcyBge2FjdGlvbiwgaWQsIHJlY29yZH1gIHZpYVxuICogYGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHttb2RlbDogTW9kZWxOYW1lfSwgYm9keSlgO1xuICogYG1hdGNoZXMoKWAgcm91dGVzIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsIGV4dGVuZHMgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCB7XG4gIC8qKlxuICAgKiBBYmlsaXR5LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICBfYWJpbGl0eSA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBjYW4gc3Vic2NyaWJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgZnJvbnRlbmQtbW9kZWwgc3Vic2NyaXB0aW9uIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBjYW5TdWJzY3JpYmUoKSB7XG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5fbW9kZWxOYW1lKClcblxuICAgIGlmICghbW9kZWxOYW1lKSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuX21vZGVsQ2xhc3MobW9kZWxOYW1lKVxuXG4gICAgaWYgKCFNb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpXG4gICAgY29uc3QgYWJpbGl0eSA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUFiaWxpdHkoe1xuICAgICAgLy8gRm9yd2FyZCB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSBzbyB0b2tlbi1hdXRoZW50aWNhdGVkIGNsaWVudHNcbiAgICAgIC8vIHJlc29sdmUgdGhlIHNhbWUgYWJpbGl0eSB0aGV5IHdvdWxkIG92ZXIgSFRUUC4gV2l0aG91dCB0aGlzIG9ubHkgc2Vzc2lvbi9jb29raWUgYXV0aCBvbiB0aGVcbiAgICAgIC8vIHVwZ3JhZGUgcmVxdWVzdCB3b3JrcywgYW5kIHBhcmFtLWJhc2VkIGF1dGggKGxpa2UgYSBzY2FubmVyIHBhc3NpbmcgYW4gYXV0aGVudGljYXRpb25Ub2tlbilcbiAgICAgIC8vIGlzIGRyb3BwZWQg4oCUIGxlYXZpbmcgc3VjaCBzdWJzY3JpYmVycyB3aXRoIGEgZ3Vlc3QgYWJpbGl0eSBhbmQgbm8gcmVhZCBydWxlLlxuICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIG1vZGVsOiBtb2RlbE5hbWV9LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIH0pXG5cbiAgICBpZiAoIWFiaWxpdHkpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2FiaWxpdHkgPSBhYmlsaXR5XG5cbiAgICAvLyBMb2FkIHJlc291cmNlLWRlY2xhcmVkIHJ1bGVzIGZvciB0aGlzIG1vZGVsIGNsYXNzIGJlZm9yZSBjaGVja2luZyxcbiAgICAvLyBvdGhlcndpc2UgYHJ1bGVzRm9yYCByZXR1cm5zIGVtcHR5IGZvciBhYmlsaXRpZXMgd2hvc2UgcmVzb3VyY2VzXG4gICAgLy8gcmVnaXN0ZXIgcnVsZXMgbGF6aWx5IHZpYSBgYWJpbGl0aWVzKClgLlxuICAgIGFiaWxpdHkubG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MoTW9kZWxDbGFzcylcblxuICAgIGNvbnN0IHJlYWRSdWxlcyA9IGFiaWxpdHkucnVsZXNGb3Ioe2FjdGlvbjogXCJyZWFkXCIsIG1vZGVsQ2xhc3M6IE1vZGVsQ2xhc3N9KVxuXG4gICAgcmV0dXJuIHJlYWRSdWxlcy5zb21lKCgvKiogQHR5cGUge3tlZmZlY3Q6IHN0cmluZ319ICovIHJ1bGUpID0+IHJ1bGUuZWZmZWN0ID09PSBcImFsbG93XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBzdWJzY3JpcHRpb24gbmFtZSB0aHJvdWdoIGZyb250ZW5kIHJlc291cmNlcyBiZWZvcmUgZmFsbGluZyBiYWNrIHRvIGEgYmFja2luZyBtb2RlbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgcmVzb3VyY2UgbmFtZS5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgX21vZGVsQ2xhc3MobW9kZWxOYW1lKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClbbW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc291cmNlRGVmaW5pdGlvbiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSA6IG51bGxcblxuICAgICAgaWYgKHJlc291cmNlQ2xhc3M/Lk1vZGVsQ2xhc3MpIHJldHVybiByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIH1cblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpW21vZGVsTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7e2V2ZW50SWQ/OiBzdHJpbmd9fSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGl2ZXJ5LlxuICAgKi9cbiAgYXN5bmMgZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgYXdhaXQgdGhpcy5fZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt7ZXZlbnRJZD86IHN0cmluZ319IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBfZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgaGFzRXZlbnRGaWx0ZXJzID0gdGhpcy5faGFzRXZlbnRGaWx0ZXJQYXJhbXMoKVxuXG4gICAgaWYgKCF0aGlzLl9oYXNQcm9qZWN0aW9uUGFyYW1zKCkgJiYgIWhhc0V2ZW50RmlsdGVycykge1xuICAgICAgLy8gRXZlbiB1bmZpbHRlcmVkIHN1YnNjcmlwdGlvbnMgbXVzdCByZXNwZWN0IHRoZSBzdWJzY3JpYmVyJ3MgYWJpbGl0eS4gQSBjcmVhdGUvdXBkYXRlIGNhcnJpZXNcbiAgICAgIC8vIHRoZSByZWNvcmQsIHNvIG9ubHkgZGVsaXZlciBpdCB3aGVuIHRoZSByZWNvcmQgaXMgd2l0aGluIHRoZSBhdXRoZW50aWNhdGVkIGFiaWxpdHkncyBzY29wZS5cbiAgICAgIC8vIERlc3Ryb3lzIChhbmQgYm9kaWVzIHdpdGhvdXQgYSB1c2FibGUgaWQpIGNhcnJ5IG5vIHJlY29yZCwgc28gcGFzcyB0aGVtIHRocm91Z2ggdW5jaGFuZ2VkLlxuICAgICAgaWYgKGJvZHkgJiYgdHlwZW9mIGJvZHkgPT09IFwib2JqZWN0XCIgJiYgKGJvZHkuYWN0aW9uID09PSBcImNyZWF0ZVwiIHx8IGJvZHkuYWN0aW9uID09PSBcInVwZGF0ZVwiKSAmJiBib2R5LmlkICE9PSB1bmRlZmluZWQgJiYgYm9keS5pZCAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKVxuXG4gICAgICAgIGlmICghYXdhaXQgdGhpcy5fZXZlbnRJc0FjY2Vzc2libGUoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpKSByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYm9keS5hY3Rpb24gPT09IFwiZGVzdHJveVwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmlkID09PSB1bmRlZmluZWQgfHwgYm9keS5pZCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gYXdhaXQgdGhpcy5fbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c0ZvckV2ZW50SWQoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzICYmIG1hdGNoZWRFdmVudEZpbHRlcktleXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxpdmVyIGJvZHkuXG4gICAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSAqL1xuICAgIGxldCBkZWxpdmVyQm9keSA9IGJvZHlcblxuICAgIGlmICh0aGlzLl9oYXNQcm9qZWN0aW9uUGFyYW1zKCkpIHtcbiAgICAgIGNvbnN0IHByb2plY3RlZFJlY29yZCA9IGF3YWl0IHRoaXMuX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGlmICghcHJvamVjdGVkUmVjb3JkKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgICAgaWYgKCFjb25maWd1cmF0aW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBjaGFubmVsIGhhcyBubyBjb25maWd1cmF0aW9uIGZvciB0cmFuc3BvcnQgc2VyaWFsaXphdGlvblwiKVxuICAgICAgfVxuXG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIHJlY29yZDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwcm9qZWN0ZWRSZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGhhc0V2ZW50RmlsdGVycykge1xuICAgICAgZGVsaXZlckJvZHkgPSB7XG4gICAgICAgIC4uLmRlbGl2ZXJCb2R5LFxuICAgICAgICBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5zZW5kTWVzc2FnZShkZWxpdmVyQm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgZnJvbSBgYnJvYWRjYXN0VG9DaGFubmVsYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGJyb2FkY2FzdCBtYXRjaGVzIHRoaXMgc3Vic2NyaWJlcidzIG1vZGVsLlxuICAgKi9cbiAgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpIHtcbiAgICByZXR1cm4gYnJvYWRjYXN0UGFyYW1zPy5tb2RlbCA9PT0gdGhpcy5fbW9kZWxOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBEZWJ1Zy1zYWZlIHN1YnNjcmlwdGlvbiBkZXRhaWxzLlxuICAgKi9cbiAgZGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBldmVudEZpbHRlcnMgPSB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdGllczogdGhpcy5wYXJhbXMuYWJpbGl0aWVzICE9PSB1bmRlZmluZWQsXG4gICAgICBldmVudEZpbHRlckNvdW50OiBldmVudEZpbHRlcnMubGVuZ3RoLFxuICAgICAgZGVzdHJveUV2ZW50RGVsaXZlcnk6IHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlLFxuICAgICAgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpLFxuICAgICAgcHJlbG9hZDogdGhpcy5wYXJhbXMucHJlbG9hZCAhPT0gdW5kZWZpbmVkLFxuICAgICAgcXVlcnlEYXRhOiB0aGlzLnBhcmFtcy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0ICE9PSB1bmRlZmluZWQsXG4gICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSAhPT0gdW5kZWZpbmVkLFxuICAgICAgdW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk6IHRoaXMucGFyYW1zLnVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID09PSB0cnVlLFxuICAgICAgd2l0aENvdW50OiB0aGlzLnBhcmFtcy53aXRoQ291bnQgIT09IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJlcXVlc3RlZCBmcm9udGVuZC1tb2RlbCBuYW1lIG9yIG51bGwuXG4gICAqL1xuICBfbW9kZWxOYW1lKCkge1xuICAgIHJldHVybiB0eXBlb2YgdGhpcy5wYXJhbXM/Lm1vZGVsID09PSBcInN0cmluZ1wiICYmIHRoaXMucGFyYW1zLm1vZGVsLmxlbmd0aCA+IDBcbiAgICAgID8gdGhpcy5wYXJhbXMubW9kZWxcbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHByb2plY3Rpb24gcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgc3Vic2NyaXB0aW9uIHJlcXVlc3RlZCBwZXItZXZlbnQgcmVjb3JkIHByb2plY3Rpb24uXG4gICAqL1xuICBfaGFzUHJvamVjdGlvblBhcmFtcygpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuc2VsZWN0ICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCB0aGlzLnBhcmFtcy5wcmVsb2FkICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLndpdGhDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCB0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgdGhpcy5wYXJhbXMucXVlcnlEYXRhICE9PSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBldmVudCBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgc3Vic2NyaXB0aW9uIHJlcXVlc3RlZCBldmVudCBxdWVyeSBmaWx0ZXJzLlxuICAgKi9cbiAgX2hhc0V2ZW50RmlsdGVyUGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLl9ldmVudEZpbHRlcnMoKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdW5maWx0ZXJlZCBldmVudCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB1bmZpbHRlcmVkIGNhbGxiYWNrcyBzaG91bGQgcmVjZWl2ZSBldmVyeSBldmVudC5cbiAgICovXG4gIF9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBkZXN0cm95IGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGlkLW9ubHkgZGVzdHJveSBldmVudHMgc2hvdWxkIGJlIGRlbGl2ZXJlZCB3aXRoIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkoKSB7XG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlbXX0gLSBWYWxpZCBldmVudCBmaWx0ZXJzLlxuICAgKi9cbiAgX2V2ZW50RmlsdGVycygpIHtcbiAgICBpZiAodGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzXCIpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV2ZW50RmlsdGVyID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChlbnRyeSlcbiAgICAgIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMoZXZlbnRGaWx0ZXIpLmZpbHRlcigoa2V5KSA9PiAhRVZFTlRfRklMVEVSX0tFWVMuaGFzKGtleSkpXG5cbiAgICAgIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgY2Fubm90IGluY2x1ZGUgJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBldmVudEZpbHRlci5rZXkgIT09IFwic3RyaW5nXCIgfHwgZXZlbnRGaWx0ZXIua2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyByZXF1aXJlIGEga2V5XCIpXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2FuaXRpemVkIGV2ZW50IGZpbHRlci5cbiAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gKi9cbiAgICAgIGNvbnN0IHNhbml0aXplZEV2ZW50RmlsdGVyID0ge2tleTogZXZlbnRGaWx0ZXIua2V5fVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIuam9pbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci5qb2lucyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIuam9pbnMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5zZWFyY2hlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLnNlYXJjaGVzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi8gKGV2ZW50RmlsdGVyLnNlYXJjaGVzKVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIud2hlcmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci53aGVyZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIud2hlcmUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBzYW5pdGl6ZWRFdmVudEZpbHRlclxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0Pn0gLSBGcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoID0gXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCJcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbENvbnRyb2xsZXJ9ID0gYXdhaXQgaW1wb3J0KGZyb250ZW5kTW9kZWxDb250cm9sbGVyUGF0aClcblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQ29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbcGFyYW1zXSAtIE9wdGlvbmFsIHBhcmFtcyBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBTeW50aGV0aWMgY29udHJvbGxlciB1c2VkIGZvciByZXNvdXJjZSBzZXJpYWxpemF0aW9uLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCBwYXJhbXMgPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoe1xuICAgICAgYWN0aW9uOiBcIndlYnNvY2tldEV2ZW50XCIsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgY29udHJvbGxlcjogXCJmcm9udGVuZC1tb2RlbHNcIixcbiAgICAgIHBhcmFtczoge1xuICAgICAgICBhYmlsaXRpZXM6IHRoaXMucGFyYW1zLmFiaWxpdGllcyxcbiAgICAgICAgam9pbnM6IHRoaXMucGFyYW1zLmpvaW5zLFxuICAgICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICAgIHByZWxvYWQ6IHRoaXMucGFyYW1zLnByZWxvYWQsXG4gICAgICAgIHF1ZXJ5RGF0YTogdGhpcy5wYXJhbXMucXVlcnlEYXRhLFxuICAgICAgICBzZWFyY2hlczogdGhpcy5wYXJhbXMuc2VhcmNoZXMsXG4gICAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0LFxuICAgICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSxcbiAgICAgICAgd2hlcmU6IHRoaXMucGFyYW1zLndoZXJlLFxuICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgIHdpdGhDb3VudDogdGhpcy5wYXJhbXMud2l0aENvdW50XG4gICAgICB9LFxuICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgIHZpZXdQYXRoOiBcIi9cIlxuICAgIH0pXG5cbiAgICBjb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gdGhpcy5fYWJpbGl0eSB8fCB1bmRlZmluZWRcblxuICAgIHJldHVybiBjb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGVuYW50IGZvciBldmVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyBfcmVzb2x2ZUV2ZW50VGVuYW50KGlkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCB3ZWJzb2NrZXQgZXZlbnQgdGVuYW50IHJlc29sdXRpb25cIn0sIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgc3Vic2NyaWJlLXRpbWUgdGVuYW50IHJlc29sdXRpb24gKGBXZWJzb2NrZXRTZXNzaW9uLl9yZXNvbHZlVGVuYW50YCk6XG4gICAgICAvLyBwYXNzIGBzdWJzY3JpcHRpb246IHtjaGFubmVsLCBwYXJhbXN9YCBzbyByZXNvbHZlcnMgdGhhdCBkZXJpdmUgc2NvcGUgZnJvbSB0aGVcbiAgICAgIC8vIHN1YnNjcmlwdGlvbiBiZWhhdmUgdGhlIHNhbWUgZm9yIGJyb2FkY2FzdHMgYXMgdGhleSBkaWQgYXQgYGNoYW5uZWwtc3Vic2NyaWJlYC5cbiAgICAgIC8vIFRoZSBzeW50aGV0aWMgcmVxdWVzdCBmb3J3YXJkcyB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSxcbiAgICAgIC8vIG1hdGNoaW5nIHRoaXMgY2hhbm5lbCdzIGFiaWxpdHkgcmVzb2x1dGlvbiBhYm92ZS5cbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQoe1xuICAgICAgICBwYXJhbXM6IHsuLi50aGlzLnBhcmFtcywgaWQsIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKX0sXG4gICAgICAgIHJlcXVlc3Q6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSksXG4gICAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgICAgc3Vic2NyaXB0aW9uOiB7Y2hhbm5lbDogRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgcGFyYW1zOiB0aGlzLnBhcmFtc31cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc3Vic2NyaWJlcidzIHRlbmFudCBmb3IgdGhlIGJyb2FkY2FzdCByZWNvcmQgYW5kIHJ1bnMgYGNhbGxiYWNrYCBpbnNpZGUgdGhhdCB0ZW5hbnRcbiAgICogY29udGV4dC4gQnJvYWRjYXN0IGRlbGl2ZXJ5IHJ1bnMgaW4gd2hhdGV2ZXIgYW1iaWVudCB0ZW5hbnQgY29udGV4dCB0aGUgcHVibGlzaGVyIGxlZnQgYmVoaW5kLiBGb3JcbiAgICogbXVsdGktdGVuYW50IHJlY29yZHMgdGhhdCBhbWJpZW50IHRlbmFudCBtYXkgaGF2ZSBiZWVuIHJlc29sdmVkIHdpdGhvdXQgdGhlIHN1YnNjcmliZXIncyByZXF1ZXN0XG4gICAqIChlLmcuIGEgcmVsYXkgZW5kcG9pbnQgb3IgYmFja2dyb3VuZCBqb2IgbXV0YXRpbmcgdGhlIHJvdyksIHNvIGl0IGxhY2tzIHRoZSBzdWJzY3JpYmVyJ3MgcGVyLXJlY29yZFxuICAgKiBhY2Nlc3MgZmxhZ3MgYW5kIHRoZSBwZXItZXZlbnQgYXV0aG9yaXphdGlvbiBxdWVyeSB3cm9uZ2x5IGZpbmRzIG5vdGhpbmcuIFJlLXJlc29sdmluZyB0aGUgdGVuYW50XG4gICAqIGZyb20gdGhlIGV2ZW50IHJlY29yZCBpZCBwbHVzIHRoZSBzdWJzY3JpYmVyJ3MgcmVxdWVzdCBtYWtlcyB0aGUgYXV0aG9yaXphdGlvbiBxdWVyaWVzIHJ1biBhZ2FpbnN0XG4gICAqIHRoZSBzdWJzY3JpYmVyJ3Mgb3duIHRlbmFudC9hYmlsaXR5IHNjb3BlLiBXaGVuIG5vIHRlbmFudCByZXNvbHZlcyAobm9uLW11bHRpdGVuYW50IGNvbmZpZ3MpLCB0aGVcbiAgICogY2FsbGJhY2sgcnVucyBkaXJlY3RseSBzbyB0aGUgYW1iaWVudCBjb250ZXh0IGlzIHByZXNlcnZlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdXRob3JpemVkLXF1ZXJ5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aEV2ZW50VGVuYW50KGlkLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uIHx8IHR5cGVvZiBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSBhd2FpdCB0aGlzLl9yZXNvbHZlRXZlbnRUZW5hbnQoaWQpXG5cbiAgICAvLyBBbHdheXMgZW50ZXIgYHJ1bldpdGhUZW5hbnRgLCBldmVuIHdoZW4gbm8gdGVuYW50IHJlc29sdmVkLiBCcm9hZGNhc3QgZmFuLW91dFxuICAgIC8vIHJ1bnMgaW4gdGhlIHB1Ymxpc2hlcidzIGFtYmllbnQgdGVuYW50IGNvbnRleHQ7IGZhbGxpbmcgYmFjayB0byBgY2FsbGJhY2soKWBcbiAgICAvLyB0aGVyZSB3b3VsZCBhdXRob3JpemUgYSBjcm9zcy10ZW5hbnQgcmVjb3JkIGFnYWluc3QgdGhlIHB1Ymxpc2hlcidzIHRlbmFudCBhbmRcbiAgICAvLyBjb3VsZCBsZWFrIGl0IHRvIGEgc3Vic2NyaWJlciB3aG9zZSBvd24gcmVzb2x2ZXIgY291bGQgbm90IHJlc29sdmUgaXQuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBldmVudCB0ZW5hbnRcIn0sIGNhbGxiYWNrKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgYnJvYWRjYXN0IHJlY29yZCBpcyB3aXRoaW4gdGhlIHN1YnNjcmliZXIncyBhdXRoZW50aWNhdGVkIGFiaWxpdHkgc2NvcGUuIFVzZWQgdG8gZ2F0ZVxuICAgKiB1bmZpbHRlcmVkL3VucHJvamVjdGVkIGNyZWF0ZS91cGRhdGUgZGVsaXZlcnkgc28gYSBzY29wZWQgdG9rZW4gbmV2ZXIgcmVjZWl2ZXMgYSByZWNvcmQgaXQgY2Fubm90IHJlYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFRydWUgd2hlbiB0aGUgcmVjb3JkIGlzIHJlYWRhYmxlIGJ5IHRoaXMgc3Vic2NyaXB0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2V2ZW50SXNBY2Nlc3NpYmxlKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgICBjb25zdCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEV2ZW50IGZpbHRlciBrZXlzIG1hdGNoZWQgYnkgdGhlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICAvKipcbiAgICAgKiBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gW11cblxuICAgIGZvciAoY29uc3QgZXZlbnRGaWx0ZXIgb2YgdGhpcy5fZXZlbnRGaWx0ZXJzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCB0aGlzLl9ldmVudE1hdGNoZXNGaWx0ZXIoe1xuICAgICAgICBGcm9udGVuZE1vZGVsQ29udHJvbGxlcixcbiAgICAgICAgZXZlbnRGaWx0ZXIsXG4gICAgICAgIGlkXG4gICAgICB9KVxuXG4gICAgICBpZiAobWF0Y2hlcykgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5wdXNoKGV2ZW50RmlsdGVyLmtleSlcbiAgICB9XG5cbiAgICByZXR1cm4gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgbWF0Y2hlcyBmaWx0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmlsdGVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gYXJncy5Gcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnl9IGFyZ3MuZXZlbnRGaWx0ZXIgLSBFdmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5pZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIHJlY29yZCBtYXRjaGVzIHRoZSBmaWx0ZXIuXG4gICAqL1xuICBhc3luYyBfZXZlbnRNYXRjaGVzRmlsdGVyKHtGcm9udGVuZE1vZGVsQ29udHJvbGxlciwgZXZlbnRGaWx0ZXIsIGlkfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlciwge1xuICAgICAgICBqb2luczogZXZlbnRGaWx0ZXIuam9pbnMsXG4gICAgICAgIHNlYXJjaGVzOiBldmVudEZpbHRlci5zZWFyY2hlcyxcbiAgICAgICAgd2hlcmU6IGV2ZW50RmlsdGVyLndoZXJlXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHdoZXJlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2hlcmUoKVxuICAgICAgY29uc3Qgam9pbnMgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxKb2lucygpXG4gICAgICAvLyBTdGFydCBmcm9tIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBhIGZpbHRlciBjYW4gb25seSBldmVyIG1hdGNoIHJlY29yZHMgdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcblxuICAgICAgaWYgKHdoZXJlKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgICAgaWYgKGpvaW5zKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuXG4gICAgICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxTZWFyY2hlcygpKSB7XG4gICAgICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJvamVjdGVkIHJlY29yZCBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgbnVsbD59IC0gU2VyaWFsaXplZCBwcm9qZWN0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIC8vIFJlbG9hZCB0aHJvdWdoIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBwcm9qZWN0ZWQgcmVjb3JkcyBhcmUgb25seSBldmVyIHNlbnQgZm9yXG4gICAgICAvLyByb3dzIHRoZSBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHByZWxvYWQgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcblxuICAgICAgaWYgKHByZWxvYWQpIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpKSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTcGVjLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IHtyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fT59ICovXG4gICAgICAgIGNvbnN0IHNwZWMgPSB7fVxuXG4gICAgICAgIHNwZWNbZW50cnkuYXR0cmlidXRlTmFtZV0gPSB7XG4gICAgICAgICAgcmVsYXRpb25zaGlwOiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZW50cnkud2hlcmUpIDogdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgcXVlcnkud2l0aENvdW50KHNwZWMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpXG5cbiAgICAgIGlmIChxdWVyeURhdGEgIT09IG51bGwpIHF1ZXJ5LnF1ZXJ5RGF0YShxdWVyeURhdGEpXG5cbiAgICAgIHF1ZXJ5ID0gY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxUcmFuc2xhdGVkQXR0cmlidXRlUHJlbG9hZHMoe3F1ZXJ5fSlcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCBxdWVyeS5maXJzdCgpXG5cbiAgICAgIGlmICghbW9kZWwpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKFttb2RlbF0pXG4gICAgICB9XG5cbiAgICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB1bmRlZmluZWRcblxuICAgICAgcmV0dXJuIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5zZXJpYWxpemUobW9kZWwsIFwiZmluZFwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWluaW1hbCBSZXF1ZXN0LWxpa2Ugc3R1YiB1c2VkIG9ubHkgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi4gQXZvaWRzXG4gICAqIGltcG9ydGluZyBgV2Vic29ja2V0UmVxdWVzdGAgaGVyZSBiZWNhdXNlIGl0cyBgbm9kZTpxdWVyeXN0cmluZ2BcbiAgICogZGVwZW5kZW5jeSB3b3VsZCBwdWxsIHNlcnZlci1vbmx5IGNvZGUgaW50byBicm93c2VyIGJ1bmRsZXMgdmlhXG4gICAqIHRoZSBgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVyc2AgaW1wb3J0IGNoYWluLlxuICAgKiBIZWFkZXIgbmFtZXMgYXJlIG5vcm1hbGl6ZWQgdG8gbG93ZXJjYXNlIHNvIGBoZWFkZXIoXCJjb29raWVcIilgXG4gICAqIGZpbmRzIGEgdmFsdWUgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoZSB1cGdyYWRlLXJlcXVlc3QgaGVhZGVyc1xuICAgKiBtYXAgdXNlcyBgXCJDb29raWVcImAgb3IgYFwiY29va2llXCJgLiBTZXNzaW9uIG1ldGFkYXRhIHN0YXlzIHNlcGFyYXRlXG4gICAqIGZyb20gaGVhZGVycyBhbmQgaXMgZXhwb3NlZCB0aHJvdWdoIGBtZXRhZGF0YSguLi4pYCBmb3IgYWJpbGl0eVxuICAgKiByZXNvbHZlcnMgdGhhdCBuZWVkIHdlYnNvY2tldC1kZWxpdmVyZWQgc2Vzc2lvbiBkYXRhLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3R9IFJlcXVlc3QtbGlrZSBvYmplY3QgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi5cbiAgICovXG4gIF9zeW50aGV0aWNSZXF1ZXN0KCkge1xuICAgIGNvbnN0IHVwZ3JhZGVSZXF1ZXN0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3R9ICovICh0aGlzLnNlc3Npb24udXBncmFkZVJlcXVlc3QpXG4gICAgY29uc3QgcmF3SGVhZGVycyA9IHR5cGVvZiB1cGdyYWRlUmVxdWVzdD8uaGVhZGVycyA9PT0gXCJmdW5jdGlvblwiID8gdXBncmFkZVJlcXVlc3QuaGVhZGVycygpIDoge31cbiAgICBjb25zdCBtZXRhZGF0YSA9IHR5cGVvZiB0aGlzLnNlc3Npb24uZ2V0TWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSgpIDoge31cbiAgICBjb25zdCByZW1vdGVBZGRyZXNzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5yZW1vdGVBZGRyZXNzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5yZW1vdGVBZGRyZXNzKCkgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBIZWFkZXIgbWFwLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD59ICovXG4gICAgY29uc3QgaGVhZGVyTWFwID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHJhd0hlYWRlcnMgfHwge30pKSB7XG4gICAgICBoZWFkZXJNYXBba2V5LnRvTG93ZXJDYXNlKCldID0gcmF3SGVhZGVyc1trZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcnM6ICgpID0+IGhlYWRlck1hcCxcbiAgICAgIGhlYWRlcjogKG5hbWUpID0+IGhlYWRlck1hcFtTdHJpbmcobmFtZSkudG9Mb3dlckNhc2UoKV0sXG4gICAgICBtZXRhZGF0YTogKGtleSkgPT4ga2V5ID09PSB1bmRlZmluZWQgPyB7Li4ubWV0YWRhdGF9IDogbWV0YWRhdGFba2V5XSxcbiAgICAgIHBhdGg6ICgpID0+IFwiL2Zyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgaHR0cE1ldGhvZDogKCkgPT4gXCJQT1NUXCIsXG4gICAgICByZW1vdGVBZGRyZXNzOiAoKSA9PiByZW1vdGVBZGRyZXNzLFxuICAgICAgb3JpZ2luOiAoKSA9PiBoZWFkZXJNYXAub3JpZ2luXG4gICAgfVxuICB9XG59XG4iXX0=