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
        this._lifecycleGeneration = 0;
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
     * Runs mutation queueing only while the lifecycle generation captured by the
     * caller remains active. Unlike pulls, a mutation must never wait through an
     * identity transition and then persist under the replacement identity.
     * @template Result
     * @param {number} lifecycleGeneration - Generation owning the mutation.
     * @param {() => Promise<Result>} callback - Mutation queueing work.
     * @returns {Promise<Result>} Callback result.
     */
    async _runMutationLifecycleWork(lifecycleGeneration, callback) {
        this._assertMutationLifecycleGeneration(lifecycleGeneration);
        return await this._runLifecycleWork(async () => {
            this._assertMutationLifecycleGeneration(lifecycleGeneration);
            return await callback();
        });
    }
    /**
     * Rejects mutation queueing captured outside the current stable lifecycle.
     * @param {number} lifecycleGeneration - Generation owning the mutation.
     * @returns {void}
     */
    _assertMutationLifecycleGeneration(lifecycleGeneration) {
        if (this._lifecycleTransitionCount === 0 && lifecycleGeneration === this._lifecycleGeneration)
            return;
        throw new SyncClientLifecycleAbortError("Sync mutation belongs to an inactive lifecycle generation");
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
        // unsubscribe() invalidates the subscription generation synchronously, so
        // an old onResume/onMessage callback cannot enter this transition's drain.
        const realtimeUnsubscribePromise = this._realtimeBridge?.unsubscribe();
        const previousTransition = this._lifecycleTransitionPromise;
        const transition = previousTransition.then(async () => {
            const abortController = this._lifecycleAbortController;
            const abortReason = new SyncClientLifecycleAbortError("Sync client lifecycle was stopped");
            abortController.abort(abortReason);
            if (realtimeUnsubscribePromise)
                await realtimeUnsubscribePromise;
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
            this._lifecycleGeneration += 1;
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
            const lifecycleGeneration = this._lifecycleGeneration;
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
                    await this._runMutationLifecycleWork(lifecycleGeneration, async () => {
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
                    });
                }
                catch (error) {
                    if (this.isLifecycleAbort(error))
                        return;
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
        const lifecycleGeneration = this._lifecycleGeneration;
        return await this._runMutationLifecycleWork(lifecycleGeneration, async () => {
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
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ25FLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUVqRixJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUE7QUFFckIsc0ZBQXNGO0FBQ3RGLE1BQU0sc0JBQXNCLEdBQUcsRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBQyxDQUFBO0FBRXRHOzs7OztvREFLb0Q7QUFDcEQsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV2RCxrR0FBa0c7QUFDbEcsTUFBTSxpQ0FBaUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtBQUV4RixNQUFNLDBCQUEwQixHQUFHO0lBQ2pDLFNBQVM7SUFDVCxxQkFBcUI7SUFDckIsZ0JBQWdCO0lBQ2hCLHFCQUFxQjtJQUNyQixPQUFPO0lBQ1AsT0FBTztJQUNQLE9BQU87SUFDUCxpQkFBaUI7SUFDakIsUUFBUTtJQUNSLG9CQUFvQjtJQUNwQixlQUFlO0NBQ2hCLENBQUE7QUFFRCxpREFBaUQ7QUFDakQsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0FBRWhELHFGQUFxRjtBQUNyRixNQUFNLE9BQU8sNkJBQThCLFNBQVEsS0FBSztJQUN0RDs7O09BR0c7SUFDSCxZQUFZLE9BQU87UUFDakIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRywrQkFBK0IsQ0FBQTtJQUM3QyxDQUFDO0NBQ0Y7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sVUFBVTtJQUM3Qjs7Ozs7Ozs7OztPQVVHO0lBQ0gsWUFBWSxPQUFPLEdBQUcsRUFBRTtRQUN0QixNQUFNLEVBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUUsRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLEdBQUcsV0FBVyxFQUFDLEdBQUcsT0FBTyxDQUFBO1FBRWhLLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUUxQixNQUFNLG1CQUFtQixHQUFHLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLE1BQU0sQ0FBQTtRQUN2RSxNQUFNLHNCQUFzQixHQUFHLDJCQUEyQixDQUFDLGNBQWMsRUFBRTtZQUN6RSxLQUFLLEVBQUUsNkJBQTZCO1lBQ3BDLFlBQVksRUFBRSwwQkFBMEI7U0FDekMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7WUFDekIsTUFBTSxJQUFJLEtBQUssQ0FBQyw4SEFBOEgsQ0FBQyxDQUFBO1FBQ2pKLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxPQUFPLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1lBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsMEVBQTBFLENBQUMsQ0FBQTtRQUM3RixDQUFDO1FBQ0QsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixZQUFZLENBQUMsbUJBQW1CLENBQUMsYUFBYSxDQUFDLENBQUE7WUFDL0MsWUFBWSxDQUFDLHFCQUFxQixDQUFDLHFCQUFxQixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFBO1FBQ2hGLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDcEQsTUFBTSxpQkFBaUIsR0FBRyxTQUFTLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQTtRQUN4RCxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLHFCQUFxQixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDeEgsd0ZBQXdGO1FBQ3hGLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUk7Z0JBQUUsU0FBUTtZQUM5QixJQUFJLFlBQVksSUFBSSxVQUFVLENBQUMscUJBQXFCLENBQUMsRUFBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLE1BQU0sRUFBRSxFQUFDLENBQUMsS0FBSyxrQkFBa0I7Z0JBQUUsU0FBUTtZQUV0SCxNQUFNLFlBQVksR0FBRyxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUE7WUFFOUMsTUFBTSxrQkFBa0IsR0FBRyxZQUFZO2dCQUNyQyxDQUFDLENBQUMsWUFBWSxDQUFDLGtCQUFrQixDQUFDLEVBQUMsa0JBQWtCLEVBQUUscUJBQXFCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLFVBQVUsRUFBQyxDQUFDO2dCQUMvRyxDQUFDLENBQUMsVUFBVSxDQUFBO1lBQ2QsTUFBTSxjQUFjLEdBQUcsaUNBQWlDLENBQUMsRUFBQyxXQUFXLEVBQUUsVUFBVSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtZQUV0SSxJQUFJLGdCQUFnQixJQUFJLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUN4RCxjQUFjLENBQUMsZ0JBQWdCLEdBQUc7b0JBQ2hDLEdBQUcsY0FBYyxDQUFDLGdCQUFnQjtvQkFDbEMsV0FBVyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLGdCQUFnQixDQUFDO2lCQUNyRixDQUFBO1lBQ0gsQ0FBQztZQUVELFNBQVMsQ0FBQyxZQUFZLENBQUMsR0FBRyxjQUFjLENBQUE7UUFDMUMsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQywwSkFBMEosQ0FBQyxDQUFBO1FBQzdLLENBQUM7UUFFRCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksS0FBSyxDQUFDLHlHQUF5RyxDQUFDLENBQUE7UUFDNUgsQ0FBQztRQUNELElBQUksWUFBWSxJQUFJLGlCQUFpQixDQUFDLHFCQUFxQixDQUFDLEVBQUMsTUFBTSxFQUFFLFlBQVksQ0FBQyxNQUFNLEVBQUUsRUFBQyxDQUFDLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztZQUNwSCxNQUFNLElBQUksS0FBSyxDQUFDLHNEQUFzRCxJQUFJLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzdHLENBQUM7UUFFRCxnRUFBZ0U7UUFDaEUsSUFBSSxDQUFDLE1BQU0sR0FBRztZQUNaLG1CQUFtQixFQUFFLG1CQUFtQixDQUFDLG1CQUFtQjtZQUM1RCxTQUFTLEVBQUUsbUJBQW1CLENBQUMsU0FBUztZQUN4QyxhQUFhO1lBQ2Isa0JBQWtCO1lBQ2xCLFFBQVEsRUFBRSxtQkFBbUIsQ0FBQyxRQUFRO1lBQ3RDLFlBQVk7WUFDWixPQUFPLEVBQUUsbUJBQW1CLENBQUMsT0FBTztZQUNwQyxXQUFXLEVBQUUsZUFBZSxDQUFDLEVBQUMsSUFBSSxFQUFFLEdBQUcsbUJBQW1CLENBQUMsU0FBUyxVQUFVLEVBQUUsY0FBYyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxTQUFTLEVBQUMsQ0FBQztZQUNsSyxVQUFVLEVBQUUsZUFBZSxDQUFDLEVBQUMsSUFBSSxFQUFFLEdBQUcsbUJBQW1CLENBQUMsU0FBUyxTQUFTLEVBQUUsY0FBYyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxTQUFTLEVBQUMsQ0FBQztZQUNoSyxRQUFRLEVBQUUsbUJBQW1CLENBQUMsUUFBUTtZQUN0QyxjQUFjLEVBQUUsc0JBQXNCO1lBQ3RDLFNBQVM7WUFDVCxTQUFTLEVBQUUsaUJBQWlCO1lBQzVCLFlBQVk7WUFDWixlQUFlLEVBQUUsbUJBQW1CLENBQUMsZUFBZTtZQUNwRCxZQUFZLEVBQUUsbUJBQW1CLENBQUMsWUFBWTtTQUMvQyxDQUFBO1FBQ0QsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLGFBQWEsQ0FBQTtRQUNwQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsZ0JBQWdCLENBQUE7UUFDekMsSUFBSSxDQUFDLHVCQUF1QixHQUFHLFlBQVk7WUFDekMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsRUFBQyxrQkFBa0IsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLEVBQUMsQ0FBQyxDQUFDLGdCQUFnQjtZQUN6RyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBQ1Isd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFBO1FBQzNCLHNNQUFzTTtRQUN0TSxJQUFJLENBQUMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtRQUNoQyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLDBCQUEwQixHQUFHLElBQUksQ0FBQTtRQUN0Qyw0REFBNEQ7UUFDNUQsSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7UUFDckMsNkRBQTZEO1FBQzdELElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxJQUFJLElBQUksQ0FBQTtRQUNyQyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksQ0FBQTtRQUM1Qiw2RkFBNkY7UUFDN0YsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQTtRQUNoQyw2T0FBNk87UUFDN08sSUFBSSxDQUFDLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtRQUMzQiw4QkFBOEI7UUFDOUIsSUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7UUFDeEMsa0NBQWtDO1FBQ2xDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ25DLDZEQUE2RDtRQUM3RCxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtRQUMxQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsQ0FBQyxDQUFBO1FBQzlCLDRHQUE0RztRQUM1RyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtRQUNuQixvQ0FBb0M7UUFDcEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDckMsSUFBSSxDQUFDLHlCQUF5QixHQUFHLElBQUksZUFBZSxFQUFFLENBQUE7UUFDdEQsSUFBSSxDQUFDLG9CQUFvQixHQUFHLENBQUMsQ0FBQTtRQUM3QixJQUFJLENBQUMseUJBQXlCLEdBQUcsQ0FBQyxDQUFBO1FBQ2xDLDRCQUE0QjtRQUM1QixJQUFJLENBQUMsMkJBQTJCLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ3BELElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLEtBQUs7UUFDVCxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQTtRQUN0QyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixJQUFJLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTTtRQUV6QixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUVwQixLQUFLLE1BQU0sQ0FBQyxZQUFZLEVBQUUsY0FBYyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDbkYsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsY0FBYyxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7WUFFekUsSUFBSSxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztnQkFDcEMsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLEtBQUssUUFBUSxDQUFDLEVBQUUsQ0FBQztvQkFDakYsTUFBTSxZQUFZLEdBQUcsU0FBUyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUE7b0JBQy9FLE1BQU0sUUFBUSxHQUFHLENBQUMsNENBQTRDLENBQUMsTUFBTSxFQUFFLEVBQUU7d0JBQ3ZFLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQzs0QkFBRSxPQUFNO3dCQUNwQyxJQUFJLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUM7NEJBQUUsT0FBTTt3QkFFN0MsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTt3QkFFckUsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQyxDQUFBO3dCQUMxRixJQUFJLENBQUMscUJBQXFCLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO29CQUMxRCxDQUFDLENBQUE7b0JBRUQsY0FBYyxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtvQkFDakQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxFQUFDLFFBQVEsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVLEVBQUMsQ0FBQyxDQUFBO2dCQUM5RixDQUFDO1lBQ0gsQ0FBQztZQUVELEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sWUFBWSxHQUFHLHNCQUFzQixDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUN0RCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxTQUFTLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtnQkFFMUUsY0FBYyxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDakQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxFQUFDLFFBQVEsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVLEVBQUMsQ0FBQyxDQUFBO1lBQzlGLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILElBQUksQ0FBQyxPQUFPLEdBQUcsRUFBRTtRQUNmLEtBQUssTUFBTSxFQUFDLFFBQVEsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFDLElBQUksSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDMUUsVUFBVSxDQUFDLDJCQUEyQixDQUFDLFlBQVksRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUNoRSxDQUFDO1FBRUQsSUFBSSxDQUFDLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtRQUMzQixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUVyQixPQUFPLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUM3QyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUM5QyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDcEMsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDNUMsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBQyxHQUFHLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN4RSxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsT0FBTztRQUMzQixJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDdEUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFBO1FBQzFFLENBQUM7UUFFRCxNQUFNLEVBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLEdBQUcsRUFBRSxFQUFFLGtCQUFrQixHQUFHLEtBQUssRUFBRSxHQUFHLFdBQVcsRUFBQyxHQUFHLE9BQU8sQ0FBQTtRQUVoRyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDMUIsSUFBSSxPQUFPLE9BQU8sS0FBSyxVQUFVO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3REFBd0QsQ0FBQyxDQUFBO1FBQzVHLElBQUksT0FBTyxrQkFBa0IsS0FBSyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrREFBK0QsQ0FBQyxDQUFBO1FBRTdILE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzVDLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7WUFDM0QsTUFBTSxPQUFPLEVBQUUsQ0FBQTtRQUNqQixDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksa0JBQWtCO1lBQUUsTUFBTSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtJQUN6RCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLFFBQVE7UUFDOUIsSUFBSSxJQUFJLENBQUMseUJBQXlCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxDQUFDLDJCQUEyQixDQUFBO1FBRTlFLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUE7UUFFcEQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXJDLE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVoQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRXRDLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxPQUFPLENBQUE7UUFDdEIsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMzQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLG1CQUFtQixFQUFFLFFBQVE7UUFDM0QsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFFNUQsT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUM3QyxJQUFJLENBQUMsa0NBQWtDLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtZQUU1RCxPQUFPLE1BQU0sUUFBUSxFQUFFLENBQUE7UUFDekIsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtDQUFrQyxDQUFDLG1CQUFtQjtRQUNwRCxJQUFJLElBQUksQ0FBQyx5QkFBeUIsS0FBSyxDQUFDLElBQUksbUJBQW1CLEtBQUssSUFBSSxDQUFDLG9CQUFvQjtZQUFFLE9BQU07UUFFckcsTUFBTSxJQUFJLDZCQUE2QixDQUFDLDJEQUEyRCxDQUFDLENBQUE7SUFDdEcsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHVCQUF1QixDQUFDLFFBQVE7UUFDOUIsSUFBSSxDQUFDLHlCQUF5QixJQUFJLENBQUMsQ0FBQTtRQUVuQywwRUFBMEU7UUFDMUUsMkVBQTJFO1FBQzNFLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxXQUFXLEVBQUUsQ0FBQTtRQUN0RSxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQywyQkFBMkIsQ0FBQTtRQUMzRCxNQUFNLFVBQVUsR0FBRyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDcEQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFBO1lBQ3RELE1BQU0sV0FBVyxHQUFHLElBQUksNkJBQTZCLENBQUMsbUNBQW1DLENBQUMsQ0FBQTtZQUUxRixlQUFlLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1lBRWxDLElBQUksMEJBQTBCO2dCQUFFLE1BQU0sMEJBQTBCLENBQUE7WUFFaEUsTUFBTSxXQUFXLEdBQUcsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxDQUFBO1lBRTVFLElBQUksSUFBSSxDQUFDLGVBQWU7Z0JBQUUsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLGNBQWMsRUFBRSxDQUFBO1lBRXJFLHdCQUF3QjtZQUN4QixNQUFNLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtZQUUzQixLQUFLLE1BQU0sTUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDO2dCQUNqQyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssVUFBVSxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7b0JBQUUsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNqSCxDQUFDO1lBRUQsSUFBSSxnQkFBZ0IsQ0FBQyxNQUFNLEtBQUssQ0FBQztnQkFBRSxNQUFNLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQzVELElBQUksZ0JBQWdCLENBQUMsTUFBTSxHQUFHLENBQUM7Z0JBQUUsTUFBTSxJQUFJLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSx1REFBdUQsQ0FBQyxDQUFBO1lBRXBJLE1BQU0sUUFBUSxFQUFFLENBQUE7UUFDbEIsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtZQUNkLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLGVBQWUsRUFBRSxDQUFBO1lBQ3RELElBQUksQ0FBQyxvQkFBb0IsSUFBSSxDQUFDLENBQUE7WUFDOUIsSUFBSSxDQUFDLHlCQUF5QixJQUFJLENBQUMsQ0FBQTtZQUNuQyxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQTtZQUNyQyxJQUFJLENBQUMsMEJBQTBCLEdBQUcsSUFBSSxDQUFBO1FBQ3hDLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLDJCQUEyQixHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsU0FBUyxFQUFFLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRXBGLE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLE9BQU87UUFDcEMsTUFBTSxFQUFDLE9BQU8sRUFBRSxXQUFXLEdBQUcsRUFBRSxFQUFFLEdBQUcsV0FBVyxFQUFDLEdBQUcsT0FBTyxDQUFBO1FBRTNELGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUMxQixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUE7UUFDNUYsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sT0FBTyxLQUFLLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxDQUFDLENBQUE7UUFDckgsSUFBSSxPQUFPLElBQUksV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFBO1FBQ2pILElBQUksV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVwQyxNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdCQUFnQixDQUFDLEtBQUs7UUFDcEIsT0FBTyxLQUFLLFlBQVksNkJBQTZCLENBQUE7SUFDdkQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxNQUFNO1FBQzdCLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTztZQUFFLE9BQU07UUFFM0IsTUFBTSxNQUFNLENBQUMsTUFBTSxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSw2QkFBNkIsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFBO0lBQy9ILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsaUJBQWlCLENBQUMsRUFBQyxjQUFjLEVBQUUsWUFBWSxFQUFDO1FBQzlDLE1BQU0sS0FBSyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUE7UUFFbEMsSUFBSSxLQUFLLEtBQUssS0FBSztZQUFFLE9BQU8sRUFBRSxDQUFBO1FBQzlCLElBQUksS0FBSyxLQUFLLFNBQVM7WUFBRSxPQUFPLDBCQUEwQixDQUFBO1FBQzFELElBQUksS0FBSyxLQUFLLElBQUk7WUFBRSxPQUFPLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzdHLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLFlBQVksNENBQTRDLENBQUMsQ0FBQTtRQUNsRyxDQUFDO1FBRUQsS0FBSyxNQUFNLFNBQVMsSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDekMsSUFBSSxDQUFDLENBQUMsU0FBUyxJQUFJLHNCQUFzQixDQUFDLEVBQUUsQ0FBQztnQkFDM0MsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsWUFBWSx5REFBeUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUNsSSxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFDLFVBQVUsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsdUJBQXVCLENBQUMsRUFBQyxTQUFTLEVBQUUsY0FBYyxFQUFDO1FBQ2pELE9BQU8sS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFBRSxPQUFNO1lBQ3BDLElBQUksSUFBSSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQztnQkFBRSxPQUFNO1lBRTdDLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFBO1lBQ3JELE1BQU0sSUFBSSxHQUFHLGFBQWEsQ0FBQyxjQUFjLENBQUM7Z0JBQ3hDLGlCQUFpQixFQUFFLGNBQWMsQ0FBQyxpQkFBaUIsSUFBSSxFQUFFO2dCQUN6RCxJQUFJLEVBQUUsY0FBYyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2dCQUM5RixtQkFBbUIsRUFBRSxjQUFjLENBQUMsbUJBQW1CLElBQUksRUFBRTtnQkFDN0QsUUFBUSxFQUFFLE1BQU07YUFDakIsQ0FBQyxDQUFBO1lBQ0YsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtZQUMxRSxNQUFNLFdBQVcsR0FBRyxjQUFjLENBQUMsZ0JBQWdCO2dCQUNqRCxDQUFDLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUMsQ0FBQztnQkFDbEUsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUNSLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDcEQsTUFBTSxjQUFjLEdBQUcsaUJBQWlCO2dCQUN0QyxDQUFDLENBQUMsaUJBQWlCLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2dCQUNuRCxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUE7WUFFekIsTUFBTSxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUMvQyxJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsbUJBQW1CLEVBQUUsS0FBSyxJQUFJLEVBQUU7d0JBQ25FLElBQUksY0FBYyxDQUFDLGdCQUFnQixFQUFFLENBQUM7NEJBQ3BDLE1BQU0sYUFBYSxDQUFDLHdCQUF3QixDQUFDO2dDQUMzQyxXQUFXO2dDQUNYLGdCQUFnQixFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7Z0NBQ2pELElBQUk7Z0NBQ0osU0FBUztnQ0FDVCxRQUFRLEVBQUUsTUFBTTtnQ0FDaEIsWUFBWSxFQUFFLE1BQU0sQ0FBQyxXQUFXLENBQUMsWUFBWSxFQUFFO2dDQUMvQyxRQUFROzZCQUNULENBQUMsQ0FBQTt3QkFDSixDQUFDOzZCQUFNLENBQUM7NEJBQ04sTUFBTSxhQUFhLENBQUMsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO3dCQUNuRyxDQUFDO29CQUNILENBQUMsQ0FBQyxDQUFBO2dCQUNKLENBQUM7Z0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztvQkFDZixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUM7d0JBQUUsT0FBTTtvQkFFeEMsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO29CQUUvRCxPQUFNO2dCQUNSLENBQUM7Z0JBRUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFBO1lBQ3ZCLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLEtBQUs7UUFDaEMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3hCLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRTFCLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLDREQUE0RCxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQ2hHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNO1FBQ0osSUFBSSxDQUFDLE9BQU8sS0FBSyxJQUFJLE1BQU0sQ0FBQyxZQUFZLEVBQUUsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBRXJGLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQTtJQUNyQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxNQUFNO1FBQ2xCLE9BQU8sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILG9CQUFvQixDQUFDLE1BQU07UUFDekIsT0FBTyxJQUFJLENBQUMscUJBQXFCLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDckUsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7T0FZRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsUUFBUTtRQUM1QixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUU1QixJQUFJLENBQUM7WUFDSCxPQUFPLE1BQU0sUUFBUSxFQUFFLENBQUE7UUFDekIsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDOUIsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxlQUFlLENBQUMsTUFBTTtRQUNwQixJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXBDLE9BQU8sR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN0RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFBO0lBQzVCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsT0FBTztRQUNaLE9BQU8seUJBQXlCLENBQUMsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sRUFBRSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQzVFLE9BQU8sSUFBSSxVQUFVLENBQUMsRUFBQyxHQUFHLE9BQU8sRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO0lBQ3BELENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsRUFBQyxVQUFVLEVBQUUsZUFBZSxFQUFDLEdBQUcsRUFBRTtRQUNsRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDaEMsTUFBTSxLQUFLLEdBQUcsd0JBQXdCLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDN0MsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ3BDLE1BQU0sUUFBUSxHQUFHLE1BQU0sVUFBVSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRTFELElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDeEQsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUNuRSxNQUFNLFlBQVksR0FBRyxhQUFhLENBQUMscUJBQXFCLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtZQUU3RSxJQUFJLFlBQVk7Z0JBQUUsTUFBTSxVQUFVLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxZQUFZLENBQUMsQ0FBQTtRQUN2RSxDQUFDO1FBRUQsT0FBTyxFQUFDLE1BQU0sRUFBRSxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBQyxVQUFVLEVBQUUsZUFBZSxFQUFDLENBQUMsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUN4RSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSztRQUNoQixJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDaEMsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsVUFBVSxDQUFDLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDckUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBQyxVQUFVLEVBQUUsZUFBZSxFQUFDLEdBQUcsRUFBRTtRQUMzQyxPQUFPLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2hILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsZUFBZSxFQUFDO1FBQy9DLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ3pDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVyQyw0RUFBNEU7UUFDNUUsSUFBSSxjQUFjLEdBQUcsSUFBSSxDQUFBO1FBRXpCLE1BQU0sYUFBYSxDQUFDLFlBQVksQ0FBQyw4QkFBOEIsSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzlGLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNyQyxNQUFNLG1CQUFtQixHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBQ25FLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNyQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7WUFDcEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3hDLE1BQU0sTUFBTSxHQUFHO2dCQUNiLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxDQUFDO2dCQUNSLGVBQWUsRUFBRSxzQ0FBc0MsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDNUQsY0FBYyxFQUFFLHFDQUFxQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUMxRCxXQUFXLEVBQUUsQ0FBQztnQkFDZCxLQUFLLEVBQUUsQ0FBQzthQUNULENBQUE7WUFFRCxLQUFLLE1BQU0sUUFBUSxJQUFJLE1BQU0sVUFBVSxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUM7Z0JBQ3ZELElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDckMsbUZBQW1GO2dCQUNuRixtRkFBbUY7Z0JBQ25GLDhEQUE4RDtnQkFDOUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQTtnQkFDOUIsTUFBTSxlQUFlLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQTtnQkFDMUMsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQTtnQkFDOUIsTUFBTSxXQUFXLEdBQUcsTUFBTSxhQUFhLENBQUMsV0FBVyxDQUFDO29CQUNsRCxTQUFTO29CQUNULG1CQUFtQjtvQkFDbkIsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUztvQkFDaEMsVUFBVSxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxVQUFVLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztvQkFDN0QsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQzt3QkFDaEQsS0FBSyxFQUFFLFNBQVMsR0FBRyxRQUFRLENBQUMsS0FBSzt3QkFDakMsV0FBVyxFQUFFLGVBQWUsR0FBRyxRQUFRLENBQUMsV0FBVzt3QkFDbkQsS0FBSyxFQUFFLFNBQVMsR0FBRyxRQUFRLENBQUMsS0FBSztxQkFDbEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO29CQUNkLFdBQVcsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQzt3QkFDckUsR0FBRyxPQUFPO3dCQUNWLG9GQUFvRjt3QkFDcEYsS0FBSyxFQUFFOzRCQUNMLFVBQVUsRUFBRSxRQUFRLENBQUMsVUFBVTs0QkFDL0IsWUFBWSxFQUFFLFFBQVEsQ0FBQyxZQUFZOzRCQUNuQyxHQUFHLENBQUMsUUFBUSxDQUFDLFlBQVksS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQzt5QkFDMUY7d0JBQ0QsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsRUFBQyxlQUFlLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztxQkFDcEQsRUFBRSxPQUFPLENBQUM7b0JBQ1gsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sVUFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDO29CQUMzRSxNQUFNO2lCQUNQLENBQUMsQ0FBQTtnQkFFRixNQUFNLENBQUMsT0FBTyxLQUFLLFdBQVcsQ0FBQyxPQUFPLENBQUE7Z0JBQ3RDLE1BQU0sQ0FBQyxLQUFLLElBQUksV0FBVyxDQUFDLEtBQUssQ0FBQTtnQkFDakMsTUFBTSxDQUFDLFdBQVcsSUFBSSxXQUFXLENBQUMsV0FBVyxDQUFBO2dCQUM3QyxNQUFNLENBQUMsS0FBSyxJQUFJLFdBQVcsQ0FBQyxLQUFLLENBQUE7Z0JBRWpDLEtBQUssTUFBTSxDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO29CQUMvRSxNQUFNLENBQUMsY0FBYyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUE7Z0JBQzFGLENBQUM7Z0JBQ0QsS0FBSyxNQUFNLENBQUMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7b0JBQ2xGLE1BQU0sQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLEtBQUssT0FBTyxDQUFBO2dCQUNsRCxDQUFDO1lBQ0gsQ0FBQztZQUVELGNBQWMsR0FBRyxNQUFNLENBQUE7UUFDekIsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDckMsT0FBTyxjQUFjLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxlQUFlLENBQUMsRUFBQyxNQUFNLEdBQUcsZUFBZSxFQUFDLEdBQUcsRUFBRTtRQUM3QyxPQUFPLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtZQUNwQixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7WUFDeEMsTUFBTSxrQkFBa0IsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7WUFFekYsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxDQUFDO2dCQUNyRCxNQUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxNQUFNLEtBQUssTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUM1RyxDQUFDO1lBRUQsT0FBTyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLEVBQUU7Z0JBQ3hELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtnQkFDeEIsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQTtnQkFFL0YsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO29CQUNyQixNQUFNLGNBQWMsR0FBRyxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUM7d0JBQzdFLENBQUMsQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLElBQUksQ0FBQzt3QkFDckUsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtvQkFFTixJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsY0FBYyxDQUFDLGdCQUFnQixDQUFDLEVBQUMsQ0FBQyxDQUFBO2dCQUMxSCxDQUFDO2dCQUVELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUMvRCxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsZUFBZSxDQUFDLG1CQUFtQixFQUFFLENBQUMsTUFBTSxFQUFFLEVBQUU7b0JBQzVFLElBQUksU0FBUzt3QkFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtvQkFFekQsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUNyQyxDQUFDLENBQUMsQ0FBQTtnQkFFRixPQUFPLE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzVCLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxjQUFjO1FBQ1osSUFBSSxJQUFJLENBQUMsZUFBZSxLQUFLLFNBQVM7WUFBRSxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUE7UUFFbkUsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ2hDLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUE7UUFDcEQsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNwQyxNQUFNLEdBQUcsR0FBRyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUE7WUFFbEgsSUFBSSxDQUFDLGVBQWUsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksd0JBQXdCLENBQUMsRUFBQyxHQUFHLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDekUsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtRQUM3QixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFBO0lBQzdCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPO1FBQzdCLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUM1QyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtZQUN4QixNQUFNLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLEVBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUN4RCxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDdkMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxJQUFJLENBQUMsZUFBZSxLQUFLLFlBQVk7WUFBRSxPQUFNO1FBRWpELElBQUksQ0FBQyxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQztZQUNyQyxJQUFJLENBQUMsMEJBQTBCLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtnQkFDOUgsSUFBSSxDQUFDLDBCQUEwQixHQUFHLElBQUksQ0FBQTtZQUN4QyxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsTUFBTTtRQUM5QixJQUFJLENBQUMsZUFBZSxHQUFHLGFBQWEsQ0FBQTtRQUVwQyxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFBO1lBQ2pFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUVyQyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBQzlCLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNyQyxNQUFNLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUNqQixJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFckMsSUFBSSxDQUFDLGVBQWUsR0FBRyxZQUFZLENBQUE7UUFDckMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQTtZQUNyQyxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQjtRQUN4QixNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxVQUFVLENBQUMsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUUxRCxNQUFNLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBRWhDLElBQUksQ0FBQyxlQUFlLEdBQUcsY0FBYyxDQUFBO1FBQ3JDLElBQUksQ0FBQywwQkFBMEIsR0FBRyxJQUFJLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLFNBQVM7UUFDYixPQUFPLEVBQUMsVUFBVSxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsY0FBYyxFQUFFLEVBQUUsWUFBWSxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ2pGLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxzQkFBc0I7UUFDcEIsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILEtBQUssQ0FBQyxjQUFjO1FBQ2xCLE9BQU8sTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxtQkFBbUI7UUFDdkIsTUFBTSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDM0MsQ0FBQztJQUVEOzs7T0FHRztJQUNILGNBQWM7UUFDWixPQUFPLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxzQkFBc0I7UUFDMUIsTUFBTSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsY0FBYyxFQUFFLENBQUE7SUFDOUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILGNBQWM7UUFDWixJQUFJLENBQUMsZUFBZSxLQUFLLElBQUksa0JBQWtCLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUVuRSxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUE7SUFDN0IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsU0FBUyxHQUFHLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFDO1FBQ3ZFLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFBO1FBRXJELE9BQU8sTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsbUJBQW1CLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDMUUsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDeEIsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ3BDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUN2RCxNQUFNLGdCQUFnQixHQUFHLFFBQVEsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtZQUV4RyxJQUFJLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNwQyxNQUFNLFVBQVUsR0FBRyxhQUFhLENBQUMsY0FBYyxDQUFDO29CQUM5QyxpQkFBaUIsRUFBRSxjQUFjLENBQUMsaUJBQWlCLElBQUksRUFBRTtvQkFDekQsSUFBSTtvQkFDSixtQkFBbUIsRUFBRSxjQUFjLENBQUMsbUJBQW1CLElBQUksRUFBRTtvQkFDN0QsUUFBUTtpQkFDVCxDQUFDLENBQUE7Z0JBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxhQUFhLENBQUMsd0JBQXdCLENBQUM7b0JBQzFELFdBQVcsRUFBRSxXQUFXLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVztvQkFDekgsZ0JBQWdCLEVBQUUsY0FBYyxDQUFDLGdCQUFnQjtvQkFDakQsSUFBSSxFQUFFLFVBQVU7b0JBQ2hCLFNBQVM7b0JBQ1QsUUFBUTtvQkFDUixZQUFZLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxZQUFZLEVBQUU7b0JBQ2pELFFBQVEsRUFBRSxnQkFBZ0I7aUJBQzNCLENBQUMsQ0FBQTtnQkFFRixJQUFJLENBQUMsY0FBYyxFQUFFLENBQUE7Z0JBRXJCLE9BQU8sTUFBTSxDQUFBO1lBQ2YsQ0FBQztZQUVELE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxpQkFBaUIsRUFBRSxFQUFFLENBQUMsTUFBTSxhQUFhLENBQUMsY0FBYyxDQUFDO2dCQUM3RyxpQkFBaUIsRUFBRSxjQUFjLENBQUMsaUJBQWlCLElBQUksRUFBRTtnQkFDekQsSUFBSTtnQkFDSixtQkFBbUIsRUFBRSxjQUFjLENBQUMsbUJBQW1CLElBQUksRUFBRTtnQkFDN0QsUUFBUTtnQkFDUixTQUFTLEVBQUUsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7Z0JBQzFHLFFBQVEsRUFBRSxnQkFBZ0I7YUFDM0IsQ0FBQyxDQUFDLENBQUE7WUFFSCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUE7WUFFckIsT0FBTyxPQUFPLENBQUE7UUFDaEIsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxhQUFhO1FBQ2pCLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO0lBQ25GLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxNQUFNO1FBQ3pCLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNyQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUFFLE9BQU07UUFDcEMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXJDLE1BQU0sYUFBYSxDQUFDLFlBQVksQ0FBQyxnQ0FBZ0MsSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxFQUFFO1lBQ3BKLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNyQyxLQUFLLE1BQU0sQ0FBQyxZQUFZLEVBQUUsY0FBYyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ25GLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCO29CQUFFLFNBQVE7Z0JBRTlDLE1BQU0sYUFBYSxDQUFDLDBCQUEwQixDQUFDO29CQUM3QyxtQkFBbUIsRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUU7b0JBQzVELFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7b0JBQ2hDLGdCQUFnQixFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7b0JBQ2pELFVBQVUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVU7b0JBQ2xDLGdCQUFnQixFQUFFLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUM7b0JBQzFFLFlBQVk7b0JBQ1osTUFBTTtpQkFDUCxDQUFDLENBQUE7WUFDSixDQUFDO1lBRUQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3JDLE1BQU0sYUFBYSxDQUFDLGdCQUFnQixDQUFDO2dCQUNuQyxtQkFBbUIsRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUU7Z0JBQzVELFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7Z0JBQ2hDLFVBQVUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVU7Z0JBQ2xDLE1BQU07Z0JBQ04sU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7YUFDM0YsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVILElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFDO1FBQ25ELEtBQUssT0FBTyxDQUFBO1FBQ1osTUFBTSxRQUFRLEdBQUcsR0FBRyxZQUFZLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUE7UUFFeEQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQ3pGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUM7UUFDaEQsSUFBSSxTQUFTLEtBQUssUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXZDLE1BQU0sZ0JBQWdCLEdBQUcsY0FBYyxDQUFDLGdCQUFnQixFQUFFLGdCQUFnQixDQUFBO1FBRTFFLElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVsQyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFcEQsSUFBSSxLQUFLLFlBQVksSUFBSTtZQUFFLE9BQU8sS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3JELElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTFGLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLGdCQUFnQiwwQ0FBMEMsQ0FBQyxDQUFBO0lBQ3RHLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHlCQUF5QixDQUFDLEVBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUM7UUFDM0QsTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUE7UUFDMUUsTUFBTSxhQUFhLEdBQUcsZ0JBQWdCO1lBQ3BDLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLCtCQUErQixFQUFFLENBQUMsZ0JBQWdCLENBQUM7WUFDeEUsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUNiLE1BQU0sYUFBYSxHQUFHLFNBQVMsS0FBSyxRQUFRLElBQUksYUFBYTtZQUMzRCxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLGFBQWEsQ0FBQztZQUNqQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBRWIsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7UUFFbkYsTUFBTSxLQUFLLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTlCLElBQUksS0FBSyxZQUFZLElBQUk7WUFBRSxPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUNyRCxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUxRixNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixnQkFBZ0IsMENBQTBDLENBQUMsQ0FBQTtJQUN0RyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxzQkFBc0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDO1FBQ3hELElBQUksU0FBUyxLQUFLLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV2QyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDL0QsTUFBTSxXQUFXLEdBQUcsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLENBQUE7UUFFN0MsSUFBSSxnQkFBZ0IsRUFBRSxNQUFNLEtBQUssQ0FBQztZQUFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDN0UsSUFBSSxXQUFXLEtBQUssU0FBUztZQUFFLE9BQU8sV0FBVyxDQUFBO1FBRWpELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtJQUNqRSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWM7UUFDWixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNsQyxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7WUFDNUIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDO29CQUFFLE9BQU07Z0JBRXhDLElBQUksQ0FBQyxXQUFXLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ2hELENBQUM7UUFDSCxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQ04sQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxzQkFBc0I7UUFDMUIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxXQUFXLENBQUMsS0FBSztRQUNmLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUMxQixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRO1FBQ1osSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXRDLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxLQUFLLENBQUE7SUFDakQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUV4QixJQUFJLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLGlCQUFpQixJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsYUFBYSxLQUFLLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQzVHLE1BQU0sSUFBSSxLQUFLLENBQUMsa0ZBQWtGLENBQUMsQ0FBQTtRQUNyRyxDQUFDO1FBRUQsSUFBSSxDQUFDLFdBQVcsS0FBSyxJQUFJLGNBQWMsQ0FBQztZQUN0QyxhQUFhLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhO1lBQ3hDLGtCQUFrQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCO1lBQ2xELFlBQVksRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVk7U0FDdkMsQ0FBQyxDQUFBO1FBRUYsT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUJBQWlCLENBQUMsUUFBUTtRQUN4QixNQUFNLFVBQVUsR0FBRyxRQUFRLEVBQUUsV0FBVyxDQUFBO1FBRXhDLElBQUksT0FBTyxVQUFVLEVBQUUsWUFBWSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ25ELE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDaEgsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtRQUM5QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLFlBQVksRUFBRSxDQUFDLENBQUE7UUFFeEYsT0FBTyxjQUFjLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDO1FBQ2pELElBQUksT0FBTyxjQUFjLENBQUMsUUFBUSxLQUFLLFVBQVU7WUFBRSxPQUFPLGNBQWMsQ0FBQyxRQUFRLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN0RyxJQUFJLFNBQVMsS0FBSyxTQUFTO1lBQUUsT0FBTyxRQUFRLENBQUE7UUFDNUMsSUFBSSxjQUFjLENBQUMsUUFBUSxLQUFLLFFBQVE7WUFBRSxPQUFPLFFBQVEsQ0FBQTtRQUV6RCxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLFNBQVM7UUFDM0IsSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsb0JBQW9CO1lBQUUsT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFFN0UsTUFBTSxlQUFlLEdBQUcsc0ZBQXNGLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUNoSSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2FBQ2xDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUN0RCxHQUFHLENBQUMsQ0FBQyxDQUFDLFlBQVksRUFBRSxRQUFRLENBQUMsRUFBRSxFQUFFO1lBQ2hDLE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUE7WUFDOUYsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQTtZQUN0QyxNQUFNLG1CQUFtQixHQUFHLFFBQVEsQ0FBQyxtQkFBbUIsQ0FBQTtZQUV4RCxPQUFPLENBQUMsWUFBWSxFQUFFO29CQUNwQixVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVU7b0JBQy9CLFVBQVUsRUFBRSxvRkFBb0YsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7b0JBQ3RILE9BQU8sRUFBRSxJQUFJO29CQUNiLFVBQVUsRUFBRSxTQUFTLElBQUksVUFBVTt3QkFDakMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsRUFBQyxHQUFHLElBQUksRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVMsSUFBSSxJQUFJLEVBQUMsQ0FBQzt3QkFDM0UsQ0FBQyxDQUFDLFVBQVU7b0JBQ2QsbUJBQW1CLEVBQUUsU0FBUyxJQUFJLG1CQUFtQjt3QkFDbkQsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLEdBQUcsSUFBSSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsU0FBUyxJQUFJLElBQUksRUFBQyxDQUFDO3dCQUNwRixDQUFDLENBQUMsbUJBQW1CO29CQUN2QixVQUFVO2lCQUNYLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUNMLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxTQUFTO1lBQUUsSUFBSSxDQUFDLG9CQUFvQixHQUFHLGVBQWUsQ0FBQTtRQUUzRCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsUUFBUTtRQUNoQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtZQUFFLE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDN0YsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLGlCQUFpQixDQUFDO1lBQ3RELGtCQUFrQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCO1lBQ2xELElBQUksRUFBRSxtQkFBbUI7U0FDMUIsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLEVBQUU7WUFDckIsTUFBTSxTQUFTLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUU3RCxPQUFPLE1BQU0sUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ2xDLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsTUFBTTtRQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFeEMsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUVwRCxPQUFPLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxLQUFLLElBQUksQ0FBQyxpQkFBaUI7WUFDekQsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxJQUFJLENBQUMsdUJBQXVCLENBQUE7SUFDMUUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxNQUFNO1FBQzFCLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0VBQStFLENBQUMsQ0FBQTtJQUNoSSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG9CQUFvQixDQUFDLEtBQUs7UUFDeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0I7WUFBRSxPQUFNO1FBRXhFLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUN4QyxNQUFNLGtCQUFrQixHQUFHLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDeEcsTUFBTSxxQkFBcUIsR0FBRyxLQUFLLENBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLENBQUE7UUFFbEUsSUFBSSxrQkFBa0IsS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtZQUN2RCxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNqRCxxQkFBcUIsS0FBSyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNuRCxNQUFNLElBQUksS0FBSyxDQUFDLDRFQUE0RSxDQUFDLENBQUE7UUFDL0YsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxpQkFBaUI7UUFDZixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtZQUFFLE9BQU07UUFFeEUsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLEVBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsRUFBQyxDQUFDLENBQUE7UUFFeEcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLElBQUksU0FBUyxDQUFDLGdCQUFnQixLQUFLLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1lBQ25ILE1BQU0sSUFBSSxLQUFLLENBQUMsNkRBQTZELENBQUMsQ0FBQTtRQUNoRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQkFBZ0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUM7UUFDbEMsSUFBSSxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxLQUFLLFNBQVM7WUFBRSxPQUFNO1FBQ3RELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNsQyxTQUFTLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQzlCLENBQUM7Q0FDRjtBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxpQ0FBaUMsQ0FBQyxFQUFDLFdBQVcsRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQ3BHLE1BQU0scUJBQXFCLEdBQUcsV0FBVyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUE7SUFFckUsSUFBSSxDQUFDLHFCQUFxQixJQUFJLE9BQU8scUJBQXFCLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMscUJBQXFCLENBQUMsRUFBRSxDQUFDO1FBQ2hILE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxZQUFZLGdFQUFnRSxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ3ZILENBQUM7SUFFRCxNQUFNLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxHQUFHLGVBQWUsRUFBQyxHQUFHLHFCQUFxQixDQUFBO0lBQ3ROLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFFaEQsNEVBQTRFO0lBQzVFLDBFQUEwRTtJQUMxRSx5RUFBeUU7SUFDekUsS0FBSyxPQUFPLENBQUE7SUFFWixJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksdUNBQXVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGtMQUFrTCxDQUFDLENBQUE7SUFDalIsQ0FBQztJQUNELElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxPQUFPLFFBQVEsS0FBSyxVQUFVLElBQUksUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ3RGLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxZQUFZLHlFQUF5RSxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQzdILENBQUM7SUFFRCxNQUFNLE9BQU8sR0FBRyxxQkFBcUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFBO0lBRXJGLElBQUksZ0JBQWdCO1FBQUUsd0JBQXdCLENBQUMsRUFBQyxnQkFBZ0IsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtJQUV6RixPQUFPO1FBQ0wsVUFBVTtRQUNWLFVBQVU7UUFDVixpQkFBaUIsRUFBRSxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLEVBQUUsaUJBQWlCLENBQUM7UUFDckYsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxnQkFBZ0IsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxnQkFBZ0IsSUFBSSxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztRQUMxSSxVQUFVO1FBQ1YsbUJBQW1CO1FBQ25CLG1CQUFtQixFQUFFLG9CQUFvQixDQUN2QyxPQUFPLENBQUMsbUJBQW1CLEVBQzNCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsSUFBSSxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FDbEg7UUFDRCxrQkFBa0I7UUFDbEIsVUFBVTtRQUNWLFFBQVE7UUFDUixRQUFRO1FBQ1IsS0FBSyxFQUFFLGVBQWUsQ0FBQyxLQUFLLENBQUM7UUFDN0IsV0FBVztLQUNaLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsd0JBQXdCLENBQUMsRUFBQyxnQkFBZ0IsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFDO0lBQ3pFLE1BQU0sZUFBZSxHQUFHO1FBQ3RCLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhO1FBQzdDLFdBQVcsRUFBRSxnQkFBZ0IsQ0FBQyxXQUFXO1FBQ3pDLGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxjQUFjO1FBQy9DLFVBQVUsRUFBRSxnQkFBZ0IsQ0FBQyxVQUFVO0tBQ3hDLENBQUE7SUFFRCxLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1FBQzNELElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxZQUFZLHFCQUFxQixHQUFHLDZCQUE2QixDQUFDLENBQUE7SUFDNUksQ0FBQztJQUNELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLElBQUksT0FBTyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsTUFBTSxLQUFLLFVBQVU7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsWUFBWSwwREFBMEQsQ0FBQyxDQUFBO0lBQzFMLElBQUksT0FBTyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsS0FBSyxVQUFVO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksdURBQXVELENBQUMsQ0FBQTtJQUNwSixJQUFJLENBQUMsZ0JBQWdCLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7UUFDN0YsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksdUZBQXVGLENBQUMsQ0FBQTtJQUN6SCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMscUJBQXFCLENBQUMsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQ3ZELElBQ0UsT0FBTyxVQUFVLENBQUMsY0FBYyxLQUFLLFVBQVU7UUFDL0MsT0FBTyxVQUFVLENBQUMsK0JBQStCLEtBQUssVUFBVTtRQUNoRSxPQUFPLFVBQVUsQ0FBQyxtQkFBbUIsS0FBSyxVQUFVO1FBQ3BELE9BQU8sVUFBVSxDQUFDLFVBQVUsS0FBSyxVQUFVO1FBQzNDLE9BQU8sVUFBVSxDQUFDLGFBQWEsS0FBSyxVQUFVLEVBQzlDLENBQUM7UUFDRCxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsWUFBWSxzS0FBc0ssQ0FBQyxDQUFBO0lBQ3hNLENBQUM7SUFFRCxNQUFNLHlCQUF5QixHQUFHLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFBO0lBQzlFLHVCQUF1QjtJQUN2QixNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtJQUM1Qix1QkFBdUI7SUFDdkIsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUE7SUFFOUIsSUFBSSxVQUFVLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQztRQUMvQixNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsRUFBRSwrQkFBK0IsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUV0SCxtQkFBbUIsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQyxDQUFBO0lBQzNGLENBQUM7SUFFRCxLQUFLLE1BQU0sVUFBVSxJQUFJLFVBQVUsQ0FBQyxjQUFjLEVBQUUsRUFBRSxDQUFDO1FBQ3JELE1BQU0sYUFBYSxHQUFHLHlCQUF5QixDQUFDLFVBQVUsQ0FBQyxJQUFJLFVBQVUsQ0FBQTtRQUN6RSxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsbUJBQW1CLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFN0QsSUFBSSxpQ0FBaUMsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUM5RyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDekMsQ0FBQztRQUNELElBQUksVUFBVSxJQUFJLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDbEQsaUJBQWlCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQ3ZDLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxFQUFDLGlCQUFpQixFQUFFLG1CQUFtQixFQUFDLENBQUE7QUFDakQsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxvQkFBb0IsQ0FBQyxPQUFPLEVBQUUsUUFBUTtJQUM3QyxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7QUFDL0QsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxlQUFlLENBQUMsS0FBSztJQUM1QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUVwRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxlQUFlLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFNBQVMsRUFBQztJQUN4RCxPQUFPLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUUsRUFBRSxFQUFFO1FBQ3JDLE1BQU0sY0FBYyxHQUFHLHlCQUF5QixDQUFDO1lBQy9DLE9BQU8sRUFBRSxjQUFjO1lBQ3ZCLEtBQUssRUFBRSw2QkFBNkI7WUFDcEMsTUFBTSxFQUFFLE9BQU87U0FDaEIsQ0FBQyxDQUFBO1FBQ0YsTUFBTSxRQUFRLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsRUFBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFFckYsSUFBSSxDQUFDLFFBQVEsSUFBSSxPQUFPLFFBQVEsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDckQsTUFBTSxJQUFJLEtBQUssQ0FBQyxrRkFBa0YsSUFBSSw2Q0FBNkMsQ0FBQyxDQUFBO1FBQ3RKLENBQUM7UUFFRCxPQUFPLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFBO0lBQzlCLENBQUMsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxVQUFVLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUU7SUFDaEUsSUFBSSxNQUFNLEdBQUcsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBRTFELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNaLE1BQU0sR0FBRyxVQUFVLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDcEQsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUNyRCxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDckIsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFBO0FBQ2YsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLElBQUksQ0FBQyxLQUFLO0lBQzlCLE9BQU8sTUFBTSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQy9DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHtpc0Jvb2xlYW5Db2x1bW5UeXBlfSBmcm9tIFwiLi4vZGF0YWJhc2UvY29sdW1uLXR5cGVzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQge2NhcHR1cmVSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuXG5pbXBvcnQge3NlcmlhbGl6ZWRTY29wZUZyb21RdWVyeX0gZnJvbSBcIi4vcXVlcnktc2NvcGUuanNcIlxuaW1wb3J0IFN5bmNBcGlDbGllbnQgZnJvbSBcIi4vc3luYy1hcGktY2xpZW50LmpzXCJcbmltcG9ydCBTeW5jUmVhbHRpbWVCcmlkZ2UgZnJvbSBcIi4vc3luYy1yZWFsdGltZS1icmlkZ2UuanNcIlxuaW1wb3J0IFN5bmNTY29wZVN0b3JlIGZyb20gXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIlxuaW1wb3J0IHtjdXJyZW50U3luY0NsaWVudCwgc2V0Q3VycmVudFN5bmNDbGllbnR9IGZyb20gXCIuL3N5bmMtY2xpZW50LXJlZ2lzdHJ5LmpzXCJcblxubGV0IGNsaWVudENvdW50ZXIgPSAwXG5cbi8qKiBAdHlwZSB7e2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIn19ICovXG5jb25zdCBUUkFDS0VEX0NBTExCQUNLX05BTUVTID0ge2NyZWF0ZTogXCJhZnRlckNyZWF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwiLCB1cGRhdGU6IFwiYWZ0ZXJVcGRhdGVcIn1cblxuLyoqXG4gKiBPcGVyYXRpb25zIHRyYWNrZWQgYnkgZGVmYXVsdCBmb3IgbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYVxuICogYHRyYWNrYCBrZXk6IGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcXVldWUgYXV0b21hdGljYWxseS4gRGVzdHJveXMgYXJlIG5vdFxuICogdHJhY2tlZCBieSBkZWZhdWx0IGJlY2F1c2UgYSBsb2NhbCBkZXN0cm95IGlzIG9mdGVuIGNhY2hlIGV2aWN0aW9uIHJhdGhlclxuICogdGhhbiBhIHNlcnZlciBkZWxldGU7IG9wdCBpbiB3aXRoIGB0cmFjazogdHJ1ZWAgb3IgYW4gb3BlcmF0aW9ucyBsaXN0LlxuICogQHR5cGUge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSAqL1xuY29uc3QgREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlMgPSBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl1cblxuLyoqIEF0dHJpYnV0ZSBuYW1lcyB0cmVhdGVkIGFzIGNsaWVudC1sb2NhbCBzeW5jIGJvb2trZWVwaW5nIHdoZW4gZGVyaXZpbmcgbG9jYWxPbmx5QXR0cmlidXRlcy4gKi9cbmNvbnN0IExPQ0FMX0JPT0tLRUVQSU5HX0FUVFJJQlVURV9OQU1FUyA9IFtcImNyZWF0ZWRBdFwiLCBcInVwZGF0ZWRBdFwiLCBcImxhc3RTeW5jQ2hhbmdlQXRcIl1cblxuY29uc3QgU1lOQ19SRVFVRVNUX1JFU0VSVkVEX0tFWVMgPSBbXG4gIFwiYWZ0ZXJJZFwiLFxuICBcImFmdGVyU2VydmVyU2VxdWVuY2VcIixcbiAgXCJhZnRlclVwZGF0ZWRBdFwiLFxuICBcImF1dGhlbnRpY2F0aW9uVG9rZW5cIixcbiAgXCJsaW1pdFwiLFxuICBcInNjb3BlXCIsXG4gIFwic3luY3NcIixcbiAgXCJ1cHN0cmVhbVJlZnJlc2hcIixcbiAgXCJ1cFRvSWRcIixcbiAgXCJ1cFRvU2VydmVyU2VxdWVuY2VcIixcbiAgXCJ1cFRvVXBkYXRlZEF0XCJcbl1cblxuLyoqIEB0eXBlIHtXZWFrTWFwPENvbmZpZ3VyYXRpb24sIFN5bmNDbGllbnQ+fSAqL1xuY29uc3Qgc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBFeHBlY3RlZCBjb29wZXJhdGl2ZSBjYW5jZWxsYXRpb24gcmFpc2VkIGJ5IGEgU3luY0NsaWVudCBsaWZlY3ljbGUgdHJhbnNpdGlvbi4gKi9cbmV4cG9ydCBjbGFzcyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhbiBleHBlY3RlZCBsaWZlY3ljbGUgY2FuY2VsbGF0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gcmVhc29uLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gXCJTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvclwiXG4gIH1cbn1cblxuLyoqXG4gKiBEZWNsYXJhdGl2ZSBjbGllbnQtc2lkZSBzeW5jIGRyaXZlci5cbiAqXG4gKiBFdmVyeXRoaW5nIGlzIGRlcml2ZWQgZnJvbSB0aGUgYXBwJ3MgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb246IG1vZGVscyBkZWNsYXJlXG4gKiBgc3RhdGljIHN5bmNgLCB0cmFuc3BvcnQvYXV0aC9jb25uZWN0aXZpdHkgY29tZSBmcm9tIHRoZSBgc3luYy5jbGllbnRgXG4gKiBjb25maWd1cmF0aW9uIGJsb2NrLCBhbmQgVmVsb2Npb3VzIG93bnMgc2NvcGUgcGVyc2lzdGVuY2UsIHBlci1zY29wZSBjdXJzb3JzLFxuICogcHVsbCBwYWdpbmcvYXBwbHksIGxvY2FsIHF1ZXVlaW5nLCBhbmQgb25saW5lLWdhdGVkIHJlcGxheS4gRGVjbGFyZSBzeW5jXG4gKiBpbnRlcmVzdCBmcm9tIHF1ZXJpZXM6XG4gKlxuICogICAgIGF3YWl0IHN5bmNDbGllbnQoKS5zdGFydCgpXG4gKiAgICAgYXdhaXQgc3luY0NsaWVudCgpLnN5bmMoRXZlbnQud2hlcmUoe3BhcnRuZXJJZH0pKVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jQ2xpZW50IHtcbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3luYyBjbGllbnQgYnkgZGVyaXZpbmcgZXZlcnl0aGluZyBmcm9tIHRoZSBhcHAncyBWZWxvY2lvdXNcbiAgICogY29uZmlndXJhdGlvbjogZXZlcnkgcmVnaXN0ZXJlZCBtb2RlbCBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCBiZWNvbWVzIGFcbiAgICogcmVzb3VyY2Ugd2l0aCBib29sZWFuQXR0cmlidXRlcyBkZXJpdmVkIGZyb20gY29sdW1uIHR5cGVzIGFuZFxuICAgKiBsb2NhbE9ubHlBdHRyaWJ1dGVzIGRlcml2ZWQgZnJvbSB0aGUgcHJpbWFyeSBrZXksIGNyZWF0ZWRBdC91cGRhdGVkQXQsIGFuZFxuICAgKiBzeW5jIGJvb2trZWVwaW5nIGNvbHVtbnM7IHRoZSBwZW5kaW5nLXN5bmMgbW9kZWwgaXMgdGhlIHJlZ2lzdGVyZWQgXCJTeW5jXCJcbiAgICogbW9kZWw7IHRyYW5zcG9ydCwgYXV0aCwgY29ubmVjdGl2aXR5LCBhbmQgZXJyb3IgcmVwb3J0aW5nIGNvbWUgZnJvbSB0aGVcbiAgICogYHN5bmMuY2xpZW50YCBjb25maWd1cmF0aW9uIGJsb2NrLCB3aXRoIHRoZSBmcmFtZXdvcmsgb3duaW5nIHRoZVxuICAgKiBgJHttb3VudFBhdGh9L2NoYW5nZXNgIGFuZCBgJHttb3VudFBhdGh9L3JlcGxheWAgUE9TVGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRPcHRpb25zfSBbb3B0aW9uc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpLCBkYXRhYmFzZUlkZW50aWZpZXIsIGxlZ2FjeUN1cnNvciwgcmVxdWVzdENvbnRleHQsIHNjb3BlU3RvcmUsIHN5bmNNb2RlbCwgdGVuYW50SGFuZGxlLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuXG4gICAgY29uc3QgY2xpZW50Q29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5jbGllbnRcbiAgICBjb25zdCBjYXB0dXJlZFJlcXVlc3RDb250ZXh0ID0gY2FwdHVyZVJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCB7XG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHJlc2VydmVkS2V5czogU1lOQ19SRVFVRVNUX1JFU0VSVkVEX0tFWVNcbiAgICB9KVxuXG4gICAgaWYgKCFjbGllbnRDb25maWd1cmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlcXVpcmVzIGEgc3luYy5jbGllbnQgY29uZmlndXJhdGlvbiBibG9jazogbmV3IENvbmZpZ3VyYXRpb24oe3N5bmM6IHtjbGllbnQ6IHthdXRoZW50aWNhdGlvblRva2VuLCB0cmFuc3BvcnR9fX0pXCIpXG4gICAgfVxuXG4gICAgaWYgKEJvb2xlYW4odGVuYW50SGFuZGxlKSAhPT0gQm9vbGVhbihkYXRhYmFzZUlkZW50aWZpZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudEhhbmRsZSBhbmQgZGF0YWJhc2VJZGVudGlmaWVyIG11c3QgYmUgcHJvdmlkZWQgdG9nZXRoZXJcIilcbiAgICB9XG4gICAgaWYgKHRlbmFudEhhbmRsZSkge1xuICAgICAgdGVuYW50SGFuZGxlLmFzc2VydENvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbilcbiAgICAgIHRlbmFudEhhbmRsZS5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCByZXNvbHZlZFN5bmNNb2RlbCA9IHN5bmNNb2RlbCB8fCBtb2RlbENsYXNzZXMuU3luY1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSB0ZW5hbnRIYW5kbGUgPyB0ZW5hbnRIYW5kbGUuZGF0YWJhc2VJZGVudGl0eSgvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcikpIDogbnVsbFxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWc+fSAqL1xuICAgIGNvbnN0IHJlc291cmNlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsQ2xhc3Mgb2YgT2JqZWN0LnZhbHVlcyhtb2RlbENsYXNzZXMpKSB7XG4gICAgICBpZiAoIW1vZGVsQ2xhc3Muc3luYykgY29udGludWVcbiAgICAgIGlmICh0ZW5hbnRIYW5kbGUgJiYgbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGVuYW50SGFuZGxlLnRlbmFudCgpfSkgIT09IGRhdGFiYXNlSWRlbnRpZmllcikgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICBjb25zdCBtZXRhZGF0YU1vZGVsQ2xhc3MgPSB0ZW5hbnRIYW5kbGVcbiAgICAgICAgPyB0ZW5hbnRIYW5kbGUubWV0YWRhdGFNb2RlbENsYXNzKHtkYXRhYmFzZUlkZW50aWZpZXI6IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSwgbW9kZWxDbGFzc30pXG4gICAgICAgIDogbW9kZWxDbGFzc1xuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSByZXNvdXJjZUNvbmZpZ0Zyb21TeW5jRGVjbGFyYXRpb24oe2RlY2xhcmF0aW9uOiBtb2RlbENsYXNzLnN5bmMsIG1ldGFkYXRhTW9kZWxDbGFzcywgbW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSlcblxuICAgICAgaWYgKGRhdGFiYXNlSWRlbnRpdHkgJiYgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nID0ge1xuICAgICAgICAgIC4uLnJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgbXV0YXRpb25Mb2c6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucGFydGl0aW9uKGRhdGFiYXNlSWRlbnRpdHkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gPSByZXNvdXJjZUNvbmZpZ1xuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhyZXNvdXJjZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBmb3VuZCBubyByZWdpc3RlcmVkIG1vZGVscyBkZWNsYXJpbmcgc3RhdGljIHN5bmMgLSBkZWNsYXJlIGBzdGF0aWMgc3luYyA9IHRydWVgIChvciBhIHN5bmMgZGVjbGFyYXRpb24gb2JqZWN0KSBvbiB0aGUgbW9kZWxzIHRoYXQgc2hvdWxkIHN5bmNcIilcbiAgICB9XG5cbiAgICBpZiAoIXJlc29sdmVkU3luY01vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlcXVpcmVzIGEgcmVnaXN0ZXJlZCBcXFwiU3luY1xcXCIgbW9kZWwgZm9yIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIChvciBwYXNzIG9wdGlvbnMuc3luY01vZGVsKVwiKVxuICAgIH1cbiAgICBpZiAodGVuYW50SGFuZGxlICYmIHJlc29sdmVkU3luY01vZGVsLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0ZW5hbnRIYW5kbGUudGVuYW50KCl9KSAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDbGllbnQgc3luYyBtb2RlbCBkb2VzIG5vdCB1c2UgdGVuYW50IGRhdGFiYXNlICR7SlNPTi5zdHJpbmdpZnkoZGF0YWJhc2VJZGVudGlmaWVyKX1gKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmlnfSAqL1xuICAgIHRoaXMuY29uZmlnID0ge1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogY2xpZW50Q29uZmlndXJhdGlvbi5hdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplOiBjbGllbnRDb25maWd1cmF0aW9uLmJhdGNoU2l6ZSxcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBpc09ubGluZTogY2xpZW50Q29uZmlndXJhdGlvbi5pc09ubGluZSxcbiAgICAgIGxlZ2FjeUN1cnNvcixcbiAgICAgIG9uRXJyb3I6IGNsaWVudENvbmZpZ3VyYXRpb24ub25FcnJvcixcbiAgICAgIHBvc3RDaGFuZ2VzOiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9jaGFuZ2VzYCwgcmVxdWVzdENvbnRleHQ6IGNhcHR1cmVkUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogY2xpZW50Q29uZmlndXJhdGlvbi50cmFuc3BvcnR9KSxcbiAgICAgIHBvc3RSZXBsYXk6IHRyYW5zcG9ydFBvc3Rlcih7cGF0aDogYCR7Y2xpZW50Q29uZmlndXJhdGlvbi5tb3VudFBhdGh9L3JlcGxheWAsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICByZWFsdGltZTogY2xpZW50Q29uZmlndXJhdGlvbi5yZWFsdGltZSxcbiAgICAgIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LFxuICAgICAgcmVzb3VyY2VzLFxuICAgICAgc3luY01vZGVsOiByZXNvbHZlZFN5bmNNb2RlbCxcbiAgICAgIHRlbmFudEhhbmRsZSxcbiAgICAgIHdlYnNvY2tldENsaWVudDogY2xpZW50Q29uZmlndXJhdGlvbi53ZWJzb2NrZXRDbGllbnQsXG4gICAgICB3ZWJzb2NrZXRVcmw6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0VXJsXG4gICAgfVxuICAgIHRoaXMuX2NsaWVudE51bWJlciA9ICsrY2xpZW50Q291bnRlclxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgPSBkYXRhYmFzZUlkZW50aXR5XG4gICAgdGhpcy5fdGVuYW50U2NoZW1hR2VuZXJhdGlvbiA9IHRlbmFudEhhbmRsZVxuICAgICAgPyB0ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcil9KS5zY2hlbWFHZW5lcmF0aW9uXG4gICAgICA6IG51bGxcbiAgICAvKiogQHR5cGUge1N5bmNSZWFsdGltZUJyaWRnZSB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhbHRpbWVCcmlkZ2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTaGFyZWRDb25uZWN0aW9uIHwgbnVsbCB8IHVuZGVmaW5lZH0gU2hhcmVkIGFwcC1saWZldGltZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiAodW5kZWZpbmVkIHVudGlsIGZpcnN0IHJlc29sdmVkLCBudWxsIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkKS4gKi9cbiAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1wic3Vic2NyaWJlZFwiIHwgXCJzdWJzY3JpYmluZ1wiIHwgXCJ1bnN1YnNjcmliZWRcIn0gKi9cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zY29wZVN0b3JlID0gc2NvcGVTdG9yZSB8fCBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zY2hlZHVsZWRSZXBsYXkgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2NhbGxiYWNrOiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQsIGNhbGxiYWNrTmFtZTogXCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8b2JqZWN0Pn0gKi9cbiAgICB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPG9iamVjdCwgQXJyYXk8c3RyaW5nIHwgbnVtYmVyIHwgbnVsbD4+fSAqL1xuICAgIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoID0gMFxuICAgIC8qKiBAdHlwZSB7TG9nZ2VyIHwge2Vycm9yOiAoLi4ubWVzc2FnZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn0gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvZ2dlciA9IG51bGxcbiAgICAvKiogQHR5cGUge1NldDxQcm9taXNlPHVua25vd24+Pn0gKi9cbiAgICB0aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrID0gbmV3IFNldCgpXG4gICAgdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpXG4gICAgdGhpcy5fbGlmZWN5Y2xlR2VuZXJhdGlvbiA9IDBcbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgPSAwXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Qcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYXV0b21hdGljIG11dGF0aW9uIHRyYWNraW5nIGZvciBldmVyeSBkZWNsYXJlZCByZXNvdXJjZSAob24gYnlcbiAgICogZGVmYXVsdDogbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBxdWV1ZSBwZW5kaW5nIHN5bmMgcm93cyBvbmNlIHRoZWlyXG4gICAqIHRyYW5zYWN0aW9uIGNvbW1pdHMgYW5kIHNjaGVkdWxlIGFuIGltbWVkaWF0ZSByZXBsYXkgYXR0ZW1wdCwgd2l0aG91dFxuICAgKiBhcHAtc2lkZSBxdWV1ZSBjYWxscykuIGB0cmFjazogZmFsc2VgIHJlc291cmNlcyBhcmUgc2tpcHBlZDsgYHRyYWNrOiB0cnVlYFxuICAgKiBhZGRzIGRlc3Ryb3lzOyBhbiBvcGVyYXRpb25zIGxpc3QgbmFycm93cyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIGF3YWl0IHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Qcm9taXNlXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgaWYgKHRoaXMuX3N0YXJ0ZWQpIHJldHVyblxuXG4gICAgdGhpcy5fc3RhcnRlZCA9IHRydWVcblxuICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgcmVzb3VyY2VDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgIGNvbnN0IG9wZXJhdGlvbnMgPSB0aGlzLnRyYWNrZWRPcGVyYXRpb25zKHtyZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlfSlcblxuICAgICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2Ygb3BlcmF0aW9ucy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBcImNyZWF0ZVwiKSkge1xuICAgICAgICAgIGNvbnN0IGNhbGxiYWNrTmFtZSA9IG9wZXJhdGlvbiA9PT0gXCJkZXN0cm95XCIgPyBcImJlZm9yZURlc3Ryb3lcIiA6IFwiYmVmb3JlVXBkYXRlXCJcbiAgICAgICAgICBjb25zdCBjYWxsYmFjayA9ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyByZWNvcmQpID0+IHtcbiAgICAgICAgICAgIGlmICghdGhpcy5vd25zUmVjb3JkKHJlY29yZCkpIHJldHVyblxuICAgICAgICAgICAgaWYgKHRoaXMuaXNUcmFja2luZ1N1cHByZXNzZWQocmVjb3JkKSkgcmV0dXJuXG5cbiAgICAgICAgICAgIGNvbnN0IGNhcHR1cmVkVmVyc2lvbnMgPSB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5nZXQocmVjb3JkKSB8fCBbXVxuXG4gICAgICAgICAgICBjYXB0dXJlZFZlcnNpb25zLnB1c2godGhpcy5wcmVNdXRhdGlvbkJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSlcbiAgICAgICAgICAgIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLnNldChyZWNvcmQsIGNhcHR1cmVkVmVyc2lvbnMpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc1tjYWxsYmFja05hbWVdKGNhbGxiYWNrKVxuICAgICAgICAgIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MucHVzaCh7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzczogcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc30pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2Ygb3BlcmF0aW9ucykge1xuICAgICAgICBjb25zdCBjYWxsYmFja05hbWUgPSBUUkFDS0VEX0NBTExCQUNLX05BTUVTW29wZXJhdGlvbl1cbiAgICAgICAgY29uc3QgY2FsbGJhY2sgPSB0aGlzLnRyYWNrZWRNdXRhdGlvbkNhbGxiYWNrKHtvcGVyYXRpb24sIHJlc291cmNlQ29uZmlnfSlcblxuICAgICAgICByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzW2NhbGxiYWNrTmFtZV0oY2FsbGJhY2spXG4gICAgICAgIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MucHVzaCh7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzczogcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc30pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFsbCB0cmFja2luZyBjYWxsYmFja3MsIGFib3J0cyBpbi1mbGlnaHQgcHVsbC9yZXBsYXkvcmVhbHRpbWVcbiAgICogd29yayBhbmQgcmVzb2x2ZXMgYWZ0ZXIgaXQgaXMgcXVpZXNjZW50LiBPcHRpb25hbCBzZWxlY3RlZCBzY29wZSByZXNldCBhbmRcbiAgICogYXBwLW93bmVkIGNsZWFudXAgaGFwcGVuIGFmdGVyIG9sZCB3b3JrIGRyYWlucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTdG9wT3B0aW9uc30gW29wdGlvbnNdIC0gU3RvcCBhbmQgc2VsZWN0ZWQtc2NvcGUgcmVzZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdG9wKG9wdGlvbnMgPSB7fSkge1xuICAgIGZvciAoY29uc3Qge2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3N9IG9mIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MpIHtcbiAgICAgIG1vZGVsQ2xhc3MudW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcyA9IFtdXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5fcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZShvcHRpb25zKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQWJvcnRzIGFuZCBkcmFpbnMgY3VycmVudCB3b3JrLCB0aGVuIGF0b21pY2FsbHkgcmVzZXRzIHNlbGVjdGVkIHNjb3BlXG4gICAqIGN1cnNvcnMgdG9nZXRoZXIgd2l0aCBhbiBvcHRpb25hbCBhcHAtb3duZWQgbG9jYWwtcm93IGNsZWFudXAgaG9vay5cbiAgICogVHJhY2tpbmcgZGVjbGFyYXRpb25zIHJlbWFpbiByZWdpc3RlcmVkIHNvIHRoZSBzYW1lIGNsaWVudCBtYXkgY29udGludWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlW119IHNjb3BlcyAtIFNlbGVjdGVkIHNjb3BlcyB0byByZXNldC5cbiAgICogQHBhcmFtIHt7Y2xlYW51cD86IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFNjb3BlQ2xlYW51cH19IFtvcHRpb25zXSAtIFNjb3BlIGNsZWFudXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXNldFNjb3BlcyhzY29wZXMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcmVzZXRTY29wZXNGb3JMaWZlY3ljbGUoey4uLm9wdGlvbnMsIHJlc2V0U2NvcGVzOiBzY29wZXN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGUgZXh0ZXJuYWwgaWRlbnRpdHkgcmVhZCBieSB0aGUgY29uZmlndXJlZCBhdXRoIGFuZFxuICAgKiBzY29wZS1vd25lciByZXNvbHZlcnM6IG9sZCB3b3JrIGlzIGFib3J0ZWQgYW5kIGRyYWluZWQsIHNlbGVjdGVkIHByaXZhdGVcbiAgICogc2NvcGUgc3RhdGUvY2FjaGUgaXMgcmVzZXQsIHRoZW4gdGhlIGFwcCdzIHJlcGxhY2VtZW50IGNhbGxiYWNrIHJ1bnMgd2hpbGVcbiAgICogbmV3IHN5bmMgd29yayByZW1haW5zIGJlaGluZCB0aGUgbGlmZWN5Y2xlIGJhcnJpZXIuIE9wdGlvbmFsbHkgc3Vic2NyaWJlc1xuICAgKiB0aGUgbmV3IHVzZXIgc2NvcGUgYmVmb3JlIHJlc29sdmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXBsYWNlSWRlbnRpdHlPcHRpb25zfSBvcHRpb25zIC0gSWRlbnRpdHkgcmVwbGFjZW1lbnQgY29udHJhY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZUlkZW50aXR5KG9wdGlvbnMpIHtcbiAgICBpZiAoIW9wdGlvbnMgfHwgdHlwZW9mIG9wdGlvbnMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudC5yZXBsYWNlSWRlbnRpdHkgcmVxdWlyZXMgYW4gb3B0aW9ucyBvYmplY3RcIilcbiAgICB9XG5cbiAgICBjb25zdCB7Y2xlYW51cCwgcmVwbGFjZSwgcmVzZXRTY29wZXMgPSBbXSwgc3Vic2NyaWJlVXNlclNjb3BlID0gZmFsc2UsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG4gICAgaWYgKHR5cGVvZiByZXBsYWNlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQucmVwbGFjZUlkZW50aXR5IHJlcXVpcmVzIGEgcmVwbGFjZSBjYWxsYmFja1wiKVxuICAgIGlmICh0eXBlb2Ygc3Vic2NyaWJlVXNlclNjb3BlICE9PSBcImJvb2xlYW5cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudC5yZXBsYWNlSWRlbnRpdHkgc3Vic2NyaWJlVXNlclNjb3BlIG11c3QgYmUgYm9vbGVhblwiKVxuXG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZSh7Y2xlYW51cCwgcmVzZXRTY29wZXN9KVxuICAgICAgYXdhaXQgcmVwbGFjZSgpXG4gICAgfSlcblxuICAgIGlmIChzdWJzY3JpYmVVc2VyU2NvcGUpIGF3YWl0IHRoaXMuc3Vic2NyaWJlVXNlclNjb3BlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBjYWxsYmFjayB3aGlsZSBob2xkaW5nIHRoZSBjdXJyZW50IGxpZmVjeWNsZSBnZW5lcmF0aW9uIGFuZFxuICAgKiB0cmFja3MgaXQgc28gc3RvcC9yZXNldC9pZGVudGl0eSByZXBsYWNlbWVudCBjYW4gYXdhaXQgcXVpZXNjZW5jZS5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0geyhzaWduYWw6IEFib3J0U2lnbmFsKSA9PiBQcm9taXNlPFJlc3VsdD59IGNhbGxiYWNrIC0gR2VuZXJhdGlvbi1ib3VuZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuTGlmZWN5Y2xlV29yayhjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgPiAwKSBhd2FpdCB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZVxuXG4gICAgY29uc3Qgc2lnbmFsID0gdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyLnNpZ25hbFxuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IGNhbGxiYWNrKHNpZ25hbClcblxuICAgIHRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmsuYWRkKHByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fYWN0aXZlTGlmZWN5Y2xlV29yay5kZWxldGUocHJvbWlzZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtdXRhdGlvbiBxdWV1ZWluZyBvbmx5IHdoaWxlIHRoZSBsaWZlY3ljbGUgZ2VuZXJhdGlvbiBjYXB0dXJlZCBieSB0aGVcbiAgICogY2FsbGVyIHJlbWFpbnMgYWN0aXZlLiBVbmxpa2UgcHVsbHMsIGEgbXV0YXRpb24gbXVzdCBuZXZlciB3YWl0IHRocm91Z2ggYW5cbiAgICogaWRlbnRpdHkgdHJhbnNpdGlvbiBhbmQgdGhlbiBwZXJzaXN0IHVuZGVyIHRoZSByZXBsYWNlbWVudCBpZGVudGl0eS5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge251bWJlcn0gbGlmZWN5Y2xlR2VuZXJhdGlvbiAtIEdlbmVyYXRpb24gb3duaW5nIHRoZSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJlc3VsdD59IGNhbGxiYWNrIC0gTXV0YXRpb24gcXVldWVpbmcgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1bk11dGF0aW9uTGlmZWN5Y2xlV29yayhsaWZlY3ljbGVHZW5lcmF0aW9uLCBjYWxsYmFjaykge1xuICAgIHRoaXMuX2Fzc2VydE11dGF0aW9uTGlmZWN5Y2xlR2VuZXJhdGlvbihsaWZlY3ljbGVHZW5lcmF0aW9uKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5fYXNzZXJ0TXV0YXRpb25MaWZlY3ljbGVHZW5lcmF0aW9uKGxpZmVjeWNsZUdlbmVyYXRpb24pXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIG11dGF0aW9uIHF1ZXVlaW5nIGNhcHR1cmVkIG91dHNpZGUgdGhlIGN1cnJlbnQgc3RhYmxlIGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGxpZmVjeWNsZUdlbmVyYXRpb24gLSBHZW5lcmF0aW9uIG93bmluZyB0aGUgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2VydE11dGF0aW9uTGlmZWN5Y2xlR2VuZXJhdGlvbihsaWZlY3ljbGVHZW5lcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCA9PT0gMCAmJiBsaWZlY3ljbGVHZW5lcmF0aW9uID09PSB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgbXV0YXRpb24gYmVsb25ncyB0byBhbiBpbmFjdGl2ZSBsaWZlY3ljbGUgZ2VuZXJhdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYSBsaWZlY3ljbGUgYmFycmllcjogY29vcGVyYXRpdmVseSBhYm9ydHMgdHJhbnNwb3J0L3N0YXJ0IHdvcmssXG4gICAqIHN0b3BzIG5ldyByZWFsdGltZSBkZWxpdmVyeSwgYXdhaXRzIG9sZCBhcHBsaWVzL3JlcGxheXMvcHVsbHMsIHJlamVjdHMgb25cbiAgICogdW5leHBlY3RlZCBvbGQtd29yayBmYWlsdXJlcywgdGhlbiBydW5zIHRoZSByZXNldC9yZXBsYWNlbWVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFRyYW5zaXRpb24gYWN0aW9uIGFmdGVyIHF1aWVzY2VuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oY2FsbGJhY2spIHtcbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgKz0gMVxuXG4gICAgLy8gdW5zdWJzY3JpYmUoKSBpbnZhbGlkYXRlcyB0aGUgc3Vic2NyaXB0aW9uIGdlbmVyYXRpb24gc3luY2hyb25vdXNseSwgc29cbiAgICAvLyBhbiBvbGQgb25SZXN1bWUvb25NZXNzYWdlIGNhbGxiYWNrIGNhbm5vdCBlbnRlciB0aGlzIHRyYW5zaXRpb24ncyBkcmFpbi5cbiAgICBjb25zdCByZWFsdGltZVVuc3Vic2NyaWJlUHJvbWlzZSA9IHRoaXMuX3JlYWx0aW1lQnJpZGdlPy51bnN1YnNjcmliZSgpXG4gICAgY29uc3QgcHJldmlvdXNUcmFuc2l0aW9uID0gdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2VcbiAgICBjb25zdCB0cmFuc2l0aW9uID0gcHJldmlvdXNUcmFuc2l0aW9uLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWJvcnRDb250cm9sbGVyID0gdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyXG4gICAgICBjb25zdCBhYm9ydFJlYXNvbiA9IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSB3YXMgc3RvcHBlZFwiKVxuXG4gICAgICBhYm9ydENvbnRyb2xsZXIuYWJvcnQoYWJvcnRSZWFzb24pXG5cbiAgICAgIGlmIChyZWFsdGltZVVuc3Vic2NyaWJlUHJvbWlzZSkgYXdhaXQgcmVhbHRpbWVVbnN1YnNjcmliZVByb21pc2VcblxuICAgICAgY29uc3Qgd29ya1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmtdKVxuXG4gICAgICBpZiAodGhpcy5fcmVhbHRpbWVCcmlkZ2UpIGF3YWl0IHRoaXMuX3JlYWx0aW1lQnJpZGdlLndhaXRGb3JBcHBsaWVkKClcblxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCB1bmV4cGVjdGVkRXJyb3JzID0gW11cblxuICAgICAgZm9yIChjb25zdCByZXN1bHQgb2Ygd29ya1Jlc3VsdHMpIHtcbiAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIiAmJiAhdGhpcy5pc0xpZmVjeWNsZUFib3J0KHJlc3VsdC5yZWFzb24pKSB1bmV4cGVjdGVkRXJyb3JzLnB1c2gocmVzdWx0LnJlYXNvbilcbiAgICAgIH1cblxuICAgICAgaWYgKHVuZXhwZWN0ZWRFcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyB1bmV4cGVjdGVkRXJyb3JzWzBdXG4gICAgICBpZiAodW5leHBlY3RlZEVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IodW5leHBlY3RlZEVycm9ycywgXCJTeW5jIGNsaWVudCBsaWZlY3ljbGUgZmFpbGVkIHdoaWxlIGJlY29taW5nIHF1aWVzY2VudFwiKVxuXG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAgIHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb24gKz0gMVxuICAgICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvbkNvdW50IC09IDFcbiAgICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICB9KVxuXG4gICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2UgPSB0cmFuc2l0aW9uLnRoZW4oKCkgPT4gdW5kZWZpbmVkLCAoKSA9PiB1bmRlZmluZWQpXG5cbiAgICByZXR1cm4gdHJhbnNpdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0cyBzZWxlY3RlZCBzY29wZXMgdGhyb3VnaCB0aGUgZnJhbWV3b3JrLW93bmVkIHN0b3JlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFN0b3BPcHRpb25zfSBvcHRpb25zIC0gUmVzZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcmVzZXRTY29wZXNGb3JMaWZlY3ljbGUob3B0aW9ucykge1xuICAgIGNvbnN0IHtjbGVhbnVwLCByZXNldFNjb3BlcyA9IFtdLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNldFNjb3BlcykpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IHJlc2V0U2NvcGVzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICBpZiAoY2xlYW51cCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBjbGVhbnVwICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IGNsZWFudXAgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgaWYgKGNsZWFudXAgJiYgcmVzZXRTY29wZXMubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNsaWVudCBjbGVhbnVwIHJlcXVpcmVzIGF0IGxlYXN0IG9uZSByZXNldCBzY29wZVwiKVxuICAgIGlmIChyZXNldFNjb3Blcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkucmVzZXQocmVzZXRTY29wZXMsIHtjbGVhbnVwfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGVycm9yIGlzIHRoZSBmcmFtZXdvcmsncyBuYXJyb3cgZXhwZWN0ZWQgbGlmZWN5Y2xlIGFib3J0LlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2FuZGlkYXRlIGVycm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgZXJyb3IgaXMgYW4gZXhwZWN0ZWQgbGlmZWN5Y2xlIGFib3J0LlxuICAgKi9cbiAgaXNMaWZlY3ljbGVBYm9ydChlcnJvcikge1xuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yXG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIHRoZSBjdXJyZW50IGxpZmVjeWNsZSByZWFzb24gd2hlbiB0aGUgc2lnbmFsIGlzIGFib3J0ZWQuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IHNpZ25hbCAtIExpZmVjeWNsZSBzaWduYWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbCkge1xuICAgIGlmICghc2lnbmFsLmFib3J0ZWQpIHJldHVyblxuXG4gICAgdGhyb3cgc2lnbmFsLnJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gc2lnbmFsLnJlYXNvbiA6IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSB3YXMgc3RvcHBlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCB2YWxpZGF0ZXMgdGhlIHRyYWNrZWQgb3BlcmF0aW9ucyBmb3IgYSByZXNvdXJjZSBjb25maWcuXG4gICAqIFRyYWNraW5nIGlzIG9uIGJ5IGRlZmF1bHQ6IG1vZGVscyBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCB3aXRob3V0IGEgYHRyYWNrYFxuICAgKiBrZXkgcXVldWUgbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBhdXRvbWF0aWNhbGx5OyBgdHJhY2s6IGZhbHNlYCBvcHRzIGFcbiAgICogbW9kZWwgb3V0IChmb3IgbW9kZWxzIHdyaXR0ZW4gYnkgbm9uLXVzZXIgZmxvd3MpLlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIFJlc291cmNlIGNvbmZpZyBhbmQgbmFtZS5cbiAgICogQHJldHVybnMge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSBUcmFja2VkIG9wZXJhdGlvbnMuXG4gICAqL1xuICB0cmFja2VkT3BlcmF0aW9ucyh7cmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZX0pIHtcbiAgICBjb25zdCB0cmFjayA9IHJlc291cmNlQ29uZmlnLnRyYWNrXG5cbiAgICBpZiAodHJhY2sgPT09IGZhbHNlKSByZXR1cm4gW11cbiAgICBpZiAodHJhY2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIERFRkFVTFRfVFJBQ0tFRF9PUEVSQVRJT05TXG4gICAgaWYgKHRyYWNrID09PSB0cnVlKSByZXR1cm4gW1wiY3JlYXRlXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXVxuXG4gICAgaWYgKCF0cmFjayB8fCB0eXBlb2YgdHJhY2sgIT09IFwib2JqZWN0XCIgfHwgIUFycmF5LmlzQXJyYXkodHJhY2sub3BlcmF0aW9ucykgfHwgdHJhY2sub3BlcmF0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCByZXNvdXJjZSAke3Jlc291cmNlVHlwZX0gdHJhY2sgbXVzdCBiZSB0cnVlIG9yIHtvcGVyYXRpb25zOiBbLi4uXX1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIHRyYWNrLm9wZXJhdGlvbnMpIHtcbiAgICAgIGlmICghKG9wZXJhdGlvbiBpbiBUUkFDS0VEX0NBTExCQUNLX05BTUVTKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDbGllbnQgcmVzb3VyY2UgJHtyZXNvdXJjZVR5cGV9IHRyYWNrLm9wZXJhdGlvbnMgbXVzdCBiZSBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3ksIGdvdDogJHtTdHJpbmcob3BlcmF0aW9uKX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cmFjay5vcGVyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsaWZlY3ljbGUgY2FsbGJhY2sgcXVldWVpbmcgb25lIHRyYWNrZWQgbXV0YXRpb24uIFRoZSBxdWV1ZWRcbiAgICogcGF5bG9hZCBhbmQgc3luYyB0eXBlIGFyZSBzbmFwc2hvdHRlZCBhdCBtdXRhdGlvbi1jYWxsYmFjayB0aW1lLCBzb1xuICAgKiBhZnRlclNhdmUgaG9va3MgYXNzaWduaW5nIHVuc2F2ZWQgYXR0cmlidXRlcyAob3IgYW55IGxhdGVyIGRyaWZ0IG9uIHRoZVxuICAgKiByZWNvcmQpIGNhbm5vdCBjaGFuZ2Ugd2hhdCBnZXRzIHF1ZXVlZCB2cyB3aGF0IHdhcyBjb21taXR0ZWQuIFF1ZXVlaW5nIGlzXG4gICAqIGRlZmVycmVkIHRocm91Z2ggdGhlIG1vZGVsIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIGl0IG9ubHkgcnVuc1xuICAgKiBvbmNlIHRoZSBtdXRhdGlvbidzIHRyYW5zYWN0aW9uIGhhcyBjb21taXR0ZWQgKGltbWVkaWF0ZWx5IHdoZW4gbm9cbiAgICogdHJhbnNhY3Rpb24gaXMgb3BlbikgLSBxdWV1ZWQgc3luY3MgbmV2ZXIgcmVmZXJlbmNlIHJvbGxlZC1iYWNrIHJvd3MuXG4gICAqIFBvc3QtY29tbWl0IHF1ZXVlIGZhaWx1cmVzIGFyZSByZXBvcnRlZCB3aXRob3V0IHJldGhyb3dpbmcgaW50byB0aGVcbiAgICogZHJpdmVyJ3MgYWZ0ZXJDb21taXQgY2hhaW4gKHNlZSByZXBvcnRBZnRlckNvbW1pdEVycm9yKS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gT3BlcmF0aW9uIGFuZCByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHsocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPn0gTGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKi9cbiAgdHJhY2tlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgcmV0dXJuIGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGlmICghdGhpcy5vd25zUmVjb3JkKHJlY29yZCkpIHJldHVyblxuICAgICAgaWYgKHRoaXMuaXNUcmFja2luZ1N1cHByZXNzZWQocmVjb3JkKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGxpZmVjeWNsZUdlbmVyYXRpb24gPSB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uXG4gICAgICBjb25zdCBkYXRhID0gU3luY0FwaUNsaWVudC5xdWV1ZWRTeW5jRGF0YSh7XG4gICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgZGF0YTogcmVzb3VyY2VDb25maWcudHJhY2tlZERhdGEgPyByZXNvdXJjZUNvbmZpZy50cmFja2VkRGF0YSh7b3BlcmF0aW9uLCByZWNvcmR9KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogcmVzb3VyY2VDb25maWcubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgcmVzb3VyY2U6IHJlY29yZFxuICAgICAgfSlcbiAgICAgIGNvbnN0IHN5bmNUeXBlID0gdGhpcy5kZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICBjb25zdCBiYXNlVmVyc2lvbiA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmdcbiAgICAgICAgPyB0aGlzLmNhcHR1cmVkQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICAgIDogbnVsbFxuICAgICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uU2NvcGUgPSBkYXRhYmFzZU9wZXJhdGlvblxuICAgICAgICA/IGRhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcbiAgICAgICAgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcblxuICAgICAgYXdhaXQgcmVjb3JkLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTXV0YXRpb25MaWZlY3ljbGVXb3JrKGxpZmVjeWNsZUdlbmVyYXRpb24sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgICAgICAgICBiYXNlVmVyc2lvbixcbiAgICAgICAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgICAgICAgIHJlc291cmNlOiByZWNvcmQsXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiByZWNvcmQuY29uc3RydWN0b3IuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgICAgICAgc3luY1R5cGVcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVMb2NhbFN5bmMoe2RhdGEsIHJlc291cmNlOiByZWNvcmQsIHN5bmNNb2RlbDogb3BlcmF0aW9uU2NvcGUsIHN5bmNUeXBlfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmICh0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpKSByZXR1cm5cblxuICAgICAgICAgIGF3YWl0IHRoaXMucmVwb3J0QWZ0ZXJDb21taXRFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnNjaGVkdWxlUmVwbGF5KClcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCB0cmFja2VkLXF1ZXVlaW5nIGZhaWx1cmUuIFRoZSB0cmFuc2FjdGlvbiBoYXMgYWxyZWFkeVxuICAgKiBjb21taXR0ZWQgd2hlbiBhZnRlckNvbW1pdCBjYWxsYmFja3MgcnVuLCBzbyByZXRocm93aW5nIGhlcmUgd291bGQgcG9pc29uXG4gICAqIHRoZSBkcml2ZXIncyBhd2FpdGVkIGFmdGVyQ29tbWl0IGNoYWluIChicmVha2luZyB1bnJlbGF0ZWQgY2FsbGJhY2tzKSAtXG4gICAqIGluc3RlYWQgdGhlIGZhaWx1cmUgZ29lcyB0byB0aGUgY29uZmlndXJlZCBzeW5jLmNsaWVudC5vbkVycm9yIGhvb2ssIG9yIGlzXG4gICAqIGxvZ2dlZCBsb3VkbHkgdGhyb3VnaCB0aGUgY2xpZW50J3MgbG9nZ2VyIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFBvc3QtY29tbWl0IHF1ZXVlaW5nIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlcigpLmVycm9yKFwiU3luY0NsaWVudCBmYWlsZWQgdG8gcXVldWUgYSB0cmFja2VkIG11dGF0aW9uIGFmdGVyIGNvbW1pdFwiLCBlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgY2xpZW50IGxvZ2dlci5cbiAgICogQHJldHVybnMge0xvZ2dlciB8IHtlcnJvcjogKC4uLm1lc3NhZ2VzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8dm9pZD59fSBDbGllbnQgbG9nZ2VyLlxuICAgKi9cbiAgbG9nZ2VyKCkge1xuICAgIHRoaXMuX2xvZ2dlciB8fD0gbmV3IExvZ2dlcihcIlN5bmNDbGllbnRcIiwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb259KVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvZ2dlclxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSByZWNvcmQgaXMgY3VycmVudGx5IGJlaW5nIHdyaXR0ZW4gYnkgcHVsbC1hcHBseSAoZWNobyBzdXBwcmVzc2lvbikuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHJlY29yZCB3cml0ZSBvcmlnaW5hdGVzIGZyb20gYSByZW1vdGUgY2hhbmdlLlxuICAgKi9cbiAgaXNSZW1vdGVBcHBseShyZWNvcmQpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmhhcyhyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0cmFja2VkIG11dGF0aW9uIHF1ZXVlaW5nIGlzIGN1cnJlbnRseSBzdXBwcmVzc2VkIGZvciBhIHJlY29yZDpcbiAgICogZWl0aGVyIHRoZSByZWNvcmQgd2FzIG1hcmtlZCBhcyBhIHJlbW90ZSBhcHBseSAoYG1hcmtSZW1vdGVBcHBseWAsIHVzZWQgYnlcbiAgICogcHVsbCBhbmQgcmVhbHRpbWUgYXBwbGllcykgb3IgYSBgd2l0aG91dFRyYWNraW5nYCBjYWxsYmFjayBpcyBydW5uaW5nIG9uXG4gICAqIHRoaXMgY2xpZW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRyYWNrZWQgcXVldWVpbmcgaXMgc3VwcHJlc3NlZCBmb3IgdGhlIHJlY29yZC5cbiAgICovXG4gIGlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkge1xuICAgIHJldHVybiB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aCA+IDAgfHwgdGhpcy5pc1JlbW90ZUFwcGx5KHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aCB0cmFja2VkIG11dGF0aW9uIHF1ZXVlaW5nIHN1cHByZXNzZWQgb24gdGhpcyBjbGllbnQgLVxuICAgKiBmb3IgY29kZSBhcHBseWluZyBzZXJ2ZXItb3JpZ2luYXRlZCBkYXRhIG91dHNpZGUgdGhlIGRlcml2ZWQgcHVsbC9yZWFsdGltZVxuICAgKiBhcHBsaWVycyAobGVnYWN5IHB1bGwgcGF0aHMsIGltcG9ydGVycywgc2lnbi1pbiBiYWNrZmlsbHMpLCBzbyB0aGVpciB3cml0ZXNcbiAgICogYXJlIG5vdCBlY2hvZWQgYmFjayB0byB0aGUgc2VydmVyIGFzIGRldmljZSBjaGFuZ2VzLiBTdXBwcmVzc2lvbiBjb3ZlcnMgdGhlXG4gICAqIHdob2xlIGFzeW5jIGR1cmF0aW9uIG9mIHRoZSBjYWxsYmFjayAobmVzdGVkIGNhbGxzIHN0YWNrKSBhbmQgaXNcbiAgICogY2xpZW50LXdpZGUgd2hpbGUgaXQgcnVuczogbXV0YXRpb25zIGZyb20gY29uY3VycmVudGx5IHJ1bm5pbmcgdGFza3MgYXJlXG4gICAqIGFsc28gc3VwcHJlc3NlZCBmb3IgdGhhdCB3aW5kb3csIHNvIHByZWZlciBgbWFya1JlbW90ZUFwcGx5KHJlY29yZClgIHdoZW5cbiAgICogd3JpdGVzIGZyb20gb3RoZXIgZmxvd3MgY2FuIGludGVybGVhdmUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPiB8IFR9IGNhbGxiYWNrIC0gV29yayB3aG9zZSBtb2RlbCB3cml0ZXMgc2hvdWxkIG5vdCBxdWV1ZSB0cmFja2VkIHN5bmNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gVGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRUcmFja2luZyhjYWxsYmFjaykge1xuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoKytcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aC0tXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIG9uZSByZWNvcmQgYXMgYmVpbmcgd3JpdHRlbiBmcm9tIHNlcnZlci1vcmlnaW5hdGVkIGRhdGEgc28gdHJhY2tlZFxuICAgKiBtdXRhdGlvbiBxdWV1ZWluZyBza2lwcyBpdCAocmVjb3JkLXByZWNpc2Ugc3VwcHJlc3Npb24pLiBUaGUgZGVyaXZlZCBwdWxsXG4gICAqIGFuZCByZWFsdGltZSBhcHBsaWVycyB1c2UgdGhpcyBpbnRlcm5hbGx5IGFyb3VuZCBldmVyeSBhcHBsaWVkIHdyaXRlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQgYWJvdXQgdG8gYmUgd3JpdHRlbi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFJlbGVhc2UgY2FsbGJhY2sgcmUtZW5hYmxpbmcgdHJhY2tpbmcgZm9yIHRoZSByZWNvcmQuXG4gICAqL1xuICBtYXJrUmVtb3RlQXBwbHkocmVjb3JkKSB7XG4gICAgdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmFkZChyZWNvcmQpXG5cbiAgICByZXR1cm4gKCkgPT4gdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmRlbGV0ZShyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoaXMgY2xpZW50IGFzIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudFN5bmNDbGllbnQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gQ3VycmVudCBzeW5jIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1N5bmNDbGllbnR9ICovIChjdXJyZW50U3luY0NsaWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbi4gQWxpYXMgZm9yXG4gICAqIGBuZXcgU3luY0NsaWVudCh7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYC5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMgYW5kIHRoZSBzeW5jLmNsaWVudCBibG9jay4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudE9wdGlvbnMsIFwiY29uZmlndXJhdGlvblwiPn0gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gU3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jQ2xpZW50KHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyAob3IgcmUtYWN0aXZhdGVzKSBhIHN5bmMgc2NvcGUgZnJvbSBhIG1vZGVsIHF1ZXJ5IGFuZCBwdWxscyBpdCB3aGVuIG9ubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBRdWVyeSBkZWNsYXJpbmcgdGhlIHN5bmMgc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBTeW5jIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KHByb2dyZXNzOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUHVsbFByb2dyZXNzKSA9PiB2b2lkfSBbb3B0aW9ucy5vblByb2dyZXNzXSAtIENhbGxlZCBwZXIgYXBwbGllZCBwYWdlIG9mIHRoZSBwdWxsIHRoaXMgZGVjbGFyYXRpb24gdHJpZ2dlcnMsIHNvIHRoZSBpbml0aWFsIGltcG9ydCBvZiBhIG5ld2x5IGRlY2xhcmVkIHNjb3BlIGNhbiBkcml2ZSBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIuIFNlZSBgcHVsbCgpYC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy51cHN0cmVhbVJlZnJlc2hdIC0gTWFya3MgdGhlIGNoYW5nZXMgcmVxdWVzdChzKSBhcyBhIHVzZXItaW5pdGlhdGVkIHJlZnJlc2gsIHNvIHRoZSBzZXJ2ZXIgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cy4gU2VlIGBwdWxsKClgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c2NvcGU6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZSwgcHVsbGVkOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9Pn0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0IChudWxsIHdoaWxlIG9mZmxpbmUpLlxuICAgKi9cbiAgYXN5bmMgc3luYyhxdWVyeSwge29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpXG4gICAgY29uc3Qgc2NvcGUgPSBzZXJpYWxpemVkU2NvcGVGcm9tUXVlcnkocXVlcnkpXG4gICAgY29uc3Qgc2NvcGVTdG9yZSA9IHRoaXMuc2NvcGVTdG9yZSgpXG4gICAgY29uc3Qgc2NvcGVSb3cgPSBhd2FpdCBzY29wZVN0b3JlLmZpbmRPckNyZWF0ZVNjb3BlKHNjb3BlKVxuXG4gICAgaWYgKCFzY29wZVJvdy5jdXJzb3JQYXlsb2FkICYmIHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcikge1xuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yUGF5bG9hZCA9IGF3YWl0IHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcih7c2NvcGV9KVxuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yID0gU3luY0FwaUNsaWVudC5zeW5jQ3Vyc29yRnJvbVBheWxvYWQobGVnYWN5Q3Vyc29yUGF5bG9hZClcblxuICAgICAgaWYgKGxlZ2FjeUN1cnNvcikgYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBsZWdhY3lDdXJzb3IpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwdWxsZWQ6IGF3YWl0IHRoaXMucHVsbCh7b25Qcm9ncmVzcywgdXBzdHJlYW1SZWZyZXNofSksIHNjb3BlfVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoZSBzeW5jIHNjb3BlIGRlY2xhcmVkIGJ5IGEgbW9kZWwgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgd2hvc2Ugc2NvcGUgc2hvdWxkIHN0b3Agc3luY2luZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN5bmMocXVlcnkpIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWxscyBjaGFuZ2VzIGZvciBldmVyeSBhY3RpdmUgc2NvcGUgd2l0aCBwZXItc2NvcGUgY3Vyc29ycyAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUHVsbCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSB3aXRoIGN1bXVsYXRpdmUgYHtwYWdlcywgc3luY2VkQ291bnQsIHRvdGFsfWAgYWNyb3NzIHRoZSBwdWxsZWQgc2NvcGVzLCBmb3IgcmVuZGVyaW5nIGEgXCJzeW5jZWRDb3VudCBvZiB0b3RhbFwiIHByb2dyZXNzIGJhciAoZS5nLiBhIGZ1bGwtaW1wb3J0IHNjcmVlbikuIE9wdGlvbmFsOyBvbWl0dGluZyBpdCBrZWVwcyB0aGUgZXhpc3RpbmcgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIFNlbmRzIGB1cHN0cmVhbVJlZnJlc2g6IHRydWVgIG9uIHRoZSBjaGFuZ2VzIHJlcXVlc3QocyksIHRlbGxpbmcgdGhlIHNlcnZlciB0aGlzIHB1bGwgaXMgdXNlci1pbml0aWF0ZWQgc28gaXQgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cyAoc2VlIGRvY3Mvc3luYy11cHN0cmVhbS1pbXBvcnRzLm1kKS4gQmFja2dyb3VuZCBwdWxscyBvbWl0IGl0IGFuZCBzdGF5IHRocm90dGxlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsPn0gQ29tYmluZWQgcHVsbCByZXN1bHQsIG9yIG51bGwgd2hpbGUgb2ZmbGluZS5cbiAgICovXG4gIGFzeW5jIHB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3B1bGwoe29uUHJvZ3Jlc3MsIHNpZ25hbCwgdXBzdHJlYW1SZWZyZXNofSkpXG4gIH1cblxuICAvKipcbiAgICogUHVsbCBpbXBsZW1lbnRhdGlvbiBib3VuZCB0byBvbmUgbGlmZWN5Y2xlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gYXJncy5zaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy51cHN0cmVhbVJlZnJlc2hdIC0gVXNlci1pbml0aWF0ZWQgdXBzdHJlYW0gcmVmcmVzaCBtYXJrZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbD59IENvbWJpbmVkIHB1bGwgcmVzdWx0LCBvciBudWxsIHdoaWxlIG9mZmxpbmUuXG4gICAqL1xuICBhc3luYyBfcHVsbCh7b25Qcm9ncmVzcywgc2lnbmFsLCB1cHN0cmVhbVJlZnJlc2h9KSB7XG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVybiBudWxsXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9ICovXG4gICAgbGV0IGNvbWJpbmVkUmVzdWx0ID0gbnVsbFxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1wdWxsLSR7dGhpcy5fY2xpZW50TnVtYmVyfWAsIGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IGF1dGhlbnRpY2F0aW9uVG9rZW4gPSBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKClcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgICAgY29uc3QgYXBwbHlTeW5jID0gdGhpcy5yZW1vdGVBcHBseVN5bmMoKVxuICAgICAgY29uc3QgcmVzdWx0ID0ge1xuICAgICAgICBjaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgcGFnZXM6IDAsXG4gICAgICAgIHJlc291cmNlQ2hhbmdlZDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKHt9KSxcbiAgICAgICAgcmVzb3VyY2VDb3VudHM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KSxcbiAgICAgICAgc3luY2VkQ291bnQ6IDAsXG4gICAgICAgIHRvdGFsOiAwXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgc2NvcGVSb3cgb2YgYXdhaXQgc2NvcGVTdG9yZS5hY3RpdmVTY29wZXMoKSkge1xuICAgICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICAgIC8vIEN1bXVsYXRlIHNjb3BlIHByb2dyZXNzIG9udG8gdGhlIGNvdW50cyBvZiB0aGUgc2NvcGVzIGFscmVhZHkgcHVsbGVkIHNvIGEgc2luZ2xlXG4gICAgICAgIC8vIHNjb3BlJ3MgcGVyLXBhZ2UgcHJvZ3Jlc3MgcmVhZHMgZXhhY3RseSBpdHMgb3duIGNvdW50cyAoYmFzZSAwKSwgYW5kIG11bHRpLXNjb3BlXG4gICAgICAgIC8vIHB1bGxzIHJlcG9ydCBhIHJ1bm5pbmcgY3VtdWxhdGl2ZSB0b3RhbCBhY3Jvc3MgZXZlcnkgc2NvcGUuXG4gICAgICAgIGNvbnN0IGJhc2VQYWdlcyA9IHJlc3VsdC5wYWdlc1xuICAgICAgICBjb25zdCBiYXNlU3luY2VkQ291bnQgPSByZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgY29uc3QgYmFzZVRvdGFsID0gcmVzdWx0LnRvdGFsXG4gICAgICAgIGNvbnN0IHNjb3BlUmVzdWx0ID0gYXdhaXQgU3luY0FwaUNsaWVudC5wdWxsQ2hhbmdlcyh7XG4gICAgICAgICAgYXBwbHlTeW5jLFxuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgICAgbG9hZEN1cnNvcjogYXN5bmMgKCkgPT4gYXdhaXQgc2NvcGVTdG9yZS5sb2FkQ3Vyc29yKHNjb3BlUm93KSxcbiAgICAgICAgICBvblByb2dyZXNzOiBvblByb2dyZXNzID8gKHByb2dyZXNzKSA9PiBvblByb2dyZXNzKHtcbiAgICAgICAgICAgIHBhZ2VzOiBiYXNlUGFnZXMgKyBwcm9ncmVzcy5wYWdlcyxcbiAgICAgICAgICAgIHN5bmNlZENvdW50OiBiYXNlU3luY2VkQ291bnQgKyBwcm9ncmVzcy5zeW5jZWRDb3VudCxcbiAgICAgICAgICAgIHRvdGFsOiBiYXNlVG90YWwgKyBwcm9ncmVzcy50b3RhbFxuICAgICAgICAgIH0pIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHBvc3RDaGFuZ2VzOiBhc3luYyAocGF5bG9hZCwgb3B0aW9ucykgPT4gYXdhaXQgdGhpcy5jb25maWcucG9zdENoYW5nZXMoe1xuICAgICAgICAgICAgLi4ucGF5bG9hZCxcbiAgICAgICAgICAgIC8vIE9ubHkgdGhlIGFsbC10eXBlcyBzY29wZSBjYXJyaWVzIHRoZSB0eXBlIGxpc3Q7IGEgdHlwZS1kZWNsYXJlZCBzY29wZSBuZWVkcyBub25lLlxuICAgICAgICAgICAgc2NvcGU6IHtcbiAgICAgICAgICAgICAgY29uZGl0aW9uczogc2NvcGVSb3cuY29uZGl0aW9ucyxcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBzY29wZVJvdy5yZXNvdXJjZVR5cGUsXG4gICAgICAgICAgICAgIC4uLihzY29wZVJvdy5yZXNvdXJjZVR5cGUgPT09IG51bGwgPyB7cmVzb3VyY2VUeXBlczogdGhpcy51c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCl9IDoge30pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLi4uKHVwc3RyZWFtUmVmcmVzaCA/IHt1cHN0cmVhbVJlZnJlc2g6IHRydWV9IDoge30pXG4gICAgICAgICAgfSwgb3B0aW9ucyksXG4gICAgICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBjdXJzb3IpLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuXG4gICAgICAgIHJlc3VsdC5jaGFuZ2VkIHx8PSBzY29wZVJlc3VsdC5jaGFuZ2VkXG4gICAgICAgIHJlc3VsdC5wYWdlcyArPSBzY29wZVJlc3VsdC5wYWdlc1xuICAgICAgICByZXN1bHQuc3luY2VkQ291bnQgKz0gc2NvcGVSZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgcmVzdWx0LnRvdGFsICs9IHNjb3BlUmVzdWx0LnRvdGFsXG5cbiAgICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCBjb3VudF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDb3VudHMpKSB7XG4gICAgICAgICAgcmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gPSAocmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyBjb3VudFxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgY2hhbmdlZF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDaGFuZ2VkKSkge1xuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gY2hhbmdlZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbWJpbmVkUmVzdWx0ID0gcmVzdWx0XG4gICAgfSlcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICByZXR1cm4gY29tYmluZWRSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGRlcml2ZWQgcmVtb3RlLWNoYW5nZSBhcHBsaWVyIHNoYXJlZCBieSBwdWxscyBhbmQgcmVhbHRpbWUgcHVzaGVzOlxuICAgKiBhcHBsaWVzIHRocm91Z2ggdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZ3MsIHJlZ2lzdGVycyBlYWNoIHdyaXR0ZW4gcmVjb3JkXG4gICAqIGZvciBlY2hvIHN1cHByZXNzaW9uICh0cmFja2VkIHJlc291cmNlcyBkbyBub3QgcmUtcXVldWUgYXBwbGllZCBjaGFuZ2VzKSwgYW5kXG4gICAqIGZhaWxzIGxvdWRseSBpbnN0ZWFkIG9mIHNpbGVudGx5IHNraXBwaW5nIHVuY29uZmlndXJlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7e3NvdXJjZT86IHN0cmluZ319IFthcmdzXSAtIEVycm9yIGNvbnRleHQgZGVzY3JpYmluZyB3aGVyZSB0aGUgY2hhbmdlIGNhbWUgZnJvbS5cbiAgICogQHJldHVybnMgeyhzeW5jOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlRW52ZWxvcGUpID0+IFByb21pc2U8aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUFwcGx5UmVzdWx0Pn0gTG91ZCByZW1vdGUtY2hhbmdlIGFwcGxpZXIuXG4gICAqL1xuICByZW1vdGVBcHBseVN5bmMoe3NvdXJjZSA9IFwicHVsbGVkIGNoYW5nZVwifSA9IHt9KSB7XG4gICAgcmV0dXJuIGFzeW5jIChzeW5jKSA9PiB7XG4gICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBzeW5jLnJlc291cmNlVHlwZSgpXG4gICAgICBjb25zdCBjb25maWd1cmVkUmVzb3VyY2UgPSByZXNvdXJjZVR5cGUgPyB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXSA6IHVuZGVmaW5lZFxuXG4gICAgICBpZiAoIXJlc291cmNlVHlwZSB8fCAhY29uZmlndXJlZFJlc291cmNlPy5hdHRyaWJ1dGVzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3luYyByZXNvdXJjZSB3aXRoIHB1bGwgYXR0cmlidXRlcyBjb25maWd1cmVkIGZvciAke3NvdXJjZX06ICR7U3RyaW5nKHJlc291cmNlVHlwZSl9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBzeW5jLmRhdGEoKVxuICAgICAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0uY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuXG4gICAgICAgIGlmICh2ZXJzaW9uQXR0cmlidXRlKSB7XG4gICAgICAgICAgY29uc3QgZGF0YUF0dHJpYnV0ZXMgPSBkYXRhICYmIHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGRhdGEpXG4gICAgICAgICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGF0YSlcbiAgICAgICAgICAgIDoge31cblxuICAgICAgICAgIHRoaXMubm90ZVJlbW90ZVZlcnNpb24oe3Jlc291cmNlSWQ6IFN0cmluZyhzeW5jLnJlc291cmNlSWQoKSksIHJlc291cmNlVHlwZSwgdmVyc2lvbjogZGF0YUF0dHJpYnV0ZXNbdmVyc2lvbkF0dHJpYnV0ZV19KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHVsbFJlc291cmNlQ29uZmlncyA9IHRoaXMucHVsbFJlc291cmNlQ29uZmlncyhvcGVyYXRpb24pXG4gICAgICAgIGNvbnN0IGFwcGxpZXIgPSBTeW5jQXBpQ2xpZW50LnJlc291cmNlQXBwbGllcihwdWxsUmVzb3VyY2VDb25maWdzLCAocmVjb3JkKSA9PiB7XG4gICAgICAgICAgaWYgKG9wZXJhdGlvbikgdGhpcy5iaW5kUmVtb3RlUmVjb3JkKHtvcGVyYXRpb24sIHJlY29yZH0pXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5tYXJrUmVtb3RlQXBwbHkocmVjb3JkKVxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiBhd2FpdCBhcHBsaWVyKHN5bmMpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2hhcmVkIGFwcC1saWZldGltZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiBhbGwgc3luYyB0cmFmZmljXG4gICAqIHJpZGVzLCBvciBudWxsIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkLiBCdWlsdCBvbmNlIGFuZCBtZW1vaXplZCAocGVyXG4gICAqIGNsaWVudCk6IGFuIGFwcC1wcm92aWRlZCBgc3luYy5jbGllbnQud2Vic29ja2V0Q2xpZW50YCBpbnN0YW5jZSB3aW5zICh0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IGNhbiBwYXNzIGl0cyBvd24gY2xpZW50IHNvIG9uZSBzb2NrZXQgY2Fycmllc1xuICAgKiBldmVyeXRoaW5nKSwgZWxzZSBhIGZyYW1ld29yay1vd25lZCByZWNvbm5lY3Rpbmcge0BsaW5rIFZlbG9jaW91c1dlYnNvY2tldENsaWVudH1cbiAgICogYnVpbHQgZnJvbSBgc3luYy5jbGllbnQud2Vic29ja2V0VXJsYC4gVGhlIHJlYWx0aW1lIGJyaWRnZSByaWRlcyB0aGlzXG4gICAqIGNvbm5lY3Rpb24gd2l0aG91dCBvd25pbmcgaXRzIGxpZmVjeWNsZTsgd2hlbiBuZWl0aGVyIGlzIGNvbmZpZ3VyZWQgdGhlXG4gICAqIGJyaWRnZSBmYWxscyBiYWNrIHRvIHRoZSBkZXByZWNhdGVkIHBlci1jeWNsZSBgcmVhbHRpbWUuY3JlYXRlQ2xpZW50YC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFNoYXJlZENvbm5lY3Rpb24gfCBudWxsfSBTaGFyZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24sIG9yIG51bGwuXG4gICAqL1xuICBzeW5jQ29ubmVjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fc3luY0Nvbm5lY3Rpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX3N5bmNDb25uZWN0aW9uXG5cbiAgICBpZiAodGhpcy5jb25maWcud2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHRoaXMuY29uZmlnLndlYnNvY2tldENsaWVudFxuICAgIH0gZWxzZSBpZiAodGhpcy5jb25maWcud2Vic29ja2V0VXJsKSB7XG4gICAgICBjb25zdCB1cmwgPSB0eXBlb2YgdGhpcy5jb25maWcud2Vic29ja2V0VXJsID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmwoKSA6IHRoaXMuY29uZmlnLndlYnNvY2tldFVybFxuXG4gICAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHVybCA/IG5ldyBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQoe3VybH0pIDogbnVsbFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fc3luY0Nvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRoZSBkZXJpdmVkIHJlYWx0aW1lIGNoYW5uZWxzIHNvIHB1c2hlZCB3ZWJzb2NrZXQgY2hhbmdlcyBhcHBseVxuICAgKiB0aHJvdWdoIHRoZSBzYW1lIGRlcml2ZWQgYXBwbGllciBhcyBwdWxscyAoaWRlbXBvdGVudCwgc2luZ2xlLWZsaWdodGVkKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2NvbnRleHRdIC0gQXBwIGNvbnRleHQgcGFzc2VkIHRvIHRoZSBkZXByZWNhdGVkIGBzeW5jLmNsaWVudC5yZWFsdGltZS5jaGFubmVsc2AgY2FsbGJhY2sgKHJ1bnRpbWUgc2NvcGUgdmFsdWVzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdWJzY3JpYmVSZWFsdGltZShjb250ZXh0KSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS5zdWJzY3JpYmUoY29udGV4dCwge3NpZ25hbH0pXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRoZSBzZXJ2ZXItZW51bWVyYXRlZCB1c2VyIHNjb3BlOiBcImV2ZXJ5dGhpbmcgbXkgYWJpbGl0eSBjYW5cbiAgICogc2VlXCIuIERlY2xhcmVzIGEgdXNlciBzY29wZSAoZW1wdHkgY29uZGl0aW9ucykgZm9yIGV2ZXJ5IHB1bGxhYmxlIHN5bmNlZFxuICAgKiByZXNvdXJjZSB0eXBlLCBzdWJzY3JpYmVzIHJlYWx0aW1lIHNvIHRoZWlyIGZyYW1ld29yayBzeW5jIGNoYW5uZWxcbiAgICogc3Vic2NyaXB0aW9ucyBnbyBsaXZlLCBhbmQgcHVsbHMgc28gdGhlIGRldmljZSBjYXRjaGVzIHVwLiBUaGUgc2VydmVyXG4gICAqIGF1dGhvcml6ZXMgZWFjaCBlbXB0eS1jb25kaXRpb25zIHNjb3BlIHRocm91Z2ggdGhlIGFwcCBzeW5jIHJlc291cmNlJ3NcbiAgICogYGF1dGhvcml6ZUNoYW5nZXNgIGFuZCByZS1jaGVja3MgcmVjb3JkIGFjY2VzcyBwZXIgZGVsaXZlcnksIHNvIHRoZSBjbGllbnRcbiAgICogc3Vic2NyaWJlcyB3aXRoIGp1c3QgaXRzIHRva2VuIGFuZCB0aGUgc2VydmVyIGRlY2lkZXMgbWVtYmVyc2hpcC5cbiAgICogSWRlbXBvdGVudCBhbmQgc2luZ2xlLWZsaWdodGVkIGxpa2Uge0BsaW5rIFN5bmNDbGllbnQjc3Vic2NyaWJlUmVhbHRpbWV9LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN1YnNjcmliZVVzZXJTY29wZSgpIHtcbiAgICBpZiAodGhpcy5fdXNlclNjb3BlU3RhdGUgPT09IFwic3Vic2NyaWJlZFwiKSByZXR1cm5cblxuICAgIGlmICghdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSkge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4gYXdhaXQgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlKHNpZ25hbCkpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW5kIGFjdGl2YXRlcyB0aGUgdXNlciBzY29wZSBmb3IgZXZlcnkgcHVsbGFibGUgcmVzb3VyY2UsIHRoZW5cbiAgICogc3Vic2NyaWJlcyByZWFsdGltZSBhbmQgcHVsbHMuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IHNpZ25hbCAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9zdWJzY3JpYmVVc2VyU2NvcGUoc2lnbmFsKSB7XG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInN1YnNjcmliaW5nXCJcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5maW5kT3JDcmVhdGVTY29wZShhd2FpdCB0aGlzLnVzZXJTY29wZSgpKVxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICBhd2FpdCB0aGlzLnN1YnNjcmliZVJlYWx0aW1lKClcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGF3YWl0IHRoaXMucHVsbCgpXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJzdWJzY3JpYmVkXCJcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnN1YnNjcmliZXMgdGhlIHVzZXIgc2NvcGU6IGRlYWN0aXZhdGVzIHRoZSBwZXItcmVzb3VyY2UgdXNlciBzY29wZXMgYW5kXG4gICAqIGNsb3NlcyB0aGUgcmVhbHRpbWUgY2hhbm5lbCBzdWJzY3JpcHRpb25zLiBUaGUgc2hhcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uXG4gICAqIHN0YXlzIG9wZW4gd2hlbiBvbmUgaXMgY29uZmlndXJlZCAoc2lnbi1vdXQgZHJvcHMgc3Vic2NyaXB0aW9ucyB3aXRob3V0XG4gICAqIGRpc2Nvbm5lY3RpbmcpLCBzbyBhIHN1YnNlcXVlbnQgc2lnbi1pbiByZXN1YnNjcmliZXMgb3ZlciB0aGUgc2FtZSBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zdWJzY3JpYmVVc2VyU2NvcGUoKSB7XG4gICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkuZGVhY3RpdmF0ZShhd2FpdCB0aGlzLnVzZXJTY29wZSgpKVxuXG4gICAgYXdhaXQgdGhpcy51bnN1YnNjcmliZVJlYWx0aW1lKClcblxuICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogVGhlIHVzZXIgc2NvcGU6IGEgc2luZ2xlIGFsbC10eXBlcyBzY29wZSAobnVsbCByZXNvdXJjZVR5cGUpIHdpdGggZW1wdHlcbiAgICogY29uZGl0aW9ucywgcGFydGl0aW9uZWQgbG9jYWxseSBieSBvd25lci4gT25lIHNjb3BlIC0gbm90IG9uZSBwZXIgcmVzb3VyY2VcbiAgICogdHlwZSAtIHNvIHRoZSBzZXJ2ZXIgYXV0aG9yaXplcyB0aGUgY2FsbGVyIG9uY2UgcGVyIHN5bmMgYW5kIHBlciBzdWJzY3JpYmUsXG4gICAqIGhvd2V2ZXIgbWFueSByZXNvdXJjZSB0eXBlcyBpdCBzZXJ2ZXMuIFRoZSBzZXJ2ZXIgZGVjaWRlcyB3aGljaCB0eXBlcyB0aGVcbiAgICogY2FsbGVyIG1heSBzZWU7IHRoZSBjbGllbnQgYXBwbGllcyBlYWNoIHB1bGxlZCByb3cgYnkgdGhlIHJlc291cmNlIHR5cGUgb25cbiAgICogaXRzIG93biBlbnZlbG9wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlPn0gVGhlIHVzZXIgc2NvcGUuXG4gICAqL1xuICBhc3luYyB1c2VyU2NvcGUoKSB7XG4gICAgcmV0dXJuIHtjb25kaXRpb25zOiB7fSwgb3duZXI6IGF3YWl0IHRoaXMudXNlclNjb3BlT3duZXIoKSwgcmVzb3VyY2VUeXBlOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSByZXNvdXJjZSB0eXBlcyB0aGUgdXNlciBzY29wZSBjb3ZlcnM6IGV2ZXJ5IGRlY2xhcmVkIHJlc291cmNlIHRoYXRcbiAgICogcmVjZWl2ZXMgcHVsbGVkIGNoYW5nZXMgKGhhcyBwdWxsIGBhdHRyaWJ1dGVzYCksIHNvIHRoZSBjbGllbnQgY2FuIGFwcGx5XG4gICAqIHRoZW0uIFNlbnQgd2l0aCB0aGUgc2NvcGUgYXMgYSBkZWxpdmVyeS90eXBlIGZpbHRlciAtIGl0IG5hcnJvd3MsIG5ldmVyXG4gICAqIHdpZGVucywgd2hhdCB0aGUgc2VydmVyJ3MgYXV0aG9yaXphdGlvbiBhbHJlYWR5IGFsbG93cywgYW5kIGl0IGtlZXBzIGFcbiAgICogYnJvYWRjYXN0IG9mIGEgdHlwZSB0aGlzIGNsaWVudCBjYW5ub3QgYXBwbHkgZnJvbSByZWFjaGluZyB0aGUgc2VydmVyJ3NcbiAgICogcGVyLWRlbGl2ZXJ5IGFjY2VzcyByZS1jaGVjayAoYSBkYXRhYmFzZSBxdWVyeSBwZXIgbWF0Y2hlZCBicm9hZGNhc3QsIHBlclxuICAgKiBzdWJzY3JpYmVkIGRldmljZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gUHVsbGFibGUgcmVzb3VyY2UgdHlwZSBuYW1lcy5cbiAgICovXG4gIHVzZXJTY29wZVJlc291cmNlVHlwZXMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMucHVsbFJlc291cmNlQ29uZmlncygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBsb2NhbCBwYXJ0aXRpb24ga2V5IGZvciB0aGUgdXNlciBzY29wZTogdGhlIGN1cnJlbnRseVxuICAgKiBjb25maWd1cmVkIGF1dGhlbnRpY2F0ZWQgaWRlbnRpdHkgKHRoZSBzeW5jIGF1dGggdG9rZW4pLiBQYXJ0aXRpb25pbmcgdGhlXG4gICAqIHVzZXIgc2NvcGUncyBsb2NhbCBzY29wZS9jdXJzb3Igcm93cyBieSB0aGlzIG93bmVyIGtlZXBzIHRoZVxuICAgKiBlbXB0eS1jb25kaXRpb25zIGN1cnNvciBmcm9tIGxlYWtpbmcgYWNyb3NzIGFjY291bnRzIG9uIGEgc2hhcmVkIGRldmljZVxuICAgKiAoYWNjb3VudCBCIHNpZ25pbmcgaW4gYWZ0ZXIgYWNjb3VudCBBIGdldHMgYSBmcmVzaCBjdXJzb3IpIHdoaWxlIHRoZSBzYW1lXG4gICAqIGFjY291bnQgcmVjb25uZWN0aW5nIGtlZXBzIGl0cyBjdXJzb3IgY29udGludWl0eS4gVGhlIG93bmVyIGlzIGEgbG9jYWxcbiAgICogcGFydGl0aW9uIGtleSBvbmx5IOKAlCBwdWxscyBzdGlsbCBwb3N0IGVtcHR5IGNvbmRpdGlvbnMgdG8gdGhlIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gVXNlci1zY29wZSBvd25lciBwYXJ0aXRpb24ga2V5LlxuICAgKi9cbiAgYXN5bmMgdXNlclNjb3BlT3duZXIoKSB7XG4gICAgcmV0dXJuIFN0cmluZyhhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKCkpXG4gIH1cblxuICAvKipcbiAgICogVW5zdWJzY3JpYmVzIHRoZSByZWFsdGltZSBjaGFubmVscyBhbmQgZGlzY29ubmVjdHMgdGhlIHdlYnNvY2tldCBjbGllbnQgKGlkZW1wb3RlbnQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVuc3Vic2NyaWJlUmVhbHRpbWUoKSB7XG4gICAgYXdhaXQgdGhpcy5yZWFsdGltZUJyaWRnZSgpLnVuc3Vic2NyaWJlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIHRoZSByZWFsdGltZSBzdWJzY3JpcHRpb24gc3RhdGUgYW5kIHBlci1jaGFubmVsIHJlYWRpbmVzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8U3luY1JlYWx0aW1lQnJpZGdlW1wic3RhdHVzXCJdPn0gUmVhbHRpbWUgc3RhdHVzLlxuICAgKi9cbiAgcmVhbHRpbWVTdGF0dXMoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVhbHRpbWVCcmlkZ2UoKS5zdGF0dXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhbGwgcGVuZGluZyByZWFsdGltZSBtZXNzYWdlIGFwcGxpZXMgYW5kIGFueSBzY2hlZHVsZWRcbiAgICogcHVsbC1vbi1yZWNvbm5lY3QgKHVzZWZ1bCBpbiB0ZXN0cyBhbmQgc2h1dGRvd24gZmxvd3MpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JSZWFsdGltZUFwcGxpZWQoKSB7XG4gICAgYXdhaXQgdGhpcy5yZWFsdGltZUJyaWRnZSgpLndhaXRGb3JBcHBsaWVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgcmVhbHRpbWUgYnJpZGdlLlxuICAgKiBAcmV0dXJucyB7U3luY1JlYWx0aW1lQnJpZGdlfSBSZWFsdGltZSBicmlkZ2UuXG4gICAqL1xuICByZWFsdGltZUJyaWRnZSgpIHtcbiAgICB0aGlzLl9yZWFsdGltZUJyaWRnZSB8fD0gbmV3IFN5bmNSZWFsdGltZUJyaWRnZSh7c3luY0NsaWVudDogdGhpc30pXG5cbiAgICByZXR1cm4gdGhpcy5fcmVhbHRpbWVCcmlkZ2VcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgYSBsb2NhbCBtb2RlbCBjaGFuZ2UgYXMgYSBwZW5kaW5nIHN5bmMgcm93IGFuZCBzY2hlZHVsZXMgYW4gaW1tZWRpYXRlXG4gICAqIHJlcGxheSBhdHRlbXB0IChrZXB0IHBlbmRpbmcgd2hpbGUgb2ZmbGluZSBvciB3aGVuIHRoZSBiYWNrZW5kIHJlamVjdHMgaXQpLlxuICAgKiBAcGFyYW0ge3tiYXNlVmVyc2lvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGwsIHJlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3BlcmF0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgc3luY1R5cGU/OiBzdHJpbmd9fSBhcmdzIC0gUXVldWUgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gUGVuZGluZyBsb2NhbCBzeW5jIHJvdyBvciBkdXJhYmxlIGNvbmZsaWN0LXRyYWNrZWQgaW50ZW50LlxuICAgKi9cbiAgYXN5bmMgcXVldWUoe2Jhc2VWZXJzaW9uLCBkYXRhLCBvcGVyYXRpb24gPSBcInVwZGF0ZVwiLCByZXNvdXJjZSwgc3luY1R5cGV9KSB7XG4gICAgY29uc3QgbGlmZWN5Y2xlR2VuZXJhdGlvbiA9IHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb25cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5NdXRhdGlvbkxpZmVjeWNsZVdvcmsobGlmZWN5Y2xlR2VuZXJhdGlvbiwgYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgICB0aGlzLmFzc2VydFJlY29yZE93bmVyc2hpcChyZXNvdXJjZSlcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZ0ZvcihyZXNvdXJjZSlcbiAgICAgIGNvbnN0IHJlc29sdmVkU3luY1R5cGUgPSBzeW5jVHlwZSA/PyB0aGlzLmRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQ6IHJlc291cmNlLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIGNvbnN0IHF1ZXVlZERhdGEgPSBTeW5jQXBpQ2xpZW50LnF1ZXVlZFN5bmNEYXRhKHtcbiAgICAgICAgICBib29sZWFuQXR0cmlidXRlczogcmVzb3VyY2VDb25maWcuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgICAgZGF0YSxcbiAgICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICAgIHJlc291cmNlXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgICBiYXNlVmVyc2lvbjogYmFzZVZlcnNpb24gPT09IHVuZGVmaW5lZCA/IHRoaXMuYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkOiByZXNvdXJjZSwgcmVzb3VyY2VDb25maWd9KSA6IGJhc2VWZXJzaW9uLFxuICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgZGF0YTogcXVldWVkRGF0YSxcbiAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgcmVzb3VyY2UsXG4gICAgICAgICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZS5jb25zdHJ1Y3Rvci5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICBzeW5jVHlwZTogcmVzb2x2ZWRTeW5jVHlwZVxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICAgIHJldHVybiByZWNvcmRcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3luY1JvdyA9IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAoZGF0YWJhc2VPcGVyYXRpb24pID0+IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVMb2NhbFN5bmMoe1xuICAgICAgICBib29sZWFuQXR0cmlidXRlczogcmVzb3VyY2VDb25maWcuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIGRhdGEsXG4gICAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIHJlc291cmNlLFxuICAgICAgICBzeW5jTW9kZWw6IGRhdGFiYXNlT3BlcmF0aW9uID8gZGF0YWJhc2VPcGVyYXRpb24ubW9kZWxDbGFzcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpIDogdGhpcy5jb25maWcuc3luY01vZGVsLFxuICAgICAgICBzeW5jVHlwZTogcmVzb2x2ZWRTeW5jVHlwZVxuICAgICAgfSkpXG5cbiAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICByZXR1cm4gc3luY1Jvd1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIHRvIHRoZSBiYWNrZW5kIChzaW5nbGUtZmxpZ2h0ZWQsIG9ubGluZS1nYXRlZCkuXG4gICAqIFJvd3MgYXJlIG9ubHkgbWFya2VkIHN1Y2Nlc3NmdWwgYWZ0ZXIgdGhlIGJhY2tlbmQgYWNrbm93bGVkZ2VzIHRoZW0uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwbGF5UGVuZGluZygpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3JlcGxheVBlbmRpbmcoc2lnbmFsKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXkgaW1wbGVtZW50YXRpb24gYm91bmQgdG8gb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBzaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcmVwbGF5UGVuZGluZyhzaWduYWwpIHtcbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5pc09ubGluZSgpKSkgcmV0dXJuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1yZXBsYXktJHt0aGlzLl9jbGllbnROdW1iZXJ9YCwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgcmVzb3VyY2VDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSBjb250aW51ZVxuXG4gICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucmVwbGF5Q29uZmxpY3RUcmFja2VkU3luY3Moe1xuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSxcbiAgICAgICAgICBiYXRjaFNpemU6IHRoaXMuY29uZmlnLmJhdGNoU2l6ZSxcbiAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgIHBvc3RSZXBsYXk6IHRoaXMuY29uZmlnLnBvc3RSZXBsYXksXG4gICAgICAgICAgcmVtb3RlR2VuZXJhdGlvbjogKGlkZW50aXR5KSA9PiB0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5nZXQoaWRlbnRpdHkpIHx8IDAsXG4gICAgICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnJlcGxheUxvY2FsU3luY3Moe1xuICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKCksXG4gICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICBwb3N0UmVwbGF5OiB0aGlzLmNvbmZpZy5wb3N0UmVwbGF5LFxuICAgICAgICBzaWduYWwsXG4gICAgICAgIHN5bmNNb2RlbDogb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3ModGhpcy5jb25maWcuc3luY01vZGVsKSA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuICAgICAgfSlcbiAgICB9KSlcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGF1dGhvcml0YXRpdmUgcmVtb3RlIG9ic2VydmF0aW9uIHNvIGFuIGluLWZsaWdodCBhY2tub3dsZWRnZW1lbnRcbiAgICogY2Fubm90IHJlYmFzZSBhIHN1Y2Nlc3NvciBhY3Jvc3MgdGhhdCBvYnNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VJZDogc3RyaW5nIHwgbnVtYmVyLCByZXNvdXJjZVR5cGU6IHN0cmluZywgdmVyc2lvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGx9fSBhcmdzIC0gUmVtb3RlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHZlcnNpb259KSB7XG4gICAgdm9pZCB2ZXJzaW9uXG4gICAgY29uc3QgaWRlbnRpdHkgPSBgJHtyZXNvdXJjZVR5cGV9OiR7U3RyaW5nKHJlc291cmNlSWQpfWBcblxuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLnNldChpZGVudGl0eSwgKHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCkgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBhdXRob3JpdGF0aXZlIGJhc2UgdmVyc2lvbiBvYnNlcnZlZCBiZWZvcmUgYSBsb2NhbCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gQmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAob3BlcmF0aW9uID09PSBcImNyZWF0ZVwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgIGlmICghdmVyc2lvbkF0dHJpYnV0ZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUodmVyc2lvbkF0dHJpYnV0ZSlcblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0IHZlcnNpb24gJHt2ZXJzaW9uQXR0cmlidXRlfSBtdXN0IGJlIGEgRGF0ZSwgc3RyaW5nLCBudW1iZXIsIG9yIG51bGxgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBwcmUtYXNzaWdubWVudCB2YWx1ZSBleHBvc2VkIGJ5IHJlY29yZCBjaGFuZ2VzIGR1cmluZyBiZWZvcmVVcGRhdGUuXG4gICAqIERlbGV0ZXMgaGF2ZSBubyB2ZXJzaW9uIGNoYW5nZSBwYWlyIGFuZCB1c2UgdGhlIHJlY29yZCdzIGN1cnJlbnQgdmVyc2lvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gUHJlLW11dGF0aW9uIGJhc2UgdmVyc2lvbi5cbiAgICovXG4gIHByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuICAgIGNvbnN0IHZlcnNpb25Db2x1bW4gPSB2ZXJzaW9uQXR0cmlidXRlXG4gICAgICA/IHJlY29yZC5jb25zdHJ1Y3Rvci5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbdmVyc2lvbkF0dHJpYnV0ZV1cbiAgICAgIDogdW5kZWZpbmVkXG4gICAgY29uc3QgdmVyc2lvbkNoYW5nZSA9IG9wZXJhdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiB2ZXJzaW9uQ29sdW1uXG4gICAgICA/IHJlY29yZC5jaGFuZ2VzKClbdmVyc2lvbkNvbHVtbl1cbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIXZlcnNpb25DaGFuZ2UpIHJldHVybiB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgY29uc3QgdmFsdWUgPSB2ZXJzaW9uQ2hhbmdlWzBdXG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCB2ZXJzaW9uICR7dmVyc2lvbkF0dHJpYnV0ZX0gbXVzdCBiZSBhIERhdGUsIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyB0aGUgYmFzZSBjYXB0dXJlZCBmb3IgdGhpcyBsaWZlY3ljbGUgZXZlbnQgYmVmb3JlIGl0cyBhZnRlci1jb21taXRcbiAgICogY2xvc3VyZSBpcyBkZWZlcnJlZCwgcHJlc2VydmluZyByZXBlYXRlZCBzYW1lLXJlY29yZCB3cml0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBDYXB0dXJlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBDYXB0dXJlZCBiYXNlIHZlcnNpb24uXG4gICAqL1xuICBjYXB0dXJlZEJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNhcHR1cmVkVmVyc2lvbnMgPSB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5nZXQocmVjb3JkKVxuICAgIGNvbnN0IGJhc2VWZXJzaW9uID0gY2FwdHVyZWRWZXJzaW9ucz8uc2hpZnQoKVxuXG4gICAgaWYgKGNhcHR1cmVkVmVyc2lvbnM/Lmxlbmd0aCA9PT0gMCkgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZGVsZXRlKHJlY29yZClcbiAgICBpZiAoYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIGJhc2VWZXJzaW9uXG5cbiAgICByZXR1cm4gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgYSBiYWNrZ3JvdW5kIHJlcGxheSBhdHRlbXB0IHdpdGhvdXQgYmxvY2tpbmcgdGhlIGNhbGxlci5cbiAgICogRmFpbHVyZXMgZ28gdG8gY29uZmlnLm9uRXJyb3IgKG9yIHJldGhyb3cgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlUmVwbGF5KCkge1xuICAgIHRoaXMuX3NjaGVkdWxlZFJlcGxheSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJlcGxheVBlbmRpbmcoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikpIHJldHVyblxuXG4gICAgICAgIHRoaXMucmVwb3J0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcbiAgICAgIH1cbiAgICB9KSgpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIHRoZSBsYXN0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIHJlcGxheSAodXNlZnVsIGluIHRlc3RzIGFuZCBzaHV0ZG93biBmbG93cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FpdEZvclNjaGVkdWxlZFJlcGxheSgpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkUmVwbGF5KSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRSZXBsYXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGEgYmFja2dyb3VuZCBzeW5jIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gQmFja2dyb3VuZCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlcG9ydEVycm9yKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLm9uRXJyb3IpIHtcbiAgICAgIHRoaXMuY29uZmlnLm9uRXJyb3IoZXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGNvbm5lY3Rpdml0eSB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGdhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBiYWNrZW5kIGlzIGNvbnNpZGVyZWQgcmVhY2hhYmxlLlxuICAgKi9cbiAgYXN5bmMgaXNPbmxpbmUoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5pc09ubGluZSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiAoYXdhaXQgdGhpcy5jb25maWcuaXNPbmxpbmUoKSkgIT09IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2NvcGUgc3RvcmUgYmFja2luZyBkZWNsYXJlZCBzY29wZXMgYW5kIGN1cnNvcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIikuZGVmYXVsdH0gU2NvcGUgc3RvcmUuXG4gICAqL1xuICBzY29wZVN0b3JlKCkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuXG4gICAgaWYgKHRoaXMuX3Njb3BlU3RvcmUgJiYgdGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJiB0aGlzLl9zY29wZVN0b3JlLnN0b3JlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgc3RvcmUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fc2NvcGVTdG9yZSB8fD0gbmV3IFN5bmNTY29wZVN0b3JlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIHRlbmFudEhhbmRsZTogdGhpcy5jb25maWcudGVuYW50SGFuZGxlXG4gICAgfSlcblxuICAgIHJldHVybiB0aGlzLl9zY29wZVN0b3JlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZyBmb3IgYSBsb2NhbCByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlY2xhcmVkIHJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHJlc291cmNlQ29uZmlnRm9yKHJlc291cmNlKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlPy5jb25zdHJ1Y3RvclxuXG4gICAgaWYgKHR5cGVvZiBtb2RlbENsYXNzPy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHJlc291cmNlcyBtdXN0IGJlIG1vZGVsIHJlY29yZHMgd2l0aCBhIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSwgZ290OiAke1N0cmluZyhyZXNvdXJjZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZykgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yOiAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN5bmMgdHlwZSBmb3IgYSBtdXRhdGlvbiB0aHJvdWdoIHRoZSByZXNvdXJjZSBjb25maWcuIFRoZVxuICAgKiBcInVwc2VydFwiIGZsYWcgcXVldWVzIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgYXMgXCJ1cGRhdGVcIiByb3dzICh0aGUgc2VydmVyXG4gICAqIHVwc2VydHMgYnkgcmVzb3VyY2UgaWQpIGFuZCBkZXN0cm95cyBhcyBcImRlbGV0ZVwiIHJvd3MuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIE11dGF0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMgdHlwZS5cbiAgICovXG4gIGRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDb25maWcuc3luY1R5cGUgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHJlc291cmNlQ29uZmlnLnN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZH0pXG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJkZXN0cm95XCIpIHJldHVybiBcImRlbGV0ZVwiXG4gICAgaWYgKHJlc291cmNlQ29uZmlnLnN5bmNUeXBlID09PSBcInVwc2VydFwiKSByZXR1cm4gXCJ1cGRhdGVcIlxuXG4gICAgcmV0dXJuIG9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIERlcml2ZXMgdGhlIHB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncyBmcm9tIHRoZSBkZWNsYXJlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSBbb3BlcmF0aW9uXSAtIFRlbmFudCBvcGVyYXRpb24gYmluZGluZyB0aGUgcmVzb3VyY2UgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz59IFB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncy5cbiAgICovXG4gIHB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKSB7XG4gICAgaWYgKCFvcGVyYXRpb24gJiYgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncykgcmV0dXJuIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3NcblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlncyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnPn0gKi8gKE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcylcbiAgICAgICAgLmZpbHRlcigoWywgcmVzb3VyY2VdKSA9PiBCb29sZWFuKHJlc291cmNlLmF0dHJpYnV0ZXMpKVxuICAgICAgICAubWFwKChbcmVzb3VyY2VUeXBlLCByZXNvdXJjZV0pID0+IHtcbiAgICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3MocmVzb3VyY2UubW9kZWxDbGFzcykgOiByZXNvdXJjZS5tb2RlbENsYXNzXG4gICAgICAgICAgY29uc3QgZmluZFJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmRcbiAgICAgICAgICBjb25zdCBmaW5kUmVjb3JkRm9yRGVsZXRlID0gcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZVxuXG4gICAgICAgICAgcmV0dXJuIFtyZXNvdXJjZVR5cGUsIHtcbiAgICAgICAgICAgIGFmdGVyQXBwbHk6IHJlc291cmNlLmFmdGVyQXBwbHksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZ1tcImF0dHJpYnV0ZXNcIl19ICovIChyZXNvdXJjZS5hdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBmaW5kUmVjb3JkOiBvcGVyYXRpb24gJiYgZmluZFJlY29yZFxuICAgICAgICAgICAgICA/IChhcmdzKSA9PiBmaW5kUmVjb3JkKHsuLi5hcmdzLCBtb2RlbENsYXNzLCBvcGVyYXRpb246IG9wZXJhdGlvbiB8fCBudWxsfSlcbiAgICAgICAgICAgICAgOiBmaW5kUmVjb3JkLFxuICAgICAgICAgICAgZmluZFJlY29yZEZvckRlbGV0ZTogb3BlcmF0aW9uICYmIGZpbmRSZWNvcmRGb3JEZWxldGVcbiAgICAgICAgICAgICAgPyAoYXJncykgPT4gZmluZFJlY29yZEZvckRlbGV0ZSh7Li4uYXJncywgbW9kZWxDbGFzcywgb3BlcmF0aW9uOiBvcGVyYXRpb24gfHwgbnVsbH0pXG4gICAgICAgICAgICAgIDogZmluZFJlY29yZEZvckRlbGV0ZSxcbiAgICAgICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgICAgICB9XVxuICAgICAgICB9KVxuICAgICkpXG5cbiAgICBpZiAoIW9wZXJhdGlvbikgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncyA9IHJlc291cmNlQ29uZmlnc1xuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9jYWwgc3RhdGUgd29yayBvbiB0aGlzIGNsaWVudCdzIGNhcHR1cmVkIHRlbmFudCwgb3IgZGlyZWN0bHkgZm9yIHRoZSBsZWdhY3kgZGVmYXVsdC1kYXRhYmFzZSBjbGllbnQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEJvdW5kIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoVGVuYW50T3BlcmF0aW9uKGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG51bGwpXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcudGVuYW50SGFuZGxlLmRhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgbmFtZTogXCJUZW5hbnQgU3luY0NsaWVudFwiXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5jb25maWcuc3luY01vZGVsKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB3aGV0aGVyIGEgcmVjb3JkIGJlbG9uZ3MgdG8gdGhpcyBjbGllbnQncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2FuZGlkYXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyBjbGllbnQgb3ducyBpdC5cbiAgICovXG4gIG93bnNSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgcmV0dXJuIHJlY29yZC5kYXRhYmFzZUlkZW50aXR5KCkgPT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiZcbiAgICAgIGRhdGFiYXNlT3BlcmF0aW9uPy5zY2hlbWFHZW5lcmF0aW9uKCkgPT09IHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIGEgcmVjb3JkIG5vdCBvd25lZCBieSB0aGlzIGNsaWVudCdzIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDYW5kaWRhdGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFJlY29yZE93bmVyc2hpcChyZWNvcmQpIHtcbiAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlc291cmNlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRlY2xhcmVkIHF1ZXJ5IGFnYWluc3QgdGhpcyBjbGllbnQncyBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gU2NvcGUgcXVlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLnRlbmFudEhhbmRsZSB8fCAhdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBxdWVyeS5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUudGVuYW50KCl9KVxuICAgIGNvbnN0IHF1ZXJ5RGF0YWJhc2VJZGVudGl0eSA9IHF1ZXJ5Ll9vcGVyYXRpb24/LmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyIHx8XG4gICAgICAhdGhpcy5jb25maWcucmVzb3VyY2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldIHx8XG4gICAgICBxdWVyeURhdGFiYXNlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgd29yayBhZnRlciB0aGUgaGFuZGxlJ3MgcmVhZHkgcGh5c2ljYWwgc2NoZW1hIGdlbmVyYXRpb24gY2hhbmdlZCBvciBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0VGVuYW50UmVhZHkoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuXG5cbiAgICBjb25zdCBsaWZlY3ljbGUgPSB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXJ9KVxuXG4gICAgaWYgKCFsaWZlY3ljbGUucmVhZHkgfHwgIWxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uIHx8IGxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uICE9PSB0aGlzLl90ZW5hbnRTY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudCBkYXRhYmFzZSBnZW5lcmF0aW9uIGlzIHN0YWxlIG9yIG5vdCByZWFkeVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIGN1c3RvbSByZW1vdGUgcmVzb2x2ZXIgcmVzdWx0IHRvIHRoZSBhY3RpdmUgdGVuYW50IG9wZXJhdGlvbiBhZnRlciBwcm92aW5nIGl0cyBjYXB0dXJlZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBCaW5kaW5nIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KSB7XG4gICAgaWYgKHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbj8uKCkgPT09IG9wZXJhdGlvbikgcmV0dXJuXG4gICAgdGhpcy5hc3NlcnRSZWNvcmRPd25lcnNoaXAocmVjb3JkKVxuICAgIG9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgcmVzb3VyY2UgY29uZmlnIGZyb20gYSBtb2RlbCdzIGBzdGF0aWMgc3luY2AgZGVjbGFyYXRpb24gcGx1cyBpdHNcbiAqIGRlcml2ZWQgY29sdW1uIG1ldGFkYXRhLlxuICogQHBhcmFtIHt7ZGVjbGFyYXRpb246IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb24sIG1ldGFkYXRhTW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBEZWNsYXJhdGlvbiBhcmdzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfSBEZXJpdmVkIHJlc291cmNlIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gcmVzb3VyY2VDb25maWdGcm9tU3luY0RlY2xhcmF0aW9uKHtkZWNsYXJhdGlvbiwgbWV0YWRhdGFNb2RlbENsYXNzLCBtb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWREZWNsYXJhdGlvbiA9IGRlY2xhcmF0aW9uID09PSB0cnVlID8ge30gOiBkZWNsYXJhdGlvblxuXG4gIGlmICghbm9ybWFsaXplZERlY2xhcmF0aW9uIHx8IHR5cGVvZiBub3JtYWxpemVkRGVjbGFyYXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShub3JtYWxpemVkRGVjbGFyYXRpb24pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgbXVzdCBiZSB0cnVlIG9yIGEgc3luYyBkZWNsYXJhdGlvbiBvYmplY3QsIGdvdDogJHtTdHJpbmcoZGVjbGFyYXRpb24pfWApXG4gIH1cblxuICBjb25zdCB7YWZ0ZXJBcHBseSwgYXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMsIGNvbmZsaWN0VHJhY2tpbmcsIGZpbmRSZWNvcmQsIGZpbmRSZWNvcmRGb3JEZWxldGUsIGxvY2FsT25seUF0dHJpYnV0ZXMsIHB1Ymxpc2gsIHJlYWx0aW1lLCBzeW5jVHlwZSwgdHJhY2ssIHRyYWNrZWREYXRhLCAuLi5yZXN0RGVjbGFyYXRpb259ID0gbm9ybWFsaXplZERlY2xhcmF0aW9uXG4gIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMocmVzdERlY2xhcmF0aW9uKVxuXG4gIC8vIGBwdWJsaXNoYCBpcyB0aGUgc2VydmVyLXNpZGUgaGFsZiBvZiB0aGUgc2hhcmVkIGBzdGF0aWMgc3luY2AgZGVjbGFyYXRpb25cbiAgLy8gKGNvbnN1bWVkIGJ5IFN5bmNQdWJsaXNoZXIgb24gdGhlIGJhY2tlbmQpIC0gdGhlIGNsaWVudCBkZXJpdmVzIG5vdGhpbmdcbiAgLy8gZnJvbSBpdCwgYnV0IG1vZGVscyBkZWNsYXJlZCBvbmNlIGZvciBib3RoIHNpZGVzIG11c3Qgc3RheSB2YWxpZCBoZXJlLlxuICB2b2lkIHB1Ymxpc2hcblxuICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHJlY2VpdmVkIHVua25vd24ga2V5czogJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGFmdGVyQXBwbHksIGF0dHJpYnV0ZXMsIGJvb2xlYW5BdHRyaWJ1dGVzLCBjb25mbGljdFRyYWNraW5nLCBmaW5kUmVjb3JkLCBmaW5kUmVjb3JkRm9yRGVsZXRlLCBsb2NhbE9ubHlBdHRyaWJ1dGVzLCBwdWJsaXNoLCByZWFsdGltZSwgc3luY1R5cGUsIHRyYWNrLCB0cmFja2VkRGF0YSlgKVxuICB9XG4gIGlmIChzeW5jVHlwZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBzeW5jVHlwZSAhPT0gXCJmdW5jdGlvblwiICYmIHN5bmNUeXBlICE9PSBcInVwc2VydFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgc3luY1R5cGUgbXVzdCBiZSBhIGZ1bmN0aW9uIG9yIHRoZSBzdHJpbmcgXCJ1cHNlcnRcIiwgZ290OiAke1N0cmluZyhzeW5jVHlwZSl9YClcbiAgfVxuXG4gIGNvbnN0IGRlcml2ZWQgPSBkZXJpdmVkU3luY0F0dHJpYnV0ZXMoe21vZGVsQ2xhc3M6IG1ldGFkYXRhTW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSlcblxuICBpZiAoY29uZmxpY3RUcmFja2luZykgdmFsaWRhdGVDb25mbGljdFRyYWNraW5nKHtjb25mbGljdFRyYWNraW5nLCBkZXJpdmVkLCByZXNvdXJjZVR5cGV9KVxuXG4gIHJldHVybiB7XG4gICAgYWZ0ZXJBcHBseSxcbiAgICBhdHRyaWJ1dGVzLFxuICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiBtZXJnZWRBdHRyaWJ1dGVOYW1lcyhkZXJpdmVkLmJvb2xlYW5BdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcyksXG4gICAgY29uZmxpY3RUcmFja2luZzogY29uZmxpY3RUcmFja2luZyA/IHsuLi5jb25mbGljdFRyYWNraW5nLCB2ZXJzaW9uQXR0cmlidXRlOiBjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgfHwgXCJ1cGRhdGVkQXRcIn0gOiB1bmRlZmluZWQsXG4gICAgZmluZFJlY29yZCxcbiAgICBmaW5kUmVjb3JkRm9yRGVsZXRlLFxuICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IG1lcmdlZEF0dHJpYnV0ZU5hbWVzKFxuICAgICAgZGVyaXZlZC5sb2NhbE9ubHlBdHRyaWJ1dGVzLFxuICAgICAgWy4uLihsb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSwgLi4uKGNvbmZsaWN0VHJhY2tpbmcgPyBbY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlIHx8IFwidXBkYXRlZEF0XCJdIDogW10pXVxuICAgICksXG4gICAgbWV0YWRhdGFNb2RlbENsYXNzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgcmVhbHRpbWUsXG4gICAgc3luY1R5cGUsXG4gICAgdHJhY2s6IG5vcm1hbGl6ZWRUcmFjayh0cmFjayksXG4gICAgdHJhY2tlZERhdGFcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgcmVzb3VyY2UncyBkdXJhYmxlIGNvbmZsaWN0LXRyYWNraW5nIGRlY2xhcmF0aW9uLlxuICogQHBhcmFtIHt7Y29uZmxpY3RUcmFja2luZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmxpY3RUcmFja2luZ0NvbmZpZywgZGVyaXZlZDoge2Jvb2xlYW5BdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbG9jYWxPbmx5QXR0cmlidXRlczogc3RyaW5nW119LCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBWYWxpZGF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVDb25mbGljdFRyYWNraW5nKHtjb25mbGljdFRyYWNraW5nLCBkZXJpdmVkLCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IHJlcXVpcmVkU3RyaW5ncyA9IHtcbiAgICBhY3RvckRldmljZUlkOiBjb25mbGljdFRyYWNraW5nLmFjdG9yRGV2aWNlSWQsXG4gICAgYWN0b3JVc2VySWQ6IGNvbmZsaWN0VHJhY2tpbmcuYWN0b3JVc2VySWQsXG4gICAgb2ZmbGluZUdyYW50SWQ6IGNvbmZsaWN0VHJhY2tpbmcub2ZmbGluZUdyYW50SWQsXG4gICAgcG9saWN5SGFzaDogY29uZmxpY3RUcmFja2luZy5wb2xpY3lIYXNoXG4gIH1cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyZXF1aXJlZFN0cmluZ3MpKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCB2YWx1ZS5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcuJHtrZXl9IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nYClcbiAgfVxuICBpZiAoIWNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgfHwgdHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgbXVzdCBiZSBhIExvY2FsTXV0YXRpb25Mb2dgKVxuICBpZiAodHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcuY2xpZW50TXV0YXRpb25JZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQgbXVzdCBiZSBhIGZ1bmN0aW9uYClcbiAgaWYgKCFjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgJiYgIWRlcml2ZWQubG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhcInVwZGF0ZWRBdFwiKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcgcmVxdWlyZXMgdmVyc2lvbkF0dHJpYnV0ZSBiZWNhdXNlIHRoZSBtb2RlbCBoYXMgbm8gdXBkYXRlZEF0IGNvbHVtbmApXG4gIH1cbn1cblxuLyoqXG4gKiBEZXJpdmVzIGJvb2xlYW4gYW5kIGxvY2FsLW9ubHkgYXR0cmlidXRlIG5hbWVzIGZyb20gYSBtb2RlbCdzIGNvbHVtbiBtZXRhZGF0YTpcbiAqIGJvb2xlYW5zIGZyb20gYm9vbGVhbiBjb2x1bW4gdHlwZXM7IGxvY2FsLW9ubHkgZnJvbSB0aGUgcHJpbWFyeSBrZXksXG4gKiBjcmVhdGVkQXQvdXBkYXRlZEF0LCBhbmQgc3luYyBib29ra2VlcGluZyBjb2x1bW5zLlxuICogQHBhcmFtIHt7bW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlcml2YXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHt7Ym9vbGVhbkF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBzdHJpbmdbXX19IERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBkZXJpdmVkU3luY0F0dHJpYnV0ZXMoe21vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pIHtcbiAgaWYgKFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5wcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCJcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVxdWlyZXMgYSBWZWxvY2lvdXMgbW9kZWwgY2xhc3Mgd2l0aCBjb2x1bW4gbWV0YWRhdGEgKGdldENvbHVtbk5hbWVzLCBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwLCBnZXRDb2x1bW5UeXBlQnlOYW1lLCBwcmltYXJ5S2V5LCBoYXNQcmltYXJ5S2V5KWApXG4gIH1cblxuICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYm9vbGVhbkF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBsb2NhbE9ubHlBdHRyaWJ1dGVzID0gW11cblxuICBpZiAobW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5KCkpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgRGVyaXZlZCBzeW5jIGF0dHJpYnV0ZXMgZm9yICR7cmVzb3VyY2VUeXBlfWApXG5cbiAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtwcmltYXJ5S2V5Q29sdW1uXSB8fCBwcmltYXJ5S2V5Q29sdW1uKVxuICB9XG5cbiAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZXMoKSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpICYmICFsb2NhbE9ubHlBdHRyaWJ1dGVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gICAgaWYgKGNvbHVtblR5cGUgJiYgaXNCb29sZWFuQ29sdW1uVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgYm9vbGVhbkF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7Ym9vbGVhbkF0dHJpYnV0ZXMsIGxvY2FsT25seUF0dHJpYnV0ZXN9XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlcml2ZWQgYXR0cmlidXRlIG5hbWVzIHdpdGggZGVjbGFyZWQgZXh0cmFzIGludG8gYSBzb3J0ZWQsIGR1cGxpY2F0ZS1mcmVlIGxpc3QuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXJpdmVkIC0gRGVyaXZlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSBkZWNsYXJlZCAtIERlY2xhcmVkIGV4dHJhIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gTWVyZ2VkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VkQXR0cmlidXRlTmFtZXMoZGVyaXZlZCwgZGVjbGFyZWQpIHtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KFsuLi5kZXJpdmVkLCAuLi4oZGVjbGFyZWQgfHwgW10pXSldLnNvcnQoKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBkZWNsYXJhdGlvbidzIHRyYWNrIHZhbHVlOiBhbiBvcGVyYXRpb25zIGFycmF5IGlzIHNob3J0aGFuZCBmb3JcbiAqIHRoZSB7b3BlcmF0aW9uc30gZm9ybS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbkNvbmZpZ1tcInRyYWNrXCJdfSB0cmFjayAtIERlY2xhcmVkIHRyYWNrIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnW1widHJhY2tcIl19IE5vcm1hbGl6ZWQgdHJhY2sgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZWRUcmFjayh0cmFjaykge1xuICBpZiAoQXJyYXkuaXNBcnJheSh0cmFjaykpIHJldHVybiB7b3BlcmF0aW9uczogdHJhY2t9XG5cbiAgcmV0dXJuIHRyYWNrXG59XG5cbi8qKlxuICogQnVpbGRzIGEgZnJhbWV3b3JrLW93bmVkIHN5bmMgZW5kcG9pbnQgUE9TVGVyIG92ZXIgdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0LlxuICogQHBhcmFtIHt7cGF0aDogc3RyaW5nLCByZXF1ZXN0Q29udGV4dDogaW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRUcmFuc3BvcnR9fSBhcmdzIC0gUG9zdGVyIGFyZ3MuXG4gKiBAcmV0dXJucyB7KHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IHtzaWduYWw/OiBBYm9ydFNpZ25hbH0pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBTeW5jIGVuZHBvaW50IFBPU1Rlci5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0UG9zdGVyKHtwYXRoLCByZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0fSkge1xuICByZXR1cm4gYXN5bmMgKHBheWxvYWQsIG9wdGlvbnMgPSB7fSkgPT4ge1xuICAgIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0gbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dCh7XG4gICAgICBjb250ZXh0OiByZXF1ZXN0Q29udGV4dCxcbiAgICAgIGxhYmVsOiBcIlN5bmMgY2xpZW50IHJlcXVlc3QgY29udGV4dFwiLFxuICAgICAgcGFyYW1zOiBwYXlsb2FkXG4gICAgfSlcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRyYW5zcG9ydC5wb3N0KHBhdGgsIHJlcXVlc3RQYXlsb2FkLCB7c2lnbmFsOiBvcHRpb25zLnNpZ25hbH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZS5qc29uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgdHJhbnNwb3J0LnBvc3QgbXVzdCByZXNvbHZlIHRvIGEgcmVzcG9uc2Ugd2l0aCBhIGpzb24oKSBtZXRob2QgZm9yICR7cGF0aH0gKGxpa2UgdGhlIGZyb250ZW5kLW1vZGVsIHdlYnNvY2tldCBjbGllbnQpYClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcmVzcG9uc2UuanNvbigpXG4gIH1cbn1cblxuLyoqXG4gKiBMYXppbHkgYnVpbGRzIChhbmQgbWVtb2l6ZXMgcGVyIGNvbmZpZ3VyYXRpb24pIHRoZSBzeW5jIGNsaWVudCBkZXJpdmVkIGZyb20gdGhlXG4gKiBhcHAncyBWZWxvY2lvdXMgY29uZmlndXJhdGlvbiBhbmQgcmVnaXN0ZXJzIGl0IGFzIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMgYW5kIHRoZSBzeW5jLmNsaWVudCBibG9jay4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtTeW5jQ2xpZW50fSBNZW1vaXplZCBzeW5jIGNsaWVudCBmb3IgdGhlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzeW5jQ2xpZW50KGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSkge1xuICBsZXQgY2xpZW50ID0gc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFjbGllbnQpIHtcbiAgICBjbGllbnQgPSBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pXG4gICAgc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24uc2V0KGNvbmZpZ3VyYXRpb24sIGNsaWVudClcbiAgICBjbGllbnQuc2V0Q3VycmVudCgpXG4gIH1cblxuICByZXR1cm4gY2xpZW50XG59XG5cbi8qKlxuICogRGVjbGFyZXMgYSBzeW5jIHNjb3BlIG9uIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBRdWVyeSBkZWNsYXJpbmcgdGhlIHN5bmMgc2NvcGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx7c2NvcGU6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZSwgcHVsbGVkOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9Pn0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3luYyhxdWVyeSkge1xuICByZXR1cm4gYXdhaXQgU3luY0NsaWVudC5jdXJyZW50KCkuc3luYyhxdWVyeSlcbn1cbiJdfQ==