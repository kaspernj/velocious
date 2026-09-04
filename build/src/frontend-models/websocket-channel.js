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
            const column = ModelClass.getColumnsHash()[columnName];
            if (!column)
                throw new Error(`Cannot authorize a destroyed ${ModelClass.name} with unknown column ${columnName}`);
            const selectedValue = query.driver.getType() == "pgsql"
                ? `CAST(${quotedValue} AS ${column.getType()})`
                : quotedValue;
            return `${selectedValue} AS ${query.driver.quoteColumn(columnName)}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDbEMsT0FBTyxRQUFRLE1BQU0sbUNBQW1DLENBQUE7QUFDeEQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFFdkU7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0gsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUE7QUFFeEUscUZBQXFGO0FBQ3JGLDJFQUEyRTtBQUMzRSxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFBO0FBRXREOzs7Ozs7R0FNRztBQUNILFNBQVMseUNBQXlDLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxFQUFFO0lBQzNFLE1BQU0sa0JBQWtCLEdBQUcseUJBQXlCLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFBO0lBQ3BFLDRGQUE0RjtJQUM1RixNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtJQUU3QixLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENB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QU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDaEQsU0FBUyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNoRCxDQUFDO1FBRUQsT0FBTztZQUNMLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTO1lBQ3hCLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN2RCxRQUFRLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztZQUNwRSxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsa0JBQWtCO1lBQzlCLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNO1lBQ3hCLGFBQWEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhO1lBQ2xDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTTtTQUMvQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIGZyb20gXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiXG5pbXBvcnQge0J1ZmZlcn0gZnJvbSBcIm5vZGU6YnVmZmVyXCJcbmltcG9ydCBSZXNwb25zZSBmcm9tIFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0fSBmcm9tIFwiLi9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9ufSBmcm9tIFwiLi9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7ZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3Rpb24/OiBzdHJpbmcsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBpZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzPzogc3RyaW5nW10sIHByZXZpb3VzSWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgcmVjb3JkPzogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIFtrZXk6IHN0cmluZ106IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3toZWFkZXJzPzogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCByZW1vdGVBZGRyZXNzPzogKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFVwZ3JhZGVSZXF1ZXN0XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPiwgaGVhZGVyOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgbWV0YWRhdGE6IChrZXk/OiBzdHJpbmcpID0+IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPiB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgdW5kZWZpbmVkLCBwYXRoOiAoKSA9PiBzdHJpbmcsIGh0dHBNZXRob2Q6ICgpID0+IHN0cmluZywgcmVtb3RlQWRkcmVzczogKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkLCBvcmlnaW46ICgpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3RcbiAqL1xuY29uc3QgRVZFTlRfRklMVEVSX0tFWVMgPSBuZXcgU2V0KFtcImpvaW5zXCIsIFwia2V5XCIsIFwic2VhcmNoZXNcIiwgXCJ3aGVyZVwiXSlcblxuLy8gTWlycm9ycyBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FIGluIC4vd2Vic29ja2V0LXB1Ymxpc2hlcnMuanMsIGR1cGxpY2F0ZWQgaGVyZVxuLy8gdG8gYXZvaWQgdGhlIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlciDihpIgd2Vic29ja2V0LXB1Ymxpc2hlcnMgaW1wb3J0IGN5Y2xlLlxuY29uc3QgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSA9IFwiZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqXG4gKiBSZXNvbHZlcyBmcm9udGVuZCByZXNvdXJjZSBpZGVudGl0eSBhdHRyaWJ1dGVzIHRvIGJhY2tpbmcgZGF0YWJhc2UgY29sdW1ucy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gcHJpbWFyeUtleSAtIEZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5IGRlZmluaXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59IC0gQmFja2luZyBjb2x1bW4gY29uZGl0aW9ucy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpIHtcbiAgY29uc3QgcmVzb3VyY2VDb25kaXRpb25zID0gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBpZClcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAqL1xuICBjb25zdCBkYXRhYmFzZUNvbmRpdGlvbnMgPSB7fVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZUNvbmRpdGlvbnMpKSB7XG4gICAgZGF0YWJhc2VDb25kaXRpb25zW01vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSldID0gdmFsdWVcbiAgfVxuXG4gIHJldHVybiBkYXRhYmFzZUNvbmRpdGlvbnNcbn1cblxuLyoqXG4gKiBSdW5zIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uIG9wdGlvbnMgZm9yIGEgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc30gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gIHJldHVybiB7XG4gICAgdGltZVpvbmU6IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbilcbiAgfVxufVxuXG4vKipcbiAqIFBlci1zZXNzaW9uIGNoYW5uZWwgc3Vic2NyaXB0aW9uIGZvciBmcm9udGVuZC1tb2RlbCBsaWZlY3ljbGUgZXZlbnRzLlxuICogUmVwbGFjZXMgdGhlIGxlZ2FjeSBgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWxgIChQaGFzZSAzKS5cbiAqXG4gKiBgY2FuU3Vic2NyaWJlYCByZXNvbHZlcyB0aGUgY2FsbGVyJ3MgYWJpbGl0eSBvbmNlIGFuZCByZXF1aXJlcyBhIHJlYWQgcnVsZVxuICogZm9yIHRoZSByZXF1ZXN0ZWQgbW9kZWwgY2xhc3MuIENyZWF0ZS91cGRhdGUgZGVsaXZlcnkgdGhlbiByZWxvYWRzIGVhY2hcbiAqIHJlY29yZCB0aHJvdWdoIHRoYXQgYWJpbGl0eSBhbmQgc2VyaWFsaXplcyBpdCB0aHJvdWdoIHRoZSBzdWJzY3JpYmVkXG4gKiBmcm9udGVuZCByZXNvdXJjZS4gU3Vic2NyaWJlci1wcm92aWRlZCBldmVudCBmaWx0ZXJzIGNhbiBmdXJ0aGVyIG5hcnJvd1xuICogdGhvc2UgYXV0aG9yaXplZCBldmVudHMuXG4gKlxuICogV2lyZTogc3Vic2NyaWJlIHdpdGggYHN1YnNjcmliZUNoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge3BhcmFtczoge21vZGVsOiBNb2RlbE5hbWV9fSlgLlxuICogQmFja2VuZCBwdWJsaXNoZXMgYHthY3Rpb24sIGlkLCByZWNvcmR9YCB2aWFcbiAqIGBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7bW9kZWw6IE1vZGVsTmFtZX0sIGJvZHkpYDtcbiAqIGBtYXRjaGVzKClgIHJvdXRlcyBieSBtb2RlbCBuYW1lLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbCBleHRlbmRzIFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwge1xuICAvKipcbiAgICogQWJpbGl0eS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgX2FiaWxpdHkgPSBudWxsXG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FuIHN1YnNjcmliZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGZyb250ZW5kLW1vZGVsIHN1YnNjcmlwdGlvbiBpcyBhdXRob3JpemVkLlxuICAgKi9cbiAgYXN5bmMgY2FuU3Vic2NyaWJlKCkge1xuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHRoaXMuX21vZGVsTmFtZSgpXG5cbiAgICBpZiAoIW1vZGVsTmFtZSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fZXZlbnRGaWx0ZXJzKClcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLl9tb2RlbENsYXNzKG1vZGVsTmFtZSlcblxuICAgIGlmICghTW9kZWxDbGFzcykgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCByZXF1ZXN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKVxuICAgIGNvbnN0IGFiaWxpdHkgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVBYmlsaXR5KHtcbiAgICAgIC8vIEZvcndhcmQgdGhlIHN1YnNjcmliZXIncyBwYXJhbXMgKGUuZy4gYXV0aGVudGljYXRpb25Ub2tlbikgc28gdG9rZW4tYXV0aGVudGljYXRlZCBjbGllbnRzXG4gICAgICAvLyByZXNvbHZlIHRoZSBzYW1lIGFiaWxpdHkgdGhleSB3b3VsZCBvdmVyIEhUVFAuIFdpdGhvdXQgdGhpcyBvbmx5IHNlc3Npb24vY29va2llIGF1dGggb24gdGhlXG4gICAgICAvLyB1cGdyYWRlIHJlcXVlc3Qgd29ya3MsIGFuZCBwYXJhbS1iYXNlZCBhdXRoIChsaWtlIGEgc2Nhbm5lciBwYXNzaW5nIGFuIGF1dGhlbnRpY2F0aW9uVG9rZW4pXG4gICAgICAvLyBpcyBkcm9wcGVkIOKAlCBsZWF2aW5nIHN1Y2ggc3Vic2NyaWJlcnMgd2l0aCBhIGd1ZXN0IGFiaWxpdHkgYW5kIG5vIHJlYWQgcnVsZS5cbiAgICAgIHBhcmFtczogey4uLnRoaXMucGFyYW1zLCBtb2RlbDogbW9kZWxOYW1lfSxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSlcbiAgICB9KVxuXG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9hYmlsaXR5ID0gYWJpbGl0eVxuXG4gICAgLy8gTG9hZCByZXNvdXJjZS1kZWNsYXJlZCBydWxlcyBmb3IgdGhpcyBtb2RlbCBjbGFzcyBiZWZvcmUgY2hlY2tpbmcsXG4gICAgLy8gb3RoZXJ3aXNlIGBydWxlc0ZvcmAgcmV0dXJucyBlbXB0eSBmb3IgYWJpbGl0aWVzIHdob3NlIHJlc291cmNlc1xuICAgIC8vIHJlZ2lzdGVyIHJ1bGVzIGxhemlseSB2aWEgYGFiaWxpdGllcygpYC5cbiAgICBhYmlsaXR5LmxvYWRBYmlsaXRpZXNGb3JNb2RlbENsYXNzKE1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCByZWFkUnVsZXMgPSBhYmlsaXR5LnJ1bGVzRm9yKHthY3Rpb246IFwicmVhZFwiLCBtb2RlbENsYXNzOiBNb2RlbENsYXNzfSlcblxuICAgIHJldHVybiByZWFkUnVsZXMuc29tZSgoLyoqIEB0eXBlIHt7ZWZmZWN0OiBzdHJpbmd9fSAqLyBydWxlKSA9PiBydWxlLmVmZmVjdCA9PT0gXCJhbGxvd1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgc3Vic2NyaXB0aW9uIG5hbWUgdGhyb3VnaCBmcm9udGVuZCByZXNvdXJjZXMgYmVmb3JlIGZhbGxpbmcgYmFjayB0byBhIGJhY2tpbmcgbW9kZWwgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIEZyb250ZW5kIHJlc291cmNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICovXG4gIF9tb2RlbENsYXNzKG1vZGVsTmFtZSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpW21vZGVsTmFtZV1cbiAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSByZXNvdXJjZURlZmluaXRpb24gPyBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbikgOiBudWxsXG5cbiAgICAgIGlmIChyZXNvdXJjZUNsYXNzPy5Nb2RlbENsYXNzKSByZXR1cm4gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICB9XG5cbiAgICByZXR1cm4gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVttb2RlbE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge3tldmVudElkPzogc3RyaW5nfX0gW21ldGFdIC0gT3B0aW9uYWwgZXZlbnQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxpdmVyeS5cbiAgICovXG4gIGFzeW5jIGRlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSkge1xuICAgIGF3YWl0IHRoaXMuX2RlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7e2V2ZW50SWQ/OiBzdHJpbmd9fSBbbWV0YV0gLSBPcHRpb25hbCBldmVudCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGl2ZXJ5LlxuICAgKi9cbiAgYXN5bmMgX2RlbGl2ZXJCcm9hZGNhc3QoYm9keSwgbWV0YSkge1xuICAgIGNvbnN0IGhhc0V2ZW50RmlsdGVycyA9IHRoaXMuX2hhc0V2ZW50RmlsdGVyUGFyYW1zKClcblxuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBib2R5Lm1vZGVsID09PSBcInN0cmluZ1wiICYmIGJvZHkubW9kZWwgIT09IHRoaXMuX21vZGVsTmFtZSgpKSByZXR1cm5cblxuICAgIGlmIChib2R5LmFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGlmIChib2R5LmlkID09PSB1bmRlZmluZWQgfHwgYm9keS5pZCA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IEZyb250ZW5kTW9kZWxDb250cm9sbGVyID0gYXdhaXQgdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpXG4gICAgICBjb25zdCBhdXRob3JpemVkID0gYXdhaXQgdGhpcy5fZGVzdHJveUV2ZW50SXNBdXRob3JpemVkKGJvZHksIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBpZiAoIWF1dGhvcml6ZWQpIHJldHVyblxuXG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHtcbiAgICAgICAgdGhpcy5zZW5kTWVzc2FnZSh7XG4gICAgICAgICAgYWN0aW9uOiBib2R5LmFjdGlvbixcbiAgICAgICAgICBpZDogYm9keS5pZCxcbiAgICAgICAgICAuLi4odHlwZW9mIGJvZHkubW9kZWwgPT09IFwic3RyaW5nXCIgPyB7bW9kZWw6IGJvZHkubW9kZWx9IDoge30pXG4gICAgICAgIH0sIG1ldGEpXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYm9keS5pZCA9PT0gdW5kZWZpbmVkIHx8IGJvZHkuaWQgPT09IG51bGwpIHtcbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IEZyb250ZW5kTW9kZWxDb250cm9sbGVyID0gYXdhaXQgdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpXG4gICAgY29uc3QgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyA9IGhhc0V2ZW50RmlsdGVyc1xuICAgICAgPyBhd2FpdCB0aGlzLl9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcbiAgICAgIDogW11cbiAgICBjb25zdCBpc0lkZW50aXR5VHJhbnNpdGlvbiA9IGJvZHkuYWN0aW9uID09PSBcInVwZGF0ZVwiICYmIGJvZHkucHJldmlvdXNJZCAhPT0gdW5kZWZpbmVkICYmIGJvZHkucHJldmlvdXNJZCAhPT0gbnVsbFxuXG4gICAgaWYgKGhhc0V2ZW50RmlsdGVycyAmJiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLmxlbmd0aCA9PT0gMCAmJiAhdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSAmJiAhaXNJZGVudGl0eVRyYW5zaXRpb24pIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHByb2plY3RlZFJlY29yZCA9IGF3YWl0IHRoaXMuX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICBpZiAoIXByb2plY3RlZFJlY29yZCkge1xuICAgICAgaWYgKGlzSWRlbnRpdHlUcmFuc2l0aW9uKSB7XG4gICAgICAgIHRoaXMuc2VuZE1lc3NhZ2Uoe1xuICAgICAgICAgIGFjdGlvbjogYm9keS5hY3Rpb24sXG4gICAgICAgICAgaWQ6IGJvZHkuaWQsXG4gICAgICAgICAgLi4uKGhhc0V2ZW50RmlsdGVycyA/IHttYXRjaGVkRXZlbnRGaWx0ZXJLZXlzfSA6IHt9KSxcbiAgICAgICAgICAuLi4odHlwZW9mIGJvZHkubW9kZWwgPT09IFwic3RyaW5nXCIgPyB7bW9kZWw6IGJvZHkubW9kZWx9IDoge30pLFxuICAgICAgICAgIHByZXZpb3VzSWQ6IGJvZHkucHJldmlvdXNJZFxuICAgICAgICB9LCBtZXRhKVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBjaGFubmVsIGhhcyBubyBjb25maWd1cmF0aW9uIGZvciB0cmFuc3BvcnQgc2VyaWFsaXphdGlvblwiKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGl2ZXIgYm9keS5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9ICovXG4gICAgbGV0IGRlbGl2ZXJCb2R5ID0ge1xuICAgICAgLi4uYm9keSxcbiAgICAgIHJlY29yZDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwcm9qZWN0ZWRSZWNvcmQsIHRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSkpXG4gICAgfVxuXG4gICAgaWYgKGhhc0V2ZW50RmlsdGVycykge1xuICAgICAgZGVsaXZlckJvZHkgPSB7XG4gICAgICAgIC4uLmRlbGl2ZXJCb2R5LFxuICAgICAgICBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5zZW5kTWVzc2FnZShkZWxpdmVyQm9keSwgbWV0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgYSBkZXN0cm95IGFnYWluc3QgdGhlIHN1YnNjcmliZXIncyBvcmRpbmFyeSBhdXRob3JpemVkIHF1ZXJ5IGJ5XG4gICAqIHJlcGxhY2luZyB0aGUgZGVsZXRlZCBiYWNraW5nIHRhYmxlIHdpdGggdGhlIGNhcHR1cmVkIHByZS1kZWxldGUgcm93LiBWYWx1ZXNcbiAgICogYXJlIHF1b3RlZCBvbiB0aGlzIHRydXN0ZWQgZGF0YWJhc2UgY29ubmVjdGlvbjsgbm8gYnJvYWRjYXN0LXByb3ZpZGVkIFNRTCBpcyBydW4uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBEZXN0cm95IGJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc3Vic2NyaWJlciBjb3VsZCByZWFkIHRoZSByZWNvcmQgYmVmb3JlIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2Rlc3Ryb3lFdmVudElzQXV0aG9yaXplZChib2R5LCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIGNvbnN0IGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkID0gYm9keS5kZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFxuICAgIGNvbnN0IGlkID0gYm9keS5pZFxuXG4gICAgaWYgKGlkID09PSB1bmRlZmluZWQgfHwgaWQgPT09IG51bGwgfHwgIWRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkIHx8IHR5cGVvZiBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgcnVsZVF1ZXJ5RmFjdG9yeSA9ICgpID0+IHRoaXMuX2Rlc3Ryb3lBdXRob3JpemF0aW9uUXVlcnkoTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG4gICAgICBjb25zdCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIiwge3J1bGVRdWVyeUZhY3Rvcnl9KVxuXG4gICAgICB0aGlzLl9hcHBseURlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkVG9RdWVyeShxdWVyeSwgTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG4gICAgICBxdWVyeS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgYmFja2luZy1tb2RlbCBxdWVyeSB3aG9zZSBzb3VyY2UgaXMgdGhlIGNhcHR1cmVkIHByZS1kZWxldGUgcm93LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAtIENhcHR1cmVkIHByZS1kZWxldGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIE9uZS1yb3cgbW9kZWwgcXVlcnkuXG4gICAqL1xuICBfZGVzdHJveUF1dGhvcml6YXRpb25RdWVyeShNb2RlbENsYXNzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuXG4gICAgdGhpcy5fYXBwbHlEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFRvUXVlcnkocXVlcnksIE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKVxuXG4gICAgcmV0dXJuIHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgYSBxdWVyeSdzIGJhY2tpbmcgdGFibGUgd2l0aCBhIHNhZmVseSBxdW90ZWQgb25lLXJvdyBkZXJpdmVkIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gcXVlcnkgLSBRdWVyeSB0byB1cGRhdGUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkIC0gQ2FwdHVyZWQgcHJlLWRlbGV0ZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRUb1F1ZXJ5KHF1ZXJ5LCBNb2RlbENsYXNzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCkge1xuICAgIGNvbnN0IHNlbGVjdGVkQ29sdW1ucyA9IE9iamVjdC5lbnRyaWVzKGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKS5tYXAoKFtjb2x1bW5OYW1lLCBzZXJpYWxpemVkVmFsdWVdKSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlNYXJrZXIgPSBzZXJpYWxpemVkVmFsdWUgJiYgdHlwZW9mIHNlcmlhbGl6ZWRWYWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShzZXJpYWxpemVkVmFsdWUpXG4gICAgICAgICYmIHNlcmlhbGl6ZWRWYWx1ZS5fX3ZlbG9jaW91c0Rlc3Ryb3lBdXRob3JpemF0aW9uVHlwZSA9PT0gXCJiaW5hcnlcIlxuICAgICAgICAmJiBBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWRWYWx1ZS52YWx1ZSlcbiAgICAgIGNvbnN0IHZhbHVlID0gYmluYXJ5TWFya2VyXG4gICAgICAgID8gQnVmZmVyLmZyb20oc2VyaWFsaXplZFZhbHVlLnZhbHVlKVxuICAgICAgICA6IGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHNlcmlhbGl6ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IHF1b3RlZFZhbHVlID0gdmFsdWUgPT09IG51bGwgPyBcIk5VTExcIiA6IHF1ZXJ5LmRyaXZlci5xdW90ZSh2YWx1ZSlcbiAgICAgIGNvbnN0IGNvbHVtbiA9IE1vZGVsQ2xhc3MuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuXG4gICAgICBpZiAoIWNvbHVtbikgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXV0aG9yaXplIGEgZGVzdHJveWVkICR7TW9kZWxDbGFzcy5uYW1lfSB3aXRoIHVua25vd24gY29sdW1uICR7Y29sdW1uTmFtZX1gKVxuXG4gICAgICBjb25zdCBzZWxlY3RlZFZhbHVlID0gcXVlcnkuZHJpdmVyLmdldFR5cGUoKSA9PSBcInBnc3FsXCJcbiAgICAgICAgPyBgQ0FTVCgke3F1b3RlZFZhbHVlfSBBUyAke2NvbHVtbi5nZXRUeXBlKCl9KWBcbiAgICAgICAgOiBxdW90ZWRWYWx1ZVxuXG4gICAgICByZXR1cm4gYCR7c2VsZWN0ZWRWYWx1ZX0gQVMgJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuICAgIH0pXG5cbiAgICBpZiAoc2VsZWN0ZWRDb2x1bW5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXV0aG9yaXplIGEgZGVzdHJveWVkICR7TW9kZWxDbGFzcy5uYW1lfSB3aXRob3V0IGNhcHR1cmVkIGF0dHJpYnV0ZXNgKVxuICAgIH1cblxuICAgIGNvbnN0IGZyb21zID0gcXVlcnkuZ2V0RnJvbXMoKVxuXG4gICAgZnJvbXMuc3BsaWNlKDAsIGZyb21zLmxlbmd0aClcbiAgICBxdWVyeS5mcm9tKGAoU0VMRUNUICR7c2VsZWN0ZWRDb2x1bW5zLmpvaW4oXCIsIFwiKX0pIEFTICR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUoTW9kZWxDbGFzcy50YWJsZU5hbWUoKSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgZnJvbSBgYnJvYWRjYXN0VG9DaGFubmVsYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGJyb2FkY2FzdCBtYXRjaGVzIHRoaXMgc3Vic2NyaWJlcidzIG1vZGVsLlxuICAgKi9cbiAgbWF0Y2hlcyhicm9hZGNhc3RQYXJhbXMpIHtcbiAgICByZXR1cm4gYnJvYWRjYXN0UGFyYW1zPy5tb2RlbCA9PT0gdGhpcy5fbW9kZWxOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBEZWJ1Zy1zYWZlIHN1YnNjcmlwdGlvbiBkZXRhaWxzLlxuICAgKi9cbiAgZGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBldmVudEZpbHRlcnMgPSB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdGllczogdGhpcy5wYXJhbXMuYWJpbGl0aWVzICE9PSB1bmRlZmluZWQsXG4gICAgICBldmVudEZpbHRlckNvdW50OiBldmVudEZpbHRlcnMubGVuZ3RoLFxuICAgICAgZGVzdHJveUV2ZW50RGVsaXZlcnk6IHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlLFxuICAgICAgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpLFxuICAgICAgcHJlbG9hZDogdGhpcy5wYXJhbXMucHJlbG9hZCAhPT0gdW5kZWZpbmVkLFxuICAgICAgcXVlcnlEYXRhOiB0aGlzLnBhcmFtcy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0ICE9PSB1bmRlZmluZWQsXG4gICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSAhPT0gdW5kZWZpbmVkLFxuICAgICAgdW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk6IHRoaXMucGFyYW1zLnVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID09PSB0cnVlLFxuICAgICAgd2l0aENvdW50OiB0aGlzLnBhcmFtcy53aXRoQ291bnQgIT09IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJlcXVlc3RlZCBmcm9udGVuZC1tb2RlbCBuYW1lIG9yIG51bGwuXG4gICAqL1xuICBfbW9kZWxOYW1lKCkge1xuICAgIHJldHVybiB0eXBlb2YgdGhpcy5wYXJhbXM/Lm1vZGVsID09PSBcInN0cmluZ1wiICYmIHRoaXMucGFyYW1zLm1vZGVsLmxlbmd0aCA+IDBcbiAgICAgID8gdGhpcy5wYXJhbXMubW9kZWxcbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGV2ZW50IGZpbHRlciBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBzdWJzY3JpcHRpb24gcmVxdWVzdGVkIGV2ZW50IHF1ZXJ5IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRXZlbnRGaWx0ZXJQYXJhbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2V2ZW50RmlsdGVycygpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB1bmZpbHRlcmVkIGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHVuZmlsdGVyZWQgY2FsbGJhY2tzIHNob3VsZCByZWNlaXZlIGV2ZXJ5IGV2ZW50LlxuICAgKi9cbiAgX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy51bmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGRlc3Ryb3kgZXZlbnQgZGVsaXZlcnkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaWQtb25seSBkZXN0cm95IGV2ZW50cyBzaG91bGQgYmUgZGVsaXZlcmVkIHdpdGggZXZlbnQgZmlsdGVycy5cbiAgICovXG4gIF9oYXNEZXN0cm95RXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZW50IGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdfSAtIFZhbGlkIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfZXZlbnRGaWx0ZXJzKCkge1xuICAgIGlmICh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBtdXN0IGJlIGFuIGFycmF5XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyBtdXN0IGJlIG9iamVjdHNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXZlbnRGaWx0ZXIgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KVxuICAgICAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhldmVudEZpbHRlcikuZmlsdGVyKChrZXkpID0+ICFFVkVOVF9GSUxURVJfS0VZUy5oYXMoa2V5KSlcblxuICAgICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyBjYW5ub3QgaW5jbHVkZSAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX1gKVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIGV2ZW50RmlsdGVyLmtleSAhPT0gXCJzdHJpbmdcIiB8fCBldmVudEZpbHRlci5rZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIHJlcXVpcmUgYSBrZXlcIilcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBTYW5pdGl6ZWQgZXZlbnQgZmlsdGVyLlxuICAgICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5fSAqL1xuICAgICAgY29uc3Qgc2FuaXRpemVkRXZlbnRGaWx0ZXIgPSB7a2V5OiBldmVudEZpbHRlci5rZXl9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5qb2lucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLmpvaW5zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChldmVudEZpbHRlci5qb2lucylcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLnNlYXJjaGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIuc2VhcmNoZXMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAqLyAoZXZlbnRGaWx0ZXIuc2VhcmNoZXMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci53aGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLndoZXJlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChldmVudEZpbHRlci53aGVyZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHNhbml0aXplZEV2ZW50RmlsdGVyXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHQ+fSAtIEZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqL1xuICBhc3luYyBfZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJDbGFzcygpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsQ29udHJvbGxlclBhdGggPSBcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIlxuICAgIGNvbnN0IHtkZWZhdWx0OiBGcm9udGVuZE1vZGVsQ29udHJvbGxlcn0gPSBhd2FpdCBpbXBvcnQoZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoKVxuXG4gICAgcmV0dXJuIEZyb250ZW5kTW9kZWxDb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAtIFN5bnRoZXRpYyBjb250cm9sbGVyIHVzZWQgZm9yIHJlc291cmNlIHNlcmlhbGl6YXRpb24uXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIHBhcmFtcyA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBGcm9udGVuZE1vZGVsQ29udHJvbGxlcih7XG4gICAgICBhY3Rpb246IFwid2Vic29ja2V0RXZlbnRcIixcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBjb250cm9sbGVyOiBcImZyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgcGFyYW1zOiB7XG4gICAgICAgIGFiaWxpdGllczogdGhpcy5wYXJhbXMuYWJpbGl0aWVzLFxuICAgICAgICBqb2luczogdGhpcy5wYXJhbXMuam9pbnMsXG4gICAgICAgIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKSxcbiAgICAgICAgcHJlbG9hZDogdGhpcy5wYXJhbXMucHJlbG9hZCxcbiAgICAgICAgcXVlcnlEYXRhOiB0aGlzLnBhcmFtcy5xdWVyeURhdGEsXG4gICAgICAgIHNlYXJjaGVzOiB0aGlzLnBhcmFtcy5zZWFyY2hlcyxcbiAgICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QsXG4gICAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhLFxuICAgICAgICB3aGVyZTogdGhpcy5wYXJhbXMud2hlcmUsXG4gICAgICAgIC4uLnBhcmFtcyxcbiAgICAgICAgd2l0aENvdW50OiB0aGlzLnBhcmFtcy53aXRoQ291bnRcbiAgICAgIH0sXG4gICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpLFxuICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pLFxuICAgICAgdmlld1BhdGg6IFwiL1wiXG4gICAgfSlcblxuICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB0aGlzLl9hYmlsaXR5IHx8IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIGNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0ZW5hbnQgZm9yIGV2ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIF9yZXNvbHZlRXZlbnRUZW5hbnQoaWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBldmVudCB0ZW5hbnQgcmVzb2x1dGlvblwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTWlycm9yIHRoZSBzdWJzY3JpYmUtdGltZSB0ZW5hbnQgcmVzb2x1dGlvbiAoYFdlYnNvY2tldFNlc3Npb24uX3Jlc29sdmVUZW5hbnRgKTpcbiAgICAgIC8vIHBhc3MgYHN1YnNjcmlwdGlvbjoge2NoYW5uZWwsIHBhcmFtc31gIHNvIHJlc29sdmVycyB0aGF0IGRlcml2ZSBzY29wZSBmcm9tIHRoZVxuICAgICAgLy8gc3Vic2NyaXB0aW9uIGJlaGF2ZSB0aGUgc2FtZSBmb3IgYnJvYWRjYXN0cyBhcyB0aGV5IGRpZCBhdCBgY2hhbm5lbC1zdWJzY3JpYmVgLlxuICAgICAgLy8gVGhlIHN5bnRoZXRpYyByZXF1ZXN0IGZvcndhcmRzIHRoZSBzdWJzY3JpYmVyJ3MgcGFyYW1zIChlLmcuIGF1dGhlbnRpY2F0aW9uVG9rZW4pLFxuICAgICAgLy8gbWF0Y2hpbmcgdGhpcyBjaGFubmVsJ3MgYWJpbGl0eSByZXNvbHV0aW9uIGFib3ZlLlxuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCh7XG4gICAgICAgIHBhcmFtczogey4uLnRoaXMucGFyYW1zLCBpZCwgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpfSxcbiAgICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pLFxuICAgICAgICBzdWJzY3JpcHRpb246IHtjaGFubmVsOiBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCBwYXJhbXM6IHRoaXMucGFyYW1zfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzdWJzY3JpYmVyJ3MgdGVuYW50IGZvciB0aGUgYnJvYWRjYXN0IHJlY29yZCBhbmQgcnVucyBgY2FsbGJhY2tgIGluc2lkZSB0aGF0IHRlbmFudFxuICAgKiBjb250ZXh0LiBCcm9hZGNhc3QgZGVsaXZlcnkgcnVucyBpbiB3aGF0ZXZlciBhbWJpZW50IHRlbmFudCBjb250ZXh0IHRoZSBwdWJsaXNoZXIgbGVmdCBiZWhpbmQuIEZvclxuICAgKiBtdWx0aS10ZW5hbnQgcmVjb3JkcyB0aGF0IGFtYmllbnQgdGVuYW50IG1heSBoYXZlIGJlZW4gcmVzb2x2ZWQgd2l0aG91dCB0aGUgc3Vic2NyaWJlcidzIHJlcXVlc3RcbiAgICogKGUuZy4gYSByZWxheSBlbmRwb2ludCBvciBiYWNrZ3JvdW5kIGpvYiBtdXRhdGluZyB0aGUgcm93KSwgc28gaXQgbGFja3MgdGhlIHN1YnNjcmliZXIncyBwZXItcmVjb3JkXG4gICAqIGFjY2VzcyBmbGFncyBhbmQgdGhlIHBlci1ldmVudCBhdXRob3JpemF0aW9uIHF1ZXJ5IHdyb25nbHkgZmluZHMgbm90aGluZy4gUmUtcmVzb2x2aW5nIHRoZSB0ZW5hbnRcbiAgICogZnJvbSB0aGUgZXZlbnQgcmVjb3JkIGlkIHBsdXMgdGhlIHN1YnNjcmliZXIncyByZXF1ZXN0IG1ha2VzIHRoZSBhdXRob3JpemF0aW9uIHF1ZXJpZXMgcnVuIGFnYWluc3RcbiAgICogdGhlIHN1YnNjcmliZXIncyBvd24gdGVuYW50L2FiaWxpdHkgc2NvcGUuIFdoZW4gbm8gdGVuYW50IHJlc29sdmVzIChub24tbXVsdGl0ZW5hbnQgY29uZmlncyksIHRoZVxuICAgKiBjYWxsYmFjayBydW5zIGRpcmVjdGx5IHNvIHRoZSBhbWJpZW50IGNvbnRleHQgaXMgcHJlc2VydmVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF1dGhvcml6ZWQtcXVlcnkgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRXZlbnRUZW5hbnQoaWQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24gfHwgdHlwZW9mIGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVFdmVudFRlbmFudChpZClcblxuICAgIC8vIEFsd2F5cyBlbnRlciBgcnVuV2l0aFRlbmFudGAsIGV2ZW4gd2hlbiBubyB0ZW5hbnQgcmVzb2x2ZWQuIEJyb2FkY2FzdCBmYW4tb3V0XG4gICAgLy8gcnVucyBpbiB0aGUgcHVibGlzaGVyJ3MgYW1iaWVudCB0ZW5hbnQgY29udGV4dDsgZmFsbGluZyBiYWNrIHRvIGBjYWxsYmFjaygpYFxuICAgIC8vIHRoZXJlIHdvdWxkIGF1dGhvcml6ZSBhIGNyb3NzLXRlbmFudCByZWNvcmQgYWdhaW5zdCB0aGUgcHVibGlzaGVyJ3MgdGVuYW50IGFuZFxuICAgIC8vIGNvdWxkIGxlYWsgaXQgdG8gYSBzdWJzY3JpYmVyIHdob3NlIG93biByZXNvbHZlciBjb3VsZCBub3QgcmVzb2x2ZSBpdC5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudFwifSwgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMgZm9yIGV2ZW50IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBFdmVudCBmaWx0ZXIga2V5cyBtYXRjaGVkIGJ5IHRoZSByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c0ZvckV2ZW50SWQoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgLyoqXG4gICAgICogTWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGV2ZW50RmlsdGVyIG9mIHRoaXMuX2V2ZW50RmlsdGVycygpKSB7XG4gICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgdGhpcy5fZXZlbnRNYXRjaGVzRmlsdGVyKHtcbiAgICAgICAgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsXG4gICAgICAgIGV2ZW50RmlsdGVyLFxuICAgICAgICBpZFxuICAgICAgfSlcblxuICAgICAgaWYgKG1hdGNoZXMpIG1hdGNoZWRFdmVudEZpbHRlcktleXMucHVzaChldmVudEZpbHRlci5rZXkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZW50IG1hdGNoZXMgZmlsdGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZpbHRlciBhcmdzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IGFyZ3MuRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5fSBhcmdzLmV2ZW50RmlsdGVyIC0gRXZlbnQgZmlsdGVyIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MuaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSByZWNvcmQgbWF0Y2hlcyB0aGUgZmlsdGVyLlxuICAgKi9cbiAgYXN5bmMgX2V2ZW50TWF0Y2hlc0ZpbHRlcih7RnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIGV2ZW50RmlsdGVyLCBpZH0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIHtcbiAgICAgICAgam9pbnM6IGV2ZW50RmlsdGVyLmpvaW5zLFxuICAgICAgICBzZWFyY2hlczogZXZlbnRGaWx0ZXIuc2VhcmNoZXMsXG4gICAgICAgIHdoZXJlOiBldmVudEZpbHRlci53aGVyZVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgICBjb25zdCB3aGVyZSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFdoZXJlKClcbiAgICAgIGNvbnN0IGpvaW5zID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsSm9pbnMoKVxuICAgICAgLy8gU3RhcnQgZnJvbSB0aGUgc3Vic2NyaWJlcidzIGF1dGhvcml6ZWQgc2NvcGUgc28gYSBmaWx0ZXIgY2FuIG9ubHkgZXZlciBtYXRjaCByZWNvcmRzIHRoZVxuICAgICAgLy8gc3Vic2NyaXB0aW9uJ3MgYWJpbGl0eSBwZXJtaXRzIHRvIHJlYWQuXG4gICAgICBsZXQgcXVlcnkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoXCJmaW5kXCIpLndoZXJlKHtcbiAgICAgICAgW01vZGVsQ2xhc3MudGFibGVOYW1lKCldOiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZClcbiAgICAgIH0pXG5cbiAgICAgIGlmICh3aGVyZSkgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxXaGVyZSh7cXVlcnksIHdoZXJlfSlcbiAgICAgIGlmIChqb2lucykgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxKb2lucyh7am9pbnMsIHF1ZXJ5fSlcblxuICAgICAgZm9yIChjb25zdCBzZWFyY2ggb2YgY29udHJvbGxlci5mcm9udGVuZE1vZGVsU2VhcmNoZXMoKSkge1xuICAgICAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaCh7cXVlcnksIHNlYXJjaH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBCb29sZWFuKGF3YWl0IHF1ZXJ5LmZpcnN0KCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByb2plY3RlZCByZWNvcmQgZm9yIGV2ZW50IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPiB8IG51bGw+fSAtIFNlcmlhbGl6ZWQgcHJvamVjdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9wcm9qZWN0ZWRSZWNvcmRGb3JFdmVudElkKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgICAgYXdhaXQgY29udHJvbGxlci5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgICAvLyBSZWxvYWQgdGhyb3VnaCB0aGUgc3Vic2NyaWJlcidzIGF1dGhvcml6ZWQgc2NvcGUgc28gcHJvamVjdGVkIHJlY29yZHMgYXJlIG9ubHkgZXZlciBzZW50IGZvclxuICAgICAgLy8gcm93cyB0aGUgc3Vic2NyaXB0aW9uJ3MgYWJpbGl0eSBwZXJtaXRzIHRvIHJlYWQuXG4gICAgICBsZXQgcXVlcnkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoXCJmaW5kXCIpLndoZXJlKHtcbiAgICAgICAgW01vZGVsQ2xhc3MudGFibGVOYW1lKCldOiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZClcbiAgICAgIH0pXG4gICAgICBjb25zdCBwcmVsb2FkID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUHJlbG9hZCgpXG5cbiAgICAgIGlmIChwcmVsb2FkKSBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQocHJlbG9hZClcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxXaXRoQ291bnQoKSkge1xuICAgICAgICAvKipcbiAgICAgICAgICogU3BlYy5cbiAgICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCB7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0+fSAqL1xuICAgICAgICBjb25zdCBzcGVjID0ge31cblxuICAgICAgICBzcGVjW2VudHJ5LmF0dHJpYnV0ZU5hbWVdID0ge1xuICAgICAgICAgIHJlbGF0aW9uc2hpcDogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB3aGVyZTogZW50cnkud2hlcmUgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKGVudHJ5LndoZXJlKSA6IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICAgIHF1ZXJ5LndpdGhDb3VudChzcGVjKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBxdWVyeURhdGEgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxRdWVyeURhdGEoKVxuXG4gICAgICBpZiAocXVlcnlEYXRhICE9PSBudWxsKSBxdWVyeS5xdWVyeURhdGEocXVlcnlEYXRhKVxuXG4gICAgICBxdWVyeSA9IGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsVHJhbnNsYXRlZEF0dHJpYnV0ZVByZWxvYWRzKHtxdWVyeX0pXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgcXVlcnkuZmlyc3QoKVxuXG4gICAgICBpZiAoIW1vZGVsKSByZXR1cm4gbnVsbFxuXG4gICAgICBpZiAodGhpcy5wYXJhbXMuYWJpbGl0aWVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgYXdhaXQgY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhbbW9kZWxdKVxuICAgICAgfVxuXG4gICAgICBjb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gdW5kZWZpbmVkXG5cbiAgICAgIHJldHVybiBhd2FpdCBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKCkuc2VyaWFsaXplKG1vZGVsLCBcImZpbmRcIilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1pbmltYWwgUmVxdWVzdC1saWtlIHN0dWIgdXNlZCBvbmx5IGZvciBhYmlsaXR5IHJlc29sdXRpb24uIEF2b2lkc1xuICAgKiBpbXBvcnRpbmcgYFdlYnNvY2tldFJlcXVlc3RgIGhlcmUgYmVjYXVzZSBpdHMgYG5vZGU6cXVlcnlzdHJpbmdgXG4gICAqIGRlcGVuZGVuY3kgd291bGQgcHVsbCBzZXJ2ZXItb25seSBjb2RlIGludG8gYnJvd3NlciBidW5kbGVzIHZpYVxuICAgKiB0aGUgYGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlciDihpIgd2Vic29ja2V0LXB1Ymxpc2hlcnNgIGltcG9ydCBjaGFpbi5cbiAgICogSGVhZGVyIG5hbWVzIGFyZSBub3JtYWxpemVkIHRvIGxvd2VyY2FzZSBzbyBgaGVhZGVyKFwiY29va2llXCIpYFxuICAgKiBmaW5kcyBhIHZhbHVlIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGUgdXBncmFkZS1yZXF1ZXN0IGhlYWRlcnNcbiAgICogbWFwIHVzZXMgYFwiQ29va2llXCJgIG9yIGBcImNvb2tpZVwiYC4gU2Vzc2lvbiBtZXRhZGF0YSBzdGF5cyBzZXBhcmF0ZVxuICAgKiBmcm9tIGhlYWRlcnMgYW5kIGlzIGV4cG9zZWQgdGhyb3VnaCBgbWV0YWRhdGEoLi4uKWAgZm9yIGFiaWxpdHlcbiAgICogcmVzb2x2ZXJzIHRoYXQgbmVlZCB3ZWJzb2NrZXQtZGVsaXZlcmVkIHNlc3Npb24gZGF0YS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRTeW50aGV0aWNSZXF1ZXN0fSBSZXF1ZXN0LWxpa2Ugb2JqZWN0IGZvciBhYmlsaXR5IHJlc29sdXRpb24uXG4gICAqL1xuICBfc3ludGhldGljUmVxdWVzdCgpIHtcbiAgICBjb25zdCB1cGdyYWRlUmVxdWVzdCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFVwZ3JhZGVSZXF1ZXN0fSAqLyAodGhpcy5zZXNzaW9uLnVwZ3JhZGVSZXF1ZXN0KVxuICAgIGNvbnN0IHJhd0hlYWRlcnMgPSB0eXBlb2YgdXBncmFkZVJlcXVlc3Q/LmhlYWRlcnMgPT09IFwiZnVuY3Rpb25cIiA/IHVwZ3JhZGVSZXF1ZXN0LmhlYWRlcnMoKSA6IHt9XG4gICAgY29uc3QgbWV0YWRhdGEgPSB0eXBlb2YgdGhpcy5zZXNzaW9uLmdldE1ldGFkYXRhID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzLnNlc3Npb24uZ2V0TWV0YWRhdGEoKSA6IHt9XG4gICAgY29uc3QgcmVtb3RlQWRkcmVzcyA9IHR5cGVvZiB1cGdyYWRlUmVxdWVzdD8ucmVtb3RlQWRkcmVzcyA9PT0gXCJmdW5jdGlvblwiID8gdXBncmFkZVJlcXVlc3QucmVtb3RlQWRkcmVzcygpIDogdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogSGVhZGVyIG1hcC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+fSAqL1xuICAgIGNvbnN0IGhlYWRlck1hcCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhyYXdIZWFkZXJzIHx8IHt9KSkge1xuICAgICAgaGVhZGVyTWFwW2tleS50b0xvd2VyQ2FzZSgpXSA9IHJhd0hlYWRlcnNba2V5XVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBoZWFkZXJzOiAoKSA9PiBoZWFkZXJNYXAsXG4gICAgICBoZWFkZXI6IChuYW1lKSA9PiBoZWFkZXJNYXBbU3RyaW5nKG5hbWUpLnRvTG93ZXJDYXNlKCldLFxuICAgICAgbWV0YWRhdGE6IChrZXkpID0+IGtleSA9PT0gdW5kZWZpbmVkID8gey4uLm1ldGFkYXRhfSA6IG1ldGFkYXRhW2tleV0sXG4gICAgICBwYXRoOiAoKSA9PiBcIi9mcm9udGVuZC1tb2RlbHNcIixcbiAgICAgIGh0dHBNZXRob2Q6ICgpID0+IFwiUE9TVFwiLFxuICAgICAgcmVtb3RlQWRkcmVzczogKCkgPT4gcmVtb3RlQWRkcmVzcyxcbiAgICAgIG9yaWdpbjogKCkgPT4gaGVhZGVyTWFwLm9yaWdpblxuICAgIH1cbiAgfVxufVxuIl19