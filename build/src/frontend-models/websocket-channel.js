// @ts-check
import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
import Response from "../http-server/client/response.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceClassFromDefinition } from "./resource-definition.js";
import { serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyConditions } from "../utils/model-primary-key.js";
/**
 * Defines this typedef.
 * @typedef {{action?: string, id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, matchedEventFilterKeys?: string[], previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
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
 * `canSubscribe` resolves the caller's ability once and requires a read rule
 * for the requested model class. Create/update delivery then reloads each
 * record through that ability and serializes it through the subscribed
 * frontend resource. Subscriber-provided event filters can further narrow
 * those authorized events.
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
        const matchedEventFilterKeys = hasEventFilters
            ? await this._matchedEventFilterKeysForEventId(body.id, FrontendModelController)
            : [];
        const isIdentityTransition = body.action === "update" && body.previousId !== undefined && body.previousId !== null;
        if (hasEventFilters && matchedEventFilterKeys.length === 0 && !this._hasUnfilteredEventDelivery() && !isIdentityTransition) {
            return;
        }
        const projectedRecord = await this._projectedRecordForEventId(body.id, FrontendModelController);
        if (!projectedRecord) {
            return;
        }
        const configuration = this.session.configuration;
        if (!configuration) {
            throw new Error("Frontend model websocket channel has no configuration for transport serialization");
        }
        /**
         * Deliver body.
         * @type {FrontendModelLifecycleBroadcastBody} */
        let deliverBody = {
            ...body,
            record: /** @type {import("./query.js").FrontendModelTransportValue} */ (serializeFrontendModelTransportValue(projectedRecord, transportSerializationOptionsForConfiguration(configuration)))
        };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sUUFBUSxNQUFNLG1DQUFtQyxDQUFBO0FBQ3hELE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQ2pGLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRXZFOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO0FBRXhFLHFGQUFxRjtBQUNyRiwyRUFBMkU7QUFDM0UsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUV0RDs7Ozs7O0dBTUc7QUFDSCxTQUFTLHlDQUF5QyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRTtJQUMzRSxNQUFNLGtCQUFrQixHQUFHLHlCQUF5QixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUNwRSw0RkFBNEY7SUFDNUYsTUFBTSxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFN0IsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1FBQ3hFLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyw2QkFBNkIsQ0FBQyxhQUFhLENBQUMs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Q0FBQTtRQUN0SDs7bUVBRTJEO1FBQzNELE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDaEQsU0FBUyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNoRCxDQUFDO1FBRUQsT0FBTztZQUNMLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTO1lBQ3hCLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN2RCxRQUFRLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztZQUNwRSxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsa0JBQWtCO1lBQzlCLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNO1lBQ3hCLGFBQWEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhO1lBQ2xDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTTtTQUMvQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIGZyb20gXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiXG5pbXBvcnQgUmVzcG9uc2UgZnJvbSBcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbn0gZnJvbSBcIi4vcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3NlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3Rpb24/OiBzdHJpbmcsIGlkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1hdGNoZWRFdmVudEZpbHRlcktleXM/OiBzdHJpbmdbXSwgcHJldmlvdXNJZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCByZWNvcmQ/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgW2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM/OiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD4sIHJlbW90ZUFkZHJlc3M/OiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3RcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aGVhZGVyczogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCBoZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBtZXRhZGF0YTogKGtleT86IHN0cmluZykgPT4gUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCB1bmRlZmluZWQsIHBhdGg6ICgpID0+IHN0cmluZywgaHR0cE1ldGhvZDogKCkgPT4gc3RyaW5nLCByZW1vdGVBZGRyZXNzOiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQsIG9yaWdpbjogKCkgPT4gc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdFxuICovXG5jb25zdCBFVkVOVF9GSUxURVJfS0VZUyA9IG5ldyBTZXQoW1wiam9pbnNcIiwgXCJrZXlcIiwgXCJzZWFyY2hlc1wiLCBcIndoZXJlXCJdKVxuXG4vLyBNaXJyb3JzIEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgaW4gLi93ZWJzb2NrZXQtcHVibGlzaGVycy5qcywgZHVwbGljYXRlZCBoZXJlXG4vLyB0byBhdm9pZCB0aGUgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVycyBpbXBvcnQgY3ljbGUuXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJlc29sdmVzIGZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5IGF0dHJpYnV0ZXMgdG8gYmFja2luZyBkYXRhYmFzZSBjb2x1bW5zLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBwcmltYXJ5S2V5IC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gLSBCYWNraW5nIGNvbHVtbiBjb25kaXRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZCkge1xuICBjb25zdCByZXNvdXJjZUNvbmRpdGlvbnMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59ICovXG4gIGNvbnN0IGRhdGFiYXNlQ29uZGl0aW9ucyA9IHt9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZGl0aW9ucykpIHtcbiAgICBkYXRhYmFzZUNvbmRpdGlvbnNbTW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKV0gPSB2YWx1ZVxuICB9XG5cbiAgcmV0dXJuIGRhdGFiYXNlQ29uZGl0aW9uc1xufVxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUGVyLXNlc3Npb24gY2hhbm5lbCBzdWJzY3JpcHRpb24gZm9yIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBldmVudHMuXG4gKiBSZXBsYWNlcyB0aGUgbGVnYWN5IGBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbGAgKFBoYXNlIDMpLlxuICpcbiAqIGBjYW5TdWJzY3JpYmVgIHJlc29sdmVzIHRoZSBjYWxsZXIncyBhYmlsaXR5IG9uY2UgYW5kIHJlcXVpcmVzIGEgcmVhZCBydWxlXG4gKiBmb3IgdGhlIHJlcXVlc3RlZCBtb2RlbCBjbGFzcy4gQ3JlYXRlL3VwZGF0ZSBkZWxpdmVyeSB0aGVuIHJlbG9hZHMgZWFjaFxuICogcmVjb3JkIHRocm91Z2ggdGhhdCBhYmlsaXR5IGFuZCBzZXJpYWxpemVzIGl0IHRocm91Z2ggdGhlIHN1YnNjcmliZWRcbiAqIGZyb250ZW5kIHJlc291cmNlLiBTdWJzY3JpYmVyLXByb3ZpZGVkIGV2ZW50IGZpbHRlcnMgY2FuIGZ1cnRoZXIgbmFycm93XG4gKiB0aG9zZSBhdXRob3JpemVkIGV2ZW50cy5cbiAqXG4gKiBXaXJlOiBzdWJzY3JpYmUgd2l0aCBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWw6IE1vZGVsTmFtZX19KWAuXG4gKiBCYWNrZW5kIHB1Ymxpc2hlcyBge2FjdGlvbiwgaWQsIHJlY29yZH1gIHZpYVxuICogYGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHttb2RlbDogTW9kZWxOYW1lfSwgYm9keSlgO1xuICogYG1hdGNoZXMoKWAgcm91dGVzIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsIGV4dGVuZHMgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCB7XG4gIC8qKlxuICAgKiBBYmlsaXR5LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICBfYWJpbGl0eSA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBjYW4gc3Vic2NyaWJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgZnJvbnRlbmQtbW9kZWwgc3Vic2NyaXB0aW9uIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBjYW5TdWJzY3JpYmUoKSB7XG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5fbW9kZWxOYW1lKClcblxuICAgIGlmICghbW9kZWxOYW1lKSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuX21vZGVsQ2xhc3MobW9kZWxOYW1lKVxuXG4gICAgaWYgKCFNb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpXG4gICAgY29uc3QgYWJpbGl0eSA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUFiaWxpdHkoe1xuICAgICAgLy8gRm9yd2FyZCB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSBzbyB0b2tlbi1hdXRoZW50aWNhdGVkIGNsaWVudHNcbiAgICAgIC8vIHJlc29sdmUgdGhlIHNhbWUgYWJpbGl0eSB0aGV5IHdvdWxkIG92ZXIgSFRUUC4gV2l0aG91dCB0aGlzIG9ubHkgc2Vzc2lvbi9jb29raWUgYXV0aCBvbiB0aGVcbiAgICAgIC8vIHVwZ3JhZGUgcmVxdWVzdCB3b3JrcywgYW5kIHBhcmFtLWJhc2VkIGF1dGggKGxpa2UgYSBzY2FubmVyIHBhc3NpbmcgYW4gYXV0aGVudGljYXRpb25Ub2tlbilcbiAgICAgIC8vIGlzIGRyb3BwZWQg4oCUIGxlYXZpbmcgc3VjaCBzdWJzY3JpYmVycyB3aXRoIGEgZ3Vlc3QgYWJpbGl0eSBhbmQgbm8gcmVhZCBydWxlLlxuICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIG1vZGVsOiBtb2RlbE5hbWV9LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIH0pXG5cbiAgICBpZiAoIWFiaWxpdHkpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2FiaWxpdHkgPSBhYmlsaXR5XG5cbiAgICAvLyBMb2FkIHJlc291cmNlLWRlY2xhcmVkIHJ1bGVzIGZvciB0aGlzIG1vZGVsIGNsYXNzIGJlZm9yZSBjaGVja2luZyxcbiAgICAvLyBvdGhlcndpc2UgYHJ1bGVzRm9yYCByZXR1cm5zIGVtcHR5IGZvciBhYmlsaXRpZXMgd2hvc2UgcmVzb3VyY2VzXG4gICAgLy8gcmVnaXN0ZXIgcnVsZXMgbGF6aWx5IHZpYSBgYWJpbGl0aWVzKClgLlxuICAgIGFiaWxpdHkubG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MoTW9kZWxDbGFzcylcblxuICAgIGNvbnN0IHJlYWRSdWxlcyA9IGFiaWxpdHkucnVsZXNGb3Ioe2FjdGlvbjogXCJyZWFkXCIsIG1vZGVsQ2xhc3M6IE1vZGVsQ2xhc3N9KVxuXG4gICAgcmV0dXJuIHJlYWRSdWxlcy5zb21lKCgvKiogQHR5cGUge3tlZmZlY3Q6IHN0cmluZ319ICovIHJ1bGUpID0+IHJ1bGUuZWZmZWN0ID09PSBcImFsbG93XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBzdWJzY3JpcHRpb24gbmFtZSB0aHJvdWdoIGZyb250ZW5kIHJlc291cmNlcyBiZWZvcmUgZmFsbGluZyBiYWNrIHRvIGEgYmFja2luZyBtb2RlbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgcmVzb3VyY2UgbmFtZS5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgX21vZGVsQ2xhc3MobW9kZWxOYW1lKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClbbW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc291cmNlRGVmaW5pdGlvbiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSA6IG51bGxcblxuICAgICAgaWYgKHJlc291cmNlQ2xhc3M/Lk1vZGVsQ2xhc3MpIHJldHVybiByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIH1cblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpW21vZGVsTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7e2V2ZW50SWQ/OiBzdHJpbmd9fSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGl2ZXJ5LlxuICAgKi9cbiAgYXN5bmMgZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgYXdhaXQgdGhpcy5fZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt7ZXZlbnRJZD86IHN0cmluZ319IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBfZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgaGFzRXZlbnRGaWx0ZXJzID0gdGhpcy5faGFzRXZlbnRGaWx0ZXJQYXJhbXMoKVxuXG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYm9keS5hY3Rpb24gPT09IFwiZGVzdHJveVwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmlkID09PSB1bmRlZmluZWQgfHwgYm9keS5pZCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gaGFzRXZlbnRGaWx0ZXJzXG4gICAgICA/IGF3YWl0IHRoaXMuX21hdGNoZWRFdmVudEZpbHRlcktleXNGb3JFdmVudElkKGJvZHkuaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuICAgICAgOiBbXVxuICAgIGNvbnN0IGlzSWRlbnRpdHlUcmFuc2l0aW9uID0gYm9keS5hY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgYm9keS5wcmV2aW91c0lkICE9PSB1bmRlZmluZWQgJiYgYm9keS5wcmV2aW91c0lkICE9PSBudWxsXG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzICYmIG1hdGNoZWRFdmVudEZpbHRlcktleXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpICYmICFpc0lkZW50aXR5VHJhbnNpdGlvbikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcHJvamVjdGVkUmVjb3JkID0gYXdhaXQgdGhpcy5fcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgIGlmICghcHJvamVjdGVkUmVjb3JkKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgaGFzIG5vIGNvbmZpZ3VyYXRpb24gZm9yIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsaXZlciBib2R5LlxuICAgICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gKi9cbiAgICBsZXQgZGVsaXZlckJvZHkgPSB7XG4gICAgICAuLi5ib2R5LFxuICAgICAgcmVjb3JkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByb2plY3RlZFJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKSlcbiAgICB9XG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnNlbmRNZXNzYWdlKGRlbGl2ZXJCb2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IGJyb2FkY2FzdFBhcmFtcyAtIFBhcmFtcyBmcm9tIGBicm9hZGNhc3RUb0NoYW5uZWxgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgYnJvYWRjYXN0IG1hdGNoZXMgdGhpcyBzdWJzY3JpYmVyJ3MgbW9kZWwuXG4gICAqL1xuICBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcykge1xuICAgIHJldHVybiBicm9hZGNhc3RQYXJhbXM/Lm1vZGVsID09PSB0aGlzLl9tb2RlbE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0aWVzOiB0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCxcbiAgICAgIGV2ZW50RmlsdGVyQ291bnQ6IGV2ZW50RmlsdGVycy5sZW5ndGgsXG4gICAgICBkZXN0cm95RXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICBwcmVsb2FkOiB0aGlzLnBhcmFtcy5wcmVsb2FkICE9PSB1bmRlZmluZWQsXG4gICAgICBxdWVyeURhdGE6IHRoaXMucGFyYW1zLnF1ZXJ5RGF0YSAhPT0gdW5kZWZpbmVkLFxuICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWQsXG4gICAgICB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICB3aXRoQ291bnQ6IHRoaXMucGFyYW1zLndpdGhDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVxdWVzdGVkIGZyb250ZW5kLW1vZGVsIG5hbWUgb3IgbnVsbC5cbiAgICovXG4gIF9tb2RlbE5hbWUoKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGlzLnBhcmFtcz8ubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5wYXJhbXMubW9kZWwubGVuZ3RoID4gMFxuICAgICAgPyB0aGlzLnBhcmFtcy5tb2RlbFxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgZXZlbnQgZmlsdGVyIHBhcmFtcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIHN1YnNjcmlwdGlvbiByZXF1ZXN0ZWQgZXZlbnQgcXVlcnkgZmlsdGVycy5cbiAgICovXG4gIF9oYXNFdmVudEZpbHRlclBhcmFtcygpIHtcbiAgICByZXR1cm4gdGhpcy5fZXZlbnRGaWx0ZXJzKCkubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHVuZmlsdGVyZWQgZXZlbnQgZGVsaXZlcnkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdW5maWx0ZXJlZCBjYWxsYmFja3Mgc2hvdWxkIHJlY2VpdmUgZXZlcnkgZXZlbnQuXG4gICAqL1xuICBfaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSB7XG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLnVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgZGVzdHJveSBldmVudCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpZC1vbmx5IGRlc3Ryb3kgZXZlbnRzIHNob3VsZCBiZSBkZWxpdmVyZWQgd2l0aCBldmVudCBmaWx0ZXJzLlxuICAgKi9cbiAgX2hhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy5kZXN0cm95RXZlbnREZWxpdmVyeSA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgZmlsdGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5W119IC0gVmFsaWQgZXZlbnQgZmlsdGVycy5cbiAgICovXG4gIF9ldmVudEZpbHRlcnMoKSB7XG4gICAgaWYgKHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZW50cnkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIG11c3QgYmUgb2JqZWN0c1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudEZpbHRlciA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpXG4gICAgICBjb25zdCB1bmtub3duS2V5cyA9IE9iamVjdC5rZXlzKGV2ZW50RmlsdGVyKS5maWx0ZXIoKGtleSkgPT4gIUVWRU5UX0ZJTFRFUl9LRVlTLmhhcyhrZXkpKVxuXG4gICAgICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIGNhbm5vdCBpbmNsdWRlICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfWApXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgZXZlbnRGaWx0ZXIua2V5ICE9PSBcInN0cmluZ1wiIHx8IGV2ZW50RmlsdGVyLmtleS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgcmVxdWlyZSBhIGtleVwiKVxuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIFNhbml0aXplZCBldmVudCBmaWx0ZXIuXG4gICAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnl9ICovXG4gICAgICBjb25zdCBzYW5pdGl6ZWRFdmVudEZpbHRlciA9IHtrZXk6IGV2ZW50RmlsdGVyLmtleX1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLmpvaW5zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIuam9pbnMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKGV2ZW50RmlsdGVyLmpvaW5zKVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIuc2VhcmNoZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci5zZWFyY2hlcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsU2VhcmNoW119ICovIChldmVudEZpbHRlci5zZWFyY2hlcylcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLndoZXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIud2hlcmUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKGV2ZW50RmlsdGVyLndoZXJlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gc2FuaXRpemVkRXZlbnRGaWx0ZXJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdD59IC0gRnJvbnRlbmQgbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICovXG4gIGFzeW5jIF9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxDb250cm9sbGVyUGF0aCA9IFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiXG4gICAgY29uc3Qge2RlZmF1bHQ6IEZyb250ZW5kTW9kZWxDb250cm9sbGVyfSA9IGF3YWl0IGltcG9ydChmcm9udGVuZE1vZGVsQ29udHJvbGxlclBhdGgpXG5cbiAgICByZXR1cm4gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3BhcmFtc10gLSBPcHRpb25hbCBwYXJhbXMgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IC0gU3ludGhldGljIGNvbnRyb2xsZXIgdXNlZCBmb3IgcmVzb3VyY2Ugc2VyaWFsaXphdGlvbi5cbiAgICovXG4gIF9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlciwgcGFyYW1zID0ge30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEZyb250ZW5kTW9kZWxDb250cm9sbGVyKHtcbiAgICAgIGFjdGlvbjogXCJ3ZWJzb2NrZXRFdmVudFwiLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGNvbnRyb2xsZXI6IFwiZnJvbnRlbmQtbW9kZWxzXCIsXG4gICAgICBwYXJhbXM6IHtcbiAgICAgICAgYWJpbGl0aWVzOiB0aGlzLnBhcmFtcy5hYmlsaXRpZXMsXG4gICAgICAgIGpvaW5zOiB0aGlzLnBhcmFtcy5qb2lucyxcbiAgICAgICAgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpLFxuICAgICAgICBwcmVsb2FkOiB0aGlzLnBhcmFtcy5wcmVsb2FkLFxuICAgICAgICBxdWVyeURhdGE6IHRoaXMucGFyYW1zLnF1ZXJ5RGF0YSxcbiAgICAgICAgc2VhcmNoZXM6IHRoaXMucGFyYW1zLnNlYXJjaGVzLFxuICAgICAgICBzZWxlY3Q6IHRoaXMucGFyYW1zLnNlbGVjdCxcbiAgICAgICAgc2VsZWN0c0V4dHJhOiB0aGlzLnBhcmFtcy5zZWxlY3RzRXh0cmEsXG4gICAgICAgIHdoZXJlOiB0aGlzLnBhcmFtcy53aGVyZSxcbiAgICAgICAgLi4ucGFyYW1zLFxuICAgICAgICB3aXRoQ291bnQ6IHRoaXMucGFyYW1zLndpdGhDb3VudFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSksXG4gICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSksXG4gICAgICB2aWV3UGF0aDogXCIvXCJcbiAgICB9KVxuXG4gICAgY29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHRoaXMuX2FiaWxpdHkgfHwgdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gY29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRlbmFudCBmb3IgZXZlbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZWQgdGVuYW50LlxuICAgKi9cbiAgYXN5bmMgX3Jlc29sdmVFdmVudFRlbmFudChpZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudCByZXNvbHV0aW9uXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNaXJyb3IgdGhlIHN1YnNjcmliZS10aW1lIHRlbmFudCByZXNvbHV0aW9uIChgV2Vic29ja2V0U2Vzc2lvbi5fcmVzb2x2ZVRlbmFudGApOlxuICAgICAgLy8gcGFzcyBgc3Vic2NyaXB0aW9uOiB7Y2hhbm5lbCwgcGFyYW1zfWAgc28gcmVzb2x2ZXJzIHRoYXQgZGVyaXZlIHNjb3BlIGZyb20gdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24gYmVoYXZlIHRoZSBzYW1lIGZvciBicm9hZGNhc3RzIGFzIHRoZXkgZGlkIGF0IGBjaGFubmVsLXN1YnNjcmliZWAuXG4gICAgICAvLyBUaGUgc3ludGhldGljIHJlcXVlc3QgZm9yd2FyZHMgdGhlIHN1YnNjcmliZXIncyBwYXJhbXMgKGUuZy4gYXV0aGVudGljYXRpb25Ub2tlbiksXG4gICAgICAvLyBtYXRjaGluZyB0aGlzIGNoYW5uZWwncyBhYmlsaXR5IHJlc29sdXRpb24gYWJvdmUuXG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIGlkLCBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCl9LFxuICAgICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpLFxuICAgICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSksXG4gICAgICAgIHN1YnNjcmlwdGlvbjoge2NoYW5uZWw6IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHBhcmFtczogdGhpcy5wYXJhbXN9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN1YnNjcmliZXIncyB0ZW5hbnQgZm9yIHRoZSBicm9hZGNhc3QgcmVjb3JkIGFuZCBydW5zIGBjYWxsYmFja2AgaW5zaWRlIHRoYXQgdGVuYW50XG4gICAqIGNvbnRleHQuIEJyb2FkY2FzdCBkZWxpdmVyeSBydW5zIGluIHdoYXRldmVyIGFtYmllbnQgdGVuYW50IGNvbnRleHQgdGhlIHB1Ymxpc2hlciBsZWZ0IGJlaGluZC4gRm9yXG4gICAqIG11bHRpLXRlbmFudCByZWNvcmRzIHRoYXQgYW1iaWVudCB0ZW5hbnQgbWF5IGhhdmUgYmVlbiByZXNvbHZlZCB3aXRob3V0IHRoZSBzdWJzY3JpYmVyJ3MgcmVxdWVzdFxuICAgKiAoZS5nLiBhIHJlbGF5IGVuZHBvaW50IG9yIGJhY2tncm91bmQgam9iIG11dGF0aW5nIHRoZSByb3cpLCBzbyBpdCBsYWNrcyB0aGUgc3Vic2NyaWJlcidzIHBlci1yZWNvcmRcbiAgICogYWNjZXNzIGZsYWdzIGFuZCB0aGUgcGVyLWV2ZW50IGF1dGhvcml6YXRpb24gcXVlcnkgd3JvbmdseSBmaW5kcyBub3RoaW5nLiBSZS1yZXNvbHZpbmcgdGhlIHRlbmFudFxuICAgKiBmcm9tIHRoZSBldmVudCByZWNvcmQgaWQgcGx1cyB0aGUgc3Vic2NyaWJlcidzIHJlcXVlc3QgbWFrZXMgdGhlIGF1dGhvcml6YXRpb24gcXVlcmllcyBydW4gYWdhaW5zdFxuICAgKiB0aGUgc3Vic2NyaWJlcidzIG93biB0ZW5hbnQvYWJpbGl0eSBzY29wZS4gV2hlbiBubyB0ZW5hbnQgcmVzb2x2ZXMgKG5vbi1tdWx0aXRlbmFudCBjb25maWdzKSwgdGhlXG4gICAqIGNhbGxiYWNrIHJ1bnMgZGlyZWN0bHkgc28gdGhlIGFtYmllbnQgY29udGV4dCBpcyBwcmVzZXJ2ZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQXV0aG9yaXplZC1xdWVyeSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhFdmVudFRlbmFudChpZCwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbiB8fCB0eXBlb2YgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50ID0gYXdhaXQgdGhpcy5fcmVzb2x2ZUV2ZW50VGVuYW50KGlkKVxuXG4gICAgLy8gQWx3YXlzIGVudGVyIGBydW5XaXRoVGVuYW50YCwgZXZlbiB3aGVuIG5vIHRlbmFudCByZXNvbHZlZC4gQnJvYWRjYXN0IGZhbi1vdXRcbiAgICAvLyBydW5zIGluIHRoZSBwdWJsaXNoZXIncyBhbWJpZW50IHRlbmFudCBjb250ZXh0OyBmYWxsaW5nIGJhY2sgdG8gYGNhbGxiYWNrKClgXG4gICAgLy8gdGhlcmUgd291bGQgYXV0aG9yaXplIGEgY3Jvc3MtdGVuYW50IHJlY29yZCBhZ2FpbnN0IHRoZSBwdWJsaXNoZXIncyB0ZW5hbnQgYW5kXG4gICAgLy8gY291bGQgbGVhayBpdCB0byBhIHN1YnNjcmliZXIgd2hvc2Ugb3duIHJlc29sdmVyIGNvdWxkIG5vdCByZXNvbHZlIGl0LlxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCB3ZWJzb2NrZXQgZXZlbnQgdGVuYW50XCJ9LCBjYWxsYmFjaylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEV2ZW50IGZpbHRlciBrZXlzIG1hdGNoZWQgYnkgdGhlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICAvKipcbiAgICAgKiBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gW11cblxuICAgIGZvciAoY29uc3QgZXZlbnRGaWx0ZXIgb2YgdGhpcy5fZXZlbnRGaWx0ZXJzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCB0aGlzLl9ldmVudE1hdGNoZXNGaWx0ZXIoe1xuICAgICAgICBGcm9udGVuZE1vZGVsQ29udHJvbGxlcixcbiAgICAgICAgZXZlbnRGaWx0ZXIsXG4gICAgICAgIGlkXG4gICAgICB9KVxuXG4gICAgICBpZiAobWF0Y2hlcykgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5wdXNoKGV2ZW50RmlsdGVyLmtleSlcbiAgICB9XG5cbiAgICByZXR1cm4gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgbWF0Y2hlcyBmaWx0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmlsdGVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gYXJncy5Gcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnl9IGFyZ3MuZXZlbnRGaWx0ZXIgLSBFdmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5pZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIHJlY29yZCBtYXRjaGVzIHRoZSBmaWx0ZXIuXG4gICAqL1xuICBhc3luYyBfZXZlbnRNYXRjaGVzRmlsdGVyKHtGcm9udGVuZE1vZGVsQ29udHJvbGxlciwgZXZlbnRGaWx0ZXIsIGlkfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlciwge1xuICAgICAgICBqb2luczogZXZlbnRGaWx0ZXIuam9pbnMsXG4gICAgICAgIHNlYXJjaGVzOiBldmVudEZpbHRlci5zZWFyY2hlcyxcbiAgICAgICAgd2hlcmU6IGV2ZW50RmlsdGVyLndoZXJlXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHdoZXJlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2hlcmUoKVxuICAgICAgY29uc3Qgam9pbnMgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxKb2lucygpXG4gICAgICAvLyBTdGFydCBmcm9tIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBhIGZpbHRlciBjYW4gb25seSBldmVyIG1hdGNoIHJlY29yZHMgdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcblxuICAgICAgaWYgKHdoZXJlKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgICAgaWYgKGpvaW5zKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuXG4gICAgICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxTZWFyY2hlcygpKSB7XG4gICAgICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJvamVjdGVkIHJlY29yZCBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgbnVsbD59IC0gU2VyaWFsaXplZCBwcm9qZWN0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIC8vIFJlbG9hZCB0aHJvdWdoIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBwcm9qZWN0ZWQgcmVjb3JkcyBhcmUgb25seSBldmVyIHNlbnQgZm9yXG4gICAgICAvLyByb3dzIHRoZSBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHByZWxvYWQgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcblxuICAgICAgaWYgKHByZWxvYWQpIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpKSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTcGVjLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IHtyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fT59ICovXG4gICAgICAgIGNvbnN0IHNwZWMgPSB7fVxuXG4gICAgICAgIHNwZWNbZW50cnkuYXR0cmlidXRlTmFtZV0gPSB7XG4gICAgICAgICAgcmVsYXRpb25zaGlwOiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZW50cnkud2hlcmUpIDogdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgcXVlcnkud2l0aENvdW50KHNwZWMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpXG5cbiAgICAgIGlmIChxdWVyeURhdGEgIT09IG51bGwpIHF1ZXJ5LnF1ZXJ5RGF0YShxdWVyeURhdGEpXG5cbiAgICAgIHF1ZXJ5ID0gY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxUcmFuc2xhdGVkQXR0cmlidXRlUHJlbG9hZHMoe3F1ZXJ5fSlcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCBxdWVyeS5maXJzdCgpXG5cbiAgICAgIGlmICghbW9kZWwpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKFttb2RlbF0pXG4gICAgICB9XG5cbiAgICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB1bmRlZmluZWRcblxuICAgICAgcmV0dXJuIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5zZXJpYWxpemUobW9kZWwsIFwiZmluZFwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWluaW1hbCBSZXF1ZXN0LWxpa2Ugc3R1YiB1c2VkIG9ubHkgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi4gQXZvaWRzXG4gICAqIGltcG9ydGluZyBgV2Vic29ja2V0UmVxdWVzdGAgaGVyZSBiZWNhdXNlIGl0cyBgbm9kZTpxdWVyeXN0cmluZ2BcbiAgICogZGVwZW5kZW5jeSB3b3VsZCBwdWxsIHNlcnZlci1vbmx5IGNvZGUgaW50byBicm93c2VyIGJ1bmRsZXMgdmlhXG4gICAqIHRoZSBgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVyc2AgaW1wb3J0IGNoYWluLlxuICAgKiBIZWFkZXIgbmFtZXMgYXJlIG5vcm1hbGl6ZWQgdG8gbG93ZXJjYXNlIHNvIGBoZWFkZXIoXCJjb29raWVcIilgXG4gICAqIGZpbmRzIGEgdmFsdWUgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoZSB1cGdyYWRlLXJlcXVlc3QgaGVhZGVyc1xuICAgKiBtYXAgdXNlcyBgXCJDb29raWVcImAgb3IgYFwiY29va2llXCJgLiBTZXNzaW9uIG1ldGFkYXRhIHN0YXlzIHNlcGFyYXRlXG4gICAqIGZyb20gaGVhZGVycyBhbmQgaXMgZXhwb3NlZCB0aHJvdWdoIGBtZXRhZGF0YSguLi4pYCBmb3IgYWJpbGl0eVxuICAgKiByZXNvbHZlcnMgdGhhdCBuZWVkIHdlYnNvY2tldC1kZWxpdmVyZWQgc2Vzc2lvbiBkYXRhLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3R9IFJlcXVlc3QtbGlrZSBvYmplY3QgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi5cbiAgICovXG4gIF9zeW50aGV0aWNSZXF1ZXN0KCkge1xuICAgIGNvbnN0IHVwZ3JhZGVSZXF1ZXN0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3R9ICovICh0aGlzLnNlc3Npb24udXBncmFkZVJlcXVlc3QpXG4gICAgY29uc3QgcmF3SGVhZGVycyA9IHR5cGVvZiB1cGdyYWRlUmVxdWVzdD8uaGVhZGVycyA9PT0gXCJmdW5jdGlvblwiID8gdXBncmFkZVJlcXVlc3QuaGVhZGVycygpIDoge31cbiAgICBjb25zdCBtZXRhZGF0YSA9IHR5cGVvZiB0aGlzLnNlc3Npb24uZ2V0TWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSgpIDoge31cbiAgICBjb25zdCByZW1vdGVBZGRyZXNzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5yZW1vdGVBZGRyZXNzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5yZW1vdGVBZGRyZXNzKCkgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBIZWFkZXIgbWFwLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD59ICovXG4gICAgY29uc3QgaGVhZGVyTWFwID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHJhd0hlYWRlcnMgfHwge30pKSB7XG4gICAgICBoZWFkZXJNYXBba2V5LnRvTG93ZXJDYXNlKCldID0gcmF3SGVhZGVyc1trZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcnM6ICgpID0+IGhlYWRlck1hcCxcbiAgICAgIGhlYWRlcjogKG5hbWUpID0+IGhlYWRlck1hcFtTdHJpbmcobmFtZSkudG9Mb3dlckNhc2UoKV0sXG4gICAgICBtZXRhZGF0YTogKGtleSkgPT4ga2V5ID09PSB1bmRlZmluZWQgPyB7Li4ubWV0YWRhdGF9IDogbWV0YWRhdGFba2V5XSxcbiAgICAgIHBhdGg6ICgpID0+IFwiL2Zyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgaHR0cE1ldGhvZDogKCkgPT4gXCJQT1NUXCIsXG4gICAgICByZW1vdGVBZGRyZXNzOiAoKSA9PiByZW1vdGVBZGRyZXNzLFxuICAgICAgb3JpZ2luOiAoKSA9PiBoZWFkZXJNYXAub3JpZ2luXG4gICAgfVxuICB9XG59XG4iXX0=