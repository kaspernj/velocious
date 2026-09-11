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
     * lock serializes reconciliation plus the shared upsert because unique
     * constraints containing nullable actor/scope columns do not enforce this
     * identity portably across supported databases. Reconciliation retains the
     * row with the newest feed sequence (then lowest id for a deterministic tie)
     * and removes older matching server-origin rows before applying the current
     * mutation.
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
            const matchingSyncs = await syncModel
                .where(identity)
                .toArray();
            matchingSyncs.sort(comparePublishedSyncRowsByRecency);
            const [existingSync, ...duplicateSyncs] = matchingSyncs;
            for (const duplicateSync of duplicateSyncs) {
                await duplicateSync.destroy();
            }
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
 * Orders matching published rows by the feed's public recency contract so
 * legacy duplicates have one deterministic survivor. Server sequences are
 * positive and monotonic; a legacy null sequence is older than any assigned
 * sequence, and the immutable row id breaks otherwise-equal ties.
 * @param {ReturnType<typeof JSON.parse>} left - First matching sync row.
 * @param {ReturnType<typeof JSON.parse>} right - Second matching sync row.
 * @returns {number} Sort comparison with the canonical survivor first.
 */
function comparePublishedSyncRowsByRecency(left, right) {
    const leftSequence = left.serverSequence();
    const rightSequence = right.serverSequence();
    if (leftSequence === null && rightSequence !== null)
        return 1;
    if (leftSequence !== null && rightSequence === null)
        return -1;
    if (leftSequence !== rightSequence)
        return rightSequence - leftSequence;
    return left.id().localeCompare(right.id());
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1wdWJsaXNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXB1Ymxpc2hlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3hFLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFFekQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0sNEJBQTRCLENBQUE7QUFDdEUsT0FBTyxFQUFDLHlCQUF5QixFQUFFLGFBQWEsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ2hGLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ3BFLE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLHdCQUF3QixDQUFBO0FBRTdELHNGQUFzRjtBQUN0RixNQUFNLHdCQUF3QixHQUFHLEVBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUMsQ0FBQTtBQUV4Rzs7Ozs7O29EQU1vRDtBQUNwRCxNQUFNLDRCQUE0QixHQUFHLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO0FBRXpELG9EQUFvRDtBQUNwRCxNQUFNLGdDQUFnQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFdEQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxhQUFhO0lBQ2hDOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxPQUFPLEdBQUcsRUFBRTtRQUN0QixNQUFNLEVBQUMs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NERBQTREO0lBQzVELE1BQU0sVUFBVSxHQUFHLEVBQUMsR0FBRyxNQUFNLENBQUMsVUFBVSxFQUFFLEVBQUMsQ0FBQTtJQUUzQyxLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ2hFLElBQUksS0FBSyxZQUFZLElBQUk7WUFBRSxVQUFVLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQzVFLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQTtBQUNuQixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxPQUFPLENBQUMsS0FBSztJQUNwQixJQUFJLENBQUMsQ0FBQyxLQUFLLFlBQVksSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQzlELE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELENBQUMsQ0FBQTtJQUM5RSxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUE7QUFDNUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi4vdXRpbHMvc3RhYmxlLWpzb24uanNcIlxuXG5pbXBvcnQge2RlY2xhcmVkU3luY1Njb3BlQXR0cmlidXRlc30gZnJvbSBcIi4vc3luYy1zY29wZS1hdHRyaWJ1dGVzLmpzXCJcbmltcG9ydCB7ZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cywgdXBzZXJ0U3luY1Jvd30gZnJvbSBcIi4vc3luYy1jaGFuZ2UtZmFub3V0LmpzXCJcbmltcG9ydCB7aXNQdWJsaXNoaW5nU3VwcHJlc3NlZH0gZnJvbSBcIi4vc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzXCJcbmltcG9ydCB7VkVMT0NJT1VTX1NZTkNfQ0hBTk5FTH0gZnJvbSBcIi4vc3luYy1jaGFubmVsLW5hbWUuanNcIlxuXG4vKiogQHR5cGUge3tjcmVhdGU6IFwiYWZ0ZXJDcmVhdGVcIiwgdXBkYXRlOiBcImFmdGVyVXBkYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCJ9fSAqL1xuY29uc3QgUFVCTElTSEVEX0NBTExCQUNLX05BTUVTID0ge2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIn1cblxuLyoqXG4gKiBPcGVyYXRpb25zIHB1Ymxpc2hlZCBieSBkZWZhdWx0IGZvciBtb2RlbHMgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2AgcHVibGlzaFxuICogd2l0aG91dCBhbiBgb3BlcmF0aW9uc2Aga2V5OiBzZXJ2ZXItc2lkZSBjcmVhdGVzIGFuZCB1cGRhdGVzIHB1Ymxpc2hcbiAqIGF1dG9tYXRpY2FsbHkuIERlc3Ryb3lzIGFyZSBub3QgcHVibGlzaGVkIGJ5IGRlZmF1bHQgYmVjYXVzZSBhIHNlcnZlclxuICogZGVzdHJveSBpcyBvZnRlbiBjbGVhbnVwIHJhdGhlciB0aGFuIGEgc3luY2VkIGRlbGV0ZTsgb3B0IGluIHdpdGggYW5cbiAqIG9wZXJhdGlvbnMgbGlzdC5cbiAqIEB0eXBlIHtBcnJheTxcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiPn0gKi9cbmNvbnN0IERFRkFVTFRfUFVCTElTSEVEX09QRVJBVElPTlMgPSBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl1cblxuLyoqIEB0eXBlIHtXZWFrTWFwPENvbmZpZ3VyYXRpb24sIFN5bmNQdWJsaXNoZXI+fSAqL1xuY29uc3Qgc3RhcnRlZFB1Ymxpc2hlcnNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogRGVjbGFyYXRpdmUgc2VydmVyLXNpZGUgc3luYyBwdWJsaXNoZXIg4oCUIHRoZSBzZXJ2ZXIgbWlycm9yIG9mIHRoZSBjbGllbnQnc1xuICogdHJhY2stYnktZGVmYXVsdCBtdXRhdGlvbiB0cmFja2luZy5cbiAqXG4gKiBTZXJ2ZXIgbW9kZWxzIGRlY2xhcmUgd2hhdCB0byBwdWJsaXNoIHRocm91Z2ggYHN0YXRpYyBzeW5jYCdzIGBwdWJsaXNoYFxuICoga2V5LCBhbmQgVmVsb2Npb3VzIHdyaXRlcyBldmVyeSBjb21taXR0ZWQgc2VydmVyLXNpZGUgY2hhbmdlIHRvIHRoZSBzeW5jXG4gKiBjaGFuZ2UgZmVlZCAobW9kZWwtYmFja2VkIFN5bmMtcm93IHVwc2VydCB3aXRoIHNlcnZlciByZS1zZXF1ZW5jaW5nKSBhbmRcbiAqIGJyb2FkY2FzdHMgdGhlIHN0YW5kYXJkIHN5bmMgZW52ZWxvcGUgKGB7ZWNob09yaWdpbiwgc3luY3M6IFsuLi5dfWApIG9uIHRoZVxuICogZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCAoe0BsaW5rIFZFTE9DSU9VU19TWU5DX0NIQU5ORUx9KSBzY29wZWQgYnkgdGhlXG4gKiBjaGFuZ2UncyBkZXJpdmVkIHNjb3BlLXBhcnRpdGlvbiB2YWx1ZXMsIHNvIGRldmljZXMgcmVjZWl2ZSBzZXJ2ZXItb3JpZ2luXG4gKiBjaGFuZ2VzIHdpdGhvdXQgYXBwIGNvZGUgZGVjbGFyaW5nIGNoYW5uZWxzIG9yIGNhbGxpbmcgbWFudWFsXG4gKiB1cHNlcnQvYnJvYWRjYXN0IGhlbHBlcnM6XG4gKlxuICogICAgIHN0YXRpYyBzeW5jID0ge3B1Ymxpc2g6IHRydWV9IC8vIGRlZmF1bHQgcGF5bG9hZCAoYXR0cmlidXRlcykgKyBkZWZhdWx0IHNjb3BlIHBhcnRpdGlvblxuICogICAgIHN0YXRpYyBzeW5jID0ge3B1Ymxpc2g6IHtzZXJpYWxpemU6IChyZWNvcmQpID0+ICh7aWQ6IHJlY29yZC5pZCgpLCBwaW46IHJlY29yZC5waW4oKX0pfX1cbiAqXG4gKiBUaGUgc2NvcGUgcGFydGl0aW9uIGNvbWVzIGZyb20gdGhlIHN5bmMgbW9kZWwncyBgc3RhdGljXG4gKiBzeW5jU2NvcGVBdHRyaWJ1dGVzYCBkZWNsYXJhdGlvbiAoZm9yIGV4YW1wbGUgYFtcImV2ZW50SWRcIl1gIG9yXG4gKiBgW1wiYWNjb3VudElkXCJdYCDigJQgVmVsb2Npb3VzIGhhcyBubyBidWlsdC1pbiBwYXJ0aXRpb24gbmFtZSk6IGVhY2ggZGVjbGFyZWRcbiAqIHNjb3BlIGF0dHJpYnV0ZSByZWFkcyB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlIG9mIHRoZSBzYW1lIG5hbWUgd2hlbiB0aGVcbiAqIG1vZGVsIGhhcyBvbmUsIGVsc2UgdGhlIHJlY29yZCdzIG93biBpZCAoc2NvcGUtcm9vdCBtb2RlbHMpLCBvdmVycmlkYWJsZVxuICogcGVyIG1vZGVsIHRocm91Z2ggYHB1Ymxpc2g6IHtzY29wZUF0dHJpYnV0ZXM6IHthY2NvdW50SWQ6IFwib3duZXJJZFwifX1gLlxuICogVGhlIHByZS1mcmFtZXdvcmstY2hhbm5lbCBgYnJvYWRjYXN0c2AgbGlzdCBhbmQgdGhlIGBldmVudElkYFxuICogc3RyaW5nL3Jlc29sdmVyLWZ1bmN0aW9uIGRlY2xhcmF0aW9uIGZvcm1zIGtlZXAgd29ya2luZyBidXQgYXJlIGRlcHJlY2F0ZWQuXG4gKlxuICogUmVwbGF5ZWQgZGV2aWNlIG11dGF0aW9ucyBuZXZlciBkb3VibGUtcHVibGlzaDogdGhlIGZyYW1ld29yaydzIHJvdXRlZFxuICogcmVwbGF5IGFwcGx5IG1hcmtzIGl0cyB3cml0dGVuIHJlY29yZHMgdGhyb3VnaCBgbWFya1NlcnZlckFwcGx5KHJlY29yZClgXG4gKiAoc2VlIHN5bmMtcHVibGlzaC1zdXBwcmVzc2lvbi5qcyksIGFuZCBhcHAgY29kZSBhcHBseWluZyBhbHJlYWR5LXN5bmNlZFxuICogZGF0YSBjYW4gdXNlIGBtYXJrU2VydmVyQXBwbHlgL2B3aXRob3V0UHVibGlzaGluZ2AgdGhlIHNhbWUgd2F5LlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jUHVibGlzaGVyIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3luYyBwdWJsaXNoZXIgYnkgZGVyaXZpbmcgcHVibGlzaGVkIHJlc291cmNlcyBmcm9tIHRoZVxuICAgKiBjb25maWd1cmF0aW9uJ3MgcmVnaXN0ZXJlZCBtb2RlbHM6IGV2ZXJ5IG1vZGVsIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgXG4gICAqIHdpdGggYSBgcHVibGlzaGAgZGVjbGFyYXRpb24gYmVjb21lcyBhIHB1Ymxpc2hlZCByZXNvdXJjZVxuICAgKiAoYHB1Ymxpc2g6IGZhbHNlYCBvcHRzIG91dCkuIFRoZSBzeW5jL2NoYW5nZSBtb2RlbCBpcyB0aGUgcmVnaXN0ZXJlZFxuICAgKiBcIlN5bmNcIiBtb2RlbCBhbmQgYnJvYWRjYXN0cyBkZWZhdWx0IHRvIHRoZSBjb25maWd1cmF0aW9uJ3MgY2hhbm5lbFxuICAgKiBicm9hZGNhc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc30gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge2FjdG9yRm9yZWlnbktleUNvbHVtbiA9IFwiYXV0aGVudGljYXRpb25fdG9rZW5faWRcIiwgYnJvYWRjYXN0ZXIsIGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb25FcnJvciwgc3luY01vZGVsLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuXG4gICAgY29uc3QgbW9kZWxDbGFzc2VzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHB1Ymxpc2hpbmdNb2RlbENsYXNzZXMgPSBPYmplY3QudmFsdWVzKG1vZGVsQ2xhc3NlcykuZmlsdGVyKChtb2RlbENsYXNzKSA9PiBwdWJsaXNoRGVjbGFyYXRpb25Gb3IobW9kZWxDbGFzcykpXG5cbiAgICBpZiAocHVibGlzaGluZ01vZGVsQ2xhc3Nlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNQdWJsaXNoZXIgZm91bmQgbm8gcmVnaXN0ZXJlZCBtb2RlbHMgZGVjbGFyaW5nIHN0YXRpYyBzeW5jIHB1Ymxpc2ggLSBkZWNsYXJlIGBzdGF0aWMgc3luYyA9IHtwdWJsaXNoOiB7c2VyaWFsaXplfX1gIG9uIHRoZSBtb2RlbHMgd2hvc2Ugc2VydmVyLXNpZGUgY2hhbmdlcyBzaG91bGQgcHVibGlzaCB0byB0aGUgc3luYyBmZWVkXCIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRTeW5jTW9kZWwgPSBzeW5jTW9kZWwgfHwgbW9kZWxDbGFzc2VzLlN5bmNcblxuICAgIGlmICghcmVzb2x2ZWRTeW5jTW9kZWwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNQdWJsaXNoZXIgcmVxdWlyZXMgYSByZWdpc3RlcmVkIFxcXCJTeW5jXFxcIiBtb2RlbCBmb3IgcHVibGlzaGVkIHN5bmMgY2hhbmdlIHJvd3MgKG9yIHBhc3Mgb3B0aW9ucy5zeW5jTW9kZWwpXCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVBdHRyaWJ1dGVzID0gZGVjbGFyZWRTeW5jU2NvcGVBdHRyaWJ1dGVzKHJlc29sdmVkU3luY01vZGVsKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWc+fSAqL1xuICAgIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgcHVibGlzaGluZ01vZGVsQ2xhc3Nlcykge1xuICAgICAgY29uc3QgcHVibGlzaCA9IHB1Ymxpc2hEZWNsYXJhdGlvbkZvcihtb2RlbENsYXNzKVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSByZXNvdXJjZUNvbmZpZ0Zyb21QdWJsaXNoRGVjbGFyYXRpb24oe21vZGVsQ2xhc3MsIHB1Ymxpc2gsIHNjb3BlQXR0cmlidXRlcywgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbH0pXG5cbiAgICAgIHJlc291cmNlc1tyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGVdID0gcmVzb3VyY2VDb25maWdcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3thY3RvckZvcmVpZ25LZXlDb2x1bW46IHN0cmluZywgYnJvYWRjYXN0ZXI6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlck9wdGlvbnNbXCJicm9hZGNhc3RlclwiXSwgY29uZmlndXJhdGlvbjogQ29uZmlndXJhdGlvbiwgb25FcnJvcjogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyT3B0aW9uc1tcIm9uRXJyb3JcIl0sIHJlc291cmNlczogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWc+LCBzeW5jTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi9cbiAgICB0aGlzLmNvbmZpZyA9IHthY3RvckZvcmVpZ25LZXlDb2x1bW4sIGJyb2FkY2FzdGVyLCBjb25maWd1cmF0aW9uLCBvbkVycm9yLCByZXNvdXJjZXMsIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWx9XG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2FsbGJhY2s6IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+LCBjYWxsYmFja05hbWU6IFwiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIsIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzID0gW11cbiAgICAvKiogQHR5cGUge0xvZ2dlciB8IG51bGx9ICovXG4gICAgdGhpcy5fbG9nZ2VyID0gbnVsbFxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN5bmMgcHVibGlzaGVyIGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbi4gQWxpYXMgZm9yXG4gICAqIGBuZXcgU3luY1B1Ymxpc2hlcih7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYC5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMuIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7T21pdDxpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zLCBcImNvbmZpZ3VyYXRpb25cIj59IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICogQHJldHVybnMge1N5bmNQdWJsaXNoZXJ9IFN5bmMgcHVibGlzaGVyIGRlcml2ZWQgZnJvbSB0aGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBmcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBuZXcgU3luY1B1Ymxpc2hlcih7Li4ub3B0aW9ucywgY29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIChhbmQgbWVtb2l6ZXMgcGVyIGNvbmZpZ3VyYXRpb24pIHRoZSBzeW5jIHB1Ymxpc2hlciBmb3IgYSBzZXJ2ZXJcbiAgICogYm9vdDogbm8tb3Agd2hlbiBubyByZWdpc3RlcmVkIG1vZGVsIGRlY2xhcmVzIGEgcHVibGlzaCBjb25maWcsIGd1YXJkZWQgc29cbiAgICogcmVwZWF0ZWQgYm9vdHMgd2l0aCB0aGUgc2FtZSBjb25maWd1cmF0aW9uIHJlZ2lzdGVyIHRoZSBwdWJsaXNoIGNhbGxiYWNrc1xuICAgKiBvbmx5IG9uY2UuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSByZWdpc3RlcmVkIG1vZGVscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY1B1Ymxpc2hlciB8IG51bGw+fSBTdGFydGVkIHB1Ymxpc2hlciwgb3IgbnVsbCB3aGVuIG5vIG1vZGVscyBkZWNsYXJlIHB1Ymxpc2guXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc3RhcnRGcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3Qgc3RhcnRlZFB1Ymxpc2hlciA9IHN0YXJ0ZWRQdWJsaXNoZXJzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKHN0YXJ0ZWRQdWJsaXNoZXIpIHJldHVybiBzdGFydGVkUHVibGlzaGVyXG5cbiAgICBpZiAoIU9iamVjdC52YWx1ZXMoY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKSkuc29tZSgobW9kZWxDbGFzcykgPT4gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHB1Ymxpc2hlciA9IG5ldyBTeW5jUHVibGlzaGVyKHtjb25maWd1cmF0aW9ufSlcblxuICAgIHN0YXJ0ZWRQdWJsaXNoZXJzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBwdWJsaXNoZXIpXG4gICAgYXdhaXQgcHVibGlzaGVyLnN0YXJ0KClcblxuICAgIHJldHVybiBwdWJsaXNoZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhlIHB1Ymxpc2ggY2FsbGJhY2tzIGZvciBldmVyeSBwdWJsaXNoZWQgcmVzb3VyY2U6IHNlcnZlci1zaWRlXG4gICAqIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgKGRlc3Ryb3lzIHdoZW4gb3B0ZWQgaW4pIHVwc2VydCBhIHN5bmMgY2hhbmdlIHJvdyBhbmRcbiAgICogZmFuIG91dCB0aGUgZGVjbGFyZWQgYnJvYWRjYXN0cyBvbmNlIHRoZWlyIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgaWYgKHRoaXMuX3N0YXJ0ZWQpIHJldHVyblxuXG4gICAgdGhpcy5fc3RhcnRlZCA9IHRydWVcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2VDb25maWcgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiByZXNvdXJjZUNvbmZpZy5vcGVyYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrTmFtZSA9IFBVQkxJU0hFRF9DQUxMQkFDS19OQU1FU1tvcGVyYXRpb25dXG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy5wdWJsaXNoZWRNdXRhdGlvbkNhbGxiYWNrKHtvcGVyYXRpb24sIHJlc291cmNlQ29uZmlnfSlcblxuICAgICAgICByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzW2NhbGxiYWNrTmFtZV0oY2FsbGJhY2spXG4gICAgICAgIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYWxsIHB1Ymxpc2ggY2FsbGJhY2tzICh0ZXN0cywgc2h1dGRvd24pLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgZm9yIChjb25zdCB7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzc30gb2YgdGhpcy5fcHVibGlzaGVkQ2FsbGJhY2tzKSB7XG4gICAgICBtb2RlbENsYXNzLnVucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHRoaXMuX3B1Ymxpc2hlZENhbGxiYWNrcyA9IFtdXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsaWZlY3ljbGUgY2FsbGJhY2sgcHVibGlzaGluZyBvbmUgc2VydmVyLXNpZGUgbXV0YXRpb24uIFRoZVxuICAgKiBwdWJsaXNoZWQgcGF5bG9hZCAoZGVjbGFyYXRpb24gYHNlcmlhbGl6ZWApLCBldmVudCBzY29wZSwgYW5kIHN5bmMgdHlwZVxuICAgKiBhcmUgc25hcHNob3R0ZWQgYXQgbXV0YXRpb24tY2FsbGJhY2sgdGltZSwgc28gYWZ0ZXJTYXZlIGhvb2tzIGFzc2lnbmluZ1xuICAgKiB1bnNhdmVkIGF0dHJpYnV0ZXMgKG9yIGFueSBsYXRlciBkcmlmdCBvbiB0aGUgcmVjb3JkKSBjYW5ub3QgY2hhbmdlIHdoYXRcbiAgICogZ2V0cyBwdWJsaXNoZWQgdnMgd2hhdCB3YXMgY29tbWl0dGVkLiBQZXJzaXN0aW5nIGFuZCBicm9hZGNhc3RpbmcgYXJlXG4gICAqIGRlZmVycmVkIHRocm91Z2ggdGhlIG1vZGVsIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIHRoZXkgb25seSBydW5cbiAgICogb25jZSB0aGUgbXV0YXRpb24ncyB0cmFuc2FjdGlvbiBoYXMgY29tbWl0dGVkIChpbW1lZGlhdGVseSB3aGVuIG5vXG4gICAqIHRyYW5zYWN0aW9uIGlzIG9wZW4pIC0gcm9sbGVkLWJhY2sgbXV0YXRpb25zIG5ldmVyIHB1Ymxpc2guIFBvc3QtY29tbWl0XG4gICAqIHB1Ymxpc2ggZmFpbHVyZXMgYXJlIHJlcG9ydGVkIHdpdGhvdXQgcmV0aHJvd2luZyBpbnRvIHRoZSBkcml2ZXInc1xuICAgKiBhZnRlckNvbW1pdCBjaGFpbiAoc2VlIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IpLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBPcGVyYXRpb24gYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMgeyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+fSBMaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqL1xuICBwdWJsaXNoZWRNdXRhdGlvbkNhbGxiYWNrKHtvcGVyYXRpb24sIHJlc291cmNlQ29uZmlnfSkge1xuICAgIHJldHVybiBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBpZiAoaXNQdWJsaXNoaW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc291cmNlQ29uZmlnLnNlcmlhbGl6ZShyZWNvcmQpXG4gICAgICBjb25zdCByZXNvdXJjZUlkID0gU3RyaW5nKHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHJlY29yZC5pZCgpLCBgU3luYyBwdWJsaXNoaW5nIGZvciAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX1gKSlcbiAgICAgIGNvbnN0IHN5bmNUeXBlID0gb3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIiA/IFwiZGVsZXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgICBjb25zdCBzY29wZVZhbHVlcyA9IGF3YWl0IHRoaXMucHVibGlzaGVkU2NvcGVWYWx1ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0ge1xuICAgICAgICBbdGhpcy5jb25maWcuYWN0b3JGb3JlaWduS2V5Q29sdW1uXTogbnVsbCxcbiAgICAgICAgY2xpZW50X3VwZGF0ZWRfYXQ6IG5ldyBEYXRlKCksXG4gICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgICAgICByZXNvdXJjZV9pZDogcmVzb3VyY2VJZCxcbiAgICAgICAgcmVzb3VyY2VfdHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlLFxuICAgICAgICBzeW5jX3R5cGU6IHN5bmNUeXBlLFxuICAgICAgICAuLi5zY29wZVZhbHVlcy5jb2x1bW5zXG4gICAgICB9XG4gICAgICBjb25zdCBkYXRhYmFzZU9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG4gICAgICBjb25zdCBvcGVyYXRpb25TY29wZSA9IGRhdGFiYXNlT3BlcmF0aW9uXG4gICAgICAgID8gZGF0YWJhc2VPcGVyYXRpb24uZm9yTW9kZWwodGhpcy5jb25maWcuc3luY01vZGVsKVxuICAgICAgICA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuXG4gICAgICBhd2FpdCByZWNvcmQuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBzY29wZUNvbHVtbk5hbWVzID0gcmVzb3VyY2VDb25maWcuc2NvcGVQbGFuLm1hcCgoe2NvbHVtbk5hbWV9KSA9PiBjb2x1bW5OYW1lKVxuICAgICAgICAgIGNvbnN0IHN5bmNSb3cgPSBhd2FpdCB0aGlzLnVwc2VydFB1Ymxpc2hlZFN5bmNSb3coYXR0cmlidXRlcywgb3BlcmF0aW9uU2NvcGUsIHNjb3BlQ29sdW1uTmFtZXMpXG5cbiAgICAgICAgICBhd2FpdCB0aGlzLmJyb2FkY2FzdGVyKCkoe1xuICAgICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgICBlY2hvT3JpZ2luOiBudWxsLFxuICAgICAgICAgICAgICBzeW5jczogW3RoaXMucHVibGlzaGVkU3luY0VudHJ5KHtkYXRhLCByZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VJZCwgc3luY1Jvdywgc3luY1R5cGV9KV1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjaGFubmVsOiBWRUxPQ0lPVVNfU1lOQ19DSEFOTkVMLFxuICAgICAgICAgICAgcGFyYW1zOiB7Li4uc2NvcGVWYWx1ZXMucGFyYW1zLCByZXNvdXJjZVR5cGU6IHJlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX1cbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgaWYgKHJlc291cmNlQ29uZmlnLmJyb2FkY2FzdHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGRlbGl2ZXJEZWNsYXJlZEJyb2FkY2FzdHMoe1xuICAgICAgICAgICAgICBhcmdzOiB7ZGF0YSwgb3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlSWQsIHJlc291cmNlVHlwZTogcmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlLCBzeW5jUm93LCBzeW5jVHlwZX0sXG4gICAgICAgICAgICAgIGJyb2FkY2FzdGVyOiB0aGlzLmJyb2FkY2FzdGVyKCksXG4gICAgICAgICAgICAgIGJyb2FkY2FzdHM6IHJlc291cmNlQ29uZmlnLmJyb2FkY2FzdHNcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGF3YWl0IHRoaXMucmVwb3J0QWZ0ZXJDb21taXRFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2NvcGUtcGFydGl0aW9uIHZhbHVlcyBmb3Igb25lIHB1Ymxpc2hlZCBtdXRhdGlvbiBmcm9tIHRoZVxuICAgKiByZXNvdXJjZSdzIGRlcml2ZWQgc2NvcGUgcGxhbjogZWFjaCBlbnRyeSByZWFkcyBpdHMgcmVjb3JkIGF0dHJpYnV0ZSAob3JcbiAgICogdGhlIHJlY29yZCdzIG93biBpZCBmb3Igc2NvcGUtcm9vdCBtb2RlbHMsIG9yIHRoZSBkZXByZWNhdGVkIHJlc29sdmVyXG4gICAqIGZ1bmN0aW9uKS4gVGhlIHZhbHVlcyBhcmUgcGVyc2lzdGVkIG9udG8gdGhlIHN5bmMgcm93J3MgcGFydGl0aW9uIGNvbHVtbnNcbiAgICogYW5kIGJyb2FkY2FzdCBhcyB0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCdzIHNjb3BpbmcgcGFyYW1zLlxuICAgKiBAcGFyYW0ge3tyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWd9fSBhcmdzIC0gTXV0YXRlZCByZWNvcmQgYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NvbHVtbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+LCBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fT59IFNjb3BlIHZhbHVlcyBrZXllZCBieSBzeW5jLXJvdyBjb2x1bW4gYW5kIGJ5IHNjb3BlIGF0dHJpYnV0ZS5cbiAgICovXG4gIGFzeW5jIHB1Ymxpc2hlZFNjb3BlVmFsdWVzKHtyZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59ICovXG4gICAgY29uc3QgY29sdW1ucyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gKi9cbiAgICBjb25zdCBwYXJhbXMgPSB7fVxuICAgIGNvbnN0IGNvbXB1dGVkU2NvcGVBdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuc2NvcGVBdHRyaWJ1dGVzUmVzb2x2ZXJcbiAgICAgID8gYXdhaXQgdGhpcy5yZXNvbHZlQ29tcHV0ZWRTY29wZUF0dHJpYnV0ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgOiBudWxsXG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlUGxhbkVudHJ5IG9mIHJlc291cmNlQ29uZmlnLnNjb3BlUGxhbikge1xuICAgICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICAgIGxldCByYXdWYWx1ZVxuXG4gICAgICBpZiAoY29tcHV0ZWRTY29wZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmF3VmFsdWUgPSBjb21wdXRlZFNjb3BlQXR0cmlidXRlc1tzY29wZVBsYW5FbnRyeS5zY29wZUF0dHJpYnV0ZV1cbiAgICAgIH0gZWxzZSBpZiAoc2NvcGVQbGFuRW50cnkucmVzb2x2ZXIpIHtcbiAgICAgICAgcmF3VmFsdWUgPSBhd2FpdCBzY29wZVBsYW5FbnRyeS5yZXNvbHZlcihyZWNvcmQpXG4gICAgICB9IGVsc2UgaWYgKHNjb3BlUGxhbkVudHJ5LnJlY29yZEF0dHJpYnV0ZSkge1xuICAgICAgICByYXdWYWx1ZSA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHNjb3BlUGxhbkVudHJ5LnJlY29yZEF0dHJpYnV0ZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJhd1ZhbHVlID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBTeW5jIHNjb3BlIHB1Ymxpc2hpbmcgZm9yICR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gcmF3VmFsdWUgPT09IHVuZGVmaW5lZCB8fCByYXdWYWx1ZSA9PT0gbnVsbCA/IG51bGwgOiBTdHJpbmcocmF3VmFsdWUpXG5cbiAgICAgIGNvbHVtbnNbc2NvcGVQbGFuRW50cnkuY29sdW1uTmFtZV0gPSB2YWx1ZVxuICAgICAgcGFyYW1zW3Njb3BlUGxhbkVudHJ5LnNjb3BlQXR0cmlidXRlXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb2x1bW5zLCBwYXJhbXN9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW5kIHZhbGlkYXRlcyBvbmUgY29tcHV0ZWQgc2NvcGUtYXR0cmlidXRlcyBkZWNsYXJhdGlvbi4gVGhlXG4gICAqIHJlc29sdmVyIHJ1bnMgb25jZSBwZXIgcHVibGlzaGVkIG11dGF0aW9uIHdpdGggdGhlIGV4YWN0IGNvbm5lY3Rpb24gdGhhdFxuICAgKiBvd25zIHRoYXQgbXV0YXRpb247IGV2ZXJ5IGRlY2xhcmVkIHNjb3BlIHZhbHVlIGlzIHRoZW4gcmV1c2VkIGZvciByb3dcbiAgICogcGVyc2lzdGVuY2UgYW5kIGJyb2FkY2FzdCByb3V0aW5nIHNvIHRob3NlIHR3byBpZGVudGl0aWVzIGNhbm5vdCBkcmlmdC5cbiAgICogQHBhcmFtIHt7cmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfX0gYXJncyAtIFJlY29yZCBhbmQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD4+fSBDb21wbGV0ZSBjb21wdXRlZCBzY29wZSB2YWx1ZXMuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQ29tcHV0ZWRTY29wZUF0dHJpYnV0ZXMoe3JlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvdXJjZUNvbmZpZy5zY29wZUF0dHJpYnV0ZXNSZXNvbHZlclxuXG4gICAgaWYgKCFyZXNvbHZlcikgdGhyb3cgbmV3IEVycm9yKGBObyBjb21wdXRlZCBzY29wZS1hdHRyaWJ1dGVzIHJlc29sdmVyIGNvbmZpZ3VyZWQgZm9yICR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfWApXG5cbiAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24sXG4gICAgICBjb25uZWN0aW9uOiByZWNvcmQuY29ubmVjdGlvbigpLFxuICAgICAgcmVjb3JkXG4gICAgfSlcblxuICAgIGlmICghaXNQbGFpbk9iamVjdChyZXNvbHZlZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIHJlc29sdmVyIG11c3QgcmVzb2x2ZSB0byBhIHBsYWluIG9iamVjdGApXG4gICAgfVxuXG4gICAgY29uc3QgZGVjbGFyZWRBdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuc2NvcGVQbGFuLm1hcCgoe3Njb3BlQXR0cmlidXRlfSkgPT4gc2NvcGVBdHRyaWJ1dGUpXG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIE9iamVjdC5rZXlzKHJlc29sdmVkKSkge1xuICAgICAgaWYgKCFkZWNsYXJlZEF0dHJpYnV0ZXMuaW5jbHVkZXMoc2NvcGVBdHRyaWJ1dGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggc2NvcGVBdHRyaWJ1dGVzIHJlc29sdmVyIHJldHVybmVkIHVua25vd24gc2NvcGUgYXR0cmlidXRlOiAke3Njb3BlQXR0cmlidXRlfSAodGhlIHN5bmMgbW9kZWwgZGVjbGFyZXM6ICR7ZGVjbGFyZWRBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX0pYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIGRlY2xhcmVkQXR0cmlidXRlcykge1xuICAgICAgaWYgKCFPYmplY3QuaGFzT3duKHJlc29sdmVkLCBzY29wZUF0dHJpYnV0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlQ29uZmlnLnJlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVzb2x2ZXIgbXVzdCByZXNvbHZlIHRoZSBkZWNsYXJlZCBzY29wZSBhdHRyaWJ1dGUgJHtzY29wZUF0dHJpYnV0ZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB2YWx1ZSA9IHJlc29sdmVkW3Njb3BlQXR0cmlidXRlXVxuXG4gICAgICBpZiAodmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VDb25maWcucmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNjb3BlIGF0dHJpYnV0ZSAke3Njb3BlQXR0cmlidXRlfSBtdXN0IGJlIGEgc3RyaW5nLCBudW1iZXIsIG9yIG51bGxgKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IG51bGw+fSAqLyAocmVzb2x2ZWQpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsIGVudHJ5IGZvciBvbmUgcHVibGlzaGVkIGNoYW5nZTogdGhlXG4gICAqIHNuYXBzaG90dGVkIHBheWxvYWQgcGx1cyB0aGUgcGVyc2lzdGVkIHN5bmMgcm93J3MgcHVibGljIGV4YWN0LXJvdyBtZXRhZGF0YVxuICAgKiAoaWQsIHNlcnZlciBzZXF1ZW5jZSwgdXBkYXRlZC1hdCwgYW5kIGRlY2xhcmVkIHNjb3BlLXBhcnRpdGlvbiBhdHRyaWJ1dGVzKS5cbiAgICogVXNlcyB0aGUgc3luYyBtb2RlbCdzIGdlbmVyYXRlZCB0eXBlZCBhY2Nlc3NvcnMgYW5kIGZvbGxvd3MgdGhlXG4gICAqIGNoYW5nZS1mZWVkIHNlcmlhbGl6ZXIncyBwdWJsaWMgZmllbGQgY29udmVudGlvbi5cbiAgICogQHBhcmFtIHt7ZGF0YTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLXB1Ymxpc2hlci10eXBlcy5qc1wiKS5TeW5jUHVibGlzaGVyUmVzb3VyY2VDb25maWcsIHJlc291cmNlSWQ6IHN0cmluZywgc3luY1JvdzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHN5bmNUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUHVibGlzaCBhcmdzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBCcm9hZGNhc3Qgc3luYyBlbnRyeS5cbiAgICovXG4gIHB1Ymxpc2hlZFN5bmNFbnRyeSh7ZGF0YSwgcmVzb3VyY2VDb25maWcsIHJlc291cmNlSWQsIHN5bmNSb3csIHN5bmNUeXBlfSkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge1xuICAgICAgZGF0YSxcbiAgICAgIGlkOiBzeW5jUm93LmlkKCksXG4gICAgICByZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZUNvbmZpZy5yZXNvdXJjZVR5cGUsXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZTogc3luY1Jvdy5zZXJ2ZXJTZXF1ZW5jZSgpLFxuICAgICAgc3luY1R5cGUsXG4gICAgICB1cGRhdGVkQXQ6IGlzb0RhdGUoc3luY1Jvdy51cGRhdGVkQXQoKSlcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZUF0dHJpYnV0ZXMgPSBkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXModGhpcy5jb25maWcuc3luY01vZGVsKVxuXG4gICAgZm9yIChjb25zdCBzY29wZUF0dHJpYnV0ZSBvZiBzY29wZUF0dHJpYnV0ZXMgfHwgW10pIHtcbiAgICAgIGNvbnN0IHNjb3BlQWNjZXNzb3IgPSBzeW5jUm93W3Njb3BlQXR0cmlidXRlXVxuXG4gICAgICBpZiAodHlwZW9mIHNjb3BlQWNjZXNzb3IgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFB1Ymxpc2hlZCBzeW5jIHJvdyBpcyBtaXNzaW5nIHRoZSBkZWNsYXJlZCBzY29wZSBhY2Nlc3NvciAke3Njb3BlQXR0cmlidXRlfSgpLmApXG4gICAgICB9XG5cbiAgICAgIGVudHJ5W3Njb3BlQXR0cmlidXRlXSA9IHNjb3BlQWNjZXNzb3IuY2FsbChzeW5jUm93KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIFVwc2VydHMgdGhlIHB1Ymxpc2hlZCBzZXJ2ZXItb3JpZ2luIHN5bmMgcm93IGZvciBhIHJlc291cmNlIGlkZW50aXR5OlxuICAgKiBzZXJ2ZXItb3JpZ2luIHJvd3MgY2FycnkgYSBudWxsIGFjdG9yIGNvbHVtbiAobm8gZGV2aWNlIHRvIGVjaG8gdGhlXG4gICAqIGNoYW5nZSBiYWNrIHRvKSwgc28gcmVwZWF0ZWQgc2VydmVyIGNoYW5nZXMgdG8gb25lIGNvbXBsZXRlIHJlc291cmNlIGFuZFxuICAgKiBzY29wZSBpZGVudGl0eSByZXVzZSBhbmQgcmUtc2VxdWVuY2Ugb25lIGZlZWQgcm93LiBBIGRhdGFiYXNlIGFkdmlzb3J5XG4gICAqIGxvY2sgc2VyaWFsaXplcyByZWNvbmNpbGlhdGlvbiBwbHVzIHRoZSBzaGFyZWQgdXBzZXJ0IGJlY2F1c2UgdW5pcXVlXG4gICAqIGNvbnN0cmFpbnRzIGNvbnRhaW5pbmcgbnVsbGFibGUgYWN0b3Ivc2NvcGUgY29sdW1ucyBkbyBub3QgZW5mb3JjZSB0aGlzXG4gICAqIGlkZW50aXR5IHBvcnRhYmx5IGFjcm9zcyBzdXBwb3J0ZWQgZGF0YWJhc2VzLiBSZWNvbmNpbGlhdGlvbiByZXRhaW5zIHRoZVxuICAgKiByb3cgd2l0aCB0aGUgbmV3ZXN0IGZlZWQgc2VxdWVuY2UgKHRoZW4gbG93ZXN0IGlkIGZvciBhIGRldGVybWluaXN0aWMgdGllKVxuICAgKiBhbmQgcmVtb3ZlcyBvbGRlciBtYXRjaGluZyBzZXJ2ZXItb3JpZ2luIHJvd3MgYmVmb3JlIGFwcGx5aW5nIHRoZSBjdXJyZW50XG4gICAqIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIFNuYXBzaG90dGVkIHN5bmMgcm93IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmNNb2RlbCAtIE9wZXJhdGlvbi1ib3VuZCBvciBzdGF0aWMgU3luYyBtb2RlbCBpbnRlcmZhY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHNjb3BlQ29sdW1uTmFtZXMgLSBQZXJzaXN0ZWQgc2NvcGUgY29sdW1ucyBwYXJ0aWNpcGF0aW5nIGluIHRoZSBjb21wbGV0ZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBVcHNlcnRlZCBzeW5jIHJvdy5cbiAgICovXG4gIGFzeW5jIHVwc2VydFB1Ymxpc2hlZFN5bmNSb3coYXR0cmlidXRlcywgc3luY01vZGVsID0gdGhpcy5jb25maWcuc3luY01vZGVsLCBzY29wZUNvbHVtbk5hbWVzID0gW10pIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBpZGVudGl0eSA9IHtcbiAgICAgIFt0aGlzLmNvbmZpZy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiBudWxsLFxuICAgICAgcmVzb3VyY2VfaWQ6IGF0dHJpYnV0ZXMucmVzb3VyY2VfaWQsXG4gICAgICByZXNvdXJjZV90eXBlOiBhdHRyaWJ1dGVzLnJlc291cmNlX3R5cGVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2Ygc2NvcGVDb2x1bW5OYW1lcykge1xuICAgICAgaWYgKCFPYmplY3QuaGFzT3duKGF0dHJpYnV0ZXMsIGNvbHVtbk5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUHVibGlzaGVkIHN5bmMgcm93IGlkZW50aXR5IGlzIG1pc3NpbmcgdGhlIHNjb3BlIGNvbHVtbiAke2NvbHVtbk5hbWV9YClcbiAgICAgIH1cblxuICAgICAgaWRlbnRpdHlbY29sdW1uTmFtZV0gPSBhdHRyaWJ1dGVzW2NvbHVtbk5hbWVdXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlnLnN5bmNNb2RlbC53aXRoQWR2aXNvcnlMb2NrKHN5bmNQdWJsaXNoZXJJZGVudGl0eUxvY2tOYW1lKGlkZW50aXR5KSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbWF0Y2hpbmdTeW5jcyA9IGF3YWl0IHN5bmNNb2RlbFxuICAgICAgICAud2hlcmUoaWRlbnRpdHkpXG4gICAgICAgIC50b0FycmF5KClcblxuICAgICAgbWF0Y2hpbmdTeW5jcy5zb3J0KGNvbXBhcmVQdWJsaXNoZWRTeW5jUm93c0J5UmVjZW5jeSlcblxuICAgICAgY29uc3QgW2V4aXN0aW5nU3luYywgLi4uZHVwbGljYXRlU3luY3NdID0gbWF0Y2hpbmdTeW5jc1xuXG4gICAgICBmb3IgKGNvbnN0IGR1cGxpY2F0ZVN5bmMgb2YgZHVwbGljYXRlU3luY3MpIHtcbiAgICAgICAgYXdhaXQgZHVwbGljYXRlU3luYy5kZXN0cm95KClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsfSlcbiAgICB9LCB7ZGVkaWNhdGVkQ29ubmVjdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYnJvYWRjYXN0ZXIgZGVsaXZlcmluZyBkZWNsYXJlZCBicm9hZGNhc3RzOiB0aGUgaW5qZWN0ZWQgb25lLFxuICAgKiBvciB0aGUgY29uZmlndXJhdGlvbidzIGNoYW5uZWwgYnJvYWRjYXN0IGF3YWl0ZWQgdGhyb3VnaCB0aGUgcGVuZGluZ1xuICAgKiBicm9hZGNhc3QgcXVldWUuXG4gICAqIEByZXR1cm5zIHtOb25OdWxsYWJsZTxpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoZXJPcHRpb25zW1wiYnJvYWRjYXN0ZXJcIl0+fSBCcm9hZGNhc3QgZGVsaXZlcmVyLlxuICAgKi9cbiAgYnJvYWRjYXN0ZXIoKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLmJyb2FkY2FzdGVyKSByZXR1cm4gdGhpcy5jb25maWcuYnJvYWRjYXN0ZXJcblxuICAgIHJldHVybiBhc3luYyAoe2JvZHksIGNoYW5uZWwsIHBhcmFtc30pID0+IHtcbiAgICAgIHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKGNoYW5uZWwsIHBhcmFtcywgYm9keSlcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24uYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCBwdWJsaXNoIGZhaWx1cmUuIFRoZSB0cmFuc2FjdGlvbiBoYXMgYWxyZWFkeVxuICAgKiBjb21taXR0ZWQgd2hlbiBhZnRlckNvbW1pdCBjYWxsYmFja3MgcnVuLCBzbyByZXRocm93aW5nIGhlcmUgd291bGQgcG9pc29uXG4gICAqIHRoZSBkcml2ZXIncyBhd2FpdGVkIGFmdGVyQ29tbWl0IGNoYWluIChicmVha2luZyB1bnJlbGF0ZWQgY2FsbGJhY2tzKSAtXG4gICAqIGluc3RlYWQgdGhlIGZhaWx1cmUgZ29lcyB0byB0aGUgY29uZmlndXJlZCBvbkVycm9yIGhvb2ssIG9yIGlzIGVtaXR0ZWQgb25cbiAgICogdGhlIGNvbmZpZ3VyYXRpb24ncyBmcmFtZXdvcmstZXJyb3IvYWxsLWVycm9yIGNoYW5uZWxzIChzbyBwcm9kdWN0aW9uIGJ1Z1xuICAgKiByZXBvcnRpbmcgdmlhIGBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClgIHNlZXMgYSBicm9rZW4gcHVibGlzaFxuICAgKiBwYXRoKSBhbmQgbG9nZ2VkIGxvdWRseSB0aHJvdWdoIHRoZSBwdWJsaXNoZXIncyBsb2dnZXIgd2hlbiBub25lIGlzXG4gICAqIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gUG9zdC1jb21taXQgcHVibGlzaCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5jb25maWcub25FcnJvcikge1xuICAgICAgdGhpcy5jb25maWcub25FcnJvcihlcnJvcilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJzeW5jLXB1Ymxpc2gtYWZ0ZXItY29tbWl0XCJ9LCBlcnJvcn1cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIoKS5lcnJvcihcIlN5bmNQdWJsaXNoZXIgZmFpbGVkIHRvIHB1Ymxpc2ggYSBzZXJ2ZXItc2lkZSBzeW5jIGNoYW5nZSBhZnRlciBjb21taXRcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IHB1Ymxpc2hlciBsb2dnZXIuXG4gICAqIEByZXR1cm5zIHtMb2dnZXJ9IFB1Ymxpc2hlciBsb2dnZXIuXG4gICAqL1xuICBsb2dnZXIoKSB7XG4gICAgdGhpcy5fbG9nZ2VyIHx8PSBuZXcgTG9nZ2VyKFwiU3luY1B1Ymxpc2hlclwiLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gdGhpcy5fbG9nZ2VyXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgZGV0ZXJtaW5pc3RpYywgTXlTUUwtc2FmZSBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIG9uZSBjb21wbGV0ZVxuICogc2VydmVyLW9yaWdpbiBwdWJsaXNoZXIgaWRlbnRpdHkuIFN0YWJsZSBKU09OIHByZXNlcnZlcyBudWxsIGFjdG9yL3Njb3BlXG4gKiBjb21wb25lbnRzIGRpc3RpbmN0bHkgZnJvbSBzdHJpbmdzLCBhbmQgdGhlIHRydW5jYXRlZCBTSEEtMjU2IGRpZ2VzdCBrZWVwc1xuICogdGhlIGZpbmFsIG5hbWUgYmVsb3cgTXlTUUwvTWFyaWFEQidzIDY0LWNoYXJhY3RlciBgR0VUX0xPQ0tgIGxpbWl0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGlkZW50aXR5IC0gQ29tcGxldGUgc3luYy1yb3cgaWRlbnRpdHkgaW4gY29sdW1uIGZvcm0uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBBZHZpc29yeS1sb2NrIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHN5bmNQdWJsaXNoZXJJZGVudGl0eUxvY2tOYW1lKGlkZW50aXR5KSB7XG4gIGNvbnN0IGhhc2ggPSBzaGEyNTZIZXgoc3RhYmxlSnNvblN0cmluZ2lmeShpZGVudGl0eSkpLnNsaWNlKDAsIDMyKVxuXG4gIHJldHVybiBgdnNwOiR7aGFzaH1gXG59XG5cbi8qKlxuICogT3JkZXJzIG1hdGNoaW5nIHB1Ymxpc2hlZCByb3dzIGJ5IHRoZSBmZWVkJ3MgcHVibGljIHJlY2VuY3kgY29udHJhY3Qgc29cbiAqIGxlZ2FjeSBkdXBsaWNhdGVzIGhhdmUgb25lIGRldGVybWluaXN0aWMgc3Vydml2b3IuIFNlcnZlciBzZXF1ZW5jZXMgYXJlXG4gKiBwb3NpdGl2ZSBhbmQgbW9ub3RvbmljOyBhIGxlZ2FjeSBudWxsIHNlcXVlbmNlIGlzIG9sZGVyIHRoYW4gYW55IGFzc2lnbmVkXG4gKiBzZXF1ZW5jZSwgYW5kIHRoZSBpbW11dGFibGUgcm93IGlkIGJyZWFrcyBvdGhlcndpc2UtZXF1YWwgdGllcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGxlZnQgLSBGaXJzdCBtYXRjaGluZyBzeW5jIHJvdy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJpZ2h0IC0gU2Vjb25kIG1hdGNoaW5nIHN5bmMgcm93LlxuICogQHJldHVybnMge251bWJlcn0gU29ydCBjb21wYXJpc29uIHdpdGggdGhlIGNhbm9uaWNhbCBzdXJ2aXZvciBmaXJzdC5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVB1Ymxpc2hlZFN5bmNSb3dzQnlSZWNlbmN5KGxlZnQsIHJpZ2h0KSB7XG4gIGNvbnN0IGxlZnRTZXF1ZW5jZSA9IGxlZnQuc2VydmVyU2VxdWVuY2UoKVxuICBjb25zdCByaWdodFNlcXVlbmNlID0gcmlnaHQuc2VydmVyU2VxdWVuY2UoKVxuXG4gIGlmIChsZWZ0U2VxdWVuY2UgPT09IG51bGwgJiYgcmlnaHRTZXF1ZW5jZSAhPT0gbnVsbCkgcmV0dXJuIDFcbiAgaWYgKGxlZnRTZXF1ZW5jZSAhPT0gbnVsbCAmJiByaWdodFNlcXVlbmNlID09PSBudWxsKSByZXR1cm4gLTFcbiAgaWYgKGxlZnRTZXF1ZW5jZSAhPT0gcmlnaHRTZXF1ZW5jZSkgcmV0dXJuIHJpZ2h0U2VxdWVuY2UgLSBsZWZ0U2VxdWVuY2VcblxuICByZXR1cm4gbGVmdC5pZCgpLmxvY2FsZUNvbXBhcmUocmlnaHQuaWQoKSlcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIG1vZGVsIGNsYXNzJ3MgYWN0aXZlIHB1Ymxpc2ggZGVjbGFyYXRpb24gZnJvbSBgc3RhdGljIHN5bmNgLlxuICogT3B0ZWQtb3V0IChgcHVibGlzaDogZmFsc2VgKSBhbmQgdW5kZWNsYXJlZCBtb2RlbHMgcmVzb2x2ZSB0byBudWxsOyBldmVyeVxuICogb3RoZXIgZGVjbGFyZWQgdmFsdWUgZmxvd3MgaW50byBsb3VkIGRlY2xhcmF0aW9uIHZhbGlkYXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtb2RlbENsYXNzIC0gUmVnaXN0ZXJlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb24gfCBudWxsfSBBY3RpdmUgcHVibGlzaCBkZWNsYXJhdGlvbiwgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcHVibGlzaERlY2xhcmF0aW9uRm9yKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgZGVjbGFyYXRpb24gPSBtb2RlbENsYXNzLnN5bmNcblxuICBpZiAoIWRlY2xhcmF0aW9uIHx8IHR5cGVvZiBkZWNsYXJhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBkZWNsYXJhdGlvbi5wdWJsaXNoID09PSB1bmRlZmluZWQgfHwgZGVjbGFyYXRpb24ucHVibGlzaCA9PT0gZmFsc2UpIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIGRlY2xhcmF0aW9uLnB1Ymxpc2hcbn1cblxuLyoqXG4gKiBCdWlsZHMgb25lIHB1Ymxpc2hlZCByZXNvdXJjZSBjb25maWcgZnJvbSBhIG1vZGVsJ3MgYHN0YXRpYyBzeW5jYCBwdWJsaXNoXG4gKiBkZWNsYXJhdGlvbi4gYHB1Ymxpc2g6IHRydWVgIG9wdHMgaW4gd2l0aCBhbGwgZGVmYXVsdHMgKGF0dHJpYnV0ZSBwYXlsb2FkLFxuICogZGVyaXZlZCBzY29wZSBwYXJ0aXRpb24sIGNyZWF0ZWQvdXBkYXRlZCBvcGVyYXRpb25zKS5cbiAqIEBwYXJhbSB7e21vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwdWJsaXNoOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb24gfCBudWxsLCBzY29wZUF0dHJpYnV0ZXM6IHN0cmluZ1tdIHwgbnVsbCwgc3luY01vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBEZWNsYXJhdGlvbiBhcmdzIHBsdXMgdGhlIHN5bmMgbW9kZWwncyBkZWNsYXJlZCBzY29wZSBhdHRyaWJ1dGVzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclJlc291cmNlQ29uZmlnfSBEZXJpdmVkIHJlc291cmNlIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gcmVzb3VyY2VDb25maWdGcm9tUHVibGlzaERlY2xhcmF0aW9uKHttb2RlbENsYXNzLCBwdWJsaXNoLCBzY29wZUF0dHJpYnV0ZXM6IHN5bmNTY29wZUF0dHJpYnV0ZXMsIHN5bmNNb2RlbH0pIHtcbiAgY29uc3QgbW9kZWxOYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICBjb25zdCBub3JtYWxpemVkUHVibGlzaCA9IHB1Ymxpc2ggPT09IHRydWUgPyB7fSA6IHB1Ymxpc2hcblxuICBpZiAoIW5vcm1hbGl6ZWRQdWJsaXNoIHx8IHR5cGVvZiBub3JtYWxpemVkUHVibGlzaCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG5vcm1hbGl6ZWRQdWJsaXNoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggbXVzdCBiZSB0cnVlLCBmYWxzZSBvciBhIHB1Ymxpc2ggZGVjbGFyYXRpb24gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHB1Ymxpc2gpfWApXG4gIH1cblxuICBjb25zdCB7YnJvYWRjYXN0cywgZXZlbnRJZCwgb3BlcmF0aW9ucywgcmVzb3VyY2VUeXBlLCBzY29wZUF0dHJpYnV0ZXMsIHNlcmlhbGl6ZSwgLi4ucmVzdERlY2xhcmF0aW9ufSA9IG5vcm1hbGl6ZWRQdWJsaXNoXG4gIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMocmVzdERlY2xhcmF0aW9uKVxuXG4gIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBicm9hZGNhc3RzLCBldmVudElkIChkZXByZWNhdGVkKSwgb3BlcmF0aW9ucywgcmVzb3VyY2VUeXBlLCBzY29wZUF0dHJpYnV0ZXMsIHNlcmlhbGl6ZSlgKVxuICB9XG4gIGlmIChzZXJpYWxpemUgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc2VyaWFsaXplICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIHNlcmlhbGl6ZSBtdXN0IGJlIGEgZnVuY3Rpb24gYnVpbGRpbmcgdGhlIHB1Ymxpc2hlZCBwYXlsb2FkLCBnb3Q6ICR7U3RyaW5nKHNlcmlhbGl6ZSl9YClcbiAgfVxuICBpZiAob3BlcmF0aW9ucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9wZXJhdGlvbnMpIHx8IG9wZXJhdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIG9wZXJhdGlvbnMgbXVzdCBiZSBhIG5vbi1lbXB0eSBhcnJheSBvZiBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3lgKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgIGlmICghKG9wZXJhdGlvbiBpbiBQVUJMSVNIRURfQ0FMTEJBQ0tfTkFNRVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggb3BlcmF0aW9ucyBtdXN0IGJlIGNyZWF0ZS91cGRhdGUvZGVzdHJveSwgZ290OiAke1N0cmluZyhvcGVyYXRpb24pfWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3Qgc2NvcGVQbGFuID0gc2NvcGVQbGFuRm9yKHtldmVudElkLCBtb2RlbENsYXNzLCBtb2RlbE5hbWUsIHNjb3BlQXR0cmlidXRlcywgc3luY01vZGVsLCBzeW5jU2NvcGVBdHRyaWJ1dGVzfSlcblxuICByZXR1cm4ge1xuICAgIGJyb2FkY2FzdHMsXG4gICAgbW9kZWxDbGFzcyxcbiAgICBvcGVyYXRpb25zOiBvcGVyYXRpb25zID09PSB1bmRlZmluZWQgPyBERUZBVUxUX1BVQkxJU0hFRF9PUEVSQVRJT05TIDogb3BlcmF0aW9ucyxcbiAgICByZXNvdXJjZVR5cGU6IHJlc291cmNlVHlwZSA9PT0gdW5kZWZpbmVkID8gbW9kZWxOYW1lIDogcmVzb3VyY2VUeXBlLFxuICAgIHNjb3BlQXR0cmlidXRlc1Jlc29sdmVyOiB0eXBlb2Ygc2NvcGVBdHRyaWJ1dGVzID09PSBcImZ1bmN0aW9uXCIgPyBzY29wZUF0dHJpYnV0ZXMgOiB1bmRlZmluZWQsXG4gICAgc2NvcGVQbGFuLFxuICAgIHNlcmlhbGl6ZTogc2VyaWFsaXplID09PSB1bmRlZmluZWQgPyBkZWZhdWx0U2VyaWFsaXplZEF0dHJpYnV0ZXMgOiBzZXJpYWxpemVcbiAgfVxufVxuXG4vKipcbiAqIERlcml2ZXMgdGhlIHNjb3BlIHBsYW4gcGFydGl0aW9uaW5nIGEgcHVibGlzaGVkIG1vZGVsJ3MgY2hhbmdlczogb25lIGVudHJ5XG4gKiBwZXIgc2NvcGUgYXR0cmlidXRlIGRlY2xhcmVkIG9uIHRoZSBzeW5jIG1vZGVsIChgc3RhdGljXG4gKiBzeW5jU2NvcGVBdHRyaWJ1dGVzYCksIGVhY2ggcmVhZGluZyB0aGUgcmVjb3JkIGF0dHJpYnV0ZSBuYW1lZCBsaWtlIHRoZVxuICogc2NvcGUgYXR0cmlidXRlIChvdmVycmlkYWJsZSB0aHJvdWdoIHRoZSBkZWNsYXJhdGlvbidzIGBzY29wZUF0dHJpYnV0ZXNgXG4gKiBuYW1lIG1hcCksIG9yIHRoZSByZWNvcmQncyBvd24gaWQgd2hlbiB0aGUgbW9kZWwgaGFzIG5vIHN1Y2ggYXR0cmlidXRlXG4gKiAoc2NvcGUtcm9vdCBtb2RlbHMpLiBUaGUgZGVwcmVjYXRlZCBgZXZlbnRJZGAgZGVjbGFyYXRpb24gZm9ybXMgbWFwIHRvIGFcbiAqIGZpeGVkIGBldmVudElkYC9gZXZlbnRfaWRgIHBsYW4gZm9yIDEuMC41MDMgY29tcGF0aWJpbGl0eS5cbiAqIEBwYXJhbSB7e2V2ZW50SWQ6IGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hEZWNsYXJhdGlvbkNvbmZpZ1tcImV2ZW50SWRcIl0sIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtb2RlbE5hbWU6IHN0cmluZywgc2NvcGVBdHRyaWJ1dGVzOiBpbXBvcnQoXCIuL3N5bmMtcHVibGlzaGVyLXR5cGVzLmpzXCIpLlN5bmNQdWJsaXNoRGVjbGFyYXRpb25Db25maWdbXCJzY29wZUF0dHJpYnV0ZXNcIl0sIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHN5bmNTY29wZUF0dHJpYnV0ZXM6IHN0cmluZ1tdIHwgbnVsbH19IGFyZ3MgLSBEZWNsYXJhdGlvbiBhbmQgc3luYy1tb2RlbCBzY29wZSBhcmdzLlxuICogQHJldHVybnMge0FycmF5PGltcG9ydChcIi4vc3luYy1wdWJsaXNoZXItdHlwZXMuanNcIikuU3luY1B1Ymxpc2hlclNjb3BlUGxhbkVudHJ5Pn0gRGVyaXZlZCBzY29wZSBwbGFuLlxuICovXG5mdW5jdGlvbiBzY29wZVBsYW5Gb3Ioe2V2ZW50SWQsIG1vZGVsQ2xhc3MsIG1vZGVsTmFtZSwgc2NvcGVBdHRyaWJ1dGVzLCBzeW5jTW9kZWwsIHN5bmNTY29wZUF0dHJpYnV0ZXN9KSB7XG4gIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKSlcblxuICBpZiAoZXZlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxOYW1lfSBzdGF0aWMgc3luYyBwdWJsaXNoIGNhbid0IGRlY2xhcmUgYm90aCBzY29wZUF0dHJpYnV0ZXMgYW5kIHRoZSBkZXByZWNhdGVkIGV2ZW50SWQgZm9ybWApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZXZlbnRJZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gW3tjb2x1bW5OYW1lOiBcImV2ZW50X2lkXCIsIHJlY29yZEF0dHJpYnV0ZTogbnVsbCwgcmVzb2x2ZXI6IGV2ZW50SWQsIHNjb3BlQXR0cmlidXRlOiBcImV2ZW50SWRcIn1dXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZXZlbnRJZCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBldmVudElkIG11c3QgYmUgYW4gYXR0cmlidXRlLW5hbWUgc3RyaW5nIChvciBhIGRlcHJlY2F0ZWQgcmVzb2x2ZXIgZnVuY3Rpb24pLCBnb3Q6ICR7U3RyaW5nKGV2ZW50SWQpfWApXG4gICAgfVxuICAgIGlmICghYXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoZXZlbnRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbE5hbWV9IHN0YXRpYyBzeW5jIHB1Ymxpc2ggZXZlbnRJZCBhdHRyaWJ1dGUgZG9lc24ndCBleGlzdCBvbiB0aGUgbW9kZWw6ICR7ZXZlbnRJZH1gKVxuICAgIH1cblxuICAgIHJldHVybiBbe2NvbHVtbk5hbWU6IFwiZXZlbnRfaWRcIiwgcmVjb3JkQXR0cmlidXRlOiBldmVudElkLCByZXNvbHZlcjogdW5kZWZpbmVkLCBzY29wZUF0dHJpYnV0ZTogXCJldmVudElkXCJ9XVxuICB9XG5cbiAgaWYgKHNjb3BlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkICYmICFzeW5jU2NvcGVBdHRyaWJ1dGVzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBkZWNsYXJlcyBzY29wZUF0dHJpYnV0ZXMgYnV0IHRoZSBzeW5jIG1vZGVsIGRlY2xhcmVzIG5vIHN0YXRpYyBzeW5jU2NvcGVBdHRyaWJ1dGVzYClcbiAgfVxuXG4gIGlmICghc3luY1Njb3BlQXR0cmlidXRlcykgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzY29wZUF0dHJpYnV0ZXMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHJldHVybiBzeW5jU2NvcGVBdHRyaWJ1dGVzLm1hcCgoc2NvcGVBdHRyaWJ1dGUpID0+ICh7XG4gICAgICBjb2x1bW5OYW1lOiBzeW5jU2NvcGVDb2x1bW5OYW1lKHtzY29wZUF0dHJpYnV0ZSwgc3luY01vZGVsfSksXG4gICAgICByZWNvcmRBdHRyaWJ1dGU6IG51bGwsXG4gICAgICByZXNvbHZlcjogdW5kZWZpbmVkLFxuICAgICAgc2NvcGVBdHRyaWJ1dGVcbiAgICB9KSlcbiAgfVxuXG4gIGlmIChzY29wZUF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHNjb3BlQXR0cmlidXRlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNjb3BlQXR0cmlidXRlcykpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QgbWFwcGluZyBzY29wZSBhdHRyaWJ1dGVzIHRvIHJlY29yZCBhdHRyaWJ1dGUgbmFtZXMsIGdvdDogJHtTdHJpbmcoc2NvcGVBdHRyaWJ1dGVzKX1gKVxuICB9XG5cbiAgZm9yIChjb25zdCBzY29wZUF0dHJpYnV0ZSBvZiBPYmplY3Qua2V5cyhzY29wZUF0dHJpYnV0ZXMgfHwge30pKSB7XG4gICAgaWYgKCFzeW5jU2NvcGVBdHRyaWJ1dGVzLmluY2x1ZGVzKHNjb3BlQXR0cmlidXRlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMgcmVjZWl2ZWQgdW5rbm93biBzY29wZSBhdHRyaWJ1dGU6ICR7c2NvcGVBdHRyaWJ1dGV9ICh0aGUgc3luYyBtb2RlbCBkZWNsYXJlczogJHtzeW5jU2NvcGVBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX0pYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc3luY1Njb3BlQXR0cmlidXRlcy5tYXAoKHNjb3BlQXR0cmlidXRlKSA9PiB7XG4gICAgY29uc3QgZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUgPSBzY29wZUF0dHJpYnV0ZXM/LltzY29wZUF0dHJpYnV0ZV1cblxuICAgIGlmIChkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAodHlwZW9mIGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlICE9PSBcInN0cmluZ1wiIHx8ICFhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhkZWNsYXJlZFJlY29yZEF0dHJpYnV0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke21vZGVsTmFtZX0gc3RhdGljIHN5bmMgcHVibGlzaCBzY29wZUF0dHJpYnV0ZXMuJHtzY29wZUF0dHJpYnV0ZX0gbXVzdCBuYW1lIGFuIGV4aXN0aW5nIHJlY29yZCBhdHRyaWJ1dGUsIGdvdDogJHtTdHJpbmcoZGVjbGFyZWRSZWNvcmRBdHRyaWJ1dGUpfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Y29sdW1uTmFtZTogc3luY1Njb3BlQ29sdW1uTmFtZSh7c2NvcGVBdHRyaWJ1dGUsIHN5bmNNb2RlbH0pLCByZWNvcmRBdHRyaWJ1dGU6IGRlY2xhcmVkUmVjb3JkQXR0cmlidXRlLCByZXNvbHZlcjogdW5kZWZpbmVkLCBzY29wZUF0dHJpYnV0ZX1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29sdW1uTmFtZTogc3luY1Njb3BlQ29sdW1uTmFtZSh7c2NvcGVBdHRyaWJ1dGUsIHN5bmNNb2RlbH0pLFxuICAgICAgcmVjb3JkQXR0cmlidXRlOiBhdHRyaWJ1dGVOYW1lcy5pbmNsdWRlcyhzY29wZUF0dHJpYnV0ZSkgPyBzY29wZUF0dHJpYnV0ZSA6IG51bGwsXG4gICAgICByZXNvbHZlcjogdW5kZWZpbmVkLFxuICAgICAgc2NvcGVBdHRyaWJ1dGVcbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHRoYXQgYSBjb21wdXRlZCBkZWNsYXJhdGlvbiByZXR1cm5lZCBhbiBvcmRpbmFyeSBrZXkvdmFsdWUgb2JqZWN0LlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJlc29sdmVyIHJlc3VsdC5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSBwbGFpbiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICByZXR1cm4gcHJvdG90eXBlID09PSBPYmplY3QucHJvdG90eXBlIHx8IHByb3RvdHlwZSA9PT0gbnVsbFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBzeW5jLXJvdyBjb2x1bW4gcGVyc2lzdGluZyBhIGRlY2xhcmVkIHNjb3BlIGF0dHJpYnV0ZS5cbiAqIEBwYXJhbSB7e3Njb3BlQXR0cmlidXRlOiBzdHJpbmcsIHN5bmNNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gU2NvcGUgYXR0cmlidXRlIGFuZCBzeW5jIG1vZGVsLlxuICogQHJldHVybnMge3N0cmluZ30gU3luYy1yb3cgY29sdW1uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHN5bmNTY29wZUNvbHVtbk5hbWUoe3Njb3BlQXR0cmlidXRlLCBzeW5jTW9kZWx9KSB7XG4gIGNvbnN0IGNvbHVtbk5hbWUgPSBzeW5jTW9kZWwuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Njb3BlQXR0cmlidXRlXVxuXG4gIGlmICghY29sdW1uTmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtzeW5jTW9kZWwubmFtZX0gZGVjbGFyZXMgdGhlIHN5bmMgc2NvcGUgYXR0cmlidXRlICR7c2NvcGVBdHRyaWJ1dGV9IGJ1dCBoYXMgbm8gbWF0Y2hpbmcgY29sdW1uIGZvciBpdGApXG4gIH1cblxuICByZXR1cm4gY29sdW1uTmFtZVxufVxuXG4vKipcbiAqIERlZmF1bHQgcHVibGlzaCBzZXJpYWxpemVyOiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcyB3aXRoIERhdGUgdmFsdWVzXG4gKiBzZXJpYWxpemVkIHRvIElTTyBzdHJpbmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTXV0YXRlZCBzZXJ2ZXIgbW9kZWwgcmVjb3JkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU2VyaWFsaXplZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRTZXJpYWxpemVkQXR0cmlidXRlcyhyZWNvcmQpIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSB7Li4ucmVjb3JkLmF0dHJpYnV0ZXMoKX1cblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWUudG9JU09TdHJpbmcoKVxuICB9XG5cbiAgcmV0dXJuIGF0dHJpYnV0ZXNcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGRhdGUtbGlrZSB2YWx1ZSB0byBhbiBJU08gc3RyaW5nLCBtYXRjaGluZyB0aGUgY2hhbmdlLWZlZWRcbiAqIHNlcmlhbGl6ZXIncyBjb252ZW50aW9uIGZvciB0aGUgc3luYyBlbnRyeSdzIHB1YmxpYyB1cGRhdGVkLWF0IG1ldGFkYXRhLlxuICogQHBhcmFtIHtEYXRlIHwgbnVsbH0gdmFsdWUgLSBQZXJzaXN0ZWQgdXBkYXRlZC1hdCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IElTTyBkYXRlLlxuICogQHRocm93cyB7RXJyb3J9IFdoZW4gdGhlIHBlcnNpc3RlZCByb3cgaGFzIG5vIHZhbGlkIHVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICovXG5mdW5jdGlvbiBpc29EYXRlKHZhbHVlKSB7XG4gIGlmICghKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKHZhbHVlLmdldFRpbWUoKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJQdWJsaXNoZWQgc3luYyByb3cgbXVzdCBoYXZlIGEgdmFsaWQgdXBkYXRlZEF0IHRpbWVzdGFtcC5cIilcbiAgfVxuXG4gIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG59XG4iXX0=