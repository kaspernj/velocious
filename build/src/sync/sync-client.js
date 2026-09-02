// @ts-check
import Configuration from "../configuration.js";
import { isBooleanColumnType } from "../database/column-types.js";
import Logger from "../logger.js";
import { captureRemoteRequestContext, mergeRemoteRequestContext } from "../remote-request-context.js";
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
        const primaryKeyColumn = modelClass.primaryKey();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUVqRixJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUE7QUFFckIsc0ZBQXNGO0FBQ3RGLE1BQU0sc0JBQXNCLEdBQUcsRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBQyxDQUFBO0FBRXRHOzs7OztvREFLb0Q7QUFDcEQsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV2RCxrR0FBa0c7QUFDbEcsTUFBTSxpQ0FBaUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtBQUV4RixNQUFNLDBCQUEwQixHQUFHO0lBQ2pDLFNBQVM7SUFDVCxxQkFBcUI7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QUE7UUFDdEosQ0FBQztRQUVELE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDOUIsQ0FBQyxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLFVBQVUsQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRTtJQUNoRSxJQUFJLE1BQU0sR0FBRywwQkFBMEIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7SUFFMUQsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ1osTUFBTSxHQUFHLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNwRCwwQkFBMEIsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ3JELE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUNyQixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsSUFBSSxDQUFDLEtBQUs7SUFDOUIsT0FBTyxNQUFNLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDL0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQge2lzQm9vbGVhbkNvbHVtblR5cGV9IGZyb20gXCIuLi9kYXRhYmFzZS9jb2x1bW4tdHlwZXMuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCB7Y2FwdHVyZVJlbW90ZVJlcXVlc3RDb250ZXh0LCBtZXJnZVJlbW90ZVJlcXVlc3RDb250ZXh0fSBmcm9tIFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuXG5pbXBvcnQge3NlcmlhbGl6ZWRTY29wZUZyb21RdWVyeX0gZnJvbSBcIi4vcXVlcnktc2NvcGUuanNcIlxuaW1wb3J0IFN5bmNBcGlDbGllbnQgZnJvbSBcIi4vc3luYy1hcGktY2xpZW50LmpzXCJcbmltcG9ydCBTeW5jUmVhbHRpbWVCcmlkZ2UgZnJvbSBcIi4vc3luYy1yZWFsdGltZS1icmlkZ2UuanNcIlxuaW1wb3J0IFN5bmNTY29wZVN0b3JlIGZyb20gXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIlxuaW1wb3J0IHtjdXJyZW50U3luY0NsaWVudCwgc2V0Q3VycmVudFN5bmNDbGllbnR9IGZyb20gXCIuL3N5bmMtY2xpZW50LXJlZ2lzdHJ5LmpzXCJcblxubGV0IGNsaWVudENvdW50ZXIgPSAwXG5cbi8qKiBAdHlwZSB7e2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIn19ICovXG5jb25zdCBUUkFDS0VEX0NBTExCQUNLX05BTUVTID0ge2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIn1cblxuLyoqXG4gKiBPcGVyYXRpb25zIHRyYWNrZWQgYnkgZGVmYXVsdCBmb3IgbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYVxuICogYHRyYWNrYCBrZXk6IGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcXVldWUgYXV0b21hdGljYWxseS4gRGVzdHJveXMgYXJlIG5vdFxuICogdHJhY2tlZCBieSBkZWZhdWx0IGJlY2F1c2UgYSBsb2NhbCBkZXN0cm95IGlzIG9mdGVuIGNhY2hlIGV2aWN0aW9uIHJhdGhlclxuICogdGhhbiBhIHNlcnZlciBkZWxldGU7IG9wdCBpbiB3aXRoIGB0cmFjazogdHJ1ZWAgb3IgYW4gb3BlcmF0aW9ucyBsaXN0LlxuICogQHR5cGUge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSAqL1xuY29uc3QgREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlMgPSBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl1cblxuLyoqIEF0dHJpYnV0ZSBuYW1lcyB0cmVhdGVkIGFzIGNsaWVudC1sb2NhbCBzeW5jIGJvb2trZWVwaW5nIHdoZW4gZGVyaXZpbmcgbG9jYWxPbmx5QXR0cmlidXRlcy4gKi9cbmNvbnN0IExPQ0FMX0JPT0tLRUVQSU5HX0FUVFJJQlVURV9OQU1FUyA9IFtcImNyZWF0ZWRBdFwiLCBcInVwZGF0ZWRBdFwiLCBcImxhc3RTeW5jQ2hhbmdlQXRcIl1cblxuY29uc3QgU1lOQ19SRVFVRVNUX1JFU0VSVkVEX0tFWVMgPSBbXG4gIFwiYWZ0ZXJJZFwiLFxuICBcImFmdGVyU2VydmVyU2VxdWVuY2VcIixcbiAgXCJhZnRlclVwZGF0ZWRBdFwiLFxuICBcImF1dGhlbnRpY2F0aW9uVG9rZW5cIixcbiAgXCJsaW1pdFwiLFxuICBcInNjb3BlXCIsXG4gIFwic3luY3NcIixcbiAgXCJ1cHN0cmVhbVJlZnJlc2hcIixcbiAgXCJ1cFRvSWRcIixcbiAgXCJ1cFRvU2VydmVyU2VxdWVuY2VcIixcbiAgXCJ1cFRvVXBkYXRlZEF0XCJcbl1cblxuLyoqIEB0eXBlIHtXZWFrTWFwPENvbmZpZ3VyYXRpb24sIFN5bmNDbGllbnQ+fSAqL1xuY29uc3Qgc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogRGVjbGFyYXRpdmUgY2xpZW50LXNpZGUgc3luYyBkcml2ZXIuXG4gKlxuICogRXZlcnl0aGluZyBpcyBkZXJpdmVkIGZyb20gdGhlIGFwcCdzIFZlbG9jaW91cyBjb25maWd1cmF0aW9uOiBtb2RlbHMgZGVjbGFyZVxuICogYHN0YXRpYyBzeW5jYCwgdHJhbnNwb3J0L2F1dGgvY29ubmVjdGl2aXR5IGNvbWUgZnJvbSB0aGUgYHN5bmMuY2xpZW50YFxuICogY29uZmlndXJhdGlvbiBibG9jaywgYW5kIFZlbG9jaW91cyBvd25zIHNjb3BlIHBlcnNpc3RlbmNlLCBwZXItc2NvcGUgY3Vyc29ycyxcbiAqIHB1bGwgcGFnaW5nL2FwcGx5LCBsb2NhbCBxdWV1ZWluZywgYW5kIG9ubGluZS1nYXRlZCByZXBsYXkuIERlY2xhcmUgc3luY1xuICogaW50ZXJlc3QgZnJvbSBxdWVyaWVzOlxuICpcbiAqICAgICBhd2FpdCBzeW5jQ2xpZW50KCkuc3RhcnQoKVxuICogICAgIGF3YWl0IHN5bmNDbGllbnQoKS5zeW5jKEV2ZW50LndoZXJlKHtwYXJ0bmVySWR9KSlcbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0NsaWVudCB7XG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMgY2xpZW50IGJ5IGRlcml2aW5nIGV2ZXJ5dGhpbmcgZnJvbSB0aGUgYXBwJ3MgVmVsb2Npb3VzXG4gICAqIGNvbmZpZ3VyYXRpb246IGV2ZXJ5IHJlZ2lzdGVyZWQgbW9kZWwgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2AgYmVjb21lcyBhXG4gICAqIHJlc291cmNlIHdpdGggYm9vbGVhbkF0dHJpYnV0ZXMgZGVyaXZlZCBmcm9tIGNvbHVtbiB0eXBlcyBhbmRcbiAgICogbG9jYWxPbmx5QXR0cmlidXRlcyBkZXJpdmVkIGZyb20gdGhlIHByaW1hcnkga2V5LCBjcmVhdGVkQXQvdXBkYXRlZEF0LCBhbmRcbiAgICogc3luYyBib29ra2VlcGluZyBjb2x1bW5zOyB0aGUgcGVuZGluZy1zeW5jIG1vZGVsIGlzIHRoZSByZWdpc3RlcmVkIFwiU3luY1wiXG4gICAqIG1vZGVsOyB0cmFuc3BvcnQsIGF1dGgsIGNvbm5lY3Rpdml0eSwgYW5kIGVycm9yIHJlcG9ydGluZyBjb21lIGZyb20gdGhlXG4gICAqIGBzeW5jLmNsaWVudGAgY29uZmlndXJhdGlvbiBibG9jaywgd2l0aCB0aGUgZnJhbWV3b3JrIG93bmluZyB0aGVcbiAgICogYCR7bW91bnRQYXRofS9jaGFuZ2VzYCBhbmQgYCR7bW91bnRQYXRofS9yZXBsYXlgIFBPU1RlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50T3B0aW9uc30gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgZGF0YWJhc2VJZGVudGlmaWVyLCBsZWdhY3lDdXJzb3IsIHJlcXVlc3RDb250ZXh0LCBzY29wZVN0b3JlLCBzeW5jTW9kZWwsIHRlbmFudEhhbmRsZSwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0T3B0aW9ucylcblxuICAgIGNvbnN0IGNsaWVudENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLmdldFN5bmNDb25maWd1cmF0aW9uKCkuY2xpZW50XG4gICAgY29uc3QgY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCA9IGNhcHR1cmVSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwge1xuICAgICAgbGFiZWw6IFwiU3luYyBjbGllbnQgcmVxdWVzdCBjb250ZXh0XCIsXG4gICAgICByZXNlcnZlZEtleXM6IFNZTkNfUkVRVUVTVF9SRVNFUlZFRF9LRVlTXG4gICAgfSlcblxuICAgIGlmICghY2xpZW50Q29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCByZXF1aXJlcyBhIHN5bmMuY2xpZW50IGNvbmZpZ3VyYXRpb24gYmxvY2s6IG5ldyBDb25maWd1cmF0aW9uKHtzeW5jOiB7Y2xpZW50OiB7YXV0aGVudGljYXRpb25Ub2tlbiwgdHJhbnNwb3J0fX19KVwiKVxuICAgIH1cblxuICAgIGlmIChCb29sZWFuKHRlbmFudEhhbmRsZSkgIT09IEJvb2xlYW4oZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCB0ZW5hbnRIYW5kbGUgYW5kIGRhdGFiYXNlSWRlbnRpZmllciBtdXN0IGJlIHByb3ZpZGVkIHRvZ2V0aGVyXCIpXG4gICAgfVxuICAgIGlmICh0ZW5hbnRIYW5kbGUpIHtcbiAgICAgIHRlbmFudEhhbmRsZS5hc3NlcnRDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pXG4gICAgICB0ZW5hbnRIYW5kbGUuZGF0YWJhc2VDb25maWd1cmF0aW9uKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSlcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcmVzb2x2ZWRTeW5jTW9kZWwgPSBzeW5jTW9kZWwgfHwgbW9kZWxDbGFzc2VzLlN5bmNcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gdGVuYW50SGFuZGxlID8gdGVuYW50SGFuZGxlLmRhdGFiYXNlSWRlbnRpdHkoLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpKSA6IG51bGxcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnPn0gKi9cbiAgICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIE9iamVjdC52YWx1ZXMobW9kZWxDbGFzc2VzKSkge1xuICAgICAgaWYgKCFtb2RlbENsYXNzLnN5bmMpIGNvbnRpbnVlXG4gICAgICBpZiAodGVuYW50SGFuZGxlICYmIG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IHRlbmFudEhhbmRsZS50ZW5hbnQoKX0pICE9PSBkYXRhYmFzZUlkZW50aWZpZXIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgY29uc3QgbWV0YWRhdGFNb2RlbENsYXNzID0gdGVuYW50SGFuZGxlXG4gICAgICAgID8gdGVuYW50SGFuZGxlLm1ldGFkYXRhTW9kZWxDbGFzcyh7ZGF0YWJhc2VJZGVudGlmaWVyOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllciksIG1vZGVsQ2xhc3N9KVxuICAgICAgICA6IG1vZGVsQ2xhc3NcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gcmVzb3VyY2VDb25maWdGcm9tU3luY0RlY2xhcmF0aW9uKHtkZWNsYXJhdGlvbjogbW9kZWxDbGFzcy5zeW5jLCBtZXRhZGF0YU1vZGVsQ2xhc3MsIG1vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pXG5cbiAgICAgIGlmIChkYXRhYmFzZUlkZW50aXR5ICYmIHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyA9IHtcbiAgICAgICAgICAuLi5yZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgIG11dGF0aW9uTG9nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnBhcnRpdGlvbihkYXRhYmFzZUlkZW50aXR5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJlc291cmNlc1tyZXNvdXJjZVR5cGVdID0gcmVzb3VyY2VDb25maWdcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMocmVzb3VyY2VzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgZm91bmQgbm8gcmVnaXN0ZXJlZCBtb2RlbHMgZGVjbGFyaW5nIHN0YXRpYyBzeW5jIC0gZGVjbGFyZSBgc3RhdGljIHN5bmMgPSB0cnVlYCAob3IgYSBzeW5jIGRlY2xhcmF0aW9uIG9iamVjdCkgb24gdGhlIG1vZGVscyB0aGF0IHNob3VsZCBzeW5jXCIpXG4gICAgfVxuXG4gICAgaWYgKCFyZXNvbHZlZFN5bmNNb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCByZXF1aXJlcyBhIHJlZ2lzdGVyZWQgXFxcIlN5bmNcXFwiIG1vZGVsIGZvciBwZW5kaW5nIGxvY2FsIHN5bmMgcm93cyAob3IgcGFzcyBvcHRpb25zLnN5bmNNb2RlbClcIilcbiAgICB9XG4gICAgaWYgKHRlbmFudEhhbmRsZSAmJiByZXNvbHZlZFN5bmNNb2RlbC5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGVuYW50SGFuZGxlLnRlbmFudCgpfSkgIT09IGRhdGFiYXNlSWRlbnRpZmllcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHN5bmMgbW9kZWwgZG9lcyBub3QgdXNlIHRlbmFudCBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KGRhdGFiYXNlSWRlbnRpZmllcil9YClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZpZ30gKi9cbiAgICB0aGlzLmNvbmZpZyA9IHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGNsaWVudENvbmZpZ3VyYXRpb24uYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogY2xpZW50Q29uZmlndXJhdGlvbi5iYXRjaFNpemUsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgaXNPbmxpbmU6IGNsaWVudENvbmZpZ3VyYXRpb24uaXNPbmxpbmUsXG4gICAgICBsZWdhY3lDdXJzb3IsXG4gICAgICBvbkVycm9yOiBjbGllbnRDb25maWd1cmF0aW9uLm9uRXJyb3IsXG4gICAgICBwb3N0Q2hhbmdlczogdHJhbnNwb3J0UG9zdGVyKHtwYXRoOiBgJHtjbGllbnRDb25maWd1cmF0aW9uLm1vdW50UGF0aH0vY2hhbmdlc2AsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICBwb3N0UmVwbGF5OiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9yZXBsYXlgLCByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0OiBjbGllbnRDb25maWd1cmF0aW9uLnRyYW5zcG9ydH0pLFxuICAgICAgcmVhbHRpbWU6IGNsaWVudENvbmZpZ3VyYXRpb24ucmVhbHRpbWUsXG4gICAgICByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCxcbiAgICAgIHJlc291cmNlcyxcbiAgICAgIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWwsXG4gICAgICB0ZW5hbnRIYW5kbGUsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQ6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0Q2xpZW50LFxuICAgICAgd2Vic29ja2V0VXJsOiBjbGllbnRDb25maWd1cmF0aW9uLndlYnNvY2tldFVybFxuICAgIH1cbiAgICB0aGlzLl9jbGllbnROdW1iZXIgPSArK2NsaWVudENvdW50ZXJcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ID0gZGF0YWJhc2VJZGVudGl0eVxuICAgIHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb24gPSB0ZW5hbnRIYW5kbGVcbiAgICAgID8gdGVuYW50SGFuZGxlLmluc3BlY3Qoe2RhdGFiYXNlSWRlbnRpZmllcjogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpfSkuc2NoZW1hR2VuZXJhdGlvblxuICAgICAgOiBudWxsXG4gICAgLyoqIEB0eXBlIHtTeW5jUmVhbHRpbWVCcmlkZ2UgfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWx0aW1lQnJpZGdlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U2hhcmVkQ29ubmVjdGlvbiB8IG51bGwgfCB1bmRlZmluZWR9IFNoYXJlZCBhcHAtbGlmZXRpbWUgd2Vic29ja2V0IGNvbm5lY3Rpb24gKHVuZGVmaW5lZCB1bnRpbCBmaXJzdCByZXNvbHZlZCwgbnVsbCB3aGVuIG5vbmUgaXMgY29uZmlndXJlZCkuICovXG4gICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtcInN1YnNjcmliZWRcIiB8IFwic3Vic2NyaWJpbmdcIiB8IFwidW5zdWJzY3JpYmVkXCJ9ICovXG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gICAgdGhpcy5fc2NvcGVTdG9yZSA9IHNjb3BlU3RvcmUgfHwgbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc2NoZWR1bGVkUmVwbGF5ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncyA9IG51bGxcbiAgICAvKiogQHR5cGUge0FycmF5PHtjYWxsYmFjazogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFByb21pc2U8dm9pZD4gfCB2b2lkLCBjYWxsYmFja05hbWU6IFwiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVEZXN0cm95XCIsIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PG9iamVjdD59ICovXG4gICAgdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzID0gbmV3IFdlYWtTZXQoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxvYmplY3QsIEFycmF5PHN0cmluZyB8IG51bWJlciB8IG51bGw+Pn0gKi9cbiAgICB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucyA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aCA9IDBcbiAgICAvKiogQHR5cGUge0xvZ2dlciB8IHtlcnJvcjogKC4uLm1lc3NhZ2VzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8dm9pZD59IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2dnZXIgPSBudWxsXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGF1dG9tYXRpYyBtdXRhdGlvbiB0cmFja2luZyBmb3IgZXZlcnkgZGVjbGFyZWQgcmVzb3VyY2UgKG9uIGJ5XG4gICAqIGRlZmF1bHQ6IGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcXVldWUgcGVuZGluZyBzeW5jIHJvd3Mgb25jZSB0aGVpclxuICAgKiB0cmFuc2FjdGlvbiBjb21taXRzIGFuZCBzY2hlZHVsZSBhbiBpbW1lZGlhdGUgcmVwbGF5IGF0dGVtcHQsIHdpdGhvdXRcbiAgICogYXBwLXNpZGUgcXVldWUgY2FsbHMpLiBgdHJhY2s6IGZhbHNlYCByZXNvdXJjZXMgYXJlIHNraXBwZWQ7IGB0cmFjazogdHJ1ZWBcbiAgICogYWRkcyBkZXN0cm95czsgYW4gb3BlcmF0aW9ucyBsaXN0IG5hcnJvd3MgdGhlIHRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAodGhpcy5fc3RhcnRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydGVkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgY29uc3Qgb3BlcmF0aW9ucyA9IHRoaXMudHJhY2tlZE9wZXJhdGlvbnMoe3Jlc291cmNlQ29uZmlnLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgICBpZiAocmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IFwiY3JlYXRlXCIpKSB7XG4gICAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gb3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIiA/IFwiYmVmb3JlRGVzdHJveVwiIDogXCJiZWZvcmVVcGRhdGVcIlxuICAgICAgICAgIGNvbnN0IGNhbGxiYWNrID0gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIHJlY29yZCkgPT4ge1xuICAgICAgICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICAgICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRWZXJzaW9ucyA9IHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLmdldChyZWNvcmQpIHx8IFtdXG5cbiAgICAgICAgICAgIGNhcHR1cmVkVmVyc2lvbnMucHVzaCh0aGlzLnByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pKVxuICAgICAgICAgICAgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuc2V0KHJlY29yZCwgY2FwdHVyZWRWZXJzaW9ucylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzW2NhbGxiYWNrTmFtZV0oY2FsbGJhY2spXG4gICAgICAgICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrTmFtZSA9IFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVNbb3BlcmF0aW9uXVxuICAgICAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMudHJhY2tlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYWxsIHRyYWNraW5nIGNhbGxiYWNrcyAodGVzdHMsIHNpZ24tb3V0LCBob3QgcmVsb2FkKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdG9wKCkge1xuICAgIGZvciAoY29uc3Qge2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3N9IG9mIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MpIHtcbiAgICAgIG1vZGVsQ2xhc3MudW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcyA9IFtdXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW5kIHZhbGlkYXRlcyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zIGZvciBhIHJlc291cmNlIGNvbmZpZy5cbiAgICogVHJhY2tpbmcgaXMgb24gYnkgZGVmYXVsdDogbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYSBgdHJhY2tgXG4gICAqIGtleSBxdWV1ZSBsb2NhbCBjcmVhdGVzIGFuZCB1cGRhdGVzIGF1dG9tYXRpY2FsbHk7IGB0cmFjazogZmFsc2VgIG9wdHMgYVxuICAgKiBtb2RlbCBvdXQgKGZvciBtb2RlbHMgd3JpdHRlbiBieSBub24tdXNlciBmbG93cykuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUmVzb3VyY2UgY29uZmlnIGFuZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59IFRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICovXG4gIHRyYWNrZWRPcGVyYXRpb25zKHtyZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlfSkge1xuICAgIGNvbnN0IHRyYWNrID0gcmVzb3VyY2VDb25maWcudHJhY2tcblxuICAgIGlmICh0cmFjayA9PT0gZmFsc2UpIHJldHVybiBbXVxuICAgIGlmICh0cmFjayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlNcbiAgICBpZiAodHJhY2sgPT09IHRydWUpIHJldHVybiBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdXG5cbiAgICBpZiAoIXRyYWNrIHx8IHR5cGVvZiB0cmFjayAhPT0gXCJvYmplY3RcIiB8fCAhQXJyYXkuaXNBcnJheSh0cmFjay5vcGVyYXRpb25zKSB8fCB0cmFjay5vcGVyYXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHJlc291cmNlICR7cmVzb3VyY2VUeXBlfSB0cmFjayBtdXN0IGJlIHRydWUgb3Ige29wZXJhdGlvbnM6IFsuLi5dfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgdHJhY2sub3BlcmF0aW9ucykge1xuICAgICAgaWYgKCEob3BlcmF0aW9uIGluIFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCByZXNvdXJjZSAke3Jlc291cmNlVHlwZX0gdHJhY2sub3BlcmF0aW9ucyBtdXN0IGJlIGNyZWF0ZS91cGRhdGUvZGVzdHJveSwgZ290OiAke1N0cmluZyhvcGVyYXRpb24pfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYWNrLm9wZXJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxpZmVjeWNsZSBjYWxsYmFjayBxdWV1ZWluZyBvbmUgdHJhY2tlZCBtdXRhdGlvbi4gVGhlIHF1ZXVlZFxuICAgKiBwYXlsb2FkIGFuZCBzeW5jIHR5cGUgYXJlIHNuYXBzaG90dGVkIGF0IG11dGF0aW9uLWNhbGxiYWNrIHRpbWUsIHNvXG4gICAqIGFmdGVyU2F2ZSBob29rcyBhc3NpZ25pbmcgdW5zYXZlZCBhdHRyaWJ1dGVzIChvciBhbnkgbGF0ZXIgZHJpZnQgb24gdGhlXG4gICAqIHJlY29yZCkgY2Fubm90IGNoYW5nZSB3aGF0IGdldHMgcXVldWVkIHZzIHdoYXQgd2FzIGNvbW1pdHRlZC4gUXVldWVpbmcgaXNcbiAgICogZGVmZXJyZWQgdGhyb3VnaCB0aGUgbW9kZWwgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gaXQgb25seSBydW5zXG4gICAqIG9uY2UgdGhlIG11dGF0aW9uJ3MgdHJhbnNhY3Rpb24gaGFzIGNvbW1pdHRlZCAoaW1tZWRpYXRlbHkgd2hlbiBub1xuICAgKiB0cmFuc2FjdGlvbiBpcyBvcGVuKSAtIHF1ZXVlZCBzeW5jcyBuZXZlciByZWZlcmVuY2Ugcm9sbGVkLWJhY2sgcm93cy5cbiAgICogUG9zdC1jb21taXQgcXVldWUgZmFpbHVyZXMgYXJlIHJlcG9ydGVkIHdpdGhvdXQgcmV0aHJvd2luZyBpbnRvIHRoZVxuICAgKiBkcml2ZXIncyBhZnRlckNvbW1pdCBjaGFpbiAoc2VlIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IpLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBPcGVyYXRpb24gYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMgeyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+fSBMaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqL1xuICB0cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgY29uc3QgZGF0YSA9IFN5bmNBcGlDbGllbnQucXVldWVkU3luY0RhdGEoe1xuICAgICAgICBib29sZWFuQXR0cmlidXRlczogcmVzb3VyY2VDb25maWcuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIGRhdGE6IHJlc291cmNlQ29uZmlnLnRyYWNrZWREYXRhID8gcmVzb3VyY2VDb25maWcudHJhY2tlZERhdGEoe29wZXJhdGlvbiwgcmVjb3JkfSkgOiB1bmRlZmluZWQsXG4gICAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIHJlc291cmNlOiByZWNvcmRcbiAgICAgIH0pXG4gICAgICBjb25zdCBzeW5jVHlwZSA9IHRoaXMuZGVmYXVsdFN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgY29uc3QgYmFzZVZlcnNpb24gPSByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nXG4gICAgICAgID8gdGhpcy5jYXB0dXJlZEJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgICA6IG51bGxcbiAgICAgIGNvbnN0IGRhdGFiYXNlT3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvblNjb3BlID0gZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgICAgPyBkYXRhYmFzZU9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG4gICAgICAgIDogdGhpcy5jb25maWcuc3luY01vZGVsXG5cbiAgICAgIGF3YWl0IHJlY29yZC5jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlQ29uZmxpY3RUcmFja2VkU3luYyh7XG4gICAgICAgICAgICAgIGJhc2VWZXJzaW9uLFxuICAgICAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgIHJlc291cmNlOiByZWNvcmQsXG4gICAgICAgICAgICAgIHJlc291cmNlVHlwZTogcmVjb3JkLmNvbnN0cnVjdG9yLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAgICAgICBzeW5jVHlwZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUxvY2FsU3luYyh7ZGF0YSwgcmVzb3VyY2U6IHJlY29yZCwgc3luY01vZGVsOiBvcGVyYXRpb25TY29wZSwgc3luY1R5cGV9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGEgcG9zdC1jb21taXQgdHJhY2tlZC1xdWV1ZWluZyBmYWlsdXJlLiBUaGUgdHJhbnNhY3Rpb24gaGFzIGFscmVhZHlcbiAgICogY29tbWl0dGVkIHdoZW4gYWZ0ZXJDb21taXQgY2FsbGJhY2tzIHJ1biwgc28gcmV0aHJvd2luZyBoZXJlIHdvdWxkIHBvaXNvblxuICAgKiB0aGUgZHJpdmVyJ3MgYXdhaXRlZCBhZnRlckNvbW1pdCBjaGFpbiAoYnJlYWtpbmcgdW5yZWxhdGVkIGNhbGxiYWNrcykgLVxuICAgKiBpbnN0ZWFkIHRoZSBmYWlsdXJlIGdvZXMgdG8gdGhlIGNvbmZpZ3VyZWQgc3luYy5jbGllbnQub25FcnJvciBob29rLCBvciBpc1xuICAgKiBsb2dnZWQgbG91ZGx5IHRocm91Z2ggdGhlIGNsaWVudCdzIGxvZ2dlciB3aGVuIG5vbmUgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBQb3N0LWNvbW1pdCBxdWV1ZWluZyBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5jb25maWcub25FcnJvcikge1xuICAgICAgdGhpcy5jb25maWcub25FcnJvcihlcnJvcilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIoKS5lcnJvcihcIlN5bmNDbGllbnQgZmFpbGVkIHRvIHF1ZXVlIGEgdHJhY2tlZCBtdXRhdGlvbiBhZnRlciBjb21taXRcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IGNsaWVudCBsb2dnZXIuXG4gICAqIEByZXR1cm5zIHtMb2dnZXIgfCB7ZXJyb3I6ICguLi5tZXNzYWdlczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fX0gQ2xpZW50IGxvZ2dlci5cbiAgICovXG4gIGxvZ2dlcigpIHtcbiAgICB0aGlzLl9sb2dnZXIgfHw9IG5ldyBMb2dnZXIoXCJTeW5jQ2xpZW50XCIsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9ufSlcblxuICAgIHJldHVybiB0aGlzLl9sb2dnZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgcmVjb3JkIGlzIGN1cnJlbnRseSBiZWluZyB3cml0dGVuIGJ5IHB1bGwtYXBwbHkgKGVjaG8gc3VwcHJlc3Npb24pLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZWNvcmQgd3JpdGUgb3JpZ2luYXRlcyBmcm9tIGEgcmVtb3RlIGNoYW5nZS5cbiAgICovXG4gIGlzUmVtb3RlQXBwbHkocmVjb3JkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlbW90ZUFwcGx5UmVjb3Jkcy5oYXMocmVjb3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdHJhY2tlZCBtdXRhdGlvbiBxdWV1ZWluZyBpcyBjdXJyZW50bHkgc3VwcHJlc3NlZCBmb3IgYSByZWNvcmQ6XG4gICAqIGVpdGhlciB0aGUgcmVjb3JkIHdhcyBtYXJrZWQgYXMgYSByZW1vdGUgYXBwbHkgKGBtYXJrUmVtb3RlQXBwbHlgLCB1c2VkIGJ5XG4gICAqIHB1bGwgYW5kIHJlYWx0aW1lIGFwcGxpZXMpIG9yIGEgYHdpdGhvdXRUcmFja2luZ2AgY2FsbGJhY2sgaXMgcnVubmluZyBvblxuICAgKiB0aGlzIGNsaWVudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0cmFja2VkIHF1ZXVlaW5nIGlzIHN1cHByZXNzZWQgZm9yIHRoZSByZWNvcmQuXG4gICAqL1xuICBpc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpIHtcbiAgICByZXR1cm4gdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGggPiAwIHx8IHRoaXMuaXNSZW1vdGVBcHBseShyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIHdpdGggdHJhY2tlZCBtdXRhdGlvbiBxdWV1ZWluZyBzdXBwcmVzc2VkIG9uIHRoaXMgY2xpZW50IC1cbiAgICogZm9yIGNvZGUgYXBwbHlpbmcgc2VydmVyLW9yaWdpbmF0ZWQgZGF0YSBvdXRzaWRlIHRoZSBkZXJpdmVkIHB1bGwvcmVhbHRpbWVcbiAgICogYXBwbGllcnMgKGxlZ2FjeSBwdWxsIHBhdGhzLCBpbXBvcnRlcnMsIHNpZ24taW4gYmFja2ZpbGxzKSwgc28gdGhlaXIgd3JpdGVzXG4gICAqIGFyZSBub3QgZWNob2VkIGJhY2sgdG8gdGhlIHNlcnZlciBhcyBkZXZpY2UgY2hhbmdlcy4gU3VwcHJlc3Npb24gY292ZXJzIHRoZVxuICAgKiB3aG9sZSBhc3luYyBkdXJhdGlvbiBvZiB0aGUgY2FsbGJhY2sgKG5lc3RlZCBjYWxscyBzdGFjaykgYW5kIGlzXG4gICAqIGNsaWVudC13aWRlIHdoaWxlIGl0IHJ1bnM6IG11dGF0aW9ucyBmcm9tIGNvbmN1cnJlbnRseSBydW5uaW5nIHRhc2tzIGFyZVxuICAgKiBhbHNvIHN1cHByZXNzZWQgZm9yIHRoYXQgd2luZG93LCBzbyBwcmVmZXIgYG1hcmtSZW1vdGVBcHBseShyZWNvcmQpYCB3aGVuXG4gICAqIHdyaXRlcyBmcm9tIG90aGVyIGZsb3dzIGNhbiBpbnRlcmxlYXZlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD4gfCBUfSBjYWxsYmFjayAtIFdvcmsgd2hvc2UgbW9kZWwgd3JpdGVzIHNob3VsZCBub3QgcXVldWUgdHJhY2tlZCBzeW5jcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IFRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRob3V0VHJhY2tpbmcoY2FsbGJhY2spIHtcbiAgICB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aCsrXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGgtLVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBvbmUgcmVjb3JkIGFzIGJlaW5nIHdyaXR0ZW4gZnJvbSBzZXJ2ZXItb3JpZ2luYXRlZCBkYXRhIHNvIHRyYWNrZWRcbiAgICogbXV0YXRpb24gcXVldWVpbmcgc2tpcHMgaXQgKHJlY29yZC1wcmVjaXNlIHN1cHByZXNzaW9uKS4gVGhlIGRlcml2ZWQgcHVsbFxuICAgKiBhbmQgcmVhbHRpbWUgYXBwbGllcnMgdXNlIHRoaXMgaW50ZXJuYWxseSBhcm91bmQgZXZlcnkgYXBwbGllZCB3cml0ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTG9jYWwgbW9kZWwgcmVjb3JkIGFib3V0IHRvIGJlIHdyaXR0ZW4uXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSBSZWxlYXNlIGNhbGxiYWNrIHJlLWVuYWJsaW5nIHRyYWNraW5nIGZvciB0aGUgcmVjb3JkLlxuICAgKi9cbiAgbWFya1JlbW90ZUFwcGx5KHJlY29yZCkge1xuICAgIHRoaXMuX3JlbW90ZUFwcGx5UmVjb3Jkcy5hZGQocmVjb3JkKVxuXG4gICAgcmV0dXJuICgpID0+IHRoaXMuX3JlbW90ZUFwcGx5UmVjb3Jkcy5kZWxldGUocmVjb3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGlzIGNsaWVudCBhcyB0aGUgYXBwJ3MgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRDdXJyZW50KCkge1xuICAgIHNldEN1cnJlbnRTeW5jQ2xpZW50KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwJ3MgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1N5bmNDbGllbnR9IEN1cnJlbnQgc3luYyBjbGllbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtTeW5jQ2xpZW50fSAqLyAoY3VycmVudFN5bmNDbGllbnQoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzeW5jIGNsaWVudCBkZXJpdmVkIGZyb20gdGhlIGdpdmVuIGNvbmZpZ3VyYXRpb24uIEFsaWFzIGZvclxuICAgKiBgbmV3IFN5bmNDbGllbnQoe2NvbmZpZ3VyYXRpb24sIC4uLm9wdGlvbnN9KWAuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzIGFuZCB0aGUgc3luYy5jbGllbnQgYmxvY2suIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7T21pdDxpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRPcHRpb25zLCBcImNvbmZpZ3VyYXRpb25cIj59IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICogQHJldHVybnMge1N5bmNDbGllbnR9IFN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBmcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBuZXcgU3luY0NsaWVudCh7Li4ub3B0aW9ucywgY29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgKG9yIHJlLWFjdGl2YXRlcykgYSBzeW5jIHNjb3BlIGZyb20gYSBtb2RlbCBxdWVyeSBhbmQgcHVsbHMgaXQgd2hlbiBvbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgZGVjbGFyaW5nIHRoZSBzeW5jIHNjb3BlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gU3luYyBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSBvZiB0aGUgcHVsbCB0aGlzIGRlY2xhcmF0aW9uIHRyaWdnZXJzLCBzbyB0aGUgaW5pdGlhbCBpbXBvcnQgb2YgYSBuZXdseSBkZWNsYXJlZCBzY29wZSBjYW4gZHJpdmUgYSBcInN5bmNlZENvdW50IG9mIHRvdGFsXCIgcHJvZ3Jlc3MgYmFyLiBTZWUgYHB1bGwoKWAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIE1hcmtzIHRoZSBjaGFuZ2VzIHJlcXVlc3QocykgYXMgYSB1c2VyLWluaXRpYXRlZCByZWZyZXNoLCBzbyB0aGUgc2VydmVyIGNhbiBieXBhc3MgdXBzdHJlYW0taW1wb3J0IHRocm90dGxlIHdpbmRvd3MuIFNlZSBgcHVsbCgpYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3Njb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGUsIHB1bGxlZDogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfT59IERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdCAobnVsbCB3aGlsZSBvZmZsaW5lKS5cbiAgICovXG4gIGFzeW5jIHN5bmMocXVlcnksIHtvblByb2dyZXNzLCB1cHN0cmVhbVJlZnJlc2h9ID0ge30pIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGNvbnN0IHNjb3BlID0gc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KVxuICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgIGNvbnN0IHNjb3BlUm93ID0gYXdhaXQgc2NvcGVTdG9yZS5maW5kT3JDcmVhdGVTY29wZShzY29wZSlcblxuICAgIGlmICghc2NvcGVSb3cuY3Vyc29yUGF5bG9hZCAmJiB0aGlzLmNvbmZpZy5sZWdhY3lDdXJzb3IpIHtcbiAgICAgIGNvbnN0IGxlZ2FjeUN1cnNvclBheWxvYWQgPSBhd2FpdCB0aGlzLmNvbmZpZy5sZWdhY3lDdXJzb3Ioe3Njb3BlfSlcbiAgICAgIGNvbnN0IGxlZ2FjeUN1cnNvciA9IFN5bmNBcGlDbGllbnQuc3luY0N1cnNvckZyb21QYXlsb2FkKGxlZ2FjeUN1cnNvclBheWxvYWQpXG5cbiAgICAgIGlmIChsZWdhY3lDdXJzb3IpIGF3YWl0IHNjb3BlU3RvcmUuc2F2ZUN1cnNvcihzY29wZVJvdywgbGVnYWN5Q3Vyc29yKVxuICAgIH1cblxuICAgIHJldHVybiB7cHVsbGVkOiBhd2FpdCB0aGlzLnB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0pLCBzY29wZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWFjdGl2YXRlcyB0aGUgc3luYyBzY29wZSBkZWNsYXJlZCBieSBhIG1vZGVsIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFF1ZXJ5IHdob3NlIHNjb3BlIHNob3VsZCBzdG9wIHN5bmNpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zeW5jKHF1ZXJ5KSB7XG4gICAgdGhpcy5hc3NlcnRRdWVyeU93bmVyc2hpcChxdWVyeSlcbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5kZWFjdGl2YXRlKHNlcmlhbGl6ZWRTY29wZUZyb21RdWVyeShxdWVyeSkpXG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgY2hhbmdlcyBmb3IgZXZlcnkgYWN0aXZlIHNjb3BlIHdpdGggcGVyLXNjb3BlIGN1cnNvcnMgKHNpbmdsZS1mbGlnaHRlZCwgb25saW5lLWdhdGVkKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFB1bGwgb3B0aW9ucy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFtvcHRpb25zLm9uUHJvZ3Jlc3NdIC0gQ2FsbGVkIHBlciBhcHBsaWVkIHBhZ2Ugd2l0aCBjdW11bGF0aXZlIGB7cGFnZXMsIHN5bmNlZENvdW50LCB0b3RhbH1gIGFjcm9zcyB0aGUgcHVsbGVkIHNjb3BlcywgZm9yIHJlbmRlcmluZyBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIgKGUuZy4gYSBmdWxsLWltcG9ydCBzY3JlZW4pLiBPcHRpb25hbDsgb21pdHRpbmcgaXQga2VlcHMgdGhlIGV4aXN0aW5nIGJlaGF2aW9yLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnVwc3RyZWFtUmVmcmVzaF0gLSBTZW5kcyBgdXBzdHJlYW1SZWZyZXNoOiB0cnVlYCBvbiB0aGUgY2hhbmdlcyByZXF1ZXN0KHMpLCB0ZWxsaW5nIHRoZSBzZXJ2ZXIgdGhpcyBwdWxsIGlzIHVzZXItaW5pdGlhdGVkIHNvIGl0IGNhbiBieXBhc3MgdXBzdHJlYW0taW1wb3J0IHRocm90dGxlIHdpbmRvd3MgKHNlZSBkb2NzL3N5bmMtdXBzdHJlYW0taW1wb3J0cy5tZCkuIEJhY2tncm91bmQgcHVsbHMgb21pdCBpdCBhbmQgc3RheSB0aHJvdHRsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbD59IENvbWJpbmVkIHB1bGwgcmVzdWx0LCBvciBudWxsIHdoaWxlIG9mZmxpbmUuXG4gICAqL1xuICBhc3luYyBwdWxsKHtvblByb2dyZXNzLCB1cHN0cmVhbVJlZnJlc2h9ID0ge30pIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAoIShhd2FpdCB0aGlzLmlzT25saW5lKCkpKSByZXR1cm4gbnVsbFxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9ICovXG4gICAgbGV0IGNvbWJpbmVkUmVzdWx0ID0gbnVsbFxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1wdWxsLSR7dGhpcy5fY2xpZW50TnVtYmVyfWAsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGF1dGhlbnRpY2F0aW9uVG9rZW4gPSBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKClcbiAgICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgICAgY29uc3QgYXBwbHlTeW5jID0gdGhpcy5yZW1vdGVBcHBseVN5bmMoKVxuICAgICAgY29uc3QgcmVzdWx0ID0ge1xuICAgICAgICBjaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgcGFnZXM6IDAsXG4gICAgICAgIHJlc291cmNlQ2hhbmdlZDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKHt9KSxcbiAgICAgICAgcmVzb3VyY2VDb3VudHM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KSxcbiAgICAgICAgc3luY2VkQ291bnQ6IDAsXG4gICAgICAgIHRvdGFsOiAwXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgc2NvcGVSb3cgb2YgYXdhaXQgc2NvcGVTdG9yZS5hY3RpdmVTY29wZXMoKSkge1xuICAgICAgICAvLyBDdW11bGF0ZSBzY29wZSBwcm9ncmVzcyBvbnRvIHRoZSBjb3VudHMgb2YgdGhlIHNjb3BlcyBhbHJlYWR5IHB1bGxlZCBzbyBhIHNpbmdsZVxuICAgICAgICAvLyBzY29wZSdzIHBlci1wYWdlIHByb2dyZXNzIHJlYWRzIGV4YWN0bHkgaXRzIG93biBjb3VudHMgKGJhc2UgMCksIGFuZCBtdWx0aS1zY29wZVxuICAgICAgICAvLyBwdWxscyByZXBvcnQgYSBydW5uaW5nIGN1bXVsYXRpdmUgdG90YWwgYWNyb3NzIGV2ZXJ5IHNjb3BlLlxuICAgICAgICBjb25zdCBiYXNlUGFnZXMgPSByZXN1bHQucGFnZXNcbiAgICAgICAgY29uc3QgYmFzZVN5bmNlZENvdW50ID0gcmVzdWx0LnN5bmNlZENvdW50XG4gICAgICAgIGNvbnN0IGJhc2VUb3RhbCA9IHJlc3VsdC50b3RhbFxuICAgICAgICBjb25zdCBzY29wZVJlc3VsdCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucHVsbENoYW5nZXMoe1xuICAgICAgICAgIGFwcGx5U3luYyxcbiAgICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICAgIGxvYWRDdXJzb3I6IGFzeW5jICgpID0+IGF3YWl0IHNjb3BlU3RvcmUubG9hZEN1cnNvcihzY29wZVJvdyksXG4gICAgICAgICAgb25Qcm9ncmVzczogb25Qcm9ncmVzcyA/IChwcm9ncmVzcykgPT4gb25Qcm9ncmVzcyh7XG4gICAgICAgICAgICBwYWdlczogYmFzZVBhZ2VzICsgcHJvZ3Jlc3MucGFnZXMsXG4gICAgICAgICAgICBzeW5jZWRDb3VudDogYmFzZVN5bmNlZENvdW50ICsgcHJvZ3Jlc3Muc3luY2VkQ291bnQsXG4gICAgICAgICAgICB0b3RhbDogYmFzZVRvdGFsICsgcHJvZ3Jlc3MudG90YWxcbiAgICAgICAgICB9KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBwb3N0Q2hhbmdlczogYXN5bmMgKHBheWxvYWQpID0+IGF3YWl0IHRoaXMuY29uZmlnLnBvc3RDaGFuZ2VzKHtcbiAgICAgICAgICAgIC4uLnBheWxvYWQsXG4gICAgICAgICAgICAvLyBPbmx5IHRoZSBhbGwtdHlwZXMgc2NvcGUgY2FycmllcyB0aGUgdHlwZSBsaXN0OyBhIHR5cGUtZGVjbGFyZWQgc2NvcGUgbmVlZHMgbm9uZS5cbiAgICAgICAgICAgIHNjb3BlOiB7XG4gICAgICAgICAgICAgIGNvbmRpdGlvbnM6IHNjb3BlUm93LmNvbmRpdGlvbnMsXG4gICAgICAgICAgICAgIHJlc291cmNlVHlwZTogc2NvcGVSb3cucmVzb3VyY2VUeXBlLFxuICAgICAgICAgICAgICAuLi4oc2NvcGVSb3cucmVzb3VyY2VUeXBlID09PSBudWxsID8ge3Jlc291cmNlVHlwZXM6IHRoaXMudXNlclNjb3BlUmVzb3VyY2VUeXBlcygpfSA6IHt9KVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC4uLih1cHN0cmVhbVJlZnJlc2ggPyB7dXBzdHJlYW1SZWZyZXNoOiB0cnVlfSA6IHt9KVxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHNhdmVDdXJzb3I6IGFzeW5jIChjdXJzb3IpID0+IGF3YWl0IHNjb3BlU3RvcmUuc2F2ZUN1cnNvcihzY29wZVJvdywgY3Vyc29yKVxuICAgICAgICB9KVxuXG4gICAgICAgIHJlc3VsdC5jaGFuZ2VkIHx8PSBzY29wZVJlc3VsdC5jaGFuZ2VkXG4gICAgICAgIHJlc3VsdC5wYWdlcyArPSBzY29wZVJlc3VsdC5wYWdlc1xuICAgICAgICByZXN1bHQuc3luY2VkQ291bnQgKz0gc2NvcGVSZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgcmVzdWx0LnRvdGFsICs9IHNjb3BlUmVzdWx0LnRvdGFsXG5cbiAgICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCBjb3VudF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDb3VudHMpKSB7XG4gICAgICAgICAgcmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gPSAocmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyBjb3VudFxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgY2hhbmdlZF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDaGFuZ2VkKSkge1xuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gY2hhbmdlZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbWJpbmVkUmVzdWx0ID0gcmVzdWx0XG4gICAgfSlcblxuICAgIHJldHVybiBjb21iaW5lZFJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZGVyaXZlZCByZW1vdGUtY2hhbmdlIGFwcGxpZXIgc2hhcmVkIGJ5IHB1bGxzIGFuZCByZWFsdGltZSBwdXNoZXM6XG4gICAqIGFwcGxpZXMgdGhyb3VnaCB0aGUgZGVjbGFyZWQgcmVzb3VyY2UgY29uZmlncywgcmVnaXN0ZXJzIGVhY2ggd3JpdHRlbiByZWNvcmRcbiAgICogZm9yIGVjaG8gc3VwcHJlc3Npb24gKHRyYWNrZWQgcmVzb3VyY2VzIGRvIG5vdCByZS1xdWV1ZSBhcHBsaWVkIGNoYW5nZXMpLCBhbmRcbiAgICogZmFpbHMgbG91ZGx5IGluc3RlYWQgb2Ygc2lsZW50bHkgc2tpcHBpbmcgdW5jb25maWd1cmVkIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHt7c291cmNlPzogc3RyaW5nfX0gW2FyZ3NdIC0gRXJyb3IgY29udGV4dCBkZXNjcmliaW5nIHdoZXJlIHRoZSBjaGFuZ2UgY2FtZSBmcm9tLlxuICAgKiBAcmV0dXJucyB7KHN5bmM6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VFbnZlbG9wZSkgPT4gUHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBMb3VkIHJlbW90ZS1jaGFuZ2UgYXBwbGllci5cbiAgICovXG4gIHJlbW90ZUFwcGx5U3luYyh7c291cmNlID0gXCJwdWxsZWQgY2hhbmdlXCJ9ID0ge30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHN5bmMpID0+IHtcbiAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IHN5bmMucmVzb3VyY2VUeXBlKClcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWRSZXNvdXJjZSA9IHJlc291cmNlVHlwZSA/IHRoaXMuY29uZmlnLnJlc291cmNlc1tyZXNvdXJjZVR5cGVdIDogdW5kZWZpbmVkXG5cbiAgICAgIGlmICghcmVzb3VyY2VUeXBlIHx8ICFjb25maWd1cmVkUmVzb3VyY2U/LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIHJlc291cmNlIHdpdGggcHVsbCBhdHRyaWJ1dGVzIGNvbmZpZ3VyZWQgZm9yICR7c291cmNlfTogJHtTdHJpbmcocmVzb3VyY2VUeXBlKX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHN5bmMuZGF0YSgpXG4gICAgICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGUgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXS5jb25mbGljdFRyYWNraW5nPy52ZXJzaW9uQXR0cmlidXRlXG5cbiAgICAgICAgaWYgKHZlcnNpb25BdHRyaWJ1dGUpIHtcbiAgICAgICAgICBjb25zdCBkYXRhQXR0cmlidXRlcyA9IGRhdGEgJiYgdHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZGF0YSlcbiAgICAgICAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkYXRhKVxuICAgICAgICAgICAgOiB7fVxuXG4gICAgICAgICAgdGhpcy5ub3RlUmVtb3RlVmVyc2lvbih7cmVzb3VyY2VJZDogU3RyaW5nKHN5bmMucmVzb3VyY2VJZCgpKSwgcmVzb3VyY2VUeXBlLCB2ZXJzaW9uOiBkYXRhQXR0cmlidXRlc1t2ZXJzaW9uQXR0cmlidXRlXX0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwdWxsUmVzb3VyY2VDb25maWdzID0gdGhpcy5wdWxsUmVzb3VyY2VDb25maWdzKG9wZXJhdGlvbilcbiAgICAgICAgY29uc3QgYXBwbGllciA9IFN5bmNBcGlDbGllbnQucmVzb3VyY2VBcHBsaWVyKHB1bGxSZXNvdXJjZUNvbmZpZ3MsIChyZWNvcmQpID0+IHtcbiAgICAgICAgICBpZiAob3BlcmF0aW9uKSB0aGlzLmJpbmRSZW1vdGVSZWNvcmQoe29wZXJhdGlvbiwgcmVjb3JkfSlcblxuICAgICAgICAgIHJldHVybiB0aGlzLm1hcmtSZW1vdGVBcHBseShyZWNvcmQpXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IGFwcGxpZXIoc3luYylcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzaGFyZWQgYXBwLWxpZmV0aW1lIHdlYnNvY2tldCBjb25uZWN0aW9uIGFsbCBzeW5jIHRyYWZmaWNcbiAgICogcmlkZXMsIG9yIG51bGwgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQuIEJ1aWx0IG9uY2UgYW5kIG1lbW9pemVkIChwZXJcbiAgICogY2xpZW50KTogYW4gYXBwLXByb3ZpZGVkIGBzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnRgIGluc3RhbmNlIHdpbnMgKHRoZVxuICAgKiBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgY2FuIHBhc3MgaXRzIG93biBjbGllbnQgc28gb25lIHNvY2tldCBjYXJyaWVzXG4gICAqIGV2ZXJ5dGhpbmcpLCBlbHNlIGEgZnJhbWV3b3JrLW93bmVkIHJlY29ubmVjdGluZyB7QGxpbmsgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fVxuICAgKiBidWlsdCBmcm9tIGBzeW5jLmNsaWVudC53ZWJzb2NrZXRVcmxgLiBUaGUgcmVhbHRpbWUgYnJpZGdlIHJpZGVzIHRoaXNcbiAgICogY29ubmVjdGlvbiB3aXRob3V0IG93bmluZyBpdHMgbGlmZWN5Y2xlOyB3aGVuIG5laXRoZXIgaXMgY29uZmlndXJlZCB0aGVcbiAgICogYnJpZGdlIGZhbGxzIGJhY2sgdG8gdGhlIGRlcHJlY2F0ZWQgcGVyLWN5Y2xlIGByZWFsdGltZS5jcmVhdGVDbGllbnRgLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U2hhcmVkQ29ubmVjdGlvbiB8IG51bGx9IFNoYXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiwgb3IgbnVsbC5cbiAgICovXG4gIHN5bmNDb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9zeW5jQ29ubmVjdGlvbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fc3luY0Nvbm5lY3Rpb25cblxuICAgIGlmICh0aGlzLmNvbmZpZy53ZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gdGhpcy5jb25maWcud2Vic29ja2V0Q2xpZW50XG4gICAgfSBlbHNlIGlmICh0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmwpIHtcbiAgICAgIGNvbnN0IHVybCA9IHR5cGVvZiB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmwgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuY29uZmlnLndlYnNvY2tldFVybCgpIDogdGhpcy5jb25maWcud2Vic29ja2V0VXJsXG5cbiAgICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gdXJsID8gbmV3IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCh7dXJsfSkgOiBudWxsXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gbnVsbFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zeW5jQ29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdGhlIGRlcml2ZWQgcmVhbHRpbWUgY2hhbm5lbHMgc28gcHVzaGVkIHdlYnNvY2tldCBjaGFuZ2VzIGFwcGx5XG4gICAqIHRocm91Z2ggdGhlIHNhbWUgZGVyaXZlZCBhcHBsaWVyIGFzIHB1bGxzIChpZGVtcG90ZW50LCBzaW5nbGUtZmxpZ2h0ZWQpLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbY29udGV4dF0gLSBBcHAgY29udGV4dCBwYXNzZWQgdG8gdGhlIGRlcHJlY2F0ZWQgYHN5bmMuY2xpZW50LnJlYWx0aW1lLmNoYW5uZWxzYCBjYWxsYmFjayAocnVudGltZSBzY29wZSB2YWx1ZXMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN1YnNjcmliZVJlYWx0aW1lKGNvbnRleHQpIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkuc3Vic2NyaWJlKGNvbnRleHQpXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0aGUgc2VydmVyLWVudW1lcmF0ZWQgdXNlciBzY29wZTogXCJldmVyeXRoaW5nIG15IGFiaWxpdHkgY2FuXG4gICAqIHNlZVwiLiBEZWNsYXJlcyBhIHVzZXIgc2NvcGUgKGVtcHR5IGNvbmRpdGlvbnMpIGZvciBldmVyeSBwdWxsYWJsZSBzeW5jZWRcbiAgICogcmVzb3VyY2UgdHlwZSwgc3Vic2NyaWJlcyByZWFsdGltZSBzbyB0aGVpciBmcmFtZXdvcmsgc3luYyBjaGFubmVsXG4gICAqIHN1YnNjcmlwdGlvbnMgZ28gbGl2ZSwgYW5kIHB1bGxzIHNvIHRoZSBkZXZpY2UgY2F0Y2hlcyB1cC4gVGhlIHNlcnZlclxuICAgKiBhdXRob3JpemVzIGVhY2ggZW1wdHktY29uZGl0aW9ucyBzY29wZSB0aHJvdWdoIHRoZSBhcHAgc3luYyByZXNvdXJjZSdzXG4gICAqIGBhdXRob3JpemVDaGFuZ2VzYCBhbmQgcmUtY2hlY2tzIHJlY29yZCBhY2Nlc3MgcGVyIGRlbGl2ZXJ5LCBzbyB0aGUgY2xpZW50XG4gICAqIHN1YnNjcmliZXMgd2l0aCBqdXN0IGl0cyB0b2tlbiBhbmQgdGhlIHNlcnZlciBkZWNpZGVzIG1lbWJlcnNoaXAuXG4gICAqIElkZW1wb3RlbnQgYW5kIHNpbmdsZS1mbGlnaHRlZCBsaWtlIHtAbGluayBTeW5jQ2xpZW50I3N1YnNjcmliZVJlYWx0aW1lfS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdWJzY3JpYmVVc2VyU2NvcGUoKSB7XG4gICAgaWYgKHRoaXMuX3VzZXJTY29wZVN0YXRlID09PSBcInN1YnNjcmliZWRcIikgcmV0dXJuXG5cbiAgICBpZiAoIXRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UpIHtcbiAgICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGUoKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuZCBhY3RpdmF0ZXMgdGhlIHVzZXIgc2NvcGUgZm9yIGV2ZXJ5IHB1bGxhYmxlIHJlc291cmNlLCB0aGVuXG4gICAqIHN1YnNjcmliZXMgcmVhbHRpbWUgYW5kIHB1bGxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9zdWJzY3JpYmVVc2VyU2NvcGUoKSB7XG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInN1YnNjcmliaW5nXCJcblxuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmZpbmRPckNyZWF0ZVNjb3BlKGF3YWl0IHRoaXMudXNlclNjb3BlKCkpXG5cbiAgICBhd2FpdCB0aGlzLnN1YnNjcmliZVJlYWx0aW1lKClcbiAgICBhd2FpdCB0aGlzLnB1bGwoKVxuXG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInN1YnNjcmliZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFVuc3Vic2NyaWJlcyB0aGUgdXNlciBzY29wZTogZGVhY3RpdmF0ZXMgdGhlIHBlci1yZXNvdXJjZSB1c2VyIHNjb3BlcyBhbmRcbiAgICogY2xvc2VzIHRoZSByZWFsdGltZSBjaGFubmVsIHN1YnNjcmlwdGlvbnMuIFRoZSBzaGFyZWQgd2Vic29ja2V0IGNvbm5lY3Rpb25cbiAgICogc3RheXMgb3BlbiB3aGVuIG9uZSBpcyBjb25maWd1cmVkIChzaWduLW91dCBkcm9wcyBzdWJzY3JpcHRpb25zIHdpdGhvdXRcbiAgICogZGlzY29ubmVjdGluZyksIHNvIGEgc3Vic2VxdWVudCBzaWduLWluIHJlc3Vic2NyaWJlcyBvdmVyIHRoZSBzYW1lIHNvY2tldC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN1YnNjcmliZVVzZXJTY29wZSgpIHtcbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5kZWFjdGl2YXRlKGF3YWl0IHRoaXMudXNlclNjb3BlKCkpXG5cbiAgICBhd2FpdCB0aGlzLnVuc3Vic2NyaWJlUmVhbHRpbWUoKVxuXG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdXNlciBzY29wZTogYSBzaW5nbGUgYWxsLXR5cGVzIHNjb3BlIChudWxsIHJlc291cmNlVHlwZSkgd2l0aCBlbXB0eVxuICAgKiBjb25kaXRpb25zLCBwYXJ0aXRpb25lZCBsb2NhbGx5IGJ5IG93bmVyLiBPbmUgc2NvcGUgLSBub3Qgb25lIHBlciByZXNvdXJjZVxuICAgKiB0eXBlIC0gc28gdGhlIHNlcnZlciBhdXRob3JpemVzIHRoZSBjYWxsZXIgb25jZSBwZXIgc3luYyBhbmQgcGVyIHN1YnNjcmliZSxcbiAgICogaG93ZXZlciBtYW55IHJlc291cmNlIHR5cGVzIGl0IHNlcnZlcy4gVGhlIHNlcnZlciBkZWNpZGVzIHdoaWNoIHR5cGVzIHRoZVxuICAgKiBjYWxsZXIgbWF5IHNlZTsgdGhlIGNsaWVudCBhcHBsaWVzIGVhY2ggcHVsbGVkIHJvdyBieSB0aGUgcmVzb3VyY2UgdHlwZSBvblxuICAgKiBpdHMgb3duIGVudmVsb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGU+fSBUaGUgdXNlciBzY29wZS5cbiAgICovXG4gIGFzeW5jIHVzZXJTY29wZSgpIHtcbiAgICByZXR1cm4ge2NvbmRpdGlvbnM6IHt9LCBvd25lcjogYXdhaXQgdGhpcy51c2VyU2NvcGVPd25lcigpLCByZXNvdXJjZVR5cGU6IG51bGx9XG4gIH1cblxuICAvKipcbiAgICogVGhlIHJlc291cmNlIHR5cGVzIHRoZSB1c2VyIHNjb3BlIGNvdmVyczogZXZlcnkgZGVjbGFyZWQgcmVzb3VyY2UgdGhhdFxuICAgKiByZWNlaXZlcyBwdWxsZWQgY2hhbmdlcyAoaGFzIHB1bGwgYGF0dHJpYnV0ZXNgKSwgc28gdGhlIGNsaWVudCBjYW4gYXBwbHlcbiAgICogdGhlbS4gU2VudCB3aXRoIHRoZSBzY29wZSBhcyBhIGRlbGl2ZXJ5L3R5cGUgZmlsdGVyIC0gaXQgbmFycm93cywgbmV2ZXJcbiAgICogd2lkZW5zLCB3aGF0IHRoZSBzZXJ2ZXIncyBhdXRob3JpemF0aW9uIGFscmVhZHkgYWxsb3dzLCBhbmQgaXQga2VlcHMgYVxuICAgKiBicm9hZGNhc3Qgb2YgYSB0eXBlIHRoaXMgY2xpZW50IGNhbm5vdCBhcHBseSBmcm9tIHJlYWNoaW5nIHRoZSBzZXJ2ZXInc1xuICAgKiBwZXItZGVsaXZlcnkgYWNjZXNzIHJlLWNoZWNrIChhIGRhdGFiYXNlIHF1ZXJ5IHBlciBtYXRjaGVkIGJyb2FkY2FzdCwgcGVyXG4gICAqIHN1YnNjcmliZWQgZGV2aWNlKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSBQdWxsYWJsZSByZXNvdXJjZSB0eXBlIG5hbWVzLlxuICAgKi9cbiAgdXNlclNjb3BlUmVzb3VyY2VUeXBlcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5wdWxsUmVzb3VyY2VDb25maWdzKCkpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGxvY2FsIHBhcnRpdGlvbiBrZXkgZm9yIHRoZSB1c2VyIHNjb3BlOiB0aGUgY3VycmVudGx5XG4gICAqIGNvbmZpZ3VyZWQgYXV0aGVudGljYXRlZCBpZGVudGl0eSAodGhlIHN5bmMgYXV0aCB0b2tlbikuIFBhcnRpdGlvbmluZyB0aGVcbiAgICogdXNlciBzY29wZSdzIGxvY2FsIHNjb3BlL2N1cnNvciByb3dzIGJ5IHRoaXMgb3duZXIga2VlcHMgdGhlXG4gICAqIGVtcHR5LWNvbmRpdGlvbnMgY3Vyc29yIGZyb20gbGVha2luZyBhY3Jvc3MgYWNjb3VudHMgb24gYSBzaGFyZWQgZGV2aWNlXG4gICAqIChhY2NvdW50IEIgc2lnbmluZyBpbiBhZnRlciBhY2NvdW50IEEgZ2V0cyBhIGZyZXNoIGN1cnNvcikgd2hpbGUgdGhlIHNhbWVcbiAgICogYWNjb3VudCByZWNvbm5lY3Rpbmcga2VlcHMgaXRzIGN1cnNvciBjb250aW51aXR5LiBUaGUgb3duZXIgaXMgYSBsb2NhbFxuICAgKiBwYXJ0aXRpb24ga2V5IG9ubHkg4oCUIHB1bGxzIHN0aWxsIHBvc3QgZW1wdHkgY29uZGl0aW9ucyB0byB0aGUgc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBVc2VyLXNjb3BlIG93bmVyIHBhcnRpdGlvbiBrZXkuXG4gICAqL1xuICBhc3luYyB1c2VyU2NvcGVPd25lcigpIHtcbiAgICByZXR1cm4gU3RyaW5nKGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBVbnN1YnNjcmliZXMgdGhlIHJlYWx0aW1lIGNoYW5uZWxzIGFuZCBkaXNjb25uZWN0cyB0aGUgd2Vic29ja2V0IGNsaWVudCAoaWRlbXBvdGVudCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zdWJzY3JpYmVSZWFsdGltZSgpIHtcbiAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkudW5zdWJzY3JpYmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgdGhlIHJlYWx0aW1lIHN1YnNjcmlwdGlvbiBzdGF0ZSBhbmQgcGVyLWNoYW5uZWwgcmVhZGluZXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxTeW5jUmVhbHRpbWVCcmlkZ2VbXCJzdGF0dXNcIl0+fSBSZWFsdGltZSBzdGF0dXMuXG4gICAqL1xuICByZWFsdGltZVN0YXR1cygpIHtcbiAgICByZXR1cm4gdGhpcy5yZWFsdGltZUJyaWRnZSgpLnN0YXR1cygpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGFsbCBwZW5kaW5nIHJlYWx0aW1lIG1lc3NhZ2UgYXBwbGllcyBhbmQgYW55IHNjaGVkdWxlZFxuICAgKiBwdWxsLW9uLXJlY29ubmVjdCAodXNlZnVsIGluIHRlc3RzIGFuZCBzaHV0ZG93biBmbG93cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FpdEZvclJlYWx0aW1lQXBwbGllZCgpIHtcbiAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkud2FpdEZvckFwcGxpZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxhemlseSBidWlsdCByZWFsdGltZSBicmlkZ2UuXG4gICAqIEByZXR1cm5zIHtTeW5jUmVhbHRpbWVCcmlkZ2V9IFJlYWx0aW1lIGJyaWRnZS5cbiAgICovXG4gIHJlYWx0aW1lQnJpZGdlKCkge1xuICAgIHRoaXMuX3JlYWx0aW1lQnJpZGdlIHx8PSBuZXcgU3luY1JlYWx0aW1lQnJpZGdlKHtzeW5jQ2xpZW50OiB0aGlzfSlcblxuICAgIHJldHVybiB0aGlzLl9yZWFsdGltZUJyaWRnZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhIGxvY2FsIG1vZGVsIGNoYW5nZSBhcyBhIHBlbmRpbmcgc3luYyByb3cgYW5kIHNjaGVkdWxlcyBhbiBpbW1lZGlhdGVcbiAgICogcmVwbGF5IGF0dGVtcHQgKGtlcHQgcGVuZGluZyB3aGlsZSBvZmZsaW5lIG9yIHdoZW4gdGhlIGJhY2tlbmQgcmVqZWN0cyBpdCkuXG4gICAqIEBwYXJhbSB7e2Jhc2VWZXJzaW9uPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgcmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBkYXRhPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcGVyYXRpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCBzeW5jVHlwZT86IHN0cmluZ319IGFyZ3MgLSBRdWV1ZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSBQZW5kaW5nIGxvY2FsIHN5bmMgcm93IG9yIGR1cmFibGUgY29uZmxpY3QtdHJhY2tlZCBpbnRlbnQuXG4gICAqL1xuICBhc3luYyBxdWV1ZSh7YmFzZVZlcnNpb24sIGRhdGEsIG9wZXJhdGlvbiA9IFwidXBkYXRlXCIsIHJlc291cmNlLCBzeW5jVHlwZX0pIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICB0aGlzLmFzc2VydFJlY29yZE93bmVyc2hpcChyZXNvdXJjZSlcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWdGb3IocmVzb3VyY2UpXG4gICAgY29uc3QgcmVzb2x2ZWRTeW5jVHlwZSA9IHN5bmNUeXBlID8/IHRoaXMuZGVmYXVsdFN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZDogcmVzb3VyY2UsIHJlc291cmNlQ29uZmlnfSlcblxuICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICBjb25zdCBxdWV1ZWREYXRhID0gU3luY0FwaUNsaWVudC5xdWV1ZWRTeW5jRGF0YSh7XG4gICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogcmVzb3VyY2VDb25maWcubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgcmVzb3VyY2VcbiAgICAgIH0pXG4gICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlQ29uZmxpY3RUcmFja2VkU3luYyh7XG4gICAgICAgIGJhc2VWZXJzaW9uOiBiYXNlVmVyc2lvbiA9PT0gdW5kZWZpbmVkID8gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQ6IHJlc291cmNlLCByZXNvdXJjZUNvbmZpZ30pIDogYmFzZVZlcnNpb24sXG4gICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgIGRhdGE6IHF1ZXVlZERhdGEsXG4gICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgcmVzb3VyY2UsXG4gICAgICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2UuY29uc3RydWN0b3IuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIHN5bmNUeXBlOiByZXNvbHZlZFN5bmNUeXBlXG4gICAgICB9KVxuXG4gICAgICB0aGlzLnNjaGVkdWxlUmVwbGF5KClcblxuICAgICAgcmV0dXJuIHJlY29yZFxuICAgIH1cblxuICAgIGNvbnN0IHN5bmNSb3cgPSBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKGRhdGFiYXNlT3BlcmF0aW9uKSA9PiBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlTG9jYWxTeW5jKHtcbiAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgIGRhdGEsXG4gICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgcmVzb3VyY2UsXG4gICAgICBzeW5jTW9kZWw6IGRhdGFiYXNlT3BlcmF0aW9uID8gZGF0YWJhc2VPcGVyYXRpb24ubW9kZWxDbGFzcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpIDogdGhpcy5jb25maWcuc3luY01vZGVsLFxuICAgICAgc3luY1R5cGU6IHJlc29sdmVkU3luY1R5cGVcbiAgICB9KSlcblxuICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgcmV0dXJuIHN5bmNSb3dcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgcGVuZGluZyBsb2NhbCBzeW5jIHJvd3MgdG8gdGhlIGJhY2tlbmQgKHNpbmdsZS1mbGlnaHRlZCwgb25saW5lLWdhdGVkKS5cbiAgICogUm93cyBhcmUgb25seSBtYXJrZWQgc3VjY2Vzc2Z1bCBhZnRlciB0aGUgYmFja2VuZCBhY2tub3dsZWRnZXMgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBsYXlQZW5kaW5nKCkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVyblxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1yZXBsYXktJHt0aGlzLl9jbGllbnROdW1iZXJ9YCwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgcmVzb3VyY2VDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSBjb250aW51ZVxuXG4gICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucmVwbGF5Q29uZmxpY3RUcmFja2VkU3luY3Moe1xuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSxcbiAgICAgICAgICBiYXRjaFNpemU6IHRoaXMuY29uZmlnLmJhdGNoU2l6ZSxcbiAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgIHBvc3RSZXBsYXk6IHRoaXMuY29uZmlnLnBvc3RSZXBsYXksXG4gICAgICAgICAgcmVtb3RlR2VuZXJhdGlvbjogKGlkZW50aXR5KSA9PiB0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5nZXQoaWRlbnRpdHkpIHx8IDAsXG4gICAgICAgICAgcmVzb3VyY2VUeXBlXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucmVwbGF5TG9jYWxTeW5jcyh7XG4gICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSxcbiAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgIHBvc3RSZXBsYXk6IHRoaXMuY29uZmlnLnBvc3RSZXBsYXksXG4gICAgICAgIHN5bmNNb2RlbDogb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3ModGhpcy5jb25maWcuc3luY01vZGVsKSA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuICAgICAgfSlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGF1dGhvcml0YXRpdmUgcmVtb3RlIG9ic2VydmF0aW9uIHNvIGFuIGluLWZsaWdodCBhY2tub3dsZWRnZW1lbnRcbiAgICogY2Fubm90IHJlYmFzZSBhIHN1Y2Nlc3NvciBhY3Jvc3MgdGhhdCBvYnNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VJZDogc3RyaW5nIHwgbnVtYmVyLCByZXNvdXJjZVR5cGU6IHN0cmluZywgdmVyc2lvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGx9fSBhcmdzIC0gUmVtb3RlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHZlcnNpb259KSB7XG4gICAgdm9pZCB2ZXJzaW9uXG4gICAgY29uc3QgaWRlbnRpdHkgPSBgJHtyZXNvdXJjZVR5cGV9OiR7U3RyaW5nKHJlc291cmNlSWQpfWBcblxuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLnNldChpZGVudGl0eSwgKHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCkgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBhdXRob3JpdGF0aXZlIGJhc2UgdmVyc2lvbiBvYnNlcnZlZCBiZWZvcmUgYSBsb2NhbCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gQmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAob3BlcmF0aW9uID09PSBcImNyZWF0ZVwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgIGlmICghdmVyc2lvbkF0dHJpYnV0ZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUodmVyc2lvbkF0dHJpYnV0ZSlcblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0IHZlcnNpb24gJHt2ZXJzaW9uQXR0cmlidXRlfSBtdXN0IGJlIGEgRGF0ZSwgc3RyaW5nLCBudW1iZXIsIG9yIG51bGxgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBwcmUtYXNzaWdubWVudCB2YWx1ZSBleHBvc2VkIGJ5IHJlY29yZCBjaGFuZ2VzIGR1cmluZyBiZWZvcmVVcGRhdGUuXG4gICAqIERlbGV0ZXMgaGF2ZSBubyB2ZXJzaW9uIGNoYW5nZSBwYWlyIGFuZCB1c2UgdGhlIHJlY29yZCdzIGN1cnJlbnQgdmVyc2lvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gUHJlLW11dGF0aW9uIGJhc2UgdmVyc2lvbi5cbiAgICovXG4gIHByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuICAgIGNvbnN0IHZlcnNpb25Db2x1bW4gPSB2ZXJzaW9uQXR0cmlidXRlXG4gICAgICA/IHJlY29yZC5jb25zdHJ1Y3Rvci5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbdmVyc2lvbkF0dHJpYnV0ZV1cbiAgICAgIDogdW5kZWZpbmVkXG4gICAgY29uc3QgdmVyc2lvbkNoYW5nZSA9IG9wZXJhdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiB2ZXJzaW9uQ29sdW1uXG4gICAgICA/IHJlY29yZC5jaGFuZ2VzKClbdmVyc2lvbkNvbHVtbl1cbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIXZlcnNpb25DaGFuZ2UpIHJldHVybiB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgY29uc3QgdmFsdWUgPSB2ZXJzaW9uQ2hhbmdlWzBdXG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCB2ZXJzaW9uICR7dmVyc2lvbkF0dHJpYnV0ZX0gbXVzdCBiZSBhIERhdGUsIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyB0aGUgYmFzZSBjYXB0dXJlZCBmb3IgdGhpcyBsaWZlY3ljbGUgZXZlbnQgYmVmb3JlIGl0cyBhZnRlci1jb21taXRcbiAgICogY2xvc3VyZSBpcyBkZWZlcnJlZCwgcHJlc2VydmluZyByZXBlYXRlZCBzYW1lLXJlY29yZCB3cml0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBDYXB0dXJlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBDYXB0dXJlZCBiYXNlIHZlcnNpb24uXG4gICAqL1xuICBjYXB0dXJlZEJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNhcHR1cmVkVmVyc2lvbnMgPSB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5nZXQocmVjb3JkKVxuICAgIGNvbnN0IGJhc2VWZXJzaW9uID0gY2FwdHVyZWRWZXJzaW9ucz8uc2hpZnQoKVxuXG4gICAgaWYgKGNhcHR1cmVkVmVyc2lvbnM/Lmxlbmd0aCA9PT0gMCkgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZGVsZXRlKHJlY29yZClcbiAgICBpZiAoYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIGJhc2VWZXJzaW9uXG5cbiAgICByZXR1cm4gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgYSBiYWNrZ3JvdW5kIHJlcGxheSBhdHRlbXB0IHdpdGhvdXQgYmxvY2tpbmcgdGhlIGNhbGxlci5cbiAgICogRmFpbHVyZXMgZ28gdG8gY29uZmlnLm9uRXJyb3IgKG9yIHJldGhyb3cgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlUmVwbGF5KCkge1xuICAgIHRoaXMuX3NjaGVkdWxlZFJlcGxheSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJlcGxheVBlbmRpbmcoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5yZXBvcnRFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuICAgICAgfVxuICAgIH0pKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgdGhlIGxhc3Qgc2NoZWR1bGVkIGJhY2tncm91bmQgcmVwbGF5ICh1c2VmdWwgaW4gdGVzdHMgYW5kIHNodXRkb3duIGZsb3dzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB3YWl0Rm9yU2NoZWR1bGVkUmVwbGF5KCkge1xuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRSZXBsYXkpIGF3YWl0IHRoaXMuX3NjaGVkdWxlZFJlcGxheVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBiYWNrZ3JvdW5kIHN5bmMgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBCYWNrZ3JvdW5kIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVwb3J0RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5jb25maWcub25FcnJvcikge1xuICAgICAgdGhpcy5jb25maWcub25FcnJvcihlcnJvcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY29ubmVjdGl2aXR5IHRocm91Z2ggdGhlIGNvbmZpZ3VyZWQgZ2F0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGJhY2tlbmQgaXMgY29uc2lkZXJlZCByZWFjaGFibGUuXG4gICAqL1xuICBhc3luYyBpc09ubGluZSgpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLmlzT25saW5lKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIChhd2FpdCB0aGlzLmNvbmZpZy5pc09ubGluZSgpKSAhPT0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzY29wZSBzdG9yZSBiYWNraW5nIGRlY2xhcmVkIHNjb3BlcyBhbmQgY3Vyc29ycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiKS5kZWZhdWx0fSBTY29wZSBzdG9yZS5cbiAgICovXG4gIHNjb3BlU3RvcmUoKSB7XG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG5cbiAgICBpZiAodGhpcy5fc2NvcGVTdG9yZSAmJiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICYmIHRoaXMuX3Njb3BlU3RvcmUuc3RvcmVJZGVudGl0eSAhPT0gdGhpcy5fZGF0YWJhc2VJZGVudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBzY29wZSBzdG9yZSBiZWxvbmdzIHRvIGFub3RoZXIgb3IgdW5yZXNvbHZlZCBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2VcIilcbiAgICB9XG5cbiAgICB0aGlzLl9zY29wZVN0b3JlIHx8PSBuZXcgU3luY1Njb3BlU3RvcmUoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbixcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgdGVuYW50SGFuZGxlOiB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGVcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXMuX3Njb3BlU3RvcmVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGVjbGFyZWQgcmVzb3VyY2UgY29uZmlnIGZvciBhIGxvY2FsIHJlY29yZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2UgLSBMb2NhbCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ30gRGVjbGFyZWQgcmVzb3VyY2UgY29uZmlnLlxuICAgKi9cbiAgcmVzb3VyY2VDb25maWdGb3IocmVzb3VyY2UpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gcmVzb3VyY2U/LmNvbnN0cnVjdG9yXG5cbiAgICBpZiAodHlwZW9mIG1vZGVsQ2xhc3M/LmdldE1vZGVsTmFtZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgcmVzb3VyY2VzIG11c3QgYmUgbW9kZWwgcmVjb3JkcyB3aXRoIGEgc3RhdGljIGdldE1vZGVsTmFtZSgpLCBnb3Q6ICR7U3RyaW5nKHJlc291cmNlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMuY29uZmlnLnJlc291cmNlc1tyZXNvdXJjZVR5cGVdXG5cbiAgICBpZiAoIXJlc291cmNlQ29uZmlnKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgcmVzb3VyY2UgY29uZmlndXJlZCBmb3I6ICR7cmVzb3VyY2VUeXBlfWApXG5cbiAgICByZXR1cm4gcmVzb3VyY2VDb25maWdcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc3luYyB0eXBlIGZvciBhIG11dGF0aW9uIHRocm91Z2ggdGhlIHJlc291cmNlIGNvbmZpZy4gVGhlXG4gICAqIFwidXBzZXJ0XCIgZmxhZyBxdWV1ZXMgY3JlYXRlcyBhbmQgdXBkYXRlcyBhcyBcInVwZGF0ZVwiIHJvd3MgKHRoZSBzZXJ2ZXJcbiAgICogdXBzZXJ0cyBieSByZXNvdXJjZSBpZCkgYW5kIGRlc3Ryb3lzIGFzIFwiZGVsZXRlXCIgcm93cy5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gTXV0YXRpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZ30gU3luYyB0eXBlLlxuICAgKi9cbiAgZGVmYXVsdFN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZUNvbmZpZy5zeW5jVHlwZSA9PT0gXCJmdW5jdGlvblwiKSByZXR1cm4gcmVzb3VyY2VDb25maWcuc3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkfSlcbiAgICBpZiAob3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIikgcmV0dXJuIFwiZGVsZXRlXCJcbiAgICBpZiAocmVzb3VyY2VDb25maWcuc3luY1R5cGUgPT09IFwidXBzZXJ0XCIpIHJldHVybiBcInVwZGF0ZVwiXG5cbiAgICByZXR1cm4gb3BlcmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogRGVyaXZlcyB0aGUgcHVsbC1hcHBseSByZXNvdXJjZSBjb25maWdzIGZyb20gdGhlIGRlY2xhcmVkIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IG51bGx9IFtvcGVyYXRpb25dIC0gVGVuYW50IG9wZXJhdGlvbiBiaW5kaW5nIHRoZSByZXNvdXJjZSBtb2RlbCBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnPn0gUHVsbC1hcHBseSByZXNvdXJjZSBjb25maWdzLlxuICAgKi9cbiAgcHVsbFJlc291cmNlQ29uZmlncyhvcGVyYXRpb24pIHtcbiAgICBpZiAoIW9wZXJhdGlvbiAmJiB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzKSByZXR1cm4gdGhpcy5fcHVsbFJlc291cmNlQ29uZmlnc1xuXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWdzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+fSAqLyAoT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKVxuICAgICAgICAuZmlsdGVyKChbLCByZXNvdXJjZV0pID0+IEJvb2xlYW4ocmVzb3VyY2UuYXR0cmlidXRlcykpXG4gICAgICAgIC5tYXAoKFtyZXNvdXJjZVR5cGUsIHJlc291cmNlXSkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBvcGVyYXRpb24gPyBvcGVyYXRpb24ubW9kZWxDbGFzcyhyZXNvdXJjZS5tb2RlbENsYXNzKSA6IHJlc291cmNlLm1vZGVsQ2xhc3NcbiAgICAgICAgICBjb25zdCBmaW5kUmVjb3JkID0gcmVzb3VyY2UuZmluZFJlY29yZFxuICAgICAgICAgIGNvbnN0IGZpbmRSZWNvcmRGb3JEZWxldGUgPSByZXNvdXJjZS5maW5kUmVjb3JkRm9yRGVsZXRlXG5cbiAgICAgICAgICByZXR1cm4gW3Jlc291cmNlVHlwZSwge1xuICAgICAgICAgICAgYWZ0ZXJBcHBseTogcmVzb3VyY2UuYWZ0ZXJBcHBseSxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnW1wiYXR0cmlidXRlc1wiXX0gKi8gKHJlc291cmNlLmF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGZpbmRSZWNvcmQ6IG9wZXJhdGlvbiAmJiBmaW5kUmVjb3JkXG4gICAgICAgICAgICAgID8gKGFyZ3MpID0+IGZpbmRSZWNvcmQoey4uLmFyZ3MsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbjogb3BlcmF0aW9uIHx8IG51bGx9KVxuICAgICAgICAgICAgICA6IGZpbmRSZWNvcmQsXG4gICAgICAgICAgICBmaW5kUmVjb3JkRm9yRGVsZXRlOiBvcGVyYXRpb24gJiYgZmluZFJlY29yZEZvckRlbGV0ZVxuICAgICAgICAgICAgICA/IChhcmdzKSA9PiBmaW5kUmVjb3JkRm9yRGVsZXRlKHsuLi5hcmdzLCBtb2RlbENsYXNzLCBvcGVyYXRpb246IG9wZXJhdGlvbiB8fCBudWxsfSlcbiAgICAgICAgICAgICAgOiBmaW5kUmVjb3JkRm9yRGVsZXRlLFxuICAgICAgICAgICAgbW9kZWxDbGFzc1xuICAgICAgICAgIH1dXG4gICAgICAgIH0pXG4gICAgKSlcblxuICAgIGlmICghb3BlcmF0aW9uKSB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzID0gcmVzb3VyY2VDb25maWdzXG5cbiAgICByZXR1cm4gcmVzb3VyY2VDb25maWdzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2NhbCBzdGF0ZSB3b3JrIG9uIHRoaXMgY2xpZW50J3MgY2FwdHVyZWQgdGVuYW50LCBvciBkaXJlY3RseSBmb3IgdGhlIGxlZ2FjeSBkZWZhdWx0LWRhdGFiYXNlIGNsaWVudC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IG51bGwpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQm91bmQgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhUZW5hbnRPcGVyYXRpb24oY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLnRlbmFudEhhbmRsZSB8fCAhdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm4gYXdhaXQgY2FsbGJhY2sobnVsbClcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUuZGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBuYW1lOiBcIlRlbmFudCBTeW5jQ2xpZW50XCJcbiAgICB9LCBhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICBhd2FpdCBvcGVyYXRpb24uZW5zdXJlTW9kZWxJbml0aWFsaXplZCh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIHdoZXRoZXIgYSByZWNvcmQgYmVsb25ncyB0byB0aGlzIGNsaWVudCdzIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDYW5kaWRhdGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGlzIGNsaWVudCBvd25zIGl0LlxuICAgKi9cbiAgb3duc1JlY29yZChyZWNvcmQpIHtcbiAgICBpZiAoIXRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBkYXRhYmFzZU9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgICByZXR1cm4gcmVjb3JkLmRhdGFiYXNlSWRlbnRpdHkoKSA9PT0gdGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJlxuICAgICAgZGF0YWJhc2VPcGVyYXRpb24/LnNjaGVtYUdlbmVyYXRpb24oKSA9PT0gdGhpcy5fdGVuYW50U2NoZW1hR2VuZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgYSByZWNvcmQgbm90IG93bmVkIGJ5IHRoaXMgY2xpZW50J3MgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIENhbmRpZGF0ZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UmVjb3JkT3duZXJzaGlwKHJlY29yZCkge1xuICAgIGlmICghdGhpcy5vd25zUmVjb3JkKHJlY29yZCkpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgcmVzb3VyY2UgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgZGVjbGFyZWQgcXVlcnkgYWdhaW5zdCB0aGlzIGNsaWVudCdzIGNhcHR1cmVkIHRlbmFudCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBTY29wZSBxdWVyeS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRRdWVyeU93bmVyc2hpcChxdWVyeSkge1xuICAgIGlmICghdGhpcy5jb25maWcudGVuYW50SGFuZGxlIHx8ICF0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVyblxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHF1ZXJ5LmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZS50ZW5hbnQoKX0pXG4gICAgY29uc3QgcXVlcnlEYXRhYmFzZUlkZW50aXR5ID0gcXVlcnkuX29wZXJhdGlvbj8uZGF0YWJhc2VJZGVudGl0eSgpXG5cbiAgICBpZiAoZGF0YWJhc2VJZGVudGlmaWVyICE9PSB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIgfHxcbiAgICAgICF0aGlzLmNvbmZpZy5yZXNvdXJjZXNbbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKV0gfHxcbiAgICAgIHF1ZXJ5RGF0YWJhc2VJZGVudGl0eSAhPT0gdGhpcy5fZGF0YWJhc2VJZGVudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBzY29wZSBiZWxvbmdzIHRvIGFub3RoZXIgb3IgdW5yZXNvbHZlZCBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2VcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyB3b3JrIGFmdGVyIHRoZSBoYW5kbGUncyByZWFkeSBwaHlzaWNhbCBzY2hlbWEgZ2VuZXJhdGlvbiBjaGFuZ2VkIG9yIGNsb3NlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRUZW5hbnRSZWFkeSgpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLnRlbmFudEhhbmRsZSB8fCAhdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm5cblxuICAgIGNvbnN0IGxpZmVjeWNsZSA9IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZS5pbnNwZWN0KHtkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcn0pXG5cbiAgICBpZiAoIWxpZmVjeWNsZS5yZWFkeSB8fCAhbGlmZWN5Y2xlLnNjaGVtYUdlbmVyYXRpb24gfHwgbGlmZWN5Y2xlLnNjaGVtYUdlbmVyYXRpb24gIT09IHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgdGVuYW50IGRhdGFiYXNlIGdlbmVyYXRpb24gaXMgc3RhbGUgb3Igbm90IHJlYWR5XCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgY3VzdG9tIHJlbW90ZSByZXNvbHZlciByZXN1bHQgdG8gdGhlIGFjdGl2ZSB0ZW5hbnQgb3BlcmF0aW9uIGFmdGVyIHByb3ZpbmcgaXRzIGNhcHR1cmVkIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0LCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIEJpbmRpbmcgYXJncy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBiaW5kUmVtb3RlUmVjb3JkKHtvcGVyYXRpb24sIHJlY29yZH0pIHtcbiAgICBpZiAocmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uPy4oKSA9PT0gb3BlcmF0aW9uKSByZXR1cm5cbiAgICB0aGlzLmFzc2VydFJlY29yZE93bmVyc2hpcChyZWNvcmQpXG4gICAgb3BlcmF0aW9uLmJpbmRSZWNvcmQocmVjb3JkKVxuICB9XG59XG5cbi8qKlxuICogQnVpbGRzIG9uZSByZXNvdXJjZSBjb25maWcgZnJvbSBhIG1vZGVsJ3MgYHN0YXRpYyBzeW5jYCBkZWNsYXJhdGlvbiBwbHVzIGl0c1xuICogZGVyaXZlZCBjb2x1bW4gbWV0YWRhdGEuXG4gKiBAcGFyYW0ge3tkZWNsYXJhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbiwgbWV0YWRhdGFNb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlY2xhcmF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlcml2ZWQgcmVzb3VyY2UgY29uZmlnLlxuICovXG5mdW5jdGlvbiByZXNvdXJjZUNvbmZpZ0Zyb21TeW5jRGVjbGFyYXRpb24oe2RlY2xhcmF0aW9uLCBtZXRhZGF0YU1vZGVsQ2xhc3MsIG1vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZERlY2xhcmF0aW9uID0gZGVjbGFyYXRpb24gPT09IHRydWUgPyB7fSA6IGRlY2xhcmF0aW9uXG5cbiAgaWYgKCFub3JtYWxpemVkRGVjbGFyYXRpb24gfHwgdHlwZW9mIG5vcm1hbGl6ZWREZWNsYXJhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG5vcm1hbGl6ZWREZWNsYXJhdGlvbikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBtdXN0IGJlIHRydWUgb3IgYSBzeW5jIGRlY2xhcmF0aW9uIG9iamVjdCwgZ290OiAke1N0cmluZyhkZWNsYXJhdGlvbil9YClcbiAgfVxuXG4gIGNvbnN0IHthZnRlckFwcGx5LCBhdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcywgY29uZmxpY3RUcmFja2luZywgZmluZFJlY29yZCwgZmluZFJlY29yZEZvckRlbGV0ZSwgbG9jYWxPbmx5QXR0cmlidXRlcywgcHVibGlzaCwgcmVhbHRpbWUsIHN5bmNUeXBlLCB0cmFjaywgdHJhY2tlZERhdGEsIC4uLnJlc3REZWNsYXJhdGlvbn0gPSBub3JtYWxpemVkRGVjbGFyYXRpb25cbiAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0RGVjbGFyYXRpb24pXG5cbiAgLy8gYHB1Ymxpc2hgIGlzIHRoZSBzZXJ2ZXItc2lkZSBoYWxmIG9mIHRoZSBzaGFyZWQgYHN0YXRpYyBzeW5jYCBkZWNsYXJhdGlvblxuICAvLyAoY29uc3VtZWQgYnkgU3luY1B1Ymxpc2hlciBvbiB0aGUgYmFja2VuZCkgLSB0aGUgY2xpZW50IGRlcml2ZXMgbm90aGluZ1xuICAvLyBmcm9tIGl0LCBidXQgbW9kZWxzIGRlY2xhcmVkIG9uY2UgZm9yIGJvdGggc2lkZXMgbXVzdCBzdGF5IHZhbGlkIGhlcmUuXG4gIHZvaWQgcHVibGlzaFxuXG4gIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYWZ0ZXJBcHBseSwgYXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMsIGNvbmZsaWN0VHJhY2tpbmcsIGZpbmRSZWNvcmQsIGZpbmRSZWNvcmRGb3JEZWxldGUsIGxvY2FsT25seUF0dHJpYnV0ZXMsIHB1Ymxpc2gsIHJlYWx0aW1lLCBzeW5jVHlwZSwgdHJhY2ssIHRyYWNrZWREYXRhKWApXG4gIH1cbiAgaWYgKHN5bmNUeXBlICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHN5bmNUeXBlICE9PSBcImZ1bmN0aW9uXCIgJiYgc3luY1R5cGUgIT09IFwidXBzZXJ0XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBzeW5jVHlwZSBtdXN0IGJlIGEgZnVuY3Rpb24gb3IgdGhlIHN0cmluZyBcInVwc2VydFwiLCBnb3Q6ICR7U3RyaW5nKHN5bmNUeXBlKX1gKVxuICB9XG5cbiAgY29uc3QgZGVyaXZlZCA9IGRlcml2ZWRTeW5jQXR0cmlidXRlcyh7bW9kZWxDbGFzczogbWV0YWRhdGFNb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KVxuXG4gIGlmIChjb25mbGljdFRyYWNraW5nKSB2YWxpZGF0ZUNvbmZsaWN0VHJhY2tpbmcoe2NvbmZsaWN0VHJhY2tpbmcsIGRlcml2ZWQsIHJlc291cmNlVHlwZX0pXG5cbiAgcmV0dXJuIHtcbiAgICBhZnRlckFwcGx5LFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgYm9vbGVhbkF0dHJpYnV0ZXM6IG1lcmdlZEF0dHJpYnV0ZU5hbWVzKGRlcml2ZWQuYm9vbGVhbkF0dHJpYnV0ZXMsIGJvb2xlYW5BdHRyaWJ1dGVzKSxcbiAgICBjb25mbGljdFRyYWNraW5nOiBjb25mbGljdFRyYWNraW5nID8gey4uLmNvbmZsaWN0VHJhY2tpbmcsIHZlcnNpb25BdHRyaWJ1dGU6IGNvbmZsaWN0VHJhY2tpbmcudmVyc2lvbkF0dHJpYnV0ZSB8fCBcInVwZGF0ZWRBdFwifSA6IHVuZGVmaW5lZCxcbiAgICBmaW5kUmVjb3JkLFxuICAgIGZpbmRSZWNvcmRGb3JEZWxldGUsXG4gICAgbG9jYWxPbmx5QXR0cmlidXRlczogbWVyZ2VkQXR0cmlidXRlTmFtZXMoXG4gICAgICBkZXJpdmVkLmxvY2FsT25seUF0dHJpYnV0ZXMsXG4gICAgICBbLi4uKGxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10pLCAuLi4oY29uZmxpY3RUcmFja2luZyA/IFtjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgfHwgXCJ1cGRhdGVkQXRcIl0gOiBbXSldXG4gICAgKSxcbiAgICBtZXRhZGF0YU1vZGVsQ2xhc3MsXG4gICAgbW9kZWxDbGFzcyxcbiAgICByZWFsdGltZSxcbiAgICBzeW5jVHlwZSxcbiAgICB0cmFjazogbm9ybWFsaXplZFRyYWNrKHRyYWNrKSxcbiAgICB0cmFja2VkRGF0YVxuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIG9uZSByZXNvdXJjZSdzIGR1cmFibGUgY29uZmxpY3QtdHJhY2tpbmcgZGVjbGFyYXRpb24uXG4gKiBAcGFyYW0ge3tjb25mbGljdFRyYWNraW5nOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnLCBkZXJpdmVkOiB7Ym9vbGVhbkF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBzdHJpbmdbXX0sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIFZhbGlkYXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiB2YWxpZGF0ZUNvbmZsaWN0VHJhY2tpbmcoe2NvbmZsaWN0VHJhY2tpbmcsIGRlcml2ZWQsIHJlc291cmNlVHlwZX0pIHtcbiAgY29uc3QgcmVxdWlyZWRTdHJpbmdzID0ge1xuICAgIGFjdG9yRGV2aWNlSWQ6IGNvbmZsaWN0VHJhY2tpbmcuYWN0b3JEZXZpY2VJZCxcbiAgICBhY3RvclVzZXJJZDogY29uZmxpY3RUcmFja2luZy5hY3RvclVzZXJJZCxcbiAgICBvZmZsaW5lR3JhbnRJZDogY29uZmxpY3RUcmFja2luZy5vZmZsaW5lR3JhbnRJZCxcbiAgICBwb2xpY3lIYXNoOiBjb25mbGljdFRyYWNraW5nLnBvbGljeUhhc2hcbiAgfVxuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlcXVpcmVkU3RyaW5ncykpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy4ke2tleX0gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdgKVxuICB9XG4gIGlmICghY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZyB8fCB0eXBlb2YgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5hcHBlbmQgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZyBtdXN0IGJlIGEgTG9jYWxNdXRhdGlvbkxvZ2ApXG4gIGlmICh0eXBlb2YgY29uZmxpY3RUcmFja2luZy5jbGllbnRNdXRhdGlvbklkICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcuY2xpZW50TXV0YXRpb25JZCBtdXN0IGJlIGEgZnVuY3Rpb25gKVxuICBpZiAoIWNvbmZsaWN0VHJhY2tpbmcudmVyc2lvbkF0dHJpYnV0ZSAmJiAhZGVyaXZlZC5sb2NhbE9ubHlBdHRyaWJ1dGVzLmluY2x1ZGVzKFwidXBkYXRlZEF0XCIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZyByZXF1aXJlcyB2ZXJzaW9uQXR0cmlidXRlIGJlY2F1c2UgdGhlIG1vZGVsIGhhcyBubyB1cGRhdGVkQXQgY29sdW1uYClcbiAgfVxufVxuXG4vKipcbiAqIERlcml2ZXMgYm9vbGVhbiBhbmQgbG9jYWwtb25seSBhdHRyaWJ1dGUgbmFtZXMgZnJvbSBhIG1vZGVsJ3MgY29sdW1uIG1ldGFkYXRhOlxuICogYm9vbGVhbnMgZnJvbSBib29sZWFuIGNvbHVtbiB0eXBlczsgbG9jYWwtb25seSBmcm9tIHRoZSBwcmltYXJ5IGtleSxcbiAqIGNyZWF0ZWRBdC91cGRhdGVkQXQsIGFuZCBzeW5jIGJvb2trZWVwaW5nIGNvbHVtbnMuXG4gKiBAcGFyYW0ge3ttb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gRGVyaXZhdGlvbiBhcmdzLlxuICogQHJldHVybnMge3tib29sZWFuQXR0cmlidXRlczogc3RyaW5nW10sIGxvY2FsT25seUF0dHJpYnV0ZXM6IHN0cmluZ1tdfX0gRGVyaXZlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIGRlcml2ZWRTeW5jQXR0cmlidXRlcyh7bW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSkge1xuICBpZiAoXG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZXMgIT09IFwiZnVuY3Rpb25cIiB8fFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAgIT09IFwiZnVuY3Rpb25cIiB8fFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUgIT09IFwiZnVuY3Rpb25cIiB8fFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLnByaW1hcnlLZXkgIT09IFwiZnVuY3Rpb25cIiB8fFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmhhc1ByaW1hcnlLZXkgIT09IFwiZnVuY3Rpb25cIlxuICApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyByZXF1aXJlcyBhIFZlbG9jaW91cyBtb2RlbCBjbGFzcyB3aXRoIGNvbHVtbiBtZXRhZGF0YSAoZ2V0Q29sdW1uTmFtZXMsIGdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAsIGdldENvbHVtblR5cGVCeU5hbWUsIHByaW1hcnlLZXksIGhhc1ByaW1hcnlLZXkpYClcbiAgfVxuXG4gIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBib29sZWFuQXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGxvY2FsT25seUF0dHJpYnV0ZXMgPSBbXVxuXG4gIGlmIChtb2RlbENsYXNzLmhhc1ByaW1hcnlLZXkoKSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW4gPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgbG9jYWxPbmx5QXR0cmlidXRlcy5wdXNoKGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbcHJpbWFyeUtleUNvbHVtbl0gfHwgcHJpbWFyeUtleUNvbHVtbilcbiAgfVxuXG4gIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzKCkpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb2x1bW5OYW1lXSB8fCBjb2x1bW5OYW1lXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKExPQ0FMX0JPT0tLRUVQSU5HX0FUVFJJQlVURV9OQU1FUy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSAmJiAhbG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgbG9jYWxPbmx5QXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICAgIGlmIChjb2x1bW5UeXBlICYmIGlzQm9vbGVhbkNvbHVtblR5cGUoY29sdW1uVHlwZSkpIHtcbiAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2Jvb2xlYW5BdHRyaWJ1dGVzLCBsb2NhbE9ubHlBdHRyaWJ1dGVzfVxufVxuXG4vKipcbiAqIE1lcmdlcyBkZXJpdmVkIGF0dHJpYnV0ZSBuYW1lcyB3aXRoIGRlY2xhcmVkIGV4dHJhcyBpbnRvIGEgc29ydGVkLCBkdXBsaWNhdGUtZnJlZSBsaXN0LlxuICogQHBhcmFtIHtzdHJpbmdbXX0gZGVyaXZlZCAtIERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gZGVjbGFyZWQgLSBEZWNsYXJlZCBleHRyYSBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IE1lcmdlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG1lcmdlZEF0dHJpYnV0ZU5hbWVzKGRlcml2ZWQsIGRlY2xhcmVkKSB7XG4gIHJldHVybiBbLi4ubmV3IFNldChbLi4uZGVyaXZlZCwgLi4uKGRlY2xhcmVkIHx8IFtdKV0pXS5zb3J0KClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgZGVjbGFyYXRpb24ncyB0cmFjayB2YWx1ZTogYW4gb3BlcmF0aW9ucyBhcnJheSBpcyBzaG9ydGhhbmQgZm9yXG4gKiB0aGUge29wZXJhdGlvbnN9IGZvcm0uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb25Db25maWdbXCJ0cmFja1wiXX0gdHJhY2sgLSBEZWNsYXJlZCB0cmFjayB2YWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ1tcInRyYWNrXCJdfSBOb3JtYWxpemVkIHRyYWNrIHZhbHVlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVkVHJhY2sodHJhY2spIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodHJhY2spKSByZXR1cm4ge29wZXJhdGlvbnM6IHRyYWNrfVxuXG4gIHJldHVybiB0cmFja1xufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyYW1ld29yay1vd25lZCBzeW5jIGVuZHBvaW50IFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydC5cbiAqIEBwYXJhbSB7e3BhdGg6IHN0cmluZywgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50VHJhbnNwb3J0fX0gYXJncyAtIFBvc3RlciBhcmdzLlxuICogQHJldHVybnMgeyhwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBTeW5jIGVuZHBvaW50IFBPU1Rlci5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0UG9zdGVyKHtwYXRoLCByZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0fSkge1xuICByZXR1cm4gYXN5bmMgKHBheWxvYWQpID0+IHtcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlUmVtb3RlUmVxdWVzdENvbnRleHQoe1xuICAgICAgY29udGV4dDogcmVxdWVzdENvbnRleHQsXG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHBhcmFtczogcGF5bG9hZFxuICAgIH0pXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0cmFuc3BvcnQucG9zdChwYXRoLCByZXF1ZXN0UGF5bG9hZClcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlLmpzb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudCB0cmFuc3BvcnQucG9zdCBtdXN0IHJlc29sdmUgdG8gYSByZXNwb25zZSB3aXRoIGEganNvbigpIG1ldGhvZCBmb3IgJHtwYXRofSAobGlrZSB0aGUgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNsaWVudClgKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCByZXNwb25zZS5qc29uKClcbiAgfVxufVxuXG4vKipcbiAqIExhemlseSBidWlsZHMgKGFuZCBtZW1vaXplcyBwZXIgY29uZmlndXJhdGlvbikgdGhlIHN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGVcbiAqIGFwcCdzIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGFuZCByZWdpc3RlcnMgaXQgYXMgdGhlIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gKiBAcGFyYW0ge0NvbmZpZ3VyYXRpb259IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSByZWdpc3RlcmVkIG1vZGVscyBhbmQgdGhlIHN5bmMuY2xpZW50IGJsb2NrLiBEZWZhdWx0cyB0byB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLlxuICogQHJldHVybnMge1N5bmNDbGllbnR9IE1lbW9pemVkIHN5bmMgY2xpZW50IGZvciB0aGUgY29uZmlndXJhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN5bmNDbGllbnQoY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpKSB7XG4gIGxldCBjbGllbnQgPSBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIWNsaWVudCkge1xuICAgIGNsaWVudCA9IFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgICBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgY2xpZW50KVxuICAgIGNsaWVudC5zZXRDdXJyZW50KClcbiAgfVxuXG4gIHJldHVybiBjbGllbnRcbn1cblxuLyoqXG4gKiBEZWNsYXJlcyBhIHN5bmMgc2NvcGUgb24gdGhlIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFF1ZXJ5IGRlY2xhcmluZyB0aGUgc3luYyBzY29wZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtzY29wZTogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlLCBwdWxsZWQ6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbH0+fSBEZWNsYXJlZCBzY29wZSBhbmQgcHVsbCByZXN1bHQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzeW5jKHF1ZXJ5KSB7XG4gIHJldHVybiBhd2FpdCBTeW5jQ2xpZW50LmN1cnJlbnQoKS5zeW5jKHF1ZXJ5KVxufVxuIl19