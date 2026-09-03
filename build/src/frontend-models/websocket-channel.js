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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sUUFBUSxNQUFNLG1DQUFtQyxDQUFBO0FBQ3hELE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLDBCQUEwQixDQUFBO0FBQ2pGLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRXZFOzs7R0FHRztBQUNIOzs7R0FHRztBQUNIOzs7R0FHRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO0FBRXhFLHFGQUFxRjtBQUNyRiwyRUFBMkU7QUFDM0UsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQTtBQUV0RDs7Ozs7O0dBTUc7QUFDSCxTQUFTLHlDQUF5QyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRTtJQUMzRSxNQUFNLGtCQUFrQixHQUFHLHlCQUF5QixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUNwRSw0RkFBNEY7SUFDNUYsTUFBTSxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFN0IsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1FBQ3hFLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyw2QkFBNkIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQTtJQUNyRixDQUFDO0lBRUQsT0FBTyxrQkFBa0IsQ0FBQTtBQUMzQixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsNkNBQTZDLENBQUMsYUFBYTtJQUNsRSxPQUFPO1FBQ0wsUUFBUSxFQUFFLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUM7S0FDM0UsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyw2QkFBOEIsU0FBUSx5QkFBeUI7SUFDbEY7O3NFQUVrRTtJQUNsRSxRQUFRLEdBQUcsSUFBSSxDQUFBO0lBRWY7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFlBQVk7UUFDaEIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBRW5DLElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFDNUIsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBRXBCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFBO1FBQ2hELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFOUMsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU3QixNQUFNLE9BQU8sR0FBRyxpRUFBaUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLENBQUE7UUFDNUcsTUFBTSxPQUFPLEdBQUcsTUFBTSxhQUFhLENBQUMsY0FBYyxDQUFDO1lBQ2pELDRGQUE0RjtZQUM1Riw4RkFBOEY7WUFDOUYsOEZBQThGO1lBQzlGLCtFQUErRTtZQUMvRSxNQUFNLEVBQUUsRUFBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBQztZQUMxQyxPQUFPO1lBQ1AsUUFBUSxFQUFFLElBQUksUUFBUSxDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUM7U0FDeEMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUMxQixJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQTtRQUV2QixxRUFBcUU7UUFDckUsbUVBQW1FO1FBQ25FLDJDQUEyQztRQUMzQyxPQUFPLENBQUMsMEJBQTBCLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFOUMsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFFNUUsT0FBTyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsK0JBQStCLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsTUFBTSxLQUFLLE9BQU8sQ0FBQyxDQUFBO0lBQzFGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsV0FBVyxDQUFDLFNBQVM7UUFDbkIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUE7UUFFaEQsS0FBSyxNQUFNLGNBQWMsSUFBSSxhQUFhLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1lBQ2hFLE1BQU0sa0JBQWtCLEdBQUcsbURBQW1ELENBQUMsY0FBYyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUE7WUFDekcsTUFBTSxhQUFhLEdBQUcsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUU5RyxJQUFJLGFBQWEsRUFBRSxVQUFVO2dCQUFFLE9BQU8sYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ2xFLENBQUM7UUFFRCxPQUFPLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLElBQUk7UUFDL0IsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO0lBQzFDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsSUFBSTtRQUNoQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUVwRCxJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyRCwrRkFBK0Y7WUFDL0YsOEZBQThGO1lBQzlGLDZGQUE2RjtZQUM3RixJQUFJLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLFFBQVEsQ0FBQyxJQUFJLElBQUksQ0FBQyxFQUFFLEtBQUssU0FBUyxJQUFJLElBQUksQ0FBQyxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQzVJLE1BQU0sdUJBQXVCLEdBQUcsTUFBTSxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtnQkFFMUUsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsdUJBQXVCLENBQUM7b0JBQUUsT0FBTTtZQUM5RSxDQUFDO1lBRUQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUE7WUFDNUIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3RDLElBQUksQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLDJCQUEyQixFQUFFO2dCQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO1lBQ3hGLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLHdCQUF3QixFQUFFLElBQUksSUFBSSxDQUFDLDJCQUEyQixFQUFFO2dCQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO1lBQzNILE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsRUFBRSxLQUFLLFNBQVMsSUFBSSxJQUFJLENBQUMsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQzlDLElBQUksQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLDJCQUEyQixFQUFFO2dCQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO1lBQ3hGLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSx1QkFBdUIsR0FBRyxNQUFNLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFBO1FBQzFFLE1BQU0sc0JBQXNCLEdBQUcsTUFBTSxJQUFJLENBQUMsaUNBQWlDLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSx1QkFBdUIsQ0FBQyxDQUFBO1FBRTdHLElBQUksZUFBZSxJQUFJLHNCQUFzQixDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsMkJBQTJCLEVBQUUsRUFBRSxDQUFDO1lBQ2xHLE9BQU07UUFDUixDQUFDO1FBRUQ7O3lEQUVpRDtRQUNqRCxJQUFJLFdBQVcsR0FBRyxJQUFJLENBQUE7UUFFdEIsSUFBSSxJQUFJLENBQUMsb0JBQW9CLEVBQUUsRUFBRSxDQUFDO1lBQ2hDLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsdUJBQXVCLENBQUMsQ0FBQTtZQUUvRixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ3JCLE9BQU07WUFDUixDQUFDO1lBRUQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUE7WUFFaEQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO2dCQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLG1GQUFtRixDQUFDLENBQUE7WUFDdEcsQ0FBQztZQUVELFdBQVcsR0FBRztnQkFDWixHQUFHLFdBQVc7Z0JBQ2QsTUFBTSxFQUFFLCtEQUErRCxDQUFDLENBQUMsb0NBQW9DLENBQUMsZUFBZSxFQUFFLDZDQUE2QyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUM7YUFDOUwsQ0FBQTtRQUNILENBQUM7UUFFRCxJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQ3BCLFdBQVcsR0FBRztnQkFDWixHQUFHLFdBQVc7Z0JBQ2Qsc0JBQXNCO2FBQ3ZCLENBQUE7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxPQUFPLENBQUMsZUFBZTtRQUNyQixPQUFPLGVBQWUsRUFBRSxLQUFLLEtBQUssSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO0lBQ3JELENBQUM7SUFFRDs7O09BR0c7SUFDSCxhQUFhO1FBQ1gsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBRXpDLE9BQU87WUFDTCxTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEtBQUssU0FBUztZQUM5QyxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsTUFBTTtZQUNyQyxvQkFBb0IsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLG9CQUFvQixLQUFLLElBQUk7WUFDL0QsS0FBSyxFQUFFLElBQUksQ0FBQyxVQUFVLEVBQUU7WUFDeEIsT0FBTyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxLQUFLLFNBQVM7WUFDMUMsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxLQUFLLFNBQVM7WUFDOUMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLFNBQVM7WUFDeEMsWUFBWSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxLQUFLLFNBQVM7WUFDcEQsdUJBQXVCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyx1QkFBdUIsS0FBSyxJQUFJO1lBQ3JFLFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsS0FBSyxTQUFTO1NBQy9DLENBQUE7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssS0FBSyxRQUFRLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7WUFDM0UsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSztZQUNuQixDQUFDLENBQUMsSUFBSSxDQUFBO0lBQ1YsQ0FBQztJQUVEOzs7T0FHRztJQUNILG9CQUFvQjtRQUNsQixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLFNBQVM7ZUFDbEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEtBQUssU0FBUztlQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sS0FBSyxTQUFTO2VBQ2pDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxLQUFLLFNBQVM7ZUFDbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEtBQUssU0FBUztlQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILHFCQUFxQjtRQUNuQixPQUFPLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7O09BR0c7SUFDSCwyQkFBMkI7UUFDekIsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLHVCQUF1QixLQUFLLElBQUksQ0FBQTtJQUNyRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsd0JBQXdCO1FBQ3RCLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsS0FBSyxJQUFJLENBQUE7SUFDbEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILGFBQWE7UUFDWCxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxLQUFLLFNBQVM7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUNyRCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFBO1FBQ2pFLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQzVDLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDaEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFBO1lBQ3hFLENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBRyw0REFBNEQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3hGLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFBO1lBRXpGLElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDakcsQ0FBQztZQUVELElBQUksT0FBTyxXQUFXLENBQUMsR0FBRyxLQUFLLFFBQVEsSUFBSSxXQUFXLENBQUMsR0FBRyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDeEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFBO1lBQ3RFLENBQUM7WUFFRDs7bUZBRXVFO1lBQ3ZFLE1BQU0sb0JBQW9CLEdBQUcsRUFBQyxHQUFHLEVBQUUsV0FBVyxDQUFDLEdBQUcsRUFBQyxDQUFBO1lBRW5ELElBQUksV0FBVyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDcEMsb0JBQW9CLENBQUMsS0FBSyxHQUFHLCtFQUErRSxDQUFDLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2xJLENBQUM7WUFFRCxJQUFJLFdBQVcsQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3ZDLG9CQUFvQixDQUFDLFFBQVEsR0FBRyx5REFBeUQsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNsSCxDQUFDO1lBRUQsSUFBSSxXQUFXLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUNwQyxvQkFBb0IsQ0FBQyxLQUFLLEdBQUcsK0VBQStFLENBQUMsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDbEksQ0FBQztZQUVELE9BQU8sb0JBQW9CLENBQUE7UUFDN0IsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLDZCQUE2QjtRQUNqQyxNQUFNLDJCQUEyQixHQUFHLGlDQUFpQyxDQUFBO1FBQ3JFLE1BQU0sRUFBQyxPQUFPLEVBQUUsdUJBQXVCLEVBQUMsR0FBRyxNQUFNLE1BQU0sQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO1FBRXBGLE9BQU8sdUJBQXVCLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsd0JBQXdCLENBQUMsdUJBQXVCLEVBQUUsTUFBTSxHQUFHLEVBQUU7UUFDM0QsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUE7UUFDaEQsTUFBTSxVQUFVLEdBQUcsSUFBSSx1QkFBdUIsQ0FBQztZQUM3QyxNQUFNLEVBQUUsZ0JBQWdCO1lBQ3hCLGFBQWE7WUFDYixVQUFVLEVBQUUsaUJBQWlCO1lBQzdCLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTO2dCQUNoQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dCQUN4QixLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRTtnQkFDeEIsT0FBTyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTztnQkFDNUIsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUztnQkFDaEMsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUTtnQkFDOUIsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTTtnQkFDMUIsWUFBWSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWTtnQkFDdEMsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSztnQkFDeEIsR0FBRyxNQUFNO2dCQUNULFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7YUFDakM7WUFDRCxPQUFPLEVBQUUsaUVBQWlFLENBQUMsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNyRyxRQUFRLEVBQUUsSUFBSSxRQUFRLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQztZQUN2QyxRQUFRLEVBQUUsR0FBRztTQUNkLENBQUMsQ0FBQTtRQUVGLFVBQVUsQ0FBQyw2QkFBNkIsR0FBRyxJQUFJLENBQUMsUUFBUSxJQUFJLFNBQVMsQ0FBQTtRQUVyRSxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFO1FBQzFCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFBO1FBRWhELE9BQU8sTUFBTSxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsa0RBQWtELEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNsSCxtRkFBbUY7WUFDbkYsaUZBQWlGO1lBQ2pGLGtGQUFrRjtZQUNsRixxRkFBcUY7WUFDckYsb0RBQW9EO1lBQ3BELE9BQU8sTUFBTSxhQUFhLENBQUMsYUFBYSxDQUFDO2dCQUN2QyxNQUFNLEVBQUUsRUFBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxFQUFFLEVBQUM7Z0JBQ3RELE9BQU8sRUFBRSxpRUFBaUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNyRyxRQUFRLEVBQUUsSUFBSSxRQUFRLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQztnQkFDdkMsWUFBWSxFQUFFLEVBQUMsT0FBTyxFQUFFLDRCQUE0QixFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFDO2FBQzNFLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7O09BYUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLFFBQVE7UUFDakMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUE7UUFFaEQsSUFBSSxDQUFDLGFBQWEsSUFBSSxPQUFPLGFBQWEsQ0FBQyxhQUFhLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDeEUsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO1FBQ3pCLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVqRCxnRkFBZ0Y7UUFDaEYsK0VBQStFO1FBQy9FLGlGQUFpRjtRQUNqRix5RUFBeUU7UUFDekUsT0FBTyxNQUFNLGFBQWEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzFELE9BQU8sTUFBTSxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsdUNBQXVDLEVBQUMsRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUN6RyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBRSxFQUFFLHVCQUF1QjtRQUNsRCxPQUFPLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNoRCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtZQUV6RSxNQUFNLFVBQVUsQ0FBQyxtQ0FBbUMsRUFBRSxDQUFBO1lBRXRELE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1lBQ2xELE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1lBQ3ZELE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyw0QkFBNEIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLENBQUM7Z0JBQ2xFLENBQUMsVUFBVSxDQUFDLFNBQVMsRUFBRSxDQUFDLEVBQUUseUNBQXlDLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxFQUFFLENBQUM7YUFDaEcsQ0FBQyxDQUFBO1lBRUYsT0FBTyxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUNyQyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFFLEVBQUUsdUJBQXVCO1FBQ2pFOzs4QkFFc0I7UUFDdEIsTUFBTSxzQkFBc0IsR0FBRyxFQUFFLENBQUE7UUFFakMsS0FBSyxNQUFNLFdBQVcsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQztZQUMvQyxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQztnQkFDN0MsdUJBQXVCO2dCQUN2QixXQUFXO2dCQUNYLEVBQUU7YUFDSCxDQUFDLENBQUE7WUFFRixJQUFJLE9BQU87Z0JBQUUsc0JBQXNCLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUMzRCxDQUFDO1FBRUQsT0FBTyxzQkFBc0IsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLHVCQUF1QixFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUM7UUFDbEUsT0FBTyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDaEQsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLHVCQUF1QixFQUFFO2dCQUN4RSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7Z0JBQ3hCLFFBQVEsRUFBRSxXQUFXLENBQUMsUUFBUTtnQkFDOUIsS0FBSyxFQUFFLFdBQVcsQ0FBQyxLQUFLO2FBQ3pCLENBQUMsQ0FBQTtZQUVGLE1BQU0sVUFBVSxDQUFDLG1DQUFtQyxFQUFFLENBQUE7WUFFdEQsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLGtCQUFrQixFQUFFLENBQUE7WUFDbEQsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLHVCQUF1QixFQUFFLENBQUE7WUFDdkQsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLGtCQUFrQixFQUFFLENBQUE7WUFDN0MsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLGtCQUFrQixFQUFFLENBQUE7WUFDN0MsMkZBQTJGO1lBQzNGLDBDQUEwQztZQUMxQyxJQUFJLEtBQUssR0FBRyxVQUFVLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxDQUFDO2dCQUNoRSxDQUFDLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxFQUFFLHlDQUF5QyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRSxDQUFDO2FBQ2hHLENBQUMsQ0FBQTtZQUVGLElBQUksS0FBSztnQkFBRSxVQUFVLENBQUMsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM3RCxJQUFJLEtBQUs7Z0JBQUUsVUFBVSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFFN0QsS0FBSyxNQUFNLE1BQU0sSUFBSSxVQUFVLENBQUMscUJBQXFCLEVBQUUsRUFBRSxDQUFDO2dCQUN4RCxVQUFVLENBQUMsd0JBQXdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUN0RCxDQUFDO1lBRUQsT0FBTyxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUNyQyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxFQUFFLEVBQUUsdUJBQXVCO1FBQzFELE9BQU8sTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2hELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1lBRXpFLE1BQU0sVUFBVSxDQUFDLG1DQUFtQyxFQUFFLENBQUE7WUFFdEQsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLGtCQUFrQixFQUFFLENBQUE7WUFDbEQsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLHVCQUF1QixFQUFFLENBQUE7WUFDdkQsK0ZBQStGO1lBQy9GLG1EQUFtRDtZQUNuRCxJQUFJLEtBQUssR0FBRyxVQUFVLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxDQUFDO2dCQUNoRSxDQUFDLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxFQUFFLHlDQUF5QyxDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsRUFBRSxDQUFDO2FBQ2hHLENBQUMsQ0FBQTtZQUNGLE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1lBRWpELElBQUksT0FBTztnQkFBRSxLQUFLLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUUzQyxLQUFLLE1BQU0sS0FBSyxJQUFJLFVBQVUsQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLENBQUM7Z0JBQ3hEOzt5SkFFeUk7Z0JBQ3pJLE1BQU0sSUFBSSxHQUFHLEVBQUUsQ0FBQTtnQkFFZixJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxHQUFHO29CQUMxQixZQUFZLEVBQUUsS0FBSyxDQUFDLGdCQUFnQjtvQkFDcEMsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLCtFQUErRSxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2lCQUMvSCxDQUFBO2dCQUNELEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDdkIsQ0FBQztZQUVELE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1lBRXJELElBQUksU0FBUyxLQUFLLElBQUk7Z0JBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUVsRCxLQUFLLEdBQUcsVUFBVSxDQUFDLDZDQUE2QyxDQUFDLEVBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUV6RSxNQUFNLEtBQUssR0FBRyxNQUFNLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUVqQyxJQUFJLENBQUMsS0FBSztnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUV2QixJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUN4QyxNQUFNLFVBQVUsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDekQsQ0FBQztZQUVELFVBQVUsQ0FBQyw2QkFBNkIsR0FBRyxTQUFTLENBQUE7WUFFcEQsT0FBTyxNQUFNLFVBQVUsQ0FBQyw2QkFBNkIsRUFBRSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDbEYsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7O09BV0c7SUFDSCxpQkFBaUI7UUFDZixNQUFNLGNBQWMsR0FBRyxtREFBbUQsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDeEcsTUFBTSxVQUFVLEdBQUcsT0FBTyxjQUFjLEVBQUUsT0FBTyxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDaEcsTUFBTSxRQUFRLEdBQUcsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUNqRyxNQUFNLGFBQWEsR0FBRyxPQUFPLGNBQWMsRUFBRSxhQUFhLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUN0SDs7bUVBRTJEO1FBQzNELE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDaEQsU0FBUyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNoRCxDQUFDO1FBRUQsT0FBTztZQUNMLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTO1lBQ3hCLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN2RCxRQUFRLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztZQUNwRSxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsa0JBQWtCO1lBQzlCLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNO1lBQ3hCLGFBQWEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhO1lBQ2xDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTTtTQUMvQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIGZyb20gXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiXG5pbXBvcnQgUmVzcG9uc2UgZnJvbSBcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbn0gZnJvbSBcIi4vcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3NlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3Rpb24/OiBzdHJpbmcsIGlkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1hdGNoZWRFdmVudEZpbHRlcktleXM/OiBzdHJpbmdbXSwgcHJldmlvdXNJZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCByZWNvcmQ/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgW2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM/OiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD4sIHJlbW90ZUFkZHJlc3M/OiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3RcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aGVhZGVyczogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCBoZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBtZXRhZGF0YTogKGtleT86IHN0cmluZykgPT4gUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCB1bmRlZmluZWQsIHBhdGg6ICgpID0+IHN0cmluZywgaHR0cE1ldGhvZDogKCkgPT4gc3RyaW5nLCByZW1vdGVBZGRyZXNzOiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQsIG9yaWdpbjogKCkgPT4gc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdFxuICovXG5jb25zdCBFVkVOVF9GSUxURVJfS0VZUyA9IG5ldyBTZXQoW1wiam9pbnNcIiwgXCJrZXlcIiwgXCJzZWFyY2hlc1wiLCBcIndoZXJlXCJdKVxuXG4vLyBNaXJyb3JzIEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgaW4gLi93ZWJzb2NrZXQtcHVibGlzaGVycy5qcywgZHVwbGljYXRlZCBoZXJlXG4vLyB0byBhdm9pZCB0aGUgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVycyBpbXBvcnQgY3ljbGUuXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJlc29sdmVzIGZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5IGF0dHJpYnV0ZXMgdG8gYmFja2luZyBkYXRhYmFzZSBjb2x1bW5zLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBwcmltYXJ5S2V5IC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gLSBCYWNraW5nIGNvbHVtbiBjb25kaXRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZCkge1xuICBjb25zdCByZXNvdXJjZUNvbmRpdGlvbnMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59ICovXG4gIGNvbnN0IGRhdGFiYXNlQ29uZGl0aW9ucyA9IHt9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZGl0aW9ucykpIHtcbiAgICBkYXRhYmFzZUNvbmRpdGlvbnNbTW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKV0gPSB2YWx1ZVxuICB9XG5cbiAgcmV0dXJuIGRhdGFiYXNlQ29uZGl0aW9uc1xufVxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUGVyLXNlc3Npb24gY2hhbm5lbCBzdWJzY3JpcHRpb24gZm9yIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBldmVudHMuXG4gKiBSZXBsYWNlcyB0aGUgbGVnYWN5IGBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbGAgKFBoYXNlIDMpLlxuICpcbiAqIEF1dGggbW9kZWw6IHN1YnNjcmliZS10aW1lIG9ubHkuIGBjYW5TdWJzY3JpYmVgIHJlc29sdmVzIHRoZSBjYWxsZXInc1xuICogYWJpbGl0eSBvbmNlLCBjaGVja3MgdGhhdCBhdCBsZWFzdCBvbmUgYGFsbG93YCBydWxlIGV4aXN0cyBmb3JcbiAqIGByZWFkYCBvbiB0aGUgcmVxdWVzdGVkIG1vZGVsIGNsYXNzLCBhbmQgdGhlbiBkZWxpdmVycyBmdXR1cmVcbiAqIGxpZmVjeWNsZSBicm9hZGNhc3RzIGZvciB0aGF0IG1vZGVsIHdpdGhvdXQgcmUtYXV0aG9yaXppbmcgcGVyIGV2ZW50LlxuICogVGhpcyBtYXRjaGVzIHRoZSBleHBsaWNpdCBkZXNpZ24gZGVjaXNpb24gaW4gUGhhc2UgMyB0byB0cmFkZVxuICogcGVyLXJlY29yZCB2aXNpYmlsaXR5IGd1YXJhbnRlZXMgZm9yIG1hc3NpdmVseSBjaGVhcGVyIGJyb2FkY2FzdCBmYW4tb3V0LlxuICogU3Vic2NyaWJlci1wcm92aWRlZCBldmVudCBmaWx0ZXJzIGNhbiBzdGlsbCBuYXJyb3cgd2hpY2ggY3JlYXRlL3VwZGF0ZVxuICogZXZlbnRzIGFyZSBkZWxpdmVyZWQsIGJ1dCB0aGV5IGFyZSBtYXRjaGluZyBwcmVkaWNhdGVzIHJhdGhlciB0aGFuXG4gKiBwZXItcmVjb3JkIGF1dGhvcml6YXRpb24gY2hlY2tzLlxuICpcbiAqIFdpcmU6IHN1YnNjcmliZSB3aXRoIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbDogTW9kZWxOYW1lfX0pYC5cbiAqIEJhY2tlbmQgcHVibGlzaGVzIGB7YWN0aW9uLCBpZCwgcmVjb3JkfWAgdmlhXG4gKiBgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge21vZGVsOiBNb2RlbE5hbWV9LCBib2R5KWA7XG4gKiBgbWF0Y2hlcygpYCByb3V0ZXMgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwgZXh0ZW5kcyBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIHtcbiAgLyoqXG4gICAqIEFiaWxpdHkuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gIF9hYmlsaXR5ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbiBzdWJzY3JpYmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBmcm9udGVuZC1tb2RlbCBzdWJzY3JpcHRpb24gaXMgYXV0aG9yaXplZC5cbiAgICovXG4gIGFzeW5jIGNhblN1YnNjcmliZSgpIHtcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLl9tb2RlbE5hbWUoKVxuXG4gICAgaWYgKCFtb2RlbE5hbWUpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5fbW9kZWxDbGFzcyhtb2RlbE5hbWUpXG5cbiAgICBpZiAoIU1vZGVsQ2xhc3MpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSlcbiAgICBjb25zdCBhYmlsaXR5ID0gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlQWJpbGl0eSh7XG4gICAgICAvLyBGb3J3YXJkIHRoZSBzdWJzY3JpYmVyJ3MgcGFyYW1zIChlLmcuIGF1dGhlbnRpY2F0aW9uVG9rZW4pIHNvIHRva2VuLWF1dGhlbnRpY2F0ZWQgY2xpZW50c1xuICAgICAgLy8gcmVzb2x2ZSB0aGUgc2FtZSBhYmlsaXR5IHRoZXkgd291bGQgb3ZlciBIVFRQLiBXaXRob3V0IHRoaXMgb25seSBzZXNzaW9uL2Nvb2tpZSBhdXRoIG9uIHRoZVxuICAgICAgLy8gdXBncmFkZSByZXF1ZXN0IHdvcmtzLCBhbmQgcGFyYW0tYmFzZWQgYXV0aCAobGlrZSBhIHNjYW5uZXIgcGFzc2luZyBhbiBhdXRoZW50aWNhdGlvblRva2VuKVxuICAgICAgLy8gaXMgZHJvcHBlZCDigJQgbGVhdmluZyBzdWNoIHN1YnNjcmliZXJzIHdpdGggYSBndWVzdCBhYmlsaXR5IGFuZCBubyByZWFkIHJ1bGUuXG4gICAgICBwYXJhbXM6IHsuLi50aGlzLnBhcmFtcywgbW9kZWw6IG1vZGVsTmFtZX0sXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgfSlcblxuICAgIGlmICghYWJpbGl0eSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fYWJpbGl0eSA9IGFiaWxpdHlcblxuICAgIC8vIExvYWQgcmVzb3VyY2UtZGVjbGFyZWQgcnVsZXMgZm9yIHRoaXMgbW9kZWwgY2xhc3MgYmVmb3JlIGNoZWNraW5nLFxuICAgIC8vIG90aGVyd2lzZSBgcnVsZXNGb3JgIHJldHVybnMgZW1wdHkgZm9yIGFiaWxpdGllcyB3aG9zZSByZXNvdXJjZXNcbiAgICAvLyByZWdpc3RlciBydWxlcyBsYXppbHkgdmlhIGBhYmlsaXRpZXMoKWAuXG4gICAgYWJpbGl0eS5sb2FkQWJpbGl0aWVzRm9yTW9kZWxDbGFzcyhNb2RlbENsYXNzKVxuXG4gICAgY29uc3QgcmVhZFJ1bGVzID0gYWJpbGl0eS5ydWxlc0Zvcih7YWN0aW9uOiBcInJlYWRcIiwgbW9kZWxDbGFzczogTW9kZWxDbGFzc30pXG5cbiAgICByZXR1cm4gcmVhZFJ1bGVzLnNvbWUoKC8qKiBAdHlwZSB7e2VmZmVjdDogc3RyaW5nfX0gKi8gcnVsZSkgPT4gcnVsZS5lZmZlY3QgPT09IFwiYWxsb3dcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHN1YnNjcmlwdGlvbiBuYW1lIHRocm91Z2ggZnJvbnRlbmQgcmVzb3VyY2VzIGJlZm9yZSBmYWxsaW5nIGJhY2sgdG8gYSBiYWNraW5nIG1vZGVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCByZXNvdXJjZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBfbW9kZWxDbGFzcyhtb2RlbE5hbWUpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVttb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gcmVzb3VyY2VEZWZpbml0aW9uID8gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pIDogbnVsbFxuXG4gICAgICBpZiAocmVzb3VyY2VDbGFzcz8uTW9kZWxDbGFzcykgcmV0dXJuIHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClbbW9kZWxOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt7ZXZlbnRJZD86IHN0cmluZ319IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBkZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpIHtcbiAgICBhd2FpdCB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge3tldmVudElkPzogc3RyaW5nfX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxpdmVyeS5cbiAgICovXG4gIGFzeW5jIF9kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpIHtcbiAgICBjb25zdCBoYXNFdmVudEZpbHRlcnMgPSB0aGlzLl9oYXNFdmVudEZpbHRlclBhcmFtcygpXG5cbiAgICBpZiAoIXRoaXMuX2hhc1Byb2plY3Rpb25QYXJhbXMoKSAmJiAhaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICAvLyBFdmVuIHVuZmlsdGVyZWQgc3Vic2NyaXB0aW9ucyBtdXN0IHJlc3BlY3QgdGhlIHN1YnNjcmliZXIncyBhYmlsaXR5LiBBIGNyZWF0ZS91cGRhdGUgY2Fycmllc1xuICAgICAgLy8gdGhlIHJlY29yZCwgc28gb25seSBkZWxpdmVyIGl0IHdoZW4gdGhlIHJlY29yZCBpcyB3aXRoaW4gdGhlIGF1dGhlbnRpY2F0ZWQgYWJpbGl0eSdzIHNjb3BlLlxuICAgICAgLy8gRGVzdHJveXMgKGFuZCBib2RpZXMgd2l0aG91dCBhIHVzYWJsZSBpZCkgY2Fycnkgbm8gcmVjb3JkLCBzbyBwYXNzIHRoZW0gdGhyb3VnaCB1bmNoYW5nZWQuXG4gICAgICBpZiAoYm9keSAmJiB0eXBlb2YgYm9keSA9PT0gXCJvYmplY3RcIiAmJiAoYm9keS5hY3Rpb24gPT09IFwiY3JlYXRlXCIgfHwgYm9keS5hY3Rpb24gPT09IFwidXBkYXRlXCIpICYmIGJvZHkuaWQgIT09IHVuZGVmaW5lZCAmJiBib2R5LmlkICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IEZyb250ZW5kTW9kZWxDb250cm9sbGVyID0gYXdhaXQgdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpXG5cbiAgICAgICAgaWYgKCFhd2FpdCB0aGlzLl9ldmVudElzQWNjZXNzaWJsZShib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikpIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5KCkgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGJvZHkuaWQgPT09IHVuZGVmaW5lZCB8fCBib2R5LmlkID09PSBudWxsKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBhd2FpdCB0aGlzLl9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgIGlmIChoYXNFdmVudEZpbHRlcnMgJiYgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5sZW5ndGggPT09IDAgJiYgIXRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGl2ZXIgYm9keS5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9ICovXG4gICAgbGV0IGRlbGl2ZXJCb2R5ID0gYm9keVxuXG4gICAgaWYgKHRoaXMuX2hhc1Byb2plY3Rpb25QYXJhbXMoKSkge1xuICAgICAgY29uc3QgcHJvamVjdGVkUmVjb3JkID0gYXdhaXQgdGhpcy5fcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgaWYgKCFwcm9qZWN0ZWRSZWNvcmQpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgaGFzIG5vIGNvbmZpZ3VyYXRpb24gZm9yIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uXCIpXG4gICAgICB9XG5cbiAgICAgIGRlbGl2ZXJCb2R5ID0ge1xuICAgICAgICAuLi5kZWxpdmVyQm9keSxcbiAgICAgICAgcmVjb3JkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByb2plY3RlZFJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnNlbmRNZXNzYWdlKGRlbGl2ZXJCb2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IGJyb2FkY2FzdFBhcmFtcyAtIFBhcmFtcyBmcm9tIGBicm9hZGNhc3RUb0NoYW5uZWxgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgYnJvYWRjYXN0IG1hdGNoZXMgdGhpcyBzdWJzY3JpYmVyJ3MgbW9kZWwuXG4gICAqL1xuICBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcykge1xuICAgIHJldHVybiBicm9hZGNhc3RQYXJhbXM/Lm1vZGVsID09PSB0aGlzLl9tb2RlbE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0aWVzOiB0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCxcbiAgICAgIGV2ZW50RmlsdGVyQ291bnQ6IGV2ZW50RmlsdGVycy5sZW5ndGgsXG4gICAgICBkZXN0cm95RXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICBwcmVsb2FkOiB0aGlzLnBhcmFtcy5wcmVsb2FkICE9PSB1bmRlZmluZWQsXG4gICAgICBxdWVyeURhdGE6IHRoaXMucGFyYW1zLnF1ZXJ5RGF0YSAhPT0gdW5kZWZpbmVkLFxuICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWQsXG4gICAgICB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICB3aXRoQ291bnQ6IHRoaXMucGFyYW1zLndpdGhDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVxdWVzdGVkIGZyb250ZW5kLW1vZGVsIG5hbWUgb3IgbnVsbC5cbiAgICovXG4gIF9tb2RlbE5hbWUoKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGlzLnBhcmFtcz8ubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5wYXJhbXMubW9kZWwubGVuZ3RoID4gMFxuICAgICAgPyB0aGlzLnBhcmFtcy5tb2RlbFxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgcHJvamVjdGlvbiBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBzdWJzY3JpcHRpb24gcmVxdWVzdGVkIHBlci1ldmVudCByZWNvcmQgcHJvamVjdGlvbi5cbiAgICovXG4gIF9oYXNQcm9qZWN0aW9uUGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy5zZWxlY3QgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLnByZWxvYWQgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgdGhpcy5wYXJhbXMud2l0aENvdW50ICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCB0aGlzLnBhcmFtcy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGV2ZW50IGZpbHRlciBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBzdWJzY3JpcHRpb24gcmVxdWVzdGVkIGV2ZW50IHF1ZXJ5IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRXZlbnRGaWx0ZXJQYXJhbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2V2ZW50RmlsdGVycygpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB1bmZpbHRlcmVkIGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHVuZmlsdGVyZWQgY2FsbGJhY2tzIHNob3VsZCByZWNlaXZlIGV2ZXJ5IGV2ZW50LlxuICAgKi9cbiAgX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy51bmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGRlc3Ryb3kgZXZlbnQgZGVsaXZlcnkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaWQtb25seSBkZXN0cm95IGV2ZW50cyBzaG91bGQgYmUgZGVsaXZlcmVkIHdpdGggZXZlbnQgZmlsdGVycy5cbiAgICovXG4gIF9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZW50IGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdfSAtIFZhbGlkIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfZXZlbnRGaWx0ZXJzKCkge1xuICAgIGlmICh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyBtdXN0IGJlIG9iamVjdHNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXZlbnRGaWx0ZXIgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KVxuICAgICAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhldmVudEZpbHRlcikuZmlsdGVyKChrZXkpID0+ICFFVkVOVF9GSUxURVJfS0VZUy5oYXMoa2V5KSlcblxuICAgICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyBjYW5ub3QgaW5jbHVkZSAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX1gKVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIGV2ZW50RmlsdGVyLmtleSAhPT0gXCJzdHJpbmdcIiB8fCBldmVudEZpbHRlci5rZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIHJlcXVpcmUgYSBrZXlcIilcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBTYW5pdGl6ZWQgZXZlbnQgZmlsdGVyLlxuICAgICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5fSAqL1xuICAgICAgY29uc3Qgc2FuaXRpemVkRXZlbnRGaWx0ZXIgPSB7a2V5OiBldmVudEZpbHRlci5rZXl9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5qb2lucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLmpvaW5zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChldmVudEZpbHRlci5qb2lucylcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLnNlYXJjaGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIuc2VhcmNoZXMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAqLyAoZXZlbnRGaWx0ZXIuc2VhcmNoZXMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci53aGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLndoZXJlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChldmVudEZpbHRlci53aGVyZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHNhbml0aXplZEV2ZW50RmlsdGVyXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHQ+fSAtIEZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqL1xuICBhc3luYyBfZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsQ29udHJvbGxlclBhdGggPSBcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIlxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsQ29udHJvbGxlcn0gPSBhd2FpdCBpbXBvcnQoZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoKVxuXG4gICAgcmV0dXJuIEZyb250ZW5kTW9kZWxDb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAtIFN5bnRoZXRpYyBjb250cm9sbGVyIHVzZWQgZm9yIHJlc291cmNlIHNlcmlhbGl6YXRpb24uXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIHBhcmFtcyA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBGcm9udGVuZE1vZGVsQ29udHJvbGxlcih7XG4gICAgICBhY3Rpb246IFwid2Vic29ja2V0RXZlbnRcIixcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBjb250cm9sbGVyOiBcImZyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgcGFyYW1zOiB7XG4gICAgICAgIGFiaWxpdGllczogdGhpcy5wYXJhbXMuYWJpbGl0aWVzLFxuICAgICAgICBqb2luczogdGhpcy5wYXJhbXMuam9pbnMsXG4gICAgICAgIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKSxcbiAgICAgICAgcHJlbG9hZDogdGhpcy5wYXJhbXMucHJlbG9hZCxcbiAgICAgICAgcXVlcnlEYXRhOiB0aGlzLnBhcmFtcy5xdWVyeURhdGEsXG4gICAgICAgIHNlYXJjaGVzOiB0aGlzLnBhcmFtcy5zZWFyY2hlcyxcbiAgICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QsXG4gICAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhLFxuICAgICAgICB3aGVyZTogdGhpcy5wYXJhbXMud2hlcmUsXG4gICAgICAgIC4uLnBhcmFtcyxcbiAgICAgICAgd2l0aENvdW50OiB0aGlzLnBhcmFtcy53aXRoQ291bnRcbiAgICAgIH0sXG4gICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpLFxuICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pLFxuICAgICAgdmlld1BhdGg6IFwiL1wiXG4gICAgfSlcblxuICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB0aGlzLl9hYmlsaXR5IHx8IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIGNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0ZW5hbnQgZm9yIGV2ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIF9yZXNvbHZlRXZlbnRUZW5hbnQoaWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBldmVudCB0ZW5hbnQgcmVzb2x1dGlvblwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSBzdWJzY3JpYmUtdGltZSB0ZW5hbnQgcmVzb2x1dGlvbiAoYFdlYnNvY2tldFNlc3Npb24uX3Jlc29sdmVUZW5hbnRgKTpcbiAgICAgIC8vIHBhc3MgYHN1YnNjcmlwdGlvbjoge2NoYW5uZWwsIHBhcmFtc31gIHNvIHJlc29sdmVycyB0aGF0IGRlcml2ZSBzY29wZSBmcm9tIHRoZVxuICAgICAgLy8gc3Vic2NyaXB0aW9uIGJlaGF2ZSB0aGUgc2FtZSBmb3IgYnJvYWRjYXN0cyBhcyB0aGV5IGRpZCBhdCBgY2hhbm5lbC1zdWJzY3JpYmVgLlxuICAgICAgLy8gVGhlIHN5bnRoZXRpYyByZXF1ZXN0IGZvcndhcmRzIHRoZSBzdWJzY3JpYmVyJ3MgcGFyYW1zIChlLmcuIGF1dGhlbnRpY2F0aW9uVG9rZW4pLFxuICAgICAgLy8gbWF0Y2hpbmcgdGhpcyBjaGFubmVsJ3MgYWJpbGl0eSByZXNvbHV0aW9uIGFib3ZlLlxuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCh7XG4gICAgICAgIHBhcmFtczogey4uLnRoaXMucGFyYW1zLCBpZCwgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpfSxcbiAgICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pLFxuICAgICAgICBzdWJzY3JpcHRpb246IHtjaGFubmVsOiBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBwYXJhbXM6IHRoaXMucGFyYW1zfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzdWJzY3JpYmVyJ3MgdGVuYW50IGZvciB0aGUgYnJvYWRjYXN0IHJlY29yZCBhbmQgcnVucyBgY2FsbGJhY2tgIGluc2lkZSB0aGF0IHRlbmFudFxuICAgKiBjb250ZXh0LiBCcm9hZGNhc3QgZGVsaXZlcnkgcnVucyBpbiB3aGF0ZXZlciBhbWJpZW50IHRlbmFudCBjb250ZXh0IHRoZSBwdWJsaXNoZXIgbGVmdCBiZWhpbmQuIEZvclxuICAgKiBtdWx0aS10ZW5hbnQgcmVjb3JkcyB0aGF0IGFtYmllbnQgdGVuYW50IG1heSBoYXZlIGJlZW4gcmVzb2x2ZWQgd2l0aG91dCB0aGUgc3Vic2NyaWJlcidzIHJlcXVlc3RcbiAgICogKGUuZy4gYSByZWxheSBlbmRwb2ludCBvciBiYWNrZ3JvdW5kIGpvYiBtdXRhdGluZyB0aGUgcm93KSwgc28gaXQgbGFja3MgdGhlIHN1YnNjcmliZXIncyBwZXItcmVjb3JkXG4gICAqIGFjY2VzcyBmbGFncyBhbmQgdGhlIHBlci1ldmVudCBhdXRob3JpemF0aW9uIHF1ZXJ5IHdyb25nbHkgZmluZHMgbm90aGluZy4gUmUtcmVzb2x2aW5nIHRoZSB0ZW5hbnRcbiAgICogZnJvbSB0aGUgZXZlbnQgcmVjb3JkIGlkIHBsdXMgdGhlIHN1YnNjcmliZXIncyByZXF1ZXN0IG1ha2VzIHRoZSBhdXRob3JpemF0aW9uIHF1ZXJpZXMgcnVuIGFnYWluc3RcbiAgICogdGhlIHN1YnNjcmliZXIncyBvd24gdGVuYW50L2FiaWxpdHkgc2NvcGUuIFdoZW4gbm8gdGVuYW50IHJlc29sdmVzIChub24tbXVsdGl0ZW5hbnQgY29uZmlncyksIHRoZVxuICAgKiBjYWxsYmFjayBydW5zIGRpcmVjdGx5IHNvIHRoZSBhbWJpZW50IGNvbnRleHQgaXMgcHJlc2VydmVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF1dGhvcml6ZWQtcXVlcnkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRXZlbnRUZW5hbnQoaWQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24gfHwgdHlwZW9mIGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVFdmVudFRlbmFudChpZClcblxuICAgIC8vIEFsd2F5cyBlbnRlciBgcnVuV2l0aFRlbmFudGAsIGV2ZW4gd2hlbiBubyB0ZW5hbnQgcmVzb2x2ZWQuIEJyb2FkY2FzdCBmYW4tb3V0XG4gICAgLy8gcnVucyBpbiB0aGUgcHVibGlzaGVyJ3MgYW1iaWVudCB0ZW5hbnQgY29udGV4dDsgZmFsbGluZyBiYWNrIHRvIGBjYWxsYmFjaygpYFxuICAgIC8vIHRoZXJlIHdvdWxkIGF1dGhvcml6ZSBhIGNyb3NzLXRlbmFudCByZWNvcmQgYWdhaW5zdCB0aGUgcHVibGlzaGVyJ3MgdGVuYW50IGFuZFxuICAgIC8vIGNvdWxkIGxlYWsgaXQgdG8gYSBzdWJzY3JpYmVyIHdob3NlIG93biByZXNvbHZlciBjb3VsZCBub3QgcmVzb2x2ZSBpdC5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudFwifSwgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBicm9hZGNhc3QgcmVjb3JkIGlzIHdpdGhpbiB0aGUgc3Vic2NyaWJlcidzIGF1dGhlbnRpY2F0ZWQgYWJpbGl0eSBzY29wZS4gVXNlZCB0byBnYXRlXG4gICAqIHVuZmlsdGVyZWQvdW5wcm9qZWN0ZWQgY3JlYXRlL3VwZGF0ZSBkZWxpdmVyeSBzbyBhIHNjb3BlZCB0b2tlbiBuZXZlciByZWNlaXZlcyBhIHJlY29yZCBpdCBjYW5ub3QgcmVhZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gVHJ1ZSB3aGVuIHRoZSByZWNvcmQgaXMgcmVhZGFibGUgYnkgdGhpcyBzdWJzY3JpcHRpb24uXG4gICAqL1xuICBhc3luYyBfZXZlbnRJc0FjY2Vzc2libGUoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gRXZlbnQgZmlsdGVyIGtleXMgbWF0Y2hlZCBieSB0aGUgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX21hdGNoZWRFdmVudEZpbHRlcktleXNGb3JFdmVudElkKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIC8qKlxuICAgICAqIE1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBldmVudEZpbHRlciBvZiB0aGlzLl9ldmVudEZpbHRlcnMoKSkge1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IGF3YWl0IHRoaXMuX2V2ZW50TWF0Y2hlc0ZpbHRlcih7XG4gICAgICAgIEZyb250ZW5kTW9kZWxDb250cm9sbGVyLFxuICAgICAgICBldmVudEZpbHRlcixcbiAgICAgICAgaWRcbiAgICAgIH0pXG5cbiAgICAgIGlmIChtYXRjaGVzKSBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLnB1c2goZXZlbnRGaWx0ZXIua2V5KVxuICAgIH1cblxuICAgIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBtYXRjaGVzIGZpbHRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGaWx0ZXIgYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBhcmdzLkZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gYXJncy5ldmVudEZpbHRlciAtIEV2ZW50IGZpbHRlciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgcmVjb3JkIG1hdGNoZXMgdGhlIGZpbHRlci5cbiAgICovXG4gIGFzeW5jIF9ldmVudE1hdGNoZXNGaWx0ZXIoe0Zyb250ZW5kTW9kZWxDb250cm9sbGVyLCBldmVudEZpbHRlciwgaWR9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCB7XG4gICAgICAgIGpvaW5zOiBldmVudEZpbHRlci5qb2lucyxcbiAgICAgICAgc2VhcmNoZXM6IGV2ZW50RmlsdGVyLnNlYXJjaGVzLFxuICAgICAgICB3aGVyZTogZXZlbnRGaWx0ZXIud2hlcmVcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgY29uc3Qgd2hlcmUgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxXaGVyZSgpXG4gICAgICBjb25zdCBqb2lucyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEpvaW5zKClcbiAgICAgIC8vIFN0YXJ0IGZyb20gdGhlIHN1YnNjcmliZXIncyBhdXRob3JpemVkIHNjb3BlIHNvIGEgZmlsdGVyIGNhbiBvbmx5IGV2ZXIgbWF0Y2ggcmVjb3JkcyB0aGVcbiAgICAgIC8vIHN1YnNjcmlwdGlvbidzIGFiaWxpdHkgcGVybWl0cyB0byByZWFkLlxuICAgICAgbGV0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuXG4gICAgICBpZiAod2hlcmUpIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pXG4gICAgICBpZiAoam9pbnMpIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsSm9pbnMoe2pvaW5zLCBxdWVyeX0pXG5cbiAgICAgIGZvciAoY29uc3Qgc2VhcmNoIG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFNlYXJjaGVzKCkpIHtcbiAgICAgICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9qZWN0ZWQgcmVjb3JkIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4gfCBudWxsPn0gLSBTZXJpYWxpemVkIHByb2plY3RlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgLy8gUmVsb2FkIHRocm91Z2ggdGhlIHN1YnNjcmliZXIncyBhdXRob3JpemVkIHNjb3BlIHNvIHByb2plY3RlZCByZWNvcmRzIGFyZSBvbmx5IGV2ZXIgc2VudCBmb3JcbiAgICAgIC8vIHJvd3MgdGhlIHN1YnNjcmlwdGlvbidzIGFiaWxpdHkgcGVybWl0cyB0byByZWFkLlxuICAgICAgbGV0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuICAgICAgY29uc3QgcHJlbG9hZCA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuXG4gICAgICBpZiAocHJlbG9hZCkgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHByZWxvYWQpXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2l0aENvdW50KCkpIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNwZWMuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59Pn0gKi9cbiAgICAgICAgY29uc3Qgc3BlYyA9IHt9XG5cbiAgICAgICAgc3BlY1tlbnRyeS5hdHRyaWJ1dGVOYW1lXSA9IHtcbiAgICAgICAgICByZWxhdGlvbnNoaXA6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChlbnRyeS53aGVyZSkgOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBxdWVyeS53aXRoQ291bnQoc3BlYylcbiAgICAgIH1cblxuICAgICAgY29uc3QgcXVlcnlEYXRhID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUXVlcnlEYXRhKClcblxuICAgICAgaWYgKHF1ZXJ5RGF0YSAhPT0gbnVsbCkgcXVlcnkucXVlcnlEYXRhKHF1ZXJ5RGF0YSlcblxuICAgICAgcXVlcnkgPSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgICAgaWYgKCFtb2RlbCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENvbXB1dGVBYmlsaXRpZXMoW21vZGVsXSlcbiAgICAgIH1cblxuICAgICAgY29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHVuZGVmaW5lZFxuXG4gICAgICByZXR1cm4gYXdhaXQgY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnNlcmlhbGl6ZShtb2RlbCwgXCJmaW5kXCIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNaW5pbWFsIFJlcXVlc3QtbGlrZSBzdHViIHVzZWQgb25seSBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLiBBdm9pZHNcbiAgICogaW1wb3J0aW5nIGBXZWJzb2NrZXRSZXF1ZXN0YCBoZXJlIGJlY2F1c2UgaXRzIGBub2RlOnF1ZXJ5c3RyaW5nYFxuICAgKiBkZXBlbmRlbmN5IHdvdWxkIHB1bGwgc2VydmVyLW9ubHkgY29kZSBpbnRvIGJyb3dzZXIgYnVuZGxlcyB2aWFcbiAgICogdGhlIGBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIg4oaSIHdlYnNvY2tldC1wdWJsaXNoZXJzYCBpbXBvcnQgY2hhaW4uXG4gICAqIEhlYWRlciBuYW1lcyBhcmUgbm9ybWFsaXplZCB0byBsb3dlcmNhc2Ugc28gYGhlYWRlcihcImNvb2tpZVwiKWBcbiAgICogZmluZHMgYSB2YWx1ZSByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhlIHVwZ3JhZGUtcmVxdWVzdCBoZWFkZXJzXG4gICAqIG1hcCB1c2VzIGBcIkNvb2tpZVwiYCBvciBgXCJjb29raWVcImAuIFNlc3Npb24gbWV0YWRhdGEgc3RheXMgc2VwYXJhdGVcbiAgICogZnJvbSBoZWFkZXJzIGFuZCBpcyBleHBvc2VkIHRocm91Z2ggYG1ldGFkYXRhKC4uLilgIGZvciBhYmlsaXR5XG4gICAqIHJlc29sdmVycyB0aGF0IG5lZWQgd2Vic29ja2V0LWRlbGl2ZXJlZCBzZXNzaW9uIGRhdGEuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdH0gUmVxdWVzdC1saWtlIG9iamVjdCBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLlxuICAgKi9cbiAgX3N5bnRoZXRpY1JlcXVlc3QoKSB7XG4gICAgY29uc3QgdXBncmFkZVJlcXVlc3QgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRVcGdyYWRlUmVxdWVzdH0gKi8gKHRoaXMuc2Vzc2lvbi51cGdyYWRlUmVxdWVzdClcbiAgICBjb25zdCByYXdIZWFkZXJzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5oZWFkZXJzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5oZWFkZXJzKCkgOiB7fVxuICAgIGNvbnN0IG1ldGFkYXRhID0gdHlwZW9mIHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5zZXNzaW9uLmdldE1ldGFkYXRhKCkgOiB7fVxuICAgIGNvbnN0IHJlbW90ZUFkZHJlc3MgPSB0eXBlb2YgdXBncmFkZVJlcXVlc3Q/LnJlbW90ZUFkZHJlc3MgPT09IFwiZnVuY3Rpb25cIiA/IHVwZ3JhZGVSZXF1ZXN0LnJlbW90ZUFkZHJlc3MoKSA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEhlYWRlciBtYXAuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPn0gKi9cbiAgICBjb25zdCBoZWFkZXJNYXAgPSB7fVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmF3SGVhZGVycyB8fCB7fSkpIHtcbiAgICAgIGhlYWRlck1hcFtrZXkudG9Mb3dlckNhc2UoKV0gPSByYXdIZWFkZXJzW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaGVhZGVyczogKCkgPT4gaGVhZGVyTWFwLFxuICAgICAgaGVhZGVyOiAobmFtZSkgPT4gaGVhZGVyTWFwW1N0cmluZyhuYW1lKS50b0xvd2VyQ2FzZSgpXSxcbiAgICAgIG1ldGFkYXRhOiAoa2V5KSA9PiBrZXkgPT09IHVuZGVmaW5lZCA/IHsuLi5tZXRhZGF0YX0gOiBtZXRhZGF0YVtrZXldLFxuICAgICAgcGF0aDogKCkgPT4gXCIvZnJvbnRlbmQtbW9kZWxzXCIsXG4gICAgICBodHRwTWV0aG9kOiAoKSA9PiBcIlBPU1RcIixcbiAgICAgIHJlbW90ZUFkZHJlc3M6ICgpID0+IHJlbW90ZUFkZHJlc3MsXG4gICAgICBvcmlnaW46ICgpID0+IGhlYWRlck1hcC5vcmlnaW5cbiAgICB9XG4gIH1cbn1cbiJdfQ==