// @ts-check
import Configuration from "../configuration.js";
import Logger from "../logger.js";
import { scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
import restArgsError from "../utils/rest-args-error.js";
import { declaredSyncScopeAttributes } from "./sync-scope-attributes.js";
import { deliverDeclaredBroadcasts, upsertSyncRow } from "./sync-change-fanout.js";
import { isPublishingSuppressed } from "./sync-publish-suppression.js";
import { VELOCIOUS_SYNC_CHANNEL } from "./sync-channel-name.js";
/** @type {{create: "afterCreate", update: "afterUpdate", destroy: "afterDestroy"}} */
const PUBLISHED_CALLBACK_NAMES = { create: "afterCreate", destroy: "afterDestroy", update: "afterUpdate" };
/**
 * Operations published by default for models declaring `static sync` publish
 * without an `operations` key: server-side creates and updates publish
 * automatically. Destroys are not published by default because a server
 * destroy is often cleanup rather than a synced delete; opt in with an
 * operations list.
 * @type {Array<"create" | "update" | "destroy">} */
const DEFAULT_PUBLISHED_OPERATIONS = ["create", "update"];
/** @type {WeakMap<Configuration, SyncPublisher>} */
const startedPublishersByConfiguration = new WeakMap();
/**
 * Declarative server-side sync publisher — the server mirror of the client's
 * track-by-default mutation tracking.
 *
 * Server models declare what to publish through `static sync`'s `publish`
 * key, and Velocious writes every committed server-side change to the sync
 * change feed (model-backed Sync-row upsert with server re-sequencing) and
 * broadcasts the standard sync envelope (`{echoOrigin, syncs: [...]}`) on the
 * framework sync channel ({@link VELOCIOUS_SYNC_CHANNEL}) scoped by the
 * change's derived scope-partition values, so devices receive server-origin
 * changes without app code declaring channels or calling manual
 * upsert/broadcast helpers:
 *
 *     static sync = {publish: true} // default payload (attributes) + default scope partition
 *     static sync = {publish: {serialize: (record) => ({id: record.id(), pin: record.pin()})}}
 *
 * The scope partition comes from the sync model's `static
 * syncScopeAttributes` declaration (for example `["eventId"]` or
 * `["accountId"]` — Velocious has no built-in partition name): each declared
 * scope attribute reads the record's attribute of the same name when the
 * model has one, else the record's own id (scope-root models), overridable
 * per model through `publish: {scopeAttributes: {accountId: "ownerId"}}`.
 * The pre-framework-channel `broadcasts` list and the `eventId`
 * string/resolver-function declaration forms keep working but are deprecated.
 *
 * Replayed device mutations never double-publish: the framework's routed
 * replay apply marks its written records through `markServerApply(record)`
 * (see sync-publish-suppression.js), and app code applying already-synced
 * data can use `markServerApply`/`withoutPublishing` the same way.
 */
export default class SyncPublisher {
    /**
     * Builds the sync publisher by deriving published resources from the
     * configuration's registered models: every model declaring `static sync`
     * with a `publish` declaration becomes a published resource
     * (`publish: false` opts out). The sync/change model is the registered
     * "Sync" model and broadcasts default to the configuration's channel
     * broadcast.
     * @param {import("./sync-publisher-types.js").SyncPublisherOptions} [options] - Optional overrides.
     */
    constructor(options = {}) {
        const { actorForeignKeyColumn = "authentication_token_id", broadcaster, configuration = Configuration.current(), onError, syncModel, ...restOptions } = options;
        restArgsError(restOptions);
        const modelClasses = configuration.getModelClasses();
        const publishingModelClasses = Object.values(modelClasses).filter((modelClass) => publishDeclarationFor(modelClass));
        if (publishingModelClasses.length === 0) {
            throw new Error("SyncPublisher found no registered models declaring static sync publish - declare `static sync = {publish: {serialize}}` on the models whose server-side changes should publish to the sync feed");
        }
        const resolvedSyncModel = syncModel || modelClasses.Sync;
        if (!resolvedSyncModel) {
            throw new Error("SyncPublisher requires a registered \"Sync\" model for published sync change rows (or pass options.syncModel)");
        }
        const scopeAttributes = declaredSyncScopeAttributes(resolvedSyncModel);
        /** @type {Record<string, import("./sync-publisher-types.js").SyncPublisherResourceConfig>} */
        const resources = {};
        for (const modelClass of publishingModelClasses) {
            const publish = publishDeclarationFor(modelClass);
            const resourceConfig = resourceConfigFromPublishDeclaration({ modelClass, publish, scopeAttributes, syncModel: resolvedSyncModel });
            resources[resourceConfig.resourceType] = resourceConfig;
        }
        /** @type {{actorForeignKeyColumn: string, broadcaster: import("./sync-publisher-types.js").SyncPublisherOptions["broadcaster"], configuration: Configuration, onError: import("./sync-publisher-types.js").SyncPublisherOptions["onError"], resources: Record<string, import("./sync-publisher-types.js").SyncPublisherResourceConfig>, syncModel: ReturnType<typeof JSON.parse>}} */
        this.config = { actorForeignKeyColumn, broadcaster, configuration, onError, resources, syncModel: resolvedSyncModel };
        /** @type {Array<{callback: (record: ReturnType<typeof JSON.parse>) => Promise<void>, callbackName: "afterCreate" | "afterUpdate" | "afterDestroy", modelClass: ReturnType<typeof JSON.parse>}>} */
        this._publishedCallbacks = [];
        /** @type {Logger | null} */
        this._logger = null;
        this._started = false;
    }
    /**
     * Builds a sync publisher derived from the given configuration. Alias for
     * `new SyncPublisher({configuration, ...options})`.
     * @param {Configuration} [configuration] - Configuration owning the registered models. Defaults to the current configuration.
     * @param {Omit<import("./sync-publisher-types.js").SyncPublisherOptions, "configuration">} [options] - Optional overrides.
     * @returns {SyncPublisher} Sync publisher derived from the configuration.
     */
    static fromConfiguration(configuration = Configuration.current(), options = {}) {
        return new SyncPublisher({ ...options, configuration });
    }
    /**
     * Starts (and memoizes per configuration) the sync publisher for a server
     * boot: no-op when no registered model declares a publish config, guarded so
     * repeated boots with the same configuration register the publish callbacks
     * only once.
     * @param {Configuration} configuration - Configuration owning the registered models.
     * @returns {Promise<SyncPublisher | null>} Started publisher, or null when no models declare publish.
     */
    static async startFromConfiguration(configuration) {
        const startedPublisher = startedPublishersByConfiguration.get(configuration);
        if (startedPublisher)
            return startedPublisher;
        if (!Object.values(configuration.getModelClasses()).some((modelClass) => publishDeclarationFor(modelClass)))
            return null;
        const publisher = new SyncPublisher({ configuration });
        startedPublishersByConfiguration.set(configuration, publisher);
        await publisher.start();
        return publisher;
    }
    /**
     * Registers the publish callbacks for every published resource: server-side
     * creates and updates (destroys when opted in) upsert a sync change row and
     * fan out the declared broadcasts once their transaction commits.
     * @returns {Promise<void>}
     */
    async start() {
        if (this._started)
            return;
        this._started = true;
        for (const resourceConfig of Object.values(this.config.resources)) {
            for (const operation of resourceConfig.operations) {
                const callbackName = PUBLISHED_CALLBACK_NAMES[operation];
                const callback = this.publishedMutationCallback({ operation, resourceConfig });
                resourceConfig.modelClass[callbackName](callback);
                this._publishedCallbacks.push({ callback, callbackName, modelClass: resourceConfig.modelClass });
            }
        }
    }
    /**
     * Unregisters all publish callbacks (tests, shutdown).
     * @returns {void}
     */
    stop() {
        for (const { callback, callbackName, modelClass } of this._publishedCallbacks) {
            modelClass.unregisterLifecycleCallback(callbackName, callback);
        }
        this._publishedCallbacks = [];
        this._started = false;
    }
    /**
     * Builds the lifecycle callback publishing one server-side mutation. The
     * published payload (declaration `serialize`), event scope, and sync type
     * are snapshotted at mutation-callback time, so afterSave hooks assigning
     * unsaved attributes (or any later drift on the record) cannot change what
     * gets published vs what was committed. Persisting and broadcasting are
     * deferred through the model connection's afterCommit hook so they only run
     * once the mutation's transaction has committed (immediately when no
     * transaction is open) - rolled-back mutations never publish. Post-commit
     * publish failures are reported without rethrowing into the driver's
     * afterCommit chain (see reportAfterCommitError).
     * @param {{operation: "create" | "update" | "destroy", resourceConfig: import("./sync-publisher-types.js").SyncPublisherResourceConfig}} args - Operation and resource config.
     * @returns {(record: ReturnType<typeof JSON.parse>) => Promise<void>} Lifecycle callback.
     */
    publishedMutationCallback({ operation, resourceConfig }) {
        return async (record) => {
            if (isPublishingSuppressed(record))
                return;
            const data = await resourceConfig.serialize(record);
            const resourceId = String(scalarModelPrimaryKeyValue(record.id(), `Sync publishing for ${resourceConfig.resourceType}`));
            const syncType = operation === "destroy" ? "delete" : "update";
            const scopeValues = await this.publishedScopeValues({ record, resourceConfig });
            /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const attributes = {
                [this.config.actorForeignKeyColumn]: null,
                client_updated_at: new Date(),
                data: JSON.stringify(data),
                resource_id: resourceId,
                resource_type: resourceConfig.resourceType,
                sync_type: syncType,
                ...scopeValues.columns
            };
            const databaseOperation = record.databaseOperation();
            const operationScope = databaseOperation
                ? databaseOperation.forModel(this.config.syncModel)
                : this.config.syncModel;
            await record.connection().afterCommit(async () => {
                try {
                    const syncRow = await this.upsertPublishedSyncRow(attributes, operationScope);
                    await this.broadcaster()({
                        body: {
                            echoOrigin: null,
                            syncs: [this.publishedSyncEntry({ data, resourceConfig, resourceId, syncRow, syncType })]
                        },
                        channel: VELOCIOUS_SYNC_CHANNEL,
                        params: { ...scopeValues.params, resourceType: resourceConfig.resourceType }
                    });
                    if (resourceConfig.broadcasts) {
                        await deliverDeclaredBroadcasts({
                            args: { data, operation, record, resourceId, resourceType: resourceConfig.resourceType, syncRow, syncType },
                            broadcaster: this.broadcaster(),
                            broadcasts: resourceConfig.broadcasts
                        });
                    }
                }
                catch (error) {
                    await this.reportAfterCommitError(/** @type {Error} */ (error));
                }
            });
        };
    }
    /**
     * Resolves the scope-partition values for one published mutation from the
     * resource's derived scope plan: each entry reads its record attribute (or
     * the record's own id for scope-root models, or the deprecated resolver
     * function). The values are persisted onto the sync row's partition columns
     * and broadcast as the framework sync channel's scoping params.
     * @param {{record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-publisher-types.js").SyncPublisherResourceConfig}} args - Mutated record and resource config.
     * @returns {Promise<{columns: Record<string, string | null>, params: Record<string, string | null>}>} Scope values keyed by sync-row column and by scope attribute.
     */
    async publishedScopeValues({ record, resourceConfig }) {
        /** @type {Record<string, string | null>} */
        const columns = {};
        /** @type {Record<string, string | null>} */
        const params = {};
        for (const scopePlanEntry of resourceConfig.scopePlan) {
            /** @type {ReturnType<typeof JSON.parse>} */
            let rawValue;
            if (scopePlanEntry.resolver) {
                rawValue = await scopePlanEntry.resolver(record);
            }
            else if (scopePlanEntry.recordAttribute) {
                rawValue = record.readAttribute(scopePlanEntry.recordAttribute);
            }
            else {
                rawValue = scalarModelPrimaryKeyValue(record.id(), `Sync scope publishing for ${resourceConfig.resourceType}`);
            }
            const value = rawValue === undefined || rawValue === null ? null : String(rawValue);
            columns[scopePlanEntry.columnName] = value;
            params[scopePlanEntry.scopeAttribute] = value;
        }
        return { columns, params };
    }
    /**
     * Builds the framework sync channel entry for one published change: the
     * snapshotted payload plus the persisted sync row's public exact-row metadata
     * (id, server sequence, updated-at, and declared scope-partition attributes).
     * Uses the sync model's generated typed accessors and follows the
     * change-feed serializer's public field convention.
     * @param {{data: Record<string, ReturnType<typeof JSON.parse>>, resourceConfig: import("./sync-publisher-types.js").SyncPublisherResourceConfig, resourceId: string, syncRow: ReturnType<typeof JSON.parse>, syncType: string}} args - Publish args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Broadcast sync entry.
     */
    publishedSyncEntry({ data, resourceConfig, resourceId, syncRow, syncType }) {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const entry = {
            data,
            id: syncRow.id(),
            resourceId,
            resourceType: resourceConfig.resourceType,
            serverSequence: syncRow.serverSequence(),
            syncType,
            updatedAt: isoDate(syncRow.updatedAt())
        };
        const scopeAttributes = declaredSyncScopeAttributes(this.config.syncModel);
        for (const scopeAttribute of scopeAttributes || []) {
            const scopeAccessor = syncRow[scopeAttribute];
            if (typeof scopeAccessor !== "function") {
                throw new Error(`Published sync row is missing the declared scope accessor ${scopeAttribute}().`);
            }
            entry[scopeAttribute] = scopeAccessor.call(syncRow);
        }
        return entry;
    }
    /**
     * Upserts the published server-origin sync row for a resource identity:
     * server-origin rows carry a null actor column (no device to echo the
     * change back to), so repeated server changes to one resource reuse and
     * re-sequence one feed row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Snapshotted sync row attributes.
     * @param {ReturnType<typeof JSON.parse>} syncModel - Operation-bound or static Sync model interface.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Upserted sync row.
     */
    async upsertPublishedSyncRow(attributes, syncModel = this.config.syncModel) {
        const existingSync = await syncModel
            .where({
            [this.config.actorForeignKeyColumn]: null,
            resource_id: attributes.resource_id,
            resource_type: attributes.resource_type
        })
            .first();
        return await upsertSyncRow({ attributes, existingSync, syncModel });
    }
    /**
     * Returns the broadcaster delivering declared broadcasts: the injected one,
     * or the configuration's channel broadcast awaited through the pending
     * broadcast queue.
     * @returns {NonNullable<import("./sync-publisher-types.js").SyncPublisherOptions["broadcaster"]>} Broadcast deliverer.
     */
    broadcaster() {
        if (this.config.broadcaster)
            return this.config.broadcaster;
        return async ({ body, channel, params }) => {
            this.config.configuration.broadcastToChannel(channel, params, body);
            await this.config.configuration.awaitPendingBroadcasts();
        };
    }
    /**
     * Reports a post-commit publish failure. The transaction has already
     * committed when afterCommit callbacks run, so rethrowing here would poison
     * the driver's awaited afterCommit chain (breaking unrelated callbacks) -
     * instead the failure goes to the configured onError hook, or is emitted on
     * the configuration's framework-error/all-error channels (so production bug
     * reporting via `configuration.getErrorEvents()` sees a broken publish
     * path) and logged loudly through the publisher's logger when none is
     * configured.
     * @param {Error} error - Post-commit publish failure.
     * @returns {Promise<void>}
     */
    async reportAfterCommitError(error) {
        if (this.config.onError) {
            this.config.onError(error);
            return;
        }
        const errorEvents = this.config.configuration.getErrorEvents();
        const payload = { context: { stage: "sync-publish-after-commit" }, error };
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
        await this.logger().error("SyncPublisher failed to publish a server-side sync change after commit", error);
    }
    /**
     * Returns the lazily built publisher logger.
     * @returns {Logger} Publisher logger.
     */
    logger() {
        this._logger ||= new Logger("SyncPublisher", { configuration: this.config.configuration });
        return this._logger;
    }
}
/**
 * Resolves a model class's active publish declaration from `static sync`.
 * Opted-out (`publish: false`) and undeclared models resolve to null; every
 * other declared value flows into loud declaration validation.
 * @param {ReturnType<typeof JSON.parse>} modelClass - Registered model class.
 * @returns {import("./sync-publisher-types.js").SyncPublishDeclaration | null} Active publish declaration, or null.
 */
function publishDeclarationFor(modelClass) {
    const declaration = modelClass.sync;
    if (!declaration || typeof declaration !== "object" || declaration.publish === undefined || declaration.publish === false)
        return null;
    return declaration.publish;
}
/**
 * Builds one published resource config from a model's `static sync` publish
 * declaration. `publish: true` opts in with all defaults (attribute payload,
 * derived scope partition, created/updated operations).
 * @param {{modelClass: ReturnType<typeof JSON.parse>, publish: import("./sync-publisher-types.js").SyncPublishDeclaration | null, scopeAttributes: string[] | null, syncModel: ReturnType<typeof JSON.parse>}} args - Declaration args plus the sync model's declared scope attributes.
 * @returns {import("./sync-publisher-types.js").SyncPublisherResourceConfig} Derived resource config.
 */
function resourceConfigFromPublishDeclaration({ modelClass, publish, scopeAttributes: syncScopeAttributes, syncModel }) {
    const modelName = modelClass.getModelName();
    const normalizedPublish = publish === true ? {} : publish;
    if (!normalizedPublish || typeof normalizedPublish !== "object" || Array.isArray(normalizedPublish)) {
        throw new Error(`${modelName} static sync publish must be true, false or a publish declaration object, got: ${String(publish)}`);
    }
    const { broadcasts, eventId, operations, resourceType, scopeAttributes, serialize, ...restDeclaration } = normalizedPublish;
    const unknownKeys = Object.keys(restDeclaration);
    if (unknownKeys.length > 0) {
        throw new Error(`${modelName} static sync publish received unknown keys: ${unknownKeys.join(", ")} (supported: broadcasts, eventId (deprecated), operations, resourceType, scopeAttributes, serialize)`);
    }
    if (serialize !== undefined && typeof serialize !== "function") {
        throw new Error(`${modelName} static sync publish serialize must be a function building the published payload, got: ${String(serialize)}`);
    }
    if (operations !== undefined) {
        if (!Array.isArray(operations) || operations.length === 0) {
            throw new Error(`${modelName} static sync publish operations must be a non-empty array of create/update/destroy`);
        }
        for (const operation of operations) {
            if (!(operation in PUBLISHED_CALLBACK_NAMES)) {
                throw new Error(`${modelName} static sync publish operations must be create/update/destroy, got: ${String(operation)}`);
            }
        }
    }
    return {
        broadcasts,
        modelClass,
        operations: operations === undefined ? DEFAULT_PUBLISHED_OPERATIONS : operations,
        resourceType: resourceType === undefined ? modelName : resourceType,
        scopePlan: scopePlanFor({ eventId, modelClass, modelName, scopeAttributes, syncModel, syncScopeAttributes }),
        serialize: serialize === undefined ? defaultSerializedAttributes : serialize
    };
}
/**
 * Derives the scope plan partitioning a published model's changes: one entry
 * per scope attribute declared on the sync model (`static
 * syncScopeAttributes`), each reading the record attribute named like the
 * scope attribute (overridable through the declaration's `scopeAttributes`
 * name map), or the record's own id when the model has no such attribute
 * (scope-root models). The deprecated `eventId` declaration forms map to a
 * fixed `eventId`/`event_id` plan for 1.0.503 compatibility.
 * @param {{eventId: import("./sync-publisher-types.js").SyncPublishDeclarationConfig["eventId"], modelClass: ReturnType<typeof JSON.parse>, modelName: string, scopeAttributes: Record<string, string> | undefined, syncModel: ReturnType<typeof JSON.parse>, syncScopeAttributes: string[] | null}} args - Declaration and sync-model scope args.
 * @returns {Array<import("./sync-publisher-types.js").SyncPublisherScopePlanEntry>} Derived scope plan.
 */
function scopePlanFor({ eventId, modelClass, modelName, scopeAttributes, syncModel, syncScopeAttributes }) {
    const attributeNames = Object.values(modelClass.getColumnNameToAttributeNameMap());
    if (eventId !== undefined) {
        if (scopeAttributes !== undefined) {
            throw new Error(`${modelName} static sync publish can't declare both scopeAttributes and the deprecated eventId form`);
        }
        if (typeof eventId === "function") {
            return [{ columnName: "event_id", recordAttribute: null, resolver: eventId, scopeAttribute: "eventId" }];
        }
        if (typeof eventId !== "string") {
            throw new Error(`${modelName} static sync publish eventId must be an attribute-name string (or a deprecated resolver function), got: ${String(eventId)}`);
        }
        if (!attributeNames.includes(eventId)) {
            throw new Error(`${modelName} static sync publish eventId attribute doesn't exist on the model: ${eventId}`);
        }
        return [{ columnName: "event_id", recordAttribute: eventId, resolver: undefined, scopeAttribute: "eventId" }];
    }
    if (scopeAttributes !== undefined && !syncScopeAttributes) {
        throw new Error(`${modelName} static sync publish declares scopeAttributes but the sync model declares no static syncScopeAttributes`);
    }
    if (!syncScopeAttributes)
        return [];
    if (scopeAttributes !== undefined && (typeof scopeAttributes !== "object" || Array.isArray(scopeAttributes))) {
        throw new Error(`${modelName} static sync publish scopeAttributes must be an object mapping scope attributes to record attribute names, got: ${String(scopeAttributes)}`);
    }
    for (const scopeAttribute of Object.keys(scopeAttributes || {})) {
        if (!syncScopeAttributes.includes(scopeAttribute)) {
            throw new Error(`${modelName} static sync publish scopeAttributes received unknown scope attribute: ${scopeAttribute} (the sync model declares: ${syncScopeAttributes.join(", ")})`);
        }
    }
    return syncScopeAttributes.map((scopeAttribute) => {
        const declaredRecordAttribute = scopeAttributes?.[scopeAttribute];
        if (declaredRecordAttribute !== undefined) {
            if (typeof declaredRecordAttribute !== "string" || !attributeNames.includes(declaredRecordAttribute)) {
                throw new Error(`${modelName} static sync publish scopeAttributes.${scopeAttribute} must name an existing record attribute, got: ${String(declaredRecordAttribute)}`);
            }
            return { columnName: syncScopeColumnName({ scopeAttribute, syncModel }), recordAttribute: declaredRecordAttribute, resolver: undefined, scopeAttribute };
        }
        return {
            columnName: syncScopeColumnName({ scopeAttribute, syncModel }),
            recordAttribute: attributeNames.includes(scopeAttribute) ? scopeAttribute : null,
            resolver: undefined,
            scopeAttribute
        };
    });
}
/**
 * Resolves the sync-row column persisting a declared scope attribute.
 * @param {{scopeAttribute: string, syncModel: ReturnType<typeof JSON.parse>}} args - Scope attribute and sync model.
 * @returns {string} Sync-row column name.
 */
function syncScopeColumnName({ scopeAttribute, syncModel }) {
    const columnName = syncModel.getAttributeNameToColumnNameMap()[scopeAttribute];
    if (!columnName) {
        throw new Error(`${syncModel.name} declares the sync scope attribute ${scopeAttribute} but has no matching column for it`);
    }
    return columnName;
}
/**
 * Default publish serializer: the record's attributes with Date values
 * serialized to ISO strings.
 * @param {ReturnType<typeof JSON.parse>} record - Mutated server model record.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} Serialized attributes payload.
 */
function defaultSerializedAttributes(record) {
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const attributes = { ...record.attributes() };
    for (const [attributeName, value] of Object.entries(attributes)) {
        if (value instanceof Date)
            attributes[attributeName] = value.toISOString();
    }
    return attributes;
}
/**
 * Converts a date-like value to an ISO string, matching the change-feed
 * serializer's convention for the sync entry's public updated-at metadata.
 * @param {Date | null} value - Persisted updated-at value.
 * @returns {string} ISO date.
 * @throws {Error} When the persisted row has no valid updated-at timestamp.
 */
function isoDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new Error("Published sync row must have a valid updatedAt timestamp.");
    }
    return value.toISOString();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1wdWJsaXNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXB1Ymxpc2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3hFLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE9BQU8sRUFBQywyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3RFLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU3RCxzRkFBc0Y7QUFDdEYsTUFBTSx3QkFBd0IsR0FBRyxFQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFDLENBQUE7QUFFeEc7Ozs7OztvREFNb0Q7QUFDcEQsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV6RCxvREFBb0Q7QUFDcEQsTUFBTSxnQ0FBZ0MsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXREOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7T0FRRztJQUNILFlBQVksT0FBTyxHQUFHLEVBQUU7UUFDdEIsTUFBTSxFQUFDLHFCQUFxQixHQUFHLHlCQUF5QixFQUFFLFdBQVcsRUFBRSxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxFQUFF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U0FBUywyQkFBMkIsQ0FBQyxNQUFNO0lBQ3pDLDREQUE0RDtJQUM1RCxNQUFNLFVBQVUsR0FBRyxFQUFDLEdBQUcsTUFBTSxDQUFDLFVBQVUsRUFBRSxFQUFDLENBQUE7SUFFM0MsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUNoRSxJQUFJLEtBQUssWUFBWSxJQUFJO1lBQUUsVUFBVSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtJQUM1RSxDQUFDO0lBRUQsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsT0FBTyxDQUFDLEtBQUs7SUFDcEIsSUFBSSxDQUFDLENBQUMsS0FBSyxZQUFZLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQztRQUM5RCxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUE7SUFDOUUsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO0FBQzVCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuaW1wb3J0IHtkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXN9IGZyb20gXCIuL3N5bmMtc2NvcGUtYXR0cmlidXRlcy5qc1wiXG5pbXBvcnQge2RlbGl2ZXJEZWNsYXJlZEJyb2FkY2FzdHMsIHVwc2VydFN5bmNSb3d9IGZyb20gXCIuL3N5bmMtY2hhbmdlLWZhbm91dC5qc1wiXG5pbXBvcnQge2lzUHVibGlzaGluZ1N1cHByZXNzZWR9IGZyb20gXCIuL3N5bmMtcHVibGlzaC1zdXBwcmVzc2lvbi5qc1wiXG5pbXBvcnQge1ZFTE9DSU9VU19TWU5DX0NIQU5ORUx9IGZyb20gXCIuL3N5bmMtY2hhbm5lbC1uYW1lLmpzXCJcblxuLyoqIEB0eXBlIHt7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwifX0gKi9cbmNvbnN0IFBVQkxJU0hFRF9DQUxMQkFDS19OQU1FUyA9IHtjcmVhdGU6IFwiYWZ0ZXJDcmVhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIiwgdXBkYXRlOiBcImFmdGVyVXBkYXRlXCJ9XG5cbi8qKlxuICogT3BlcmF0aW9ucyBwdWJsaXNoZWQgYnkgZGVmYXVsdCBmb3IgbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHB1Ymxpc2hcbiAqIHdpdGhvdXQgYW4gYG9wZXJhdGlvbnNgIGtleTogc2VydmVyLXNpZGUgY3JlYXRlcyBhbmQgdXBkYXRlcyBwdWJsaXNoXG4gKiBhdXRvbWF0aWNhbGx5LiBEZXN0cm95cyBhcmUgbm90IHB1Ymxpc2hlZCBieSBkZWZhdWx0IGJlY2F1c2UgYSBzZXJ2ZXJcbiAqIGRlc3Ryb3kgaXMgb2Z0ZW4gY2xlYW51cCByYXRoZXIgdGhhbiBhIHN5bmNlZCBkZWxldGU7IG9wdCBpbiB3aXRoIGFuXG4gKiBvcGVyYXRpb25zIGxpc3QuXG4gKiBAdHlwZSB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59ICovXG5jb25zdCBERUZBVUxUX1BVQkxJU0hFRF9PUEVSQVRJT05TID0gW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxDb25maWd1cmF0aW9uLCBTeW5jUHVibGlzaGVyPn0gKi9cbmNvbnN0IHN0YXJ0ZWRQdWJsaXNoZXJzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIERlY2xhcmF0aXZlIHNlcnZlci1zaWRlIHN5bmMgcHVibGlzaGVyIOKAlCB0aGUgc2VydmVyIG1pcnJvciBvZiB0aGUgY2xpZW50J3NcbiAqIHRyYWNrLWJ5LWRlZmF1bHQgbXV0YXRpb24gdHJhY2tpbmcuXG4gKlxuICogU2VydmVyIG1vZGVscyBkZWNsYXJlIHdoYXQgdG8gcHVibGlzaCB0aHJvdWdoIGBzdGF0aWMgc3luY2AncyBgcHVibGlzaGBcbiAqIGtleSwgYW5kIFZlbG9jaW91cyB3cml0ZXMgZXZlcnkgY29tbWl0dGVkIHNlcnZlci1zaWRlIGNoYW5nZSB0byB0aGUgc3luY1xuICogY2hhbmdlIGZlZWQgKG1vZGVsLWJhY2tlZCBTeW5jLXJvdyB1cHNlcnQgd2l0aCBzZXJ2ZXIgcmUtc2VxdWVuY2luZykgYW5kXG4gKiBicm9hZGNhc3RzIHRoZSBzdGFuZGFyZCBzeW5jIGVudmVsb3BlIChge2VjaG9PcmlnaW4sIHN5bmNzOiBbLi4uXX1gKSBvbiB0aGVcbiAqIGZyYW1ld29yayBzeW5jIGNoYW5uZWwgKHtAbGluayBWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSkgc2NvcGVkIGJ5IHRoZVxuICogY2hhbmdlJ3MgZGVyaXZlZCBzY29wZS1wYXJ0aXRpb24gdmFsdWVzLCBzbyBkZXZpY2VzIHJlY2VpdmUgc2VydmVyLW9yaWdpblxuICogY2hhbmdlcyB3aXRob3V0IGFwcCBjb2RlIGRlY2xhcmluZyBjaGFubmVscyBvciBjYWxsaW5nIG1hbnVhbFxuICogdXBzZXJ0L2Jyb2FkY2FzdCBoZWxwZXJzOlxuICpcbiAqICAgICBzdGF0aWMgc3luYyA9IHtwdWJsaXNoOiB0cnVlfSAvLyBkZWZhdWx0IHBheWxvYWQgKGF0dHJpYnV0ZXMpICsgZGVmYXVsdCBzY29wZSBwYXJ0aXRpb25cbiAqICAgICBzdGF0aWMgc3luYyA9IHtwdWJsaXNoOiB7c2VyaWFsaXplOiAocmVjb3JkKSA9PiAoe2lkOiByZWNvcmQuaWQoKSwgcGluOiByZWNvcmQucGluKCl9KX19XG4gKlxuICogVGhlIHNjb3BlIHBhcnRpdGlvbiBjb21lcyBmcm9tIHRoZSBzeW5jIG1vZGVsJ3MgYHN0YXRpY1xuICogc3luY1Njb3BlQXR0cmlidXRlc2AgZGVjbGFyYXRpb24gKGZvciBleGFtcGxlIGBbXCJldmVudElkXCJdYCBvclxuICogYFtcImFjY291bnRJZFwiXWAg4oCUIFZlbG9jaW91cyBoYXMgbm8gYnVpbHQtaW4gcGFydGl0aW9uIG5hbWUpOiBlYWNoIGRlY2xhcmVkXG4gKiBzY29wZSBhdHRyaWJ1dGUgcmVhZHMgdGhlIHJlY29yZCdzIGF0dHJpYnV0ZSBvZiB0aGUgc2FtZSBuYW1lIHdoZW4gdGhlXG4gKiBtb2RlbCBoYXMgb25lLCBlbHNlIHRoZSByZWNvcmQncyBvd24gaWQgKHNjb3BlLXJvb3QgbW9kZWxzKSwgb3ZlcnJpZGFibGVcbiAqIHBlciBtb2RlbCB0aHJvdWdoIGBwdWJsaXNoOiB7c2NvcGVBdHRyaWJ1dGVzOiB7YWNjb3VudElkOiBcIm93bmVySWRcIn19YC5cbiAqIFRoZSBwcmUtZnJhbWV3b3JrLWNoYW5uZWwgYGJyb2FkY2FzdHNgIGxpc3QgYW5kIHRoZSBgZXZlbnRJZGBcbiAqIHN0cmluZy9yZXNvbHZlci1mdW5jdGlvbiBkZWNsYXJhdGlvbiBmb3JtcyBrZWVwIHdvcmtpbmcgYnV0IGFyZSBkZXByZWNhdGVkLlxuICpcbiAqIFJlcGxheWVkIGRldmljZSBtdXRhdGlvbnMgbmV2ZXIgZG91YmxlLXB1Ymxpc2g6IHRoZSBmcmFtZXdvcmsncyByb3V0ZWRcbiAqIHJlcGxheSBhcHBseSBtYXJrcyBpdHMgd3JpdHRlbiByZWNvcmRzIHRocm91Z2ggYG1hcmtTZXJ2ZXJBcHBseShyZWNvcmQpYFxuICogKHNlZSBzeW5jLXB1Ymxpc2gtc3VwcHJlc3Npb24uanMpLCBhbmQgYXBwIGNvZGUgYXBwbHlpbmcgYWxyZWFkeS1zeW5jZWRcbiAqIGRhdGEgY2FuIHVzZSBgbWFya1NlcnZlckFwcGx5YC9gd2l0aG91dFB1Ymxpc2hpbmdgIHRoZSBzYW1lIHdheS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY1B1Ymxpc2hlciB7XG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMgcHVibGlzaGVyIGJ5IGRlcml2aW5nIHB1Ymxpc2hlZCByZXNvdXJjZXMgZnJvbSB0aGVcbiAgICogY29uZmlndXJhdGlvbidzIHJlZ2lzdGVyZWQgbW9kZWxzOiBldmVyeSBtb2RlbCBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYFxuICAgKiB3aXRoIGEgYHB1Ymxpc2hgIGRlY2xhcmF0aW9uIGJlY29tZXMgYSBwdWJsaXNoZWQgcmVzb3VyY2VcbiAgICogKGBwdWJsaXNoOiBmYWxzZWAgb3B0cyBvdXQpLiBUaGUgc3luYy9jaGFuZ2UgbW9kZWwgaXMgdGhlIHJlZ2lzdGVyZWRcbiAgICogXCJTeW5jXCIgbW9kZWwgYW5kIGJyb2FkY2FzdHMgZGVmYXVsdCB0byB0aGUgY29uZmlndXJhdGlvbidzIGNoYW5uZWxcbiAgICogYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnN9IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHthY3RvckZvcmVpZ25LZXlDb2x1bW4gPSBcImF1dGhlbnRpY2F0aW9uX3Rva2VuX2lkXCIsIGJyb2FkY2FzdGVyLCBjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9uRXJyb3IsIHN5bmNNb2RlbCwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0T3B0aW9ucylcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCBwdWJsaXNoaW5nTW9kZWxDbGFzc2VzID0gT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzZXMpLmZpbHRlcigobW9kZWxDbGFzcykgPT4gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpKVxuXG4gICAgaWYgKHB1Ymxpc2hpbmdNb2RlbENsYXNzZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jUHVibGlzaGVyIGZvdW5kIG5vIHJlZ2lzdGVyZWQgbW9kZWxzIGRlY2xhcmluZyBzdGF0aWMgc3luYyBwdWJsaXNoIC0gZGVjbGFyZSBgc3RhdGljIHN5bmMgPSB7cHVibGlzaDoge3NlcmlhbGl6ZX19YCBvbiB0aGUgbW9kZWxzIHdob3NlIHNlcnZlci1zaWRlIGNoYW5nZXMgc2hvdWxkIHB1Ymxpc2ggdG8gdGhlIHN5bmMgZmVlZFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkU3luY01vZGVsID0gc3luY01vZGVsIHx8IG1vZGVsQ2xhc3Nlcy5TeW5jXG5cbiAgICBpZiAoIXJlc29sdmVkU3luY01vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jUHVibGlzaGVyIHJlcXVpcmVzIGEgcmVnaXN0ZXJlZCBcXFwiU3luY1xcXCIgbW9kZWwgZm9yIHB1Ymxpc2hlZCBzeW5jIGNoYW5nZSByb3dzIChvciBwYXNzIG9wdGlvbnMuc3luY01vZGVsKVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlQXR0cmlidXRlcyA9IGRlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlcyhyZXNvbHZlZFN5bmNNb2RlbClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnPn0gKi9cbiAgICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIHB1Ymxpc2hpbmdNb2RlbENsYXNzZXMpIHtcbiAgICAgIGNvbnN0IHB1Ymxpc2ggPSBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcylcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gcmVzb3VyY2VDb25maWdGcm9tUHVibGlzaERlY2xhcmF0aW9uKHttb2RlbENsYXNzLCBwdWJsaXNoLCBzY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWx9KVxuXG4gICAgICByZXNvdXJjZXNbcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlXSA9IHJlc291cmNlQ29uZmlnXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHt7YWN0b3JGb3JlaWduS2V5Q29sdW1uOiBzdHJpbmcsIGJyb2FkY2FzdGVyOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wiYnJvYWRjYXN0ZXJcIl0sIGNvbmZpZ3VyYXRpb246IENvbmZpZ3VyYXRpb24sIG9uRXJyb3I6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnNbXCJvbkVycm9yXCJdLCByZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnPiwgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovXG4gICAgdGhpcy5jb25maWcgPSB7YWN0b3JGb3JlaWduS2V5Q29sdW1uLCBicm9hZGNhc3RlciwgY29uZmlndXJhdGlvbiwgb25FcnJvciwgcmVzb3VyY2VzLCBzeW5jTW9kZWw6IHJlc29sdmVkU3luY01vZGVsfVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2NhbGxiYWNrOiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPiwgY2FsbGJhY2tOYW1lOiBcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiLCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtMb2dnZXIgfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvZ2dlciA9IG51bGxcbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzeW5jIHB1Ymxpc2hlciBkZXJpdmVkIGZyb20gdGhlIGdpdmVuIGNvbmZpZ3VyYXRpb24uIEFsaWFzIGZvclxuICAgKiBgbmV3IFN5bmNQdWJsaXNoZXIoe2NvbmZpZ3VyYXRpb24sIC4uLm9wdGlvbnN9KWAuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzLiBEZWZhdWx0cyB0byB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge09taXQ8aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9ucywgXCJjb25maWd1cmF0aW9uXCI+fSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqIEByZXR1cm5zIHtTeW5jUHVibGlzaGVyfSBTeW5jIHB1Ymxpc2hlciBkZXJpdmVkIGZyb20gdGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgZnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gbmV3IFN5bmNQdWJsaXNoZXIoey4uLm9wdGlvbnMsIGNvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyAoYW5kIG1lbW9pemVzIHBlciBjb25maWd1cmF0aW9uKSB0aGUgc3luYyBwdWJsaXNoZXIgZm9yIGEgc2VydmVyXG4gICAqIGJvb3Q6IG5vLW9wIHdoZW4gbm8gcmVnaXN0ZXJlZCBtb2RlbCBkZWNsYXJlcyBhIHB1Ymxpc2ggY29uZmlnLCBndWFyZGVkIHNvXG4gICAqIHJlcGVhdGVkIGJvb3RzIHdpdGggdGhlIHNhbWUgY29uZmlndXJhdGlvbiByZWdpc3RlciB0aGUgcHVibGlzaCBjYWxsYmFja3NcbiAgICogb25seSBvbmNlLlxuICAgKiBAcGFyYW0ge0NvbmZpZ3VyYXRpb259IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNQdWJsaXNoZXIgfCBudWxsPn0gU3RhcnRlZCBwdWJsaXNoZXIsIG9yIG51bGwgd2hlbiBubyBtb2RlbHMgZGVjbGFyZSBwdWJsaXNoLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHN0YXJ0RnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHN0YXJ0ZWRQdWJsaXNoZXIgPSBzdGFydGVkUHVibGlzaGVyc0J5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICAgIGlmIChzdGFydGVkUHVibGlzaGVyKSByZXR1cm4gc3RhcnRlZFB1Ymxpc2hlclxuXG4gICAgaWYgKCFPYmplY3QudmFsdWVzKGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKCkpLnNvbWUoKG1vZGVsQ2xhc3MpID0+IHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwdWJsaXNoZXIgPSBuZXcgU3luY1B1Ymxpc2hlcih7Y29uZmlndXJhdGlvbn0pXG5cbiAgICBzdGFydGVkUHVibGlzaGVyc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgcHVibGlzaGVyKVxuICAgIGF3YWl0IHB1Ymxpc2hlci5zdGFydCgpXG5cbiAgICByZXR1cm4gcHVibGlzaGVyXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoZSBwdWJsaXNoIGNhbGxiYWNrcyBmb3IgZXZlcnkgcHVibGlzaGVkIHJlc291cmNlOiBzZXJ2ZXItc2lkZVxuICAgKiBjcmVhdGVzIGFuZCB1cGRhdGVzIChkZXN0cm95cyB3aGVuIG9wdGVkIGluKSB1cHNlcnQgYSBzeW5jIGNoYW5nZSByb3cgYW5kXG4gICAqIGZhbiBvdXQgdGhlIGRlY2xhcmVkIGJyb2FkY2FzdHMgb25jZSB0aGVpciB0cmFuc2FjdGlvbiBjb21taXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIGlmICh0aGlzLl9zdGFydGVkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0ZWQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IHJlc291cmNlQ29uZmlnIG9mIE9iamVjdC52YWx1ZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgcmVzb3VyY2VDb25maWcub3BlcmF0aW9ucykge1xuICAgICAgICBjb25zdCBjYWxsYmFja05hbWUgPSBQVUJMSVNIRURfQ0FMTEJBQ0tfTkFNRVNbb3BlcmF0aW9uXVxuICAgICAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMucHVibGlzaGVkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgICAgcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc1tjYWxsYmFja05hbWVdKGNhbGxiYWNrKVxuICAgICAgICB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MucHVzaCh7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzczogcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc30pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFsbCBwdWJsaXNoIGNhbGxiYWNrcyAodGVzdHMsIHNodXRkb3duKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdG9wKCkge1xuICAgIGZvciAoY29uc3Qge2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3N9IG9mIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcykge1xuICAgICAgbW9kZWxDbGFzcy51bnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MgPSBbXVxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbGlmZWN5Y2xlIGNhbGxiYWNrIHB1Ymxpc2hpbmcgb25lIHNlcnZlci1zaWRlIG11dGF0aW9uLiBUaGVcbiAgICogcHVibGlzaGVkIHBheWxvYWQgKGRlY2xhcmF0aW9uIGBzZXJpYWxpemVgKSwgZXZlbnQgc2NvcGUsIGFuZCBzeW5jIHR5cGVcbiAgICogYXJlIHNuYXBzaG90dGVkIGF0IG11dGF0aW9uLWNhbGxiYWNrIHRpbWUsIHNvIGFmdGVyU2F2ZSBob29rcyBhc3NpZ25pbmdcbiAgICogdW5zYXZlZCBhdHRyaWJ1dGVzIChvciBhbnkgbGF0ZXIgZHJpZnQgb24gdGhlIHJlY29yZCkgY2Fubm90IGNoYW5nZSB3aGF0XG4gICAqIGdldHMgcHVibGlzaGVkIHZzIHdoYXQgd2FzIGNvbW1pdHRlZC4gUGVyc2lzdGluZyBhbmQgYnJvYWRjYXN0aW5nIGFyZVxuICAgKiBkZWZlcnJlZCB0aHJvdWdoIHRoZSBtb2RlbCBjb25uZWN0aW9uJ3MgYWZ0ZXJDb21taXQgaG9vayBzbyB0aGV5IG9ubHkgcnVuXG4gICAqIG9uY2UgdGhlIG11dGF0aW9uJ3MgdHJhbnNhY3Rpb24gaGFzIGNvbW1pdHRlZCAoaW1tZWRpYXRlbHkgd2hlbiBub1xuICAgKiB0cmFuc2FjdGlvbiBpcyBvcGVuKSAtIHJvbGxlZC1iYWNrIG11dGF0aW9ucyBuZXZlciBwdWJsaXNoLiBQb3N0LWNvbW1pdFxuICAgKiBwdWJsaXNoIGZhaWx1cmVzIGFyZSByZXBvcnRlZCB3aXRob3V0IHJldGhyb3dpbmcgaW50byB0aGUgZHJpdmVyJ3NcbiAgICogYWZ0ZXJDb21taXQgY2hhaW4gKHNlZSByZXBvcnRBZnRlckNvbW1pdEVycm9yKS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9fSBhcmdzIC0gT3BlcmF0aW9uIGFuZCByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHsocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPn0gTGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKi9cbiAgcHVibGlzaGVkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKGlzUHVibGlzaGluZ1N1cHByZXNzZWQocmVjb3JkKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNvdXJjZUNvbmZpZy5zZXJpYWxpemUocmVjb3JkKVxuICAgICAgY29uc3QgcmVzb3VyY2VJZCA9IFN0cmluZyhzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShyZWNvcmQuaWQoKSwgYFN5bmMgcHVibGlzaGluZyBmb3IgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9YCkpXG4gICAgICBjb25zdCBzeW5jVHlwZSA9IG9wZXJhdGlvbiA9PT0gXCJkZXN0cm95XCIgPyBcImRlbGV0ZVwiIDogXCJ1cGRhdGVcIlxuICAgICAgY29uc3Qgc2NvcGVWYWx1ZXMgPSBhd2FpdCB0aGlzLnB1Ymxpc2hlZFNjb3BlVmFsdWVzKHtyZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHtcbiAgICAgICAgW3RoaXMuY29uZmlnLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IG51bGwsXG4gICAgICAgIGNsaWVudF91cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLFxuICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICAgICAgcmVzb3VyY2VfaWQ6IHJlc291cmNlSWQsXG4gICAgICAgIHJlc291cmNlX3R5cGU6IHJlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZSxcbiAgICAgICAgc3luY190eXBlOiBzeW5jVHlwZSxcbiAgICAgICAgLi4uc2NvcGVWYWx1ZXMuY29sdW1uc1xuICAgICAgfVxuICAgICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uU2NvcGUgPSBkYXRhYmFzZU9wZXJhdGlvblxuICAgICAgICA/IGRhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcbiAgICAgICAgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcblxuICAgICAgYXdhaXQgcmVjb3JkLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3Qgc3luY1JvdyA9IGF3YWl0IHRoaXMudXBzZXJ0UHVibGlzaGVkU3luY1JvdyhhdHRyaWJ1dGVzLCBvcGVyYXRpb25TY29wZSlcblxuICAgICAgICAgIGF3YWl0IHRoaXMuYnJvYWRjYXN0ZXIoKSh7XG4gICAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICAgIGVjaG9PcmlnaW46IG51bGwsXG4gICAgICAgICAgICAgIHN5bmNzOiBbdGhpcy5wdWJsaXNoZWRTeW5jRW50cnkoe2RhdGEsIHJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkLCBzeW5jUm93LCBzeW5jVHlwZX0pXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNoYW5uZWw6IFZFTE9DSU9VU19TWU5DX0NIQU5ORUwsXG4gICAgICAgICAgICBwYXJhbXM6IHsuLi5zY29wZVZhbHVlcy5wYXJhbXMsIHJlc291cmNlVHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpZiAocmVzb3VyY2VDb25maWcuYnJvYWRjYXN0cykge1xuICAgICAgICAgICAgYXdhaXQgZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cyh7XG4gICAgICAgICAgICAgIGFyZ3M6IHtkYXRhLCBvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsIHN5bmNSb3csIHN5bmNUeXBlfSxcbiAgICAgICAgICAgICAgYnJvYWRjYXN0ZXI6IHRoaXMuYnJvYWRjYXN0ZXIoKSxcbiAgICAgICAgICAgICAgYnJvYWRjYXN0czogcmVzb3VyY2VDb25maWcuYnJvYWRjYXN0c1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yZXBvcnRBZnRlckNvbW1pdEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzY29wZS1wYXJ0aXRpb24gdmFsdWVzIGZvciBvbmUgcHVibGlzaGVkIG11dGF0aW9uIGZyb20gdGhlXG4gICAqIHJlc291cmNlJ3MgZGVyaXZlZCBzY29wZSBwbGFuOiBlYWNoIGVudHJ5IHJlYWRzIGl0cyByZWNvcmQgYXR0cmlidXRlIChvclxuICAgKiB0aGUgcmVjb3JkJ3Mgb3duIGlkIGZvciBzY29wZS1yb290IG1vZGVscywgb3IgdGhlIGRlcHJlY2F0ZWQgcmVzb2x2ZXJcbiAgICogZnVuY3Rpb24pLiBUaGUgdmFsdWVzIGFyZSBwZXJzaXN0ZWQgb250byB0aGUgc3luYyByb3cncyBwYXJ0aXRpb24gY29sdW1uc1xuICAgKiBhbmQgYnJvYWRjYXN0IGFzIHRoZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsJ3Mgc2NvcGluZyBwYXJhbXMuXG4gICAqIEBwYXJhbSB7e3JlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBNdXRhdGVkIHJlY29yZCBhbmQgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y29sdW1uczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD4sIHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59Pn0gU2NvcGUgdmFsdWVzIGtleWVkIGJ5IHN5bmMtcm93IGNvbHVtbiBhbmQgYnkgc2NvcGUgYXR0cmlidXRlLlxuICAgKi9cbiAgYXN5bmMgcHVibGlzaGVkU2NvcGVWYWx1ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gKi9cbiAgICBjb25zdCBjb2x1bW5zID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlUGxhbkVudHJ5IG9mIHJlc291cmNlQ29uZmlnLnNjb3BlUGxhbikge1xuICAgICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICAgIGxldCByYXdWYWx1ZVxuXG4gICAgICBpZiAoc2NvcGVQbGFuRW50cnkucmVzb2x2ZXIpIHtcbiAgICAgICAgcmF3VmFsdWUgPSBhd2FpdCBzY29wZVBsYW5FbnRyeS5yZXNvbHZlcihyZWNvcmQpXG4gICAgICB9IGVsc2UgaWYgKHNjb3BlUGxhbkVudHJ5LnJlY29yZEF0dHJpYnV0ZSkge1xuICAgICAgICByYXdWYWx1ZSA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHNjb3BlUGxhbkVudHJ5LnJlY29yZEF0dHJpYnV0ZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJhd1ZhbHVlID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBTeW5jIHNjb3BlIHB1Ymxpc2hpbmcgZm9yICR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gcmF3VmFsdWUgPT09IHVuZGVmaW5lZCB8fCByYXdWYWx1ZSA9PT0gbnVsbCA/IG51bGwgOiBTdHJpbmcocmF3VmFsdWUpXG5cbiAgICAgIGNvbHVtbnNbc2NvcGVQbGFuRW50cnkuY29sdW1uTmFtZV0gPSB2YWx1ZVxuICAgICAgcGFyYW1zW3Njb3BlUGxhbkVudHJ5LnNjb3BlQXR0cmlidXRlXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb2x1bW5zLCBwYXJhbXN9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsIGVudHJ5IGZvciBvbmUgcHVibGlzaGVkIGNoYW5nZTogdGhlXG4gICAqIHNuYXBzaG90dGVkIHBheWxvYWQgcGx1cyB0aGUgcGVyc2lzdGVkIHN5bmMgcm93J3MgcHVibGljIGV4YWN0LXJvdyBtZXRhZGF0YVxuICAgKiAoaWQsIHNlcnZlciBzZXF1ZW5jZSwgdXBkYXRlZC1hdCwgYW5kIGRlY2xhcmVkIHNjb3BlLXBhcnRpdGlvbiBhdHRyaWJ1dGVzKS5cbiAgICogVXNlcyB0aGUgc3luYyBtb2RlbCdzIGdlbmVyYXRlZCB0eXBlZCBhY2Nlc3NvcnMgYW5kIGZvbGxvd3MgdGhlXG4gICAqIGNoYW5nZS1mZWVkIHNlcmlhbGl6ZXIncyBwdWJsaWMgZmllbGQgY29udmVudGlvbi5cbiAgICogQHBhcmFtIHt7ZGF0YTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWcsIHJlc291cmNlSWQ6IHN0cmluZywgc3luY1JvdzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHN5bmNUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUHVibGlzaCBhcmdzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBCcm9hZGNhc3Qgc3luYyBlbnRyeS5cbiAgICovXG4gIHB1Ymxpc2hlZFN5bmNFbnRyeSh7ZGF0YSwgcmVzb3VyY2VDb25maWcsIHJlc291cmNlSWQsIHN5bmNSb3csIHN5bmNUeXBlfSkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge1xuICAgICAgZGF0YSxcbiAgICAgIGlkOiBzeW5jUm93LmlkKCksXG4gICAgICByZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZTogc3luY1Jvdy5zZXJ2ZXJTZXF1ZW5jZSgpLFxuICAgICAgc3luY1R5cGUsXG4gICAgICB1cGRhdGVkQXQ6IGlzb0RhdGUoc3luY1Jvdy51cGRhdGVkQXQoKSlcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZUF0dHJpYnV0ZXMgPSBkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXModGhpcy5jb25maWcuc3luY01vZGVsKVxuXG4gICAgZm9yIChjb25zdCBzY29wZUF0dHJpYnV0ZSBvZiBzY29wZUF0dHJpYnV0ZXMgfHwgW10pIHtcbiAgICAgIGNvbnN0IHNjb3BlQWNjZXNzb3IgPSBzeW5jUm93W3Njb3BlQXR0cmlidXRlXVxuXG4gICAgICBpZiAodHlwZW9mIHNjb3BlQWNjZXNzb3IgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFB1Ymxpc2hlZCBzeW5jIHJvdyBpcyBtaXNzaW5nIHRoZSBkZWNsYXJlZCBzY29wZSBhY2Nlc3NvciAke3Njb3BlQXR0cmlidXRlfSgpLmApXG4gICAgICB9XG5cbiAgICAgIGVudHJ5W3Njb3BlQXR0cmlidXRlXSA9IHNjb3BlQWNjZXNzb3IuY2FsbChzeW5jUm93KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIFVwc2VydHMgdGhlIHB1Ymxpc2hlZCBzZXJ2ZXItb3JpZ2luIHN5bmMgcm93IGZvciBhIHJlc291cmNlIGlkZW50aXR5OlxuICAgKiBzZXJ2ZXItb3JpZ2luIHJvd3MgY2FycnkgYSBudWxsIGFjdG9yIGNvbHVtbiAobm8gZGV2aWNlIHRvIGVjaG8gdGhlXG4gICAqIGNoYW5nZSBiYWNrIHRvKSwgc28gcmVwZWF0ZWQgc2VydmVyIGNoYW5nZXMgdG8gb25lIHJlc291cmNlIHJldXNlIGFuZFxuICAgKiByZS1zZXF1ZW5jZSBvbmUgZmVlZCByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gU25hcHNob3R0ZWQgc3luYyByb3cgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luY01vZGVsIC0gT3BlcmF0aW9uLWJvdW5kIG9yIHN0YXRpYyBTeW5jIG1vZGVsIGludGVyZmFjZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBVcHNlcnRlZCBzeW5jIHJvdy5cbiAgICovXG4gIGFzeW5jIHVwc2VydFB1Ymxpc2hlZFN5bmNSb3coYXR0cmlidXRlcywgc3luY01vZGVsID0gdGhpcy5jb25maWcuc3luY01vZGVsKSB7XG4gICAgY29uc3QgZXhpc3RpbmdTeW5jID0gYXdhaXQgc3luY01vZGVsXG4gICAgICAud2hlcmUoe1xuICAgICAgICBbdGhpcy5jb25maWcuYWN0b3JGb3JlaWduS2V5Q29sdW1uXTogbnVsbCxcbiAgICAgICAgcmVzb3VyY2VfaWQ6IGF0dHJpYnV0ZXMucmVzb3VyY2VfaWQsXG4gICAgICAgIHJlc291cmNlX3R5cGU6IGF0dHJpYnV0ZXMucmVzb3VyY2VfdHlwZVxuICAgICAgfSlcbiAgICAgIC5maXJzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdXBzZXJ0U3luY1Jvdyh7YXR0cmlidXRlcywgZXhpc3RpbmdTeW5jLCBzeW5jTW9kZWx9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGJyb2FkY2FzdGVyIGRlbGl2ZXJpbmcgZGVjbGFyZWQgYnJvYWRjYXN0czogdGhlIGluamVjdGVkIG9uZSxcbiAgICogb3IgdGhlIGNvbmZpZ3VyYXRpb24ncyBjaGFubmVsIGJyb2FkY2FzdCBhd2FpdGVkIHRocm91Z2ggdGhlIHBlbmRpbmdcbiAgICogYnJvYWRjYXN0IHF1ZXVlLlxuICAgKiBAcmV0dXJucyB7Tm9uTnVsbGFibGU8aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc1tcImJyb2FkY2FzdGVyXCJdPn0gQnJvYWRjYXN0IGRlbGl2ZXJlci5cbiAgICovXG4gIGJyb2FkY2FzdGVyKCkge1xuICAgIGlmICh0aGlzLmNvbmZpZy5icm9hZGNhc3RlcikgcmV0dXJuIHRoaXMuY29uZmlnLmJyb2FkY2FzdGVyXG5cbiAgICByZXR1cm4gYXN5bmMgKHtib2R5LCBjaGFubmVsLCBwYXJhbXN9KSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChjaGFubmVsLCBwYXJhbXMsIGJvZHkpXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLmF3YWl0UGVuZGluZ0Jyb2FkY2FzdHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGEgcG9zdC1jb21taXQgcHVibGlzaCBmYWlsdXJlLiBUaGUgdHJhbnNhY3Rpb24gaGFzIGFscmVhZHlcbiAgICogY29tbWl0dGVkIHdoZW4gYWZ0ZXJDb21taXQgY2FsbGJhY2tzIHJ1biwgc28gcmV0aHJvd2luZyBoZXJlIHdvdWxkIHBvaXNvblxuICAgKiB0aGUgZHJpdmVyJ3MgYXdhaXRlZCBhZnRlckNvbW1pdCBjaGFpbiAoYnJlYWtpbmcgdW5yZWxhdGVkIGNhbGxiYWNrcykgLVxuICAgKiBpbnN0ZWFkIHRoZSBmYWlsdXJlIGdvZXMgdG8gdGhlIGNvbmZpZ3VyZWQgb25FcnJvciBob29rLCBvciBpcyBlbWl0dGVkIG9uXG4gICAqIHRoZSBjb25maWd1cmF0aW9uJ3MgZnJhbWV3b3JrLWVycm9yL2FsbC1lcnJvciBjaGFubmVscyAoc28gcHJvZHVjdGlvbiBidWdcbiAgICogcmVwb3J0aW5nIHZpYSBgY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpYCBzZWVzIGEgYnJva2VuIHB1Ymxpc2hcbiAgICogcGF0aCkgYW5kIGxvZ2dlZCBsb3VkbHkgdGhyb3VnaCB0aGUgcHVibGlzaGVyJ3MgbG9nZ2VyIHdoZW4gbm9uZSBpc1xuICAgKiBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFBvc3QtY29tbWl0IHB1Ymxpc2ggZmFpbHVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBvcnRBZnRlckNvbW1pdEVycm9yKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLm9uRXJyb3IpIHtcbiAgICAgIHRoaXMuY29uZmlnLm9uRXJyb3IoZXJyb3IpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWcuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwic3luYy1wdWJsaXNoLWFmdGVyLWNvbW1pdFwifSwgZXJyb3J9XG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyKCkuZXJyb3IoXCJTeW5jUHVibGlzaGVyIGZhaWxlZCB0byBwdWJsaXNoIGEgc2VydmVyLXNpZGUgc3luYyBjaGFuZ2UgYWZ0ZXIgY29tbWl0XCIsIGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxhemlseSBidWlsdCBwdWJsaXNoZXIgbG9nZ2VyLlxuICAgKiBAcmV0dXJucyB7TG9nZ2VyfSBQdWJsaXNoZXIgbG9nZ2VyLlxuICAgKi9cbiAgbG9nZ2VyKCkge1xuICAgIHRoaXMuX2xvZ2dlciB8fD0gbmV3IExvZ2dlcihcIlN5bmNQdWJsaXNoZXJcIiwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb259KVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvZ2dlclxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYSBtb2RlbCBjbGFzcydzIGFjdGl2ZSBwdWJsaXNoIGRlY2xhcmF0aW9uIGZyb20gYHN0YXRpYyBzeW5jYC5cbiAqIE9wdGVkLW91dCAoYHB1Ymxpc2g6IGZhbHNlYCkgYW5kIHVuZGVjbGFyZWQgbW9kZWxzIHJlc29sdmUgdG8gbnVsbDsgZXZlcnlcbiAqIG90aGVyIGRlY2xhcmVkIHZhbHVlIGZsb3dzIGludG8gbG91ZCBkZWNsYXJhdGlvbiB2YWxpZGF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbW9kZWxDbGFzcyAtIFJlZ2lzdGVyZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uIHwgbnVsbH0gQWN0aXZlIHB1Ymxpc2ggZGVjbGFyYXRpb24sIG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKSB7XG4gIGNvbnN0IGRlY2xhcmF0aW9uID0gbW9kZWxDbGFzcy5zeW5jXG5cbiAgaWYgKCFkZWNsYXJhdGlvbiB8fCB0eXBlb2YgZGVjbGFyYXRpb24gIT09IFwib2JqZWN0XCIgfHwgZGVjbGFyYXRpb24ucHVibGlzaCA9PT0gdW5kZWZpbmVkIHx8IGRlY2xhcmF0aW9uLnB1Ymxpc2ggPT09IGZhbHNlKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBkZWNsYXJhdGlvbi5wdWJsaXNoXG59XG5cbi8qKlxuICogQnVpbGRzIG9uZSBwdWJsaXNoZWQgcmVzb3VyY2UgY29uZmlnIGZyb20gYSBtb2RlbCdzIGBzdGF0aWMgc3luY2AgcHVibGlzaFxuICogZGVjbGFyYXRpb24uIGBwdWJsaXNoOiB0cnVlYCBvcHRzIGluIHdpdGggYWxsIGRlZmF1bHRzIChhdHRyaWJ1dGUgcGF5bG9hZCxcbiAqIGRlcml2ZWQgc2NvcGUgcGFydGl0aW9uLCBjcmVhdGVkL3VwZGF0ZWQgb3BlcmF0aW9ucykuXG4gKiBAcGFyYW0ge3ttb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcHVibGlzaDogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uIHwgbnVsbCwgc2NvcGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSB8IG51bGwsIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gRGVjbGFyYXRpb24gYXJncyBwbHVzIHRoZSBzeW5jIG1vZGVsJ3MgZGVjbGFyZWQgc2NvcGUgYXR0cmlidXRlcy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ30gRGVyaXZlZCByZXNvdXJjZSBjb25maWcuXG4gKi9cbmZ1bmN0aW9uIHJlc291cmNlQ29uZmlnRnJvbVB1Ymxpc2hEZWNsYXJhdGlvbih7bW9kZWxDbGFzcywgcHVibGlzaCwgc2NvcGVBdHRyaWJ1dGVzOiBzeW5jU2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWx9KSB7XG4gIGNvbnN0IG1vZGVsTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgY29uc3Qgbm9ybWFsaXplZFB1Ymxpc2ggPSBwdWJsaXNoID09PSB0cnVlID8ge30gOiBwdWJsaXNoXG5cbiAgaWYgKCFub3JtYWxpemVkUHVibGlzaCB8fCB0eXBlb2Ygbm9ybWFsaXplZFB1Ymxpc2ggIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShub3JtYWxpemVkUHVibGlzaCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIG11c3QgYmUgdHJ1ZSwgZmFsc2Ugb3IgYSBwdWJsaXNoIGRlY2xhcmF0aW9uIG9iamVjdCwgZ290OiAke1N0cmluZyhwdWJsaXNoKX1gKVxuICB9XG5cbiAgY29uc3Qge2Jyb2FkY2FzdHMsIGV2ZW50SWQsIG9wZXJhdGlvbnMsIHJlc291cmNlVHlwZSwgc2NvcGVBdHRyaWJ1dGVzLCBzZXJpYWxpemUsIC4uLnJlc3REZWNsYXJhdGlvbn0gPSBub3JtYWxpemVkUHVibGlzaFxuICBjb25zdCB1bmtub3duS2V5cyA9IE9iamVjdC5rZXlzKHJlc3REZWNsYXJhdGlvbilcblxuICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYnJvYWRjYXN0cywgZXZlbnRJZCAoZGVwcmVjYXRlZCksIG9wZXJhdGlvbnMsIHJlc291cmNlVHlwZSwgc2NvcGVBdHRyaWJ1dGVzLCBzZXJpYWxpemUpYClcbiAgfVxuICBpZiAoc2VyaWFsaXplICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHNlcmlhbGl6ZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzZXJpYWxpemUgbXVzdCBiZSBhIGZ1bmN0aW9uIGJ1aWxkaW5nIHRoZSBwdWJsaXNoZWQgcGF5bG9hZCwgZ290OiAke1N0cmluZyhzZXJpYWxpemUpfWApXG4gIH1cbiAgaWYgKG9wZXJhdGlvbnMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShvcGVyYXRpb25zKSB8fCBvcGVyYXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBvcGVyYXRpb25zIG11c3QgYmUgYSBub24tZW1wdHkgYXJyYXkgb2YgY3JlYXRlL3VwZGF0ZS9kZXN0cm95YClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zKSB7XG4gICAgICBpZiAoIShvcGVyYXRpb24gaW4gUFVCTElTSEVEX0NBTExCQUNLX05BTUVTKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIG9wZXJhdGlvbnMgbXVzdCBiZSBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3ksIGdvdDogJHtTdHJpbmcob3BlcmF0aW9uKX1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYnJvYWRjYXN0cyxcbiAgICBtb2RlbENsYXNzLFxuICAgIG9wZXJhdGlvbnM6IG9wZXJhdGlvbnMgPT09IHVuZGVmaW5lZCA/IERFRkFVTFRfUFVCTElTSEVEX09QRVJBVElPTlMgOiBvcGVyYXRpb25zLFxuICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2VUeXBlID09PSB1bmRlZmluZWQgPyBtb2RlbE5hbWUgOiByZXNvdXJjZVR5cGUsXG4gICAgc2NvcGVQbGFuOiBzY29wZVBsYW5Gb3Ioe2V2ZW50SWQsIG1vZGVsQ2xhc3MsIG1vZGVsTmFtZSwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWwsIHN5bmNTY29wZUF0dHJpYnV0ZXN9KSxcbiAgICBzZXJpYWxpemU6IHNlcmlhbGl6ZSA9PT0gdW5kZWZpbmVkID8gZGVmYXVsdFNlcmlhbGl6ZWRBdHRyaWJ1dGVzIDogc2VyaWFsaXplXG4gIH1cbn1cblxuLyoqXG4gKiBEZXJpdmVzIHRoZSBzY29wZSBwbGFuIHBhcnRpdGlvbmluZyBhIHB1Ymxpc2hlZCBtb2RlbCdzIGNoYW5nZXM6IG9uZSBlbnRyeVxuICogcGVyIHNjb3BlIGF0dHJpYnV0ZSBkZWNsYXJlZCBvbiB0aGUgc3luYyBtb2RlbCAoYHN0YXRpY1xuICogc3luY1Njb3BlQXR0cmlidXRlc2ApLCBlYWNoIHJlYWRpbmcgdGhlIHJlY29yZCBhdHRyaWJ1dGUgbmFtZWQgbGlrZSB0aGVcbiAqIHNjb3BlIGF0dHJpYnV0ZSAob3ZlcnJpZGFibGUgdGhyb3VnaCB0aGUgZGVjbGFyYXRpb24ncyBgc2NvcGVBdHRyaWJ1dGVzYFxuICogbmFtZSBtYXApLCBvciB0aGUgcmVjb3JkJ3Mgb3duIGlkIHdoZW4gdGhlIG1vZGVsIGhhcyBubyBzdWNoIGF0dHJpYnV0ZVxuICogKHNjb3BlLXJvb3QgbW9kZWxzKS4gVGhlIGRlcHJlY2F0ZWQgYGV2ZW50SWRgIGRlY2xhcmF0aW9uIGZvcm1zIG1hcCB0byBhXG4gKiBmaXhlZCBgZXZlbnRJZGAvYGV2ZW50X2lkYCBwbGFuIGZvciAxLjAuNTAzIGNvbXBhdGliaWxpdHkuXG4gKiBAcGFyYW0ge3tldmVudElkOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb25Db25maWdbXCJldmVudElkXCJdLCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbW9kZWxOYW1lOiBzdHJpbmcsIHNjb3BlQXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCwgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc3luY1Njb3BlQXR0cmlidXRlczogc3RyaW5nW10gfCBudWxsfX0gYXJncyAtIERlY2xhcmF0aW9uIGFuZCBzeW5jLW1vZGVsIHNjb3BlIGFyZ3MuXG4gKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyU2NvcGVQbGFuRW50cnk+fSBEZXJpdmVkIHNjb3BlIHBsYW4uXG4gKi9cbmZ1bmN0aW9uIHNjb3BlUGxhbkZvcih7ZXZlbnRJZCwgbW9kZWxDbGFzcywgbW9kZWxOYW1lLCBzY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbCwgc3luY1Njb3BlQXR0cmlidXRlc30pIHtcbiAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBPYmplY3QudmFsdWVzKG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpKVxuXG4gIGlmIChldmVudElkICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoc2NvcGVBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggY2FuJ3QgZGVjbGFyZSBib3RoIHNjb3BlQXR0cmlidXRlcyBhbmQgdGhlIGRlcHJlY2F0ZWQgZXZlbnRJZCBmb3JtYClcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBldmVudElkID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBbe2NvbHVtbk5hbWU6IFwiZXZlbnRfaWRcIiwgcmVjb3JkQXR0cmlidXRlOiBudWxsLCByZXNvbHZlcjogZXZlbnRJZCwgc2NvcGVBdHRyaWJ1dGU6IFwiZXZlbnRJZFwifV1cbiAgICB9XG4gICAgaWYgKHR5cGVvZiBldmVudElkICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGV2ZW50SWQgbXVzdCBiZSBhbiBhdHRyaWJ1dGUtbmFtZSBzdHJpbmcgKG9yIGEgZGVwcmVjYXRlZCByZXNvbHZlciBmdW5jdGlvbiksIGdvdDogJHtTdHJpbmcoZXZlbnRJZCl9YClcbiAgICB9XG4gICAgaWYgKCFhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhldmVudElkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBldmVudElkIGF0dHJpYnV0ZSBkb2Vzbid0IGV4aXN0IG9uIHRoZSBtb2RlbDogJHtldmVudElkfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIFt7Y29sdW1uTmFtZTogXCJldmVudF9pZFwiLCByZWNvcmRBdHRyaWJ1dGU6IGV2ZW50SWQsIHJlc29sdmVyOiB1bmRlZmluZWQsIHNjb3BlQXR0cmlidXRlOiBcImV2ZW50SWRcIn1dXG4gIH1cblxuICBpZiAoc2NvcGVBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgJiYgIXN5bmNTY29wZUF0dHJpYnV0ZXMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGRlY2xhcmVzIHNjb3BlQXR0cmlidXRlcyBidXQgdGhlIHN5bmMgbW9kZWwgZGVjbGFyZXMgbm8gc3RhdGljIHN5bmNTY29wZUF0dHJpYnV0ZXNgKVxuICB9XG5cbiAgaWYgKCFzeW5jU2NvcGVBdHRyaWJ1dGVzKSByZXR1cm4gW11cblxuICBpZiAoc2NvcGVBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBzY29wZUF0dHJpYnV0ZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzY29wZUF0dHJpYnV0ZXMpKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0IG1hcHBpbmcgc2NvcGUgYXR0cmlidXRlcyB0byByZWNvcmQgYXR0cmlidXRlIG5hbWVzLCBnb3Q6ICR7U3RyaW5nKHNjb3BlQXR0cmlidXRlcyl9YClcbiAgfVxuXG4gIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2YgT2JqZWN0LmtleXMoc2NvcGVBdHRyaWJ1dGVzIHx8IHt9KSkge1xuICAgIGlmICghc3luY1Njb3BlQXR0cmlidXRlcy5pbmNsdWRlcyhzY29wZUF0dHJpYnV0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIHJlY2VpdmVkIHVua25vd24gc2NvcGUgYXR0cmlidXRlOiAke3Njb3BlQXR0cmlidXRlfSAodGhlIHN5bmMgbW9kZWwgZGVjbGFyZXM6ICR7c3luY1Njb3BlQXR0cmlidXRlcy5qb2luKFwiLCBcIil9KWApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHN5bmNTY29wZUF0dHJpYnV0ZXMubWFwKChzY29wZUF0dHJpYnV0ZSkgPT4ge1xuICAgIGNvbnN0IGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlID0gc2NvcGVBdHRyaWJ1dGVzPy5bc2NvcGVBdHRyaWJ1dGVdXG5cbiAgICBpZiAoZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHR5cGVvZiBkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSAhPT0gXCJzdHJpbmdcIiB8fCAhYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzLiR7c2NvcGVBdHRyaWJ1dGV9IG11c3QgbmFtZSBhbiBleGlzdGluZyByZWNvcmQgYXR0cmlidXRlLCBnb3Q6ICR7U3RyaW5nKGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlKX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2NvbHVtbk5hbWU6IHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSwgcmVjb3JkQXR0cmlidXRlOiBkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSwgcmVzb2x2ZXI6IHVuZGVmaW5lZCwgc2NvcGVBdHRyaWJ1dGV9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbHVtbk5hbWU6IHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSxcbiAgICAgIHJlY29yZEF0dHJpYnV0ZTogYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoc2NvcGVBdHRyaWJ1dGUpID8gc2NvcGVBdHRyaWJ1dGUgOiBudWxsLFxuICAgICAgcmVzb2x2ZXI6IHVuZGVmaW5lZCxcbiAgICAgIHNjb3BlQXR0cmlidXRlXG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBzeW5jLXJvdyBjb2x1bW4gcGVyc2lzdGluZyBhIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZS5cbiAqIEBwYXJhbSB7e3Njb3BlQXR0cmlidXRlOiBzdHJpbmcsIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gU2NvcGUgYXR0cmlidXRlIGFuZCBzeW5jIG1vZGVsLlxuICogQHJldHVybnMge3N0cmluZ30gU3luYy1yb3cgY29sdW1uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSB7XG4gIGNvbnN0IGNvbHVtbk5hbWUgPSBzeW5jTW9kZWwuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Njb3BlQXR0cmlidXRlXVxuXG4gIGlmICghY29sdW1uTmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtzeW5jTW9kZWwubmFtZX0gZGVjbGFyZXMgdGhlIHN5bmMgc2NvcGUgYXR0cmlidXRlICR7c2NvcGVBdHRyaWJ1dGV9IGJ1dCBoYXMgbm8gbWF0Y2hpbmcgY29sdW1uIGZvciBpdGApXG4gIH1cblxuICByZXR1cm4gY29sdW1uTmFtZVxufVxuXG4vKipcbiAqIERlZmF1bHQgcHVibGlzaCBzZXJpYWxpemVyOiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcyB3aXRoIERhdGUgdmFsdWVzXG4gKiBzZXJpYWxpemVkIHRvIElTTyBzdHJpbmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTXV0YXRlZCBzZXJ2ZXIgbW9kZWwgcmVjb3JkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU2VyaWFsaXplZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRTZXJpYWxpemVkQXR0cmlidXRlcyhyZWNvcmQpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSB7Li4ucmVjb3JkLmF0dHJpYnV0ZXMoKX1cblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWUudG9JU09TdHJpbmcoKVxuICB9XG5cbiAgcmV0dXJuIGF0dHJpYnV0ZXNcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGRhdGUtbGlrZSB2YWx1ZSB0byBhbiBJU08gc3RyaW5nLCBtYXRjaGluZyB0aGUgY2hhbmdlLWZlZWRcbiAqIHNlcmlhbGl6ZXIncyBjb252ZW50aW9uIGZvciB0aGUgc3luYyBlbnRyeSdzIHB1YmxpYyB1cGRhdGVkLWF0IG1ldGFkYXRhLlxuICogQHBhcmFtIHtEYXRlIHwgbnVsbH0gdmFsdWUgLSBQZXJzaXN0ZWQgdXBkYXRlZC1hdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IElTTyBkYXRlLlxuICogQHRocm93cyB7RXJyb3J9IFdoZW4gdGhlIHBlcnNpc3RlZCByb3cgaGFzIG5vIHZhbGlkIHVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICovXG5mdW5jdGlvbiBpc29EYXRlKHZhbHVlKSB7XG4gIGlmICghKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKHZhbHVlLmdldFRpbWUoKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJQdWJsaXNoZWQgc3luYyByb3cgbXVzdCBoYXZlIGEgdmFsaWQgdXBkYXRlZEF0IHRpbWVzdGFtcC5cIilcbiAgfVxuXG4gIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG59XG4iXX0=