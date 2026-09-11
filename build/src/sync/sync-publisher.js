// @ts-check
import Configuration from "../configuration.js";
import Logger from "../logger.js";
import { scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
import restArgsError from "../utils/rest-args-error.js";
import sha256Hex from "../utils/sha256-hex.js";
import stableJsonStringify from "../utils/stable-json.js";
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
                    const scopeColumnNames = resourceConfig.scopePlan.map(({ columnName }) => columnName);
                    const syncRow = await this.upsertPublishedSyncRow(attributes, operationScope, scopeColumnNames);
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
     * change back to), so repeated server changes to one complete resource and
     * scope identity reuse and re-sequence one feed row. A database advisory
     * lock serializes the lookup plus shared upsert because unique constraints
     * containing nullable actor/scope columns do not enforce this identity
     * portably across supported databases.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Snapshotted sync row attributes.
     * @param {ReturnType<typeof JSON.parse>} syncModel - Operation-bound or static Sync model interface.
     * @param {string[]} scopeColumnNames - Persisted scope columns participating in the complete identity.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Upserted sync row.
     */
    async upsertPublishedSyncRow(attributes, syncModel = this.config.syncModel, scopeColumnNames = []) {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const identity = {
            [this.config.actorForeignKeyColumn]: null,
            resource_id: attributes.resource_id,
            resource_type: attributes.resource_type
        };
        for (const columnName of scopeColumnNames) {
            if (!Object.hasOwn(attributes, columnName)) {
                throw new Error(`Published sync row identity is missing the scope column ${columnName}`);
            }
            identity[columnName] = attributes[columnName];
        }
        return await this.config.syncModel.withAdvisoryLock(syncPublisherIdentityLockName(identity), async () => {
            const existingSync = await syncModel
                .where(identity)
                .first();
            return await upsertSyncRow({ attributes, existingSync, syncModel });
        }, { dedicatedConnection: true });
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
 * Returns a deterministic, MySQL-safe advisory-lock name for one complete
 * server-origin publisher identity. Stable JSON preserves null actor/scope
 * components distinctly from strings, and the truncated SHA-256 digest keeps
 * the final name below MySQL/MariaDB's 64-character `GET_LOCK` limit.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} identity - Complete sync-row identity in column form.
 * @returns {string} Advisory-lock name.
 */
function syncPublisherIdentityLockName(identity) {
    const hash = sha256Hex(stableJsonStringify(identity)).slice(0, 32);
    return `vsp:${hash}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1wdWJsaXNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXB1Ymxpc2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3hFLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFFekQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0sNEJBQTRCLENBQUE7QUFDdEUsT0FBTyxFQUFDLHlCQUF5QixFQUFFLGFBQWEsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ2hGLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3BFLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLHdCQUF3QixDQUFBO0FBRTdELHNGQUFzRjtBQUN0RixNQUFNLHdCQUF3QixHQUFHLEVBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUMsQ0FBQTtBQUV4Rzs7Ozs7O29EQU1vRDtBQUNwRCxNQUFNLDRCQUE0QixHQUFHLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO0FBRXpELG9EQUFvRDtBQUNwRCxNQUFNLGdDQUFnQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFdEQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxPQUFPLEdBQUcsRUFBRTtRQUN0QixNQUFNLEVBQUMs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LEVBQUMsY0FBYyxFQUFFLFNBQVMsRUFBQztJQUN0RCxNQUFNLFVBQVUsR0FBRyxTQUFTLENBQUMsK0JBQStCLEVBQUUsQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUU5RSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFNBQVMsQ0FBQyxJQUFJLHNDQUFzQyxjQUFjLG9DQUFvQyxDQUFDLENBQUE7SUFDNUgsQ0FBQztJQUVELE9BQU8sVUFBVSxDQUFBO0FBQ25CLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsMkJBQTJCLENBQUMsTUFBTTtJQUN6Qyw0REFBNEQ7SUFDNUQsTUFBTSxVQUFVLEdBQUcsRUFBQyxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxDQUFBO0lBRTNDLEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7UUFDaEUsSUFBSSxLQUFLLFlBQVksSUFBSTtZQUFFLFVBQVUsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDNUUsQ0FBQztJQUVELE9BQU8sVUFBVSxDQUFBO0FBQ25CLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLE9BQU8sQ0FBQyxLQUFLO0lBQ3BCLElBQUksQ0FBQyxDQUFDLEtBQUssWUFBWSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxFQUFFLENBQUM7UUFDOUQsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFBO0lBQzlFLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtBQUM1QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBDb25maWd1cmF0aW9uIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQge3NjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgc2hhMjU2SGV4IGZyb20gXCIuLi91dGlscy9zaGEyNTYtaGV4LmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuLi91dGlscy9zdGFibGUtanNvbi5qc1wiXG5cbmltcG9ydCB7ZGVjbGFyZWRTeW5jU2NvcGVBdHRyaWJ1dGVzfSBmcm9tIFwiLi9zeW5jLXNjb3BlLWF0dHJpYnV0ZXMuanNcIlxuaW1wb3J0IHtkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzLCB1cHNlcnRTeW5jUm93fSBmcm9tIFwiLi9zeW5jLWNoYW5nZS1mYW5vdXQuanNcIlxuaW1wb3J0IHtpc1B1Ymxpc2hpbmdTdXBwcmVzc2VkfSBmcm9tIFwiLi9zeW5jLXB1Ymxpc2gtc3VwcHJlc3Npb24uanNcIlxuaW1wb3J0IHtWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMfSBmcm9tIFwiLi9zeW5jLWNoYW5uZWwtbmFtZS5qc1wiXG5cbi8qKiBAdHlwZSB7e2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIn19ICovXG5jb25zdCBQVUJMSVNIRURfQ0FMTEJBQ0tfTkFNRVMgPSB7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwifVxuXG4vKipcbiAqIE9wZXJhdGlvbnMgcHVibGlzaGVkIGJ5IGRlZmF1bHQgZm9yIG1vZGVscyBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCBwdWJsaXNoXG4gKiB3aXRob3V0IGFuIGBvcGVyYXRpb25zYCBrZXk6IHNlcnZlci1zaWRlIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcHVibGlzaFxuICogYXV0b21hdGljYWxseS4gRGVzdHJveXMgYXJlIG5vdCBwdWJsaXNoZWQgYnkgZGVmYXVsdCBiZWNhdXNlIGEgc2VydmVyXG4gKiBkZXN0cm95IGlzIG9mdGVuIGNsZWFudXAgcmF0aGVyIHRoYW4gYSBzeW5jZWQgZGVsZXRlOyBvcHQgaW4gd2l0aCBhblxuICogb3BlcmF0aW9ucyBsaXN0LlxuICogQHR5cGUge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSAqL1xuY29uc3QgREVGQVVMVF9QVUJMSVNIRURfT1BFUkFUSU9OUyA9IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXVxuXG4vKiogQHR5cGUge1dlYWtNYXA8Q29uZmlndXJhdGlvbiwgU3luY1B1Ymxpc2hlcj59ICovXG5jb25zdCBzdGFydGVkUHVibGlzaGVyc0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBEZWNsYXJhdGl2ZSBzZXJ2ZXItc2lkZSBzeW5jIHB1Ymxpc2hlciDigJQgdGhlIHNlcnZlciBtaXJyb3Igb2YgdGhlIGNsaWVudCdzXG4gKiB0cmFjay1ieS1kZWZhdWx0IG11dGF0aW9uIHRyYWNraW5nLlxuICpcbiAqIFNlcnZlciBtb2RlbHMgZGVjbGFyZSB3aGF0IHRvIHB1Ymxpc2ggdGhyb3VnaCBgc3RhdGljIHN5bmNgJ3MgYHB1Ymxpc2hgXG4gKiBrZXksIGFuZCBWZWxvY2lvdXMgd3JpdGVzIGV2ZXJ5IGNvbW1pdHRlZCBzZXJ2ZXItc2lkZSBjaGFuZ2UgdG8gdGhlIHN5bmNcbiAqIGNoYW5nZSBmZWVkIChtb2RlbC1iYWNrZWQgU3luYy1yb3cgdXBzZXJ0IHdpdGggc2VydmVyIHJlLXNlcXVlbmNpbmcpIGFuZFxuICogYnJvYWRjYXN0cyB0aGUgc3RhbmRhcmQgc3luYyBlbnZlbG9wZSAoYHtlY2hvT3JpZ2luLCBzeW5jczogWy4uLl19YCkgb24gdGhlXG4gKiBmcmFtZXdvcmsgc3luYyBjaGFubmVsICh7QGxpbmsgVkVMT0NJT1VTX1NZTkNfQ0hBTk5FTH0pIHNjb3BlZCBieSB0aGVcbiAqIGNoYW5nZSdzIGRlcml2ZWQgc2NvcGUtcGFydGl0aW9uIHZhbHVlcywgc28gZGV2aWNlcyByZWNlaXZlIHNlcnZlci1vcmlnaW5cbiAqIGNoYW5nZXMgd2l0aG91dCBhcHAgY29kZSBkZWNsYXJpbmcgY2hhbm5lbHMgb3IgY2FsbGluZyBtYW51YWxcbiAqIHVwc2VydC9icm9hZGNhc3QgaGVscGVyczpcbiAqXG4gKiAgICAgc3RhdGljIHN5bmMgPSB7cHVibGlzaDogdHJ1ZX0gLy8gZGVmYXVsdCBwYXlsb2FkIChhdHRyaWJ1dGVzKSArIGRlZmF1bHQgc2NvcGUgcGFydGl0aW9uXG4gKiAgICAgc3RhdGljIHN5bmMgPSB7cHVibGlzaDoge3NlcmlhbGl6ZTogKHJlY29yZCkgPT4gKHtpZDogcmVjb3JkLmlkKCksIHBpbjogcmVjb3JkLnBpbigpfSl9fVxuICpcbiAqIFRoZSBzY29wZSBwYXJ0aXRpb24gY29tZXMgZnJvbSB0aGUgc3luYyBtb2RlbCdzIGBzdGF0aWNcbiAqIHN5bmNTY29wZUF0dHJpYnV0ZXNgIGRlY2xhcmF0aW9uIChmb3IgZXhhbXBsZSBgW1wiZXZlbnRJZFwiXWAgb3JcbiAqIGBbXCJhY2NvdW50SWRcIl1gIOKAlCBWZWxvY2lvdXMgaGFzIG5vIGJ1aWx0LWluIHBhcnRpdGlvbiBuYW1lKTogZWFjaCBkZWNsYXJlZFxuICogc2NvcGUgYXR0cmlidXRlIHJlYWRzIHRoZSByZWNvcmQncyBhdHRyaWJ1dGUgb2YgdGhlIHNhbWUgbmFtZSB3aGVuIHRoZVxuICogbW9kZWwgaGFzIG9uZSwgZWxzZSB0aGUgcmVjb3JkJ3Mgb3duIGlkIChzY29wZS1yb290IG1vZGVscyksIG92ZXJyaWRhYmxlXG4gKiBwZXIgbW9kZWwgdGhyb3VnaCBgcHVibGlzaDoge3Njb3BlQXR0cmlidXRlczoge2FjY291bnRJZDogXCJvd25lcklkXCJ9fWAuXG4gKiBUaGUgcHJlLWZyYW1ld29yay1jaGFubmVsIGBicm9hZGNhc3RzYCBsaXN0IGFuZCB0aGUgYGV2ZW50SWRgXG4gKiBzdHJpbmcvcmVzb2x2ZXItZnVuY3Rpb24gZGVjbGFyYXRpb24gZm9ybXMga2VlcCB3b3JraW5nIGJ1dCBhcmUgZGVwcmVjYXRlZC5cbiAqXG4gKiBSZXBsYXllZCBkZXZpY2UgbXV0YXRpb25zIG5ldmVyIGRvdWJsZS1wdWJsaXNoOiB0aGUgZnJhbWV3b3JrJ3Mgcm91dGVkXG4gKiByZXBsYXkgYXBwbHkgbWFya3MgaXRzIHdyaXR0ZW4gcmVjb3JkcyB0aHJvdWdoIGBtYXJrU2VydmVyQXBwbHkocmVjb3JkKWBcbiAqIChzZWUgc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzKSwgYW5kIGFwcCBjb2RlIGFwcGx5aW5nIGFscmVhZHktc3luY2VkXG4gKiBkYXRhIGNhbiB1c2UgYG1hcmtTZXJ2ZXJBcHBseWAvYHdpdGhvdXRQdWJsaXNoaW5nYCB0aGUgc2FtZSB3YXkuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNQdWJsaXNoZXIge1xuICAvKipcbiAgICogQnVpbGRzIHRoZSBzeW5jIHB1Ymxpc2hlciBieSBkZXJpdmluZyBwdWJsaXNoZWQgcmVzb3VyY2VzIGZyb20gdGhlXG4gICAqIGNvbmZpZ3VyYXRpb24ncyByZWdpc3RlcmVkIG1vZGVsczogZXZlcnkgbW9kZWwgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2BcbiAgICogd2l0aCBhIGBwdWJsaXNoYCBkZWNsYXJhdGlvbiBiZWNvbWVzIGEgcHVibGlzaGVkIHJlc291cmNlXG4gICAqIChgcHVibGlzaDogZmFsc2VgIG9wdHMgb3V0KS4gVGhlIHN5bmMvY2hhbmdlIG1vZGVsIGlzIHRoZSByZWdpc3RlcmVkXG4gICAqIFwiU3luY1wiIG1vZGVsIGFuZCBicm9hZGNhc3RzIGRlZmF1bHQgdG8gdGhlIGNvbmZpZ3VyYXRpb24ncyBjaGFubmVsXG4gICAqIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zfSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7YWN0b3JGb3JlaWduS2V5Q29sdW1uID0gXCJhdXRoZW50aWNhdGlvbl90b2tlbl9pZFwiLCBicm9hZGNhc3RlciwgY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBvbkVycm9yLCBzeW5jTW9kZWwsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG5cbiAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcHVibGlzaGluZ01vZGVsQ2xhc3NlcyA9IE9iamVjdC52YWx1ZXMobW9kZWxDbGFzc2VzKS5maWx0ZXIoKG1vZGVsQ2xhc3MpID0+IHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKSlcblxuICAgIGlmIChwdWJsaXNoaW5nTW9kZWxDbGFzc2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY1B1Ymxpc2hlciBmb3VuZCBubyByZWdpc3RlcmVkIG1vZGVscyBkZWNsYXJpbmcgc3RhdGljIHN5bmMgcHVibGlzaCAtIGRlY2xhcmUgYHN0YXRpYyBzeW5jID0ge3B1Ymxpc2g6IHtzZXJpYWxpemV9fWAgb24gdGhlIG1vZGVscyB3aG9zZSBzZXJ2ZXItc2lkZSBjaGFuZ2VzIHNob3VsZCBwdWJsaXNoIHRvIHRoZSBzeW5jIGZlZWRcIilcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZFN5bmNNb2RlbCA9IHN5bmNNb2RlbCB8fCBtb2RlbENsYXNzZXMuU3luY1xuXG4gICAgaWYgKCFyZXNvbHZlZFN5bmNNb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY1B1Ymxpc2hlciByZXF1aXJlcyBhIHJlZ2lzdGVyZWQgXFxcIlN5bmNcXFwiIG1vZGVsIGZvciBwdWJsaXNoZWQgc3luYyBjaGFuZ2Ugcm93cyAob3IgcGFzcyBvcHRpb25zLnN5bmNNb2RlbClcIilcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZUF0dHJpYnV0ZXMgPSBkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXMocmVzb2x2ZWRTeW5jTW9kZWwpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZz59ICovXG4gICAgY29uc3QgcmVzb3VyY2VzID0ge31cblxuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBwdWJsaXNoaW5nTW9kZWxDbGFzc2VzKSB7XG4gICAgICBjb25zdCBwdWJsaXNoID0gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHJlc291cmNlQ29uZmlnRnJvbVB1Ymxpc2hEZWNsYXJhdGlvbih7bW9kZWxDbGFzcywgcHVibGlzaCwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWw6IHJlc29sdmVkU3luY01vZGVsfSlcblxuICAgICAgcmVzb3VyY2VzW3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZV0gPSByZXNvdXJjZUNvbmZpZ1xuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2FjdG9yRm9yZWlnbktleUNvbHVtbjogc3RyaW5nLCBicm9hZGNhc3RlcjogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc1tcImJyb2FkY2FzdGVyXCJdLCBjb25maWd1cmF0aW9uOiBDb25maWd1cmF0aW9uLCBvbkVycm9yOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wib25FcnJvclwiXSwgcmVzb3VyY2VzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZz4sIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqL1xuICAgIHRoaXMuY29uZmlnID0ge2FjdG9yRm9yZWlnbktleUNvbHVtbiwgYnJvYWRjYXN0ZXIsIGNvbmZpZ3VyYXRpb24sIG9uRXJyb3IsIHJlc291cmNlcywgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbH1cbiAgICAvKiogQHR5cGUge0FycmF5PHtjYWxsYmFjazogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFByb21pc2U8dm9pZD4sIGNhbGxiYWNrTmFtZTogXCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MgPSBbXVxuICAgIC8qKiBAdHlwZSB7TG9nZ2VyIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2dnZXIgPSBudWxsXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3luYyBwdWJsaXNoZXIgZGVyaXZlZCBmcm9tIHRoZSBnaXZlbiBjb25maWd1cmF0aW9uLiBBbGlhcyBmb3JcbiAgICogYG5ldyBTeW5jUHVibGlzaGVyKHtjb25maWd1cmF0aW9uLCAuLi5vcHRpb25zfSlgLlxuICAgKiBAcGFyYW0ge0NvbmZpZ3VyYXRpb259IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSByZWdpc3RlcmVkIG1vZGVscy4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnMsIFwiY29uZmlndXJhdGlvblwiPn0gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7U3luY1B1Ymxpc2hlcn0gU3luYyBwdWJsaXNoZXIgZGVyaXZlZCBmcm9tIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jUHVibGlzaGVyKHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgKGFuZCBtZW1vaXplcyBwZXIgY29uZmlndXJhdGlvbikgdGhlIHN5bmMgcHVibGlzaGVyIGZvciBhIHNlcnZlclxuICAgKiBib290OiBuby1vcCB3aGVuIG5vIHJlZ2lzdGVyZWQgbW9kZWwgZGVjbGFyZXMgYSBwdWJsaXNoIGNvbmZpZywgZ3VhcmRlZCBzb1xuICAgKiByZXBlYXRlZCBib290cyB3aXRoIHRoZSBzYW1lIGNvbmZpZ3VyYXRpb24gcmVnaXN0ZXIgdGhlIHB1Ymxpc2ggY2FsbGJhY2tzXG4gICAqIG9ubHkgb25jZS5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jUHVibGlzaGVyIHwgbnVsbD59IFN0YXJ0ZWQgcHVibGlzaGVyLCBvciBudWxsIHdoZW4gbm8gbW9kZWxzIGRlY2xhcmUgcHVibGlzaC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBzdGFydEZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCBzdGFydGVkUHVibGlzaGVyID0gc3RhcnRlZFB1Ymxpc2hlcnNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoc3RhcnRlZFB1Ymxpc2hlcikgcmV0dXJuIHN0YXJ0ZWRQdWJsaXNoZXJcblxuICAgIGlmICghT2JqZWN0LnZhbHVlcyhjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpKS5zb21lKChtb2RlbENsYXNzKSA9PiBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcykpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcHVibGlzaGVyID0gbmV3IFN5bmNQdWJsaXNoZXIoe2NvbmZpZ3VyYXRpb259KVxuXG4gICAgc3RhcnRlZFB1Ymxpc2hlcnNCeUNvbmZpZ3VyYXRpb24uc2V0KGNvbmZpZ3VyYXRpb24sIHB1Ymxpc2hlcilcbiAgICBhd2FpdCBwdWJsaXNoZXIuc3RhcnQoKVxuXG4gICAgcmV0dXJuIHB1Ymxpc2hlclxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGUgcHVibGlzaCBjYWxsYmFja3MgZm9yIGV2ZXJ5IHB1Ymxpc2hlZCByZXNvdXJjZTogc2VydmVyLXNpZGVcbiAgICogY3JlYXRlcyBhbmQgdXBkYXRlcyAoZGVzdHJveXMgd2hlbiBvcHRlZCBpbikgdXBzZXJ0IGEgc3luYyBjaGFuZ2Ugcm93IGFuZFxuICAgKiBmYW4gb3V0IHRoZSBkZWNsYXJlZCBicm9hZGNhc3RzIG9uY2UgdGhlaXIgdHJhbnNhY3Rpb24gY29tbWl0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICBpZiAodGhpcy5fc3RhcnRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydGVkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCByZXNvdXJjZUNvbmZpZyBvZiBPYmplY3QudmFsdWVzKHRoaXMuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIHJlc291cmNlQ29uZmlnLm9wZXJhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gUFVCTElTSEVEX0NBTExCQUNLX05BTUVTW29wZXJhdGlvbl1cbiAgICAgICAgY29uc3QgY2FsbGJhY2sgPSB0aGlzLnB1Ymxpc2hlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbGwgcHVibGlzaCBjYWxsYmFja3MgKHRlc3RzLCBzaHV0ZG93bikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBmb3IgKGNvbnN0IHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzfSBvZiB0aGlzLl9wdWJsaXNoZWRDYWxsYmFja3MpIHtcbiAgICAgIG1vZGVsQ2xhc3MudW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzID0gW11cbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxpZmVjeWNsZSBjYWxsYmFjayBwdWJsaXNoaW5nIG9uZSBzZXJ2ZXItc2lkZSBtdXRhdGlvbi4gVGhlXG4gICAqIHB1Ymxpc2hlZCBwYXlsb2FkIChkZWNsYXJhdGlvbiBgc2VyaWFsaXplYCksIGV2ZW50IHNjb3BlLCBhbmQgc3luYyB0eXBlXG4gICAqIGFyZSBzbmFwc2hvdHRlZCBhdCBtdXRhdGlvbi1jYWxsYmFjayB0aW1lLCBzbyBhZnRlclNhdmUgaG9va3MgYXNzaWduaW5nXG4gICAqIHVuc2F2ZWQgYXR0cmlidXRlcyAob3IgYW55IGxhdGVyIGRyaWZ0IG9uIHRoZSByZWNvcmQpIGNhbm5vdCBjaGFuZ2Ugd2hhdFxuICAgKiBnZXRzIHB1Ymxpc2hlZCB2cyB3aGF0IHdhcyBjb21taXR0ZWQuIFBlcnNpc3RpbmcgYW5kIGJyb2FkY2FzdGluZyBhcmVcbiAgICogZGVmZXJyZWQgdGhyb3VnaCB0aGUgbW9kZWwgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gdGhleSBvbmx5IHJ1blxuICAgKiBvbmNlIHRoZSBtdXRhdGlvbidzIHRyYW5zYWN0aW9uIGhhcyBjb21taXR0ZWQgKGltbWVkaWF0ZWx5IHdoZW4gbm9cbiAgICogdHJhbnNhY3Rpb24gaXMgb3BlbikgLSByb2xsZWQtYmFjayBtdXRhdGlvbnMgbmV2ZXIgcHVibGlzaC4gUG9zdC1jb21taXRcbiAgICogcHVibGlzaCBmYWlsdXJlcyBhcmUgcmVwb3J0ZWQgd2l0aG91dCByZXRocm93aW5nIGludG8gdGhlIGRyaXZlcidzXG4gICAqIGFmdGVyQ29tbWl0IGNoYWluIChzZWUgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcikuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfX0gYXJncyAtIE9wZXJhdGlvbiBhbmQgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7KHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFByb21pc2U8dm9pZD59IExpZmVjeWNsZSBjYWxsYmFjay5cbiAgICovXG4gIHB1Ymxpc2hlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgcmV0dXJuIGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGlmIChpc1B1Ymxpc2hpbmdTdXBwcmVzc2VkKHJlY29yZCkpIHJldHVyblxuXG4gICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzb3VyY2VDb25maWcuc2VyaWFsaXplKHJlY29yZClcbiAgICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcoc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBTeW5jIHB1Ymxpc2hpbmcgZm9yICR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfWApKVxuICAgICAgY29uc3Qgc3luY1R5cGUgPSBvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiID8gXCJkZWxldGVcIiA6IFwidXBkYXRlXCJcbiAgICAgIGNvbnN0IHNjb3BlVmFsdWVzID0gYXdhaXQgdGhpcy5wdWJsaXNoZWRTY29wZVZhbHVlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIFt0aGlzLmNvbmZpZy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiBudWxsLFxuICAgICAgICBjbGllbnRfdXBkYXRlZF9hdDogbmV3IERhdGUoKSxcbiAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gICAgICAgIHJlc291cmNlX2lkOiByZXNvdXJjZUlkLFxuICAgICAgICByZXNvdXJjZV90eXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsXG4gICAgICAgIHN5bmNfdHlwZTogc3luY1R5cGUsXG4gICAgICAgIC4uLnNjb3BlVmFsdWVzLmNvbHVtbnNcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGFiYXNlT3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvblNjb3BlID0gZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgICAgPyBkYXRhYmFzZU9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG4gICAgICAgIDogdGhpcy5jb25maWcuc3luY01vZGVsXG5cbiAgICAgIGF3YWl0IHJlY29yZC5jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHNjb3BlQ29sdW1uTmFtZXMgPSByZXNvdXJjZUNvbmZpZy5zY29wZVBsYW4ubWFwKCh7Y29sdW1uTmFtZX0pID0+IGNvbHVtbk5hbWUpXG4gICAgICAgICAgY29uc3Qgc3luY1JvdyA9IGF3YWl0IHRoaXMudXBzZXJ0UHVibGlzaGVkU3luY1JvdyhhdHRyaWJ1dGVzLCBvcGVyYXRpb25TY29wZSwgc2NvcGVDb2x1bW5OYW1lcylcblxuICAgICAgICAgIGF3YWl0IHRoaXMuYnJvYWRjYXN0ZXIoKSh7XG4gICAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICAgIGVjaG9PcmlnaW46IG51bGwsXG4gICAgICAgICAgICAgIHN5bmNzOiBbdGhpcy5wdWJsaXNoZWRTeW5jRW50cnkoe2RhdGEsIHJlc291cmNlQ29uZmlnLCByZXNvdXJjZUlkLCBzeW5jUm93LCBzeW5jVHlwZX0pXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNoYW5uZWw6IFZFTE9DSU9VU19TWU5DX0NIQU5ORUwsXG4gICAgICAgICAgICBwYXJhbXM6IHsuLi5zY29wZVZhbHVlcy5wYXJhbXMsIHJlc291cmNlVHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpZiAocmVzb3VyY2VDb25maWcuYnJvYWRjYXN0cykge1xuICAgICAgICAgICAgYXdhaXQgZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cyh7XG4gICAgICAgICAgICAgIGFyZ3M6IHtkYXRhLCBvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsIHN5bmNSb3csIHN5bmNUeXBlfSxcbiAgICAgICAgICAgICAgYnJvYWRjYXN0ZXI6IHRoaXMuYnJvYWRjYXN0ZXIoKSxcbiAgICAgICAgICAgICAgYnJvYWRjYXN0czogcmVzb3VyY2VDb25maWcuYnJvYWRjYXN0c1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yZXBvcnRBZnRlckNvbW1pdEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzY29wZS1wYXJ0aXRpb24gdmFsdWVzIGZvciBvbmUgcHVibGlzaGVkIG11dGF0aW9uIGZyb20gdGhlXG4gICAqIHJlc291cmNlJ3MgZGVyaXZlZCBzY29wZSBwbGFuOiBlYWNoIGVudHJ5IHJlYWRzIGl0cyByZWNvcmQgYXR0cmlidXRlIChvclxuICAgKiB0aGUgcmVjb3JkJ3Mgb3duIGlkIGZvciBzY29wZS1yb290IG1vZGVscywgb3IgdGhlIGRlcHJlY2F0ZWQgcmVzb2x2ZXJcbiAgICogZnVuY3Rpb24pLiBUaGUgdmFsdWVzIGFyZSBwZXJzaXN0ZWQgb250byB0aGUgc3luYyByb3cncyBwYXJ0aXRpb24gY29sdW1uc1xuICAgKiBhbmQgYnJvYWRjYXN0IGFzIHRoZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsJ3Mgc2NvcGluZyBwYXJhbXMuXG4gICAqIEBwYXJhbSB7e3JlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBNdXRhdGVkIHJlY29yZCBhbmQgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y29sdW1uczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD4sIHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59Pn0gU2NvcGUgdmFsdWVzIGtleWVkIGJ5IHN5bmMtcm93IGNvbHVtbiBhbmQgYnkgc2NvcGUgYXR0cmlidXRlLlxuICAgKi9cbiAgYXN5bmMgcHVibGlzaGVkU2NvcGVWYWx1ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gKi9cbiAgICBjb25zdCBjb2x1bW5zID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IHBhcmFtcyA9IHt9XG4gICAgY29uc3QgY29tcHV0ZWRTY29wZUF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5zY29wZUF0dHJpYnV0ZXNSZXNvbHZlclxuICAgICAgPyBhd2FpdCB0aGlzLnJlc29sdmVDb21wdXRlZFNjb3BlQXR0cmlidXRlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICA6IG51bGxcblxuICAgIGZvciAoY29uc3Qgc2NvcGVQbGFuRW50cnkgb2YgcmVzb3VyY2VDb25maWcuc2NvcGVQbGFuKSB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgbGV0IHJhd1ZhbHVlXG5cbiAgICAgIGlmIChjb21wdXRlZFNjb3BlQXR0cmlidXRlcykge1xuICAgICAgICByYXdWYWx1ZSA9IGNvbXB1dGVkU2NvcGVBdHRyaWJ1dGVzW3Njb3BlUGxhbkVudHJ5LnNjb3BlQXR0cmlidXRlXVxuICAgICAgfSBlbHNlIGlmIChzY29wZVBsYW5FbnRyeS5yZXNvbHZlcikge1xuICAgICAgICByYXdWYWx1ZSA9IGF3YWl0IHNjb3BlUGxhbkVudHJ5LnJlc29sdmVyKHJlY29yZClcbiAgICAgIH0gZWxzZSBpZiAoc2NvcGVQbGFuRW50cnkucmVjb3JkQXR0cmlidXRlKSB7XG4gICAgICAgIHJhd1ZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUoc2NvcGVQbGFuRW50cnkucmVjb3JkQXR0cmlidXRlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmF3VmFsdWUgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShyZWNvcmQuaWQoKSwgYFN5bmMgc2NvcGUgcHVibGlzaGluZyBmb3IgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdmFsdWUgPSByYXdWYWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHJhd1ZhbHVlID09PSBudWxsID8gbnVsbCA6IFN0cmluZyhyYXdWYWx1ZSlcblxuICAgICAgY29sdW1uc1tzY29wZVBsYW5FbnRyeS5jb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICBwYXJhbXNbc2NvcGVQbGFuRW50cnkuc2NvcGVBdHRyaWJ1dGVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4ge2NvbHVtbnMsIHBhcmFtc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgdmFsaWRhdGVzIG9uZSBjb21wdXRlZCBzY29wZS1hdHRyaWJ1dGVzIGRlY2xhcmF0aW9uLiBUaGVcbiAgICogcmVzb2x2ZXIgcnVucyBvbmNlIHBlciBwdWJsaXNoZWQgbXV0YXRpb24gd2l0aCB0aGUgZXhhY3QgY29ubmVjdGlvbiB0aGF0XG4gICAqIG93bnMgdGhhdCBtdXRhdGlvbjsgZXZlcnkgZGVjbGFyZWQgc2NvcGUgdmFsdWUgaXMgdGhlbiByZXVzZWQgZm9yIHJvd1xuICAgKiBwZXJzaXN0ZW5jZSBhbmQgYnJvYWRjYXN0IHJvdXRpbmcgc28gdGhvc2UgdHdvIGlkZW50aXRpZXMgY2Fubm90IGRyaWZ0LlxuICAgKiBAcGFyYW0ge3tyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9fSBhcmdzIC0gUmVjb3JkIGFuZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBudWxsPj59IENvbXBsZXRlIGNvbXB1dGVkIHNjb3BlIHZhbHVlcy5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVDb21wdXRlZFNjb3BlQXR0cmlidXRlcyh7cmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHJlc291cmNlQ29uZmlnLnNjb3BlQXR0cmlidXRlc1Jlc29sdmVyXG5cbiAgICBpZiAoIXJlc29sdmVyKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbXB1dGVkIHNjb3BlLWF0dHJpYnV0ZXMgcmVzb2x2ZXIgY29uZmlndXJlZCBmb3IgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9YClcblxuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbixcbiAgICAgIGNvbm5lY3Rpb246IHJlY29yZC5jb25uZWN0aW9uKCksXG4gICAgICByZWNvcmRcbiAgICB9KVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHJlc29sdmVkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVzb2x2ZXIgbXVzdCByZXNvbHZlIHRvIGEgcGxhaW4gb2JqZWN0YClcbiAgICB9XG5cbiAgICBjb25zdCBkZWNsYXJlZEF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5zY29wZVBsYW4ubWFwKCh7c2NvcGVBdHRyaWJ1dGV9KSA9PiBzY29wZUF0dHJpYnV0ZSlcblxuICAgIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2YgT2JqZWN0LmtleXMocmVzb2x2ZWQpKSB7XG4gICAgICBpZiAoIWRlY2xhcmVkQXR0cmlidXRlcy5pbmNsdWRlcyhzY29wZUF0dHJpYnV0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVzb2x2ZXIgcmV0dXJuZWQgdW5rbm93biBzY29wZSBhdHRyaWJ1dGU6ICR7c2NvcGVBdHRyaWJ1dGV9ICh0aGUgc3luYyBtb2RlbCBkZWNsYXJlczogJHtkZWNsYXJlZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfSlgKVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2YgZGVjbGFyZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24ocmVzb2x2ZWQsIHNjb3BlQXR0cmlidXRlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlQXR0cmlidXRlcyByZXNvbHZlciBtdXN0IHJlc29sdmUgdGhlIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZSAke3Njb3BlQXR0cmlidXRlfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gcmVzb2x2ZWRbc2NvcGVBdHRyaWJ1dGVdXG5cbiAgICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGUgYXR0cmlidXRlICR7c2NvcGVBdHRyaWJ1dGV9IG11c3QgYmUgYSBzdHJpbmcsIG51bWJlciwgb3IgbnVsbGApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59ICovIChyZXNvbHZlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGZyYW1ld29yayBzeW5jIGNoYW5uZWwgZW50cnkgZm9yIG9uZSBwdWJsaXNoZWQgY2hhbmdlOiB0aGVcbiAgICogc25hcHNob3R0ZWQgcGF5bG9hZCBwbHVzIHRoZSBwZXJzaXN0ZWQgc3luYyByb3cncyBwdWJsaWMgZXhhY3Qtcm93IG1ldGFkYXRhXG4gICAqIChpZCwgc2VydmVyIHNlcXVlbmNlLCB1cGRhdGVkLWF0LCBhbmQgZGVjbGFyZWQgc2NvcGUtcGFydGl0aW9uIGF0dHJpYnV0ZXMpLlxuICAgKiBVc2VzIHRoZSBzeW5jIG1vZGVsJ3MgZ2VuZXJhdGVkIHR5cGVkIGFjY2Vzc29ycyBhbmQgZm9sbG93cyB0aGVcbiAgICogY2hhbmdlLWZlZWQgc2VyaWFsaXplcidzIHB1YmxpYyBmaWVsZCBjb252ZW50aW9uLlxuICAgKiBAcGFyYW0ge3tkYXRhOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VJZDogc3RyaW5nLCBzeW5jUm93OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc3luY1R5cGU6IHN0cmluZ319IGFyZ3MgLSBQdWJsaXNoIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEJyb2FkY2FzdCBzeW5jIGVudHJ5LlxuICAgKi9cbiAgcHVibGlzaGVkU3luY0VudHJ5KHtkYXRhLCByZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VJZCwgc3luY1Jvdywgc3luY1R5cGV9KSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7XG4gICAgICBkYXRhLFxuICAgICAgaWQ6IHN5bmNSb3cuaWQoKSxcbiAgICAgIHJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGU6IHJlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZSxcbiAgICAgIHNlcnZlclNlcXVlbmNlOiBzeW5jUm93LnNlcnZlclNlcXVlbmNlKCksXG4gICAgICBzeW5jVHlwZSxcbiAgICAgIHVwZGF0ZWRBdDogaXNvRGF0ZShzeW5jUm93LnVwZGF0ZWRBdCgpKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlQXR0cmlidXRlcyA9IGRlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIHNjb3BlQXR0cmlidXRlcyB8fCBbXSkge1xuICAgICAgY29uc3Qgc2NvcGVBY2Nlc3NvciA9IHN5bmNSb3dbc2NvcGVBdHRyaWJ1dGVdXG5cbiAgICAgIGlmICh0eXBlb2Ygc2NvcGVBY2Nlc3NvciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUHVibGlzaGVkIHN5bmMgcm93IGlzIG1pc3NpbmcgdGhlIGRlY2xhcmVkIHNjb3BlIGFjY2Vzc29yICR7c2NvcGVBdHRyaWJ1dGV9KCkuYClcbiAgICAgIH1cblxuICAgICAgZW50cnlbc2NvcGVBdHRyaWJ1dGVdID0gc2NvcGVBY2Nlc3Nvci5jYWxsKHN5bmNSb3cpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogVXBzZXJ0cyB0aGUgcHVibGlzaGVkIHNlcnZlci1vcmlnaW4gc3luYyByb3cgZm9yIGEgcmVzb3VyY2UgaWRlbnRpdHk6XG4gICAqIHNlcnZlci1vcmlnaW4gcm93cyBjYXJyeSBhIG51bGwgYWN0b3IgY29sdW1uIChubyBkZXZpY2UgdG8gZWNobyB0aGVcbiAgICogY2hhbmdlIGJhY2sgdG8pLCBzbyByZXBlYXRlZCBzZXJ2ZXIgY2hhbmdlcyB0byBvbmUgY29tcGxldGUgcmVzb3VyY2UgYW5kXG4gICAqIHNjb3BlIGlkZW50aXR5IHJldXNlIGFuZCByZS1zZXF1ZW5jZSBvbmUgZmVlZCByb3cuIEEgZGF0YWJhc2UgYWR2aXNvcnlcbiAgICogbG9jayBzZXJpYWxpemVzIHRoZSBsb29rdXAgcGx1cyBzaGFyZWQgdXBzZXJ0IGJlY2F1c2UgdW5pcXVlIGNvbnN0cmFpbnRzXG4gICAqIGNvbnRhaW5pbmcgbnVsbGFibGUgYWN0b3Ivc2NvcGUgY29sdW1ucyBkbyBub3QgZW5mb3JjZSB0aGlzIGlkZW50aXR5XG4gICAqIHBvcnRhYmx5IGFjcm9zcyBzdXBwb3J0ZWQgZGF0YWJhc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIFNuYXBzaG90dGVkIHN5bmMgcm93IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmNNb2RlbCAtIE9wZXJhdGlvbi1ib3VuZCBvciBzdGF0aWMgU3luYyBtb2RlbCBpbnRlcmZhY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHNjb3BlQ29sdW1uTmFtZXMgLSBQZXJzaXN0ZWQgc2NvcGUgY29sdW1ucyBwYXJ0aWNpcGF0aW5nIGluIHRoZSBjb21wbGV0ZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBVcHNlcnRlZCBzeW5jIHJvdy5cbiAgICovXG4gIGFzeW5jIHVwc2VydFB1Ymxpc2hlZFN5bmNSb3coYXR0cmlidXRlcywgc3luY01vZGVsID0gdGhpcy5jb25maWcuc3luY01vZGVsLCBzY29wZUNvbHVtbk5hbWVzID0gW10pIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBpZGVudGl0eSA9IHtcbiAgICAgIFt0aGlzLmNvbmZpZy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiBudWxsLFxuICAgICAgcmVzb3VyY2VfaWQ6IGF0dHJpYnV0ZXMucmVzb3VyY2VfaWQsXG4gICAgICByZXNvdXJjZV90eXBlOiBhdHRyaWJ1dGVzLnJlc291cmNlX3R5cGVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2Ygc2NvcGVDb2x1bW5OYW1lcykge1xuICAgICAgaWYgKCFPYmplY3QuaGFzT3duKGF0dHJpYnV0ZXMsIGNvbHVtbk5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUHVibGlzaGVkIHN5bmMgcm93IGlkZW50aXR5IGlzIG1pc3NpbmcgdGhlIHNjb3BlIGNvbHVtbiAke2NvbHVtbk5hbWV9YClcbiAgICAgIH1cblxuICAgICAgaWRlbnRpdHlbY29sdW1uTmFtZV0gPSBhdHRyaWJ1dGVzW2NvbHVtbk5hbWVdXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlnLnN5bmNNb2RlbC53aXRoQWR2aXNvcnlMb2NrKHN5bmNQdWJsaXNoZXJJZGVudGl0eUxvY2tOYW1lKGlkZW50aXR5KSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmdTeW5jID0gYXdhaXQgc3luY01vZGVsXG4gICAgICAgIC53aGVyZShpZGVudGl0eSlcbiAgICAgICAgLmZpcnN0KClcblxuICAgICAgcmV0dXJuIGF3YWl0IHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsfSlcbiAgICB9LCB7ZGVkaWNhdGVkQ29ubmVjdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYnJvYWRjYXN0ZXIgZGVsaXZlcmluZyBkZWNsYXJlZCBicm9hZGNhc3RzOiB0aGUgaW5qZWN0ZWQgb25lLFxuICAgKiBvciB0aGUgY29uZmlndXJhdGlvbidzIGNoYW5uZWwgYnJvYWRjYXN0IGF3YWl0ZWQgdGhyb3VnaCB0aGUgcGVuZGluZ1xuICAgKiBicm9hZGNhc3QgcXVldWUuXG4gICAqIEByZXR1cm5zIHtOb25OdWxsYWJsZTxpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wiYnJvYWRjYXN0ZXJcIl0+fSBCcm9hZGNhc3QgZGVsaXZlcmVyLlxuICAgKi9cbiAgYnJvYWRjYXN0ZXIoKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLmJyb2FkY2FzdGVyKSByZXR1cm4gdGhpcy5jb25maWcuYnJvYWRjYXN0ZXJcblxuICAgIHJldHVybiBhc3luYyAoe2JvZHksIGNoYW5uZWwsIHBhcmFtc30pID0+IHtcbiAgICAgIHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKGNoYW5uZWwsIHBhcmFtcywgYm9keSlcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCBwdWJsaXNoIGZhaWx1cmUuIFRoZSB0cmFuc2FjdGlvbiBoYXMgYWxyZWFkeVxuICAgKiBjb21taXR0ZWQgd2hlbiBhZnRlckNvbW1pdCBjYWxsYmFja3MgcnVuLCBzbyByZXRocm93aW5nIGhlcmUgd291bGQgcG9pc29uXG4gICAqIHRoZSBkcml2ZXIncyBhd2FpdGVkIGFmdGVyQ29tbWl0IGNoYWluIChicmVha2luZyB1bnJlbGF0ZWQgY2FsbGJhY2tzKSAtXG4gICAqIGluc3RlYWQgdGhlIGZhaWx1cmUgZ29lcyB0byB0aGUgY29uZmlndXJlZCBvbkVycm9yIGhvb2ssIG9yIGlzIGVtaXR0ZWQgb25cbiAgICogdGhlIGNvbmZpZ3VyYXRpb24ncyBmcmFtZXdvcmstZXJyb3IvYWxsLWVycm9yIGNoYW5uZWxzIChzbyBwcm9kdWN0aW9uIGJ1Z1xuICAgKiByZXBvcnRpbmcgdmlhIGBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClgIHNlZXMgYSBicm9rZW4gcHVibGlzaFxuICAgKiBwYXRoKSBhbmQgbG9nZ2VkIGxvdWRseSB0aHJvdWdoIHRoZSBwdWJsaXNoZXIncyBsb2dnZXIgd2hlbiBub25lIGlzXG4gICAqIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gUG9zdC1jb21taXQgcHVibGlzaCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5jb25maWcub25FcnJvcikge1xuICAgICAgdGhpcy5jb25maWcub25FcnJvcihlcnJvcilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJzeW5jLXB1Ymxpc2gtYWZ0ZXItY29tbWl0XCJ9LCBlcnJvcn1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIoKS5lcnJvcihcIlN5bmNQdWJsaXNoZXIgZmFpbGVkIHRvIHB1Ymxpc2ggYSBzZXJ2ZXItc2lkZSBzeW5jIGNoYW5nZSBhZnRlciBjb21taXRcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IHB1Ymxpc2hlciBsb2dnZXIuXG4gICAqIEByZXR1cm5zIHtMb2dnZXJ9IFB1Ymxpc2hlciBsb2dnZXIuXG4gICAqL1xuICBsb2dnZXIoKSB7XG4gICAgdGhpcy5fbG9nZ2VyIHx8PSBuZXcgTG9nZ2VyKFwiU3luY1B1Ymxpc2hlclwiLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gdGhpcy5fbG9nZ2VyXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgZGV0ZXJtaW5pc3RpYywgTXlTUUwtc2FmZSBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIG9uZSBjb21wbGV0ZVxuICogc2VydmVyLW9yaWdpbiBwdWJsaXNoZXIgaWRlbnRpdHkuIFN0YWJsZSBKU09OIHByZXNlcnZlcyBudWxsIGFjdG9yL3Njb3BlXG4gKiBjb21wb25lbnRzIGRpc3RpbmN0bHkgZnJvbSBzdHJpbmdzLCBhbmQgdGhlIHRydW5jYXRlZCBTSEEtMjU2IGRpZ2VzdCBrZWVwc1xuICogdGhlIGZpbmFsIG5hbWUgYmVsb3cgTXlTUUwvTWFyaWFEQidzIDY0LWNoYXJhY3RlciBgR0VUX0xPQ0tgIGxpbWl0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGlkZW50aXR5IC0gQ29tcGxldGUgc3luYy1yb3cgaWRlbnRpdHkgaW4gY29sdW1uIGZvcm0uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBBZHZpc29yeS1sb2NrIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHN5bmNQdWJsaXNoZXJJZGVudGl0eUxvY2tOYW1lKGlkZW50aXR5KSB7XG4gIGNvbnN0IGhhc2ggPSBzaGEyNTZIZXgoc3RhYmxlSnNvblN0cmluZ2lmeShpZGVudGl0eSkpLnNsaWNlKDAsIDMyKVxuXG4gIHJldHVybiBgdnNwOiR7aGFzaH1gXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYSBtb2RlbCBjbGFzcydzIGFjdGl2ZSBwdWJsaXNoIGRlY2xhcmF0aW9uIGZyb20gYHN0YXRpYyBzeW5jYC5cbiAqIE9wdGVkLW91dCAoYHB1Ymxpc2g6IGZhbHNlYCkgYW5kIHVuZGVjbGFyZWQgbW9kZWxzIHJlc29sdmUgdG8gbnVsbDsgZXZlcnlcbiAqIG90aGVyIGRlY2xhcmVkIHZhbHVlIGZsb3dzIGludG8gbG91ZCBkZWNsYXJhdGlvbiB2YWxpZGF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbW9kZWxDbGFzcyAtIFJlZ2lzdGVyZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uIHwgbnVsbH0gQWN0aXZlIHB1Ymxpc2ggZGVjbGFyYXRpb24sIG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKSB7XG4gIGNvbnN0IGRlY2xhcmF0aW9uID0gbW9kZWxDbGFzcy5zeW5jXG5cbiAgaWYgKCFkZWNsYXJhdGlvbiB8fCB0eXBlb2YgZGVjbGFyYXRpb24gIT09IFwib2JqZWN0XCIgfHwgZGVjbGFyYXRpb24ucHVibGlzaCA9PT0gdW5kZWZpbmVkIHx8IGRlY2xhcmF0aW9uLnB1Ymxpc2ggPT09IGZhbHNlKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBkZWNsYXJhdGlvbi5wdWJsaXNoXG59XG5cbi8qKlxuICogQnVpbGRzIG9uZSBwdWJsaXNoZWQgcmVzb3VyY2UgY29uZmlnIGZyb20gYSBtb2RlbCdzIGBzdGF0aWMgc3luY2AgcHVibGlzaFxuICogZGVjbGFyYXRpb24uIGBwdWJsaXNoOiB0cnVlYCBvcHRzIGluIHdpdGggYWxsIGRlZmF1bHRzIChhdHRyaWJ1dGUgcGF5bG9hZCxcbiAqIGRlcml2ZWQgc2NvcGUgcGFydGl0aW9uLCBjcmVhdGVkL3VwZGF0ZWQgb3BlcmF0aW9ucykuXG4gKiBAcGFyYW0ge3ttb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcHVibGlzaDogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uIHwgbnVsbCwgc2NvcGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSB8IG51bGwsIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gRGVjbGFyYXRpb24gYXJncyBwbHVzIHRoZSBzeW5jIG1vZGVsJ3MgZGVjbGFyZWQgc2NvcGUgYXR0cmlidXRlcy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ30gRGVyaXZlZCByZXNvdXJjZSBjb25maWcuXG4gKi9cbmZ1bmN0aW9uIHJlc291cmNlQ29uZmlnRnJvbVB1Ymxpc2hEZWNsYXJhdGlvbih7bW9kZWxDbGFzcywgcHVibGlzaCwgc2NvcGVBdHRyaWJ1dGVzOiBzeW5jU2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWx9KSB7XG4gIGNvbnN0IG1vZGVsTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgY29uc3Qgbm9ybWFsaXplZFB1Ymxpc2ggPSBwdWJsaXNoID09PSB0cnVlID8ge30gOiBwdWJsaXNoXG5cbiAgaWYgKCFub3JtYWxpemVkUHVibGlzaCB8fCB0eXBlb2Ygbm9ybWFsaXplZFB1Ymxpc2ggIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShub3JtYWxpemVkUHVibGlzaCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIG11c3QgYmUgdHJ1ZSwgZmFsc2Ugb3IgYSBwdWJsaXNoIGRlY2xhcmF0aW9uIG9iamVjdCwgZ290OiAke1N0cmluZyhwdWJsaXNoKX1gKVxuICB9XG5cbiAgY29uc3Qge2Jyb2FkY2FzdHMsIGV2ZW50SWQsIG9wZXJhdGlvbnMsIHJlc291cmNlVHlwZSwgc2NvcGVBdHRyaWJ1dGVzLCBzZXJpYWxpemUsIC4uLnJlc3REZWNsYXJhdGlvbn0gPSBub3JtYWxpemVkUHVibGlzaFxuICBjb25zdCB1bmtub3duS2V5cyA9IE9iamVjdC5rZXlzKHJlc3REZWNsYXJhdGlvbilcblxuICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYnJvYWRjYXN0cywgZXZlbnRJZCAoZGVwcmVjYXRlZCksIG9wZXJhdGlvbnMsIHJlc291cmNlVHlwZSwgc2NvcGVBdHRyaWJ1dGVzLCBzZXJpYWxpemUpYClcbiAgfVxuICBpZiAoc2VyaWFsaXplICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHNlcmlhbGl6ZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzZXJpYWxpemUgbXVzdCBiZSBhIGZ1bmN0aW9uIGJ1aWxkaW5nIHRoZSBwdWJsaXNoZWQgcGF5bG9hZCwgZ290OiAke1N0cmluZyhzZXJpYWxpemUpfWApXG4gIH1cbiAgaWYgKG9wZXJhdGlvbnMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShvcGVyYXRpb25zKSB8fCBvcGVyYXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBvcGVyYXRpb25zIG11c3QgYmUgYSBub24tZW1wdHkgYXJyYXkgb2YgY3JlYXRlL3VwZGF0ZS9kZXN0cm95YClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zKSB7XG4gICAgICBpZiAoIShvcGVyYXRpb24gaW4gUFVCTElTSEVEX0NBTExCQUNLX05BTUVTKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIG9wZXJhdGlvbnMgbXVzdCBiZSBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3ksIGdvdDogJHtTdHJpbmcob3BlcmF0aW9uKX1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHNjb3BlUGxhbiA9IHNjb3BlUGxhbkZvcih7ZXZlbnRJZCwgbW9kZWxDbGFzcywgbW9kZWxOYW1lLCBzY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbCwgc3luY1Njb3BlQXR0cmlidXRlc30pXG5cbiAgcmV0dXJuIHtcbiAgICBicm9hZGNhc3RzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgb3BlcmF0aW9uczogb3BlcmF0aW9ucyA9PT0gdW5kZWZpbmVkID8gREVGQVVMVF9QVUJMSVNIRURfT1BFUkFUSU9OUyA6IG9wZXJhdGlvbnMsXG4gICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZVR5cGUgPT09IHVuZGVmaW5lZCA/IG1vZGVsTmFtZSA6IHJlc291cmNlVHlwZSxcbiAgICBzY29wZUF0dHJpYnV0ZXNSZXNvbHZlcjogdHlwZW9mIHNjb3BlQXR0cmlidXRlcyA9PT0gXCJmdW5jdGlvblwiID8gc2NvcGVBdHRyaWJ1dGVzIDogdW5kZWZpbmVkLFxuICAgIHNjb3BlUGxhbixcbiAgICBzZXJpYWxpemU6IHNlcmlhbGl6ZSA9PT0gdW5kZWZpbmVkID8gZGVmYXVsdFNlcmlhbGl6ZWRBdHRyaWJ1dGVzIDogc2VyaWFsaXplXG4gIH1cbn1cblxuLyoqXG4gKiBEZXJpdmVzIHRoZSBzY29wZSBwbGFuIHBhcnRpdGlvbmluZyBhIHB1Ymxpc2hlZCBtb2RlbCdzIGNoYW5nZXM6IG9uZSBlbnRyeVxuICogcGVyIHNjb3BlIGF0dHJpYnV0ZSBkZWNsYXJlZCBvbiB0aGUgc3luYyBtb2RlbCAoYHN0YXRpY1xuICogc3luY1Njb3BlQXR0cmlidXRlc2ApLCBlYWNoIHJlYWRpbmcgdGhlIHJlY29yZCBhdHRyaWJ1dGUgbmFtZWQgbGlrZSB0aGVcbiAqIHNjb3BlIGF0dHJpYnV0ZSAob3ZlcnJpZGFibGUgdGhyb3VnaCB0aGUgZGVjbGFyYXRpb24ncyBgc2NvcGVBdHRyaWJ1dGVzYFxuICogbmFtZSBtYXApLCBvciB0aGUgcmVjb3JkJ3Mgb3duIGlkIHdoZW4gdGhlIG1vZGVsIGhhcyBubyBzdWNoIGF0dHJpYnV0ZVxuICogKHNjb3BlLXJvb3QgbW9kZWxzKS4gVGhlIGRlcHJlY2F0ZWQgYGV2ZW50SWRgIGRlY2xhcmF0aW9uIGZvcm1zIG1hcCB0byBhXG4gKiBmaXhlZCBgZXZlbnRJZGAvYGV2ZW50X2lkYCBwbGFuIGZvciAxLjAuNTAzIGNvbXBhdGliaWxpdHkuXG4gKiBAcGFyYW0ge3tldmVudElkOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb25Db25maWdbXCJldmVudElkXCJdLCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbW9kZWxOYW1lOiBzdHJpbmcsIHNjb3BlQXR0cmlidXRlczogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaERlY2xhcmF0aW9uQ29uZmlnW1wic2NvcGVBdHRyaWJ1dGVzXCJdLCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzeW5jU2NvcGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSB8IG51bGx9fSBhcmdzIC0gRGVjbGFyYXRpb24gYW5kIHN5bmMtbW9kZWwgc2NvcGUgYXJncy5cbiAqIEByZXR1cm5zIHtBcnJheTxpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJTY29wZVBsYW5FbnRyeT59IERlcml2ZWQgc2NvcGUgcGxhbi5cbiAqL1xuZnVuY3Rpb24gc2NvcGVQbGFuRm9yKHtldmVudElkLCBtb2RlbENsYXNzLCBtb2RlbE5hbWUsIHNjb3BlQXR0cmlidXRlcywgc3luY01vZGVsLCBzeW5jU2NvcGVBdHRyaWJ1dGVzfSkge1xuICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IE9iamVjdC52YWx1ZXMobW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKCkpXG5cbiAgaWYgKGV2ZW50SWQgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChzY29wZUF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBjYW4ndCBkZWNsYXJlIGJvdGggc2NvcGVBdHRyaWJ1dGVzIGFuZCB0aGUgZGVwcmVjYXRlZCBldmVudElkIGZvcm1gKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGV2ZW50SWQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIFt7Y29sdW1uTmFtZTogXCJldmVudF9pZFwiLCByZWNvcmRBdHRyaWJ1dGU6IG51bGwsIHJlc29sdmVyOiBldmVudElkLCBzY29wZUF0dHJpYnV0ZTogXCJldmVudElkXCJ9XVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGV2ZW50SWQgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggZXZlbnRJZCBtdXN0IGJlIGFuIGF0dHJpYnV0ZS1uYW1lIHN0cmluZyAob3IgYSBkZXByZWNhdGVkIHJlc29sdmVyIGZ1bmN0aW9uKSwgZ290OiAke1N0cmluZyhldmVudElkKX1gKVxuICAgIH1cbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKGV2ZW50SWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGV2ZW50SWQgYXR0cmlidXRlIGRvZXNuJ3QgZXhpc3Qgb24gdGhlIG1vZGVsOiAke2V2ZW50SWR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gW3tjb2x1bW5OYW1lOiBcImV2ZW50X2lkXCIsIHJlY29yZEF0dHJpYnV0ZTogZXZlbnRJZCwgcmVzb2x2ZXI6IHVuZGVmaW5lZCwgc2NvcGVBdHRyaWJ1dGU6IFwiZXZlbnRJZFwifV1cbiAgfVxuXG4gIGlmIChzY29wZUF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCAmJiAhc3luY1Njb3BlQXR0cmlidXRlcykge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggZGVjbGFyZXMgc2NvcGVBdHRyaWJ1dGVzIGJ1dCB0aGUgc3luYyBtb2RlbCBkZWNsYXJlcyBubyBzdGF0aWMgc3luY1Njb3BlQXR0cmlidXRlc2ApXG4gIH1cblxuICBpZiAoIXN5bmNTY29wZUF0dHJpYnV0ZXMpIHJldHVybiBbXVxuXG4gIGlmICh0eXBlb2Ygc2NvcGVBdHRyaWJ1dGVzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByZXR1cm4gc3luY1Njb3BlQXR0cmlidXRlcy5tYXAoKHNjb3BlQXR0cmlidXRlKSA9PiAoe1xuICAgICAgY29sdW1uTmFtZTogc3luY1Njb3BlQ29sdW1uTmFtZSh7c2NvcGVBdHRyaWJ1dGUsIHN5bmNNb2RlbH0pLFxuICAgICAgcmVjb3JkQXR0cmlidXRlOiBudWxsLFxuICAgICAgcmVzb2x2ZXI6IHVuZGVmaW5lZCxcbiAgICAgIHNjb3BlQXR0cmlidXRlXG4gICAgfSkpXG4gIH1cblxuICBpZiAoc2NvcGVBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBzY29wZUF0dHJpYnV0ZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzY29wZUF0dHJpYnV0ZXMpKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0IG1hcHBpbmcgc2NvcGUgYXR0cmlidXRlcyB0byByZWNvcmQgYXR0cmlidXRlIG5hbWVzLCBnb3Q6ICR7U3RyaW5nKHNjb3BlQXR0cmlidXRlcyl9YClcbiAgfVxuXG4gIGZvciAoY29uc3Qgc2NvcGVBdHRyaWJ1dGUgb2YgT2JqZWN0LmtleXMoc2NvcGVBdHRyaWJ1dGVzIHx8IHt9KSkge1xuICAgIGlmICghc3luY1Njb3BlQXR0cmlidXRlcy5pbmNsdWRlcyhzY29wZUF0dHJpYnV0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIHJlY2VpdmVkIHVua25vd24gc2NvcGUgYXR0cmlidXRlOiAke3Njb3BlQXR0cmlidXRlfSAodGhlIHN5bmMgbW9kZWwgZGVjbGFyZXM6ICR7c3luY1Njb3BlQXR0cmlidXRlcy5qb2luKFwiLCBcIil9KWApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHN5bmNTY29wZUF0dHJpYnV0ZXMubWFwKChzY29wZUF0dHJpYnV0ZSkgPT4ge1xuICAgIGNvbnN0IGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlID0gc2NvcGVBdHRyaWJ1dGVzPy5bc2NvcGVBdHRyaWJ1dGVdXG5cbiAgICBpZiAoZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHR5cGVvZiBkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSAhPT0gXCJzdHJpbmdcIiB8fCAhYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzLiR7c2NvcGVBdHRyaWJ1dGV9IG11c3QgbmFtZSBhbiBleGlzdGluZyByZWNvcmQgYXR0cmlidXRlLCBnb3Q6ICR7U3RyaW5nKGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlKX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2NvbHVtbk5hbWU6IHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSwgcmVjb3JkQXR0cmlidXRlOiBkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSwgcmVzb2x2ZXI6IHVuZGVmaW5lZCwgc2NvcGVBdHRyaWJ1dGV9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbHVtbk5hbWU6IHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSxcbiAgICAgIHJlY29yZEF0dHJpYnV0ZTogYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoc2NvcGVBdHRyaWJ1dGUpID8gc2NvcGVBdHRyaWJ1dGUgOiBudWxsLFxuICAgICAgcmVzb2x2ZXI6IHVuZGVmaW5lZCxcbiAgICAgIHNjb3BlQXR0cmlidXRlXG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyB0aGF0IGEgY29tcHV0ZWQgZGVjbGFyYXRpb24gcmV0dXJuZWQgYW4gb3JkaW5hcnkga2V5L3ZhbHVlIG9iamVjdC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSZXNvbHZlciByZXN1bHQuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj59IFdoZXRoZXIgdGhlIHZhbHVlIGlzIGEgcGxhaW4gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBpc1BsYWluT2JqZWN0KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgc3luYy1yb3cgY29sdW1uIHBlcnNpc3RpbmcgYSBkZWNsYXJlZCBzY29wZSBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge3tzY29wZUF0dHJpYnV0ZTogc3RyaW5nLCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIFNjb3BlIGF0dHJpYnV0ZSBhbmQgc3luYyBtb2RlbC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMtcm93IGNvbHVtbiBuYW1lLlxuICovXG5mdW5jdGlvbiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSkge1xuICBjb25zdCBjb2x1bW5OYW1lID0gc3luY01vZGVsLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtzY29wZUF0dHJpYnV0ZV1cblxuICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7c3luY01vZGVsLm5hbWV9IGRlY2xhcmVzIHRoZSBzeW5jIHNjb3BlIGF0dHJpYnV0ZSAke3Njb3BlQXR0cmlidXRlfSBidXQgaGFzIG5vIG1hdGNoaW5nIGNvbHVtbiBmb3IgaXRgKVxuICB9XG5cbiAgcmV0dXJuIGNvbHVtbk5hbWVcbn1cblxuLyoqXG4gKiBEZWZhdWx0IHB1Ymxpc2ggc2VyaWFsaXplcjogdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMgd2l0aCBEYXRlIHZhbHVlc1xuICogc2VyaWFsaXplZCB0byBJU08gc3RyaW5ncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIE11dGF0ZWQgc2VydmVyIG1vZGVsIHJlY29yZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFNlcmlhbGl6ZWQgYXR0cmlidXRlcyBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0U2VyaWFsaXplZEF0dHJpYnV0ZXMocmVjb3JkKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBhdHRyaWJ1dGVzID0gey4uLnJlY29yZC5hdHRyaWJ1dGVzKCl9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgfVxuXG4gIHJldHVybiBhdHRyaWJ1dGVzXG59XG5cbi8qKlxuICogQ29udmVydHMgYSBkYXRlLWxpa2UgdmFsdWUgdG8gYW4gSVNPIHN0cmluZywgbWF0Y2hpbmcgdGhlIGNoYW5nZS1mZWVkXG4gKiBzZXJpYWxpemVyJ3MgY29udmVudGlvbiBmb3IgdGhlIHN5bmMgZW50cnkncyBwdWJsaWMgdXBkYXRlZC1hdCBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7RGF0ZSB8IG51bGx9IHZhbHVlIC0gUGVyc2lzdGVkIHVwZGF0ZWQtYXQgdmFsdWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBJU08gZGF0ZS5cbiAqIEB0aHJvd3Mge0Vycm9yfSBXaGVuIHRoZSBwZXJzaXN0ZWQgcm93IGhhcyBubyB2YWxpZCB1cGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAqL1xuZnVuY3Rpb24gaXNvRGF0ZSh2YWx1ZSkge1xuICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHx8IE51bWJlci5pc05hTih2YWx1ZS5nZXRUaW1lKCkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUHVibGlzaGVkIHN5bmMgcm93IG11c3QgaGF2ZSBhIHZhbGlkIHVwZGF0ZWRBdCB0aW1lc3RhbXAuXCIpXG4gIH1cblxuICByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxufVxuIl19