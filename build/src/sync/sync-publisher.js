// @ts-check
import Configuration from "../configuration.js";
import Logger from "../logger.js";
import { scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
import restArgsError from "../utils/rest-args-error.js";
import { declaredSyncScopeAttributes } from "./sync-scope-attributes.js";
import { deliverDeclaredBroadcasts } from "./sync-change-fanout.js";
import { isPublishingSuppressed } from "./sync-publish-suppression.js";
import { upsertServerOriginSyncRow } from "./upsert-server-origin-sync-row.js";
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
                    const syncRow = await upsertServerOriginSyncRow({
                        actorForeignKeyColumn: this.config.actorForeignKeyColumn,
                        attributes,
                        persistenceModel: operationScope,
                        scopeColumnNames: resourceConfig.scopePlan.map(({ columnName }) => columnName),
                        syncModel: this.config.syncModel
                    });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1wdWJsaXNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXB1Ymxpc2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3hFLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZELE9BQU8sRUFBQywyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3RFLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ2pFLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLG9DQUFvQyxDQUFBO0FBQzVFLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLHdCQUF3QixDQUFBO0FBRTdELHNGQUFzRjtBQUN0RixNQUFNLHdCQUF3QixHQUFHLEVBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUMsQ0FBQTtBQUV4Rzs7Ozs7O29EQU1vRDtBQUNwRCxNQUFNLDRCQUE0QixHQUFHLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO0FBRXpELG9EQUFvRDtBQUNwRCxNQUFNLGdDQUFnQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFdEQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxPQUFPLEdBQUcsRUFBRTtRQUN0QixNQUFNLEVBQUMscUJBQXFCLEdBQUcseUJBQXlCLEVBQUUsV0FBVyxFQUFF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QUErQixFQUFFLENBQUMsY0FBYyxDQUFDLENBQUE7SUFFOUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxTQUFTLENBQUMsSUFBSSxzQ0FBc0MsY0FBYyxvQ0FBb0MsQ0FBQyxDQUFBO0lBQzVILENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQTtBQUNuQixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLDJCQUEyQixDQUFDLE1BQU07SUFDekMsNERBQTREO0lBQzVELE1BQU0sVUFBVSxHQUFHLEVBQUMsR0FBRyxNQUFNLENBQUMsVUFBVSxFQUFFLEVBQUMsQ0FBQTtJQUUzQyxLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ2hFLElBQUksS0FBSyxZQUFZLElBQUk7WUFBRSxVQUFVLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQzVFLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQTtBQUNuQixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxPQUFPLENBQUMsS0FBSztJQUNwQixJQUFJLENBQUMsQ0FBQyxLQUFLLFlBQVksSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQzlELE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELENBQUMsQ0FBQTtJQUM5RSxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUE7QUFDNUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5pbXBvcnQge2RlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlc30gZnJvbSBcIi4vc3luYy1zY29wZS1hdHRyaWJ1dGVzLmpzXCJcbmltcG9ydCB7ZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0c30gZnJvbSBcIi4vc3luYy1jaGFuZ2UtZmFub3V0LmpzXCJcbmltcG9ydCB7aXNQdWJsaXNoaW5nU3VwcHJlc3NlZH0gZnJvbSBcIi4vc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzXCJcbmltcG9ydCB7dXBzZXJ0U2VydmVyT3JpZ2luU3luY1Jvd30gZnJvbSBcIi4vdXBzZXJ0LXNlcnZlci1vcmlnaW4tc3luYy1yb3cuanNcIlxuaW1wb3J0IHtWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSBmcm9tIFwiLi9zeW5jLWNoYW5uZWwtbmFtZS5qc1wiXG5cbi8qKiBAdHlwZSB7e2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIn19ICovXG5jb25zdCBQVUJMSVNIRURfQ0FMTEJBQ0tfTkFNRVMgPSB7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwifVxuXG4vKipcbiAqIE9wZXJhdGlvbnMgcHVibGlzaGVkIGJ5IGRlZmF1bHQgZm9yIG1vZGVscyBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCBwdWJsaXNoXG4gKiB3aXRob3V0IGFuIGBvcGVyYXRpb25zYCBrZXk6IHNlcnZlci1zaWRlIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcHVibGlzaFxuICogYXV0b21hdGljYWxseS4gRGVzdHJveXMgYXJlIG5vdCBwdWJsaXNoZWQgYnkgZGVmYXVsdCBiZWNhdXNlIGEgc2VydmVyXG4gKiBkZXN0cm95IGlzIG9mdGVuIGNsZWFudXAgcmF0aGVyIHRoYW4gYSBzeW5jZWQgZGVsZXRlOyBvcHQgaW4gd2l0aCBhblxuICogb3BlcmF0aW9ucyBsaXN0LlxuICogQHR5cGUge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSAqL1xuY29uc3QgREVGQVVMVF9QVUJMSVNIRURfT1BFUkFUSU9OUyA9IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXVxuXG4vKiogQHR5cGUge1dlYWtNYXA8Q29uZmlndXJhdGlvbiwgU3luY1B1Ymxpc2hlcj59ICovXG5jb25zdCBzdGFydGVkUHVibGlzaGVyc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBEZWNsYXJhdGl2ZSBzZXJ2ZXItc2lkZSBzeW5jIHB1Ymxpc2hlciDigJQgdGhlIHNlcnZlciBtaXJyb3Igb2YgdGhlIGNsaWVudCdzXG4gKiB0cmFjay1ieS1kZWZhdWx0IG11dGF0aW9uIHRyYWNraW5nLlxuICpcbiAqIFNlcnZlciBtb2RlbHMgZGVjbGFyZSB3aGF0IHRvIHB1Ymxpc2ggdGhyb3VnaCBgc3RhdGljIHN5bmNgJ3MgYHB1Ymxpc2hgXG4gKiBrZXksIGFuZCBWZWxvY2lvdXMgd3JpdGVzIGV2ZXJ5IGNvbW1pdHRlZCBzZXJ2ZXItc2lkZSBjaGFuZ2UgdG8gdGhlIHN5bmNcbiAqIGNoYW5nZSBmZWVkIChtb2RlbC1iYWNrZWQgU3luYy1yb3cgdXBzZXJ0IHdpdGggc2VydmVyIHJlLXNlcXVlbmNpbmcpIGFuZFxuICogYnJvYWRjYXN0cyB0aGUgc3RhbmRhcmQgc3luYyBlbnZlbG9wZSAoYHtlY2hvT3JpZ2luLCBzeW5jczogWy4uLl19YCkgb24gdGhlXG4gKiBmcmFtZXdvcmsgc3luYyBjaGFubmVsICh7QGxpbmsgVkVMT0NJT1VTX1NZTkNfQ0hBTk5FTH0pIHNjb3BlZCBieSB0aGVcbiAqIGNoYW5nZSdzIGRlcml2ZWQgc2NvcGUtcGFydGl0aW9uIHZhbHVlcywgc28gZGV2aWNlcyByZWNlaXZlIHNlcnZlci1vcmlnaW5cbiAqIGNoYW5nZXMgd2l0aG91dCBhcHAgY29kZSBkZWNsYXJpbmcgY2hhbm5lbHMgb3IgY2FsbGluZyBtYW51YWxcbiAqIHVwc2VydC9icm9hZGNhc3QgaGVscGVyczpcbiAqXG4gKiAgICAgc3RhdGljIHN5bmMgPSB7cHVibGlzaDogdHJ1ZX0gLy8gZGVmYXVsdCBwYXlsb2FkIChhdHRyaWJ1dGVzKSArIGRlZmF1bHQgc2NvcGUgcGFydGl0aW9uXG4gKiAgICAgc3RhdGljIHN5bmMgPSB7cHVibGlzaDoge3NlcmlhbGl6ZTogKHJlY29yZCkgPT4gKHtpZDogcmVjb3JkLmlkKCksIHBpbjogcmVjb3JkLnBpbigpfSl9fVxuICpcbiAqIFRoZSBzY29wZSBwYXJ0aXRpb24gY29tZXMgZnJvbSB0aGUgc3luYyBtb2RlbCdzIGBzdGF0aWNcbiAqIHN5bmNTY29wZUF0dHJpYnV0ZXNgIGRlY2xhcmF0aW9uIChmb3IgZXhhbXBsZSBgW1wiZXZlbnRJZFwiXWAgb3JcbiAqIGBbXCJhY2NvdW50SWRcIl1gIOKAlCBWZWxvY2lvdXMgaGFzIG5vIGJ1aWx0LWluIHBhcnRpdGlvbiBuYW1lKTogZWFjaCBkZWNsYXJlZFxuICogc2NvcGUgYXR0cmlidXRlIHJlYWRzIHRoZSByZWNvcmQncyBhdHRyaWJ1dGUgb2YgdGhlIHNhbWUgbmFtZSB3aGVuIHRoZVxuICogbW9kZWwgaGFzIG9uZSwgZWxzZSB0aGUgcmVjb3JkJ3Mgb3duIGlkIChzY29wZS1yb290IG1vZGVscyksIG92ZXJyaWRhYmxlXG4gKiBwZXIgbW9kZWwgdGhyb3VnaCBgcHVibGlzaDoge3Njb3BlQXR0cmlidXRlczoge2FjY291bnRJZDogXCJvd25lcklkXCJ9fWAuXG4gKiBUaGUgcHJlLWZyYW1ld29yay1jaGFubmVsIGBicm9hZGNhc3RzYCBsaXN0IGFuZCB0aGUgYGV2ZW50SWRgXG4gKiBzdHJpbmcvcmVzb2x2ZXItZnVuY3Rpb24gZGVjbGFyYXRpb24gZm9ybXMga2VlcCB3b3JraW5nIGJ1dCBhcmUgZGVwcmVjYXRlZC5cbiAqXG4gKiBSZXBsYXllZCBkZXZpY2UgbXV0YXRpb25zIG5ldmVyIGRvdWJsZS1wdWJsaXNoOiB0aGUgZnJhbWV3b3JrJ3Mgcm91dGVkXG4gKiByZXBsYXkgYXBwbHkgbWFya3MgaXRzIHdyaXR0ZW4gcmVjb3JkcyB0aHJvdWdoIGBtYXJrU2VydmVyQXBwbHkocmVjb3JkKWBcbiAqIChzZWUgc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzKSwgYW5kIGFwcCBjb2RlIGFwcGx5aW5nIGFscmVhZHktc3luY2VkXG4gKiBkYXRhIGNhbiB1c2UgYG1hcmtTZXJ2ZXJBcHBseWAvYHdpdGhvdXRQdWJsaXNoaW5nYCB0aGUgc2FtZSB3YXkuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNQdWJsaXNoZXIge1xuICAvKipcbiAgICogQnVpbGRzIHRoZSBzeW5jIHB1Ymxpc2hlciBieSBkZXJpdmluZyBwdWJsaXNoZWQgcmVzb3VyY2VzIGZyb20gdGhlXG4gICAqIGNvbmZpZ3VyYXRpb24ncyByZWdpc3RlcmVkIG1vZGVsczogZXZlcnkgbW9kZWwgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2BcbiAgICogd2l0aCBhIGBwdWJsaXNoYCBkZWNsYXJhdGlvbiBiZWNvbWVzIGEgcHVibGlzaGVkIHJlc291cmNlXG4gICAqIChgcHVibGlzaDogZmFsc2VgIG9wdHMgb3V0KS4gVGhlIHN5bmMvY2hhbmdlIG1vZGVsIGlzIHRoZSByZWdpc3RlcmVkXG4gICAqIFwiU3luY1wiIG1vZGVsIGFuZCBicm9hZGNhc3RzIGRlZmF1bHQgdG8gdGhlIGNvbmZpZ3VyYXRpb24ncyBjaGFubmVsXG4gICAqIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zfSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7YWN0b3JGb3JlaWduS2V5Q29sdW1uID0gXCJhdXRoZW50aWNhdGlvbl90b2tlbl9pZFwiLCBicm9hZGNhc3RlciwgY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBvbkVycm9yLCBzeW5jTW9kZWwsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG5cbiAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcHVibGlzaGluZ01vZGVsQ2xhc3NlcyA9IE9iamVjdC52YWx1ZXMobW9kZWxDbGFzc2VzKS5maWx0ZXIoKG1vZGVsQ2xhc3MpID0+IHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKSlcblxuICAgIGlmIChwdWJsaXNoaW5nTW9kZWxDbGFzc2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY1B1Ymxpc2hlciBmb3VuZCBubyByZWdpc3RlcmVkIG1vZGVscyBkZWNsYXJpbmcgc3RhdGljIHN5bmMgcHVibGlzaCAtIGRlY2xhcmUgYHN0YXRpYyBzeW5jID0ge3B1Ymxpc2g6IHtzZXJpYWxpemV9fWAgb24gdGhlIG1vZGVscyB3aG9zZSBzZXJ2ZXItc2lkZSBjaGFuZ2VzIHNob3VsZCBwdWJsaXNoIHRvIHRoZSBzeW5jIGZlZWRcIilcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZFN5bmNNb2RlbCA9IHN5bmNNb2RlbCB8fCBtb2RlbENsYXNzZXMuU3luY1xuXG4gICAgaWYgKCFyZXNvbHZlZFN5bmNNb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY1B1Ymxpc2hlciByZXF1aXJlcyBhIHJlZ2lzdGVyZWQgXFxcIlN5bmNcXFwiIG1vZGVsIGZvciBwdWJsaXNoZWQgc3luYyBjaGFuZ2Ugcm93cyAob3IgcGFzcyBvcHRpb25zLnN5bmNNb2RlbClcIilcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZUF0dHJpYnV0ZXMgPSBkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXMocmVzb2x2ZWRTeW5jTW9kZWwpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZz59ICovXG4gICAgY29uc3QgcmVzb3VyY2VzID0ge31cblxuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBwdWJsaXNoaW5nTW9kZWxDbGFzc2VzKSB7XG4gICAgICBjb25zdCBwdWJsaXNoID0gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHJlc291cmNlQ29uZmlnRnJvbVB1Ymxpc2hEZWNsYXJhdGlvbih7bW9kZWxDbGFzcywgcHVibGlzaCwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWw6IHJlc29sdmVkU3luY01vZGVsfSlcblxuICAgICAgcmVzb3VyY2VzW3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZV0gPSByZXNvdXJjZUNvbmZpZ1xuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2FjdG9yRm9yZWlnbktleUNvbHVtbjogc3RyaW5nLCBicm9hZGNhc3RlcjogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc1tcImJyb2FkY2FzdGVyXCJdLCBjb25maWd1cmF0aW9uOiBDb25maWd1cmF0aW9uLCBvbkVycm9yOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wib25FcnJvclwiXSwgcmVzb3VyY2VzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZz4sIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqL1xuICAgIHRoaXMuY29uZmlnID0ge2FjdG9yRm9yZWlnbktleUNvbHVtbiwgYnJvYWRjYXN0ZXIsIGNvbmZpZ3VyYXRpb24sIG9uRXJyb3IsIHJlc291cmNlcywgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbH1cbiAgICAvKiogQHR5cGUge0FycmF5PHtjYWxsYmFjazogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFByb21pc2U8dm9pZD4sIGNhbGxiYWNrTmFtZTogXCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MgPSBbXVxuICAgIC8qKiBAdHlwZSB7TG9nZ2VyIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2dnZXIgPSBudWxsXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3luYyBwdWJsaXNoZXIgZGVyaXZlZCBmcm9tIHRoZSBnaXZlbiBjb25maWd1cmF0aW9uLiBBbGlhcyBmb3JcbiAgICogYG5ldyBTeW5jUHVibGlzaGVyKHtjb25maWd1cmF0aW9uLCAuLi5vcHRpb25zfSlgLlxuICAgKiBAcGFyYW0ge0NvbmZpZ3VyYXRpb259IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSByZWdpc3RlcmVkIG1vZGVscy4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnMsIFwiY29uZmlndXJhdGlvblwiPn0gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7U3luY1B1Ymxpc2hlcn0gU3luYyBwdWJsaXNoZXIgZGVyaXZlZCBmcm9tIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jUHVibGlzaGVyKHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgKGFuZCBtZW1vaXplcyBwZXIgY29uZmlndXJhdGlvbikgdGhlIHN5bmMgcHVibGlzaGVyIGZvciBhIHNlcnZlclxuICAgKiBib290OiBuby1vcCB3aGVuIG5vIHJlZ2lzdGVyZWQgbW9kZWwgZGVjbGFyZXMgYSBwdWJsaXNoIGNvbmZpZywgZ3VhcmRlZCBzb1xuICAgKiByZXBlYXRlZCBib290cyB3aXRoIHRoZSBzYW1lIGNvbmZpZ3VyYXRpb24gcmVnaXN0ZXIgdGhlIHB1Ymxpc2ggY2FsbGJhY2tzXG4gICAqIG9ubHkgb25jZS5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jUHVibGlzaGVyIHwgbnVsbD59IFN0YXJ0ZWQgcHVibGlzaGVyLCBvciBudWxsIHdoZW4gbm8gbW9kZWxzIGRlY2xhcmUgcHVibGlzaC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBzdGFydEZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCBzdGFydGVkUHVibGlzaGVyID0gc3RhcnRlZFB1Ymxpc2hlcnNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoc3RhcnRlZFB1Ymxpc2hlcikgcmV0dXJuIHN0YXJ0ZWRQdWJsaXNoZXJcblxuICAgIGlmICghT2JqZWN0LnZhbHVlcyhjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpKS5zb21lKChtb2RlbENsYXNzKSA9PiBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcykpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcHVibGlzaGVyID0gbmV3IFN5bmNQdWJsaXNoZXIoe2NvbmZpZ3VyYXRpb259KVxuXG4gICAgc3RhcnRlZFB1Ymxpc2hlcnNCeUNvbmZpZ3VyYXRpb24uc2V0KGNvbmZpZ3VyYXRpb24sIHB1Ymxpc2hlcilcbiAgICBhd2FpdCBwdWJsaXNoZXIuc3RhcnQoKVxuXG4gICAgcmV0dXJuIHB1Ymxpc2hlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGUgcHVibGlzaCBjYWxsYmFja3MgZm9yIGV2ZXJ5IHB1Ymxpc2hlZCByZXNvdXJjZTogc2VydmVyLXNpZGVcbiAgICogY3JlYXRlcyBhbmQgdXBkYXRlcyAoZGVzdHJveXMgd2hlbiBvcHRlZCBpbikgdXBzZXJ0IGEgc3luYyBjaGFuZ2Ugcm93IGFuZFxuICAgKiBmYW4gb3V0IHRoZSBkZWNsYXJlZCBicm9hZGNhc3RzIG9uY2UgdGhlaXIgdHJhbnNhY3Rpb24gY29tbWl0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICBpZiAodGhpcy5fc3RhcnRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydGVkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCByZXNvdXJjZUNvbmZpZyBvZiBPYmplY3QudmFsdWVzKHRoaXMuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIHJlc291cmNlQ29uZmlnLm9wZXJhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gUFVCTElTSEVEX0NBTExCQUNLX05BTUVTW29wZXJhdGlvbl1cbiAgICAgICAgY29uc3QgY2FsbGJhY2sgPSB0aGlzLnB1Ymxpc2hlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbGwgcHVibGlzaCBjYWxsYmFja3MgKHRlc3RzLCBzaHV0ZG93bikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBmb3IgKGNvbnN0IHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzfSBvZiB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MpIHtcbiAgICAgIG1vZGVsQ2xhc3MudW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzID0gW11cbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxpZmVjeWNsZSBjYWxsYmFjayBwdWJsaXNoaW5nIG9uZSBzZXJ2ZXItc2lkZSBtdXRhdGlvbi4gVGhlXG4gICAqIHB1Ymxpc2hlZCBwYXlsb2FkIChkZWNsYXJhdGlvbiBgc2VyaWFsaXplYCksIGV2ZW50IHNjb3BlLCBhbmQgc3luYyB0eXBlXG4gICAqIGFyZSBzbmFwc2hvdHRlZCBhdCBtdXRhdGlvbi1jYWxsYmFjayB0aW1lLCBzbyBhZnRlclNhdmUgaG9va3MgYXNzaWduaW5nXG4gICAqIHVuc2F2ZWQgYXR0cmlidXRlcyAob3IgYW55IGxhdGVyIGRyaWZ0IG9uIHRoZSByZWNvcmQpIGNhbm5vdCBjaGFuZ2Ugd2hhdFxuICAgKiBnZXRzIHB1Ymxpc2hlZCB2cyB3aGF0IHdhcyBjb21taXR0ZWQuIFBlcnNpc3RpbmcgYW5kIGJyb2FkY2FzdGluZyBhcmVcbiAgICogZGVmZXJyZWQgdGhyb3VnaCB0aGUgbW9kZWwgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gdGhleSBvbmx5IHJ1blxuICAgKiBvbmNlIHRoZSBtdXRhdGlvbidzIHRyYW5zYWN0aW9uIGhhcyBjb21taXR0ZWQgKGltbWVkaWF0ZWx5IHdoZW4gbm9cbiAgICogdHJhbnNhY3Rpb24gaXMgb3BlbikgLSByb2xsZWQtYmFjayBtdXRhdGlvbnMgbmV2ZXIgcHVibGlzaC4gUG9zdC1jb21taXRcbiAgICogcHVibGlzaCBmYWlsdXJlcyBhcmUgcmVwb3J0ZWQgd2l0aG91dCByZXRocm93aW5nIGludG8gdGhlIGRyaXZlcidzXG4gICAqIGFmdGVyQ29tbWl0IGNoYWluIChzZWUgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcikuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfX0gYXJncyAtIE9wZXJhdGlvbiBhbmQgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7KHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFByb21pc2U8dm9pZD59IExpZmVjeWNsZSBjYWxsYmFjay5cbiAgICovXG4gIHB1Ymxpc2hlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgcmV0dXJuIGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGlmIChpc1B1Ymxpc2hpbmdTdXBwcmVzc2VkKHJlY29yZCkpIHJldHVyblxuXG4gICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzb3VyY2VDb25maWcuc2VyaWFsaXplKHJlY29yZClcbiAgICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcoc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBTeW5jIHB1Ymxpc2hpbmcgZm9yICR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfWApKVxuICAgICAgY29uc3Qgc3luY1R5cGUgPSBvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiID8gXCJkZWxldGVcIiA6IFwidXBkYXRlXCJcbiAgICAgIGNvbnN0IHNjb3BlVmFsdWVzID0gYXdhaXQgdGhpcy5wdWJsaXNoZWRTY29wZVZhbHVlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIFt0aGlzLmNvbmZpZy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiBudWxsLFxuICAgICAgICBjbGllbnRfdXBkYXRlZF9hdDogbmV3IERhdGUoKSxcbiAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gICAgICAgIHJlc291cmNlX2lkOiByZXNvdXJjZUlkLFxuICAgICAgICByZXNvdXJjZV90eXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsXG4gICAgICAgIHN5bmNfdHlwZTogc3luY1R5cGUsXG4gICAgICAgIC4uLnNjb3BlVmFsdWVzLmNvbHVtbnNcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGFiYXNlT3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvblNjb3BlID0gZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgICAgPyBkYXRhYmFzZU9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG4gICAgICAgIDogdGhpcy5jb25maWcuc3luY01vZGVsXG5cbiAgICAgIGF3YWl0IHJlY29yZC5jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHN5bmNSb3cgPSBhd2FpdCB1cHNlcnRTZXJ2ZXJPcmlnaW5TeW5jUm93KHtcbiAgICAgICAgICAgIGFjdG9yRm9yZWlnbktleUNvbHVtbjogdGhpcy5jb25maWcuYWN0b3JGb3JlaWduS2V5Q29sdW1uLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIHBlcnNpc3RlbmNlTW9kZWw6IG9wZXJhdGlvblNjb3BlLFxuICAgICAgICAgICAgc2NvcGVDb2x1bW5OYW1lczogcmVzb3VyY2VDb25maWcuc2NvcGVQbGFuLm1hcCgoe2NvbHVtbk5hbWV9KSA9PiBjb2x1bW5OYW1lKSxcbiAgICAgICAgICAgIHN5bmNNb2RlbDogdGhpcy5jb25maWcuc3luY01vZGVsXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGF3YWl0IHRoaXMuYnJvYWRjYXN0ZXIoKSh7XG4gICAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICAgIGVjaG9PcmlnaW46IG51bGwsXG4gICAgICAgICAgICAgIHN5bmNzOiBbdGhpcy5wdWJsaXNoZWRTeW5jRW50cnkoe2RhdGEsIHJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkLCBzeW5jUm93LCBzeW5jVHlwZX0pXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNoYW5uZWw6IFZFTE9DSU9VU19TWU5DX0NIQU5ORUwsXG4gICAgICAgICAgICBwYXJhbXM6IHsuLi5zY29wZVZhbHVlcy5wYXJhbXMsIHJlc291cmNlVHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpZiAocmVzb3VyY2VDb25maWcuYnJvYWRjYXN0cykge1xuICAgICAgICAgICAgYXdhaXQgZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cyh7XG4gICAgICAgICAgICAgIGFyZ3M6IHtkYXRhLCBvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsIHN5bmNSb3csIHN5bmNUeXBlfSxcbiAgICAgICAgICAgICAgYnJvYWRjYXN0ZXI6IHRoaXMuYnJvYWRjYXN0ZXIoKSxcbiAgICAgICAgICAgICAgYnJvYWRjYXN0czogcmVzb3VyY2VDb25maWcuYnJvYWRjYXN0c1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yZXBvcnRBZnRlckNvbW1pdEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzY29wZS1wYXJ0aXRpb24gdmFsdWVzIGZvciBvbmUgcHVibGlzaGVkIG11dGF0aW9uIGZyb20gdGhlXG4gICAqIHJlc291cmNlJ3MgZGVyaXZlZCBzY29wZSBwbGFuOiBlYWNoIGVudHJ5IHJlYWRzIGl0cyByZWNvcmQgYXR0cmlidXRlIChvclxuICAgKiB0aGUgcmVjb3JkJ3Mgb3duIGlkIGZvciBzY29wZS1yb290IG1vZGVscywgb3IgdGhlIGRlcHJlY2F0ZWQgcmVzb2x2ZXJcbiAgICogZnVuY3Rpb24pLiBUaGUgdmFsdWVzIGFyZSBwZXJzaXN0ZWQgb250byB0aGUgc3luYyByb3cncyBwYXJ0aXRpb24gY29sdW1uc1xuICAgKiBhbmQgYnJvYWRjYXN0IGFzIHRoZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsJ3Mgc2NvcGluZyBwYXJhbXMuXG4gICAqIEBwYXJhbSB7e3JlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBNdXRhdGVkIHJlY29yZCBhbmQgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y29sdW1uczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD4sIHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59Pn0gU2NvcGUgdmFsdWVzIGtleWVkIGJ5IHN5bmMtcm93IGNvbHVtbiBhbmQgYnkgc2NvcGUgYXR0cmlidXRlLlxuICAgKi9cbiAgYXN5bmMgcHVibGlzaGVkU2NvcGVWYWx1ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gKi9cbiAgICBjb25zdCBjb2x1bW5zID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IHt9XG4gICAgY29uc3QgY29tcHV0ZWRTY29wZUF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5zY29wZUF0dHJpYnV0ZXNSZXNvbHZlclxuICAgICAgPyBhd2FpdCB0aGlzLnJlc29sdmVDb21wdXRlZFNjb3BlQXR0cmlidXRlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICA6IG51bGxcblxuICAgIGZvciAoY29uc3Qgc2NvcGVQbGFuRW50cnkgb2YgcmVzb3VyY2VDb25maWcuc2NvcGVQbGFuKSB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgbGV0IHJhd1ZhbHVlXG5cbiAgICAgIGlmIChjb21wdXRlZFNjb3BlQXR0cmlidXRlcykge1xuICAgICAgICByYXdWYWx1ZSA9IGNvbXB1dGVkU2NvcGVBdHRyaWJ1dGVzW3Njb3BlUGxhbkVudHJ5LnNjb3BlQXR0cmlidXRlXVxuICAgICAgfSBlbHNlIGlmIChzY29wZVBsYW5FbnRyeS5yZXNvbHZlcikge1xuICAgICAgICByYXdWYWx1ZSA9IGF3YWl0IHNjb3BlUGxhbkVudHJ5LnJlc29sdmVyKHJlY29yZClcbiAgICAgIH0gZWxzZSBpZiAoc2NvcGVQbGFuRW50cnkucmVjb3JkQXR0cmlidXRlKSB7XG4gICAgICAgIHJhd1ZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUoc2NvcGVQbGFuRW50cnkucmVjb3JkQXR0cmlidXRlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmF3VmFsdWUgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShyZWNvcmQuaWQoKSwgYFN5bmMgc2NvcGUgcHVibGlzaGluZyBmb3IgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdmFsdWUgPSByYXdWYWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHJhd1ZhbHVlID09PSBudWxsID8gbnVsbCA6IFN0cmluZyhyYXdWYWx1ZSlcblxuICAgICAgY29sdW1uc1tzY29wZVBsYW5FbnRyeS5jb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICBwYXJhbXNbc2NvcGVQbGFuRW50cnkuc2NvcGVBdHRyaWJ1dGVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4ge2NvbHVtbnMsIHBhcmFtc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgdmFsaWRhdGVzIG9uZSBjb21wdXRlZCBzY29wZS1hdHRyaWJ1dGVzIGRlY2xhcmF0aW9uLiBUaGVcbiAgICogcmVzb2x2ZXIgcnVucyBvbmNlIHBlciBwdWJsaXNoZWQgbXV0YXRpb24gd2l0aCB0aGUgZXhhY3QgY29ubmVjdGlvbiB0aGF0XG4gICAqIG93bnMgdGhhdCBtdXRhdGlvbjsgZXZlcnkgZGVjbGFyZWQgc2NvcGUgdmFsdWUgaXMgdGhlbiByZXVzZWQgZm9yIHJvd1xuICAgKiBwZXJzaXN0ZW5jZSBhbmQgYnJvYWRjYXN0IHJvdXRpbmcgc28gdGhvc2UgdHdvIGlkZW50aXRpZXMgY2Fubm90IGRyaWZ0LlxuICAgKiBAcGFyYW0ge3tyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9fSBhcmdzIC0gUmVjb3JkIGFuZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBudWxsPj59IENvbXBsZXRlIGNvbXB1dGVkIHNjb3BlIHZhbHVlcy5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVDb21wdXRlZFNjb3BlQXR0cmlidXRlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHJlc291cmNlQ29uZmlnLnNjb3BlQXR0cmlidXRlc1Jlc29sdmVyXG5cbiAgICBpZiAoIXJlc29sdmVyKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbXB1dGVkIHNjb3BlLWF0dHJpYnV0ZXMgcmVzb2x2ZXIgY29uZmlndXJlZCBmb3IgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9YClcblxuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbixcbiAgICAgIGNvbm5lY3Rpb246IHJlY29yZC5jb25uZWN0aW9uKCksXG4gICAgICByZWNvcmRcbiAgICB9KVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHJlc29sdmVkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVzb2x2ZXIgbXVzdCByZXNvbHZlIHRvIGEgcGxhaW4gb2JqZWN0YClcbiAgICB9XG5cbiAgICBjb25zdCBkZWNsYXJlZEF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5zY29wZVBsYW4ubWFwKCh7c2NvcGVBdHRyaWJ1dGV9KSA9PiBzY29wZUF0dHJpYnV0ZSlcblxuICAgIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2YgT2JqZWN0LmtleXMocmVzb2x2ZWQpKSB7XG4gICAgICBpZiAoIWRlY2xhcmVkQXR0cmlidXRlcy5pbmNsdWRlcyhzY29wZUF0dHJpYnV0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVzb2x2ZXIgcmV0dXJuZWQgdW5rbm93biBzY29wZSBhdHRyaWJ1dGU6ICR7c2NvcGVBdHRyaWJ1dGV9ICh0aGUgc3luYyBtb2RlbCBkZWNsYXJlczogJHtkZWNsYXJlZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfSlgKVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2YgZGVjbGFyZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24ocmVzb2x2ZWQsIHNjb3BlQXR0cmlidXRlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyByZXNvbHZlciBtdXN0IHJlc29sdmUgdGhlIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZSAke3Njb3BlQXR0cmlidXRlfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gcmVzb2x2ZWRbc2NvcGVBdHRyaWJ1dGVdXG5cbiAgICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGUgYXR0cmlidXRlICR7c2NvcGVBdHRyaWJ1dGV9IG11c3QgYmUgYSBzdHJpbmcsIG51bWJlciwgb3IgbnVsbGApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59ICovIChyZXNvbHZlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGZyYW1ld29yayBzeW5jIGNoYW5uZWwgZW50cnkgZm9yIG9uZSBwdWJsaXNoZWQgY2hhbmdlOiB0aGVcbiAgICogc25hcHNob3R0ZWQgcGF5bG9hZCBwbHVzIHRoZSBwZXJzaXN0ZWQgc3luYyByb3cncyBwdWJsaWMgZXhhY3Qtcm93IG1ldGFkYXRhXG4gICAqIChpZCwgc2VydmVyIHNlcXVlbmNlLCB1cGRhdGVkLWF0LCBhbmQgZGVjbGFyZWQgc2NvcGUtcGFydGl0aW9uIGF0dHJpYnV0ZXMpLlxuICAgKiBVc2VzIHRoZSBzeW5jIG1vZGVsJ3MgZ2VuZXJhdGVkIHR5cGVkIGFjY2Vzc29ycyBhbmQgZm9sbG93cyB0aGVcbiAgICogY2hhbmdlLWZlZWQgc2VyaWFsaXplcidzIHB1YmxpYyBmaWVsZCBjb252ZW50aW9uLlxuICAgKiBAcGFyYW0ge3tkYXRhOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VJZDogc3RyaW5nLCBzeW5jUm93OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc3luY1R5cGU6IHN0cmluZ319IGFyZ3MgLSBQdWJsaXNoIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEJyb2FkY2FzdCBzeW5jIGVudHJ5LlxuICAgKi9cbiAgcHVibGlzaGVkU3luY0VudHJ5KHtkYXRhLCByZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VJZCwgc3luY1Jvdywgc3luY1R5cGV9KSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7XG4gICAgICBkYXRhLFxuICAgICAgaWQ6IHN5bmNSb3cuaWQoKSxcbiAgICAgIHJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGU6IHJlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZSxcbiAgICAgIHNlcnZlclNlcXVlbmNlOiBzeW5jUm93LnNlcnZlclNlcXVlbmNlKCksXG4gICAgICBzeW5jVHlwZSxcbiAgICAgIHVwZGF0ZWRBdDogaXNvRGF0ZShzeW5jUm93LnVwZGF0ZWRBdCgpKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlQXR0cmlidXRlcyA9IGRlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIHNjb3BlQXR0cmlidXRlcyB8fCBbXSkge1xuICAgICAgY29uc3Qgc2NvcGVBY2Nlc3NvciA9IHN5bmNSb3dbc2NvcGVBdHRyaWJ1dGVdXG5cbiAgICAgIGlmICh0eXBlb2Ygc2NvcGVBY2Nlc3NvciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUHVibGlzaGVkIHN5bmMgcm93IGlzIG1pc3NpbmcgdGhlIGRlY2xhcmVkIHNjb3BlIGFjY2Vzc29yICR7c2NvcGVBdHRyaWJ1dGV9KCkuYClcbiAgICAgIH1cblxuICAgICAgZW50cnlbc2NvcGVBdHRyaWJ1dGVdID0gc2NvcGVBY2Nlc3Nvci5jYWxsKHN5bmNSb3cpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYnJvYWRjYXN0ZXIgZGVsaXZlcmluZyBkZWNsYXJlZCBicm9hZGNhc3RzOiB0aGUgaW5qZWN0ZWQgb25lLFxuICAgKiBvciB0aGUgY29uZmlndXJhdGlvbidzIGNoYW5uZWwgYnJvYWRjYXN0IGF3YWl0ZWQgdGhyb3VnaCB0aGUgcGVuZGluZ1xuICAgKiBicm9hZGNhc3QgcXVldWUuXG4gICAqIEByZXR1cm5zIHtOb25OdWxsYWJsZTxpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wiYnJvYWRjYXN0ZXJcIl0+fSBCcm9hZGNhc3QgZGVsaXZlcmVyLlxuICAgKi9cbiAgYnJvYWRjYXN0ZXIoKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLmJyb2FkY2FzdGVyKSByZXR1cm4gdGhpcy5jb25maWcuYnJvYWRjYXN0ZXJcblxuICAgIHJldHVybiBhc3luYyAoe2JvZHksIGNoYW5uZWwsIHBhcmFtc30pID0+IHtcbiAgICAgIHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKGNoYW5uZWwsIHBhcmFtcywgYm9keSlcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCBwdWJsaXNoIGZhaWx1cmUuIFRoZSB0cmFuc2FjdGlvbiBoYXMgYWxyZWFkeVxuICAgKiBjb21taXR0ZWQgd2hlbiBhZnRlckNvbW1pdCBjYWxsYmFja3MgcnVuLCBzbyByZXRocm93aW5nIGhlcmUgd291bGQgcG9pc29uXG4gICAqIHRoZSBkcml2ZXIncyBhd2FpdGVkIGFmdGVyQ29tbWl0IGNoYWluIChicmVha2luZyB1bnJlbGF0ZWQgY2FsbGJhY2tzKSAtXG4gICAqIGluc3RlYWQgdGhlIGZhaWx1cmUgZ29lcyB0byB0aGUgY29uZmlndXJlZCBvbkVycm9yIGhvb2ssIG9yIGlzIGVtaXR0ZWQgb25cbiAgICogdGhlIGNvbmZpZ3VyYXRpb24ncyBmcmFtZXdvcmstZXJyb3IvYWxsLWVycm9yIGNoYW5uZWxzIChzbyBwcm9kdWN0aW9uIGJ1Z1xuICAgKiByZXBvcnRpbmcgdmlhIGBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClgIHNlZXMgYSBicm9rZW4gcHVibGlzaFxuICAgKiBwYXRoKSBhbmQgbG9nZ2VkIGxvdWRseSB0aHJvdWdoIHRoZSBwdWJsaXNoZXIncyBsb2dnZXIgd2hlbiBub25lIGlzXG4gICAqIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gUG9zdC1jb21taXQgcHVibGlzaCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5jb25maWcub25FcnJvcikge1xuICAgICAgdGhpcy5jb25maWcub25FcnJvcihlcnJvcilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJzeW5jLXB1Ymxpc2gtYWZ0ZXItY29tbWl0XCJ9LCBlcnJvcn1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIoKS5lcnJvcihcIlN5bmNQdWJsaXNoZXIgZmFpbGVkIHRvIHB1Ymxpc2ggYSBzZXJ2ZXItc2lkZSBzeW5jIGNoYW5nZSBhZnRlciBjb21taXRcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IHB1Ymxpc2hlciBsb2dnZXIuXG4gICAqIEByZXR1cm5zIHtMb2dnZXJ9IFB1Ymxpc2hlciBsb2dnZXIuXG4gICAqL1xuICBsb2dnZXIoKSB7XG4gICAgdGhpcy5fbG9nZ2VyIHx8PSBuZXcgTG9nZ2VyKFwiU3luY1B1Ymxpc2hlclwiLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gdGhpcy5fbG9nZ2VyXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIG1vZGVsIGNsYXNzJ3MgYWN0aXZlIHB1Ymxpc2ggZGVjbGFyYXRpb24gZnJvbSBgc3RhdGljIHN5bmNgLlxuICogT3B0ZWQtb3V0IChgcHVibGlzaDogZmFsc2VgKSBhbmQgdW5kZWNsYXJlZCBtb2RlbHMgcmVzb2x2ZSB0byBudWxsOyBldmVyeVxuICogb3RoZXIgZGVjbGFyZWQgdmFsdWUgZmxvd3MgaW50byBsb3VkIGRlY2xhcmF0aW9uIHZhbGlkYXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtb2RlbENsYXNzIC0gUmVnaXN0ZXJlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb24gfCBudWxsfSBBY3RpdmUgcHVibGlzaCBkZWNsYXJhdGlvbiwgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgZGVjbGFyYXRpb24gPSBtb2RlbENsYXNzLnN5bmNcblxuICBpZiAoIWRlY2xhcmF0aW9uIHx8IHR5cGVvZiBkZWNsYXJhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBkZWNsYXJhdGlvbi5wdWJsaXNoID09PSB1bmRlZmluZWQgfHwgZGVjbGFyYXRpb24ucHVibGlzaCA9PT0gZmFsc2UpIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIGRlY2xhcmF0aW9uLnB1Ymxpc2hcbn1cblxuLyoqXG4gKiBCdWlsZHMgb25lIHB1Ymxpc2hlZCByZXNvdXJjZSBjb25maWcgZnJvbSBhIG1vZGVsJ3MgYHN0YXRpYyBzeW5jYCBwdWJsaXNoXG4gKiBkZWNsYXJhdGlvbi4gYHB1Ymxpc2g6IHRydWVgIG9wdHMgaW4gd2l0aCBhbGwgZGVmYXVsdHMgKGF0dHJpYnV0ZSBwYXlsb2FkLFxuICogZGVyaXZlZCBzY29wZSBwYXJ0aXRpb24sIGNyZWF0ZWQvdXBkYXRlZCBvcGVyYXRpb25zKS5cbiAqIEBwYXJhbSB7e21vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwdWJsaXNoOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb24gfCBudWxsLCBzY29wZUF0dHJpYnV0ZXM6IHN0cmluZ1tdIHwgbnVsbCwgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBEZWNsYXJhdGlvbiBhcmdzIHBsdXMgdGhlIHN5bmMgbW9kZWwncyBkZWNsYXJlZCBzY29wZSBhdHRyaWJ1dGVzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfSBEZXJpdmVkIHJlc291cmNlIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gcmVzb3VyY2VDb25maWdGcm9tUHVibGlzaERlY2xhcmF0aW9uKHttb2RlbENsYXNzLCBwdWJsaXNoLCBzY29wZUF0dHJpYnV0ZXM6IHN5bmNTY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbH0pIHtcbiAgY29uc3QgbW9kZWxOYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICBjb25zdCBub3JtYWxpemVkUHVibGlzaCA9IHB1Ymxpc2ggPT09IHRydWUgPyB7fSA6IHB1Ymxpc2hcblxuICBpZiAoIW5vcm1hbGl6ZWRQdWJsaXNoIHx8IHR5cGVvZiBub3JtYWxpemVkUHVibGlzaCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG5vcm1hbGl6ZWRQdWJsaXNoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggbXVzdCBiZSB0cnVlLCBmYWxzZSBvciBhIHB1Ymxpc2ggZGVjbGFyYXRpb24gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHB1Ymxpc2gpfWApXG4gIH1cblxuICBjb25zdCB7YnJvYWRjYXN0cywgZXZlbnRJZCwgb3BlcmF0aW9ucywgcmVzb3VyY2VUeXBlLCBzY29wZUF0dHJpYnV0ZXMsIHNlcmlhbGl6ZSwgLi4ucmVzdERlY2xhcmF0aW9ufSA9IG5vcm1hbGl6ZWRQdWJsaXNoXG4gIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMocmVzdERlY2xhcmF0aW9uKVxuXG4gIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBicm9hZGNhc3RzLCBldmVudElkIChkZXByZWNhdGVkKSwgb3BlcmF0aW9ucywgcmVzb3VyY2VUeXBlLCBzY29wZUF0dHJpYnV0ZXMsIHNlcmlhbGl6ZSlgKVxuICB9XG4gIGlmIChzZXJpYWxpemUgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc2VyaWFsaXplICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNlcmlhbGl6ZSBtdXN0IGJlIGEgZnVuY3Rpb24gYnVpbGRpbmcgdGhlIHB1Ymxpc2hlZCBwYXlsb2FkLCBnb3Q6ICR7U3RyaW5nKHNlcmlhbGl6ZSl9YClcbiAgfVxuICBpZiAob3BlcmF0aW9ucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9wZXJhdGlvbnMpIHx8IG9wZXJhdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIG9wZXJhdGlvbnMgbXVzdCBiZSBhIG5vbi1lbXB0eSBhcnJheSBvZiBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3lgKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgIGlmICghKG9wZXJhdGlvbiBpbiBQVUJMSVNIRURfQ0FMTEJBQ0tfTkFNRVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggb3BlcmF0aW9ucyBtdXN0IGJlIGNyZWF0ZS91cGRhdGUvZGVzdHJveSwgZ290OiAke1N0cmluZyhvcGVyYXRpb24pfWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3Qgc2NvcGVQbGFuID0gc2NvcGVQbGFuRm9yKHtldmVudElkLCBtb2RlbENsYXNzLCBtb2RlbE5hbWUsIHNjb3BlQXR0cmlidXRlcywgc3luY01vZGVsLCBzeW5jU2NvcGVBdHRyaWJ1dGVzfSlcblxuICByZXR1cm4ge1xuICAgIGJyb2FkY2FzdHMsXG4gICAgbW9kZWxDbGFzcyxcbiAgICBvcGVyYXRpb25zOiBvcGVyYXRpb25zID09PSB1bmRlZmluZWQgPyBERUZBVUxUX1BVQkxJU0hFRF9PUEVSQVRJT05TIDogb3BlcmF0aW9ucyxcbiAgICByZXNvdXJjZVR5cGU6IHJlc291cmNlVHlwZSA9PT0gdW5kZWZpbmVkID8gbW9kZWxOYW1lIDogcmVzb3VyY2VUeXBlLFxuICAgIHNjb3BlQXR0cmlidXRlc1Jlc29sdmVyOiB0eXBlb2Ygc2NvcGVBdHRyaWJ1dGVzID09PSBcImZ1bmN0aW9uXCIgPyBzY29wZUF0dHJpYnV0ZXMgOiB1bmRlZmluZWQsXG4gICAgc2NvcGVQbGFuLFxuICAgIHNlcmlhbGl6ZTogc2VyaWFsaXplID09PSB1bmRlZmluZWQgPyBkZWZhdWx0U2VyaWFsaXplZEF0dHJpYnV0ZXMgOiBzZXJpYWxpemVcbiAgfVxufVxuXG4vKipcbiAqIERlcml2ZXMgdGhlIHNjb3BlIHBsYW4gcGFydGl0aW9uaW5nIGEgcHVibGlzaGVkIG1vZGVsJ3MgY2hhbmdlczogb25lIGVudHJ5XG4gKiBwZXIgc2NvcGUgYXR0cmlidXRlIGRlY2xhcmVkIG9uIHRoZSBzeW5jIG1vZGVsIChgc3RhdGljXG4gKiBzeW5jU2NvcGVBdHRyaWJ1dGVzYCksIGVhY2ggcmVhZGluZyB0aGUgcmVjb3JkIGF0dHJpYnV0ZSBuYW1lZCBsaWtlIHRoZVxuICogc2NvcGUgYXR0cmlidXRlIChvdmVycmlkYWJsZSB0aHJvdWdoIHRoZSBkZWNsYXJhdGlvbidzIGBzY29wZUF0dHJpYnV0ZXNgXG4gKiBuYW1lIG1hcCksIG9yIHRoZSByZWNvcmQncyBvd24gaWQgd2hlbiB0aGUgbW9kZWwgaGFzIG5vIHN1Y2ggYXR0cmlidXRlXG4gKiAoc2NvcGUtcm9vdCBtb2RlbHMpLiBUaGUgZGVwcmVjYXRlZCBgZXZlbnRJZGAgZGVjbGFyYXRpb24gZm9ybXMgbWFwIHRvIGFcbiAqIGZpeGVkIGBldmVudElkYC9gZXZlbnRfaWRgIHBsYW4gZm9yIDEuMC41MDMgY29tcGF0aWJpbGl0eS5cbiAqIEBwYXJhbSB7e2V2ZW50SWQ6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbkNvbmZpZ1tcImV2ZW50SWRcIl0sIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtb2RlbE5hbWU6IHN0cmluZywgc2NvcGVBdHRyaWJ1dGVzOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb25Db25maWdbXCJzY29wZUF0dHJpYnV0ZXNcIl0sIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHN5bmNTY29wZUF0dHJpYnV0ZXM6IHN0cmluZ1tdIHwgbnVsbH19IGFyZ3MgLSBEZWNsYXJhdGlvbiBhbmQgc3luYy1tb2RlbCBzY29wZSBhcmdzLlxuICogQHJldHVybnMge0FycmF5PGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclNjb3BlUGxhbkVudHJ5Pn0gRGVyaXZlZCBzY29wZSBwbGFuLlxuICovXG5mdW5jdGlvbiBzY29wZVBsYW5Gb3Ioe2V2ZW50SWQsIG1vZGVsQ2xhc3MsIG1vZGVsTmFtZSwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWwsIHN5bmNTY29wZUF0dHJpYnV0ZXN9KSB7XG4gIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKSlcblxuICBpZiAoZXZlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGNhbid0IGRlY2xhcmUgYm90aCBzY29wZUF0dHJpYnV0ZXMgYW5kIHRoZSBkZXByZWNhdGVkIGV2ZW50SWQgZm9ybWApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZXZlbnRJZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gW3tjb2x1bW5OYW1lOiBcImV2ZW50X2lkXCIsIHJlY29yZEF0dHJpYnV0ZTogbnVsbCwgcmVzb2x2ZXI6IGV2ZW50SWQsIHNjb3BlQXR0cmlidXRlOiBcImV2ZW50SWRcIn1dXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZXZlbnRJZCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBldmVudElkIG11c3QgYmUgYW4gYXR0cmlidXRlLW5hbWUgc3RyaW5nIChvciBhIGRlcHJlY2F0ZWQgcmVzb2x2ZXIgZnVuY3Rpb24pLCBnb3Q6ICR7U3RyaW5nKGV2ZW50SWQpfWApXG4gICAgfVxuICAgIGlmICghYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoZXZlbnRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggZXZlbnRJZCBhdHRyaWJ1dGUgZG9lc24ndCBleGlzdCBvbiB0aGUgbW9kZWw6ICR7ZXZlbnRJZH1gKVxuICAgIH1cblxuICAgIHJldHVybiBbe2NvbHVtbk5hbWU6IFwiZXZlbnRfaWRcIiwgcmVjb3JkQXR0cmlidXRlOiBldmVudElkLCByZXNvbHZlcjogdW5kZWZpbmVkLCBzY29wZUF0dHJpYnV0ZTogXCJldmVudElkXCJ9XVxuICB9XG5cbiAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkICYmICFzeW5jU2NvcGVBdHRyaWJ1dGVzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBkZWNsYXJlcyBzY29wZUF0dHJpYnV0ZXMgYnV0IHRoZSBzeW5jIG1vZGVsIGRlY2xhcmVzIG5vIHN0YXRpYyBzeW5jU2NvcGVBdHRyaWJ1dGVzYClcbiAgfVxuXG4gIGlmICghc3luY1Njb3BlQXR0cmlidXRlcykgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzY29wZUF0dHJpYnV0ZXMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHJldHVybiBzeW5jU2NvcGVBdHRyaWJ1dGVzLm1hcCgoc2NvcGVBdHRyaWJ1dGUpID0+ICh7XG4gICAgICBjb2x1bW5OYW1lOiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSksXG4gICAgICByZWNvcmRBdHRyaWJ1dGU6IG51bGwsXG4gICAgICByZXNvbHZlcjogdW5kZWZpbmVkLFxuICAgICAgc2NvcGVBdHRyaWJ1dGVcbiAgICB9KSlcbiAgfVxuXG4gIGlmIChzY29wZUF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHNjb3BlQXR0cmlidXRlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNjb3BlQXR0cmlidXRlcykpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QgbWFwcGluZyBzY29wZSBhdHRyaWJ1dGVzIHRvIHJlY29yZCBhdHRyaWJ1dGUgbmFtZXMsIGdvdDogJHtTdHJpbmcoc2NvcGVBdHRyaWJ1dGVzKX1gKVxuICB9XG5cbiAgZm9yIChjb25zdCBzY29wZUF0dHJpYnV0ZSBvZiBPYmplY3Qua2V5cyhzY29wZUF0dHJpYnV0ZXMgfHwge30pKSB7XG4gICAgaWYgKCFzeW5jU2NvcGVBdHRyaWJ1dGVzLmluY2x1ZGVzKHNjb3BlQXR0cmlidXRlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVjZWl2ZWQgdW5rbm93biBzY29wZSBhdHRyaWJ1dGU6ICR7c2NvcGVBdHRyaWJ1dGV9ICh0aGUgc3luYyBtb2RlbCBkZWNsYXJlczogJHtzeW5jU2NvcGVBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX0pYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc3luY1Njb3BlQXR0cmlidXRlcy5tYXAoKHNjb3BlQXR0cmlidXRlKSA9PiB7XG4gICAgY29uc3QgZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUgPSBzY29wZUF0dHJpYnV0ZXM/LltzY29wZUF0dHJpYnV0ZV1cblxuICAgIGlmIChkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAodHlwZW9mIGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlICE9PSBcInN0cmluZ1wiIHx8ICFhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMuJHtzY29wZUF0dHJpYnV0ZX0gbXVzdCBuYW1lIGFuIGV4aXN0aW5nIHJlY29yZCBhdHRyaWJ1dGUsIGdvdDogJHtTdHJpbmcoZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUpfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Y29sdW1uTmFtZTogc3luY1Njb3BlQ29sdW1uTmFtZSh7c2NvcGVBdHRyaWJ1dGUsIHN5bmNNb2RlbH0pLCByZWNvcmRBdHRyaWJ1dGU6IGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlLCByZXNvbHZlcjogdW5kZWZpbmVkLCBzY29wZUF0dHJpYnV0ZX1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29sdW1uTmFtZTogc3luY1Njb3BlQ29sdW1uTmFtZSh7c2NvcGVBdHRyaWJ1dGUsIHN5bmNNb2RlbH0pLFxuICAgICAgcmVjb3JkQXR0cmlidXRlOiBhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhzY29wZUF0dHJpYnV0ZSkgPyBzY29wZUF0dHJpYnV0ZSA6IG51bGwsXG4gICAgICByZXNvbHZlcjogdW5kZWZpbmVkLFxuICAgICAgc2NvcGVBdHRyaWJ1dGVcbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHRoYXQgYSBjb21wdXRlZCBkZWNsYXJhdGlvbiByZXR1cm5lZCBhbiBvcmRpbmFyeSBrZXkvdmFsdWUgb2JqZWN0LlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJlc29sdmVyIHJlc3VsdC5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSBwbGFpbiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICByZXR1cm4gcHJvdG90eXBlID09PSBPYmplY3QucHJvdG90eXBlIHx8IHByb3RvdHlwZSA9PT0gbnVsbFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBzeW5jLXJvdyBjb2x1bW4gcGVyc2lzdGluZyBhIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZS5cbiAqIEBwYXJhbSB7e3Njb3BlQXR0cmlidXRlOiBzdHJpbmcsIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gU2NvcGUgYXR0cmlidXRlIGFuZCBzeW5jIG1vZGVsLlxuICogQHJldHVybnMge3N0cmluZ30gU3luYy1yb3cgY29sdW1uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSB7XG4gIGNvbnN0IGNvbHVtbk5hbWUgPSBzeW5jTW9kZWwuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Njb3BlQXR0cmlidXRlXVxuXG4gIGlmICghY29sdW1uTmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtzeW5jTW9kZWwubmFtZX0gZGVjbGFyZXMgdGhlIHN5bmMgc2NvcGUgYXR0cmlidXRlICR7c2NvcGVBdHRyaWJ1dGV9IGJ1dCBoYXMgbm8gbWF0Y2hpbmcgY29sdW1uIGZvciBpdGApXG4gIH1cblxuICByZXR1cm4gY29sdW1uTmFtZVxufVxuXG4vKipcbiAqIERlZmF1bHQgcHVibGlzaCBzZXJpYWxpemVyOiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcyB3aXRoIERhdGUgdmFsdWVzXG4gKiBzZXJpYWxpemVkIHRvIElTTyBzdHJpbmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTXV0YXRlZCBzZXJ2ZXIgbW9kZWwgcmVjb3JkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU2VyaWFsaXplZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRTZXJpYWxpemVkQXR0cmlidXRlcyhyZWNvcmQpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSB7Li4ucmVjb3JkLmF0dHJpYnV0ZXMoKX1cblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWUudG9JU09TdHJpbmcoKVxuICB9XG5cbiAgcmV0dXJuIGF0dHJpYnV0ZXNcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGRhdGUtbGlrZSB2YWx1ZSB0byBhbiBJU08gc3RyaW5nLCBtYXRjaGluZyB0aGUgY2hhbmdlLWZlZWRcbiAqIHNlcmlhbGl6ZXIncyBjb252ZW50aW9uIGZvciB0aGUgc3luYyBlbnRyeSdzIHB1YmxpYyB1cGRhdGVkLWF0IG1ldGFkYXRhLlxuICogQHBhcmFtIHtEYXRlIHwgbnVsbH0gdmFsdWUgLSBQZXJzaXN0ZWQgdXBkYXRlZC1hdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IElTTyBkYXRlLlxuICogQHRocm93cyB7RXJyb3J9IFdoZW4gdGhlIHBlcnNpc3RlZCByb3cgaGFzIG5vIHZhbGlkIHVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICovXG5mdW5jdGlvbiBpc29EYXRlKHZhbHVlKSB7XG4gIGlmICghKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKHZhbHVlLmdldFRpbWUoKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJQdWJsaXNoZWQgc3luYyByb3cgbXVzdCBoYXZlIGEgdmFsaWQgdXBkYXRlZEF0IHRpbWVzdGFtcC5cIilcbiAgfVxuXG4gIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG59XG4iXX0=