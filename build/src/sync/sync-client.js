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
import SyncOfflineSession from "./sync-offline-session.js";
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
            const resourceConfig = resourceConfigFromSyncDeclaration({ declaration: modelClass.sync, metadataModelClass, modelClass, offlineConfigured: Boolean(clientConfiguration.offline), resourceType });
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
            offline: clientConfiguration.offline,
            offlinePost: transportPathPoster({ requestContext: capturedRequestContext, transport: clientConfiguration.transport }),
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
        /** @type {SyncOfflineSession | null} */
        this._offlineSession = null;
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
        /** @type {((reason: "mutation" | "realtime") => Promise<void>) | null} */
        this._coordinatorTrigger = null;
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
        this._trackingGeneration = 0;
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
        const trackingGeneration = this._trackingGeneration;
        await this._lifecycleTransitionPromise;
        if (trackingGeneration !== this._trackingGeneration)
            return;
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
        this._trackingGeneration += 1;
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
     * Attaches the one reusable coordinator that owns mutation and reconnect
     * cycles for this client. The returned detach only removes the same owner.
     * @param {(reason: "mutation" | "realtime") => Promise<void>} trigger - Coordinator trigger.
     * @returns {() => void} Idempotent detach callback.
     */
    attachCoordinator(trigger) {
        if (typeof trigger !== "function")
            throw new Error("SyncClient coordinator trigger must be a function");
        if (this._coordinatorTrigger)
            throw new Error("SyncClient already has an attached coordinator");
        this._coordinatorTrigger = trigger;
        return () => {
            if (this._coordinatorTrigger === trigger)
                this._coordinatorTrigger = null;
        };
    }
    /**
     * Routes framework-owned work through the attached coordinator, or returns
     * null so the legacy direct scheduling owner may run.
     * @param {"mutation" | "realtime"} reason - Trigger reason.
     * @returns {Promise<void> | null} Coordinator flight, or null without an owner.
     */
    requestCoordinatorSync(reason) {
        return this._coordinatorTrigger ? this._coordinatorTrigger(reason) : null;
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
     * Declares and activates the server-enumerated user scope without starting
     * realtime or pulling. Use this from SyncCoordinator.prepare() so the
     * coordinator remains the sole network ordering owner.
     * @returns {Promise<void>}
     */
    async activateUserScope() {
        await this._runLifecycleWork(async (signal) => await this._activateUserScope(signal));
    }
    /**
     * Activates the user scope under the current lifecycle generation.
     * @param {AbortSignal} signal - Lifecycle cancellation signal.
     * @returns {Promise<void>} - Resolves after the scope is durable.
     */
    async _activateUserScope(signal) {
        await this.scopeStore().findOrCreateScope(await this.userScope());
        this._throwIfLifecycleAborted(signal);
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
            await this._activateUserScope(signal);
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
                    offlineSession: this.config.offline ? this.offlineSession() : undefined,
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
            if (this.config.offline) {
                // Long-offline session configured: the signed offline session owns the
                // conflict-tracked mutation logs, so the background drain replays them
                // through the signed replay endpoint instead of the legacy unsigned
                // one. One owner per log — never both.
                await this._replayOfflinePending({ signal });
            }
            else {
                for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
                    if (!resourceConfig.conflictTracking)
                        continue;
                    await SyncApiClient.replayConflictTrackedSyncs({
                        applyConflict: async ({ record, result }) => await this.applyConflictReplayResult({ record, result, resourceType }),
                        authenticationToken: await this.config.authenticationToken(),
                        batchSize: this.config.batchSize,
                        conflictTracking: resourceConfig.conflictTracking,
                        postReplay: this.config.postReplay,
                        remoteGeneration: (identity) => this._remoteGenerations.get(identity) || 0,
                        resourceType,
                        signal
                    });
                }
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
     * Applies an authoritative serverModel returned by a conflict through the
     * same tenant-bound, tracking-suppressed applier used by pull/realtime.
     * A conflict result without serverModel has no authoritative state to apply
     * and remains diagnostic-only.
     * @param {{record: import("./local-mutation-log.js").LocalMutationLogRecord, resourceType: string, result: import("./sync-api-client-types.js").SyncReplayItem}} args - Conflict result.
     * @returns {Promise<void>}
     */
    async applyConflictReplayResult({ record, resourceType, result }) {
        const conflict = result.conflict;
        if (!conflict || !Object.hasOwn(conflict, "serverModel"))
            return;
        const serverModel = conflict.serverModel;
        if (serverModel !== null && (typeof serverModel !== "object" || Array.isArray(serverModel))) {
            throw new Error(`Sync conflict serverModel for ${resourceType} must be an object or null`);
        }
        const resourceId = record.mutation.payload?.resourceId;
        if (typeof resourceId !== "string" || resourceId.length === 0)
            throw new Error(`Sync conflict for ${resourceType} is missing resourceId`);
        const sync = SyncApiClient.syncEnvelopeFromPayload({
            data: serverModel,
            resourceId,
            resourceType,
            syncType: serverModel === null ? "delete" : "update"
        });
        await this.remoteApplySync({ source: "conflict server version" })(sync);
    }
    /**
     * Returns queue counts and privacy-safe conflicts for coordinator/UI status.
     * Full local/server payloads remain only in the durable mutation log.
     * @returns {Promise<import("./sync-coordinator-types.js").SyncClientInspection>} Durable sync state.
     */
    async inspectSyncState() {
        return await this._runLifecycleWork(async (signal) => {
            this._throwIfLifecycleAborted(signal);
            let pendingCount = 0;
            let rejectedCount = 0;
            /** @type {import("./sync-coordinator-types.js").SyncConflictDiagnostic[]} */
            const conflicts = [];
            for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
                if (!resourceConfig.conflictTracking)
                    continue;
                for (const record of await resourceConfig.conflictTracking.mutationLog.records()) {
                    if (record.mutation.model !== resourceType)
                        continue;
                    if (["pending", "applied-locally", "peer-applied"].includes(record.status))
                        pendingCount += 1;
                    if (record.status === "rejected")
                        rejectedCount += 1;
                    if (record.status === "conflict")
                        conflicts.push(syncConflictDiagnostic(record));
                }
                this._throwIfLifecycleAborted(signal);
            }
            pendingCount += await this.withTenantOperation(async (operation) => {
                const syncModel = operation ? operation.modelClass(this.config.syncModel) : this.config.syncModel;
                const pendingRows = await syncModel.preload({ resource: true }).where({ state: "pending" }).order("created_at").toArray();
                return pendingRows.length;
            });
            this._throwIfLifecycleAborted(signal);
            return { conflicts, pendingCount, rejectedCount };
        });
    }
    /**
     * Resolves a durable conflict on its declared resource log. Retry-local is
     * scheduled through the current coordinator when attached.
     * @param {{recordId: string, resolution: "keep-server" | "retry-local", resourceType: string}} args - Resolution.
     * @returns {Promise<import("./local-mutation-log.js").LocalMutationLogRecord>} - Resolved durable record.
     */
    async resolveConflict({ recordId, resolution, resourceType }) {
        return await this._runLifecycleWork(async (signal) => {
            const conflictTracking = this.config.resources[resourceType]?.conflictTracking;
            if (!conflictTracking)
                throw new Error(`No conflict-tracked sync resource configured for: ${resourceType}`);
            const record = await conflictTracking.mutationLog.resolveConflict({ id: recordId, resolution });
            this._throwIfLifecycleAborted(signal);
            if (resolution === "retry-local")
                this.scheduleReplay();
            return record;
        });
    }
    /**
     * Returns the framework-owned long-offline session built from
     * `sync.client.offline`, creating it on first use. Fails when the offline
     * configuration block is missing.
     * @returns {SyncOfflineSession} - The client's offline session.
     */
    offlineSession() {
        if (!this.config.offline) {
            throw new Error("SyncClient has no sync.client.offline configuration - configure deviceIdentityStorage, enrollDevice, and grantScopes to use the long-offline session");
        }
        if (!this._offlineSession) {
            this._offlineSession = new SyncOfflineSession({
                authenticationToken: this.config.authenticationToken,
                config: this.config.offline,
                mutationLogs: this.offlineMutationLogs(),
                post: this.config.offlinePost
            });
        }
        return this._offlineSession;
    }
    /**
     * Collects the durable mutation logs the offline session signs, replays,
     * re-signs, and exports: the configured `sync.client.offline.mutationLog`
     * when given, plus every conflict-tracking log declared by the synced models.
     * @returns {Array<import("./local-mutation-log.js").default>} - Session mutation logs.
     */
    offlineMutationLogs() {
        /** @type {Array<import("./local-mutation-log.js").default>} */
        const logs = [];
        if (this.config.offline?.mutationLog)
            logs.push(this.config.offline.mutationLog);
        for (const resourceConfig of Object.values(this.config.resources)) {
            const mutationLog = resourceConfig.conflictTracking?.mutationLog;
            if (!mutationLog)
                continue;
            if (logs.some((log) => log === mutationLog || log.storageKey === mutationLog.storageKey))
                continue;
            logs.push(mutationLog);
        }
        if (logs.length === 0)
            throw new Error("SyncClient offline session found no durable mutation log - declare conflictTracking on a synced model or configure sync.client.offline.mutationLog");
        return logs;
    }
    /**
     * Starts the long-offline session: resolves the device signing identity
     * (generating and enrolling a key pair when the app-owned storage has none)
     * and bootstraps a live offline grant through the built-in
     * `/frontend-models/sync/bootstrap` endpoint. Idempotent.
     * @returns {Promise<import("./sync-offline-session.js").SyncOfflineSessionSummary>} - Session summary (actor ids, live grant id, expiry).
     */
    async startOfflineSession() {
        return await this._runLifecycleWork(async (signal) => {
            this._throwIfLifecycleAborted(signal);
            const summary = await this.offlineSession().start();
            this._throwIfLifecycleAborted(signal);
            return summary;
        });
    }
    /**
     * Stops the long-offline session. The device identity and retained grants
     * stay in the app-owned durable storage; pending mutations stay in the
     * durable mutation logs and replay with the grant they were signed under.
     * @returns {Promise<void>} - Resolves after the session is stopped.
     */
    async stopOfflineSession() {
        if (!this._offlineSession)
            return;
        await this._offlineSession.stop();
    }
    /**
     * Bootstraps a fresh offline grant and re-signs this device's pending
     * mutations under it (the replay idempotency key is grant-id-free, so
     * re-signing never duplicates an intent).
     * @returns {Promise<import("./sync-offline-session.js").SyncOfflineSessionSummary>} - Refreshed session summary.
     */
    async refreshOfflineGrant() {
        return await this._runLifecycleWork(async (signal) => {
            this._throwIfLifecycleAborted(signal);
            const summary = await this.offlineSession().refreshGrant();
            this._throwIfLifecycleAborted(signal);
            return summary;
        });
    }
    /**
     * Drains the durable mutation logs through the built-in signed replay
     * endpoint (`/frontend-models/sync/replay`): ensures a live grant (refreshing
     * an expired one), batches pending signed mutations with the signed grant
     * each was signed under, and maps per-mutation results back onto the log
     * records as synced/conflict/rejected. Structured conflicts stay reachable
     * through the existing conflict contract (`syncResult.conflict` on the record
     * and `resolveConflict(...)`).
     * @param {object} [options] - Replay options.
     * @param {number} [options.batchSize] - Max signed mutations per request.
     * @returns {Promise<import("./sync-offline-session.js").SyncOfflineReplayResult>} - Mapped replay result.
     */
    async replayOfflinePending(options = {}) {
        return await this._runLifecycleWork(async (signal) => await this._replayOfflinePending({ ...options, signal }));
    }
    /**
     * Signed replay implementation bound to one lifecycle generation.
     * @param {object} [options] - Replay options.
     * @param {number} [options.batchSize] - Max signed mutations per request.
     * @param {AbortSignal} [options.signal] - Lifecycle cancellation signal.
     * @returns {Promise<import("./sync-offline-session.js").SyncOfflineReplayResult>} - Mapped replay result.
     */
    async _replayOfflinePending(options = {}) {
        const { signal, ...replayOptions } = options;
        const lifecycleSignal = signal ?? this._lifecycleAbortController.signal;
        this._throwIfLifecycleAborted(lifecycleSignal);
        const result = await this.offlineSession().replayPending({ ...replayOptions, signal: lifecycleSignal });
        this._throwIfLifecycleAborted(lifecycleSignal);
        for (const entry of result.results) {
            if (entry.status !== "conflict" || !entry.serverResult)
                continue;
            await this.applyOfflineConflictReplayResult(entry);
        }
        return result;
    }
    /**
     * Applies the authoritative server version carried by a signed replay
     * conflict result through the same conflict contract the online replay uses.
     * @param {{mutation: import("./device-identity.js").SyncMutation, serverResult: Record<string, ReturnType<typeof JSON.parse>> | null, status: string}} entry - Mapped replay result.
     * @returns {Promise<void>} - Resolves after the conflict server version is applied.
     */
    async applyOfflineConflictReplayResult(entry) {
        if (!entry.serverResult)
            return;
        const response = entry.serverResult.response;
        if (!response || typeof response !== "object" || Array.isArray(response))
            return;
        const conflict = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (response).conflict;
        if (!conflict || !Object.hasOwn(conflict, "serverModel"))
            return;
        await this.applyConflictReplayResult({
            record: /** @type {import("./local-mutation-log.js").LocalMutationLogRecord} */ ({ mutation: { payload: entry.mutation.payload } }),
            resourceType: entry.mutation.model,
            result: /** @type {import("./sync-api-client-types.js").SyncReplayItem} */ ({ conflict })
        });
    }
    /**
     * Exports the durable non-terminal mutations of the offline session's logs
     * as one signed peer bundle for device-to-device transfer.
     * @param {object} [options] - Export options.
     * @param {import("./local-mutation-log.js").LocalMutationStatus[]} [options.statuses] - Statuses to export.
     * @param {() => Date} [options.now] - Export clock.
     * @returns {Promise<import("./peer-mutation-bundle.js").PeerMutationBundle>} - Signed peer bundle.
     */
    async exportPeerBundle(options = {}) {
        return await this._runLifecycleWork(async (signal) => {
            this._throwIfLifecycleAborted(signal);
            return await this.offlineSession().exportBundle(options);
        });
    }
    /**
     * Imports a peer bundle into the local mutation log: every entry is verified
     * against the configured backend public key before it is appended, and
     * entries already present by idempotency key are skipped as duplicates.
     * @param {object} args - Import args.
     * @param {import("./peer-mutation-bundle.js").PeerMutationBundle} args.bundle - Peer bundle to import.
     * @param {import("./local-mutation-log.js").default} [args.mutationLog] - Target log. Defaults to the session's first log.
     * @returns {Promise<import("./peer-mutation-bundle.js").PeerMutationBundleImportResult>} - Import result (imported/rejected/skipped).
     */
    async importPeerBundle({ bundle, mutationLog }) {
        return await this._runLifecycleWork(async (signal) => {
            this._throwIfLifecycleAborted(signal);
            return await this.offlineSession().importBundle({ bundle, mutationLog });
        });
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
        const coordinatorRun = this.requestCoordinatorSync("mutation");
        if (coordinatorRun) {
            this._scheduledReplay = coordinatorRun;
            return;
        }
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
 * Builds privacy-safe conflict metadata from a durable record.
 * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Durable conflict record.
 * @returns {import("./sync-coordinator-types.js").SyncConflictDiagnostic} - Safe diagnostic.
 */
function syncConflictDiagnostic(record) {
    const conflict = record.syncResult?.conflict;
    const conflictObject = conflict && !(conflict instanceof Date) && typeof conflict === "object" && !Array.isArray(conflict)
        ? /** @type {Record<string, unknown>} */ (conflict)
        : {};
    const resourceId = record.mutation.payload?.resourceId;
    if (typeof resourceId !== "string" || resourceId.length === 0)
        throw new Error(`Sync conflict ${record.id} is missing a safe resourceId`);
    return {
        baseVersion: safeConflictVersion(conflictObject.baseVersion ?? record.mutation.baseVersion ?? null),
        clientMutationId: record.mutation.clientMutationId,
        localVersion: safeConflictVersion(conflictObject.localVersion ?? null),
        recordId: record.id,
        resourceId,
        resourceType: record.mutation.model,
        serverVersion: safeConflictVersion(conflictObject.serverVersion ?? null),
        versionAttribute: typeof conflictObject.versionAttribute === "string" ? conflictObject.versionAttribute : null
    };
}
/**
 * Restricts diagnostic versions to safe scalar values.
 * @param {unknown} value - Version candidate.
 * @returns {string | number | null} - Safe scalar version.
 */
function safeConflictVersion(value) {
    return value === null || typeof value === "string" || typeof value === "number" ? value : null;
}
/**
 * Builds one resource config from a model's `static sync` declaration plus its
 * derived column metadata.
 * @param {{declaration: import("./sync-client-types.js").ModelSyncDeclaration, metadataModelClass: ReturnType<typeof JSON.parse>, modelClass: ReturnType<typeof JSON.parse>, offlineConfigured?: boolean, resourceType: string}} args - Declaration args.
 * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Derived resource config.
 */
function resourceConfigFromSyncDeclaration({ declaration, metadataModelClass, modelClass, offlineConfigured = false, resourceType }) {
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
        validateConflictTracking({ conflictTracking, derived, offlineConfigured, resourceType });
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
 * @param {{conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig, derived: {booleanAttributes: string[], localOnlyAttributes: string[]}, offlineConfigured: boolean, resourceType: string}} args - Validation args.
 * @returns {void}
 */
function validateConflictTracking({ conflictTracking, derived, offlineConfigured, resourceType }) {
    const identityFields = {
        actorDeviceId: conflictTracking.actorDeviceId,
        actorUserId: conflictTracking.actorUserId,
        offlineGrantId: conflictTracking.offlineGrantId,
        policyHash: conflictTracking.policyHash
    };
    for (const [key, value] of Object.entries(identityFields)) {
        // Grants and policy hashes rotate at runtime: a declaration may provide a
        // static string, a function resolving the value at queue time, or omit the
        // key entirely when a `sync.client.offline` session supplies it.
        if (value === undefined && offlineConfigured)
            continue;
        if (typeof value === "function")
            continue;
        if (typeof value !== "string" || value.length === 0) {
            throw new Error(`${resourceType} conflictTracking.${key} must be a non-empty string, a function resolving one, or omitted when sync.client.offline supplies it`);
        }
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
 * Builds a framework-owned POSTer over the configured transport for a path
 * chosen at call time (used by the long-offline session's bootstrap/replay
 * endpoints, which live outside the sync.api mount path).
 * @param {{requestContext: import("../remote-request-context.js").RemoteRequestContext, transport: import("../configuration-types.js").VelociousSyncClientTransport}} args - Poster args.
 * @returns {(path: string, payload: Record<string, ReturnType<typeof JSON.parse>>, options?: {signal?: AbortSignal}) => Promise<ReturnType<typeof JSON.parse>>} Path-selecting sync endpoint POSTer.
 */
function transportPathPoster({ requestContext, transport }) {
    return async (path, payload, options = {}) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ25FLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGtCQUFrQixNQUFNLDJCQUEyQixDQUFBO0FBQzFELE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBQ2xELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSxvQkFBb0IsRUFBQyxNQUFNLDJCQUEyQixDQUFBO0FBRWpGLElBQUksYUFBYSxHQUFHLENBQUMsQ0FBQTtBQUVyQixzRkFBc0Y7QUFDdEYsTUFBTSxzQkFBc0IsR0FBRyxFQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFDLENBQUE7QUFFdEc7Ozs7O29EQUtvRDtBQUNwRCxNQUFNLDBCQUEwQixHQUFHLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO0FBRXZELGtHQUFrRztBQUNsRyxNQUFNLGlDQUFpQyxHQUFHLENBQUMsV0FB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QUNaLE1BQU0sR0FBRyxVQUFVLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDcEQsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUNyRCxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDckIsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFBO0FBQ2YsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLElBQUksQ0FBQyxLQUFLO0lBQzlCLE9BQU8sTUFBTSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQy9DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHtpc0Jvb2xlYW5Db2x1bW5UeXBlfSBmcm9tIFwiLi4vZGF0YWJhc2UvY29sdW1uLXR5cGVzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQge2NhcHR1cmVSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuXG5pbXBvcnQge3NlcmlhbGl6ZWRTY29wZUZyb21RdWVyeX0gZnJvbSBcIi4vcXVlcnktc2NvcGUuanNcIlxuaW1wb3J0IFN5bmNBcGlDbGllbnQgZnJvbSBcIi4vc3luYy1hcGktY2xpZW50LmpzXCJcbmltcG9ydCBTeW5jT2ZmbGluZVNlc3Npb24gZnJvbSBcIi4vc3luYy1vZmZsaW5lLXNlc3Npb24uanNcIlxuaW1wb3J0IFN5bmNSZWFsdGltZUJyaWRnZSBmcm9tIFwiLi9zeW5jLXJlYWx0aW1lLWJyaWRnZS5qc1wiXG5pbXBvcnQgU3luY1Njb3BlU3RvcmUgZnJvbSBcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiXG5pbXBvcnQge2N1cnJlbnRTeW5jQ2xpZW50LCBzZXRDdXJyZW50U3luY0NsaWVudH0gZnJvbSBcIi4vc3luYy1jbGllbnQtcmVnaXN0cnkuanNcIlxuXG5sZXQgY2xpZW50Q291bnRlciA9IDBcblxuLyoqIEB0eXBlIHt7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwifX0gKi9cbmNvbnN0IFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMgPSB7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwifVxuXG4vKipcbiAqIE9wZXJhdGlvbnMgdHJhY2tlZCBieSBkZWZhdWx0IGZvciBtb2RlbHMgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2Agd2l0aG91dCBhXG4gKiBgdHJhY2tgIGtleTogbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBxdWV1ZSBhdXRvbWF0aWNhbGx5LiBEZXN0cm95cyBhcmUgbm90XG4gKiB0cmFja2VkIGJ5IGRlZmF1bHQgYmVjYXVzZSBhIGxvY2FsIGRlc3Ryb3kgaXMgb2Z0ZW4gY2FjaGUgZXZpY3Rpb24gcmF0aGVyXG4gKiB0aGFuIGEgc2VydmVyIGRlbGV0ZTsgb3B0IGluIHdpdGggYHRyYWNrOiB0cnVlYCBvciBhbiBvcGVyYXRpb25zIGxpc3QuXG4gKiBAdHlwZSB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59ICovXG5jb25zdCBERUZBVUxUX1RSQUNLRURfT1BFUkFUSU9OUyA9IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXVxuXG4vKiogQXR0cmlidXRlIG5hbWVzIHRyZWF0ZWQgYXMgY2xpZW50LWxvY2FsIHN5bmMgYm9va2tlZXBpbmcgd2hlbiBkZXJpdmluZyBsb2NhbE9ubHlBdHRyaWJ1dGVzLiAqL1xuY29uc3QgTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTID0gW1wiY3JlYXRlZEF0XCIsIFwidXBkYXRlZEF0XCIsIFwibGFzdFN5bmNDaGFuZ2VBdFwiXVxuXG5jb25zdCBTWU5DX1JFUVVFU1RfUkVTRVJWRURfS0VZUyA9IFtcbiAgXCJhZnRlcklkXCIsXG4gIFwiYWZ0ZXJTZXJ2ZXJTZXF1ZW5jZVwiLFxuICBcImFmdGVyVXBkYXRlZEF0XCIsXG4gIFwiYXV0aGVudGljYXRpb25Ub2tlblwiLFxuICBcImxpbWl0XCIsXG4gIFwic2NvcGVcIixcbiAgXCJzeW5jc1wiLFxuICBcInVwc3RyZWFtUmVmcmVzaFwiLFxuICBcInVwVG9JZFwiLFxuICBcInVwVG9TZXJ2ZXJTZXF1ZW5jZVwiLFxuICBcInVwVG9VcGRhdGVkQXRcIlxuXVxuXG4vKiogQHR5cGUge1dlYWtNYXA8Q29uZmlndXJhdGlvbiwgU3luY0NsaWVudD59ICovXG5jb25zdCBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqIEV4cGVjdGVkIGNvb3BlcmF0aXZlIGNhbmNlbGxhdGlvbiByYWlzZWQgYnkgYSBTeW5jQ2xpZW50IGxpZmVjeWNsZSB0cmFuc2l0aW9uLiAqL1xuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogQnVpbGRzIGFuIGV4cGVjdGVkIGxpZmVjeWNsZSBjYW5jZWxsYXRpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiByZWFzb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIlN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIERlY2xhcmF0aXZlIGNsaWVudC1zaWRlIHN5bmMgZHJpdmVyLlxuICpcbiAqIEV2ZXJ5dGhpbmcgaXMgZGVyaXZlZCBmcm9tIHRoZSBhcHAncyBWZWxvY2lvdXMgY29uZmlndXJhdGlvbjogbW9kZWxzIGRlY2xhcmVcbiAqIGBzdGF0aWMgc3luY2AsIHRyYW5zcG9ydC9hdXRoL2Nvbm5lY3Rpdml0eSBjb21lIGZyb20gdGhlIGBzeW5jLmNsaWVudGBcbiAqIGNvbmZpZ3VyYXRpb24gYmxvY2ssIGFuZCBWZWxvY2lvdXMgb3ducyBzY29wZSBwZXJzaXN0ZW5jZSwgcGVyLXNjb3BlIGN1cnNvcnMsXG4gKiBwdWxsIHBhZ2luZy9hcHBseSwgbG9jYWwgcXVldWVpbmcsIGFuZCBvbmxpbmUtZ2F0ZWQgcmVwbGF5LiBEZWNsYXJlIHN5bmNcbiAqIGludGVyZXN0IGZyb20gcXVlcmllczpcbiAqXG4gKiAgICAgYXdhaXQgc3luY0NsaWVudCgpLnN0YXJ0KClcbiAqICAgICBhd2FpdCBzeW5jQ2xpZW50KCkuc3luYyhFdmVudC53aGVyZSh7cGFydG5lcklkfSkpXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNDbGllbnQge1xuICAvKipcbiAgICogQnVpbGRzIHRoZSBzeW5jIGNsaWVudCBieSBkZXJpdmluZyBldmVyeXRoaW5nIGZyb20gdGhlIGFwcCdzIFZlbG9jaW91c1xuICAgKiBjb25maWd1cmF0aW9uOiBldmVyeSByZWdpc3RlcmVkIG1vZGVsIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIGJlY29tZXMgYVxuICAgKiByZXNvdXJjZSB3aXRoIGJvb2xlYW5BdHRyaWJ1dGVzIGRlcml2ZWQgZnJvbSBjb2x1bW4gdHlwZXMgYW5kXG4gICAqIGxvY2FsT25seUF0dHJpYnV0ZXMgZGVyaXZlZCBmcm9tIHRoZSBwcmltYXJ5IGtleSwgY3JlYXRlZEF0L3VwZGF0ZWRBdCwgYW5kXG4gICAqIHN5bmMgYm9va2tlZXBpbmcgY29sdW1uczsgdGhlIHBlbmRpbmctc3luYyBtb2RlbCBpcyB0aGUgcmVnaXN0ZXJlZCBcIlN5bmNcIlxuICAgKiBtb2RlbDsgdHJhbnNwb3J0LCBhdXRoLCBjb25uZWN0aXZpdHksIGFuZCBlcnJvciByZXBvcnRpbmcgY29tZSBmcm9tIHRoZVxuICAgKiBgc3luYy5jbGllbnRgIGNvbmZpZ3VyYXRpb24gYmxvY2ssIHdpdGggdGhlIGZyYW1ld29yayBvd25pbmcgdGhlXG4gICAqIGAke21vdW50UGF0aH0vY2hhbmdlc2AgYW5kIGAke21vdW50UGF0aH0vcmVwbGF5YCBQT1NUZXJzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudE9wdGlvbnN9IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIGRhdGFiYXNlSWRlbnRpZmllciwgbGVnYWN5Q3Vyc29yLCByZXF1ZXN0Q29udGV4dCwgc2NvcGVTdG9yZSwgc3luY01vZGVsLCB0ZW5hbnRIYW5kbGUsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG5cbiAgICBjb25zdCBjbGllbnRDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpLmNsaWVudFxuICAgIGNvbnN0IGNhcHR1cmVkUmVxdWVzdENvbnRleHQgPSBjYXB0dXJlUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHtcbiAgICAgIGxhYmVsOiBcIlN5bmMgY2xpZW50IHJlcXVlc3QgY29udGV4dFwiLFxuICAgICAgcmVzZXJ2ZWRLZXlzOiBTWU5DX1JFUVVFU1RfUkVTRVJWRURfS0VZU1xuICAgIH0pXG5cbiAgICBpZiAoIWNsaWVudENvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgcmVxdWlyZXMgYSBzeW5jLmNsaWVudCBjb25maWd1cmF0aW9uIGJsb2NrOiBuZXcgQ29uZmlndXJhdGlvbih7c3luYzoge2NsaWVudDoge2F1dGhlbnRpY2F0aW9uVG9rZW4sIHRyYW5zcG9ydH19fSlcIilcbiAgICB9XG5cbiAgICBpZiAoQm9vbGVhbih0ZW5hbnRIYW5kbGUpICE9PSBCb29sZWFuKGRhdGFiYXNlSWRlbnRpZmllcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgdGVuYW50SGFuZGxlIGFuZCBkYXRhYmFzZUlkZW50aWZpZXIgbXVzdCBiZSBwcm92aWRlZCB0b2dldGhlclwiKVxuICAgIH1cbiAgICBpZiAodGVuYW50SGFuZGxlKSB7XG4gICAgICB0ZW5hbnRIYW5kbGUuYXNzZXJ0Q29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuICAgICAgdGVuYW50SGFuZGxlLmRhdGFiYXNlQ29uZmlndXJhdGlvbigvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcikpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxDbGFzc2VzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHJlc29sdmVkU3luY01vZGVsID0gc3luY01vZGVsIHx8IG1vZGVsQ2xhc3Nlcy5TeW5jXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGl0eSA9IHRlbmFudEhhbmRsZSA/IHRlbmFudEhhbmRsZS5kYXRhYmFzZUlkZW50aXR5KC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSkgOiBudWxsXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZz59ICovXG4gICAgY29uc3QgcmVzb3VyY2VzID0ge31cblxuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKG1vZGVsQ2xhc3NlcykpIHtcbiAgICAgIGlmICghbW9kZWxDbGFzcy5zeW5jKSBjb250aW51ZVxuICAgICAgaWYgKHRlbmFudEhhbmRsZSAmJiBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0ZW5hbnRIYW5kbGUudGVuYW50KCl9KSAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIGNvbnN0IG1ldGFkYXRhTW9kZWxDbGFzcyA9IHRlbmFudEhhbmRsZVxuICAgICAgICA/IHRlbmFudEhhbmRsZS5tZXRhZGF0YU1vZGVsQ2xhc3Moe2RhdGFiYXNlSWRlbnRpZmllcjogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpLCBtb2RlbENsYXNzfSlcbiAgICAgICAgOiBtb2RlbENsYXNzXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHJlc291cmNlQ29uZmlnRnJvbVN5bmNEZWNsYXJhdGlvbih7ZGVjbGFyYXRpb246IG1vZGVsQ2xhc3Muc3luYywgbWV0YWRhdGFNb2RlbENsYXNzLCBtb2RlbENsYXNzLCBvZmZsaW5lQ29uZmlndXJlZDogQm9vbGVhbihjbGllbnRDb25maWd1cmF0aW9uLm9mZmxpbmUpLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgICBpZiAoZGF0YWJhc2VJZGVudGl0eSAmJiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcgPSB7XG4gICAgICAgICAgLi4ucmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgICBtdXRhdGlvbkxvZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5wYXJ0aXRpb24oZGF0YWJhc2VJZGVudGl0eSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXNvdXJjZXNbcmVzb3VyY2VUeXBlXSA9IHJlc291cmNlQ29uZmlnXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlc291cmNlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IGZvdW5kIG5vIHJlZ2lzdGVyZWQgbW9kZWxzIGRlY2xhcmluZyBzdGF0aWMgc3luYyAtIGRlY2xhcmUgYHN0YXRpYyBzeW5jID0gdHJ1ZWAgKG9yIGEgc3luYyBkZWNsYXJhdGlvbiBvYmplY3QpIG9uIHRoZSBtb2RlbHMgdGhhdCBzaG91bGQgc3luY1wiKVxuICAgIH1cblxuICAgIGlmICghcmVzb2x2ZWRTeW5jTW9kZWwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgcmVxdWlyZXMgYSByZWdpc3RlcmVkIFxcXCJTeW5jXFxcIiBtb2RlbCBmb3IgcGVuZGluZyBsb2NhbCBzeW5jIHJvd3MgKG9yIHBhc3Mgb3B0aW9ucy5zeW5jTW9kZWwpXCIpXG4gICAgfVxuICAgIGlmICh0ZW5hbnRIYW5kbGUgJiYgcmVzb2x2ZWRTeW5jTW9kZWwuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IHRlbmFudEhhbmRsZS50ZW5hbnQoKX0pICE9PSBkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCBzeW5jIG1vZGVsIGRvZXMgbm90IHVzZSB0ZW5hbnQgZGF0YWJhc2UgJHtKU09OLnN0cmluZ2lmeShkYXRhYmFzZUlkZW50aWZpZXIpfWApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25maWd9ICovXG4gICAgdGhpcy5jb25maWcgPSB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBjbGllbnRDb25maWd1cmF0aW9uLmF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemU6IGNsaWVudENvbmZpZ3VyYXRpb24uYmF0Y2hTaXplLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIGlzT25saW5lOiBjbGllbnRDb25maWd1cmF0aW9uLmlzT25saW5lLFxuICAgICAgbGVnYWN5Q3Vyc29yLFxuICAgICAgb25FcnJvcjogY2xpZW50Q29uZmlndXJhdGlvbi5vbkVycm9yLFxuICAgICAgb2ZmbGluZTogY2xpZW50Q29uZmlndXJhdGlvbi5vZmZsaW5lLFxuICAgICAgb2ZmbGluZVBvc3Q6IHRyYW5zcG9ydFBhdGhQb3N0ZXIoe3JlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICBwb3N0Q2hhbmdlczogdHJhbnNwb3J0UG9zdGVyKHtwYXRoOiBgJHtjbGllbnRDb25maWd1cmF0aW9uLm1vdW50UGF0aH0vY2hhbmdlc2AsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICBwb3N0UmVwbGF5OiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9yZXBsYXlgLCByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0OiBjbGllbnRDb25maWd1cmF0aW9uLnRyYW5zcG9ydH0pLFxuICAgICAgcmVhbHRpbWU6IGNsaWVudENvbmZpZ3VyYXRpb24ucmVhbHRpbWUsXG4gICAgICByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCxcbiAgICAgIHJlc291cmNlcyxcbiAgICAgIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWwsXG4gICAgICB0ZW5hbnRIYW5kbGUsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQ6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0Q2xpZW50LFxuICAgICAgd2Vic29ja2V0VXJsOiBjbGllbnRDb25maWd1cmF0aW9uLndlYnNvY2tldFVybFxuICAgIH1cbiAgICB0aGlzLl9jbGllbnROdW1iZXIgPSArK2NsaWVudENvdW50ZXJcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ID0gZGF0YWJhc2VJZGVudGl0eVxuICAgIHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb24gPSB0ZW5hbnRIYW5kbGVcbiAgICAgID8gdGVuYW50SGFuZGxlLmluc3BlY3Qoe2RhdGFiYXNlSWRlbnRpZmllcjogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpfSkuc2NoZW1hR2VuZXJhdGlvblxuICAgICAgOiBudWxsXG4gICAgLyoqIEB0eXBlIHtTeW5jUmVhbHRpbWVCcmlkZ2UgfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWx0aW1lQnJpZGdlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7U3luY09mZmxpbmVTZXNzaW9uIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9vZmZsaW5lU2Vzc2lvbiA9IG51bGxcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFNoYXJlZENvbm5lY3Rpb24gfCBudWxsIHwgdW5kZWZpbmVkfSBTaGFyZWQgYXBwLWxpZmV0aW1lIHdlYnNvY2tldCBjb25uZWN0aW9uICh1bmRlZmluZWQgdW50aWwgZmlyc3QgcmVzb2x2ZWQsIG51bGwgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQpLiAqL1xuICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7XCJzdWJzY3JpYmVkXCIgfCBcInN1YnNjcmliaW5nXCIgfCBcInVuc3Vic2NyaWJlZFwifSAqL1xuICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLXNjb3BlLXN0b3JlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIHRoaXMuX3Njb3BlU3RvcmUgPSBzY29wZVN0b3JlIHx8IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3NjaGVkdWxlZFJlcGxheSA9IG51bGxcbiAgICAvKiogQHR5cGUgeygocmVhc29uOiBcIm11dGF0aW9uXCIgfCBcInJlYWx0aW1lXCIpID0+IFByb21pc2U8dm9pZD4pIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9jb29yZGluYXRvclRyaWdnZXIgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWc+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9wdWxsUmVzb3VyY2VDb25maWdzID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2NhbGxiYWNrOiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQsIGNhbGxiYWNrTmFtZTogXCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiwgbW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8b2JqZWN0Pn0gKi9cbiAgICB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPG9iamVjdCwgQXJyYXk8c3RyaW5nIHwgbnVtYmVyIHwgbnVsbD4+fSAqL1xuICAgIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoID0gMFxuICAgIC8qKiBAdHlwZSB7TG9nZ2VyIHwge2Vycm9yOiAoLi4ubWVzc2FnZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn0gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvZ2dlciA9IG51bGxcbiAgICAvKiogQHR5cGUge1NldDxQcm9taXNlPHVua25vd24+Pn0gKi9cbiAgICB0aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrID0gbmV3IFNldCgpXG4gICAgdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpXG4gICAgdGhpcy5fbGlmZWN5Y2xlR2VuZXJhdGlvbiA9IDBcbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgPSAwXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Qcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl90cmFja2luZ0dlbmVyYXRpb24gPSAwXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGF1dG9tYXRpYyBtdXRhdGlvbiB0cmFja2luZyBmb3IgZXZlcnkgZGVjbGFyZWQgcmVzb3VyY2UgKG9uIGJ5XG4gICAqIGRlZmF1bHQ6IGxvY2FsIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgcXVldWUgcGVuZGluZyBzeW5jIHJvd3Mgb25jZSB0aGVpclxuICAgKiB0cmFuc2FjdGlvbiBjb21taXRzIGFuZCBzY2hlZHVsZSBhbiBpbW1lZGlhdGUgcmVwbGF5IGF0dGVtcHQsIHdpdGhvdXRcbiAgICogYXBwLXNpZGUgcXVldWUgY2FsbHMpLiBgdHJhY2s6IGZhbHNlYCByZXNvdXJjZXMgYXJlIHNraXBwZWQ7IGB0cmFjazogdHJ1ZWBcbiAgICogYWRkcyBkZXN0cm95czsgYW4gb3BlcmF0aW9ucyBsaXN0IG5hcnJvd3MgdGhlIHRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICBjb25zdCB0cmFja2luZ0dlbmVyYXRpb24gPSB0aGlzLl90cmFja2luZ0dlbmVyYXRpb25cblxuICAgIGF3YWl0IHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Qcm9taXNlXG4gICAgaWYgKHRyYWNraW5nR2VuZXJhdGlvbiAhPT0gdGhpcy5fdHJhY2tpbmdHZW5lcmF0aW9uKSByZXR1cm5cbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAodGhpcy5fc3RhcnRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydGVkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgY29uc3Qgb3BlcmF0aW9ucyA9IHRoaXMudHJhY2tlZE9wZXJhdGlvbnMoe3Jlc291cmNlQ29uZmlnLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgICBpZiAocmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IFwiY3JlYXRlXCIpKSB7XG4gICAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gb3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIiA/IFwiYmVmb3JlRGVzdHJveVwiIDogXCJiZWZvcmVVcGRhdGVcIlxuICAgICAgICAgIGNvbnN0IGNhbGxiYWNrID0gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIHJlY29yZCkgPT4ge1xuICAgICAgICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICAgICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRWZXJzaW9ucyA9IHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLmdldChyZWNvcmQpIHx8IFtdXG5cbiAgICAgICAgICAgIGNhcHR1cmVkVmVyc2lvbnMucHVzaCh0aGlzLnByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pKVxuICAgICAgICAgICAgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuc2V0KHJlY29yZCwgY2FwdHVyZWRWZXJzaW9ucylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzW2NhbGxiYWNrTmFtZV0oY2FsbGJhY2spXG4gICAgICAgICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrTmFtZSA9IFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVNbb3BlcmF0aW9uXVxuICAgICAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMudHJhY2tlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYWxsIHRyYWNraW5nIGNhbGxiYWNrcywgYWJvcnRzIGluLWZsaWdodCBwdWxsL3JlcGxheS9yZWFsdGltZVxuICAgKiB3b3JrIGFuZCByZXNvbHZlcyBhZnRlciBpdCBpcyBxdWllc2NlbnQuIE9wdGlvbmFsIHNlbGVjdGVkIHNjb3BlIHJlc2V0IGFuZFxuICAgKiBhcHAtb3duZWQgY2xlYW51cCBoYXBwZW4gYWZ0ZXIgb2xkIHdvcmsgZHJhaW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFN0b3BPcHRpb25zfSBbb3B0aW9uc10gLSBTdG9wIGFuZCBzZWxlY3RlZC1zY29wZSByZXNldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0b3Aob3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5fdHJhY2tpbmdHZW5lcmF0aW9uICs9IDFcblxuICAgIGZvciAoY29uc3Qge2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3N9IG9mIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MpIHtcbiAgICAgIG1vZGVsQ2xhc3MudW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcyA9IFtdXG4gICAgdGhpcy5fc3RhcnRlZCA9IGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5fcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZShvcHRpb25zKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQWJvcnRzIGFuZCBkcmFpbnMgY3VycmVudCB3b3JrLCB0aGVuIGF0b21pY2FsbHkgcmVzZXRzIHNlbGVjdGVkIHNjb3BlXG4gICAqIGN1cnNvcnMgdG9nZXRoZXIgd2l0aCBhbiBvcHRpb25hbCBhcHAtb3duZWQgbG9jYWwtcm93IGNsZWFudXAgaG9vay5cbiAgICogVHJhY2tpbmcgZGVjbGFyYXRpb25zIHJlbWFpbiByZWdpc3RlcmVkIHNvIHRoZSBzYW1lIGNsaWVudCBtYXkgY29udGludWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlW119IHNjb3BlcyAtIFNlbGVjdGVkIHNjb3BlcyB0byByZXNldC5cbiAgICogQHBhcmFtIHt7Y2xlYW51cD86IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFNjb3BlQ2xlYW51cH19IFtvcHRpb25zXSAtIFNjb3BlIGNsZWFudXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXNldFNjb3BlcyhzY29wZXMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcmVzZXRTY29wZXNGb3JMaWZlY3ljbGUoey4uLm9wdGlvbnMsIHJlc2V0U2NvcGVzOiBzY29wZXN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGUgZXh0ZXJuYWwgaWRlbnRpdHkgcmVhZCBieSB0aGUgY29uZmlndXJlZCBhdXRoIGFuZFxuICAgKiBzY29wZS1vd25lciByZXNvbHZlcnM6IG9sZCB3b3JrIGlzIGFib3J0ZWQgYW5kIGRyYWluZWQsIHNlbGVjdGVkIHByaXZhdGVcbiAgICogc2NvcGUgc3RhdGUvY2FjaGUgaXMgcmVzZXQsIHRoZW4gdGhlIGFwcCdzIHJlcGxhY2VtZW50IGNhbGxiYWNrIHJ1bnMgd2hpbGVcbiAgICogbmV3IHN5bmMgd29yayByZW1haW5zIGJlaGluZCB0aGUgbGlmZWN5Y2xlIGJhcnJpZXIuIE9wdGlvbmFsbHkgc3Vic2NyaWJlc1xuICAgKiB0aGUgbmV3IHVzZXIgc2NvcGUgYmVmb3JlIHJlc29sdmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXBsYWNlSWRlbnRpdHlPcHRpb25zfSBvcHRpb25zIC0gSWRlbnRpdHkgcmVwbGFjZW1lbnQgY29udHJhY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZUlkZW50aXR5KG9wdGlvbnMpIHtcbiAgICBpZiAoIW9wdGlvbnMgfHwgdHlwZW9mIG9wdGlvbnMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudC5yZXBsYWNlSWRlbnRpdHkgcmVxdWlyZXMgYW4gb3B0aW9ucyBvYmplY3RcIilcbiAgICB9XG5cbiAgICBjb25zdCB7Y2xlYW51cCwgcmVwbGFjZSwgcmVzZXRTY29wZXMgPSBbXSwgc3Vic2NyaWJlVXNlclNjb3BlID0gZmFsc2UsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG4gICAgaWYgKHR5cGVvZiByZXBsYWNlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQucmVwbGFjZUlkZW50aXR5IHJlcXVpcmVzIGEgcmVwbGFjZSBjYWxsYmFja1wiKVxuICAgIGlmICh0eXBlb2Ygc3Vic2NyaWJlVXNlclNjb3BlICE9PSBcImJvb2xlYW5cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudC5yZXBsYWNlSWRlbnRpdHkgc3Vic2NyaWJlVXNlclNjb3BlIG11c3QgYmUgYm9vbGVhblwiKVxuXG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZSh7Y2xlYW51cCwgcmVzZXRTY29wZXN9KVxuICAgICAgYXdhaXQgcmVwbGFjZSgpXG4gICAgfSlcblxuICAgIGlmIChzdWJzY3JpYmVVc2VyU2NvcGUpIGF3YWl0IHRoaXMuc3Vic2NyaWJlVXNlclNjb3BlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBjYWxsYmFjayB3aGlsZSBob2xkaW5nIHRoZSBjdXJyZW50IGxpZmVjeWNsZSBnZW5lcmF0aW9uIGFuZFxuICAgKiB0cmFja3MgaXQgc28gc3RvcC9yZXNldC9pZGVudGl0eSByZXBsYWNlbWVudCBjYW4gYXdhaXQgcXVpZXNjZW5jZS5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0geyhzaWduYWw6IEFib3J0U2lnbmFsKSA9PiBQcm9taXNlPFJlc3VsdD59IGNhbGxiYWNrIC0gR2VuZXJhdGlvbi1ib3VuZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuTGlmZWN5Y2xlV29yayhjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgPiAwKSBhd2FpdCB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZVxuXG4gICAgY29uc3Qgc2lnbmFsID0gdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyLnNpZ25hbFxuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IGNhbGxiYWNrKHNpZ25hbClcblxuICAgIHRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmsuYWRkKHByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fYWN0aXZlTGlmZWN5Y2xlV29yay5kZWxldGUocHJvbWlzZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtdXRhdGlvbiBxdWV1ZWluZyBvbmx5IHdoaWxlIHRoZSBsaWZlY3ljbGUgZ2VuZXJhdGlvbiBjYXB0dXJlZCBieSB0aGVcbiAgICogY2FsbGVyIHJlbWFpbnMgYWN0aXZlLiBVbmxpa2UgcHVsbHMsIGEgbXV0YXRpb24gbXVzdCBuZXZlciB3YWl0IHRocm91Z2ggYW5cbiAgICogaWRlbnRpdHkgdHJhbnNpdGlvbiBhbmQgdGhlbiBwZXJzaXN0IHVuZGVyIHRoZSByZXBsYWNlbWVudCBpZGVudGl0eS5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge251bWJlcn0gbGlmZWN5Y2xlR2VuZXJhdGlvbiAtIEdlbmVyYXRpb24gb3duaW5nIHRoZSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJlc3VsdD59IGNhbGxiYWNrIC0gTXV0YXRpb24gcXVldWVpbmcgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1bk11dGF0aW9uTGlmZWN5Y2xlV29yayhsaWZlY3ljbGVHZW5lcmF0aW9uLCBjYWxsYmFjaykge1xuICAgIHRoaXMuX2Fzc2VydE11dGF0aW9uTGlmZWN5Y2xlR2VuZXJhdGlvbihsaWZlY3ljbGVHZW5lcmF0aW9uKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5fYXNzZXJ0TXV0YXRpb25MaWZlY3ljbGVHZW5lcmF0aW9uKGxpZmVjeWNsZUdlbmVyYXRpb24pXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIG11dGF0aW9uIHF1ZXVlaW5nIGNhcHR1cmVkIG91dHNpZGUgdGhlIGN1cnJlbnQgc3RhYmxlIGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGxpZmVjeWNsZUdlbmVyYXRpb24gLSBHZW5lcmF0aW9uIG93bmluZyB0aGUgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2VydE11dGF0aW9uTGlmZWN5Y2xlR2VuZXJhdGlvbihsaWZlY3ljbGVHZW5lcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCA9PT0gMCAmJiBsaWZlY3ljbGVHZW5lcmF0aW9uID09PSB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgbXV0YXRpb24gYmVsb25ncyB0byBhbiBpbmFjdGl2ZSBsaWZlY3ljbGUgZ2VuZXJhdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYSBsaWZlY3ljbGUgYmFycmllcjogY29vcGVyYXRpdmVseSBhYm9ydHMgdHJhbnNwb3J0L3N0YXJ0IHdvcmssXG4gICAqIHN0b3BzIG5ldyByZWFsdGltZSBkZWxpdmVyeSwgYXdhaXRzIG9sZCBhcHBsaWVzL3JlcGxheXMvcHVsbHMsIHJlamVjdHMgb25cbiAgICogdW5leHBlY3RlZCBvbGQtd29yayBmYWlsdXJlcywgdGhlbiBydW5zIHRoZSByZXNldC9yZXBsYWNlbWVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFRyYW5zaXRpb24gYWN0aW9uIGFmdGVyIHF1aWVzY2VuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgX3J1bkxpZmVjeWNsZVRyYW5zaXRpb24oY2FsbGJhY2spIHtcbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgKz0gMVxuXG4gICAgLy8gdW5zdWJzY3JpYmUoKSBpbnZhbGlkYXRlcyB0aGUgc3Vic2NyaXB0aW9uIGdlbmVyYXRpb24gc3luY2hyb25vdXNseSwgc29cbiAgICAvLyBhbiBvbGQgb25SZXN1bWUvb25NZXNzYWdlIGNhbGxiYWNrIGNhbm5vdCBlbnRlciB0aGlzIHRyYW5zaXRpb24ncyBkcmFpbi5cbiAgICBjb25zdCByZWFsdGltZVVuc3Vic2NyaWJlUHJvbWlzZSA9IHRoaXMuX3JlYWx0aW1lQnJpZGdlPy51bnN1YnNjcmliZSgpXG4gICAgY29uc3QgcHJldmlvdXNUcmFuc2l0aW9uID0gdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2VcbiAgICBjb25zdCB0cmFuc2l0aW9uID0gcHJldmlvdXNUcmFuc2l0aW9uLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWJvcnRDb250cm9sbGVyID0gdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyXG4gICAgICBjb25zdCBhYm9ydFJlYXNvbiA9IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSB3YXMgc3RvcHBlZFwiKVxuXG4gICAgICBhYm9ydENvbnRyb2xsZXIuYWJvcnQoYWJvcnRSZWFzb24pXG5cbiAgICAgIGlmIChyZWFsdGltZVVuc3Vic2NyaWJlUHJvbWlzZSkgYXdhaXQgcmVhbHRpbWVVbnN1YnNjcmliZVByb21pc2VcblxuICAgICAgY29uc3Qgd29ya1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmtdKVxuXG4gICAgICBpZiAodGhpcy5fcmVhbHRpbWVCcmlkZ2UpIGF3YWl0IHRoaXMuX3JlYWx0aW1lQnJpZGdlLndhaXRGb3JBcHBsaWVkKClcblxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCB1bmV4cGVjdGVkRXJyb3JzID0gW11cblxuICAgICAgZm9yIChjb25zdCByZXN1bHQgb2Ygd29ya1Jlc3VsdHMpIHtcbiAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIiAmJiAhdGhpcy5pc0xpZmVjeWNsZUFib3J0KHJlc3VsdC5yZWFzb24pKSB1bmV4cGVjdGVkRXJyb3JzLnB1c2gocmVzdWx0LnJlYXNvbilcbiAgICAgIH1cblxuICAgICAgaWYgKHVuZXhwZWN0ZWRFcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyB1bmV4cGVjdGVkRXJyb3JzWzBdXG4gICAgICBpZiAodW5leHBlY3RlZEVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IodW5leHBlY3RlZEVycm9ycywgXCJTeW5jIGNsaWVudCBsaWZlY3ljbGUgZmFpbGVkIHdoaWxlIGJlY29taW5nIHF1aWVzY2VudFwiKVxuXG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAgIHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb24gKz0gMVxuICAgICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvbkNvdW50IC09IDFcbiAgICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICB9KVxuXG4gICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2UgPSB0cmFuc2l0aW9uLnRoZW4oKCkgPT4gdW5kZWZpbmVkLCAoKSA9PiB1bmRlZmluZWQpXG5cbiAgICByZXR1cm4gdHJhbnNpdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0cyBzZWxlY3RlZCBzY29wZXMgdGhyb3VnaCB0aGUgZnJhbWV3b3JrLW93bmVkIHN0b3JlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFN0b3BPcHRpb25zfSBvcHRpb25zIC0gUmVzZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcmVzZXRTY29wZXNGb3JMaWZlY3ljbGUob3B0aW9ucykge1xuICAgIGNvbnN0IHtjbGVhbnVwLCByZXNldFNjb3BlcyA9IFtdLCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RPcHRpb25zKVxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNldFNjb3BlcykpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IHJlc2V0U2NvcGVzIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICBpZiAoY2xlYW51cCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBjbGVhbnVwICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IGNsZWFudXAgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgaWYgKGNsZWFudXAgJiYgcmVzZXRTY29wZXMubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNsaWVudCBjbGVhbnVwIHJlcXVpcmVzIGF0IGxlYXN0IG9uZSByZXNldCBzY29wZVwiKVxuICAgIGlmIChyZXNldFNjb3Blcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkucmVzZXQocmVzZXRTY29wZXMsIHtjbGVhbnVwfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGVycm9yIGlzIHRoZSBmcmFtZXdvcmsncyBuYXJyb3cgZXhwZWN0ZWQgbGlmZWN5Y2xlIGFib3J0LlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2FuZGlkYXRlIGVycm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgZXJyb3IgaXMgYW4gZXhwZWN0ZWQgbGlmZWN5Y2xlIGFib3J0LlxuICAgKi9cbiAgaXNMaWZlY3ljbGVBYm9ydChlcnJvcikge1xuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yXG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIHRoZSBjdXJyZW50IGxpZmVjeWNsZSByZWFzb24gd2hlbiB0aGUgc2lnbmFsIGlzIGFib3J0ZWQuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IHNpZ25hbCAtIExpZmVjeWNsZSBzaWduYWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbCkge1xuICAgIGlmICghc2lnbmFsLmFib3J0ZWQpIHJldHVyblxuXG4gICAgdGhyb3cgc2lnbmFsLnJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gc2lnbmFsLnJlYXNvbiA6IG5ldyBTeW5jQ2xpZW50TGlmZWN5Y2xlQWJvcnRFcnJvcihcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSB3YXMgc3RvcHBlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuZCB2YWxpZGF0ZXMgdGhlIHRyYWNrZWQgb3BlcmF0aW9ucyBmb3IgYSByZXNvdXJjZSBjb25maWcuXG4gICAqIFRyYWNraW5nIGlzIG9uIGJ5IGRlZmF1bHQ6IG1vZGVscyBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCB3aXRob3V0IGEgYHRyYWNrYFxuICAgKiBrZXkgcXVldWUgbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBhdXRvbWF0aWNhbGx5OyBgdHJhY2s6IGZhbHNlYCBvcHRzIGFcbiAgICogbW9kZWwgb3V0IChmb3IgbW9kZWxzIHdyaXR0ZW4gYnkgbm9uLXVzZXIgZmxvd3MpLlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIFJlc291cmNlIGNvbmZpZyBhbmQgbmFtZS5cbiAgICogQHJldHVybnMge0FycmF5PFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCI+fSBUcmFja2VkIG9wZXJhdGlvbnMuXG4gICAqL1xuICB0cmFja2VkT3BlcmF0aW9ucyh7cmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZX0pIHtcbiAgICBjb25zdCB0cmFjayA9IHJlc291cmNlQ29uZmlnLnRyYWNrXG5cbiAgICBpZiAodHJhY2sgPT09IGZhbHNlKSByZXR1cm4gW11cbiAgICBpZiAodHJhY2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIERFRkFVTFRfVFJBQ0tFRF9PUEVSQVRJT05TXG4gICAgaWYgKHRyYWNrID09PSB0cnVlKSByZXR1cm4gW1wiY3JlYXRlXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXVxuXG4gICAgaWYgKCF0cmFjayB8fCB0eXBlb2YgdHJhY2sgIT09IFwib2JqZWN0XCIgfHwgIUFycmF5LmlzQXJyYXkodHJhY2sub3BlcmF0aW9ucykgfHwgdHJhY2sub3BlcmF0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCByZXNvdXJjZSAke3Jlc291cmNlVHlwZX0gdHJhY2sgbXVzdCBiZSB0cnVlIG9yIHtvcGVyYXRpb25zOiBbLi4uXX1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIHRyYWNrLm9wZXJhdGlvbnMpIHtcbiAgICAgIGlmICghKG9wZXJhdGlvbiBpbiBUUkFDS0VEX0NBTExCQUNLX05BTUVTKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNDbGllbnQgcmVzb3VyY2UgJHtyZXNvdXJjZVR5cGV9IHRyYWNrLm9wZXJhdGlvbnMgbXVzdCBiZSBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3ksIGdvdDogJHtTdHJpbmcob3BlcmF0aW9uKX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cmFjay5vcGVyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsaWZlY3ljbGUgY2FsbGJhY2sgcXVldWVpbmcgb25lIHRyYWNrZWQgbXV0YXRpb24uIFRoZSBxdWV1ZWRcbiAgICogcGF5bG9hZCBhbmQgc3luYyB0eXBlIGFyZSBzbmFwc2hvdHRlZCBhdCBtdXRhdGlvbi1jYWxsYmFjayB0aW1lLCBzb1xuICAgKiBhZnRlclNhdmUgaG9va3MgYXNzaWduaW5nIHVuc2F2ZWQgYXR0cmlidXRlcyAob3IgYW55IGxhdGVyIGRyaWZ0IG9uIHRoZVxuICAgKiByZWNvcmQpIGNhbm5vdCBjaGFuZ2Ugd2hhdCBnZXRzIHF1ZXVlZCB2cyB3aGF0IHdhcyBjb21taXR0ZWQuIFF1ZXVlaW5nIGlzXG4gICAqIGRlZmVycmVkIHRocm91Z2ggdGhlIG1vZGVsIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIGl0IG9ubHkgcnVuc1xuICAgKiBvbmNlIHRoZSBtdXRhdGlvbidzIHRyYW5zYWN0aW9uIGhhcyBjb21taXR0ZWQgKGltbWVkaWF0ZWx5IHdoZW4gbm9cbiAgICogdHJhbnNhY3Rpb24gaXMgb3BlbikgLSBxdWV1ZWQgc3luY3MgbmV2ZXIgcmVmZXJlbmNlIHJvbGxlZC1iYWNrIHJvd3MuXG4gICAqIFBvc3QtY29tbWl0IHF1ZXVlIGZhaWx1cmVzIGFyZSByZXBvcnRlZCB3aXRob3V0IHJldGhyb3dpbmcgaW50byB0aGVcbiAgICogZHJpdmVyJ3MgYWZ0ZXJDb21taXQgY2hhaW4gKHNlZSByZXBvcnRBZnRlckNvbW1pdEVycm9yKS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gT3BlcmF0aW9uIGFuZCByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHsocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUHJvbWlzZTx2b2lkPn0gTGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKi9cbiAgdHJhY2tlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgcmV0dXJuIGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGlmICghdGhpcy5vd25zUmVjb3JkKHJlY29yZCkpIHJldHVyblxuICAgICAgaWYgKHRoaXMuaXNUcmFja2luZ1N1cHByZXNzZWQocmVjb3JkKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGxpZmVjeWNsZUdlbmVyYXRpb24gPSB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uXG4gICAgICBjb25zdCBkYXRhID0gU3luY0FwaUNsaWVudC5xdWV1ZWRTeW5jRGF0YSh7XG4gICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgZGF0YTogcmVzb3VyY2VDb25maWcudHJhY2tlZERhdGEgPyByZXNvdXJjZUNvbmZpZy50cmFja2VkRGF0YSh7b3BlcmF0aW9uLCByZWNvcmR9KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogcmVzb3VyY2VDb25maWcubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgcmVzb3VyY2U6IHJlY29yZFxuICAgICAgfSlcbiAgICAgIGNvbnN0IHN5bmNUeXBlID0gdGhpcy5kZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICBjb25zdCBiYXNlVmVyc2lvbiA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmdcbiAgICAgICAgPyB0aGlzLmNhcHR1cmVkQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gICAgICAgIDogbnVsbFxuICAgICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuICAgICAgY29uc3Qgb3BlcmF0aW9uU2NvcGUgPSBkYXRhYmFzZU9wZXJhdGlvblxuICAgICAgICA/IGRhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKHRoaXMuY29uZmlnLnN5bmNNb2RlbClcbiAgICAgICAgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcblxuICAgICAgYXdhaXQgcmVjb3JkLmNvbm5lY3Rpb24oKS5hZnRlckNvbW1pdChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTXV0YXRpb25MaWZlY3ljbGVXb3JrKGxpZmVjeWNsZUdlbmVyYXRpb24sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgICAgICAgICBiYXNlVmVyc2lvbixcbiAgICAgICAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgICAgICAgIHJlc291cmNlOiByZWNvcmQsXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiByZWNvcmQuY29uc3RydWN0b3IuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgICAgICAgc3luY1R5cGVcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVMb2NhbFN5bmMoe2RhdGEsIHJlc291cmNlOiByZWNvcmQsIHN5bmNNb2RlbDogb3BlcmF0aW9uU2NvcGUsIHN5bmNUeXBlfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmICh0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpKSByZXR1cm5cblxuICAgICAgICAgIGF3YWl0IHRoaXMucmVwb3J0QWZ0ZXJDb21taXRFcnJvcigvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnNjaGVkdWxlUmVwbGF5KClcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCB0cmFja2VkLXF1ZXVlaW5nIGZhaWx1cmUuIFRoZSB0cmFuc2FjdGlvbiBoYXMgYWxyZWFkeVxuICAgKiBjb21taXR0ZWQgd2hlbiBhZnRlckNvbW1pdCBjYWxsYmFja3MgcnVuLCBzbyByZXRocm93aW5nIGhlcmUgd291bGQgcG9pc29uXG4gICAqIHRoZSBkcml2ZXIncyBhd2FpdGVkIGFmdGVyQ29tbWl0IGNoYWluIChicmVha2luZyB1bnJlbGF0ZWQgY2FsbGJhY2tzKSAtXG4gICAqIGluc3RlYWQgdGhlIGZhaWx1cmUgZ29lcyB0byB0aGUgY29uZmlndXJlZCBzeW5jLmNsaWVudC5vbkVycm9yIGhvb2ssIG9yIGlzXG4gICAqIGxvZ2dlZCBsb3VkbHkgdGhyb3VnaCB0aGUgY2xpZW50J3MgbG9nZ2VyIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIFBvc3QtY29tbWl0IHF1ZXVlaW5nIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwb3J0QWZ0ZXJDb21taXRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlcigpLmVycm9yKFwiU3luY0NsaWVudCBmYWlsZWQgdG8gcXVldWUgYSB0cmFja2VkIG11dGF0aW9uIGFmdGVyIGNvbW1pdFwiLCBlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgY2xpZW50IGxvZ2dlci5cbiAgICogQHJldHVybnMge0xvZ2dlciB8IHtlcnJvcjogKC4uLm1lc3NhZ2VzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8dm9pZD59fSBDbGllbnQgbG9nZ2VyLlxuICAgKi9cbiAgbG9nZ2VyKCkge1xuICAgIHRoaXMuX2xvZ2dlciB8fD0gbmV3IExvZ2dlcihcIlN5bmNDbGllbnRcIiwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb259KVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvZ2dlclxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSByZWNvcmQgaXMgY3VycmVudGx5IGJlaW5nIHdyaXR0ZW4gYnkgcHVsbC1hcHBseSAoZWNobyBzdXBwcmVzc2lvbikuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHJlY29yZCB3cml0ZSBvcmlnaW5hdGVzIGZyb20gYSByZW1vdGUgY2hhbmdlLlxuICAgKi9cbiAgaXNSZW1vdGVBcHBseShyZWNvcmQpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmhhcyhyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0cmFja2VkIG11dGF0aW9uIHF1ZXVlaW5nIGlzIGN1cnJlbnRseSBzdXBwcmVzc2VkIGZvciBhIHJlY29yZDpcbiAgICogZWl0aGVyIHRoZSByZWNvcmQgd2FzIG1hcmtlZCBhcyBhIHJlbW90ZSBhcHBseSAoYG1hcmtSZW1vdGVBcHBseWAsIHVzZWQgYnlcbiAgICogcHVsbCBhbmQgcmVhbHRpbWUgYXBwbGllcykgb3IgYSBgd2l0aG91dFRyYWNraW5nYCBjYWxsYmFjayBpcyBydW5uaW5nIG9uXG4gICAqIHRoaXMgY2xpZW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRyYWNrZWQgcXVldWVpbmcgaXMgc3VwcHJlc3NlZCBmb3IgdGhlIHJlY29yZC5cbiAgICovXG4gIGlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkge1xuICAgIHJldHVybiB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aCA+IDAgfHwgdGhpcy5pc1JlbW90ZUFwcGx5KHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aCB0cmFja2VkIG11dGF0aW9uIHF1ZXVlaW5nIHN1cHByZXNzZWQgb24gdGhpcyBjbGllbnQgLVxuICAgKiBmb3IgY29kZSBhcHBseWluZyBzZXJ2ZXItb3JpZ2luYXRlZCBkYXRhIG91dHNpZGUgdGhlIGRlcml2ZWQgcHVsbC9yZWFsdGltZVxuICAgKiBhcHBsaWVycyAobGVnYWN5IHB1bGwgcGF0aHMsIGltcG9ydGVycywgc2lnbi1pbiBiYWNrZmlsbHMpLCBzbyB0aGVpciB3cml0ZXNcbiAgICogYXJlIG5vdCBlY2hvZWQgYmFjayB0byB0aGUgc2VydmVyIGFzIGRldmljZSBjaGFuZ2VzLiBTdXBwcmVzc2lvbiBjb3ZlcnMgdGhlXG4gICAqIHdob2xlIGFzeW5jIGR1cmF0aW9uIG9mIHRoZSBjYWxsYmFjayAobmVzdGVkIGNhbGxzIHN0YWNrKSBhbmQgaXNcbiAgICogY2xpZW50LXdpZGUgd2hpbGUgaXQgcnVuczogbXV0YXRpb25zIGZyb20gY29uY3VycmVudGx5IHJ1bm5pbmcgdGFza3MgYXJlXG4gICAqIGFsc28gc3VwcHJlc3NlZCBmb3IgdGhhdCB3aW5kb3csIHNvIHByZWZlciBgbWFya1JlbW90ZUFwcGx5KHJlY29yZClgIHdoZW5cbiAgICogd3JpdGVzIGZyb20gb3RoZXIgZmxvd3MgY2FuIGludGVybGVhdmUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPiB8IFR9IGNhbGxiYWNrIC0gV29yayB3aG9zZSBtb2RlbCB3cml0ZXMgc2hvdWxkIG5vdCBxdWV1ZSB0cmFja2VkIHN5bmNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gVGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhvdXRUcmFja2luZyhjYWxsYmFjaykge1xuICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoKytcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl93aXRob3V0VHJhY2tpbmdEZXB0aC0tXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIG9uZSByZWNvcmQgYXMgYmVpbmcgd3JpdHRlbiBmcm9tIHNlcnZlci1vcmlnaW5hdGVkIGRhdGEgc28gdHJhY2tlZFxuICAgKiBtdXRhdGlvbiBxdWV1ZWluZyBza2lwcyBpdCAocmVjb3JkLXByZWNpc2Ugc3VwcHJlc3Npb24pLiBUaGUgZGVyaXZlZCBwdWxsXG4gICAqIGFuZCByZWFsdGltZSBhcHBsaWVycyB1c2UgdGhpcyBpbnRlcm5hbGx5IGFyb3VuZCBldmVyeSBhcHBsaWVkIHdyaXRlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBMb2NhbCBtb2RlbCByZWNvcmQgYWJvdXQgdG8gYmUgd3JpdHRlbi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFJlbGVhc2UgY2FsbGJhY2sgcmUtZW5hYmxpbmcgdHJhY2tpbmcgZm9yIHRoZSByZWNvcmQuXG4gICAqL1xuICBtYXJrUmVtb3RlQXBwbHkocmVjb3JkKSB7XG4gICAgdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmFkZChyZWNvcmQpXG5cbiAgICByZXR1cm4gKCkgPT4gdGhpcy5fcmVtb3RlQXBwbHlSZWNvcmRzLmRlbGV0ZShyZWNvcmQpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoaXMgY2xpZW50IGFzIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2V0Q3VycmVudFN5bmNDbGllbnQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2hlcyB0aGUgb25lIHJldXNhYmxlIGNvb3JkaW5hdG9yIHRoYXQgb3ducyBtdXRhdGlvbiBhbmQgcmVjb25uZWN0XG4gICAqIGN5Y2xlcyBmb3IgdGhpcyBjbGllbnQuIFRoZSByZXR1cm5lZCBkZXRhY2ggb25seSByZW1vdmVzIHRoZSBzYW1lIG93bmVyLlxuICAgKiBAcGFyYW0geyhyZWFzb246IFwibXV0YXRpb25cIiB8IFwicmVhbHRpbWVcIikgPT4gUHJvbWlzZTx2b2lkPn0gdHJpZ2dlciAtIENvb3JkaW5hdG9yIHRyaWdnZXIuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSBJZGVtcG90ZW50IGRldGFjaCBjYWxsYmFjay5cbiAgICovXG4gIGF0dGFjaENvb3JkaW5hdG9yKHRyaWdnZXIpIHtcbiAgICBpZiAodHlwZW9mIHRyaWdnZXIgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBjb29yZGluYXRvciB0cmlnZ2VyIG11c3QgYmUgYSBmdW5jdGlvblwiKVxuICAgIGlmICh0aGlzLl9jb29yZGluYXRvclRyaWdnZXIpIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgYWxyZWFkeSBoYXMgYW4gYXR0YWNoZWQgY29vcmRpbmF0b3JcIilcblxuICAgIHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlciA9IHRyaWdnZXJcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fY29vcmRpbmF0b3JUcmlnZ2VyID09PSB0cmlnZ2VyKSB0aGlzLl9jb29yZGluYXRvclRyaWdnZXIgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJvdXRlcyBmcmFtZXdvcmstb3duZWQgd29yayB0aHJvdWdoIHRoZSBhdHRhY2hlZCBjb29yZGluYXRvciwgb3IgcmV0dXJuc1xuICAgKiBudWxsIHNvIHRoZSBsZWdhY3kgZGlyZWN0IHNjaGVkdWxpbmcgb3duZXIgbWF5IHJ1bi5cbiAgICogQHBhcmFtIHtcIm11dGF0aW9uXCIgfCBcInJlYWx0aW1lXCJ9IHJlYXNvbiAtIFRyaWdnZXIgcmVhc29uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPiB8IG51bGx9IENvb3JkaW5hdG9yIGZsaWdodCwgb3IgbnVsbCB3aXRob3V0IGFuIG93bmVyLlxuICAgKi9cbiAgcmVxdWVzdENvb3JkaW5hdG9yU3luYyhyZWFzb24pIHtcbiAgICByZXR1cm4gdGhpcy5fY29vcmRpbmF0b3JUcmlnZ2VyID8gdGhpcy5fY29vcmRpbmF0b3JUcmlnZ2VyKHJlYXNvbikgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwJ3MgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1N5bmNDbGllbnR9IEN1cnJlbnQgc3luYyBjbGllbnQuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudCgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtTeW5jQ2xpZW50fSAqLyAoY3VycmVudFN5bmNDbGllbnQoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzeW5jIGNsaWVudCBkZXJpdmVkIGZyb20gdGhlIGdpdmVuIGNvbmZpZ3VyYXRpb24uIEFsaWFzIGZvclxuICAgKiBgbmV3IFN5bmNDbGllbnQoe2NvbmZpZ3VyYXRpb24sIC4uLm9wdGlvbnN9KWAuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzIGFuZCB0aGUgc3luYy5jbGllbnQgYmxvY2suIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7T21pdDxpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRPcHRpb25zLCBcImNvbmZpZ3VyYXRpb25cIj59IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICogQHJldHVybnMge1N5bmNDbGllbnR9IFN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBmcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBuZXcgU3luY0NsaWVudCh7Li4ub3B0aW9ucywgY29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgKG9yIHJlLWFjdGl2YXRlcykgYSBzeW5jIHNjb3BlIGZyb20gYSBtb2RlbCBxdWVyeSBhbmQgcHVsbHMgaXQgd2hlbiBvbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgZGVjbGFyaW5nIHRoZSBzeW5jIHNjb3BlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gU3luYyBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSBvZiB0aGUgcHVsbCB0aGlzIGRlY2xhcmF0aW9uIHRyaWdnZXJzLCBzbyB0aGUgaW5pdGlhbCBpbXBvcnQgb2YgYSBuZXdseSBkZWNsYXJlZCBzY29wZSBjYW4gZHJpdmUgYSBcInN5bmNlZENvdW50IG9mIHRvdGFsXCIgcHJvZ3Jlc3MgYmFyLiBTZWUgYHB1bGwoKWAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIE1hcmtzIHRoZSBjaGFuZ2VzIHJlcXVlc3QocykgYXMgYSB1c2VyLWluaXRpYXRlZCByZWZyZXNoLCBzbyB0aGUgc2VydmVyIGNhbiBieXBhc3MgdXBzdHJlYW0taW1wb3J0IHRocm90dGxlIHdpbmRvd3MuIFNlZSBgcHVsbCgpYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3Njb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGUsIHB1bGxlZDogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfT59IERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdCAobnVsbCB3aGlsZSBvZmZsaW5lKS5cbiAgICovXG4gIGFzeW5jIHN5bmMocXVlcnksIHtvblByb2dyZXNzLCB1cHN0cmVhbVJlZnJlc2h9ID0ge30pIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGNvbnN0IHNjb3BlID0gc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KVxuICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgIGNvbnN0IHNjb3BlUm93ID0gYXdhaXQgc2NvcGVTdG9yZS5maW5kT3JDcmVhdGVTY29wZShzY29wZSlcblxuICAgIGlmICghc2NvcGVSb3cuY3Vyc29yUGF5bG9hZCAmJiB0aGlzLmNvbmZpZy5sZWdhY3lDdXJzb3IpIHtcbiAgICAgIGNvbnN0IGxlZ2FjeUN1cnNvclBheWxvYWQgPSBhd2FpdCB0aGlzLmNvbmZpZy5sZWdhY3lDdXJzb3Ioe3Njb3BlfSlcbiAgICAgIGNvbnN0IGxlZ2FjeUN1cnNvciA9IFN5bmNBcGlDbGllbnQuc3luY0N1cnNvckZyb21QYXlsb2FkKGxlZ2FjeUN1cnNvclBheWxvYWQpXG5cbiAgICAgIGlmIChsZWdhY3lDdXJzb3IpIGF3YWl0IHNjb3BlU3RvcmUuc2F2ZUN1cnNvcihzY29wZVJvdywgbGVnYWN5Q3Vyc29yKVxuICAgIH1cblxuICAgIHJldHVybiB7cHVsbGVkOiBhd2FpdCB0aGlzLnB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0pLCBzY29wZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWFjdGl2YXRlcyB0aGUgc3luYyBzY29wZSBkZWNsYXJlZCBieSBhIG1vZGVsIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIFF1ZXJ5IHdob3NlIHNjb3BlIHNob3VsZCBzdG9wIHN5bmNpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zeW5jKHF1ZXJ5KSB7XG4gICAgdGhpcy5hc3NlcnRRdWVyeU93bmVyc2hpcChxdWVyeSlcbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5kZWFjdGl2YXRlKHNlcmlhbGl6ZWRTY29wZUZyb21RdWVyeShxdWVyeSkpXG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgY2hhbmdlcyBmb3IgZXZlcnkgYWN0aXZlIHNjb3BlIHdpdGggcGVyLXNjb3BlIGN1cnNvcnMgKHNpbmdsZS1mbGlnaHRlZCwgb25saW5lLWdhdGVkKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFB1bGwgb3B0aW9ucy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFtvcHRpb25zLm9uUHJvZ3Jlc3NdIC0gQ2FsbGVkIHBlciBhcHBsaWVkIHBhZ2Ugd2l0aCBjdW11bGF0aXZlIGB7cGFnZXMsIHN5bmNlZENvdW50LCB0b3RhbH1gIGFjcm9zcyB0aGUgcHVsbGVkIHNjb3BlcywgZm9yIHJlbmRlcmluZyBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIgKGUuZy4gYSBmdWxsLWltcG9ydCBzY3JlZW4pLiBPcHRpb25hbDsgb21pdHRpbmcgaXQga2VlcHMgdGhlIGV4aXN0aW5nIGJlaGF2aW9yLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnVwc3RyZWFtUmVmcmVzaF0gLSBTZW5kcyBgdXBzdHJlYW1SZWZyZXNoOiB0cnVlYCBvbiB0aGUgY2hhbmdlcyByZXF1ZXN0KHMpLCB0ZWxsaW5nIHRoZSBzZXJ2ZXIgdGhpcyBwdWxsIGlzIHVzZXItaW5pdGlhdGVkIHNvIGl0IGNhbiBieXBhc3MgdXBzdHJlYW0taW1wb3J0IHRocm90dGxlIHdpbmRvd3MgKHNlZSBkb2NzL3N5bmMtdXBzdHJlYW0taW1wb3J0cy5tZCkuIEJhY2tncm91bmQgcHVsbHMgb21pdCBpdCBhbmQgc3RheSB0aHJvdHRsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbD59IENvbWJpbmVkIHB1bGwgcmVzdWx0LCBvciBudWxsIHdoaWxlIG9mZmxpbmUuXG4gICAqL1xuICBhc3luYyBwdWxsKHtvblByb2dyZXNzLCB1cHN0cmVhbVJlZnJlc2h9ID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9wdWxsKHtvblByb2dyZXNzLCBzaWduYWwsIHVwc3RyZWFtUmVmcmVzaH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGwgaW1wbGVtZW50YXRpb24gYm91bmQgdG8gb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFB1bGwgYXJncy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IGFyZ3Muc2lnbmFsIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MudXBzdHJlYW1SZWZyZXNoXSAtIFVzZXItaW5pdGlhdGVkIHVwc3RyZWFtIHJlZnJlc2ggbWFya2VyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGw+fSBDb21iaW5lZCBwdWxsIHJlc3VsdCwgb3IgbnVsbCB3aGlsZSBvZmZsaW5lLlxuICAgKi9cbiAgYXN5bmMgX3B1bGwoe29uUHJvZ3Jlc3MsIHNpZ25hbCwgdXBzdHJlYW1SZWZyZXNofSkge1xuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAoIShhd2FpdCB0aGlzLmlzT25saW5lKCkpKSByZXR1cm4gbnVsbFxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfSAqL1xuICAgIGxldCBjb21iaW5lZFJlc3VsdCA9IG51bGxcblxuICAgIGF3YWl0IFN5bmNBcGlDbGllbnQuc2luZ2xlRmxpZ2h0KGB2ZWxvY2lvdXMtc3luYy1jbGllbnQtcHVsbC0ke3RoaXMuX2NsaWVudE51bWJlcn1gLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBjb25zdCBhdXRoZW50aWNhdGlvblRva2VuID0gYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBjb25zdCBzY29wZVN0b3JlID0gdGhpcy5zY29wZVN0b3JlKClcbiAgICAgIGNvbnN0IGFwcGx5U3luYyA9IHRoaXMucmVtb3RlQXBwbHlTeW5jKClcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHtcbiAgICAgICAgY2hhbmdlZDogZmFsc2UsXG4gICAgICAgIHBhZ2VzOiAwLFxuICAgICAgICByZXNvdXJjZUNoYW5nZWQ6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovICh7fSksXG4gICAgICAgIHJlc291cmNlQ291bnRzOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSksXG4gICAgICAgIHN5bmNlZENvdW50OiAwLFxuICAgICAgICB0b3RhbDogMFxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHNjb3BlUm93IG9mIGF3YWl0IHNjb3BlU3RvcmUuYWN0aXZlU2NvcGVzKCkpIHtcbiAgICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgICAvLyBDdW11bGF0ZSBzY29wZSBwcm9ncmVzcyBvbnRvIHRoZSBjb3VudHMgb2YgdGhlIHNjb3BlcyBhbHJlYWR5IHB1bGxlZCBzbyBhIHNpbmdsZVxuICAgICAgICAvLyBzY29wZSdzIHBlci1wYWdlIHByb2dyZXNzIHJlYWRzIGV4YWN0bHkgaXRzIG93biBjb3VudHMgKGJhc2UgMCksIGFuZCBtdWx0aS1zY29wZVxuICAgICAgICAvLyBwdWxscyByZXBvcnQgYSBydW5uaW5nIGN1bXVsYXRpdmUgdG90YWwgYWNyb3NzIGV2ZXJ5IHNjb3BlLlxuICAgICAgICBjb25zdCBiYXNlUGFnZXMgPSByZXN1bHQucGFnZXNcbiAgICAgICAgY29uc3QgYmFzZVN5bmNlZENvdW50ID0gcmVzdWx0LnN5bmNlZENvdW50XG4gICAgICAgIGNvbnN0IGJhc2VUb3RhbCA9IHJlc3VsdC50b3RhbFxuICAgICAgICBjb25zdCBzY29wZVJlc3VsdCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucHVsbENoYW5nZXMoe1xuICAgICAgICAgIGFwcGx5U3luYyxcbiAgICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICAgIGxvYWRDdXJzb3I6IGFzeW5jICgpID0+IGF3YWl0IHNjb3BlU3RvcmUubG9hZEN1cnNvcihzY29wZVJvdyksXG4gICAgICAgICAgb25Qcm9ncmVzczogb25Qcm9ncmVzcyA/IChwcm9ncmVzcykgPT4gb25Qcm9ncmVzcyh7XG4gICAgICAgICAgICBwYWdlczogYmFzZVBhZ2VzICsgcHJvZ3Jlc3MucGFnZXMsXG4gICAgICAgICAgICBzeW5jZWRDb3VudDogYmFzZVN5bmNlZENvdW50ICsgcHJvZ3Jlc3Muc3luY2VkQ291bnQsXG4gICAgICAgICAgICB0b3RhbDogYmFzZVRvdGFsICsgcHJvZ3Jlc3MudG90YWxcbiAgICAgICAgICB9KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBwb3N0Q2hhbmdlczogYXN5bmMgKHBheWxvYWQsIG9wdGlvbnMpID0+IGF3YWl0IHRoaXMuY29uZmlnLnBvc3RDaGFuZ2VzKHtcbiAgICAgICAgICAgIC4uLnBheWxvYWQsXG4gICAgICAgICAgICAvLyBPbmx5IHRoZSBhbGwtdHlwZXMgc2NvcGUgY2FycmllcyB0aGUgdHlwZSBsaXN0OyBhIHR5cGUtZGVjbGFyZWQgc2NvcGUgbmVlZHMgbm9uZS5cbiAgICAgICAgICAgIHNjb3BlOiB7XG4gICAgICAgICAgICAgIGNvbmRpdGlvbnM6IHNjb3BlUm93LmNvbmRpdGlvbnMsXG4gICAgICAgICAgICAgIHJlc291cmNlVHlwZTogc2NvcGVSb3cucmVzb3VyY2VUeXBlLFxuICAgICAgICAgICAgICAuLi4oc2NvcGVSb3cucmVzb3VyY2VUeXBlID09PSBudWxsID8ge3Jlc291cmNlVHlwZXM6IHRoaXMudXNlclNjb3BlUmVzb3VyY2VUeXBlcygpfSA6IHt9KVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC4uLih1cHN0cmVhbVJlZnJlc2ggPyB7dXBzdHJlYW1SZWZyZXNoOiB0cnVlfSA6IHt9KVxuICAgICAgICAgIH0sIG9wdGlvbnMpLFxuICAgICAgICAgIHNhdmVDdXJzb3I6IGFzeW5jIChjdXJzb3IpID0+IGF3YWl0IHNjb3BlU3RvcmUuc2F2ZUN1cnNvcihzY29wZVJvdywgY3Vyc29yKSxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcblxuICAgICAgICByZXN1bHQuY2hhbmdlZCB8fD0gc2NvcGVSZXN1bHQuY2hhbmdlZFxuICAgICAgICByZXN1bHQucGFnZXMgKz0gc2NvcGVSZXN1bHQucGFnZXNcbiAgICAgICAgcmVzdWx0LnN5bmNlZENvdW50ICs9IHNjb3BlUmVzdWx0LnN5bmNlZENvdW50XG4gICAgICAgIHJlc3VsdC50b3RhbCArPSBzY29wZVJlc3VsdC50b3RhbFxuXG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlUmVzdWx0LnJlc291cmNlQ291bnRzKSkge1xuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdID0gKHJlc3VsdC5yZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdIHx8IDApICsgY291bnRcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIGNoYW5nZWRdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlUmVzdWx0LnJlc291cmNlQ2hhbmdlZCkpIHtcbiAgICAgICAgICByZXN1bHQucmVzb3VyY2VDaGFuZ2VkW3Jlc291cmNlVHlwZV0gfHw9IGNoYW5nZWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb21iaW5lZFJlc3VsdCA9IHJlc3VsdFxuICAgIH0pXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgcmV0dXJuIGNvbWJpbmVkUmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBkZXJpdmVkIHJlbW90ZS1jaGFuZ2UgYXBwbGllciBzaGFyZWQgYnkgcHVsbHMgYW5kIHJlYWx0aW1lIHB1c2hlczpcbiAgICogYXBwbGllcyB0aHJvdWdoIHRoZSBkZWNsYXJlZCByZXNvdXJjZSBjb25maWdzLCByZWdpc3RlcnMgZWFjaCB3cml0dGVuIHJlY29yZFxuICAgKiBmb3IgZWNobyBzdXBwcmVzc2lvbiAodHJhY2tlZCByZXNvdXJjZXMgZG8gbm90IHJlLXF1ZXVlIGFwcGxpZWQgY2hhbmdlcyksIGFuZFxuICAgKiBmYWlscyBsb3VkbHkgaW5zdGVhZCBvZiBzaWxlbnRseSBza2lwcGluZyB1bmNvbmZpZ3VyZWQgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge3tzb3VyY2U/OiBzdHJpbmd9fSBbYXJnc10gLSBFcnJvciBjb250ZXh0IGRlc2NyaWJpbmcgd2hlcmUgdGhlIGNoYW5nZSBjYW1lIGZyb20uXG4gICAqIEByZXR1cm5zIHsoc3luYzogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IExvdWQgcmVtb3RlLWNoYW5nZSBhcHBsaWVyLlxuICAgKi9cbiAgcmVtb3RlQXBwbHlTeW5jKHtzb3VyY2UgPSBcInB1bGxlZCBjaGFuZ2VcIn0gPSB7fSkge1xuICAgIHJldHVybiBhc3luYyAoc3luYykgPT4ge1xuICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gc3luYy5yZXNvdXJjZVR5cGUoKVxuICAgICAgY29uc3QgY29uZmlndXJlZFJlc291cmNlID0gcmVzb3VyY2VUeXBlID8gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gOiB1bmRlZmluZWRcblxuICAgICAgaWYgKCFyZXNvdXJjZVR5cGUgfHwgIWNvbmZpZ3VyZWRSZXNvdXJjZT8uYXR0cmlidXRlcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgcmVzb3VyY2Ugd2l0aCBwdWxsIGF0dHJpYnV0ZXMgY29uZmlndXJlZCBmb3IgJHtzb3VyY2V9OiAke1N0cmluZyhyZXNvdXJjZVR5cGUpfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgICBjb25zdCBkYXRhID0gc3luYy5kYXRhKClcbiAgICAgICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHRoaXMuY29uZmlnLnJlc291cmNlc1tyZXNvdXJjZVR5cGVdLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgICAgICBpZiAodmVyc2lvbkF0dHJpYnV0ZSkge1xuICAgICAgICAgIGNvbnN0IGRhdGFBdHRyaWJ1dGVzID0gZGF0YSAmJiB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShkYXRhKVxuICAgICAgICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRhdGEpXG4gICAgICAgICAgICA6IHt9XG5cbiAgICAgICAgICB0aGlzLm5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkOiBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKCkpLCByZXNvdXJjZVR5cGUsIHZlcnNpb246IGRhdGFBdHRyaWJ1dGVzW3ZlcnNpb25BdHRyaWJ1dGVdfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHB1bGxSZXNvdXJjZUNvbmZpZ3MgPSB0aGlzLnB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKVxuICAgICAgICBjb25zdCBhcHBsaWVyID0gU3luY0FwaUNsaWVudC5yZXNvdXJjZUFwcGxpZXIocHVsbFJlc291cmNlQ29uZmlncywgKHJlY29yZCkgPT4ge1xuICAgICAgICAgIGlmIChvcGVyYXRpb24pIHRoaXMuYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFya1JlbW90ZUFwcGx5KHJlY29yZClcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gYXdhaXQgYXBwbGllcihzeW5jKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNoYXJlZCBhcHAtbGlmZXRpbWUgd2Vic29ja2V0IGNvbm5lY3Rpb24gYWxsIHN5bmMgdHJhZmZpY1xuICAgKiByaWRlcywgb3IgbnVsbCB3aGVuIG5vbmUgaXMgY29uZmlndXJlZC4gQnVpbHQgb25jZSBhbmQgbWVtb2l6ZWQgKHBlclxuICAgKiBjbGllbnQpOiBhbiBhcHAtcHJvdmlkZWQgYHN5bmMuY2xpZW50LndlYnNvY2tldENsaWVudGAgaW5zdGFuY2Ugd2lucyAodGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBjYW4gcGFzcyBpdHMgb3duIGNsaWVudCBzbyBvbmUgc29ja2V0IGNhcnJpZXNcbiAgICogZXZlcnl0aGluZyksIGVsc2UgYSBmcmFtZXdvcmstb3duZWQgcmVjb25uZWN0aW5nIHtAbGluayBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9XG4gICAqIGJ1aWx0IGZyb20gYHN5bmMuY2xpZW50LndlYnNvY2tldFVybGAuIFRoZSByZWFsdGltZSBicmlkZ2UgcmlkZXMgdGhpc1xuICAgKiBjb25uZWN0aW9uIHdpdGhvdXQgb3duaW5nIGl0cyBsaWZlY3ljbGU7IHdoZW4gbmVpdGhlciBpcyBjb25maWd1cmVkIHRoZVxuICAgKiBicmlkZ2UgZmFsbHMgYmFjayB0byB0aGUgZGVwcmVjYXRlZCBwZXItY3ljbGUgYHJlYWx0aW1lLmNyZWF0ZUNsaWVudGAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRTaGFyZWRDb25uZWN0aW9uIHwgbnVsbH0gU2hhcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uLCBvciBudWxsLlxuICAgKi9cbiAgc3luY0Nvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX3N5bmNDb25uZWN0aW9uICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9zeW5jQ29ubmVjdGlvblxuXG4gICAgaWYgKHRoaXMuY29uZmlnLndlYnNvY2tldENsaWVudCkge1xuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB0aGlzLmNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9IGVsc2UgaWYgKHRoaXMuY29uZmlnLndlYnNvY2tldFVybCkge1xuICAgICAgY29uc3QgdXJsID0gdHlwZW9mIHRoaXMuY29uZmlnLndlYnNvY2tldFVybCA9PT0gXCJmdW5jdGlvblwiID8gdGhpcy5jb25maWcud2Vic29ja2V0VXJsKCkgOiB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmxcblxuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB1cmwgPyBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHt1cmx9KSA6IG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3N5bmNDb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0aGUgZGVyaXZlZCByZWFsdGltZSBjaGFubmVscyBzbyBwdXNoZWQgd2Vic29ja2V0IGNoYW5nZXMgYXBwbHlcbiAgICogdGhyb3VnaCB0aGUgc2FtZSBkZXJpdmVkIGFwcGxpZXIgYXMgcHVsbHMgKGlkZW1wb3RlbnQsIHNpbmdsZS1mbGlnaHRlZCkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFtjb250ZXh0XSAtIEFwcCBjb250ZXh0IHBhc3NlZCB0byB0aGUgZGVwcmVjYXRlZCBgc3luYy5jbGllbnQucmVhbHRpbWUuY2hhbm5lbHNgIGNhbGxiYWNrIChydW50aW1lIHNjb3BlIHZhbHVlcykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3Vic2NyaWJlUmVhbHRpbWUoY29udGV4dCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkuc3Vic2NyaWJlKGNvbnRleHQsIHtzaWduYWx9KVxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0aGUgc2VydmVyLWVudW1lcmF0ZWQgdXNlciBzY29wZTogXCJldmVyeXRoaW5nIG15IGFiaWxpdHkgY2FuXG4gICAqIHNlZVwiLiBEZWNsYXJlcyBhIHVzZXIgc2NvcGUgKGVtcHR5IGNvbmRpdGlvbnMpIGZvciBldmVyeSBwdWxsYWJsZSBzeW5jZWRcbiAgICogcmVzb3VyY2UgdHlwZSwgc3Vic2NyaWJlcyByZWFsdGltZSBzbyB0aGVpciBmcmFtZXdvcmsgc3luYyBjaGFubmVsXG4gICAqIHN1YnNjcmlwdGlvbnMgZ28gbGl2ZSwgYW5kIHB1bGxzIHNvIHRoZSBkZXZpY2UgY2F0Y2hlcyB1cC4gVGhlIHNlcnZlclxuICAgKiBhdXRob3JpemVzIGVhY2ggZW1wdHktY29uZGl0aW9ucyBzY29wZSB0aHJvdWdoIHRoZSBhcHAgc3luYyByZXNvdXJjZSdzXG4gICAqIGBhdXRob3JpemVDaGFuZ2VzYCBhbmQgcmUtY2hlY2tzIHJlY29yZCBhY2Nlc3MgcGVyIGRlbGl2ZXJ5LCBzbyB0aGUgY2xpZW50XG4gICAqIHN1YnNjcmliZXMgd2l0aCBqdXN0IGl0cyB0b2tlbiBhbmQgdGhlIHNlcnZlciBkZWNpZGVzIG1lbWJlcnNoaXAuXG4gICAqIElkZW1wb3RlbnQgYW5kIHNpbmdsZS1mbGlnaHRlZCBsaWtlIHtAbGluayBTeW5jQ2xpZW50I3N1YnNjcmliZVJlYWx0aW1lfS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdWJzY3JpYmVVc2VyU2NvcGUoKSB7XG4gICAgaWYgKHRoaXMuX3VzZXJTY29wZVN0YXRlID09PSBcInN1YnNjcmliZWRcIikgcmV0dXJuXG5cbiAgICBpZiAoIXRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UpIHtcbiAgICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZShzaWduYWwpKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuZCBhY3RpdmF0ZXMgdGhlIHNlcnZlci1lbnVtZXJhdGVkIHVzZXIgc2NvcGUgd2l0aG91dCBzdGFydGluZ1xuICAgKiByZWFsdGltZSBvciBwdWxsaW5nLiBVc2UgdGhpcyBmcm9tIFN5bmNDb29yZGluYXRvci5wcmVwYXJlKCkgc28gdGhlXG4gICAqIGNvb3JkaW5hdG9yIHJlbWFpbnMgdGhlIHNvbGUgbmV0d29yayBvcmRlcmluZyBvd25lci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhY3RpdmF0ZVVzZXJTY29wZSgpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX2FjdGl2YXRlVXNlclNjb3BlKHNpZ25hbCkpXG4gIH1cblxuICAvKipcbiAgICogQWN0aXZhdGVzIHRoZSB1c2VyIHNjb3BlIHVuZGVyIHRoZSBjdXJyZW50IGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBzaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHNjb3BlIGlzIGR1cmFibGUuXG4gICAqL1xuICBhc3luYyBfYWN0aXZhdGVVc2VyU2NvcGUoc2lnbmFsKSB7XG4gICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkuZmluZE9yQ3JlYXRlU2NvcGUoYXdhaXQgdGhpcy51c2VyU2NvcGUoKSlcbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW5kIGFjdGl2YXRlcyB0aGUgdXNlciBzY29wZSBmb3IgZXZlcnkgcHVsbGFibGUgcmVzb3VyY2UsIHRoZW5cbiAgICogc3Vic2NyaWJlcyByZWFsdGltZSBhbmQgcHVsbHMuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IHNpZ25hbCAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9zdWJzY3JpYmVVc2VyU2NvcGUoc2lnbmFsKSB7XG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInN1YnNjcmliaW5nXCJcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9hY3RpdmF0ZVVzZXJTY29wZShzaWduYWwpXG5cbiAgICAgIGF3YWl0IHRoaXMuc3Vic2NyaWJlUmVhbHRpbWUoKVxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgYXdhaXQgdGhpcy5wdWxsKClcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInN1YnNjcmliZWRcIlxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVuc3Vic2NyaWJlcyB0aGUgdXNlciBzY29wZTogZGVhY3RpdmF0ZXMgdGhlIHBlci1yZXNvdXJjZSB1c2VyIHNjb3BlcyBhbmRcbiAgICogY2xvc2VzIHRoZSByZWFsdGltZSBjaGFubmVsIHN1YnNjcmlwdGlvbnMuIFRoZSBzaGFyZWQgd2Vic29ja2V0IGNvbm5lY3Rpb25cbiAgICogc3RheXMgb3BlbiB3aGVuIG9uZSBpcyBjb25maWd1cmVkIChzaWduLW91dCBkcm9wcyBzdWJzY3JpcHRpb25zIHdpdGhvdXRcbiAgICogZGlzY29ubmVjdGluZyksIHNvIGEgc3Vic2VxdWVudCBzaWduLWluIHJlc3Vic2NyaWJlcyBvdmVyIHRoZSBzYW1lIHNvY2tldC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN1YnNjcmliZVVzZXJTY29wZSgpIHtcbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5kZWFjdGl2YXRlKGF3YWl0IHRoaXMudXNlclNjb3BlKCkpXG5cbiAgICBhd2FpdCB0aGlzLnVuc3Vic2NyaWJlUmVhbHRpbWUoKVxuXG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdXNlciBzY29wZTogYSBzaW5nbGUgYWxsLXR5cGVzIHNjb3BlIChudWxsIHJlc291cmNlVHlwZSkgd2l0aCBlbXB0eVxuICAgKiBjb25kaXRpb25zLCBwYXJ0aXRpb25lZCBsb2NhbGx5IGJ5IG93bmVyLiBPbmUgc2NvcGUgLSBub3Qgb25lIHBlciByZXNvdXJjZVxuICAgKiB0eXBlIC0gc28gdGhlIHNlcnZlciBhdXRob3JpemVzIHRoZSBjYWxsZXIgb25jZSBwZXIgc3luYyBhbmQgcGVyIHN1YnNjcmliZSxcbiAgICogaG93ZXZlciBtYW55IHJlc291cmNlIHR5cGVzIGl0IHNlcnZlcy4gVGhlIHNlcnZlciBkZWNpZGVzIHdoaWNoIHR5cGVzIHRoZVxuICAgKiBjYWxsZXIgbWF5IHNlZTsgdGhlIGNsaWVudCBhcHBsaWVzIGVhY2ggcHVsbGVkIHJvdyBieSB0aGUgcmVzb3VyY2UgdHlwZSBvblxuICAgKiBpdHMgb3duIGVudmVsb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGU+fSBUaGUgdXNlciBzY29wZS5cbiAgICovXG4gIGFzeW5jIHVzZXJTY29wZSgpIHtcbiAgICByZXR1cm4ge2NvbmRpdGlvbnM6IHt9LCBvd25lcjogYXdhaXQgdGhpcy51c2VyU2NvcGVPd25lcigpLCByZXNvdXJjZVR5cGU6IG51bGx9XG4gIH1cblxuICAvKipcbiAgICogVGhlIHJlc291cmNlIHR5cGVzIHRoZSB1c2VyIHNjb3BlIGNvdmVyczogZXZlcnkgZGVjbGFyZWQgcmVzb3VyY2UgdGhhdFxuICAgKiByZWNlaXZlcyBwdWxsZWQgY2hhbmdlcyAoaGFzIHB1bGwgYGF0dHJpYnV0ZXNgKSwgc28gdGhlIGNsaWVudCBjYW4gYXBwbHlcbiAgICogdGhlbS4gU2VudCB3aXRoIHRoZSBzY29wZSBhcyBhIGRlbGl2ZXJ5L3R5cGUgZmlsdGVyIC0gaXQgbmFycm93cywgbmV2ZXJcbiAgICogd2lkZW5zLCB3aGF0IHRoZSBzZXJ2ZXIncyBhdXRob3JpemF0aW9uIGFscmVhZHkgYWxsb3dzLCBhbmQgaXQga2VlcHMgYVxuICAgKiBicm9hZGNhc3Qgb2YgYSB0eXBlIHRoaXMgY2xpZW50IGNhbm5vdCBhcHBseSBmcm9tIHJlYWNoaW5nIHRoZSBzZXJ2ZXInc1xuICAgKiBwZXItZGVsaXZlcnkgYWNjZXNzIHJlLWNoZWNrIChhIGRhdGFiYXNlIHF1ZXJ5IHBlciBtYXRjaGVkIGJyb2FkY2FzdCwgcGVyXG4gICAqIHN1YnNjcmliZWQgZGV2aWNlKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSBQdWxsYWJsZSByZXNvdXJjZSB0eXBlIG5hbWVzLlxuICAgKi9cbiAgdXNlclNjb3BlUmVzb3VyY2VUeXBlcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5wdWxsUmVzb3VyY2VDb25maWdzKCkpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGxvY2FsIHBhcnRpdGlvbiBrZXkgZm9yIHRoZSB1c2VyIHNjb3BlOiB0aGUgY3VycmVudGx5XG4gICAqIGNvbmZpZ3VyZWQgYXV0aGVudGljYXRlZCBpZGVudGl0eSAodGhlIHN5bmMgYXV0aCB0b2tlbikuIFBhcnRpdGlvbmluZyB0aGVcbiAgICogdXNlciBzY29wZSdzIGxvY2FsIHNjb3BlL2N1cnNvciByb3dzIGJ5IHRoaXMgb3duZXIga2VlcHMgdGhlXG4gICAqIGVtcHR5LWNvbmRpdGlvbnMgY3Vyc29yIGZyb20gbGVha2luZyBhY3Jvc3MgYWNjb3VudHMgb24gYSBzaGFyZWQgZGV2aWNlXG4gICAqIChhY2NvdW50IEIgc2lnbmluZyBpbiBhZnRlciBhY2NvdW50IEEgZ2V0cyBhIGZyZXNoIGN1cnNvcikgd2hpbGUgdGhlIHNhbWVcbiAgICogYWNjb3VudCByZWNvbm5lY3Rpbmcga2VlcHMgaXRzIGN1cnNvciBjb250aW51aXR5LiBUaGUgb3duZXIgaXMgYSBsb2NhbFxuICAgKiBwYXJ0aXRpb24ga2V5IG9ubHkg4oCUIHB1bGxzIHN0aWxsIHBvc3QgZW1wdHkgY29uZGl0aW9ucyB0byB0aGUgc2VydmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBVc2VyLXNjb3BlIG93bmVyIHBhcnRpdGlvbiBrZXkuXG4gICAqL1xuICBhc3luYyB1c2VyU2NvcGVPd25lcigpIHtcbiAgICByZXR1cm4gU3RyaW5nKGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBVbnN1YnNjcmliZXMgdGhlIHJlYWx0aW1lIGNoYW5uZWxzIGFuZCBkaXNjb25uZWN0cyB0aGUgd2Vic29ja2V0IGNsaWVudCAoaWRlbXBvdGVudCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zdWJzY3JpYmVSZWFsdGltZSgpIHtcbiAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkudW5zdWJzY3JpYmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgdGhlIHJlYWx0aW1lIHN1YnNjcmlwdGlvbiBzdGF0ZSBhbmQgcGVyLWNoYW5uZWwgcmVhZGluZXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxTeW5jUmVhbHRpbWVCcmlkZ2VbXCJzdGF0dXNcIl0+fSBSZWFsdGltZSBzdGF0dXMuXG4gICAqL1xuICByZWFsdGltZVN0YXR1cygpIHtcbiAgICByZXR1cm4gdGhpcy5yZWFsdGltZUJyaWRnZSgpLnN0YXR1cygpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIGFsbCBwZW5kaW5nIHJlYWx0aW1lIG1lc3NhZ2UgYXBwbGllcyBhbmQgYW55IHNjaGVkdWxlZFxuICAgKiBwdWxsLW9uLXJlY29ubmVjdCAodXNlZnVsIGluIHRlc3RzIGFuZCBzaHV0ZG93biBmbG93cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FpdEZvclJlYWx0aW1lQXBwbGllZCgpIHtcbiAgICBhd2FpdCB0aGlzLnJlYWx0aW1lQnJpZGdlKCkud2FpdEZvckFwcGxpZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxhemlseSBidWlsdCByZWFsdGltZSBicmlkZ2UuXG4gICAqIEByZXR1cm5zIHtTeW5jUmVhbHRpbWVCcmlkZ2V9IFJlYWx0aW1lIGJyaWRnZS5cbiAgICovXG4gIHJlYWx0aW1lQnJpZGdlKCkge1xuICAgIHRoaXMuX3JlYWx0aW1lQnJpZGdlIHx8PSBuZXcgU3luY1JlYWx0aW1lQnJpZGdlKHtzeW5jQ2xpZW50OiB0aGlzfSlcblxuICAgIHJldHVybiB0aGlzLl9yZWFsdGltZUJyaWRnZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhIGxvY2FsIG1vZGVsIGNoYW5nZSBhcyBhIHBlbmRpbmcgc3luYyByb3cgYW5kIHNjaGVkdWxlcyBhbiBpbW1lZGlhdGVcbiAgICogcmVwbGF5IGF0dGVtcHQgKGtlcHQgcGVuZGluZyB3aGlsZSBvZmZsaW5lIG9yIHdoZW4gdGhlIGJhY2tlbmQgcmVqZWN0cyBpdCkuXG4gICAqIEBwYXJhbSB7e2Jhc2VWZXJzaW9uPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgcmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBkYXRhPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcGVyYXRpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCBzeW5jVHlwZT86IHN0cmluZ319IGFyZ3MgLSBRdWV1ZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSBQZW5kaW5nIGxvY2FsIHN5bmMgcm93IG9yIGR1cmFibGUgY29uZmxpY3QtdHJhY2tlZCBpbnRlbnQuXG4gICAqL1xuICBhc3luYyBxdWV1ZSh7YmFzZVZlcnNpb24sIGRhdGEsIG9wZXJhdGlvbiA9IFwidXBkYXRlXCIsIHJlc291cmNlLCBzeW5jVHlwZX0pIHtcbiAgICBjb25zdCBsaWZlY3ljbGVHZW5lcmF0aW9uID0gdGhpcy5fbGlmZWN5Y2xlR2VuZXJhdGlvblxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bk11dGF0aW9uTGlmZWN5Y2xlV29yayhsaWZlY3ljbGVHZW5lcmF0aW9uLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICAgIHRoaXMuYXNzZXJ0UmVjb3JkT3duZXJzaGlwKHJlc291cmNlKVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnRm9yKHJlc291cmNlKVxuICAgICAgY29uc3QgcmVzb2x2ZWRTeW5jVHlwZSA9IHN5bmNUeXBlID8/IHRoaXMuZGVmYXVsdFN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZDogcmVzb3VyY2UsIHJlc291cmNlQ29uZmlnfSlcblxuICAgICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgY29uc3QgcXVldWVkRGF0YSA9IFN5bmNBcGlDbGllbnQucXVldWVkU3luY0RhdGEoe1xuICAgICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgICBkYXRhLFxuICAgICAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgICAgcmVzb3VyY2VcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgcmVjb3JkID0gYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUNvbmZsaWN0VHJhY2tlZFN5bmMoe1xuICAgICAgICAgIGJhc2VWZXJzaW9uOiBiYXNlVmVyc2lvbiA9PT0gdW5kZWZpbmVkID8gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQ6IHJlc291cmNlLCByZXNvdXJjZUNvbmZpZ30pIDogYmFzZVZlcnNpb24sXG4gICAgICAgICAgY29uZmxpY3RUcmFja2luZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgICBkYXRhOiBxdWV1ZWREYXRhLFxuICAgICAgICAgIG9mZmxpbmVTZXNzaW9uOiB0aGlzLmNvbmZpZy5vZmZsaW5lID8gdGhpcy5vZmZsaW5lU2Vzc2lvbigpIDogdW5kZWZpbmVkLFxuICAgICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgICByZXNvdXJjZSxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6IHJlc291cmNlLmNvbnN0cnVjdG9yLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAgIHN5bmNUeXBlOiByZXNvbHZlZFN5bmNUeXBlXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG5cbiAgICAgICAgcmV0dXJuIHJlY29yZFxuICAgICAgfVxuXG4gICAgICBjb25zdCBzeW5jUm93ID0gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChkYXRhYmFzZU9wZXJhdGlvbikgPT4gYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUxvY2FsU3luYyh7XG4gICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogcmVzb3VyY2VDb25maWcubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgcmVzb3VyY2UsXG4gICAgICAgIHN5bmNNb2RlbDogZGF0YWJhc2VPcGVyYXRpb24gPyBkYXRhYmFzZU9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWwsXG4gICAgICAgIHN5bmNUeXBlOiByZXNvbHZlZFN5bmNUeXBlXG4gICAgICB9KSlcblxuICAgICAgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG5cbiAgICAgIHJldHVybiBzeW5jUm93XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgcGVuZGluZyBsb2NhbCBzeW5jIHJvd3MgdG8gdGhlIGJhY2tlbmQgKHNpbmdsZS1mbGlnaHRlZCwgb25saW5lLWdhdGVkKS5cbiAgICogUm93cyBhcmUgb25seSBtYXJrZWQgc3VjY2Vzc2Z1bCBhZnRlciB0aGUgYmFja2VuZCBhY2tub3dsZWRnZXMgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBsYXlQZW5kaW5nKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4gYXdhaXQgdGhpcy5fcmVwbGF5UGVuZGluZyhzaWduYWwpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheSBpbXBsZW1lbnRhdGlvbiBib3VuZCB0byBvbmUgbGlmZWN5Y2xlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IHNpZ25hbCAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXBsYXlQZW5kaW5nKHNpZ25hbCkge1xuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAoIShhd2FpdCB0aGlzLmlzT25saW5lKCkpKSByZXR1cm5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnNpbmdsZUZsaWdodChgdmVsb2Npb3VzLXN5bmMtY2xpZW50LXJlcGxheS0ke3RoaXMuX2NsaWVudE51bWJlcn1gLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICBpZiAodGhpcy5jb25maWcub2ZmbGluZSkge1xuICAgICAgICAvLyBMb25nLW9mZmxpbmUgc2Vzc2lvbiBjb25maWd1cmVkOiB0aGUgc2lnbmVkIG9mZmxpbmUgc2Vzc2lvbiBvd25zIHRoZVxuICAgICAgICAvLyBjb25mbGljdC10cmFja2VkIG11dGF0aW9uIGxvZ3MsIHNvIHRoZSBiYWNrZ3JvdW5kIGRyYWluIHJlcGxheXMgdGhlbVxuICAgICAgICAvLyB0aHJvdWdoIHRoZSBzaWduZWQgcmVwbGF5IGVuZHBvaW50IGluc3RlYWQgb2YgdGhlIGxlZ2FjeSB1bnNpZ25lZFxuICAgICAgICAvLyBvbmUuIE9uZSBvd25lciBwZXIgbG9nIOKAlCBuZXZlciBib3RoLlxuICAgICAgICBhd2FpdCB0aGlzLl9yZXBsYXlPZmZsaW5lUGVuZGluZyh7c2lnbmFsfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgcmVzb3VyY2VDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcykpIHtcbiAgICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIGNvbnRpbnVlXG5cbiAgICAgICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnJlcGxheUNvbmZsaWN0VHJhY2tlZFN5bmNzKHtcbiAgICAgICAgICAgIGFwcGx5Q29uZmxpY3Q6IGFzeW5jICh7cmVjb3JkLCByZXN1bHR9KSA9PiBhd2FpdCB0aGlzLmFwcGx5Q29uZmxpY3RSZXBsYXlSZXN1bHQoe3JlY29yZCwgcmVzdWx0LCByZXNvdXJjZVR5cGV9KSxcbiAgICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSxcbiAgICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICAgICAgY29uZmxpY3RUcmFja2luZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgICAgIHBvc3RSZXBsYXk6IHRoaXMuY29uZmlnLnBvc3RSZXBsYXksXG4gICAgICAgICAgICByZW1vdGVHZW5lcmF0aW9uOiAoaWRlbnRpdHkpID0+IHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCxcbiAgICAgICAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgICAgICAgIHNpZ25hbFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5yZXBsYXlMb2NhbFN5bmNzKHtcbiAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpLFxuICAgICAgICBiYXRjaFNpemU6IHRoaXMuY29uZmlnLmJhdGNoU2l6ZSxcbiAgICAgICAgcG9zdFJlcGxheTogdGhpcy5jb25maWcucG9zdFJlcGxheSxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgICBzeW5jTW9kZWw6IG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcbiAgICAgIH0pXG4gICAgfSkpXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhbiBhdXRob3JpdGF0aXZlIHNlcnZlck1vZGVsIHJldHVybmVkIGJ5IGEgY29uZmxpY3QgdGhyb3VnaCB0aGVcbiAgICogc2FtZSB0ZW5hbnQtYm91bmQsIHRyYWNraW5nLXN1cHByZXNzZWQgYXBwbGllciB1c2VkIGJ5IHB1bGwvcmVhbHRpbWUuXG4gICAqIEEgY29uZmxpY3QgcmVzdWx0IHdpdGhvdXQgc2VydmVyTW9kZWwgaGFzIG5vIGF1dGhvcml0YXRpdmUgc3RhdGUgdG8gYXBwbHlcbiAgICogYW5kIHJlbWFpbnMgZGlhZ25vc3RpYy1vbmx5LlxuICAgKiBAcGFyYW0ge3tyZWNvcmQ6IGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQsIHJlc291cmNlVHlwZTogc3RyaW5nLCByZXN1bHQ6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXBsYXlJdGVtfX0gYXJncyAtIENvbmZsaWN0IHJlc3VsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhcHBseUNvbmZsaWN0UmVwbGF5UmVzdWx0KHtyZWNvcmQsIHJlc291cmNlVHlwZSwgcmVzdWx0fSkge1xuICAgIGNvbnN0IGNvbmZsaWN0ID0gcmVzdWx0LmNvbmZsaWN0XG5cbiAgICBpZiAoIWNvbmZsaWN0IHx8ICFPYmplY3QuaGFzT3duKGNvbmZsaWN0LCBcInNlcnZlck1vZGVsXCIpKSByZXR1cm5cblxuICAgIGNvbnN0IHNlcnZlck1vZGVsID0gY29uZmxpY3Quc2VydmVyTW9kZWxcblxuICAgIGlmIChzZXJ2ZXJNb2RlbCAhPT0gbnVsbCAmJiAodHlwZW9mIHNlcnZlck1vZGVsICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2VydmVyTW9kZWwpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0IHNlcnZlck1vZGVsIGZvciAke3Jlc291cmNlVHlwZX0gbXVzdCBiZSBhbiBvYmplY3Qgb3IgbnVsbGApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VJZCA9IHJlY29yZC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlSWQgIT09IFwic3RyaW5nXCIgfHwgcmVzb3VyY2VJZC5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCBmb3IgJHtyZXNvdXJjZVR5cGV9IGlzIG1pc3NpbmcgcmVzb3VyY2VJZGApXG5cbiAgICBjb25zdCBzeW5jID0gU3luY0FwaUNsaWVudC5zeW5jRW52ZWxvcGVGcm9tUGF5bG9hZCh7XG4gICAgICBkYXRhOiBzZXJ2ZXJNb2RlbCxcbiAgICAgIHJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGUsXG4gICAgICBzeW5jVHlwZTogc2VydmVyTW9kZWwgPT09IG51bGwgPyBcImRlbGV0ZVwiIDogXCJ1cGRhdGVcIlxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLnJlbW90ZUFwcGx5U3luYyh7c291cmNlOiBcImNvbmZsaWN0IHNlcnZlciB2ZXJzaW9uXCJ9KShzeW5jKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcXVldWUgY291bnRzIGFuZCBwcml2YWN5LXNhZmUgY29uZmxpY3RzIGZvciBjb29yZGluYXRvci9VSSBzdGF0dXMuXG4gICAqIEZ1bGwgbG9jYWwvc2VydmVyIHBheWxvYWRzIHJlbWFpbiBvbmx5IGluIHRoZSBkdXJhYmxlIG11dGF0aW9uIGxvZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWNvb3JkaW5hdG9yLXR5cGVzLmpzXCIpLlN5bmNDbGllbnRJbnNwZWN0aW9uPn0gRHVyYWJsZSBzeW5jIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zcGVjdFN5bmNTdGF0ZSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBsZXQgcGVuZGluZ0NvdW50ID0gMFxuICAgICAgbGV0IHJlamVjdGVkQ291bnQgPSAwXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ29uZmxpY3REaWFnbm9zdGljW119ICovXG4gICAgICBjb25zdCBjb25mbGljdHMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykgY29udGludWVcblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBhd2FpdCByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnJlY29yZHMoKSkge1xuICAgICAgICAgIGlmIChyZWNvcmQubXV0YXRpb24ubW9kZWwgIT09IHJlc291cmNlVHlwZSkgY29udGludWVcbiAgICAgICAgICBpZiAoW1wicGVuZGluZ1wiLCBcImFwcGxpZWQtbG9jYWxseVwiLCBcInBlZXItYXBwbGllZFwiXS5pbmNsdWRlcyhyZWNvcmQuc3RhdHVzKSkgcGVuZGluZ0NvdW50ICs9IDFcbiAgICAgICAgICBpZiAocmVjb3JkLnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKSByZWplY3RlZENvdW50ICs9IDFcbiAgICAgICAgICBpZiAocmVjb3JkLnN0YXR1cyA9PT0gXCJjb25mbGljdFwiKSBjb25mbGljdHMucHVzaChzeW5jQ29uZmxpY3REaWFnbm9zdGljKHJlY29yZCkpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgfVxuXG4gICAgICBwZW5kaW5nQ291bnQgKz0gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgICAgY29uc3Qgc3luY01vZGVsID0gb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3ModGhpcy5jb25maWcuc3luY01vZGVsKSA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuICAgICAgICBjb25zdCBwZW5kaW5nUm93cyA9IGF3YWl0IHN5bmNNb2RlbC5wcmVsb2FkKHtyZXNvdXJjZTogdHJ1ZX0pLndoZXJlKHtzdGF0ZTogXCJwZW5kaW5nXCJ9KS5vcmRlcihcImNyZWF0ZWRfYXRcIikudG9BcnJheSgpXG5cbiAgICAgICAgcmV0dXJuIHBlbmRpbmdSb3dzLmxlbmd0aFxuICAgICAgfSlcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgcmV0dXJuIHtjb25mbGljdHMsIHBlbmRpbmdDb3VudCwgcmVqZWN0ZWRDb3VudH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZHVyYWJsZSBjb25mbGljdCBvbiBpdHMgZGVjbGFyZWQgcmVzb3VyY2UgbG9nLiBSZXRyeS1sb2NhbCBpc1xuICAgKiBzY2hlZHVsZWQgdGhyb3VnaCB0aGUgY3VycmVudCBjb29yZGluYXRvciB3aGVuIGF0dGFjaGVkLlxuICAgKiBAcGFyYW0ge3tyZWNvcmRJZDogc3RyaW5nLCByZXNvbHV0aW9uOiBcImtlZXAtc2VydmVyXCIgfCBcInJldHJ5LWxvY2FsXCIsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIFJlc29sdXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSAtIFJlc29sdmVkIGR1cmFibGUgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUNvbmZsaWN0KHtyZWNvcmRJZCwgcmVzb2x1dGlvbiwgcmVzb3VyY2VUeXBlfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZsaWN0VHJhY2tpbmcgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXT8uY29uZmxpY3RUcmFja2luZ1xuXG4gICAgICBpZiAoIWNvbmZsaWN0VHJhY2tpbmcpIHRocm93IG5ldyBFcnJvcihgTm8gY29uZmxpY3QtdHJhY2tlZCBzeW5jIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yOiAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnJlc29sdmVDb25mbGljdCh7aWQ6IHJlY29yZElkLCByZXNvbHV0aW9ufSlcblxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgaWYgKHJlc29sdXRpb24gPT09IFwicmV0cnktbG9jYWxcIikgdGhpcy5zY2hlZHVsZVJlcGxheSgpXG5cbiAgICAgIHJldHVybiByZWNvcmRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZyYW1ld29yay1vd25lZCBsb25nLW9mZmxpbmUgc2Vzc2lvbiBidWlsdCBmcm9tXG4gICAqIGBzeW5jLmNsaWVudC5vZmZsaW5lYCwgY3JlYXRpbmcgaXQgb24gZmlyc3QgdXNlLiBGYWlscyB3aGVuIHRoZSBvZmZsaW5lXG4gICAqIGNvbmZpZ3VyYXRpb24gYmxvY2sgaXMgbWlzc2luZy5cbiAgICogQHJldHVybnMge1N5bmNPZmZsaW5lU2Vzc2lvbn0gLSBUaGUgY2xpZW50J3Mgb2ZmbGluZSBzZXNzaW9uLlxuICAgKi9cbiAgb2ZmbGluZVNlc3Npb24oKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5vZmZsaW5lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IGhhcyBubyBzeW5jLmNsaWVudC5vZmZsaW5lIGNvbmZpZ3VyYXRpb24gLSBjb25maWd1cmUgZGV2aWNlSWRlbnRpdHlTdG9yYWdlLCBlbnJvbGxEZXZpY2UsIGFuZCBncmFudFNjb3BlcyB0byB1c2UgdGhlIGxvbmctb2ZmbGluZSBzZXNzaW9uXCIpXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9vZmZsaW5lU2Vzc2lvbikge1xuICAgICAgdGhpcy5fb2ZmbGluZVNlc3Npb24gPSBuZXcgU3luY09mZmxpbmVTZXNzaW9uKHtcbiAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgICAgY29uZmlnOiB0aGlzLmNvbmZpZy5vZmZsaW5lLFxuICAgICAgICBtdXRhdGlvbkxvZ3M6IHRoaXMub2ZmbGluZU11dGF0aW9uTG9ncygpLFxuICAgICAgICBwb3N0OiB0aGlzLmNvbmZpZy5vZmZsaW5lUG9zdFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fb2ZmbGluZVNlc3Npb25cbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyB0aGUgZHVyYWJsZSBtdXRhdGlvbiBsb2dzIHRoZSBvZmZsaW5lIHNlc3Npb24gc2lnbnMsIHJlcGxheXMsXG4gICAqIHJlLXNpZ25zLCBhbmQgZXhwb3J0czogdGhlIGNvbmZpZ3VyZWQgYHN5bmMuY2xpZW50Lm9mZmxpbmUubXV0YXRpb25Mb2dgXG4gICAqIHdoZW4gZ2l2ZW4sIHBsdXMgZXZlcnkgY29uZmxpY3QtdHJhY2tpbmcgbG9nIGRlY2xhcmVkIGJ5IHRoZSBzeW5jZWQgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdD59IC0gU2Vzc2lvbiBtdXRhdGlvbiBsb2dzLlxuICAgKi9cbiAgb2ZmbGluZU11dGF0aW9uTG9ncygpIHtcbiAgICAvKiogQHR5cGUge0FycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGxvZ3MgPSBbXVxuXG4gICAgaWYgKHRoaXMuY29uZmlnLm9mZmxpbmU/Lm11dGF0aW9uTG9nKSBsb2dzLnB1c2godGhpcy5jb25maWcub2ZmbGluZS5tdXRhdGlvbkxvZylcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2VDb25maWcgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkxvZyA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/Lm11dGF0aW9uTG9nXG5cbiAgICAgIGlmICghbXV0YXRpb25Mb2cpIGNvbnRpbnVlXG4gICAgICBpZiAobG9ncy5zb21lKChsb2cpID0+IGxvZyA9PT0gbXV0YXRpb25Mb2cgfHwgbG9nLnN0b3JhZ2VLZXkgPT09IG11dGF0aW9uTG9nLnN0b3JhZ2VLZXkpKSBjb250aW51ZVxuXG4gICAgICBsb2dzLnB1c2gobXV0YXRpb25Mb2cpXG4gICAgfVxuXG4gICAgaWYgKGxvZ3MubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IG9mZmxpbmUgc2Vzc2lvbiBmb3VuZCBubyBkdXJhYmxlIG11dGF0aW9uIGxvZyAtIGRlY2xhcmUgY29uZmxpY3RUcmFja2luZyBvbiBhIHN5bmNlZCBtb2RlbCBvciBjb25maWd1cmUgc3luYy5jbGllbnQub2ZmbGluZS5tdXRhdGlvbkxvZ1wiKVxuXG4gICAgcmV0dXJuIGxvZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgdGhlIGxvbmctb2ZmbGluZSBzZXNzaW9uOiByZXNvbHZlcyB0aGUgZGV2aWNlIHNpZ25pbmcgaWRlbnRpdHlcbiAgICogKGdlbmVyYXRpbmcgYW5kIGVucm9sbGluZyBhIGtleSBwYWlyIHdoZW4gdGhlIGFwcC1vd25lZCBzdG9yYWdlIGhhcyBub25lKVxuICAgKiBhbmQgYm9vdHN0cmFwcyBhIGxpdmUgb2ZmbGluZSBncmFudCB0aHJvdWdoIHRoZSBidWlsdC1pblxuICAgKiBgL2Zyb250ZW5kLW1vZGVscy9zeW5jL2Jvb3RzdHJhcGAgZW5kcG9pbnQuIElkZW1wb3RlbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1vZmZsaW5lLXNlc3Npb24uanNcIikuU3luY09mZmxpbmVTZXNzaW9uU3VtbWFyeT59IC0gU2Vzc2lvbiBzdW1tYXJ5IChhY3RvciBpZHMsIGxpdmUgZ3JhbnQgaWQsIGV4cGlyeSkuXG4gICAqL1xuICBhc3luYyBzdGFydE9mZmxpbmVTZXNzaW9uKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgY29uc3Qgc3VtbWFyeSA9IGF3YWl0IHRoaXMub2ZmbGluZVNlc3Npb24oKS5zdGFydCgpXG5cbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgcmV0dXJuIHN1bW1hcnlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoZSBsb25nLW9mZmxpbmUgc2Vzc2lvbi4gVGhlIGRldmljZSBpZGVudGl0eSBhbmQgcmV0YWluZWQgZ3JhbnRzXG4gICAqIHN0YXkgaW4gdGhlIGFwcC1vd25lZCBkdXJhYmxlIHN0b3JhZ2U7IHBlbmRpbmcgbXV0YXRpb25zIHN0YXkgaW4gdGhlXG4gICAqIGR1cmFibGUgbXV0YXRpb24gbG9ncyBhbmQgcmVwbGF5IHdpdGggdGhlIGdyYW50IHRoZXkgd2VyZSBzaWduZWQgdW5kZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBzZXNzaW9uIGlzIHN0b3BwZWQuXG4gICAqL1xuICBhc3luYyBzdG9wT2ZmbGluZVNlc3Npb24oKSB7XG4gICAgaWYgKCF0aGlzLl9vZmZsaW5lU2Vzc2lvbikgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9vZmZsaW5lU2Vzc2lvbi5zdG9wKClcbiAgfVxuXG4gIC8qKlxuICAgKiBCb290c3RyYXBzIGEgZnJlc2ggb2ZmbGluZSBncmFudCBhbmQgcmUtc2lnbnMgdGhpcyBkZXZpY2UncyBwZW5kaW5nXG4gICAqIG11dGF0aW9ucyB1bmRlciBpdCAodGhlIHJlcGxheSBpZGVtcG90ZW5jeSBrZXkgaXMgZ3JhbnQtaWQtZnJlZSwgc29cbiAgICogcmUtc2lnbmluZyBuZXZlciBkdXBsaWNhdGVzIGFuIGludGVudCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1vZmZsaW5lLXNlc3Npb24uanNcIikuU3luY09mZmxpbmVTZXNzaW9uU3VtbWFyeT59IC0gUmVmcmVzaGVkIHNlc3Npb24gc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIHJlZnJlc2hPZmZsaW5lR3JhbnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICBjb25zdCBzdW1tYXJ5ID0gYXdhaXQgdGhpcy5vZmZsaW5lU2Vzc2lvbigpLnJlZnJlc2hHcmFudCgpXG5cbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgcmV0dXJuIHN1bW1hcnlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyB0aGUgZHVyYWJsZSBtdXRhdGlvbiBsb2dzIHRocm91Z2ggdGhlIGJ1aWx0LWluIHNpZ25lZCByZXBsYXlcbiAgICogZW5kcG9pbnQgKGAvZnJvbnRlbmQtbW9kZWxzL3N5bmMvcmVwbGF5YCk6IGVuc3VyZXMgYSBsaXZlIGdyYW50IChyZWZyZXNoaW5nXG4gICAqIGFuIGV4cGlyZWQgb25lKSwgYmF0Y2hlcyBwZW5kaW5nIHNpZ25lZCBtdXRhdGlvbnMgd2l0aCB0aGUgc2lnbmVkIGdyYW50XG4gICAqIGVhY2ggd2FzIHNpZ25lZCB1bmRlciwgYW5kIG1hcHMgcGVyLW11dGF0aW9uIHJlc3VsdHMgYmFjayBvbnRvIHRoZSBsb2dcbiAgICogcmVjb3JkcyBhcyBzeW5jZWQvY29uZmxpY3QvcmVqZWN0ZWQuIFN0cnVjdHVyZWQgY29uZmxpY3RzIHN0YXkgcmVhY2hhYmxlXG4gICAqIHRocm91Z2ggdGhlIGV4aXN0aW5nIGNvbmZsaWN0IGNvbnRyYWN0IChgc3luY1Jlc3VsdC5jb25mbGljdGAgb24gdGhlIHJlY29yZFxuICAgKiBhbmQgYHJlc29sdmVDb25mbGljdCguLi4pYCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBSZXBsYXkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtvcHRpb25zLmJhdGNoU2l6ZV0gLSBNYXggc2lnbmVkIG11dGF0aW9ucyBwZXIgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLW9mZmxpbmUtc2Vzc2lvbi5qc1wiKS5TeW5jT2ZmbGluZVJlcGxheVJlc3VsdD59IC0gTWFwcGVkIHJlcGxheSByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYXlPZmZsaW5lUGVuZGluZyhvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9yZXBsYXlPZmZsaW5lUGVuZGluZyh7Li4ub3B0aW9ucywgc2lnbmFsfSkpXG4gIH1cblxuICAvKipcbiAgICogU2lnbmVkIHJlcGxheSBpbXBsZW1lbnRhdGlvbiBib3VuZCB0byBvbmUgbGlmZWN5Y2xlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBSZXBsYXkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtvcHRpb25zLmJhdGNoU2l6ZV0gLSBNYXggc2lnbmVkIG11dGF0aW9ucyBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gW29wdGlvbnMuc2lnbmFsXSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtb2ZmbGluZS1zZXNzaW9uLmpzXCIpLlN5bmNPZmZsaW5lUmVwbGF5UmVzdWx0Pn0gLSBNYXBwZWQgcmVwbGF5IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9yZXBsYXlPZmZsaW5lUGVuZGluZyhvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7c2lnbmFsLCAuLi5yZXBsYXlPcHRpb25zfSA9IG9wdGlvbnNcbiAgICBjb25zdCBsaWZlY3ljbGVTaWduYWwgPSBzaWduYWwgPz8gdGhpcy5fbGlmZWN5Y2xlQWJvcnRDb250cm9sbGVyLnNpZ25hbFxuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQobGlmZWN5Y2xlU2lnbmFsKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5vZmZsaW5lU2Vzc2lvbigpLnJlcGxheVBlbmRpbmcoey4uLnJlcGxheU9wdGlvbnMsIHNpZ25hbDogbGlmZWN5Y2xlU2lnbmFsfSlcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKGxpZmVjeWNsZVNpZ25hbClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVzdWx0LnJlc3VsdHMpIHtcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiY29uZmxpY3RcIiB8fCAhZW50cnkuc2VydmVyUmVzdWx0KSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmFwcGx5T2ZmbGluZUNvbmZsaWN0UmVwbGF5UmVzdWx0KGVudHJ5KVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBhdXRob3JpdGF0aXZlIHNlcnZlciB2ZXJzaW9uIGNhcnJpZWQgYnkgYSBzaWduZWQgcmVwbGF5XG4gICAqIGNvbmZsaWN0IHJlc3VsdCB0aHJvdWdoIHRoZSBzYW1lIGNvbmZsaWN0IGNvbnRyYWN0IHRoZSBvbmxpbmUgcmVwbGF5IHVzZXMuXG4gICAqIEBwYXJhbSB7e211dGF0aW9uOiBpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb24sIHNlcnZlclJlc3VsdDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbCwgc3RhdHVzOiBzdHJpbmd9fSBlbnRyeSAtIE1hcHBlZCByZXBsYXkgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgY29uZmxpY3Qgc2VydmVyIHZlcnNpb24gaXMgYXBwbGllZC5cbiAgICovXG4gIGFzeW5jIGFwcGx5T2ZmbGluZUNvbmZsaWN0UmVwbGF5UmVzdWx0KGVudHJ5KSB7XG4gICAgaWYgKCFlbnRyeS5zZXJ2ZXJSZXN1bHQpIHJldHVyblxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBlbnRyeS5zZXJ2ZXJSZXN1bHQucmVzcG9uc2VcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocmVzcG9uc2UpKSByZXR1cm5cblxuICAgIGNvbnN0IGNvbmZsaWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZXNwb25zZSkuY29uZmxpY3RcblxuICAgIGlmICghY29uZmxpY3QgfHwgIU9iamVjdC5oYXNPd24oY29uZmxpY3QsIFwic2VydmVyTW9kZWxcIikpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5hcHBseUNvbmZsaWN0UmVwbGF5UmVzdWx0KHtcbiAgICAgIHJlY29yZDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSAqLyAoe211dGF0aW9uOiB7cGF5bG9hZDogZW50cnkubXV0YXRpb24ucGF5bG9hZH19KSxcbiAgICAgIHJlc291cmNlVHlwZTogZW50cnkubXV0YXRpb24ubW9kZWwsXG4gICAgICByZXN1bHQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1JlcGxheUl0ZW19ICovICh7Y29uZmxpY3R9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXhwb3J0cyB0aGUgZHVyYWJsZSBub24tdGVybWluYWwgbXV0YXRpb25zIG9mIHRoZSBvZmZsaW5lIHNlc3Npb24ncyBsb2dzXG4gICAqIGFzIG9uZSBzaWduZWQgcGVlciBidW5kbGUgZm9yIGRldmljZS10by1kZXZpY2UgdHJhbnNmZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBFeHBvcnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uU3RhdHVzW119IFtvcHRpb25zLnN0YXR1c2VzXSAtIFN0YXR1c2VzIHRvIGV4cG9ydC5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbb3B0aW9ucy5ub3ddIC0gRXhwb3J0IGNsb2NrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3BlZXItbXV0YXRpb24tYnVuZGxlLmpzXCIpLlBlZXJNdXRhdGlvbkJ1bmRsZT59IC0gU2lnbmVkIHBlZXIgYnVuZGxlLlxuICAgKi9cbiAgYXN5bmMgZXhwb3J0UGVlckJ1bmRsZShvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9mZmxpbmVTZXNzaW9uKCkuZXhwb3J0QnVuZGxlKG9wdGlvbnMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbXBvcnRzIGEgcGVlciBidW5kbGUgaW50byB0aGUgbG9jYWwgbXV0YXRpb24gbG9nOiBldmVyeSBlbnRyeSBpcyB2ZXJpZmllZFxuICAgKiBhZ2FpbnN0IHRoZSBjb25maWd1cmVkIGJhY2tlbmQgcHVibGljIGtleSBiZWZvcmUgaXQgaXMgYXBwZW5kZWQsIGFuZFxuICAgKiBlbnRyaWVzIGFscmVhZHkgcHJlc2VudCBieSBpZGVtcG90ZW5jeSBrZXkgYXJlIHNraXBwZWQgYXMgZHVwbGljYXRlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbXBvcnQgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3BlZXItbXV0YXRpb24tYnVuZGxlLmpzXCIpLlBlZXJNdXRhdGlvbkJ1bmRsZX0gYXJncy5idW5kbGUgLSBQZWVyIGJ1bmRsZSB0byBpbXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdH0gW2FyZ3MubXV0YXRpb25Mb2ddIC0gVGFyZ2V0IGxvZy4gRGVmYXVsdHMgdG8gdGhlIHNlc3Npb24ncyBmaXJzdCBsb2cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vcGVlci1tdXRhdGlvbi1idW5kbGUuanNcIikuUGVlck11dGF0aW9uQnVuZGxlSW1wb3J0UmVzdWx0Pn0gLSBJbXBvcnQgcmVzdWx0IChpbXBvcnRlZC9yZWplY3RlZC9za2lwcGVkKS5cbiAgICovXG4gIGFzeW5jIGltcG9ydFBlZXJCdW5kbGUoe2J1bmRsZSwgbXV0YXRpb25Mb2d9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vZmZsaW5lU2Vzc2lvbigpLmltcG9ydEJ1bmRsZSh7YnVuZGxlLCBtdXRhdGlvbkxvZ30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGF1dGhvcml0YXRpdmUgcmVtb3RlIG9ic2VydmF0aW9uIHNvIGFuIGluLWZsaWdodCBhY2tub3dsZWRnZW1lbnRcbiAgICogY2Fubm90IHJlYmFzZSBhIHN1Y2Nlc3NvciBhY3Jvc3MgdGhhdCBvYnNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VJZDogc3RyaW5nIHwgbnVtYmVyLCByZXNvdXJjZVR5cGU6IHN0cmluZywgdmVyc2lvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGx9fSBhcmdzIC0gUmVtb3RlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHZlcnNpb259KSB7XG4gICAgdm9pZCB2ZXJzaW9uXG4gICAgY29uc3QgaWRlbnRpdHkgPSBgJHtyZXNvdXJjZVR5cGV9OiR7U3RyaW5nKHJlc291cmNlSWQpfWBcblxuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLnNldChpZGVudGl0eSwgKHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCkgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBhdXRob3JpdGF0aXZlIGJhc2UgdmVyc2lvbiBvYnNlcnZlZCBiZWZvcmUgYSBsb2NhbCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gQmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAob3BlcmF0aW9uID09PSBcImNyZWF0ZVwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgIGlmICghdmVyc2lvbkF0dHJpYnV0ZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUodmVyc2lvbkF0dHJpYnV0ZSlcblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0IHZlcnNpb24gJHt2ZXJzaW9uQXR0cmlidXRlfSBtdXN0IGJlIGEgRGF0ZSwgc3RyaW5nLCBudW1iZXIsIG9yIG51bGxgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBwcmUtYXNzaWdubWVudCB2YWx1ZSBleHBvc2VkIGJ5IHJlY29yZCBjaGFuZ2VzIGR1cmluZyBiZWZvcmVVcGRhdGUuXG4gICAqIERlbGV0ZXMgaGF2ZSBubyB2ZXJzaW9uIGNoYW5nZSBwYWlyIGFuZCB1c2UgdGhlIHJlY29yZCdzIGN1cnJlbnQgdmVyc2lvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gUHJlLW11dGF0aW9uIGJhc2UgdmVyc2lvbi5cbiAgICovXG4gIHByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuICAgIGNvbnN0IHZlcnNpb25Db2x1bW4gPSB2ZXJzaW9uQXR0cmlidXRlXG4gICAgICA/IHJlY29yZC5jb25zdHJ1Y3Rvci5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbdmVyc2lvbkF0dHJpYnV0ZV1cbiAgICAgIDogdW5kZWZpbmVkXG4gICAgY29uc3QgdmVyc2lvbkNoYW5nZSA9IG9wZXJhdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiB2ZXJzaW9uQ29sdW1uXG4gICAgICA/IHJlY29yZC5jaGFuZ2VzKClbdmVyc2lvbkNvbHVtbl1cbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIXZlcnNpb25DaGFuZ2UpIHJldHVybiB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgY29uc3QgdmFsdWUgPSB2ZXJzaW9uQ2hhbmdlWzBdXG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCB2ZXJzaW9uICR7dmVyc2lvbkF0dHJpYnV0ZX0gbXVzdCBiZSBhIERhdGUsIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyB0aGUgYmFzZSBjYXB0dXJlZCBmb3IgdGhpcyBsaWZlY3ljbGUgZXZlbnQgYmVmb3JlIGl0cyBhZnRlci1jb21taXRcbiAgICogY2xvc3VyZSBpcyBkZWZlcnJlZCwgcHJlc2VydmluZyByZXBlYXRlZCBzYW1lLXJlY29yZCB3cml0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBDYXB0dXJlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBDYXB0dXJlZCBiYXNlIHZlcnNpb24uXG4gICAqL1xuICBjYXB0dXJlZEJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNhcHR1cmVkVmVyc2lvbnMgPSB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5nZXQocmVjb3JkKVxuICAgIGNvbnN0IGJhc2VWZXJzaW9uID0gY2FwdHVyZWRWZXJzaW9ucz8uc2hpZnQoKVxuXG4gICAgaWYgKGNhcHR1cmVkVmVyc2lvbnM/Lmxlbmd0aCA9PT0gMCkgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZGVsZXRlKHJlY29yZClcbiAgICBpZiAoYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIGJhc2VWZXJzaW9uXG5cbiAgICByZXR1cm4gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgYSBiYWNrZ3JvdW5kIHJlcGxheSBhdHRlbXB0IHdpdGhvdXQgYmxvY2tpbmcgdGhlIGNhbGxlci5cbiAgICogRmFpbHVyZXMgZ28gdG8gY29uZmlnLm9uRXJyb3IgKG9yIHJldGhyb3cgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlUmVwbGF5KCkge1xuICAgIGNvbnN0IGNvb3JkaW5hdG9yUnVuID0gdGhpcy5yZXF1ZXN0Q29vcmRpbmF0b3JTeW5jKFwibXV0YXRpb25cIilcblxuICAgIGlmIChjb29yZGluYXRvclJ1bikge1xuICAgICAgdGhpcy5fc2NoZWR1bGVkUmVwbGF5ID0gY29vcmRpbmF0b3JSdW5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3NjaGVkdWxlZFJlcGxheSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJlcGxheVBlbmRpbmcoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikpIHJldHVyblxuXG4gICAgICAgIHRoaXMucmVwb3J0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcbiAgICAgIH1cbiAgICB9KSgpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIHRoZSBsYXN0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIHJlcGxheSAodXNlZnVsIGluIHRlc3RzIGFuZCBzaHV0ZG93biBmbG93cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FpdEZvclNjaGVkdWxlZFJlcGxheSgpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkUmVwbGF5KSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRSZXBsYXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGEgYmFja2dyb3VuZCBzeW5jIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gQmFja2dyb3VuZCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlcG9ydEVycm9yKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLm9uRXJyb3IpIHtcbiAgICAgIHRoaXMuY29uZmlnLm9uRXJyb3IoZXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGNvbm5lY3Rpdml0eSB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGdhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBiYWNrZW5kIGlzIGNvbnNpZGVyZWQgcmVhY2hhYmxlLlxuICAgKi9cbiAgYXN5bmMgaXNPbmxpbmUoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5pc09ubGluZSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiAoYXdhaXQgdGhpcy5jb25maWcuaXNPbmxpbmUoKSkgIT09IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2NvcGUgc3RvcmUgYmFja2luZyBkZWNsYXJlZCBzY29wZXMgYW5kIGN1cnNvcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIikuZGVmYXVsdH0gU2NvcGUgc3RvcmUuXG4gICAqL1xuICBzY29wZVN0b3JlKCkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuXG4gICAgaWYgKHRoaXMuX3Njb3BlU3RvcmUgJiYgdGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJiB0aGlzLl9zY29wZVN0b3JlLnN0b3JlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgc3RvcmUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fc2NvcGVTdG9yZSB8fD0gbmV3IFN5bmNTY29wZVN0b3JlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIHRlbmFudEhhbmRsZTogdGhpcy5jb25maWcudGVuYW50SGFuZGxlXG4gICAgfSlcblxuICAgIHJldHVybiB0aGlzLl9zY29wZVN0b3JlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZyBmb3IgYSBsb2NhbCByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlY2xhcmVkIHJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHJlc291cmNlQ29uZmlnRm9yKHJlc291cmNlKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlPy5jb25zdHJ1Y3RvclxuXG4gICAgaWYgKHR5cGVvZiBtb2RlbENsYXNzPy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHJlc291cmNlcyBtdXN0IGJlIG1vZGVsIHJlY29yZHMgd2l0aCBhIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSwgZ290OiAke1N0cmluZyhyZXNvdXJjZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZykgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yOiAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN5bmMgdHlwZSBmb3IgYSBtdXRhdGlvbiB0aHJvdWdoIHRoZSByZXNvdXJjZSBjb25maWcuIFRoZVxuICAgKiBcInVwc2VydFwiIGZsYWcgcXVldWVzIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgYXMgXCJ1cGRhdGVcIiByb3dzICh0aGUgc2VydmVyXG4gICAqIHVwc2VydHMgYnkgcmVzb3VyY2UgaWQpIGFuZCBkZXN0cm95cyBhcyBcImRlbGV0ZVwiIHJvd3MuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIE11dGF0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMgdHlwZS5cbiAgICovXG4gIGRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDb25maWcuc3luY1R5cGUgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHJlc291cmNlQ29uZmlnLnN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZH0pXG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJkZXN0cm95XCIpIHJldHVybiBcImRlbGV0ZVwiXG4gICAgaWYgKHJlc291cmNlQ29uZmlnLnN5bmNUeXBlID09PSBcInVwc2VydFwiKSByZXR1cm4gXCJ1cGRhdGVcIlxuXG4gICAgcmV0dXJuIG9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIERlcml2ZXMgdGhlIHB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncyBmcm9tIHRoZSBkZWNsYXJlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSBbb3BlcmF0aW9uXSAtIFRlbmFudCBvcGVyYXRpb24gYmluZGluZyB0aGUgcmVzb3VyY2UgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz59IFB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncy5cbiAgICovXG4gIHB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKSB7XG4gICAgaWYgKCFvcGVyYXRpb24gJiYgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncykgcmV0dXJuIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3NcblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlncyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnPn0gKi8gKE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcylcbiAgICAgICAgLmZpbHRlcigoWywgcmVzb3VyY2VdKSA9PiBCb29sZWFuKHJlc291cmNlLmF0dHJpYnV0ZXMpKVxuICAgICAgICAubWFwKChbcmVzb3VyY2VUeXBlLCByZXNvdXJjZV0pID0+IHtcbiAgICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3MocmVzb3VyY2UubW9kZWxDbGFzcykgOiByZXNvdXJjZS5tb2RlbENsYXNzXG4gICAgICAgICAgY29uc3QgZmluZFJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmRcbiAgICAgICAgICBjb25zdCBmaW5kUmVjb3JkRm9yRGVsZXRlID0gcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZVxuXG4gICAgICAgICAgcmV0dXJuIFtyZXNvdXJjZVR5cGUsIHtcbiAgICAgICAgICAgIGFmdGVyQXBwbHk6IHJlc291cmNlLmFmdGVyQXBwbHksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZ1tcImF0dHJpYnV0ZXNcIl19ICovIChyZXNvdXJjZS5hdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBmaW5kUmVjb3JkOiBvcGVyYXRpb24gJiYgZmluZFJlY29yZFxuICAgICAgICAgICAgICA/IChhcmdzKSA9PiBmaW5kUmVjb3JkKHsuLi5hcmdzLCBtb2RlbENsYXNzLCBvcGVyYXRpb246IG9wZXJhdGlvbiB8fCBudWxsfSlcbiAgICAgICAgICAgICAgOiBmaW5kUmVjb3JkLFxuICAgICAgICAgICAgZmluZFJlY29yZEZvckRlbGV0ZTogb3BlcmF0aW9uICYmIGZpbmRSZWNvcmRGb3JEZWxldGVcbiAgICAgICAgICAgICAgPyAoYXJncykgPT4gZmluZFJlY29yZEZvckRlbGV0ZSh7Li4uYXJncywgbW9kZWxDbGFzcywgb3BlcmF0aW9uOiBvcGVyYXRpb24gfHwgbnVsbH0pXG4gICAgICAgICAgICAgIDogZmluZFJlY29yZEZvckRlbGV0ZSxcbiAgICAgICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgICAgICB9XVxuICAgICAgICB9KVxuICAgICkpXG5cbiAgICBpZiAoIW9wZXJhdGlvbikgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncyA9IHJlc291cmNlQ29uZmlnc1xuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9jYWwgc3RhdGUgd29yayBvbiB0aGlzIGNsaWVudCdzIGNhcHR1cmVkIHRlbmFudCwgb3IgZGlyZWN0bHkgZm9yIHRoZSBsZWdhY3kgZGVmYXVsdC1kYXRhYmFzZSBjbGllbnQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEJvdW5kIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoVGVuYW50T3BlcmF0aW9uKGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG51bGwpXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcudGVuYW50SGFuZGxlLmRhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgbmFtZTogXCJUZW5hbnQgU3luY0NsaWVudFwiXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5jb25maWcuc3luY01vZGVsKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB3aGV0aGVyIGEgcmVjb3JkIGJlbG9uZ3MgdG8gdGhpcyBjbGllbnQncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2FuZGlkYXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyBjbGllbnQgb3ducyBpdC5cbiAgICovXG4gIG93bnNSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgcmV0dXJuIHJlY29yZC5kYXRhYmFzZUlkZW50aXR5KCkgPT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiZcbiAgICAgIGRhdGFiYXNlT3BlcmF0aW9uPy5zY2hlbWFHZW5lcmF0aW9uKCkgPT09IHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIGEgcmVjb3JkIG5vdCBvd25lZCBieSB0aGlzIGNsaWVudCdzIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDYW5kaWRhdGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFJlY29yZE93bmVyc2hpcChyZWNvcmQpIHtcbiAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlc291cmNlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRlY2xhcmVkIHF1ZXJ5IGFnYWluc3QgdGhpcyBjbGllbnQncyBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gU2NvcGUgcXVlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLnRlbmFudEhhbmRsZSB8fCAhdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBxdWVyeS5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUudGVuYW50KCl9KVxuICAgIGNvbnN0IHF1ZXJ5RGF0YWJhc2VJZGVudGl0eSA9IHF1ZXJ5Ll9vcGVyYXRpb24/LmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyIHx8XG4gICAgICAhdGhpcy5jb25maWcucmVzb3VyY2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldIHx8XG4gICAgICBxdWVyeURhdGFiYXNlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgd29yayBhZnRlciB0aGUgaGFuZGxlJ3MgcmVhZHkgcGh5c2ljYWwgc2NoZW1hIGdlbmVyYXRpb24gY2hhbmdlZCBvciBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0VGVuYW50UmVhZHkoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuXG5cbiAgICBjb25zdCBsaWZlY3ljbGUgPSB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXJ9KVxuXG4gICAgaWYgKCFsaWZlY3ljbGUucmVhZHkgfHwgIWxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uIHx8IGxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uICE9PSB0aGlzLl90ZW5hbnRTY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudCBkYXRhYmFzZSBnZW5lcmF0aW9uIGlzIHN0YWxlIG9yIG5vdCByZWFkeVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIGN1c3RvbSByZW1vdGUgcmVzb2x2ZXIgcmVzdWx0IHRvIHRoZSBhY3RpdmUgdGVuYW50IG9wZXJhdGlvbiBhZnRlciBwcm92aW5nIGl0cyBjYXB0dXJlZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBCaW5kaW5nIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KSB7XG4gICAgaWYgKHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbj8uKCkgPT09IG9wZXJhdGlvbikgcmV0dXJuXG4gICAgdGhpcy5hc3NlcnRSZWNvcmRPd25lcnNoaXAocmVjb3JkKVxuICAgIG9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBwcml2YWN5LXNhZmUgY29uZmxpY3QgbWV0YWRhdGEgZnJvbSBhIGR1cmFibGUgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBEdXJhYmxlIGNvbmZsaWN0IHJlY29yZC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0NvbmZsaWN0RGlhZ25vc3RpY30gLSBTYWZlIGRpYWdub3N0aWMuXG4gKi9cbmZ1bmN0aW9uIHN5bmNDb25mbGljdERpYWdub3N0aWMocmVjb3JkKSB7XG4gIGNvbnN0IGNvbmZsaWN0ID0gcmVjb3JkLnN5bmNSZXN1bHQ/LmNvbmZsaWN0XG4gIGNvbnN0IGNvbmZsaWN0T2JqZWN0ID0gY29uZmxpY3QgJiYgIShjb25mbGljdCBpbnN0YW5jZW9mIERhdGUpICYmIHR5cGVvZiBjb25mbGljdCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjb25mbGljdClcbiAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChjb25mbGljdClcbiAgICA6IHt9XG4gIGNvbnN0IHJlc291cmNlSWQgPSByZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZFxuXG4gIGlmICh0eXBlb2YgcmVzb3VyY2VJZCAhPT0gXCJzdHJpbmdcIiB8fCByZXNvdXJjZUlkLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0ICR7cmVjb3JkLmlkfSBpcyBtaXNzaW5nIGEgc2FmZSByZXNvdXJjZUlkYClcblxuICByZXR1cm4ge1xuICAgIGJhc2VWZXJzaW9uOiBzYWZlQ29uZmxpY3RWZXJzaW9uKGNvbmZsaWN0T2JqZWN0LmJhc2VWZXJzaW9uID8/IHJlY29yZC5tdXRhdGlvbi5iYXNlVmVyc2lvbiA/PyBudWxsKSxcbiAgICBjbGllbnRNdXRhdGlvbklkOiByZWNvcmQubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICBsb2NhbFZlcnNpb246IHNhZmVDb25mbGljdFZlcnNpb24oY29uZmxpY3RPYmplY3QubG9jYWxWZXJzaW9uID8/IG51bGwpLFxuICAgIHJlY29yZElkOiByZWNvcmQuaWQsXG4gICAgcmVzb3VyY2VJZCxcbiAgICByZXNvdXJjZVR5cGU6IHJlY29yZC5tdXRhdGlvbi5tb2RlbCxcbiAgICBzZXJ2ZXJWZXJzaW9uOiBzYWZlQ29uZmxpY3RWZXJzaW9uKGNvbmZsaWN0T2JqZWN0LnNlcnZlclZlcnNpb24gPz8gbnVsbCksXG4gICAgdmVyc2lvbkF0dHJpYnV0ZTogdHlwZW9mIGNvbmZsaWN0T2JqZWN0LnZlcnNpb25BdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgPyBjb25mbGljdE9iamVjdC52ZXJzaW9uQXR0cmlidXRlIDogbnVsbFxuICB9XG59XG5cbi8qKlxuICogUmVzdHJpY3RzIGRpYWdub3N0aWMgdmVyc2lvbnMgdG8gc2FmZSBzY2FsYXIgdmFsdWVzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZlcnNpb24gY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IC0gU2FmZSBzY2FsYXIgdmVyc2lvbi5cbiAqL1xuZnVuY3Rpb24gc2FmZUNvbmZsaWN0VmVyc2lvbih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiA/IHZhbHVlIDogbnVsbFxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgcmVzb3VyY2UgY29uZmlnIGZyb20gYSBtb2RlbCdzIGBzdGF0aWMgc3luY2AgZGVjbGFyYXRpb24gcGx1cyBpdHNcbiAqIGRlcml2ZWQgY29sdW1uIG1ldGFkYXRhLlxuICogQHBhcmFtIHt7ZGVjbGFyYXRpb246IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb24sIG1ldGFkYXRhTW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBvZmZsaW5lQ29uZmlndXJlZD86IGJvb2xlYW4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlY2xhcmF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlcml2ZWQgcmVzb3VyY2UgY29uZmlnLlxuICovXG5mdW5jdGlvbiByZXNvdXJjZUNvbmZpZ0Zyb21TeW5jRGVjbGFyYXRpb24oe2RlY2xhcmF0aW9uLCBtZXRhZGF0YU1vZGVsQ2xhc3MsIG1vZGVsQ2xhc3MsIG9mZmxpbmVDb25maWd1cmVkID0gZmFsc2UsIHJlc291cmNlVHlwZX0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZERlY2xhcmF0aW9uID0gZGVjbGFyYXRpb24gPT09IHRydWUgPyB7fSA6IGRlY2xhcmF0aW9uXG5cbiAgaWYgKCFub3JtYWxpemVkRGVjbGFyYXRpb24gfHwgdHlwZW9mIG5vcm1hbGl6ZWREZWNsYXJhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG5vcm1hbGl6ZWREZWNsYXJhdGlvbikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBtdXN0IGJlIHRydWUgb3IgYSBzeW5jIGRlY2xhcmF0aW9uIG9iamVjdCwgZ290OiAke1N0cmluZyhkZWNsYXJhdGlvbil9YClcbiAgfVxuXG4gIGNvbnN0IHthZnRlckFwcGx5LCBhdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcywgY29uZmxpY3RUcmFja2luZywgZmluZFJlY29yZCwgZmluZFJlY29yZEZvckRlbGV0ZSwgbG9jYWxPbmx5QXR0cmlidXRlcywgcHVibGlzaCwgcmVhbHRpbWUsIHN5bmNUeXBlLCB0cmFjaywgdHJhY2tlZERhdGEsIC4uLnJlc3REZWNsYXJhdGlvbn0gPSBub3JtYWxpemVkRGVjbGFyYXRpb25cbiAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0RGVjbGFyYXRpb24pXG5cbiAgLy8gYHB1Ymxpc2hgIGlzIHRoZSBzZXJ2ZXItc2lkZSBoYWxmIG9mIHRoZSBzaGFyZWQgYHN0YXRpYyBzeW5jYCBkZWNsYXJhdGlvblxuICAvLyAoY29uc3VtZWQgYnkgU3luY1B1Ymxpc2hlciBvbiB0aGUgYmFja2VuZCkgLSB0aGUgY2xpZW50IGRlcml2ZXMgbm90aGluZ1xuICAvLyBmcm9tIGl0LCBidXQgbW9kZWxzIGRlY2xhcmVkIG9uY2UgZm9yIGJvdGggc2lkZXMgbXVzdCBzdGF5IHZhbGlkIGhlcmUuXG4gIHZvaWQgcHVibGlzaFxuXG4gIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYWZ0ZXJBcHBseSwgYXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMsIGNvbmZsaWN0VHJhY2tpbmcsIGZpbmRSZWNvcmQsIGZpbmRSZWNvcmRGb3JEZWxldGUsIGxvY2FsT25seUF0dHJpYnV0ZXMsIHB1Ymxpc2gsIHJlYWx0aW1lLCBzeW5jVHlwZSwgdHJhY2ssIHRyYWNrZWREYXRhKWApXG4gIH1cbiAgaWYgKHN5bmNUeXBlICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHN5bmNUeXBlICE9PSBcImZ1bmN0aW9uXCIgJiYgc3luY1R5cGUgIT09IFwidXBzZXJ0XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBzeW5jVHlwZSBtdXN0IGJlIGEgZnVuY3Rpb24gb3IgdGhlIHN0cmluZyBcInVwc2VydFwiLCBnb3Q6ICR7U3RyaW5nKHN5bmNUeXBlKX1gKVxuICB9XG5cbiAgY29uc3QgZGVyaXZlZCA9IGRlcml2ZWRTeW5jQXR0cmlidXRlcyh7bW9kZWxDbGFzczogbWV0YWRhdGFNb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KVxuXG4gIGlmIChjb25mbGljdFRyYWNraW5nKSB2YWxpZGF0ZUNvbmZsaWN0VHJhY2tpbmcoe2NvbmZsaWN0VHJhY2tpbmcsIGRlcml2ZWQsIG9mZmxpbmVDb25maWd1cmVkLCByZXNvdXJjZVR5cGV9KVxuXG4gIHJldHVybiB7XG4gICAgYWZ0ZXJBcHBseSxcbiAgICBhdHRyaWJ1dGVzLFxuICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiBtZXJnZWRBdHRyaWJ1dGVOYW1lcyhkZXJpdmVkLmJvb2xlYW5BdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcyksXG4gICAgY29uZmxpY3RUcmFja2luZzogY29uZmxpY3RUcmFja2luZyA/IHsuLi5jb25mbGljdFRyYWNraW5nLCB2ZXJzaW9uQXR0cmlidXRlOiBjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgfHwgXCJ1cGRhdGVkQXRcIn0gOiB1bmRlZmluZWQsXG4gICAgZmluZFJlY29yZCxcbiAgICBmaW5kUmVjb3JkRm9yRGVsZXRlLFxuICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IG1lcmdlZEF0dHJpYnV0ZU5hbWVzKFxuICAgICAgZGVyaXZlZC5sb2NhbE9ubHlBdHRyaWJ1dGVzLFxuICAgICAgWy4uLihsb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSwgLi4uKGNvbmZsaWN0VHJhY2tpbmcgPyBbY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlIHx8IFwidXBkYXRlZEF0XCJdIDogW10pXVxuICAgICksXG4gICAgbWV0YWRhdGFNb2RlbENsYXNzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgcmVhbHRpbWUsXG4gICAgc3luY1R5cGUsXG4gICAgdHJhY2s6IG5vcm1hbGl6ZWRUcmFjayh0cmFjayksXG4gICAgdHJhY2tlZERhdGFcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgcmVzb3VyY2UncyBkdXJhYmxlIGNvbmZsaWN0LXRyYWNraW5nIGRlY2xhcmF0aW9uLlxuICogQHBhcmFtIHt7Y29uZmxpY3RUcmFja2luZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmxpY3RUcmFja2luZ0NvbmZpZywgZGVyaXZlZDoge2Jvb2xlYW5BdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbG9jYWxPbmx5QXR0cmlidXRlczogc3RyaW5nW119LCBvZmZsaW5lQ29uZmlndXJlZDogYm9vbGVhbiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gVmFsaWRhdGlvbiBhcmdzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlQ29uZmxpY3RUcmFja2luZyh7Y29uZmxpY3RUcmFja2luZywgZGVyaXZlZCwgb2ZmbGluZUNvbmZpZ3VyZWQsIHJlc291cmNlVHlwZX0pIHtcbiAgY29uc3QgaWRlbnRpdHlGaWVsZHMgPSB7XG4gICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgIGFjdG9yVXNlcklkOiBjb25mbGljdFRyYWNraW5nLmFjdG9yVXNlcklkLFxuICAgIG9mZmxpbmVHcmFudElkOiBjb25mbGljdFRyYWNraW5nLm9mZmxpbmVHcmFudElkLFxuICAgIHBvbGljeUhhc2g6IGNvbmZsaWN0VHJhY2tpbmcucG9saWN5SGFzaFxuICB9XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoaWRlbnRpdHlGaWVsZHMpKSB7XG4gICAgLy8gR3JhbnRzIGFuZCBwb2xpY3kgaGFzaGVzIHJvdGF0ZSBhdCBydW50aW1lOiBhIGRlY2xhcmF0aW9uIG1heSBwcm92aWRlIGFcbiAgICAvLyBzdGF0aWMgc3RyaW5nLCBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgdmFsdWUgYXQgcXVldWUgdGltZSwgb3Igb21pdCB0aGVcbiAgICAvLyBrZXkgZW50aXJlbHkgd2hlbiBhIGBzeW5jLmNsaWVudC5vZmZsaW5lYCBzZXNzaW9uIHN1cHBsaWVzIGl0LlxuICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkICYmIG9mZmxpbmVDb25maWd1cmVkKSBjb250aW51ZVxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikgY29udGludWVcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy4ke2tleX0gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGEgZnVuY3Rpb24gcmVzb2x2aW5nIG9uZSwgb3Igb21pdHRlZCB3aGVuIHN5bmMuY2xpZW50Lm9mZmxpbmUgc3VwcGxpZXMgaXRgKVxuICAgIH1cbiAgfVxuICBpZiAoIWNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgfHwgdHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgbXVzdCBiZSBhIExvY2FsTXV0YXRpb25Mb2dgKVxuICBpZiAodHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcuY2xpZW50TXV0YXRpb25JZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQgbXVzdCBiZSBhIGZ1bmN0aW9uYClcbiAgaWYgKCFjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgJiYgIWRlcml2ZWQubG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhcInVwZGF0ZWRBdFwiKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcgcmVxdWlyZXMgdmVyc2lvbkF0dHJpYnV0ZSBiZWNhdXNlIHRoZSBtb2RlbCBoYXMgbm8gdXBkYXRlZEF0IGNvbHVtbmApXG4gIH1cbn1cblxuLyoqXG4gKiBEZXJpdmVzIGJvb2xlYW4gYW5kIGxvY2FsLW9ubHkgYXR0cmlidXRlIG5hbWVzIGZyb20gYSBtb2RlbCdzIGNvbHVtbiBtZXRhZGF0YTpcbiAqIGJvb2xlYW5zIGZyb20gYm9vbGVhbiBjb2x1bW4gdHlwZXM7IGxvY2FsLW9ubHkgZnJvbSB0aGUgcHJpbWFyeSBrZXksXG4gKiBjcmVhdGVkQXQvdXBkYXRlZEF0LCBhbmQgc3luYyBib29ra2VlcGluZyBjb2x1bW5zLlxuICogQHBhcmFtIHt7bW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlcml2YXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHt7Ym9vbGVhbkF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBzdHJpbmdbXX19IERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBkZXJpdmVkU3luY0F0dHJpYnV0ZXMoe21vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pIHtcbiAgaWYgKFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5wcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCJcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVxdWlyZXMgYSBWZWxvY2lvdXMgbW9kZWwgY2xhc3Mgd2l0aCBjb2x1bW4gbWV0YWRhdGEgKGdldENvbHVtbk5hbWVzLCBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwLCBnZXRDb2x1bW5UeXBlQnlOYW1lLCBwcmltYXJ5S2V5LCBoYXNQcmltYXJ5S2V5KWApXG4gIH1cblxuICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYm9vbGVhbkF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBsb2NhbE9ubHlBdHRyaWJ1dGVzID0gW11cblxuICBpZiAobW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5KCkpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgRGVyaXZlZCBzeW5jIGF0dHJpYnV0ZXMgZm9yICR7cmVzb3VyY2VUeXBlfWApXG5cbiAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtwcmltYXJ5S2V5Q29sdW1uXSB8fCBwcmltYXJ5S2V5Q29sdW1uKVxuICB9XG5cbiAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZXMoKSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpICYmICFsb2NhbE9ubHlBdHRyaWJ1dGVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gICAgaWYgKGNvbHVtblR5cGUgJiYgaXNCb29sZWFuQ29sdW1uVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgYm9vbGVhbkF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7Ym9vbGVhbkF0dHJpYnV0ZXMsIGxvY2FsT25seUF0dHJpYnV0ZXN9XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlcml2ZWQgYXR0cmlidXRlIG5hbWVzIHdpdGggZGVjbGFyZWQgZXh0cmFzIGludG8gYSBzb3J0ZWQsIGR1cGxpY2F0ZS1mcmVlIGxpc3QuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXJpdmVkIC0gRGVyaXZlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSBkZWNsYXJlZCAtIERlY2xhcmVkIGV4dHJhIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gTWVyZ2VkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VkQXR0cmlidXRlTmFtZXMoZGVyaXZlZCwgZGVjbGFyZWQpIHtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KFsuLi5kZXJpdmVkLCAuLi4oZGVjbGFyZWQgfHwgW10pXSldLnNvcnQoKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBkZWNsYXJhdGlvbidzIHRyYWNrIHZhbHVlOiBhbiBvcGVyYXRpb25zIGFycmF5IGlzIHNob3J0aGFuZCBmb3JcbiAqIHRoZSB7b3BlcmF0aW9uc30gZm9ybS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbkNvbmZpZ1tcInRyYWNrXCJdfSB0cmFjayAtIERlY2xhcmVkIHRyYWNrIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnW1widHJhY2tcIl19IE5vcm1hbGl6ZWQgdHJhY2sgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZWRUcmFjayh0cmFjaykge1xuICBpZiAoQXJyYXkuaXNBcnJheSh0cmFjaykpIHJldHVybiB7b3BlcmF0aW9uczogdHJhY2t9XG5cbiAgcmV0dXJuIHRyYWNrXG59XG5cbi8qKlxuICogQnVpbGRzIGEgZnJhbWV3b3JrLW93bmVkIFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBmb3IgYSBwYXRoXG4gKiBjaG9zZW4gYXQgY2FsbCB0aW1lICh1c2VkIGJ5IHRoZSBsb25nLW9mZmxpbmUgc2Vzc2lvbidzIGJvb3RzdHJhcC9yZXBsYXlcbiAqIGVuZHBvaW50cywgd2hpY2ggbGl2ZSBvdXRzaWRlIHRoZSBzeW5jLmFwaSBtb3VudCBwYXRoKS5cbiAqIEBwYXJhbSB7e3JlcXVlc3RDb250ZXh0OiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudFRyYW5zcG9ydH19IGFyZ3MgLSBQb3N0ZXIgYXJncy5cbiAqIEByZXR1cm5zIHsocGF0aDogc3RyaW5nLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUGF0aC1zZWxlY3Rpbmcgc3luYyBlbmRwb2ludCBQT1NUZXIuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFBhdGhQb3N0ZXIoe3JlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnR9KSB7XG4gIHJldHVybiBhc3luYyAocGF0aCwgcGF5bG9hZCwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSBtZXJnZVJlbW90ZVJlcXVlc3RDb250ZXh0KHtcbiAgICAgIGNvbnRleHQ6IHJlcXVlc3RDb250ZXh0LFxuICAgICAgbGFiZWw6IFwiU3luYyBjbGllbnQgcmVxdWVzdCBjb250ZXh0XCIsXG4gICAgICBwYXJhbXM6IHBheWxvYWRcbiAgICB9KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdHJhbnNwb3J0LnBvc3QocGF0aCwgcmVxdWVzdFBheWxvYWQsIHtzaWduYWw6IG9wdGlvbnMuc2lnbmFsfSlcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlLmpzb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudCB0cmFuc3BvcnQucG9zdCBtdXN0IHJlc29sdmUgdG8gYSByZXNwb25zZSB3aXRoIGEganNvbigpIG1ldGhvZCBmb3IgJHtwYXRofSAobGlrZSB0aGUgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNsaWVudClgKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCByZXNwb25zZS5qc29uKClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyYW1ld29yay1vd25lZCBzeW5jIGVuZHBvaW50IFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydC5cbiAqIEBwYXJhbSB7e3BhdGg6IHN0cmluZywgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50VHJhbnNwb3J0fX0gYXJncyAtIFBvc3RlciBhcmdzLlxuICogQHJldHVybnMgeyhwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU3luYyBlbmRwb2ludCBQT1NUZXIuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFBvc3Rlcih7cGF0aCwgcmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydH0pIHtcbiAgcmV0dXJuIGFzeW5jIChwYXlsb2FkLCBvcHRpb25zID0ge30pID0+IHtcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlUmVtb3RlUmVxdWVzdENvbnRleHQoe1xuICAgICAgY29udGV4dDogcmVxdWVzdENvbnRleHQsXG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHBhcmFtczogcGF5bG9hZFxuICAgIH0pXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0cmFuc3BvcnQucG9zdChwYXRoLCByZXF1ZXN0UGF5bG9hZCwge3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuXG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UuanNvbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50IHRyYW5zcG9ydC5wb3N0IG11c3QgcmVzb2x2ZSB0byBhIHJlc3BvbnNlIHdpdGggYSBqc29uKCkgbWV0aG9kIGZvciAke3BhdGh9IChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlLmpzb24oKVxuICB9XG59XG5cbi8qKlxuICogTGF6aWx5IGJ1aWxkcyAoYW5kIG1lbW9pemVzIHBlciBjb25maWd1cmF0aW9uKSB0aGUgc3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZVxuICogYXBwJ3MgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24gYW5kIHJlZ2lzdGVycyBpdCBhcyB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzIGFuZCB0aGUgc3luYy5jbGllbnQgYmxvY2suIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7U3luY0NsaWVudH0gTWVtb2l6ZWQgc3luYyBjbGllbnQgZm9yIHRoZSBjb25maWd1cmF0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3luY0NsaWVudChjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCkpIHtcbiAgbGV0IGNsaWVudCA9IHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghY2xpZW50KSB7XG4gICAgY2xpZW50ID0gU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuICAgIHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBjbGllbnQpXG4gICAgY2xpZW50LnNldEN1cnJlbnQoKVxuICB9XG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIERlY2xhcmVzIGEgc3luYyBzY29wZSBvbiB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgZGVjbGFyaW5nIHRoZSBzeW5jIHNjb3BlLlxuICogQHJldHVybnMge1Byb21pc2U8e3Njb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGUsIHB1bGxlZDogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfT59IERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN5bmMocXVlcnkpIHtcbiAgcmV0dXJuIGF3YWl0IFN5bmNDbGllbnQuY3VycmVudCgpLnN5bmMocXVlcnkpXG59XG4iXX0=