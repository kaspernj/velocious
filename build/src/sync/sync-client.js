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
/** Expected cooperative cancellation raised by a SyncClient lifecycle transition. */
export class SyncClientLifecycleAbortError extends Error {
    /**
     * Builds an expected lifecycle cancellation error.
     * @param {string} message - Lifecycle cancellation reason.
     */
    constructor(message) {
        super(message);
        this.name = "SyncClientLifecycleAbortError";
    }
}
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
        /** @type {Set<Promise<unknown>>} */
        this._activeLifecycleWork = new Set();
        this._lifecycleAbortController = new AbortController();
        this._lifecycleTransitionCount = 0;
        /** @type {Promise<void>} */
        this._lifecycleTransitionPromise = Promise.resolve();
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
        await this._lifecycleTransitionPromise;
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
     * Unregisters all tracking callbacks, aborts in-flight pull/replay/realtime
     * work and resolves after it is quiescent. Optional selected scope reset and
     * app-owned cleanup happen after old work drains.
     * @param {import("./sync-client-types.js").SyncClientStopOptions} [options] - Stop and selected-scope reset options.
     * @returns {Promise<void>}
     */
    stop(options = {}) {
        for (const { callback, callbackName, modelClass } of this._trackedCallbacks) {
            modelClass.unregisterLifecycleCallback(callbackName, callback);
        }
        this._trackedCallbacks = [];
        this._started = false;
        return this._runLifecycleTransition(async () => {
            await this._resetScopesForLifecycle(options);
        });
    }
    /**
     * Aborts and drains current work, then atomically resets selected scope
     * cursors together with an optional app-owned local-row cleanup hook.
     * Tracking declarations remain registered so the same client may continue.
     * @param {import("./sync-client-types.js").SerializedSyncScope[]} scopes - Selected scopes to reset.
     * @param {{cleanup?: import("./sync-client-types.js").SyncClientScopeCleanup}} [options] - Scope cleanup options.
     * @returns {Promise<void>}
     */
    async resetScopes(scopes, options = {}) {
        await this._runLifecycleTransition(async () => {
            await this._resetScopesForLifecycle({ ...options, resetScopes: scopes });
        });
    }
    /**
     * Atomically replaces the external identity read by the configured auth and
     * scope-owner resolvers: old work is aborted and drained, selected private
     * scope state/cache is reset, then the app's replacement callback runs while
     * new sync work remains behind the lifecycle barrier. Optionally subscribes
     * the new user scope before resolving.
     * @param {import("./sync-client-types.js").SyncClientReplaceIdentityOptions} options - Identity replacement contract.
     * @returns {Promise<void>}
     */
    async replaceIdentity(options) {
        if (!options || typeof options !== "object" || Array.isArray(options)) {
            throw new Error("SyncClient.replaceIdentity requires an options object");
        }
        const { cleanup, replace, resetScopes = [], subscribeUserScope = false, ...restOptions } = options;
        restArgsError(restOptions);
        if (typeof replace !== "function")
            throw new Error("SyncClient.replaceIdentity requires a replace callback");
        if (typeof subscribeUserScope !== "boolean")
            throw new Error("SyncClient.replaceIdentity subscribeUserScope must be boolean");
        await this._runLifecycleTransition(async () => {
            await this._resetScopesForLifecycle({ cleanup, resetScopes });
            await replace();
        });
        if (subscribeUserScope)
            await this.subscribeUserScope();
    }
    /**
     * Runs one callback while holding the current lifecycle generation and
     * tracks it so stop/reset/identity replacement can await quiescence.
     * @template Result
     * @param {(signal: AbortSignal) => Promise<Result>} callback - Generation-bound work.
     * @returns {Promise<Result>} Callback result.
     */
    async _runLifecycleWork(callback) {
        if (this._lifecycleTransitionCount > 0)
            await this._lifecycleTransitionPromise;
        const signal = this._lifecycleAbortController.signal;
        this._throwIfLifecycleAborted(signal);
        const promise = callback(signal);
        this._activeLifecycleWork.add(promise);
        try {
            return await promise;
        }
        finally {
            this._activeLifecycleWork.delete(promise);
        }
    }
    /**
     * Serializes a lifecycle barrier: cooperatively aborts transport/start work,
     * stops new realtime delivery, awaits old applies/replays/pulls, rejects on
     * unexpected old-work failures, then runs the reset/replacement callback.
     * @param {() => Promise<void>} callback - Transition action after quiescence.
     * @returns {Promise<void>}
     */
    _runLifecycleTransition(callback) {
        this._lifecycleTransitionCount += 1;
        const previousTransition = this._lifecycleTransitionPromise;
        const transition = previousTransition.then(async () => {
            const abortController = this._lifecycleAbortController;
            const abortReason = new SyncClientLifecycleAbortError("Sync client lifecycle was stopped");
            abortController.abort(abortReason);
            if (this._realtimeBridge) {
                await this._realtimeBridge.unsubscribe();
            }
            const workResults = await Promise.allSettled([...this._activeLifecycleWork]);
            if (this._realtimeBridge)
                await this._realtimeBridge.waitForApplied();
            /** @type {unknown[]} */
            const unexpectedErrors = [];
            for (const result of workResults) {
                if (result.status === "rejected" && !this.isLifecycleAbort(result.reason))
                    unexpectedErrors.push(result.reason);
            }
            if (unexpectedErrors.length === 1)
                throw unexpectedErrors[0];
            if (unexpectedErrors.length > 1)
                throw new AggregateError(unexpectedErrors, "Sync client lifecycle failed while becoming quiescent");
            await callback();
        }).finally(() => {
            this._lifecycleAbortController = new AbortController();
            this._lifecycleTransitionCount -= 1;
            this._userScopeState = "unsubscribed";
            this._subscribeUserScopePromise = null;
        });
        this._lifecycleTransitionPromise = transition.then(() => undefined, () => undefined);
        return transition;
    }
    /**
     * Resets selected scopes through the framework-owned store.
     * @param {import("./sync-client-types.js").SyncClientStopOptions} options - Reset options.
     * @returns {Promise<void>}
     */
    async _resetScopesForLifecycle(options) {
        const { cleanup, resetScopes = [], ...restOptions } = options;
        restArgsError(restOptions);
        if (!Array.isArray(resetScopes))
            throw new Error("Sync client resetScopes must be an array");
        if (cleanup !== undefined && typeof cleanup !== "function")
            throw new Error("Sync client cleanup must be a function");
        if (cleanup && resetScopes.length === 0)
            throw new Error("Sync client cleanup requires at least one reset scope");
        if (resetScopes.length === 0)
            return;
        await this.scopeStore().reset(resetScopes, { cleanup });
    }
    /**
     * Whether an error is the framework's narrow expected lifecycle abort.
     * @param {unknown} error - Candidate error.
     * @returns {boolean} Whether the error is an expected lifecycle abort.
     */
    isLifecycleAbort(error) {
        return error instanceof SyncClientLifecycleAbortError;
    }
    /**
     * Throws the current lifecycle reason when the signal is aborted.
     * @param {AbortSignal} signal - Lifecycle signal.
     * @returns {void}
     */
    _throwIfLifecycleAborted(signal) {
        if (!signal.aborted)
            return;
        throw signal.reason instanceof Error ? signal.reason : new SyncClientLifecycleAbortError("Sync client lifecycle was stopped");
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
        return await this._runLifecycleWork(async (signal) => await this._pull({ onProgress, signal, upstreamRefresh }));
    }
    /**
     * Pull implementation bound to one lifecycle generation.
     * @param {object} args - Pull args.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [args.onProgress] - Progress callback.
     * @param {AbortSignal} args.signal - Lifecycle cancellation signal.
     * @param {boolean} [args.upstreamRefresh] - User-initiated upstream refresh marker.
     * @returns {Promise<import("./sync-api-client-types.js").SyncChangesResult | null>} Combined pull result, or null while offline.
     */
    async _pull({ onProgress, signal, upstreamRefresh }) {
        this._throwIfLifecycleAborted(signal);
        this.assertTenantReady();
        if (!(await this.isOnline()))
            return null;
        this._throwIfLifecycleAborted(signal);
        /** @type {import("./sync-api-client-types.js").SyncChangesResult | null} */
        let combinedResult = null;
        await SyncApiClient.singleFlight(`velocious-sync-client-pull-${this._clientNumber}`, async () => {
            this._throwIfLifecycleAborted(signal);
            const authenticationToken = await this.config.authenticationToken();
            this._throwIfLifecycleAborted(signal);
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
                this._throwIfLifecycleAborted(signal);
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
                    postChanges: async (payload, options) => await this.config.postChanges({
                        ...payload,
                        // Only the all-types scope carries the type list; a type-declared scope needs none.
                        scope: {
                            conditions: scopeRow.conditions,
                            resourceType: scopeRow.resourceType,
                            ...(scopeRow.resourceType === null ? { resourceTypes: this.userScopeResourceTypes() } : {})
                        },
                        ...(upstreamRefresh ? { upstreamRefresh: true } : {})
                    }, options),
                    saveCursor: async (cursor) => await scopeStore.saveCursor(scopeRow, cursor),
                    signal
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
        this._throwIfLifecycleAborted(signal);
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
        await this._runLifecycleWork(async (signal) => {
            this.assertTenantReady();
            await this.realtimeBridge().subscribe(context, { signal });
            this._throwIfLifecycleAborted(signal);
        });
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
            this._subscribeUserScopePromise = this._runLifecycleWork(async (signal) => await this._subscribeUserScope(signal)).finally(() => {
                this._subscribeUserScopePromise = null;
            });
        }
        await this._subscribeUserScopePromise;
    }
    /**
     * Declares and activates the user scope for every pullable resource, then
     * subscribes realtime and pulls.
     * @param {AbortSignal} signal - Lifecycle cancellation signal.
     * @returns {Promise<void>}
     */
    async _subscribeUserScope(signal) {
        this._userScopeState = "subscribing";
        try {
            await this.scopeStore().findOrCreateScope(await this.userScope());
            this._throwIfLifecycleAborted(signal);
            await this.subscribeRealtime();
            this._throwIfLifecycleAborted(signal);
            await this.pull();
            this._throwIfLifecycleAborted(signal);
            this._userScopeState = "subscribed";
        }
        catch (error) {
            this._userScopeState = "unsubscribed";
            throw error;
        }
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
        await this._runLifecycleWork(async (signal) => await this._replayPending(signal));
    }
    /**
     * Replay implementation bound to one lifecycle generation.
     * @param {AbortSignal} signal - Lifecycle cancellation signal.
     * @returns {Promise<void>}
     */
    async _replayPending(signal) {
        this._throwIfLifecycleAborted(signal);
        this.assertTenantReady();
        if (!(await this.isOnline()))
            return;
        this._throwIfLifecycleAborted(signal);
        await SyncApiClient.singleFlight(`velocious-sync-client-replay-${this._clientNumber}`, async () => await this.withTenantOperation(async (operation) => {
            this._throwIfLifecycleAborted(signal);
            for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
                if (!resourceConfig.conflictTracking)
                    continue;
                await SyncApiClient.replayConflictTrackedSyncs({
                    authenticationToken: await this.config.authenticationToken(),
                    batchSize: this.config.batchSize,
                    conflictTracking: resourceConfig.conflictTracking,
                    postReplay: this.config.postReplay,
                    remoteGeneration: (identity) => this._remoteGenerations.get(identity) || 0,
                    resourceType,
                    signal
                });
            }
            this._throwIfLifecycleAborted(signal);
            await SyncApiClient.replayLocalSyncs({
                authenticationToken: await this.config.authenticationToken(),
                batchSize: this.config.batchSize,
                postReplay: this.config.postReplay,
                signal,
                syncModel: operation ? operation.modelClass(this.config.syncModel) : this.config.syncModel
            });
        }));
        this._throwIfLifecycleAborted(signal);
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
                if (this.isLifecycleAbort(error))
                    return;
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
 * @returns {(payload: Record<string, ReturnType<typeof JSON.parse>>, options?: {signal?: AbortSignal}) => Promise<ReturnType<typeof JSON.parse>>} Sync endpoint POSTer.
 */
function transportPoster({ path, requestContext, transport }) {
    return async (payload, options = {}) => {
        const requestPayload = mergeRemoteRequestContext({
            context: requestContext,
            label: "Sync client request context",
            params: payload
        });
        const response = await transport.post(path, requestPayload, { signal: options.signal });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ25FLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUVqRixJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUE7QUFFckIsc0ZBQXNGO0FBQ3RGLE1BQU0sc0JBQXNCLEdBQUcsRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBQyxDQUFBO0FBRXRHOzs7OztvREFLb0Q7QUFDcEQsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV2RCxrR0FBa0c7QUFDbEcsTUFBTSxpQ0FBaUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtBQUV4RixNQUFNLDBCQUEwQixHQUFHO0lBQ2pDLFNBQVM7SUFDVCxxQkFBcUI7SUFDckIsZ0JBQWdCO0lBQ2hCLHFCQUFxQjtJQUNyQixPQUFPO0lBQ1AsT0FBTztJQUNQLE9BQU87SUFDUCxpQkFBaUI7SUFDakIsUUFBUTtJQUNSLG9CQUFvQjtJQUNwQixlQUFlO0NBQ2hCLENBQUE7QUFFRCxpREFBaUQ7QUFDakQsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRWhELHFGQUFxRjtBQUNyRixNQUFNLE9BQU8sNkJBQThCLFNBQVEsS0FBSztJQUN0RDs7O09BR0c7SUFDSCxZQUFZLE9BQU87UUFDakIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRywrQkFBK0IsQ0FBQTtJQUM3QyxDQUFDO0NBQ0Y7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sVUFBVTtJQUM3Qjs7Ozs7Ozs7OztPQVVHO0lBQ0gsWUFBWSxPQUFPLEdBQUcsRUFBRTtRQUN0QixNQUFNLEVBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUUsRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLEdBQUcsV0FBVyxFQUFDLEdBQUcsT0FBTyxDQUFBO1FBRWhLLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUUxQixNQUFNLG1CQUFtQixHQUFHLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLE1BQU0sQ0FBQTtRQUN2RSxNQUFNLHNCQUFzQixHQUFHLDJCQUEyQixDQUFDLGNBQWMsRUFBRTtZQUN6RSxLQUFLLEVBQUUsNkJBQTZCO1lBQ3BDLFlBQVksRUFBRSwwQkFBMEI7U0FDekMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7WUFDekIsTUFBTSxJQUFJLEtBQUssQ0FBQyw4SEFBOEgsQ0FBQyxDQUFBO1FBQ2pKLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxPQUFPLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1lBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsMEVBQTBFLENBQUMsQ0FBQTtRQUM3RixDQUFDO1FBQ0QsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixZQUFZLENBQUMsbUJBQW1CLENBQUMsYUFBYSxDQUFDLENBQUE7WUFDL0MsWUFBWSxDQUFDLHFCQUFxQixDQUFDLHFCQUFxQixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFBO1FBQ2hGLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDcEQsTUFBTSxpQkFBaUIsR0FBRyxTQUFTLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQTtRQUN4RCxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLHFCQUFxQixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDeEgsd0ZBQXdGO1FBQ3hGLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUk7Z0JBQUUsU0FBUTtZQUM5QixJQUFJLFlBQVksSUFBSSxVQUFVLENBQUMscUJBQXFCLENBQUMsRUFBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLE1BQU0sRUFBRSxFQUFDLENBQUMsS0FBSyxrQkFBa0I7Z0JBQUUsU0FBUTtZQUV0SCxNQUFNLFlBQVksR0FBRyxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUE7WUFFOUMsTUFBTSxrQkFBa0IsR0FBRyxZQUFZO2dCQUNyQyxDQUFDLENBQUMsWUFBWSxDQUFDLGtCQUFrQixDQUFDLEVBQUMsa0JBQWtCLEVBQUUscUJBQXFCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLFVBQVUsRUFBQyxDQUFDO2dCQUMvRyxDQUFDLENBQUMsVUFBVSxDQUFBO1lBQ2QsTUFBTSxjQUFjLEdBQUcsaUNBQWlDLENBQUMsRUFBQyxXQUFXLEVBQUUsVUFBVSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtZQUV0SSxJQUFJLGdCQUFnQixJQUFJLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUN4RCxjQUFjLENBQUMsZ0JBQWdCLEdBQUc7b0JBQ2hDLEdBQUcsY0FBYyxDQUFDLGdCQUFnQjtvQkFDbEMsV0FBVyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLGdCQUFnQixDQUFDO2lCQUNyRixDQUFBO1lBQ0gsQ0FBQztZQUVELFNBQVMsQ0FBQyxZQUFZLENBQUMsR0FBRyxjQUFjLENBQUE7UUFDMUMsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQywwSkFBMEosQ0FBQyxDQUFBO1FBQzdLLENBQUM7UUFFRCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksS0FBSyxDQUFDLHlHQUF5RyxDQUFDLENBQUE7UUFDNUgsQ0FBQztRQUNELElBQUksWUFBWSxJQUFJLGlCQUFpQixDQUFDLHFCQUFxQixDQUFDLEVBQUMsTUFBTSxFQUFFLFlBQVksQ0FBQyxNQUFNLEVBQUUsRUFBQyxDQUFDLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztZQUNwSCxNQUFNLElBQUksS0FBSyxDQUFDLHNEQUFzRCxJQUFJLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzdHLENBQUM7UUFFRCxnRUFBZ0U7UUFDaEUsSUFBSSxDQUFDLE1BQU0sR0FBRztZQUNaLG1CQUFtQixFQUFFLG1CQUFtQixDQUFDLG1CQUFtQjtZQUM1RCxTQUFTLEVBQUUsbUJBQW1CLENBQUMsU0FBUztZQUN4QyxhQUFhO1lBQ2Isa0JBQWtCO1lBQ2xCLFFBQVEsRUFBRSxtQkFBbUIsQ0FBQyxRQUFRO1lBQ3RDLFlBQVk7WUFDWixPQUFPLEVBQUUsbUJBQW1CLENBQUMsT0FBTztZQUNwQyxXQUFXLEVBQUUsZUFBZSxDQUFDLEVBQUMsSUFBSSxFQUFFLEdBQUcsbUJBQW1CLENBQUMsU0FBUyxVQUFVLEVBQUUsY0FBYyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxTQUFTLEVBQUMsQ0FBQztZQUNsSyxVQUFVLEVBQUUsZUFBZSxDQUFDLEVBQUMsSUFBSSxFQUFFLEdBQUcsbUJBQW1CLENBQUMsU0FBUyxTQUFTLEVBQUUsY0FBYyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxTQUFTLEVBQUMsQ0FBQztZQUNoSyxRQUFRLEVBQUUsbUJBQW1CLENBQUMsUUFBUTtZQUN0QyxjQUFjLEVBQUUsc0JBQXNCO1lBQ3RDLFNBQVM7WUFDVCxTQUFTLEVBQUUsaUJBQWlCO1lBQzVCLFlBQVk7WUFDWixlQUFlLEVBQUUsbUJBQW1CLENBQUMsZUFBZTtZQUNwRCxZQUFZLEVBQUUsbUJBQW1CLENBQUMsWUFBWTtTQUMvQyxDQUFBO1FBQ0QsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLGFBQWEsQ0FBQTtRQUNwQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsZ0JBQWdCLENBQUE7UUFDekMsSUFBSSxDQUFDLHVCQUF1QixHQUFHLFlBQVk7WUFDekMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsRUFBQyxrQkFBa0IsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLEVBQUMsQ0FBQyxDQUFDLGdCQUFnQjtZQUN6RyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBQ1Isd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFBO1FBQzNCLHNNQUFzTTtRQUN0TSxJQUFJLENBQUMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtRQUNoQyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLDBCQUEwQixHQUFHLElBQUksQ0FBQTtRQUN0Qyw0REFBNEQ7UUFDNUQsSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7UUFDckMsNkRBQTZEO1FBQzdELElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxJQUFJLElBQUksQ0FBQTtRQUNyQyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksQ0FBQTtRQUM1Qiw2RkFBNkY7UUFDN0YsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQTtRQUNoQyw2T0FBNk87UUFDN08sSUFBSSxDQUFDLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtRQUMzQiw4QkFBOEI7UUFDOUIsSUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7UUFDeEMsa0NBQWtDO1FBQ2xDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ25DLDZEQUE2RDtRQUM3RCxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtRQUMxQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsQ0FBQyxDQUFBO1FBQzlCLDRHQUE0RztRQUM1RyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtRQUNuQixvQ0FBb0M7UUFDcEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDckMsSUFBSSxDQUFDLHlCQUF5QixHQUFHLElBQUksZUFBZSxFQUFFLENBQUE7UUFDdEQsSUFBSSxDQUFDLHlCQUF5QixHQUFHLENBQUMsQ0FBQTtRQUNsQyw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLDJCQUEyQixHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwRCxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtJQUN2QixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsTUFBTSxJQUFJLENBQUMsMkJBQTJCLENBQUE7UUFDdEMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDeEIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFekIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7UUFFcEIsS0FBSyxNQUFNLENBQUMsWUFBWSxFQUFFLGNBQWMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ25GLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFBO1lBRXpFLElBQUksY0FBYyxDQUFDLGdCQUFnQixFQUFFLENBQUM7Z0JBQ3BDLEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUyxLQUFLLFFBQVEsQ0FBQyxFQUFFLENBQUM7b0JBQ2pGLE1BQU0sWUFBWSxHQUFHLFNBQVMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFBO29CQUMvRSxNQUFNLFFBQVEsR0FBRyxDQUFDLDRDQUE0QyxDQUFDLE1BQU0sRUFBRSxFQUFFO3dCQUN2RSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7NEJBQUUsT0FBTTt3QkFDcEMsSUFBSSxJQUFJLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDOzRCQUFFLE9BQU07d0JBRTdDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUE7d0JBRXJFLGdCQUFnQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUMsQ0FBQTt3QkFDMUYsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtvQkFDMUQsQ0FBQyxDQUFBO29CQUVELGNBQWMsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7b0JBQ2pELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsRUFBQyxRQUFRLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxjQUFjLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQTtnQkFDOUYsQ0FBQztZQUNILENBQUM7WUFFRCxLQUFLLE1BQU0sU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUNuQyxNQUFNLFlBQVksR0FBRyxzQkFBc0IsQ0FBQyxTQUFTLENBQUMsQ0FBQTtnQkFDdEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsU0FBUyxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7Z0JBRTFFLGNBQWMsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBQ2pELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsRUFBQyxRQUFRLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxjQUFjLENBQUMsVUFBVSxFQUFDLENBQUMsQ0FBQTtZQUM5RixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUU7UUFDZixLQUFLLE1BQU0sRUFBQyxRQUFRLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQzFFLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFDaEUsQ0FBQztRQUVELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxFQUFFLENBQUE7UUFDM0IsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7UUFFckIsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDN0MsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDOUMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQ3BDLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzVDLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUMsR0FBRyxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDeEUsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLE9BQU87UUFDM0IsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3RFLE1BQU0sSUFBSSxLQUFLLENBQUMsdURBQXVELENBQUMsQ0FBQTtRQUMxRSxDQUFDO1FBRUQsTUFBTSxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsV0FBVyxHQUFHLEVBQUUsRUFBRSxrQkFBa0IsR0FBRyxLQUFLLEVBQUUsR0FBRyxXQUFXLEVBQUMsR0FBRyxPQUFPLENBQUE7UUFFaEcsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzFCLElBQUksT0FBTyxPQUFPLEtBQUssVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQTtRQUM1RyxJQUFJLE9BQU8sa0JBQWtCLEtBQUssU0FBUztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0RBQStELENBQUMsQ0FBQTtRQUU3SCxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUM1QyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLE9BQU8sRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1lBQzNELE1BQU0sT0FBTyxFQUFFLENBQUE7UUFDakIsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLGtCQUFrQjtZQUFFLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUE7SUFDekQsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRO1FBQzlCLElBQUksSUFBSSxDQUFDLHlCQUF5QixHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQTtRQUU5RSxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFBO1FBRXBELElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVyQyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFaEMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUV0QyxJQUFJLENBQUM7WUFDSCxPQUFPLE1BQU0sT0FBTyxDQUFBO1FBQ3RCLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDM0MsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx1QkFBdUIsQ0FBQyxRQUFRO1FBQzlCLElBQUksQ0FBQyx5QkFBeUIsSUFBSSxDQUFDLENBQUE7UUFFbkMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsMkJBQTJCLENBQUE7UUFDM0QsTUFBTSxVQUFVLEdBQUcsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ3BELE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQTtZQUN0RCxNQUFNLFdBQVcsR0FBRyxJQUFJLDZCQUE2QixDQUFDLG1DQUFtQyxDQUFDLENBQUE7WUFFMUYsZUFBZSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQTtZQUVsQyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztnQkFDekIsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRSxDQUFBO1lBQzFDLENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBRyxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUE7WUFFNUUsSUFBSSxJQUFJLENBQUMsZUFBZTtnQkFBRSxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsY0FBYyxFQUFFLENBQUE7WUFFckUsd0JBQXdCO1lBQ3hCLE1BQU0sZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO1lBRTNCLEtBQUssTUFBTSxNQUFNLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2pDLElBQUksTUFBTSxDQUFDLE1BQU0sS0FBSyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQztvQkFBRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ2pILENBQUM7WUFFRCxJQUFJLGdCQUFnQixDQUFDLE1BQU0sS0FBSyxDQUFDO2dCQUFFLE1BQU0sZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDNUQsSUFBSSxnQkFBZ0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFBRSxNQUFNLElBQUksY0FBYyxDQUFDLGdCQUFnQixFQUFFLHVEQUF1RCxDQUFDLENBQUE7WUFFcEksTUFBTSxRQUFRLEVBQUUsQ0FBQTtRQUNsQixDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFO1lBQ2QsSUFBSSxDQUFDLHlCQUF5QixHQUFHLElBQUksZUFBZSxFQUFFLENBQUE7WUFDdEQsSUFBSSxDQUFDLHlCQUF5QixJQUFJLENBQUMsQ0FBQTtZQUNuQyxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQTtZQUNyQyxJQUFJLENBQUMsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO1FBQ3hDLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLDJCQUEyQixHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsU0FBUyxFQUFFLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRXBGLE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLE9BQU87UUFDcEMsTUFBTSxFQUFDLE9BQU8sRUFBRSxXQUFXLEdBQUcsRUFBRSxFQUFFLEdBQUcsV0FBVyxFQUFDLEdBQUcsT0FBTyxDQUFBO1FBRTNELGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUMxQixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUE7UUFDNUYsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sT0FBTyxLQUFLLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxDQUFDLENBQUE7UUFDckgsSUFBSSxPQUFPLElBQUksV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFBO1FBQ2pILElBQUksV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVwQyxNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdCQUFnQixDQUFDLEtBQUs7UUFDcEIsT0FBTyxLQUFLLFlBQVksNkJBQTZCLENBQUE7SUFDdkQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxNQUFNO1FBQzdCLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTztZQUFFLE9BQU07UUFFM0IsTUFBTSxNQUFNLENBQUMsTUFBTSxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSw2QkFBNkIsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFBO0lBQy9ILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsaUJBQWlCLENBQUMsRUFBQyxjQUFjLEVBQUUsWUFBWSxFQUFDO1FBQzlDLE1BQU0sS0FBSyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUE7UUFFbEMsSUFBSSxLQUFLLEtBQUssS0FBSztZQUFFLE9BQU8sRUFBRSxDQUFBO1FBQzlCLElBQUksS0FBSyxLQUFLLFNBQVM7WUFBRSxPQUFPLDBCQUEwQixDQUFBO1FBQzFELElBQUksS0FBSyxLQUFLLElBQUk7WUFBRSxPQUFPLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzdHLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLFlBQVksNENBQTRDLENBQUMsQ0FBQTtRQUNsRyxDQUFDO1FBRUQsS0FBSyxNQUFNLFNBQVMsSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDekMsSUFBSSxDQUFDLENBQUMsU0FBUyxJQUFJLHNCQUFzQixDQUFDLEVBQUUsQ0FBQztnQkFDM0MsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsWUFBWSx5REFBeUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUNsSSxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFDLFVBQVUsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsdUJBQXVCLENBQUMsRUFBQyxTQUFTLEVBQUUsY0FBYyxFQUFDO1FBQ2pELE9BQU8sS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFBRSxPQUFNO1lBQ3BDLElBQUksSUFBSSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQztnQkFBRSxPQUFNO1lBRTdDLE1BQU0sSUFBSSxHQUFHLGFBQWEsQ0FBQyxjQUFjLENBQUM7Z0JBQ3hDLGlCQUFpQixFQUFFLGNBQWMsQ0FBQyxpQkFBaUIsSUFBSSxFQUFFO2dCQUN6RCxJQUFJLEVBQUUsY0FBYyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2dCQUM5RixtQkFBbUIsRUFBRSxjQUFjLENBQUMsbUJBQW1CLElBQUksRUFBRTtnQkFDN0QsUUFBUSxFQUFFLE1BQU07YUFDakIsQ0FBQyxDQUFBO1lBQ0YsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtZQUMxRSxNQUFNLFdBQVcsR0FBRyxjQUFjLENBQUMsZ0JBQWdCO2dCQUNqRCxDQUFDLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUMsQ0FBQztnQkFDbEUsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUNSLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDcEQsTUFBTSxjQUFjLEdBQUcsaUJBQWlCO2dCQUN0QyxDQUFDLENBQUMsaUJBQWlCLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2dCQUNuRCxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUE7WUFFekIsTUFBTSxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUMvQyxJQUFJLENBQUM7b0JBQ0gsSUFBSSxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQzt3QkFDcEMsTUFBTSxhQUFhLENBQUMsd0JBQXdCLENBQUM7NEJBQzNDLFdBQVc7NEJBQ1gsZ0JBQWdCLEVBQUUsY0FBYyxDQUFDLGdCQUFnQjs0QkFDakQsSUFBSTs0QkFDSixTQUFTOzRCQUNULFFBQVEsRUFBRSxNQUFNOzRCQUNoQixZQUFZLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBQyxZQUFZLEVBQUU7NEJBQy9DLFFBQVE7eUJBQ1QsQ0FBQyxDQUFBO29CQUNKLENBQUM7eUJBQU0sQ0FBQzt3QkFDTixNQUFNLGFBQWEsQ0FBQyxjQUFjLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUE7b0JBQ25HLENBQUM7Z0JBQ0gsQ0FBQztnQkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO29CQUNmLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLG9CQUFvQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtvQkFFL0QsT0FBTTtnQkFDUixDQUFDO2dCQUVELElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtZQUN2QixDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLO1FBQ2hDLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUUxQixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyw0REFBNEQsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUNoRyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTTtRQUNKLElBQUksQ0FBQyxPQUFPLEtBQUssSUFBSSxNQUFNLENBQUMsWUFBWSxFQUFFLEVBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUVyRixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsTUFBTTtRQUNsQixPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxvQkFBb0IsQ0FBQyxNQUFNO1FBQ3pCLE9BQU8sSUFBSSxDQUFDLHFCQUFxQixHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3JFLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFFBQVE7UUFDNUIsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFFNUIsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO1FBQ3pCLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQzlCLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsZUFBZSxDQUFDLE1BQU07UUFDcEIsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVwQyxPQUFPLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDdEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixvQkFBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLE9BQU87UUFDWixPQUFPLHlCQUF5QixDQUFDLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFBO0lBQ3hELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsaUJBQWlCLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUUsRUFBRSxPQUFPLEdBQUcsRUFBRTtRQUM1RSxPQUFPLElBQUksVUFBVSxDQUFDLEVBQUMsR0FBRyxPQUFPLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLEVBQUMsVUFBVSxFQUFFLGVBQWUsRUFBQyxHQUFHLEVBQUU7UUFDbEQsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ2hDLE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzdDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNwQyxNQUFNLFFBQVEsR0FBRyxNQUFNLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsUUFBUSxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3hELE1BQU0sbUJBQW1CLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDbkUsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFDLHFCQUFxQixDQUFDLG1CQUFtQixDQUFDLENBQUE7WUFFN0UsSUFBSSxZQUFZO2dCQUFFLE1BQU0sVUFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDdkUsQ0FBQztRQUVELE9BQU8sRUFBQyxNQUFNLEVBQUUsTUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUMsVUFBVSxFQUFFLGVBQWUsRUFBQyxDQUFDLEVBQUUsS0FBSyxFQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUs7UUFDaEIsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ2hDLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLFVBQVUsQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0lBQ3JFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUMsVUFBVSxFQUFFLGVBQWUsRUFBQyxHQUFHLEVBQUU7UUFDM0MsT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBQyxVQUFVLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUNoSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxVQUFVLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBQztRQUMvQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDckMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDeEIsSUFBSSxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUN6QyxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFckMsNEVBQTRFO1FBQzVFLElBQUksY0FBYyxHQUFHLElBQUksQ0FBQTtRQUV6QixNQUFNLGFBQWEsQ0FBQyxZQUFZLENBQUMsOEJBQThCLElBQUksQ0FBQyxhQUFhLEVBQUUsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM5RixJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDckMsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUNuRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDckMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBQ3BDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtZQUN4QyxNQUFNLE1BQU0sR0FBRztnQkFDYixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUUsQ0FBQztnQkFDUixlQUFlLEVBQUUsc0NBQXNDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQzVELGNBQWMsRUFBRSxxQ0FBcUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDMUQsV0FBVyxFQUFFLENBQUM7Z0JBQ2QsS0FBSyxFQUFFLENBQUM7YUFDVCxDQUFBO1lBRUQsS0FBSyxNQUFNLFFBQVEsSUFBSSxNQUFNLFVBQVUsQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDO2dCQUN2RCxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQ3JDLG1GQUFtRjtnQkFDbkYsbUZBQW1GO2dCQUNuRiw4REFBOEQ7Z0JBQzlELE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUE7Z0JBQzlCLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUE7Z0JBQzFDLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUE7Z0JBQzlCLE1BQU0sV0FBVyxHQUFHLE1BQU0sYUFBYSxDQUFDLFdBQVcsQ0FBQztvQkFDbEQsU0FBUztvQkFDVCxtQkFBbUI7b0JBQ25CLFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7b0JBQ2hDLFVBQVUsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sVUFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7b0JBQzdELFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUM7d0JBQ2hELEtBQUssRUFBRSxTQUFTLEdBQUcsUUFBUSxDQUFDLEtBQUs7d0JBQ2pDLFdBQVcsRUFBRSxlQUFlLEdBQUcsUUFBUSxDQUFDLFdBQVc7d0JBQ25ELEtBQUssRUFBRSxTQUFTLEdBQUcsUUFBUSxDQUFDLEtBQUs7cUJBQ2xDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztvQkFDZCxXQUFXLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUM7d0JBQ3JFLEdBQUcsT0FBTzt3QkFDVixvRkFBb0Y7d0JBQ3BGLEtBQUssRUFBRTs0QkFDTCxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVU7NEJBQy9CLFlBQVksRUFBRSxRQUFRLENBQUMsWUFBWTs0QkFDbkMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxZQUFZLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsc0JBQXNCLEVBQUUsRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7eUJBQzFGO3dCQUNELEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLEVBQUMsZUFBZSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7cUJBQ3BELEVBQUUsT0FBTyxDQUFDO29CQUNYLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQztvQkFDM0UsTUFBTTtpQkFDUCxDQUFDLENBQUE7Z0JBRUYsTUFBTSxDQUFDLE9BQU8sS0FBSyxXQUFXLENBQUMsT0FBTyxDQUFBO2dCQUN0QyxNQUFNLENBQUMsS0FBSyxJQUFJLFdBQVcsQ0FBQyxLQUFLLENBQUE7Z0JBQ2pDLE1BQU0sQ0FBQyxXQUFXLElBQUksV0FBVyxDQUFDLFdBQVcsQ0FBQTtnQkFDN0MsTUFBTSxDQUFDLEtBQUssSUFBSSxXQUFXLENBQUMsS0FBSyxDQUFBO2dCQUVqQyxLQUFLLE1BQU0sQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztvQkFDL0UsTUFBTSxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFBO2dCQUMxRixDQUFDO2dCQUNELEtBQUssTUFBTSxDQUFDLFlBQVksRUFBRSxPQUFPLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO29CQUNsRixNQUFNLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxLQUFLLE9BQU8sQ0FBQTtnQkFDbEQsQ0FBQztZQUNILENBQUM7WUFFRCxjQUFjLEdBQUcsTUFBTSxDQUFBO1FBQ3pCLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3JDLE9BQU8sY0FBYyxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsZUFBZSxDQUFDLEVBQUMsTUFBTSxHQUFHLGVBQWUsRUFBQyxHQUFHLEVBQUU7UUFDN0MsT0FBTyxLQUFLLEVBQUUsSUFBSSxFQUFFLEVBQUU7WUFDcEIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFBO1lBQ3hDLE1BQU0sa0JBQWtCLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1lBRXpGLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsQ0FBQztnQkFDckQsTUFBTSxJQUFJLEtBQUssQ0FBQyx3REFBd0QsTUFBTSxLQUFLLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDNUcsQ0FBQztZQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxFQUFFO2dCQUN4RCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7Z0JBQ3hCLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUE7Z0JBRS9GLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztvQkFDckIsTUFBTSxjQUFjLEdBQUcsSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO3dCQUM3RSxDQUFDLENBQUMsNERBQTRELENBQUMsQ0FBQyxJQUFJLENBQUM7d0JBQ3JFLENBQUMsQ0FBQyxFQUFFLENBQUE7b0JBRU4sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLENBQUMsQ0FBQTtnQkFDMUgsQ0FBQztnQkFFRCxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsQ0FBQTtnQkFDL0QsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLGVBQWUsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFO29CQUM1RSxJQUFJLFNBQVM7d0JBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7b0JBRXpELE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDckMsQ0FBQyxDQUFDLENBQUE7Z0JBRUYsT0FBTyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUM1QixDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsY0FBYztRQUNaLElBQUksSUFBSSxDQUFDLGVBQWUsS0FBSyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFBO1FBRW5FLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNoQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFBO1FBQ3BELENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDcEMsTUFBTSxHQUFHLEdBQUcsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFBO1lBRWxILElBQUksQ0FBQyxlQUFlLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLHdCQUF3QixDQUFDLEVBQUMsR0FBRyxFQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBQ3pFLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLENBQUE7UUFDN0IsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsT0FBTztRQUM3QixNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDNUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDeEIsTUFBTSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxFQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7WUFDeEQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3ZDLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCO1FBQ3RCLElBQUksSUFBSSxDQUFDLGVBQWUsS0FBSyxZQUFZO1lBQUUsT0FBTTtRQUVqRCxJQUFJLENBQUMsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUM7WUFDckMsSUFBSSxDQUFDLDBCQUEwQixHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUU7Z0JBQzlILElBQUksQ0FBQywwQkFBMEIsR0FBRyxJQUFJLENBQUE7WUFDeEMsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLE1BQU07UUFDOUIsSUFBSSxDQUFDLGVBQWUsR0FBRyxhQUFhLENBQUE7UUFFcEMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsaUJBQWlCLENBQUMsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtZQUNqRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFckMsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtZQUM5QixJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDckMsTUFBTSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7WUFDakIsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBRXJDLElBQUksQ0FBQyxlQUFlLEdBQUcsWUFBWSxDQUFBO1FBQ3JDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7WUFDckMsTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxvQkFBb0I7UUFDeEIsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsVUFBVSxDQUFDLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUE7UUFFMUQsTUFBTSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUVoQyxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxTQUFTO1FBQ2IsT0FBTyxFQUFDLFVBQVUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUNqRixDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsc0JBQXNCO1FBQ3BCLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxDQUFBO0lBQ2hELENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsY0FBYztRQUNsQixPQUFPLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxDQUFBO0lBQ3hELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsbUJBQW1CO1FBQ3ZCLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQzNDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osT0FBTyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCO1FBQzFCLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFBO0lBQzlDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osSUFBSSxDQUFDLGVBQWUsS0FBSyxJQUFJLGtCQUFrQixDQUFDLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFbkUsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFBO0lBQzdCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLFNBQVMsR0FBRyxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBQztRQUN2RSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMscUJBQXFCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDcEMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZELE1BQU0sZ0JBQWdCLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1FBRXhHLElBQUksY0FBYyxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDcEMsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLGNBQWMsQ0FBQztnQkFDOUMsaUJBQWlCLEVBQUUsY0FBYyxDQUFDLGlCQUFpQixJQUFJLEVBQUU7Z0JBQ3pELElBQUk7Z0JBQ0osbUJBQW1CLEVBQUUsY0FBYyxDQUFDLG1CQUFtQixJQUFJLEVBQUU7Z0JBQzdELFFBQVE7YUFDVCxDQUFDLENBQUE7WUFDRixNQUFNLE1BQU0sR0FBRyxNQUFNLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQztnQkFDMUQsV0FBVyxFQUFFLFdBQVcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXO2dCQUN6SCxnQkFBZ0IsRUFBRSxjQUFjLENBQUMsZ0JBQWdCO2dCQUNqRCxJQUFJLEVBQUUsVUFBVTtnQkFDaEIsU0FBUztnQkFDVCxRQUFRO2dCQUNSLFlBQVksRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLFlBQVksRUFBRTtnQkFDakQsUUFBUSxFQUFFLGdCQUFnQjthQUMzQixDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsY0FBYyxFQUFFLENBQUE7WUFFckIsT0FBTyxNQUFNLENBQUE7UUFDZixDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxNQUFNLGFBQWEsQ0FBQyxjQUFjLENBQUM7WUFDN0csaUJBQWlCLEVBQUUsY0FBYyxDQUFDLGlCQUFpQixJQUFJLEVBQUU7WUFDekQsSUFBSTtZQUNKLG1CQUFtQixFQUFFLGNBQWMsQ0FBQyxtQkFBbUIsSUFBSSxFQUFFO1lBQzdELFFBQVE7WUFDUixTQUFTLEVBQUUsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7WUFDMUcsUUFBUSxFQUFFLGdCQUFnQjtTQUMzQixDQUFDLENBQUMsQ0FBQTtRQUVILElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUVyQixPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxhQUFhO1FBQ2pCLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO0lBQ25GLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxNQUFNO1FBQ3pCLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUFFLE9BQU07UUFDcEMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXJDLE1BQU0sYUFBYSxDQUFDLFlBQVksQ0FBQyxnQ0FBZ0MsSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxFQUFFO1lBQ3BKLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNyQyxLQUFLLE1BQU0sQ0FBQyxZQUFZLEVBQUUsY0FBYyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ25GLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCO29CQUFFLFNBQVE7Z0JBRTlDLE1BQU0sYUFBYSxDQUFDLDBCQUEwQixDQUFDO29CQUM3QyxtQkFBbUIsRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUU7b0JBQzVELFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7b0JBQ2hDLGdCQUFnQixFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7b0JBQ2pELFVBQVUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVU7b0JBQ2xDLGdCQUFnQixFQUFFLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUM7b0JBQzFFLFlBQVk7b0JBQ1osTUFBTTtpQkFDUCxDQUFDLENBQUE7WUFDSixDQUFDO1lBRUQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3JDLE1BQU0sYUFBYSxDQUFDLGdCQUFnQixDQUFDO2dCQUNuQyxtQkFBbUIsRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUU7Z0JBQzVELFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7Z0JBQ2hDLFVBQVUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVU7Z0JBQ2xDLE1BQU07Z0JBQ04sU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7YUFDM0YsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVILElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFDO1FBQ25ELEtBQUssT0FBTyxDQUFBO1FBQ1osTUFBTSxRQUFRLEdBQUcsR0FBRyxZQUFZLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUE7UUFFeEQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQ3pGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUM7UUFDaEQsSUFBSSxTQUFTLEtBQUssUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXZDLE1BQU0sZ0JBQWdCLEdBQUcsY0FBYyxDQUFDLGdCQUFnQixFQUFFLGdCQUFnQixDQUFBO1FBRTFFLElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVsQyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFcEQsSUFBSSxLQUFLLFlBQVksSUFBSTtZQUFFLE9BQU8sS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3JELElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTFGLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLGdCQUFnQiwwQ0FBMEMsQ0FBQyxDQUFBO0lBQ3RHLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHlCQUF5QixDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUM7UUFDM0QsTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUE7UUFDMUUsTUFBTSxhQUFhLEdBQUcsZ0JBQWdCO1lBQ3BDLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLCtCQUErQixFQUFFLENBQUMsZ0JBQWdCLENBQUM7WUFDeEUsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUNiLE1BQU0sYUFBYSxHQUFHLFNBQVMsS0FBSyxRQUFRLElBQUksYUFBYTtZQUMzRCxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLGFBQWEsQ0FBQztZQUNqQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBRWIsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7UUFFbkYsTUFBTSxLQUFLLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTlCLElBQUksS0FBSyxZQUFZLElBQUk7WUFBRSxPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUNyRCxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUxRixNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixnQkFBZ0IsMENBQTBDLENBQUMsQ0FBQTtJQUN0RyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxzQkFBc0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDO1FBQ3hELElBQUksU0FBUyxLQUFLLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV2QyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDL0QsTUFBTSxXQUFXLEdBQUcsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLENBQUE7UUFFN0MsSUFBSSxnQkFBZ0IsRUFBRSxNQUFNLEtBQUssQ0FBQztZQUFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDN0UsSUFBSSxXQUFXLEtBQUssU0FBUztZQUFFLE9BQU8sV0FBVyxDQUFBO1FBRWpELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtJQUNqRSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWM7UUFDWixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNsQyxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7WUFDNUIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDO29CQUFFLE9BQU07Z0JBRXhDLElBQUksQ0FBQyxXQUFXLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ2hELENBQUM7UUFDSCxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQ04sQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxzQkFBc0I7UUFDMUIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxXQUFXLENBQUMsS0FBSztRQUNmLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUMxQixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRO1FBQ1osSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXRDLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxLQUFLLENBQUE7SUFDakQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUV4QixJQUFJLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLGlCQUFpQixJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsYUFBYSxLQUFLLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQzVHLE1BQU0sSUFBSSxLQUFLLENBQUMsa0ZBQWtGLENBQUMsQ0FBQTtRQUNyRyxDQUFDO1FBRUQsSUFBSSxDQUFDLFdBQVcsS0FBSyxJQUFJLGNBQWMsQ0FBQztZQUN0QyxhQUFhLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhO1lBQ3hDLGtCQUFrQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCO1lBQ2xELFlBQVksRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVk7U0FDdkMsQ0FBQyxDQUFBO1FBRUYsT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUJBQWlCLENBQUMsUUFBUTtRQUN4QixNQUFNLFVBQVUsR0FBRyxRQUFRLEVBQUUsV0FBVyxDQUFBO1FBRXhDLElBQUksT0FBTyxVQUFVLEVBQUUsWUFBWSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ25ELE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDaEgsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtRQUM5QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLFlBQVksRUFBRSxDQUFDLENBQUE7UUFFeEYsT0FBTyxjQUFjLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDO1FBQ2pELElBQUksT0FBTyxjQUFjLENBQUMsUUFBUSxLQUFLLFVBQVU7WUFBRSxPQUFPLGNBQWMsQ0FBQyxRQUFRLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN0RyxJQUFJLFNBQVMsS0FBSyxTQUFTO1lBQUUsT0FBTyxRQUFRLENBQUE7UUFDNUMsSUFBSSxjQUFjLENBQUMsUUFBUSxLQUFLLFFBQVE7WUFBRSxPQUFPLFFBQVEsQ0FBQTtRQUV6RCxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLFNBQVM7UUFDM0IsSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsb0JBQW9CO1lBQUUsT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFFN0UsTUFBTSxlQUFlLEdBQUcsc0ZBQXNGLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUNoSSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2FBQ2xDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUN0RCxHQUFHLENBQUMsQ0FBQyxDQUFDLFlBQVksRUFBRSxRQUFRLENBQUMsRUFBRSxFQUFFO1lBQ2hDLE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUE7WUFDOUYsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQTtZQUN0QyxNQUFNLG1CQUFtQixHQUFHLFFBQVEsQ0FBQyxtQkFBbUIsQ0FBQTtZQUV4RCxPQUFPLENBQUMsWUFBWSxFQUFFO29CQUNwQixVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVU7b0JBQy9CLFVBQVUsRUFBRSxvRkFBb0YsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7b0JBQ3RILE9BQU8sRUFBRSxJQUFJO29CQUNiLFVBQVUsRUFBRSxTQUFTLElBQUksVUFBVTt3QkFDakMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsRUFBQyxHQUFHLElBQUksRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVMsSUFBSSxJQUFJLEVBQUMsQ0FBQzt3QkFDM0UsQ0FBQyxDQUFDLFVBQVU7b0JBQ2QsbUJBQW1CLEVBQUUsU0FBUyxJQUFJLG1CQUFtQjt3QkFDbkQsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLEdBQUcsSUFBSSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsU0FBUyxJQUFJLElBQUksRUFBQyxDQUFDO3dCQUNwRixDQUFDLENBQUMsbUJBQW1CO29CQUN2QixVQUFVO2lCQUNYLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUNMLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxTQUFTO1lBQUUsSUFBSSxDQUFDLG9CQUFvQixHQUFHLGVBQWUsQ0FBQTtRQUUzRCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsUUFBUTtRQUNoQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtZQUFFLE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDN0YsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLGlCQUFpQixDQUFDO1lBQ3RELGtCQUFrQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCO1lBQ2xELElBQUksRUFBRSxtQkFBbUI7U0FDMUIsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLEVBQUU7WUFDckIsTUFBTSxTQUFTLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUU3RCxPQUFPLE1BQU0sUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ2xDLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsTUFBTTtRQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFeEMsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUVwRCxPQUFPLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxLQUFLLElBQUksQ0FBQyxpQkFBaUI7WUFDekQsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxJQUFJLENBQUMsdUJBQXVCLENBQUE7SUFDMUUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxNQUFNO1FBQzFCLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0VBQStFLENBQUMsQ0FBQTtJQUNoSSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG9CQUFvQixDQUFDLEtBQUs7UUFDeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0I7WUFBRSxPQUFNO1FBRXhFLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUN4QyxNQUFNLGtCQUFrQixHQUFHLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDeEcsTUFBTSxxQkFBcUIsR0FBRyxLQUFLLENBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLENBQUE7UUFFbEUsSUFBSSxrQkFBa0IsS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtZQUN2RCxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNqRCxxQkFBcUIsS0FBSyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNuRCxNQUFNLElBQUksS0FBSyxDQUFDLDRFQUE0RSxDQUFDLENBQUE7UUFDL0YsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxpQkFBaUI7UUFDZixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtZQUFFLE9BQU07UUFFeEUsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLEVBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsRUFBQyxDQUFDLENBQUE7UUFFeEcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLElBQUksU0FBUyxDQUFDLGdCQUFnQixLQUFLLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1lBQ25ILE1BQU0sSUFBSSxLQUFLLENBQUMsNkRBQTZELENBQUMsQ0FBQTtRQUNoRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQkFBZ0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUM7UUFDbEMsSUFBSSxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxLQUFLLFNBQVM7WUFBRSxPQUFNO1FBQ3RELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNsQyxTQUFTLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQzlCLENBQUM7Q0FDRjtBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxpQ0FBaUMsQ0FBQyxFQUFDLFdBQVcsRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQ3BHLE1BQU0scUJBQXFCLEdBQUcsV0FBVyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUE7SUFFckUsSUFBSSxDQUFDLHFCQUFxQixJQUFJLE9BQU8scUJBQXFCLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMscUJBQXFCLENBQUMsRUFBRSxDQUFDO1FBQ2hILE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxZQUFZLGdFQUFnRSxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ3ZILENBQUM7SUFFRCxNQUFNLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxHQUFHLGVBQWUsRUFBQyxHQUFHLHFCQUFxQixDQUFBO0lBQ3ROLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFFaEQsNEVBQTRFO0lBQzVFLDBFQUEwRTtJQUMxRSx5RUFBeUU7SUFDekUsS0FBSyxPQUFPLENBQUE7SUFFWixJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksdUNBQXVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGtMQUFrTCxDQUFDLENBQUE7SUFDalIsQ0FBQztJQUNELElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxPQUFPLFFBQVEsS0FBSyxVQUFVLElBQUksUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ3RGLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxZQUFZLHlFQUF5RSxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQzdILENBQUM7SUFFRCxNQUFNLE9BQU8sR0FBRyxxQkFBcUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFBO0lBRXJGLElBQUksZ0JBQWdCO1FBQUUsd0JBQXdCLENBQUMsRUFBQyxnQkFBZ0IsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtJQUV6RixPQUFPO1FBQ0wsVUFBVTtRQUNWLFVBQVU7UUFDVixpQkFBaUIsRUFBRSxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLEVBQUUsaUJBQWlCLENBQUM7UUFDckYsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxnQkFBZ0IsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxnQkFBZ0IsSUFBSSxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztRQUMxSSxVQUFVO1FBQ1YsbUJBQW1CO1FBQ25CLG1CQUFtQixFQUFFLG9CQUFvQixDQUN2QyxPQUFPLENBQUMsbUJBQW1CLEVBQzNCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsSUFBSSxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FDbEg7UUFDRCxrQkFBa0I7UUFDbEIsVUFBVTtRQUNWLFFBQVE7UUFDUixRQUFRO1FBQ1IsS0FBSyxFQUFFLGVBQWUsQ0FBQyxLQUFLLENBQUM7UUFDN0IsV0FBVztLQUNaLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsd0JBQXdCLENBQUMsRUFBQyxnQkFBZ0IsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFDO0lBQ3pFLE1BQU0sZUFBZSxHQUFHO1FBQ3RCLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhO1FBQzdDLFdBQVcsRUFBRSxnQkFBZ0IsQ0FBQyxXQUFXO1FBQ3pDLGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxjQUFjO1FBQy9DLFVBQVUsRUFBRSxnQkFBZ0IsQ0FBQyxVQUFVO0tBQ3hDLENBQUE7SUFFRCxLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1FBQzNELElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxZQUFZLHFCQUFxQixHQUFHLDZCQUE2QixDQUFDLENBQUE7SUFDNUksQ0FBQztJQUNELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLElBQUksT0FBTyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsTUFBTSxLQUFLLFVBQVU7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsWUFBWSwwREFBMEQsQ0FBQyxDQUFBO0lBQzFMLElBQUksT0FBTyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsS0FBSyxVQUFVO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksdURBQXVELENBQUMsQ0FBQTtJQUNwSixJQUFJLENBQUMsZ0JBQWdCLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7UUFDN0YsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksdUZBQXVGLENBQUMsQ0FBQTtJQUN6SCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMscUJBQXFCLENBQUMsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQ3ZELElBQ0UsT0FBTyxVQUFVLENBQUMsY0FBYyxLQUFLLFVBQVU7UUFDL0MsT0FBTyxVQUFVLENBQUMsK0JBQStCLEtBQUssVUFBVTtRQUNoRSxPQUFPLFVBQVUsQ0FBQyxtQkFBbUIsS0FBSyxVQUFVO1FBQ3BELE9BQU8sVUFBVSxDQUFDLFVBQVUsS0FBSyxVQUFVO1FBQzNDLE9BQU8sVUFBVSxDQUFDLGFBQWEsS0FBSyxVQUFVLEVBQzlDLENBQUM7UUFDRCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsWUFBWSxzS0FBc0ssQ0FBQyxDQUFBO0lBQ3hNLENBQUM7SUFFRCxNQUFNLHlCQUF5QixHQUFHLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFBO0lBQzlFLHVCQUF1QjtJQUN2QixNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtJQUM1Qix1QkFBdUI7SUFDdkIsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUE7SUFFOUIsSUFBSSxVQUFVLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQztRQUMvQixNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsRUFBRSwrQkFBK0IsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUV0SCxtQkFBbUIsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQyxDQUFBO0lBQzNGLENBQUM7SUFFRCxLQUFLLE1BQU0sVUFBVSxJQUFJLFVBQVUsQ0FBQyxjQUFjLEVBQUUsRUFBRSxDQUFDO1FBQ3JELE1BQU0sYUFBYSxHQUFHLHlCQUF5QixDQUFDLFVBQVUsQ0FBQyxJQUFJLFVBQVUsQ0FBQTtRQUN6RSxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsbUJBQW1CLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFN0QsSUFBSSxpQ0FBaUMsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUM5RyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDekMsQ0FBQztRQUNELElBQUksVUFBVSxJQUFJLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDbEQsaUJBQWlCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQ3ZDLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxFQUFDLGlCQUFpQixFQUFFLG1CQUFtQixFQUFDLENBQUE7QUFDakQsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxvQkFBb0IsQ0FBQyxPQUFPLEVBQUUsUUFBUTtJQUM3QyxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7QUFDL0QsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxlQUFlLENBQUMsS0FBSztJQUM1QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUVwRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxlQUFlLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFNBQVMsRUFBQztJQUN4RCxPQUFPLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUUsRUFBRSxFQUFFO1FBQ3JDLE1BQU0sY0FBYyxHQUFHLHlCQUF5QixDQUFDO1lBQy9DLE9BQU8sRUFBRSxjQUFjO1lBQ3ZCLEtBQUssRUFBRSw2QkFBNkI7WUFDcEMsTUFBTSxFQUFFLE9BQU87U0FDaEIsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxRQUFRLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsRUFBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFFckYsSUFBSSxDQUFDLFFBQVEsSUFBSSxPQUFPLFFBQVEsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDckQsTUFBTSxJQUFJLEtBQUssQ0FBQyxrRkFBa0YsSUFBSSw2Q0FBNkMsQ0FBQyxDQUFBO1FBQ3RKLENBQUM7UUFFRCxPQUFPLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFBO0lBQzlCLENBQUMsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxVQUFVLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUU7SUFDaEUsSUFBSSxNQUFNLEdBQUcsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBRTFELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNaLE1BQU0sR0FBRyxVQUFVLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDcEQsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUNyRCxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDckIsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFBO0FBQ2YsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLElBQUksQ0FBQyxLQUFLO0lBQzlCLE9BQU8sTUFBTSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQy9DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHtpc0Jvb2xlYW5Db2x1bW5UeXBlfSBmcm9tIFwiLi4vZGF0YWJhc2UvY29sdW1uLXR5cGVzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQge2NhcHR1cmVSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuXG5pbXBvcnQge3NlcmlhbGl6ZWRTY29wZUZyb21RdWVyeX0gZnJvbSBcIi4vcXVlcnktc2NvcGUuanNcIlxuaW1wb3J0IFN5bmNBcGlDbGllbnQgZnJvbSBcIi4vc3luYy1hcGktY2xpZW50LmpzXCJcbmltcG9ydCBTeW5jUmVhbHRpbWVCcmlkZ2UgZnJvbSBcIi4vc3luYy1yZWFsdGltZS1icmlkZ2UuanNcIlxuaW1wb3J0IFN5bmNTY29wZVN0b3JlIGZyb20gXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIlxuaW1wb3J0IHtjdXJyZW50U3luY0NsaWVudCwgc2V0Q3VycmVudFN5bmNDbGllbnR9IGZyb20gXCIuL3N5bmMtY2xpZW50LXJlZ2lzdHJ5LmpzXCJcblxubGV0IGNsaWVudENvdW50ZXIgPSAwXG5cbi8qKiBAdHlwZSB7e2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIn19ICovXG5jb25zdCBUUkFDS0VEX0NBTExCQUNLX05BTUVTID0ge2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIn1cblxuLyoqXG4gKiBPcGVyYXRpb25zIHRyYWNrZWQgYnkgZGVmYXVsdCBmb3IgbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYVxuICogYHRyYWNrYCBrZXk6IGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcXVldWUgYXV0b21hdGljYWxseS4gRGVzdHJveXMgYXJlIG5vdFxuICogdHJhY2tlZCBieSBkZWZhdWx0IGJlY2F1c2UgYSBsb2NhbCBkZXN0cm95IGlzIG9mdGVuIGNhY2hlIGV2aWN0aW9uIHJhdGhlclxuICogdGhhbiBhIHNlcnZlciBkZWxldGU7IG9wdCBpbiB3aXRoIGB0cmFjazogdHJ1ZWAgb3IgYW4gb3BlcmF0aW9ucyBsaXN0LlxuICogQHR5cGUge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSAqL1xuY29uc3QgREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlMgPSBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl1cblxuLyoqIEF0dHJpYnV0ZSBuYW1lcyB0cmVhdGVkIGFzIGNsaWVudC1sb2NhbCBzeW5jIGJvb2trZWVwaW5nIHdoZW4gZGVyaXZpbmcgbG9jYWxPbmx5QXR0cmlidXRlcy4gKi9cbmNvbnN0IExPQ0FMX0JPT0tLRUVQSU5HX0FUVFJJQlVURV9OQU1FUyA9IFtcImNyZWF0ZWRBdFwiLCBcInVwZGF0ZWRBdFwiLCBcImxhc3RTeW5jQ2hhbmdlQXRcIl1cblxuY29uc3QgU1lOQ19SRVFVRVNUX1JFU0VSVkVEX0tFWVMgPSBbXG4gIFwiYWZ0ZXJJZFwiLFxuICBcImFmdGVyU2VydmVyU2VxdWVuY2VcIixcbiAgXCJhZnRlclVwZGF0ZWRBdFwiLFxuICBcImF1dGhlbnRpY2F0aW9uVG9rZW5cIixcbiAgXCJsaW1pdFwiLFxuICBcInNjb3BlXCIsXG4gIFwic3luY3NcIixcbiAgXCJ1cHN0cmVhbVJlZnJlc2hcIixcbiAgXCJ1cFRvSWRcIixcbiAgXCJ1cFRvU2VydmVyU2VxdWVuY2VcIixcbiAgXCJ1cFRvVXBkYXRlZEF0XCJcbl1cblxuLyoqIEB0eXBlIHtXZWFrTWFwPENvbmZpZ3VyYXRpb24sIFN5bmNDbGllbnQ+fSAqL1xuY29uc3Qgc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBFeHBlY3RlZCBjb29wZXJhdGl2ZSBjYW5jZWxsYXRpb24gcmFpc2VkIGJ5IGEgU3luY0NsaWVudCBsaWZlY3ljbGUgdHJhbnNpdGlvbi4gKi9cbmV4cG9ydCBjbGFzcyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhbiBleHBlY3RlZCBsaWZlY3ljbGUgY2FuY2VsbGF0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gcmVhc29uLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gXCJTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvclwiXG4gIH1cbn1cblxuLyoqXG4gKiBEZWNsYXJhdGl2ZSBjbGllbnQtc2lkZSBzeW5jIGRyaXZlci5cbiAqXG4gKiBFdmVyeXRoaW5nIGlzIGRlcml2ZWQgZnJvbSB0aGUgYXBwJ3MgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb246IG1vZGVscyBkZWNsYXJlXG4gKiBgc3RhdGljIHN5bmNgLCB0cmFuc3BvcnQvYXV0aC9jb25uZWN0aXZpdHkgY29tZSBmcm9tIHRoZSBgc3luYy5jbGllbnRgXG4gKiBjb25maWd1cmF0aW9uIGJsb2NrLCBhbmQgVmVsb2Npb3VzIG93bnMgc2NvcGUgcGVyc2lzdGVuY2UsIHBlci1zY29wZSBjdXJzb3JzLFxuICogcHVsbCBwYWdpbmcvYXBwbHksIGxvY2FsIHF1ZXVlaW5nLCBhbmQgb25saW5lLWdhdGVkIHJlcGxheS4gRGVjbGFyZSBzeW5jXG4gKiBpbnRlcmVzdCBmcm9tIHF1ZXJpZXM6XG4gKlxuICogICAgIGF3YWl0IHN5bmNDbGllbnQoKS5zdGFydCgpXG4gKiAgICAgYXdhaXQgc3luY0NsaWVudCgpLnN5bmMoRXZlbnQud2hlcmUoe3BhcnRuZXJJZH0pKVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jQ2xpZW50IHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3luYyBjbGllbnQgYnkgZGVyaXZpbmcgZXZlcnl0aGluZyBmcm9tIHRoZSBhcHAncyBWZWxvY2lvdXNcbiAgICogY29uZmlndXJhdGlvbjogZXZlcnkgcmVnaXN0ZXJlZCBtb2RlbCBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCBiZWNvbWVzIGFcbiAgICogcmVzb3VyY2Ugd2l0aCBib29sZWFuQXR0cmlidXRlcyBkZXJpdmVkIGZyb20gY29sdW1uIHR5cGVzIGFuZFxuICAgKiBsb2NhbE9ubHlBdHRyaWJ1dGVzIGRlcml2ZWQgZnJvbSB0aGUgcHJpbWFyeSBrZXksIGNyZWF0ZWRBdC91cGRhdGVkQXQsIGFuZFxuICAgKiBzeW5jIGJvb2trZWVwaW5nIGNvbHVtbnM7IHRoZSBwZW5kaW5nLXN5bmMgbW9kZWwgaXMgdGhlIHJlZ2lzdGVyZWQgXCJTeW5jXCJcbiAgICogbW9kZWw7IHRyYW5zcG9ydCwgYXV0aCwgY29ubmVjdGl2aXR5LCBhbmQgZXJyb3IgcmVwb3J0aW5nIGNvbWUgZnJvbSB0aGVcbiAgICogYHN5bmMuY2xpZW50YCBjb25maWd1cmF0aW9uIGJsb2NrLCB3aXRoIHRoZSBmcmFtZXdvcmsgb3duaW5nIHRoZVxuICAgKiBgJHttb3VudFBhdGh9L2NoYW5nZXNgIGFuZCBgJHttb3VudFBhdGh9L3JlcGxheWAgUE9TVGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRPcHRpb25zfSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBkYXRhYmFzZUlkZW50aWZpZXIsIGxlZ2FjeUN1cnNvciwgcmVxdWVzdENvbnRleHQsIHNjb3BlU3RvcmUsIHN5bmNNb2RlbCwgdGVuYW50SGFuZGxlLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuXG4gICAgY29uc3QgY2xpZW50Q29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5jbGllbnRcbiAgICBjb25zdCBjYXB0dXJlZFJlcXVlc3RDb250ZXh0ID0gY2FwdHVyZVJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCB7XG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHJlc2VydmVkS2V5czogU1lOQ19SRVFVRVNUX1JFU0VSVkVEX0tFWVNcbiAgICB9KVxuXG4gICAgaWYgKCFjbGllbnRDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlcXVpcmVzIGEgc3luYy5jbGllbnQgY29uZmlndXJhdGlvbiBibG9jazogbmV3IENvbmZpZ3VyYXRpb24oe3N5bmM6IHtjbGllbnQ6IHthdXRoZW50aWNhdGlvblRva2VuLCB0cmFuc3BvcnR9fX0pXCIpXG4gICAgfVxuXG4gICAgaWYgKEJvb2xlYW4odGVuYW50SGFuZGxlKSAhPT0gQm9vbGVhbihkYXRhYmFzZUlkZW50aWZpZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudEhhbmRsZSBhbmQgZGF0YWJhc2VJZGVudGlmaWVyIG11c3QgYmUgcHJvdmlkZWQgdG9nZXRoZXJcIilcbiAgICB9XG4gICAgaWYgKHRlbmFudEhhbmRsZSkge1xuICAgICAgdGVuYW50SGFuZGxlLmFzc2VydENvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgICAgIHRlbmFudEhhbmRsZS5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCByZXNvbHZlZFN5bmNNb2RlbCA9IHN5bmNNb2RlbCB8fCBtb2RlbENsYXNzZXMuU3luY1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSB0ZW5hbnRIYW5kbGUgPyB0ZW5hbnRIYW5kbGUuZGF0YWJhc2VJZGVudGl0eSgvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcikpIDogbnVsbFxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWc+fSAqL1xuICAgIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzZXMpKSB7XG4gICAgICBpZiAoIW1vZGVsQ2xhc3Muc3luYykgY29udGludWVcbiAgICAgIGlmICh0ZW5hbnRIYW5kbGUgJiYgbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGVuYW50SGFuZGxlLnRlbmFudCgpfSkgIT09IGRhdGFiYXNlSWRlbnRpZmllcikgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICBjb25zdCBtZXRhZGF0YU1vZGVsQ2xhc3MgPSB0ZW5hbnRIYW5kbGVcbiAgICAgICAgPyB0ZW5hbnRIYW5kbGUubWV0YWRhdGFNb2RlbENsYXNzKHtkYXRhYmFzZUlkZW50aWZpZXI6IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSwgbW9kZWxDbGFzc30pXG4gICAgICAgIDogbW9kZWxDbGFzc1xuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSByZXNvdXJjZUNvbmZpZ0Zyb21TeW5jRGVjbGFyYXRpb24oe2RlY2xhcmF0aW9uOiBtb2RlbENsYXNzLnN5bmMsIG1ldGFkYXRhTW9kZWxDbGFzcywgbW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSlcblxuICAgICAgaWYgKGRhdGFiYXNlSWRlbnRpdHkgJiYgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nID0ge1xuICAgICAgICAgIC4uLnJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgbXV0YXRpb25Mb2c6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucGFydGl0aW9uKGRhdGFiYXNlSWRlbnRpdHkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gPSByZXNvdXJjZUNvbmZpZ1xuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhyZXNvdXJjZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBmb3VuZCBubyByZWdpc3RlcmVkIG1vZGVscyBkZWNsYXJpbmcgc3RhdGljIHN5bmMgLSBkZWNsYXJlIGBzdGF0aWMgc3luYyA9IHRydWVgIChvciBhIHN5bmMgZGVjbGFyYXRpb24gb2JqZWN0KSBvbiB0aGUgbW9kZWxzIHRoYXQgc2hvdWxkIHN5bmNcIilcbiAgICB9XG5cbiAgICBpZiAoIXJlc29sdmVkU3luY01vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlcXVpcmVzIGEgcmVnaXN0ZXJlZCBcXFwiU3luY1xcXCIgbW9kZWwgZm9yIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIChvciBwYXNzIG9wdGlvbnMuc3luY01vZGVsKVwiKVxuICAgIH1cbiAgICBpZiAodGVuYW50SGFuZGxlICYmIHJlc29sdmVkU3luY01vZGVsLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0ZW5hbnRIYW5kbGUudGVuYW50KCl9KSAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDbGllbnQgc3luYyBtb2RlbCBkb2VzIG5vdCB1c2UgdGVuYW50IGRhdGFiYXNlICR7SlNPTi5zdHJpbmdpZnkoZGF0YWJhc2VJZGVudGlmaWVyKX1gKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmlnfSAqL1xuICAgIHRoaXMuY29uZmlnID0ge1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogY2xpZW50Q29uZmlndXJhdGlvbi5hdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplOiBjbGllbnRDb25maWd1cmF0aW9uLmJhdGNoU2l6ZSxcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBpc09ubGluZTogY2xpZW50Q29uZmlndXJhdGlvbi5pc09ubGluZSxcbiAgICAgIGxlZ2FjeUN1cnNvcixcbiAgICAgIG9uRXJyb3I6IGNsaWVudENvbmZpZ3VyYXRpb24ub25FcnJvcixcbiAgICAgIHBvc3RDaGFuZ2VzOiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9jaGFuZ2VzYCwgcmVxdWVzdENvbnRleHQ6IGNhcHR1cmVkUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogY2xpZW50Q29uZmlndXJhdGlvbi50cmFuc3BvcnR9KSxcbiAgICAgIHBvc3RSZXBsYXk6IHRyYW5zcG9ydFBvc3Rlcih7cGF0aDogYCR7Y2xpZW50Q29uZmlndXJhdGlvbi5tb3VudFBhdGh9L3JlcGxheWAsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICByZWFsdGltZTogY2xpZW50Q29uZmlndXJhdGlvbi5yZWFsdGltZSxcbiAgICAgIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LFxuICAgICAgcmVzb3VyY2VzLFxuICAgICAgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbCxcbiAgICAgIHRlbmFudEhhbmRsZSxcbiAgICAgIHdlYnNvY2tldENsaWVudDogY2xpZW50Q29uZmlndXJhdGlvbi53ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmw6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0VXJsXG4gICAgfVxuICAgIHRoaXMuX2NsaWVudE51bWJlciA9ICsrY2xpZW50Q291bnRlclxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgPSBkYXRhYmFzZUlkZW50aXR5XG4gICAgdGhpcy5fdGVuYW50U2NoZW1hR2VuZXJhdGlvbiA9IHRlbmFudEhhbmRsZVxuICAgICAgPyB0ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcil9KS5zY2hlbWFHZW5lcmF0aW9uXG4gICAgICA6IG51bGxcbiAgICAvKiogQHR5cGUge1N5bmNSZWFsdGltZUJyaWRnZSB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhbHRpbWVCcmlkZ2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTaGFyZWRDb25uZWN0aW9uIHwgbnVsbCB8IHVuZGVmaW5lZH0gU2hhcmVkIGFwcC1saWZldGltZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiAodW5kZWZpbmVkIHVudGlsIGZpcnN0IHJlc29sdmVkLCBudWxsIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkKS4gKi9cbiAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1wic3Vic2NyaWJlZFwiIHwgXCJzdWJzY3JpYmluZ1wiIHwgXCJ1bnN1YnNjcmliZWRcIn0gKi9cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zY29wZVN0b3JlID0gc2NvcGVTdG9yZSB8fCBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRSZXBsYXkgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2NhbGxiYWNrOiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQsIGNhbGxiYWNrTmFtZTogXCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8b2JqZWN0Pn0gKi9cbiAgICB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPG9iamVjdCwgQXJyYXk8c3RyaW5nIHwgbnVtYmVyIHwgbnVsbD4+fSAqL1xuICAgIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoID0gMFxuICAgIC8qKiBAdHlwZSB7TG9nZ2VyIHwge2Vycm9yOiAoLi4ubWVzc2FnZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn0gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvZ2dlciA9IG51bGxcbiAgICAvKiogQHR5cGUge1NldDxQcm9taXNlPHVua25vd24+Pn0gKi9cbiAgICB0aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrID0gbmV3IFNldCgpXG4gICAgdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpXG4gICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvbkNvdW50ID0gMFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGF1dG9tYXRpYyBtdXRhdGlvbiB0cmFja2luZyBmb3IgZXZlcnkgZGVjbGFyZWQgcmVzb3VyY2UgKG9uIGJ5XG4gICAqIGRlZmF1bHQ6IGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcXVldWUgcGVuZGluZyBzeW5jIHJvd3Mgb25jZSB0aGVpclxuICAgKiB0cmFuc2FjdGlvbiBjb21taXRzIGFuZCBzY2hlZHVsZSBhbiBpbW1lZGlhdGUgcmVwbGF5IGF0dGVtcHQsIHdpdGhvdXRcbiAgICogYXBwLXNpZGUgcXVldWUgY2FsbHMpLiBgdHJhY2s6IGZhbHNlYCByZXNvdXJjZXMgYXJlIHNraXBwZWQ7IGB0cmFjazogdHJ1ZWBcbiAgICogYWRkcyBkZXN0cm95czsgYW4gb3BlcmF0aW9ucyBsaXN0IG5hcnJvd3MgdGhlIHRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICBhd2FpdCB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICh0aGlzLl9zdGFydGVkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0ZWQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBjb25zdCBvcGVyYXRpb25zID0gdGhpcy50cmFja2VkT3BlcmF0aW9ucyh7cmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZX0pXG5cbiAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gXCJjcmVhdGVcIikpIHtcbiAgICAgICAgICBjb25zdCBjYWxsYmFja05hbWUgPSBvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiID8gXCJiZWZvcmVEZXN0cm95XCIgOiBcImJlZm9yZVVwZGF0ZVwiXG4gICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gcmVjb3JkKSA9PiB7XG4gICAgICAgICAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSByZXR1cm5cbiAgICAgICAgICAgIGlmICh0aGlzLmlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkpIHJldHVyblxuXG4gICAgICAgICAgICBjb25zdCBjYXB0dXJlZFZlcnNpb25zID0gdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZ2V0KHJlY29yZCkgfHwgW11cblxuICAgICAgICAgICAgY2FwdHVyZWRWZXJzaW9ucy5wdXNoKHRoaXMucHJlTXV0YXRpb25CYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkpXG4gICAgICAgICAgICB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5zZXQocmVjb3JkLCBjYXB0dXJlZFZlcnNpb25zKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gVFJBQ0tFRF9DQUxMQkFDS19OQU1FU1tvcGVyYXRpb25dXG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy50cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgICAgcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc1tjYWxsYmFja05hbWVdKGNhbGxiYWNrKVxuICAgICAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbGwgdHJhY2tpbmcgY2FsbGJhY2tzLCBhYm9ydHMgaW4tZmxpZ2h0IHB1bGwvcmVwbGF5L3JlYWx0aW1lXG4gICAqIHdvcmsgYW5kIHJlc29sdmVzIGFmdGVyIGl0IGlzIHF1aWVzY2VudC4gT3B0aW9uYWwgc2VsZWN0ZWQgc2NvcGUgcmVzZXQgYW5kXG4gICAqIGFwcC1vd25lZCBjbGVhbnVwIGhhcHBlbiBhZnRlciBvbGQgd29yayBkcmFpbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U3RvcE9wdGlvbnN9IFtvcHRpb25zXSAtIFN0b3AgYW5kIHNlbGVjdGVkLXNjb3BlIHJlc2V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RvcChvcHRpb25zID0ge30pIHtcbiAgICBmb3IgKGNvbnN0IHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzfSBvZiB0aGlzLl90cmFja2VkQ2FsbGJhY2tzKSB7XG4gICAgICBtb2RlbENsYXNzLnVucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MgPSBbXVxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcmVzZXRTY29wZXNGb3JMaWZlY3ljbGUob3B0aW9ucylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFib3J0cyBhbmQgZHJhaW5zIGN1cnJlbnQgd29yaywgdGhlbiBhdG9taWNhbGx5IHJlc2V0cyBzZWxlY3RlZCBzY29wZVxuICAgKiBjdXJzb3JzIHRvZ2V0aGVyIHdpdGggYW4gb3B0aW9uYWwgYXBwLW93bmVkIGxvY2FsLXJvdyBjbGVhbnVwIGhvb2suXG4gICAqIFRyYWNraW5nIGRlY2xhcmF0aW9ucyByZW1haW4gcmVnaXN0ZXJlZCBzbyB0aGUgc2FtZSBjbGllbnQgbWF5IGNvbnRpbnVlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZVtdfSBzY29wZXMgLSBTZWxlY3RlZCBzY29wZXMgdG8gcmVzZXQuXG4gICAqIEBwYXJhbSB7e2NsZWFudXA/OiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTY29wZUNsZWFudXB9fSBbb3B0aW9uc10gLSBTY29wZSBjbGVhbnVwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVzZXRTY29wZXMoc2NvcGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVUcmFuc2l0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3Jlc2V0U2NvcGVzRm9yTGlmZWN5Y2xlKHsuLi5vcHRpb25zLCByZXNldFNjb3Blczogc2NvcGVzfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIGV4dGVybmFsIGlkZW50aXR5IHJlYWQgYnkgdGhlIGNvbmZpZ3VyZWQgYXV0aCBhbmRcbiAgICogc2NvcGUtb3duZXIgcmVzb2x2ZXJzOiBvbGQgd29yayBpcyBhYm9ydGVkIGFuZCBkcmFpbmVkLCBzZWxlY3RlZCBwcml2YXRlXG4gICAqIHNjb3BlIHN0YXRlL2NhY2hlIGlzIHJlc2V0LCB0aGVuIHRoZSBhcHAncyByZXBsYWNlbWVudCBjYWxsYmFjayBydW5zIHdoaWxlXG4gICAqIG5ldyBzeW5jIHdvcmsgcmVtYWlucyBiZWhpbmQgdGhlIGxpZmVjeWNsZSBiYXJyaWVyLiBPcHRpb25hbGx5IHN1YnNjcmliZXNcbiAgICogdGhlIG5ldyB1c2VyIHNjb3BlIGJlZm9yZSByZXNvbHZpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVwbGFjZUlkZW50aXR5T3B0aW9uc30gb3B0aW9ucyAtIElkZW50aXR5IHJlcGxhY2VtZW50IGNvbnRyYWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VJZGVudGl0eShvcHRpb25zKSB7XG4gICAgaWYgKCFvcHRpb25zIHx8IHR5cGVvZiBvcHRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQucmVwbGFjZUlkZW50aXR5IHJlcXVpcmVzIGFuIG9wdGlvbnMgb2JqZWN0XCIpXG4gICAgfVxuXG4gICAgY29uc3Qge2NsZWFudXAsIHJlcGxhY2UsIHJlc2V0U2NvcGVzID0gW10sIHN1YnNjcmliZVVzZXJTY29wZSA9IGZhbHNlLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuICAgIGlmICh0eXBlb2YgcmVwbGFjZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50LnJlcGxhY2VJZGVudGl0eSByZXF1aXJlcyBhIHJlcGxhY2UgY2FsbGJhY2tcIilcbiAgICBpZiAodHlwZW9mIHN1YnNjcmliZVVzZXJTY29wZSAhPT0gXCJib29sZWFuXCIpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQucmVwbGFjZUlkZW50aXR5IHN1YnNjcmliZVVzZXJTY29wZSBtdXN0IGJlIGJvb2xlYW5cIilcblxuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcmVzZXRTY29wZXNGb3JMaWZlY3ljbGUoe2NsZWFudXAsIHJlc2V0U2NvcGVzfSlcbiAgICAgIGF3YWl0IHJlcGxhY2UoKVxuICAgIH0pXG5cbiAgICBpZiAoc3Vic2NyaWJlVXNlclNjb3BlKSBhd2FpdCB0aGlzLnN1YnNjcmliZVVzZXJTY29wZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgY2FsbGJhY2sgd2hpbGUgaG9sZGluZyB0aGUgY3VycmVudCBsaWZlY3ljbGUgZ2VuZXJhdGlvbiBhbmRcbiAgICogdHJhY2tzIGl0IHNvIHN0b3AvcmVzZXQvaWRlbnRpdHkgcmVwbGFjZW1lbnQgY2FuIGF3YWl0IHF1aWVzY2VuY2UuXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHsoc2lnbmFsOiBBYm9ydFNpZ25hbCkgPT4gUHJvbWlzZTxSZXN1bHQ+fSBjYWxsYmFjayAtIEdlbmVyYXRpb24tYm91bmQgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1bkxpZmVjeWNsZVdvcmsoY2FsbGJhY2spIHtcbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvbkNvdW50ID4gMCkgYXdhaXQgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2VcblxuICAgIGNvbnN0IHNpZ25hbCA9IHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlci5zaWduYWxcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgIGNvbnN0IHByb21pc2UgPSBjYWxsYmFjayhzaWduYWwpXG5cbiAgICB0aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrLmFkZChwcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmsuZGVsZXRlKHByb21pc2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYSBsaWZlY3ljbGUgYmFycmllcjogY29vcGVyYXRpdmVseSBhYm9ydHMgdHJhbnNwb3J0L3N0YXJ0IHdvcmssXG4gICAqIHN0b3BzIG5ldyByZWFsdGltZSBkZWxpdmVyeSwgYXdhaXRzIG9sZCBhcHBsaWVzL3JlcGxheXMvcHVsbHMsIHJlamVjdHMgb25cbiAgICogdW5leHBlY3RlZCBvbGQtd29yayBmYWlsdXJlcywgdGhlbiBydW5zIHRoZSByZXNldC9yZXBsYWNlbWVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFRyYW5zaXRpb24gYWN0aW9uIGFmdGVyIHF1aWVzY2VuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oY2FsbGJhY2spIHtcbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgKz0gMVxuXG4gICAgY29uc3QgcHJldmlvdXNUcmFuc2l0aW9uID0gdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2VcbiAgICBjb25zdCB0cmFuc2l0aW9uID0gcHJldmlvdXNUcmFuc2l0aW9uLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWJvcnRDb250cm9sbGVyID0gdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyXG4gICAgICBjb25zdCBhYm9ydFJlYXNvbiA9IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSB3YXMgc3RvcHBlZFwiKVxuXG4gICAgICBhYm9ydENvbnRyb2xsZXIuYWJvcnQoYWJvcnRSZWFzb24pXG5cbiAgICAgIGlmICh0aGlzLl9yZWFsdGltZUJyaWRnZSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWFsdGltZUJyaWRnZS51bnN1YnNjcmliZSgpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHdvcmtSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi50aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrXSlcblxuICAgICAgaWYgKHRoaXMuX3JlYWx0aW1lQnJpZGdlKSBhd2FpdCB0aGlzLl9yZWFsdGltZUJyaWRnZS53YWl0Rm9yQXBwbGllZCgpXG5cbiAgICAgIC8qKiBAdHlwZSB7dW5rbm93bltdfSAqL1xuICAgICAgY29uc3QgdW5leHBlY3RlZEVycm9ycyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIHdvcmtSZXN1bHRzKSB7XG4gICAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIgJiYgIXRoaXMuaXNMaWZlY3ljbGVBYm9ydChyZXN1bHQucmVhc29uKSkgdW5leHBlY3RlZEVycm9ycy5wdXNoKHJlc3VsdC5yZWFzb24pXG4gICAgICB9XG5cbiAgICAgIGlmICh1bmV4cGVjdGVkRXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgdW5leHBlY3RlZEVycm9yc1swXVxuICAgICAgaWYgKHVuZXhwZWN0ZWRFcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKHVuZXhwZWN0ZWRFcnJvcnMsIFwiU3luYyBjbGllbnQgbGlmZWN5Y2xlIGZhaWxlZCB3aGlsZSBiZWNvbWluZyBxdWllc2NlbnRcIilcblxuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH0pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpXG4gICAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgLT0gMVxuICAgICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgIH0pXG5cbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZSA9IHRyYW5zaXRpb24udGhlbigoKSA9PiB1bmRlZmluZWQsICgpID0+IHVuZGVmaW5lZClcblxuICAgIHJldHVybiB0cmFuc2l0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVzZXRzIHNlbGVjdGVkIHNjb3BlcyB0aHJvdWdoIHRoZSBmcmFtZXdvcmstb3duZWQgc3RvcmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U3RvcE9wdGlvbnN9IG9wdGlvbnMgLSBSZXNldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZShvcHRpb25zKSB7XG4gICAgY29uc3Qge2NsZWFudXAsIHJlc2V0U2NvcGVzID0gW10sIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc2V0U2NvcGVzKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjbGllbnQgcmVzZXRTY29wZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIGlmIChjbGVhbnVwICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNsZWFudXAgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjbGllbnQgY2xlYW51cCBtdXN0IGJlIGEgZnVuY3Rpb25cIilcbiAgICBpZiAoY2xlYW51cCAmJiByZXNldFNjb3Blcy5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IGNsZWFudXAgcmVxdWlyZXMgYXQgbGVhc3Qgb25lIHJlc2V0IHNjb3BlXCIpXG4gICAgaWYgKHJlc2V0U2NvcGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5yZXNldChyZXNldFNjb3Blcywge2NsZWFudXB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gZXJyb3IgaXMgdGhlIGZyYW1ld29yaydzIG5hcnJvdyBleHBlY3RlZCBsaWZlY3ljbGUgYWJvcnQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYW5kaWRhdGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhbiBleHBlY3RlZCBsaWZlY3ljbGUgYWJvcnQuXG4gICAqL1xuICBpc0xpZmVjeWNsZUFib3J0KGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgU3luY0NsaWVudExpZmVjeWNsZUFib3J0RXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBUaHJvd3MgdGhlIGN1cnJlbnQgbGlmZWN5Y2xlIHJlYXNvbiB3aGVuIHRoZSBzaWduYWwgaXMgYWJvcnRlZC5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIHNpZ25hbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKSB7XG4gICAgaWYgKCFzaWduYWwuYWJvcnRlZCkgcmV0dXJuXG5cbiAgICB0aHJvdyBzaWduYWwucmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyBzaWduYWwucmVhc29uIDogbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjbGllbnQgbGlmZWN5Y2xlIHdhcyBzdG9wcGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW5kIHZhbGlkYXRlcyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zIGZvciBhIHJlc291cmNlIGNvbmZpZy5cbiAgICogVHJhY2tpbmcgaXMgb24gYnkgZGVmYXVsdDogbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYSBgdHJhY2tgXG4gICAqIGtleSBxdWV1ZSBsb2NhbCBjcmVhdGVzIGFuZCB1cGRhdGVzIGF1dG9tYXRpY2FsbHk7IGB0cmFjazogZmFsc2VgIG9wdHMgYVxuICAgKiBtb2RlbCBvdXQgKGZvciBtb2RlbHMgd3JpdHRlbiBieSBub24tdXNlciBmbG93cykuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUmVzb3VyY2UgY29uZmlnIGFuZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59IFRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICovXG4gIHRyYWNrZWRPcGVyYXRpb25zKHtyZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlfSkge1xuICAgIGNvbnN0IHRyYWNrID0gcmVzb3VyY2VDb25maWcudHJhY2tcblxuICAgIGlmICh0cmFjayA9PT0gZmFsc2UpIHJldHVybiBbXVxuICAgIGlmICh0cmFjayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlNcbiAgICBpZiAodHJhY2sgPT09IHRydWUpIHJldHVybiBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdXG5cbiAgICBpZiAoIXRyYWNrIHx8IHR5cGVvZiB0cmFjayAhPT0gXCJvYmplY3RcIiB8fCAhQXJyYXkuaXNBcnJheSh0cmFjay5vcGVyYXRpb25zKSB8fCB0cmFjay5vcGVyYXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHJlc291cmNlICR7cmVzb3VyY2VUeXBlfSB0cmFjayBtdXN0IGJlIHRydWUgb3Ige29wZXJhdGlvbnM6IFsuLi5dfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgdHJhY2sub3BlcmF0aW9ucykge1xuICAgICAgaWYgKCEob3BlcmF0aW9uIGluIFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCByZXNvdXJjZSAke3Jlc291cmNlVHlwZX0gdHJhY2sub3BlcmF0aW9ucyBtdXN0IGJlIGNyZWF0ZS91cGRhdGUvZGVzdHJveSwgZ290OiAke1N0cmluZyhvcGVyYXRpb24pfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYWNrLm9wZXJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxpZmVjeWNsZSBjYWxsYmFjayBxdWV1ZWluZyBvbmUgdHJhY2tlZCBtdXRhdGlvbi4gVGhlIHF1ZXVlZFxuICAgKiBwYXlsb2FkIGFuZCBzeW5jIHR5cGUgYXJlIHNuYXBzaG90dGVkIGF0IG11dGF0aW9uLWNhbGxiYWNrIHRpbWUsIHNvXG4gICAqIGFmdGVyU2F2ZSBob29rcyBhc3NpZ25pbmcgdW5zYXZlZCBhdHRyaWJ1dGVzIChvciBhbnkgbGF0ZXIgZHJpZnQgb24gdGhlXG4gICAqIHJlY29yZCkgY2Fubm90IGNoYW5nZSB3aGF0IGdldHMgcXVldWVkIHZzIHdoYXQgd2FzIGNvbW1pdHRlZC4gUXVldWVpbmcgaXNcbiAgICogZGVmZXJyZWQgdGhyb3VnaCB0aGUgbW9kZWwgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gaXQgb25seSBydW5zXG4gICAqIG9uY2UgdGhlIG11dGF0aW9uJ3MgdHJhbnNhY3Rpb24gaGFzIGNvbW1pdHRlZCAoaW1tZWRpYXRlbHkgd2hlbiBub1xuICAgKiB0cmFuc2FjdGlvbiBpcyBvcGVuKSAtIHF1ZXVlZCBzeW5jcyBuZXZlciByZWZlcmVuY2Ugcm9sbGVkLWJhY2sgcm93cy5cbiAgICogUG9zdC1jb21taXQgcXVldWUgZmFpbHVyZXMgYXJlIHJlcG9ydGVkIHdpdGhvdXQgcmV0aHJvd2luZyBpbnRvIHRoZVxuICAgKiBkcml2ZXIncyBhZnRlckNvbW1pdCBjaGFpbiAoc2VlIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IpLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBPcGVyYXRpb24gYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMgeyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+fSBMaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqL1xuICB0cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgY29uc3QgZGF0YSA9IFN5bmNBcGlDbGllbnQucXVldWVkU3luY0RhdGEoe1xuICAgICAgICBib29sZWFuQXR0cmlidXRlczogcmVzb3VyY2VDb25maWcuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIGRhdGE6IHJlc291cmNlQ29uZmlnLnRyYWNrZWREYXRhID8gcmVzb3VyY2VDb25maWcudHJhY2tlZERhdGEoe29wZXJhdGlvbiwgcmVjb3JkfSkgOiB1bmRlZmluZWQsXG4gICAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIHJlc291cmNlOiByZWNvcmRcbiAgICAgIH0pXG4gICAgICBjb25zdCBzeW5jVHlwZSA9IHRoaXMuZGVmYXVsdFN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgY29uc3QgYmFzZVZlcnNpb24gPSByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nXG4gICAgICAgID8gdGhpcy5jYXB0dXJlZEJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuICAgICAgICA6IG51bGxcbiAgICAgIGNvbnN0IGRhdGFiYXNlT3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcbiAgICAgIGNvbnN0IG9wZXJhdGlvblNjb3BlID0gZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgICAgPyBkYXRhYmFzZU9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpXG4gICAgICAgIDogdGhpcy5jb25maWcuc3luY01vZGVsXG5cbiAgICAgIGF3YWl0IHJlY29yZC5jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlQ29uZmxpY3RUcmFja2VkU3luYyh7XG4gICAgICAgICAgICAgIGJhc2VWZXJzaW9uLFxuICAgICAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgIHJlc291cmNlOiByZWNvcmQsXG4gICAgICAgICAgICAgIHJlc291cmNlVHlwZTogcmVjb3JkLmNvbnN0cnVjdG9yLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAgICAgICBzeW5jVHlwZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUxvY2FsU3luYyh7ZGF0YSwgcmVzb3VyY2U6IHJlY29yZCwgc3luY01vZGVsOiBvcGVyYXRpb25TY29wZSwgc3luY1R5cGV9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGEgcG9zdC1jb21taXQgdHJhY2tlZC1xdWV1ZWluZyBmYWlsdXJlLiBUaGUgdHJhbnNhY3Rpb24gaGFzIGFscmVhZHlcbiAgICogY29tbWl0dGVkIHdoZW4gYWZ0ZXJDb21taXQgY2FsbGJhY2tzIHJ1biwgc28gcmV0aHJvd2luZyBoZXJlIHdvdWxkIHBvaXNvblxuICAgKiB0aGUgZHJpdmVyJ3MgYXdhaXRlZCBhZnRlckNvbW1pdCBjaGFpbiAoYnJlYWtpbmcgdW5yZWxhdGVkIGNhbGxiYWNrcykgLVxuICAgKiBpbnN0ZWFkIHRoZSBmYWlsdXJlIGdvZXMgdG8gdGhlIGNvbmZpZ3VyZWQgc3luYy5jbGllbnQub25FcnJvciBob29rLCBvciBpc1xuICAgKiBsb2dnZWQgbG91ZGx5IHRocm91Z2ggdGhlIGNsaWVudCdzIGxvZ2dlciB3aGVuIG5vbmUgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBQb3N0LWNvbW1pdCBxdWV1ZWluZyBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5jb25maWcub25FcnJvcikge1xuICAgICAgdGhpcy5jb25maWcub25FcnJvcihlcnJvcilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIoKS5lcnJvcihcIlN5bmNDbGllbnQgZmFpbGVkIHRvIHF1ZXVlIGEgdHJhY2tlZCBtdXRhdGlvbiBhZnRlciBjb21taXRcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IGNsaWVudCBsb2dnZXIuXG4gICAqIEByZXR1cm5zIHtMb2dnZXIgfCB7ZXJyb3I6ICguLi5tZXNzYWdlczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fX0gQ2xpZW50IGxvZ2dlci5cbiAgICovXG4gIGxvZ2dlcigpIHtcbiAgICB0aGlzLl9sb2dnZXIgfHw9IG5ldyBMb2dnZXIoXCJTeW5jQ2xpZW50XCIsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9ufSlcblxuICAgIHJldHVybiB0aGlzLl9sb2dnZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgcmVjb3JkIGlzIGN1cnJlbnRseSBiZWluZyB3cml0dGVuIGJ5IHB1bGwtYXBwbHkgKGVjaG8gc3VwcHJlc3Npb24pLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZWNvcmQgd3JpdGUgb3JpZ2luYXRlcyBmcm9tIGEgcmVtb3RlIGNoYW5nZS5cbiAgICovXG4gIGlzUmVtb3RlQXBwbHkocmVjb3JkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlbW90ZUFwcGx5UmVjb3Jkcy5oYXMocmVjb3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdHJhY2tlZCBtdXRhdGlvbiBxdWV1ZWluZyBpcyBjdXJyZW50bHkgc3VwcHJlc3NlZCBmb3IgYSByZWNvcmQ6XG4gICAqIGVpdGhlciB0aGUgcmVjb3JkIHdhcyBtYXJrZWQgYXMgYSByZW1vdGUgYXBwbHkgKGBtYXJrUmVtb3RlQXBwbHlgLCB1c2VkIGJ5XG4gICAqIHB1bGwgYW5kIHJlYWx0aW1lIGFwcGxpZXMpIG9yIGEgYHdpdGhvdXRUcmFja2luZ2AgY2FsbGJhY2sgaXMgcnVubmluZyBvblxuICAgKiB0aGlzIGNsaWVudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0cmFja2VkIHF1ZXVlaW5nIGlzIHN1cHByZXNzZWQgZm9yIHRoZSByZWNvcmQuXG4gICAqL1xuICBpc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpIHtcbiAgICByZXR1cm4gdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGggPiAwIHx8IHRoaXMuaXNSZW1vdGVBcHBseShyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIHdpdGggdHJhY2tlZCBtdXRhdGlvbiBxdWV1ZWluZyBzdXBwcmVzc2VkIG9uIHRoaXMgY2xpZW50IC1cbiAgICogZm9yIGNvZGUgYXBwbHlpbmcgc2VydmVyLW9yaWdpbmF0ZWQgZGF0YSBvdXRzaWRlIHRoZSBkZXJpdmVkIHB1bGwvcmVhbHRpbWVcbiAgICogYXBwbGllcnMgKGxlZ2FjeSBwdWxsIHBhdGhzLCBpbXBvcnRlcnMsIHNpZ24taW4gYmFja2ZpbGxzKSwgc28gdGhlaXIgd3JpdGVzXG4gICAqIGFyZSBub3QgZWNob2VkIGJhY2sgdG8gdGhlIHNlcnZlciBhcyBkZXZpY2UgY2hhbmdlcy4gU3VwcHJlc3Npb24gY292ZXJzIHRoZVxuICAgKiB3aG9sZSBhc3luYyBkdXJhdGlvbiBvZiB0aGUgY2FsbGJhY2sgKG5lc3RlZCBjYWxscyBzdGFjaykgYW5kIGlzXG4gICAqIGNsaWVudC13aWRlIHdoaWxlIGl0IHJ1bnM6IG11dGF0aW9ucyBmcm9tIGNvbmN1cnJlbnRseSBydW5uaW5nIHRhc2tzIGFyZVxuICAgKiBhbHNvIHN1cHByZXNzZWQgZm9yIHRoYXQgd2luZG93LCBzbyBwcmVmZXIgYG1hcmtSZW1vdGVBcHBseShyZWNvcmQpYCB3aGVuXG4gICAqIHdyaXRlcyBmcm9tIG90aGVyIGZsb3dzIGNhbiBpbnRlcmxlYXZlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD4gfCBUfSBjYWxsYmFjayAtIFdvcmsgd2hvc2UgbW9kZWwgd3JpdGVzIHNob3VsZCBub3QgcXVldWUgdHJhY2tlZCBzeW5jcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IFRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRob3V0VHJhY2tpbmcoY2FsbGJhY2spIHtcbiAgICB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aCsrXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGgtLVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBvbmUgcmVjb3JkIGFzIGJlaW5nIHdyaXR0ZW4gZnJvbSBzZXJ2ZXItb3JpZ2luYXRlZCBkYXRhIHNvIHRyYWNrZWRcbiAgICogbXV0YXRpb24gcXVldWVpbmcgc2tpcHMgaXQgKHJlY29yZC1wcmVjaXNlIHN1cHByZXNzaW9uKS4gVGhlIGRlcml2ZWQgcHVsbFxuICAgKiBhbmQgcmVhbHRpbWUgYXBwbGllcnMgdXNlIHRoaXMgaW50ZXJuYWxseSBhcm91bmQgZXZlcnkgYXBwbGllZCB3cml0ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTG9jYWwgbW9kZWwgcmVjb3JkIGFib3V0IHRvIGJlIHdyaXR0ZW4uXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSBSZWxlYXNlIGNhbGxiYWNrIHJlLWVuYWJsaW5nIHRyYWNraW5nIGZvciB0aGUgcmVjb3JkLlxuICAgKi9cbiAgbWFya1JlbW90ZUFwcGx5KHJlY29yZCkge1xuICAgIHRoaXMuX3JlbW90ZUFwcGx5UmVjb3Jkcy5hZGQocmVjb3JkKVxuXG4gICAgcmV0dXJuICgpID0+IHRoaXMuX3JlbW90ZUFwcGx5UmVjb3Jkcy5kZWxldGUocmVjb3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGlzIGNsaWVudCBhcyB0aGUgYXBwJ3MgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRDdXJyZW50KCkge1xuICAgIHNldEN1cnJlbnRTeW5jQ2xpZW50KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwJ3MgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1N5bmNDbGllbnR9IEN1cnJlbnQgc3luYyBjbGllbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtTeW5jQ2xpZW50fSAqLyAoY3VycmVudFN5bmNDbGllbnQoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzeW5jIGNsaWVudCBkZXJpdmVkIGZyb20gdGhlIGdpdmVuIGNvbmZpZ3VyYXRpb24uIEFsaWFzIGZvclxuICAgKiBgbmV3IFN5bmNDbGllbnQoe2NvbmZpZ3VyYXRpb24sIC4uLm9wdGlvbnN9KWAuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzIGFuZCB0aGUgc3luYy5jbGllbnQgYmxvY2suIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7T21pdDxpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRPcHRpb25zLCBcImNvbmZpZ3VyYXRpb25cIj59IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICogQHJldHVybnMge1N5bmNDbGllbnR9IFN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBmcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBuZXcgU3luY0NsaWVudCh7Li4ub3B0aW9ucywgY29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgKG9yIHJlLWFjdGl2YXRlcykgYSBzeW5jIHNjb3BlIGZyb20gYSBtb2RlbCBxdWVyeSBhbmQgcHVsbHMgaXQgd2hlbiBvbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgZGVjbGFyaW5nIHRoZSBzeW5jIHNjb3BlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gU3luYyBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSBvZiB0aGUgcHVsbCB0aGlzIGRlY2xhcmF0aW9uIHRyaWdnZXJzLCBzbyB0aGUgaW5pdGlhbCBpbXBvcnQgb2YgYSBuZXdseSBkZWNsYXJlZCBzY29wZSBjYW4gZHJpdmUgYSBcInN5bmNlZENvdW50IG9mIHRvdGFsXCIgcHJvZ3Jlc3MgYmFyLiBTZWUgYHB1bGwoKWAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIE1hcmtzIHRoZSBjaGFuZ2VzIHJlcXVlc3QocykgYXMgYSB1c2VyLWluaXRpYXRlZCByZWZyZXNoLCBzbyB0aGUgc2VydmVyIGNhbiBieXBhc3MgdXBzdHJlYW0taW1wb3J0IHRocm90dGxlIHdpbmRvd3MuIFNlZSBgcHVsbCgpYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3Njb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGUsIHB1bGxlZDogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfT59IERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdCAobnVsbCB3aGlsZSBvZmZsaW5lKS5cbiAgICovXG4gIGFzeW5jIHN5bmMocXVlcnksIHtvblByb2dyZXNzLCB1cHN0cmVhbVJlZnJlc2h9ID0ge30pIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGNvbnN0IHNjb3BlID0gc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KVxuICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgIGNvbnN0IHNjb3BlUm93ID0gYXdhaXQgc2NvcGVTdG9yZS5maW5kT3JDcmVhdGVTY29wZShzY29wZSlcblxuICAgIGlmICghc2NvcGVSb3cuY3Vyc29yUGF5bG9hZCAmJiB0aGlzLmNvbmZpZy5sZWdhY3lDdXJzb3IpIHtcbiAgICAgIGNvbnN0IGxlZ2FjeUN1cnNvclBheWxvYWQgPSBhd2FpdCB0aGlzLmNvbmZpZy5sZWdhY3lDdXJzb3Ioe3Njb3BlfSlcbiAgICAgIGNvbnN0IGxlZ2FjeUN1cnNvciA9IFN5bmNBcGlDbGllbnQuc3luY0N1cnNvckZyb21QYXlsb2FkKGxlZ2FjeUN1cnNvclBheWxvYWQpXG5cbiAgICAgIGlmIChsZWdhY3lDdXJzb3IpIGF3YWl0IHNjb3BlU3RvcmUuc2F2ZUN1cnNvcihzY29wZVJvdywgbGVnYWN5Q3Vyc29yKVxuICAgIH1cblxuICAgIHJldHVybiB7cHVsbGVkOiBhd2FpdCB0aGlzLnB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0pLCBzY29wZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWFjdGl2YXRlcyB0aGUgc3luYyBzY29wZSBkZWNsYXJlZCBieSBhIG1vZGVsIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFF1ZXJ5IHdob3NlIHNjb3BlIHNob3VsZCBzdG9wIHN5bmNpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zeW5jKHF1ZXJ5KSB7XG4gICAgdGhpcy5hc3NlcnRRdWVyeU93bmVyc2hpcChxdWVyeSlcbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5kZWFjdGl2YXRlKHNlcmlhbGl6ZWRTY29wZUZyb21RdWVyeShxdWVyeSkpXG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgY2hhbmdlcyBmb3IgZXZlcnkgYWN0aXZlIHNjb3BlIHdpdGggcGVyLXNjb3BlIGN1cnNvcnMgKHNpbmdsZS1mbGlnaHRlZCwgb25saW5lLWdhdGVkKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFB1bGwgb3B0aW9ucy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFtvcHRpb25zLm9uUHJvZ3Jlc3NdIC0gQ2FsbGVkIHBlciBhcHBsaWVkIHBhZ2Ugd2l0aCBjdW11bGF0aXZlIGB7cGFnZXMsIHN5bmNlZENvdW50LCB0b3RhbH1gIGFjcm9zcyB0aGUgcHVsbGVkIHNjb3BlcywgZm9yIHJlbmRlcmluZyBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIgKGUuZy4gYSBmdWxsLWltcG9ydCBzY3JlZW4pLiBPcHRpb25hbDsgb21pdHRpbmcgaXQga2VlcHMgdGhlIGV4aXN0aW5nIGJlaGF2aW9yLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnVwc3RyZWFtUmVmcmVzaF0gLSBTZW5kcyBgdXBzdHJlYW1SZWZyZXNoOiB0cnVlYCBvbiB0aGUgY2hhbmdlcyByZXF1ZXN0KHMpLCB0ZWxsaW5nIHRoZSBzZXJ2ZXIgdGhpcyBwdWxsIGlzIHVzZXItaW5pdGlhdGVkIHNvIGl0IGNhbiBieXBhc3MgdXBzdHJlYW0taW1wb3J0IHRocm90dGxlIHdpbmRvd3MgKHNlZSBkb2NzL3N5bmMtdXBzdHJlYW0taW1wb3J0cy5tZCkuIEJhY2tncm91bmQgcHVsbHMgb21pdCBpdCBhbmQgc3RheSB0aHJvdHRsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbD59IENvbWJpbmVkIHB1bGwgcmVzdWx0LCBvciBudWxsIHdoaWxlIG9mZmxpbmUuXG4gICAqL1xuICBhc3luYyBwdWxsKHtvblByb2dyZXNzLCB1cHN0cmVhbVJlZnJlc2h9ID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9wdWxsKHtvblByb2dyZXNzLCBzaWduYWwsIHVwc3RyZWFtUmVmcmVzaH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGwgaW1wbGVtZW50YXRpb24gYm91bmQgdG8gb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFB1bGwgYXJncy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IGFyZ3Muc2lnbmFsIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MudXBzdHJlYW1SZWZyZXNoXSAtIFVzZXItaW5pdGlhdGVkIHVwc3RyZWFtIHJlZnJlc2ggbWFya2VyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGw+fSBDb21iaW5lZCBwdWxsIHJlc3VsdCwgb3IgbnVsbCB3aGlsZSBvZmZsaW5lLlxuICAgKi9cbiAgYXN5bmMgX3B1bGwoe29uUHJvZ3Jlc3MsIHNpZ25hbCwgdXBzdHJlYW1SZWZyZXNofSkge1xuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAoIShhd2FpdCB0aGlzLmlzT25saW5lKCkpKSByZXR1cm4gbnVsbFxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfSAqL1xuICAgIGxldCBjb21iaW5lZFJlc3VsdCA9IG51bGxcblxuICAgIGF3YWl0IFN5bmNBcGlDbGllbnQuc2luZ2xlRmxpZ2h0KGB2ZWxvY2lvdXMtc3luYy1jbGllbnQtcHVsbC0ke3RoaXMuX2NsaWVudE51bWJlcn1gLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBjb25zdCBhdXRoZW50aWNhdGlvblRva2VuID0gYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBjb25zdCBzY29wZVN0b3JlID0gdGhpcy5zY29wZVN0b3JlKClcbiAgICAgIGNvbnN0IGFwcGx5U3luYyA9IHRoaXMucmVtb3RlQXBwbHlTeW5jKClcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHtcbiAgICAgICAgY2hhbmdlZDogZmFsc2UsXG4gICAgICAgIHBhZ2VzOiAwLFxuICAgICAgICByZXNvdXJjZUNoYW5nZWQ6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovICh7fSksXG4gICAgICAgIHJlc291cmNlQ291bnRzOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSksXG4gICAgICAgIHN5bmNlZENvdW50OiAwLFxuICAgICAgICB0b3RhbDogMFxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHNjb3BlUm93IG9mIGF3YWl0IHNjb3BlU3RvcmUuYWN0aXZlU2NvcGVzKCkpIHtcbiAgICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgICAvLyBDdW11bGF0ZSBzY29wZSBwcm9ncmVzcyBvbnRvIHRoZSBjb3VudHMgb2YgdGhlIHNjb3BlcyBhbHJlYWR5IHB1bGxlZCBzbyBhIHNpbmdsZVxuICAgICAgICAvLyBzY29wZSdzIHBlci1wYWdlIHByb2dyZXNzIHJlYWRzIGV4YWN0bHkgaXRzIG93biBjb3VudHMgKGJhc2UgMCksIGFuZCBtdWx0aS1zY29wZVxuICAgICAgICAvLyBwdWxscyByZXBvcnQgYSBydW5uaW5nIGN1bXVsYXRpdmUgdG90YWwgYWNyb3NzIGV2ZXJ5IHNjb3BlLlxuICAgICAgICBjb25zdCBiYXNlUGFnZXMgPSByZXN1bHQucGFnZXNcbiAgICAgICAgY29uc3QgYmFzZVN5bmNlZENvdW50ID0gcmVzdWx0LnN5bmNlZENvdW50XG4gICAgICAgIGNvbnN0IGJhc2VUb3RhbCA9IHJlc3VsdC50b3RhbFxuICAgICAgICBjb25zdCBzY29wZVJlc3VsdCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucHVsbENoYW5nZXMoe1xuICAgICAgICAgIGFwcGx5U3luYyxcbiAgICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICAgIGxvYWRDdXJzb3I6IGFzeW5jICgpID0+IGF3YWl0IHNjb3BlU3RvcmUubG9hZEN1cnNvcihzY29wZVJvdyksXG4gICAgICAgICAgb25Qcm9ncmVzczogb25Qcm9ncmVzcyA/IChwcm9ncmVzcykgPT4gb25Qcm9ncmVzcyh7XG4gICAgICAgICAgICBwYWdlczogYmFzZVBhZ2VzICsgcHJvZ3Jlc3MucGFnZXMsXG4gICAgICAgICAgICBzeW5jZWRDb3VudDogYmFzZVN5bmNlZENvdW50ICsgcHJvZ3Jlc3Muc3luY2VkQ291bnQsXG4gICAgICAgICAgICB0b3RhbDogYmFzZVRvdGFsICsgcHJvZ3Jlc3MudG90YWxcbiAgICAgICAgICB9KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBwb3N0Q2hhbmdlczogYXN5bmMgKHBheWxvYWQsIG9wdGlvbnMpID0+IGF3YWl0IHRoaXMuY29uZmlnLnBvc3RDaGFuZ2VzKHtcbiAgICAgICAgICAgIC4uLnBheWxvYWQsXG4gICAgICAgICAgICAvLyBPbmx5IHRoZSBhbGwtdHlwZXMgc2NvcGUgY2FycmllcyB0aGUgdHlwZSBsaXN0OyBhIHR5cGUtZGVjbGFyZWQgc2NvcGUgbmVlZHMgbm9uZS5cbiAgICAgICAgICAgIHNjb3BlOiB7XG4gICAgICAgICAgICAgIGNvbmRpdGlvbnM6IHNjb3BlUm93LmNvbmRpdGlvbnMsXG4gICAgICAgICAgICAgIHJlc291cmNlVHlwZTogc2NvcGVSb3cucmVzb3VyY2VUeXBlLFxuICAgICAgICAgICAgICAuLi4oc2NvcGVSb3cucmVzb3VyY2VUeXBlID09PSBudWxsID8ge3Jlc291cmNlVHlwZXM6IHRoaXMudXNlclNjb3BlUmVzb3VyY2VUeXBlcygpfSA6IHt9KVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC4uLih1cHN0cmVhbVJlZnJlc2ggPyB7dXBzdHJlYW1SZWZyZXNoOiB0cnVlfSA6IHt9KVxuICAgICAgICAgIH0sIG9wdGlvbnMpLFxuICAgICAgICAgIHNhdmVDdXJzb3I6IGFzeW5jIChjdXJzb3IpID0+IGF3YWl0IHNjb3BlU3RvcmUuc2F2ZUN1cnNvcihzY29wZVJvdywgY3Vyc29yKSxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcblxuICAgICAgICByZXN1bHQuY2hhbmdlZCB8fD0gc2NvcGVSZXN1bHQuY2hhbmdlZFxuICAgICAgICByZXN1bHQucGFnZXMgKz0gc2NvcGVSZXN1bHQucGFnZXNcbiAgICAgICAgcmVzdWx0LnN5bmNlZENvdW50ICs9IHNjb3BlUmVzdWx0LnN5bmNlZENvdW50XG4gICAgICAgIHJlc3VsdC50b3RhbCArPSBzY29wZVJlc3VsdC50b3RhbFxuXG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlUmVzdWx0LnJlc291cmNlQ291bnRzKSkge1xuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdID0gKHJlc3VsdC5yZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdIHx8IDApICsgY291bnRcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIGNoYW5nZWRdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlUmVzdWx0LnJlc291cmNlQ2hhbmdlZCkpIHtcbiAgICAgICAgICByZXN1bHQucmVzb3VyY2VDaGFuZ2VkW3Jlc291cmNlVHlwZV0gfHw9IGNoYW5nZWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb21iaW5lZFJlc3VsdCA9IHJlc3VsdFxuICAgIH0pXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgcmV0dXJuIGNvbWJpbmVkUmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBkZXJpdmVkIHJlbW90ZS1jaGFuZ2UgYXBwbGllciBzaGFyZWQgYnkgcHVsbHMgYW5kIHJlYWx0aW1lIHB1c2hlczpcbiAgICogYXBwbGllcyB0aHJvdWdoIHRoZSBkZWNsYXJlZCByZXNvdXJjZSBjb25maWdzLCByZWdpc3RlcnMgZWFjaCB3cml0dGVuIHJlY29yZFxuICAgKiBmb3IgZWNobyBzdXBwcmVzc2lvbiAodHJhY2tlZCByZXNvdXJjZXMgZG8gbm90IHJlLXF1ZXVlIGFwcGxpZWQgY2hhbmdlcyksIGFuZFxuICAgKiBmYWlscyBsb3VkbHkgaW5zdGVhZCBvZiBzaWxlbnRseSBza2lwcGluZyB1bmNvbmZpZ3VyZWQgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge3tzb3VyY2U/OiBzdHJpbmd9fSBbYXJnc10gLSBFcnJvciBjb250ZXh0IGRlc2NyaWJpbmcgd2hlcmUgdGhlIGNoYW5nZSBjYW1lIGZyb20uXG4gICAqIEByZXR1cm5zIHsoc3luYzogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IExvdWQgcmVtb3RlLWNoYW5nZSBhcHBsaWVyLlxuICAgKi9cbiAgcmVtb3RlQXBwbHlTeW5jKHtzb3VyY2UgPSBcInB1bGxlZCBjaGFuZ2VcIn0gPSB7fSkge1xuICAgIHJldHVybiBhc3luYyAoc3luYykgPT4ge1xuICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gc3luYy5yZXNvdXJjZVR5cGUoKVxuICAgICAgY29uc3QgY29uZmlndXJlZFJlc291cmNlID0gcmVzb3VyY2VUeXBlID8gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gOiB1bmRlZmluZWRcblxuICAgICAgaWYgKCFyZXNvdXJjZVR5cGUgfHwgIWNvbmZpZ3VyZWRSZXNvdXJjZT8uYXR0cmlidXRlcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgcmVzb3VyY2Ugd2l0aCBwdWxsIGF0dHJpYnV0ZXMgY29uZmlndXJlZCBmb3IgJHtzb3VyY2V9OiAke1N0cmluZyhyZXNvdXJjZVR5cGUpfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgICBjb25zdCBkYXRhID0gc3luYy5kYXRhKClcbiAgICAgICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHRoaXMuY29uZmlnLnJlc291cmNlc1tyZXNvdXJjZVR5cGVdLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgICAgICBpZiAodmVyc2lvbkF0dHJpYnV0ZSkge1xuICAgICAgICAgIGNvbnN0IGRhdGFBdHRyaWJ1dGVzID0gZGF0YSAmJiB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShkYXRhKVxuICAgICAgICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRhdGEpXG4gICAgICAgICAgICA6IHt9XG5cbiAgICAgICAgICB0aGlzLm5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkOiBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKCkpLCByZXNvdXJjZVR5cGUsIHZlcnNpb246IGRhdGFBdHRyaWJ1dGVzW3ZlcnNpb25BdHRyaWJ1dGVdfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHB1bGxSZXNvdXJjZUNvbmZpZ3MgPSB0aGlzLnB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKVxuICAgICAgICBjb25zdCBhcHBsaWVyID0gU3luY0FwaUNsaWVudC5yZXNvdXJjZUFwcGxpZXIocHVsbFJlc291cmNlQ29uZmlncywgKHJlY29yZCkgPT4ge1xuICAgICAgICAgIGlmIChvcGVyYXRpb24pIHRoaXMuYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFya1JlbW90ZUFwcGx5KHJlY29yZClcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gYXdhaXQgYXBwbGllcihzeW5jKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNoYXJlZCBhcHAtbGlmZXRpbWUgd2Vic29ja2V0IGNvbm5lY3Rpb24gYWxsIHN5bmMgdHJhZmZpY1xuICAgKiByaWRlcywgb3IgbnVsbCB3aGVuIG5vbmUgaXMgY29uZmlndXJlZC4gQnVpbHQgb25jZSBhbmQgbWVtb2l6ZWQgKHBlclxuICAgKiBjbGllbnQpOiBhbiBhcHAtcHJvdmlkZWQgYHN5bmMuY2xpZW50LndlYnNvY2tldENsaWVudGAgaW5zdGFuY2Ugd2lucyAodGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBjYW4gcGFzcyBpdHMgb3duIGNsaWVudCBzbyBvbmUgc29ja2V0IGNhcnJpZXNcbiAgICogZXZlcnl0aGluZyksIGVsc2UgYSBmcmFtZXdvcmstb3duZWQgcmVjb25uZWN0aW5nIHtAbGluayBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9XG4gICAqIGJ1aWx0IGZyb20gYHN5bmMuY2xpZW50LndlYnNvY2tldFVybGAuIFRoZSByZWFsdGltZSBicmlkZ2UgcmlkZXMgdGhpc1xuICAgKiBjb25uZWN0aW9uIHdpdGhvdXQgb3duaW5nIGl0cyBsaWZlY3ljbGU7IHdoZW4gbmVpdGhlciBpcyBjb25maWd1cmVkIHRoZVxuICAgKiBicmlkZ2UgZmFsbHMgYmFjayB0byB0aGUgZGVwcmVjYXRlZCBwZXItY3ljbGUgYHJlYWx0aW1lLmNyZWF0ZUNsaWVudGAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTaGFyZWRDb25uZWN0aW9uIHwgbnVsbH0gU2hhcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uLCBvciBudWxsLlxuICAgKi9cbiAgc3luY0Nvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX3N5bmNDb25uZWN0aW9uICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9zeW5jQ29ubmVjdGlvblxuXG4gICAgaWYgKHRoaXMuY29uZmlnLndlYnNvY2tldENsaWVudCkge1xuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB0aGlzLmNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9IGVsc2UgaWYgKHRoaXMuY29uZmlnLndlYnNvY2tldFVybCkge1xuICAgICAgY29uc3QgdXJsID0gdHlwZW9mIHRoaXMuY29uZmlnLndlYnNvY2tldFVybCA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5jb25maWcud2Vic29ja2V0VXJsKCkgOiB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmxcblxuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB1cmwgPyBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHt1cmx9KSA6IG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3N5bmNDb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0aGUgZGVyaXZlZCByZWFsdGltZSBjaGFubmVscyBzbyBwdXNoZWQgd2Vic29ja2V0IGNoYW5nZXMgYXBwbHlcbiAgICogdGhyb3VnaCB0aGUgc2FtZSBkZXJpdmVkIGFwcGxpZXIgYXMgcHVsbHMgKGlkZW1wb3RlbnQsIHNpbmdsZS1mbGlnaHRlZCkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtjb250ZXh0XSAtIEFwcCBjb250ZXh0IHBhc3NlZCB0byB0aGUgZGVwcmVjYXRlZCBgc3luYy5jbGllbnQucmVhbHRpbWUuY2hhbm5lbHNgIGNhbGxiYWNrIChydW50aW1lIHNjb3BlIHZhbHVlcykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3Vic2NyaWJlUmVhbHRpbWUoY29udGV4dCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkuc3Vic2NyaWJlKGNvbnRleHQsIHtzaWduYWx9KVxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0aGUgc2VydmVyLWVudW1lcmF0ZWQgdXNlciBzY29wZTogXCJldmVyeXRoaW5nIG15IGFiaWxpdHkgY2FuXG4gICAqIHNlZVwiLiBEZWNsYXJlcyBhIHVzZXIgc2NvcGUgKGVtcHR5IGNvbmRpdGlvbnMpIGZvciBldmVyeSBwdWxsYWJsZSBzeW5jZWRcbiAgICogcmVzb3VyY2UgdHlwZSwgc3Vic2NyaWJlcyByZWFsdGltZSBzbyB0aGVpciBmcmFtZXdvcmsgc3luYyBjaGFubmVsXG4gICAqIHN1YnNjcmlwdGlvbnMgZ28gbGl2ZSwgYW5kIHB1bGxzIHNvIHRoZSBkZXZpY2UgY2F0Y2hlcyB1cC4gVGhlIHNlcnZlclxuICAgKiBhdXRob3JpemVzIGVhY2ggZW1wdHktY29uZGl0aW9ucyBzY29wZSB0aHJvdWdoIHRoZSBhcHAgc3luYyByZXNvdXJjZSdzXG4gICAqIGBhdXRob3JpemVDaGFuZ2VzYCBhbmQgcmUtY2hlY2tzIHJlY29yZCBhY2Nlc3MgcGVyIGRlbGl2ZXJ5LCBzbyB0aGUgY2xpZW50XG4gICAqIHN1YnNjcmliZXMgd2l0aCBqdXN0IGl0cyB0b2tlbiBhbmQgdGhlIHNlcnZlciBkZWNpZGVzIG1lbWJlcnNoaXAuXG4gICAqIElkZW1wb3RlbnQgYW5kIHNpbmdsZS1mbGlnaHRlZCBsaWtlIHtAbGluayBTeW5jQ2xpZW50I3N1YnNjcmliZVJlYWx0aW1lfS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdWJzY3JpYmVVc2VyU2NvcGUoKSB7XG4gICAgaWYgKHRoaXMuX3VzZXJTY29wZVN0YXRlID09PSBcInN1YnNjcmliZWRcIikgcmV0dXJuXG5cbiAgICBpZiAoIXRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UpIHtcbiAgICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZShzaWduYWwpKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuZCBhY3RpdmF0ZXMgdGhlIHVzZXIgc2NvcGUgZm9yIGV2ZXJ5IHB1bGxhYmxlIHJlc291cmNlLCB0aGVuXG4gICAqIHN1YnNjcmliZXMgcmVhbHRpbWUgYW5kIHB1bGxzLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBzaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc3Vic2NyaWJlVXNlclNjb3BlKHNpZ25hbCkge1xuICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJzdWJzY3JpYmluZ1wiXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkuZmluZE9yQ3JlYXRlU2NvcGUoYXdhaXQgdGhpcy51c2VyU2NvcGUoKSlcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgYXdhaXQgdGhpcy5zdWJzY3JpYmVSZWFsdGltZSgpXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBhd2FpdCB0aGlzLnB1bGwoKVxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwic3Vic2NyaWJlZFwiXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5zdWJzY3JpYmVzIHRoZSB1c2VyIHNjb3BlOiBkZWFjdGl2YXRlcyB0aGUgcGVyLXJlc291cmNlIHVzZXIgc2NvcGVzIGFuZFxuICAgKiBjbG9zZXMgdGhlIHJlYWx0aW1lIGNoYW5uZWwgc3Vic2NyaXB0aW9ucy4gVGhlIHNoYXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvblxuICAgKiBzdGF5cyBvcGVuIHdoZW4gb25lIGlzIGNvbmZpZ3VyZWQgKHNpZ24tb3V0IGRyb3BzIHN1YnNjcmlwdGlvbnMgd2l0aG91dFxuICAgKiBkaXNjb25uZWN0aW5nKSwgc28gYSBzdWJzZXF1ZW50IHNpZ24taW4gcmVzdWJzY3JpYmVzIG92ZXIgdGhlIHNhbWUgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVuc3Vic2NyaWJlVXNlclNjb3BlKCkge1xuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoYXdhaXQgdGhpcy51c2VyU2NvcGUoKSlcblxuICAgIGF3YWl0IHRoaXMudW5zdWJzY3JpYmVSZWFsdGltZSgpXG5cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB1c2VyIHNjb3BlOiBhIHNpbmdsZSBhbGwtdHlwZXMgc2NvcGUgKG51bGwgcmVzb3VyY2VUeXBlKSB3aXRoIGVtcHR5XG4gICAqIGNvbmRpdGlvbnMsIHBhcnRpdGlvbmVkIGxvY2FsbHkgYnkgb3duZXIuIE9uZSBzY29wZSAtIG5vdCBvbmUgcGVyIHJlc291cmNlXG4gICAqIHR5cGUgLSBzbyB0aGUgc2VydmVyIGF1dGhvcml6ZXMgdGhlIGNhbGxlciBvbmNlIHBlciBzeW5jIGFuZCBwZXIgc3Vic2NyaWJlLFxuICAgKiBob3dldmVyIG1hbnkgcmVzb3VyY2UgdHlwZXMgaXQgc2VydmVzLiBUaGUgc2VydmVyIGRlY2lkZXMgd2hpY2ggdHlwZXMgdGhlXG4gICAqIGNhbGxlciBtYXkgc2VlOyB0aGUgY2xpZW50IGFwcGxpZXMgZWFjaCBwdWxsZWQgcm93IGJ5IHRoZSByZXNvdXJjZSB0eXBlIG9uXG4gICAqIGl0cyBvd24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZT59IFRoZSB1c2VyIHNjb3BlLlxuICAgKi9cbiAgYXN5bmMgdXNlclNjb3BlKCkge1xuICAgIHJldHVybiB7Y29uZGl0aW9uczoge30sIG93bmVyOiBhd2FpdCB0aGlzLnVzZXJTY29wZU93bmVyKCksIHJlc291cmNlVHlwZTogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcmVzb3VyY2UgdHlwZXMgdGhlIHVzZXIgc2NvcGUgY292ZXJzOiBldmVyeSBkZWNsYXJlZCByZXNvdXJjZSB0aGF0XG4gICAqIHJlY2VpdmVzIHB1bGxlZCBjaGFuZ2VzIChoYXMgcHVsbCBgYXR0cmlidXRlc2ApLCBzbyB0aGUgY2xpZW50IGNhbiBhcHBseVxuICAgKiB0aGVtLiBTZW50IHdpdGggdGhlIHNjb3BlIGFzIGEgZGVsaXZlcnkvdHlwZSBmaWx0ZXIgLSBpdCBuYXJyb3dzLCBuZXZlclxuICAgKiB3aWRlbnMsIHdoYXQgdGhlIHNlcnZlcidzIGF1dGhvcml6YXRpb24gYWxyZWFkeSBhbGxvd3MsIGFuZCBpdCBrZWVwcyBhXG4gICAqIGJyb2FkY2FzdCBvZiBhIHR5cGUgdGhpcyBjbGllbnQgY2Fubm90IGFwcGx5IGZyb20gcmVhY2hpbmcgdGhlIHNlcnZlcidzXG4gICAqIHBlci1kZWxpdmVyeSBhY2Nlc3MgcmUtY2hlY2sgKGEgZGF0YWJhc2UgcXVlcnkgcGVyIG1hdGNoZWQgYnJvYWRjYXN0LCBwZXJcbiAgICogc3Vic2NyaWJlZCBkZXZpY2UpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IFB1bGxhYmxlIHJlc291cmNlIHR5cGUgbmFtZXMuXG4gICAqL1xuICB1c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLnB1bGxSZXNvdXJjZUNvbmZpZ3MoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgbG9jYWwgcGFydGl0aW9uIGtleSBmb3IgdGhlIHVzZXIgc2NvcGU6IHRoZSBjdXJyZW50bHlcbiAgICogY29uZmlndXJlZCBhdXRoZW50aWNhdGVkIGlkZW50aXR5ICh0aGUgc3luYyBhdXRoIHRva2VuKS4gUGFydGl0aW9uaW5nIHRoZVxuICAgKiB1c2VyIHNjb3BlJ3MgbG9jYWwgc2NvcGUvY3Vyc29yIHJvd3MgYnkgdGhpcyBvd25lciBrZWVwcyB0aGVcbiAgICogZW1wdHktY29uZGl0aW9ucyBjdXJzb3IgZnJvbSBsZWFraW5nIGFjcm9zcyBhY2NvdW50cyBvbiBhIHNoYXJlZCBkZXZpY2VcbiAgICogKGFjY291bnQgQiBzaWduaW5nIGluIGFmdGVyIGFjY291bnQgQSBnZXRzIGEgZnJlc2ggY3Vyc29yKSB3aGlsZSB0aGUgc2FtZVxuICAgKiBhY2NvdW50IHJlY29ubmVjdGluZyBrZWVwcyBpdHMgY3Vyc29yIGNvbnRpbnVpdHkuIFRoZSBvd25lciBpcyBhIGxvY2FsXG4gICAqIHBhcnRpdGlvbiBrZXkgb25seSDigJQgcHVsbHMgc3RpbGwgcG9zdCBlbXB0eSBjb25kaXRpb25zIHRvIHRoZSBzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFVzZXItc2NvcGUgb3duZXIgcGFydGl0aW9uIGtleS5cbiAgICovXG4gIGFzeW5jIHVzZXJTY29wZU93bmVyKCkge1xuICAgIHJldHVybiBTdHJpbmcoYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFVuc3Vic2NyaWJlcyB0aGUgcmVhbHRpbWUgY2hhbm5lbHMgYW5kIGRpc2Nvbm5lY3RzIHRoZSB3ZWJzb2NrZXQgY2xpZW50IChpZGVtcG90ZW50KS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN1YnNjcmliZVJlYWx0aW1lKCkge1xuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS51bnN1YnNjcmliZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB0aGUgcmVhbHRpbWUgc3Vic2NyaXB0aW9uIHN0YXRlIGFuZCBwZXItY2hhbm5lbCByZWFkaW5lc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPFN5bmNSZWFsdGltZUJyaWRnZVtcInN0YXR1c1wiXT59IFJlYWx0aW1lIHN0YXR1cy5cbiAgICovXG4gIHJlYWx0aW1lU3RhdHVzKCkge1xuICAgIHJldHVybiB0aGlzLnJlYWx0aW1lQnJpZGdlKCkuc3RhdHVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgcmVhbHRpbWUgbWVzc2FnZSBhcHBsaWVzIGFuZCBhbnkgc2NoZWR1bGVkXG4gICAqIHB1bGwtb24tcmVjb25uZWN0ICh1c2VmdWwgaW4gdGVzdHMgYW5kIHNodXRkb3duIGZsb3dzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB3YWl0Rm9yUmVhbHRpbWVBcHBsaWVkKCkge1xuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS53YWl0Rm9yQXBwbGllZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IHJlYWx0aW1lIGJyaWRnZS5cbiAgICogQHJldHVybnMge1N5bmNSZWFsdGltZUJyaWRnZX0gUmVhbHRpbWUgYnJpZGdlLlxuICAgKi9cbiAgcmVhbHRpbWVCcmlkZ2UoKSB7XG4gICAgdGhpcy5fcmVhbHRpbWVCcmlkZ2UgfHw9IG5ldyBTeW5jUmVhbHRpbWVCcmlkZ2Uoe3N5bmNDbGllbnQ6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlYWx0aW1lQnJpZGdlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGEgbG9jYWwgbW9kZWwgY2hhbmdlIGFzIGEgcGVuZGluZyBzeW5jIHJvdyBhbmQgc2NoZWR1bGVzIGFuIGltbWVkaWF0ZVxuICAgKiByZXBsYXkgYXR0ZW1wdCAoa2VwdCBwZW5kaW5nIHdoaWxlIG9mZmxpbmUgb3Igd2hlbiB0aGUgYmFja2VuZCByZWplY3RzIGl0KS5cbiAgICogQHBhcmFtIHt7YmFzZVZlcnNpb24/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCByZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wZXJhdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHN5bmNUeXBlPzogc3RyaW5nfX0gYXJncyAtIFF1ZXVlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IFBlbmRpbmcgbG9jYWwgc3luYyByb3cgb3IgZHVyYWJsZSBjb25mbGljdC10cmFja2VkIGludGVudC5cbiAgICovXG4gIGFzeW5jIHF1ZXVlKHtiYXNlVmVyc2lvbiwgZGF0YSwgb3BlcmF0aW9uID0gXCJ1cGRhdGVcIiwgcmVzb3VyY2UsIHN5bmNUeXBlfSkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIHRoaXMuYXNzZXJ0UmVjb3JkT3duZXJzaGlwKHJlc291cmNlKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZ0ZvcihyZXNvdXJjZSlcbiAgICBjb25zdCByZXNvbHZlZFN5bmNUeXBlID0gc3luY1R5cGUgPz8gdGhpcy5kZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkOiByZXNvdXJjZSwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgIGNvbnN0IHF1ZXVlZERhdGEgPSBTeW5jQXBpQ2xpZW50LnF1ZXVlZFN5bmNEYXRhKHtcbiAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICBkYXRhLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICByZXNvdXJjZVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgYmFzZVZlcnNpb246IGJhc2VWZXJzaW9uID09PSB1bmRlZmluZWQgPyB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZDogcmVzb3VyY2UsIHJlc291cmNlQ29uZmlnfSkgOiBiYXNlVmVyc2lvbixcbiAgICAgICAgY29uZmxpY3RUcmFja2luZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgZGF0YTogcXVldWVkRGF0YSxcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICByZXNvdXJjZSxcbiAgICAgICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZS5jb25zdHJ1Y3Rvci5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgc3luY1R5cGU6IHJlc29sdmVkU3luY1R5cGVcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICByZXR1cm4gcmVjb3JkXG4gICAgfVxuXG4gICAgY29uc3Qgc3luY1JvdyA9IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAoZGF0YWJhc2VPcGVyYXRpb24pID0+IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVMb2NhbFN5bmMoe1xuICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgZGF0YSxcbiAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICByZXNvdXJjZSxcbiAgICAgIHN5bmNNb2RlbDogZGF0YWJhc2VPcGVyYXRpb24gPyBkYXRhYmFzZU9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWwsXG4gICAgICBzeW5jVHlwZTogcmVzb2x2ZWRTeW5jVHlwZVxuICAgIH0pKVxuXG4gICAgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG5cbiAgICByZXR1cm4gc3luY1Jvd1xuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIGxvY2FsIHN5bmMgcm93cyB0byB0aGUgYmFja2VuZCAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBSb3dzIGFyZSBvbmx5IG1hcmtlZCBzdWNjZXNzZnVsIGFmdGVyIHRoZSBiYWNrZW5kIGFja25vd2xlZGdlcyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcGxheVBlbmRpbmcoKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9yZXBsYXlQZW5kaW5nKHNpZ25hbCkpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5IGltcGxlbWVudGF0aW9uIGJvdW5kIHRvIG9uZSBsaWZlY3ljbGUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3JlcGxheVBlbmRpbmcoc2lnbmFsKSB7XG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVyblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgIGF3YWl0IFN5bmNBcGlDbGllbnQuc2luZ2xlRmxpZ2h0KGB2ZWxvY2lvdXMtc3luYy1jbGllbnQtcmVwbGF5LSR7dGhpcy5fY2xpZW50TnVtYmVyfWAsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykgY29udGludWVcblxuICAgICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnJlcGxheUNvbmZsaWN0VHJhY2tlZFN5bmNzKHtcbiAgICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKCksXG4gICAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgICAgY29uZmxpY3RUcmFja2luZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgICBwb3N0UmVwbGF5OiB0aGlzLmNvbmZpZy5wb3N0UmVwbGF5LFxuICAgICAgICAgIHJlbW90ZUdlbmVyYXRpb246IChpZGVudGl0eSkgPT4gdGhpcy5fcmVtb3RlR2VuZXJhdGlvbnMuZ2V0KGlkZW50aXR5KSB8fCAwLFxuICAgICAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5yZXBsYXlMb2NhbFN5bmNzKHtcbiAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpLFxuICAgICAgICBiYXRjaFNpemU6IHRoaXMuY29uZmlnLmJhdGNoU2l6ZSxcbiAgICAgICAgcG9zdFJlcGxheTogdGhpcy5jb25maWcucG9zdFJlcGxheSxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgICBzeW5jTW9kZWw6IG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcbiAgICAgIH0pXG4gICAgfSkpXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbiBhdXRob3JpdGF0aXZlIHJlbW90ZSBvYnNlcnZhdGlvbiBzbyBhbiBpbi1mbGlnaHQgYWNrbm93bGVkZ2VtZW50XG4gICAqIGNhbm5vdCByZWJhc2UgYSBzdWNjZXNzb3IgYWNyb3NzIHRoYXQgb2JzZXJ2YXRpb24uXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlSWQ6IHN0cmluZyB8IG51bWJlciwgcmVzb3VyY2VUeXBlOiBzdHJpbmcsIHZlcnNpb24/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsfX0gYXJncyAtIFJlbW90ZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBub3RlUmVtb3RlVmVyc2lvbih7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlLCB2ZXJzaW9ufSkge1xuICAgIHZvaWQgdmVyc2lvblxuICAgIGNvbnN0IGlkZW50aXR5ID0gYCR7cmVzb3VyY2VUeXBlfToke1N0cmluZyhyZXNvdXJjZUlkKX1gXG5cbiAgICB0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5zZXQoaWRlbnRpdHksICh0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5nZXQoaWRlbnRpdHkpIHx8IDApICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgYXV0aG9yaXRhdGl2ZSBiYXNlIHZlcnNpb24gb2JzZXJ2ZWQgYmVmb3JlIGEgbG9jYWwgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIFZlcnNpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IEJhc2UgdmVyc2lvbi5cbiAgICovXG4gIGJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGUgPSByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nPy52ZXJzaW9uQXR0cmlidXRlXG5cbiAgICBpZiAoIXZlcnNpb25BdHRyaWJ1dGUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB2YWx1ZSA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHZlcnNpb25BdHRyaWJ1dGUpXG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCB2ZXJzaW9uICR7dmVyc2lvbkF0dHJpYnV0ZX0gbXVzdCBiZSBhIERhdGUsIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgcHJlLWFzc2lnbm1lbnQgdmFsdWUgZXhwb3NlZCBieSByZWNvcmQgY2hhbmdlcyBkdXJpbmcgYmVmb3JlVXBkYXRlLlxuICAgKiBEZWxldGVzIGhhdmUgbm8gdmVyc2lvbiBjaGFuZ2UgcGFpciBhbmQgdXNlIHRoZSByZWNvcmQncyBjdXJyZW50IHZlcnNpb24uXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIFZlcnNpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IFByZS1tdXRhdGlvbiBiYXNlIHZlcnNpb24uXG4gICAqL1xuICBwcmVNdXRhdGlvbkJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcbiAgICBjb25zdCB2ZXJzaW9uQ29sdW1uID0gdmVyc2lvbkF0dHJpYnV0ZVxuICAgICAgPyByZWNvcmQuY29uc3RydWN0b3IuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3ZlcnNpb25BdHRyaWJ1dGVdXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHZlcnNpb25DaGFuZ2UgPSBvcGVyYXRpb24gPT09IFwidXBkYXRlXCIgJiYgdmVyc2lvbkNvbHVtblxuICAgICAgPyByZWNvcmQuY2hhbmdlcygpW3ZlcnNpb25Db2x1bW5dXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCF2ZXJzaW9uQ2hhbmdlKSByZXR1cm4gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcblxuICAgIGNvbnN0IHZhbHVlID0gdmVyc2lvbkNoYW5nZVswXVxuXG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY29uZmxpY3QgdmVyc2lvbiAke3ZlcnNpb25BdHRyaWJ1dGV9IG11c3QgYmUgYSBEYXRlLCBzdHJpbmcsIG51bWJlciwgb3IgbnVsbGApXG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgdGhlIGJhc2UgY2FwdHVyZWQgZm9yIHRoaXMgbGlmZWN5Y2xlIGV2ZW50IGJlZm9yZSBpdHMgYWZ0ZXItY29tbWl0XG4gICAqIGNsb3N1cmUgaXMgZGVmZXJyZWQsIHByZXNlcnZpbmcgcmVwZWF0ZWQgc2FtZS1yZWNvcmQgd3JpdGVzIGluIG9uZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gQ2FwdHVyZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gQ2FwdHVyZWQgYmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgY2FwdHVyZWRCYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmIChvcGVyYXRpb24gPT09IFwiY3JlYXRlXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjYXB0dXJlZFZlcnNpb25zID0gdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZ2V0KHJlY29yZClcbiAgICBjb25zdCBiYXNlVmVyc2lvbiA9IGNhcHR1cmVkVmVyc2lvbnM/LnNoaWZ0KClcblxuICAgIGlmIChjYXB0dXJlZFZlcnNpb25zPy5sZW5ndGggPT09IDApIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLmRlbGV0ZShyZWNvcmQpXG4gICAgaWYgKGJhc2VWZXJzaW9uICE9PSB1bmRlZmluZWQpIHJldHVybiBiYXNlVmVyc2lvblxuXG4gICAgcmV0dXJuIHRoaXMuYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gIH1cblxuICAvKipcbiAgICogU2NoZWR1bGVzIGEgYmFja2dyb3VuZCByZXBsYXkgYXR0ZW1wdCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIuXG4gICAqIEZhaWx1cmVzIGdvIHRvIGNvbmZpZy5vbkVycm9yIChvciByZXRocm93IHdoZW4gbm9uZSBpcyBjb25maWd1cmVkKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzY2hlZHVsZVJlcGxheSgpIHtcbiAgICB0aGlzLl9zY2hlZHVsZWRSZXBsYXkgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZXBsYXlQZW5kaW5nKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICh0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpKSByZXR1cm5cblxuICAgICAgICB0aGlzLnJlcG9ydEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICB9XG4gICAgfSkoKVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyB0aGUgbGFzdCBzY2hlZHVsZWQgYmFja2dyb3VuZCByZXBsYXkgKHVzZWZ1bCBpbiB0ZXN0cyBhbmQgc2h1dGRvd24gZmxvd3MpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JTY2hlZHVsZWRSZXBsYXkoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFJlcGxheSkgYXdhaXQgdGhpcy5fc2NoZWR1bGVkUmVwbGF5XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIGJhY2tncm91bmQgc3luYyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEJhY2tncm91bmQgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXBvcnRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb25uZWN0aXZpdHkgdGhyb3VnaCB0aGUgY29uZmlndXJlZCBnYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgYmFja2VuZCBpcyBjb25zaWRlcmVkIHJlYWNoYWJsZS5cbiAgICovXG4gIGFzeW5jIGlzT25saW5lKCkge1xuICAgIGlmICghdGhpcy5jb25maWcuaXNPbmxpbmUpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuY29uZmlnLmlzT25saW5lKCkpICE9PSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNjb3BlIHN0b3JlIGJhY2tpbmcgZGVjbGFyZWQgc2NvcGVzIGFuZCBjdXJzb3JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXNjb3BlLXN0b3JlLmpzXCIpLmRlZmF1bHR9IFNjb3BlIHN0b3JlLlxuICAgKi9cbiAgc2NvcGVTdG9yZSgpIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcblxuICAgIGlmICh0aGlzLl9zY29wZVN0b3JlICYmIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiYgdGhpcy5fc2NvcGVTdG9yZS5zdG9yZUlkZW50aXR5ICE9PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHNjb3BlIHN0b3JlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX3Njb3BlU3RvcmUgfHw9IG5ldyBTeW5jU2NvcGVTdG9yZSh7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRIYW5kbGU6IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZVxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fc2NvcGVTdG9yZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkZWNsYXJlZCByZXNvdXJjZSBjb25maWcgZm9yIGEgbG9jYWwgcmVjb3JkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZXNvdXJjZSAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfSBEZWNsYXJlZCByZXNvdXJjZSBjb25maWcuXG4gICAqL1xuICByZXNvdXJjZUNvbmZpZ0ZvcihyZXNvdXJjZSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSByZXNvdXJjZT8uY29uc3RydWN0b3JcblxuICAgIGlmICh0eXBlb2YgbW9kZWxDbGFzcz8uZ2V0TW9kZWxOYW1lICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyByZXNvdXJjZXMgbXVzdCBiZSBtb2RlbCByZWNvcmRzIHdpdGggYSBzdGF0aWMgZ2V0TW9kZWxOYW1lKCksIGdvdDogJHtTdHJpbmcocmVzb3VyY2UpfWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VUeXBlID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV1cblxuICAgIGlmICghcmVzb3VyY2VDb25maWcpIHRocm93IG5ldyBFcnJvcihgTm8gc3luYyByZXNvdXJjZSBjb25maWd1cmVkIGZvcjogJHtyZXNvdXJjZVR5cGV9YClcblxuICAgIHJldHVybiByZXNvdXJjZUNvbmZpZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzeW5jIHR5cGUgZm9yIGEgbXV0YXRpb24gdGhyb3VnaCB0aGUgcmVzb3VyY2UgY29uZmlnLiBUaGVcbiAgICogXCJ1cHNlcnRcIiBmbGFnIHF1ZXVlcyBjcmVhdGVzIGFuZCB1cGRhdGVzIGFzIFwidXBkYXRlXCIgcm93cyAodGhlIHNlcnZlclxuICAgKiB1cHNlcnRzIGJ5IHJlc291cmNlIGlkKSBhbmQgZGVzdHJveXMgYXMgXCJkZWxldGVcIiByb3dzLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBNdXRhdGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTeW5jIHR5cGUuXG4gICAqL1xuICBkZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAodHlwZW9mIHJlc291cmNlQ29uZmlnLnN5bmNUeXBlID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiByZXNvdXJjZUNvbmZpZy5zeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmR9KVxuICAgIGlmIChvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiKSByZXR1cm4gXCJkZWxldGVcIlxuICAgIGlmIChyZXNvdXJjZUNvbmZpZy5zeW5jVHlwZSA9PT0gXCJ1cHNlcnRcIikgcmV0dXJuIFwidXBkYXRlXCJcblxuICAgIHJldHVybiBvcGVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXJpdmVzIHRoZSBwdWxsLWFwcGx5IHJlc291cmNlIGNvbmZpZ3MgZnJvbSB0aGUgZGVjbGFyZWQgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gW29wZXJhdGlvbl0gLSBUZW5hbnQgb3BlcmF0aW9uIGJpbmRpbmcgdGhlIHJlc291cmNlIG1vZGVsIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+fSBQdWxsLWFwcGx5IHJlc291cmNlIGNvbmZpZ3MuXG4gICAqL1xuICBwdWxsUmVzb3VyY2VDb25maWdzKG9wZXJhdGlvbikge1xuICAgIGlmICghb3BlcmF0aW9uICYmIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3MpIHJldHVybiB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzXG5cbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3MgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz59ICovIChPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpXG4gICAgICAgIC5maWx0ZXIoKFssIHJlc291cmNlXSkgPT4gQm9vbGVhbihyZXNvdXJjZS5hdHRyaWJ1dGVzKSlcbiAgICAgICAgLm1hcCgoW3Jlc291cmNlVHlwZSwgcmVzb3VyY2VdKSA9PiB7XG4gICAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5tb2RlbENsYXNzKHJlc291cmNlLm1vZGVsQ2xhc3MpIDogcmVzb3VyY2UubW9kZWxDbGFzc1xuICAgICAgICAgIGNvbnN0IGZpbmRSZWNvcmQgPSByZXNvdXJjZS5maW5kUmVjb3JkXG4gICAgICAgICAgY29uc3QgZmluZFJlY29yZEZvckRlbGV0ZSA9IHJlc291cmNlLmZpbmRSZWNvcmRGb3JEZWxldGVcblxuICAgICAgICAgIHJldHVybiBbcmVzb3VyY2VUeXBlLCB7XG4gICAgICAgICAgICBhZnRlckFwcGx5OiByZXNvdXJjZS5hZnRlckFwcGx5LFxuICAgICAgICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWdbXCJhdHRyaWJ1dGVzXCJdfSAqLyAocmVzb3VyY2UuYXR0cmlidXRlcyksXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZmluZFJlY29yZDogb3BlcmF0aW9uICYmIGZpbmRSZWNvcmRcbiAgICAgICAgICAgICAgPyAoYXJncykgPT4gZmluZFJlY29yZCh7Li4uYXJncywgbW9kZWxDbGFzcywgb3BlcmF0aW9uOiBvcGVyYXRpb24gfHwgbnVsbH0pXG4gICAgICAgICAgICAgIDogZmluZFJlY29yZCxcbiAgICAgICAgICAgIGZpbmRSZWNvcmRGb3JEZWxldGU6IG9wZXJhdGlvbiAmJiBmaW5kUmVjb3JkRm9yRGVsZXRlXG4gICAgICAgICAgICAgID8gKGFyZ3MpID0+IGZpbmRSZWNvcmRGb3JEZWxldGUoey4uLmFyZ3MsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbjogb3BlcmF0aW9uIHx8IG51bGx9KVxuICAgICAgICAgICAgICA6IGZpbmRSZWNvcmRGb3JEZWxldGUsXG4gICAgICAgICAgICBtb2RlbENsYXNzXG4gICAgICAgICAgfV1cbiAgICAgICAgfSlcbiAgICApKVxuXG4gICAgaWYgKCFvcGVyYXRpb24pIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3MgPSByZXNvdXJjZUNvbmZpZ3NcblxuICAgIHJldHVybiByZXNvdXJjZUNvbmZpZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvY2FsIHN0YXRlIHdvcmsgb24gdGhpcyBjbGllbnQncyBjYXB0dXJlZCB0ZW5hbnQsIG9yIGRpcmVjdGx5IGZvciB0aGUgbGVnYWN5IGRlZmF1bHQtZGF0YWJhc2UgY2xpZW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhvcGVyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBCb3VuZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aFRlbmFudE9wZXJhdGlvbihjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5jb25maWcudGVuYW50SGFuZGxlIHx8ICF0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVybiBhd2FpdCBjYWxsYmFjayhudWxsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZS5kYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIG5hbWU6IFwiVGVuYW50IFN5bmNDbGllbnRcIlxuICAgIH0sIGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IG9wZXJhdGlvbi5lbnN1cmVNb2RlbEluaXRpYWxpemVkKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgd2hldGhlciBhIHJlY29yZCBiZWxvbmdzIHRvIHRoaXMgY2xpZW50J3MgcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIENhbmRpZGF0ZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoaXMgY2xpZW50IG93bnMgaXQuXG4gICAqL1xuICBvd25zUmVjb3JkKHJlY29yZCkge1xuICAgIGlmICghdGhpcy5fZGF0YWJhc2VJZGVudGl0eSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IGRhdGFiYXNlT3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICAgIHJldHVybiByZWNvcmQuZGF0YWJhc2VJZGVudGl0eSgpID09PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICYmXG4gICAgICBkYXRhYmFzZU9wZXJhdGlvbj8uc2NoZW1hR2VuZXJhdGlvbigpID09PSB0aGlzLl90ZW5hbnRTY2hlbWFHZW5lcmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBhIHJlY29yZCBub3Qgb3duZWQgYnkgdGhpcyBjbGllbnQncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2FuZGlkYXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRSZWNvcmRPd25lcnNoaXAocmVjb3JkKSB7XG4gICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCByZXNvdXJjZSBiZWxvbmdzIHRvIGFub3RoZXIgb3IgdW5yZXNvbHZlZCBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBkZWNsYXJlZCBxdWVyeSBhZ2FpbnN0IHRoaXMgY2xpZW50J3MgY2FwdHVyZWQgdGVuYW50IGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFNjb3BlIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gcXVlcnkuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGhpcy5jb25maWcudGVuYW50SGFuZGxlLnRlbmFudCgpfSlcbiAgICBjb25zdCBxdWVyeURhdGFiYXNlSWRlbnRpdHkgPSBxdWVyeS5fb3BlcmF0aW9uPy5kYXRhYmFzZUlkZW50aXR5KClcblxuICAgIGlmIChkYXRhYmFzZUlkZW50aWZpZXIgIT09IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllciB8fFxuICAgICAgIXRoaXMuY29uZmlnLnJlc291cmNlc1ttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSB8fFxuICAgICAgcXVlcnlEYXRhYmFzZUlkZW50aXR5ICE9PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHNjb3BlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIHdvcmsgYWZ0ZXIgdGhlIGhhbmRsZSdzIHJlYWR5IHBoeXNpY2FsIHNjaGVtYSBnZW5lcmF0aW9uIGNoYW5nZWQgb3IgY2xvc2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFRlbmFudFJlYWR5KCkge1xuICAgIGlmICghdGhpcy5jb25maWcudGVuYW50SGFuZGxlIHx8ICF0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVyblxuXG4gICAgY29uc3QgbGlmZWN5Y2xlID0gdGhpcy5jb25maWcudGVuYW50SGFuZGxlLmluc3BlY3Qoe2RhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyfSlcblxuICAgIGlmICghbGlmZWN5Y2xlLnJlYWR5IHx8ICFsaWZlY3ljbGUuc2NoZW1hR2VuZXJhdGlvbiB8fCBsaWZlY3ljbGUuc2NoZW1hR2VuZXJhdGlvbiAhPT0gdGhpcy5fdGVuYW50U2NoZW1hR2VuZXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCB0ZW5hbnQgZGF0YWJhc2UgZ2VuZXJhdGlvbiBpcyBzdGFsZSBvciBub3QgcmVhZHlcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSBjdXN0b20gcmVtb3RlIHJlc29sdmVyIHJlc3VsdCB0byB0aGUgYWN0aXZlIHRlbmFudCBvcGVyYXRpb24gYWZ0ZXIgcHJvdmluZyBpdHMgY2FwdHVyZWQgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gQmluZGluZyBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJpbmRSZW1vdGVSZWNvcmQoe29wZXJhdGlvbiwgcmVjb3JkfSkge1xuICAgIGlmIChyZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24/LigpID09PSBvcGVyYXRpb24pIHJldHVyblxuICAgIHRoaXMuYXNzZXJ0UmVjb3JkT3duZXJzaGlwKHJlY29yZClcbiAgICBvcGVyYXRpb24uYmluZFJlY29yZChyZWNvcmQpXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgb25lIHJlc291cmNlIGNvbmZpZyBmcm9tIGEgbW9kZWwncyBgc3RhdGljIHN5bmNgIGRlY2xhcmF0aW9uIHBsdXMgaXRzXG4gKiBkZXJpdmVkIGNvbHVtbiBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7e2RlY2xhcmF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLk1vZGVsU3luY0RlY2xhcmF0aW9uLCBtZXRhZGF0YU1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gRGVjbGFyYXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ30gRGVyaXZlZCByZXNvdXJjZSBjb25maWcuXG4gKi9cbmZ1bmN0aW9uIHJlc291cmNlQ29uZmlnRnJvbVN5bmNEZWNsYXJhdGlvbih7ZGVjbGFyYXRpb24sIG1ldGFkYXRhTW9kZWxDbGFzcywgbW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSkge1xuICBjb25zdCBub3JtYWxpemVkRGVjbGFyYXRpb24gPSBkZWNsYXJhdGlvbiA9PT0gdHJ1ZSA/IHt9IDogZGVjbGFyYXRpb25cblxuICBpZiAoIW5vcm1hbGl6ZWREZWNsYXJhdGlvbiB8fCB0eXBlb2Ygbm9ybWFsaXplZERlY2xhcmF0aW9uICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobm9ybWFsaXplZERlY2xhcmF0aW9uKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIG11c3QgYmUgdHJ1ZSBvciBhIHN5bmMgZGVjbGFyYXRpb24gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKGRlY2xhcmF0aW9uKX1gKVxuICB9XG5cbiAgY29uc3Qge2FmdGVyQXBwbHksIGF0dHJpYnV0ZXMsIGJvb2xlYW5BdHRyaWJ1dGVzLCBjb25mbGljdFRyYWNraW5nLCBmaW5kUmVjb3JkLCBmaW5kUmVjb3JkRm9yRGVsZXRlLCBsb2NhbE9ubHlBdHRyaWJ1dGVzLCBwdWJsaXNoLCByZWFsdGltZSwgc3luY1R5cGUsIHRyYWNrLCB0cmFja2VkRGF0YSwgLi4ucmVzdERlY2xhcmF0aW9ufSA9IG5vcm1hbGl6ZWREZWNsYXJhdGlvblxuICBjb25zdCB1bmtub3duS2V5cyA9IE9iamVjdC5rZXlzKHJlc3REZWNsYXJhdGlvbilcblxuICAvLyBgcHVibGlzaGAgaXMgdGhlIHNlcnZlci1zaWRlIGhhbGYgb2YgdGhlIHNoYXJlZCBgc3RhdGljIHN5bmNgIGRlY2xhcmF0aW9uXG4gIC8vIChjb25zdW1lZCBieSBTeW5jUHVibGlzaGVyIG9uIHRoZSBiYWNrZW5kKSAtIHRoZSBjbGllbnQgZGVyaXZlcyBub3RoaW5nXG4gIC8vIGZyb20gaXQsIGJ1dCBtb2RlbHMgZGVjbGFyZWQgb25jZSBmb3IgYm90aCBzaWRlcyBtdXN0IHN0YXkgdmFsaWQgaGVyZS5cbiAgdm9pZCBwdWJsaXNoXG5cbiAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyByZWNlaXZlZCB1bmtub3duIGtleXM6ICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfSAoc3VwcG9ydGVkOiBhZnRlckFwcGx5LCBhdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcywgY29uZmxpY3RUcmFja2luZywgZmluZFJlY29yZCwgZmluZFJlY29yZEZvckRlbGV0ZSwgbG9jYWxPbmx5QXR0cmlidXRlcywgcHVibGlzaCwgcmVhbHRpbWUsIHN5bmNUeXBlLCB0cmFjaywgdHJhY2tlZERhdGEpYClcbiAgfVxuICBpZiAoc3luY1R5cGUgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc3luY1R5cGUgIT09IFwiZnVuY3Rpb25cIiAmJiBzeW5jVHlwZSAhPT0gXCJ1cHNlcnRcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHN5bmNUeXBlIG11c3QgYmUgYSBmdW5jdGlvbiBvciB0aGUgc3RyaW5nIFwidXBzZXJ0XCIsIGdvdDogJHtTdHJpbmcoc3luY1R5cGUpfWApXG4gIH1cblxuICBjb25zdCBkZXJpdmVkID0gZGVyaXZlZFN5bmNBdHRyaWJ1dGVzKHttb2RlbENsYXNzOiBtZXRhZGF0YU1vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pXG5cbiAgaWYgKGNvbmZsaWN0VHJhY2tpbmcpIHZhbGlkYXRlQ29uZmxpY3RUcmFja2luZyh7Y29uZmxpY3RUcmFja2luZywgZGVyaXZlZCwgcmVzb3VyY2VUeXBlfSlcblxuICByZXR1cm4ge1xuICAgIGFmdGVyQXBwbHksXG4gICAgYXR0cmlidXRlcyxcbiAgICBib29sZWFuQXR0cmlidXRlczogbWVyZ2VkQXR0cmlidXRlTmFtZXMoZGVyaXZlZC5ib29sZWFuQXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMpLFxuICAgIGNvbmZsaWN0VHJhY2tpbmc6IGNvbmZsaWN0VHJhY2tpbmcgPyB7Li4uY29uZmxpY3RUcmFja2luZywgdmVyc2lvbkF0dHJpYnV0ZTogY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlIHx8IFwidXBkYXRlZEF0XCJ9IDogdW5kZWZpbmVkLFxuICAgIGZpbmRSZWNvcmQsXG4gICAgZmluZFJlY29yZEZvckRlbGV0ZSxcbiAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBtZXJnZWRBdHRyaWJ1dGVOYW1lcyhcbiAgICAgIGRlcml2ZWQubG9jYWxPbmx5QXR0cmlidXRlcyxcbiAgICAgIFsuLi4obG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSksIC4uLihjb25mbGljdFRyYWNraW5nID8gW2NvbmZsaWN0VHJhY2tpbmcudmVyc2lvbkF0dHJpYnV0ZSB8fCBcInVwZGF0ZWRBdFwiXSA6IFtdKV1cbiAgICApLFxuICAgIG1ldGFkYXRhTW9kZWxDbGFzcyxcbiAgICBtb2RlbENsYXNzLFxuICAgIHJlYWx0aW1lLFxuICAgIHN5bmNUeXBlLFxuICAgIHRyYWNrOiBub3JtYWxpemVkVHJhY2sodHJhY2spLFxuICAgIHRyYWNrZWREYXRhXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgb25lIHJlc291cmNlJ3MgZHVyYWJsZSBjb25mbGljdC10cmFja2luZyBkZWNsYXJhdGlvbi5cbiAqIEBwYXJhbSB7e2NvbmZsaWN0VHJhY2tpbmc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWcsIGRlcml2ZWQ6IHtib29sZWFuQXR0cmlidXRlczogc3RyaW5nW10sIGxvY2FsT25seUF0dHJpYnV0ZXM6IHN0cmluZ1tdfSwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gVmFsaWRhdGlvbiBhcmdzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlQ29uZmxpY3RUcmFja2luZyh7Y29uZmxpY3RUcmFja2luZywgZGVyaXZlZCwgcmVzb3VyY2VUeXBlfSkge1xuICBjb25zdCByZXF1aXJlZFN0cmluZ3MgPSB7XG4gICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgIGFjdG9yVXNlcklkOiBjb25mbGljdFRyYWNraW5nLmFjdG9yVXNlcklkLFxuICAgIG9mZmxpbmVHcmFudElkOiBjb25mbGljdFRyYWNraW5nLm9mZmxpbmVHcmFudElkLFxuICAgIHBvbGljeUhhc2g6IGNvbmZsaWN0VHJhY2tpbmcucG9saWN5SGFzaFxuICB9XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocmVxdWlyZWRTdHJpbmdzKSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgdmFsdWUubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLiR7a2V5fSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ2ApXG4gIH1cbiAgaWYgKCFjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nIHx8IHR5cGVvZiBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLmFwcGVuZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nIG11c3QgYmUgYSBMb2NhbE11dGF0aW9uTG9nYClcbiAgaWYgKHR5cGVvZiBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy5jbGllbnRNdXRhdGlvbklkIG11c3QgYmUgYSBmdW5jdGlvbmApXG4gIGlmICghY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlICYmICFkZXJpdmVkLmxvY2FsT25seUF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJ1cGRhdGVkQXRcIikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nIHJlcXVpcmVzIHZlcnNpb25BdHRyaWJ1dGUgYmVjYXVzZSB0aGUgbW9kZWwgaGFzIG5vIHVwZGF0ZWRBdCBjb2x1bW5gKVxuICB9XG59XG5cbi8qKlxuICogRGVyaXZlcyBib29sZWFuIGFuZCBsb2NhbC1vbmx5IGF0dHJpYnV0ZSBuYW1lcyBmcm9tIGEgbW9kZWwncyBjb2x1bW4gbWV0YWRhdGE6XG4gKiBib29sZWFucyBmcm9tIGJvb2xlYW4gY29sdW1uIHR5cGVzOyBsb2NhbC1vbmx5IGZyb20gdGhlIHByaW1hcnkga2V5LFxuICogY3JlYXRlZEF0L3VwZGF0ZWRBdCwgYW5kIHN5bmMgYm9va2tlZXBpbmcgY29sdW1ucy5cbiAqIEBwYXJhbSB7e21vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBEZXJpdmF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7e2Jvb2xlYW5BdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbG9jYWxPbmx5QXR0cmlidXRlczogc3RyaW5nW119fSBEZXJpdmVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gZGVyaXZlZFN5bmNBdHRyaWJ1dGVzKHttb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KSB7XG4gIGlmIChcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lcyAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZSAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MucHJpbWFyeUtleSAhPT0gXCJmdW5jdGlvblwiIHx8XG4gICAgdHlwZW9mIG1vZGVsQ2xhc3MuaGFzUHJpbWFyeUtleSAhPT0gXCJmdW5jdGlvblwiXG4gICkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHJlcXVpcmVzIGEgVmVsb2Npb3VzIG1vZGVsIGNsYXNzIHdpdGggY29sdW1uIG1ldGFkYXRhIChnZXRDb2x1bW5OYW1lcywgZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCwgZ2V0Q29sdW1uVHlwZUJ5TmFtZSwgcHJpbWFyeUtleSwgaGFzUHJpbWFyeUtleSlgKVxuICB9XG5cbiAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGJvb2xlYW5BdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgbG9jYWxPbmx5QXR0cmlidXRlcyA9IFtdXG5cbiAgaWYgKG1vZGVsQ2xhc3MuaGFzUHJpbWFyeUtleSgpKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShtb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYERlcml2ZWQgc3luYyBhdHRyaWJ1dGVzIGZvciAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgbG9jYWxPbmx5QXR0cmlidXRlcy5wdXNoKGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbcHJpbWFyeUtleUNvbHVtbl0gfHwgcHJpbWFyeUtleUNvbHVtbilcbiAgfVxuXG4gIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzKCkpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb2x1bW5OYW1lXSB8fCBjb2x1bW5OYW1lXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKExPQ0FMX0JPT0tLRUVQSU5HX0FUVFJJQlVURV9OQU1FUy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSAmJiAhbG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgbG9jYWxPbmx5QXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICAgIGlmIChjb2x1bW5UeXBlICYmIGlzQm9vbGVhbkNvbHVtblR5cGUoY29sdW1uVHlwZSkpIHtcbiAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2Jvb2xlYW5BdHRyaWJ1dGVzLCBsb2NhbE9ubHlBdHRyaWJ1dGVzfVxufVxuXG4vKipcbiAqIE1lcmdlcyBkZXJpdmVkIGF0dHJpYnV0ZSBuYW1lcyB3aXRoIGRlY2xhcmVkIGV4dHJhcyBpbnRvIGEgc29ydGVkLCBkdXBsaWNhdGUtZnJlZSBsaXN0LlxuICogQHBhcmFtIHtzdHJpbmdbXX0gZGVyaXZlZCAtIERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gZGVjbGFyZWQgLSBEZWNsYXJlZCBleHRyYSBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IE1lcmdlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG1lcmdlZEF0dHJpYnV0ZU5hbWVzKGRlcml2ZWQsIGRlY2xhcmVkKSB7XG4gIHJldHVybiBbLi4ubmV3IFNldChbLi4uZGVyaXZlZCwgLi4uKGRlY2xhcmVkIHx8IFtdKV0pXS5zb3J0KClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgZGVjbGFyYXRpb24ncyB0cmFjayB2YWx1ZTogYW4gb3BlcmF0aW9ucyBhcnJheSBpcyBzaG9ydGhhbmQgZm9yXG4gKiB0aGUge29wZXJhdGlvbnN9IGZvcm0uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb25Db25maWdbXCJ0cmFja1wiXX0gdHJhY2sgLSBEZWNsYXJlZCB0cmFjayB2YWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ1tcInRyYWNrXCJdfSBOb3JtYWxpemVkIHRyYWNrIHZhbHVlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVkVHJhY2sodHJhY2spIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodHJhY2spKSByZXR1cm4ge29wZXJhdGlvbnM6IHRyYWNrfVxuXG4gIHJldHVybiB0cmFja1xufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyYW1ld29yay1vd25lZCBzeW5jIGVuZHBvaW50IFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydC5cbiAqIEBwYXJhbSB7e3BhdGg6IHN0cmluZywgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50VHJhbnNwb3J0fX0gYXJncyAtIFBvc3RlciBhcmdzLlxuICogQHJldHVybnMgeyhwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU3luYyBlbmRwb2ludCBQT1NUZXIuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFBvc3Rlcih7cGF0aCwgcmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydH0pIHtcbiAgcmV0dXJuIGFzeW5jIChwYXlsb2FkLCBvcHRpb25zID0ge30pID0+IHtcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlUmVtb3RlUmVxdWVzdENvbnRleHQoe1xuICAgICAgY29udGV4dDogcmVxdWVzdENvbnRleHQsXG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHBhcmFtczogcGF5bG9hZFxuICAgIH0pXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0cmFuc3BvcnQucG9zdChwYXRoLCByZXF1ZXN0UGF5bG9hZCwge3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuXG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UuanNvbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50IHRyYW5zcG9ydC5wb3N0IG11c3QgcmVzb2x2ZSB0byBhIHJlc3BvbnNlIHdpdGggYSBqc29uKCkgbWV0aG9kIGZvciAke3BhdGh9IChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlLmpzb24oKVxuICB9XG59XG5cbi8qKlxuICogTGF6aWx5IGJ1aWxkcyAoYW5kIG1lbW9pemVzIHBlciBjb25maWd1cmF0aW9uKSB0aGUgc3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZVxuICogYXBwJ3MgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24gYW5kIHJlZ2lzdGVycyBpdCBhcyB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzIGFuZCB0aGUgc3luYy5jbGllbnQgYmxvY2suIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7U3luY0NsaWVudH0gTWVtb2l6ZWQgc3luYyBjbGllbnQgZm9yIHRoZSBjb25maWd1cmF0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3luY0NsaWVudChjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCkpIHtcbiAgbGV0IGNsaWVudCA9IHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghY2xpZW50KSB7XG4gICAgY2xpZW50ID0gU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuICAgIHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBjbGllbnQpXG4gICAgY2xpZW50LnNldEN1cnJlbnQoKVxuICB9XG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIERlY2xhcmVzIGEgc3luYyBzY29wZSBvbiB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgZGVjbGFyaW5nIHRoZSBzeW5jIHNjb3BlLlxuICogQHJldHVybnMge1Byb21pc2U8e3Njb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGUsIHB1bGxlZDogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfT59IERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN5bmMocXVlcnkpIHtcbiAgcmV0dXJuIGF3YWl0IFN5bmNDbGllbnQuY3VycmVudCgpLnN5bmMocXVlcnkpXG59XG4iXX0=