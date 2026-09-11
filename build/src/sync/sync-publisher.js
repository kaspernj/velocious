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
        const computedScopeAttributes = resourceConfig.scopeAttributesResolver
            ? await this.resolveComputedScopeAttributes({ record, resourceConfig })
            : null;
        for (const scopePlanEntry of resourceConfig.scopePlan) {
            /** @type {ReturnType<typeof JSON.parse>} */
            let rawValue;
            if (computedScopeAttributes) {
                rawValue = computedScopeAttributes[scopePlanEntry.scopeAttribute];
            }
            else if (scopePlanEntry.resolver) {
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
     * Resolves and validates one computed scope-attributes declaration. The
     * resolver runs once per published mutation with the exact connection that
     * owns that mutation; every declared scope value is then reused for row
     * persistence and broadcast routing so those two identities cannot drift.
     * @param {{record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-publisher-types.js").SyncPublisherResourceConfig}} args - Record and resource configuration.
     * @returns {Promise<Record<string, string | number | null>>} Complete computed scope values.
     */
    async resolveComputedScopeAttributes({ record, resourceConfig }) {
        const resolver = resourceConfig.scopeAttributesResolver;
        if (!resolver)
            throw new Error(`No computed scope-attributes resolver configured for ${resourceConfig.resourceType}`);
        const resolved = await resolver({
            configuration: this.config.configuration,
            connection: record.connection(),
            record
        });
        if (!isPlainObject(resolved)) {
            throw new Error(`${resourceConfig.resourceType} static sync publish scopeAttributes resolver must resolve to a plain object`);
        }
        const declaredAttributes = resourceConfig.scopePlan.map(({ scopeAttribute }) => scopeAttribute);
        for (const scopeAttribute of Object.keys(resolved)) {
            if (!declaredAttributes.includes(scopeAttribute)) {
                throw new Error(`${resourceConfig.resourceType} static sync publish scopeAttributes resolver returned unknown scope attribute: ${scopeAttribute} (the sync model declares: ${declaredAttributes.join(", ")})`);
            }
        }
        for (const scopeAttribute of declaredAttributes) {
            if (!Object.hasOwn(resolved, scopeAttribute)) {
                throw new Error(`${resourceConfig.resourceType} static sync publish scopeAttributes resolver must resolve the declared scope attribute ${scopeAttribute}`);
            }
            const value = resolved[scopeAttribute];
            if (value !== null && typeof value !== "string" && typeof value !== "number") {
                throw new Error(`${resourceConfig.resourceType} static sync publish scope attribute ${scopeAttribute} must be a string, number, or null`);
            }
        }
        return /** @type {Record<string, string | number | null>} */ (resolved);
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
    const scopePlan = scopePlanFor({ eventId, modelClass, modelName, scopeAttributes, syncModel, syncScopeAttributes });
    return {
        broadcasts,
        modelClass,
        operations: operations === undefined ? DEFAULT_PUBLISHED_OPERATIONS : operations,
        resourceType: resourceType === undefined ? modelName : resourceType,
        scopeAttributesResolver: typeof scopeAttributes === "function" ? scopeAttributes : undefined,
        scopePlan,
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
 * @param {{eventId: import("./sync-publisher-types.js").SyncPublishDeclarationConfig["eventId"], modelClass: ReturnType<typeof JSON.parse>, modelName: string, scopeAttributes: import("./sync-publisher-types.js").SyncPublishDeclarationConfig["scopeAttributes"], syncModel: ReturnType<typeof JSON.parse>, syncScopeAttributes: string[] | null}} args - Declaration and sync-model scope args.
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
    if (typeof scopeAttributes === "function") {
        return syncScopeAttributes.map((scopeAttribute) => ({
            columnName: syncScopeColumnName({ scopeAttribute, syncModel }),
            recordAttribute: null,
            resolver: undefined,
            scopeAttribute
        }));
    }
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
 * Checks that a computed declaration returned an ordinary key/value object.
 * @param {unknown} value - Resolver result.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1wdWJsaXNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXB1Ymxpc2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3hFLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE9BQU8sRUFBQywyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3RFLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU3RCxzRkFBc0Y7QUFDdEYsTUFBTSx3QkFBd0IsR0FBRyxFQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFDLENBQUE7QUFFeEc7Ozs7OztvREFNb0Q7QUFDcEQsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV6RCxvREFBb0Q7QUFDcEQsTUFBTSxnQ0FBZ0MsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRXREOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7T0FRRztJQUNILFlBQVksT0FBTyxHQUFHLEVBQUU7UUFDdEIsTUFBTSxFQUFDLHFCQUFxQixHQUFHLHlCQUF5QixFQUFFLFdBQVcsRUFBRSxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxFQUFF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aGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5pbXBvcnQge2RlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlc30gZnJvbSBcIi4vc3luYy1zY29wZS1hdHRyaWJ1dGVzLmpzXCJcbmltcG9ydCB7ZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cywgdXBzZXJ0U3luY1Jvd30gZnJvbSBcIi4vc3luYy1jaGFuZ2UtZmFub3V0LmpzXCJcbmltcG9ydCB7aXNQdWJsaXNoaW5nU3VwcHJlc3NlZH0gZnJvbSBcIi4vc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzXCJcbmltcG9ydCB7VkVMT0NJT1VTX1NZTkNfQ0hBTk5FTH0gZnJvbSBcIi4vc3luYy1jaGFubmVsLW5hbWUuanNcIlxuXG4vKiogQHR5cGUge3tjcmVhdGU6IFwiYWZ0ZXJDcmVhdGVcIiwgdXBkYXRlOiBcImFmdGVyVXBkYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCJ9fSAqL1xuY29uc3QgUFVCTElTSEVEX0NBTExCQUNLX05BTUVTID0ge2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIn1cblxuLyoqXG4gKiBPcGVyYXRpb25zIHB1Ymxpc2hlZCBieSBkZWZhdWx0IGZvciBtb2RlbHMgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2AgcHVibGlzaFxuICogd2l0aG91dCBhbiBgb3BlcmF0aW9uc2Aga2V5OiBzZXJ2ZXItc2lkZSBjcmVhdGVzIGFuZCB1cGRhdGVzIHB1Ymxpc2hcbiAqIGF1dG9tYXRpY2FsbHkuIERlc3Ryb3lzIGFyZSBub3QgcHVibGlzaGVkIGJ5IGRlZmF1bHQgYmVjYXVzZSBhIHNlcnZlclxuICogZGVzdHJveSBpcyBvZnRlbiBjbGVhbnVwIHJhdGhlciB0aGFuIGEgc3luY2VkIGRlbGV0ZTsgb3B0IGluIHdpdGggYW5cbiAqIG9wZXJhdGlvbnMgbGlzdC5cbiAqIEB0eXBlIHtBcnJheTxcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiPn0gKi9cbmNvbnN0IERFRkFVTFRfUFVCTElTSEVEX09QRVJBVElPTlMgPSBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl1cblxuLyoqIEB0eXBlIHtXZWFrTWFwPENvbmZpZ3VyYXRpb24sIFN5bmNQdWJsaXNoZXI+fSAqL1xuY29uc3Qgc3RhcnRlZFB1Ymxpc2hlcnNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogRGVjbGFyYXRpdmUgc2VydmVyLXNpZGUgc3luYyBwdWJsaXNoZXIg4oCUIHRoZSBzZXJ2ZXIgbWlycm9yIG9mIHRoZSBjbGllbnQnc1xuICogdHJhY2stYnktZGVmYXVsdCBtdXRhdGlvbiB0cmFja2luZy5cbiAqXG4gKiBTZXJ2ZXIgbW9kZWxzIGRlY2xhcmUgd2hhdCB0byBwdWJsaXNoIHRocm91Z2ggYHN0YXRpYyBzeW5jYCdzIGBwdWJsaXNoYFxuICoga2V5LCBhbmQgVmVsb2Npb3VzIHdyaXRlcyBldmVyeSBjb21taXR0ZWQgc2VydmVyLXNpZGUgY2hhbmdlIHRvIHRoZSBzeW5jXG4gKiBjaGFuZ2UgZmVlZCAobW9kZWwtYmFja2VkIFN5bmMtcm93IHVwc2VydCB3aXRoIHNlcnZlciByZS1zZXF1ZW5jaW5nKSBhbmRcbiAqIGJyb2FkY2FzdHMgdGhlIHN0YW5kYXJkIHN5bmMgZW52ZWxvcGUgKGB7ZWNob09yaWdpbiwgc3luY3M6IFsuLi5dfWApIG9uIHRoZVxuICogZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCAoe0BsaW5rIFZFTE9DSU9VU19TWU5DX0NIQU5ORUx9KSBzY29wZWQgYnkgdGhlXG4gKiBjaGFuZ2UncyBkZXJpdmVkIHNjb3BlLXBhcnRpdGlvbiB2YWx1ZXMsIHNvIGRldmljZXMgcmVjZWl2ZSBzZXJ2ZXItb3JpZ2luXG4gKiBjaGFuZ2VzIHdpdGhvdXQgYXBwIGNvZGUgZGVjbGFyaW5nIGNoYW5uZWxzIG9yIGNhbGxpbmcgbWFudWFsXG4gKiB1cHNlcnQvYnJvYWRjYXN0IGhlbHBlcnM6XG4gKlxuICogICAgIHN0YXRpYyBzeW5jID0ge3B1Ymxpc2g6IHRydWV9IC8vIGRlZmF1bHQgcGF5bG9hZCAoYXR0cmlidXRlcykgKyBkZWZhdWx0IHNjb3BlIHBhcnRpdGlvblxuICogICAgIHN0YXRpYyBzeW5jID0ge3B1Ymxpc2g6IHtzZXJpYWxpemU6IChyZWNvcmQpID0+ICh7aWQ6IHJlY29yZC5pZCgpLCBwaW46IHJlY29yZC5waW4oKX0pfX1cbiAqXG4gKiBUaGUgc2NvcGUgcGFydGl0aW9uIGNvbWVzIGZyb20gdGhlIHN5bmMgbW9kZWwncyBgc3RhdGljXG4gKiBzeW5jU2NvcGVBdHRyaWJ1dGVzYCBkZWNsYXJhdGlvbiAoZm9yIGV4YW1wbGUgYFtcImV2ZW50SWRcIl1gIG9yXG4gKiBgW1wiYWNjb3VudElkXCJdYCDigJQgVmVsb2Npb3VzIGhhcyBubyBidWlsdC1pbiBwYXJ0aXRpb24gbmFtZSk6IGVhY2ggZGVjbGFyZWRcbiAqIHNjb3BlIGF0dHJpYnV0ZSByZWFkcyB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlIG9mIHRoZSBzYW1lIG5hbWUgd2hlbiB0aGVcbiAqIG1vZGVsIGhhcyBvbmUsIGVsc2UgdGhlIHJlY29yZCdzIG93biBpZCAoc2NvcGUtcm9vdCBtb2RlbHMpLCBvdmVycmlkYWJsZVxuICogcGVyIG1vZGVsIHRocm91Z2ggYHB1Ymxpc2g6IHtzY29wZUF0dHJpYnV0ZXM6IHthY2NvdW50SWQ6IFwib3duZXJJZFwifX1gLlxuICogVGhlIHByZS1mcmFtZXdvcmstY2hhbm5lbCBgYnJvYWRjYXN0c2AgbGlzdCBhbmQgdGhlIGBldmVudElkYFxuICogc3RyaW5nL3Jlc29sdmVyLWZ1bmN0aW9uIGRlY2xhcmF0aW9uIGZvcm1zIGtlZXAgd29ya2luZyBidXQgYXJlIGRlcHJlY2F0ZWQuXG4gKlxuICogUmVwbGF5ZWQgZGV2aWNlIG11dGF0aW9ucyBuZXZlciBkb3VibGUtcHVibGlzaDogdGhlIGZyYW1ld29yaydzIHJvdXRlZFxuICogcmVwbGF5IGFwcGx5IG1hcmtzIGl0cyB3cml0dGVuIHJlY29yZHMgdGhyb3VnaCBgbWFya1NlcnZlckFwcGx5KHJlY29yZClgXG4gKiAoc2VlIHN5bmMtcHVibGlzaC1zdXBwcmVzc2lvbi5qcyksIGFuZCBhcHAgY29kZSBhcHBseWluZyBhbHJlYWR5LXN5bmNlZFxuICogZGF0YSBjYW4gdXNlIGBtYXJrU2VydmVyQXBwbHlgL2B3aXRob3V0UHVibGlzaGluZ2AgdGhlIHNhbWUgd2F5LlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jUHVibGlzaGVyIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3luYyBwdWJsaXNoZXIgYnkgZGVyaXZpbmcgcHVibGlzaGVkIHJlc291cmNlcyBmcm9tIHRoZVxuICAgKiBjb25maWd1cmF0aW9uJ3MgcmVnaXN0ZXJlZCBtb2RlbHM6IGV2ZXJ5IG1vZGVsIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgXG4gICAqIHdpdGggYSBgcHVibGlzaGAgZGVjbGFyYXRpb24gYmVjb21lcyBhIHB1Ymxpc2hlZCByZXNvdXJjZVxuICAgKiAoYHB1Ymxpc2g6IGZhbHNlYCBvcHRzIG91dCkuIFRoZSBzeW5jL2NoYW5nZSBtb2RlbCBpcyB0aGUgcmVnaXN0ZXJlZFxuICAgKiBcIlN5bmNcIiBtb2RlbCBhbmQgYnJvYWRjYXN0cyBkZWZhdWx0IHRvIHRoZSBjb25maWd1cmF0aW9uJ3MgY2hhbm5lbFxuICAgKiBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc30gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge2FjdG9yRm9yZWlnbktleUNvbHVtbiA9IFwiYXV0aGVudGljYXRpb25fdG9rZW5faWRcIiwgYnJvYWRjYXN0ZXIsIGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb25FcnJvciwgc3luY01vZGVsLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuXG4gICAgY29uc3QgbW9kZWxDbGFzc2VzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHB1Ymxpc2hpbmdNb2RlbENsYXNzZXMgPSBPYmplY3QudmFsdWVzKG1vZGVsQ2xhc3NlcykuZmlsdGVyKChtb2RlbENsYXNzKSA9PiBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcykpXG5cbiAgICBpZiAocHVibGlzaGluZ01vZGVsQ2xhc3Nlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNQdWJsaXNoZXIgZm91bmQgbm8gcmVnaXN0ZXJlZCBtb2RlbHMgZGVjbGFyaW5nIHN0YXRpYyBzeW5jIHB1Ymxpc2ggLSBkZWNsYXJlIGBzdGF0aWMgc3luYyA9IHtwdWJsaXNoOiB7c2VyaWFsaXplfX1gIG9uIHRoZSBtb2RlbHMgd2hvc2Ugc2VydmVyLXNpZGUgY2hhbmdlcyBzaG91bGQgcHVibGlzaCB0byB0aGUgc3luYyBmZWVkXCIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRTeW5jTW9kZWwgPSBzeW5jTW9kZWwgfHwgbW9kZWxDbGFzc2VzLlN5bmNcblxuICAgIGlmICghcmVzb2x2ZWRTeW5jTW9kZWwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNQdWJsaXNoZXIgcmVxdWlyZXMgYSByZWdpc3RlcmVkIFxcXCJTeW5jXFxcIiBtb2RlbCBmb3IgcHVibGlzaGVkIHN5bmMgY2hhbmdlIHJvd3MgKG9yIHBhc3Mgb3B0aW9ucy5zeW5jTW9kZWwpXCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVBdHRyaWJ1dGVzID0gZGVjbGFyZWRTeW5jU2NvcGVBdHRyaWJ1dGVzKHJlc29sdmVkU3luY01vZGVsKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWc+fSAqL1xuICAgIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgcHVibGlzaGluZ01vZGVsQ2xhc3Nlcykge1xuICAgICAgY29uc3QgcHVibGlzaCA9IHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSByZXNvdXJjZUNvbmZpZ0Zyb21QdWJsaXNoRGVjbGFyYXRpb24oe21vZGVsQ2xhc3MsIHB1Ymxpc2gsIHNjb3BlQXR0cmlidXRlcywgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbH0pXG5cbiAgICAgIHJlc291cmNlc1tyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGVdID0gcmVzb3VyY2VDb25maWdcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3thY3RvckZvcmVpZ25LZXlDb2x1bW46IHN0cmluZywgYnJvYWRjYXN0ZXI6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnNbXCJicm9hZGNhc3RlclwiXSwgY29uZmlndXJhdGlvbjogQ29uZmlndXJhdGlvbiwgb25FcnJvcjogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc1tcIm9uRXJyb3JcIl0sIHJlc291cmNlczogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWc+LCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi9cbiAgICB0aGlzLmNvbmZpZyA9IHthY3RvckZvcmVpZ25LZXlDb2x1bW4sIGJyb2FkY2FzdGVyLCBjb25maWd1cmF0aW9uLCBvbkVycm9yLCByZXNvdXJjZXMsIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWx9XG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2FsbGJhY2s6IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+LCBjYWxsYmFja05hbWU6IFwiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIsIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzID0gW11cbiAgICAvKiogQHR5cGUge0xvZ2dlciB8IG51bGx9ICovXG4gICAgdGhpcy5fbG9nZ2VyID0gbnVsbFxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN5bmMgcHVibGlzaGVyIGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbi4gQWxpYXMgZm9yXG4gICAqIGBuZXcgU3luY1B1Ymxpc2hlcih7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYC5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMuIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7T21pdDxpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zLCBcImNvbmZpZ3VyYXRpb25cIj59IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICogQHJldHVybnMge1N5bmNQdWJsaXNoZXJ9IFN5bmMgcHVibGlzaGVyIGRlcml2ZWQgZnJvbSB0aGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBmcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBuZXcgU3luY1B1Ymxpc2hlcih7Li4ub3B0aW9ucywgY29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIChhbmQgbWVtb2l6ZXMgcGVyIGNvbmZpZ3VyYXRpb24pIHRoZSBzeW5jIHB1Ymxpc2hlciBmb3IgYSBzZXJ2ZXJcbiAgICogYm9vdDogbm8tb3Agd2hlbiBubyByZWdpc3RlcmVkIG1vZGVsIGRlY2xhcmVzIGEgcHVibGlzaCBjb25maWcsIGd1YXJkZWQgc29cbiAgICogcmVwZWF0ZWQgYm9vdHMgd2l0aCB0aGUgc2FtZSBjb25maWd1cmF0aW9uIHJlZ2lzdGVyIHRoZSBwdWJsaXNoIGNhbGxiYWNrc1xuICAgKiBvbmx5IG9uY2UuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSByZWdpc3RlcmVkIG1vZGVscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY1B1Ymxpc2hlciB8IG51bGw+fSBTdGFydGVkIHB1Ymxpc2hlciwgb3IgbnVsbCB3aGVuIG5vIG1vZGVscyBkZWNsYXJlIHB1Ymxpc2guXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc3RhcnRGcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3Qgc3RhcnRlZFB1Ymxpc2hlciA9IHN0YXJ0ZWRQdWJsaXNoZXJzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKHN0YXJ0ZWRQdWJsaXNoZXIpIHJldHVybiBzdGFydGVkUHVibGlzaGVyXG5cbiAgICBpZiAoIU9iamVjdC52YWx1ZXMoY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKSkuc29tZSgobW9kZWxDbGFzcykgPT4gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHB1Ymxpc2hlciA9IG5ldyBTeW5jUHVibGlzaGVyKHtjb25maWd1cmF0aW9ufSlcblxuICAgIHN0YXJ0ZWRQdWJsaXNoZXJzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXIpXG4gICAgYXdhaXQgcHVibGlzaGVyLnN0YXJ0KClcblxuICAgIHJldHVybiBwdWJsaXNoZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhlIHB1Ymxpc2ggY2FsbGJhY2tzIGZvciBldmVyeSBwdWJsaXNoZWQgcmVzb3VyY2U6IHNlcnZlci1zaWRlXG4gICAqIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgKGRlc3Ryb3lzIHdoZW4gb3B0ZWQgaW4pIHVwc2VydCBhIHN5bmMgY2hhbmdlIHJvdyBhbmRcbiAgICogZmFuIG91dCB0aGUgZGVjbGFyZWQgYnJvYWRjYXN0cyBvbmNlIHRoZWlyIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgaWYgKHRoaXMuX3N0YXJ0ZWQpIHJldHVyblxuXG4gICAgdGhpcy5fc3RhcnRlZCA9IHRydWVcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2VDb25maWcgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiByZXNvdXJjZUNvbmZpZy5vcGVyYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrTmFtZSA9IFBVQkxJU0hFRF9DQUxMQkFDS19OQU1FU1tvcGVyYXRpb25dXG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy5wdWJsaXNoZWRNdXRhdGlvbkNhbGxiYWNrKHtvcGVyYXRpb24sIHJlc291cmNlQ29uZmlnfSlcblxuICAgICAgICByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzW2NhbGxiYWNrTmFtZV0oY2FsbGJhY2spXG4gICAgICAgIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYWxsIHB1Ymxpc2ggY2FsbGJhY2tzICh0ZXN0cywgc2h1dGRvd24pLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgZm9yIChjb25zdCB7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzc30gb2YgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzKSB7XG4gICAgICBtb2RlbENsYXNzLnVucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcyA9IFtdXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsaWZlY3ljbGUgY2FsbGJhY2sgcHVibGlzaGluZyBvbmUgc2VydmVyLXNpZGUgbXV0YXRpb24uIFRoZVxuICAgKiBwdWJsaXNoZWQgcGF5bG9hZCAoZGVjbGFyYXRpb24gYHNlcmlhbGl6ZWApLCBldmVudCBzY29wZSwgYW5kIHN5bmMgdHlwZVxuICAgKiBhcmUgc25hcHNob3R0ZWQgYXQgbXV0YXRpb24tY2FsbGJhY2sgdGltZSwgc28gYWZ0ZXJTYXZlIGhvb2tzIGFzc2lnbmluZ1xuICAgKiB1bnNhdmVkIGF0dHJpYnV0ZXMgKG9yIGFueSBsYXRlciBkcmlmdCBvbiB0aGUgcmVjb3JkKSBjYW5ub3QgY2hhbmdlIHdoYXRcbiAgICogZ2V0cyBwdWJsaXNoZWQgdnMgd2hhdCB3YXMgY29tbWl0dGVkLiBQZXJzaXN0aW5nIGFuZCBicm9hZGNhc3RpbmcgYXJlXG4gICAqIGRlZmVycmVkIHRocm91Z2ggdGhlIG1vZGVsIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIHRoZXkgb25seSBydW5cbiAgICogb25jZSB0aGUgbXV0YXRpb24ncyB0cmFuc2FjdGlvbiBoYXMgY29tbWl0dGVkIChpbW1lZGlhdGVseSB3aGVuIG5vXG4gICAqIHRyYW5zYWN0aW9uIGlzIG9wZW4pIC0gcm9sbGVkLWJhY2sgbXV0YXRpb25zIG5ldmVyIHB1Ymxpc2guIFBvc3QtY29tbWl0XG4gICAqIHB1Ymxpc2ggZmFpbHVyZXMgYXJlIHJlcG9ydGVkIHdpdGhvdXQgcmV0aHJvd2luZyBpbnRvIHRoZSBkcml2ZXInc1xuICAgKiBhZnRlckNvbW1pdCBjaGFpbiAoc2VlIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IpLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBPcGVyYXRpb24gYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMgeyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+fSBMaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqL1xuICBwdWJsaXNoZWRNdXRhdGlvbkNhbGxiYWNrKHtvcGVyYXRpb24sIHJlc291cmNlQ29uZmlnfSkge1xuICAgIHJldHVybiBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBpZiAoaXNQdWJsaXNoaW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc291cmNlQ29uZmlnLnNlcmlhbGl6ZShyZWNvcmQpXG4gICAgICBjb25zdCByZXNvdXJjZUlkID0gU3RyaW5nKHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHJlY29yZC5pZCgpLCBgU3luYyBwdWJsaXNoaW5nIGZvciAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX1gKSlcbiAgICAgIGNvbnN0IHN5bmNUeXBlID0gb3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIiA/IFwiZGVsZXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgICBjb25zdCBzY29wZVZhbHVlcyA9IGF3YWl0IHRoaXMucHVibGlzaGVkU2NvcGVWYWx1ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0ge1xuICAgICAgICBbdGhpcy5jb25maWcuYWN0b3JGb3JlaWduS2V5Q29sdW1uXTogbnVsbCxcbiAgICAgICAgY2xpZW50X3VwZGF0ZWRfYXQ6IG5ldyBEYXRlKCksXG4gICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgICAgICByZXNvdXJjZV9pZDogcmVzb3VyY2VJZCxcbiAgICAgICAgcmVzb3VyY2VfdHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlLFxuICAgICAgICBzeW5jX3R5cGU6IHN5bmNUeXBlLFxuICAgICAgICAuLi5zY29wZVZhbHVlcy5jb2x1bW5zXG4gICAgICB9XG4gICAgICBjb25zdCBkYXRhYmFzZU9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG4gICAgICBjb25zdCBvcGVyYXRpb25TY29wZSA9IGRhdGFiYXNlT3BlcmF0aW9uXG4gICAgICAgID8gZGF0YWJhc2VPcGVyYXRpb24uZm9yTW9kZWwodGhpcy5jb25maWcuc3luY01vZGVsKVxuICAgICAgICA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuXG4gICAgICBhd2FpdCByZWNvcmQuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBzeW5jUm93ID0gYXdhaXQgdGhpcy51cHNlcnRQdWJsaXNoZWRTeW5jUm93KGF0dHJpYnV0ZXMsIG9wZXJhdGlvblNjb3BlKVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5icm9hZGNhc3RlcigpKHtcbiAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgZWNob09yaWdpbjogbnVsbCxcbiAgICAgICAgICAgICAgc3luY3M6IFt0aGlzLnB1Ymxpc2hlZFN5bmNFbnRyeSh7ZGF0YSwgcmVzb3VyY2VDb25maWcsIHJlc291cmNlSWQsIHN5bmNSb3csIHN5bmNUeXBlfSldXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY2hhbm5lbDogVkVMT0NJT1VTX1NZTkNfQ0hBTk5FTCxcbiAgICAgICAgICAgIHBhcmFtczogey4uLnNjb3BlVmFsdWVzLnBhcmFtcywgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5icm9hZGNhc3RzKSB7XG4gICAgICAgICAgICBhd2FpdCBkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzKHtcbiAgICAgICAgICAgICAgYXJnczoge2RhdGEsIG9wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGU6IHJlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZSwgc3luY1Jvdywgc3luY1R5cGV9LFxuICAgICAgICAgICAgICBicm9hZGNhc3RlcjogdGhpcy5icm9hZGNhc3RlcigpLFxuICAgICAgICAgICAgICBicm9hZGNhc3RzOiByZXNvdXJjZUNvbmZpZy5icm9hZGNhc3RzXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNjb3BlLXBhcnRpdGlvbiB2YWx1ZXMgZm9yIG9uZSBwdWJsaXNoZWQgbXV0YXRpb24gZnJvbSB0aGVcbiAgICogcmVzb3VyY2UncyBkZXJpdmVkIHNjb3BlIHBsYW46IGVhY2ggZW50cnkgcmVhZHMgaXRzIHJlY29yZCBhdHRyaWJ1dGUgKG9yXG4gICAqIHRoZSByZWNvcmQncyBvd24gaWQgZm9yIHNjb3BlLXJvb3QgbW9kZWxzLCBvciB0aGUgZGVwcmVjYXRlZCByZXNvbHZlclxuICAgKiBmdW5jdGlvbikuIFRoZSB2YWx1ZXMgYXJlIHBlcnNpc3RlZCBvbnRvIHRoZSBzeW5jIHJvdydzIHBhcnRpdGlvbiBjb2x1bW5zXG4gICAqIGFuZCBicm9hZGNhc3QgYXMgdGhlIGZyYW1ld29yayBzeW5jIGNoYW5uZWwncyBzY29waW5nIHBhcmFtcy5cbiAgICogQHBhcmFtIHt7cmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfX0gYXJncyAtIE11dGF0ZWQgcmVjb3JkIGFuZCByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb2x1bW5zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPiwgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0+fSBTY29wZSB2YWx1ZXMga2V5ZWQgYnkgc3luYy1yb3cgY29sdW1uIGFuZCBieSBzY29wZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBhc3luYyBwdWJsaXNoZWRTY29wZVZhbHVlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IGNvbHVtbnMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59ICovXG4gICAgY29uc3QgcGFyYW1zID0ge31cbiAgICBjb25zdCBjb21wdXRlZFNjb3BlQXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLnNjb3BlQXR0cmlidXRlc1Jlc29sdmVyXG4gICAgICA/IGF3YWl0IHRoaXMucmVzb2x2ZUNvbXB1dGVkU2NvcGVBdHRyaWJ1dGVzKHtyZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgICAgIDogbnVsbFxuXG4gICAgZm9yIChjb25zdCBzY29wZVBsYW5FbnRyeSBvZiByZXNvdXJjZUNvbmZpZy5zY29wZVBsYW4pIHtcbiAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgICBsZXQgcmF3VmFsdWVcblxuICAgICAgaWYgKGNvbXB1dGVkU2NvcGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgIHJhd1ZhbHVlID0gY29tcHV0ZWRTY29wZUF0dHJpYnV0ZXNbc2NvcGVQbGFuRW50cnkuc2NvcGVBdHRyaWJ1dGVdXG4gICAgICB9IGVsc2UgaWYgKHNjb3BlUGxhbkVudHJ5LnJlc29sdmVyKSB7XG4gICAgICAgIHJhd1ZhbHVlID0gYXdhaXQgc2NvcGVQbGFuRW50cnkucmVzb2x2ZXIocmVjb3JkKVxuICAgICAgfSBlbHNlIGlmIChzY29wZVBsYW5FbnRyeS5yZWNvcmRBdHRyaWJ1dGUpIHtcbiAgICAgICAgcmF3VmFsdWUgPSByZWNvcmQucmVhZEF0dHJpYnV0ZShzY29wZVBsYW5FbnRyeS5yZWNvcmRBdHRyaWJ1dGUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByYXdWYWx1ZSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHJlY29yZC5pZCgpLCBgU3luYyBzY29wZSBwdWJsaXNoaW5nIGZvciAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB2YWx1ZSA9IHJhd1ZhbHVlID09PSB1bmRlZmluZWQgfHwgcmF3VmFsdWUgPT09IG51bGwgPyBudWxsIDogU3RyaW5nKHJhd1ZhbHVlKVxuXG4gICAgICBjb2x1bW5zW3Njb3BlUGxhbkVudHJ5LmNvbHVtbk5hbWVdID0gdmFsdWVcbiAgICAgIHBhcmFtc1tzY29wZVBsYW5FbnRyeS5zY29wZUF0dHJpYnV0ZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiB7Y29sdW1ucywgcGFyYW1zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCB2YWxpZGF0ZXMgb25lIGNvbXB1dGVkIHNjb3BlLWF0dHJpYnV0ZXMgZGVjbGFyYXRpb24uIFRoZVxuICAgKiByZXNvbHZlciBydW5zIG9uY2UgcGVyIHB1Ymxpc2hlZCBtdXRhdGlvbiB3aXRoIHRoZSBleGFjdCBjb25uZWN0aW9uIHRoYXRcbiAgICogb3ducyB0aGF0IG11dGF0aW9uOyBldmVyeSBkZWNsYXJlZCBzY29wZSB2YWx1ZSBpcyB0aGVuIHJldXNlZCBmb3Igcm93XG4gICAqIHBlcnNpc3RlbmNlIGFuZCBicm9hZGNhc3Qgcm91dGluZyBzbyB0aG9zZSB0d28gaWRlbnRpdGllcyBjYW5ub3QgZHJpZnQuXG4gICAqIEBwYXJhbSB7e3JlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBSZWNvcmQgYW5kIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IG51bGw+Pn0gQ29tcGxldGUgY29tcHV0ZWQgc2NvcGUgdmFsdWVzLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUNvbXB1dGVkU2NvcGVBdHRyaWJ1dGVzKHtyZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gcmVzb3VyY2VDb25maWcuc2NvcGVBdHRyaWJ1dGVzUmVzb2x2ZXJcblxuICAgIGlmICghcmVzb2x2ZXIpIHRocm93IG5ldyBFcnJvcihgTm8gY29tcHV0ZWQgc2NvcGUtYXR0cmlidXRlcyByZXNvbHZlciBjb25maWd1cmVkIGZvciAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX1gKVxuXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLFxuICAgICAgY29ubmVjdGlvbjogcmVjb3JkLmNvbm5lY3Rpb24oKSxcbiAgICAgIHJlY29yZFxuICAgIH0pXG5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QocmVzb2x2ZWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyByZXNvbHZlciBtdXN0IHJlc29sdmUgdG8gYSBwbGFpbiBvYmplY3RgKVxuICAgIH1cblxuICAgIGNvbnN0IGRlY2xhcmVkQXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLnNjb3BlUGxhbi5tYXAoKHtzY29wZUF0dHJpYnV0ZX0pID0+IHNjb3BlQXR0cmlidXRlKVxuXG4gICAgZm9yIChjb25zdCBzY29wZUF0dHJpYnV0ZSBvZiBPYmplY3Qua2V5cyhyZXNvbHZlZCkpIHtcbiAgICAgIGlmICghZGVjbGFyZWRBdHRyaWJ1dGVzLmluY2x1ZGVzKHNjb3BlQXR0cmlidXRlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyByZXNvbHZlciByZXR1cm5lZCB1bmtub3duIHNjb3BlIGF0dHJpYnV0ZTogJHtzY29wZUF0dHJpYnV0ZX0gKHRoZSBzeW5jIG1vZGVsIGRlY2xhcmVzOiAke2RlY2xhcmVkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzY29wZUF0dHJpYnV0ZSBvZiBkZWNsYXJlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGlmICghT2JqZWN0Lmhhc093bihyZXNvbHZlZCwgc2NvcGVBdHRyaWJ1dGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIHJlc29sdmVyIG11c3QgcmVzb2x2ZSB0aGUgZGVjbGFyZWQgc2NvcGUgYXR0cmlidXRlICR7c2NvcGVBdHRyaWJ1dGV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdmFsdWUgPSByZXNvbHZlZFtzY29wZUF0dHJpYnV0ZV1cblxuICAgICAgaWYgKHZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZSBhdHRyaWJ1dGUgJHtzY29wZUF0dHJpYnV0ZX0gbXVzdCBiZSBhIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBudWxsPn0gKi8gKHJlc29sdmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCBlbnRyeSBmb3Igb25lIHB1Ymxpc2hlZCBjaGFuZ2U6IHRoZVxuICAgKiBzbmFwc2hvdHRlZCBwYXlsb2FkIHBsdXMgdGhlIHBlcnNpc3RlZCBzeW5jIHJvdydzIHB1YmxpYyBleGFjdC1yb3cgbWV0YWRhdGFcbiAgICogKGlkLCBzZXJ2ZXIgc2VxdWVuY2UsIHVwZGF0ZWQtYXQsIGFuZCBkZWNsYXJlZCBzY29wZS1wYXJ0aXRpb24gYXR0cmlidXRlcykuXG4gICAqIFVzZXMgdGhlIHN5bmMgbW9kZWwncyBnZW5lcmF0ZWQgdHlwZWQgYWNjZXNzb3JzIGFuZCBmb2xsb3dzIHRoZVxuICAgKiBjaGFuZ2UtZmVlZCBzZXJpYWxpemVyJ3MgcHVibGljIGZpZWxkIGNvbnZlbnRpb24uXG4gICAqIEBwYXJhbSB7e2RhdGE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkOiBzdHJpbmcsIHN5bmNSb3c6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzeW5jVHlwZTogc3RyaW5nfX0gYXJncyAtIFB1Ymxpc2ggYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQnJvYWRjYXN0IHN5bmMgZW50cnkuXG4gICAqL1xuICBwdWJsaXNoZWRTeW5jRW50cnkoe2RhdGEsIHJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkLCBzeW5jUm93LCBzeW5jVHlwZX0pIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtcbiAgICAgIGRhdGEsXG4gICAgICBpZDogc3luY1Jvdy5pZCgpLFxuICAgICAgcmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlLFxuICAgICAgc2VydmVyU2VxdWVuY2U6IHN5bmNSb3cuc2VydmVyU2VxdWVuY2UoKSxcbiAgICAgIHN5bmNUeXBlLFxuICAgICAgdXBkYXRlZEF0OiBpc29EYXRlKHN5bmNSb3cudXBkYXRlZEF0KCkpXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVBdHRyaWJ1dGVzID0gZGVjbGFyZWRTeW5jU2NvcGVBdHRyaWJ1dGVzKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcblxuICAgIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2Ygc2NvcGVBdHRyaWJ1dGVzIHx8IFtdKSB7XG4gICAgICBjb25zdCBzY29wZUFjY2Vzc29yID0gc3luY1Jvd1tzY29wZUF0dHJpYnV0ZV1cblxuICAgICAgaWYgKHR5cGVvZiBzY29wZUFjY2Vzc29yICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQdWJsaXNoZWQgc3luYyByb3cgaXMgbWlzc2luZyB0aGUgZGVjbGFyZWQgc2NvcGUgYWNjZXNzb3IgJHtzY29wZUF0dHJpYnV0ZX0oKS5gKVxuICAgICAgfVxuXG4gICAgICBlbnRyeVtzY29wZUF0dHJpYnV0ZV0gPSBzY29wZUFjY2Vzc29yLmNhbGwoc3luY1JvdylcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBVcHNlcnRzIHRoZSBwdWJsaXNoZWQgc2VydmVyLW9yaWdpbiBzeW5jIHJvdyBmb3IgYSByZXNvdXJjZSBpZGVudGl0eTpcbiAgICogc2VydmVyLW9yaWdpbiByb3dzIGNhcnJ5IGEgbnVsbCBhY3RvciBjb2x1bW4gKG5vIGRldmljZSB0byBlY2hvIHRoZVxuICAgKiBjaGFuZ2UgYmFjayB0byksIHNvIHJlcGVhdGVkIHNlcnZlciBjaGFuZ2VzIHRvIG9uZSByZXNvdXJjZSByZXVzZSBhbmRcbiAgICogcmUtc2VxdWVuY2Ugb25lIGZlZWQgcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIFNuYXBzaG90dGVkIHN5bmMgcm93IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmNNb2RlbCAtIE9wZXJhdGlvbi1ib3VuZCBvciBzdGF0aWMgU3luYyBtb2RlbCBpbnRlcmZhY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gVXBzZXJ0ZWQgc3luYyByb3cuXG4gICAqL1xuICBhc3luYyB1cHNlcnRQdWJsaXNoZWRTeW5jUm93KGF0dHJpYnV0ZXMsIHN5bmNNb2RlbCA9IHRoaXMuY29uZmlnLnN5bmNNb2RlbCkge1xuICAgIGNvbnN0IGV4aXN0aW5nU3luYyA9IGF3YWl0IHN5bmNNb2RlbFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgW3RoaXMuY29uZmlnLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IG51bGwsXG4gICAgICAgIHJlc291cmNlX2lkOiBhdHRyaWJ1dGVzLnJlc291cmNlX2lkLFxuICAgICAgICByZXNvdXJjZV90eXBlOiBhdHRyaWJ1dGVzLnJlc291cmNlX3R5cGVcbiAgICAgIH0pXG4gICAgICAuZmlyc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBicm9hZGNhc3RlciBkZWxpdmVyaW5nIGRlY2xhcmVkIGJyb2FkY2FzdHM6IHRoZSBpbmplY3RlZCBvbmUsXG4gICAqIG9yIHRoZSBjb25maWd1cmF0aW9uJ3MgY2hhbm5lbCBicm9hZGNhc3QgYXdhaXRlZCB0aHJvdWdoIHRoZSBwZW5kaW5nXG4gICAqIGJyb2FkY2FzdCBxdWV1ZS5cbiAgICogQHJldHVybnMge05vbk51bGxhYmxlPGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnNbXCJicm9hZGNhc3RlclwiXT59IEJyb2FkY2FzdCBkZWxpdmVyZXIuXG4gICAqL1xuICBicm9hZGNhc3RlcigpIHtcbiAgICBpZiAodGhpcy5jb25maWcuYnJvYWRjYXN0ZXIpIHJldHVybiB0aGlzLmNvbmZpZy5icm9hZGNhc3RlclxuXG4gICAgcmV0dXJuIGFzeW5jICh7Ym9keSwgY2hhbm5lbCwgcGFyYW1zfSkgPT4ge1xuICAgICAgdGhpcy5jb25maWcuY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoY2hhbm5lbCwgcGFyYW1zLCBib2R5KVxuICAgICAgYXdhaXQgdGhpcy5jb25maWcuY29uZmlndXJhdGlvbi5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIHBvc3QtY29tbWl0IHB1Ymxpc2ggZmFpbHVyZS4gVGhlIHRyYW5zYWN0aW9uIGhhcyBhbHJlYWR5XG4gICAqIGNvbW1pdHRlZCB3aGVuIGFmdGVyQ29tbWl0IGNhbGxiYWNrcyBydW4sIHNvIHJldGhyb3dpbmcgaGVyZSB3b3VsZCBwb2lzb25cbiAgICogdGhlIGRyaXZlcidzIGF3YWl0ZWQgYWZ0ZXJDb21taXQgY2hhaW4gKGJyZWFraW5nIHVucmVsYXRlZCBjYWxsYmFja3MpIC1cbiAgICogaW5zdGVhZCB0aGUgZmFpbHVyZSBnb2VzIHRvIHRoZSBjb25maWd1cmVkIG9uRXJyb3IgaG9vaywgb3IgaXMgZW1pdHRlZCBvblxuICAgKiB0aGUgY29uZmlndXJhdGlvbidzIGZyYW1ld29yay1lcnJvci9hbGwtZXJyb3IgY2hhbm5lbHMgKHNvIHByb2R1Y3Rpb24gYnVnXG4gICAqIHJlcG9ydGluZyB2aWEgYGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKWAgc2VlcyBhIGJyb2tlbiBwdWJsaXNoXG4gICAqIHBhdGgpIGFuZCBsb2dnZWQgbG91ZGx5IHRocm91Z2ggdGhlIHB1Ymxpc2hlcidzIGxvZ2dlciB3aGVuIG5vbmUgaXNcbiAgICogY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBQb3N0LWNvbW1pdCBwdWJsaXNoIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcInN5bmMtcHVibGlzaC1hZnRlci1jb21taXRcIn0sIGVycm9yfVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlcigpLmVycm9yKFwiU3luY1B1Ymxpc2hlciBmYWlsZWQgdG8gcHVibGlzaCBhIHNlcnZlci1zaWRlIHN5bmMgY2hhbmdlIGFmdGVyIGNvbW1pdFwiLCBlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgcHVibGlzaGVyIGxvZ2dlci5cbiAgICogQHJldHVybnMge0xvZ2dlcn0gUHVibGlzaGVyIGxvZ2dlci5cbiAgICovXG4gIGxvZ2dlcigpIHtcbiAgICB0aGlzLl9sb2dnZXIgfHw9IG5ldyBMb2dnZXIoXCJTeW5jUHVibGlzaGVyXCIsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9ufSlcblxuICAgIHJldHVybiB0aGlzLl9sb2dnZXJcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgbW9kZWwgY2xhc3MncyBhY3RpdmUgcHVibGlzaCBkZWNsYXJhdGlvbiBmcm9tIGBzdGF0aWMgc3luY2AuXG4gKiBPcHRlZC1vdXQgKGBwdWJsaXNoOiBmYWxzZWApIGFuZCB1bmRlY2xhcmVkIG1vZGVscyByZXNvbHZlIHRvIG51bGw7IGV2ZXJ5XG4gKiBvdGhlciBkZWNsYXJlZCB2YWx1ZSBmbG93cyBpbnRvIGxvdWQgZGVjbGFyYXRpb24gdmFsaWRhdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1vZGVsQ2xhc3MgLSBSZWdpc3RlcmVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbiB8IG51bGx9IEFjdGl2ZSBwdWJsaXNoIGRlY2xhcmF0aW9uLCBvciBudWxsLlxuICovXG5mdW5jdGlvbiBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcykge1xuICBjb25zdCBkZWNsYXJhdGlvbiA9IG1vZGVsQ2xhc3Muc3luY1xuXG4gIGlmICghZGVjbGFyYXRpb24gfHwgdHlwZW9mIGRlY2xhcmF0aW9uICE9PSBcIm9iamVjdFwiIHx8IGRlY2xhcmF0aW9uLnB1Ymxpc2ggPT09IHVuZGVmaW5lZCB8fCBkZWNsYXJhdGlvbi5wdWJsaXNoID09PSBmYWxzZSkgcmV0dXJuIG51bGxcblxuICByZXR1cm4gZGVjbGFyYXRpb24ucHVibGlzaFxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgcHVibGlzaGVkIHJlc291cmNlIGNvbmZpZyBmcm9tIGEgbW9kZWwncyBgc3RhdGljIHN5bmNgIHB1Ymxpc2hcbiAqIGRlY2xhcmF0aW9uLiBgcHVibGlzaDogdHJ1ZWAgb3B0cyBpbiB3aXRoIGFsbCBkZWZhdWx0cyAoYXR0cmlidXRlIHBheWxvYWQsXG4gKiBkZXJpdmVkIHNjb3BlIHBhcnRpdGlvbiwgY3JlYXRlZC91cGRhdGVkIG9wZXJhdGlvbnMpLlxuICogQHBhcmFtIHt7bW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHB1Ymxpc2g6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbiB8IG51bGwsIHNjb3BlQXR0cmlidXRlczogc3RyaW5nW10gfCBudWxsLCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIERlY2xhcmF0aW9uIGFyZ3MgcGx1cyB0aGUgc3luYyBtb2RlbCdzIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9IERlcml2ZWQgcmVzb3VyY2UgY29uZmlnLlxuICovXG5mdW5jdGlvbiByZXNvdXJjZUNvbmZpZ0Zyb21QdWJsaXNoRGVjbGFyYXRpb24oe21vZGVsQ2xhc3MsIHB1Ymxpc2gsIHNjb3BlQXR0cmlidXRlczogc3luY1Njb3BlQXR0cmlidXRlcywgc3luY01vZGVsfSkge1xuICBjb25zdCBtb2RlbE5hbWUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gIGNvbnN0IG5vcm1hbGl6ZWRQdWJsaXNoID0gcHVibGlzaCA9PT0gdHJ1ZSA/IHt9IDogcHVibGlzaFxuXG4gIGlmICghbm9ybWFsaXplZFB1Ymxpc2ggfHwgdHlwZW9mIG5vcm1hbGl6ZWRQdWJsaXNoICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobm9ybWFsaXplZFB1Ymxpc2gpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBtdXN0IGJlIHRydWUsIGZhbHNlIG9yIGEgcHVibGlzaCBkZWNsYXJhdGlvbiBvYmplY3QsIGdvdDogJHtTdHJpbmcocHVibGlzaCl9YClcbiAgfVxuXG4gIGNvbnN0IHticm9hZGNhc3RzLCBldmVudElkLCBvcGVyYXRpb25zLCByZXNvdXJjZVR5cGUsIHNjb3BlQXR0cmlidXRlcywgc2VyaWFsaXplLCAuLi5yZXN0RGVjbGFyYXRpb259ID0gbm9ybWFsaXplZFB1Ymxpc2hcbiAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0RGVjbGFyYXRpb24pXG5cbiAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHJlY2VpdmVkIHVua25vd24ga2V5czogJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGJyb2FkY2FzdHMsIGV2ZW50SWQgKGRlcHJlY2F0ZWQpLCBvcGVyYXRpb25zLCByZXNvdXJjZVR5cGUsIHNjb3BlQXR0cmlidXRlcywgc2VyaWFsaXplKWApXG4gIH1cbiAgaWYgKHNlcmlhbGl6ZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBzZXJpYWxpemUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2VyaWFsaXplIG11c3QgYmUgYSBmdW5jdGlvbiBidWlsZGluZyB0aGUgcHVibGlzaGVkIHBheWxvYWQsIGdvdDogJHtTdHJpbmcoc2VyaWFsaXplKX1gKVxuICB9XG4gIGlmIChvcGVyYXRpb25zICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob3BlcmF0aW9ucykgfHwgb3BlcmF0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggb3BlcmF0aW9ucyBtdXN0IGJlIGEgbm9uLWVtcHR5IGFycmF5IG9mIGNyZWF0ZS91cGRhdGUvZGVzdHJveWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2Ygb3BlcmF0aW9ucykge1xuICAgICAgaWYgKCEob3BlcmF0aW9uIGluIFBVQkxJU0hFRF9DQUxMQkFDS19OQU1FUykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBvcGVyYXRpb25zIG11c3QgYmUgY3JlYXRlL3VwZGF0ZS9kZXN0cm95LCBnb3Q6ICR7U3RyaW5nKG9wZXJhdGlvbil9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBzY29wZVBsYW4gPSBzY29wZVBsYW5Gb3Ioe2V2ZW50SWQsIG1vZGVsQ2xhc3MsIG1vZGVsTmFtZSwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWwsIHN5bmNTY29wZUF0dHJpYnV0ZXN9KVxuXG4gIHJldHVybiB7XG4gICAgYnJvYWRjYXN0cyxcbiAgICBtb2RlbENsYXNzLFxuICAgIG9wZXJhdGlvbnM6IG9wZXJhdGlvbnMgPT09IHVuZGVmaW5lZCA/IERFRkFVTFRfUFVCTElTSEVEX09QRVJBVElPTlMgOiBvcGVyYXRpb25zLFxuICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2VUeXBlID09PSB1bmRlZmluZWQgPyBtb2RlbE5hbWUgOiByZXNvdXJjZVR5cGUsXG4gICAgc2NvcGVBdHRyaWJ1dGVzUmVzb2x2ZXI6IHR5cGVvZiBzY29wZUF0dHJpYnV0ZXMgPT09IFwiZnVuY3Rpb25cIiA/IHNjb3BlQXR0cmlidXRlcyA6IHVuZGVmaW5lZCxcbiAgICBzY29wZVBsYW4sXG4gICAgc2VyaWFsaXplOiBzZXJpYWxpemUgPT09IHVuZGVmaW5lZCA/IGRlZmF1bHRTZXJpYWxpemVkQXR0cmlidXRlcyA6IHNlcmlhbGl6ZVxuICB9XG59XG5cbi8qKlxuICogRGVyaXZlcyB0aGUgc2NvcGUgcGxhbiBwYXJ0aXRpb25pbmcgYSBwdWJsaXNoZWQgbW9kZWwncyBjaGFuZ2VzOiBvbmUgZW50cnlcbiAqIHBlciBzY29wZSBhdHRyaWJ1dGUgZGVjbGFyZWQgb24gdGhlIHN5bmMgbW9kZWwgKGBzdGF0aWNcbiAqIHN5bmNTY29wZUF0dHJpYnV0ZXNgKSwgZWFjaCByZWFkaW5nIHRoZSByZWNvcmQgYXR0cmlidXRlIG5hbWVkIGxpa2UgdGhlXG4gKiBzY29wZSBhdHRyaWJ1dGUgKG92ZXJyaWRhYmxlIHRocm91Z2ggdGhlIGRlY2xhcmF0aW9uJ3MgYHNjb3BlQXR0cmlidXRlc2BcbiAqIG5hbWUgbWFwKSwgb3IgdGhlIHJlY29yZCdzIG93biBpZCB3aGVuIHRoZSBtb2RlbCBoYXMgbm8gc3VjaCBhdHRyaWJ1dGVcbiAqIChzY29wZS1yb290IG1vZGVscykuIFRoZSBkZXByZWNhdGVkIGBldmVudElkYCBkZWNsYXJhdGlvbiBmb3JtcyBtYXAgdG8gYVxuICogZml4ZWQgYGV2ZW50SWRgL2BldmVudF9pZGAgcGxhbiBmb3IgMS4wLjUwMyBjb21wYXRpYmlsaXR5LlxuICogQHBhcmFtIHt7ZXZlbnRJZDogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uQ29uZmlnW1wiZXZlbnRJZFwiXSwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1vZGVsTmFtZTogc3RyaW5nLCBzY29wZUF0dHJpYnV0ZXM6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbkNvbmZpZ1tcInNjb3BlQXR0cmlidXRlc1wiXSwgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc3luY1Njb3BlQXR0cmlidXRlczogc3RyaW5nW10gfCBudWxsfX0gYXJncyAtIERlY2xhcmF0aW9uIGFuZCBzeW5jLW1vZGVsIHNjb3BlIGFyZ3MuXG4gKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyU2NvcGVQbGFuRW50cnk+fSBEZXJpdmVkIHNjb3BlIHBsYW4uXG4gKi9cbmZ1bmN0aW9uIHNjb3BlUGxhbkZvcih7ZXZlbnRJZCwgbW9kZWxDbGFzcywgbW9kZWxOYW1lLCBzY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbCwgc3luY1Njb3BlQXR0cmlidXRlc30pIHtcbiAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBPYmplY3QudmFsdWVzKG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpKVxuXG4gIGlmIChldmVudElkICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoc2NvcGVBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggY2FuJ3QgZGVjbGFyZSBib3RoIHNjb3BlQXR0cmlidXRlcyBhbmQgdGhlIGRlcHJlY2F0ZWQgZXZlbnRJZCBmb3JtYClcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBldmVudElkID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBbe2NvbHVtbk5hbWU6IFwiZXZlbnRfaWRcIiwgcmVjb3JkQXR0cmlidXRlOiBudWxsLCByZXNvbHZlcjogZXZlbnRJZCwgc2NvcGVBdHRyaWJ1dGU6IFwiZXZlbnRJZFwifV1cbiAgICB9XG4gICAgaWYgKHR5cGVvZiBldmVudElkICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGV2ZW50SWQgbXVzdCBiZSBhbiBhdHRyaWJ1dGUtbmFtZSBzdHJpbmcgKG9yIGEgZGVwcmVjYXRlZCByZXNvbHZlciBmdW5jdGlvbiksIGdvdDogJHtTdHJpbmcoZXZlbnRJZCl9YClcbiAgICB9XG4gICAgaWYgKCFhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhldmVudElkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBldmVudElkIGF0dHJpYnV0ZSBkb2Vzbid0IGV4aXN0IG9uIHRoZSBtb2RlbDogJHtldmVudElkfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIFt7Y29sdW1uTmFtZTogXCJldmVudF9pZFwiLCByZWNvcmRBdHRyaWJ1dGU6IGV2ZW50SWQsIHJlc29sdmVyOiB1bmRlZmluZWQsIHNjb3BlQXR0cmlidXRlOiBcImV2ZW50SWRcIn1dXG4gIH1cblxuICBpZiAoc2NvcGVBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgJiYgIXN5bmNTY29wZUF0dHJpYnV0ZXMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGRlY2xhcmVzIHNjb3BlQXR0cmlidXRlcyBidXQgdGhlIHN5bmMgbW9kZWwgZGVjbGFyZXMgbm8gc3RhdGljIHN5bmNTY29wZUF0dHJpYnV0ZXNgKVxuICB9XG5cbiAgaWYgKCFzeW5jU2NvcGVBdHRyaWJ1dGVzKSByZXR1cm4gW11cblxuICBpZiAodHlwZW9mIHNjb3BlQXR0cmlidXRlcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgcmV0dXJuIHN5bmNTY29wZUF0dHJpYnV0ZXMubWFwKChzY29wZUF0dHJpYnV0ZSkgPT4gKHtcbiAgICAgIGNvbHVtbk5hbWU6IHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSxcbiAgICAgIHJlY29yZEF0dHJpYnV0ZTogbnVsbCxcbiAgICAgIHJlc29sdmVyOiB1bmRlZmluZWQsXG4gICAgICBzY29wZUF0dHJpYnV0ZVxuICAgIH0pKVxuICB9XG5cbiAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2Ygc2NvcGVBdHRyaWJ1dGVzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2NvcGVBdHRyaWJ1dGVzKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdCBtYXBwaW5nIHNjb3BlIGF0dHJpYnV0ZXMgdG8gcmVjb3JkIGF0dHJpYnV0ZSBuYW1lcywgZ290OiAke1N0cmluZyhzY29wZUF0dHJpYnV0ZXMpfWApXG4gIH1cblxuICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIE9iamVjdC5rZXlzKHNjb3BlQXR0cmlidXRlcyB8fCB7fSkpIHtcbiAgICBpZiAoIXN5bmNTY29wZUF0dHJpYnV0ZXMuaW5jbHVkZXMoc2NvcGVBdHRyaWJ1dGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyByZWNlaXZlZCB1bmtub3duIHNjb3BlIGF0dHJpYnV0ZTogJHtzY29wZUF0dHJpYnV0ZX0gKHRoZSBzeW5jIG1vZGVsIGRlY2xhcmVzOiAke3N5bmNTY29wZUF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfSlgKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzeW5jU2NvcGVBdHRyaWJ1dGVzLm1hcCgoc2NvcGVBdHRyaWJ1dGUpID0+IHtcbiAgICBjb25zdCBkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSA9IHNjb3BlQXR0cmlidXRlcz8uW3Njb3BlQXR0cmlidXRlXVxuXG4gICAgaWYgKGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICh0eXBlb2YgZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUgIT09IFwic3RyaW5nXCIgfHwgIWF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcy4ke3Njb3BlQXR0cmlidXRlfSBtdXN0IG5hbWUgYW4gZXhpc3RpbmcgcmVjb3JkIGF0dHJpYnV0ZSwgZ290OiAke1N0cmluZyhkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSl9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtjb2x1bW5OYW1lOiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSksIHJlY29yZEF0dHJpYnV0ZTogZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUsIHJlc29sdmVyOiB1bmRlZmluZWQsIHNjb3BlQXR0cmlidXRlfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjb2x1bW5OYW1lOiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSksXG4gICAgICByZWNvcmRBdHRyaWJ1dGU6IGF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKHNjb3BlQXR0cmlidXRlKSA/IHNjb3BlQXR0cmlidXRlIDogbnVsbCxcbiAgICAgIHJlc29sdmVyOiB1bmRlZmluZWQsXG4gICAgICBzY29wZUF0dHJpYnV0ZVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBDaGVja3MgdGhhdCBhIGNvbXB1dGVkIGRlY2xhcmF0aW9uIHJldHVybmVkIGFuIG9yZGluYXJ5IGtleS92YWx1ZSBvYmplY3QuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmVzb2x2ZXIgcmVzdWx0LlxuICogQHJldHVybnMge3ZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+fSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gaXNQbGFpbk9iamVjdCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIHN5bmMtcm93IGNvbHVtbiBwZXJzaXN0aW5nIGEgZGVjbGFyZWQgc2NvcGUgYXR0cmlidXRlLlxuICogQHBhcmFtIHt7c2NvcGVBdHRyaWJ1dGU6IHN0cmluZywgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBTY29wZSBhdHRyaWJ1dGUgYW5kIHN5bmMgbW9kZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBTeW5jLXJvdyBjb2x1bW4gbmFtZS5cbiAqL1xuZnVuY3Rpb24gc3luY1Njb3BlQ29sdW1uTmFtZSh7c2NvcGVBdHRyaWJ1dGUsIHN5bmNNb2RlbH0pIHtcbiAgY29uc3QgY29sdW1uTmFtZSA9IHN5bmNNb2RlbC5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbc2NvcGVBdHRyaWJ1dGVdXG5cbiAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3N5bmNNb2RlbC5uYW1lfSBkZWNsYXJlcyB0aGUgc3luYyBzY29wZSBhdHRyaWJ1dGUgJHtzY29wZUF0dHJpYnV0ZX0gYnV0IGhhcyBubyBtYXRjaGluZyBjb2x1bW4gZm9yIGl0YClcbiAgfVxuXG4gIHJldHVybiBjb2x1bW5OYW1lXG59XG5cbi8qKlxuICogRGVmYXVsdCBwdWJsaXNoIHNlcmlhbGl6ZXI6IHRoZSByZWNvcmQncyBhdHRyaWJ1dGVzIHdpdGggRGF0ZSB2YWx1ZXNcbiAqIHNlcmlhbGl6ZWQgdG8gSVNPIHN0cmluZ3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBNdXRhdGVkIHNlcnZlciBtb2RlbCByZWNvcmQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBTZXJpYWxpemVkIGF0dHJpYnV0ZXMgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdFNlcmlhbGl6ZWRBdHRyaWJ1dGVzKHJlY29yZCkge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgYXR0cmlidXRlcyA9IHsuLi5yZWNvcmQuYXR0cmlidXRlcygpfVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZS50b0lTT1N0cmluZygpXG4gIH1cblxuICByZXR1cm4gYXR0cmlidXRlc1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZGF0ZS1saWtlIHZhbHVlIHRvIGFuIElTTyBzdHJpbmcsIG1hdGNoaW5nIHRoZSBjaGFuZ2UtZmVlZFxuICogc2VyaWFsaXplcidzIGNvbnZlbnRpb24gZm9yIHRoZSBzeW5jIGVudHJ5J3MgcHVibGljIHVwZGF0ZWQtYXQgbWV0YWRhdGEuXG4gKiBAcGFyYW0ge0RhdGUgfCBudWxsfSB2YWx1ZSAtIFBlcnNpc3RlZCB1cGRhdGVkLWF0IHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gSVNPIGRhdGUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gV2hlbiB0aGUgcGVyc2lzdGVkIHJvdyBoYXMgbm8gdmFsaWQgdXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gKi9cbmZ1bmN0aW9uIGlzb0RhdGUodmFsdWUpIHtcbiAgaWYgKCEodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlB1Ymxpc2hlZCBzeW5jIHJvdyBtdXN0IGhhdmUgYSB2YWxpZCB1cGRhdGVkQXQgdGltZXN0YW1wLlwiKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbn1cbiJdfQ==