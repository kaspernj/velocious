// @ts-check
import Configuration from "../configuration.js";
import { isBooleanColumnType } from "../database/column-types.js";
import Logger from "../logger.js";
import { captureRemoteRequestContext, mergeRemoteRequestContext } from "../remote-request-context.js";
import { scalarModelPrimaryKey } from "../utils/model-primary-key.js";
import restArgsError from "../utils/rest-args-error.js";
import VelociousWebsocketClient from "../http-client/websocket-client.js";
import { serializedScopeFromQuery } from "./query-scope.js";
import SyncApiClient from "./sync-api-client.js";
import SyncRealtimeBridge from "./sync-realtime-bridge.js";
import SyncScopeStore from "./sync-scope-store.js";
import { currentSyncClient, setCurrentSyncClient } from "./sync-client-registry.js";
let clientCounter = 0;
/** @type {{create: "afterCreate", update: "afterUpdate", destroy: "afterDestroy"}} */
const TRACKED_CALLBACK_NAMES = { create: "afterCreate", destroy: "afterDestroy", update: "afterUpdate" };
/**
 * Operations tracked by default for models declaring `static sync` without a
 * `track` key: local creates and updates queue automatically. Destroys are not
 * tracked by default because a local destroy is often cache eviction rather
 * than a server delete; opt in with `track: true` or an operations list.
 * @type {Array<"create" | "update" | "destroy">} */
const DEFAULT_TRACKED_OPERATIONS = ["create", "update"];
/** Attribute names treated as client-local sync bookkeeping when deriving localOnlyAttributes. */
const LOCAL_BOOKKEEPING_ATTRIBUTE_NAMES = ["createdAt", "updatedAt", "lastSyncChangeAt"];
const SYNC_REQUEST_RESERVED_KEYS = [
    "afterId",
    "afterServerSequence",
    "afterUpdatedAt",
    "authenticationToken",
    "limit",
    "scope",
    "syncs",
    "upstreamRefresh",
    "upToId",
    "upToServerSequence",
    "upToUpdatedAt"
];
/** @type {WeakMap<Configuration, SyncClient>} */
const syncClientsByConfiguration = new WeakMap();
/**
 * Declarative client-side sync driver.
 *
 * Everything is derived from the app's Velocious configuration: models declare
 * `static sync`, transport/auth/connectivity come from the `sync.client`
 * configuration block, and Velocious owns scope persistence, per-scope cursors,
 * pull paging/apply, local queueing, and online-gated replay. Declare sync
 * interest from queries:
 *
 *     await syncClient().start()
 *     await syncClient().sync(Event.where({partnerId}))
 */
export default class SyncClient {
    /**
     * Builds the sync client by deriving everything from the app's Velocious
     * configuration: every registered model declaring `static sync` becomes a
     * resource with booleanAttributes derived from column types and
     * localOnlyAttributes derived from the primary key, createdAt/updatedAt, and
     * sync bookkeeping columns; the pending-sync model is the registered "Sync"
     * model; transport, auth, connectivity, and error reporting come from the
     * `sync.client` configuration block, with the framework owning the
     * `${mountPath}/changes` and `${mountPath}/replay` POSTers.
     * @param {import("./sync-client-types.js").SyncClientOptions} [options] - Optional overrides.
     */
    constructor(options = {}) {
        const { configuration = Configuration.current(), databaseIdentifier, legacyCursor, requestContext, scopeStore, syncModel, tenantHandle, ...restOptions } = options;
        restArgsError(restOptions);
        const clientConfiguration = configuration.getSyncConfiguration().client;
        const capturedRequestContext = captureRemoteRequestContext(requestContext, {
            label: "Sync client request context",
            reservedKeys: SYNC_REQUEST_RESERVED_KEYS
        });
        if (!clientConfiguration) {
            throw new Error("SyncClient requires a sync.client configuration block: new Configuration({sync: {client: {authenticationToken, transport}}})");
        }
        if (Boolean(tenantHandle) !== Boolean(databaseIdentifier)) {
            throw new Error("SyncClient tenantHandle and databaseIdentifier must be provided together");
        }
        if (tenantHandle) {
            tenantHandle.assertConfiguration(configuration);
            tenantHandle.databaseConfiguration(/** @type {string} */ (databaseIdentifier));
        }
        const modelClasses = configuration.getModelClasses();
        const resolvedSyncModel = syncModel || modelClasses.Sync;
        const databaseIdentity = tenantHandle ? tenantHandle.databaseIdentity(/** @type {string} */ (databaseIdentifier)) : null;
        /** @type {Record<string, import("./sync-client-types.js").SyncClientResourceConfig>} */
        const resources = {};
        for (const modelClass of Object.values(modelClasses)) {
            if (!modelClass.sync)
                continue;
            if (tenantHandle && modelClass.getDatabaseIdentifier({ tenant: tenantHandle.tenant() }) !== databaseIdentifier)
                continue;
            const resourceType = modelClass.getModelName();
            const metadataModelClass = tenantHandle
                ? tenantHandle.metadataModelClass({ databaseIdentifier: /** @type {string} */ (databaseIdentifier), modelClass })
                : modelClass;
            const resourceConfig = resourceConfigFromSyncDeclaration({ declaration: modelClass.sync, metadataModelClass, modelClass, resourceType });
            if (databaseIdentity && resourceConfig.conflictTracking) {
                resourceConfig.conflictTracking = {
                    ...resourceConfig.conflictTracking,
                    mutationLog: resourceConfig.conflictTracking.mutationLog.partition(databaseIdentity)
                };
            }
            resources[resourceType] = resourceConfig;
        }
        if (Object.keys(resources).length === 0) {
            throw new Error("SyncClient found no registered models declaring static sync - declare `static sync = true` (or a sync declaration object) on the models that should sync");
        }
        if (!resolvedSyncModel) {
            throw new Error("SyncClient requires a registered \"Sync\" model for pending local sync rows (or pass options.syncModel)");
        }
        if (tenantHandle && resolvedSyncModel.getDatabaseIdentifier({ tenant: tenantHandle.tenant() }) !== databaseIdentifier) {
            throw new Error(`SyncClient sync model does not use tenant database ${JSON.stringify(databaseIdentifier)}`);
        }
        /** @type {import("./sync-client-types.js").SyncClientConfig} */
        this.config = {
            authenticationToken: clientConfiguration.authenticationToken,
            batchSize: clientConfiguration.batchSize,
            configuration,
            databaseIdentifier,
            isOnline: clientConfiguration.isOnline,
            legacyCursor,
            onError: clientConfiguration.onError,
            postChanges: transportPoster({ path: `${clientConfiguration.mountPath}/changes`, requestContext: capturedRequestContext, transport: clientConfiguration.transport }),
            postReplay: transportPoster({ path: `${clientConfiguration.mountPath}/replay`, requestContext: capturedRequestContext, transport: clientConfiguration.transport }),
            realtime: clientConfiguration.realtime,
            requestContext: capturedRequestContext,
            resources,
            syncModel: resolvedSyncModel,
            tenantHandle,
            websocketClient: clientConfiguration.websocketClient,
            websocketUrl: clientConfiguration.websocketUrl
        };
        this._clientNumber = ++clientCounter;
        this._databaseIdentity = databaseIdentity;
        this._tenantSchemaGeneration = tenantHandle
            ? tenantHandle.inspect({ databaseIdentifier: /** @type {string} */ (databaseIdentifier) }).schemaGeneration
            : null;
        /** @type {SyncRealtimeBridge | null} */
        this._realtimeBridge = null;
        /** @type {import("./sync-client-types.js").SyncClientSharedConnection | null | undefined} Shared app-lifetime websocket connection (undefined until first resolved, null when none is configured). */
        this._syncConnection = undefined;
        /** @type {Promise<void> | null} */
        this._subscribeUserScopePromise = null;
        /** @type {"subscribed" | "subscribing" | "unsubscribed"} */
        this._userScopeState = "unsubscribed";
        /** @type {import("./sync-scope-store.js").default | null} */
        this._scopeStore = scopeStore || null;
        /** @type {Promise<void> | null} */
        this._scheduledReplay = null;
        /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig> | null} */
        this._pullResourceConfigs = null;
        /** @type {Array<{callback: (record: ReturnType<typeof JSON.parse>) => Promise<void> | void, callbackName: "afterCreate" | "afterUpdate" | "afterDestroy" | "beforeUpdate" | "beforeDestroy", modelClass: ReturnType<typeof JSON.parse>}>} */
        this._trackedCallbacks = [];
        /** @type {WeakSet<object>} */
        this._remoteApplyRecords = new WeakSet();
        /** @type {Map<string, number>} */
        this._remoteGenerations = new Map();
        /** @type {WeakMap<object, Array<string | number | null>>} */
        this._capturedBaseVersions = new WeakMap();
        this._withoutTrackingDepth = 0;
        /** @type {Logger | {error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} | null} */
        this._logger = null;
        this._started = false;
    }
    /**
     * Registers automatic mutation tracking for every declared resource (on by
     * default: local creates and updates queue pending sync rows once their
     * transaction commits and schedule an immediate replay attempt, without
     * app-side queue calls). `track: false` resources are skipped; `track: true`
     * adds destroys; an operations list narrows the tracked operations.
     * @returns {Promise<void>}
     */
    async start() {
        this.assertTenantReady();
        if (this._started)
            return;
        this._started = true;
        for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
            const operations = this.trackedOperations({ resourceConfig, resourceType });
            if (resourceConfig.conflictTracking) {
                for (const operation of operations.filter((candidate) => candidate !== "create")) {
                    const callbackName = operation === "destroy" ? "beforeDestroy" : "beforeUpdate";
                    const callback = (/** @type {ReturnType<typeof JSON.parse>} */ record) => {
                        if (!this.ownsRecord(record))
                            return;
                        if (this.isTrackingSuppressed(record))
                            return;
                        const capturedVersions = this._capturedBaseVersions.get(record) || [];
                        capturedVersions.push(this.preMutationBaseVersionFor({ operation, record, resourceConfig }));
                        this._capturedBaseVersions.set(record, capturedVersions);
                    };
                    resourceConfig.modelClass[callbackName](callback);
                    this._trackedCallbacks.push({ callback, callbackName, modelClass: resourceConfig.modelClass });
                }
            }
            for (const operation of operations) {
                const callbackName = TRACKED_CALLBACK_NAMES[operation];
                const callback = this.trackedMutationCallback({ operation, resourceConfig });
                resourceConfig.modelClass[callbackName](callback);
                this._trackedCallbacks.push({ callback, callbackName, modelClass: resourceConfig.modelClass });
            }
        }
    }
    /**
     * Unregisters all tracking callbacks (tests, sign-out, hot reload).
     * @returns {void}
     */
    stop() {
        for (const { callback, callbackName, modelClass } of this._trackedCallbacks) {
            modelClass.unregisterLifecycleCallback(callbackName, callback);
        }
        this._trackedCallbacks = [];
        this._started = false;
    }
    /**
     * Resolves and validates the tracked operations for a resource config.
     * Tracking is on by default: models declaring `static sync` without a `track`
     * key queue local creates and updates automatically; `track: false` opts a
     * model out (for models written by non-user flows).
     * @param {{resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig, resourceType: string}} args - Resource config and name.
     * @returns {Array<"create" | "update" | "destroy">} Tracked operations.
     */
    trackedOperations({ resourceConfig, resourceType }) {
        const track = resourceConfig.track;
        if (track === false)
            return [];
        if (track === undefined)
            return DEFAULT_TRACKED_OPERATIONS;
        if (track === true)
            return ["create", "update", "destroy"];
        if (!track || typeof track !== "object" || !Array.isArray(track.operations) || track.operations.length === 0) {
            throw new Error(`SyncClient resource ${resourceType} track must be true or {operations: [...]}`);
        }
        for (const operation of track.operations) {
            if (!(operation in TRACKED_CALLBACK_NAMES)) {
                throw new Error(`SyncClient resource ${resourceType} track.operations must be create/update/destroy, got: ${String(operation)}`);
            }
        }
        return track.operations;
    }
    /**
     * Builds the lifecycle callback queueing one tracked mutation. The queued
     * payload and sync type are snapshotted at mutation-callback time, so
     * afterSave hooks assigning unsaved attributes (or any later drift on the
     * record) cannot change what gets queued vs what was committed. Queueing is
     * deferred through the model connection's afterCommit hook so it only runs
     * once the mutation's transaction has committed (immediately when no
     * transaction is open) - queued syncs never reference rolled-back rows.
     * Post-commit queue failures are reported without rethrowing into the
     * driver's afterCommit chain (see reportAfterCommitError).
     * @param {{operation: "create" | "update" | "destroy", resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Operation and resource config.
     * @returns {(record: ReturnType<typeof JSON.parse>) => Promise<void>} Lifecycle callback.
     */
    trackedMutationCallback({ operation, resourceConfig }) {
        return async (record) => {
            if (!this.ownsRecord(record))
                return;
            if (this.isTrackingSuppressed(record))
                return;
            const data = SyncApiClient.queuedSyncData({
                booleanAttributes: resourceConfig.booleanAttributes || [],
                data: resourceConfig.trackedData ? resourceConfig.trackedData({ operation, record }) : undefined,
                localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
                resource: record
            });
            const syncType = this.defaultSyncType({ operation, record, resourceConfig });
            const baseVersion = resourceConfig.conflictTracking
                ? this.capturedBaseVersionFor({ operation, record, resourceConfig })
                : null;
            const databaseOperation = record.databaseOperation();
            const operationScope = databaseOperation
                ? databaseOperation.forModel(this.config.syncModel)
                : this.config.syncModel;
            await record.connection().afterCommit(async () => {
                try {
                    if (resourceConfig.conflictTracking) {
                        await SyncApiClient.queueConflictTrackedSync({
                            baseVersion,
                            conflictTracking: resourceConfig.conflictTracking,
                            data,
                            operation,
                            resource: record,
                            resourceType: record.constructor.getModelName(),
                            syncType
                        });
                    }
                    else {
                        await SyncApiClient.queueLocalSync({ data, resource: record, syncModel: operationScope, syncType });
                    }
                }
                catch (error) {
                    await this.reportAfterCommitError(/** @type {Error} */ (error));
                    return;
                }
                this.scheduleReplay();
            });
        };
    }
    /**
     * Reports a post-commit tracked-queueing failure. The transaction has already
     * committed when afterCommit callbacks run, so rethrowing here would poison
     * the driver's awaited afterCommit chain (breaking unrelated callbacks) -
     * instead the failure goes to the configured sync.client.onError hook, or is
     * logged loudly through the client's logger when none is configured.
     * @param {Error} error - Post-commit queueing failure.
     * @returns {Promise<void>}
     */
    async reportAfterCommitError(error) {
        if (this.config.onError) {
            this.config.onError(error);
            return;
        }
        await this.logger().error("SyncClient failed to queue a tracked mutation after commit", error);
    }
    /**
     * Returns the lazily built client logger.
     * @returns {Logger | {error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>}} Client logger.
     */
    logger() {
        this._logger ||= new Logger("SyncClient", { configuration: this.config.configuration });
        return this._logger;
    }
    /**
     * Whether a record is currently being written by pull-apply (echo suppression).
     * @param {ReturnType<typeof JSON.parse>} record - Local model record.
     * @returns {boolean} Whether the record write originates from a remote change.
     */
    isRemoteApply(record) {
        return this._remoteApplyRecords.has(record);
    }
    /**
     * Whether tracked mutation queueing is currently suppressed for a record:
     * either the record was marked as a remote apply (`markRemoteApply`, used by
     * pull and realtime applies) or a `withoutTracking` callback is running on
     * this client.
     * @param {ReturnType<typeof JSON.parse>} record - Local model record.
     * @returns {boolean} Whether tracked queueing is suppressed for the record.
     */
    isTrackingSuppressed(record) {
        return this._withoutTrackingDepth > 0 || this.isRemoteApply(record);
    }
    /**
     * Runs a callback with tracked mutation queueing suppressed on this client -
     * for code applying server-originated data outside the derived pull/realtime
     * appliers (legacy pull paths, importers, sign-in backfills), so their writes
     * are not echoed back to the server as device changes. Suppression covers the
     * whole async duration of the callback (nested calls stack) and is
     * client-wide while it runs: mutations from concurrently running tasks are
     * also suppressed for that window, so prefer `markRemoteApply(record)` when
     * writes from other flows can interleave.
     * @template T
     * @param {() => Promise<T> | T} callback - Work whose model writes should not queue tracked syncs.
     * @returns {Promise<T>} The callback result.
     */
    async withoutTracking(callback) {
        this._withoutTrackingDepth++;
        try {
            return await callback();
        }
        finally {
            this._withoutTrackingDepth--;
        }
    }
    /**
     * Marks one record as being written from server-originated data so tracked
     * mutation queueing skips it (record-precise suppression). The derived pull
     * and realtime appliers use this internally around every applied write.
     * @param {ReturnType<typeof JSON.parse>} record - Local model record about to be written.
     * @returns {() => void} Release callback re-enabling tracking for the record.
     */
    markRemoteApply(record) {
        this._remoteApplyRecords.add(record);
        return () => this._remoteApplyRecords.delete(record);
    }
    /**
     * Registers this client as the app's current sync client.
     * @returns {void}
     */
    setCurrent() {
        setCurrentSyncClient(this);
    }
    /**
     * Returns the app's current sync client.
     * @returns {SyncClient} Current sync client.
     */
    static current() {
        return /** @type {SyncClient} */ (currentSyncClient());
    }
    /**
     * Builds a sync client derived from the given configuration. Alias for
     * `new SyncClient({configuration, ...options})`.
     * @param {Configuration} [configuration] - Configuration owning the registered models and the sync.client block. Defaults to the current configuration.
     * @param {Omit<import("./sync-client-types.js").SyncClientOptions, "configuration">} [options] - Optional overrides.
     * @returns {SyncClient} Sync client derived from the configuration.
     */
    static fromConfiguration(configuration = Configuration.current(), options = {}) {
        return new SyncClient({ ...options, configuration });
    }
    /**
     * Declares (or re-activates) a sync scope from a model query and pulls it when online.
     * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query declaring the sync scope.
     * @param {object} [options] - Sync options.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [options.onProgress] - Called per applied page of the pull this declaration triggers, so the initial import of a newly declared scope can drive a "syncedCount of total" progress bar. See `pull()`.
     * @param {boolean} [options.upstreamRefresh] - Marks the changes request(s) as a user-initiated refresh, so the server can bypass upstream-import throttle windows. See `pull()`.
     * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result (null while offline).
     */
    async sync(query, { onProgress, upstreamRefresh } = {}) {
        this.assertQueryOwnership(query);
        const scope = serializedScopeFromQuery(query);
        const scopeStore = this.scopeStore();
        const scopeRow = await scopeStore.findOrCreateScope(scope);
        if (!scopeRow.cursorPayload && this.config.legacyCursor) {
            const legacyCursorPayload = await this.config.legacyCursor({ scope });
            const legacyCursor = SyncApiClient.syncCursorFromPayload(legacyCursorPayload);
            if (legacyCursor)
                await scopeStore.saveCursor(scopeRow, legacyCursor);
        }
        return { pulled: await this.pull({ onProgress, upstreamRefresh }), scope };
    }
    /**
     * Deactivates the sync scope declared by a model query.
     * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query whose scope should stop syncing.
     * @returns {Promise<void>}
     */
    async unsync(query) {
        this.assertQueryOwnership(query);
        await this.scopeStore().deactivate(serializedScopeFromQuery(query));
    }
    /**
     * Pulls changes for every active scope with per-scope cursors (single-flighted, online-gated).
     * @param {object} [options] - Pull options.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [options.onProgress] - Called per applied page with cumulative `{pages, syncedCount, total}` across the pulled scopes, for rendering a "syncedCount of total" progress bar (e.g. a full-import screen). Optional; omitting it keeps the existing behavior.
     * @param {boolean} [options.upstreamRefresh] - Sends `upstreamRefresh: true` on the changes request(s), telling the server this pull is user-initiated so it can bypass upstream-import throttle windows (see docs/sync-upstream-imports.md). Background pulls omit it and stay throttled.
     * @returns {Promise<import("./sync-api-client-types.js").SyncChangesResult | null>} Combined pull result, or null while offline.
     */
    async pull({ onProgress, upstreamRefresh } = {}) {
        this.assertTenantReady();
        if (!(await this.isOnline()))
            return null;
        /** @type {import("./sync-api-client-types.js").SyncChangesResult | null} */
        let combinedResult = null;
        await SyncApiClient.singleFlight(`velocious-sync-client-pull-${this._clientNumber}`, async () => {
            const authenticationToken = await this.config.authenticationToken();
            const scopeStore = this.scopeStore();
            const applySync = this.remoteApplySync();
            const result = {
                changed: false,
                pages: 0,
                resourceChanged: /** @type {Record<string, boolean>} */ ({}),
                resourceCounts: /** @type {Record<string, number>} */ ({}),
                syncedCount: 0,
                total: 0
            };
            for (const scopeRow of await scopeStore.activeScopes()) {
                // Cumulate scope progress onto the counts of the scopes already pulled so a single
                // scope's per-page progress reads exactly its own counts (base 0), and multi-scope
                // pulls report a running cumulative total across every scope.
                const basePages = result.pages;
                const baseSyncedCount = result.syncedCount;
                const baseTotal = result.total;
                const scopeResult = await SyncApiClient.pullChanges({
                    applySync,
                    authenticationToken,
                    batchSize: this.config.batchSize,
                    loadCursor: async () => await scopeStore.loadCursor(scopeRow),
                    onProgress: onProgress ? (progress) => onProgress({
                        pages: basePages + progress.pages,
                        syncedCount: baseSyncedCount + progress.syncedCount,
                        total: baseTotal + progress.total
                    }) : undefined,
                    postChanges: async (payload) => await this.config.postChanges({
                        ...payload,
                        // Only the all-types scope carries the type list; a type-declared scope needs none.
                        scope: {
                            conditions: scopeRow.conditions,
                            resourceType: scopeRow.resourceType,
                            ...(scopeRow.resourceType === null ? { resourceTypes: this.userScopeResourceTypes() } : {})
                        },
                        ...(upstreamRefresh ? { upstreamRefresh: true } : {})
                    }),
                    saveCursor: async (cursor) => await scopeStore.saveCursor(scopeRow, cursor)
                });
                result.changed ||= scopeResult.changed;
                result.pages += scopeResult.pages;
                result.syncedCount += scopeResult.syncedCount;
                result.total += scopeResult.total;
                for (const [resourceType, count] of Object.entries(scopeResult.resourceCounts)) {
                    result.resourceCounts[resourceType] = (result.resourceCounts[resourceType] || 0) + count;
                }
                for (const [resourceType, changed] of Object.entries(scopeResult.resourceChanged)) {
                    result.resourceChanged[resourceType] ||= changed;
                }
            }
            combinedResult = result;
        });
        return combinedResult;
    }
    /**
     * Builds the derived remote-change applier shared by pulls and realtime pushes:
     * applies through the declared resource configs, registers each written record
     * for echo suppression (tracked resources do not re-queue applied changes), and
     * fails loudly instead of silently skipping unconfigured resources.
     * @param {{source?: string}} [args] - Error context describing where the change came from.
     * @returns {(sync: import("./sync-api-client-types.js").SyncChangeEnvelope) => Promise<import("./sync-api-client-types.js").SyncChangeApplyResult>} Loud remote-change applier.
     */
    remoteApplySync({ source = "pulled change" } = {}) {
        return async (sync) => {
            const resourceType = sync.resourceType();
            const configuredResource = resourceType ? this.config.resources[resourceType] : undefined;
            if (!resourceType || !configuredResource?.attributes) {
                throw new Error(`No sync resource with pull attributes configured for ${source}: ${String(resourceType)}`);
            }
            return await this.withTenantOperation(async (operation) => {
                const data = sync.data();
                const versionAttribute = this.config.resources[resourceType].conflictTracking?.versionAttribute;
                if (versionAttribute) {
                    const dataAttributes = data && typeof data === "object" && !Array.isArray(data)
                        ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (data)
                        : {};
                    this.noteRemoteVersion({ resourceId: String(sync.resourceId()), resourceType, version: dataAttributes[versionAttribute] });
                }
                const pullResourceConfigs = this.pullResourceConfigs(operation);
                const applier = SyncApiClient.resourceApplier(pullResourceConfigs, (record) => {
                    if (operation)
                        this.bindRemoteRecord({ operation, record });
                    return this.markRemoteApply(record);
                });
                return await applier(sync);
            });
        };
    }
    /**
     * Resolves the shared app-lifetime websocket connection all sync traffic
     * rides, or null when none is configured. Built once and memoized (per
     * client): an app-provided `sync.client.websocketClient` instance wins (the
     * frontend-model transport can pass its own client so one socket carries
     * everything), else a framework-owned reconnecting {@link VelociousWebsocketClient}
     * built from `sync.client.websocketUrl`. The realtime bridge rides this
     * connection without owning its lifecycle; when neither is configured the
     * bridge falls back to the deprecated per-cycle `realtime.createClient`.
     * @returns {import("./sync-client-types.js").SyncClientSharedConnection | null} Shared websocket connection, or null.
     */
    syncConnection() {
        if (this._syncConnection !== undefined)
            return this._syncConnection;
        if (this.config.websocketClient) {
            this._syncConnection = this.config.websocketClient;
        }
        else if (this.config.websocketUrl) {
            const url = typeof this.config.websocketUrl === "function" ? this.config.websocketUrl() : this.config.websocketUrl;
            this._syncConnection = url ? new VelociousWebsocketClient({ url }) : null;
        }
        else {
            this._syncConnection = null;
        }
        return this._syncConnection;
    }
    /**
     * Subscribes the derived realtime channels so pushed websocket changes apply
     * through the same derived applier as pulls (idempotent, single-flighted).
     * @param {ReturnType<typeof JSON.parse>} [context] - App context passed to the deprecated `sync.client.realtime.channels` callback (runtime scope values).
     * @returns {Promise<void>}
     */
    async subscribeRealtime(context) {
        this.assertTenantReady();
        await this.realtimeBridge().subscribe(context);
    }
    /**
     * Subscribes the server-enumerated user scope: "everything my ability can
     * see". Declares a user scope (empty conditions) for every pullable synced
     * resource type, subscribes realtime so their framework sync channel
     * subscriptions go live, and pulls so the device catches up. The server
     * authorizes each empty-conditions scope through the app sync resource's
     * `authorizeChanges` and re-checks record access per delivery, so the client
     * subscribes with just its token and the server decides membership.
     * Idempotent and single-flighted like {@link SyncClient#subscribeRealtime}.
     * @returns {Promise<void>}
     */
    async subscribeUserScope() {
        if (this._userScopeState === "subscribed")
            return;
        if (!this._subscribeUserScopePromise) {
            this._subscribeUserScopePromise = this._subscribeUserScope().finally(() => {
                this._subscribeUserScopePromise = null;
            });
        }
        await this._subscribeUserScopePromise;
    }
    /**
     * Declares and activates the user scope for every pullable resource, then
     * subscribes realtime and pulls.
     * @returns {Promise<void>}
     */
    async _subscribeUserScope() {
        this._userScopeState = "subscribing";
        await this.scopeStore().findOrCreateScope(await this.userScope());
        await this.subscribeRealtime();
        await this.pull();
        this._userScopeState = "subscribed";
    }
    /**
     * Unsubscribes the user scope: deactivates the per-resource user scopes and
     * closes the realtime channel subscriptions. The shared websocket connection
     * stays open when one is configured (sign-out drops subscriptions without
     * disconnecting), so a subsequent sign-in resubscribes over the same socket.
     * @returns {Promise<void>}
     */
    async unsubscribeUserScope() {
        await this.scopeStore().deactivate(await this.userScope());
        await this.unsubscribeRealtime();
        this._userScopeState = "unsubscribed";
        this._subscribeUserScopePromise = null;
    }
    /**
     * The user scope: a single all-types scope (null resourceType) with empty
     * conditions, partitioned locally by owner. One scope - not one per resource
     * type - so the server authorizes the caller once per sync and per subscribe,
     * however many resource types it serves. The server decides which types the
     * caller may see; the client applies each pulled row by the resource type on
     * its own envelope.
     * @returns {Promise<import("./sync-client-types.js").SerializedSyncScope>} The user scope.
     */
    async userScope() {
        return { conditions: {}, owner: await this.userScopeOwner(), resourceType: null };
    }
    /**
     * The resource types the user scope covers: every declared resource that
     * receives pulled changes (has pull `attributes`), so the client can apply
     * them. Sent with the scope as a delivery/type filter - it narrows, never
     * widens, what the server's authorization already allows, and it keeps a
     * broadcast of a type this client cannot apply from reaching the server's
     * per-delivery access re-check (a database query per matched broadcast, per
     * subscribed device).
     * @returns {string[]} Pullable resource type names.
     */
    userScopeResourceTypes() {
        return Object.keys(this.pullResourceConfigs());
    }
    /**
     * Resolves the local partition key for the user scope: the currently
     * configured authenticated identity (the sync auth token). Partitioning the
     * user scope's local scope/cursor rows by this owner keeps the
     * empty-conditions cursor from leaking across accounts on a shared device
     * (account B signing in after account A gets a fresh cursor) while the same
     * account reconnecting keeps its cursor continuity. The owner is a local
     * partition key only — pulls still post empty conditions to the server.
     * @returns {Promise<string>} User-scope owner partition key.
     */
    async userScopeOwner() {
        return String(await this.config.authenticationToken());
    }
    /**
     * Unsubscribes the realtime channels and disconnects the websocket client (idempotent).
     * @returns {Promise<void>}
     */
    async unsubscribeRealtime() {
        await this.realtimeBridge().unsubscribe();
    }
    /**
     * Reports the realtime subscription state and per-channel readiness.
     * @returns {ReturnType<SyncRealtimeBridge["status"]>} Realtime status.
     */
    realtimeStatus() {
        return this.realtimeBridge().status();
    }
    /**
     * Awaits all pending realtime message applies and any scheduled
     * pull-on-reconnect (useful in tests and shutdown flows).
     * @returns {Promise<void>}
     */
    async waitForRealtimeApplied() {
        await this.realtimeBridge().waitForApplied();
    }
    /**
     * Returns the lazily built realtime bridge.
     * @returns {SyncRealtimeBridge} Realtime bridge.
     */
    realtimeBridge() {
        this._realtimeBridge ||= new SyncRealtimeBridge({ syncClient: this });
        return this._realtimeBridge;
    }
    /**
     * Queues a local model change as a pending sync row and schedules an immediate
     * replay attempt (kept pending while offline or when the backend rejects it).
     * @param {{baseVersion?: string | number | null, resource: ReturnType<typeof JSON.parse>, data?: Record<string, ReturnType<typeof JSON.parse>>, operation?: "create" | "update" | "destroy", syncType?: string}} args - Queue args.
     * @returns {Promise<ReturnType<typeof JSON.parse> | import("./local-mutation-log.js").LocalMutationLogRecord>} Pending local sync row or durable conflict-tracked intent.
     */
    async queue({ baseVersion, data, operation = "update", resource, syncType }) {
        this.assertTenantReady();
        this.assertRecordOwnership(resource);
        const resourceConfig = this.resourceConfigFor(resource);
        const resolvedSyncType = syncType ?? this.defaultSyncType({ operation, record: resource, resourceConfig });
        if (resourceConfig.conflictTracking) {
            const queuedData = SyncApiClient.queuedSyncData({
                booleanAttributes: resourceConfig.booleanAttributes || [],
                data,
                localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
                resource
            });
            const record = await SyncApiClient.queueConflictTrackedSync({
                baseVersion: baseVersion === undefined ? this.baseVersionFor({ operation, record: resource, resourceConfig }) : baseVersion,
                conflictTracking: resourceConfig.conflictTracking,
                data: queuedData,
                operation,
                resource,
                resourceType: resource.constructor.getModelName(),
                syncType: resolvedSyncType
            });
            this.scheduleReplay();
            return record;
        }
        const syncRow = await this.withTenantOperation(async (databaseOperation) => await SyncApiClient.queueLocalSync({
            booleanAttributes: resourceConfig.booleanAttributes || [],
            data,
            localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
            resource,
            syncModel: databaseOperation ? databaseOperation.modelClass(this.config.syncModel) : this.config.syncModel,
            syncType: resolvedSyncType
        }));
        this.scheduleReplay();
        return syncRow;
    }
    /**
     * Drains pending local sync rows to the backend (single-flighted, online-gated).
     * Rows are only marked successful after the backend acknowledges them.
     * @returns {Promise<void>}
     */
    async replayPending() {
        this.assertTenantReady();
        if (!(await this.isOnline()))
            return;
        await SyncApiClient.singleFlight(`velocious-sync-client-replay-${this._clientNumber}`, async () => await this.withTenantOperation(async (operation) => {
            for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
                if (!resourceConfig.conflictTracking)
                    continue;
                await SyncApiClient.replayConflictTrackedSyncs({
                    authenticationToken: await this.config.authenticationToken(),
                    batchSize: this.config.batchSize,
                    conflictTracking: resourceConfig.conflictTracking,
                    postReplay: this.config.postReplay,
                    remoteGeneration: (identity) => this._remoteGenerations.get(identity) || 0,
                    resourceType
                });
            }
            await SyncApiClient.replayLocalSyncs({
                authenticationToken: await this.config.authenticationToken(),
                batchSize: this.config.batchSize,
                postReplay: this.config.postReplay,
                syncModel: operation ? operation.modelClass(this.config.syncModel) : this.config.syncModel
            });
        }));
    }
    /**
     * Records an authoritative remote observation so an in-flight acknowledgement
     * cannot rebase a successor across that observation.
     * @param {{resourceId: string | number, resourceType: string, version?: string | number | null}} args - Remote identity.
     * @returns {void}
     */
    noteRemoteVersion({ resourceId, resourceType, version }) {
        void version;
        const identity = `${resourceType}:${String(resourceId)}`;
        this._remoteGenerations.set(identity, (this._remoteGenerations.get(identity) || 0) + 1);
    }
    /**
     * Reads the authoritative base version observed before a local mutation.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Version args.
     * @returns {string | number | null} Base version.
     */
    baseVersionFor({ operation, record, resourceConfig }) {
        if (operation === "create")
            return null;
        const versionAttribute = resourceConfig.conflictTracking?.versionAttribute;
        if (!versionAttribute)
            return null;
        const value = record.readAttribute(versionAttribute);
        if (value instanceof Date)
            return value.toISOString();
        if (value === null || typeof value === "string" || typeof value === "number")
            return value;
        throw new Error(`Sync conflict version ${versionAttribute} must be a Date, string, number, or null`);
    }
    /**
     * Reads the pre-assignment value exposed by record changes during beforeUpdate.
     * Deletes have no version change pair and use the record's current version.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Version args.
     * @returns {string | number | null} Pre-mutation base version.
     */
    preMutationBaseVersionFor({ operation, record, resourceConfig }) {
        const versionAttribute = resourceConfig.conflictTracking?.versionAttribute;
        const versionColumn = versionAttribute
            ? record.constructor.getAttributeNameToColumnNameMap()[versionAttribute]
            : undefined;
        const versionChange = operation === "update" && versionColumn
            ? record.changes()[versionColumn]
            : undefined;
        if (!versionChange)
            return this.baseVersionFor({ operation, record, resourceConfig });
        const value = versionChange[0];
        if (value instanceof Date)
            return value.toISOString();
        if (value === null || typeof value === "string" || typeof value === "number")
            return value;
        throw new Error(`Sync conflict version ${versionAttribute} must be a Date, string, number, or null`);
    }
    /**
     * Consumes the base captured for this lifecycle event before its after-commit
     * closure is deferred, preserving repeated same-record writes in one transaction.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Capture args.
     * @returns {string | number | null} Captured base version.
     */
    capturedBaseVersionFor({ operation, record, resourceConfig }) {
        if (operation === "create")
            return null;
        const capturedVersions = this._capturedBaseVersions.get(record);
        const baseVersion = capturedVersions?.shift();
        if (capturedVersions?.length === 0)
            this._capturedBaseVersions.delete(record);
        if (baseVersion !== undefined)
            return baseVersion;
        return this.baseVersionFor({ operation, record, resourceConfig });
    }
    /**
     * Schedules a background replay attempt without blocking the caller.
     * Failures go to config.onError (or rethrow when none is configured).
     * @returns {void}
     */
    scheduleReplay() {
        this._scheduledReplay = (async () => {
            try {
                await this.replayPending();
            }
            catch (error) {
                this.reportError(/** @type {Error} */ (error));
            }
        })();
    }
    /**
     * Awaits the last scheduled background replay (useful in tests and shutdown flows).
     * @returns {Promise<void>}
     */
    async waitForScheduledReplay() {
        if (this._scheduledReplay)
            await this._scheduledReplay;
    }
    /**
     * Reports a background sync failure.
     * @param {Error} error - Background failure.
     * @returns {void}
     */
    reportError(error) {
        if (this.config.onError) {
            this.config.onError(error);
            return;
        }
        throw error;
    }
    /**
     * Resolves connectivity through the configured gate.
     * @returns {Promise<boolean>} Whether the backend is considered reachable.
     */
    async isOnline() {
        if (!this.config.isOnline)
            return true;
        return (await this.config.isOnline()) !== false;
    }
    /**
     * Returns the scope store backing declared scopes and cursors.
     * @returns {import("./sync-scope-store.js").default} Scope store.
     */
    scopeStore() {
        this.assertTenantReady();
        if (this._scopeStore && this._databaseIdentity && this._scopeStore.storeIdentity !== this._databaseIdentity) {
            throw new Error("SyncClient scope store belongs to another or unresolved physical tenant database");
        }
        this._scopeStore ||= new SyncScopeStore({
            configuration: this.config.configuration,
            databaseIdentifier: this.config.databaseIdentifier,
            tenantHandle: this.config.tenantHandle
        });
        return this._scopeStore;
    }
    /**
     * Resolves the declared resource config for a local record.
     * @param {ReturnType<typeof JSON.parse>} resource - Local model record.
     * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Declared resource config.
     */
    resourceConfigFor(resource) {
        const modelClass = resource?.constructor;
        if (typeof modelClass?.getModelName !== "function") {
            throw new Error(`Sync resources must be model records with a static getModelName(), got: ${String(resource)}`);
        }
        const resourceType = modelClass.getModelName();
        const resourceConfig = this.config.resources[resourceType];
        if (!resourceConfig)
            throw new Error(`No sync resource configured for: ${resourceType}`);
        return resourceConfig;
    }
    /**
     * Resolves the sync type for a mutation through the resource config. The
     * "upsert" flag queues creates and updates as "update" rows (the server
     * upserts by resource id) and destroys as "delete" rows.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Mutation args.
     * @returns {string} Sync type.
     */
    defaultSyncType({ operation, record, resourceConfig }) {
        if (typeof resourceConfig.syncType === "function")
            return resourceConfig.syncType({ operation, record });
        if (operation === "destroy")
            return "delete";
        if (resourceConfig.syncType === "upsert")
            return "update";
        return operation;
    }
    /**
     * Derives the pull-apply resource configs from the declared resources.
     * @param {import("../database/operation.js").default | null} [operation] - Tenant operation binding the resource model classes.
     * @returns {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} Pull-apply resource configs.
     */
    pullResourceConfigs(operation) {
        if (!operation && this._pullResourceConfigs)
            return this._pullResourceConfigs;
        const resourceConfigs = /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} */ (Object.fromEntries(Object.entries(this.config.resources)
            .filter(([, resource]) => Boolean(resource.attributes))
            .map(([resourceType, resource]) => {
            const modelClass = operation ? operation.modelClass(resource.modelClass) : resource.modelClass;
            const findRecord = resource.findRecord;
            const findRecordForDelete = resource.findRecordForDelete;
            return [resourceType, {
                    afterApply: resource.afterApply,
                    attributes: /** @type {import("./sync-api-client-types.js").SyncResourceConfig["attributes"]} */ (resource.attributes),
                    enabled: true,
                    findRecord: operation && findRecord
                        ? (args) => findRecord({ ...args, modelClass, operation: operation || null })
                        : findRecord,
                    findRecordForDelete: operation && findRecordForDelete
                        ? (args) => findRecordForDelete({ ...args, modelClass, operation: operation || null })
                        : findRecordForDelete,
                    modelClass
                }];
        })));
        if (!operation)
            this._pullResourceConfigs = resourceConfigs;
        return resourceConfigs;
    }
    /**
     * Runs local state work on this client's captured tenant, or directly for the legacy default-database client.
     * @template T
     * @param {(operation: import("../database/operation.js").default | null) => Promise<T>} callback - Bound work.
     * @returns {Promise<T>} Callback result.
     */
    async withTenantOperation(callback) {
        if (!this.config.tenantHandle || !this.config.databaseIdentifier)
            return await callback(null);
        this.assertTenantReady();
        return await this.config.tenantHandle.databaseOperation({
            databaseIdentifier: this.config.databaseIdentifier,
            name: "Tenant SyncClient"
        }, async (operation) => {
            await operation.ensureModelInitialized(this.config.syncModel);
            return await callback(operation);
        });
    }
    /**
     * Reports whether a record belongs to this client's physical database.
     * @param {ReturnType<typeof JSON.parse>} record - Candidate record.
     * @returns {boolean} Whether this client owns it.
     */
    ownsRecord(record) {
        if (!this._databaseIdentity)
            return true;
        const databaseOperation = record.databaseOperation();
        return record.databaseIdentity() === this._databaseIdentity &&
            databaseOperation?.schemaGeneration() === this._tenantSchemaGeneration;
    }
    /**
     * Rejects a record not owned by this client's physical database.
     * @param {ReturnType<typeof JSON.parse>} record - Candidate record.
     * @returns {void}
     */
    assertRecordOwnership(record) {
        if (!this.ownsRecord(record))
            throw new Error("SyncClient resource belongs to another or unresolved physical tenant database");
    }
    /**
     * Validates a declared query against this client's captured tenant database.
     * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Scope query.
     * @returns {void}
     */
    assertQueryOwnership(query) {
        if (!this.config.tenantHandle || !this.config.databaseIdentifier)
            return;
        const modelClass = query.getModelClass();
        const databaseIdentifier = modelClass.getDatabaseIdentifier({ tenant: this.config.tenantHandle.tenant() });
        const queryDatabaseIdentity = query._operation?.databaseIdentity();
        if (databaseIdentifier !== this.config.databaseIdentifier ||
            !this.config.resources[modelClass.getModelName()] ||
            queryDatabaseIdentity !== this._databaseIdentity) {
            throw new Error("SyncClient scope belongs to another or unresolved physical tenant database");
        }
    }
    /**
     * Rejects work after the handle's ready physical schema generation changed or closed.
     * @returns {void}
     */
    assertTenantReady() {
        if (!this.config.tenantHandle || !this.config.databaseIdentifier)
            return;
        const lifecycle = this.config.tenantHandle.inspect({ databaseIdentifier: this.config.databaseIdentifier });
        if (!lifecycle.ready || !lifecycle.schemaGeneration || lifecycle.schemaGeneration !== this._tenantSchemaGeneration) {
            throw new Error("SyncClient tenant database generation is stale or not ready");
        }
    }
    /**
     * Binds a custom remote resolver result to the active tenant operation after proving its captured identity.
     * @param {{operation: import("../database/operation.js").default, record: ReturnType<typeof JSON.parse>}} args - Binding args.
     * @returns {void}
     */
    bindRemoteRecord({ operation, record }) {
        if (record.databaseOperation?.() === operation)
            return;
        this.assertRecordOwnership(record);
        operation.bindRecord(record);
    }
}
/**
 * Builds one resource config from a model's `static sync` declaration plus its
 * derived column metadata.
 * @param {{declaration: import("./sync-client-types.js").ModelSyncDeclaration, metadataModelClass: ReturnType<typeof JSON.parse>, modelClass: ReturnType<typeof JSON.parse>, resourceType: string}} args - Declaration args.
 * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Derived resource config.
 */
function resourceConfigFromSyncDeclaration({ declaration, metadataModelClass, modelClass, resourceType }) {
    const normalizedDeclaration = declaration === true ? {} : declaration;
    if (!normalizedDeclaration || typeof normalizedDeclaration !== "object" || Array.isArray(normalizedDeclaration)) {
        throw new Error(`${resourceType} static sync must be true or a sync declaration object, got: ${String(declaration)}`);
    }
    const { afterApply, attributes, booleanAttributes, conflictTracking, findRecord, findRecordForDelete, localOnlyAttributes, publish, realtime, syncType, track, trackedData, ...restDeclaration } = normalizedDeclaration;
    const unknownKeys = Object.keys(restDeclaration);
    // `publish` is the server-side half of the shared `static sync` declaration
    // (consumed by SyncPublisher on the backend) - the client derives nothing
    // from it, but models declared once for both sides must stay valid here.
    void publish;
    if (unknownKeys.length > 0) {
        throw new Error(`${resourceType} static sync received unknown keys: ${unknownKeys.join(", ")} (supported: afterApply, attributes, booleanAttributes, conflictTracking, findRecord, findRecordForDelete, localOnlyAttributes, publish, realtime, syncType, track, trackedData)`);
    }
    if (syncType !== undefined && typeof syncType !== "function" && syncType !== "upsert") {
        throw new Error(`${resourceType} static sync syncType must be a function or the string "upsert", got: ${String(syncType)}`);
    }
    const derived = derivedSyncAttributes({ modelClass: metadataModelClass, resourceType });
    if (conflictTracking)
        validateConflictTracking({ conflictTracking, derived, resourceType });
    return {
        afterApply,
        attributes,
        booleanAttributes: mergedAttributeNames(derived.booleanAttributes, booleanAttributes),
        conflictTracking: conflictTracking ? { ...conflictTracking, versionAttribute: conflictTracking.versionAttribute || "updatedAt" } : undefined,
        findRecord,
        findRecordForDelete,
        localOnlyAttributes: mergedAttributeNames(derived.localOnlyAttributes, [...(localOnlyAttributes || []), ...(conflictTracking ? [conflictTracking.versionAttribute || "updatedAt"] : [])]),
        metadataModelClass,
        modelClass,
        realtime,
        syncType,
        track: normalizedTrack(track),
        trackedData
    };
}
/**
 * Validates one resource's durable conflict-tracking declaration.
 * @param {{conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig, derived: {booleanAttributes: string[], localOnlyAttributes: string[]}, resourceType: string}} args - Validation args.
 * @returns {void}
 */
function validateConflictTracking({ conflictTracking, derived, resourceType }) {
    const requiredStrings = {
        actorDeviceId: conflictTracking.actorDeviceId,
        actorUserId: conflictTracking.actorUserId,
        offlineGrantId: conflictTracking.offlineGrantId,
        policyHash: conflictTracking.policyHash
    };
    for (const [key, value] of Object.entries(requiredStrings)) {
        if (typeof value !== "string" || value.length === 0)
            throw new Error(`${resourceType} conflictTracking.${key} must be a non-empty string`);
    }
    if (!conflictTracking.mutationLog || typeof conflictTracking.mutationLog.append !== "function")
        throw new Error(`${resourceType} conflictTracking.mutationLog must be a LocalMutationLog`);
    if (typeof conflictTracking.clientMutationId !== "function")
        throw new Error(`${resourceType} conflictTracking.clientMutationId must be a function`);
    if (!conflictTracking.versionAttribute && !derived.localOnlyAttributes.includes("updatedAt")) {
        throw new Error(`${resourceType} conflictTracking requires versionAttribute because the model has no updatedAt column`);
    }
}
/**
 * Derives boolean and local-only attribute names from a model's column metadata:
 * booleans from boolean column types; local-only from the primary key,
 * createdAt/updatedAt, and sync bookkeeping columns.
 * @param {{modelClass: ReturnType<typeof JSON.parse>, resourceType: string}} args - Derivation args.
 * @returns {{booleanAttributes: string[], localOnlyAttributes: string[]}} Derived attribute names.
 */
function derivedSyncAttributes({ modelClass, resourceType }) {
    if (typeof modelClass.getColumnNames !== "function" ||
        typeof modelClass.getColumnNameToAttributeNameMap !== "function" ||
        typeof modelClass.getColumnTypeByName !== "function" ||
        typeof modelClass.primaryKey !== "function" ||
        typeof modelClass.hasPrimaryKey !== "function") {
        throw new Error(`${resourceType} static sync requires a Velocious model class with column metadata (getColumnNames, getColumnNameToAttributeNameMap, getColumnTypeByName, primaryKey, hasPrimaryKey)`);
    }
    const columnNameToAttributeName = modelClass.getColumnNameToAttributeNameMap();
    /** @type {string[]} */
    const booleanAttributes = [];
    /** @type {string[]} */
    const localOnlyAttributes = [];
    if (modelClass.hasPrimaryKey()) {
        const primaryKeyColumn = scalarModelPrimaryKey(modelClass.primaryKey(), `Derived sync attributes for ${resourceType}`);
        localOnlyAttributes.push(columnNameToAttributeName[primaryKeyColumn] || primaryKeyColumn);
    }
    for (const columnName of modelClass.getColumnNames()) {
        const attributeName = columnNameToAttributeName[columnName] || columnName;
        const columnType = modelClass.getColumnTypeByName(columnName);
        if (LOCAL_BOOKKEEPING_ATTRIBUTE_NAMES.includes(attributeName) && !localOnlyAttributes.includes(attributeName)) {
            localOnlyAttributes.push(attributeName);
        }
        if (columnType && isBooleanColumnType(columnType)) {
            booleanAttributes.push(attributeName);
        }
    }
    return { booleanAttributes, localOnlyAttributes };
}
/**
 * Merges derived attribute names with declared extras into a sorted, duplicate-free list.
 * @param {string[]} derived - Derived attribute names.
 * @param {string[] | undefined} declared - Declared extra attribute names.
 * @returns {string[]} Merged attribute names.
 */
function mergedAttributeNames(derived, declared) {
    return [...new Set([...derived, ...(declared || [])])].sort();
}
/**
 * Normalizes a declaration's track value: an operations array is shorthand for
 * the {operations} form.
 * @param {import("./sync-client-types.js").ModelSyncDeclarationConfig["track"]} track - Declared track value.
 * @returns {import("./sync-client-types.js").SyncClientResourceConfig["track"]} Normalized track value.
 */
function normalizedTrack(track) {
    if (Array.isArray(track))
        return { operations: track };
    return track;
}
/**
 * Builds a framework-owned sync endpoint POSTer over the configured transport.
 * @param {{path: string, requestContext: import("../remote-request-context.js").RemoteRequestContext, transport: import("../configuration-types.js").VelociousSyncClientTransport}} args - Poster args.
 * @returns {(payload: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>} Sync endpoint POSTer.
 */
function transportPoster({ path, requestContext, transport }) {
    return async (payload) => {
        const requestPayload = mergeRemoteRequestContext({
            context: requestContext,
            label: "Sync client request context",
            params: payload
        });
        const response = await transport.post(path, requestPayload);
        if (!response || typeof response.json !== "function") {
            throw new Error(`sync.client transport.post must resolve to a response with a json() method for ${path} (like the frontend-model websocket client)`);
        }
        return await response.json();
    };
}
/**
 * Lazily builds (and memoizes per configuration) the sync client derived from the
 * app's Velocious configuration and registers it as the current sync client.
 * @param {Configuration} [configuration] - Configuration owning the registered models and the sync.client block. Defaults to the current configuration.
 * @returns {SyncClient} Memoized sync client for the configuration.
 */
export function syncClient(configuration = Configuration.current()) {
    let client = syncClientsByConfiguration.get(configuration);
    if (!client) {
        client = SyncClient.fromConfiguration(configuration);
        syncClientsByConfiguration.set(configuration, client);
        client.setCurrent();
    }
    return client;
}
/**
 * Declares a sync scope on the current sync client.
 * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query declaring the sync scope.
 * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result.
 */
export async function sync(query) {
    return await SyncClient.current().sync(query);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ25FLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUVqRixJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUE7QUFFckIsc0ZBQXNGO0FBQ3RGLE1BQU0sc0JBQXNCLEdBQUcsRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBQyxDQUFBO0FBRXRHOzs7OztvREFLb0Q7QUFDcEQsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV2RCxrR0FBa0c7QUFDbEcsTUFBTSxpQ0FBaUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtB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USxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNyRCxNQUFNLElBQUksS0FBSyxDQUFDLGtGQUFrRixJQUFJLDZDQUE2QyxDQUFDLENBQUE7UUFDdEosQ0FBQztRQUVELE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDOUIsQ0FBQyxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLFVBQVUsQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRTtJQUNoRSxJQUFJLE1BQU0sR0FBRywwQkFBMEIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7SUFFMUQsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ1osTUFBTSxHQUFHLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNwRCwwQkFBMEIsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ3JELE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUNyQixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsSUFBSSxDQUFDLEtBQUs7SUFDOUIsT0FBTyxNQUFNLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDL0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQge2lzQm9vbGVhbkNvbHVtblR5cGV9IGZyb20gXCIuLi9kYXRhYmFzZS9jb2x1bW4tdHlwZXMuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCB7Y2FwdHVyZVJlbW90ZVJlcXVlc3RDb250ZXh0LCBtZXJnZVJlbW90ZVJlcXVlc3RDb250ZXh0fSBmcm9tIFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQge3NjYWxhck1vZGVsUHJpbWFyeUtleX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCBmcm9tIFwiLi4vaHR0cC1jbGllbnQvd2Vic29ja2V0LWNsaWVudC5qc1wiXG5cbmltcG9ydCB7c2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5fSBmcm9tIFwiLi9xdWVyeS1zY29wZS5qc1wiXG5pbXBvcnQgU3luY0FwaUNsaWVudCBmcm9tIFwiLi9zeW5jLWFwaS1jbGllbnQuanNcIlxuaW1wb3J0IFN5bmNSZWFsdGltZUJyaWRnZSBmcm9tIFwiLi9zeW5jLXJlYWx0aW1lLWJyaWRnZS5qc1wiXG5pbXBvcnQgU3luY1Njb3BlU3RvcmUgZnJvbSBcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiXG5pbXBvcnQge2N1cnJlbnRTeW5jQ2xpZW50LCBzZXRDdXJyZW50U3luY0NsaWVudH0gZnJvbSBcIi4vc3luYy1jbGllbnQtcmVnaXN0cnkuanNcIlxuXG5sZXQgY2xpZW50Q291bnRlciA9IDBcblxuLyoqIEB0eXBlIHt7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwifX0gKi9cbmNvbnN0IFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMgPSB7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwifVxuXG4vKipcbiAqIE9wZXJhdGlvbnMgdHJhY2tlZCBieSBkZWZhdWx0IGZvciBtb2RlbHMgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2Agd2l0aG91dCBhXG4gKiBgdHJhY2tgIGtleTogbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBxdWV1ZSBhdXRvbWF0aWNhbGx5LiBEZXN0cm95cyBhcmUgbm90XG4gKiB0cmFja2VkIGJ5IGRlZmF1bHQgYmVjYXVzZSBhIGxvY2FsIGRlc3Ryb3kgaXMgb2Z0ZW4gY2FjaGUgZXZpY3Rpb24gcmF0aGVyXG4gKiB0aGFuIGEgc2VydmVyIGRlbGV0ZTsgb3B0IGluIHdpdGggYHRyYWNrOiB0cnVlYCBvciBhbiBvcGVyYXRpb25zIGxpc3QuXG4gKiBAdHlwZSB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59ICovXG5jb25zdCBERUZBVUxUX1RSQUNLRURfT1BFUkFUSU9OUyA9IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXVxuXG4vKiogQXR0cmlidXRlIG5hbWVzIHRyZWF0ZWQgYXMgY2xpZW50LWxvY2FsIHN5bmMgYm9va2tlZXBpbmcgd2hlbiBkZXJpdmluZyBsb2NhbE9ubHlBdHRyaWJ1dGVzLiAqL1xuY29uc3QgTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTID0gW1wiY3JlYXRlZEF0XCIsIFwidXBkYXRlZEF0XCIsIFwibGFzdFN5bmNDaGFuZ2VBdFwiXVxuXG5jb25zdCBTWU5DX1JFUVVFU1RfUkVTRVJWRURfS0VZUyA9IFtcbiAgXCJhZnRlcklkXCIsXG4gIFwiYWZ0ZXJTZXJ2ZXJTZXF1ZW5jZVwiLFxuICBcImFmdGVyVXBkYXRlZEF0XCIsXG4gIFwiYXV0aGVudGljYXRpb25Ub2tlblwiLFxuICBcImxpbWl0XCIsXG4gIFwic2NvcGVcIixcbiAgXCJzeW5jc1wiLFxuICBcInVwc3RyZWFtUmVmcmVzaFwiLFxuICBcInVwVG9JZFwiLFxuICBcInVwVG9TZXJ2ZXJTZXF1ZW5jZVwiLFxuICBcInVwVG9VcGRhdGVkQXRcIlxuXVxuXG4vKiogQHR5cGUge1dlYWtNYXA8Q29uZmlndXJhdGlvbiwgU3luY0NsaWVudD59ICovXG5jb25zdCBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBEZWNsYXJhdGl2ZSBjbGllbnQtc2lkZSBzeW5jIGRyaXZlci5cbiAqXG4gKiBFdmVyeXRoaW5nIGlzIGRlcml2ZWQgZnJvbSB0aGUgYXBwJ3MgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb246IG1vZGVscyBkZWNsYXJlXG4gKiBgc3RhdGljIHN5bmNgLCB0cmFuc3BvcnQvYXV0aC9jb25uZWN0aXZpdHkgY29tZSBmcm9tIHRoZSBgc3luYy5jbGllbnRgXG4gKiBjb25maWd1cmF0aW9uIGJsb2NrLCBhbmQgVmVsb2Npb3VzIG93bnMgc2NvcGUgcGVyc2lzdGVuY2UsIHBlci1zY29wZSBjdXJzb3JzLFxuICogcHVsbCBwYWdpbmcvYXBwbHksIGxvY2FsIHF1ZXVlaW5nLCBhbmQgb25saW5lLWdhdGVkIHJlcGxheS4gRGVjbGFyZSBzeW5jXG4gKiBpbnRlcmVzdCBmcm9tIHF1ZXJpZXM6XG4gKlxuICogICAgIGF3YWl0IHN5bmNDbGllbnQoKS5zdGFydCgpXG4gKiAgICAgYXdhaXQgc3luY0NsaWVudCgpLnN5bmMoRXZlbnQud2hlcmUoe3BhcnRuZXJJZH0pKVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jQ2xpZW50IHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3luYyBjbGllbnQgYnkgZGVyaXZpbmcgZXZlcnl0aGluZyBmcm9tIHRoZSBhcHAncyBWZWxvY2lvdXNcbiAgICogY29uZmlndXJhdGlvbjogZXZlcnkgcmVnaXN0ZXJlZCBtb2RlbCBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCBiZWNvbWVzIGFcbiAgICogcmVzb3VyY2Ugd2l0aCBib29sZWFuQXR0cmlidXRlcyBkZXJpdmVkIGZyb20gY29sdW1uIHR5cGVzIGFuZFxuICAgKiBsb2NhbE9ubHlBdHRyaWJ1dGVzIGRlcml2ZWQgZnJvbSB0aGUgcHJpbWFyeSBrZXksIGNyZWF0ZWRBdC91cGRhdGVkQXQsIGFuZFxuICAgKiBzeW5jIGJvb2trZWVwaW5nIGNvbHVtbnM7IHRoZSBwZW5kaW5nLXN5bmMgbW9kZWwgaXMgdGhlIHJlZ2lzdGVyZWQgXCJTeW5jXCJcbiAgICogbW9kZWw7IHRyYW5zcG9ydCwgYXV0aCwgY29ubmVjdGl2aXR5LCBhbmQgZXJyb3IgcmVwb3J0aW5nIGNvbWUgZnJvbSB0aGVcbiAgICogYHN5bmMuY2xpZW50YCBjb25maWd1cmF0aW9uIGJsb2NrLCB3aXRoIHRoZSBmcmFtZXdvcmsgb3duaW5nIHRoZVxuICAgKiBgJHttb3VudFBhdGh9L2NoYW5nZXNgIGFuZCBgJHttb3VudFBhdGh9L3JlcGxheWAgUE9TVGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRPcHRpb25zfSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBkYXRhYmFzZUlkZW50aWZpZXIsIGxlZ2FjeUN1cnNvciwgcmVxdWVzdENvbnRleHQsIHNjb3BlU3RvcmUsIHN5bmNNb2RlbCwgdGVuYW50SGFuZGxlLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuXG4gICAgY29uc3QgY2xpZW50Q29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5jbGllbnRcbiAgICBjb25zdCBjYXB0dXJlZFJlcXVlc3RDb250ZXh0ID0gY2FwdHVyZVJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCB7XG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHJlc2VydmVkS2V5czogU1lOQ19SRVFVRVNUX1JFU0VSVkVEX0tFWVNcbiAgICB9KVxuXG4gICAgaWYgKCFjbGllbnRDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlcXVpcmVzIGEgc3luYy5jbGllbnQgY29uZmlndXJhdGlvbiBibG9jazogbmV3IENvbmZpZ3VyYXRpb24oe3N5bmM6IHtjbGllbnQ6IHthdXRoZW50aWNhdGlvblRva2VuLCB0cmFuc3BvcnR9fX0pXCIpXG4gICAgfVxuXG4gICAgaWYgKEJvb2xlYW4odGVuYW50SGFuZGxlKSAhPT0gQm9vbGVhbihkYXRhYmFzZUlkZW50aWZpZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudEhhbmRsZSBhbmQgZGF0YWJhc2VJZGVudGlmaWVyIG11c3QgYmUgcHJvdmlkZWQgdG9nZXRoZXJcIilcbiAgICB9XG4gICAgaWYgKHRlbmFudEhhbmRsZSkge1xuICAgICAgdGVuYW50SGFuZGxlLmFzc2VydENvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgICAgIHRlbmFudEhhbmRsZS5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCByZXNvbHZlZFN5bmNNb2RlbCA9IHN5bmNNb2RlbCB8fCBtb2RlbENsYXNzZXMuU3luY1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSB0ZW5hbnRIYW5kbGUgPyB0ZW5hbnRIYW5kbGUuZGF0YWJhc2VJZGVudGl0eSgvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcikpIDogbnVsbFxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWc+fSAqL1xuICAgIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzZXMpKSB7XG4gICAgICBpZiAoIW1vZGVsQ2xhc3Muc3luYykgY29udGludWVcbiAgICAgIGlmICh0ZW5hbnRIYW5kbGUgJiYgbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGVuYW50SGFuZGxlLnRlbmFudCgpfSkgIT09IGRhdGFiYXNlSWRlbnRpZmllcikgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICBjb25zdCBtZXRhZGF0YU1vZGVsQ2xhc3MgPSB0ZW5hbnRIYW5kbGVcbiAgICAgICAgPyB0ZW5hbnRIYW5kbGUubWV0YWRhdGFNb2RlbENsYXNzKHtkYXRhYmFzZUlkZW50aWZpZXI6IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSwgbW9kZWxDbGFzc30pXG4gICAgICAgIDogbW9kZWxDbGFzc1xuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSByZXNvdXJjZUNvbmZpZ0Zyb21TeW5jRGVjbGFyYXRpb24oe2RlY2xhcmF0aW9uOiBtb2RlbENsYXNzLnN5bmMsIG1ldGFkYXRhTW9kZWxDbGFzcywgbW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSlcblxuICAgICAgaWYgKGRhdGFiYXNlSWRlbnRpdHkgJiYgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nID0ge1xuICAgICAgICAgIC4uLnJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgbXV0YXRpb25Mb2c6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucGFydGl0aW9uKGRhdGFiYXNlSWRlbnRpdHkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gPSByZXNvdXJjZUNvbmZpZ1xuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhyZXNvdXJjZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBmb3VuZCBubyByZWdpc3RlcmVkIG1vZGVscyBkZWNsYXJpbmcgc3RhdGljIHN5bmMgLSBkZWNsYXJlIGBzdGF0aWMgc3luYyA9IHRydWVgIChvciBhIHN5bmMgZGVjbGFyYXRpb24gb2JqZWN0KSBvbiB0aGUgbW9kZWxzIHRoYXQgc2hvdWxkIHN5bmNcIilcbiAgICB9XG5cbiAgICBpZiAoIXJlc29sdmVkU3luY01vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlcXVpcmVzIGEgcmVnaXN0ZXJlZCBcXFwiU3luY1xcXCIgbW9kZWwgZm9yIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIChvciBwYXNzIG9wdGlvbnMuc3luY01vZGVsKVwiKVxuICAgIH1cbiAgICBpZiAodGVuYW50SGFuZGxlICYmIHJlc29sdmVkU3luY01vZGVsLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0ZW5hbnRIYW5kbGUudGVuYW50KCl9KSAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDbGllbnQgc3luYyBtb2RlbCBkb2VzIG5vdCB1c2UgdGVuYW50IGRhdGFiYXNlICR7SlNPTi5zdHJpbmdpZnkoZGF0YWJhc2VJZGVudGlmaWVyKX1gKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmlnfSAqL1xuICAgIHRoaXMuY29uZmlnID0ge1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogY2xpZW50Q29uZmlndXJhdGlvbi5hdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplOiBjbGllbnRDb25maWd1cmF0aW9uLmJhdGNoU2l6ZSxcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBpc09ubGluZTogY2xpZW50Q29uZmlndXJhdGlvbi5pc09ubGluZSxcbiAgICAgIGxlZ2FjeUN1cnNvcixcbiAgICAgIG9uRXJyb3I6IGNsaWVudENvbmZpZ3VyYXRpb24ub25FcnJvcixcbiAgICAgIHBvc3RDaGFuZ2VzOiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9jaGFuZ2VzYCwgcmVxdWVzdENvbnRleHQ6IGNhcHR1cmVkUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogY2xpZW50Q29uZmlndXJhdGlvbi50cmFuc3BvcnR9KSxcbiAgICAgIHBvc3RSZXBsYXk6IHRyYW5zcG9ydFBvc3Rlcih7cGF0aDogYCR7Y2xpZW50Q29uZmlndXJhdGlvbi5tb3VudFBhdGh9L3JlcGxheWAsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICByZWFsdGltZTogY2xpZW50Q29uZmlndXJhdGlvbi5yZWFsdGltZSxcbiAgICAgIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LFxuICAgICAgcmVzb3VyY2VzLFxuICAgICAgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbCxcbiAgICAgIHRlbmFudEhhbmRsZSxcbiAgICAgIHdlYnNvY2tldENsaWVudDogY2xpZW50Q29uZmlndXJhdGlvbi53ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmw6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0VXJsXG4gICAgfVxuICAgIHRoaXMuX2NsaWVudE51bWJlciA9ICsrY2xpZW50Q291bnRlclxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgPSBkYXRhYmFzZUlkZW50aXR5XG4gICAgdGhpcy5fdGVuYW50U2NoZW1hR2VuZXJhdGlvbiA9IHRlbmFudEhhbmRsZVxuICAgICAgPyB0ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcil9KS5zY2hlbWFHZW5lcmF0aW9uXG4gICAgICA6IG51bGxcbiAgICAvKiogQHR5cGUge1N5bmNSZWFsdGltZUJyaWRnZSB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhbHRpbWVCcmlkZ2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTaGFyZWRDb25uZWN0aW9uIHwgbnVsbCB8IHVuZGVmaW5lZH0gU2hhcmVkIGFwcC1saWZldGltZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiAodW5kZWZpbmVkIHVudGlsIGZpcnN0IHJlc29sdmVkLCBudWxsIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkKS4gKi9cbiAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1wic3Vic2NyaWJlZFwiIHwgXCJzdWJzY3JpYmluZ1wiIHwgXCJ1bnN1YnNjcmliZWRcIn0gKi9cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zY29wZVN0b3JlID0gc2NvcGVTdG9yZSB8fCBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRSZXBsYXkgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2NhbGxiYWNrOiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQsIGNhbGxiYWNrTmFtZTogXCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8b2JqZWN0Pn0gKi9cbiAgICB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPG9iamVjdCwgQXJyYXk8c3RyaW5nIHwgbnVtYmVyIHwgbnVsbD4+fSAqL1xuICAgIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoID0gMFxuICAgIC8qKiBAdHlwZSB7TG9nZ2VyIHwge2Vycm9yOiAoLi4ubWVzc2FnZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn0gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvZ2dlciA9IG51bGxcbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYXV0b21hdGljIG11dGF0aW9uIHRyYWNraW5nIGZvciBldmVyeSBkZWNsYXJlZCByZXNvdXJjZSAob24gYnlcbiAgICogZGVmYXVsdDogbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBxdWV1ZSBwZW5kaW5nIHN5bmMgcm93cyBvbmNlIHRoZWlyXG4gICAqIHRyYW5zYWN0aW9uIGNvbW1pdHMgYW5kIHNjaGVkdWxlIGFuIGltbWVkaWF0ZSByZXBsYXkgYXR0ZW1wdCwgd2l0aG91dFxuICAgKiBhcHAtc2lkZSBxdWV1ZSBjYWxscykuIGB0cmFjazogZmFsc2VgIHJlc291cmNlcyBhcmUgc2tpcHBlZDsgYHRyYWNrOiB0cnVlYFxuICAgKiBhZGRzIGRlc3Ryb3lzOyBhbiBvcGVyYXRpb25zIGxpc3QgbmFycm93cyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICh0aGlzLl9zdGFydGVkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0ZWQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBjb25zdCBvcGVyYXRpb25zID0gdGhpcy50cmFja2VkT3BlcmF0aW9ucyh7cmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZX0pXG5cbiAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gXCJjcmVhdGVcIikpIHtcbiAgICAgICAgICBjb25zdCBjYWxsYmFja05hbWUgPSBvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiID8gXCJiZWZvcmVEZXN0cm95XCIgOiBcImJlZm9yZVVwZGF0ZVwiXG4gICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gcmVjb3JkKSA9PiB7XG4gICAgICAgICAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSByZXR1cm5cbiAgICAgICAgICAgIGlmICh0aGlzLmlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkpIHJldHVyblxuXG4gICAgICAgICAgICBjb25zdCBjYXB0dXJlZFZlcnNpb25zID0gdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZ2V0KHJlY29yZCkgfHwgW11cblxuICAgICAgICAgICAgY2FwdHVyZWRWZXJzaW9ucy5wdXNoKHRoaXMucHJlTXV0YXRpb25CYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkpXG4gICAgICAgICAgICB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5zZXQocmVjb3JkLCBjYXB0dXJlZFZlcnNpb25zKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gVFJBQ0tFRF9DQUxMQkFDS19OQU1FU1tvcGVyYXRpb25dXG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy50cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgICAgcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc1tjYWxsYmFja05hbWVdKGNhbGxiYWNrKVxuICAgICAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbGwgdHJhY2tpbmcgY2FsbGJhY2tzICh0ZXN0cywgc2lnbi1vdXQsIGhvdCByZWxvYWQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgZm9yIChjb25zdCB7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzc30gb2YgdGhpcy5fdHJhY2tlZENhbGxiYWNrcykge1xuICAgICAgbW9kZWxDbGFzcy51bnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbmQgdmFsaWRhdGVzIHRoZSB0cmFja2VkIG9wZXJhdGlvbnMgZm9yIGEgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBUcmFja2luZyBpcyBvbiBieSBkZWZhdWx0OiBtb2RlbHMgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2Agd2l0aG91dCBhIGB0cmFja2BcbiAgICoga2V5IHF1ZXVlIGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgYXV0b21hdGljYWxseTsgYHRyYWNrOiBmYWxzZWAgb3B0cyBhXG4gICAqIG1vZGVsIG91dCAoZm9yIG1vZGVscyB3cml0dGVuIGJ5IG5vbi11c2VyIGZsb3dzKS5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnLCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBSZXNvdXJjZSBjb25maWcgYW5kIG5hbWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiPn0gVHJhY2tlZCBvcGVyYXRpb25zLlxuICAgKi9cbiAgdHJhY2tlZE9wZXJhdGlvbnMoe3Jlc291cmNlQ29uZmlnLCByZXNvdXJjZVR5cGV9KSB7XG4gICAgY29uc3QgdHJhY2sgPSByZXNvdXJjZUNvbmZpZy50cmFja1xuXG4gICAgaWYgKHRyYWNrID09PSBmYWxzZSkgcmV0dXJuIFtdXG4gICAgaWYgKHRyYWNrID09PSB1bmRlZmluZWQpIHJldHVybiBERUZBVUxUX1RSQUNLRURfT1BFUkFUSU9OU1xuICAgIGlmICh0cmFjayA9PT0gdHJ1ZSkgcmV0dXJuIFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl1cblxuICAgIGlmICghdHJhY2sgfHwgdHlwZW9mIHRyYWNrICE9PSBcIm9iamVjdFwiIHx8ICFBcnJheS5pc0FycmF5KHRyYWNrLm9wZXJhdGlvbnMpIHx8IHRyYWNrLm9wZXJhdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDbGllbnQgcmVzb3VyY2UgJHtyZXNvdXJjZVR5cGV9IHRyYWNrIG11c3QgYmUgdHJ1ZSBvciB7b3BlcmF0aW9uczogWy4uLl19YClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiB0cmFjay5vcGVyYXRpb25zKSB7XG4gICAgICBpZiAoIShvcGVyYXRpb24gaW4gVFJBQ0tFRF9DQUxMQkFDS19OQU1FUykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHJlc291cmNlICR7cmVzb3VyY2VUeXBlfSB0cmFjay5vcGVyYXRpb25zIG11c3QgYmUgY3JlYXRlL3VwZGF0ZS9kZXN0cm95LCBnb3Q6ICR7U3RyaW5nKG9wZXJhdGlvbil9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJhY2sub3BlcmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbGlmZWN5Y2xlIGNhbGxiYWNrIHF1ZXVlaW5nIG9uZSB0cmFja2VkIG11dGF0aW9uLiBUaGUgcXVldWVkXG4gICAqIHBheWxvYWQgYW5kIHN5bmMgdHlwZSBhcmUgc25hcHNob3R0ZWQgYXQgbXV0YXRpb24tY2FsbGJhY2sgdGltZSwgc29cbiAgICogYWZ0ZXJTYXZlIGhvb2tzIGFzc2lnbmluZyB1bnNhdmVkIGF0dHJpYnV0ZXMgKG9yIGFueSBsYXRlciBkcmlmdCBvbiB0aGVcbiAgICogcmVjb3JkKSBjYW5ub3QgY2hhbmdlIHdoYXQgZ2V0cyBxdWV1ZWQgdnMgd2hhdCB3YXMgY29tbWl0dGVkLiBRdWV1ZWluZyBpc1xuICAgKiBkZWZlcnJlZCB0aHJvdWdoIHRoZSBtb2RlbCBjb25uZWN0aW9uJ3MgYWZ0ZXJDb21taXQgaG9vayBzbyBpdCBvbmx5IHJ1bnNcbiAgICogb25jZSB0aGUgbXV0YXRpb24ncyB0cmFuc2FjdGlvbiBoYXMgY29tbWl0dGVkIChpbW1lZGlhdGVseSB3aGVuIG5vXG4gICAqIHRyYW5zYWN0aW9uIGlzIG9wZW4pIC0gcXVldWVkIHN5bmNzIG5ldmVyIHJlZmVyZW5jZSByb2xsZWQtYmFjayByb3dzLlxuICAgKiBQb3N0LWNvbW1pdCBxdWV1ZSBmYWlsdXJlcyBhcmUgcmVwb3J0ZWQgd2l0aG91dCByZXRocm93aW5nIGludG8gdGhlXG4gICAqIGRyaXZlcidzIGFmdGVyQ29tbWl0IGNoYWluIChzZWUgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcikuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIE9wZXJhdGlvbiBhbmQgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7KHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFByb21pc2U8dm9pZD59IExpZmVjeWNsZSBjYWxsYmFjay5cbiAgICovXG4gIHRyYWNrZWRNdXRhdGlvbkNhbGxiYWNrKHtvcGVyYXRpb24sIHJlc291cmNlQ29uZmlnfSkge1xuICAgIHJldHVybiBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSByZXR1cm5cbiAgICAgIGlmICh0aGlzLmlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkpIHJldHVyblxuXG4gICAgICBjb25zdCBkYXRhID0gU3luY0FwaUNsaWVudC5xdWV1ZWRTeW5jRGF0YSh7XG4gICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgZGF0YTogcmVzb3VyY2VDb25maWcudHJhY2tlZERhdGEgPyByZXNvdXJjZUNvbmZpZy50cmFja2VkRGF0YSh7b3BlcmF0aW9uLCByZWNvcmR9KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogcmVzb3VyY2VDb25maWcubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgcmVzb3VyY2U6IHJlY29yZFxuICAgICAgfSlcbiAgICAgIGNvbnN0IHN5bmNUeXBlID0gdGhpcy5kZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICBjb25zdCBiYXNlVmVyc2lvbiA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmdcbiAgICAgICAgPyB0aGlzLmNhcHR1cmVkQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICAgIDogbnVsbFxuICAgICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uU2NvcGUgPSBkYXRhYmFzZU9wZXJhdGlvblxuICAgICAgICA/IGRhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcbiAgICAgICAgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcblxuICAgICAgYXdhaXQgcmVjb3JkLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgICAgICAgYmFzZVZlcnNpb24sXG4gICAgICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgICAgICAgcmVzb3VyY2U6IHJlY29yZCxcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiByZWNvcmQuY29uc3RydWN0b3IuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgICAgIHN5bmNUeXBlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlTG9jYWxTeW5jKHtkYXRhLCByZXNvdXJjZTogcmVjb3JkLCBzeW5jTW9kZWw6IG9wZXJhdGlvblNjb3BlLCBzeW5jVHlwZX0pXG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGF3YWl0IHRoaXMucmVwb3J0QWZ0ZXJDb21taXRFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnNjaGVkdWxlUmVwbGF5KClcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCB0cmFja2VkLXF1ZXVlaW5nIGZhaWx1cmUuIFRoZSB0cmFuc2FjdGlvbiBoYXMgYWxyZWFkeVxuICAgKiBjb21taXR0ZWQgd2hlbiBhZnRlckNvbW1pdCBjYWxsYmFja3MgcnVuLCBzbyByZXRocm93aW5nIGhlcmUgd291bGQgcG9pc29uXG4gICAqIHRoZSBkcml2ZXIncyBhd2FpdGVkIGFmdGVyQ29tbWl0IGNoYWluIChicmVha2luZyB1bnJlbGF0ZWQgY2FsbGJhY2tzKSAtXG4gICAqIGluc3RlYWQgdGhlIGZhaWx1cmUgZ29lcyB0byB0aGUgY29uZmlndXJlZCBzeW5jLmNsaWVudC5vbkVycm9yIGhvb2ssIG9yIGlzXG4gICAqIGxvZ2dlZCBsb3VkbHkgdGhyb3VnaCB0aGUgY2xpZW50J3MgbG9nZ2VyIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFBvc3QtY29tbWl0IHF1ZXVlaW5nIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlcigpLmVycm9yKFwiU3luY0NsaWVudCBmYWlsZWQgdG8gcXVldWUgYSB0cmFja2VkIG11dGF0aW9uIGFmdGVyIGNvbW1pdFwiLCBlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgY2xpZW50IGxvZ2dlci5cbiAgICogQHJldHVybnMge0xvZ2dlciB8IHtlcnJvcjogKC4uLm1lc3NhZ2VzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8dm9pZD59fSBDbGllbnQgbG9nZ2VyLlxuICAgKi9cbiAgbG9nZ2VyKCkge1xuICAgIHRoaXMuX2xvZ2dlciB8fD0gbmV3IExvZ2dlcihcIlN5bmNDbGllbnRcIiwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb259KVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvZ2dlclxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSByZWNvcmQgaXMgY3VycmVudGx5IGJlaW5nIHdyaXR0ZW4gYnkgcHVsbC1hcHBseSAoZWNobyBzdXBwcmVzc2lvbikuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHJlY29yZCB3cml0ZSBvcmlnaW5hdGVzIGZyb20gYSByZW1vdGUgY2hhbmdlLlxuICAgKi9cbiAgaXNSZW1vdGVBcHBseShyZWNvcmQpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmhhcyhyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0cmFja2VkIG11dGF0aW9uIHF1ZXVlaW5nIGlzIGN1cnJlbnRseSBzdXBwcmVzc2VkIGZvciBhIHJlY29yZDpcbiAgICogZWl0aGVyIHRoZSByZWNvcmQgd2FzIG1hcmtlZCBhcyBhIHJlbW90ZSBhcHBseSAoYG1hcmtSZW1vdGVBcHBseWAsIHVzZWQgYnlcbiAgICogcHVsbCBhbmQgcmVhbHRpbWUgYXBwbGllcykgb3IgYSBgd2l0aG91dFRyYWNraW5nYCBjYWxsYmFjayBpcyBydW5uaW5nIG9uXG4gICAqIHRoaXMgY2xpZW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRyYWNrZWQgcXVldWVpbmcgaXMgc3VwcHJlc3NlZCBmb3IgdGhlIHJlY29yZC5cbiAgICovXG4gIGlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkge1xuICAgIHJldHVybiB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aCA+IDAgfHwgdGhpcy5pc1JlbW90ZUFwcGx5KHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aCB0cmFja2VkIG11dGF0aW9uIHF1ZXVlaW5nIHN1cHByZXNzZWQgb24gdGhpcyBjbGllbnQgLVxuICAgKiBmb3IgY29kZSBhcHBseWluZyBzZXJ2ZXItb3JpZ2luYXRlZCBkYXRhIG91dHNpZGUgdGhlIGRlcml2ZWQgcHVsbC9yZWFsdGltZVxuICAgKiBhcHBsaWVycyAobGVnYWN5IHB1bGwgcGF0aHMsIGltcG9ydGVycywgc2lnbi1pbiBiYWNrZmlsbHMpLCBzbyB0aGVpciB3cml0ZXNcbiAgICogYXJlIG5vdCBlY2hvZWQgYmFjayB0byB0aGUgc2VydmVyIGFzIGRldmljZSBjaGFuZ2VzLiBTdXBwcmVzc2lvbiBjb3ZlcnMgdGhlXG4gICAqIHdob2xlIGFzeW5jIGR1cmF0aW9uIG9mIHRoZSBjYWxsYmFjayAobmVzdGVkIGNhbGxzIHN0YWNrKSBhbmQgaXNcbiAgICogY2xpZW50LXdpZGUgd2hpbGUgaXQgcnVuczogbXV0YXRpb25zIGZyb20gY29uY3VycmVudGx5IHJ1bm5pbmcgdGFza3MgYXJlXG4gICAqIGFsc28gc3VwcHJlc3NlZCBmb3IgdGhhdCB3aW5kb3csIHNvIHByZWZlciBgbWFya1JlbW90ZUFwcGx5KHJlY29yZClgIHdoZW5cbiAgICogd3JpdGVzIGZyb20gb3RoZXIgZmxvd3MgY2FuIGludGVybGVhdmUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPiB8IFR9IGNhbGxiYWNrIC0gV29yayB3aG9zZSBtb2RlbCB3cml0ZXMgc2hvdWxkIG5vdCBxdWV1ZSB0cmFja2VkIHN5bmNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gVGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRUcmFja2luZyhjYWxsYmFjaykge1xuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoKytcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aC0tXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIG9uZSByZWNvcmQgYXMgYmVpbmcgd3JpdHRlbiBmcm9tIHNlcnZlci1vcmlnaW5hdGVkIGRhdGEgc28gdHJhY2tlZFxuICAgKiBtdXRhdGlvbiBxdWV1ZWluZyBza2lwcyBpdCAocmVjb3JkLXByZWNpc2Ugc3VwcHJlc3Npb24pLiBUaGUgZGVyaXZlZCBwdWxsXG4gICAqIGFuZCByZWFsdGltZSBhcHBsaWVycyB1c2UgdGhpcyBpbnRlcm5hbGx5IGFyb3VuZCBldmVyeSBhcHBsaWVkIHdyaXRlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQgYWJvdXQgdG8gYmUgd3JpdHRlbi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFJlbGVhc2UgY2FsbGJhY2sgcmUtZW5hYmxpbmcgdHJhY2tpbmcgZm9yIHRoZSByZWNvcmQuXG4gICAqL1xuICBtYXJrUmVtb3RlQXBwbHkocmVjb3JkKSB7XG4gICAgdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmFkZChyZWNvcmQpXG5cbiAgICByZXR1cm4gKCkgPT4gdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmRlbGV0ZShyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoaXMgY2xpZW50IGFzIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudFN5bmNDbGllbnQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gQ3VycmVudCBzeW5jIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1N5bmNDbGllbnR9ICovIChjdXJyZW50U3luY0NsaWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbi4gQWxpYXMgZm9yXG4gICAqIGBuZXcgU3luY0NsaWVudCh7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYC5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMgYW5kIHRoZSBzeW5jLmNsaWVudCBibG9jay4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudE9wdGlvbnMsIFwiY29uZmlndXJhdGlvblwiPn0gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gU3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jQ2xpZW50KHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyAob3IgcmUtYWN0aXZhdGVzKSBhIHN5bmMgc2NvcGUgZnJvbSBhIG1vZGVsIHF1ZXJ5IGFuZCBwdWxscyBpdCB3aGVuIG9ubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBRdWVyeSBkZWNsYXJpbmcgdGhlIHN5bmMgc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBTeW5jIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KHByb2dyZXNzOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUHVsbFByb2dyZXNzKSA9PiB2b2lkfSBbb3B0aW9ucy5vblByb2dyZXNzXSAtIENhbGxlZCBwZXIgYXBwbGllZCBwYWdlIG9mIHRoZSBwdWxsIHRoaXMgZGVjbGFyYXRpb24gdHJpZ2dlcnMsIHNvIHRoZSBpbml0aWFsIGltcG9ydCBvZiBhIG5ld2x5IGRlY2xhcmVkIHNjb3BlIGNhbiBkcml2ZSBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIuIFNlZSBgcHVsbCgpYC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy51cHN0cmVhbVJlZnJlc2hdIC0gTWFya3MgdGhlIGNoYW5nZXMgcmVxdWVzdChzKSBhcyBhIHVzZXItaW5pdGlhdGVkIHJlZnJlc2gsIHNvIHRoZSBzZXJ2ZXIgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cy4gU2VlIGBwdWxsKClgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c2NvcGU6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZSwgcHVsbGVkOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9Pn0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0IChudWxsIHdoaWxlIG9mZmxpbmUpLlxuICAgKi9cbiAgYXN5bmMgc3luYyhxdWVyeSwge29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpXG4gICAgY29uc3Qgc2NvcGUgPSBzZXJpYWxpemVkU2NvcGVGcm9tUXVlcnkocXVlcnkpXG4gICAgY29uc3Qgc2NvcGVTdG9yZSA9IHRoaXMuc2NvcGVTdG9yZSgpXG4gICAgY29uc3Qgc2NvcGVSb3cgPSBhd2FpdCBzY29wZVN0b3JlLmZpbmRPckNyZWF0ZVNjb3BlKHNjb3BlKVxuXG4gICAgaWYgKCFzY29wZVJvdy5jdXJzb3JQYXlsb2FkICYmIHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcikge1xuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yUGF5bG9hZCA9IGF3YWl0IHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcih7c2NvcGV9KVxuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yID0gU3luY0FwaUNsaWVudC5zeW5jQ3Vyc29yRnJvbVBheWxvYWQobGVnYWN5Q3Vyc29yUGF5bG9hZClcblxuICAgICAgaWYgKGxlZ2FjeUN1cnNvcikgYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBsZWdhY3lDdXJzb3IpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwdWxsZWQ6IGF3YWl0IHRoaXMucHVsbCh7b25Qcm9ncmVzcywgdXBzdHJlYW1SZWZyZXNofSksIHNjb3BlfVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoZSBzeW5jIHNjb3BlIGRlY2xhcmVkIGJ5IGEgbW9kZWwgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgd2hvc2Ugc2NvcGUgc2hvdWxkIHN0b3Agc3luY2luZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN5bmMocXVlcnkpIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWxscyBjaGFuZ2VzIGZvciBldmVyeSBhY3RpdmUgc2NvcGUgd2l0aCBwZXItc2NvcGUgY3Vyc29ycyAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUHVsbCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSB3aXRoIGN1bXVsYXRpdmUgYHtwYWdlcywgc3luY2VkQ291bnQsIHRvdGFsfWAgYWNyb3NzIHRoZSBwdWxsZWQgc2NvcGVzLCBmb3IgcmVuZGVyaW5nIGEgXCJzeW5jZWRDb3VudCBvZiB0b3RhbFwiIHByb2dyZXNzIGJhciAoZS5nLiBhIGZ1bGwtaW1wb3J0IHNjcmVlbikuIE9wdGlvbmFsOyBvbWl0dGluZyBpdCBrZWVwcyB0aGUgZXhpc3RpbmcgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIFNlbmRzIGB1cHN0cmVhbVJlZnJlc2g6IHRydWVgIG9uIHRoZSBjaGFuZ2VzIHJlcXVlc3QocyksIHRlbGxpbmcgdGhlIHNlcnZlciB0aGlzIHB1bGwgaXMgdXNlci1pbml0aWF0ZWQgc28gaXQgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cyAoc2VlIGRvY3Mvc3luYy11cHN0cmVhbS1pbXBvcnRzLm1kKS4gQmFja2dyb3VuZCBwdWxscyBvbWl0IGl0IGFuZCBzdGF5IHRocm90dGxlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsPn0gQ29tYmluZWQgcHVsbCByZXN1bHQsIG9yIG51bGwgd2hpbGUgb2ZmbGluZS5cbiAgICovXG4gIGFzeW5jIHB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVybiBudWxsXG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbH0gKi9cbiAgICBsZXQgY29tYmluZWRSZXN1bHQgPSBudWxsXG5cbiAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnNpbmdsZUZsaWdodChgdmVsb2Npb3VzLXN5bmMtY2xpZW50LXB1bGwtJHt0aGlzLl9jbGllbnROdW1iZXJ9YCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXV0aGVudGljYXRpb25Ub2tlbiA9IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKVxuICAgICAgY29uc3Qgc2NvcGVTdG9yZSA9IHRoaXMuc2NvcGVTdG9yZSgpXG4gICAgICBjb25zdCBhcHBseVN5bmMgPSB0aGlzLnJlbW90ZUFwcGx5U3luYygpXG4gICAgICBjb25zdCByZXN1bHQgPSB7XG4gICAgICAgIGNoYW5nZWQ6IGZhbHNlLFxuICAgICAgICBwYWdlczogMCxcbiAgICAgICAgcmVzb3VyY2VDaGFuZ2VkOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqLyAoe30pLFxuICAgICAgICByZXNvdXJjZUNvdW50czogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoe30pLFxuICAgICAgICBzeW5jZWRDb3VudDogMCxcbiAgICAgICAgdG90YWw6IDBcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBzY29wZVJvdyBvZiBhd2FpdCBzY29wZVN0b3JlLmFjdGl2ZVNjb3BlcygpKSB7XG4gICAgICAgIC8vIEN1bXVsYXRlIHNjb3BlIHByb2dyZXNzIG9udG8gdGhlIGNvdW50cyBvZiB0aGUgc2NvcGVzIGFscmVhZHkgcHVsbGVkIHNvIGEgc2luZ2xlXG4gICAgICAgIC8vIHNjb3BlJ3MgcGVyLXBhZ2UgcHJvZ3Jlc3MgcmVhZHMgZXhhY3RseSBpdHMgb3duIGNvdW50cyAoYmFzZSAwKSwgYW5kIG11bHRpLXNjb3BlXG4gICAgICAgIC8vIHB1bGxzIHJlcG9ydCBhIHJ1bm5pbmcgY3VtdWxhdGl2ZSB0b3RhbCBhY3Jvc3MgZXZlcnkgc2NvcGUuXG4gICAgICAgIGNvbnN0IGJhc2VQYWdlcyA9IHJlc3VsdC5wYWdlc1xuICAgICAgICBjb25zdCBiYXNlU3luY2VkQ291bnQgPSByZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgY29uc3QgYmFzZVRvdGFsID0gcmVzdWx0LnRvdGFsXG4gICAgICAgIGNvbnN0IHNjb3BlUmVzdWx0ID0gYXdhaXQgU3luY0FwaUNsaWVudC5wdWxsQ2hhbmdlcyh7XG4gICAgICAgICAgYXBwbHlTeW5jLFxuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgICAgbG9hZEN1cnNvcjogYXN5bmMgKCkgPT4gYXdhaXQgc2NvcGVTdG9yZS5sb2FkQ3Vyc29yKHNjb3BlUm93KSxcbiAgICAgICAgICBvblByb2dyZXNzOiBvblByb2dyZXNzID8gKHByb2dyZXNzKSA9PiBvblByb2dyZXNzKHtcbiAgICAgICAgICAgIHBhZ2VzOiBiYXNlUGFnZXMgKyBwcm9ncmVzcy5wYWdlcyxcbiAgICAgICAgICAgIHN5bmNlZENvdW50OiBiYXNlU3luY2VkQ291bnQgKyBwcm9ncmVzcy5zeW5jZWRDb3VudCxcbiAgICAgICAgICAgIHRvdGFsOiBiYXNlVG90YWwgKyBwcm9ncmVzcy50b3RhbFxuICAgICAgICAgIH0pIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHBvc3RDaGFuZ2VzOiBhc3luYyAocGF5bG9hZCkgPT4gYXdhaXQgdGhpcy5jb25maWcucG9zdENoYW5nZXMoe1xuICAgICAgICAgICAgLi4ucGF5bG9hZCxcbiAgICAgICAgICAgIC8vIE9ubHkgdGhlIGFsbC10eXBlcyBzY29wZSBjYXJyaWVzIHRoZSB0eXBlIGxpc3Q7IGEgdHlwZS1kZWNsYXJlZCBzY29wZSBuZWVkcyBub25lLlxuICAgICAgICAgICAgc2NvcGU6IHtcbiAgICAgICAgICAgICAgY29uZGl0aW9uczogc2NvcGVSb3cuY29uZGl0aW9ucyxcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBzY29wZVJvdy5yZXNvdXJjZVR5cGUsXG4gICAgICAgICAgICAgIC4uLihzY29wZVJvdy5yZXNvdXJjZVR5cGUgPT09IG51bGwgPyB7cmVzb3VyY2VUeXBlczogdGhpcy51c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCl9IDoge30pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLi4uKHVwc3RyZWFtUmVmcmVzaCA/IHt1cHN0cmVhbVJlZnJlc2g6IHRydWV9IDoge30pXG4gICAgICAgICAgfSksXG4gICAgICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBjdXJzb3IpXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmVzdWx0LmNoYW5nZWQgfHw9IHNjb3BlUmVzdWx0LmNoYW5nZWRcbiAgICAgICAgcmVzdWx0LnBhZ2VzICs9IHNjb3BlUmVzdWx0LnBhZ2VzXG4gICAgICAgIHJlc3VsdC5zeW5jZWRDb3VudCArPSBzY29wZVJlc3VsdC5zeW5jZWRDb3VudFxuICAgICAgICByZXN1bHQudG90YWwgKz0gc2NvcGVSZXN1bHQudG90YWxcblxuICAgICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIGNvdW50XSBvZiBPYmplY3QuZW50cmllcyhzY29wZVJlc3VsdC5yZXNvdXJjZUNvdW50cykpIHtcbiAgICAgICAgICByZXN1bHQucmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSA9IChyZXN1bHQucmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSB8fCAwKSArIGNvdW50XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCBjaGFuZ2VkXSBvZiBPYmplY3QuZW50cmllcyhzY29wZVJlc3VsdC5yZXNvdXJjZUNoYW5nZWQpKSB7XG4gICAgICAgICAgcmVzdWx0LnJlc291cmNlQ2hhbmdlZFtyZXNvdXJjZVR5cGVdIHx8PSBjaGFuZ2VkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29tYmluZWRSZXN1bHQgPSByZXN1bHRcbiAgICB9KVxuXG4gICAgcmV0dXJuIGNvbWJpbmVkUmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBkZXJpdmVkIHJlbW90ZS1jaGFuZ2UgYXBwbGllciBzaGFyZWQgYnkgcHVsbHMgYW5kIHJlYWx0aW1lIHB1c2hlczpcbiAgICogYXBwbGllcyB0aHJvdWdoIHRoZSBkZWNsYXJlZCByZXNvdXJjZSBjb25maWdzLCByZWdpc3RlcnMgZWFjaCB3cml0dGVuIHJlY29yZFxuICAgKiBmb3IgZWNobyBzdXBwcmVzc2lvbiAodHJhY2tlZCByZXNvdXJjZXMgZG8gbm90IHJlLXF1ZXVlIGFwcGxpZWQgY2hhbmdlcyksIGFuZFxuICAgKiBmYWlscyBsb3VkbHkgaW5zdGVhZCBvZiBzaWxlbnRseSBza2lwcGluZyB1bmNvbmZpZ3VyZWQgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge3tzb3VyY2U/OiBzdHJpbmd9fSBbYXJnc10gLSBFcnJvciBjb250ZXh0IGRlc2NyaWJpbmcgd2hlcmUgdGhlIGNoYW5nZSBjYW1lIGZyb20uXG4gICAqIEByZXR1cm5zIHsoc3luYzogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IExvdWQgcmVtb3RlLWNoYW5nZSBhcHBsaWVyLlxuICAgKi9cbiAgcmVtb3RlQXBwbHlTeW5jKHtzb3VyY2UgPSBcInB1bGxlZCBjaGFuZ2VcIn0gPSB7fSkge1xuICAgIHJldHVybiBhc3luYyAoc3luYykgPT4ge1xuICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gc3luYy5yZXNvdXJjZVR5cGUoKVxuICAgICAgY29uc3QgY29uZmlndXJlZFJlc291cmNlID0gcmVzb3VyY2VUeXBlID8gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gOiB1bmRlZmluZWRcblxuICAgICAgaWYgKCFyZXNvdXJjZVR5cGUgfHwgIWNvbmZpZ3VyZWRSZXNvdXJjZT8uYXR0cmlidXRlcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgcmVzb3VyY2Ugd2l0aCBwdWxsIGF0dHJpYnV0ZXMgY29uZmlndXJlZCBmb3IgJHtzb3VyY2V9OiAke1N0cmluZyhyZXNvdXJjZVR5cGUpfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgICBjb25zdCBkYXRhID0gc3luYy5kYXRhKClcbiAgICAgICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHRoaXMuY29uZmlnLnJlc291cmNlc1tyZXNvdXJjZVR5cGVdLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgICAgICBpZiAodmVyc2lvbkF0dHJpYnV0ZSkge1xuICAgICAgICAgIGNvbnN0IGRhdGFBdHRyaWJ1dGVzID0gZGF0YSAmJiB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShkYXRhKVxuICAgICAgICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRhdGEpXG4gICAgICAgICAgICA6IHt9XG5cbiAgICAgICAgICB0aGlzLm5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkOiBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKCkpLCByZXNvdXJjZVR5cGUsIHZlcnNpb246IGRhdGFBdHRyaWJ1dGVzW3ZlcnNpb25BdHRyaWJ1dGVdfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHB1bGxSZXNvdXJjZUNvbmZpZ3MgPSB0aGlzLnB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKVxuICAgICAgICBjb25zdCBhcHBsaWVyID0gU3luY0FwaUNsaWVudC5yZXNvdXJjZUFwcGxpZXIocHVsbFJlc291cmNlQ29uZmlncywgKHJlY29yZCkgPT4ge1xuICAgICAgICAgIGlmIChvcGVyYXRpb24pIHRoaXMuYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFya1JlbW90ZUFwcGx5KHJlY29yZClcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gYXdhaXQgYXBwbGllcihzeW5jKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNoYXJlZCBhcHAtbGlmZXRpbWUgd2Vic29ja2V0IGNvbm5lY3Rpb24gYWxsIHN5bmMgdHJhZmZpY1xuICAgKiByaWRlcywgb3IgbnVsbCB3aGVuIG5vbmUgaXMgY29uZmlndXJlZC4gQnVpbHQgb25jZSBhbmQgbWVtb2l6ZWQgKHBlclxuICAgKiBjbGllbnQpOiBhbiBhcHAtcHJvdmlkZWQgYHN5bmMuY2xpZW50LndlYnNvY2tldENsaWVudGAgaW5zdGFuY2Ugd2lucyAodGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBjYW4gcGFzcyBpdHMgb3duIGNsaWVudCBzbyBvbmUgc29ja2V0IGNhcnJpZXNcbiAgICogZXZlcnl0aGluZyksIGVsc2UgYSBmcmFtZXdvcmstb3duZWQgcmVjb25uZWN0aW5nIHtAbGluayBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9XG4gICAqIGJ1aWx0IGZyb20gYHN5bmMuY2xpZW50LndlYnNvY2tldFVybGAuIFRoZSByZWFsdGltZSBicmlkZ2UgcmlkZXMgdGhpc1xuICAgKiBjb25uZWN0aW9uIHdpdGhvdXQgb3duaW5nIGl0cyBsaWZlY3ljbGU7IHdoZW4gbmVpdGhlciBpcyBjb25maWd1cmVkIHRoZVxuICAgKiBicmlkZ2UgZmFsbHMgYmFjayB0byB0aGUgZGVwcmVjYXRlZCBwZXItY3ljbGUgYHJlYWx0aW1lLmNyZWF0ZUNsaWVudGAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTaGFyZWRDb25uZWN0aW9uIHwgbnVsbH0gU2hhcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uLCBvciBudWxsLlxuICAgKi9cbiAgc3luY0Nvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX3N5bmNDb25uZWN0aW9uICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9zeW5jQ29ubmVjdGlvblxuXG4gICAgaWYgKHRoaXMuY29uZmlnLndlYnNvY2tldENsaWVudCkge1xuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB0aGlzLmNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9IGVsc2UgaWYgKHRoaXMuY29uZmlnLndlYnNvY2tldFVybCkge1xuICAgICAgY29uc3QgdXJsID0gdHlwZW9mIHRoaXMuY29uZmlnLndlYnNvY2tldFVybCA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5jb25maWcud2Vic29ja2V0VXJsKCkgOiB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmxcblxuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB1cmwgPyBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHt1cmx9KSA6IG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3N5bmNDb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0aGUgZGVyaXZlZCByZWFsdGltZSBjaGFubmVscyBzbyBwdXNoZWQgd2Vic29ja2V0IGNoYW5nZXMgYXBwbHlcbiAgICogdGhyb3VnaCB0aGUgc2FtZSBkZXJpdmVkIGFwcGxpZXIgYXMgcHVsbHMgKGlkZW1wb3RlbnQsIHNpbmdsZS1mbGlnaHRlZCkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtjb250ZXh0XSAtIEFwcCBjb250ZXh0IHBhc3NlZCB0byB0aGUgZGVwcmVjYXRlZCBgc3luYy5jbGllbnQucmVhbHRpbWUuY2hhbm5lbHNgIGNhbGxiYWNrIChydW50aW1lIHNjb3BlIHZhbHVlcykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3Vic2NyaWJlUmVhbHRpbWUoY29udGV4dCkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS5zdWJzY3JpYmUoY29udGV4dClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRoZSBzZXJ2ZXItZW51bWVyYXRlZCB1c2VyIHNjb3BlOiBcImV2ZXJ5dGhpbmcgbXkgYWJpbGl0eSBjYW5cbiAgICogc2VlXCIuIERlY2xhcmVzIGEgdXNlciBzY29wZSAoZW1wdHkgY29uZGl0aW9ucykgZm9yIGV2ZXJ5IHB1bGxhYmxlIHN5bmNlZFxuICAgKiByZXNvdXJjZSB0eXBlLCBzdWJzY3JpYmVzIHJlYWx0aW1lIHNvIHRoZWlyIGZyYW1ld29yayBzeW5jIGNoYW5uZWxcbiAgICogc3Vic2NyaXB0aW9ucyBnbyBsaXZlLCBhbmQgcHVsbHMgc28gdGhlIGRldmljZSBjYXRjaGVzIHVwLiBUaGUgc2VydmVyXG4gICAqIGF1dGhvcml6ZXMgZWFjaCBlbXB0eS1jb25kaXRpb25zIHNjb3BlIHRocm91Z2ggdGhlIGFwcCBzeW5jIHJlc291cmNlJ3NcbiAgICogYGF1dGhvcml6ZUNoYW5nZXNgIGFuZCByZS1jaGVja3MgcmVjb3JkIGFjY2VzcyBwZXIgZGVsaXZlcnksIHNvIHRoZSBjbGllbnRcbiAgICogc3Vic2NyaWJlcyB3aXRoIGp1c3QgaXRzIHRva2VuIGFuZCB0aGUgc2VydmVyIGRlY2lkZXMgbWVtYmVyc2hpcC5cbiAgICogSWRlbXBvdGVudCBhbmQgc2luZ2xlLWZsaWdodGVkIGxpa2Uge0BsaW5rIFN5bmNDbGllbnQjc3Vic2NyaWJlUmVhbHRpbWV9LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN1YnNjcmliZVVzZXJTY29wZSgpIHtcbiAgICBpZiAodGhpcy5fdXNlclNjb3BlU3RhdGUgPT09IFwic3Vic2NyaWJlZFwiKSByZXR1cm5cblxuICAgIGlmICghdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSkge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW5kIGFjdGl2YXRlcyB0aGUgdXNlciBzY29wZSBmb3IgZXZlcnkgcHVsbGFibGUgcmVzb3VyY2UsIHRoZW5cbiAgICogc3Vic2NyaWJlcyByZWFsdGltZSBhbmQgcHVsbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3N1YnNjcmliZVVzZXJTY29wZSgpIHtcbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwic3Vic2NyaWJpbmdcIlxuXG4gICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkuZmluZE9yQ3JlYXRlU2NvcGUoYXdhaXQgdGhpcy51c2VyU2NvcGUoKSlcblxuICAgIGF3YWl0IHRoaXMuc3Vic2NyaWJlUmVhbHRpbWUoKVxuICAgIGF3YWl0IHRoaXMucHVsbCgpXG5cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwic3Vic2NyaWJlZFwiXG4gIH1cblxuICAvKipcbiAgICogVW5zdWJzY3JpYmVzIHRoZSB1c2VyIHNjb3BlOiBkZWFjdGl2YXRlcyB0aGUgcGVyLXJlc291cmNlIHVzZXIgc2NvcGVzIGFuZFxuICAgKiBjbG9zZXMgdGhlIHJlYWx0aW1lIGNoYW5uZWwgc3Vic2NyaXB0aW9ucy4gVGhlIHNoYXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvblxuICAgKiBzdGF5cyBvcGVuIHdoZW4gb25lIGlzIGNvbmZpZ3VyZWQgKHNpZ24tb3V0IGRyb3BzIHN1YnNjcmlwdGlvbnMgd2l0aG91dFxuICAgKiBkaXNjb25uZWN0aW5nKSwgc28gYSBzdWJzZXF1ZW50IHNpZ24taW4gcmVzdWJzY3JpYmVzIG92ZXIgdGhlIHNhbWUgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVuc3Vic2NyaWJlVXNlclNjb3BlKCkge1xuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoYXdhaXQgdGhpcy51c2VyU2NvcGUoKSlcblxuICAgIGF3YWl0IHRoaXMudW5zdWJzY3JpYmVSZWFsdGltZSgpXG5cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB1c2VyIHNjb3BlOiBhIHNpbmdsZSBhbGwtdHlwZXMgc2NvcGUgKG51bGwgcmVzb3VyY2VUeXBlKSB3aXRoIGVtcHR5XG4gICAqIGNvbmRpdGlvbnMsIHBhcnRpdGlvbmVkIGxvY2FsbHkgYnkgb3duZXIuIE9uZSBzY29wZSAtIG5vdCBvbmUgcGVyIHJlc291cmNlXG4gICAqIHR5cGUgLSBzbyB0aGUgc2VydmVyIGF1dGhvcml6ZXMgdGhlIGNhbGxlciBvbmNlIHBlciBzeW5jIGFuZCBwZXIgc3Vic2NyaWJlLFxuICAgKiBob3dldmVyIG1hbnkgcmVzb3VyY2UgdHlwZXMgaXQgc2VydmVzLiBUaGUgc2VydmVyIGRlY2lkZXMgd2hpY2ggdHlwZXMgdGhlXG4gICAqIGNhbGxlciBtYXkgc2VlOyB0aGUgY2xpZW50IGFwcGxpZXMgZWFjaCBwdWxsZWQgcm93IGJ5IHRoZSByZXNvdXJjZSB0eXBlIG9uXG4gICAqIGl0cyBvd24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZT59IFRoZSB1c2VyIHNjb3BlLlxuICAgKi9cbiAgYXN5bmMgdXNlclNjb3BlKCkge1xuICAgIHJldHVybiB7Y29uZGl0aW9uczoge30sIG93bmVyOiBhd2FpdCB0aGlzLnVzZXJTY29wZU93bmVyKCksIHJlc291cmNlVHlwZTogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcmVzb3VyY2UgdHlwZXMgdGhlIHVzZXIgc2NvcGUgY292ZXJzOiBldmVyeSBkZWNsYXJlZCByZXNvdXJjZSB0aGF0XG4gICAqIHJlY2VpdmVzIHB1bGxlZCBjaGFuZ2VzIChoYXMgcHVsbCBgYXR0cmlidXRlc2ApLCBzbyB0aGUgY2xpZW50IGNhbiBhcHBseVxuICAgKiB0aGVtLiBTZW50IHdpdGggdGhlIHNjb3BlIGFzIGEgZGVsaXZlcnkvdHlwZSBmaWx0ZXIgLSBpdCBuYXJyb3dzLCBuZXZlclxuICAgKiB3aWRlbnMsIHdoYXQgdGhlIHNlcnZlcidzIGF1dGhvcml6YXRpb24gYWxyZWFkeSBhbGxvd3MsIGFuZCBpdCBrZWVwcyBhXG4gICAqIGJyb2FkY2FzdCBvZiBhIHR5cGUgdGhpcyBjbGllbnQgY2Fubm90IGFwcGx5IGZyb20gcmVhY2hpbmcgdGhlIHNlcnZlcidzXG4gICAqIHBlci1kZWxpdmVyeSBhY2Nlc3MgcmUtY2hlY2sgKGEgZGF0YWJhc2UgcXVlcnkgcGVyIG1hdGNoZWQgYnJvYWRjYXN0LCBwZXJcbiAgICogc3Vic2NyaWJlZCBkZXZpY2UpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IFB1bGxhYmxlIHJlc291cmNlIHR5cGUgbmFtZXMuXG4gICAqL1xuICB1c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLnB1bGxSZXNvdXJjZUNvbmZpZ3MoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgbG9jYWwgcGFydGl0aW9uIGtleSBmb3IgdGhlIHVzZXIgc2NvcGU6IHRoZSBjdXJyZW50bHlcbiAgICogY29uZmlndXJlZCBhdXRoZW50aWNhdGVkIGlkZW50aXR5ICh0aGUgc3luYyBhdXRoIHRva2VuKS4gUGFydGl0aW9uaW5nIHRoZVxuICAgKiB1c2VyIHNjb3BlJ3MgbG9jYWwgc2NvcGUvY3Vyc29yIHJvd3MgYnkgdGhpcyBvd25lciBrZWVwcyB0aGVcbiAgICogZW1wdHktY29uZGl0aW9ucyBjdXJzb3IgZnJvbSBsZWFraW5nIGFjcm9zcyBhY2NvdW50cyBvbiBhIHNoYXJlZCBkZXZpY2VcbiAgICogKGFjY291bnQgQiBzaWduaW5nIGluIGFmdGVyIGFjY291bnQgQSBnZXRzIGEgZnJlc2ggY3Vyc29yKSB3aGlsZSB0aGUgc2FtZVxuICAgKiBhY2NvdW50IHJlY29ubmVjdGluZyBrZWVwcyBpdHMgY3Vyc29yIGNvbnRpbnVpdHkuIFRoZSBvd25lciBpcyBhIGxvY2FsXG4gICAqIHBhcnRpdGlvbiBrZXkgb25seSDigJQgcHVsbHMgc3RpbGwgcG9zdCBlbXB0eSBjb25kaXRpb25zIHRvIHRoZSBzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFVzZXItc2NvcGUgb3duZXIgcGFydGl0aW9uIGtleS5cbiAgICovXG4gIGFzeW5jIHVzZXJTY29wZU93bmVyKCkge1xuICAgIHJldHVybiBTdHJpbmcoYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFVuc3Vic2NyaWJlcyB0aGUgcmVhbHRpbWUgY2hhbm5lbHMgYW5kIGRpc2Nvbm5lY3RzIHRoZSB3ZWJzb2NrZXQgY2xpZW50IChpZGVtcG90ZW50KS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN1YnNjcmliZVJlYWx0aW1lKCkge1xuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS51bnN1YnNjcmliZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB0aGUgcmVhbHRpbWUgc3Vic2NyaXB0aW9uIHN0YXRlIGFuZCBwZXItY2hhbm5lbCByZWFkaW5lc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPFN5bmNSZWFsdGltZUJyaWRnZVtcInN0YXR1c1wiXT59IFJlYWx0aW1lIHN0YXR1cy5cbiAgICovXG4gIHJlYWx0aW1lU3RhdHVzKCkge1xuICAgIHJldHVybiB0aGlzLnJlYWx0aW1lQnJpZGdlKCkuc3RhdHVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgcmVhbHRpbWUgbWVzc2FnZSBhcHBsaWVzIGFuZCBhbnkgc2NoZWR1bGVkXG4gICAqIHB1bGwtb24tcmVjb25uZWN0ICh1c2VmdWwgaW4gdGVzdHMgYW5kIHNodXRkb3duIGZsb3dzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB3YWl0Rm9yUmVhbHRpbWVBcHBsaWVkKCkge1xuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS53YWl0Rm9yQXBwbGllZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IHJlYWx0aW1lIGJyaWRnZS5cbiAgICogQHJldHVybnMge1N5bmNSZWFsdGltZUJyaWRnZX0gUmVhbHRpbWUgYnJpZGdlLlxuICAgKi9cbiAgcmVhbHRpbWVCcmlkZ2UoKSB7XG4gICAgdGhpcy5fcmVhbHRpbWVCcmlkZ2UgfHw9IG5ldyBTeW5jUmVhbHRpbWVCcmlkZ2Uoe3N5bmNDbGllbnQ6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlYWx0aW1lQnJpZGdlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGEgbG9jYWwgbW9kZWwgY2hhbmdlIGFzIGEgcGVuZGluZyBzeW5jIHJvdyBhbmQgc2NoZWR1bGVzIGFuIGltbWVkaWF0ZVxuICAgKiByZXBsYXkgYXR0ZW1wdCAoa2VwdCBwZW5kaW5nIHdoaWxlIG9mZmxpbmUgb3Igd2hlbiB0aGUgYmFja2VuZCByZWplY3RzIGl0KS5cbiAgICogQHBhcmFtIHt7YmFzZVZlcnNpb24/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCByZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wZXJhdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHN5bmNUeXBlPzogc3RyaW5nfX0gYXJncyAtIFF1ZXVlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IFBlbmRpbmcgbG9jYWwgc3luYyByb3cgb3IgZHVyYWJsZSBjb25mbGljdC10cmFja2VkIGludGVudC5cbiAgICovXG4gIGFzeW5jIHF1ZXVlKHtiYXNlVmVyc2lvbiwgZGF0YSwgb3BlcmF0aW9uID0gXCJ1cGRhdGVcIiwgcmVzb3VyY2UsIHN5bmNUeXBlfSkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIHRoaXMuYXNzZXJ0UmVjb3JkT3duZXJzaGlwKHJlc291cmNlKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZ0ZvcihyZXNvdXJjZSlcbiAgICBjb25zdCByZXNvbHZlZFN5bmNUeXBlID0gc3luY1R5cGUgPz8gdGhpcy5kZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkOiByZXNvdXJjZSwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgIGNvbnN0IHF1ZXVlZERhdGEgPSBTeW5jQXBpQ2xpZW50LnF1ZXVlZFN5bmNEYXRhKHtcbiAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICBkYXRhLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICByZXNvdXJjZVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgYmFzZVZlcnNpb246IGJhc2VWZXJzaW9uID09PSB1bmRlZmluZWQgPyB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZDogcmVzb3VyY2UsIHJlc291cmNlQ29uZmlnfSkgOiBiYXNlVmVyc2lvbixcbiAgICAgICAgY29uZmxpY3RUcmFja2luZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgZGF0YTogcXVldWVkRGF0YSxcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICByZXNvdXJjZSxcbiAgICAgICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZS5jb25zdHJ1Y3Rvci5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgc3luY1R5cGU6IHJlc29sdmVkU3luY1R5cGVcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICByZXR1cm4gcmVjb3JkXG4gICAgfVxuXG4gICAgY29uc3Qgc3luY1JvdyA9IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAoZGF0YWJhc2VPcGVyYXRpb24pID0+IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVMb2NhbFN5bmMoe1xuICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgZGF0YSxcbiAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICByZXNvdXJjZSxcbiAgICAgIHN5bmNNb2RlbDogZGF0YWJhc2VPcGVyYXRpb24gPyBkYXRhYmFzZU9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWwsXG4gICAgICBzeW5jVHlwZTogcmVzb2x2ZWRTeW5jVHlwZVxuICAgIH0pKVxuXG4gICAgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG5cbiAgICByZXR1cm4gc3luY1Jvd1xuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIGxvY2FsIHN5bmMgcm93cyB0byB0aGUgYmFja2VuZCAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBSb3dzIGFyZSBvbmx5IG1hcmtlZCBzdWNjZXNzZnVsIGFmdGVyIHRoZSBiYWNrZW5kIGFja25vd2xlZGdlcyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcGxheVBlbmRpbmcoKSB7XG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5pc09ubGluZSgpKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnNpbmdsZUZsaWdodChgdmVsb2Npb3VzLXN5bmMtY2xpZW50LXJlcGxheS0ke3RoaXMuX2NsaWVudE51bWJlcn1gLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIGNvbnRpbnVlXG5cbiAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5yZXBsYXlDb25mbGljdFRyYWNrZWRTeW5jcyh7XG4gICAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgcG9zdFJlcGxheTogdGhpcy5jb25maWcucG9zdFJlcGxheSxcbiAgICAgICAgICByZW1vdGVHZW5lcmF0aW9uOiAoaWRlbnRpdHkpID0+IHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCxcbiAgICAgICAgICByZXNvdXJjZVR5cGVcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5yZXBsYXlMb2NhbFN5bmNzKHtcbiAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpLFxuICAgICAgICBiYXRjaFNpemU6IHRoaXMuY29uZmlnLmJhdGNoU2l6ZSxcbiAgICAgICAgcG9zdFJlcGxheTogdGhpcy5jb25maWcucG9zdFJlcGxheSxcbiAgICAgICAgc3luY01vZGVsOiBvcGVyYXRpb24gPyBvcGVyYXRpb24ubW9kZWxDbGFzcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpIDogdGhpcy5jb25maWcuc3luY01vZGVsXG4gICAgICB9KVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gYXV0aG9yaXRhdGl2ZSByZW1vdGUgb2JzZXJ2YXRpb24gc28gYW4gaW4tZmxpZ2h0IGFja25vd2xlZGdlbWVudFxuICAgKiBjYW5ub3QgcmViYXNlIGEgc3VjY2Vzc29yIGFjcm9zcyB0aGF0IG9ic2VydmF0aW9uLlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZUlkOiBzdHJpbmcgfCBudW1iZXIsIHJlc291cmNlVHlwZTogc3RyaW5nLCB2ZXJzaW9uPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbH19IGFyZ3MgLSBSZW1vdGUgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgbm90ZVJlbW90ZVZlcnNpb24oe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZSwgdmVyc2lvbn0pIHtcbiAgICB2b2lkIHZlcnNpb25cbiAgICBjb25zdCBpZGVudGl0eSA9IGAke3Jlc291cmNlVHlwZX06JHtTdHJpbmcocmVzb3VyY2VJZCl9YFxuXG4gICAgdGhpcy5fcmVtb3RlR2VuZXJhdGlvbnMuc2V0KGlkZW50aXR5LCAodGhpcy5fcmVtb3RlR2VuZXJhdGlvbnMuZ2V0KGlkZW50aXR5KSB8fCAwKSArIDEpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGF1dGhvcml0YXRpdmUgYmFzZSB2ZXJzaW9uIG9ic2VydmVkIGJlZm9yZSBhIGxvY2FsIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBWZXJzaW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBCYXNlIHZlcnNpb24uXG4gICAqL1xuICBiYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmIChvcGVyYXRpb24gPT09IFwiY3JlYXRlXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuXG4gICAgaWYgKCF2ZXJzaW9uQXR0cmlidXRlKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdmFsdWUgPSByZWNvcmQucmVhZEF0dHJpYnV0ZSh2ZXJzaW9uQXR0cmlidXRlKVxuXG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY29uZmxpY3QgdmVyc2lvbiAke3ZlcnNpb25BdHRyaWJ1dGV9IG11c3QgYmUgYSBEYXRlLCBzdHJpbmcsIG51bWJlciwgb3IgbnVsbGApXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIHByZS1hc3NpZ25tZW50IHZhbHVlIGV4cG9zZWQgYnkgcmVjb3JkIGNoYW5nZXMgZHVyaW5nIGJlZm9yZVVwZGF0ZS5cbiAgICogRGVsZXRlcyBoYXZlIG5vIHZlcnNpb24gY2hhbmdlIHBhaXIgYW5kIHVzZSB0aGUgcmVjb3JkJ3MgY3VycmVudCB2ZXJzaW9uLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBWZXJzaW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBQcmUtbXV0YXRpb24gYmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgcHJlTXV0YXRpb25CYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGUgPSByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nPy52ZXJzaW9uQXR0cmlidXRlXG4gICAgY29uc3QgdmVyc2lvbkNvbHVtbiA9IHZlcnNpb25BdHRyaWJ1dGVcbiAgICAgID8gcmVjb3JkLmNvbnN0cnVjdG9yLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVt2ZXJzaW9uQXR0cmlidXRlXVxuICAgICAgOiB1bmRlZmluZWRcbiAgICBjb25zdCB2ZXJzaW9uQ2hhbmdlID0gb3BlcmF0aW9uID09PSBcInVwZGF0ZVwiICYmIHZlcnNpb25Db2x1bW5cbiAgICAgID8gcmVjb3JkLmNoYW5nZXMoKVt2ZXJzaW9uQ29sdW1uXVxuICAgICAgOiB1bmRlZmluZWRcblxuICAgIGlmICghdmVyc2lvbkNoYW5nZSkgcmV0dXJuIHRoaXMuYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICBjb25zdCB2YWx1ZSA9IHZlcnNpb25DaGFuZ2VbMF1cblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0IHZlcnNpb24gJHt2ZXJzaW9uQXR0cmlidXRlfSBtdXN0IGJlIGEgRGF0ZSwgc3RyaW5nLCBudW1iZXIsIG9yIG51bGxgKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIHRoZSBiYXNlIGNhcHR1cmVkIGZvciB0aGlzIGxpZmVjeWNsZSBldmVudCBiZWZvcmUgaXRzIGFmdGVyLWNvbW1pdFxuICAgKiBjbG9zdXJlIGlzIGRlZmVycmVkLCBwcmVzZXJ2aW5nIHJlcGVhdGVkIHNhbWUtcmVjb3JkIHdyaXRlcyBpbiBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIENhcHR1cmUgYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IENhcHR1cmVkIGJhc2UgdmVyc2lvbi5cbiAgICovXG4gIGNhcHR1cmVkQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAob3BlcmF0aW9uID09PSBcImNyZWF0ZVwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY2FwdHVyZWRWZXJzaW9ucyA9IHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLmdldChyZWNvcmQpXG4gICAgY29uc3QgYmFzZVZlcnNpb24gPSBjYXB0dXJlZFZlcnNpb25zPy5zaGlmdCgpXG5cbiAgICBpZiAoY2FwdHVyZWRWZXJzaW9ucz8ubGVuZ3RoID09PSAwKSB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5kZWxldGUocmVjb3JkKVxuICAgIGlmIChiYXNlVmVyc2lvbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYmFzZVZlcnNpb25cblxuICAgIHJldHVybiB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNjaGVkdWxlcyBhIGJhY2tncm91bmQgcmVwbGF5IGF0dGVtcHQgd2l0aG91dCBibG9ja2luZyB0aGUgY2FsbGVyLlxuICAgKiBGYWlsdXJlcyBnbyB0byBjb25maWcub25FcnJvciAob3IgcmV0aHJvdyB3aGVuIG5vbmUgaXMgY29uZmlndXJlZCkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2NoZWR1bGVSZXBsYXkoKSB7XG4gICAgdGhpcy5fc2NoZWR1bGVkUmVwbGF5ID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVwbGF5UGVuZGluZygpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLnJlcG9ydEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICB9XG4gICAgfSkoKVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyB0aGUgbGFzdCBzY2hlZHVsZWQgYmFja2dyb3VuZCByZXBsYXkgKHVzZWZ1bCBpbiB0ZXN0cyBhbmQgc2h1dGRvd24gZmxvd3MpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JTY2hlZHVsZWRSZXBsYXkoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFJlcGxheSkgYXdhaXQgdGhpcy5fc2NoZWR1bGVkUmVwbGF5XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIGJhY2tncm91bmQgc3luYyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEJhY2tncm91bmQgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXBvcnRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb25uZWN0aXZpdHkgdGhyb3VnaCB0aGUgY29uZmlndXJlZCBnYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgYmFja2VuZCBpcyBjb25zaWRlcmVkIHJlYWNoYWJsZS5cbiAgICovXG4gIGFzeW5jIGlzT25saW5lKCkge1xuICAgIGlmICghdGhpcy5jb25maWcuaXNPbmxpbmUpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuY29uZmlnLmlzT25saW5lKCkpICE9PSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNjb3BlIHN0b3JlIGJhY2tpbmcgZGVjbGFyZWQgc2NvcGVzIGFuZCBjdXJzb3JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXNjb3BlLXN0b3JlLmpzXCIpLmRlZmF1bHR9IFNjb3BlIHN0b3JlLlxuICAgKi9cbiAgc2NvcGVTdG9yZSgpIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcblxuICAgIGlmICh0aGlzLl9zY29wZVN0b3JlICYmIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiYgdGhpcy5fc2NvcGVTdG9yZS5zdG9yZUlkZW50aXR5ICE9PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHNjb3BlIHN0b3JlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX3Njb3BlU3RvcmUgfHw9IG5ldyBTeW5jU2NvcGVTdG9yZSh7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRIYW5kbGU6IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZVxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fc2NvcGVTdG9yZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkZWNsYXJlZCByZXNvdXJjZSBjb25maWcgZm9yIGEgbG9jYWwgcmVjb3JkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZXNvdXJjZSAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfSBEZWNsYXJlZCByZXNvdXJjZSBjb25maWcuXG4gICAqL1xuICByZXNvdXJjZUNvbmZpZ0ZvcihyZXNvdXJjZSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZT8uY29uc3RydWN0b3JcblxuICAgIGlmICh0eXBlb2YgbW9kZWxDbGFzcz8uZ2V0TW9kZWxOYW1lICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyByZXNvdXJjZXMgbXVzdCBiZSBtb2RlbCByZWNvcmRzIHdpdGggYSBzdGF0aWMgZ2V0TW9kZWxOYW1lKCksIGdvdDogJHtTdHJpbmcocmVzb3VyY2UpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VUeXBlID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV1cblxuICAgIGlmICghcmVzb3VyY2VDb25maWcpIHRocm93IG5ldyBFcnJvcihgTm8gc3luYyByZXNvdXJjZSBjb25maWd1cmVkIGZvcjogJHtyZXNvdXJjZVR5cGV9YClcblxuICAgIHJldHVybiByZXNvdXJjZUNvbmZpZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzeW5jIHR5cGUgZm9yIGEgbXV0YXRpb24gdGhyb3VnaCB0aGUgcmVzb3VyY2UgY29uZmlnLiBUaGVcbiAgICogXCJ1cHNlcnRcIiBmbGFnIHF1ZXVlcyBjcmVhdGVzIGFuZCB1cGRhdGVzIGFzIFwidXBkYXRlXCIgcm93cyAodGhlIHNlcnZlclxuICAgKiB1cHNlcnRzIGJ5IHJlc291cmNlIGlkKSBhbmQgZGVzdHJveXMgYXMgXCJkZWxldGVcIiByb3dzLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBNdXRhdGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTeW5jIHR5cGUuXG4gICAqL1xuICBkZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ29uZmlnLnN5bmNUeXBlID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiByZXNvdXJjZUNvbmZpZy5zeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmR9KVxuICAgIGlmIChvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiKSByZXR1cm4gXCJkZWxldGVcIlxuICAgIGlmIChyZXNvdXJjZUNvbmZpZy5zeW5jVHlwZSA9PT0gXCJ1cHNlcnRcIikgcmV0dXJuIFwidXBkYXRlXCJcblxuICAgIHJldHVybiBvcGVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXJpdmVzIHRoZSBwdWxsLWFwcGx5IHJlc291cmNlIGNvbmZpZ3MgZnJvbSB0aGUgZGVjbGFyZWQgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gW29wZXJhdGlvbl0gLSBUZW5hbnQgb3BlcmF0aW9uIGJpbmRpbmcgdGhlIHJlc291cmNlIG1vZGVsIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+fSBQdWxsLWFwcGx5IHJlc291cmNlIGNvbmZpZ3MuXG4gICAqL1xuICBwdWxsUmVzb3VyY2VDb25maWdzKG9wZXJhdGlvbikge1xuICAgIGlmICghb3BlcmF0aW9uICYmIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3MpIHJldHVybiB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzXG5cbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3MgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz59ICovIChPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpXG4gICAgICAgIC5maWx0ZXIoKFssIHJlc291cmNlXSkgPT4gQm9vbGVhbihyZXNvdXJjZS5hdHRyaWJ1dGVzKSlcbiAgICAgICAgLm1hcCgoW3Jlc291cmNlVHlwZSwgcmVzb3VyY2VdKSA9PiB7XG4gICAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5tb2RlbENsYXNzKHJlc291cmNlLm1vZGVsQ2xhc3MpIDogcmVzb3VyY2UubW9kZWxDbGFzc1xuICAgICAgICAgIGNvbnN0IGZpbmRSZWNvcmQgPSByZXNvdXJjZS5maW5kUmVjb3JkXG4gICAgICAgICAgY29uc3QgZmluZFJlY29yZEZvckRlbGV0ZSA9IHJlc291cmNlLmZpbmRSZWNvcmRGb3JEZWxldGVcblxuICAgICAgICAgIHJldHVybiBbcmVzb3VyY2VUeXBlLCB7XG4gICAgICAgICAgICBhZnRlckFwcGx5OiByZXNvdXJjZS5hZnRlckFwcGx5LFxuICAgICAgICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWdbXCJhdHRyaWJ1dGVzXCJdfSAqLyAocmVzb3VyY2UuYXR0cmlidXRlcyksXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZmluZFJlY29yZDogb3BlcmF0aW9uICYmIGZpbmRSZWNvcmRcbiAgICAgICAgICAgICAgPyAoYXJncykgPT4gZmluZFJlY29yZCh7Li4uYXJncywgbW9kZWxDbGFzcywgb3BlcmF0aW9uOiBvcGVyYXRpb24gfHwgbnVsbH0pXG4gICAgICAgICAgICAgIDogZmluZFJlY29yZCxcbiAgICAgICAgICAgIGZpbmRSZWNvcmRGb3JEZWxldGU6IG9wZXJhdGlvbiAmJiBmaW5kUmVjb3JkRm9yRGVsZXRlXG4gICAgICAgICAgICAgID8gKGFyZ3MpID0+IGZpbmRSZWNvcmRGb3JEZWxldGUoey4uLmFyZ3MsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbjogb3BlcmF0aW9uIHx8IG51bGx9KVxuICAgICAgICAgICAgICA6IGZpbmRSZWNvcmRGb3JEZWxldGUsXG4gICAgICAgICAgICBtb2RlbENsYXNzXG4gICAgICAgICAgfV1cbiAgICAgICAgfSlcbiAgICApKVxuXG4gICAgaWYgKCFvcGVyYXRpb24pIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3MgPSByZXNvdXJjZUNvbmZpZ3NcblxuICAgIHJldHVybiByZXNvdXJjZUNvbmZpZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvY2FsIHN0YXRlIHdvcmsgb24gdGhpcyBjbGllbnQncyBjYXB0dXJlZCB0ZW5hbnQsIG9yIGRpcmVjdGx5IGZvciB0aGUgbGVnYWN5IGRlZmF1bHQtZGF0YWJhc2UgY2xpZW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBCb3VuZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aFRlbmFudE9wZXJhdGlvbihjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5jb25maWcudGVuYW50SGFuZGxlIHx8ICF0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVybiBhd2FpdCBjYWxsYmFjayhudWxsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZS5kYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIG5hbWU6IFwiVGVuYW50IFN5bmNDbGllbnRcIlxuICAgIH0sIGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IG9wZXJhdGlvbi5lbnN1cmVNb2RlbEluaXRpYWxpemVkKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgd2hldGhlciBhIHJlY29yZCBiZWxvbmdzIHRvIHRoaXMgY2xpZW50J3MgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIENhbmRpZGF0ZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoaXMgY2xpZW50IG93bnMgaXQuXG4gICAqL1xuICBvd25zUmVjb3JkKHJlY29yZCkge1xuICAgIGlmICghdGhpcy5fZGF0YWJhc2VJZGVudGl0eSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IGRhdGFiYXNlT3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICAgIHJldHVybiByZWNvcmQuZGF0YWJhc2VJZGVudGl0eSgpID09PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICYmXG4gICAgICBkYXRhYmFzZU9wZXJhdGlvbj8uc2NoZW1hR2VuZXJhdGlvbigpID09PSB0aGlzLl90ZW5hbnRTY2hlbWFHZW5lcmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBhIHJlY29yZCBub3Qgb3duZWQgYnkgdGhpcyBjbGllbnQncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2FuZGlkYXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRSZWNvcmRPd25lcnNoaXAocmVjb3JkKSB7XG4gICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCByZXNvdXJjZSBiZWxvbmdzIHRvIGFub3RoZXIgb3IgdW5yZXNvbHZlZCBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBkZWNsYXJlZCBxdWVyeSBhZ2FpbnN0IHRoaXMgY2xpZW50J3MgY2FwdHVyZWQgdGVuYW50IGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFNjb3BlIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gcXVlcnkuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGhpcy5jb25maWcudGVuYW50SGFuZGxlLnRlbmFudCgpfSlcbiAgICBjb25zdCBxdWVyeURhdGFiYXNlSWRlbnRpdHkgPSBxdWVyeS5fb3BlcmF0aW9uPy5kYXRhYmFzZUlkZW50aXR5KClcblxuICAgIGlmIChkYXRhYmFzZUlkZW50aWZpZXIgIT09IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllciB8fFxuICAgICAgIXRoaXMuY29uZmlnLnJlc291cmNlc1ttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSB8fFxuICAgICAgcXVlcnlEYXRhYmFzZUlkZW50aXR5ICE9PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHNjb3BlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIHdvcmsgYWZ0ZXIgdGhlIGhhbmRsZSdzIHJlYWR5IHBoeXNpY2FsIHNjaGVtYSBnZW5lcmF0aW9uIGNoYW5nZWQgb3IgY2xvc2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFRlbmFudFJlYWR5KCkge1xuICAgIGlmICghdGhpcy5jb25maWcudGVuYW50SGFuZGxlIHx8ICF0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVyblxuXG4gICAgY29uc3QgbGlmZWN5Y2xlID0gdGhpcy5jb25maWcudGVuYW50SGFuZGxlLmluc3BlY3Qoe2RhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyfSlcblxuICAgIGlmICghbGlmZWN5Y2xlLnJlYWR5IHx8ICFsaWZlY3ljbGUuc2NoZW1hR2VuZXJhdGlvbiB8fCBsaWZlY3ljbGUuc2NoZW1hR2VuZXJhdGlvbiAhPT0gdGhpcy5fdGVuYW50U2NoZW1hR2VuZXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCB0ZW5hbnQgZGF0YWJhc2UgZ2VuZXJhdGlvbiBpcyBzdGFsZSBvciBub3QgcmVhZHlcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSBjdXN0b20gcmVtb3RlIHJlc29sdmVyIHJlc3VsdCB0byB0aGUgYWN0aXZlIHRlbmFudCBvcGVyYXRpb24gYWZ0ZXIgcHJvdmluZyBpdHMgY2FwdHVyZWQgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gQmluZGluZyBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJpbmRSZW1vdGVSZWNvcmQoe29wZXJhdGlvbiwgcmVjb3JkfSkge1xuICAgIGlmIChyZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24/LigpID09PSBvcGVyYXRpb24pIHJldHVyblxuICAgIHRoaXMuYXNzZXJ0UmVjb3JkT3duZXJzaGlwKHJlY29yZClcbiAgICBvcGVyYXRpb24uYmluZFJlY29yZChyZWNvcmQpXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgb25lIHJlc291cmNlIGNvbmZpZyBmcm9tIGEgbW9kZWwncyBgc3RhdGljIHN5bmNgIGRlY2xhcmF0aW9uIHBsdXMgaXRzXG4gKiBkZXJpdmVkIGNvbHVtbiBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7e2RlY2xhcmF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLk1vZGVsU3luY0RlY2xhcmF0aW9uLCBtZXRhZGF0YU1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gRGVjbGFyYXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ30gRGVyaXZlZCByZXNvdXJjZSBjb25maWcuXG4gKi9cbmZ1bmN0aW9uIHJlc291cmNlQ29uZmlnRnJvbVN5bmNEZWNsYXJhdGlvbih7ZGVjbGFyYXRpb24sIG1ldGFkYXRhTW9kZWxDbGFzcywgbW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSkge1xuICBjb25zdCBub3JtYWxpemVkRGVjbGFyYXRpb24gPSBkZWNsYXJhdGlvbiA9PT0gdHJ1ZSA/IHt9IDogZGVjbGFyYXRpb25cblxuICBpZiAoIW5vcm1hbGl6ZWREZWNsYXJhdGlvbiB8fCB0eXBlb2Ygbm9ybWFsaXplZERlY2xhcmF0aW9uICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobm9ybWFsaXplZERlY2xhcmF0aW9uKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIG11c3QgYmUgdHJ1ZSBvciBhIHN5bmMgZGVjbGFyYXRpb24gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKGRlY2xhcmF0aW9uKX1gKVxuICB9XG5cbiAgY29uc3Qge2FmdGVyQXBwbHksIGF0dHJpYnV0ZXMsIGJvb2xlYW5BdHRyaWJ1dGVzLCBjb25mbGljdFRyYWNraW5nLCBmaW5kUmVjb3JkLCBmaW5kUmVjb3JkRm9yRGVsZXRlLCBsb2NhbE9ubHlBdHRyaWJ1dGVzLCBwdWJsaXNoLCByZWFsdGltZSwgc3luY1R5cGUsIHRyYWNrLCB0cmFja2VkRGF0YSwgLi4ucmVzdERlY2xhcmF0aW9ufSA9IG5vcm1hbGl6ZWREZWNsYXJhdGlvblxuICBjb25zdCB1bmtub3duS2V5cyA9IE9iamVjdC5rZXlzKHJlc3REZWNsYXJhdGlvbilcblxuICAvLyBgcHVibGlzaGAgaXMgdGhlIHNlcnZlci1zaWRlIGhhbGYgb2YgdGhlIHNoYXJlZCBgc3RhdGljIHN5bmNgIGRlY2xhcmF0aW9uXG4gIC8vIChjb25zdW1lZCBieSBTeW5jUHVibGlzaGVyIG9uIHRoZSBiYWNrZW5kKSAtIHRoZSBjbGllbnQgZGVyaXZlcyBub3RoaW5nXG4gIC8vIGZyb20gaXQsIGJ1dCBtb2RlbHMgZGVjbGFyZWQgb25jZSBmb3IgYm90aCBzaWRlcyBtdXN0IHN0YXkgdmFsaWQgaGVyZS5cbiAgdm9pZCBwdWJsaXNoXG5cbiAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBhZnRlckFwcGx5LCBhdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcywgY29uZmxpY3RUcmFja2luZywgZmluZFJlY29yZCwgZmluZFJlY29yZEZvckRlbGV0ZSwgbG9jYWxPbmx5QXR0cmlidXRlcywgcHVibGlzaCwgcmVhbHRpbWUsIHN5bmNUeXBlLCB0cmFjaywgdHJhY2tlZERhdGEpYClcbiAgfVxuICBpZiAoc3luY1R5cGUgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc3luY1R5cGUgIT09IFwiZnVuY3Rpb25cIiAmJiBzeW5jVHlwZSAhPT0gXCJ1cHNlcnRcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHN5bmNUeXBlIG11c3QgYmUgYSBmdW5jdGlvbiBvciB0aGUgc3RyaW5nIFwidXBzZXJ0XCIsIGdvdDogJHtTdHJpbmcoc3luY1R5cGUpfWApXG4gIH1cblxuICBjb25zdCBkZXJpdmVkID0gZGVyaXZlZFN5bmNBdHRyaWJ1dGVzKHttb2RlbENsYXNzOiBtZXRhZGF0YU1vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pXG5cbiAgaWYgKGNvbmZsaWN0VHJhY2tpbmcpIHZhbGlkYXRlQ29uZmxpY3RUcmFja2luZyh7Y29uZmxpY3RUcmFja2luZywgZGVyaXZlZCwgcmVzb3VyY2VUeXBlfSlcblxuICByZXR1cm4ge1xuICAgIGFmdGVyQXBwbHksXG4gICAgYXR0cmlidXRlcyxcbiAgICBib29sZWFuQXR0cmlidXRlczogbWVyZ2VkQXR0cmlidXRlTmFtZXMoZGVyaXZlZC5ib29sZWFuQXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMpLFxuICAgIGNvbmZsaWN0VHJhY2tpbmc6IGNvbmZsaWN0VHJhY2tpbmcgPyB7Li4uY29uZmxpY3RUcmFja2luZywgdmVyc2lvbkF0dHJpYnV0ZTogY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlIHx8IFwidXBkYXRlZEF0XCJ9IDogdW5kZWZpbmVkLFxuICAgIGZpbmRSZWNvcmQsXG4gICAgZmluZFJlY29yZEZvckRlbGV0ZSxcbiAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBtZXJnZWRBdHRyaWJ1dGVOYW1lcyhcbiAgICAgIGRlcml2ZWQubG9jYWxPbmx5QXR0cmlidXRlcyxcbiAgICAgIFsuLi4obG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSksIC4uLihjb25mbGljdFRyYWNraW5nID8gW2NvbmZsaWN0VHJhY2tpbmcudmVyc2lvbkF0dHJpYnV0ZSB8fCBcInVwZGF0ZWRBdFwiXSA6IFtdKV1cbiAgICApLFxuICAgIG1ldGFkYXRhTW9kZWxDbGFzcyxcbiAgICBtb2RlbENsYXNzLFxuICAgIHJlYWx0aW1lLFxuICAgIHN5bmNUeXBlLFxuICAgIHRyYWNrOiBub3JtYWxpemVkVHJhY2sodHJhY2spLFxuICAgIHRyYWNrZWREYXRhXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgb25lIHJlc291cmNlJ3MgZHVyYWJsZSBjb25mbGljdC10cmFja2luZyBkZWNsYXJhdGlvbi5cbiAqIEBwYXJhbSB7e2NvbmZsaWN0VHJhY2tpbmc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWcsIGRlcml2ZWQ6IHtib29sZWFuQXR0cmlidXRlczogc3RyaW5nW10sIGxvY2FsT25seUF0dHJpYnV0ZXM6IHN0cmluZ1tdfSwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gVmFsaWRhdGlvbiBhcmdzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlQ29uZmxpY3RUcmFja2luZyh7Y29uZmxpY3RUcmFja2luZywgZGVyaXZlZCwgcmVzb3VyY2VUeXBlfSkge1xuICBjb25zdCByZXF1aXJlZFN0cmluZ3MgPSB7XG4gICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgIGFjdG9yVXNlcklkOiBjb25mbGljdFRyYWNraW5nLmFjdG9yVXNlcklkLFxuICAgIG9mZmxpbmVHcmFudElkOiBjb25mbGljdFRyYWNraW5nLm9mZmxpbmVHcmFudElkLFxuICAgIHBvbGljeUhhc2g6IGNvbmZsaWN0VHJhY2tpbmcucG9saWN5SGFzaFxuICB9XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocmVxdWlyZWRTdHJpbmdzKSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgdmFsdWUubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLiR7a2V5fSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ2ApXG4gIH1cbiAgaWYgKCFjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nIHx8IHR5cGVvZiBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLmFwcGVuZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nIG11c3QgYmUgYSBMb2NhbE11dGF0aW9uTG9nYClcbiAgaWYgKHR5cGVvZiBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy5jbGllbnRNdXRhdGlvbklkIG11c3QgYmUgYSBmdW5jdGlvbmApXG4gIGlmICghY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlICYmICFkZXJpdmVkLmxvY2FsT25seUF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJ1cGRhdGVkQXRcIikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nIHJlcXVpcmVzIHZlcnNpb25BdHRyaWJ1dGUgYmVjYXVzZSB0aGUgbW9kZWwgaGFzIG5vIHVwZGF0ZWRBdCBjb2x1bW5gKVxuICB9XG59XG5cbi8qKlxuICogRGVyaXZlcyBib29sZWFuIGFuZCBsb2NhbC1vbmx5IGF0dHJpYnV0ZSBuYW1lcyBmcm9tIGEgbW9kZWwncyBjb2x1bW4gbWV0YWRhdGE6XG4gKiBib29sZWFucyBmcm9tIGJvb2xlYW4gY29sdW1uIHR5cGVzOyBsb2NhbC1vbmx5IGZyb20gdGhlIHByaW1hcnkga2V5LFxuICogY3JlYXRlZEF0L3VwZGF0ZWRBdCwgYW5kIHN5bmMgYm9va2tlZXBpbmcgY29sdW1ucy5cbiAqIEBwYXJhbSB7e21vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBEZXJpdmF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7e2Jvb2xlYW5BdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbG9jYWxPbmx5QXR0cmlidXRlczogc3RyaW5nW119fSBEZXJpdmVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gZGVyaXZlZFN5bmNBdHRyaWJ1dGVzKHttb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KSB7XG4gIGlmIChcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lcyAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZSAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MucHJpbWFyeUtleSAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuaGFzUHJpbWFyeUtleSAhPT0gXCJmdW5jdGlvblwiXG4gICkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHJlcXVpcmVzIGEgVmVsb2Npb3VzIG1vZGVsIGNsYXNzIHdpdGggY29sdW1uIG1ldGFkYXRhIChnZXRDb2x1bW5OYW1lcywgZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCwgZ2V0Q29sdW1uVHlwZUJ5TmFtZSwgcHJpbWFyeUtleSwgaGFzUHJpbWFyeUtleSlgKVxuICB9XG5cbiAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGJvb2xlYW5BdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgbG9jYWxPbmx5QXR0cmlidXRlcyA9IFtdXG5cbiAgaWYgKG1vZGVsQ2xhc3MuaGFzUHJpbWFyeUtleSgpKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShtb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYERlcml2ZWQgc3luYyBhdHRyaWJ1dGVzIGZvciAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgbG9jYWxPbmx5QXR0cmlidXRlcy5wdXNoKGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbcHJpbWFyeUtleUNvbHVtbl0gfHwgcHJpbWFyeUtleUNvbHVtbilcbiAgfVxuXG4gIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzKCkpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb2x1bW5OYW1lXSB8fCBjb2x1bW5OYW1lXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKExPQ0FMX0JPT0tLRUVQSU5HX0FUVFJJQlVURV9OQU1FUy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSAmJiAhbG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgbG9jYWxPbmx5QXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICAgIGlmIChjb2x1bW5UeXBlICYmIGlzQm9vbGVhbkNvbHVtblR5cGUoY29sdW1uVHlwZSkpIHtcbiAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2Jvb2xlYW5BdHRyaWJ1dGVzLCBsb2NhbE9ubHlBdHRyaWJ1dGVzfVxufVxuXG4vKipcbiAqIE1lcmdlcyBkZXJpdmVkIGF0dHJpYnV0ZSBuYW1lcyB3aXRoIGRlY2xhcmVkIGV4dHJhcyBpbnRvIGEgc29ydGVkLCBkdXBsaWNhdGUtZnJlZSBsaXN0LlxuICogQHBhcmFtIHtzdHJpbmdbXX0gZGVyaXZlZCAtIERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gZGVjbGFyZWQgLSBEZWNsYXJlZCBleHRyYSBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IE1lcmdlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG1lcmdlZEF0dHJpYnV0ZU5hbWVzKGRlcml2ZWQsIGRlY2xhcmVkKSB7XG4gIHJldHVybiBbLi4ubmV3IFNldChbLi4uZGVyaXZlZCwgLi4uKGRlY2xhcmVkIHx8IFtdKV0pXS5zb3J0KClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgZGVjbGFyYXRpb24ncyB0cmFjayB2YWx1ZTogYW4gb3BlcmF0aW9ucyBhcnJheSBpcyBzaG9ydGhhbmQgZm9yXG4gKiB0aGUge29wZXJhdGlvbnN9IGZvcm0uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb25Db25maWdbXCJ0cmFja1wiXX0gdHJhY2sgLSBEZWNsYXJlZCB0cmFjayB2YWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ1tcInRyYWNrXCJdfSBOb3JtYWxpemVkIHRyYWNrIHZhbHVlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVkVHJhY2sodHJhY2spIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodHJhY2spKSByZXR1cm4ge29wZXJhdGlvbnM6IHRyYWNrfVxuXG4gIHJldHVybiB0cmFja1xufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyYW1ld29yay1vd25lZCBzeW5jIGVuZHBvaW50IFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydC5cbiAqIEBwYXJhbSB7e3BhdGg6IHN0cmluZywgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50VHJhbnNwb3J0fX0gYXJncyAtIFBvc3RlciBhcmdzLlxuICogQHJldHVybnMgeyhwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBTeW5jIGVuZHBvaW50IFBPU1Rlci5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0UG9zdGVyKHtwYXRoLCByZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0fSkge1xuICByZXR1cm4gYXN5bmMgKHBheWxvYWQpID0+IHtcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlUmVtb3RlUmVxdWVzdENvbnRleHQoe1xuICAgICAgY29udGV4dDogcmVxdWVzdENvbnRleHQsXG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHBhcmFtczogcGF5bG9hZFxuICAgIH0pXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0cmFuc3BvcnQucG9zdChwYXRoLCByZXF1ZXN0UGF5bG9hZClcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlLmpzb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudCB0cmFuc3BvcnQucG9zdCBtdXN0IHJlc29sdmUgdG8gYSByZXNwb25zZSB3aXRoIGEganNvbigpIG1ldGhvZCBmb3IgJHtwYXRofSAobGlrZSB0aGUgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNsaWVudClgKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCByZXNwb25zZS5qc29uKClcbiAgfVxufVxuXG4vKipcbiAqIExhemlseSBidWlsZHMgKGFuZCBtZW1vaXplcyBwZXIgY29uZmlndXJhdGlvbikgdGhlIHN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGVcbiAqIGFwcCdzIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGFuZCByZWdpc3RlcnMgaXQgYXMgdGhlIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gKiBAcGFyYW0ge0NvbmZpZ3VyYXRpb259IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSByZWdpc3RlcmVkIG1vZGVscyBhbmQgdGhlIHN5bmMuY2xpZW50IGJsb2NrLiBEZWZhdWx0cyB0byB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge1N5bmNDbGllbnR9IE1lbW9pemVkIHN5bmMgY2xpZW50IGZvciB0aGUgY29uZmlndXJhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN5bmNDbGllbnQoY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpKSB7XG4gIGxldCBjbGllbnQgPSBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIWNsaWVudCkge1xuICAgIGNsaWVudCA9IFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgICBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgY2xpZW50KVxuICAgIGNsaWVudC5zZXRDdXJyZW50KClcbiAgfVxuXG4gIHJldHVybiBjbGllbnRcbn1cblxuLyoqXG4gKiBEZWNsYXJlcyBhIHN5bmMgc2NvcGUgb24gdGhlIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFF1ZXJ5IGRlY2xhcmluZyB0aGUgc3luYyBzY29wZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtzY29wZTogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlLCBwdWxsZWQ6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbH0+fSBEZWNsYXJlZCBzY29wZSBhbmQgcHVsbCByZXN1bHQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzeW5jKHF1ZXJ5KSB7XG4gIHJldHVybiBhd2FpdCBTeW5jQ2xpZW50LmN1cnJlbnQoKS5zeW5jKHF1ZXJ5KVxufVxuIl19