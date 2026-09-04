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
 * @typedef {{action?: string, id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, matchedEventFilterKeys?: string[], previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, record?: import("./query.js").FrontendModelTransportValue, [key: string]: import("./query.js").FrontendModelTransportValue | string[] | undefined}} FrontendModelLifecycleBroadcastBody
 */
/**
 * @typedef {Record<string, import("./query.js").FrontendModelTransportValue>} DestroyAuthorizationRecord
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
 * Checks whether a server-side broadcast value is a destroy-authorization record.
 * @param {import("./query.js").FrontendModelTransportValue | undefined} value - Candidate value.
 * @returns {value is DestroyAuthorizationRecord} - Whether the value is a column-keyed record.
 */
function isDestroyAuthorizationRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
/**
 * Checks whether a captured value is a serialized binary-column marker.
 * @param {import("./query.js").FrontendModelTransportValue} value - Captured column value.
 * @returns {value is {__velociousDestroyAuthorizationType: "binary", value: number[]}} - Whether the value contains serialized bytes.
 */
function isDestroyAuthorizationBinary(value) {
    return Boolean(value
        && typeof value === "object"
        && !Array.isArray(value)
        && "__velociousDestroyAuthorizationType" in value
        && value.__velociousDestroyAuthorizationType === "binary"
        && "value" in value
        && Array.isArray(value.value)
        && value.value.every((byte) => typeof byte === "number"));
}
/**
 * Builds a PostgreSQL array expression whose elements are quoted by the active driver.
 * @param {import("../database/drivers/base.js").default} driver - Active PostgreSQL driver.
 * @param {import("./query.js").FrontendModelTransportValue[]} values - Captured array values.
 * @returns {string} - PostgreSQL array expression.
 */
function pgsqlArrayValueSql(driver, values) {
    const elements = values.map((value) => {
        if (Array.isArray(value))
            return pgsqlArrayValueSql(driver, value);
        if (value === null)
            return "NULL";
        return driver.quote(value);
    });
    return `ARRAY[${elements.join(", ")}]`;
}
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
     * @param {import("../http-server/websocket-channel.js").WebsocketBroadcastMetadata} [meta] - Optional server-side broadcast metadata.
     * @returns {Promise<void>} Resolves after delivery.
     */
    async deliverBroadcast(body, meta) {
        await this._deliverBroadcast(body, meta);
    }
    /**
     * Runs deliver broadcast.
     * @param {FrontendModelLifecycleBroadcastBody} body - Broadcast body.
     * @param {import("../http-server/websocket-channel.js").WebsocketBroadcastMetadata} [meta] - Optional server-side broadcast metadata.
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
            const authorized = await this._destroyEventIsAuthorized(body, FrontendModelController, meta?.broadcastParams?.destroyAuthorizationRecord);
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
     * @param {import("./query.js").FrontendModelTransportValue | undefined} destroyAuthorizationRecord - Server-only pre-delete record from live broadcast metadata.
     * @returns {Promise<boolean>} - Whether the subscriber could read the record before deletion.
     */
    async _destroyEventIsAuthorized(body, FrontendModelController, destroyAuthorizationRecord) {
        const id = body.id;
        if (id === undefined || id === null || !isDestroyAuthorizationRecord(destroyAuthorizationRecord))
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
     * @param {DestroyAuthorizationRecord} destroyAuthorizationRecord - Captured pre-delete record.
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
     * @param {DestroyAuthorizationRecord} destroyAuthorizationRecord - Captured pre-delete record.
     * @returns {void}
     */
    _applyDestroyAuthorizationRecordToQuery(query, ModelClass, destroyAuthorizationRecord) {
        const selectedColumns = Object.entries(destroyAuthorizationRecord).map(([columnName, serializedValue]) => {
            const value = isDestroyAuthorizationBinary(serializedValue)
                ? Buffer.from(serializedValue.value)
                : deserializeFrontendModelTransportValue(serializedValue);
            const column = ModelClass.getColumnsHash()[columnName];
            if (!column)
                throw new Error(`Cannot authorize a destroyed ${ModelClass.name} with unknown column ${columnName}`);
            const quotedValue = query.driver.getType() == "pgsql" && column.getType() === "ARRAY" && Array.isArray(value)
                ? pgsqlArrayValueSql(query.driver, value)
                : value === null ? "NULL" : query.driver.quote(value);
            const selectedValue = query.driver.getType() == "pgsql"
                ? `CAST(${quotedValue} AS ${column.getDatabaseType()})`
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDbEMsT0FBTyxRQUFRLE1BQU0sbUNBQW1DLENBQUE7QUFDeEQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFFdkU7OztHQUdHO0FBQ0g7O0dBRUc7QUFDSDs7O0dBR0c7QUFDSDs7O0dBR0c7QUFDSCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQTtBQUV4RSxxRkFBcUY7QUFDckYsMkVBQTJFO0FBQzNFLE1BQU0sNEJBQTRCLEdBQUcsaUJBQWlCLENBQUE7QUFFdEQ7Ozs7R0FJRztBQUNILFNBQVMsNEJBQTRCLENBQUMsS0FBSztJQUN6QyxPQUFPLE9BQU8sQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0FBQzdFLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyw0QkFBNEIsQ0FBQyxLQUFLO0lBQ3pDLE9BQU8sT0FBTyxDQUNaLEtBQUs7V0FDRixPQUFPLEtBQUssS0FBSyxRQUFR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QUMsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDaEQsU0FBUyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNoRCxDQUFDO1FBRUQsT0FBTztZQUNMLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTO1lBQ3hCLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN2RCxRQUFRLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztZQUNwRSxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsa0JBQWtCO1lBQzlCLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNO1lBQ3hCLGFBQWEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhO1lBQ2xDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTTtTQUMvQixDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIGZyb20gXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiXG5pbXBvcnQge0J1ZmZlcn0gZnJvbSBcIm5vZGU6YnVmZmVyXCJcbmltcG9ydCBSZXNwb25zZSBmcm9tIFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0fSBmcm9tIFwiLi9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9ufSBmcm9tIFwiLi9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7ZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3Rpb24/OiBzdHJpbmcsIGlkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1hdGNoZWRFdmVudEZpbHRlcktleXM/OiBzdHJpbmdbXSwgcHJldmlvdXNJZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCByZWNvcmQ/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgW2tleTogc3RyaW5nXTogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5XG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aGVhZGVycz86ICgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPiwgcmVtb3RlQWRkcmVzcz86ICgpID0+IHN0cmluZyB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRVcGdyYWRlUmVxdWVzdFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3toZWFkZXJzOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD4sIGhlYWRlcjogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQsIG1ldGFkYXRhOiAoa2V5Pzogc3RyaW5nKSA9PiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4gfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IHVuZGVmaW5lZCwgcGF0aDogKCkgPT4gc3RyaW5nLCBodHRwTWV0aG9kOiAoKSA9PiBzdHJpbmcsIHJlbW90ZUFkZHJlc3M6ICgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCwgb3JpZ2luOiAoKSA9PiBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH19IEZyb250ZW5kTW9kZWxXZWJzb2NrZXRTeW50aGV0aWNSZXF1ZXN0XG4gKi9cbmNvbnN0IEVWRU5UX0ZJTFRFUl9LRVlTID0gbmV3IFNldChbXCJqb2luc1wiLCBcImtleVwiLCBcInNlYXJjaGVzXCIsIFwid2hlcmVcIl0pXG5cbi8vIE1pcnJvcnMgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSBpbiAuL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzLCBkdXBsaWNhdGVkIGhlcmVcbi8vIHRvIGF2b2lkIHRoZSBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIg4oaSIHdlYnNvY2tldC1wdWJsaXNoZXJzIGltcG9ydCBjeWNsZS5cbmNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBzZXJ2ZXItc2lkZSBicm9hZGNhc3QgdmFsdWUgaXMgYSBkZXN0cm95LWF1dGhvcml6YXRpb24gcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmR9IC0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSBjb2x1bW4ta2V5ZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBpc0Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBjYXB0dXJlZCB2YWx1ZSBpcyBhIHNlcmlhbGl6ZWQgYmluYXJ5LWNvbHVtbiBtYXJrZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSB2YWx1ZSAtIENhcHR1cmVkIGNvbHVtbiB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyB7X192ZWxvY2lvdXNEZXN0cm95QXV0aG9yaXphdGlvblR5cGU6IFwiYmluYXJ5XCIsIHZhbHVlOiBudW1iZXJbXX19IC0gV2hldGhlciB0aGUgdmFsdWUgY29udGFpbnMgc2VyaWFsaXplZCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gaXNEZXN0cm95QXV0aG9yaXphdGlvbkJpbmFyeSh2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbihcbiAgICB2YWx1ZVxuICAgICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIlxuICAgICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgICYmIFwiX192ZWxvY2lvdXNEZXN0cm95QXV0aG9yaXphdGlvblR5cGVcIiBpbiB2YWx1ZVxuICAgICYmIHZhbHVlLl9fdmVsb2Npb3VzRGVzdHJveUF1dGhvcml6YXRpb25UeXBlID09PSBcImJpbmFyeVwiXG4gICAgJiYgXCJ2YWx1ZVwiIGluIHZhbHVlXG4gICAgJiYgQXJyYXkuaXNBcnJheSh2YWx1ZS52YWx1ZSlcbiAgICAmJiB2YWx1ZS52YWx1ZS5ldmVyeSgoYnl0ZSkgPT4gdHlwZW9mIGJ5dGUgPT09IFwibnVtYmVyXCIpXG4gIClcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBQb3N0Z3JlU1FMIGFycmF5IGV4cHJlc3Npb24gd2hvc2UgZWxlbWVudHMgYXJlIHF1b3RlZCBieSB0aGUgYWN0aXZlIGRyaXZlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRyaXZlciAtIEFjdGl2ZSBQb3N0Z3JlU1FMIGRyaXZlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVbXX0gdmFsdWVzIC0gQ2FwdHVyZWQgYXJyYXkgdmFsdWVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBQb3N0Z3JlU1FMIGFycmF5IGV4cHJlc3Npb24uXG4gKi9cbmZ1bmN0aW9uIHBnc3FsQXJyYXlWYWx1ZVNxbChkcml2ZXIsIHZhbHVlcykge1xuICBjb25zdCBlbGVtZW50cyA9IHZhbHVlcy5tYXAoKHZhbHVlKSA9PiB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gcGdzcWxBcnJheVZhbHVlU3FsKGRyaXZlciwgdmFsdWUpXG4gICAgaWYgKHZhbHVlID09PSBudWxsKSByZXR1cm4gXCJOVUxMXCJcblxuICAgIHJldHVybiBkcml2ZXIucXVvdGUodmFsdWUpXG4gIH0pXG5cbiAgcmV0dXJuIGBBUlJBWVske2VsZW1lbnRzLmpvaW4oXCIsIFwiKX1dYFxufVxuXG4vKipcbiAqIFJlc29sdmVzIGZyb250ZW5kIHJlc291cmNlIGlkZW50aXR5IGF0dHJpYnV0ZXMgdG8gYmFja2luZyBkYXRhYmFzZSBjb2x1bW5zLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBwcmltYXJ5S2V5IC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gLSBCYWNraW5nIGNvbHVtbiBjb25kaXRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUHJpbWFyeUtleURhdGFiYXNlQ29uZGl0aW9ucyhNb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBpZCkge1xuICBjb25zdCByZXNvdXJjZUNvbmRpdGlvbnMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcj59ICovXG4gIGNvbnN0IGRhdGFiYXNlQ29uZGl0aW9ucyA9IHt9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlQ29uZGl0aW9ucykpIHtcbiAgICBkYXRhYmFzZUNvbmRpdGlvbnNbTW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKV0gPSB2YWx1ZVxuICB9XG5cbiAgcmV0dXJuIGRhdGFiYXNlQ29uZGl0aW9uc1xufVxuXG4vKipcbiAqIFJ1bnMgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gb3B0aW9ucyBmb3IgYSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zfSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgcmV0dXJuIHtcbiAgICB0aW1lWm9uZTogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG59XG5cbi8qKlxuICogUGVyLXNlc3Npb24gY2hhbm5lbCBzdWJzY3JpcHRpb24gZm9yIGZyb250ZW5kLW1vZGVsIGxpZmVjeWNsZSBldmVudHMuXG4gKiBSZXBsYWNlcyB0aGUgbGVnYWN5IGBGcm9udGVuZE1vZGVsV2Vic29ja2V0Q2hhbm5lbGAgKFBoYXNlIDMpLlxuICpcbiAqIGBjYW5TdWJzY3JpYmVgIHJlc29sdmVzIHRoZSBjYWxsZXIncyBhYmlsaXR5IG9uY2UgYW5kIHJlcXVpcmVzIGEgcmVhZCBydWxlXG4gKiBmb3IgdGhlIHJlcXVlc3RlZCBtb2RlbCBjbGFzcy4gQ3JlYXRlL3VwZGF0ZSBkZWxpdmVyeSB0aGVuIHJlbG9hZHMgZWFjaFxuICogcmVjb3JkIHRocm91Z2ggdGhhdCBhYmlsaXR5IGFuZCBzZXJpYWxpemVzIGl0IHRocm91Z2ggdGhlIHN1YnNjcmliZWRcbiAqIGZyb250ZW5kIHJlc291cmNlLiBTdWJzY3JpYmVyLXByb3ZpZGVkIGV2ZW50IGZpbHRlcnMgY2FuIGZ1cnRoZXIgbmFycm93XG4gKiB0aG9zZSBhdXRob3JpemVkIGV2ZW50cy5cbiAqXG4gKiBXaXJlOiBzdWJzY3JpYmUgd2l0aCBgc3Vic2NyaWJlQ2hhbm5lbChcImZyb250ZW5kLW1vZGVsc1wiLCB7cGFyYW1zOiB7bW9kZWw6IE1vZGVsTmFtZX19KWAuXG4gKiBCYWNrZW5kIHB1Ymxpc2hlcyBge2FjdGlvbiwgaWQsIHJlY29yZH1gIHZpYVxuICogYGNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHttb2RlbDogTW9kZWxOYW1lfSwgYm9keSlgO1xuICogYG1hdGNoZXMoKWAgcm91dGVzIGJ5IG1vZGVsIG5hbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsIGV4dGVuZHMgVmVsb2Npb3VzV2Vic29ja2V0Q2hhbm5lbCB7XG4gIC8qKlxuICAgKiBBYmlsaXR5LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICBfYWJpbGl0eSA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBjYW4gc3Vic2NyaWJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgZnJvbnRlbmQtbW9kZWwgc3Vic2NyaXB0aW9uIGlzIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBjYW5TdWJzY3JpYmUoKSB7XG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5fbW9kZWxOYW1lKClcblxuICAgIGlmICghbW9kZWxOYW1lKSByZXR1cm4gZmFsc2VcbiAgICB0aGlzLl9ldmVudEZpbHRlcnMoKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuX21vZGVsQ2xhc3MobW9kZWxOYW1lKVxuXG4gICAgaWYgKCFNb2RlbENsYXNzKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHJlcXVlc3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpXG4gICAgY29uc3QgYWJpbGl0eSA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUFiaWxpdHkoe1xuICAgICAgLy8gRm9yd2FyZCB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSBzbyB0b2tlbi1hdXRoZW50aWNhdGVkIGNsaWVudHNcbiAgICAgIC8vIHJlc29sdmUgdGhlIHNhbWUgYWJpbGl0eSB0aGV5IHdvdWxkIG92ZXIgSFRUUC4gV2l0aG91dCB0aGlzIG9ubHkgc2Vzc2lvbi9jb29raWUgYXV0aCBvbiB0aGVcbiAgICAgIC8vIHVwZ3JhZGUgcmVxdWVzdCB3b3JrcywgYW5kIHBhcmFtLWJhc2VkIGF1dGggKGxpa2UgYSBzY2FubmVyIHBhc3NpbmcgYW4gYXV0aGVudGljYXRpb25Ub2tlbilcbiAgICAgIC8vIGlzIGRyb3BwZWQg4oCUIGxlYXZpbmcgc3VjaCBzdWJzY3JpYmVycyB3aXRoIGEgZ3Vlc3QgYWJpbGl0eSBhbmQgbm8gcmVhZCBydWxlLlxuICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIG1vZGVsOiBtb2RlbE5hbWV9LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIH0pXG5cbiAgICBpZiAoIWFiaWxpdHkpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2FiaWxpdHkgPSBhYmlsaXR5XG5cbiAgICAvLyBMb2FkIHJlc291cmNlLWRlY2xhcmVkIHJ1bGVzIGZvciB0aGlzIG1vZGVsIGNsYXNzIGJlZm9yZSBjaGVja2luZyxcbiAgICAvLyBvdGhlcndpc2UgYHJ1bGVzRm9yYCByZXR1cm5zIGVtcHR5IGZvciBhYmlsaXRpZXMgd2hvc2UgcmVzb3VyY2VzXG4gICAgLy8gcmVnaXN0ZXIgcnVsZXMgbGF6aWx5IHZpYSBgYWJpbGl0aWVzKClgLlxuICAgIGFiaWxpdHkubG9hZEFiaWxpdGllc0Zvck1vZGVsQ2xhc3MoTW9kZWxDbGFzcylcblxuICAgIGNvbnN0IHJlYWRSdWxlcyA9IGFiaWxpdHkucnVsZXNGb3Ioe2FjdGlvbjogXCJyZWFkXCIsIG1vZGVsQ2xhc3M6IE1vZGVsQ2xhc3N9KVxuXG4gICAgcmV0dXJuIHJlYWRSdWxlcy5zb21lKCgvKiogQHR5cGUge3tlZmZlY3Q6IHN0cmluZ319ICovIHJ1bGUpID0+IHJ1bGUuZWZmZWN0ID09PSBcImFsbG93XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBzdWJzY3JpcHRpb24gbmFtZSB0aHJvdWdoIGZyb250ZW5kIHJlc291cmNlcyBiZWZvcmUgZmFsbGluZyBiYWNrIHRvIGEgYmFja2luZyBtb2RlbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgcmVzb3VyY2UgbmFtZS5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgX21vZGVsQ2xhc3MobW9kZWxOYW1lKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClbbW9kZWxOYW1lXVxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc291cmNlRGVmaW5pdGlvbiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSA6IG51bGxcblxuICAgICAgaWYgKHJlc291cmNlQ2xhc3M/Lk1vZGVsQ2xhc3MpIHJldHVybiByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIH1cblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpW21vZGVsTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0QnJvYWRjYXN0TWV0YWRhdGF9IFttZXRhXSAtIE9wdGlvbmFsIHNlcnZlci1zaWRlIGJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGl2ZXJ5LlxuICAgKi9cbiAgYXN5bmMgZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgYXdhaXQgdGhpcy5fZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBfZGVsaXZlckJyb2FkY2FzdChib2R5LCBtZXRhKSB7XG4gICAgY29uc3QgaGFzRXZlbnRGaWx0ZXJzID0gdGhpcy5faGFzRXZlbnRGaWx0ZXJQYXJhbXMoKVxuXG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGJvZHkubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgYm9keS5tb2RlbCAhPT0gdGhpcy5fbW9kZWxOYW1lKCkpIHJldHVyblxuXG4gICAgaWYgKGJvZHkuYWN0aW9uID09PSBcImRlc3Ryb3lcIikge1xuICAgICAgaWYgKGJvZHkuaWQgPT09IHVuZGVmaW5lZCB8fCBib2R5LmlkID09PSBudWxsKSByZXR1cm5cblxuICAgICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWQgPSBhd2FpdCB0aGlzLl9kZXN0cm95RXZlbnRJc0F1dGhvcml6ZWQoXG4gICAgICAgIGJvZHksXG4gICAgICAgIEZyb250ZW5kTW9kZWxDb250cm9sbGVyLFxuICAgICAgICBtZXRhPy5icm9hZGNhc3RQYXJhbXM/LmRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkXG4gICAgICApXG5cbiAgICAgIGlmICghYXV0aG9yaXplZCkgcmV0dXJuXG5cbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5KCkgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkge1xuICAgICAgICB0aGlzLnNlbmRNZXNzYWdlKHtcbiAgICAgICAgICBhY3Rpb246IGJvZHkuYWN0aW9uLFxuICAgICAgICAgIGlkOiBib2R5LmlkLFxuICAgICAgICAgIC4uLih0eXBlb2YgYm9keS5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IHttb2RlbDogYm9keS5tb2RlbH0gOiB7fSlcbiAgICAgICAgfSwgbWV0YSlcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChib2R5LmlkID09PSB1bmRlZmluZWQgfHwgYm9keS5pZCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSkgdGhpcy5zZW5kTWVzc2FnZShib2R5LCBtZXRhKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgPSBhd2FpdCB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKClcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gaGFzRXZlbnRGaWx0ZXJzXG4gICAgICA/IGF3YWl0IHRoaXMuX21hdGNoZWRFdmVudEZpbHRlcktleXNGb3JFdmVudElkKGJvZHkuaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuICAgICAgOiBbXVxuICAgIGNvbnN0IGlzSWRlbnRpdHlUcmFuc2l0aW9uID0gYm9keS5hY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgYm9keS5wcmV2aW91c0lkICE9PSB1bmRlZmluZWQgJiYgYm9keS5wcmV2aW91c0lkICE9PSBudWxsXG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzICYmIG1hdGNoZWRFdmVudEZpbHRlcktleXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpICYmICFpc0lkZW50aXR5VHJhbnNpdGlvbikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcHJvamVjdGVkUmVjb3JkID0gYXdhaXQgdGhpcy5fcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChib2R5LmlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcilcblxuICAgIGlmICghcHJvamVjdGVkUmVjb3JkKSB7XG4gICAgICBpZiAoaXNJZGVudGl0eVRyYW5zaXRpb24pIHtcbiAgICAgICAgdGhpcy5zZW5kTWVzc2FnZSh7XG4gICAgICAgICAgYWN0aW9uOiBib2R5LmFjdGlvbixcbiAgICAgICAgICBpZDogYm9keS5pZCxcbiAgICAgICAgICAuLi4oaGFzRXZlbnRGaWx0ZXJzID8ge21hdGNoZWRFdmVudEZpbHRlcktleXN9IDoge30pLFxuICAgICAgICAgIC4uLih0eXBlb2YgYm9keS5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IHttb2RlbDogYm9keS5tb2RlbH0gOiB7fSksXG4gICAgICAgICAgcHJldmlvdXNJZDogYm9keS5wcmV2aW91c0lkXG4gICAgICAgIH0sIG1ldGEpXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgaGFzIG5vIGNvbmZpZ3VyYXRpb24gZm9yIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsaXZlciBib2R5LlxuICAgICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gKi9cbiAgICBsZXQgZGVsaXZlckJvZHkgPSB7XG4gICAgICAuLi5ib2R5LFxuICAgICAgcmVjb3JkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByb2plY3RlZFJlY29yZCwgdHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnNGb3JDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pKSlcbiAgICB9XG5cbiAgICBpZiAoaGFzRXZlbnRGaWx0ZXJzKSB7XG4gICAgICBkZWxpdmVyQm9keSA9IHtcbiAgICAgICAgLi4uZGVsaXZlckJvZHksXG4gICAgICAgIG1hdGNoZWRFdmVudEZpbHRlcktleXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnNlbmRNZXNzYWdlKGRlbGl2ZXJCb2R5LCBtZXRhKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBhIGRlc3Ryb3kgYWdhaW5zdCB0aGUgc3Vic2NyaWJlcidzIG9yZGluYXJ5IGF1dGhvcml6ZWQgcXVlcnkgYnlcbiAgICogcmVwbGFjaW5nIHRoZSBkZWxldGVkIGJhY2tpbmcgdGFibGUgd2l0aCB0aGUgY2FwdHVyZWQgcHJlLWRlbGV0ZSByb3cuIFZhbHVlc1xuICAgKiBhcmUgcXVvdGVkIG9uIHRoaXMgdHJ1c3RlZCBkYXRhYmFzZSBjb25uZWN0aW9uOyBubyBicm9hZGNhc3QtcHJvdmlkZWQgU1FMIGlzIHJ1bi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gYm9keSAtIERlc3Ryb3kgYnJvYWRjYXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgdW5kZWZpbmVkfSBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAtIFNlcnZlci1vbmx5IHByZS1kZWxldGUgcmVjb3JkIGZyb20gbGl2ZSBicm9hZGNhc3QgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHN1YnNjcmliZXIgY291bGQgcmVhZCB0aGUgcmVjb3JkIGJlZm9yZSBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIF9kZXN0cm95RXZlbnRJc0F1dGhvcml6ZWQoYm9keSwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSB7XG4gICAgY29uc3QgaWQgPSBib2R5LmlkXG5cbiAgICBpZiAoaWQgPT09IHVuZGVmaW5lZCB8fCBpZCA9PT0gbnVsbCB8fCAhaXNEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZChkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHJ1bGVRdWVyeUZhY3RvcnkgPSAoKSA9PiB0aGlzLl9kZXN0cm95QXV0aG9yaXphdGlvblF1ZXJ5KE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKVxuICAgICAgY29uc3QgcXVlcnkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoXCJmaW5kXCIsIHtydWxlUXVlcnlGYWN0b3J5fSlcblxuICAgICAgdGhpcy5fYXBwbHlEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFRvUXVlcnkocXVlcnksIE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKVxuICAgICAgcXVlcnkud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGJhY2tpbmctbW9kZWwgcXVlcnkgd2hvc2Ugc291cmNlIGlzIHRoZSBjYXB0dXJlZCBwcmUtZGVsZXRlIHJvdy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge0Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAtIENhcHR1cmVkIHByZS1kZWxldGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIE9uZS1yb3cgbW9kZWwgcXVlcnkuXG4gICAqL1xuICBfZGVzdHJveUF1dGhvcml6YXRpb25RdWVyeShNb2RlbENsYXNzLCBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuXG4gICAgdGhpcy5fYXBwbHlEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFRvUXVlcnkocXVlcnksIE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKVxuXG4gICAgcmV0dXJuIHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgYSBxdWVyeSdzIGJhY2tpbmcgdGFibGUgd2l0aCBhIHNhZmVseSBxdW90ZWQgb25lLXJvdyBkZXJpdmVkIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gcXVlcnkgLSBRdWVyeSB0byB1cGRhdGUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQgLSBDYXB0dXJlZCBwcmUtZGVsZXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFRvUXVlcnkocXVlcnksIE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSB7XG4gICAgY29uc3Qgc2VsZWN0ZWRDb2x1bW5zID0gT2JqZWN0LmVudHJpZXMoZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpLm1hcCgoW2NvbHVtbk5hbWUsIHNlcmlhbGl6ZWRWYWx1ZV0pID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gaXNEZXN0cm95QXV0aG9yaXphdGlvbkJpbmFyeShzZXJpYWxpemVkVmFsdWUpXG4gICAgICAgID8gQnVmZmVyLmZyb20oc2VyaWFsaXplZFZhbHVlLnZhbHVlKVxuICAgICAgICA6IGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHNlcmlhbGl6ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IGNvbHVtbiA9IE1vZGVsQ2xhc3MuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuXG4gICAgICBpZiAoIWNvbHVtbikgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXV0aG9yaXplIGEgZGVzdHJveWVkICR7TW9kZWxDbGFzcy5uYW1lfSB3aXRoIHVua25vd24gY29sdW1uICR7Y29sdW1uTmFtZX1gKVxuICAgICAgY29uc3QgcXVvdGVkVmFsdWUgPSBxdWVyeS5kcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIiAmJiBjb2x1bW4uZ2V0VHlwZSgpID09PSBcIkFSUkFZXCIgJiYgQXJyYXkuaXNBcnJheSh2YWx1ZSlcbiAgICAgICAgPyBwZ3NxbEFycmF5VmFsdWVTcWwocXVlcnkuZHJpdmVyLCB2YWx1ZSlcbiAgICAgICAgOiB2YWx1ZSA9PT0gbnVsbCA/IFwiTlVMTFwiIDogcXVlcnkuZHJpdmVyLnF1b3RlKHZhbHVlKVxuXG4gICAgICBjb25zdCBzZWxlY3RlZFZhbHVlID0gcXVlcnkuZHJpdmVyLmdldFR5cGUoKSA9PSBcInBnc3FsXCJcbiAgICAgICAgPyBgQ0FTVCgke3F1b3RlZFZhbHVlfSBBUyAke2NvbHVtbi5nZXREYXRhYmFzZVR5cGUoKX0pYFxuICAgICAgICA6IHF1b3RlZFZhbHVlXG5cbiAgICAgIHJldHVybiBgJHtzZWxlY3RlZFZhbHVlfSBBUyAke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG4gICAgfSlcblxuICAgIGlmIChzZWxlY3RlZENvbHVtbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhdXRob3JpemUgYSBkZXN0cm95ZWQgJHtNb2RlbENsYXNzLm5hbWV9IHdpdGhvdXQgY2FwdHVyZWQgYXR0cmlidXRlc2ApXG4gICAgfVxuXG4gICAgY29uc3QgZnJvbXMgPSBxdWVyeS5nZXRGcm9tcygpXG5cbiAgICBmcm9tcy5zcGxpY2UoMCwgZnJvbXMubGVuZ3RoKVxuICAgIHF1ZXJ5LmZyb20oYChTRUxFQ1QgJHtzZWxlY3RlZENvbHVtbnMuam9pbihcIiwgXCIpfSkgQVMgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZShNb2RlbENsYXNzLnRhYmxlTmFtZSgpKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IGJyb2FkY2FzdFBhcmFtcyAtIFBhcmFtcyBmcm9tIGBicm9hZGNhc3RUb0NoYW5uZWxgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgYnJvYWRjYXN0IG1hdGNoZXMgdGhpcyBzdWJzY3JpYmVyJ3MgbW9kZWwuXG4gICAqL1xuICBtYXRjaGVzKGJyb2FkY2FzdFBhcmFtcykge1xuICAgIHJldHVybiBicm9hZGNhc3RQYXJhbXM/Lm1vZGVsID09PSB0aGlzLl9tb2RlbE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IERlYnVnLXNhZmUgc3Vic2NyaXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0aWVzOiB0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCxcbiAgICAgIGV2ZW50RmlsdGVyQ291bnQ6IGV2ZW50RmlsdGVycy5sZW5ndGgsXG4gICAgICBkZXN0cm95RXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMuZGVzdHJveUV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICBwcmVsb2FkOiB0aGlzLnBhcmFtcy5wcmVsb2FkICE9PSB1bmRlZmluZWQsXG4gICAgICBxdWVyeURhdGE6IHRoaXMucGFyYW1zLnF1ZXJ5RGF0YSAhPT0gdW5kZWZpbmVkLFxuICAgICAgc2VsZWN0OiB0aGlzLnBhcmFtcy5zZWxlY3QgIT09IHVuZGVmaW5lZCxcbiAgICAgIHNlbGVjdHNFeHRyYTogdGhpcy5wYXJhbXMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWQsXG4gICAgICB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeTogdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWUsXG4gICAgICB3aXRoQ291bnQ6IHRoaXMucGFyYW1zLndpdGhDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVxdWVzdGVkIGZyb250ZW5kLW1vZGVsIG5hbWUgb3IgbnVsbC5cbiAgICovXG4gIF9tb2RlbE5hbWUoKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGlzLnBhcmFtcz8ubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5wYXJhbXMubW9kZWwubGVuZ3RoID4gMFxuICAgICAgPyB0aGlzLnBhcmFtcy5tb2RlbFxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgZXZlbnQgZmlsdGVyIHBhcmFtcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIHN1YnNjcmlwdGlvbiByZXF1ZXN0ZWQgZXZlbnQgcXVlcnkgZmlsdGVycy5cbiAgICovXG4gIF9oYXNFdmVudEZpbHRlclBhcmFtcygpIHtcbiAgICByZXR1cm4gdGhpcy5fZXZlbnRGaWx0ZXJzKCkubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHVuZmlsdGVyZWQgZXZlbnQgZGVsaXZlcnkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdW5maWx0ZXJlZCBjYWxsYmFja3Mgc2hvdWxkIHJlY2VpdmUgZXZlcnkgZXZlbnQuXG4gICAqL1xuICBfaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkoKSB7XG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLnVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgZGVzdHJveSBldmVudCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpZC1vbmx5IGRlc3Ryb3kgZXZlbnRzIHNob3VsZCBiZSBkZWxpdmVyZWQgd2l0aCBldmVudCBmaWx0ZXJzLlxuICAgKi9cbiAgX2hhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLnBhcmFtcy5kZXN0cm95RXZlbnREZWxpdmVyeSA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgZmlsdGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5W119IC0gVmFsaWQgZXZlbnQgZmlsdGVycy5cbiAgICovXG4gIF9ldmVudEZpbHRlcnMoKSB7XG4gICAgaWYgKHRoaXMucGFyYW1zLmV2ZW50RmlsdGVycyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZW50cnkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIG11c3QgYmUgb2JqZWN0c1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudEZpbHRlciA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpXG4gICAgICBjb25zdCB1bmtub3duS2V5cyA9IE9iamVjdC5rZXlzKGV2ZW50RmlsdGVyKS5maWx0ZXIoKGtleSkgPT4gIUVWRU5UX0ZJTFRFUl9LRVlTLmhhcyhrZXkpKVxuXG4gICAgICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIGV2ZW50RmlsdGVycyBlbnRyaWVzIGNhbm5vdCBpbmNsdWRlICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfWApXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgZXZlbnRGaWx0ZXIua2V5ICE9PSBcInN0cmluZ1wiIHx8IGV2ZW50RmlsdGVyLmtleS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgcmVxdWlyZSBhIGtleVwiKVxuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIFNhbml0aXplZCBldmVudCBmaWx0ZXIuXG4gICAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnl9ICovXG4gICAgICBjb25zdCBzYW5pdGl6ZWRFdmVudEZpbHRlciA9IHtrZXk6IGV2ZW50RmlsdGVyLmtleX1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLmpvaW5zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIuam9pbnMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKGV2ZW50RmlsdGVyLmpvaW5zKVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIuc2VhcmNoZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci5zZWFyY2hlcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsU2VhcmNoW119ICovIChldmVudEZpbHRlci5zZWFyY2hlcylcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50RmlsdGVyLndoZXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FuaXRpemVkRXZlbnRGaWx0ZXIud2hlcmUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKGV2ZW50RmlsdGVyLndoZXJlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gc2FuaXRpemVkRXZlbnRGaWx0ZXJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdD59IC0gRnJvbnRlbmQgbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICovXG4gIGFzeW5jIF9mcm9udGVuZE1vZGVsQ29udHJvbGxlckNsYXNzKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxDb250cm9sbGVyUGF0aCA9IFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiXG4gICAgY29uc3Qge2RlZmF1bHQ6IEZyb250ZW5kTW9kZWxDb250cm9sbGVyfSA9IGF3YWl0IGltcG9ydChmcm9udGVuZE1vZGVsQ29udHJvbGxlclBhdGgpXG5cbiAgICByZXR1cm4gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbnRyb2xsZXIuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3BhcmFtc10gLSBPcHRpb25hbCBwYXJhbXMgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IC0gU3ludGhldGljIGNvbnRyb2xsZXIgdXNlZCBmb3IgcmVzb3VyY2Ugc2VyaWFsaXphdGlvbi5cbiAgICovXG4gIF9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlciwgcGFyYW1zID0ge30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEZyb250ZW5kTW9kZWxDb250cm9sbGVyKHtcbiAgICAgIGFjdGlvbjogXCJ3ZWJzb2NrZXRFdmVudFwiLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGNvbnRyb2xsZXI6IFwiZnJvbnRlbmQtbW9kZWxzXCIsXG4gICAgICBwYXJhbXM6IHtcbiAgICAgICAgYWJpbGl0aWVzOiB0aGlzLnBhcmFtcy5hYmlsaXRpZXMsXG4gICAgICAgIGpvaW5zOiB0aGlzLnBhcmFtcy5qb2lucyxcbiAgICAgICAgbW9kZWw6IHRoaXMuX21vZGVsTmFtZSgpLFxuICAgICAgICBwcmVsb2FkOiB0aGlzLnBhcmFtcy5wcmVsb2FkLFxuICAgICAgICBxdWVyeURhdGE6IHRoaXMucGFyYW1zLnF1ZXJ5RGF0YSxcbiAgICAgICAgc2VhcmNoZXM6IHRoaXMucGFyYW1zLnNlYXJjaGVzLFxuICAgICAgICBzZWxlY3Q6IHRoaXMucGFyYW1zLnNlbGVjdCxcbiAgICAgICAgc2VsZWN0c0V4dHJhOiB0aGlzLnBhcmFtcy5zZWxlY3RzRXh0cmEsXG4gICAgICAgIHdoZXJlOiB0aGlzLnBhcmFtcy53aGVyZSxcbiAgICAgICAgLi4ucGFyYW1zLFxuICAgICAgICB3aXRoQ291bnQ6IHRoaXMucGFyYW1zLndpdGhDb3VudFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSksXG4gICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSksXG4gICAgICB2aWV3UGF0aDogXCIvXCJcbiAgICB9KVxuXG4gICAgY29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHRoaXMuX2FiaWxpdHkgfHwgdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gY29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRlbmFudCBmb3IgZXZlbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZWQgdGVuYW50LlxuICAgKi9cbiAgYXN5bmMgX3Jlc29sdmVFdmVudFRlbmFudChpZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgd2Vic29ja2V0IGV2ZW50IHRlbmFudCByZXNvbHV0aW9uXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNaXJyb3IgdGhlIHN1YnNjcmliZS10aW1lIHRlbmFudCByZXNvbHV0aW9uIChgV2Vic29ja2V0U2Vzc2lvbi5fcmVzb2x2ZVRlbmFudGApOlxuICAgICAgLy8gcGFzcyBgc3Vic2NyaXB0aW9uOiB7Y2hhbm5lbCwgcGFyYW1zfWAgc28gcmVzb2x2ZXJzIHRoYXQgZGVyaXZlIHNjb3BlIGZyb20gdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24gYmVoYXZlIHRoZSBzYW1lIGZvciBicm9hZGNhc3RzIGFzIHRoZXkgZGlkIGF0IGBjaGFubmVsLXN1YnNjcmliZWAuXG4gICAgICAvLyBUaGUgc3ludGhldGljIHJlcXVlc3QgZm9yd2FyZHMgdGhlIHN1YnNjcmliZXIncyBwYXJhbXMgKGUuZy4gYXV0aGVudGljYXRpb25Ub2tlbiksXG4gICAgICAvLyBtYXRjaGluZyB0aGlzIGNoYW5uZWwncyBhYmlsaXR5IHJlc29sdXRpb24gYWJvdmUuXG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgICAgcGFyYW1zOiB7Li4udGhpcy5wYXJhbXMsIGlkLCBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCl9LFxuICAgICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLl9zeW50aGV0aWNSZXF1ZXN0KCkpLFxuICAgICAgICByZXNwb25zZTogbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSksXG4gICAgICAgIHN1YnNjcmlwdGlvbjoge2NoYW5uZWw6IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHBhcmFtczogdGhpcy5wYXJhbXN9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN1YnNjcmliZXIncyB0ZW5hbnQgZm9yIHRoZSBicm9hZGNhc3QgcmVjb3JkIGFuZCBydW5zIGBjYWxsYmFja2AgaW5zaWRlIHRoYXQgdGVuYW50XG4gICAqIGNvbnRleHQuIEJyb2FkY2FzdCBkZWxpdmVyeSBydW5zIGluIHdoYXRldmVyIGFtYmllbnQgdGVuYW50IGNvbnRleHQgdGhlIHB1Ymxpc2hlciBsZWZ0IGJlaGluZC4gRm9yXG4gICAqIG11bHRpLXRlbmFudCByZWNvcmRzIHRoYXQgYW1iaWVudCB0ZW5hbnQgbWF5IGhhdmUgYmVlbiByZXNvbHZlZCB3aXRob3V0IHRoZSBzdWJzY3JpYmVyJ3MgcmVxdWVzdFxuICAgKiAoZS5nLiBhIHJlbGF5IGVuZHBvaW50IG9yIGJhY2tncm91bmQgam9iIG11dGF0aW5nIHRoZSByb3cpLCBzbyBpdCBsYWNrcyB0aGUgc3Vic2NyaWJlcidzIHBlci1yZWNvcmRcbiAgICogYWNjZXNzIGZsYWdzIGFuZCB0aGUgcGVyLWV2ZW50IGF1dGhvcml6YXRpb24gcXVlcnkgd3JvbmdseSBmaW5kcyBub3RoaW5nLiBSZS1yZXNvbHZpbmcgdGhlIHRlbmFudFxuICAgKiBmcm9tIHRoZSBldmVudCByZWNvcmQgaWQgcGx1cyB0aGUgc3Vic2NyaWJlcidzIHJlcXVlc3QgbWFrZXMgdGhlIGF1dGhvcml6YXRpb24gcXVlcmllcyBydW4gYWdhaW5zdFxuICAgKiB0aGUgc3Vic2NyaWJlcidzIG93biB0ZW5hbnQvYWJpbGl0eSBzY29wZS4gV2hlbiBubyB0ZW5hbnQgcmVzb2x2ZXMgKG5vbi1tdWx0aXRlbmFudCBjb25maWdzKSwgdGhlXG4gICAqIGNhbGxiYWNrIHJ1bnMgZGlyZWN0bHkgc28gdGhlIGFtYmllbnQgY29udGV4dCBpcyBwcmVzZXJ2ZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQXV0aG9yaXplZC1xdWVyeSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhFdmVudFRlbmFudChpZCwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbiB8fCB0eXBlb2YgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50ID0gYXdhaXQgdGhpcy5fcmVzb2x2ZUV2ZW50VGVuYW50KGlkKVxuXG4gICAgLy8gQWx3YXlzIGVudGVyIGBydW5XaXRoVGVuYW50YCwgZXZlbiB3aGVuIG5vIHRlbmFudCByZXNvbHZlZC4gQnJvYWRjYXN0IGZhbi1vdXRcbiAgICAvLyBydW5zIGluIHRoZSBwdWJsaXNoZXIncyBhbWJpZW50IHRlbmFudCBjb250ZXh0OyBmYWxsaW5nIGJhY2sgdG8gYGNhbGxiYWNrKClgXG4gICAgLy8gdGhlcmUgd291bGQgYXV0aG9yaXplIGEgY3Jvc3MtdGVuYW50IHJlY29yZCBhZ2FpbnN0IHRoZSBwdWJsaXNoZXIncyB0ZW5hbnQgYW5kXG4gICAgLy8gY291bGQgbGVhayBpdCB0byBhIHN1YnNjcmliZXIgd2hvc2Ugb3duIHJlc29sdmVyIGNvdWxkIG5vdCByZXNvbHZlIGl0LlxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCB3ZWJzb2NrZXQgZXZlbnQgdGVuYW50XCJ9LCBjYWxsYmFjaylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEV2ZW50IGZpbHRlciBrZXlzIG1hdGNoZWQgYnkgdGhlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICAvKipcbiAgICAgKiBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gW11cblxuICAgIGZvciAoY29uc3QgZXZlbnRGaWx0ZXIgb2YgdGhpcy5fZXZlbnRGaWx0ZXJzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCB0aGlzLl9ldmVudE1hdGNoZXNGaWx0ZXIoe1xuICAgICAgICBGcm9udGVuZE1vZGVsQ29udHJvbGxlcixcbiAgICAgICAgZXZlbnRGaWx0ZXIsXG4gICAgICAgIGlkXG4gICAgICB9KVxuXG4gICAgICBpZiAobWF0Y2hlcykgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5wdXNoKGV2ZW50RmlsdGVyLmtleSlcbiAgICB9XG5cbiAgICByZXR1cm4gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgbWF0Y2hlcyBmaWx0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmlsdGVyIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gYXJncy5Gcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnl9IGFyZ3MuZXZlbnRGaWx0ZXIgLSBFdmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5pZCAtIEV2ZW50IHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIHJlY29yZCBtYXRjaGVzIHRoZSBmaWx0ZXIuXG4gICAqL1xuICBhc3luYyBfZXZlbnRNYXRjaGVzRmlsdGVyKHtGcm9udGVuZE1vZGVsQ29udHJvbGxlciwgZXZlbnRGaWx0ZXIsIGlkfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRXZlbnRUZW5hbnQoaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29udHJvbGxlcihGcm9udGVuZE1vZGVsQ29udHJvbGxlciwge1xuICAgICAgICBqb2luczogZXZlbnRGaWx0ZXIuam9pbnMsXG4gICAgICAgIHNlYXJjaGVzOiBldmVudEZpbHRlci5zZWFyY2hlcyxcbiAgICAgICAgd2hlcmU6IGV2ZW50RmlsdGVyLndoZXJlXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHdoZXJlID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2hlcmUoKVxuICAgICAgY29uc3Qgam9pbnMgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxKb2lucygpXG4gICAgICAvLyBTdGFydCBmcm9tIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBhIGZpbHRlciBjYW4gb25seSBldmVyIG1hdGNoIHJlY29yZHMgdGhlXG4gICAgICAvLyBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcblxuICAgICAgaWYgKHdoZXJlKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgICAgaWYgKGpvaW5zKSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuXG4gICAgICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxTZWFyY2hlcygpKSB7XG4gICAgICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJvamVjdGVkIHJlY29yZCBmb3IgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IEZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+IHwgbnVsbD59IC0gU2VyaWFsaXplZCBwcm9qZWN0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX3Byb2plY3RlZFJlY29yZEZvckV2ZW50SWQoaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICAgIC8vIFJlbG9hZCB0aHJvdWdoIHRoZSBzdWJzY3JpYmVyJ3MgYXV0aG9yaXplZCBzY29wZSBzbyBwcm9qZWN0ZWQgcmVjb3JkcyBhcmUgb25seSBldmVyIHNlbnQgZm9yXG4gICAgICAvLyByb3dzIHRoZSBzdWJzY3JpcHRpb24ncyBhYmlsaXR5IHBlcm1pdHMgdG8gcmVhZC5cbiAgICAgIGxldCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIikud2hlcmUoe1xuICAgICAgICBbTW9kZWxDbGFzcy50YWJsZU5hbWUoKV06IGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHByZWxvYWQgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcblxuICAgICAgaWYgKHByZWxvYWQpIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpKSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTcGVjLlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IHtyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fT59ICovXG4gICAgICAgIGNvbnN0IHNwZWMgPSB7fVxuXG4gICAgICAgIHNwZWNbZW50cnkuYXR0cmlidXRlTmFtZV0gPSB7XG4gICAgICAgICAgcmVsYXRpb25zaGlwOiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZW50cnkud2hlcmUpIDogdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgcXVlcnkud2l0aENvdW50KHNwZWMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpXG5cbiAgICAgIGlmIChxdWVyeURhdGEgIT09IG51bGwpIHF1ZXJ5LnF1ZXJ5RGF0YShxdWVyeURhdGEpXG5cbiAgICAgIHF1ZXJ5ID0gY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxUcmFuc2xhdGVkQXR0cmlidXRlUHJlbG9hZHMoe3F1ZXJ5fSlcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCBxdWVyeS5maXJzdCgpXG5cbiAgICAgIGlmICghbW9kZWwpIHJldHVybiBudWxsXG5cbiAgICAgIGlmICh0aGlzLnBhcmFtcy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKFttb2RlbF0pXG4gICAgICB9XG5cbiAgICAgIGNvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB1bmRlZmluZWRcblxuICAgICAgcmV0dXJuIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5zZXJpYWxpemUobW9kZWwsIFwiZmluZFwiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWluaW1hbCBSZXF1ZXN0LWxpa2Ugc3R1YiB1c2VkIG9ubHkgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi4gQXZvaWRzXG4gICAqIGltcG9ydGluZyBgV2Vic29ja2V0UmVxdWVzdGAgaGVyZSBiZWNhdXNlIGl0cyBgbm9kZTpxdWVyeXN0cmluZ2BcbiAgICogZGVwZW5kZW5jeSB3b3VsZCBwdWxsIHNlcnZlci1vbmx5IGNvZGUgaW50byBicm93c2VyIGJ1bmRsZXMgdmlhXG4gICAqIHRoZSBgY29uZmlndXJhdGlvbiDihpIgbG9nZ2VyIOKGkiB3ZWJzb2NrZXQtcHVibGlzaGVyc2AgaW1wb3J0IGNoYWluLlxuICAgKiBIZWFkZXIgbmFtZXMgYXJlIG5vcm1hbGl6ZWQgdG8gbG93ZXJjYXNlIHNvIGBoZWFkZXIoXCJjb29raWVcIilgXG4gICAqIGZpbmRzIGEgdmFsdWUgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoZSB1cGdyYWRlLXJlcXVlc3QgaGVhZGVyc1xuICAgKiBtYXAgdXNlcyBgXCJDb29raWVcImAgb3IgYFwiY29va2llXCJgLiBTZXNzaW9uIG1ldGFkYXRhIHN0YXlzIHNlcGFyYXRlXG4gICAqIGZyb20gaGVhZGVycyBhbmQgaXMgZXhwb3NlZCB0aHJvdWdoIGBtZXRhZGF0YSguLi4pYCBmb3IgYWJpbGl0eVxuICAgKiByZXNvbHZlcnMgdGhhdCBuZWVkIHdlYnNvY2tldC1kZWxpdmVyZWQgc2Vzc2lvbiBkYXRhLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3R9IFJlcXVlc3QtbGlrZSBvYmplY3QgZm9yIGFiaWxpdHkgcmVzb2x1dGlvbi5cbiAgICovXG4gIF9zeW50aGV0aWNSZXF1ZXN0KCkge1xuICAgIGNvbnN0IHVwZ3JhZGVSZXF1ZXN0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0VXBncmFkZVJlcXVlc3R9ICovICh0aGlzLnNlc3Npb24udXBncmFkZVJlcXVlc3QpXG4gICAgY29uc3QgcmF3SGVhZGVycyA9IHR5cGVvZiB1cGdyYWRlUmVxdWVzdD8uaGVhZGVycyA9PT0gXCJmdW5jdGlvblwiID8gdXBncmFkZVJlcXVlc3QuaGVhZGVycygpIDoge31cbiAgICBjb25zdCBtZXRhZGF0YSA9IHR5cGVvZiB0aGlzLnNlc3Npb24uZ2V0TWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSgpIDoge31cbiAgICBjb25zdCByZW1vdGVBZGRyZXNzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5yZW1vdGVBZGRyZXNzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5yZW1vdGVBZGRyZXNzKCkgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBIZWFkZXIgbWFwLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD59ICovXG4gICAgY29uc3QgaGVhZGVyTWFwID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHJhd0hlYWRlcnMgfHwge30pKSB7XG4gICAgICBoZWFkZXJNYXBba2V5LnRvTG93ZXJDYXNlKCldID0gcmF3SGVhZGVyc1trZXldXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcnM6ICgpID0+IGhlYWRlck1hcCxcbiAgICAgIGhlYWRlcjogKG5hbWUpID0+IGhlYWRlck1hcFtTdHJpbmcobmFtZSkudG9Mb3dlckNhc2UoKV0sXG4gICAgICBtZXRhZGF0YTogKGtleSkgPT4ga2V5ID09PSB1bmRlZmluZWQgPyB7Li4ubWV0YWRhdGF9IDogbWV0YWRhdGFba2V5XSxcbiAgICAgIHBhdGg6ICgpID0+IFwiL2Zyb250ZW5kLW1vZGVsc1wiLFxuICAgICAgaHR0cE1ldGhvZDogKCkgPT4gXCJQT1NUXCIsXG4gICAgICByZW1vdGVBZGRyZXNzOiAoKSA9PiByZW1vdGVBZGRyZXNzLFxuICAgICAgb3JpZ2luOiAoKSA9PiBoZWFkZXJNYXAub3JpZ2luXG4gICAgfVxuICB9XG59XG4iXX0=