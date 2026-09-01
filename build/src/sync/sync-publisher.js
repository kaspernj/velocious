// @ts-check
import Configuration from "../configuration.js";
import Logger from "../logger.js";
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
            const resourceId = String(record.id());
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
                rawValue = record.id();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1wdWJsaXNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXB1Ymxpc2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE9BQU8sRUFBQywyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3RFLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU3RCxzRkFBc0Y7QUFDdEYsTUFBTSx3QkFBd0IsR0FBRyxFQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFDLENBQUE7QUFFeEc7Ozs7OztvREFNb0Q7QUFDcEQsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV6RCxvREFBb0Q7QUFDcEQsTUFBTSxnQ0FBZ0MsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXREOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7T0FRRztJQUNILFlBQVksT0FBTyxHQUFHLEVBQUU7UUFDdEIsTUFBTSxFQUFDLHFCQUFxQixHQUFHLHlCQUF5QixFQUFFLFdBQVcsRUFBRSxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsR0FBRyxXQUFXLEVBQUMsR0FBRyxPQUFPLENBQUE7UUFFN0osYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBRTFCLE1BQU0sWUFBWSxHQUFHLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUNwRCxNQUFNLHNCQUFzQixHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1FBRXBILElBQUksc0JBQXNCLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3hDLE1BQU0sSUFBSSxLQUFLLENBQUMsaU1BQWlNLENBQUMsQ0FBQTtRQUNwTixDQUFDO1FBRUQsTUFBTSxpQkFBaUIsR0FBRyxTQUFTLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQTtRQUV4RCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksS0FBSyxDQUFDLCtHQUErRyxDQUFDLENBQUE7UUFDbEksQ0FBQztRQUVELE1BQU0sZUFBZSxHQUFHLDJCQUEyQixDQUFDLGlCQUFpQixDQUFDLENBQUE7UUFDdEUsOEZBQThGO1FBQzlGLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sVUFBVSxJQUFJLHNCQUFzQixFQUFFLENBQUM7WUFDaEQsTUFBTSxPQUFPLEdBQUcscUJBQXFCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDakQsTUFBTSxjQUFjLEdBQUcsb0NBQW9DLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1lBRWpJLFNBQVMsQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLEdBQUcsY0FBYyxDQUFBO1FBQ3pELENBQUM7UUFFRCxzWEFBc1g7UUFDdFgsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFDLHFCQUFxQixFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQTtRQUNuSCxtTUFBbU07UUFDbk0sSUFBSSxDQUFDLG1CQUFtQixHQUFHLEVBQUUsQ0FBQTtRQUM3Qiw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQzVFLE9BQU8sSUFBSSxhQUFhLENBQUMsRUFBQyxHQUFHLE9BQU8sRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO0lBQ3ZELENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxhQUFhO1FBQy9DLE1BQU0sZ0JBQWdCLEdBQUcsZ0NBQWdDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRTVFLElBQUksZ0JBQWdCO1lBQUUsT0FBTyxnQkFBZ0IsQ0FBQTtRQUU3QyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLHFCQUFxQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFeEgsTUFBTSxTQUFTLEdBQUcsSUFBSSxhQUFhLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBRXBELGdDQUFnQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDOUQsTUFBTSxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFdkIsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTTtRQUV6QixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUVwQixLQUFLLE1BQU0sY0FBYyxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ2xFLEtBQUssTUFBTSxTQUFTLElBQUksY0FBYyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNsRCxNQUFNLFlBQVksR0FBRyx3QkFBd0IsQ0FBQyxTQUFTLENBQUMsQ0FBQTtnQkFDeEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUMsU0FBUyxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7Z0JBRTVFLGNBQWMsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBQ2pELElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsRUFBQyxRQUFRLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxjQUFjLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQTtZQUNoRyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxJQUFJO1FBQ0YsS0FBSyxNQUFNLEVBQUMsUUFBUSxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUMsSUFBSSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUM1RSxVQUFVLENBQUMsMkJBQTJCLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ2hFLENBQUM7UUFFRCxJQUFJLENBQUMsbUJBQW1CLEdBQUcsRUFBRSxDQUFBO1FBQzdCLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7OztPQWFHO0lBQ0gseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUUsY0FBYyxFQUFDO1FBQ25ELE9BQU8sS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3RCLElBQUksc0JBQXNCLENBQUMsTUFBTSxDQUFDO2dCQUFFLE9BQU07WUFFMUMsTUFBTSxJQUFJLEdBQUcsTUFBTSxjQUFjLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ25ELE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQTtZQUN0QyxNQUFNLFFBQVEsR0FBRyxTQUFTLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQTtZQUM5RCxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1lBQzdFLDREQUE0RDtZQUM1RCxNQUFNLFVBQVUsR0FBRztnQkFDakIsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLHFCQUFxQixDQUFDLEVBQUUsSUFBSTtnQkFDekMsaUJBQWlCLEVBQUUsSUFBSSxJQUFJLEVBQUU7Z0JBQzdCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQztnQkFDMUIsV0FBVyxFQUFFLFVBQVU7Z0JBQ3ZCLGFBQWEsRUFBRSxjQUFjLENBQUMsWUFBWTtnQkFDMUMsU0FBUyxFQUFFLFFBQVE7Z0JBQ25CLEdBQUcsV0FBVyxDQUFDLE9BQU87YUFDdkIsQ0FBQTtZQUNELE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDcEQsTUFBTSxjQUFjLEdBQUcsaUJBQWlCO2dCQUN0QyxDQUFDLENBQUMsaUJBQWlCLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2dCQUNuRCxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUE7WUFFekIsTUFBTSxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUMvQyxJQUFJLENBQUM7b0JBQ0gsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxFQUFFLGNBQWMsQ0FBQyxDQUFBO29CQUU3RSxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQzt3QkFDdkIsSUFBSSxFQUFFOzRCQUNKLFVBQVUsRUFBRSxJQUFJOzRCQUNoQixLQUFLLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQzt5QkFDeEY7d0JBQ0QsT0FBTyxFQUFFLHNCQUFzQjt3QkFDL0IsTUFBTSxFQUFFLEVBQUMsR0FBRyxXQUFXLENBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxjQUFjLENBQUMsWUFBWSxFQUFDO3FCQUMzRSxDQUFDLENBQUE7b0JBRUYsSUFBSSxjQUFjLENBQUMsVUFBVSxFQUFFLENBQUM7d0JBQzlCLE1BQU0seUJBQXlCLENBQUM7NEJBQzlCLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxZQUFZLEVBQUUsY0FBYyxDQUFDLFlBQVksRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFDOzRCQUN6RyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRTs0QkFDL0IsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVO3lCQUN0QyxDQUFDLENBQUE7b0JBQ0osQ0FBQztnQkFDSCxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO2dCQUNqRSxDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBQyxNQUFNLEVBQUUsY0FBYyxFQUFDO1FBQ2pELDRDQUE0QztRQUM1QyxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUE7UUFDbEIsNENBQTRDO1FBQzVDLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixLQUFLLE1BQU0sY0FBYyxJQUFJLGNBQWMsQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUN0RCw0Q0FBNEM7WUFDNUMsSUFBSSxRQUFRLENBQUE7WUFFWixJQUFJLGNBQWMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDNUIsUUFBUSxHQUFHLE1BQU0sY0FBYyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNsRCxDQUFDO2lCQUFNLElBQUksY0FBYyxDQUFDLGVBQWUsRUFBRSxDQUFDO2dCQUMxQyxRQUFRLEdBQUcsTUFBTSxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsZUFBZSxDQUFDLENBQUE7WUFDakUsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLFFBQVEsR0FBRyxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUE7WUFDeEIsQ0FBQztZQUVELE1BQU0sS0FBSyxHQUFHLFFBQVEsS0FBSyxTQUFTLElBQUksUUFBUSxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFbkYsT0FBTyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsR0FBRyxLQUFLLENBQUE7WUFDMUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxjQUFjLENBQUMsR0FBRyxLQUFLLENBQUE7UUFDL0MsQ0FBQztRQUVELE9BQU8sRUFBQyxPQUFPLEVBQUUsTUFBTSxFQUFDLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsa0JBQWtCLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFDO1FBQ3RFLDREQUE0RDtRQUM1RCxNQUFNLEtBQUssR0FBRztZQUNaLElBQUk7WUFDSixFQUFFLEVBQUUsT0FBTyxDQUFDLEVBQUUsRUFBRTtZQUNoQixVQUFVO1lBQ1YsWUFBWSxFQUFFLGNBQWMsQ0FBQyxZQUFZO1lBQ3pDLGNBQWMsRUFBRSxPQUFPLENBQUMsY0FBYyxFQUFFO1lBQ3hDLFFBQVE7WUFDUixTQUFTLEVBQUUsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsQ0FBQztTQUN4QyxDQUFBO1FBRUQsTUFBTSxlQUFlLEdBQUcsMkJBQTJCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUUxRSxLQUFLLE1BQU0sY0FBYyxJQUFJLGVBQWUsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUNuRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUE7WUFFN0MsSUFBSSxPQUFPLGFBQWEsS0FBSyxVQUFVLEVBQUUsQ0FBQztnQkFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQyw2REFBNkQsY0FBYyxLQUFLLENBQUMsQ0FBQTtZQUNuRyxDQUFDO1lBRUQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDckQsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTO1FBQ3hFLE1BQU0sWUFBWSxHQUFHLE1BQU0sU0FBUzthQUNqQyxLQUFLLENBQUM7WUFDTCxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsRUFBRSxJQUFJO1lBQ3pDLFdBQVcsRUFBRSxVQUFVLENBQUMsV0FBVztZQUNuQyxhQUFhLEVBQUUsVUFBVSxDQUFDLGFBQWE7U0FDeEMsQ0FBQzthQUNELEtBQUssRUFBRSxDQUFBO1FBRVYsT0FBTyxNQUFNLGFBQWEsQ0FBQyxFQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtJQUNuRSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxXQUFXO1FBQ1QsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVc7WUFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFBO1FBRTNELE9BQU8sS0FBSyxFQUFFLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUMsRUFBRSxFQUFFO1lBQ3ZDLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7WUFDbkUsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBQzFELENBQUMsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLO1FBQ2hDLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUUxQixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBQzlELE1BQU0sT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLEVBQUMsS0FBSyxFQUFFLDJCQUEyQixFQUFDLEVBQUUsS0FBSyxFQUFDLENBQUE7UUFFdEUsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7UUFFekUsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLHdFQUF3RSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQzVHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNO1FBQ0osSUFBSSxDQUFDLE9BQU8sS0FBSyxJQUFJLE1BQU0sQ0FBQyxlQUFlLEVBQUUsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBRXhGLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQTtJQUNyQixDQUFDO0NBQ0Y7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLHFCQUFxQixDQUFDLFVBQVU7SUFDdkMsTUFBTSxXQUFXLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQTtJQUVuQyxJQUFJLENBQUMsV0FBVyxJQUFJLE9BQU8sV0FBVyxLQUFLLFFBQVEsSUFBSSxXQUFXLENBQUMsT0FBTyxLQUFLLFNBQVMsSUFBSSxXQUFXLENBQUMsT0FBTyxLQUFLLEtBQUs7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUV0SSxPQUFPLFdBQVcsQ0FBQyxPQUFPLENBQUE7QUFDNUIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsb0NBQW9DLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxtQkFBbUIsRUFBRSxTQUFTLEVBQUM7SUFDbEgsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLFlBQVksRUFBRSxDQUFBO0lBQzNDLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUE7SUFFekQsSUFBSSxDQUFDLGlCQUFpQixJQUFJLE9BQU8saUJBQWlCLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO1FBQ3BHLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLGtGQUFrRixNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ2xJLENBQUM7SUFFRCxNQUFNLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsR0FBRyxlQUFlLEVBQUMsR0FBRyxpQkFBaUIsQ0FBQTtJQUN6SCxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO0lBRWhELElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUywrQ0FBK0MsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsc0dBQXNHLENBQUMsQ0FBQTtJQUMxTSxDQUFDO0lBQ0QsSUFBSSxTQUFTLEtBQUssU0FBUyxJQUFJLE9BQU8sU0FBUyxLQUFLLFVBQVUsRUFBRSxDQUFDO1FBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLDBGQUEwRixNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQzVJLENBQUM7SUFDRCxJQUFJLFVBQVUsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM3QixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLG9GQUFvRixDQUFDLENBQUE7UUFDbkgsQ0FBQztRQUVELEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLENBQUMsU0FBUyxJQUFJLHdCQUF3QixDQUFDLEVBQUUsQ0FBQztnQkFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFNBQVMsdUVBQXVFLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDekgsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTztRQUNMLFVBQVU7UUFDVixVQUFVO1FBQ1YsVUFBVSxFQUFFLFVBQVUsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLDRCQUE0QixDQUFDLENBQUMsQ0FBQyxVQUFVO1FBQ2hGLFlBQVksRUFBRSxZQUFZLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFlBQVk7UUFDbkUsU0FBUyxFQUFFLFlBQVksQ0FBQyxFQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsbUJBQW1CLEVBQUMsQ0FBQztRQUMxRyxTQUFTLEVBQUUsU0FBUyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxDQUFDLFNBQVM7S0FDN0UsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsU0FBUyxZQUFZLENBQUMsRUFBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLG1CQUFtQixFQUFDO0lBQ3JHLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLCtCQUErQixFQUFFLENBQUMsQ0FBQTtJQUVsRixJQUFJLE9BQU8sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMxQixJQUFJLGVBQWUsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyx5RkFBeUYsQ0FBQyxDQUFBO1FBQ3hILENBQUM7UUFDRCxJQUFJLE9BQU8sT0FBTyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ2xDLE9BQU8sQ0FBQyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBQ3hHLENBQUM7UUFDRCxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ2hDLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLDJHQUEyRyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNKLENBQUM7UUFDRCxJQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLHNFQUFzRSxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBQzlHLENBQUM7UUFFRCxPQUFPLENBQUMsRUFBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtJQUM3RyxDQUFDO0lBRUQsSUFBSSxlQUFlLEtBQUssU0FBUyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUMxRCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyx5R0FBeUcsQ0FBQyxDQUFBO0lBQ3hJLENBQUM7SUFFRCxJQUFJLENBQUMsbUJBQW1CO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFbkMsSUFBSSxlQUFlLEtBQUssU0FBUyxJQUFJLENBQUMsT0FBTyxlQUFlLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQzdHLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLG1IQUFtSCxNQUFNLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQzNLLENBQUM7SUFFRCxLQUFLLE1BQU0sY0FBYyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7UUFDaEUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLDBFQUEwRSxjQUFjLDhCQUE4QixtQkFBbUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3RMLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsQ0FBQyxjQUFjLEVBQUUsRUFBRTtRQUNoRCxNQUFNLHVCQUF1QixHQUFHLGVBQWUsRUFBRSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRWpFLElBQUksdUJBQXVCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDMUMsSUFBSSxPQUFPLHVCQUF1QixLQUFLLFFBQVEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsdUJBQXVCLENBQUMsRUFBRSxDQUFDO2dCQUNyRyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsU0FBUyx3Q0FBd0MsY0FBYyxpREFBaUQsTUFBTSxDQUFDLHVCQUF1QixDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQ3ZLLENBQUM7WUFFRCxPQUFPLEVBQUMsVUFBVSxFQUFFLG1CQUFtQixDQUFDLEVBQUMsY0FBYyxFQUFFLFNBQVMsRUFBQyxDQUFDLEVBQUUsZUFBZSxFQUFFLHVCQUF1QixFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsY0FBYyxFQUFDLENBQUE7UUFDdEosQ0FBQztRQUVELE9BQU87WUFDTCxVQUFVLEVBQUUsbUJBQW1CLENBQUMsRUFBQyxjQUFjLEVBQUUsU0FBUyxFQUFDLENBQUM7WUFDNUQsZUFBZSxFQUFFLGNBQWMsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsSUFBSTtZQUNoRixRQUFRLEVBQUUsU0FBUztZQUNuQixjQUFjO1NBQ2YsQ0FBQTtJQUNILENBQUMsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG1CQUFtQixDQUFDLEVBQUMsY0FBYyxFQUFFLFNBQVMsRUFBQztJQUN0RCxNQUFNLFVBQVUsR0FBRyxTQUFTLENBQUMsK0JBQStCLEVBQUUsQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUU5RSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFNBQVMsQ0FBQyxJQUFJLHNDQUFzQyxjQUFjLG9DQUFvQyxDQUFDLENBQUE7SUFDNUgsQ0FBQztJQUVELE9BQU8sVUFBVSxDQUFBO0FBQ25CLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsMkJBQTJCLENBQUMsTUFBTTtJQUN6Qyw0REFBNEQ7SUFDNUQsTUFBTSxVQUFVLEdBQUcsRUFBQyxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxDQUFBO0lBRTNDLEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7UUFDaEUsSUFBSSxLQUFLLFlBQVksSUFBSTtZQUFFLFVBQVUsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDNUUsQ0FBQztJQUVELE9BQU8sVUFBVSxDQUFBO0FBQ25CLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLE9BQU8sQ0FBQyxLQUFLO0lBQ3BCLElBQUksQ0FBQyxDQUFDLEtBQUssWUFBWSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFFLENBQUM7UUFDOUQsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFBO0lBQzlFLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtBQUM1QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBDb25maWd1cmF0aW9uIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuaW1wb3J0IHtkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXN9IGZyb20gXCIuL3N5bmMtc2NvcGUtYXR0cmlidXRlcy5qc1wiXG5pbXBvcnQge2RlbGl2ZXJEZWNsYXJlZEJyb2FkY2FzdHMsIHVwc2VydFN5bmNSb3d9IGZyb20gXCIuL3N5bmMtY2hhbmdlLWZhbm91dC5qc1wiXG5pbXBvcnQge2lzUHVibGlzaGluZ1N1cHByZXNzZWR9IGZyb20gXCIuL3N5bmMtcHVibGlzaC1zdXBwcmVzc2lvbi5qc1wiXG5pbXBvcnQge1ZFTE9DSU9VU19TWU5DX0NIQU5ORUx9IGZyb20gXCIuL3N5bmMtY2hhbm5lbC1uYW1lLmpzXCJcblxuLyoqIEB0eXBlIHt7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwifX0gKi9cbmNvbnN0IFBVQkxJU0hFRF9DQUxMQkFDS19OQU1FUyA9IHtjcmVhdGU6IFwiYWZ0ZXJDcmVhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIiwgdXBkYXRlOiBcImFmdGVyVXBkYXRlXCJ9XG5cbi8qKlxuICogT3BlcmF0aW9ucyBwdWJsaXNoZWQgYnkgZGVmYXVsdCBmb3IgbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHB1Ymxpc2hcbiAqIHdpdGhvdXQgYW4gYG9wZXJhdGlvbnNgIGtleTogc2VydmVyLXNpZGUgY3JlYXRlcyBhbmQgdXBkYXRlcyBwdWJsaXNoXG4gKiBhdXRvbWF0aWNhbGx5LiBEZXN0cm95cyBhcmUgbm90IHB1Ymxpc2hlZCBieSBkZWZhdWx0IGJlY2F1c2UgYSBzZXJ2ZXJcbiAqIGRlc3Ryb3kgaXMgb2Z0ZW4gY2xlYW51cCByYXRoZXIgdGhhbiBhIHN5bmNlZCBkZWxldGU7IG9wdCBpbiB3aXRoIGFuXG4gKiBvcGVyYXRpb25zIGxpc3QuXG4gKiBAdHlwZSB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59ICovXG5jb25zdCBERUZBVUxUX1BVQkxJU0hFRF9PUEVSQVRJT05TID0gW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxDb25maWd1cmF0aW9uLCBTeW5jUHVibGlzaGVyPn0gKi9cbmNvbnN0IHN0YXJ0ZWRQdWJsaXNoZXJzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIERlY2xhcmF0aXZlIHNlcnZlci1zaWRlIHN5bmMgcHVibGlzaGVyIOKAlCB0aGUgc2VydmVyIG1pcnJvciBvZiB0aGUgY2xpZW50J3NcbiAqIHRyYWNrLWJ5LWRlZmF1bHQgbXV0YXRpb24gdHJhY2tpbmcuXG4gKlxuICogU2VydmVyIG1vZGVscyBkZWNsYXJlIHdoYXQgdG8gcHVibGlzaCB0aHJvdWdoIGBzdGF0aWMgc3luY2AncyBgcHVibGlzaGBcbiAqIGtleSwgYW5kIFZlbG9jaW91cyB3cml0ZXMgZXZlcnkgY29tbWl0dGVkIHNlcnZlci1zaWRlIGNoYW5nZSB0byB0aGUgc3luY1xuICogY2hhbmdlIGZlZWQgKG1vZGVsLWJhY2tlZCBTeW5jLXJvdyB1cHNlcnQgd2l0aCBzZXJ2ZXIgcmUtc2VxdWVuY2luZykgYW5kXG4gKiBicm9hZGNhc3RzIHRoZSBzdGFuZGFyZCBzeW5jIGVudmVsb3BlIChge2VjaG9PcmlnaW4sIHN5bmNzOiBbLi4uXX1gKSBvbiB0aGVcbiAqIGZyYW1ld29yayBzeW5jIGNoYW5uZWwgKHtAbGluayBWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSkgc2NvcGVkIGJ5IHRoZVxuICogY2hhbmdlJ3MgZGVyaXZlZCBzY29wZS1wYXJ0aXRpb24gdmFsdWVzLCBzbyBkZXZpY2VzIHJlY2VpdmUgc2VydmVyLW9yaWdpblxuICogY2hhbmdlcyB3aXRob3V0IGFwcCBjb2RlIGRlY2xhcmluZyBjaGFubmVscyBvciBjYWxsaW5nIG1hbnVhbFxuICogdXBzZXJ0L2Jyb2FkY2FzdCBoZWxwZXJzOlxuICpcbiAqICAgICBzdGF0aWMgc3luYyA9IHtwdWJsaXNoOiB0cnVlfSAvLyBkZWZhdWx0IHBheWxvYWQgKGF0dHJpYnV0ZXMpICsgZGVmYXVsdCBzY29wZSBwYXJ0aXRpb25cbiAqICAgICBzdGF0aWMgc3luYyA9IHtwdWJsaXNoOiB7c2VyaWFsaXplOiAocmVjb3JkKSA9PiAoe2lkOiByZWNvcmQuaWQoKSwgcGluOiByZWNvcmQucGluKCl9KX19XG4gKlxuICogVGhlIHNjb3BlIHBhcnRpdGlvbiBjb21lcyBmcm9tIHRoZSBzeW5jIG1vZGVsJ3MgYHN0YXRpY1xuICogc3luY1Njb3BlQXR0cmlidXRlc2AgZGVjbGFyYXRpb24gKGZvciBleGFtcGxlIGBbXCJldmVudElkXCJdYCBvclxuICogYFtcImFjY291bnRJZFwiXWAg4oCUIFZlbG9jaW91cyBoYXMgbm8gYnVpbHQtaW4gcGFydGl0aW9uIG5hbWUpOiBlYWNoIGRlY2xhcmVkXG4gKiBzY29wZSBhdHRyaWJ1dGUgcmVhZHMgdGhlIHJlY29yZCdzIGF0dHJpYnV0ZSBvZiB0aGUgc2FtZSBuYW1lIHdoZW4gdGhlXG4gKiBtb2RlbCBoYXMgb25lLCBlbHNlIHRoZSByZWNvcmQncyBvd24gaWQgKHNjb3BlLXJvb3QgbW9kZWxzKSwgb3ZlcnJpZGFibGVcbiAqIHBlciBtb2RlbCB0aHJvdWdoIGBwdWJsaXNoOiB7c2NvcGVBdHRyaWJ1dGVzOiB7YWNjb3VudElkOiBcIm93bmVySWRcIn19YC5cbiAqIFRoZSBwcmUtZnJhbWV3b3JrLWNoYW5uZWwgYGJyb2FkY2FzdHNgIGxpc3QgYW5kIHRoZSBgZXZlbnRJZGBcbiAqIHN0cmluZy9yZXNvbHZlci1mdW5jdGlvbiBkZWNsYXJhdGlvbiBmb3JtcyBrZWVwIHdvcmtpbmcgYnV0IGFyZSBkZXByZWNhdGVkLlxuICpcbiAqIFJlcGxheWVkIGRldmljZSBtdXRhdGlvbnMgbmV2ZXIgZG91YmxlLXB1Ymxpc2g6IHRoZSBmcmFtZXdvcmsncyByb3V0ZWRcbiAqIHJlcGxheSBhcHBseSBtYXJrcyBpdHMgd3JpdHRlbiByZWNvcmRzIHRocm91Z2ggYG1hcmtTZXJ2ZXJBcHBseShyZWNvcmQpYFxuICogKHNlZSBzeW5jLXB1Ymxpc2gtc3VwcHJlc3Npb24uanMpLCBhbmQgYXBwIGNvZGUgYXBwbHlpbmcgYWxyZWFkeS1zeW5jZWRcbiAqIGRhdGEgY2FuIHVzZSBgbWFya1NlcnZlckFwcGx5YC9gd2l0aG91dFB1Ymxpc2hpbmdgIHRoZSBzYW1lIHdheS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY1B1Ymxpc2hlciB7XG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMgcHVibGlzaGVyIGJ5IGRlcml2aW5nIHB1Ymxpc2hlZCByZXNvdXJjZXMgZnJvbSB0aGVcbiAgICogY29uZmlndXJhdGlvbidzIHJlZ2lzdGVyZWQgbW9kZWxzOiBldmVyeSBtb2RlbCBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYFxuICAgKiB3aXRoIGEgYHB1Ymxpc2hgIGRlY2xhcmF0aW9uIGJlY29tZXMgYSBwdWJsaXNoZWQgcmVzb3VyY2VcbiAgICogKGBwdWJsaXNoOiBmYWxzZWAgb3B0cyBvdXQpLiBUaGUgc3luYy9jaGFuZ2UgbW9kZWwgaXMgdGhlIHJlZ2lzdGVyZWRcbiAgICogXCJTeW5jXCIgbW9kZWwgYW5kIGJyb2FkY2FzdHMgZGVmYXVsdCB0byB0aGUgY29uZmlndXJhdGlvbidzIGNoYW5uZWxcbiAgICogYnJvYWRjYXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnN9IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHthY3RvckZvcmVpZ25LZXlDb2x1bW4gPSBcImF1dGhlbnRpY2F0aW9uX3Rva2VuX2lkXCIsIGJyb2FkY2FzdGVyLCBjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9uRXJyb3IsIHN5bmNNb2RlbCwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0T3B0aW9ucylcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCBwdWJsaXNoaW5nTW9kZWxDbGFzc2VzID0gT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzZXMpLmZpbHRlcigobW9kZWxDbGFzcykgPT4gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpKVxuXG4gICAgaWYgKHB1Ymxpc2hpbmdNb2RlbENsYXNzZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jUHVibGlzaGVyIGZvdW5kIG5vIHJlZ2lzdGVyZWQgbW9kZWxzIGRlY2xhcmluZyBzdGF0aWMgc3luYyBwdWJsaXNoIC0gZGVjbGFyZSBgc3RhdGljIHN5bmMgPSB7cHVibGlzaDoge3NlcmlhbGl6ZX19YCBvbiB0aGUgbW9kZWxzIHdob3NlIHNlcnZlci1zaWRlIGNoYW5nZXMgc2hvdWxkIHB1Ymxpc2ggdG8gdGhlIHN5bmMgZmVlZFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkU3luY01vZGVsID0gc3luY01vZGVsIHx8IG1vZGVsQ2xhc3Nlcy5TeW5jXG5cbiAgICBpZiAoIXJlc29sdmVkU3luY01vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jUHVibGlzaGVyIHJlcXVpcmVzIGEgcmVnaXN0ZXJlZCBcXFwiU3luY1xcXCIgbW9kZWwgZm9yIHB1Ymxpc2hlZCBzeW5jIGNoYW5nZSByb3dzIChvciBwYXNzIG9wdGlvbnMuc3luY01vZGVsKVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlQXR0cmlidXRlcyA9IGRlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlcyhyZXNvbHZlZFN5bmNNb2RlbClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnPn0gKi9cbiAgICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIHB1Ymxpc2hpbmdNb2RlbENsYXNzZXMpIHtcbiAgICAgIGNvbnN0IHB1Ymxpc2ggPSBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcylcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gcmVzb3VyY2VDb25maWdGcm9tUHVibGlzaERlY2xhcmF0aW9uKHttb2RlbENsYXNzLCBwdWJsaXNoLCBzY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWx9KVxuXG4gICAgICByZXNvdXJjZXNbcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlXSA9IHJlc291cmNlQ29uZmlnXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHt7YWN0b3JGb3JlaWduS2V5Q29sdW1uOiBzdHJpbmcsIGJyb2FkY2FzdGVyOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wiYnJvYWRjYXN0ZXJcIl0sIGNvbmZpZ3VyYXRpb246IENvbmZpZ3VyYXRpb24sIG9uRXJyb3I6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnNbXCJvbkVycm9yXCJdLCByZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnPiwgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovXG4gICAgdGhpcy5jb25maWcgPSB7YWN0b3JGb3JlaWduS2V5Q29sdW1uLCBicm9hZGNhc3RlciwgY29uZmlndXJhdGlvbiwgb25FcnJvciwgcmVzb3VyY2VzLCBzeW5jTW9kZWw6IHJlc29sdmVkU3luY01vZGVsfVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2NhbGxiYWNrOiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPiwgY2FsbGJhY2tOYW1lOiBcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiLCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtMb2dnZXIgfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvZ2dlciA9IG51bGxcbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzeW5jIHB1Ymxpc2hlciBkZXJpdmVkIGZyb20gdGhlIGdpdmVuIGNvbmZpZ3VyYXRpb24uIEFsaWFzIGZvclxuICAgKiBgbmV3IFN5bmNQdWJsaXNoZXIoe2NvbmZpZ3VyYXRpb24sIC4uLm9wdGlvbnN9KWAuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzLiBEZWZhdWx0cyB0byB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge09taXQ8aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9ucywgXCJjb25maWd1cmF0aW9uXCI+fSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqIEByZXR1cm5zIHtTeW5jUHVibGlzaGVyfSBTeW5jIHB1Ymxpc2hlciBkZXJpdmVkIGZyb20gdGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgZnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gbmV3IFN5bmNQdWJsaXNoZXIoey4uLm9wdGlvbnMsIGNvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyAoYW5kIG1lbW9pemVzIHBlciBjb25maWd1cmF0aW9uKSB0aGUgc3luYyBwdWJsaXNoZXIgZm9yIGEgc2VydmVyXG4gICAqIGJvb3Q6IG5vLW9wIHdoZW4gbm8gcmVnaXN0ZXJlZCBtb2RlbCBkZWNsYXJlcyBhIHB1Ymxpc2ggY29uZmlnLCBndWFyZGVkIHNvXG4gICAqIHJlcGVhdGVkIGJvb3RzIHdpdGggdGhlIHNhbWUgY29uZmlndXJhdGlvbiByZWdpc3RlciB0aGUgcHVibGlzaCBjYWxsYmFja3NcbiAgICogb25seSBvbmNlLlxuICAgKiBAcGFyYW0ge0NvbmZpZ3VyYXRpb259IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNQdWJsaXNoZXIgfCBudWxsPn0gU3RhcnRlZCBwdWJsaXNoZXIsIG9yIG51bGwgd2hlbiBubyBtb2RlbHMgZGVjbGFyZSBwdWJsaXNoLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHN0YXJ0RnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHN0YXJ0ZWRQdWJsaXNoZXIgPSBzdGFydGVkUHVibGlzaGVyc0J5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICAgIGlmIChzdGFydGVkUHVibGlzaGVyKSByZXR1cm4gc3RhcnRlZFB1Ymxpc2hlclxuXG4gICAgaWYgKCFPYmplY3QudmFsdWVzKGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKCkpLnNvbWUoKG1vZGVsQ2xhc3MpID0+IHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKSkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwdWJsaXNoZXIgPSBuZXcgU3luY1B1Ymxpc2hlcih7Y29uZmlndXJhdGlvbn0pXG5cbiAgICBzdGFydGVkUHVibGlzaGVyc0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgcHVibGlzaGVyKVxuICAgIGF3YWl0IHB1Ymxpc2hlci5zdGFydCgpXG5cbiAgICByZXR1cm4gcHVibGlzaGVyXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoZSBwdWJsaXNoIGNhbGxiYWNrcyBmb3IgZXZlcnkgcHVibGlzaGVkIHJlc291cmNlOiBzZXJ2ZXItc2lkZVxuICAgKiBjcmVhdGVzIGFuZCB1cGRhdGVzIChkZXN0cm95cyB3aGVuIG9wdGVkIGluKSB1cHNlcnQgYSBzeW5jIGNoYW5nZSByb3cgYW5kXG4gICAqIGZhbiBvdXQgdGhlIGRlY2xhcmVkIGJyb2FkY2FzdHMgb25jZSB0aGVpciB0cmFuc2FjdGlvbiBjb21taXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIGlmICh0aGlzLl9zdGFydGVkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0ZWQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IHJlc291cmNlQ29uZmlnIG9mIE9iamVjdC52YWx1ZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgcmVzb3VyY2VDb25maWcub3BlcmF0aW9ucykge1xuICAgICAgICBjb25zdCBjYWxsYmFja05hbWUgPSBQVUJMSVNIRURfQ0FMTEJBQ0tfTkFNRVNbb3BlcmF0aW9uXVxuICAgICAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMucHVibGlzaGVkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgICAgcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc1tjYWxsYmFja05hbWVdKGNhbGxiYWNrKVxuICAgICAgICB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MucHVzaCh7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzczogcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc30pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFsbCBwdWJsaXNoIGNhbGxiYWNrcyAodGVzdHMsIHNodXRkb3duKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdG9wKCkge1xuICAgIGZvciAoY29uc3Qge2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3N9IG9mIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcykge1xuICAgICAgbW9kZWxDbGFzcy51bnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MgPSBbXVxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbGlmZWN5Y2xlIGNhbGxiYWNrIHB1Ymxpc2hpbmcgb25lIHNlcnZlci1zaWRlIG11dGF0aW9uLiBUaGVcbiAgICogcHVibGlzaGVkIHBheWxvYWQgKGRlY2xhcmF0aW9uIGBzZXJpYWxpemVgKSwgZXZlbnQgc2NvcGUsIGFuZCBzeW5jIHR5cGVcbiAgICogYXJlIHNuYXBzaG90dGVkIGF0IG11dGF0aW9uLWNhbGxiYWNrIHRpbWUsIHNvIGFmdGVyU2F2ZSBob29rcyBhc3NpZ25pbmdcbiAgICogdW5zYXZlZCBhdHRyaWJ1dGVzIChvciBhbnkgbGF0ZXIgZHJpZnQgb24gdGhlIHJlY29yZCkgY2Fubm90IGNoYW5nZSB3aGF0XG4gICAqIGdldHMgcHVibGlzaGVkIHZzIHdoYXQgd2FzIGNvbW1pdHRlZC4gUGVyc2lzdGluZyBhbmQgYnJvYWRjYXN0aW5nIGFyZVxuICAgKiBkZWZlcnJlZCB0aHJvdWdoIHRoZSBtb2RlbCBjb25uZWN0aW9uJ3MgYWZ0ZXJDb21taXQgaG9vayBzbyB0aGV5IG9ubHkgcnVuXG4gICAqIG9uY2UgdGhlIG11dGF0aW9uJ3MgdHJhbnNhY3Rpb24gaGFzIGNvbW1pdHRlZCAoaW1tZWRpYXRlbHkgd2hlbiBub1xuICAgKiB0cmFuc2FjdGlvbiBpcyBvcGVuKSAtIHJvbGxlZC1iYWNrIG11dGF0aW9ucyBuZXZlciBwdWJsaXNoLiBQb3N0LWNvbW1pdFxuICAgKiBwdWJsaXNoIGZhaWx1cmVzIGFyZSByZXBvcnRlZCB3aXRob3V0IHJldGhyb3dpbmcgaW50byB0aGUgZHJpdmVyJ3NcbiAgICogYWZ0ZXJDb21taXQgY2hhaW4gKHNlZSByZXBvcnRBZnRlckNvbW1pdEVycm9yKS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9fSBhcmdzIC0gT3BlcmF0aW9uIGFuZCByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHsocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPn0gTGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKi9cbiAgcHVibGlzaGVkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKGlzUHVibGlzaGluZ1N1cHByZXNzZWQocmVjb3JkKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNvdXJjZUNvbmZpZy5zZXJpYWxpemUocmVjb3JkKVxuICAgICAgY29uc3QgcmVzb3VyY2VJZCA9IFN0cmluZyhyZWNvcmQuaWQoKSlcbiAgICAgIGNvbnN0IHN5bmNUeXBlID0gb3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIiA/IFwiZGVsZXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgICBjb25zdCBzY29wZVZhbHVlcyA9IGF3YWl0IHRoaXMucHVibGlzaGVkU2NvcGVWYWx1ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0ge1xuICAgICAgICBbdGhpcy5jb25maWcuYWN0b3JGb3JlaWduS2V5Q29sdW1uXTogbnVsbCxcbiAgICAgICAgY2xpZW50X3VwZGF0ZWRfYXQ6IG5ldyBEYXRlKCksXG4gICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgICAgICByZXNvdXJjZV9pZDogcmVzb3VyY2VJZCxcbiAgICAgICAgcmVzb3VyY2VfdHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlLFxuICAgICAgICBzeW5jX3R5cGU6IHN5bmNUeXBlLFxuICAgICAgICAuLi5zY29wZVZhbHVlcy5jb2x1bW5zXG4gICAgICB9XG4gICAgICBjb25zdCBkYXRhYmFzZU9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG4gICAgICBjb25zdCBvcGVyYXRpb25TY29wZSA9IGRhdGFiYXNlT3BlcmF0aW9uXG4gICAgICAgID8gZGF0YWJhc2VPcGVyYXRpb24uZm9yTW9kZWwodGhpcy5jb25maWcuc3luY01vZGVsKVxuICAgICAgICA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuXG4gICAgICBhd2FpdCByZWNvcmQuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBzeW5jUm93ID0gYXdhaXQgdGhpcy51cHNlcnRQdWJsaXNoZWRTeW5jUm93KGF0dHJpYnV0ZXMsIG9wZXJhdGlvblNjb3BlKVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5icm9hZGNhc3RlcigpKHtcbiAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgZWNob09yaWdpbjogbnVsbCxcbiAgICAgICAgICAgICAgc3luY3M6IFt0aGlzLnB1Ymxpc2hlZFN5bmNFbnRyeSh7ZGF0YSwgcmVzb3VyY2VDb25maWcsIHJlc291cmNlSWQsIHN5bmNSb3csIHN5bmNUeXBlfSldXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY2hhbm5lbDogVkVMT0NJT1VTX1NZTkNfQ0hBTk5FTCxcbiAgICAgICAgICAgIHBhcmFtczogey4uLnNjb3BlVmFsdWVzLnBhcmFtcywgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5icm9hZGNhc3RzKSB7XG4gICAgICAgICAgICBhd2FpdCBkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzKHtcbiAgICAgICAgICAgICAgYXJnczoge2RhdGEsIG9wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGU6IHJlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZSwgc3luY1Jvdywgc3luY1R5cGV9LFxuICAgICAgICAgICAgICBicm9hZGNhc3RlcjogdGhpcy5icm9hZGNhc3RlcigpLFxuICAgICAgICAgICAgICBicm9hZGNhc3RzOiByZXNvdXJjZUNvbmZpZy5icm9hZGNhc3RzXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNjb3BlLXBhcnRpdGlvbiB2YWx1ZXMgZm9yIG9uZSBwdWJsaXNoZWQgbXV0YXRpb24gZnJvbSB0aGVcbiAgICogcmVzb3VyY2UncyBkZXJpdmVkIHNjb3BlIHBsYW46IGVhY2ggZW50cnkgcmVhZHMgaXRzIHJlY29yZCBhdHRyaWJ1dGUgKG9yXG4gICAqIHRoZSByZWNvcmQncyBvd24gaWQgZm9yIHNjb3BlLXJvb3QgbW9kZWxzLCBvciB0aGUgZGVwcmVjYXRlZCByZXNvbHZlclxuICAgKiBmdW5jdGlvbikuIFRoZSB2YWx1ZXMgYXJlIHBlcnNpc3RlZCBvbnRvIHRoZSBzeW5jIHJvdydzIHBhcnRpdGlvbiBjb2x1bW5zXG4gICAqIGFuZCBicm9hZGNhc3QgYXMgdGhlIGZyYW1ld29yayBzeW5jIGNoYW5uZWwncyBzY29waW5nIHBhcmFtcy5cbiAgICogQHBhcmFtIHt7cmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfX0gYXJncyAtIE11dGF0ZWQgcmVjb3JkIGFuZCByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb2x1bW5zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPiwgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0+fSBTY29wZSB2YWx1ZXMga2V5ZWQgYnkgc3luYy1yb3cgY29sdW1uIGFuZCBieSBzY29wZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBhc3luYyBwdWJsaXNoZWRTY29wZVZhbHVlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IGNvbHVtbnMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59ICovXG4gICAgY29uc3QgcGFyYW1zID0ge31cblxuICAgIGZvciAoY29uc3Qgc2NvcGVQbGFuRW50cnkgb2YgcmVzb3VyY2VDb25maWcuc2NvcGVQbGFuKSB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgbGV0IHJhd1ZhbHVlXG5cbiAgICAgIGlmIChzY29wZVBsYW5FbnRyeS5yZXNvbHZlcikge1xuICAgICAgICByYXdWYWx1ZSA9IGF3YWl0IHNjb3BlUGxhbkVudHJ5LnJlc29sdmVyKHJlY29yZClcbiAgICAgIH0gZWxzZSBpZiAoc2NvcGVQbGFuRW50cnkucmVjb3JkQXR0cmlidXRlKSB7XG4gICAgICAgIHJhd1ZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUoc2NvcGVQbGFuRW50cnkucmVjb3JkQXR0cmlidXRlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmF3VmFsdWUgPSByZWNvcmQuaWQoKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB2YWx1ZSA9IHJhd1ZhbHVlID09PSB1bmRlZmluZWQgfHwgcmF3VmFsdWUgPT09IG51bGwgPyBudWxsIDogU3RyaW5nKHJhd1ZhbHVlKVxuXG4gICAgICBjb2x1bW5zW3Njb3BlUGxhbkVudHJ5LmNvbHVtbk5hbWVdID0gdmFsdWVcbiAgICAgIHBhcmFtc1tzY29wZVBsYW5FbnRyeS5zY29wZUF0dHJpYnV0ZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiB7Y29sdW1ucywgcGFyYW1zfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCBlbnRyeSBmb3Igb25lIHB1Ymxpc2hlZCBjaGFuZ2U6IHRoZVxuICAgKiBzbmFwc2hvdHRlZCBwYXlsb2FkIHBsdXMgdGhlIHBlcnNpc3RlZCBzeW5jIHJvdydzIHB1YmxpYyBleGFjdC1yb3cgbWV0YWRhdGFcbiAgICogKGlkLCBzZXJ2ZXIgc2VxdWVuY2UsIHVwZGF0ZWQtYXQsIGFuZCBkZWNsYXJlZCBzY29wZS1wYXJ0aXRpb24gYXR0cmlidXRlcykuXG4gICAqIFVzZXMgdGhlIHN5bmMgbW9kZWwncyBnZW5lcmF0ZWQgdHlwZWQgYWNjZXNzb3JzIGFuZCBmb2xsb3dzIHRoZVxuICAgKiBjaGFuZ2UtZmVlZCBzZXJpYWxpemVyJ3MgcHVibGljIGZpZWxkIGNvbnZlbnRpb24uXG4gICAqIEBwYXJhbSB7e2RhdGE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkOiBzdHJpbmcsIHN5bmNSb3c6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzeW5jVHlwZTogc3RyaW5nfX0gYXJncyAtIFB1Ymxpc2ggYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQnJvYWRjYXN0IHN5bmMgZW50cnkuXG4gICAqL1xuICBwdWJsaXNoZWRTeW5jRW50cnkoe2RhdGEsIHJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkLCBzeW5jUm93LCBzeW5jVHlwZX0pIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtcbiAgICAgIGRhdGEsXG4gICAgICBpZDogc3luY1Jvdy5pZCgpLFxuICAgICAgcmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlLFxuICAgICAgc2VydmVyU2VxdWVuY2U6IHN5bmNSb3cuc2VydmVyU2VxdWVuY2UoKSxcbiAgICAgIHN5bmNUeXBlLFxuICAgICAgdXBkYXRlZEF0OiBpc29EYXRlKHN5bmNSb3cudXBkYXRlZEF0KCkpXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVBdHRyaWJ1dGVzID0gZGVjbGFyZWRTeW5jU2NvcGVBdHRyaWJ1dGVzKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcblxuICAgIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2Ygc2NvcGVBdHRyaWJ1dGVzIHx8IFtdKSB7XG4gICAgICBjb25zdCBzY29wZUFjY2Vzc29yID0gc3luY1Jvd1tzY29wZUF0dHJpYnV0ZV1cblxuICAgICAgaWYgKHR5cGVvZiBzY29wZUFjY2Vzc29yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQdWJsaXNoZWQgc3luYyByb3cgaXMgbWlzc2luZyB0aGUgZGVjbGFyZWQgc2NvcGUgYWNjZXNzb3IgJHtzY29wZUF0dHJpYnV0ZX0oKS5gKVxuICAgICAgfVxuXG4gICAgICBlbnRyeVtzY29wZUF0dHJpYnV0ZV0gPSBzY29wZUFjY2Vzc29yLmNhbGwoc3luY1JvdylcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBVcHNlcnRzIHRoZSBwdWJsaXNoZWQgc2VydmVyLW9yaWdpbiBzeW5jIHJvdyBmb3IgYSByZXNvdXJjZSBpZGVudGl0eTpcbiAgICogc2VydmVyLW9yaWdpbiByb3dzIGNhcnJ5IGEgbnVsbCBhY3RvciBjb2x1bW4gKG5vIGRldmljZSB0byBlY2hvIHRoZVxuICAgKiBjaGFuZ2UgYmFjayB0byksIHNvIHJlcGVhdGVkIHNlcnZlciBjaGFuZ2VzIHRvIG9uZSByZXNvdXJjZSByZXVzZSBhbmRcbiAgICogcmUtc2VxdWVuY2Ugb25lIGZlZWQgcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIFNuYXBzaG90dGVkIHN5bmMgcm93IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmNNb2RlbCAtIE9wZXJhdGlvbi1ib3VuZCBvciBzdGF0aWMgU3luYyBtb2RlbCBpbnRlcmZhY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gVXBzZXJ0ZWQgc3luYyByb3cuXG4gICAqL1xuICBhc3luYyB1cHNlcnRQdWJsaXNoZWRTeW5jUm93KGF0dHJpYnV0ZXMsIHN5bmNNb2RlbCA9IHRoaXMuY29uZmlnLnN5bmNNb2RlbCkge1xuICAgIGNvbnN0IGV4aXN0aW5nU3luYyA9IGF3YWl0IHN5bmNNb2RlbFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgW3RoaXMuY29uZmlnLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IG51bGwsXG4gICAgICAgIHJlc291cmNlX2lkOiBhdHRyaWJ1dGVzLnJlc291cmNlX2lkLFxuICAgICAgICByZXNvdXJjZV90eXBlOiBhdHRyaWJ1dGVzLnJlc291cmNlX3R5cGVcbiAgICAgIH0pXG4gICAgICAuZmlyc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBicm9hZGNhc3RlciBkZWxpdmVyaW5nIGRlY2xhcmVkIGJyb2FkY2FzdHM6IHRoZSBpbmplY3RlZCBvbmUsXG4gICAqIG9yIHRoZSBjb25maWd1cmF0aW9uJ3MgY2hhbm5lbCBicm9hZGNhc3QgYXdhaXRlZCB0aHJvdWdoIHRoZSBwZW5kaW5nXG4gICAqIGJyb2FkY2FzdCBxdWV1ZS5cbiAgICogQHJldHVybnMge05vbk51bGxhYmxlPGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnNbXCJicm9hZGNhc3RlclwiXT59IEJyb2FkY2FzdCBkZWxpdmVyZXIuXG4gICAqL1xuICBicm9hZGNhc3RlcigpIHtcbiAgICBpZiAodGhpcy5jb25maWcuYnJvYWRjYXN0ZXIpIHJldHVybiB0aGlzLmNvbmZpZy5icm9hZGNhc3RlclxuXG4gICAgcmV0dXJuIGFzeW5jICh7Ym9keSwgY2hhbm5lbCwgcGFyYW1zfSkgPT4ge1xuICAgICAgdGhpcy5jb25maWcuY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoY2hhbm5lbCwgcGFyYW1zLCBib2R5KVxuICAgICAgYXdhaXQgdGhpcy5jb25maWcuY29uZmlndXJhdGlvbi5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIHBvc3QtY29tbWl0IHB1Ymxpc2ggZmFpbHVyZS4gVGhlIHRyYW5zYWN0aW9uIGhhcyBhbHJlYWR5XG4gICAqIGNvbW1pdHRlZCB3aGVuIGFmdGVyQ29tbWl0IGNhbGxiYWNrcyBydW4sIHNvIHJldGhyb3dpbmcgaGVyZSB3b3VsZCBwb2lzb25cbiAgICogdGhlIGRyaXZlcidzIGF3YWl0ZWQgYWZ0ZXJDb21taXQgY2hhaW4gKGJyZWFraW5nIHVucmVsYXRlZCBjYWxsYmFja3MpIC1cbiAgICogaW5zdGVhZCB0aGUgZmFpbHVyZSBnb2VzIHRvIHRoZSBjb25maWd1cmVkIG9uRXJyb3IgaG9vaywgb3IgaXMgZW1pdHRlZCBvblxuICAgKiB0aGUgY29uZmlndXJhdGlvbidzIGZyYW1ld29yay1lcnJvci9hbGwtZXJyb3IgY2hhbm5lbHMgKHNvIHByb2R1Y3Rpb24gYnVnXG4gICAqIHJlcG9ydGluZyB2aWEgYGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKWAgc2VlcyBhIGJyb2tlbiBwdWJsaXNoXG4gICAqIHBhdGgpIGFuZCBsb2dnZWQgbG91ZGx5IHRocm91Z2ggdGhlIHB1Ymxpc2hlcidzIGxvZ2dlciB3aGVuIG5vbmUgaXNcbiAgICogY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBQb3N0LWNvbW1pdCBwdWJsaXNoIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcInN5bmMtcHVibGlzaC1hZnRlci1jb21taXRcIn0sIGVycm9yfVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlcigpLmVycm9yKFwiU3luY1B1Ymxpc2hlciBmYWlsZWQgdG8gcHVibGlzaCBhIHNlcnZlci1zaWRlIHN5bmMgY2hhbmdlIGFmdGVyIGNvbW1pdFwiLCBlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgcHVibGlzaGVyIGxvZ2dlci5cbiAgICogQHJldHVybnMge0xvZ2dlcn0gUHVibGlzaGVyIGxvZ2dlci5cbiAgICovXG4gIGxvZ2dlcigpIHtcbiAgICB0aGlzLl9sb2dnZXIgfHw9IG5ldyBMb2dnZXIoXCJTeW5jUHVibGlzaGVyXCIsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9ufSlcblxuICAgIHJldHVybiB0aGlzLl9sb2dnZXJcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgbW9kZWwgY2xhc3MncyBhY3RpdmUgcHVibGlzaCBkZWNsYXJhdGlvbiBmcm9tIGBzdGF0aWMgc3luY2AuXG4gKiBPcHRlZC1vdXQgKGBwdWJsaXNoOiBmYWxzZWApIGFuZCB1bmRlY2xhcmVkIG1vZGVscyByZXNvbHZlIHRvIG51bGw7IGV2ZXJ5XG4gKiBvdGhlciBkZWNsYXJlZCB2YWx1ZSBmbG93cyBpbnRvIGxvdWQgZGVjbGFyYXRpb24gdmFsaWRhdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1vZGVsQ2xhc3MgLSBSZWdpc3RlcmVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbiB8IG51bGx9IEFjdGl2ZSBwdWJsaXNoIGRlY2xhcmF0aW9uLCBvciBudWxsLlxuICovXG5mdW5jdGlvbiBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcykge1xuICBjb25zdCBkZWNsYXJhdGlvbiA9IG1vZGVsQ2xhc3Muc3luY1xuXG4gIGlmICghZGVjbGFyYXRpb24gfHwgdHlwZW9mIGRlY2xhcmF0aW9uICE9PSBcIm9iamVjdFwiIHx8IGRlY2xhcmF0aW9uLnB1Ymxpc2ggPT09IHVuZGVmaW5lZCB8fCBkZWNsYXJhdGlvbi5wdWJsaXNoID09PSBmYWxzZSkgcmV0dXJuIG51bGxcblxuICByZXR1cm4gZGVjbGFyYXRpb24ucHVibGlzaFxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgcHVibGlzaGVkIHJlc291cmNlIGNvbmZpZyBmcm9tIGEgbW9kZWwncyBgc3RhdGljIHN5bmNgIHB1Ymxpc2hcbiAqIGRlY2xhcmF0aW9uLiBgcHVibGlzaDogdHJ1ZWAgb3B0cyBpbiB3aXRoIGFsbCBkZWZhdWx0cyAoYXR0cmlidXRlIHBheWxvYWQsXG4gKiBkZXJpdmVkIHNjb3BlIHBhcnRpdGlvbiwgY3JlYXRlZC91cGRhdGVkIG9wZXJhdGlvbnMpLlxuICogQHBhcmFtIHt7bW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHB1Ymxpc2g6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbiB8IG51bGwsIHNjb3BlQXR0cmlidXRlczogc3RyaW5nW10gfCBudWxsLCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIERlY2xhcmF0aW9uIGFyZ3MgcGx1cyB0aGUgc3luYyBtb2RlbCdzIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9IERlcml2ZWQgcmVzb3VyY2UgY29uZmlnLlxuICovXG5mdW5jdGlvbiByZXNvdXJjZUNvbmZpZ0Zyb21QdWJsaXNoRGVjbGFyYXRpb24oe21vZGVsQ2xhc3MsIHB1Ymxpc2gsIHNjb3BlQXR0cmlidXRlczogc3luY1Njb3BlQXR0cmlidXRlcywgc3luY01vZGVsfSkge1xuICBjb25zdCBtb2RlbE5hbWUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gIGNvbnN0IG5vcm1hbGl6ZWRQdWJsaXNoID0gcHVibGlzaCA9PT0gdHJ1ZSA/IHt9IDogcHVibGlzaFxuXG4gIGlmICghbm9ybWFsaXplZFB1Ymxpc2ggfHwgdHlwZW9mIG5vcm1hbGl6ZWRQdWJsaXNoICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobm9ybWFsaXplZFB1Ymxpc2gpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBtdXN0IGJlIHRydWUsIGZhbHNlIG9yIGEgcHVibGlzaCBkZWNsYXJhdGlvbiBvYmplY3QsIGdvdDogJHtTdHJpbmcocHVibGlzaCl9YClcbiAgfVxuXG4gIGNvbnN0IHticm9hZGNhc3RzLCBldmVudElkLCBvcGVyYXRpb25zLCByZXNvdXJjZVR5cGUsIHNjb3BlQXR0cmlidXRlcywgc2VyaWFsaXplLCAuLi5yZXN0RGVjbGFyYXRpb259ID0gbm9ybWFsaXplZFB1Ymxpc2hcbiAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0RGVjbGFyYXRpb24pXG5cbiAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHJlY2VpdmVkIHVua25vd24ga2V5czogJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGJyb2FkY2FzdHMsIGV2ZW50SWQgKGRlcHJlY2F0ZWQpLCBvcGVyYXRpb25zLCByZXNvdXJjZVR5cGUsIHNjb3BlQXR0cmlidXRlcywgc2VyaWFsaXplKWApXG4gIH1cbiAgaWYgKHNlcmlhbGl6ZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBzZXJpYWxpemUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2VyaWFsaXplIG11c3QgYmUgYSBmdW5jdGlvbiBidWlsZGluZyB0aGUgcHVibGlzaGVkIHBheWxvYWQsIGdvdDogJHtTdHJpbmcoc2VyaWFsaXplKX1gKVxuICB9XG4gIGlmIChvcGVyYXRpb25zICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob3BlcmF0aW9ucykgfHwgb3BlcmF0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggb3BlcmF0aW9ucyBtdXN0IGJlIGEgbm9uLWVtcHR5IGFycmF5IG9mIGNyZWF0ZS91cGRhdGUvZGVzdHJveWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2Ygb3BlcmF0aW9ucykge1xuICAgICAgaWYgKCEob3BlcmF0aW9uIGluIFBVQkxJU0hFRF9DQUxMQkFDS19OQU1FUykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBvcGVyYXRpb25zIG11c3QgYmUgY3JlYXRlL3VwZGF0ZS9kZXN0cm95LCBnb3Q6ICR7U3RyaW5nKG9wZXJhdGlvbil9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGJyb2FkY2FzdHMsXG4gICAgbW9kZWxDbGFzcyxcbiAgICBvcGVyYXRpb25zOiBvcGVyYXRpb25zID09PSB1bmRlZmluZWQgPyBERUZBVUxUX1BVQkxJU0hFRF9PUEVSQVRJT05TIDogb3BlcmF0aW9ucyxcbiAgICByZXNvdXJjZVR5cGU6IHJlc291cmNlVHlwZSA9PT0gdW5kZWZpbmVkID8gbW9kZWxOYW1lIDogcmVzb3VyY2VUeXBlLFxuICAgIHNjb3BlUGxhbjogc2NvcGVQbGFuRm9yKHtldmVudElkLCBtb2RlbENsYXNzLCBtb2RlbE5hbWUsIHNjb3BlQXR0cmlidXRlcywgc3luY01vZGVsLCBzeW5jU2NvcGVBdHRyaWJ1dGVzfSksXG4gICAgc2VyaWFsaXplOiBzZXJpYWxpemUgPT09IHVuZGVmaW5lZCA/IGRlZmF1bHRTZXJpYWxpemVkQXR0cmlidXRlcyA6IHNlcmlhbGl6ZVxuICB9XG59XG5cbi8qKlxuICogRGVyaXZlcyB0aGUgc2NvcGUgcGxhbiBwYXJ0aXRpb25pbmcgYSBwdWJsaXNoZWQgbW9kZWwncyBjaGFuZ2VzOiBvbmUgZW50cnlcbiAqIHBlciBzY29wZSBhdHRyaWJ1dGUgZGVjbGFyZWQgb24gdGhlIHN5bmMgbW9kZWwgKGBzdGF0aWNcbiAqIHN5bmNTY29wZUF0dHJpYnV0ZXNgKSwgZWFjaCByZWFkaW5nIHRoZSByZWNvcmQgYXR0cmlidXRlIG5hbWVkIGxpa2UgdGhlXG4gKiBzY29wZSBhdHRyaWJ1dGUgKG92ZXJyaWRhYmxlIHRocm91Z2ggdGhlIGRlY2xhcmF0aW9uJ3MgYHNjb3BlQXR0cmlidXRlc2BcbiAqIG5hbWUgbWFwKSwgb3IgdGhlIHJlY29yZCdzIG93biBpZCB3aGVuIHRoZSBtb2RlbCBoYXMgbm8gc3VjaCBhdHRyaWJ1dGVcbiAqIChzY29wZS1yb290IG1vZGVscykuIFRoZSBkZXByZWNhdGVkIGBldmVudElkYCBkZWNsYXJhdGlvbiBmb3JtcyBtYXAgdG8gYVxuICogZml4ZWQgYGV2ZW50SWRgL2BldmVudF9pZGAgcGxhbiBmb3IgMS4wLjUwMyBjb21wYXRpYmlsaXR5LlxuICogQHBhcmFtIHt7ZXZlbnRJZDogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uQ29uZmlnW1wiZXZlbnRJZFwiXSwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1vZGVsTmFtZTogc3RyaW5nLCBzY29wZUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQsIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHN5bmNTY29wZUF0dHJpYnV0ZXM6IHN0cmluZ1tdIHwgbnVsbH19IGFyZ3MgLSBEZWNsYXJhdGlvbiBhbmQgc3luYy1tb2RlbCBzY29wZSBhcmdzLlxuICogQHJldHVybnMge0FycmF5PGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclNjb3BlUGxhbkVudHJ5Pn0gRGVyaXZlZCBzY29wZSBwbGFuLlxuICovXG5mdW5jdGlvbiBzY29wZVBsYW5Gb3Ioe2V2ZW50SWQsIG1vZGVsQ2xhc3MsIG1vZGVsTmFtZSwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWwsIHN5bmNTY29wZUF0dHJpYnV0ZXN9KSB7XG4gIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKSlcblxuICBpZiAoZXZlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGNhbid0IGRlY2xhcmUgYm90aCBzY29wZUF0dHJpYnV0ZXMgYW5kIHRoZSBkZXByZWNhdGVkIGV2ZW50SWQgZm9ybWApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZXZlbnRJZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gW3tjb2x1bW5OYW1lOiBcImV2ZW50X2lkXCIsIHJlY29yZEF0dHJpYnV0ZTogbnVsbCwgcmVzb2x2ZXI6IGV2ZW50SWQsIHNjb3BlQXR0cmlidXRlOiBcImV2ZW50SWRcIn1dXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZXZlbnRJZCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBldmVudElkIG11c3QgYmUgYW4gYXR0cmlidXRlLW5hbWUgc3RyaW5nIChvciBhIGRlcHJlY2F0ZWQgcmVzb2x2ZXIgZnVuY3Rpb24pLCBnb3Q6ICR7U3RyaW5nKGV2ZW50SWQpfWApXG4gICAgfVxuICAgIGlmICghYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoZXZlbnRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggZXZlbnRJZCBhdHRyaWJ1dGUgZG9lc24ndCBleGlzdCBvbiB0aGUgbW9kZWw6ICR7ZXZlbnRJZH1gKVxuICAgIH1cblxuICAgIHJldHVybiBbe2NvbHVtbk5hbWU6IFwiZXZlbnRfaWRcIiwgcmVjb3JkQXR0cmlidXRlOiBldmVudElkLCByZXNvbHZlcjogdW5kZWZpbmVkLCBzY29wZUF0dHJpYnV0ZTogXCJldmVudElkXCJ9XVxuICB9XG5cbiAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkICYmICFzeW5jU2NvcGVBdHRyaWJ1dGVzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBkZWNsYXJlcyBzY29wZUF0dHJpYnV0ZXMgYnV0IHRoZSBzeW5jIG1vZGVsIGRlY2xhcmVzIG5vIHN0YXRpYyBzeW5jU2NvcGVBdHRyaWJ1dGVzYClcbiAgfVxuXG4gIGlmICghc3luY1Njb3BlQXR0cmlidXRlcykgcmV0dXJuIFtdXG5cbiAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2Ygc2NvcGVBdHRyaWJ1dGVzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2NvcGVBdHRyaWJ1dGVzKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdCBtYXBwaW5nIHNjb3BlIGF0dHJpYnV0ZXMgdG8gcmVjb3JkIGF0dHJpYnV0ZSBuYW1lcywgZ290OiAke1N0cmluZyhzY29wZUF0dHJpYnV0ZXMpfWApXG4gIH1cblxuICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIE9iamVjdC5rZXlzKHNjb3BlQXR0cmlidXRlcyB8fCB7fSkpIHtcbiAgICBpZiAoIXN5bmNTY29wZUF0dHJpYnV0ZXMuaW5jbHVkZXMoc2NvcGVBdHRyaWJ1dGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyByZWNlaXZlZCB1bmtub3duIHNjb3BlIGF0dHJpYnV0ZTogJHtzY29wZUF0dHJpYnV0ZX0gKHRoZSBzeW5jIG1vZGVsIGRlY2xhcmVzOiAke3N5bmNTY29wZUF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfSlgKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzeW5jU2NvcGVBdHRyaWJ1dGVzLm1hcCgoc2NvcGVBdHRyaWJ1dGUpID0+IHtcbiAgICBjb25zdCBkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSA9IHNjb3BlQXR0cmlidXRlcz8uW3Njb3BlQXR0cmlidXRlXVxuXG4gICAgaWYgKGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICh0eXBlb2YgZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUgIT09IFwic3RyaW5nXCIgfHwgIWF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcy4ke3Njb3BlQXR0cmlidXRlfSBtdXN0IG5hbWUgYW4gZXhpc3RpbmcgcmVjb3JkIGF0dHJpYnV0ZSwgZ290OiAke1N0cmluZyhkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSl9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtjb2x1bW5OYW1lOiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSksIHJlY29yZEF0dHJpYnV0ZTogZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUsIHJlc29sdmVyOiB1bmRlZmluZWQsIHNjb3BlQXR0cmlidXRlfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjb2x1bW5OYW1lOiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSksXG4gICAgICByZWNvcmRBdHRyaWJ1dGU6IGF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKHNjb3BlQXR0cmlidXRlKSA/IHNjb3BlQXR0cmlidXRlIDogbnVsbCxcbiAgICAgIHJlc29sdmVyOiB1bmRlZmluZWQsXG4gICAgICBzY29wZUF0dHJpYnV0ZVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgc3luYy1yb3cgY29sdW1uIHBlcnNpc3RpbmcgYSBkZWNsYXJlZCBzY29wZSBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge3tzY29wZUF0dHJpYnV0ZTogc3RyaW5nLCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIFNjb3BlIGF0dHJpYnV0ZSBhbmQgc3luYyBtb2RlbC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMtcm93IGNvbHVtbiBuYW1lLlxuICovXG5mdW5jdGlvbiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSkge1xuICBjb25zdCBjb2x1bW5OYW1lID0gc3luY01vZGVsLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtzY29wZUF0dHJpYnV0ZV1cblxuICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7c3luY01vZGVsLm5hbWV9IGRlY2xhcmVzIHRoZSBzeW5jIHNjb3BlIGF0dHJpYnV0ZSAke3Njb3BlQXR0cmlidXRlfSBidXQgaGFzIG5vIG1hdGNoaW5nIGNvbHVtbiBmb3IgaXRgKVxuICB9XG5cbiAgcmV0dXJuIGNvbHVtbk5hbWVcbn1cblxuLyoqXG4gKiBEZWZhdWx0IHB1Ymxpc2ggc2VyaWFsaXplcjogdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMgd2l0aCBEYXRlIHZhbHVlc1xuICogc2VyaWFsaXplZCB0byBJU08gc3RyaW5ncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIE11dGF0ZWQgc2VydmVyIG1vZGVsIHJlY29yZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFNlcmlhbGl6ZWQgYXR0cmlidXRlcyBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0U2VyaWFsaXplZEF0dHJpYnV0ZXMocmVjb3JkKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBhdHRyaWJ1dGVzID0gey4uLnJlY29yZC5hdHRyaWJ1dGVzKCl9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgfVxuXG4gIHJldHVybiBhdHRyaWJ1dGVzXG59XG5cbi8qKlxuICogQ29udmVydHMgYSBkYXRlLWxpa2UgdmFsdWUgdG8gYW4gSVNPIHN0cmluZywgbWF0Y2hpbmcgdGhlIGNoYW5nZS1mZWVkXG4gKiBzZXJpYWxpemVyJ3MgY29udmVudGlvbiBmb3IgdGhlIHN5bmMgZW50cnkncyBwdWJsaWMgdXBkYXRlZC1hdCBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7RGF0ZSB8IG51bGx9IHZhbHVlIC0gUGVyc2lzdGVkIHVwZGF0ZWQtYXQgdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBJU08gZGF0ZS5cbiAqIEB0aHJvd3Mge0Vycm9yfSBXaGVuIHRoZSBwZXJzaXN0ZWQgcm93IGhhcyBubyB2YWxpZCB1cGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAqL1xuZnVuY3Rpb24gaXNvRGF0ZSh2YWx1ZSkge1xuICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHx8IE51bWJlci5pc05hTih2YWx1ZS5nZXRUaW1lKCkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUHVibGlzaGVkIHN5bmMgcm93IG11c3QgaGF2ZSBhIHZhbGlkIHVwZGF0ZWRBdCB0aW1lc3RhbXAuXCIpXG4gIH1cblxuICByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxufVxuIl19