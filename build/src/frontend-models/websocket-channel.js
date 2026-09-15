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
     * Requires a resync for relevant destroy events because their authorization
     * snapshots are intentionally excluded from the persisted replay payload.
     * @param {import("../http-server/websocket-channel.js").WebsocketJsonValue} body - Persisted broadcast payload.
     * @returns {boolean} - Whether replay cannot safely authorize this event.
     */
    _requiresReplayGap(body) {
        if (!body || typeof body !== "object" || Array.isArray(body))
            return false;
        if (!("action" in body) || body.action !== "destroy")
            return false;
        if (!("id" in body) || body.id === undefined || body.id === null)
            return false;
        return !("model" in body) || typeof body.model !== "string" || body.model === this._modelName();
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
     * Drops the server-only destroy-authorization snapshot before replay
     * persistence. The snapshot is what makes replayed destroy events
     * require a client resync, and the pre-delete row it captures must
     * never be stored.
     * @param {Record<string, import("./query.js").FrontendModelTransportValue> | null | undefined} broadcastParams - Params from `broadcastToChannel`.
     * @returns {Record<string, import("./query.js").FrontendModelTransportValue> | null} - Persistable routing params.
     */
    static replayableBroadcastParams(broadcastParams) {
        if (!broadcastParams)
            return null;
        const replayableParams = { ...broadcastParams };
        delete replayableParams.destroyAuthorizationRecord;
        return replayableParams;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLHFDQUFxQyxDQUFBO0FBQzNFLE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDbEMsT0FBTyxRQUFRLE1BQU0sbUNBQW1DLENBQUE7QUFDeEQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFFdkU7OztHQUdHO0FBQ0g7O0dBRUc7QUFDSDs7O0dBR0c7QUFDSDs7O0dBR0c7QUFDSCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQTtBQUV4RSxxRkFBcUY7QUFDckYsMkVBQTJFO0FBQzNFLE1BQU0sNEJBQTRCLEdBQUcsaUJBQWlCLENBQUE7QUFFdEQ7Ozs7R0FJRztBQUNILFNBQVMsNEJBQTRCLENBQUMsS0FBSztJQUN6QyxPQUFPLE9BQU8sQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0FBQzdFLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyw0QkFBNEIsQ0FBQyxLQUFLO0lBQ3pDLE9BQU8sT0FBTyxDQUNaLEtBQUs7V0FDRixPQUFPLEtBQUssS0FBSyxRQUFR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QUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3ZELFFBQVEsRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsR0FBRyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBQyxHQUFHLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDO1lBQ3BFLElBQUksRUFBRSxHQUFHLEVBQUUsQ0FBQyxrQkFBa0I7WUFDOUIsVUFBVSxFQUFFLEdBQUcsRUFBRSxDQUFDLE1BQU07WUFDeEIsYUFBYSxFQUFFLEdBQUcsRUFBRSxDQUFDLGFBQWE7WUFDbEMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxNQUFNO1NBQy9CLENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWwgZnJvbSBcIi4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCJcbmltcG9ydCB7QnVmZmVyfSBmcm9tIFwibm9kZTpidWZmZXJcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuL2J1aWx0LWluLXJlc291cmNlcy5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb259IGZyb20gXCIuL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnN9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2FjdGlvbj86IHN0cmluZywgaWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cz86IHN0cmluZ1tdLCBwcmV2aW91c0lkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHJlY29yZD86IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBba2V5OiBzdHJpbmddOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHlcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3toZWFkZXJzPzogKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCByZW1vdGVBZGRyZXNzPzogKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFVwZ3JhZGVSZXF1ZXN0XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2hlYWRlcnM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPiwgaGVhZGVyOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgbWV0YWRhdGE6IChrZXk/OiBzdHJpbmcpID0+IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPiB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgdW5kZWZpbmVkLCBwYXRoOiAoKSA9PiBzdHJpbmcsIGh0dHBNZXRob2Q6ICgpID0+IHN0cmluZywgcmVtb3RlQWRkcmVzczogKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkLCBvcmlnaW46ICgpID0+IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbFdlYnNvY2tldFN5bnRoZXRpY1JlcXVlc3RcbiAqL1xuY29uc3QgRVZFTlRfRklMVEVSX0tFWVMgPSBuZXcgU2V0KFtcImpvaW5zXCIsIFwia2V5XCIsIFwic2VhcmNoZXNcIiwgXCJ3aGVyZVwiXSlcblxuLy8gTWlycm9ycyBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FIGluIC4vd2Vic29ja2V0LXB1Ymxpc2hlcnMuanMsIGR1cGxpY2F0ZWQgaGVyZVxuLy8gdG8gYXZvaWQgdGhlIGNvbmZpZ3VyYXRpb24g4oaSIGxvZ2dlciDihpIgd2Vic29ja2V0LXB1Ymxpc2hlcnMgaW1wb3J0IGN5Y2xlLlxuY29uc3QgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSA9IFwiZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhIHNlcnZlci1zaWRlIGJyb2FkY2FzdCB2YWx1ZSBpcyBhIGRlc3Ryb3ktYXV0aG9yaXphdGlvbiByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBEZXN0cm95QXV0aG9yaXphdGlvblJlY29yZH0gLSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIGNvbHVtbi1rZXllZCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIGlzRGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSlcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhIGNhcHR1cmVkIHZhbHVlIGlzIGEgc2VyaWFsaXplZCBiaW5hcnktY29sdW1uIG1hcmtlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IHZhbHVlIC0gQ2FwdHVyZWQgY29sdW1uIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHtfX3ZlbG9jaW91c0Rlc3Ryb3lBdXRob3JpemF0aW9uVHlwZTogXCJiaW5hcnlcIiwgdmFsdWU6IG51bWJlcltdfX0gLSBXaGV0aGVyIHRoZSB2YWx1ZSBjb250YWlucyBzZXJpYWxpemVkIGJ5dGVzLlxuICovXG5mdW5jdGlvbiBpc0Rlc3Ryb3lBdXRob3JpemF0aW9uQmluYXJ5KHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKFxuICAgIHZhbHVlXG4gICAgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiXG4gICAgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpXG4gICAgJiYgXCJfX3ZlbG9jaW91c0Rlc3Ryb3lBdXRob3JpemF0aW9uVHlwZVwiIGluIHZhbHVlXG4gICAgJiYgdmFsdWUuX192ZWxvY2lvdXNEZXN0cm95QXV0aG9yaXphdGlvblR5cGUgPT09IFwiYmluYXJ5XCJcbiAgICAmJiBcInZhbHVlXCIgaW4gdmFsdWVcbiAgICAmJiBBcnJheS5pc0FycmF5KHZhbHVlLnZhbHVlKVxuICAgICYmIHZhbHVlLnZhbHVlLmV2ZXJ5KChieXRlKSA9PiB0eXBlb2YgYnl0ZSA9PT0gXCJudW1iZXJcIilcbiAgKVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIFBvc3RncmVTUUwgYXJyYXkgZXhwcmVzc2lvbiB3aG9zZSBlbGVtZW50cyBhcmUgcXVvdGVkIGJ5IHRoZSBhY3RpdmUgZHJpdmVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZHJpdmVyIC0gQWN0aXZlIFBvc3RncmVTUUwgZHJpdmVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVtdfSB2YWx1ZXMgLSBDYXB0dXJlZCBhcnJheSB2YWx1ZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBvc3RncmVTUUwgYXJyYXkgZXhwcmVzc2lvbi5cbiAqL1xuZnVuY3Rpb24gcGdzcWxBcnJheVZhbHVlU3FsKGRyaXZlciwgdmFsdWVzKSB7XG4gIGNvbnN0IGVsZW1lbnRzID0gdmFsdWVzLm1hcCgodmFsdWUpID0+IHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBwZ3NxbEFycmF5VmFsdWVTcWwoZHJpdmVyLCB2YWx1ZSlcbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBcIk5VTExcIlxuXG4gICAgcmV0dXJuIGRyaXZlci5xdW90ZSh2YWx1ZSlcbiAgfSlcblxuICByZXR1cm4gYEFSUkFZWyR7ZWxlbWVudHMuam9pbihcIiwgXCIpfV1gXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgZnJvbnRlbmQgcmVzb3VyY2UgaWRlbnRpdHkgYXR0cmlidXRlcyB0byBiYWNraW5nIGRhdGFiYXNlIGNvbHVtbnMuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IHByaW1hcnlLZXkgLSBGcm9udGVuZCByZXNvdXJjZSBpZGVudGl0eSBkZWZpbml0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBGcm9udGVuZCByZXNvdXJjZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXI+fSAtIEJhY2tpbmcgY29sdW1uIGNvbmRpdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5RGF0YWJhc2VDb25kaXRpb25zKE1vZGVsQ2xhc3MsIHByaW1hcnlLZXksIGlkKSB7XG4gIGNvbnN0IHJlc291cmNlQ29uZGl0aW9ucyA9IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyPn0gKi9cbiAgY29uc3QgZGF0YWJhc2VDb25kaXRpb25zID0ge31cblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocmVzb3VyY2VDb25kaXRpb25zKSkge1xuICAgIGRhdGFiYXNlQ29uZGl0aW9uc1tNb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXSA9IHZhbHVlXG4gIH1cblxuICByZXR1cm4gZGF0YWJhc2VDb25kaXRpb25zXG59XG5cbi8qKlxuICogUnVucyB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnN9IC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICovXG5mdW5jdGlvbiB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICByZXR1cm4ge1xuICAgIHRpbWVab25lOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cblxuLyoqXG4gKiBQZXItc2Vzc2lvbiBjaGFubmVsIHN1YnNjcmlwdGlvbiBmb3IgZnJvbnRlbmQtbW9kZWwgbGlmZWN5Y2xlIGV2ZW50cy5cbiAqIFJlcGxhY2VzIHRoZSBsZWdhY3kgYEZyb250ZW5kTW9kZWxXZWJzb2NrZXRDaGFubmVsYCAoUGhhc2UgMykuXG4gKlxuICogYGNhblN1YnNjcmliZWAgcmVzb2x2ZXMgdGhlIGNhbGxlcidzIGFiaWxpdHkgb25jZSBhbmQgcmVxdWlyZXMgYSByZWFkIHJ1bGVcbiAqIGZvciB0aGUgcmVxdWVzdGVkIG1vZGVsIGNsYXNzLiBDcmVhdGUvdXBkYXRlIGRlbGl2ZXJ5IHRoZW4gcmVsb2FkcyBlYWNoXG4gKiByZWNvcmQgdGhyb3VnaCB0aGF0IGFiaWxpdHkgYW5kIHNlcmlhbGl6ZXMgaXQgdGhyb3VnaCB0aGUgc3Vic2NyaWJlZFxuICogZnJvbnRlbmQgcmVzb3VyY2UuIFN1YnNjcmliZXItcHJvdmlkZWQgZXZlbnQgZmlsdGVycyBjYW4gZnVydGhlciBuYXJyb3dcbiAqIHRob3NlIGF1dGhvcml6ZWQgZXZlbnRzLlxuICpcbiAqIFdpcmU6IHN1YnNjcmliZSB3aXRoIGBzdWJzY3JpYmVDaGFubmVsKFwiZnJvbnRlbmQtbW9kZWxzXCIsIHtwYXJhbXM6IHttb2RlbDogTW9kZWxOYW1lfX0pYC5cbiAqIEJhY2tlbmQgcHVibGlzaGVzIGB7YWN0aW9uLCBpZCwgcmVjb3JkfWAgdmlhXG4gKiBgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoXCJmcm9udGVuZC1tb2RlbHNcIiwge21vZGVsOiBNb2RlbE5hbWV9LCBib2R5KWA7XG4gKiBgbWF0Y2hlcygpYCByb3V0ZXMgYnkgbW9kZWwgbmFtZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbFdlYnNvY2tldENoYW5uZWwgZXh0ZW5kcyBWZWxvY2lvdXNXZWJzb2NrZXRDaGFubmVsIHtcbiAgLyoqXG4gICAqIEFiaWxpdHkuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gIF9hYmlsaXR5ID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbiBzdWJzY3JpYmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBmcm9udGVuZC1tb2RlbCBzdWJzY3JpcHRpb24gaXMgYXV0aG9yaXplZC5cbiAgICovXG4gIGFzeW5jIGNhblN1YnNjcmliZSgpIHtcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLl9tb2RlbE5hbWUoKVxuXG4gICAgaWYgKCFtb2RlbE5hbWUpIHJldHVybiBmYWxzZVxuICAgIHRoaXMuX2V2ZW50RmlsdGVycygpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5fbW9kZWxDbGFzcyhtb2RlbE5hbWUpXG5cbiAgICBpZiAoIU1vZGVsQ2xhc3MpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSlcbiAgICBjb25zdCBhYmlsaXR5ID0gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlQWJpbGl0eSh7XG4gICAgICAvLyBGb3J3YXJkIHRoZSBzdWJzY3JpYmVyJ3MgcGFyYW1zIChlLmcuIGF1dGhlbnRpY2F0aW9uVG9rZW4pIHNvIHRva2VuLWF1dGhlbnRpY2F0ZWQgY2xpZW50c1xuICAgICAgLy8gcmVzb2x2ZSB0aGUgc2FtZSBhYmlsaXR5IHRoZXkgd291bGQgb3ZlciBIVFRQLiBXaXRob3V0IHRoaXMgb25seSBzZXNzaW9uL2Nvb2tpZSBhdXRoIG9uIHRoZVxuICAgICAgLy8gdXBncmFkZSByZXF1ZXN0IHdvcmtzLCBhbmQgcGFyYW0tYmFzZWQgYXV0aCAobGlrZSBhIHNjYW5uZXIgcGFzc2luZyBhbiBhdXRoZW50aWNhdGlvblRva2VuKVxuICAgICAgLy8gaXMgZHJvcHBlZCDigJQgbGVhdmluZyBzdWNoIHN1YnNjcmliZXJzIHdpdGggYSBndWVzdCBhYmlsaXR5IGFuZCBubyByZWFkIHJ1bGUuXG4gICAgICBwYXJhbXM6IHsuLi50aGlzLnBhcmFtcywgbW9kZWw6IG1vZGVsTmFtZX0sXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2U6IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgfSlcblxuICAgIGlmICghYWJpbGl0eSkgcmV0dXJuIGZhbHNlXG4gICAgdGhpcy5fYWJpbGl0eSA9IGFiaWxpdHlcblxuICAgIC8vIExvYWQgcmVzb3VyY2UtZGVjbGFyZWQgcnVsZXMgZm9yIHRoaXMgbW9kZWwgY2xhc3MgYmVmb3JlIGNoZWNraW5nLFxuICAgIC8vIG90aGVyd2lzZSBgcnVsZXNGb3JgIHJldHVybnMgZW1wdHkgZm9yIGFiaWxpdGllcyB3aG9zZSByZXNvdXJjZXNcbiAgICAvLyByZWdpc3RlciBydWxlcyBsYXppbHkgdmlhIGBhYmlsaXRpZXMoKWAuXG4gICAgYWJpbGl0eS5sb2FkQWJpbGl0aWVzRm9yTW9kZWxDbGFzcyhNb2RlbENsYXNzKVxuXG4gICAgY29uc3QgcmVhZFJ1bGVzID0gYWJpbGl0eS5ydWxlc0Zvcih7YWN0aW9uOiBcInJlYWRcIiwgbW9kZWxDbGFzczogTW9kZWxDbGFzc30pXG5cbiAgICByZXR1cm4gcmVhZFJ1bGVzLnNvbWUoKC8qKiBAdHlwZSB7e2VmZmVjdDogc3RyaW5nfX0gKi8gcnVsZSkgPT4gcnVsZS5lZmZlY3QgPT09IFwiYWxsb3dcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHN1YnNjcmlwdGlvbiBuYW1lIHRocm91Z2ggZnJvbnRlbmQgcmVzb3VyY2VzIGJlZm9yZSBmYWxsaW5nIGJhY2sgdG8gYSBiYWNraW5nIG1vZGVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCByZXNvdXJjZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBfbW9kZWxDbGFzcyhtb2RlbE5hbWUpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5zZXNzaW9uLmNvbmZpZ3VyYXRpb25cblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVttb2RlbE5hbWVdXG4gICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gcmVzb3VyY2VEZWZpbml0aW9uID8gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pIDogbnVsbFxuXG4gICAgICBpZiAocmVzb3VyY2VDbGFzcz8uTW9kZWxDbGFzcykgcmV0dXJuIHJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClbbW9kZWxOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbExpZmVjeWNsZUJyb2FkY2FzdEJvZHl9IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5XZWJzb2NrZXRCcm9hZGNhc3RNZXRhZGF0YX0gW21ldGFdIC0gT3B0aW9uYWwgc2VydmVyLXNpZGUgYnJvYWRjYXN0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsaXZlcnkuXG4gICAqL1xuICBhc3luYyBkZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpIHtcbiAgICBhd2FpdCB0aGlzLl9kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTGlmZWN5Y2xlQnJvYWRjYXN0Qm9keX0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEJyb2FkY2FzdE1ldGFkYXRhfSBbbWV0YV0gLSBPcHRpb25hbCBzZXJ2ZXItc2lkZSBicm9hZGNhc3QgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxpdmVyeS5cbiAgICovXG4gIGFzeW5jIF9kZWxpdmVyQnJvYWRjYXN0KGJvZHksIG1ldGEpIHtcbiAgICBjb25zdCBoYXNFdmVudEZpbHRlcnMgPSB0aGlzLl9oYXNFdmVudEZpbHRlclBhcmFtcygpXG5cbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGlmICghaGFzRXZlbnRGaWx0ZXJzIHx8IHRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkpIHRoaXMuc2VuZE1lc3NhZ2UoYm9keSwgbWV0YSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYm9keS5tb2RlbCA9PT0gXCJzdHJpbmdcIiAmJiBib2R5Lm1vZGVsICE9PSB0aGlzLl9tb2RlbE5hbWUoKSkgcmV0dXJuXG5cbiAgICBpZiAoYm9keS5hY3Rpb24gPT09IFwiZGVzdHJveVwiKSB7XG4gICAgICBpZiAoYm9keS5pZCA9PT0gdW5kZWZpbmVkIHx8IGJvZHkuaWQgPT09IG51bGwpIHJldHVyblxuXG4gICAgICBjb25zdCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKVxuICAgICAgY29uc3QgYXV0aG9yaXplZCA9IGF3YWl0IHRoaXMuX2Rlc3Ryb3lFdmVudElzQXV0aG9yaXplZChcbiAgICAgICAgYm9keSxcbiAgICAgICAgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIsXG4gICAgICAgIG1ldGE/LmJyb2FkY2FzdFBhcmFtcz8uZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRcbiAgICAgIClcblxuICAgICAgaWYgKCFhdXRob3JpemVkKSByZXR1cm5cblxuICAgICAgaWYgKCFoYXNFdmVudEZpbHRlcnMgfHwgdGhpcy5faGFzRGVzdHJveUV2ZW50RGVsaXZlcnkoKSB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB7XG4gICAgICAgIHRoaXMuc2VuZE1lc3NhZ2Uoe1xuICAgICAgICAgIGFjdGlvbjogYm9keS5hY3Rpb24sXG4gICAgICAgICAgaWQ6IGJvZHkuaWQsXG4gICAgICAgICAgLi4uKHR5cGVvZiBib2R5Lm1vZGVsID09PSBcInN0cmluZ1wiID8ge21vZGVsOiBib2R5Lm1vZGVsfSA6IHt9KVxuICAgICAgICB9LCBtZXRhKVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGJvZHkuaWQgPT09IHVuZGVmaW5lZCB8fCBib2R5LmlkID09PSBudWxsKSB7XG4gICAgICBpZiAoIWhhc0V2ZW50RmlsdGVycyB8fCB0aGlzLl9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpKSB0aGlzLnNlbmRNZXNzYWdlKGJvZHksIG1ldGEpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciA9IGF3YWl0IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBoYXNFdmVudEZpbHRlcnNcbiAgICAgID8gYXdhaXQgdGhpcy5fbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c0ZvckV2ZW50SWQoYm9keS5pZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG4gICAgICA6IFtdXG4gICAgY29uc3QgaXNJZGVudGl0eVRyYW5zaXRpb24gPSBib2R5LmFjdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiBib2R5LnByZXZpb3VzSWQgIT09IHVuZGVmaW5lZCAmJiBib2R5LnByZXZpb3VzSWQgIT09IG51bGxcblxuICAgIGlmIChoYXNFdmVudEZpbHRlcnMgJiYgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5sZW5ndGggPT09IDAgJiYgIXRoaXMuX2hhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5KCkgJiYgIWlzSWRlbnRpdHlUcmFuc2l0aW9uKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwcm9qZWN0ZWRSZWNvcmQgPSBhd2FpdCB0aGlzLl9wcm9qZWN0ZWRSZWNvcmRGb3JFdmVudElkKGJvZHkuaWQsIEZyb250ZW5kTW9kZWxDb250cm9sbGVyKVxuXG4gICAgaWYgKCFwcm9qZWN0ZWRSZWNvcmQpIHtcbiAgICAgIGlmIChpc0lkZW50aXR5VHJhbnNpdGlvbikge1xuICAgICAgICB0aGlzLnNlbmRNZXNzYWdlKHtcbiAgICAgICAgICBhY3Rpb246IGJvZHkuYWN0aW9uLFxuICAgICAgICAgIGlkOiBib2R5LmlkLFxuICAgICAgICAgIC4uLihoYXNFdmVudEZpbHRlcnMgPyB7bWF0Y2hlZEV2ZW50RmlsdGVyS2V5c30gOiB7fSksXG4gICAgICAgICAgLi4uKHR5cGVvZiBib2R5Lm1vZGVsID09PSBcInN0cmluZ1wiID8ge21vZGVsOiBib2R5Lm1vZGVsfSA6IHt9KSxcbiAgICAgICAgICBwcmV2aW91c0lkOiBib2R5LnByZXZpb3VzSWRcbiAgICAgICAgfSwgbWV0YSlcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCB3ZWJzb2NrZXQgY2hhbm5lbCBoYXMgbm8gY29uZmlndXJhdGlvbiBmb3IgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb25cIilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxpdmVyIGJvZHkuXG4gICAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSAqL1xuICAgIGxldCBkZWxpdmVyQm9keSA9IHtcbiAgICAgIC4uLmJvZHksXG4gICAgICByZWNvcmQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocHJvamVjdGVkUmVjb3JkLCB0cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9uc0ZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikpKVxuICAgIH1cblxuICAgIGlmIChoYXNFdmVudEZpbHRlcnMpIHtcbiAgICAgIGRlbGl2ZXJCb2R5ID0ge1xuICAgICAgICAuLi5kZWxpdmVyQm9keSxcbiAgICAgICAgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuc2VuZE1lc3NhZ2UoZGVsaXZlckJvZHksIG1ldGEpXG4gIH1cblxuICAvKipcbiAgICogUmVxdWlyZXMgYSByZXN5bmMgZm9yIHJlbGV2YW50IGRlc3Ryb3kgZXZlbnRzIGJlY2F1c2UgdGhlaXIgYXV0aG9yaXphdGlvblxuICAgKiBzbmFwc2hvdHMgYXJlIGludGVudGlvbmFsbHkgZXhjbHVkZWQgZnJvbSB0aGUgcGVyc2lzdGVkIHJlcGxheSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL3dlYnNvY2tldC1jaGFubmVsLmpzXCIpLldlYnNvY2tldEpzb25WYWx1ZX0gYm9keSAtIFBlcnNpc3RlZCBicm9hZGNhc3QgcGF5bG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZXBsYXkgY2Fubm90IHNhZmVseSBhdXRob3JpemUgdGhpcyBldmVudC5cbiAgICovXG4gIF9yZXF1aXJlc1JlcGxheUdhcChib2R5KSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYm9keSkpIHJldHVybiBmYWxzZVxuICAgIGlmICghKFwiYWN0aW9uXCIgaW4gYm9keSkgfHwgYm9keS5hY3Rpb24gIT09IFwiZGVzdHJveVwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoIShcImlkXCIgaW4gYm9keSkgfHwgYm9keS5pZCA9PT0gdW5kZWZpbmVkIHx8IGJvZHkuaWQgPT09IG51bGwpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuICEoXCJtb2RlbFwiIGluIGJvZHkpIHx8IHR5cGVvZiBib2R5Lm1vZGVsICE9PSBcInN0cmluZ1wiIHx8IGJvZHkubW9kZWwgPT09IHRoaXMuX21vZGVsTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGEgZGVzdHJveSBhZ2FpbnN0IHRoZSBzdWJzY3JpYmVyJ3Mgb3JkaW5hcnkgYXV0aG9yaXplZCBxdWVyeSBieVxuICAgKiByZXBsYWNpbmcgdGhlIGRlbGV0ZWQgYmFja2luZyB0YWJsZSB3aXRoIHRoZSBjYXB0dXJlZCBwcmUtZGVsZXRlIHJvdy4gVmFsdWVzXG4gICAqIGFyZSBxdW90ZWQgb24gdGhpcyB0cnVzdGVkIGRhdGFiYXNlIGNvbm5lY3Rpb247IG5vIGJyb2FkY2FzdC1wcm92aWRlZCBTUUwgaXMgcnVuLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxMaWZlY3ljbGVCcm9hZGNhc3RCb2R5fSBib2R5IC0gRGVzdHJveSBicm9hZGNhc3QgYm9keS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCB1bmRlZmluZWR9IGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkIC0gU2VydmVyLW9ubHkgcHJlLWRlbGV0ZSByZWNvcmQgZnJvbSBsaXZlIGJyb2FkY2FzdCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc3Vic2NyaWJlciBjb3VsZCByZWFkIHRoZSByZWNvcmQgYmVmb3JlIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2Rlc3Ryb3lFdmVudElzQXV0aG9yaXplZChib2R5LCBGcm9udGVuZE1vZGVsQ29udHJvbGxlciwgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpIHtcbiAgICBjb25zdCBpZCA9IGJvZHkuaWRcblxuICAgIGlmIChpZCA9PT0gdW5kZWZpbmVkIHx8IGlkID09PSBudWxsIHx8ICFpc0Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgcnVsZVF1ZXJ5RmFjdG9yeSA9ICgpID0+IHRoaXMuX2Rlc3Ryb3lBdXRob3JpemF0aW9uUXVlcnkoTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG4gICAgICBjb25zdCBxdWVyeSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImZpbmRcIiwge3J1bGVRdWVyeUZhY3Rvcnl9KVxuXG4gICAgICB0aGlzLl9hcHBseURlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkVG9RdWVyeShxdWVyeSwgTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG4gICAgICBxdWVyeS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgYmFja2luZy1tb2RlbCBxdWVyeSB3aG9zZSBzb3VyY2UgaXMgdGhlIGNhcHR1cmVkIHByZS1kZWxldGUgcm93LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7RGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmR9IGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkIC0gQ2FwdHVyZWQgcHJlLWRlbGV0ZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gT25lLXJvdyBtb2RlbCBxdWVyeS5cbiAgICovXG4gIF9kZXN0cm95QXV0aG9yaXphdGlvblF1ZXJ5KE1vZGVsQ2xhc3MsIGRlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkKSB7XG4gICAgY29uc3QgcXVlcnkgPSBNb2RlbENsYXNzLl9uZXdRdWVyeSgpXG5cbiAgICB0aGlzLl9hcHBseURlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkVG9RdWVyeShxdWVyeSwgTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpXG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyBhIHF1ZXJ5J3MgYmFja2luZyB0YWJsZSB3aXRoIGEgc2FmZWx5IHF1b3RlZCBvbmUtcm93IGRlcml2ZWQgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBxdWVyeSAtIFF1ZXJ5IHRvIHVwZGF0ZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge0Rlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkfSBkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCAtIENhcHR1cmVkIHByZS1kZWxldGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseURlc3Ryb3lBdXRob3JpemF0aW9uUmVjb3JkVG9RdWVyeShxdWVyeSwgTW9kZWxDbGFzcywgZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmQpIHtcbiAgICBjb25zdCBzZWxlY3RlZENvbHVtbnMgPSBPYmplY3QuZW50cmllcyhkZXN0cm95QXV0aG9yaXphdGlvblJlY29yZCkubWFwKChbY29sdW1uTmFtZSwgc2VyaWFsaXplZFZhbHVlXSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSBpc0Rlc3Ryb3lBdXRob3JpemF0aW9uQmluYXJ5KHNlcmlhbGl6ZWRWYWx1ZSlcbiAgICAgICAgPyBCdWZmZXIuZnJvbShzZXJpYWxpemVkVmFsdWUudmFsdWUpXG4gICAgICAgIDogZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoc2VyaWFsaXplZFZhbHVlKVxuICAgICAgY29uc3QgY29sdW1uID0gTW9kZWxDbGFzcy5nZXRDb2x1bW5zSGFzaCgpW2NvbHVtbk5hbWVdXG5cbiAgICAgIGlmICghY29sdW1uKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhdXRob3JpemUgYSBkZXN0cm95ZWQgJHtNb2RlbENsYXNzLm5hbWV9IHdpdGggdW5rbm93biBjb2x1bW4gJHtjb2x1bW5OYW1lfWApXG4gICAgICBjb25zdCBxdW90ZWRWYWx1ZSA9IHF1ZXJ5LmRyaXZlci5nZXRUeXBlKCkgPT0gXCJwZ3NxbFwiICYmIGNvbHVtbi5nZXRUeXBlKCkgPT09IFwiQVJSQVlcIiAmJiBBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgICAgICA/IHBnc3FsQXJyYXlWYWx1ZVNxbChxdWVyeS5kcml2ZXIsIHZhbHVlKVxuICAgICAgICA6IHZhbHVlID09PSBudWxsID8gXCJOVUxMXCIgOiBxdWVyeS5kcml2ZXIucXVvdGUodmFsdWUpXG5cbiAgICAgIGNvbnN0IHNlbGVjdGVkVmFsdWUgPSBxdWVyeS5kcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIlxuICAgICAgICA/IGBDQVNUKCR7cXVvdGVkVmFsdWV9IEFTICR7Y29sdW1uLmdldERhdGFiYXNlVHlwZSgpfSlgXG4gICAgICAgIDogcXVvdGVkVmFsdWVcblxuICAgICAgcmV0dXJuIGAke3NlbGVjdGVkVmFsdWV9IEFTICR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcbiAgICB9KVxuXG4gICAgaWYgKHNlbGVjdGVkQ29sdW1ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGF1dGhvcml6ZSBhIGRlc3Ryb3llZCAke01vZGVsQ2xhc3MubmFtZX0gd2l0aG91dCBjYXB0dXJlZCBhdHRyaWJ1dGVzYClcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tcyA9IHF1ZXJ5LmdldEZyb21zKClcblxuICAgIGZyb21zLnNwbGljZSgwLCBmcm9tcy5sZW5ndGgpXG4gICAgcXVlcnkuZnJvbShgKFNFTEVDVCAke3NlbGVjdGVkQ29sdW1ucy5qb2luKFwiLCBcIil9KSBBUyAke3F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKE1vZGVsQ2xhc3MudGFibGVOYW1lKCkpfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gYnJvYWRjYXN0UGFyYW1zIC0gUGFyYW1zIGZyb20gYGJyb2FkY2FzdFRvQ2hhbm5lbGAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBicm9hZGNhc3QgbWF0Y2hlcyB0aGlzIHN1YnNjcmliZXIncyBtb2RlbC5cbiAgICovXG4gIG1hdGNoZXMoYnJvYWRjYXN0UGFyYW1zKSB7XG4gICAgcmV0dXJuIGJyb2FkY2FzdFBhcmFtcz8ubW9kZWwgPT09IHRoaXMuX21vZGVsTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogRHJvcHMgdGhlIHNlcnZlci1vbmx5IGRlc3Ryb3ktYXV0aG9yaXphdGlvbiBzbmFwc2hvdCBiZWZvcmUgcmVwbGF5XG4gICAqIHBlcnNpc3RlbmNlLiBUaGUgc25hcHNob3QgaXMgd2hhdCBtYWtlcyByZXBsYXllZCBkZXN0cm95IGV2ZW50c1xuICAgKiByZXF1aXJlIGEgY2xpZW50IHJlc3luYywgYW5kIHRoZSBwcmUtZGVsZXRlIHJvdyBpdCBjYXB0dXJlcyBtdXN0XG4gICAqIG5ldmVyIGJlIHN0b3JlZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4gfCBudWxsIHwgdW5kZWZpbmVkfSBicm9hZGNhc3RQYXJhbXMgLSBQYXJhbXMgZnJvbSBgYnJvYWRjYXN0VG9DaGFubmVsYC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPiB8IG51bGx9IC0gUGVyc2lzdGFibGUgcm91dGluZyBwYXJhbXMuXG4gICAqL1xuICBzdGF0aWMgcmVwbGF5YWJsZUJyb2FkY2FzdFBhcmFtcyhicm9hZGNhc3RQYXJhbXMpIHtcbiAgICBpZiAoIWJyb2FkY2FzdFBhcmFtcykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlcGxheWFibGVQYXJhbXMgPSB7Li4uYnJvYWRjYXN0UGFyYW1zfVxuXG4gICAgZGVsZXRlIHJlcGxheWFibGVQYXJhbXMuZGVzdHJveUF1dGhvcml6YXRpb25SZWNvcmRcblxuICAgIHJldHVybiByZXBsYXlhYmxlUGFyYW1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gRGVidWctc2FmZSBzdWJzY3JpcHRpb24gZGV0YWlscy5cbiAgICovXG4gIGRlYnVnU25hcHNob3QoKSB7XG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzID0gdGhpcy5fZXZlbnRGaWx0ZXJzKClcblxuICAgIHJldHVybiB7XG4gICAgICBhYmlsaXRpZXM6IHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkLFxuICAgICAgZXZlbnRGaWx0ZXJDb3VudDogZXZlbnRGaWx0ZXJzLmxlbmd0aCxcbiAgICAgIGRlc3Ryb3lFdmVudERlbGl2ZXJ5OiB0aGlzLnBhcmFtcy5kZXN0cm95RXZlbnREZWxpdmVyeSA9PT0gdHJ1ZSxcbiAgICAgIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKSxcbiAgICAgIHByZWxvYWQ6IHRoaXMucGFyYW1zLnByZWxvYWQgIT09IHVuZGVmaW5lZCxcbiAgICAgIHF1ZXJ5RGF0YTogdGhpcy5wYXJhbXMucXVlcnlEYXRhICE9PSB1bmRlZmluZWQsXG4gICAgICBzZWxlY3Q6IHRoaXMucGFyYW1zLnNlbGVjdCAhPT0gdW5kZWZpbmVkLFxuICAgICAgc2VsZWN0c0V4dHJhOiB0aGlzLnBhcmFtcy5zZWxlY3RzRXh0cmEgIT09IHVuZGVmaW5lZCxcbiAgICAgIHVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5OiB0aGlzLnBhcmFtcy51bmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9PT0gdHJ1ZSxcbiAgICAgIHdpdGhDb3VudDogdGhpcy5wYXJhbXMud2l0aENvdW50ICE9PSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSZXF1ZXN0ZWQgZnJvbnRlbmQtbW9kZWwgbmFtZSBvciBudWxsLlxuICAgKi9cbiAgX21vZGVsTmFtZSgpIHtcbiAgICByZXR1cm4gdHlwZW9mIHRoaXMucGFyYW1zPy5tb2RlbCA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLnBhcmFtcy5tb2RlbC5sZW5ndGggPiAwXG4gICAgICA/IHRoaXMucGFyYW1zLm1vZGVsXG4gICAgICA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBldmVudCBmaWx0ZXIgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgc3Vic2NyaXB0aW9uIHJlcXVlc3RlZCBldmVudCBxdWVyeSBmaWx0ZXJzLlxuICAgKi9cbiAgX2hhc0V2ZW50RmlsdGVyUGFyYW1zKCkge1xuICAgIHJldHVybiB0aGlzLl9ldmVudEZpbHRlcnMoKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdW5maWx0ZXJlZCBldmVudCBkZWxpdmVyeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB1bmZpbHRlcmVkIGNhbGxiYWNrcyBzaG91bGQgcmVjZWl2ZSBldmVyeSBldmVudC5cbiAgICovXG4gIF9oYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSgpIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbXMudW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBkZXN0cm95IGV2ZW50IGRlbGl2ZXJ5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGlkLW9ubHkgZGVzdHJveSBldmVudHMgc2hvdWxkIGJlIGRlbGl2ZXJlZCB3aXRoIGV2ZW50IGZpbHRlcnMuXG4gICAqL1xuICBfaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkoKSB7XG4gICAgcmV0dXJuIHRoaXMucGFyYW1zLmRlc3Ryb3lFdmVudERlbGl2ZXJ5ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlbXX0gLSBWYWxpZCBldmVudCBmaWx0ZXJzLlxuICAgKi9cbiAgX2V2ZW50RmlsdGVycygpIHtcbiAgICBpZiAodGhpcy5wYXJhbXMuZXZlbnRGaWx0ZXJzID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBhcmFtcy5ldmVudEZpbHRlcnMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzXCIpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV2ZW50RmlsdGVyID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChlbnRyeSlcbiAgICAgIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMoZXZlbnRGaWx0ZXIpLmZpbHRlcigoa2V5KSA9PiAhRVZFTlRfRklMVEVSX0tFWVMuaGFzKGtleSkpXG5cbiAgICAgIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgZXZlbnRGaWx0ZXJzIGVudHJpZXMgY2Fubm90IGluY2x1ZGUgJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBldmVudEZpbHRlci5rZXkgIT09IFwic3RyaW5nXCIgfHwgZXZlbnRGaWx0ZXIua2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudEZpbHRlcnMgZW50cmllcyByZXF1aXJlIGEga2V5XCIpXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2FuaXRpemVkIGV2ZW50IGZpbHRlci5cbiAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gKi9cbiAgICAgIGNvbnN0IHNhbml0aXplZEV2ZW50RmlsdGVyID0ge2tleTogZXZlbnRGaWx0ZXIua2V5fVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIuam9pbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci5qb2lucyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIuam9pbnMpXG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudEZpbHRlci5zZWFyY2hlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbml0aXplZEV2ZW50RmlsdGVyLnNlYXJjaGVzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi8gKGV2ZW50RmlsdGVyLnNlYXJjaGVzKVxuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRGaWx0ZXIud2hlcmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW5pdGl6ZWRFdmVudEZpbHRlci53aGVyZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoZXZlbnRGaWx0ZXIud2hlcmUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBzYW5pdGl6ZWRFdmVudEZpbHRlclxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0Pn0gLSBGcm9udGVuZCBtb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyQ2xhc3MoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbENvbnRyb2xsZXJQYXRoID0gXCIuLi9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzXCJcbiAgICBjb25zdCB7ZGVmYXVsdDogRnJvbnRlbmRNb2RlbENvbnRyb2xsZXJ9ID0gYXdhaXQgaW1wb3J0KGZyb250ZW5kTW9kZWxDb250cm9sbGVyUGF0aClcblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQ29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsQ29udHJvbGxlciAtIFNlcnZlci1zaWRlIGZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbcGFyYW1zXSAtIE9wdGlvbmFsIHBhcmFtcyBvdmVycmlkZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBTeW50aGV0aWMgY29udHJvbGxlciB1c2VkIGZvciByZXNvdXJjZSBzZXJpYWxpemF0aW9uLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCBwYXJhbXMgPSB7fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoe1xuICAgICAgYWN0aW9uOiBcIndlYnNvY2tldEV2ZW50XCIsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgY29udHJvbGxlcjogXCJmcm9udGVuZC1tb2RlbHNcIixcbiAgICAgIHBhcmFtczoge1xuICAgICAgICBhYmlsaXRpZXM6IHRoaXMucGFyYW1zLmFiaWxpdGllcyxcbiAgICAgICAgam9pbnM6IHRoaXMucGFyYW1zLmpvaW5zLFxuICAgICAgICBtb2RlbDogdGhpcy5fbW9kZWxOYW1lKCksXG4gICAgICAgIHByZWxvYWQ6IHRoaXMucGFyYW1zLnByZWxvYWQsXG4gICAgICAgIHF1ZXJ5RGF0YTogdGhpcy5wYXJhbXMucXVlcnlEYXRhLFxuICAgICAgICBzZWFyY2hlczogdGhpcy5wYXJhbXMuc2VhcmNoZXMsXG4gICAgICAgIHNlbGVjdDogdGhpcy5wYXJhbXMuc2VsZWN0LFxuICAgICAgICBzZWxlY3RzRXh0cmE6IHRoaXMucGFyYW1zLnNlbGVjdHNFeHRyYSxcbiAgICAgICAgd2hlcmU6IHRoaXMucGFyYW1zLndoZXJlLFxuICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgIHdpdGhDb3VudDogdGhpcy5wYXJhbXMud2l0aENvdW50XG4gICAgICB9LFxuICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5fc3ludGhldGljUmVxdWVzdCgpKSxcbiAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgIHZpZXdQYXRoOiBcIi9cIlxuICAgIH0pXG5cbiAgICBjb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gdGhpcy5fYWJpbGl0eSB8fCB1bmRlZmluZWRcblxuICAgIHJldHVybiBjb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGVuYW50IGZvciBldmVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyBfcmVzb2x2ZUV2ZW50VGVuYW50KGlkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuc2Vzc2lvbi5jb25maWd1cmF0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCB3ZWJzb2NrZXQgZXZlbnQgdGVuYW50IHJlc29sdXRpb25cIn0sIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgc3Vic2NyaWJlLXRpbWUgdGVuYW50IHJlc29sdXRpb24gKGBXZWJzb2NrZXRTZXNzaW9uLl9yZXNvbHZlVGVuYW50YCk6XG4gICAgICAvLyBwYXNzIGBzdWJzY3JpcHRpb246IHtjaGFubmVsLCBwYXJhbXN9YCBzbyByZXNvbHZlcnMgdGhhdCBkZXJpdmUgc2NvcGUgZnJvbSB0aGVcbiAgICAgIC8vIHN1YnNjcmlwdGlvbiBiZWhhdmUgdGhlIHNhbWUgZm9yIGJyb2FkY2FzdHMgYXMgdGhleSBkaWQgYXQgYGNoYW5uZWwtc3Vic2NyaWJlYC5cbiAgICAgIC8vIFRoZSBzeW50aGV0aWMgcmVxdWVzdCBmb3J3YXJkcyB0aGUgc3Vic2NyaWJlcidzIHBhcmFtcyAoZS5nLiBhdXRoZW50aWNhdGlvblRva2VuKSxcbiAgICAgIC8vIG1hdGNoaW5nIHRoaXMgY2hhbm5lbCdzIGFiaWxpdHkgcmVzb2x1dGlvbiBhYm92ZS5cbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQoe1xuICAgICAgICBwYXJhbXM6IHsuLi50aGlzLnBhcmFtcywgaWQsIG1vZGVsOiB0aGlzLl9tb2RlbE5hbWUoKX0sXG4gICAgICAgIHJlcXVlc3Q6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuX3N5bnRoZXRpY1JlcXVlc3QoKSksXG4gICAgICAgIHJlc3BvbnNlOiBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KSxcbiAgICAgICAgc3Vic2NyaXB0aW9uOiB7Y2hhbm5lbDogRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwgcGFyYW1zOiB0aGlzLnBhcmFtc31cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc3Vic2NyaWJlcidzIHRlbmFudCBmb3IgdGhlIGJyb2FkY2FzdCByZWNvcmQgYW5kIHJ1bnMgYGNhbGxiYWNrYCBpbnNpZGUgdGhhdCB0ZW5hbnRcbiAgICogY29udGV4dC4gQnJvYWRjYXN0IGRlbGl2ZXJ5IHJ1bnMgaW4gd2hhdGV2ZXIgYW1iaWVudCB0ZW5hbnQgY29udGV4dCB0aGUgcHVibGlzaGVyIGxlZnQgYmVoaW5kLiBGb3JcbiAgICogbXVsdGktdGVuYW50IHJlY29yZHMgdGhhdCBhbWJpZW50IHRlbmFudCBtYXkgaGF2ZSBiZWVuIHJlc29sdmVkIHdpdGhvdXQgdGhlIHN1YnNjcmliZXIncyByZXF1ZXN0XG4gICAqIChlLmcuIGEgcmVsYXkgZW5kcG9pbnQgb3IgYmFja2dyb3VuZCBqb2IgbXV0YXRpbmcgdGhlIHJvdyksIHNvIGl0IGxhY2tzIHRoZSBzdWJzY3JpYmVyJ3MgcGVyLXJlY29yZFxuICAgKiBhY2Nlc3MgZmxhZ3MgYW5kIHRoZSBwZXItZXZlbnQgYXV0aG9yaXphdGlvbiBxdWVyeSB3cm9uZ2x5IGZpbmRzIG5vdGhpbmcuIFJlLXJlc29sdmluZyB0aGUgdGVuYW50XG4gICAqIGZyb20gdGhlIGV2ZW50IHJlY29yZCBpZCBwbHVzIHRoZSBzdWJzY3JpYmVyJ3MgcmVxdWVzdCBtYWtlcyB0aGUgYXV0aG9yaXphdGlvbiBxdWVyaWVzIHJ1biBhZ2FpbnN0XG4gICAqIHRoZSBzdWJzY3JpYmVyJ3Mgb3duIHRlbmFudC9hYmlsaXR5IHNjb3BlLiBXaGVuIG5vIHRlbmFudCByZXNvbHZlcyAobm9uLW11bHRpdGVuYW50IGNvbmZpZ3MpLCB0aGVcbiAgICogY2FsbGJhY2sgcnVucyBkaXJlY3RseSBzbyB0aGUgYW1iaWVudCBjb250ZXh0IGlzIHByZXNlcnZlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdXRob3JpemVkLXF1ZXJ5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aEV2ZW50VGVuYW50KGlkLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLnNlc3Npb24uY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uIHx8IHR5cGVvZiBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnQgPSBhd2FpdCB0aGlzLl9yZXNvbHZlRXZlbnRUZW5hbnQoaWQpXG5cbiAgICAvLyBBbHdheXMgZW50ZXIgYHJ1bldpdGhUZW5hbnRgLCBldmVuIHdoZW4gbm8gdGVuYW50IHJlc29sdmVkLiBCcm9hZGNhc3QgZmFuLW91dFxuICAgIC8vIHJ1bnMgaW4gdGhlIHB1Ymxpc2hlcidzIGFtYmllbnQgdGVuYW50IGNvbnRleHQ7IGZhbGxpbmcgYmFjayB0byBgY2FsbGJhY2soKWBcbiAgICAvLyB0aGVyZSB3b3VsZCBhdXRob3JpemUgYSBjcm9zcy10ZW5hbnQgcmVjb3JkIGFnYWluc3QgdGhlIHB1Ymxpc2hlcidzIHRlbmFudCBhbmRcbiAgICAvLyBjb3VsZCBsZWFrIGl0IHRvIGEgc3Vic2NyaWJlciB3aG9zZSBvd24gcmVzb2x2ZXIgY291bGQgbm90IHJlc29sdmUgaXQuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHdlYnNvY2tldCBldmVudCB0ZW5hbnRcIn0sIGNhbGxiYWNrKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gRXZlbnQgZmlsdGVyIGtleXMgbWF0Y2hlZCBieSB0aGUgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgX21hdGNoZWRFdmVudEZpbHRlcktleXNGb3JFdmVudElkKGlkLCBGcm9udGVuZE1vZGVsQ29udHJvbGxlcikge1xuICAgIC8qKlxuICAgICAqIE1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBldmVudEZpbHRlciBvZiB0aGlzLl9ldmVudEZpbHRlcnMoKSkge1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IGF3YWl0IHRoaXMuX2V2ZW50TWF0Y2hlc0ZpbHRlcih7XG4gICAgICAgIEZyb250ZW5kTW9kZWxDb250cm9sbGVyLFxuICAgICAgICBldmVudEZpbHRlcixcbiAgICAgICAgaWRcbiAgICAgIH0pXG5cbiAgICAgIGlmIChtYXRjaGVzKSBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLnB1c2goZXZlbnRGaWx0ZXIua2V5KVxuICAgIH1cblxuICAgIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBtYXRjaGVzIGZpbHRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGaWx0ZXIgYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSBhcmdzLkZyb250ZW5kTW9kZWxDb250cm9sbGVyIC0gU2VydmVyLXNpZGUgZnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeX0gYXJncy5ldmVudEZpbHRlciAtIEV2ZW50IGZpbHRlciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gRXZlbnQgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgcmVjb3JkIG1hdGNoZXMgdGhlIGZpbHRlci5cbiAgICovXG4gIGFzeW5jIF9ldmVudE1hdGNoZXNGaWx0ZXIoe0Zyb250ZW5kTW9kZWxDb250cm9sbGVyLCBldmVudEZpbHRlciwgaWR9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhFdmVudFRlbmFudChpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDb250cm9sbGVyKEZyb250ZW5kTW9kZWxDb250cm9sbGVyLCB7XG4gICAgICAgIGpvaW5zOiBldmVudEZpbHRlci5qb2lucyxcbiAgICAgICAgc2VhcmNoZXM6IGV2ZW50RmlsdGVyLnNlYXJjaGVzLFxuICAgICAgICB3aGVyZTogZXZlbnRGaWx0ZXIud2hlcmVcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgY29uc3Qgd2hlcmUgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxXaGVyZSgpXG4gICAgICBjb25zdCBqb2lucyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbEpvaW5zKClcbiAgICAgIC8vIFN0YXJ0IGZyb20gdGhlIHN1YnNjcmliZXIncyBhdXRob3JpemVkIHNjb3BlIHNvIGEgZmlsdGVyIGNhbiBvbmx5IGV2ZXIgbWF0Y2ggcmVjb3JkcyB0aGVcbiAgICAgIC8vIHN1YnNjcmlwdGlvbidzIGFiaWxpdHkgcGVybWl0cyB0byByZWFkLlxuICAgICAgbGV0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuXG4gICAgICBpZiAod2hlcmUpIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pXG4gICAgICBpZiAoam9pbnMpIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsSm9pbnMoe2pvaW5zLCBxdWVyeX0pXG5cbiAgICAgIGZvciAoY29uc3Qgc2VhcmNoIG9mIGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFNlYXJjaGVzKCkpIHtcbiAgICAgICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9qZWN0ZWQgcmVjb3JkIGZvciBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBFdmVudCByZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgLSBTZXJ2ZXItc2lkZSBmcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4gfCBudWxsPn0gLSBTZXJpYWxpemVkIHByb2plY3RlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfcHJvamVjdGVkUmVjb3JkRm9yRXZlbnRJZChpZCwgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aEV2ZW50VGVuYW50KGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbnRyb2xsZXIoRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgICAgLy8gUmVsb2FkIHRocm91Z2ggdGhlIHN1YnNjcmliZXIncyBhdXRob3JpemVkIHNjb3BlIHNvIHByb2plY3RlZCByZWNvcmRzIGFyZSBvbmx5IGV2ZXIgc2VudCBmb3JcbiAgICAgIC8vIHJvd3MgdGhlIHN1YnNjcmlwdGlvbidzIGFiaWxpdHkgcGVybWl0cyB0byByZWFkLlxuICAgICAgbGV0IHF1ZXJ5ID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KFwiZmluZFwiKS53aGVyZSh7XG4gICAgICAgIFtNb2RlbENsYXNzLnRhYmxlTmFtZSgpXTogZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlEYXRhYmFzZUNvbmRpdGlvbnMoTW9kZWxDbGFzcywgcHJpbWFyeUtleSwgaWQpXG4gICAgICB9KVxuICAgICAgY29uc3QgcHJlbG9hZCA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuXG4gICAgICBpZiAocHJlbG9hZCkgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHByZWxvYWQpXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udHJvbGxlci5mcm9udGVuZE1vZGVsV2l0aENvdW50KCkpIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNwZWMuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59Pn0gKi9cbiAgICAgICAgY29uc3Qgc3BlYyA9IHt9XG5cbiAgICAgICAgc3BlY1tlbnRyeS5hdHRyaWJ1dGVOYW1lXSA9IHtcbiAgICAgICAgICByZWxhdGlvbnNoaXA6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovIChlbnRyeS53aGVyZSkgOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBxdWVyeS53aXRoQ291bnQoc3BlYylcbiAgICAgIH1cblxuICAgICAgY29uc3QgcXVlcnlEYXRhID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUXVlcnlEYXRhKClcblxuICAgICAgaWYgKHF1ZXJ5RGF0YSAhPT0gbnVsbCkgcXVlcnkucXVlcnlEYXRhKHF1ZXJ5RGF0YSlcblxuICAgICAgcXVlcnkgPSBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgICAgaWYgKCFtb2RlbCkgcmV0dXJuIG51bGxcblxuICAgICAgaWYgKHRoaXMucGFyYW1zLmFiaWxpdGllcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbENvbXB1dGVBYmlsaXRpZXMoW21vZGVsXSlcbiAgICAgIH1cblxuICAgICAgY29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHVuZGVmaW5lZFxuXG4gICAgICByZXR1cm4gYXdhaXQgY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnNlcmlhbGl6ZShtb2RlbCwgXCJmaW5kXCIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNaW5pbWFsIFJlcXVlc3QtbGlrZSBzdHViIHVzZWQgb25seSBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLiBBdm9pZHNcbiAgICogaW1wb3J0aW5nIGBXZWJzb2NrZXRSZXF1ZXN0YCBoZXJlIGJlY2F1c2UgaXRzIGBub2RlOnF1ZXJ5c3RyaW5nYFxuICAgKiBkZXBlbmRlbmN5IHdvdWxkIHB1bGwgc2VydmVyLW9ubHkgY29kZSBpbnRvIGJyb3dzZXIgYnVuZGxlcyB2aWFcbiAgICogdGhlIGBjb25maWd1cmF0aW9uIOKGkiBsb2dnZXIg4oaSIHdlYnNvY2tldC1wdWJsaXNoZXJzYCBpbXBvcnQgY2hhaW4uXG4gICAqIEhlYWRlciBuYW1lcyBhcmUgbm9ybWFsaXplZCB0byBsb3dlcmNhc2Ugc28gYGhlYWRlcihcImNvb2tpZVwiKWBcbiAgICogZmluZHMgYSB2YWx1ZSByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhlIHVwZ3JhZGUtcmVxdWVzdCBoZWFkZXJzXG4gICAqIG1hcCB1c2VzIGBcIkNvb2tpZVwiYCBvciBgXCJjb29raWVcImAuIFNlc3Npb24gbWV0YWRhdGEgc3RheXMgc2VwYXJhdGVcbiAgICogZnJvbSBoZWFkZXJzIGFuZCBpcyBleHBvc2VkIHRocm91Z2ggYG1ldGFkYXRhKC4uLilgIGZvciBhYmlsaXR5XG4gICAqIHJlc29sdmVycyB0aGF0IG5lZWQgd2Vic29ja2V0LWRlbGl2ZXJlZCBzZXNzaW9uIGRhdGEuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsV2Vic29ja2V0U3ludGhldGljUmVxdWVzdH0gUmVxdWVzdC1saWtlIG9iamVjdCBmb3IgYWJpbGl0eSByZXNvbHV0aW9uLlxuICAgKi9cbiAgX3N5bnRoZXRpY1JlcXVlc3QoKSB7XG4gICAgY29uc3QgdXBncmFkZVJlcXVlc3QgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxXZWJzb2NrZXRVcGdyYWRlUmVxdWVzdH0gKi8gKHRoaXMuc2Vzc2lvbi51cGdyYWRlUmVxdWVzdClcbiAgICBjb25zdCByYXdIZWFkZXJzID0gdHlwZW9mIHVwZ3JhZGVSZXF1ZXN0Py5oZWFkZXJzID09PSBcImZ1bmN0aW9uXCIgPyB1cGdyYWRlUmVxdWVzdC5oZWFkZXJzKCkgOiB7fVxuICAgIGNvbnN0IG1ldGFkYXRhID0gdHlwZW9mIHRoaXMuc2Vzc2lvbi5nZXRNZXRhZGF0YSA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5zZXNzaW9uLmdldE1ldGFkYXRhKCkgOiB7fVxuICAgIGNvbnN0IHJlbW90ZUFkZHJlc3MgPSB0eXBlb2YgdXBncmFkZVJlcXVlc3Q/LnJlbW90ZUFkZHJlc3MgPT09IFwiZnVuY3Rpb25cIiA/IHVwZ3JhZGVSZXF1ZXN0LnJlbW90ZUFkZHJlc3MoKSA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEhlYWRlciBtYXAuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkPn0gKi9cbiAgICBjb25zdCBoZWFkZXJNYXAgPSB7fVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmF3SGVhZGVycyB8fCB7fSkpIHtcbiAgICAgIGhlYWRlck1hcFtrZXkudG9Mb3dlckNhc2UoKV0gPSByYXdIZWFkZXJzW2tleV1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaGVhZGVyczogKCkgPT4gaGVhZGVyTWFwLFxuICAgICAgaGVhZGVyOiAobmFtZSkgPT4gaGVhZGVyTWFwW1N0cmluZyhuYW1lKS50b0xvd2VyQ2FzZSgpXSxcbiAgICAgIG1ldGFkYXRhOiAoa2V5KSA9PiBrZXkgPT09IHVuZGVmaW5lZCA/IHsuLi5tZXRhZGF0YX0gOiBtZXRhZGF0YVtrZXldLFxuICAgICAgcGF0aDogKCkgPT4gXCIvZnJvbnRlbmQtbW9kZWxzXCIsXG4gICAgICBodHRwTWV0aG9kOiAoKSA9PiBcIlBPU1RcIixcbiAgICAgIHJlbW90ZUFkZHJlc3M6ICgpID0+IHJlbW90ZUFkZHJlc3MsXG4gICAgICBvcmlnaW46ICgpID0+IGhlYWRlck1hcC5vcmlnaW5cbiAgICB9XG4gIH1cbn1cbiJdfQ==