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
import SyncAppliedSequenceStore from "./sync-applied-sequence-store.js";
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
        /** @type {import("./sync-applied-sequence-store.js").default | null} */
        this._appliedSequenceStore = null;
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
     *
     * Applies are idempotent per record: the feed is at-least-once (a realtime push
     * does not advance the pull cursor, so the same `serverSequence` arrives again
     * on the next pull). A change whose sequence is not greater than the newest one
     * already applied to that record is skipped, so a duplicate cannot overwrite
     * newer local state. Sources without a sequence (e.g. legacy broadcasts) keep
     * applying unchanged.
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
                const resourceId = String(sync.resourceId());
                const serverSequence = sync.serverSequence();
                const appliedSequences = this.appliedSequenceStore();
                if (serverSequence !== null) {
                    const lastAppliedSequence = await appliedSequences.lastAppliedSequence({ resourceId, resourceType });
                    if (lastAppliedSequence !== null && serverSequence <= lastAppliedSequence) {
                        return { changed: false, resourceType };
                    }
                }
                const versionAttribute = this.config.resources[resourceType].conflictTracking?.versionAttribute;
                if (versionAttribute) {
                    const dataAttributes = data && typeof data === "object" && !Array.isArray(data)
                        ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (data)
                        : {};
                    this.noteRemoteVersion({ resourceId, resourceType, version: dataAttributes[versionAttribute] });
                }
                const pullResourceConfigs = this.pullResourceConfigs(operation);
                const applier = SyncApiClient.resourceApplier(pullResourceConfigs, (record) => {
                    if (operation)
                        this.bindRemoteRecord({ operation, record });
                    return this.markRemoteApply(record);
                });
                const result = await applier(sync);
                if (serverSequence !== null) {
                    await appliedSequences.recordAppliedSequence({ resourceId, resourceType, serverSequence });
                }
                return result;
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
     * Returns the per-record applied-sequence store that keeps remote applies
     * idempotent across pull/realtime duplication.
     * @returns {import("./sync-applied-sequence-store.js").default} Applied-sequence store.
     */
    appliedSequenceStore() {
        this.assertTenantReady();
        if (this._appliedSequenceStore && this._databaseIdentity && this._appliedSequenceStore.storeIdentity !== this._databaseIdentity) {
            throw new Error("SyncClient applied-sequence store belongs to another or unresolved physical tenant database");
        }
        this._appliedSequenceStore ||= new SyncAppliedSequenceStore({
            configuration: this.config.configuration,
            databaseIdentifier: this.config.databaseIdentifier,
            tenantHandle: this.config.tenantHandle
        });
        return this._appliedSequenceStore;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ25FLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyx3QkFBd0IsTUFBTSxrQ0FBa0MsQ0FBQTtBQUN2RSxPQUFPLGtCQUFrQixNQUFNLDJCQUEyQixDQUFBO0FBQzFELE9BQU8sa0JBQWtCLE1BQU0sMkJBQTJCLENBQUE7QUFDMUQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxFQUFDLGlCQUFpQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFFakYsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFBO0FBRXJCLHNGQUFzRjtBQUN0RixNQUFNLHNCQUFzQixHQUFHLEVBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUMsQ0FBQTtBQUV0Rzs7Ozs7b0RBS29EO0FBQ3BELE1BQU0sMEJBQTBCLEdBQUcsQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUE7QUFFdkQsa0dB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QUFBO0lBQzlCLENBQUMsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxVQUFVLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUU7SUFDaEUsSUFBSSxNQUFNLEdBQUcsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBRTFELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNaLE1BQU0sR0FBRyxVQUFVLENBQUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDcEQsMEJBQTBCLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUNyRCxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDckIsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFBO0FBQ2YsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLElBQUksQ0FBQyxLQUFLO0lBQzlCLE9BQU8sTUFBTSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQy9DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IHtpc0Jvb2xlYW5Db2x1bW5UeXBlfSBmcm9tIFwiLi4vZGF0YWJhc2UvY29sdW1uLXR5cGVzLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQge2NhcHR1cmVSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuXG5pbXBvcnQge3NlcmlhbGl6ZWRTY29wZUZyb21RdWVyeX0gZnJvbSBcIi4vcXVlcnktc2NvcGUuanNcIlxuaW1wb3J0IFN5bmNBcGlDbGllbnQgZnJvbSBcIi4vc3luYy1hcGktY2xpZW50LmpzXCJcbmltcG9ydCBTeW5jQXBwbGllZFNlcXVlbmNlU3RvcmUgZnJvbSBcIi4vc3luYy1hcHBsaWVkLXNlcXVlbmNlLXN0b3JlLmpzXCJcbmltcG9ydCBTeW5jT2ZmbGluZVNlc3Npb24gZnJvbSBcIi4vc3luYy1vZmZsaW5lLXNlc3Npb24uanNcIlxuaW1wb3J0IFN5bmNSZWFsdGltZUJyaWRnZSBmcm9tIFwiLi9zeW5jLXJlYWx0aW1lLWJyaWRnZS5qc1wiXG5pbXBvcnQgU3luY1Njb3BlU3RvcmUgZnJvbSBcIi4vc3luYy1zY29wZS1zdG9yZS5qc1wiXG5pbXBvcnQge2N1cnJlbnRTeW5jQ2xpZW50LCBzZXRDdXJyZW50U3luY0NsaWVudH0gZnJvbSBcIi4vc3luYy1jbGllbnQtcmVnaXN0cnkuanNcIlxuXG5sZXQgY2xpZW50Q291bnRlciA9IDBcblxuLyoqIEB0eXBlIHt7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwiLCBkZXN0cm95OiBcImFmdGVyRGVzdHJveVwifX0gKi9cbmNvbnN0IFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMgPSB7Y3JlYXRlOiBcImFmdGVyQ3JlYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCIsIHVwZGF0ZTogXCJhZnRlclVwZGF0ZVwifVxuXG4vKipcbiAqIE9wZXJhdGlvbnMgdHJhY2tlZCBieSBkZWZhdWx0IGZvciBtb2RlbHMgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2Agd2l0aG91dCBhXG4gKiBgdHJhY2tgIGtleTogbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBxdWV1ZSBhdXRvbWF0aWNhbGx5LiBEZXN0cm95cyBhcmUgbm90XG4gKiB0cmFja2VkIGJ5IGRlZmF1bHQgYmVjYXVzZSBhIGxvY2FsIGRlc3Ryb3kgaXMgb2Z0ZW4gY2FjaGUgZXZpY3Rpb24gcmF0aGVyXG4gKiB0aGFuIGEgc2VydmVyIGRlbGV0ZTsgb3B0IGluIHdpdGggYHRyYWNrOiB0cnVlYCBvciBhbiBvcGVyYXRpb25zIGxpc3QuXG4gKiBAdHlwZSB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59ICovXG5jb25zdCBERUZBVUxUX1RSQUNLRURfT1BFUkFUSU9OUyA9IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXVxuXG4vKiogQXR0cmlidXRlIG5hbWVzIHRyZWF0ZWQgYXMgY2xpZW50LWxvY2FsIHN5bmMgYm9va2tlZXBpbmcgd2hlbiBkZXJpdmluZyBsb2NhbE9ubHlBdHRyaWJ1dGVzLiAqL1xuY29uc3QgTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTID0gW1wiY3JlYXRlZEF0XCIsIFwidXBkYXRlZEF0XCIsIFwibGFzdFN5bmNDaGFuZ2VBdFwiXVxuXG5jb25zdCBTWU5DX1JFUVVFU1RfUkVTRVJWRURfS0VZUyA9IFtcbiAgXCJhZnRlcklkXCIsXG4gIFwiYWZ0ZXJTZXJ2ZXJTZXF1ZW5jZVwiLFxuICBcImFmdGVyVXBkYXRlZEF0XCIsXG4gIFwiYXV0aGVudGljYXRpb25Ub2tlblwiLFxuICBcImxpbWl0XCIsXG4gIFwic2NvcGVcIixcbiAgXCJzeW5jc1wiLFxuICBcInVwc3RyZWFtUmVmcmVzaFwiLFxuICBcInVwVG9JZFwiLFxuICBcInVwVG9TZXJ2ZXJTZXF1ZW5jZVwiLFxuICBcInVwVG9VcGRhdGVkQXRcIlxuXVxuXG4vKiogQHR5cGUge1dlYWtNYXA8Q29uZmlndXJhdGlvbiwgU3luY0NsaWVudD59ICovXG5jb25zdCBzeW5jQ2xpZW50c0J5Q29uZmlndXJhdGlvbiA9IG5ldyBXZWFrTWFwKClcblxuLyoqIEV4cGVjdGVkIGNvb3BlcmF0aXZlIGNhbmNlbGxhdGlvbiByYWlzZWQgYnkgYSBTeW5jQ2xpZW50IGxpZmVjeWNsZSB0cmFuc2l0aW9uLiAqL1xuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogQnVpbGRzIGFuIGV4cGVjdGVkIGxpZmVjeWNsZSBjYW5jZWxsYXRpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiByZWFzb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIlN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIERlY2xhcmF0aXZlIGNsaWVudC1zaWRlIHN5bmMgZHJpdmVyLlxuICpcbiAqIEV2ZXJ5dGhpbmcgaXMgZGVyaXZlZCBmcm9tIHRoZSBhcHAncyBWZWxvY2lvdXMgY29uZmlndXJhdGlvbjogbW9kZWxzIGRlY2xhcmVcbiAqIGBzdGF0aWMgc3luY2AsIHRyYW5zcG9ydC9hdXRoL2Nvbm5lY3Rpdml0eSBjb21lIGZyb20gdGhlIGBzeW5jLmNsaWVudGBcbiAqIGNvbmZpZ3VyYXRpb24gYmxvY2ssIGFuZCBWZWxvY2lvdXMgb3ducyBzY29wZSBwZXJzaXN0ZW5jZSwgcGVyLXNjb3BlIGN1cnNvcnMsXG4gKiBwdWxsIHBhZ2luZy9hcHBseSwgbG9jYWwgcXVldWVpbmcsIGFuZCBvbmxpbmUtZ2F0ZWQgcmVwbGF5LiBEZWNsYXJlIHN5bmNcbiAqIGludGVyZXN0IGZyb20gcXVlcmllczpcbiAqXG4gKiAgICAgYXdhaXQgc3luY0NsaWVudCgpLnN0YXJ0KClcbiAqICAgICBhd2FpdCBzeW5jQ2xpZW50KCkuc3luYyhFdmVudC53aGVyZSh7cGFydG5lcklkfSkpXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNDbGllbnQge1xuICAvKipcbiAgICogQnVpbGRzIHRoZSBzeW5jIGNsaWVudCBieSBkZXJpdmluZyBldmVyeXRoaW5nIGZyb20gdGhlIGFwcCdzIFZlbG9jaW91c1xuICAgKiBjb25maWd1cmF0aW9uOiBldmVyeSByZWdpc3RlcmVkIG1vZGVsIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIGJlY29tZXMgYVxuICAgKiByZXNvdXJjZSB3aXRoIGJvb2xlYW5BdHRyaWJ1dGVzIGRlcml2ZWQgZnJvbSBjb2x1bW4gdHlwZXMgYW5kXG4gICAqIGxvY2FsT25seUF0dHJpYnV0ZXMgZGVyaXZlZCBmcm9tIHRoZSBwcmltYXJ5IGtleSwgY3JlYXRlZEF0L3VwZGF0ZWRBdCwgYW5kXG4gICAqIHN5bmMgYm9va2tlZXBpbmcgY29sdW1uczsgdGhlIHBlbmRpbmctc3luYyBtb2RlbCBpcyB0aGUgcmVnaXN0ZXJlZCBcIlN5bmNcIlxuICAgKiBtb2RlbDsgdHJhbnNwb3J0LCBhdXRoLCBjb25uZWN0aXZpdHksIGFuZCBlcnJvciByZXBvcnRpbmcgY29tZSBmcm9tIHRoZVxuICAgKiBgc3luYy5jbGllbnRgIGNvbmZpZ3VyYXRpb24gYmxvY2ssIHdpdGggdGhlIGZyYW1ld29yayBvd25pbmcgdGhlXG4gICAqIGAke21vdW50UGF0aH0vY2hhbmdlc2AgYW5kIGAke21vdW50UGF0aH0vcmVwbGF5YCBQT1NUZXJzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudE9wdGlvbnN9IFtvcHRpb25zXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCksIGRhdGFiYXNlSWRlbnRpZmllciwgbGVnYWN5Q3Vyc29yLCByZXF1ZXN0Q29udGV4dCwgc2NvcGVTdG9yZSwgc3luY01vZGVsLCB0ZW5hbnRIYW5kbGUsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG5cbiAgICBjb25zdCBjbGllbnRDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpLmNsaWVudFxuICAgIGNvbnN0IGNhcHR1cmVkUmVxdWVzdENvbnRleHQgPSBjYXB0dXJlUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHtcbiAgICAgIGxhYmVsOiBcIlN5bmMgY2xpZW50IHJlcXVlc3QgY29udGV4dFwiLFxuICAgICAgcmVzZXJ2ZWRLZXlzOiBTWU5DX1JFUVVFU1RfUkVTRVJWRURfS0VZU1xuICAgIH0pXG5cbiAgICBpZiAoIWNsaWVudENvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgcmVxdWlyZXMgYSBzeW5jLmNsaWVudCBjb25maWd1cmF0aW9uIGJsb2NrOiBuZXcgQ29uZmlndXJhdGlvbih7c3luYzoge2NsaWVudDoge2F1dGhlbnRpY2F0aW9uVG9rZW4sIHRyYW5zcG9ydH19fSlcIilcbiAgICB9XG5cbiAgICBpZiAoQm9vbGVhbih0ZW5hbnRIYW5kbGUpICE9PSBCb29sZWFuKGRhdGFiYXNlSWRlbnRpZmllcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgdGVuYW50SGFuZGxlIGFuZCBkYXRhYmFzZUlkZW50aWZpZXIgbXVzdCBiZSBwcm92aWRlZCB0b2dldGhlclwiKVxuICAgIH1cbiAgICBpZiAodGVuYW50SGFuZGxlKSB7XG4gICAgICB0ZW5hbnRIYW5kbGUuYXNzZXJ0Q29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuICAgICAgdGVuYW50SGFuZGxlLmRhdGFiYXNlQ29uZmlndXJhdGlvbigvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllcikpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxDbGFzc2VzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHJlc29sdmVkU3luY01vZGVsID0gc3luY01vZGVsIHx8IG1vZGVsQ2xhc3Nlcy5TeW5jXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGl0eSA9IHRlbmFudEhhbmRsZSA/IHRlbmFudEhhbmRsZS5kYXRhYmFzZUlkZW50aXR5KC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSkgOiBudWxsXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZz59ICovXG4gICAgY29uc3QgcmVzb3VyY2VzID0ge31cblxuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKG1vZGVsQ2xhc3NlcykpIHtcbiAgICAgIGlmICghbW9kZWxDbGFzcy5zeW5jKSBjb250aW51ZVxuICAgICAgaWYgKHRlbmFudEhhbmRsZSAmJiBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0ZW5hbnRIYW5kbGUudGVuYW50KCl9KSAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIGNvbnN0IG1ldGFkYXRhTW9kZWxDbGFzcyA9IHRlbmFudEhhbmRsZVxuICAgICAgICA/IHRlbmFudEhhbmRsZS5tZXRhZGF0YU1vZGVsQ2xhc3Moe2RhdGFiYXNlSWRlbnRpZmllcjogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpLCBtb2RlbENsYXNzfSlcbiAgICAgICAgOiBtb2RlbENsYXNzXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHJlc291cmNlQ29uZmlnRnJvbVN5bmNEZWNsYXJhdGlvbih7ZGVjbGFyYXRpb246IG1vZGVsQ2xhc3Muc3luYywgbWV0YWRhdGFNb2RlbENsYXNzLCBtb2RlbENsYXNzLCBvZmZsaW5lQ29uZmlndXJlZDogQm9vbGVhbihjbGllbnRDb25maWd1cmF0aW9uLm9mZmxpbmUpLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgICBpZiAoZGF0YWJhc2VJZGVudGl0eSAmJiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcgPSB7XG4gICAgICAgICAgLi4ucmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyxcbiAgICAgICAgICBtdXRhdGlvbkxvZzogcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5wYXJ0aXRpb24oZGF0YWJhc2VJZGVudGl0eSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXNvdXJjZXNbcmVzb3VyY2VUeXBlXSA9IHJlc291cmNlQ29uZmlnXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlc291cmNlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IGZvdW5kIG5vIHJlZ2lzdGVyZWQgbW9kZWxzIGRlY2xhcmluZyBzdGF0aWMgc3luYyAtIGRlY2xhcmUgYHN0YXRpYyBzeW5jID0gdHJ1ZWAgKG9yIGEgc3luYyBkZWNsYXJhdGlvbiBvYmplY3QpIG9uIHRoZSBtb2RlbHMgdGhhdCBzaG91bGQgc3luY1wiKVxuICAgIH1cblxuICAgIGlmICghcmVzb2x2ZWRTeW5jTW9kZWwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgcmVxdWlyZXMgYSByZWdpc3RlcmVkIFxcXCJTeW5jXFxcIiBtb2RlbCBmb3IgcGVuZGluZyBsb2NhbCBzeW5jIHJvd3MgKG9yIHBhc3Mgb3B0aW9ucy5zeW5jTW9kZWwpXCIpXG4gICAgfVxuICAgIGlmICh0ZW5hbnRIYW5kbGUgJiYgcmVzb2x2ZWRTeW5jTW9kZWwuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IHRlbmFudEhhbmRsZS50ZW5hbnQoKX0pICE9PSBkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCBzeW5jIG1vZGVsIGRvZXMgbm90IHVzZSB0ZW5hbnQgZGF0YWJhc2UgJHtKU09OLnN0cmluZ2lmeShkYXRhYmFzZUlkZW50aWZpZXIpfWApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25maWd9ICovXG4gICAgdGhpcy5jb25maWcgPSB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBjbGllbnRDb25maWd1cmF0aW9uLmF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemU6IGNsaWVudENvbmZpZ3VyYXRpb24uYmF0Y2hTaXplLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIGlzT25saW5lOiBjbGllbnRDb25maWd1cmF0aW9uLmlzT25saW5lLFxuICAgICAgbGVnYWN5Q3Vyc29yLFxuICAgICAgb25FcnJvcjogY2xpZW50Q29uZmlndXJhdGlvbi5vbkVycm9yLFxuICAgICAgb2ZmbGluZTogY2xpZW50Q29uZmlndXJhdGlvbi5vZmZsaW5lLFxuICAgICAgb2ZmbGluZVBvc3Q6IHRyYW5zcG9ydFBhdGhQb3N0ZXIoe3JlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICBwb3N0Q2hhbmdlczogdHJhbnNwb3J0UG9zdGVyKHtwYXRoOiBgJHtjbGllbnRDb25maWd1cmF0aW9uLm1vdW50UGF0aH0vY2hhbmdlc2AsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICBwb3N0UmVwbGF5OiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9yZXBsYXlgLCByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0OiBjbGllbnRDb25maWd1cmF0aW9uLnRyYW5zcG9ydH0pLFxuICAgICAgcmVhbHRpbWU6IGNsaWVudENvbmZpZ3VyYXRpb24ucmVhbHRpbWUsXG4gICAgICByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCxcbiAgICAgIHJlc291cmNlcyxcbiAgICAgIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWwsXG4gICAgICB0ZW5hbnRIYW5kbGUsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQ6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0Q2xpZW50LFxuICAgICAgd2Vic29ja2V0VXJsOiBjbGllbnRDb25maWd1cmF0aW9uLndlYnNvY2tldFVybFxuICAgIH1cbiAgICB0aGlzLl9jbGllbnROdW1iZXIgPSArK2NsaWVudENvdW50ZXJcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ID0gZGF0YWJhc2VJZGVudGl0eVxuICAgIHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb24gPSB0ZW5hbnRIYW5kbGVcbiAgICAgID8gdGVuYW50SGFuZGxlLmluc3BlY3Qoe2RhdGFiYXNlSWRlbnRpZmllcjogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpfSkuc2NoZW1hR2VuZXJhdGlvblxuICAgICAgOiBudWxsXG4gICAgLyoqIEB0eXBlIHtTeW5jUmVhbHRpbWVCcmlkZ2UgfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWx0aW1lQnJpZGdlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7U3luY09mZmxpbmVTZXNzaW9uIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9vZmZsaW5lU2Vzc2lvbiA9IG51bGxcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFNoYXJlZENvbm5lY3Rpb24gfCBudWxsIHwgdW5kZWZpbmVkfSBTaGFyZWQgYXBwLWxpZmV0aW1lIHdlYnNvY2tldCBjb25uZWN0aW9uICh1bmRlZmluZWQgdW50aWwgZmlyc3QgcmVzb2x2ZWQsIG51bGwgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQpLiAqL1xuICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7XCJzdWJzY3JpYmVkXCIgfCBcInN1YnNjcmliaW5nXCIgfCBcInVuc3Vic2NyaWJlZFwifSAqL1xuICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLXNjb3BlLXN0b3JlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIHRoaXMuX3Njb3BlU3RvcmUgPSBzY29wZVN0b3JlIHx8IG51bGxcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcHBsaWVkLXNlcXVlbmNlLXN0b3JlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIHRoaXMuX2FwcGxpZWRTZXF1ZW5jZVN0b3JlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc2NoZWR1bGVkUmVwbGF5ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7KChyZWFzb246IFwibXV0YXRpb25cIiB8IFwicmVhbHRpbWVcIikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAqL1xuICAgIHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlciA9IG51bGxcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3MgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2FsbGJhY2s6IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZCwgY2FsbGJhY2tOYW1lOiBcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiLCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MgPSBbXVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxvYmplY3Q+fSAqL1xuICAgIHRoaXMuX3JlbW90ZUFwcGx5UmVjb3JkcyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgdGhpcy5fcmVtb3RlR2VuZXJhdGlvbnMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8b2JqZWN0LCBBcnJheTxzdHJpbmcgfCBudW1iZXIgfCBudWxsPj59ICovXG4gICAgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGggPSAwXG4gICAgLyoqIEB0eXBlIHtMb2dnZXIgfCB7ZXJyb3I6ICguLi5tZXNzYWdlczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fSB8IG51bGx9ICovXG4gICAgdGhpcy5fbG9nZ2VyID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dW5rbm93bj4+fSAqL1xuICAgIHRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmsgPSBuZXcgU2V0KClcbiAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uID0gMFxuICAgIHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCA9IDBcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3RyYWNraW5nR2VuZXJhdGlvbiA9IDBcbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYXV0b21hdGljIG11dGF0aW9uIHRyYWNraW5nIGZvciBldmVyeSBkZWNsYXJlZCByZXNvdXJjZSAob24gYnlcbiAgICogZGVmYXVsdDogbG9jYWwgY3JlYXRlcyBhbmQgdXBkYXRlcyBxdWV1ZSBwZW5kaW5nIHN5bmMgcm93cyBvbmNlIHRoZWlyXG4gICAqIHRyYW5zYWN0aW9uIGNvbW1pdHMgYW5kIHNjaGVkdWxlIGFuIGltbWVkaWF0ZSByZXBsYXkgYXR0ZW1wdCwgd2l0aG91dFxuICAgKiBhcHAtc2lkZSBxdWV1ZSBjYWxscykuIGB0cmFjazogZmFsc2VgIHJlc291cmNlcyBhcmUgc2tpcHBlZDsgYHRyYWNrOiB0cnVlYFxuICAgKiBhZGRzIGRlc3Ryb3lzOyBhbiBvcGVyYXRpb25zIGxpc3QgbmFycm93cyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIGNvbnN0IHRyYWNraW5nR2VuZXJhdGlvbiA9IHRoaXMuX3RyYWNraW5nR2VuZXJhdGlvblxuXG4gICAgYXdhaXQgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2VcbiAgICBpZiAodHJhY2tpbmdHZW5lcmF0aW9uICE9PSB0aGlzLl90cmFja2luZ0dlbmVyYXRpb24pIHJldHVyblxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICh0aGlzLl9zdGFydGVkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0ZWQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICBjb25zdCBvcGVyYXRpb25zID0gdGhpcy50cmFja2VkT3BlcmF0aW9ucyh7cmVzb3VyY2VDb25maWcsIHJlc291cmNlVHlwZX0pXG5cbiAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gXCJjcmVhdGVcIikpIHtcbiAgICAgICAgICBjb25zdCBjYWxsYmFja05hbWUgPSBvcGVyYXRpb24gPT09IFwiZGVzdHJveVwiID8gXCJiZWZvcmVEZXN0cm95XCIgOiBcImJlZm9yZVVwZGF0ZVwiXG4gICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gcmVjb3JkKSA9PiB7XG4gICAgICAgICAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSByZXR1cm5cbiAgICAgICAgICAgIGlmICh0aGlzLmlzVHJhY2tpbmdTdXBwcmVzc2VkKHJlY29yZCkpIHJldHVyblxuXG4gICAgICAgICAgICBjb25zdCBjYXB0dXJlZFZlcnNpb25zID0gdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZ2V0KHJlY29yZCkgfHwgW11cblxuICAgICAgICAgICAgY2FwdHVyZWRWZXJzaW9ucy5wdXNoKHRoaXMucHJlTXV0YXRpb25CYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkpXG4gICAgICAgICAgICB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5zZXQocmVjb3JkLCBjYXB0dXJlZFZlcnNpb25zKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gVFJBQ0tFRF9DQUxMQkFDS19OQU1FU1tvcGVyYXRpb25dXG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gdGhpcy50cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgICAgcmVzb3VyY2VDb25maWcubW9kZWxDbGFzc1tjYWxsYmFja05hbWVdKGNhbGxiYWNrKVxuICAgICAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzLnB1c2goe2NhbGxiYWNrLCBjYWxsYmFja05hbWUsIG1vZGVsQ2xhc3M6IHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3N9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbGwgdHJhY2tpbmcgY2FsbGJhY2tzLCBhYm9ydHMgaW4tZmxpZ2h0IHB1bGwvcmVwbGF5L3JlYWx0aW1lXG4gICAqIHdvcmsgYW5kIHJlc29sdmVzIGFmdGVyIGl0IGlzIHF1aWVzY2VudC4gT3B0aW9uYWwgc2VsZWN0ZWQgc2NvcGUgcmVzZXQgYW5kXG4gICAqIGFwcC1vd25lZCBjbGVhbnVwIGhhcHBlbiBhZnRlciBvbGQgd29yayBkcmFpbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U3RvcE9wdGlvbnN9IFtvcHRpb25zXSAtIFN0b3AgYW5kIHNlbGVjdGVkLXNjb3BlIHJlc2V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RvcChvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLl90cmFja2luZ0dlbmVyYXRpb24gKz0gMVxuXG4gICAgZm9yIChjb25zdCB7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzc30gb2YgdGhpcy5fdHJhY2tlZENhbGxiYWNrcykge1xuICAgICAgbW9kZWxDbGFzcy51bnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLl9ydW5MaWZlY3ljbGVUcmFuc2l0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3Jlc2V0U2NvcGVzRm9yTGlmZWN5Y2xlKG9wdGlvbnMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBYm9ydHMgYW5kIGRyYWlucyBjdXJyZW50IHdvcmssIHRoZW4gYXRvbWljYWxseSByZXNldHMgc2VsZWN0ZWQgc2NvcGVcbiAgICogY3Vyc29ycyB0b2dldGhlciB3aXRoIGFuIG9wdGlvbmFsIGFwcC1vd25lZCBsb2NhbC1yb3cgY2xlYW51cCBob29rLlxuICAgKiBUcmFja2luZyBkZWNsYXJhdGlvbnMgcmVtYWluIHJlZ2lzdGVyZWQgc28gdGhlIHNhbWUgY2xpZW50IG1heSBjb250aW51ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGVbXX0gc2NvcGVzIC0gU2VsZWN0ZWQgc2NvcGVzIHRvIHJlc2V0LlxuICAgKiBAcGFyYW0ge3tjbGVhbnVwPzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U2NvcGVDbGVhbnVwfX0gW29wdGlvbnNdIC0gU2NvcGUgY2xlYW51cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlc2V0U2NvcGVzKHNjb3Blcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZSh7Li4ub3B0aW9ucywgcmVzZXRTY29wZXM6IHNjb3Blc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlcGxhY2VzIHRoZSBleHRlcm5hbCBpZGVudGl0eSByZWFkIGJ5IHRoZSBjb25maWd1cmVkIGF1dGggYW5kXG4gICAqIHNjb3BlLW93bmVyIHJlc29sdmVyczogb2xkIHdvcmsgaXMgYWJvcnRlZCBhbmQgZHJhaW5lZCwgc2VsZWN0ZWQgcHJpdmF0ZVxuICAgKiBzY29wZSBzdGF0ZS9jYWNoZSBpcyByZXNldCwgdGhlbiB0aGUgYXBwJ3MgcmVwbGFjZW1lbnQgY2FsbGJhY2sgcnVucyB3aGlsZVxuICAgKiBuZXcgc3luYyB3b3JrIHJlbWFpbnMgYmVoaW5kIHRoZSBsaWZlY3ljbGUgYmFycmllci4gT3B0aW9uYWxseSBzdWJzY3JpYmVzXG4gICAqIHRoZSBuZXcgdXNlciBzY29wZSBiZWZvcmUgcmVzb2x2aW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlcGxhY2VJZGVudGl0eU9wdGlvbnN9IG9wdGlvbnMgLSBJZGVudGl0eSByZXBsYWNlbWVudCBjb250cmFjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBsYWNlSWRlbnRpdHkob3B0aW9ucykge1xuICAgIGlmICghb3B0aW9ucyB8fCB0eXBlb2Ygb3B0aW9ucyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50LnJlcGxhY2VJZGVudGl0eSByZXF1aXJlcyBhbiBvcHRpb25zIG9iamVjdFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtjbGVhbnVwLCByZXBsYWNlLCByZXNldFNjb3BlcyA9IFtdLCBzdWJzY3JpYmVVc2VyU2NvcGUgPSBmYWxzZSwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0T3B0aW9ucylcbiAgICBpZiAodHlwZW9mIHJlcGxhY2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudC5yZXBsYWNlSWRlbnRpdHkgcmVxdWlyZXMgYSByZXBsYWNlIGNhbGxiYWNrXCIpXG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpYmVVc2VyU2NvcGUgIT09IFwiYm9vbGVhblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50LnJlcGxhY2VJZGVudGl0eSBzdWJzY3JpYmVVc2VyU2NvcGUgbXVzdCBiZSBib29sZWFuXCIpXG5cbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVUcmFuc2l0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3Jlc2V0U2NvcGVzRm9yTGlmZWN5Y2xlKHtjbGVhbnVwLCByZXNldFNjb3Blc30pXG4gICAgICBhd2FpdCByZXBsYWNlKClcbiAgICB9KVxuXG4gICAgaWYgKHN1YnNjcmliZVVzZXJTY29wZSkgYXdhaXQgdGhpcy5zdWJzY3JpYmVVc2VyU2NvcGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGNhbGxiYWNrIHdoaWxlIGhvbGRpbmcgdGhlIGN1cnJlbnQgbGlmZWN5Y2xlIGdlbmVyYXRpb24gYW5kXG4gICAqIHRyYWNrcyBpdCBzbyBzdG9wL3Jlc2V0L2lkZW50aXR5IHJlcGxhY2VtZW50IGNhbiBhd2FpdCBxdWllc2NlbmNlLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7KHNpZ25hbDogQWJvcnRTaWduYWwpID0+IFByb21pc2U8UmVzdWx0Pn0gY2FsbGJhY2sgLSBHZW5lcmF0aW9uLWJvdW5kIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5MaWZlY3ljbGVXb3JrKGNhbGxiYWNrKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCA+IDApIGF3YWl0IHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Qcm9taXNlXG5cbiAgICBjb25zdCBzaWduYWwgPSB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIuc2lnbmFsXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICBjb25zdCBwcm9taXNlID0gY2FsbGJhY2soc2lnbmFsKVxuXG4gICAgdGhpcy5fYWN0aXZlTGlmZWN5Y2xlV29yay5hZGQocHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrLmRlbGV0ZShwcm9taXNlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG11dGF0aW9uIHF1ZXVlaW5nIG9ubHkgd2hpbGUgdGhlIGxpZmVjeWNsZSBnZW5lcmF0aW9uIGNhcHR1cmVkIGJ5IHRoZVxuICAgKiBjYWxsZXIgcmVtYWlucyBhY3RpdmUuIFVubGlrZSBwdWxscywgYSBtdXRhdGlvbiBtdXN0IG5ldmVyIHdhaXQgdGhyb3VnaCBhblxuICAgKiBpZGVudGl0eSB0cmFuc2l0aW9uIGFuZCB0aGVuIHBlcnNpc3QgdW5kZXIgdGhlIHJlcGxhY2VtZW50IGlkZW50aXR5LlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsaWZlY3ljbGVHZW5lcmF0aW9uIC0gR2VuZXJhdGlvbiBvd25pbmcgdGhlIG11dGF0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmVzdWx0Pn0gY2FsbGJhY2sgLSBNdXRhdGlvbiBxdWV1ZWluZyB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuTXV0YXRpb25MaWZlY3ljbGVXb3JrKGxpZmVjeWNsZUdlbmVyYXRpb24sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fYXNzZXJ0TXV0YXRpb25MaWZlY3ljbGVHZW5lcmF0aW9uKGxpZmVjeWNsZUdlbmVyYXRpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLl9hc3NlcnRNdXRhdGlvbkxpZmVjeWNsZUdlbmVyYXRpb24obGlmZWN5Y2xlR2VuZXJhdGlvbilcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgbXV0YXRpb24gcXVldWVpbmcgY2FwdHVyZWQgb3V0c2lkZSB0aGUgY3VycmVudCBzdGFibGUgbGlmZWN5Y2xlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbGlmZWN5Y2xlR2VuZXJhdGlvbiAtIEdlbmVyYXRpb24gb3duaW5nIHRoZSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXNzZXJ0TXV0YXRpb25MaWZlY3ljbGVHZW5lcmF0aW9uKGxpZmVjeWNsZUdlbmVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvbkNvdW50ID09PSAwICYmIGxpZmVjeWNsZUdlbmVyYXRpb24gPT09IHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb24pIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBtdXRhdGlvbiBiZWxvbmdzIHRvIGFuIGluYWN0aXZlIGxpZmVjeWNsZSBnZW5lcmF0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBhIGxpZmVjeWNsZSBiYXJyaWVyOiBjb29wZXJhdGl2ZWx5IGFib3J0cyB0cmFuc3BvcnQvc3RhcnQgd29yayxcbiAgICogc3RvcHMgbmV3IHJlYWx0aW1lIGRlbGl2ZXJ5LCBhd2FpdHMgb2xkIGFwcGxpZXMvcmVwbGF5cy9wdWxscywgcmVqZWN0cyBvblxuICAgKiB1bmV4cGVjdGVkIG9sZC13b3JrIGZhaWx1cmVzLCB0aGVuIHJ1bnMgdGhlIHJlc2V0L3JlcGxhY2VtZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gVHJhbnNpdGlvbiBhY3Rpb24gYWZ0ZXIgcXVpZXNjZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBfcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihjYWxsYmFjaykge1xuICAgIHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCArPSAxXG5cbiAgICAvLyB1bnN1YnNjcmliZSgpIGludmFsaWRhdGVzIHRoZSBzdWJzY3JpcHRpb24gZ2VuZXJhdGlvbiBzeW5jaHJvbm91c2x5LCBzb1xuICAgIC8vIGFuIG9sZCBvblJlc3VtZS9vbk1lc3NhZ2UgY2FsbGJhY2sgY2Fubm90IGVudGVyIHRoaXMgdHJhbnNpdGlvbidzIGRyYWluLlxuICAgIGNvbnN0IHJlYWx0aW1lVW5zdWJzY3JpYmVQcm9taXNlID0gdGhpcy5fcmVhbHRpbWVCcmlkZ2U/LnVuc3Vic2NyaWJlKClcbiAgICBjb25zdCBwcmV2aW91c1RyYW5zaXRpb24gPSB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZVxuICAgIGNvbnN0IHRyYW5zaXRpb24gPSBwcmV2aW91c1RyYW5zaXRpb24udGhlbihhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhYm9ydENvbnRyb2xsZXIgPSB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXJcbiAgICAgIGNvbnN0IGFib3J0UmVhc29uID0gbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjbGllbnQgbGlmZWN5Y2xlIHdhcyBzdG9wcGVkXCIpXG5cbiAgICAgIGFib3J0Q29udHJvbGxlci5hYm9ydChhYm9ydFJlYXNvbilcblxuICAgICAgaWYgKHJlYWx0aW1lVW5zdWJzY3JpYmVQcm9taXNlKSBhd2FpdCByZWFsdGltZVVuc3Vic2NyaWJlUHJvbWlzZVxuXG4gICAgICBjb25zdCB3b3JrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4udGhpcy5fYWN0aXZlTGlmZWN5Y2xlV29ya10pXG5cbiAgICAgIGlmICh0aGlzLl9yZWFsdGltZUJyaWRnZSkgYXdhaXQgdGhpcy5fcmVhbHRpbWVCcmlkZ2Uud2FpdEZvckFwcGxpZWQoKVxuXG4gICAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICAgIGNvbnN0IHVuZXhwZWN0ZWRFcnJvcnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiB3b3JrUmVzdWx0cykge1xuICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiICYmICF0aGlzLmlzTGlmZWN5Y2xlQWJvcnQocmVzdWx0LnJlYXNvbikpIHVuZXhwZWN0ZWRFcnJvcnMucHVzaChyZXN1bHQucmVhc29uKVxuICAgICAgfVxuXG4gICAgICBpZiAodW5leHBlY3RlZEVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IHVuZXhwZWN0ZWRFcnJvcnNbMF1cbiAgICAgIGlmICh1bmV4cGVjdGVkRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcih1bmV4cGVjdGVkRXJyb3JzLCBcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSBmYWlsZWQgd2hpbGUgYmVjb21pbmcgcXVpZXNjZW50XCIpXG5cbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgICAgdGhpcy5fbGlmZWN5Y2xlR2VuZXJhdGlvbiArPSAxXG4gICAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgLT0gMVxuICAgICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgIH0pXG5cbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZSA9IHRyYW5zaXRpb24udGhlbigoKSA9PiB1bmRlZmluZWQsICgpID0+IHVuZGVmaW5lZClcblxuICAgIHJldHVybiB0cmFuc2l0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVzZXRzIHNlbGVjdGVkIHNjb3BlcyB0aHJvdWdoIHRoZSBmcmFtZXdvcmstb3duZWQgc3RvcmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U3RvcE9wdGlvbnN9IG9wdGlvbnMgLSBSZXNldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZShvcHRpb25zKSB7XG4gICAgY29uc3Qge2NsZWFudXAsIHJlc2V0U2NvcGVzID0gW10sIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc2V0U2NvcGVzKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjbGllbnQgcmVzZXRTY29wZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIGlmIChjbGVhbnVwICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNsZWFudXAgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjbGllbnQgY2xlYW51cCBtdXN0IGJlIGEgZnVuY3Rpb25cIilcbiAgICBpZiAoY2xlYW51cCAmJiByZXNldFNjb3Blcy5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IGNsZWFudXAgcmVxdWlyZXMgYXQgbGVhc3Qgb25lIHJlc2V0IHNjb3BlXCIpXG4gICAgaWYgKHJlc2V0U2NvcGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5yZXNldChyZXNldFNjb3Blcywge2NsZWFudXB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gZXJyb3IgaXMgdGhlIGZyYW1ld29yaydzIG5hcnJvdyBleHBlY3RlZCBsaWZlY3ljbGUgYWJvcnQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYW5kaWRhdGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhbiBleHBlY3RlZCBsaWZlY3ljbGUgYWJvcnQuXG4gICAqL1xuICBpc0xpZmVjeWNsZUFib3J0KGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgU3luY0NsaWVudExpZmVjeWNsZUFib3J0RXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBUaHJvd3MgdGhlIGN1cnJlbnQgbGlmZWN5Y2xlIHJlYXNvbiB3aGVuIHRoZSBzaWduYWwgaXMgYWJvcnRlZC5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIHNpZ25hbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKSB7XG4gICAgaWYgKCFzaWduYWwuYWJvcnRlZCkgcmV0dXJuXG5cbiAgICB0aHJvdyBzaWduYWwucmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyBzaWduYWwucmVhc29uIDogbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjbGllbnQgbGlmZWN5Y2xlIHdhcyBzdG9wcGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW5kIHZhbGlkYXRlcyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zIGZvciBhIHJlc291cmNlIGNvbmZpZy5cbiAgICogVHJhY2tpbmcgaXMgb24gYnkgZGVmYXVsdDogbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYSBgdHJhY2tgXG4gICAqIGtleSBxdWV1ZSBsb2NhbCBjcmVhdGVzIGFuZCB1cGRhdGVzIGF1dG9tYXRpY2FsbHk7IGB0cmFjazogZmFsc2VgIG9wdHMgYVxuICAgKiBtb2RlbCBvdXQgKGZvciBtb2RlbHMgd3JpdHRlbiBieSBub24tdXNlciBmbG93cykuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUmVzb3VyY2UgY29uZmlnIGFuZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59IFRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICovXG4gIHRyYWNrZWRPcGVyYXRpb25zKHtyZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlfSkge1xuICAgIGNvbnN0IHRyYWNrID0gcmVzb3VyY2VDb25maWcudHJhY2tcblxuICAgIGlmICh0cmFjayA9PT0gZmFsc2UpIHJldHVybiBbXVxuICAgIGlmICh0cmFjayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlNcbiAgICBpZiAodHJhY2sgPT09IHRydWUpIHJldHVybiBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdXG5cbiAgICBpZiAoIXRyYWNrIHx8IHR5cGVvZiB0cmFjayAhPT0gXCJvYmplY3RcIiB8fCAhQXJyYXkuaXNBcnJheSh0cmFjay5vcGVyYXRpb25zKSB8fCB0cmFjay5vcGVyYXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHJlc291cmNlICR7cmVzb3VyY2VUeXBlfSB0cmFjayBtdXN0IGJlIHRydWUgb3Ige29wZXJhdGlvbnM6IFsuLi5dfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgdHJhY2sub3BlcmF0aW9ucykge1xuICAgICAgaWYgKCEob3BlcmF0aW9uIGluIFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCByZXNvdXJjZSAke3Jlc291cmNlVHlwZX0gdHJhY2sub3BlcmF0aW9ucyBtdXN0IGJlIGNyZWF0ZS91cGRhdGUvZGVzdHJveSwgZ290OiAke1N0cmluZyhvcGVyYXRpb24pfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYWNrLm9wZXJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxpZmVjeWNsZSBjYWxsYmFjayBxdWV1ZWluZyBvbmUgdHJhY2tlZCBtdXRhdGlvbi4gVGhlIHF1ZXVlZFxuICAgKiBwYXlsb2FkIGFuZCBzeW5jIHR5cGUgYXJlIHNuYXBzaG90dGVkIGF0IG11dGF0aW9uLWNhbGxiYWNrIHRpbWUsIHNvXG4gICAqIGFmdGVyU2F2ZSBob29rcyBhc3NpZ25pbmcgdW5zYXZlZCBhdHRyaWJ1dGVzIChvciBhbnkgbGF0ZXIgZHJpZnQgb24gdGhlXG4gICAqIHJlY29yZCkgY2Fubm90IGNoYW5nZSB3aGF0IGdldHMgcXVldWVkIHZzIHdoYXQgd2FzIGNvbW1pdHRlZC4gUXVldWVpbmcgaXNcbiAgICogZGVmZXJyZWQgdGhyb3VnaCB0aGUgbW9kZWwgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gaXQgb25seSBydW5zXG4gICAqIG9uY2UgdGhlIG11dGF0aW9uJ3MgdHJhbnNhY3Rpb24gaGFzIGNvbW1pdHRlZCAoaW1tZWRpYXRlbHkgd2hlbiBub1xuICAgKiB0cmFuc2FjdGlvbiBpcyBvcGVuKSAtIHF1ZXVlZCBzeW5jcyBuZXZlciByZWZlcmVuY2Ugcm9sbGVkLWJhY2sgcm93cy5cbiAgICogUG9zdC1jb21taXQgcXVldWUgZmFpbHVyZXMgYXJlIHJlcG9ydGVkIHdpdGhvdXQgcmV0aHJvd2luZyBpbnRvIHRoZVxuICAgKiBkcml2ZXIncyBhZnRlckNvbW1pdCBjaGFpbiAoc2VlIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IpLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBPcGVyYXRpb24gYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMgeyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+fSBMaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqL1xuICB0cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgY29uc3QgbGlmZWN5Y2xlR2VuZXJhdGlvbiA9IHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb25cbiAgICAgIGNvbnN0IGRhdGEgPSBTeW5jQXBpQ2xpZW50LnF1ZXVlZFN5bmNEYXRhKHtcbiAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICBkYXRhOiByZXNvdXJjZUNvbmZpZy50cmFja2VkRGF0YSA/IHJlc291cmNlQ29uZmlnLnRyYWNrZWREYXRhKHtvcGVyYXRpb24sIHJlY29yZH0pIDogdW5kZWZpbmVkLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICByZXNvdXJjZTogcmVjb3JkXG4gICAgICB9KVxuICAgICAgY29uc3Qgc3luY1R5cGUgPSB0aGlzLmRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgICAgIGNvbnN0IGJhc2VWZXJzaW9uID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZ1xuICAgICAgICA/IHRoaXMuY2FwdHVyZWRCYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgICAgICAgOiBudWxsXG4gICAgICBjb25zdCBkYXRhYmFzZU9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG4gICAgICBjb25zdCBvcGVyYXRpb25TY29wZSA9IGRhdGFiYXNlT3BlcmF0aW9uXG4gICAgICAgID8gZGF0YWJhc2VPcGVyYXRpb24uZm9yTW9kZWwodGhpcy5jb25maWcuc3luY01vZGVsKVxuICAgICAgICA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuXG4gICAgICBhd2FpdCByZWNvcmQuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5NdXRhdGlvbkxpZmVjeWNsZVdvcmsobGlmZWN5Y2xlR2VuZXJhdGlvbiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUNvbmZsaWN0VHJhY2tlZFN5bmMoe1xuICAgICAgICAgICAgICAgIGJhc2VWZXJzaW9uLFxuICAgICAgICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2U6IHJlY29yZCxcbiAgICAgICAgICAgICAgICByZXNvdXJjZVR5cGU6IHJlY29yZC5jb25zdHJ1Y3Rvci5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICAgICAgICBzeW5jVHlwZVxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUxvY2FsU3luYyh7ZGF0YSwgcmVzb3VyY2U6IHJlY29yZCwgc3luY01vZGVsOiBvcGVyYXRpb25TY29wZSwgc3luY1R5cGV9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgaWYgKHRoaXMuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikpIHJldHVyblxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5yZXBvcnRBZnRlckNvbW1pdEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIHBvc3QtY29tbWl0IHRyYWNrZWQtcXVldWVpbmcgZmFpbHVyZS4gVGhlIHRyYW5zYWN0aW9uIGhhcyBhbHJlYWR5XG4gICAqIGNvbW1pdHRlZCB3aGVuIGFmdGVyQ29tbWl0IGNhbGxiYWNrcyBydW4sIHNvIHJldGhyb3dpbmcgaGVyZSB3b3VsZCBwb2lzb25cbiAgICogdGhlIGRyaXZlcidzIGF3YWl0ZWQgYWZ0ZXJDb21taXQgY2hhaW4gKGJyZWFraW5nIHVucmVsYXRlZCBjYWxsYmFja3MpIC1cbiAgICogaW5zdGVhZCB0aGUgZmFpbHVyZSBnb2VzIHRvIHRoZSBjb25maWd1cmVkIHN5bmMuY2xpZW50Lm9uRXJyb3IgaG9vaywgb3IgaXNcbiAgICogbG9nZ2VkIGxvdWRseSB0aHJvdWdoIHRoZSBjbGllbnQncyBsb2dnZXIgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gUG9zdC1jb21taXQgcXVldWVpbmcgZmFpbHVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBvcnRBZnRlckNvbW1pdEVycm9yKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLm9uRXJyb3IpIHtcbiAgICAgIHRoaXMuY29uZmlnLm9uRXJyb3IoZXJyb3IpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyKCkuZXJyb3IoXCJTeW5jQ2xpZW50IGZhaWxlZCB0byBxdWV1ZSBhIHRyYWNrZWQgbXV0YXRpb24gYWZ0ZXIgY29tbWl0XCIsIGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxhemlseSBidWlsdCBjbGllbnQgbG9nZ2VyLlxuICAgKiBAcmV0dXJucyB7TG9nZ2VyIHwge2Vycm9yOiAoLi4ubWVzc2FnZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn19IENsaWVudCBsb2dnZXIuXG4gICAqL1xuICBsb2dnZXIoKSB7XG4gICAgdGhpcy5fbG9nZ2VyIHx8PSBuZXcgTG9nZ2VyKFwiU3luY0NsaWVudFwiLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gdGhpcy5fbG9nZ2VyXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIHJlY29yZCBpcyBjdXJyZW50bHkgYmVpbmcgd3JpdHRlbiBieSBwdWxsLWFwcGx5IChlY2hvIHN1cHByZXNzaW9uKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmVjb3JkIHdyaXRlIG9yaWdpbmF0ZXMgZnJvbSBhIHJlbW90ZSBjaGFuZ2UuXG4gICAqL1xuICBpc1JlbW90ZUFwcGx5KHJlY29yZCkge1xuICAgIHJldHVybiB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMuaGFzKHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRyYWNrZWQgbXV0YXRpb24gcXVldWVpbmcgaXMgY3VycmVudGx5IHN1cHByZXNzZWQgZm9yIGEgcmVjb3JkOlxuICAgKiBlaXRoZXIgdGhlIHJlY29yZCB3YXMgbWFya2VkIGFzIGEgcmVtb3RlIGFwcGx5IChgbWFya1JlbW90ZUFwcGx5YCwgdXNlZCBieVxuICAgKiBwdWxsIGFuZCByZWFsdGltZSBhcHBsaWVzKSBvciBhIGB3aXRob3V0VHJhY2tpbmdgIGNhbGxiYWNrIGlzIHJ1bm5pbmcgb25cbiAgICogdGhpcyBjbGllbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdHJhY2tlZCBxdWV1ZWluZyBpcyBzdXBwcmVzc2VkIGZvciB0aGUgcmVjb3JkLlxuICAgKi9cbiAgaXNUcmFja2luZ1N1cHByZXNzZWQocmVjb3JkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoID4gMCB8fCB0aGlzLmlzUmVtb3RlQXBwbHkocmVjb3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRoIHRyYWNrZWQgbXV0YXRpb24gcXVldWVpbmcgc3VwcHJlc3NlZCBvbiB0aGlzIGNsaWVudCAtXG4gICAqIGZvciBjb2RlIGFwcGx5aW5nIHNlcnZlci1vcmlnaW5hdGVkIGRhdGEgb3V0c2lkZSB0aGUgZGVyaXZlZCBwdWxsL3JlYWx0aW1lXG4gICAqIGFwcGxpZXJzIChsZWdhY3kgcHVsbCBwYXRocywgaW1wb3J0ZXJzLCBzaWduLWluIGJhY2tmaWxscyksIHNvIHRoZWlyIHdyaXRlc1xuICAgKiBhcmUgbm90IGVjaG9lZCBiYWNrIHRvIHRoZSBzZXJ2ZXIgYXMgZGV2aWNlIGNoYW5nZXMuIFN1cHByZXNzaW9uIGNvdmVycyB0aGVcbiAgICogd2hvbGUgYXN5bmMgZHVyYXRpb24gb2YgdGhlIGNhbGxiYWNrIChuZXN0ZWQgY2FsbHMgc3RhY2spIGFuZCBpc1xuICAgKiBjbGllbnQtd2lkZSB3aGlsZSBpdCBydW5zOiBtdXRhdGlvbnMgZnJvbSBjb25jdXJyZW50bHkgcnVubmluZyB0YXNrcyBhcmVcbiAgICogYWxzbyBzdXBwcmVzc2VkIGZvciB0aGF0IHdpbmRvdywgc28gcHJlZmVyIGBtYXJrUmVtb3RlQXBwbHkocmVjb3JkKWAgd2hlblxuICAgKiB3cml0ZXMgZnJvbSBvdGhlciBmbG93cyBjYW4gaW50ZXJsZWF2ZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+IHwgVH0gY2FsbGJhY2sgLSBXb3JrIHdob3NlIG1vZGVsIHdyaXRlcyBzaG91bGQgbm90IHF1ZXVlIHRyYWNrZWQgc3luY3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBUaGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aG91dFRyYWNraW5nKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGgrK1xuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoLS1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFya3Mgb25lIHJlY29yZCBhcyBiZWluZyB3cml0dGVuIGZyb20gc2VydmVyLW9yaWdpbmF0ZWQgZGF0YSBzbyB0cmFja2VkXG4gICAqIG11dGF0aW9uIHF1ZXVlaW5nIHNraXBzIGl0IChyZWNvcmQtcHJlY2lzZSBzdXBwcmVzc2lvbikuIFRoZSBkZXJpdmVkIHB1bGxcbiAgICogYW5kIHJlYWx0aW1lIGFwcGxpZXJzIHVzZSB0aGlzIGludGVybmFsbHkgYXJvdW5kIGV2ZXJ5IGFwcGxpZWQgd3JpdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZCBhYm91dCB0byBiZSB3cml0dGVuLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gUmVsZWFzZSBjYWxsYmFjayByZS1lbmFibGluZyB0cmFja2luZyBmb3IgdGhlIHJlY29yZC5cbiAgICovXG4gIG1hcmtSZW1vdGVBcHBseShyZWNvcmQpIHtcbiAgICB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMuYWRkKHJlY29yZClcblxuICAgIHJldHVybiAoKSA9PiB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMuZGVsZXRlKHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhpcyBjbGllbnQgYXMgdGhlIGFwcCdzIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0Q3VycmVudCgpIHtcbiAgICBzZXRDdXJyZW50U3luY0NsaWVudCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaGVzIHRoZSBvbmUgcmV1c2FibGUgY29vcmRpbmF0b3IgdGhhdCBvd25zIG11dGF0aW9uIGFuZCByZWNvbm5lY3RcbiAgICogY3ljbGVzIGZvciB0aGlzIGNsaWVudC4gVGhlIHJldHVybmVkIGRldGFjaCBvbmx5IHJlbW92ZXMgdGhlIHNhbWUgb3duZXIuXG4gICAqIEBwYXJhbSB7KHJlYXNvbjogXCJtdXRhdGlvblwiIHwgXCJyZWFsdGltZVwiKSA9PiBQcm9taXNlPHZvaWQ+fSB0cmlnZ2VyIC0gQ29vcmRpbmF0b3IgdHJpZ2dlci5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IElkZW1wb3RlbnQgZGV0YWNoIGNhbGxiYWNrLlxuICAgKi9cbiAgYXR0YWNoQ29vcmRpbmF0b3IodHJpZ2dlcikge1xuICAgIGlmICh0eXBlb2YgdHJpZ2dlciAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IGNvb3JkaW5hdG9yIHRyaWdnZXIgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgaWYgKHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlcikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBhbHJlYWR5IGhhcyBhbiBhdHRhY2hlZCBjb29yZGluYXRvclwiKVxuXG4gICAgdGhpcy5fY29vcmRpbmF0b3JUcmlnZ2VyID0gdHJpZ2dlclxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9jb29yZGluYXRvclRyaWdnZXIgPT09IHRyaWdnZXIpIHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlciA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGZyYW1ld29yay1vd25lZCB3b3JrIHRocm91Z2ggdGhlIGF0dGFjaGVkIGNvb3JkaW5hdG9yLCBvciByZXR1cm5zXG4gICAqIG51bGwgc28gdGhlIGxlZ2FjeSBkaXJlY3Qgc2NoZWR1bGluZyBvd25lciBtYXkgcnVuLlxuICAgKiBAcGFyYW0ge1wibXV0YXRpb25cIiB8IFwicmVhbHRpbWVcIn0gcmVhc29uIC0gVHJpZ2dlciByZWFzb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gQ29vcmRpbmF0b3IgZmxpZ2h0LCBvciBudWxsIHdpdGhvdXQgYW4gb3duZXIuXG4gICAqL1xuICByZXF1ZXN0Q29vcmRpbmF0b3JTeW5jKHJlYXNvbikge1xuICAgIHJldHVybiB0aGlzLl9jb29yZGluYXRvclRyaWdnZXIgPyB0aGlzLl9jb29yZGluYXRvclRyaWdnZXIocmVhc29uKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gQ3VycmVudCBzeW5jIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1N5bmNDbGllbnR9ICovIChjdXJyZW50U3luY0NsaWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbi4gQWxpYXMgZm9yXG4gICAqIGBuZXcgU3luY0NsaWVudCh7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYC5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMgYW5kIHRoZSBzeW5jLmNsaWVudCBibG9jay4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudE9wdGlvbnMsIFwiY29uZmlndXJhdGlvblwiPn0gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gU3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jQ2xpZW50KHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyAob3IgcmUtYWN0aXZhdGVzKSBhIHN5bmMgc2NvcGUgZnJvbSBhIG1vZGVsIHF1ZXJ5IGFuZCBwdWxscyBpdCB3aGVuIG9ubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBRdWVyeSBkZWNsYXJpbmcgdGhlIHN5bmMgc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBTeW5jIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KHByb2dyZXNzOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUHVsbFByb2dyZXNzKSA9PiB2b2lkfSBbb3B0aW9ucy5vblByb2dyZXNzXSAtIENhbGxlZCBwZXIgYXBwbGllZCBwYWdlIG9mIHRoZSBwdWxsIHRoaXMgZGVjbGFyYXRpb24gdHJpZ2dlcnMsIHNvIHRoZSBpbml0aWFsIGltcG9ydCBvZiBhIG5ld2x5IGRlY2xhcmVkIHNjb3BlIGNhbiBkcml2ZSBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIuIFNlZSBgcHVsbCgpYC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy51cHN0cmVhbVJlZnJlc2hdIC0gTWFya3MgdGhlIGNoYW5nZXMgcmVxdWVzdChzKSBhcyBhIHVzZXItaW5pdGlhdGVkIHJlZnJlc2gsIHNvIHRoZSBzZXJ2ZXIgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cy4gU2VlIGBwdWxsKClgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c2NvcGU6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZSwgcHVsbGVkOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9Pn0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0IChudWxsIHdoaWxlIG9mZmxpbmUpLlxuICAgKi9cbiAgYXN5bmMgc3luYyhxdWVyeSwge29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpXG4gICAgY29uc3Qgc2NvcGUgPSBzZXJpYWxpemVkU2NvcGVGcm9tUXVlcnkocXVlcnkpXG4gICAgY29uc3Qgc2NvcGVTdG9yZSA9IHRoaXMuc2NvcGVTdG9yZSgpXG4gICAgY29uc3Qgc2NvcGVSb3cgPSBhd2FpdCBzY29wZVN0b3JlLmZpbmRPckNyZWF0ZVNjb3BlKHNjb3BlKVxuXG4gICAgaWYgKCFzY29wZVJvdy5jdXJzb3JQYXlsb2FkICYmIHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcikge1xuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yUGF5bG9hZCA9IGF3YWl0IHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcih7c2NvcGV9KVxuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yID0gU3luY0FwaUNsaWVudC5zeW5jQ3Vyc29yRnJvbVBheWxvYWQobGVnYWN5Q3Vyc29yUGF5bG9hZClcblxuICAgICAgaWYgKGxlZ2FjeUN1cnNvcikgYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBsZWdhY3lDdXJzb3IpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwdWxsZWQ6IGF3YWl0IHRoaXMucHVsbCh7b25Qcm9ncmVzcywgdXBzdHJlYW1SZWZyZXNofSksIHNjb3BlfVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoZSBzeW5jIHNjb3BlIGRlY2xhcmVkIGJ5IGEgbW9kZWwgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgd2hvc2Ugc2NvcGUgc2hvdWxkIHN0b3Agc3luY2luZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN5bmMocXVlcnkpIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWxscyBjaGFuZ2VzIGZvciBldmVyeSBhY3RpdmUgc2NvcGUgd2l0aCBwZXItc2NvcGUgY3Vyc29ycyAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUHVsbCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSB3aXRoIGN1bXVsYXRpdmUgYHtwYWdlcywgc3luY2VkQ291bnQsIHRvdGFsfWAgYWNyb3NzIHRoZSBwdWxsZWQgc2NvcGVzLCBmb3IgcmVuZGVyaW5nIGEgXCJzeW5jZWRDb3VudCBvZiB0b3RhbFwiIHByb2dyZXNzIGJhciAoZS5nLiBhIGZ1bGwtaW1wb3J0IHNjcmVlbikuIE9wdGlvbmFsOyBvbWl0dGluZyBpdCBrZWVwcyB0aGUgZXhpc3RpbmcgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIFNlbmRzIGB1cHN0cmVhbVJlZnJlc2g6IHRydWVgIG9uIHRoZSBjaGFuZ2VzIHJlcXVlc3QocyksIHRlbGxpbmcgdGhlIHNlcnZlciB0aGlzIHB1bGwgaXMgdXNlci1pbml0aWF0ZWQgc28gaXQgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cyAoc2VlIGRvY3Mvc3luYy11cHN0cmVhbS1pbXBvcnRzLm1kKS4gQmFja2dyb3VuZCBwdWxscyBvbWl0IGl0IGFuZCBzdGF5IHRocm90dGxlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsPn0gQ29tYmluZWQgcHVsbCByZXN1bHQsIG9yIG51bGwgd2hpbGUgb2ZmbGluZS5cbiAgICovXG4gIGFzeW5jIHB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3B1bGwoe29uUHJvZ3Jlc3MsIHNpZ25hbCwgdXBzdHJlYW1SZWZyZXNofSkpXG4gIH1cblxuICAvKipcbiAgICogUHVsbCBpbXBsZW1lbnRhdGlvbiBib3VuZCB0byBvbmUgbGlmZWN5Y2xlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gYXJncy5zaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy51cHN0cmVhbVJlZnJlc2hdIC0gVXNlci1pbml0aWF0ZWQgdXBzdHJlYW0gcmVmcmVzaCBtYXJrZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbD59IENvbWJpbmVkIHB1bGwgcmVzdWx0LCBvciBudWxsIHdoaWxlIG9mZmxpbmUuXG4gICAqL1xuICBhc3luYyBfcHVsbCh7b25Qcm9ncmVzcywgc2lnbmFsLCB1cHN0cmVhbVJlZnJlc2h9KSB7XG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVybiBudWxsXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9ICovXG4gICAgbGV0IGNvbWJpbmVkUmVzdWx0ID0gbnVsbFxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1wdWxsLSR7dGhpcy5fY2xpZW50TnVtYmVyfWAsIGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IGF1dGhlbnRpY2F0aW9uVG9rZW4gPSBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKClcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgICAgY29uc3QgYXBwbHlTeW5jID0gdGhpcy5yZW1vdGVBcHBseVN5bmMoKVxuICAgICAgY29uc3QgcmVzdWx0ID0ge1xuICAgICAgICBjaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgcGFnZXM6IDAsXG4gICAgICAgIHJlc291cmNlQ2hhbmdlZDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKHt9KSxcbiAgICAgICAgcmVzb3VyY2VDb3VudHM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KSxcbiAgICAgICAgc3luY2VkQ291bnQ6IDAsXG4gICAgICAgIHRvdGFsOiAwXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgc2NvcGVSb3cgb2YgYXdhaXQgc2NvcGVTdG9yZS5hY3RpdmVTY29wZXMoKSkge1xuICAgICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICAgIC8vIEN1bXVsYXRlIHNjb3BlIHByb2dyZXNzIG9udG8gdGhlIGNvdW50cyBvZiB0aGUgc2NvcGVzIGFscmVhZHkgcHVsbGVkIHNvIGEgc2luZ2xlXG4gICAgICAgIC8vIHNjb3BlJ3MgcGVyLXBhZ2UgcHJvZ3Jlc3MgcmVhZHMgZXhhY3RseSBpdHMgb3duIGNvdW50cyAoYmFzZSAwKSwgYW5kIG11bHRpLXNjb3BlXG4gICAgICAgIC8vIHB1bGxzIHJlcG9ydCBhIHJ1bm5pbmcgY3VtdWxhdGl2ZSB0b3RhbCBhY3Jvc3MgZXZlcnkgc2NvcGUuXG4gICAgICAgIGNvbnN0IGJhc2VQYWdlcyA9IHJlc3VsdC5wYWdlc1xuICAgICAgICBjb25zdCBiYXNlU3luY2VkQ291bnQgPSByZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgY29uc3QgYmFzZVRvdGFsID0gcmVzdWx0LnRvdGFsXG4gICAgICAgIGNvbnN0IHNjb3BlUmVzdWx0ID0gYXdhaXQgU3luY0FwaUNsaWVudC5wdWxsQ2hhbmdlcyh7XG4gICAgICAgICAgYXBwbHlTeW5jLFxuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgICAgbG9hZEN1cnNvcjogYXN5bmMgKCkgPT4gYXdhaXQgc2NvcGVTdG9yZS5sb2FkQ3Vyc29yKHNjb3BlUm93KSxcbiAgICAgICAgICBvblByb2dyZXNzOiBvblByb2dyZXNzID8gKHByb2dyZXNzKSA9PiBvblByb2dyZXNzKHtcbiAgICAgICAgICAgIHBhZ2VzOiBiYXNlUGFnZXMgKyBwcm9ncmVzcy5wYWdlcyxcbiAgICAgICAgICAgIHN5bmNlZENvdW50OiBiYXNlU3luY2VkQ291bnQgKyBwcm9ncmVzcy5zeW5jZWRDb3VudCxcbiAgICAgICAgICAgIHRvdGFsOiBiYXNlVG90YWwgKyBwcm9ncmVzcy50b3RhbFxuICAgICAgICAgIH0pIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHBvc3RDaGFuZ2VzOiBhc3luYyAocGF5bG9hZCwgb3B0aW9ucykgPT4gYXdhaXQgdGhpcy5jb25maWcucG9zdENoYW5nZXMoe1xuICAgICAgICAgICAgLi4ucGF5bG9hZCxcbiAgICAgICAgICAgIC8vIE9ubHkgdGhlIGFsbC10eXBlcyBzY29wZSBjYXJyaWVzIHRoZSB0eXBlIGxpc3Q7IGEgdHlwZS1kZWNsYXJlZCBzY29wZSBuZWVkcyBub25lLlxuICAgICAgICAgICAgc2NvcGU6IHtcbiAgICAgICAgICAgICAgY29uZGl0aW9uczogc2NvcGVSb3cuY29uZGl0aW9ucyxcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBzY29wZVJvdy5yZXNvdXJjZVR5cGUsXG4gICAgICAgICAgICAgIC4uLihzY29wZVJvdy5yZXNvdXJjZVR5cGUgPT09IG51bGwgPyB7cmVzb3VyY2VUeXBlczogdGhpcy51c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCl9IDoge30pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLi4uKHVwc3RyZWFtUmVmcmVzaCA/IHt1cHN0cmVhbVJlZnJlc2g6IHRydWV9IDoge30pXG4gICAgICAgICAgfSwgb3B0aW9ucyksXG4gICAgICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBjdXJzb3IpLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuXG4gICAgICAgIHJlc3VsdC5jaGFuZ2VkIHx8PSBzY29wZVJlc3VsdC5jaGFuZ2VkXG4gICAgICAgIHJlc3VsdC5wYWdlcyArPSBzY29wZVJlc3VsdC5wYWdlc1xuICAgICAgICByZXN1bHQuc3luY2VkQ291bnQgKz0gc2NvcGVSZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgcmVzdWx0LnRvdGFsICs9IHNjb3BlUmVzdWx0LnRvdGFsXG5cbiAgICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCBjb3VudF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDb3VudHMpKSB7XG4gICAgICAgICAgcmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gPSAocmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyBjb3VudFxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgY2hhbmdlZF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDaGFuZ2VkKSkge1xuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gY2hhbmdlZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbWJpbmVkUmVzdWx0ID0gcmVzdWx0XG4gICAgfSlcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICByZXR1cm4gY29tYmluZWRSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGRlcml2ZWQgcmVtb3RlLWNoYW5nZSBhcHBsaWVyIHNoYXJlZCBieSBwdWxscyBhbmQgcmVhbHRpbWUgcHVzaGVzOlxuICAgKiBhcHBsaWVzIHRocm91Z2ggdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZ3MsIHJlZ2lzdGVycyBlYWNoIHdyaXR0ZW4gcmVjb3JkXG4gICAqIGZvciBlY2hvIHN1cHByZXNzaW9uICh0cmFja2VkIHJlc291cmNlcyBkbyBub3QgcmUtcXVldWUgYXBwbGllZCBjaGFuZ2VzKSwgYW5kXG4gICAqIGZhaWxzIGxvdWRseSBpbnN0ZWFkIG9mIHNpbGVudGx5IHNraXBwaW5nIHVuY29uZmlndXJlZCByZXNvdXJjZXMuXG4gICAqXG4gICAqIEFwcGxpZXMgYXJlIGlkZW1wb3RlbnQgcGVyIHJlY29yZDogdGhlIGZlZWQgaXMgYXQtbGVhc3Qtb25jZSAoYSByZWFsdGltZSBwdXNoXG4gICAqIGRvZXMgbm90IGFkdmFuY2UgdGhlIHB1bGwgY3Vyc29yLCBzbyB0aGUgc2FtZSBgc2VydmVyU2VxdWVuY2VgIGFycml2ZXMgYWdhaW5cbiAgICogb24gdGhlIG5leHQgcHVsbCkuIEEgY2hhbmdlIHdob3NlIHNlcXVlbmNlIGlzIG5vdCBncmVhdGVyIHRoYW4gdGhlIG5ld2VzdCBvbmVcbiAgICogYWxyZWFkeSBhcHBsaWVkIHRvIHRoYXQgcmVjb3JkIGlzIHNraXBwZWQsIHNvIGEgZHVwbGljYXRlIGNhbm5vdCBvdmVyd3JpdGVcbiAgICogbmV3ZXIgbG9jYWwgc3RhdGUuIFNvdXJjZXMgd2l0aG91dCBhIHNlcXVlbmNlIChlLmcuIGxlZ2FjeSBicm9hZGNhc3RzKSBrZWVwXG4gICAqIGFwcGx5aW5nIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHt7c291cmNlPzogc3RyaW5nfX0gW2FyZ3NdIC0gRXJyb3IgY29udGV4dCBkZXNjcmliaW5nIHdoZXJlIHRoZSBjaGFuZ2UgY2FtZSBmcm9tLlxuICAgKiBAcmV0dXJucyB7KHN5bmM6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VFbnZlbG9wZSkgPT4gUHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBMb3VkIHJlbW90ZS1jaGFuZ2UgYXBwbGllci5cbiAgICovXG4gIHJlbW90ZUFwcGx5U3luYyh7c291cmNlID0gXCJwdWxsZWQgY2hhbmdlXCJ9ID0ge30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHN5bmMpID0+IHtcbiAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IHN5bmMucmVzb3VyY2VUeXBlKClcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWRSZXNvdXJjZSA9IHJlc291cmNlVHlwZSA/IHRoaXMuY29uZmlnLnJlc291cmNlc1tyZXNvdXJjZVR5cGVdIDogdW5kZWZpbmVkXG5cbiAgICAgIGlmICghcmVzb3VyY2VUeXBlIHx8ICFjb25maWd1cmVkUmVzb3VyY2U/LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIHJlc291cmNlIHdpdGggcHVsbCBhdHRyaWJ1dGVzIGNvbmZpZ3VyZWQgZm9yICR7c291cmNlfTogJHtTdHJpbmcocmVzb3VyY2VUeXBlKX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHN5bmMuZGF0YSgpXG4gICAgICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKCkpXG4gICAgICAgIGNvbnN0IHNlcnZlclNlcXVlbmNlID0gc3luYy5zZXJ2ZXJTZXF1ZW5jZSgpXG4gICAgICAgIGNvbnN0IGFwcGxpZWRTZXF1ZW5jZXMgPSB0aGlzLmFwcGxpZWRTZXF1ZW5jZVN0b3JlKClcblxuICAgICAgICBpZiAoc2VydmVyU2VxdWVuY2UgIT09IG51bGwpIHtcbiAgICAgICAgICBjb25zdCBsYXN0QXBwbGllZFNlcXVlbmNlID0gYXdhaXQgYXBwbGllZFNlcXVlbmNlcy5sYXN0QXBwbGllZFNlcXVlbmNlKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgICAgICAgaWYgKGxhc3RBcHBsaWVkU2VxdWVuY2UgIT09IG51bGwgJiYgc2VydmVyU2VxdWVuY2UgPD0gbGFzdEFwcGxpZWRTZXF1ZW5jZSkge1xuICAgICAgICAgICAgcmV0dXJuIHtjaGFuZ2VkOiBmYWxzZSwgcmVzb3VyY2VUeXBlfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGUgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXS5jb25mbGljdFRyYWNraW5nPy52ZXJzaW9uQXR0cmlidXRlXG5cbiAgICAgICAgaWYgKHZlcnNpb25BdHRyaWJ1dGUpIHtcbiAgICAgICAgICBjb25zdCBkYXRhQXR0cmlidXRlcyA9IGRhdGEgJiYgdHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZGF0YSlcbiAgICAgICAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkYXRhKVxuICAgICAgICAgICAgOiB7fVxuXG4gICAgICAgICAgdGhpcy5ub3RlUmVtb3RlVmVyc2lvbih7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlLCB2ZXJzaW9uOiBkYXRhQXR0cmlidXRlc1t2ZXJzaW9uQXR0cmlidXRlXX0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwdWxsUmVzb3VyY2VDb25maWdzID0gdGhpcy5wdWxsUmVzb3VyY2VDb25maWdzKG9wZXJhdGlvbilcbiAgICAgICAgY29uc3QgYXBwbGllciA9IFN5bmNBcGlDbGllbnQucmVzb3VyY2VBcHBsaWVyKHB1bGxSZXNvdXJjZUNvbmZpZ3MsIChyZWNvcmQpID0+IHtcbiAgICAgICAgICBpZiAob3BlcmF0aW9uKSB0aGlzLmJpbmRSZW1vdGVSZWNvcmQoe29wZXJhdGlvbiwgcmVjb3JkfSlcblxuICAgICAgICAgIHJldHVybiB0aGlzLm1hcmtSZW1vdGVBcHBseShyZWNvcmQpXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgYXBwbGllcihzeW5jKVxuXG4gICAgICAgIGlmIChzZXJ2ZXJTZXF1ZW5jZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGF3YWl0IGFwcGxpZWRTZXF1ZW5jZXMucmVjb3JkQXBwbGllZFNlcXVlbmNlKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHNlcnZlclNlcXVlbmNlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzaGFyZWQgYXBwLWxpZmV0aW1lIHdlYnNvY2tldCBjb25uZWN0aW9uIGFsbCBzeW5jIHRyYWZmaWNcbiAgICogcmlkZXMsIG9yIG51bGwgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQuIEJ1aWx0IG9uY2UgYW5kIG1lbW9pemVkIChwZXJcbiAgICogY2xpZW50KTogYW4gYXBwLXByb3ZpZGVkIGBzeW5jLmNsaWVudC53ZWJzb2NrZXRDbGllbnRgIGluc3RhbmNlIHdpbnMgKHRoZVxuICAgKiBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgY2FuIHBhc3MgaXRzIG93biBjbGllbnQgc28gb25lIHNvY2tldCBjYXJyaWVzXG4gICAqIGV2ZXJ5dGhpbmcpLCBlbHNlIGEgZnJhbWV3b3JrLW93bmVkIHJlY29ubmVjdGluZyB7QGxpbmsgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fVxuICAgKiBidWlsdCBmcm9tIGBzeW5jLmNsaWVudC53ZWJzb2NrZXRVcmxgLiBUaGUgcmVhbHRpbWUgYnJpZGdlIHJpZGVzIHRoaXNcbiAgICogY29ubmVjdGlvbiB3aXRob3V0IG93bmluZyBpdHMgbGlmZWN5Y2xlOyB3aGVuIG5laXRoZXIgaXMgY29uZmlndXJlZCB0aGVcbiAgICogYnJpZGdlIGZhbGxzIGJhY2sgdG8gdGhlIGRlcHJlY2F0ZWQgcGVyLWN5Y2xlIGByZWFsdGltZS5jcmVhdGVDbGllbnRgLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U2hhcmVkQ29ubmVjdGlvbiB8IG51bGx9IFNoYXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiwgb3IgbnVsbC5cbiAgICovXG4gIHN5bmNDb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9zeW5jQ29ubmVjdGlvbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fc3luY0Nvbm5lY3Rpb25cblxuICAgIGlmICh0aGlzLmNvbmZpZy53ZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gdGhpcy5jb25maWcud2Vic29ja2V0Q2xpZW50XG4gICAgfSBlbHNlIGlmICh0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmwpIHtcbiAgICAgIGNvbnN0IHVybCA9IHR5cGVvZiB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmwgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuY29uZmlnLndlYnNvY2tldFVybCgpIDogdGhpcy5jb25maWcud2Vic29ja2V0VXJsXG5cbiAgICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gdXJsID8gbmV3IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCh7dXJsfSkgOiBudWxsXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX3N5bmNDb25uZWN0aW9uID0gbnVsbFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9zeW5jQ29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdGhlIGRlcml2ZWQgcmVhbHRpbWUgY2hhbm5lbHMgc28gcHVzaGVkIHdlYnNvY2tldCBjaGFuZ2VzIGFwcGx5XG4gICAqIHRocm91Z2ggdGhlIHNhbWUgZGVyaXZlZCBhcHBsaWVyIGFzIHB1bGxzIChpZGVtcG90ZW50LCBzaW5nbGUtZmxpZ2h0ZWQpLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbY29udGV4dF0gLSBBcHAgY29udGV4dCBwYXNzZWQgdG8gdGhlIGRlcHJlY2F0ZWQgYHN5bmMuY2xpZW50LnJlYWx0aW1lLmNoYW5uZWxzYCBjYWxsYmFjayAocnVudGltZSBzY29wZSB2YWx1ZXMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN1YnNjcmliZVJlYWx0aW1lKGNvbnRleHQpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgICAgYXdhaXQgdGhpcy5yZWFsdGltZUJyaWRnZSgpLnN1YnNjcmliZShjb250ZXh0LCB7c2lnbmFsfSlcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdGhlIHNlcnZlci1lbnVtZXJhdGVkIHVzZXIgc2NvcGU6IFwiZXZlcnl0aGluZyBteSBhYmlsaXR5IGNhblxuICAgKiBzZWVcIi4gRGVjbGFyZXMgYSB1c2VyIHNjb3BlIChlbXB0eSBjb25kaXRpb25zKSBmb3IgZXZlcnkgcHVsbGFibGUgc3luY2VkXG4gICAqIHJlc291cmNlIHR5cGUsIHN1YnNjcmliZXMgcmVhbHRpbWUgc28gdGhlaXIgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbFxuICAgKiBzdWJzY3JpcHRpb25zIGdvIGxpdmUsIGFuZCBwdWxscyBzbyB0aGUgZGV2aWNlIGNhdGNoZXMgdXAuIFRoZSBzZXJ2ZXJcbiAgICogYXV0aG9yaXplcyBlYWNoIGVtcHR5LWNvbmRpdGlvbnMgc2NvcGUgdGhyb3VnaCB0aGUgYXBwIHN5bmMgcmVzb3VyY2Unc1xuICAgKiBgYXV0aG9yaXplQ2hhbmdlc2AgYW5kIHJlLWNoZWNrcyByZWNvcmQgYWNjZXNzIHBlciBkZWxpdmVyeSwgc28gdGhlIGNsaWVudFxuICAgKiBzdWJzY3JpYmVzIHdpdGgganVzdCBpdHMgdG9rZW4gYW5kIHRoZSBzZXJ2ZXIgZGVjaWRlcyBtZW1iZXJzaGlwLlxuICAgKiBJZGVtcG90ZW50IGFuZCBzaW5nbGUtZmxpZ2h0ZWQgbGlrZSB7QGxpbmsgU3luY0NsaWVudCNzdWJzY3JpYmVSZWFsdGltZX0uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3Vic2NyaWJlVXNlclNjb3BlKCkge1xuICAgIGlmICh0aGlzLl91c2VyU2NvcGVTdGF0ZSA9PT0gXCJzdWJzY3JpYmVkXCIpIHJldHVyblxuXG4gICAgaWYgKCF0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlKSB7XG4gICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGUoc2lnbmFsKSkuZmluYWxseSgoKSA9PiB7XG4gICAgICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSBudWxsXG4gICAgICB9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbmQgYWN0aXZhdGVzIHRoZSBzZXJ2ZXItZW51bWVyYXRlZCB1c2VyIHNjb3BlIHdpdGhvdXQgc3RhcnRpbmdcbiAgICogcmVhbHRpbWUgb3IgcHVsbGluZy4gVXNlIHRoaXMgZnJvbSBTeW5jQ29vcmRpbmF0b3IucHJlcGFyZSgpIHNvIHRoZVxuICAgKiBjb29yZGluYXRvciByZW1haW5zIHRoZSBzb2xlIG5ldHdvcmsgb3JkZXJpbmcgb3duZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYWN0aXZhdGVVc2VyU2NvcGUoKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9hY3RpdmF0ZVVzZXJTY29wZShzaWduYWwpKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjdGl2YXRlcyB0aGUgdXNlciBzY29wZSB1bmRlciB0aGUgY3VycmVudCBsaWZlY3ljbGUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBzY29wZSBpcyBkdXJhYmxlLlxuICAgKi9cbiAgYXN5bmMgX2FjdGl2YXRlVXNlclNjb3BlKHNpZ25hbCkge1xuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmZpbmRPckNyZWF0ZVNjb3BlKGF3YWl0IHRoaXMudXNlclNjb3BlKCkpXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuZCBhY3RpdmF0ZXMgdGhlIHVzZXIgc2NvcGUgZm9yIGV2ZXJ5IHB1bGxhYmxlIHJlc291cmNlLCB0aGVuXG4gICAqIHN1YnNjcmliZXMgcmVhbHRpbWUgYW5kIHB1bGxzLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBzaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc3Vic2NyaWJlVXNlclNjb3BlKHNpZ25hbCkge1xuICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJzdWJzY3JpYmluZ1wiXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fYWN0aXZhdGVVc2VyU2NvcGUoc2lnbmFsKVxuXG4gICAgICBhd2FpdCB0aGlzLnN1YnNjcmliZVJlYWx0aW1lKClcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGF3YWl0IHRoaXMucHVsbCgpXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJzdWJzY3JpYmVkXCJcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVbnN1YnNjcmliZXMgdGhlIHVzZXIgc2NvcGU6IGRlYWN0aXZhdGVzIHRoZSBwZXItcmVzb3VyY2UgdXNlciBzY29wZXMgYW5kXG4gICAqIGNsb3NlcyB0aGUgcmVhbHRpbWUgY2hhbm5lbCBzdWJzY3JpcHRpb25zLiBUaGUgc2hhcmVkIHdlYnNvY2tldCBjb25uZWN0aW9uXG4gICAqIHN0YXlzIG9wZW4gd2hlbiBvbmUgaXMgY29uZmlndXJlZCAoc2lnbi1vdXQgZHJvcHMgc3Vic2NyaXB0aW9ucyB3aXRob3V0XG4gICAqIGRpc2Nvbm5lY3RpbmcpLCBzbyBhIHN1YnNlcXVlbnQgc2lnbi1pbiByZXN1YnNjcmliZXMgb3ZlciB0aGUgc2FtZSBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgdW5zdWJzY3JpYmVVc2VyU2NvcGUoKSB7XG4gICAgYXdhaXQgdGhpcy5zY29wZVN0b3JlKCkuZGVhY3RpdmF0ZShhd2FpdCB0aGlzLnVzZXJTY29wZSgpKVxuXG4gICAgYXdhaXQgdGhpcy51bnN1YnNjcmliZVJlYWx0aW1lKClcblxuICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogVGhlIHVzZXIgc2NvcGU6IGEgc2luZ2xlIGFsbC10eXBlcyBzY29wZSAobnVsbCByZXNvdXJjZVR5cGUpIHdpdGggZW1wdHlcbiAgICogY29uZGl0aW9ucywgcGFydGl0aW9uZWQgbG9jYWxseSBieSBvd25lci4gT25lIHNjb3BlIC0gbm90IG9uZSBwZXIgcmVzb3VyY2VcbiAgICogdHlwZSAtIHNvIHRoZSBzZXJ2ZXIgYXV0aG9yaXplcyB0aGUgY2FsbGVyIG9uY2UgcGVyIHN5bmMgYW5kIHBlciBzdWJzY3JpYmUsXG4gICAqIGhvd2V2ZXIgbWFueSByZXNvdXJjZSB0eXBlcyBpdCBzZXJ2ZXMuIFRoZSBzZXJ2ZXIgZGVjaWRlcyB3aGljaCB0eXBlcyB0aGVcbiAgICogY2FsbGVyIG1heSBzZWU7IHRoZSBjbGllbnQgYXBwbGllcyBlYWNoIHB1bGxlZCByb3cgYnkgdGhlIHJlc291cmNlIHR5cGUgb25cbiAgICogaXRzIG93biBlbnZlbG9wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlPn0gVGhlIHVzZXIgc2NvcGUuXG4gICAqL1xuICBhc3luYyB1c2VyU2NvcGUoKSB7XG4gICAgcmV0dXJuIHtjb25kaXRpb25zOiB7fSwgb3duZXI6IGF3YWl0IHRoaXMudXNlclNjb3BlT3duZXIoKSwgcmVzb3VyY2VUeXBlOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSByZXNvdXJjZSB0eXBlcyB0aGUgdXNlciBzY29wZSBjb3ZlcnM6IGV2ZXJ5IGRlY2xhcmVkIHJlc291cmNlIHRoYXRcbiAgICogcmVjZWl2ZXMgcHVsbGVkIGNoYW5nZXMgKGhhcyBwdWxsIGBhdHRyaWJ1dGVzYCksIHNvIHRoZSBjbGllbnQgY2FuIGFwcGx5XG4gICAqIHRoZW0uIFNlbnQgd2l0aCB0aGUgc2NvcGUgYXMgYSBkZWxpdmVyeS90eXBlIGZpbHRlciAtIGl0IG5hcnJvd3MsIG5ldmVyXG4gICAqIHdpZGVucywgd2hhdCB0aGUgc2VydmVyJ3MgYXV0aG9yaXphdGlvbiBhbHJlYWR5IGFsbG93cywgYW5kIGl0IGtlZXBzIGFcbiAgICogYnJvYWRjYXN0IG9mIGEgdHlwZSB0aGlzIGNsaWVudCBjYW5ub3QgYXBwbHkgZnJvbSByZWFjaGluZyB0aGUgc2VydmVyJ3NcbiAgICogcGVyLWRlbGl2ZXJ5IGFjY2VzcyByZS1jaGVjayAoYSBkYXRhYmFzZSBxdWVyeSBwZXIgbWF0Y2hlZCBicm9hZGNhc3QsIHBlclxuICAgKiBzdWJzY3JpYmVkIGRldmljZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gUHVsbGFibGUgcmVzb3VyY2UgdHlwZSBuYW1lcy5cbiAgICovXG4gIHVzZXJTY29wZVJlc291cmNlVHlwZXMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMucHVsbFJlc291cmNlQ29uZmlncygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBsb2NhbCBwYXJ0aXRpb24ga2V5IGZvciB0aGUgdXNlciBzY29wZTogdGhlIGN1cnJlbnRseVxuICAgKiBjb25maWd1cmVkIGF1dGhlbnRpY2F0ZWQgaWRlbnRpdHkgKHRoZSBzeW5jIGF1dGggdG9rZW4pLiBQYXJ0aXRpb25pbmcgdGhlXG4gICAqIHVzZXIgc2NvcGUncyBsb2NhbCBzY29wZS9jdXJzb3Igcm93cyBieSB0aGlzIG93bmVyIGtlZXBzIHRoZVxuICAgKiBlbXB0eS1jb25kaXRpb25zIGN1cnNvciBmcm9tIGxlYWtpbmcgYWNyb3NzIGFjY291bnRzIG9uIGEgc2hhcmVkIGRldmljZVxuICAgKiAoYWNjb3VudCBCIHNpZ25pbmcgaW4gYWZ0ZXIgYWNjb3VudCBBIGdldHMgYSBmcmVzaCBjdXJzb3IpIHdoaWxlIHRoZSBzYW1lXG4gICAqIGFjY291bnQgcmVjb25uZWN0aW5nIGtlZXBzIGl0cyBjdXJzb3IgY29udGludWl0eS4gVGhlIG93bmVyIGlzIGEgbG9jYWxcbiAgICogcGFydGl0aW9uIGtleSBvbmx5IOKAlCBwdWxscyBzdGlsbCBwb3N0IGVtcHR5IGNvbmRpdGlvbnMgdG8gdGhlIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gVXNlci1zY29wZSBvd25lciBwYXJ0aXRpb24ga2V5LlxuICAgKi9cbiAgYXN5bmMgdXNlclNjb3BlT3duZXIoKSB7XG4gICAgcmV0dXJuIFN0cmluZyhhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKCkpXG4gIH1cblxuICAvKipcbiAgICogVW5zdWJzY3JpYmVzIHRoZSByZWFsdGltZSBjaGFubmVscyBhbmQgZGlzY29ubmVjdHMgdGhlIHdlYnNvY2tldCBjbGllbnQgKGlkZW1wb3RlbnQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVuc3Vic2NyaWJlUmVhbHRpbWUoKSB7XG4gICAgYXdhaXQgdGhpcy5yZWFsdGltZUJyaWRnZSgpLnVuc3Vic2NyaWJlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIHRoZSByZWFsdGltZSBzdWJzY3JpcHRpb24gc3RhdGUgYW5kIHBlci1jaGFubmVsIHJlYWRpbmVzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8U3luY1JlYWx0aW1lQnJpZGdlW1wic3RhdHVzXCJdPn0gUmVhbHRpbWUgc3RhdHVzLlxuICAgKi9cbiAgcmVhbHRpbWVTdGF0dXMoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVhbHRpbWVCcmlkZ2UoKS5zdGF0dXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyBhbGwgcGVuZGluZyByZWFsdGltZSBtZXNzYWdlIGFwcGxpZXMgYW5kIGFueSBzY2hlZHVsZWRcbiAgICogcHVsbC1vbi1yZWNvbm5lY3QgKHVzZWZ1bCBpbiB0ZXN0cyBhbmQgc2h1dGRvd24gZmxvd3MpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JSZWFsdGltZUFwcGxpZWQoKSB7XG4gICAgYXdhaXQgdGhpcy5yZWFsdGltZUJyaWRnZSgpLndhaXRGb3JBcHBsaWVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsYXppbHkgYnVpbHQgcmVhbHRpbWUgYnJpZGdlLlxuICAgKiBAcmV0dXJucyB7U3luY1JlYWx0aW1lQnJpZGdlfSBSZWFsdGltZSBicmlkZ2UuXG4gICAqL1xuICByZWFsdGltZUJyaWRnZSgpIHtcbiAgICB0aGlzLl9yZWFsdGltZUJyaWRnZSB8fD0gbmV3IFN5bmNSZWFsdGltZUJyaWRnZSh7c3luY0NsaWVudDogdGhpc30pXG5cbiAgICByZXR1cm4gdGhpcy5fcmVhbHRpbWVCcmlkZ2VcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgYSBsb2NhbCBtb2RlbCBjaGFuZ2UgYXMgYSBwZW5kaW5nIHN5bmMgcm93IGFuZCBzY2hlZHVsZXMgYW4gaW1tZWRpYXRlXG4gICAqIHJlcGxheSBhdHRlbXB0IChrZXB0IHBlbmRpbmcgd2hpbGUgb2ZmbGluZSBvciB3aGVuIHRoZSBiYWNrZW5kIHJlamVjdHMgaXQpLlxuICAgKiBAcGFyYW0ge3tiYXNlVmVyc2lvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGwsIHJlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3BlcmF0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgc3luY1R5cGU/OiBzdHJpbmd9fSBhcmdzIC0gUXVldWUgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gUGVuZGluZyBsb2NhbCBzeW5jIHJvdyBvciBkdXJhYmxlIGNvbmZsaWN0LXRyYWNrZWQgaW50ZW50LlxuICAgKi9cbiAgYXN5bmMgcXVldWUoe2Jhc2VWZXJzaW9uLCBkYXRhLCBvcGVyYXRpb24gPSBcInVwZGF0ZVwiLCByZXNvdXJjZSwgc3luY1R5cGV9KSB7XG4gICAgY29uc3QgbGlmZWN5Y2xlR2VuZXJhdGlvbiA9IHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb25cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5NdXRhdGlvbkxpZmVjeWNsZVdvcmsobGlmZWN5Y2xlR2VuZXJhdGlvbiwgYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgICB0aGlzLmFzc2VydFJlY29yZE93bmVyc2hpcChyZXNvdXJjZSlcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZ0ZvcihyZXNvdXJjZSlcbiAgICAgIGNvbnN0IHJlc29sdmVkU3luY1R5cGUgPSBzeW5jVHlwZSA/PyB0aGlzLmRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQ6IHJlc291cmNlLCByZXNvdXJjZUNvbmZpZ30pXG5cbiAgICAgIGlmIChyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSB7XG4gICAgICAgIGNvbnN0IHF1ZXVlZERhdGEgPSBTeW5jQXBpQ2xpZW50LnF1ZXVlZFN5bmNEYXRhKHtcbiAgICAgICAgICBib29sZWFuQXR0cmlidXRlczogcmVzb3VyY2VDb25maWcuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgICAgZGF0YSxcbiAgICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICAgIHJlc291cmNlXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtcbiAgICAgICAgICBiYXNlVmVyc2lvbjogYmFzZVZlcnNpb24gPT09IHVuZGVmaW5lZCA/IHRoaXMuYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkOiByZXNvdXJjZSwgcmVzb3VyY2VDb25maWd9KSA6IGJhc2VWZXJzaW9uLFxuICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgZGF0YTogcXVldWVkRGF0YSxcbiAgICAgICAgICBvZmZsaW5lU2Vzc2lvbjogdGhpcy5jb25maWcub2ZmbGluZSA/IHRoaXMub2ZmbGluZVNlc3Npb24oKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgcmVzb3VyY2UsXG4gICAgICAgICAgcmVzb3VyY2VUeXBlOiByZXNvdXJjZS5jb25zdHJ1Y3Rvci5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICBzeW5jVHlwZTogcmVzb2x2ZWRTeW5jVHlwZVxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICAgIHJldHVybiByZWNvcmRcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3luY1JvdyA9IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAoZGF0YWJhc2VPcGVyYXRpb24pID0+IGF3YWl0IFN5bmNBcGlDbGllbnQucXVldWVMb2NhbFN5bmMoe1xuICAgICAgICBib29sZWFuQXR0cmlidXRlczogcmVzb3VyY2VDb25maWcuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIGRhdGEsXG4gICAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10sXG4gICAgICAgIHJlc291cmNlLFxuICAgICAgICBzeW5jTW9kZWw6IGRhdGFiYXNlT3BlcmF0aW9uID8gZGF0YWJhc2VPcGVyYXRpb24ubW9kZWxDbGFzcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpIDogdGhpcy5jb25maWcuc3luY01vZGVsLFxuICAgICAgICBzeW5jVHlwZTogcmVzb2x2ZWRTeW5jVHlwZVxuICAgICAgfSkpXG5cbiAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICByZXR1cm4gc3luY1Jvd1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIHRvIHRoZSBiYWNrZW5kIChzaW5nbGUtZmxpZ2h0ZWQsIG9ubGluZS1nYXRlZCkuXG4gICAqIFJvd3MgYXJlIG9ubHkgbWFya2VkIHN1Y2Nlc3NmdWwgYWZ0ZXIgdGhlIGJhY2tlbmQgYWNrbm93bGVkZ2VzIHRoZW0uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVwbGF5UGVuZGluZygpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3JlcGxheVBlbmRpbmcoc2lnbmFsKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXkgaW1wbGVtZW50YXRpb24gYm91bmQgdG8gb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBzaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcmVwbGF5UGVuZGluZyhzaWduYWwpIHtcbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5pc09ubGluZSgpKSkgcmV0dXJuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1yZXBsYXktJHt0aGlzLl9jbGllbnROdW1iZXJ9YCwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy53aXRoVGVuYW50T3BlcmF0aW9uKGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgaWYgKHRoaXMuY29uZmlnLm9mZmxpbmUpIHtcbiAgICAgICAgLy8gTG9uZy1vZmZsaW5lIHNlc3Npb24gY29uZmlndXJlZDogdGhlIHNpZ25lZCBvZmZsaW5lIHNlc3Npb24gb3ducyB0aGVcbiAgICAgICAgLy8gY29uZmxpY3QtdHJhY2tlZCBtdXRhdGlvbiBsb2dzLCBzbyB0aGUgYmFja2dyb3VuZCBkcmFpbiByZXBsYXlzIHRoZW1cbiAgICAgICAgLy8gdGhyb3VnaCB0aGUgc2lnbmVkIHJlcGxheSBlbmRwb2ludCBpbnN0ZWFkIG9mIHRoZSBsZWdhY3kgdW5zaWduZWRcbiAgICAgICAgLy8gb25lLiBPbmUgb3duZXIgcGVyIGxvZyDigJQgbmV2ZXIgYm90aC5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVwbGF5T2ZmbGluZVBlbmRpbmcoe3NpZ25hbH0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nKSBjb250aW51ZVxuXG4gICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5yZXBsYXlDb25mbGljdFRyYWNrZWRTeW5jcyh7XG4gICAgICAgICAgICBhcHBseUNvbmZsaWN0OiBhc3luYyAoe3JlY29yZCwgcmVzdWx0fSkgPT4gYXdhaXQgdGhpcy5hcHBseUNvbmZsaWN0UmVwbGF5UmVzdWx0KHtyZWNvcmQsIHJlc3VsdCwgcmVzb3VyY2VUeXBlfSksXG4gICAgICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKCksXG4gICAgICAgICAgICBiYXRjaFNpemU6IHRoaXMuY29uZmlnLmJhdGNoU2l6ZSxcbiAgICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgICBwb3N0UmVwbGF5OiB0aGlzLmNvbmZpZy5wb3N0UmVwbGF5LFxuICAgICAgICAgICAgcmVtb3RlR2VuZXJhdGlvbjogKGlkZW50aXR5KSA9PiB0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5nZXQoaWRlbnRpdHkpIHx8IDAsXG4gICAgICAgICAgICByZXNvdXJjZVR5cGUsXG4gICAgICAgICAgICBzaWduYWxcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucmVwbGF5TG9jYWxTeW5jcyh7XG4gICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSxcbiAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgIHBvc3RSZXBsYXk6IHRoaXMuY29uZmlnLnBvc3RSZXBsYXksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgc3luY01vZGVsOiBvcGVyYXRpb24gPyBvcGVyYXRpb24ubW9kZWxDbGFzcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpIDogdGhpcy5jb25maWcuc3luY01vZGVsXG4gICAgICB9KVxuICAgIH0pKVxuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYW4gYXV0aG9yaXRhdGl2ZSBzZXJ2ZXJNb2RlbCByZXR1cm5lZCBieSBhIGNvbmZsaWN0IHRocm91Z2ggdGhlXG4gICAqIHNhbWUgdGVuYW50LWJvdW5kLCB0cmFja2luZy1zdXBwcmVzc2VkIGFwcGxpZXIgdXNlZCBieSBwdWxsL3JlYWx0aW1lLlxuICAgKiBBIGNvbmZsaWN0IHJlc3VsdCB3aXRob3V0IHNlcnZlck1vZGVsIGhhcyBubyBhdXRob3JpdGF0aXZlIHN0YXRlIHRvIGFwcGx5XG4gICAqIGFuZCByZW1haW5zIGRpYWdub3N0aWMtb25seS5cbiAgICogQHBhcmFtIHt7cmVjb3JkOiBpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkLCByZXNvdXJjZVR5cGU6IHN0cmluZywgcmVzdWx0OiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVwbGF5SXRlbX19IGFyZ3MgLSBDb25mbGljdCByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXBwbHlDb25mbGljdFJlcGxheVJlc3VsdCh7cmVjb3JkLCByZXNvdXJjZVR5cGUsIHJlc3VsdH0pIHtcbiAgICBjb25zdCBjb25mbGljdCA9IHJlc3VsdC5jb25mbGljdFxuXG4gICAgaWYgKCFjb25mbGljdCB8fCAhT2JqZWN0Lmhhc093bihjb25mbGljdCwgXCJzZXJ2ZXJNb2RlbFwiKSkgcmV0dXJuXG5cbiAgICBjb25zdCBzZXJ2ZXJNb2RlbCA9IGNvbmZsaWN0LnNlcnZlck1vZGVsXG5cbiAgICBpZiAoc2VydmVyTW9kZWwgIT09IG51bGwgJiYgKHR5cGVvZiBzZXJ2ZXJNb2RlbCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcnZlck1vZGVsKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCBzZXJ2ZXJNb2RlbCBmb3IgJHtyZXNvdXJjZVR5cGV9IG11c3QgYmUgYW4gb2JqZWN0IG9yIG51bGxgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlSWQgPSByZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZFxuXG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZUlkICE9PSBcInN0cmluZ1wiIHx8IHJlc291cmNlSWQubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY29uZmxpY3QgZm9yICR7cmVzb3VyY2VUeXBlfSBpcyBtaXNzaW5nIHJlc291cmNlSWRgKVxuXG4gICAgY29uc3Qgc3luYyA9IFN5bmNBcGlDbGllbnQuc3luY0VudmVsb3BlRnJvbVBheWxvYWQoe1xuICAgICAgZGF0YTogc2VydmVyTW9kZWwsXG4gICAgICByZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgc3luY1R5cGU6IHNlcnZlck1vZGVsID09PSBudWxsID8gXCJkZWxldGVcIiA6IFwidXBkYXRlXCJcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5yZW1vdGVBcHBseVN5bmMoe3NvdXJjZTogXCJjb25mbGljdCBzZXJ2ZXIgdmVyc2lvblwifSkoc3luYylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHF1ZXVlIGNvdW50cyBhbmQgcHJpdmFjeS1zYWZlIGNvbmZsaWN0cyBmb3IgY29vcmRpbmF0b3IvVUkgc3RhdHVzLlxuICAgKiBGdWxsIGxvY2FsL3NlcnZlciBwYXlsb2FkcyByZW1haW4gb25seSBpbiB0aGUgZHVyYWJsZSBtdXRhdGlvbiBsb2cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ2xpZW50SW5zcGVjdGlvbj59IER1cmFibGUgc3luYyBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGluc3BlY3RTeW5jU3RhdGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgbGV0IHBlbmRpbmdDb3VudCA9IDBcbiAgICAgIGxldCByZWplY3RlZENvdW50ID0gMFxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0NvbmZsaWN0RGlhZ25vc3RpY1tdfSAqL1xuICAgICAgY29uc3QgY29uZmxpY3RzID0gW11cblxuICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIGNvbnRpbnVlXG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYXdhaXQgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5yZWNvcmRzKCkpIHtcbiAgICAgICAgICBpZiAocmVjb3JkLm11dGF0aW9uLm1vZGVsICE9PSByZXNvdXJjZVR5cGUpIGNvbnRpbnVlXG4gICAgICAgICAgaWYgKFtcInBlbmRpbmdcIiwgXCJhcHBsaWVkLWxvY2FsbHlcIiwgXCJwZWVyLWFwcGxpZWRcIl0uaW5jbHVkZXMocmVjb3JkLnN0YXR1cykpIHBlbmRpbmdDb3VudCArPSAxXG4gICAgICAgICAgaWYgKHJlY29yZC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikgcmVqZWN0ZWRDb3VudCArPSAxXG4gICAgICAgICAgaWYgKHJlY29yZC5zdGF0dXMgPT09IFwiY29uZmxpY3RcIikgY29uZmxpY3RzLnB1c2goc3luY0NvbmZsaWN0RGlhZ25vc3RpYyhyZWNvcmQpKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIH1cblxuICAgICAgcGVuZGluZ0NvdW50ICs9IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IHN5bmNNb2RlbCA9IG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcbiAgICAgICAgY29uc3QgcGVuZGluZ1Jvd3MgPSBhd2FpdCBzeW5jTW9kZWwucHJlbG9hZCh7cmVzb3VyY2U6IHRydWV9KS53aGVyZSh7c3RhdGU6IFwicGVuZGluZ1wifSkub3JkZXIoXCJjcmVhdGVkX2F0XCIpLnRvQXJyYXkoKVxuXG4gICAgICAgIHJldHVybiBwZW5kaW5nUm93cy5sZW5ndGhcbiAgICAgIH0pXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHJldHVybiB7Y29uZmxpY3RzLCBwZW5kaW5nQ291bnQsIHJlamVjdGVkQ291bnR9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGR1cmFibGUgY29uZmxpY3Qgb24gaXRzIGRlY2xhcmVkIHJlc291cmNlIGxvZy4gUmV0cnktbG9jYWwgaXNcbiAgICogc2NoZWR1bGVkIHRocm91Z2ggdGhlIGN1cnJlbnQgY29vcmRpbmF0b3Igd2hlbiBhdHRhY2hlZC5cbiAgICogQHBhcmFtIHt7cmVjb3JkSWQ6IHN0cmluZywgcmVzb2x1dGlvbjogXCJrZWVwLXNlcnZlclwiIHwgXCJyZXRyeS1sb2NhbFwiLCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBSZXNvbHV0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gLSBSZXNvbHZlZCBkdXJhYmxlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVDb25mbGljdCh7cmVjb3JkSWQsIHJlc29sdXRpb24sIHJlc291cmNlVHlwZX0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBjb25zdCBjb25mbGljdFRyYWNraW5nID0gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0/LmNvbmZsaWN0VHJhY2tpbmdcblxuICAgICAgaWYgKCFjb25mbGljdFRyYWNraW5nKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZsaWN0LXRyYWNrZWQgc3luYyByZXNvdXJjZSBjb25maWd1cmVkIGZvcjogJHtyZXNvdXJjZVR5cGV9YClcblxuICAgICAgY29uc3QgcmVjb3JkID0gYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5yZXNvbHZlQ29uZmxpY3Qoe2lkOiByZWNvcmRJZCwgcmVzb2x1dGlvbn0pXG5cbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGlmIChyZXNvbHV0aW9uID09PSBcInJldHJ5LWxvY2FsXCIpIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICByZXR1cm4gcmVjb3JkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmcmFtZXdvcmstb3duZWQgbG9uZy1vZmZsaW5lIHNlc3Npb24gYnVpbHQgZnJvbVxuICAgKiBgc3luYy5jbGllbnQub2ZmbGluZWAsIGNyZWF0aW5nIGl0IG9uIGZpcnN0IHVzZS4gRmFpbHMgd2hlbiB0aGUgb2ZmbGluZVxuICAgKiBjb25maWd1cmF0aW9uIGJsb2NrIGlzIG1pc3NpbmcuXG4gICAqIEByZXR1cm5zIHtTeW5jT2ZmbGluZVNlc3Npb259IC0gVGhlIGNsaWVudCdzIG9mZmxpbmUgc2Vzc2lvbi5cbiAgICovXG4gIG9mZmxpbmVTZXNzaW9uKCkge1xuICAgIGlmICghdGhpcy5jb25maWcub2ZmbGluZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBoYXMgbm8gc3luYy5jbGllbnQub2ZmbGluZSBjb25maWd1cmF0aW9uIC0gY29uZmlndXJlIGRldmljZUlkZW50aXR5U3RvcmFnZSwgZW5yb2xsRGV2aWNlLCBhbmQgZ3JhbnRTY29wZXMgdG8gdXNlIHRoZSBsb25nLW9mZmxpbmUgc2Vzc2lvblwiKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5fb2ZmbGluZVNlc3Npb24pIHtcbiAgICAgIHRoaXMuX29mZmxpbmVTZXNzaW9uID0gbmV3IFN5bmNPZmZsaW5lU2Vzc2lvbih7XG4gICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgIGNvbmZpZzogdGhpcy5jb25maWcub2ZmbGluZSxcbiAgICAgICAgbXV0YXRpb25Mb2dzOiB0aGlzLm9mZmxpbmVNdXRhdGlvbkxvZ3MoKSxcbiAgICAgICAgcG9zdDogdGhpcy5jb25maWcub2ZmbGluZVBvc3RcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX29mZmxpbmVTZXNzaW9uXG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdHMgdGhlIGR1cmFibGUgbXV0YXRpb24gbG9ncyB0aGUgb2ZmbGluZSBzZXNzaW9uIHNpZ25zLCByZXBsYXlzLFxuICAgKiByZS1zaWducywgYW5kIGV4cG9ydHM6IHRoZSBjb25maWd1cmVkIGBzeW5jLmNsaWVudC5vZmZsaW5lLm11dGF0aW9uTG9nYFxuICAgKiB3aGVuIGdpdmVuLCBwbHVzIGV2ZXJ5IGNvbmZsaWN0LXRyYWNraW5nIGxvZyBkZWNsYXJlZCBieSB0aGUgc3luY2VkIG1vZGVscy5cbiAgICogQHJldHVybnMge0FycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQ+fSAtIFNlc3Npb24gbXV0YXRpb24gbG9ncy5cbiAgICovXG4gIG9mZmxpbmVNdXRhdGlvbkxvZ3MoKSB7XG4gICAgLyoqIEB0eXBlIHtBcnJheTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBsb2dzID0gW11cblxuICAgIGlmICh0aGlzLmNvbmZpZy5vZmZsaW5lPy5tdXRhdGlvbkxvZykgbG9ncy5wdXNoKHRoaXMuY29uZmlnLm9mZmxpbmUubXV0YXRpb25Mb2cpXG5cbiAgICBmb3IgKGNvbnN0IHJlc291cmNlQ29uZmlnIG9mIE9iamVjdC52YWx1ZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgY29uc3QgbXV0YXRpb25Mb2cgPSByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nPy5tdXRhdGlvbkxvZ1xuXG4gICAgICBpZiAoIW11dGF0aW9uTG9nKSBjb250aW51ZVxuICAgICAgaWYgKGxvZ3Muc29tZSgobG9nKSA9PiBsb2cgPT09IG11dGF0aW9uTG9nIHx8IGxvZy5zdG9yYWdlS2V5ID09PSBtdXRhdGlvbkxvZy5zdG9yYWdlS2V5KSkgY29udGludWVcblxuICAgICAgbG9ncy5wdXNoKG11dGF0aW9uTG9nKVxuICAgIH1cblxuICAgIGlmIChsb2dzLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBvZmZsaW5lIHNlc3Npb24gZm91bmQgbm8gZHVyYWJsZSBtdXRhdGlvbiBsb2cgLSBkZWNsYXJlIGNvbmZsaWN0VHJhY2tpbmcgb24gYSBzeW5jZWQgbW9kZWwgb3IgY29uZmlndXJlIHN5bmMuY2xpZW50Lm9mZmxpbmUubXV0YXRpb25Mb2dcIilcblxuICAgIHJldHVybiBsb2dzXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHRoZSBsb25nLW9mZmxpbmUgc2Vzc2lvbjogcmVzb2x2ZXMgdGhlIGRldmljZSBzaWduaW5nIGlkZW50aXR5XG4gICAqIChnZW5lcmF0aW5nIGFuZCBlbnJvbGxpbmcgYSBrZXkgcGFpciB3aGVuIHRoZSBhcHAtb3duZWQgc3RvcmFnZSBoYXMgbm9uZSlcbiAgICogYW5kIGJvb3RzdHJhcHMgYSBsaXZlIG9mZmxpbmUgZ3JhbnQgdGhyb3VnaCB0aGUgYnVpbHQtaW5cbiAgICogYC9mcm9udGVuZC1tb2RlbHMvc3luYy9ib290c3RyYXBgIGVuZHBvaW50LiBJZGVtcG90ZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtb2ZmbGluZS1zZXNzaW9uLmpzXCIpLlN5bmNPZmZsaW5lU2Vzc2lvblN1bW1hcnk+fSAtIFNlc3Npb24gc3VtbWFyeSAoYWN0b3IgaWRzLCBsaXZlIGdyYW50IGlkLCBleHBpcnkpLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRPZmZsaW5lU2Vzc2lvbigpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIGNvbnN0IHN1bW1hcnkgPSBhd2FpdCB0aGlzLm9mZmxpbmVTZXNzaW9uKCkuc3RhcnQoKVxuXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHJldHVybiBzdW1tYXJ5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyB0aGUgbG9uZy1vZmZsaW5lIHNlc3Npb24uIFRoZSBkZXZpY2UgaWRlbnRpdHkgYW5kIHJldGFpbmVkIGdyYW50c1xuICAgKiBzdGF5IGluIHRoZSBhcHAtb3duZWQgZHVyYWJsZSBzdG9yYWdlOyBwZW5kaW5nIG11dGF0aW9ucyBzdGF5IGluIHRoZVxuICAgKiBkdXJhYmxlIG11dGF0aW9uIGxvZ3MgYW5kIHJlcGxheSB3aXRoIHRoZSBncmFudCB0aGV5IHdlcmUgc2lnbmVkIHVuZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgc2Vzc2lvbiBpcyBzdG9wcGVkLlxuICAgKi9cbiAgYXN5bmMgc3RvcE9mZmxpbmVTZXNzaW9uKCkge1xuICAgIGlmICghdGhpcy5fb2ZmbGluZVNlc3Npb24pIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fb2ZmbGluZVNlc3Npb24uc3RvcCgpXG4gIH1cblxuICAvKipcbiAgICogQm9vdHN0cmFwcyBhIGZyZXNoIG9mZmxpbmUgZ3JhbnQgYW5kIHJlLXNpZ25zIHRoaXMgZGV2aWNlJ3MgcGVuZGluZ1xuICAgKiBtdXRhdGlvbnMgdW5kZXIgaXQgKHRoZSByZXBsYXkgaWRlbXBvdGVuY3kga2V5IGlzIGdyYW50LWlkLWZyZWUsIHNvXG4gICAqIHJlLXNpZ25pbmcgbmV2ZXIgZHVwbGljYXRlcyBhbiBpbnRlbnQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMtb2ZmbGluZS1zZXNzaW9uLmpzXCIpLlN5bmNPZmZsaW5lU2Vzc2lvblN1bW1hcnk+fSAtIFJlZnJlc2hlZCBzZXNzaW9uIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWZyZXNoT2ZmbGluZUdyYW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgY29uc3Qgc3VtbWFyeSA9IGF3YWl0IHRoaXMub2ZmbGluZVNlc3Npb24oKS5yZWZyZXNoR3JhbnQoKVxuXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHJldHVybiBzdW1tYXJ5XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgdGhlIGR1cmFibGUgbXV0YXRpb24gbG9ncyB0aHJvdWdoIHRoZSBidWlsdC1pbiBzaWduZWQgcmVwbGF5XG4gICAqIGVuZHBvaW50IChgL2Zyb250ZW5kLW1vZGVscy9zeW5jL3JlcGxheWApOiBlbnN1cmVzIGEgbGl2ZSBncmFudCAocmVmcmVzaGluZ1xuICAgKiBhbiBleHBpcmVkIG9uZSksIGJhdGNoZXMgcGVuZGluZyBzaWduZWQgbXV0YXRpb25zIHdpdGggdGhlIHNpZ25lZCBncmFudFxuICAgKiBlYWNoIHdhcyBzaWduZWQgdW5kZXIsIGFuZCBtYXBzIHBlci1tdXRhdGlvbiByZXN1bHRzIGJhY2sgb250byB0aGUgbG9nXG4gICAqIHJlY29yZHMgYXMgc3luY2VkL2NvbmZsaWN0L3JlamVjdGVkLiBTdHJ1Y3R1cmVkIGNvbmZsaWN0cyBzdGF5IHJlYWNoYWJsZVxuICAgKiB0aHJvdWdoIHRoZSBleGlzdGluZyBjb25mbGljdCBjb250cmFjdCAoYHN5bmNSZXN1bHQuY29uZmxpY3RgIG9uIHRoZSByZWNvcmRcbiAgICogYW5kIGByZXNvbHZlQ29uZmxpY3QoLi4uKWApLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUmVwbGF5IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0aW9ucy5iYXRjaFNpemVdIC0gTWF4IHNpZ25lZCBtdXRhdGlvbnMgcGVyIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1vZmZsaW5lLXNlc3Npb24uanNcIikuU3luY09mZmxpbmVSZXBsYXlSZXN1bHQ+fSAtIE1hcHBlZCByZXBsYXkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5T2ZmbGluZVBlbmRpbmcob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4gYXdhaXQgdGhpcy5fcmVwbGF5T2ZmbGluZVBlbmRpbmcoey4uLm9wdGlvbnMsIHNpZ25hbH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFNpZ25lZCByZXBsYXkgaW1wbGVtZW50YXRpb24gYm91bmQgdG8gb25lIGxpZmVjeWNsZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUmVwbGF5IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0aW9ucy5iYXRjaFNpemVdIC0gTWF4IHNpZ25lZCBtdXRhdGlvbnMgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFtvcHRpb25zLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLW9mZmxpbmUtc2Vzc2lvbi5qc1wiKS5TeW5jT2ZmbGluZVJlcGxheVJlc3VsdD59IC0gTWFwcGVkIHJlcGxheSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcmVwbGF5T2ZmbGluZVBlbmRpbmcob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3NpZ25hbCwgLi4ucmVwbGF5T3B0aW9uc30gPSBvcHRpb25zXG4gICAgY29uc3QgbGlmZWN5Y2xlU2lnbmFsID0gc2lnbmFsID8/IHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlci5zaWduYWxcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKGxpZmVjeWNsZVNpZ25hbClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMub2ZmbGluZVNlc3Npb24oKS5yZXBsYXlQZW5kaW5nKHsuLi5yZXBsYXlPcHRpb25zLCBzaWduYWw6IGxpZmVjeWNsZVNpZ25hbH0pXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChsaWZlY3ljbGVTaWduYWwpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlc3VsdC5yZXN1bHRzKSB7XG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImNvbmZsaWN0XCIgfHwgIWVudHJ5LnNlcnZlclJlc3VsdCkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5hcHBseU9mZmxpbmVDb25mbGljdFJlcGxheVJlc3VsdChlbnRyeSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgYXV0aG9yaXRhdGl2ZSBzZXJ2ZXIgdmVyc2lvbiBjYXJyaWVkIGJ5IGEgc2lnbmVkIHJlcGxheVxuICAgKiBjb25mbGljdCByZXN1bHQgdGhyb3VnaCB0aGUgc2FtZSBjb25mbGljdCBjb250cmFjdCB0aGUgb25saW5lIHJlcGxheSB1c2VzLlxuICAgKiBAcGFyYW0ge3ttdXRhdGlvbjogaW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9uLCBzZXJ2ZXJSZXN1bHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGwsIHN0YXR1czogc3RyaW5nfX0gZW50cnkgLSBNYXBwZWQgcmVwbGF5IHJlc3VsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGNvbmZsaWN0IHNlcnZlciB2ZXJzaW9uIGlzIGFwcGxpZWQuXG4gICAqL1xuICBhc3luYyBhcHBseU9mZmxpbmVDb25mbGljdFJlcGxheVJlc3VsdChlbnRyeSkge1xuICAgIGlmICghZW50cnkuc2VydmVyUmVzdWx0KSByZXR1cm5cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gZW50cnkuc2VydmVyUmVzdWx0LnJlc3BvbnNlXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJlc3BvbnNlKSkgcmV0dXJuXG5cbiAgICBjb25zdCBjb25mbGljdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzcG9uc2UpLmNvbmZsaWN0XG5cbiAgICBpZiAoIWNvbmZsaWN0IHx8ICFPYmplY3QuaGFzT3duKGNvbmZsaWN0LCBcInNlcnZlck1vZGVsXCIpKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuYXBwbHlDb25mbGljdFJlcGxheVJlc3VsdCh7XG4gICAgICByZWNvcmQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gKi8gKHttdXRhdGlvbjoge3BheWxvYWQ6IGVudHJ5Lm11dGF0aW9uLnBheWxvYWR9fSksXG4gICAgICByZXNvdXJjZVR5cGU6IGVudHJ5Lm11dGF0aW9uLm1vZGVsLFxuICAgICAgcmVzdWx0OiAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXBsYXlJdGVtfSAqLyAoe2NvbmZsaWN0fSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4cG9ydHMgdGhlIGR1cmFibGUgbm9uLXRlcm1pbmFsIG11dGF0aW9ucyBvZiB0aGUgb2ZmbGluZSBzZXNzaW9uJ3MgbG9nc1xuICAgKiBhcyBvbmUgc2lnbmVkIHBlZXIgYnVuZGxlIGZvciBkZXZpY2UtdG8tZGV2aWNlIHRyYW5zZmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gRXhwb3J0IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvblN0YXR1c1tdfSBbb3B0aW9ucy5zdGF0dXNlc10gLSBTdGF0dXNlcyB0byBleHBvcnQuXG4gICAqIEBwYXJhbSB7KCkgPT4gRGF0ZX0gW29wdGlvbnMubm93XSAtIEV4cG9ydCBjbG9jay5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9wZWVyLW11dGF0aW9uLWJ1bmRsZS5qc1wiKS5QZWVyTXV0YXRpb25CdW5kbGU+fSAtIFNpZ25lZCBwZWVyIGJ1bmRsZS5cbiAgICovXG4gIGFzeW5jIGV4cG9ydFBlZXJCdW5kbGUob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vZmZsaW5lU2Vzc2lvbigpLmV4cG9ydEJ1bmRsZShvcHRpb25zKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSW1wb3J0cyBhIHBlZXIgYnVuZGxlIGludG8gdGhlIGxvY2FsIG11dGF0aW9uIGxvZzogZXZlcnkgZW50cnkgaXMgdmVyaWZpZWRcbiAgICogYWdhaW5zdCB0aGUgY29uZmlndXJlZCBiYWNrZW5kIHB1YmxpYyBrZXkgYmVmb3JlIGl0IGlzIGFwcGVuZGVkLCBhbmRcbiAgICogZW50cmllcyBhbHJlYWR5IHByZXNlbnQgYnkgaWRlbXBvdGVuY3kga2V5IGFyZSBza2lwcGVkIGFzIGR1cGxpY2F0ZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW1wb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9wZWVyLW11dGF0aW9uLWJ1bmRsZS5qc1wiKS5QZWVyTXV0YXRpb25CdW5kbGV9IGFyZ3MuYnVuZGxlIC0gUGVlciBidW5kbGUgdG8gaW1wb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHR9IFthcmdzLm11dGF0aW9uTG9nXSAtIFRhcmdldCBsb2cuIERlZmF1bHRzIHRvIHRoZSBzZXNzaW9uJ3MgZmlyc3QgbG9nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3BlZXItbXV0YXRpb24tYnVuZGxlLmpzXCIpLlBlZXJNdXRhdGlvbkJ1bmRsZUltcG9ydFJlc3VsdD59IC0gSW1wb3J0IHJlc3VsdCAoaW1wb3J0ZWQvcmVqZWN0ZWQvc2tpcHBlZCkuXG4gICAqL1xuICBhc3luYyBpbXBvcnRQZWVyQnVuZGxlKHtidW5kbGUsIG11dGF0aW9uTG9nfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub2ZmbGluZVNlc3Npb24oKS5pbXBvcnRCdW5kbGUoe2J1bmRsZSwgbXV0YXRpb25Mb2d9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbiBhdXRob3JpdGF0aXZlIHJlbW90ZSBvYnNlcnZhdGlvbiBzbyBhbiBpbi1mbGlnaHQgYWNrbm93bGVkZ2VtZW50XG4gICAqIGNhbm5vdCByZWJhc2UgYSBzdWNjZXNzb3IgYWNyb3NzIHRoYXQgb2JzZXJ2YXRpb24uXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlSWQ6IHN0cmluZyB8IG51bWJlciwgcmVzb3VyY2VUeXBlOiBzdHJpbmcsIHZlcnNpb24/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsfX0gYXJncyAtIFJlbW90ZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBub3RlUmVtb3RlVmVyc2lvbih7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlLCB2ZXJzaW9ufSkge1xuICAgIHZvaWQgdmVyc2lvblxuICAgIGNvbnN0IGlkZW50aXR5ID0gYCR7cmVzb3VyY2VUeXBlfToke1N0cmluZyhyZXNvdXJjZUlkKX1gXG5cbiAgICB0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5zZXQoaWRlbnRpdHksICh0aGlzLl9yZW1vdGVHZW5lcmF0aW9ucy5nZXQoaWRlbnRpdHkpIHx8IDApICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgYXV0aG9yaXRhdGl2ZSBiYXNlIHZlcnNpb24gb2JzZXJ2ZWQgYmVmb3JlIGEgbG9jYWwgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIFZlcnNpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IEJhc2UgdmVyc2lvbi5cbiAgICovXG4gIGJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGUgPSByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nPy52ZXJzaW9uQXR0cmlidXRlXG5cbiAgICBpZiAoIXZlcnNpb25BdHRyaWJ1dGUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB2YWx1ZSA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHZlcnNpb25BdHRyaWJ1dGUpXG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCB2ZXJzaW9uICR7dmVyc2lvbkF0dHJpYnV0ZX0gbXVzdCBiZSBhIERhdGUsIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgcHJlLWFzc2lnbm1lbnQgdmFsdWUgZXhwb3NlZCBieSByZWNvcmQgY2hhbmdlcyBkdXJpbmcgYmVmb3JlVXBkYXRlLlxuICAgKiBEZWxldGVzIGhhdmUgbm8gdmVyc2lvbiBjaGFuZ2UgcGFpciBhbmQgdXNlIHRoZSByZWNvcmQncyBjdXJyZW50IHZlcnNpb24uXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIFZlcnNpb24gYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IFByZS1tdXRhdGlvbiBiYXNlIHZlcnNpb24uXG4gICAqL1xuICBwcmVNdXRhdGlvbkJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcbiAgICBjb25zdCB2ZXJzaW9uQ29sdW1uID0gdmVyc2lvbkF0dHJpYnV0ZVxuICAgICAgPyByZWNvcmQuY29uc3RydWN0b3IuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3ZlcnNpb25BdHRyaWJ1dGVdXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHZlcnNpb25DaGFuZ2UgPSBvcGVyYXRpb24gPT09IFwidXBkYXRlXCIgJiYgdmVyc2lvbkNvbHVtblxuICAgICAgPyByZWNvcmQuY2hhbmdlcygpW3ZlcnNpb25Db2x1bW5dXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCF2ZXJzaW9uQ2hhbmdlKSByZXR1cm4gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcblxuICAgIGNvbnN0IHZhbHVlID0gdmVyc2lvbkNoYW5nZVswXVxuXG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY29uZmxpY3QgdmVyc2lvbiAke3ZlcnNpb25BdHRyaWJ1dGV9IG11c3QgYmUgYSBEYXRlLCBzdHJpbmcsIG51bWJlciwgb3IgbnVsbGApXG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgdGhlIGJhc2UgY2FwdHVyZWQgZm9yIHRoaXMgbGlmZWN5Y2xlIGV2ZW50IGJlZm9yZSBpdHMgYWZ0ZXItY29tbWl0XG4gICAqIGNsb3N1cmUgaXMgZGVmZXJyZWQsIHByZXNlcnZpbmcgcmVwZWF0ZWQgc2FtZS1yZWNvcmQgd3JpdGVzIGluIG9uZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gQ2FwdHVyZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gQ2FwdHVyZWQgYmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgY2FwdHVyZWRCYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmIChvcGVyYXRpb24gPT09IFwiY3JlYXRlXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjYXB0dXJlZFZlcnNpb25zID0gdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZ2V0KHJlY29yZClcbiAgICBjb25zdCBiYXNlVmVyc2lvbiA9IGNhcHR1cmVkVmVyc2lvbnM/LnNoaWZ0KClcblxuICAgIGlmIChjYXB0dXJlZFZlcnNpb25zPy5sZW5ndGggPT09IDApIHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLmRlbGV0ZShyZWNvcmQpXG4gICAgaWYgKGJhc2VWZXJzaW9uICE9PSB1bmRlZmluZWQpIHJldHVybiBiYXNlVmVyc2lvblxuXG4gICAgcmV0dXJuIHRoaXMuYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pXG4gIH1cblxuICAvKipcbiAgICogU2NoZWR1bGVzIGEgYmFja2dyb3VuZCByZXBsYXkgYXR0ZW1wdCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIuXG4gICAqIEZhaWx1cmVzIGdvIHRvIGNvbmZpZy5vbkVycm9yIChvciByZXRocm93IHdoZW4gbm9uZSBpcyBjb25maWd1cmVkKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzY2hlZHVsZVJlcGxheSgpIHtcbiAgICBjb25zdCBjb29yZGluYXRvclJ1biA9IHRoaXMucmVxdWVzdENvb3JkaW5hdG9yU3luYyhcIm11dGF0aW9uXCIpXG5cbiAgICBpZiAoY29vcmRpbmF0b3JSdW4pIHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFJlcGxheSA9IGNvb3JkaW5hdG9yUnVuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9zY2hlZHVsZWRSZXBsYXkgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZXBsYXlQZW5kaW5nKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICh0aGlzLmlzTGlmZWN5Y2xlQWJvcnQoZXJyb3IpKSByZXR1cm5cblxuICAgICAgICB0aGlzLnJlcG9ydEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG4gICAgICB9XG4gICAgfSkoKVxuICB9XG5cbiAgLyoqXG4gICAqIEF3YWl0cyB0aGUgbGFzdCBzY2hlZHVsZWQgYmFja2dyb3VuZCByZXBsYXkgKHVzZWZ1bCBpbiB0ZXN0cyBhbmQgc2h1dGRvd24gZmxvd3MpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JTY2hlZHVsZWRSZXBsYXkoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFJlcGxheSkgYXdhaXQgdGhpcy5fc2NoZWR1bGVkUmVwbGF5XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIGJhY2tncm91bmQgc3luYyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEJhY2tncm91bmQgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXBvcnRFcnJvcihlcnJvcikge1xuICAgIGlmICh0aGlzLmNvbmZpZy5vbkVycm9yKSB7XG4gICAgICB0aGlzLmNvbmZpZy5vbkVycm9yKGVycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb25uZWN0aXZpdHkgdGhyb3VnaCB0aGUgY29uZmlndXJlZCBnYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgYmFja2VuZCBpcyBjb25zaWRlcmVkIHJlYWNoYWJsZS5cbiAgICovXG4gIGFzeW5jIGlzT25saW5lKCkge1xuICAgIGlmICghdGhpcy5jb25maWcuaXNPbmxpbmUpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuY29uZmlnLmlzT25saW5lKCkpICE9PSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNjb3BlIHN0b3JlIGJhY2tpbmcgZGVjbGFyZWQgc2NvcGVzIGFuZCBjdXJzb3JzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXNjb3BlLXN0b3JlLmpzXCIpLmRlZmF1bHR9IFNjb3BlIHN0b3JlLlxuICAgKi9cbiAgc2NvcGVTdG9yZSgpIHtcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcblxuICAgIGlmICh0aGlzLl9zY29wZVN0b3JlICYmIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiYgdGhpcy5fc2NvcGVTdG9yZS5zdG9yZUlkZW50aXR5ICE9PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHNjb3BlIHN0b3JlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX3Njb3BlU3RvcmUgfHw9IG5ldyBTeW5jU2NvcGVTdG9yZSh7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZy5jb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICB0ZW5hbnRIYW5kbGU6IHRoaXMuY29uZmlnLnRlbmFudEhhbmRsZVxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5fc2NvcGVTdG9yZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHBlci1yZWNvcmQgYXBwbGllZC1zZXF1ZW5jZSBzdG9yZSB0aGF0IGtlZXBzIHJlbW90ZSBhcHBsaWVzXG4gICAqIGlkZW1wb3RlbnQgYWNyb3NzIHB1bGwvcmVhbHRpbWUgZHVwbGljYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtYXBwbGllZC1zZXF1ZW5jZS1zdG9yZS5qc1wiKS5kZWZhdWx0fSBBcHBsaWVkLXNlcXVlbmNlIHN0b3JlLlxuICAgKi9cbiAgYXBwbGllZFNlcXVlbmNlU3RvcmUoKSB7XG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG5cbiAgICBpZiAodGhpcy5fYXBwbGllZFNlcXVlbmNlU3RvcmUgJiYgdGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJiB0aGlzLl9hcHBsaWVkU2VxdWVuY2VTdG9yZS5zdG9yZUlkZW50aXR5ICE9PSB0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IGFwcGxpZWQtc2VxdWVuY2Ugc3RvcmUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYXBwbGllZFNlcXVlbmNlU3RvcmUgfHw9IG5ldyBTeW5jQXBwbGllZFNlcXVlbmNlU3RvcmUoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbixcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgdGVuYW50SGFuZGxlOiB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGVcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGxpZWRTZXF1ZW5jZVN0b3JlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZyBmb3IgYSBsb2NhbCByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlY2xhcmVkIHJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHJlc291cmNlQ29uZmlnRm9yKHJlc291cmNlKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlPy5jb25zdHJ1Y3RvclxuXG4gICAgaWYgKHR5cGVvZiBtb2RlbENsYXNzPy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHJlc291cmNlcyBtdXN0IGJlIG1vZGVsIHJlY29yZHMgd2l0aCBhIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSwgZ290OiAke1N0cmluZyhyZXNvdXJjZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZykgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yOiAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN5bmMgdHlwZSBmb3IgYSBtdXRhdGlvbiB0aHJvdWdoIHRoZSByZXNvdXJjZSBjb25maWcuIFRoZVxuICAgKiBcInVwc2VydFwiIGZsYWcgcXVldWVzIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgYXMgXCJ1cGRhdGVcIiByb3dzICh0aGUgc2VydmVyXG4gICAqIHVwc2VydHMgYnkgcmVzb3VyY2UgaWQpIGFuZCBkZXN0cm95cyBhcyBcImRlbGV0ZVwiIHJvd3MuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIE11dGF0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMgdHlwZS5cbiAgICovXG4gIGRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDb25maWcuc3luY1R5cGUgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHJlc291cmNlQ29uZmlnLnN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZH0pXG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJkZXN0cm95XCIpIHJldHVybiBcImRlbGV0ZVwiXG4gICAgaWYgKHJlc291cmNlQ29uZmlnLnN5bmNUeXBlID09PSBcInVwc2VydFwiKSByZXR1cm4gXCJ1cGRhdGVcIlxuXG4gICAgcmV0dXJuIG9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIERlcml2ZXMgdGhlIHB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncyBmcm9tIHRoZSBkZWNsYXJlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSBbb3BlcmF0aW9uXSAtIFRlbmFudCBvcGVyYXRpb24gYmluZGluZyB0aGUgcmVzb3VyY2UgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz59IFB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncy5cbiAgICovXG4gIHB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKSB7XG4gICAgaWYgKCFvcGVyYXRpb24gJiYgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncykgcmV0dXJuIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3NcblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlncyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnPn0gKi8gKE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcylcbiAgICAgICAgLmZpbHRlcigoWywgcmVzb3VyY2VdKSA9PiBCb29sZWFuKHJlc291cmNlLmF0dHJpYnV0ZXMpKVxuICAgICAgICAubWFwKChbcmVzb3VyY2VUeXBlLCByZXNvdXJjZV0pID0+IHtcbiAgICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3MocmVzb3VyY2UubW9kZWxDbGFzcykgOiByZXNvdXJjZS5tb2RlbENsYXNzXG4gICAgICAgICAgY29uc3QgZmluZFJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmRcbiAgICAgICAgICBjb25zdCBmaW5kUmVjb3JkRm9yRGVsZXRlID0gcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZVxuXG4gICAgICAgICAgcmV0dXJuIFtyZXNvdXJjZVR5cGUsIHtcbiAgICAgICAgICAgIGFmdGVyQXBwbHk6IHJlc291cmNlLmFmdGVyQXBwbHksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZ1tcImF0dHJpYnV0ZXNcIl19ICovIChyZXNvdXJjZS5hdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBmaW5kUmVjb3JkOiBvcGVyYXRpb24gJiYgZmluZFJlY29yZFxuICAgICAgICAgICAgICA/IChhcmdzKSA9PiBmaW5kUmVjb3JkKHsuLi5hcmdzLCBtb2RlbENsYXNzLCBvcGVyYXRpb246IG9wZXJhdGlvbiB8fCBudWxsfSlcbiAgICAgICAgICAgICAgOiBmaW5kUmVjb3JkLFxuICAgICAgICAgICAgZmluZFJlY29yZEZvckRlbGV0ZTogb3BlcmF0aW9uICYmIGZpbmRSZWNvcmRGb3JEZWxldGVcbiAgICAgICAgICAgICAgPyAoYXJncykgPT4gZmluZFJlY29yZEZvckRlbGV0ZSh7Li4uYXJncywgbW9kZWxDbGFzcywgb3BlcmF0aW9uOiBvcGVyYXRpb24gfHwgbnVsbH0pXG4gICAgICAgICAgICAgIDogZmluZFJlY29yZEZvckRlbGV0ZSxcbiAgICAgICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgICAgICB9XVxuICAgICAgICB9KVxuICAgICkpXG5cbiAgICBpZiAoIW9wZXJhdGlvbikgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncyA9IHJlc291cmNlQ29uZmlnc1xuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9jYWwgc3RhdGUgd29yayBvbiB0aGlzIGNsaWVudCdzIGNhcHR1cmVkIHRlbmFudCwgb3IgZGlyZWN0bHkgZm9yIHRoZSBsZWdhY3kgZGVmYXVsdC1kYXRhYmFzZSBjbGllbnQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEJvdW5kIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoVGVuYW50T3BlcmF0aW9uKGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG51bGwpXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcudGVuYW50SGFuZGxlLmRhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgbmFtZTogXCJUZW5hbnQgU3luY0NsaWVudFwiXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5jb25maWcuc3luY01vZGVsKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB3aGV0aGVyIGEgcmVjb3JkIGJlbG9uZ3MgdG8gdGhpcyBjbGllbnQncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2FuZGlkYXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyBjbGllbnQgb3ducyBpdC5cbiAgICovXG4gIG93bnNSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgcmV0dXJuIHJlY29yZC5kYXRhYmFzZUlkZW50aXR5KCkgPT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiZcbiAgICAgIGRhdGFiYXNlT3BlcmF0aW9uPy5zY2hlbWFHZW5lcmF0aW9uKCkgPT09IHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIGEgcmVjb3JkIG5vdCBvd25lZCBieSB0aGlzIGNsaWVudCdzIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDYW5kaWRhdGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFJlY29yZE93bmVyc2hpcChyZWNvcmQpIHtcbiAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlc291cmNlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRlY2xhcmVkIHF1ZXJ5IGFnYWluc3QgdGhpcyBjbGllbnQncyBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gU2NvcGUgcXVlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLnRlbmFudEhhbmRsZSB8fCAhdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBxdWVyeS5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUudGVuYW50KCl9KVxuICAgIGNvbnN0IHF1ZXJ5RGF0YWJhc2VJZGVudGl0eSA9IHF1ZXJ5Ll9vcGVyYXRpb24/LmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyIHx8XG4gICAgICAhdGhpcy5jb25maWcucmVzb3VyY2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldIHx8XG4gICAgICBxdWVyeURhdGFiYXNlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgd29yayBhZnRlciB0aGUgaGFuZGxlJ3MgcmVhZHkgcGh5c2ljYWwgc2NoZW1hIGdlbmVyYXRpb24gY2hhbmdlZCBvciBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0VGVuYW50UmVhZHkoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuXG5cbiAgICBjb25zdCBsaWZlY3ljbGUgPSB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXJ9KVxuXG4gICAgaWYgKCFsaWZlY3ljbGUucmVhZHkgfHwgIWxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uIHx8IGxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uICE9PSB0aGlzLl90ZW5hbnRTY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudCBkYXRhYmFzZSBnZW5lcmF0aW9uIGlzIHN0YWxlIG9yIG5vdCByZWFkeVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIGN1c3RvbSByZW1vdGUgcmVzb2x2ZXIgcmVzdWx0IHRvIHRoZSBhY3RpdmUgdGVuYW50IG9wZXJhdGlvbiBhZnRlciBwcm92aW5nIGl0cyBjYXB0dXJlZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBCaW5kaW5nIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KSB7XG4gICAgaWYgKHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbj8uKCkgPT09IG9wZXJhdGlvbikgcmV0dXJuXG4gICAgdGhpcy5hc3NlcnRSZWNvcmRPd25lcnNoaXAocmVjb3JkKVxuICAgIG9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBwcml2YWN5LXNhZmUgY29uZmxpY3QgbWV0YWRhdGEgZnJvbSBhIGR1cmFibGUgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBEdXJhYmxlIGNvbmZsaWN0IHJlY29yZC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0NvbmZsaWN0RGlhZ25vc3RpY30gLSBTYWZlIGRpYWdub3N0aWMuXG4gKi9cbmZ1bmN0aW9uIHN5bmNDb25mbGljdERpYWdub3N0aWMocmVjb3JkKSB7XG4gIGNvbnN0IGNvbmZsaWN0ID0gcmVjb3JkLnN5bmNSZXN1bHQ/LmNvbmZsaWN0XG4gIGNvbnN0IGNvbmZsaWN0T2JqZWN0ID0gY29uZmxpY3QgJiYgIShjb25mbGljdCBpbnN0YW5jZW9mIERhdGUpICYmIHR5cGVvZiBjb25mbGljdCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjb25mbGljdClcbiAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChjb25mbGljdClcbiAgICA6IHt9XG4gIGNvbnN0IHJlc291cmNlSWQgPSByZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZFxuXG4gIGlmICh0eXBlb2YgcmVzb3VyY2VJZCAhPT0gXCJzdHJpbmdcIiB8fCByZXNvdXJjZUlkLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0ICR7cmVjb3JkLmlkfSBpcyBtaXNzaW5nIGEgc2FmZSByZXNvdXJjZUlkYClcblxuICByZXR1cm4ge1xuICAgIGJhc2VWZXJzaW9uOiBzYWZlQ29uZmxpY3RWZXJzaW9uKGNvbmZsaWN0T2JqZWN0LmJhc2VWZXJzaW9uID8/IHJlY29yZC5tdXRhdGlvbi5iYXNlVmVyc2lvbiA/PyBudWxsKSxcbiAgICBjbGllbnRNdXRhdGlvbklkOiByZWNvcmQubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICBsb2NhbFZlcnNpb246IHNhZmVDb25mbGljdFZlcnNpb24oY29uZmxpY3RPYmplY3QubG9jYWxWZXJzaW9uID8/IG51bGwpLFxuICAgIHJlY29yZElkOiByZWNvcmQuaWQsXG4gICAgcmVzb3VyY2VJZCxcbiAgICByZXNvdXJjZVR5cGU6IHJlY29yZC5tdXRhdGlvbi5tb2RlbCxcbiAgICBzZXJ2ZXJWZXJzaW9uOiBzYWZlQ29uZmxpY3RWZXJzaW9uKGNvbmZsaWN0T2JqZWN0LnNlcnZlclZlcnNpb24gPz8gbnVsbCksXG4gICAgdmVyc2lvbkF0dHJpYnV0ZTogdHlwZW9mIGNvbmZsaWN0T2JqZWN0LnZlcnNpb25BdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgPyBjb25mbGljdE9iamVjdC52ZXJzaW9uQXR0cmlidXRlIDogbnVsbFxuICB9XG59XG5cbi8qKlxuICogUmVzdHJpY3RzIGRpYWdub3N0aWMgdmVyc2lvbnMgdG8gc2FmZSBzY2FsYXIgdmFsdWVzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZlcnNpb24gY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IC0gU2FmZSBzY2FsYXIgdmVyc2lvbi5cbiAqL1xuZnVuY3Rpb24gc2FmZUNvbmZsaWN0VmVyc2lvbih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiA/IHZhbHVlIDogbnVsbFxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgcmVzb3VyY2UgY29uZmlnIGZyb20gYSBtb2RlbCdzIGBzdGF0aWMgc3luY2AgZGVjbGFyYXRpb24gcGx1cyBpdHNcbiAqIGRlcml2ZWQgY29sdW1uIG1ldGFkYXRhLlxuICogQHBhcmFtIHt7ZGVjbGFyYXRpb246IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb24sIG1ldGFkYXRhTW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBvZmZsaW5lQ29uZmlndXJlZD86IGJvb2xlYW4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlY2xhcmF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlcml2ZWQgcmVzb3VyY2UgY29uZmlnLlxuICovXG5mdW5jdGlvbiByZXNvdXJjZUNvbmZpZ0Zyb21TeW5jRGVjbGFyYXRpb24oe2RlY2xhcmF0aW9uLCBtZXRhZGF0YU1vZGVsQ2xhc3MsIG1vZGVsQ2xhc3MsIG9mZmxpbmVDb25maWd1cmVkID0gZmFsc2UsIHJlc291cmNlVHlwZX0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZERlY2xhcmF0aW9uID0gZGVjbGFyYXRpb24gPT09IHRydWUgPyB7fSA6IGRlY2xhcmF0aW9uXG5cbiAgaWYgKCFub3JtYWxpemVkRGVjbGFyYXRpb24gfHwgdHlwZW9mIG5vcm1hbGl6ZWREZWNsYXJhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG5vcm1hbGl6ZWREZWNsYXJhdGlvbikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBtdXN0IGJlIHRydWUgb3IgYSBzeW5jIGRlY2xhcmF0aW9uIG9iamVjdCwgZ290OiAke1N0cmluZyhkZWNsYXJhdGlvbil9YClcbiAgfVxuXG4gIGNvbnN0IHthZnRlckFwcGx5LCBhdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcywgY29uZmxpY3RUcmFja2luZywgZmluZFJlY29yZCwgZmluZFJlY29yZEZvckRlbGV0ZSwgbG9jYWxPbmx5QXR0cmlidXRlcywgcHVibGlzaCwgcmVhbHRpbWUsIHN5bmNUeXBlLCB0cmFjaywgdHJhY2tlZERhdGEsIC4uLnJlc3REZWNsYXJhdGlvbn0gPSBub3JtYWxpemVkRGVjbGFyYXRpb25cbiAgY29uc3QgdW5rbm93bktleXMgPSBPYmplY3Qua2V5cyhyZXN0RGVjbGFyYXRpb24pXG5cbiAgLy8gYHB1Ymxpc2hgIGlzIHRoZSBzZXJ2ZXItc2lkZSBoYWxmIG9mIHRoZSBzaGFyZWQgYHN0YXRpYyBzeW5jYCBkZWNsYXJhdGlvblxuICAvLyAoY29uc3VtZWQgYnkgU3luY1B1Ymxpc2hlciBvbiB0aGUgYmFja2VuZCkgLSB0aGUgY2xpZW50IGRlcml2ZXMgbm90aGluZ1xuICAvLyBmcm9tIGl0LCBidXQgbW9kZWxzIGRlY2xhcmVkIG9uY2UgZm9yIGJvdGggc2lkZXMgbXVzdCBzdGF5IHZhbGlkIGhlcmUuXG4gIHZvaWQgcHVibGlzaFxuXG4gIGlmICh1bmtub3duS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVjZWl2ZWQgdW5rbm93biBrZXlzOiAke3Vua25vd25LZXlzLmpvaW4oXCIsIFwiKX0gKHN1cHBvcnRlZDogYWZ0ZXJBcHBseSwgYXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMsIGNvbmZsaWN0VHJhY2tpbmcsIGZpbmRSZWNvcmQsIGZpbmRSZWNvcmRGb3JEZWxldGUsIGxvY2FsT25seUF0dHJpYnV0ZXMsIHB1Ymxpc2gsIHJlYWx0aW1lLCBzeW5jVHlwZSwgdHJhY2ssIHRyYWNrZWREYXRhKWApXG4gIH1cbiAgaWYgKHN5bmNUeXBlICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHN5bmNUeXBlICE9PSBcImZ1bmN0aW9uXCIgJiYgc3luY1R5cGUgIT09IFwidXBzZXJ0XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBzdGF0aWMgc3luYyBzeW5jVHlwZSBtdXN0IGJlIGEgZnVuY3Rpb24gb3IgdGhlIHN0cmluZyBcInVwc2VydFwiLCBnb3Q6ICR7U3RyaW5nKHN5bmNUeXBlKX1gKVxuICB9XG5cbiAgY29uc3QgZGVyaXZlZCA9IGRlcml2ZWRTeW5jQXR0cmlidXRlcyh7bW9kZWxDbGFzczogbWV0YWRhdGFNb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KVxuXG4gIGlmIChjb25mbGljdFRyYWNraW5nKSB2YWxpZGF0ZUNvbmZsaWN0VHJhY2tpbmcoe2NvbmZsaWN0VHJhY2tpbmcsIGRlcml2ZWQsIG9mZmxpbmVDb25maWd1cmVkLCByZXNvdXJjZVR5cGV9KVxuXG4gIHJldHVybiB7XG4gICAgYWZ0ZXJBcHBseSxcbiAgICBhdHRyaWJ1dGVzLFxuICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiBtZXJnZWRBdHRyaWJ1dGVOYW1lcyhkZXJpdmVkLmJvb2xlYW5BdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcyksXG4gICAgY29uZmxpY3RUcmFja2luZzogY29uZmxpY3RUcmFja2luZyA/IHsuLi5jb25mbGljdFRyYWNraW5nLCB2ZXJzaW9uQXR0cmlidXRlOiBjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgfHwgXCJ1cGRhdGVkQXRcIn0gOiB1bmRlZmluZWQsXG4gICAgZmluZFJlY29yZCxcbiAgICBmaW5kUmVjb3JkRm9yRGVsZXRlLFxuICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IG1lcmdlZEF0dHJpYnV0ZU5hbWVzKFxuICAgICAgZGVyaXZlZC5sb2NhbE9ubHlBdHRyaWJ1dGVzLFxuICAgICAgWy4uLihsb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSwgLi4uKGNvbmZsaWN0VHJhY2tpbmcgPyBbY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlIHx8IFwidXBkYXRlZEF0XCJdIDogW10pXVxuICAgICksXG4gICAgbWV0YWRhdGFNb2RlbENsYXNzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgcmVhbHRpbWUsXG4gICAgc3luY1R5cGUsXG4gICAgdHJhY2s6IG5vcm1hbGl6ZWRUcmFjayh0cmFjayksXG4gICAgdHJhY2tlZERhdGFcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgcmVzb3VyY2UncyBkdXJhYmxlIGNvbmZsaWN0LXRyYWNraW5nIGRlY2xhcmF0aW9uLlxuICogQHBhcmFtIHt7Y29uZmxpY3RUcmFja2luZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmxpY3RUcmFja2luZ0NvbmZpZywgZGVyaXZlZDoge2Jvb2xlYW5BdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbG9jYWxPbmx5QXR0cmlidXRlczogc3RyaW5nW119LCBvZmZsaW5lQ29uZmlndXJlZDogYm9vbGVhbiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gVmFsaWRhdGlvbiBhcmdzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlQ29uZmxpY3RUcmFja2luZyh7Y29uZmxpY3RUcmFja2luZywgZGVyaXZlZCwgb2ZmbGluZUNvbmZpZ3VyZWQsIHJlc291cmNlVHlwZX0pIHtcbiAgY29uc3QgaWRlbnRpdHlGaWVsZHMgPSB7XG4gICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgIGFjdG9yVXNlcklkOiBjb25mbGljdFRyYWNraW5nLmFjdG9yVXNlcklkLFxuICAgIG9mZmxpbmVHcmFudElkOiBjb25mbGljdFRyYWNraW5nLm9mZmxpbmVHcmFudElkLFxuICAgIHBvbGljeUhhc2g6IGNvbmZsaWN0VHJhY2tpbmcucG9saWN5SGFzaFxuICB9XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoaWRlbnRpdHlGaWVsZHMpKSB7XG4gICAgLy8gR3JhbnRzIGFuZCBwb2xpY3kgaGFzaGVzIHJvdGF0ZSBhdCBydW50aW1lOiBhIGRlY2xhcmF0aW9uIG1heSBwcm92aWRlIGFcbiAgICAvLyBzdGF0aWMgc3RyaW5nLCBhIGZ1bmN0aW9uIHJlc29sdmluZyB0aGUgdmFsdWUgYXQgcXVldWUgdGltZSwgb3Igb21pdCB0aGVcbiAgICAvLyBrZXkgZW50aXJlbHkgd2hlbiBhIGBzeW5jLmNsaWVudC5vZmZsaW5lYCBzZXNzaW9uIHN1cHBsaWVzIGl0LlxuICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkICYmIG9mZmxpbmVDb25maWd1cmVkKSBjb250aW51ZVxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikgY29udGludWVcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy4ke2tleX0gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGEgZnVuY3Rpb24gcmVzb2x2aW5nIG9uZSwgb3Igb21pdHRlZCB3aGVuIHN5bmMuY2xpZW50Lm9mZmxpbmUgc3VwcGxpZXMgaXRgKVxuICAgIH1cbiAgfVxuICBpZiAoIWNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgfHwgdHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgbXVzdCBiZSBhIExvY2FsTXV0YXRpb25Mb2dgKVxuICBpZiAodHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcuY2xpZW50TXV0YXRpb25JZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQgbXVzdCBiZSBhIGZ1bmN0aW9uYClcbiAgaWYgKCFjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgJiYgIWRlcml2ZWQubG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhcInVwZGF0ZWRBdFwiKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcgcmVxdWlyZXMgdmVyc2lvbkF0dHJpYnV0ZSBiZWNhdXNlIHRoZSBtb2RlbCBoYXMgbm8gdXBkYXRlZEF0IGNvbHVtbmApXG4gIH1cbn1cblxuLyoqXG4gKiBEZXJpdmVzIGJvb2xlYW4gYW5kIGxvY2FsLW9ubHkgYXR0cmlidXRlIG5hbWVzIGZyb20gYSBtb2RlbCdzIGNvbHVtbiBtZXRhZGF0YTpcbiAqIGJvb2xlYW5zIGZyb20gYm9vbGVhbiBjb2x1bW4gdHlwZXM7IGxvY2FsLW9ubHkgZnJvbSB0aGUgcHJpbWFyeSBrZXksXG4gKiBjcmVhdGVkQXQvdXBkYXRlZEF0LCBhbmQgc3luYyBib29ra2VlcGluZyBjb2x1bW5zLlxuICogQHBhcmFtIHt7bW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlcml2YXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHt7Ym9vbGVhbkF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBzdHJpbmdbXX19IERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBkZXJpdmVkU3luY0F0dHJpYnV0ZXMoe21vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pIHtcbiAgaWYgKFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5wcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCJcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVxdWlyZXMgYSBWZWxvY2lvdXMgbW9kZWwgY2xhc3Mgd2l0aCBjb2x1bW4gbWV0YWRhdGEgKGdldENvbHVtbk5hbWVzLCBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwLCBnZXRDb2x1bW5UeXBlQnlOYW1lLCBwcmltYXJ5S2V5LCBoYXNQcmltYXJ5S2V5KWApXG4gIH1cblxuICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYm9vbGVhbkF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBsb2NhbE9ubHlBdHRyaWJ1dGVzID0gW11cblxuICBpZiAobW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5KCkpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgRGVyaXZlZCBzeW5jIGF0dHJpYnV0ZXMgZm9yICR7cmVzb3VyY2VUeXBlfWApXG5cbiAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtwcmltYXJ5S2V5Q29sdW1uXSB8fCBwcmltYXJ5S2V5Q29sdW1uKVxuICB9XG5cbiAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZXMoKSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpICYmICFsb2NhbE9ubHlBdHRyaWJ1dGVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gICAgaWYgKGNvbHVtblR5cGUgJiYgaXNCb29sZWFuQ29sdW1uVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgYm9vbGVhbkF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7Ym9vbGVhbkF0dHJpYnV0ZXMsIGxvY2FsT25seUF0dHJpYnV0ZXN9XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlcml2ZWQgYXR0cmlidXRlIG5hbWVzIHdpdGggZGVjbGFyZWQgZXh0cmFzIGludG8gYSBzb3J0ZWQsIGR1cGxpY2F0ZS1mcmVlIGxpc3QuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXJpdmVkIC0gRGVyaXZlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSBkZWNsYXJlZCAtIERlY2xhcmVkIGV4dHJhIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gTWVyZ2VkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VkQXR0cmlidXRlTmFtZXMoZGVyaXZlZCwgZGVjbGFyZWQpIHtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KFsuLi5kZXJpdmVkLCAuLi4oZGVjbGFyZWQgfHwgW10pXSldLnNvcnQoKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBkZWNsYXJhdGlvbidzIHRyYWNrIHZhbHVlOiBhbiBvcGVyYXRpb25zIGFycmF5IGlzIHNob3J0aGFuZCBmb3JcbiAqIHRoZSB7b3BlcmF0aW9uc30gZm9ybS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbkNvbmZpZ1tcInRyYWNrXCJdfSB0cmFjayAtIERlY2xhcmVkIHRyYWNrIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnW1widHJhY2tcIl19IE5vcm1hbGl6ZWQgdHJhY2sgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZWRUcmFjayh0cmFjaykge1xuICBpZiAoQXJyYXkuaXNBcnJheSh0cmFjaykpIHJldHVybiB7b3BlcmF0aW9uczogdHJhY2t9XG5cbiAgcmV0dXJuIHRyYWNrXG59XG5cbi8qKlxuICogQnVpbGRzIGEgZnJhbWV3b3JrLW93bmVkIFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBmb3IgYSBwYXRoXG4gKiBjaG9zZW4gYXQgY2FsbCB0aW1lICh1c2VkIGJ5IHRoZSBsb25nLW9mZmxpbmUgc2Vzc2lvbidzIGJvb3RzdHJhcC9yZXBsYXlcbiAqIGVuZHBvaW50cywgd2hpY2ggbGl2ZSBvdXRzaWRlIHRoZSBzeW5jLmFwaSBtb3VudCBwYXRoKS5cbiAqIEBwYXJhbSB7e3JlcXVlc3RDb250ZXh0OiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzU3luY0NsaWVudFRyYW5zcG9ydH19IGFyZ3MgLSBQb3N0ZXIgYXJncy5cbiAqIEByZXR1cm5zIHsocGF0aDogc3RyaW5nLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUGF0aC1zZWxlY3Rpbmcgc3luYyBlbmRwb2ludCBQT1NUZXIuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFBhdGhQb3N0ZXIoe3JlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnR9KSB7XG4gIHJldHVybiBhc3luYyAocGF0aCwgcGF5bG9hZCwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSBtZXJnZVJlbW90ZVJlcXVlc3RDb250ZXh0KHtcbiAgICAgIGNvbnRleHQ6IHJlcXVlc3RDb250ZXh0LFxuICAgICAgbGFiZWw6IFwiU3luYyBjbGllbnQgcmVxdWVzdCBjb250ZXh0XCIsXG4gICAgICBwYXJhbXM6IHBheWxvYWRcbiAgICB9KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdHJhbnNwb3J0LnBvc3QocGF0aCwgcmVxdWVzdFBheWxvYWQsIHtzaWduYWw6IG9wdGlvbnMuc2lnbmFsfSlcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlLmpzb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jLmNsaWVudCB0cmFuc3BvcnQucG9zdCBtdXN0IHJlc29sdmUgdG8gYSByZXNwb25zZSB3aXRoIGEganNvbigpIG1ldGhvZCBmb3IgJHtwYXRofSAobGlrZSB0aGUgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNsaWVudClgKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCByZXNwb25zZS5qc29uKClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGZyYW1ld29yay1vd25lZCBzeW5jIGVuZHBvaW50IFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydC5cbiAqIEBwYXJhbSB7e3BhdGg6IHN0cmluZywgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydDogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNTeW5jQ2xpZW50VHJhbnNwb3J0fX0gYXJncyAtIFBvc3RlciBhcmdzLlxuICogQHJldHVybnMgeyhwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU3luYyBlbmRwb2ludCBQT1NUZXIuXG4gKi9cbmZ1bmN0aW9uIHRyYW5zcG9ydFBvc3Rlcih7cGF0aCwgcmVxdWVzdENvbnRleHQsIHRyYW5zcG9ydH0pIHtcbiAgcmV0dXJuIGFzeW5jIChwYXlsb2FkLCBvcHRpb25zID0ge30pID0+IHtcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlUmVtb3RlUmVxdWVzdENvbnRleHQoe1xuICAgICAgY29udGV4dDogcmVxdWVzdENvbnRleHQsXG4gICAgICBsYWJlbDogXCJTeW5jIGNsaWVudCByZXF1ZXN0IGNvbnRleHRcIixcbiAgICAgIHBhcmFtczogcGF5bG9hZFxuICAgIH0pXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0cmFuc3BvcnQucG9zdChwYXRoLCByZXF1ZXN0UGF5bG9hZCwge3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuXG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UuanNvbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMuY2xpZW50IHRyYW5zcG9ydC5wb3N0IG11c3QgcmVzb2x2ZSB0byBhIHJlc3BvbnNlIHdpdGggYSBqc29uKCkgbWV0aG9kIGZvciAke3BhdGh9IChsaWtlIHRoZSBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2xpZW50KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlLmpzb24oKVxuICB9XG59XG5cbi8qKlxuICogTGF6aWx5IGJ1aWxkcyAoYW5kIG1lbW9pemVzIHBlciBjb25maWd1cmF0aW9uKSB0aGUgc3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZVxuICogYXBwJ3MgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24gYW5kIHJlZ2lzdGVycyBpdCBhcyB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gW2NvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHJlZ2lzdGVyZWQgbW9kZWxzIGFuZCB0aGUgc3luYy5jbGllbnQgYmxvY2suIERlZmF1bHRzIHRvIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7U3luY0NsaWVudH0gTWVtb2l6ZWQgc3luYyBjbGllbnQgZm9yIHRoZSBjb25maWd1cmF0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3luY0NsaWVudChjb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KCkpIHtcbiAgbGV0IGNsaWVudCA9IHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghY2xpZW50KSB7XG4gICAgY2xpZW50ID0gU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuICAgIHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBjbGllbnQpXG4gICAgY2xpZW50LnNldEN1cnJlbnQoKVxuICB9XG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIERlY2xhcmVzIGEgc3luYyBzY29wZSBvbiB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgZGVjbGFyaW5nIHRoZSBzeW5jIHNjb3BlLlxuICogQHJldHVybnMge1Byb21pc2U8e3Njb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGUsIHB1bGxlZDogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsfT59IERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN5bmMocXVlcnkpIHtcbiAgcmV0dXJuIGF3YWl0IFN5bmNDbGllbnQuY3VycmVudCgpLnN5bmMocXVlcnkpXG59XG4iXX0=