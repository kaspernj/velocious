// @ts-check
import VelociousWebsocketChannel from "../http-server/websocket-channel.js";
import { Buffer } from "node:buffer";
import Response from "../http-server/client/response.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./built-in-resources.js";
import { frontendModelResourceClassFromDefinition } from "./resource-definition.js";
import { deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue } from "./transport-serialization.js";
import { modelPrimaryKeyConditions } from "../utils/model-primary-key.js";
/**
 * Defines this typedef.
 * @typedef {{action?: string, destroyAuthorizationRecord?: Record<string, ReturnType<typeof JSON.parse>>, id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, matchedEventFilterKeys?: string[], previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
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
        if (typeof body.model === "string" && body.model !== this._modelName())
            return;
        if (body.action === "destroy") {
            if (body.id === undefined || body.id === null)
                return;
            const FrontendModelController = await this._frontendModelControllerClass();
            const authorized = await this._destroyEventIsAuthorized(body, FrontendModelController);
            if (!authorized)
                return;
            if (!hasEventFilters || this._hasDestroyEventDelivery() || this._hasUnfilteredEventDelivery()) {
                this.sendMessage({
                    action: body.action,
                    id: body.id,
                    ...(typeof body.model === "string" ? { model: body.model } : {})
                }, meta);
            }
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
            if (isIdentityTransition) {
                this.sendMessage({
                    action: body.action,
                    id: body.id,
                    ...(hasEventFilters ? { matchedEventFilterKeys } : {}),
                    ...(typeof body.model === "string" ? { model: body.model } : {}),
                    previousId: body.previousId
                }, meta);
            }
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
     * Checks a destroy against the subscriber's ordinary authorized query by
     * replacing the deleted backing table with the captured pre-delete row. Values
     * are quoted on this trusted database connection; no broadcast-provided SQL is run.
     * @param {FrontendModelLifecycleBroadcastBody} body - Destroy broadcast body.
     * @param {typeof import("../frontend-model-controller.js").default} FrontendModelController - Server-side frontend-model controller class.
     * @returns {Promise<boolean>} - Whether the subscriber could read the record before deletion.
     */
    async _destroyEventIsAuthorized(body, FrontendModelController) {
        const destroyAuthorizationRecord = body.destroyAuthorizationRecord;
        const id = body.id;
        if (id === undefined || id === null || !destroyAuthorizationRecord || typeof destroyAuthorizationRecord !== "object" || Array.isArray(destroyAuthorizationRecord))
            return false;
        return await this._withEventTenant(id, async () => {
            const controller = this._frontendModelController(FrontendModelController);
            await controller.ensureFrontendModelClassInitialized();
            const ModelClass = controller.frontendModelClass();
            const primaryKey = controller.frontendModelPrimaryKey();
            const ruleQueryFactory = () => this._destroyAuthorizationQuery(ModelClass, destroyAuthorizationRecord);
            const query = controller.frontendModelAuthorizedQuery("find", { ruleQueryFactory });
            this._applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord);
            query.where({
                [ModelClass.tableName()]: frontendModelPrimaryKeyDatabaseConditions(ModelClass, primaryKey, id)
            });
            return Boolean(await query.first());
        });
    }
    /**
     * Builds a backing-model query whose source is the captured pre-delete row.
     * @param {typeof import("../database/record/index.js").default} ModelClass - Backing model class.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} destroyAuthorizationRecord - Captured pre-delete record.
     * @returns {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} - One-row model query.
     */
    _destroyAuthorizationQuery(ModelClass, destroyAuthorizationRecord) {
        const query = ModelClass._newQuery();
        this._applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord);
        return query;
    }
    /**
     * Replaces a query's backing table with a safely quoted one-row derived table.
     * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} query - Query to update.
     * @param {typeof import("../database/record/index.js").default} ModelClass - Backing model class.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} destroyAuthorizationRecord - Captured pre-delete record.
     * @returns {void}
     */
    _applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord) {
        const selectedColumns = Object.entries(destroyAuthorizationRecord).map(([columnName, serializedValue]) => {
            const binaryMarker = serializedValue && typeof serializedValue === "object" && !Array.isArray(serializedValue)
                && serializedValue.__velociousDestroyAuthorizationType === "binary"
                && Array.isArray(serializedValue.value);
            const value = binaryMarker
                ? Buffer.from(serializedValue.value)
                : deserializeFrontendModelTransportValue(serializedValue);
            const quotedValue = value === null ? "NULL" : query.driver.quote(value);
            return `${quotedValue} AS ${query.driver.quoteColumn(columnName)}`;
        });
        if (selectedColumns.length === 0) {
            throw new Error(`Cannot authorize a destroyed ${ModelClass.name} without captured attributes`);
        }
        const froms = query.getFroms();
        froms.splice(0, froms.length);
        query.from(`(SELECT ${selectedColumns.join(", ")}) AS ${query.driver.quoteTable(ModelClass.tableName())}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDbEMsT0FBTyxRQUFRLE1BQU0sbUNBQW1DLENBQUE7QUFDeEQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFFdkU7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0gsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUE7QUFFeEUscUZBQXFGO0FBQ3JGLDJFQUEyRTtBQUMzRSxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRXREOzs7Ozs7R0FNRztBQUNILFNBQVMseUNBQXlDLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxFQUFFO0lBQzNFLE1BQU0sa0JBQWtCLEdBQUcseUJBQXlCLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFBO0lBQ3BFLDRGQUE0RjtJQUM1RixNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtJQUU3QixLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENB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LENBQUMsR0FBRyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBQyxHQUFHLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDO1lBQ3BFLElBQUksRUFBRSxHQUFHLEVBQUUsQ0FBQyxrQkFBa0I7WUFDOUIsVUFBVSxFQUFFLEdBQUcsRUFBRSxDQUFDLE1BQU07WUFDeEIsYUFBYSxFQUFFLEdBQUcsRUFBRSxDQUFDLGFBQWE7WUFDbEMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxNQUFNO1NBQy9CLENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwgZnJvbSBcIi4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCJcbmltcG9ydCB7QnVmZmVyfSBmcm9tIFwibm9kZTpidWZmZXJcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuL2J1aWx0LWluLXJlc291cmNlcy5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb259IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnN9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2FjdGlvbj86IHN0cmluZywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQ/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGlkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1hdGNoZWRFdmVudEZpbHRlcktleXM/OiBzdHJpbmdbXSwgcHJldmlvdXNJZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCByZWNvcmQ/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgW2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM/OiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD4sIHJlbW90ZUFkZHJlc3M/OiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3RcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aGVhZGVyczogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCBoZWFkZXI6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBtZXRhZGF0YTogKGtleT86IHN0cmluZykgPT4gUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCB1bmRlZmluZWQsIHBhdGg6ICgpID0+IHN0cmluZywgaHR0cE1ldGhvZDogKCkgPT4gc3RyaW5nLCByZW1vdGVBZGRyZXNzOiAoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQsIG9yaWdpbjogKCkgPT4gc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdFxuICovXG5jb25zdCBFVkVOVF9GSUxURVJfS0VZUyA9IG5ldyBTZXQoW1wiam9pbnNcIiwgXCJrZXlcIiwgXCJzZWFyY2hlc1wiLCBcIndoZXJlXCJdKVxuXG4vLyBNaXJyb3JzIEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgaW4gLi93ZWJzb2NrZXQtcHVibGlzaGVycy5qcywgZHVwbGljYXRlZCBoZXJlXG4vLyB0byBhdm9pZCB0aGUgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVycyBpbXBvcnQgY3ljbGUuXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJlc29sdmVzIGZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5IGF0dHJpYnV0ZXMgdG8gYmFja2luZyBkYXRhYmFzZSBjb2x1bW5zLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBwcmltYXJ5S2V5IC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gLSBCYWNraW5nIGNvbHVtbiBjb25kaXRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZCkge1xuICBjb25zdCByZXNvdXJjZUNvbmRpdGlvbnMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59ICovXG4gIGNvbnN0IGRhdGFiYXNlQ29uZGl0aW9ucyA9IHt9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZGl0aW9ucykpIHtcbiAgICBkYXRhYmFzZUNvbmRpdGlvbnNbTW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKV0gPSB2YWx1ZVxuICB9XG5cbiAgcmV0dXJuIGRhdGFiYXNlQ29uZGl0aW9uc1xufVxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUGVyLXNlc3Npb24gY2hhbm5lbCBzdWJzY3JpcHRpb24gZm9yIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBldmVudHMuXG4gKiBSZXBsYWNlcyB0aGUgbGVnYWN5IGBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbGAgKFBoYXNlIDMpLlxuICpcbiAqIGBjYW5TdWJzY3JpYmVgIHJlc29sdmVzIHRoZSBjYWxsZXIncyBhYmlsaXR5IG9uY2UgYW5kIHJlcXVpcmVzIGEgcmVhZCBydWxlXG4gKiBmb3IgdGhlIHJlcXVlc3RlZCBtb2RlbCBjbGFzcy4gQ3JlYXRlL3VwZGF0ZSBkZWxpdmVyeSB0aGVuIHJlbG9hZHMgZWFjaFxuICogcmVjb3JkIHRocm91Z2ggdGhhdCBhYmlsaXR5IGFuZCBzZXJpYWxpemVzIGl0IHRocm91Z2ggdGhlIHN1YnNjcmliZWRcbiAqIGZyb250ZW5kIHJlc291cmNlLiBTdWJzY3JpYmVyLXByb3ZpZGVkIGV2ZW50IGZpbHRlcnMgY2FuIGZ1cnRoZXIgbmFycm93XG4gKiB0aG9zZSBhdXRob3JpemVkIGV2ZW50cy5cbiAqXG4gKiBXaXJlOiBzdWJzY3JpYmUgd2l0aCBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWw6IE1vZGVsTmFtZX19KWAuXG4gKiBCYWNrZW5kIHB1Ymxpc2hlcyBge2FjdGlvbiwgaWQsIHJlY29yZH1gIHZpYVxuICogYGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHttb2RlbDogTW9kZWxOYW1lfSwgYm9keSlgO1xuICogYG1hdGNoZXMoKWAgcm91dGVzIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsIGV4dGVuZHMgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCB7XG4gIC8qKlxuICAgKiBBYmlsaXR5LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICBfYWJpbGl0eSA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBjYW4gc3Vic2NyaWJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgZnJvbnRlbmQtbW9kZWwgc3Vic2NyaXB0aW9uIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBjYW5TdWJzY3JpYmUoKSB7XG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5fbW9kZWxOYW1lKClcblxuICAgIGlmICghbW9kZWxOYW1lKSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuX21vZGVsQ2xhc3MobW9kZWxOYW1lKVxuXG4gICAgaWYgKCFNb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpXG4gICAgY29uc3QgYWJpbGl0eSA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUFiaWxpdHkoe1xuICAgICAgLy8gRm9yd2FyZCB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSBzbyB0b2tlbi1hdXRoZW50aWNhdGVkIGNsaWVudHNcbiAgICAgIC8vIHJlc29sdmUgdGhlIHNhbWUgYWJpbGl0eSB0aGV5IHdvdWxkIG92ZXIgSFRUUC4gV2l0aG91dCB0aGlzIG9ubHkgc2Vzc2lvbi9jb29raWUgYXV0aCBvbiB0aGVcbiAgICAgIC8vIHVwZ3JhZGUgcmVxdWVzdCB3b3JrcywgYW5kIHBhcmFtLWJhc2VkIGF1dGggKGxpa2UgYSBzY2FubmVyIHBhc3NpbmcgYW4gYXV0aGVudGljYXRpb25Ub2tlbilcbiAgICAgIC8vIGlzIGRyb3BwZWQg4oCUIGxlYXZpbmcgc3VjaCBzdWJzY3JpYmVycyB3aXRoIGEgZ3Vlc3QgYWJpbGl0eSBhbmQgbm8gcmVhZCBydWxlLlxuICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIG1vZGVsOiBtb2RlbE5hbWV9LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIH0pXG5cbiAgICBpZiAoIWFiaWxpdHkpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2FiaWxpdHkgPSBhYmlsaXR5XG5cbiAgICAvLyBMb2FkIHJlc291cmNlLWRlY2xhcmVkIHJ1bGVzIGZvciB0aGlzIG1vZGVsIGNsYXNzIGJlZm9yZSBjaGVja2luZyxcbiAgICAvLyBvdGhlcndpc2UgYHJ1bGVzRm9yYCByZXR1cm5zIGVtcHR5IGZvciBhYmlsaXRpZXMgd2hvc2UgcmVzb3VyY2VzXG4gICAgLy8gcmVnaXN0ZXIgcnVsZXMgbGF6aWx5IHZpYSBgYWJpbGl0aWVzKClgLlxuICAgIGFiaWxpdHkubG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MoTW9kZWxDbGFzcylcblxuICAgIGNvbnN0IHJlYWRSdWxlcyA9IGFiaWxpdHkucnVsZXNGb3Ioe2FjdGlvbjogXCJyZWFkXCIsIG1vZGVsQ2xhc3M6IE1vZGVsQ2xhc3N9KVxuXG4gICAgcmV0dXJuIHJlYWRSdWxlcy5zb21lKCgvKiogQHR5cGUge3tlZmZlY3Q6IHN0cmluZ319ICovIHJ1bGUpID0+IHJ1bGUuZWZmZWN0ID09PSBcImFsbG93XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBzdWJzY3JpcHRpb24gbmFtZSB0aHJvdWdoIGZyb250ZW5kIHJlc291cmNlcyBiZWZvcmUgZmFsbGluZyBiYWNrIHRvIGEgYmFja2luZyBtb2RlbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgcmVzb3VyY2UgbmFtZS5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgX21vZGVsQ2xhc3MobW9kZWxOYW1lKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClbbW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc291cmNlRGVmaW5pdGlvbiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSA6IG51bGxcblxuICAgICAgaWYgKHJlc291cmNlQ2xhc3M/Lk1vZGVsQ2xhc3MpIHJldHVybiByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIH1cblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpW21vZGVsTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7e2V2ZW50SWQ/OiBzdHJpbmd9fSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGl2ZXJ5LlxuICAgKi9cbiAgYXN5bmMgZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgYXdhaXQgdGhpcy5fZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt7ZXZlbnRJZD86IHN0cmluZ319IFttZXRhXSAtIE9wdGlvbmFsIGV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBfZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgaGFzRXZlbnRGaWx0ZXJzID0gdGhpcy5faGFzRXZlbnRGaWx0ZXJQYXJhbXMoKVxuXG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGJvZHkubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgYm9keS5tb2RlbCAhPT0gdGhpcy5fbW9kZWxOYW1lKCkpIHJldHVyblxuXG4gICAgaWYgKGJvZHkuYWN0aW9uID09PSBcImRlc3Ryb3lcIikge1xuICAgICAgaWYgKGJvZHkuaWQgPT09IHVuZGVmaW5lZCB8fCBib2R5LmlkID09PSBudWxsKSByZXR1cm5cblxuICAgICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWQgPSBhd2FpdCB0aGlzLl9kZXN0cm95RXZlbnRJc0F1dGhvcml6ZWQoYm9keSwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGlmICghYXV0aG9yaXplZCkgcmV0dXJuXG5cbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5KCkgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkge1xuICAgICAgICB0aGlzLnNlbmRNZXNzYWdlKHtcbiAgICAgICAgICBhY3Rpb246IGJvZHkuYWN0aW9uLFxuICAgICAgICAgIGlkOiBib2R5LmlkLFxuICAgICAgICAgIC4uLih0eXBlb2YgYm9keS5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IHttb2RlbDogYm9keS5tb2RlbH0gOiB7fSlcbiAgICAgICAgfSwgbWV0YSlcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmlkID09PSB1bmRlZmluZWQgfHwgYm9keS5pZCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gaGFzRXZlbnRGaWx0ZXJzXG4gICAgICA/IGF3YWl0IHRoaXMuX21hdGNoZWRFdmVudEZpbHRlcktleXNGb3JFdmVudElkKGJvZHkuaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuICAgICAgOiBbXVxuICAgIGNvbnN0IGlzSWRlbnRpdHlUcmFuc2l0aW9uID0gYm9keS5hY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgYm9keS5wcmV2aW91c0lkICE9PSB1bmRlZmluZWQgJiYgYm9keS5wcmV2aW91c0lkICE9PSBudWxsXG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzICYmIG1hdGNoZWRFdmVudEZpbHRlcktleXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpICYmICFpc0lkZW50aXR5VHJhbnNpdGlvbikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcHJvamVjdGVkUmVjb3JkID0gYXdhaXQgdGhpcy5fcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgIGlmICghcHJvamVjdGVkUmVjb3JkKSB7XG4gICAgICBpZiAoaXNJZGVudGl0eVRyYW5zaXRpb24pIHtcbiAgICAgICAgdGhpcy5zZW5kTWVzc2FnZSh7XG4gICAgICAgICAgYWN0aW9uOiBib2R5LmFjdGlvbixcbiAgICAgICAgICBpZDogYm9keS5pZCxcbiAgICAgICAgICAuLi4oaGFzRXZlbnRGaWx0ZXJzID8ge21hdGNoZWRFdmVudEZpbHRlcktleXN9IDoge30pLFxuICAgICAgICAgIC4uLih0eXBlb2YgYm9keS5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IHttb2RlbDogYm9keS5tb2RlbH0gOiB7fSksXG4gICAgICAgICAgcHJldmlvdXNJZDogYm9keS5wcmV2aW91c0lkXG4gICAgICAgIH0sIG1ldGEpXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgaGFzIG5vIGNvbmZpZ3VyYXRpb24gZm9yIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsaXZlciBib2R5LlxuICAgICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gKi9cbiAgICBsZXQgZGVsaXZlckJvZHkgPSB7XG4gICAgICAuLi5ib2R5LFxuICAgICAgcmVjb3JkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByb2plY3RlZFJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKSlcbiAgICB9XG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnNlbmRNZXNzYWdlKGRlbGl2ZXJCb2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBhIGRlc3Ryb3kgYWdhaW5zdCB0aGUgc3Vic2NyaWJlcidzIG9yZGluYXJ5IGF1dGhvcml6ZWQgcXVlcnkgYnlcbiAgICogcmVwbGFjaW5nIHRoZSBkZWxldGVkIGJhY2tpbmcgdGFibGUgd2l0aCB0aGUgY2FwdHVyZWQgcHJlLWRlbGV0ZSByb3cuIFZhbHVlc1xuICAgKiBhcmUgcXVvdGVkIG9uIHRoaXMgdHJ1c3RlZCBkYXRhYmFzZSBjb25uZWN0aW9uOyBubyBicm9hZGNhc3QtcHJvdmlkZWQgU1FMIGlzIHJ1bi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gYm9keSAtIERlc3Ryb3kgYnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzdWJzY3JpYmVyIGNvdWxkIHJlYWQgdGhlIHJlY29yZCBiZWZvcmUgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBfZGVzdHJveUV2ZW50SXNBdXRob3JpemVkKGJvZHksIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgY29uc3QgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgPSBib2R5LmRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkXG4gICAgY29uc3QgaWQgPSBib2R5LmlkXG5cbiAgICBpZiAoaWQgPT09IHVuZGVmaW5lZCB8fCBpZCA9PT0gbnVsbCB8fCAhZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgfHwgdHlwZW9mIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgICBjb25zdCBydWxlUXVlcnlGYWN0b3J5ID0gKCkgPT4gdGhpcy5fZGVzdHJveUF1dGhvcml6YXRpb25RdWVyeShNb2RlbENsYXNzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZClcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiLCB7cnVsZVF1ZXJ5RmFjdG9yeX0pXG5cbiAgICAgIHRoaXMuX2FwcGx5RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRUb1F1ZXJ5KHF1ZXJ5LCBNb2RlbENsYXNzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZClcbiAgICAgIHF1ZXJ5LndoZXJlKHtcbiAgICAgICAgW01vZGVsQ2xhc3MudGFibGVOYW1lKCldOiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZClcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBCb29sZWFuKGF3YWl0IHF1ZXJ5LmZpcnN0KCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBiYWNraW5nLW1vZGVsIHF1ZXJ5IHdob3NlIHNvdXJjZSBpcyB0aGUgY2FwdHVyZWQgcHJlLWRlbGV0ZSByb3cuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkIC0gQ2FwdHVyZWQgcHJlLWRlbGV0ZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gT25lLXJvdyBtb2RlbCBxdWVyeS5cbiAgICovXG4gIF9kZXN0cm95QXV0aG9yaXphdGlvblF1ZXJ5KE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSB7XG4gICAgY29uc3QgcXVlcnkgPSBNb2RlbENsYXNzLl9uZXdRdWVyeSgpXG5cbiAgICB0aGlzLl9hcHBseURlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkVG9RdWVyeShxdWVyeSwgTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyBhIHF1ZXJ5J3MgYmFja2luZyB0YWJsZSB3aXRoIGEgc2FmZWx5IHF1b3RlZCBvbmUtcm93IGRlcml2ZWQgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBxdWVyeSAtIFF1ZXJ5IHRvIHVwZGF0ZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgLSBDYXB0dXJlZCBwcmUtZGVsZXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFRvUXVlcnkocXVlcnksIE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSB7XG4gICAgY29uc3Qgc2VsZWN0ZWRDb2x1bW5zID0gT2JqZWN0LmVudHJpZXMoZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpLm1hcCgoW2NvbHVtbk5hbWUsIHNlcmlhbGl6ZWRWYWx1ZV0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeU1hcmtlciA9IHNlcmlhbGl6ZWRWYWx1ZSAmJiB0eXBlb2Ygc2VyaWFsaXplZFZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWRWYWx1ZSlcbiAgICAgICAgJiYgc2VyaWFsaXplZFZhbHVlLl9fdmVsb2Npb3VzRGVzdHJveUF1dGhvcml6YXRpb25UeXBlID09PSBcImJpbmFyeVwiXG4gICAgICAgICYmIEFycmF5LmlzQXJyYXkoc2VyaWFsaXplZFZhbHVlLnZhbHVlKVxuICAgICAgY29uc3QgdmFsdWUgPSBiaW5hcnlNYXJrZXJcbiAgICAgICAgPyBCdWZmZXIuZnJvbShzZXJpYWxpemVkVmFsdWUudmFsdWUpXG4gICAgICAgIDogZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoc2VyaWFsaXplZFZhbHVlKVxuICAgICAgY29uc3QgcXVvdGVkVmFsdWUgPSB2YWx1ZSA9PT0gbnVsbCA/IFwiTlVMTFwiIDogcXVlcnkuZHJpdmVyLnF1b3RlKHZhbHVlKVxuXG4gICAgICByZXR1cm4gYCR7cXVvdGVkVmFsdWV9IEFTICR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcbiAgICB9KVxuXG4gICAgaWYgKHNlbGVjdGVkQ29sdW1ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGF1dGhvcml6ZSBhIGRlc3Ryb3llZCAke01vZGVsQ2xhc3MubmFtZX0gd2l0aG91dCBjYXB0dXJlZCBhdHRyaWJ1dGVzYClcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tcyA9IHF1ZXJ5LmdldEZyb21zKClcblxuICAgIGZyb21zLnNwbGljZSgwLCBmcm9tcy5sZW5ndGgpXG4gICAgcXVlcnkuZnJvbShgKFNFTEVDVCAke3NlbGVjdGVkQ29sdW1ucy5qb2luKFwiLCBcIil9KSBBUyAke3F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKE1vZGVsQ2xhc3MudGFibGVOYW1lKCkpfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gYnJvYWRjYXN0UGFyYW1zIC0gUGFyYW1zIGZyb20gYGJyb2FkY2FzdFRvQ2hhbm5lbGAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBicm9hZGNhc3QgbWF0Y2hlcyB0aGlzIHN1YnNjcmliZXIncyBtb2RlbC5cbiAgICovXG4gIG1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zKSB7XG4gICAgcmV0dXJuIGJyb2FkY2FzdFBhcmFtcz8ubW9kZWwgPT09IHRoaXMuX21vZGVsTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gRGVidWctc2FmZSBzdWJzY3JpcHRpb24gZGV0YWlscy5cbiAgICovXG4gIGRlYnVnU25hcHNob3QoKSB7XG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzID0gdGhpcy5fZXZlbnRGaWx0ZXJzKClcblxuICAgIHJldHVybiB7XG4gICAgICBhYmlsaXRpZXM6IHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkLFxuICAgICAgZXZlbnRGaWx0ZXJDb3VudDogZXZlbnRGaWx0ZXJzLmxlbmd0aCxcbiAgICAgIGRlc3Ryb3lFdmVudERlbGl2ZXJ5OiB0aGlzLnBhcmFtcy5kZXN0cm95RXZlbnREZWxpdmVyeSA9PT0gdHJ1ZSxcbiAgICAgIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKSxcbiAgICAgIHByZWxvYWQ6IHRoaXMucGFyYW1zLnByZWxvYWQgIT09IHVuZGVmaW5lZCxcbiAgICAgIHF1ZXJ5RGF0YTogdGhpcy5wYXJhbXMucXVlcnlEYXRhICE9PSB1bmRlZmluZWQsXG4gICAgICBzZWxlY3Q6IHRoaXMucGFyYW1zLnNlbGVjdCAhPT0gdW5kZWZpbmVkLFxuICAgICAgc2VsZWN0c0V4dHJhOiB0aGlzLnBhcmFtcy5zZWxlY3RzRXh0cmEgIT09IHVuZGVmaW5lZCxcbiAgICAgIHVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5OiB0aGlzLnBhcmFtcy51bmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9PT0gdHJ1ZSxcbiAgICAgIHdpdGhDb3VudDogdGhpcy5wYXJhbXMud2l0aENvdW50ICE9PSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSZXF1ZXN0ZWQgZnJvbnRlbmQtbW9kZWwgbmFtZSBvciBudWxsLlxuICAgKi9cbiAgX21vZGVsTmFtZSgpIHtcbiAgICByZXR1cm4gdHlwZW9mIHRoaXMucGFyYW1zPy5tb2RlbCA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLnBhcmFtcy5tb2RlbC5sZW5ndGggPiAwXG4gICAgICA/IHRoaXMucGFyYW1zLm1vZGVsXG4gICAgICA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBldmVudCBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgc3Vic2NyaXB0aW9uIHJlcXVlc3RlZCBldmVudCBxdWVyeSBmaWx0ZXJzLlxuICAgKi9cbiAgX2hhc0V2ZW50RmlsdGVyUGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLl9ldmVudEZpbHRlcnMoKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdW5maWx0ZXJlZCBldmVudCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB1bmZpbHRlcmVkIGNhbGxiYWNrcyBzaG91bGQgcmVjZWl2ZSBldmVyeSBldmVudC5cbiAgICovXG4gIF9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBkZXN0cm95IGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGlkLW9ubHkgZGVzdHJveSBldmVudHMgc2hvdWxkIGJlIGRlbGl2ZXJlZCB3aXRoIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkoKSB7XG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlbXX0gLSBWYWxpZCBldmVudCBmaWx0ZXJzLlxuICAgKi9cbiAgX2V2ZW50RmlsdGVycygpIHtcbiAgICBpZiAodGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzXCIpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV2ZW50RmlsdGVyID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChlbnRyeSlcbiAgICAgIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMoZXZlbnRGaWx0ZXIpLmZpbHRlcigoa2V5KSA9PiAhRVZFTlRfRklMVEVSX0tFWVMuaGFzKGtleSkpXG5cbiAgICAgIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgY2Fubm90IGluY2x1ZGUgJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBldmVudEZpbHRlci5rZXkgIT09IFwic3RyaW5nXCIgfHwgZXZlbnRGaWx0ZXIua2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyByZXF1aXJlIGEga2V5XCIpXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2FuaXRpemVkIGV2ZW50IGZpbHRlci5cbiAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gKi9cbiAgICAgIGNvbnN0IHNhbml0aXplZEV2ZW50RmlsdGVyID0ge2tleTogZXZlbnRGaWx0ZXIua2V5fVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIuam9pbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci5qb2lucyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIuam9pbnMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5zZWFyY2hlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLnNlYXJjaGVzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi8gKGV2ZW50RmlsdGVyLnNlYXJjaGVzKVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIud2hlcmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci53aGVyZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIud2hlcmUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBzYW5pdGl6ZWRFdmVudEZpbHRlclxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0Pn0gLSBGcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoID0gXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCJcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbENvbnRyb2xsZXJ9ID0gYXdhaXQgaW1wb3J0KGZyb250ZW5kTW9kZWxDb250cm9sbGVyUGF0aClcblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQ29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbcGFyYW1zXSAtIE9wdGlvbmFsIHBhcmFtcyBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBTeW50aGV0aWMgY29udHJvbGxlciB1c2VkIGZvciByZXNvdXJjZSBzZXJpYWxpemF0aW9uLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCBwYXJhbXMgPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoe1xuICAgICAgYWN0aW9uOiBcIndlYnNvY2tldEV2ZW50XCIsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgY29udHJvbGxlcjogXCJmcm9udGVuZC1tb2RlbHNcIixcbiAgICAgIHBhcmFtczoge1xuICAgICAgICBhYmlsaXRpZXM6IHRoaXMucGFyYW1zLmFiaWxpdGllcyxcbiAgICAgICAgam9pbnM6IHRoaXMucGFyYW1zLmpvaW5zLFxuICAgICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICAgIHByZWxvYWQ6IHRoaXMucGFyYW1zLnByZWxvYWQsXG4gICAgICAgIHF1ZXJ5RGF0YTogdGhpcy5wYXJhbXMucXVlcnlEYXRhLFxuICAgICAgICBzZWFyY2hlczogdGhpcy5wYXJhbXMuc2VhcmNoZXMsXG4gICAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0LFxuICAgICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSxcbiAgICAgICAgd2hlcmU6IHRoaXMucGFyYW1zLndoZXJlLFxuICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgIHdpdGhDb3VudDogdGhpcy5wYXJhbXMud2l0aENvdW50XG4gICAgICB9LFxuICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgIHZpZXdQYXRoOiBcIi9cIlxuICAgIH0pXG5cbiAgICBjb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gdGhpcy5fYWJpbGl0eSB8fCB1bmRlZmluZWRcblxuICAgIHJldHVybiBjb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGVuYW50IGZvciBldmVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyBfcmVzb2x2ZUV2ZW50VGVuYW50KGlkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCB3ZWJzb2NrZXQgZXZlbnQgdGVuYW50IHJlc29sdXRpb25cIn0sIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgc3Vic2NyaWJlLXRpbWUgdGVuYW50IHJlc29sdXRpb24gKGBXZWJzb2NrZXRTZXNzaW9uLl9yZXNvbHZlVGVuYW50YCk6XG4gICAgICAvLyBwYXNzIGBzdWJzY3JpcHRpb246IHtjaGFubmVsLCBwYXJhbXN9YCBzbyByZXNvbHZlcnMgdGhhdCBkZXJpdmUgc2NvcGUgZnJvbSB0aGVcbiAgICAgIC8vIHN1YnNjcmlwdGlvbiBiZWhhdmUgdGhlIHNhbWUgZm9yIGJyb2FkY2FzdHMgYXMgdGhleSBkaWQgYXQgYGNoYW5uZWwtc3Vic2NyaWJlYC5cbiAgICAgIC8vIFRoZSBzeW50aGV0aWMgcmVxdWVzdCBmb3J3YXJkcyB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSxcbiAgICAgIC8vIG1hdGNoaW5nIHRoaXMgY2hhbm5lbCdzIGFiaWxpdHkgcmVzb2x1dGlvbiBhYm92ZS5cbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQoe1xuICAgICAgICBwYXJhbXM6IHsuLi50aGlzLnBhcmFtcywgaWQsIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKX0sXG4gICAgICAgIHJlcXVlc3Q6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSksXG4gICAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgICAgc3Vic2NyaXB0aW9uOiB7Y2hhbm5lbDogRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgcGFyYW1zOiB0aGlzLnBhcmFtc31cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc3Vic2NyaWJlcidzIHRlbmFudCBmb3IgdGhlIGJyb2FkY2FzdCByZWNvcmQgYW5kIHJ1bnMgYGNhbGxiYWNrYCBpbnNpZGUgdGhhdCB0ZW5hbnRcbiAgICogY29udGV4dC4gQnJvYWRjYXN0IGRlbGl2ZXJ5IHJ1bnMgaW4gd2hhdGV2ZXIgYW1iaWVudCB0ZW5hbnQgY29udGV4dCB0aGUgcHVibGlzaGVyIGxlZnQgYmVoaW5kLiBGb3JcbiAgICogbXVsdGktdGVuYW50IHJlY29yZHMgdGhhdCBhbWJpZW50IHRlbmFudCBtYXkgaGF2ZSBiZWVuIHJlc29sdmVkIHdpdGhvdXQgdGhlIHN1YnNjcmliZXIncyByZXF1ZXN0XG4gICAqIChlLmcuIGEgcmVsYXkgZW5kcG9pbnQgb3IgYmFja2dyb3VuZCBqb2IgbXV0YXRpbmcgdGhlIHJvdyksIHNvIGl0IGxhY2tzIHRoZSBzdWJzY3JpYmVyJ3MgcGVyLXJlY29yZFxuICAgKiBhY2Nlc3MgZmxhZ3MgYW5kIHRoZSBwZXItZXZlbnQgYXV0aG9yaXphdGlvbiBxdWVyeSB3cm9uZ2x5IGZpbmRzIG5vdGhpbmcuIFJlLXJlc29sdmluZyB0aGUgdGVuYW50XG4gICAqIGZyb20gdGhlIGV2ZW50IHJlY29yZCBpZCBwbHVzIHRoZSBzdWJzY3JpYmVyJ3MgcmVxdWVzdCBtYWtlcyB0aGUgYXV0aG9yaXphdGlvbiBxdWVyaWVzIHJ1biBhZ2FpbnN0XG4gICAqIHRoZSBzdWJzY3JpYmVyJ3Mgb3duIHRlbmFudC9hYmlsaXR5IHNjb3BlLiBXaGVuIG5vIHRlbmFudCByZXNvbHZlcyAobm9uLW11bHRpdGVuYW50IGNvbmZpZ3MpLCB0aGVcbiAgICogY2FsbGJhY2sgcnVucyBkaXJlY3RseSBzbyB0aGUgYW1iaWVudCBjb250ZXh0IGlzIHByZXNlcnZlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdXRob3JpemVkLXF1ZXJ5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aEV2ZW50VGVuYW50KGlkLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uIHx8IHR5cGVvZiBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSBhd2FpdCB0aGlzLl9yZXNvbHZlRXZlbnRUZW5hbnQoaWQpXG5cbiAgICAvLyBBbHdheXMgZW50ZXIgYHJ1bldpdGhUZW5hbnRgLCBldmVuIHdoZW4gbm8gdGVuYW50IHJlc29sdmVkLiBCcm9hZGNhc3QgZmFuLW91dFxuICAgIC8vIHJ1bnMgaW4gdGhlIHB1Ymxpc2hlcidzIGFtYmllbnQgdGVuYW50IGNvbnRleHQ7IGZhbGxpbmcgYmFjayB0byBgY2FsbGJhY2soKWBcbiAgICAvLyB0aGVyZSB3b3VsZCBhdXRob3JpemUgYSBjcm9zcy10ZW5hbnQgcmVjb3JkIGFnYWluc3QgdGhlIHB1Ymxpc2hlcidzIHRlbmFudCBhbmRcbiAgICAvLyBjb3VsZCBsZWFrIGl0IHRvIGEgc3Vic2NyaWJlciB3aG9zZSBvd24gcmVzb2x2ZXIgY291bGQgbm90IHJlc29sdmUgaXQuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBldmVudCB0ZW5hbnRcIn0sIGNhbGxiYWNrKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gRXZlbnQgZmlsdGVyIGtleXMgbWF0Y2hlZCBieSB0aGUgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX21hdGNoZWRFdmVudEZpbHRlcktleXNGb3JFdmVudElkKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIC8qKlxuICAgICAqIE1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBldmVudEZpbHRlciBvZiB0aGlzLl9ldmVudEZpbHRlcnMoKSkge1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IGF3YWl0IHRoaXMuX2V2ZW50TWF0Y2hlc0ZpbHRlcih7XG4gICAgICAgIEZyb250ZW5kTW9kZWxDb250cm9sbGVyLFxuICAgICAgICBldmVudEZpbHRlcixcbiAgICAgICAgaWRcbiAgICAgIH0pXG5cbiAgICAgIGlmIChtYXRjaGVzKSBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLnB1c2goZXZlbnRGaWx0ZXIua2V5KVxuICAgIH1cblxuICAgIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBtYXRjaGVzIGZpbHRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGaWx0ZXIgYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBhcmdzLkZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gYXJncy5ldmVudEZpbHRlciAtIEV2ZW50IGZpbHRlciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgcmVjb3JkIG1hdGNoZXMgdGhlIGZpbHRlci5cbiAgICovXG4gIGFzeW5jIF9ldmVudE1hdGNoZXNGaWx0ZXIoe0Zyb250ZW5kTW9kZWxDb250cm9sbGVyLCBldmVudEZpbHRlciwgaWR9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCB7XG4gICAgICAgIGpvaW5zOiBldmVudEZpbHRlci5qb2lucyxcbiAgICAgICAgc2VhcmNoZXM6IGV2ZW50RmlsdGVyLnNlYXJjaGVzLFxuICAgICAgICB3aGVyZTogZXZlbnRGaWx0ZXIud2hlcmVcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgY29uc3Qgd2hlcmUgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxXaGVyZSgpXG4gICAgICBjb25zdCBqb2lucyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEpvaW5zKClcbiAgICAgIC8vIFN0YXJ0IGZyb20gdGhlIHN1YnNjcmliZXIncyBhdXRob3JpemVkIHNjb3BlIHNvIGEgZmlsdGVyIGNhbiBvbmx5IGV2ZXIgbWF0Y2ggcmVjb3JkcyB0aGVcbiAgICAgIC8vIHN1YnNjcmlwdGlvbidzIGFiaWxpdHkgcGVybWl0cyB0byByZWFkLlxuICAgICAgbGV0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuXG4gICAgICBpZiAod2hlcmUpIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pXG4gICAgICBpZiAoam9pbnMpIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsSm9pbnMoe2pvaW5zLCBxdWVyeX0pXG5cbiAgICAgIGZvciAoY29uc3Qgc2VhcmNoIG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFNlYXJjaGVzKCkpIHtcbiAgICAgICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9qZWN0ZWQgcmVjb3JkIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4gfCBudWxsPn0gLSBTZXJpYWxpemVkIHByb2plY3RlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgLy8gUmVsb2FkIHRocm91Z2ggdGhlIHN1YnNjcmliZXIncyBhdXRob3JpemVkIHNjb3BlIHNvIHByb2plY3RlZCByZWNvcmRzIGFyZSBvbmx5IGV2ZXIgc2VudCBmb3JcbiAgICAgIC8vIHJvd3MgdGhlIHN1YnNjcmlwdGlvbidzIGFiaWxpdHkgcGVybWl0cyB0byByZWFkLlxuICAgICAgbGV0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuICAgICAgY29uc3QgcHJlbG9hZCA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuXG4gICAgICBpZiAocHJlbG9hZCkgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHByZWxvYWQpXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2l0aENvdW50KCkpIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNwZWMuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59Pn0gKi9cbiAgICAgICAgY29uc3Qgc3BlYyA9IHt9XG5cbiAgICAgICAgc3BlY1tlbnRyeS5hdHRyaWJ1dGVOYW1lXSA9IHtcbiAgICAgICAgICByZWxhdGlvbnNoaXA6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChlbnRyeS53aGVyZSkgOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBxdWVyeS53aXRoQ291bnQoc3BlYylcbiAgICAgIH1cblxuICAgICAgY29uc3QgcXVlcnlEYXRhID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUXVlcnlEYXRhKClcblxuICAgICAgaWYgKHF1ZXJ5RGF0YSAhPT0gbnVsbCkgcXVlcnkucXVlcnlEYXRhKHF1ZXJ5RGF0YSlcblxuICAgICAgcXVlcnkgPSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgICAgaWYgKCFtb2RlbCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENvbXB1dGVBYmlsaXRpZXMoW21vZGVsXSlcbiAgICAgIH1cblxuICAgICAgY29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHVuZGVmaW5lZFxuXG4gICAgICByZXR1cm4gYXdhaXQgY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnNlcmlhbGl6ZShtb2RlbCwgXCJmaW5kXCIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNaW5pbWFsIFJlcXVlc3QtbGlrZSBzdHViIHVzZWQgb25seSBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLiBBdm9pZHNcbiAgICogaW1wb3J0aW5nIGBXZWJzb2NrZXRSZXF1ZXN0YCBoZXJlIGJlY2F1c2UgaXRzIGBub2RlOnF1ZXJ5c3RyaW5nYFxuICAgKiBkZXBlbmRlbmN5IHdvdWxkIHB1bGwgc2VydmVyLW9ubHkgY29kZSBpbnRvIGJyb3dzZXIgYnVuZGxlcyB2aWFcbiAgICogdGhlIGBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIg4oaSIHdlYnNvY2tldC1wdWJsaXNoZXJzYCBpbXBvcnQgY2hhaW4uXG4gICAqIEhlYWRlciBuYW1lcyBhcmUgbm9ybWFsaXplZCB0byBsb3dlcmNhc2Ugc28gYGhlYWRlcihcImNvb2tpZVwiKWBcbiAgICogZmluZHMgYSB2YWx1ZSByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhlIHVwZ3JhZGUtcmVxdWVzdCBoZWFkZXJzXG4gICAqIG1hcCB1c2VzIGBcIkNvb2tpZVwiYCBvciBgXCJjb29raWVcImAuIFNlc3Npb24gbWV0YWRhdGEgc3RheXMgc2VwYXJhdGVcbiAgICogZnJvbSBoZWFkZXJzIGFuZCBpcyBleHBvc2VkIHRocm91Z2ggYG1ldGFkYXRhKC4uLilgIGZvciBhYmlsaXR5XG4gICAqIHJlc29sdmVycyB0aGF0IG5lZWQgd2Vic29ja2V0LWRlbGl2ZXJlZCBzZXNzaW9uIGRhdGEuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdH0gUmVxdWVzdC1saWtlIG9iamVjdCBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLlxuICAgKi9cbiAgX3N5bnRoZXRpY1JlcXVlc3QoKSB7XG4gICAgY29uc3QgdXBncmFkZVJlcXVlc3QgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRVcGdyYWRlUmVxdWVzdH0gKi8gKHRoaXMuc2Vzc2lvbi51cGdyYWRlUmVxdWVzdClcbiAgICBjb25zdCByYXdIZWFkZXJzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5oZWFkZXJzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5oZWFkZXJzKCkgOiB7fVxuICAgIGNvbnN0IG1ldGFkYXRhID0gdHlwZW9mIHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5zZXNzaW9uLmdldE1ldGFkYXRhKCkgOiB7fVxuICAgIGNvbnN0IHJlbW90ZUFkZHJlc3MgPSB0eXBlb2YgdXBncmFkZVJlcXVlc3Q/LnJlbW90ZUFkZHJlc3MgPT09IFwiZnVuY3Rpb25cIiA/IHVwZ3JhZGVSZXF1ZXN0LnJlbW90ZUFkZHJlc3MoKSA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEhlYWRlciBtYXAuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPn0gKi9cbiAgICBjb25zdCBoZWFkZXJNYXAgPSB7fVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmF3SGVhZGVycyB8fCB7fSkpIHtcbiAgICAgIGhlYWRlck1hcFtrZXkudG9Mb3dlckNhc2UoKV0gPSByYXdIZWFkZXJzW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaGVhZGVyczogKCkgPT4gaGVhZGVyTWFwLFxuICAgICAgaGVhZGVyOiAobmFtZSkgPT4gaGVhZGVyTWFwW1N0cmluZyhuYW1lKS50b0xvd2VyQ2FzZSgpXSxcbiAgICAgIG1ldGFkYXRhOiAoa2V5KSA9PiBrZXkgPT09IHVuZGVmaW5lZCA/IHsuLi5tZXRhZGF0YX0gOiBtZXRhZGF0YVtrZXldLFxuICAgICAgcGF0aDogKCkgPT4gXCIvZnJvbnRlbmQtbW9kZWxzXCIsXG4gICAgICBodHRwTWV0aG9kOiAoKSA9PiBcIlBPU1RcIixcbiAgICAgIHJlbW90ZUFkZHJlc3M6ICgpID0+IHJlbW90ZUFkZHJlc3MsXG4gICAgICBvcmlnaW46ICgpID0+IGhlYWRlck1hcC5vcmlnaW5cbiAgICB9XG4gIH1cbn1cbiJdfQ==