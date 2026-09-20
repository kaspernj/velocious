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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDL0QsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ25HLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQ25FLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sd0JBQXdCLE1BQU0sb0NBQW9DLENBQUE7QUFFekUsT0FBTyxFQUFDLHdCQUF3QixFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sc0JBQXNCLENBQUE7QUFDaEQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUVqRixJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUE7QUFFckIsc0ZBQXNGO0FBQ3RGLE1BQU0sc0JBQXNCLEdBQUcsRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBQyxDQUFBO0FBRXRHOzs7OztvREFLb0Q7QUFDcEQsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUV2RCxrR0FBa0c7QUFDbEcsTUFBTSxpQ0FBaUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtB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QUFDLGFBQWEsR0FBRyxhQUFhLENBQUMsT0FBTyxFQUFFO0lBQ2hFLElBQUksTUFBTSxHQUFHLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUUxRCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDWixNQUFNLEdBQUcsVUFBVSxDQUFDLGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQ3BELDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDckQsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFBO0lBQ3JCLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQTtBQUNmLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxJQUFJLENBQUMsS0FBSztJQUM5QixPQUFPLE1BQU0sVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtBQUMvQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBDb25maWd1cmF0aW9uIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCB7aXNCb29sZWFuQ29sdW1uVHlwZX0gZnJvbSBcIi4uL2RhdGFiYXNlL2NvbHVtbi10eXBlcy5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IHtjYXB0dXJlUmVtb3RlUmVxdWVzdENvbnRleHQsIG1lcmdlUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5fSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IGZyb20gXCIuLi9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzXCJcblxuaW1wb3J0IHtzZXJpYWxpemVkU2NvcGVGcm9tUXVlcnl9IGZyb20gXCIuL3F1ZXJ5LXNjb3BlLmpzXCJcbmltcG9ydCBTeW5jQXBpQ2xpZW50IGZyb20gXCIuL3N5bmMtYXBpLWNsaWVudC5qc1wiXG5pbXBvcnQgU3luY1JlYWx0aW1lQnJpZGdlIGZyb20gXCIuL3N5bmMtcmVhbHRpbWUtYnJpZGdlLmpzXCJcbmltcG9ydCBTeW5jU2NvcGVTdG9yZSBmcm9tIFwiLi9zeW5jLXNjb3BlLXN0b3JlLmpzXCJcbmltcG9ydCB7Y3VycmVudFN5bmNDbGllbnQsIHNldEN1cnJlbnRTeW5jQ2xpZW50fSBmcm9tIFwiLi9zeW5jLWNsaWVudC1yZWdpc3RyeS5qc1wiXG5cbmxldCBjbGllbnRDb3VudGVyID0gMFxuXG4vKiogQHR5cGUge3tjcmVhdGU6IFwiYWZ0ZXJDcmVhdGVcIiwgdXBkYXRlOiBcImFmdGVyVXBkYXRlXCIsIGRlc3Ryb3k6IFwiYWZ0ZXJEZXN0cm95XCJ9fSAqL1xuY29uc3QgVFJBQ0tFRF9DQUxMQkFDS19OQU1FUyA9IHtjcmVhdGU6IFwiYWZ0ZXJDcmVhdGVcIiwgZGVzdHJveTogXCJhZnRlckRlc3Ryb3lcIiwgdXBkYXRlOiBcImFmdGVyVXBkYXRlXCJ9XG5cbi8qKlxuICogT3BlcmF0aW9ucyB0cmFja2VkIGJ5IGRlZmF1bHQgZm9yIG1vZGVscyBkZWNsYXJpbmcgYHN0YXRpYyBzeW5jYCB3aXRob3V0IGFcbiAqIGB0cmFja2Aga2V5OiBsb2NhbCBjcmVhdGVzIGFuZCB1cGRhdGVzIHF1ZXVlIGF1dG9tYXRpY2FsbHkuIERlc3Ryb3lzIGFyZSBub3RcbiAqIHRyYWNrZWQgYnkgZGVmYXVsdCBiZWNhdXNlIGEgbG9jYWwgZGVzdHJveSBpcyBvZnRlbiBjYWNoZSBldmljdGlvbiByYXRoZXJcbiAqIHRoYW4gYSBzZXJ2ZXIgZGVsZXRlOyBvcHQgaW4gd2l0aCBgdHJhY2s6IHRydWVgIG9yIGFuIG9wZXJhdGlvbnMgbGlzdC5cbiAqIEB0eXBlIHtBcnJheTxcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiPn0gKi9cbmNvbnN0IERFRkFVTFRfVFJBQ0tFRF9PUEVSQVRJT05TID0gW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdXG5cbi8qKiBBdHRyaWJ1dGUgbmFtZXMgdHJlYXRlZCBhcyBjbGllbnQtbG9jYWwgc3luYyBib29ra2VlcGluZyB3aGVuIGRlcml2aW5nIGxvY2FsT25seUF0dHJpYnV0ZXMuICovXG5jb25zdCBMT0NBTF9CT09LS0VFUElOR19BVFRSSUJVVEVfTkFNRVMgPSBbXCJjcmVhdGVkQXRcIiwgXCJ1cGRhdGVkQXRcIiwgXCJsYXN0U3luY0NoYW5nZUF0XCJdXG5cbmNvbnN0IFNZTkNfUkVRVUVTVF9SRVNFUlZFRF9LRVlTID0gW1xuICBcImFmdGVySWRcIixcbiAgXCJhZnRlclNlcnZlclNlcXVlbmNlXCIsXG4gIFwiYWZ0ZXJVcGRhdGVkQXRcIixcbiAgXCJhdXRoZW50aWNhdGlvblRva2VuXCIsXG4gIFwibGltaXRcIixcbiAgXCJzY29wZVwiLFxuICBcInN5bmNzXCIsXG4gIFwidXBzdHJlYW1SZWZyZXNoXCIsXG4gIFwidXBUb0lkXCIsXG4gIFwidXBUb1NlcnZlclNlcXVlbmNlXCIsXG4gIFwidXBUb1VwZGF0ZWRBdFwiXG5dXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxDb25maWd1cmF0aW9uLCBTeW5jQ2xpZW50Pn0gKi9cbmNvbnN0IHN5bmNDbGllbnRzQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKiogRXhwZWN0ZWQgY29vcGVyYXRpdmUgY2FuY2VsbGF0aW9uIHJhaXNlZCBieSBhIFN5bmNDbGllbnQgbGlmZWN5Y2xlIHRyYW5zaXRpb24uICovXG5leHBvcnQgY2xhc3MgU3luY0NsaWVudExpZmVjeWNsZUFib3J0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBCdWlsZHMgYW4gZXhwZWN0ZWQgbGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBlcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHJlYXNvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiU3luY0NsaWVudExpZmVjeWNsZUFib3J0RXJyb3JcIlxuICB9XG59XG5cbi8qKlxuICogRGVjbGFyYXRpdmUgY2xpZW50LXNpZGUgc3luYyBkcml2ZXIuXG4gKlxuICogRXZlcnl0aGluZyBpcyBkZXJpdmVkIGZyb20gdGhlIGFwcCdzIFZlbG9jaW91cyBjb25maWd1cmF0aW9uOiBtb2RlbHMgZGVjbGFyZVxuICogYHN0YXRpYyBzeW5jYCwgdHJhbnNwb3J0L2F1dGgvY29ubmVjdGl2aXR5IGNvbWUgZnJvbSB0aGUgYHN5bmMuY2xpZW50YFxuICogY29uZmlndXJhdGlvbiBibG9jaywgYW5kIFZlbG9jaW91cyBvd25zIHNjb3BlIHBlcnNpc3RlbmNlLCBwZXItc2NvcGUgY3Vyc29ycyxcbiAqIHB1bGwgcGFnaW5nL2FwcGx5LCBsb2NhbCBxdWV1ZWluZywgYW5kIG9ubGluZS1nYXRlZCByZXBsYXkuIERlY2xhcmUgc3luY1xuICogaW50ZXJlc3QgZnJvbSBxdWVyaWVzOlxuICpcbiAqICAgICBhd2FpdCBzeW5jQ2xpZW50KCkuc3RhcnQoKVxuICogICAgIGF3YWl0IHN5bmNDbGllbnQoKS5zeW5jKEV2ZW50LndoZXJlKHtwYXJ0bmVySWR9KSlcbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0NsaWVudCB7XG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMgY2xpZW50IGJ5IGRlcml2aW5nIGV2ZXJ5dGhpbmcgZnJvbSB0aGUgYXBwJ3MgVmVsb2Npb3VzXG4gICAqIGNvbmZpZ3VyYXRpb246IGV2ZXJ5IHJlZ2lzdGVyZWQgbW9kZWwgZGVjbGFyaW5nIGBzdGF0aWMgc3luY2AgYmVjb21lcyBhXG4gICAqIHJlc291cmNlIHdpdGggYm9vbGVhbkF0dHJpYnV0ZXMgZGVyaXZlZCBmcm9tIGNvbHVtbiB0eXBlcyBhbmRcbiAgICogbG9jYWxPbmx5QXR0cmlidXRlcyBkZXJpdmVkIGZyb20gdGhlIHByaW1hcnkga2V5LCBjcmVhdGVkQXQvdXBkYXRlZEF0LCBhbmRcbiAgICogc3luYyBib29ra2VlcGluZyBjb2x1bW5zOyB0aGUgcGVuZGluZy1zeW5jIG1vZGVsIGlzIHRoZSByZWdpc3RlcmVkIFwiU3luY1wiXG4gICAqIG1vZGVsOyB0cmFuc3BvcnQsIGF1dGgsIGNvbm5lY3Rpdml0eSwgYW5kIGVycm9yIHJlcG9ydGluZyBjb21lIGZyb20gdGhlXG4gICAqIGBzeW5jLmNsaWVudGAgY29uZmlndXJhdGlvbiBibG9jaywgd2l0aCB0aGUgZnJhbWV3b3JrIG93bmluZyB0aGVcbiAgICogYCR7bW91bnRQYXRofS9jaGFuZ2VzYCBhbmQgYCR7bW91bnRQYXRofS9yZXBsYXlgIFBPU1RlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50T3B0aW9uc30gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgZGF0YWJhc2VJZGVudGlmaWVyLCBsZWdhY3lDdXJzb3IsIHJlcXVlc3RDb250ZXh0LCBzY29wZVN0b3JlLCBzeW5jTW9kZWwsIHRlbmFudEhhbmRsZSwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0T3B0aW9ucylcblxuICAgIGNvbnN0IGNsaWVudENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLmdldFN5bmNDb25maWd1cmF0aW9uKCkuY2xpZW50XG4gICAgY29uc3QgY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCA9IGNhcHR1cmVSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwge1xuICAgICAgbGFiZWw6IFwiU3luYyBjbGllbnQgcmVxdWVzdCBjb250ZXh0XCIsXG4gICAgICByZXNlcnZlZEtleXM6IFNZTkNfUkVRVUVTVF9SRVNFUlZFRF9LRVlTXG4gICAgfSlcblxuICAgIGlmICghY2xpZW50Q29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCByZXF1aXJlcyBhIHN5bmMuY2xpZW50IGNvbmZpZ3VyYXRpb24gYmxvY2s6IG5ldyBDb25maWd1cmF0aW9uKHtzeW5jOiB7Y2xpZW50OiB7YXV0aGVudGljYXRpb25Ub2tlbiwgdHJhbnNwb3J0fX19KVwiKVxuICAgIH1cblxuICAgIGlmIChCb29sZWFuKHRlbmFudEhhbmRsZSkgIT09IEJvb2xlYW4oZGF0YWJhc2VJZGVudGlmaWVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCB0ZW5hbnRIYW5kbGUgYW5kIGRhdGFiYXNlSWRlbnRpZmllciBtdXN0IGJlIHByb3ZpZGVkIHRvZ2V0aGVyXCIpXG4gICAgfVxuICAgIGlmICh0ZW5hbnRIYW5kbGUpIHtcbiAgICAgIHRlbmFudEhhbmRsZS5hc3NlcnRDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pXG4gICAgICB0ZW5hbnRIYW5kbGUuZGF0YWJhc2VDb25maWd1cmF0aW9uKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGF0YWJhc2VJZGVudGlmaWVyKSlcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcmVzb2x2ZWRTeW5jTW9kZWwgPSBzeW5jTW9kZWwgfHwgbW9kZWxDbGFzc2VzLlN5bmNcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gdGVuYW50SGFuZGxlID8gdGVuYW50SGFuZGxlLmRhdGFiYXNlSWRlbnRpdHkoLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpKSA6IG51bGxcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnPn0gKi9cbiAgICBjb25zdCByZXNvdXJjZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIE9iamVjdC52YWx1ZXMobW9kZWxDbGFzc2VzKSkge1xuICAgICAgaWYgKCFtb2RlbENsYXNzLnN5bmMpIGNvbnRpbnVlXG4gICAgICBpZiAodGVuYW50SGFuZGxlICYmIG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IHRlbmFudEhhbmRsZS50ZW5hbnQoKX0pICE9PSBkYXRhYmFzZUlkZW50aWZpZXIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgY29uc3QgbWV0YWRhdGFNb2RlbENsYXNzID0gdGVuYW50SGFuZGxlXG4gICAgICAgID8gdGVuYW50SGFuZGxlLm1ldGFkYXRhTW9kZWxDbGFzcyh7ZGF0YWJhc2VJZGVudGlmaWVyOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKGRhdGFiYXNlSWRlbnRpZmllciksIG1vZGVsQ2xhc3N9KVxuICAgICAgICA6IG1vZGVsQ2xhc3NcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gcmVzb3VyY2VDb25maWdGcm9tU3luY0RlY2xhcmF0aW9uKHtkZWNsYXJhdGlvbjogbW9kZWxDbGFzcy5zeW5jLCBtZXRhZGF0YU1vZGVsQ2xhc3MsIG1vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pXG5cbiAgICAgIGlmIChkYXRhYmFzZUlkZW50aXR5ICYmIHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZyA9IHtcbiAgICAgICAgICAuLi5yZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgIG11dGF0aW9uTG9nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnBhcnRpdGlvbihkYXRhYmFzZUlkZW50aXR5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJlc291cmNlc1tyZXNvdXJjZVR5cGVdID0gcmVzb3VyY2VDb25maWdcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMocmVzb3VyY2VzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgZm91bmQgbm8gcmVnaXN0ZXJlZCBtb2RlbHMgZGVjbGFyaW5nIHN0YXRpYyBzeW5jIC0gZGVjbGFyZSBgc3RhdGljIHN5bmMgPSB0cnVlYCAob3IgYSBzeW5jIGRlY2xhcmF0aW9uIG9iamVjdCkgb24gdGhlIG1vZGVscyB0aGF0IHNob3VsZCBzeW5jXCIpXG4gICAgfVxuXG4gICAgaWYgKCFyZXNvbHZlZFN5bmNNb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCByZXF1aXJlcyBhIHJlZ2lzdGVyZWQgXFxcIlN5bmNcXFwiIG1vZGVsIGZvciBwZW5kaW5nIGxvY2FsIHN5bmMgcm93cyAob3IgcGFzcyBvcHRpb25zLnN5bmNNb2RlbClcIilcbiAgICB9XG4gICAgaWYgKHRlbmFudEhhbmRsZSAmJiByZXNvbHZlZFN5bmNNb2RlbC5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGVuYW50SGFuZGxlLnRlbmFudCgpfSkgIT09IGRhdGFiYXNlSWRlbnRpZmllcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHN5bmMgbW9kZWwgZG9lcyBub3QgdXNlIHRlbmFudCBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KGRhdGFiYXNlSWRlbnRpZmllcil9YClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZpZ30gKi9cbiAgICB0aGlzLmNvbmZpZyA9IHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGNsaWVudENvbmZpZ3VyYXRpb24uYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogY2xpZW50Q29uZmlndXJhdGlvbi5iYXRjaFNpemUsXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgaXNPbmxpbmU6IGNsaWVudENvbmZpZ3VyYXRpb24uaXNPbmxpbmUsXG4gICAgICBsZWdhY3lDdXJzb3IsXG4gICAgICBvbkVycm9yOiBjbGllbnRDb25maWd1cmF0aW9uLm9uRXJyb3IsXG4gICAgICBwb3N0Q2hhbmdlczogdHJhbnNwb3J0UG9zdGVyKHtwYXRoOiBgJHtjbGllbnRDb25maWd1cmF0aW9uLm1vdW50UGF0aH0vY2hhbmdlc2AsIHJlcXVlc3RDb250ZXh0OiBjYXB0dXJlZFJlcXVlc3RDb250ZXh0LCB0cmFuc3BvcnQ6IGNsaWVudENvbmZpZ3VyYXRpb24udHJhbnNwb3J0fSksXG4gICAgICBwb3N0UmVwbGF5OiB0cmFuc3BvcnRQb3N0ZXIoe3BhdGg6IGAke2NsaWVudENvbmZpZ3VyYXRpb24ubW91bnRQYXRofS9yZXBsYXlgLCByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0OiBjbGllbnRDb25maWd1cmF0aW9uLnRyYW5zcG9ydH0pLFxuICAgICAgcmVhbHRpbWU6IGNsaWVudENvbmZpZ3VyYXRpb24ucmVhbHRpbWUsXG4gICAgICByZXF1ZXN0Q29udGV4dDogY2FwdHVyZWRSZXF1ZXN0Q29udGV4dCxcbiAgICAgIHJlc291cmNlcyxcbiAgICAgIHN5bmNNb2RlbDogcmVzb2x2ZWRTeW5jTW9kZWwsXG4gICAgICB0ZW5hbnRIYW5kbGUsXG4gICAgICB3ZWJzb2NrZXRDbGllbnQ6IGNsaWVudENvbmZpZ3VyYXRpb24ud2Vic29ja2V0Q2xpZW50LFxuICAgICAgd2Vic29ja2V0VXJsOiBjbGllbnRDb25maWd1cmF0aW9uLndlYnNvY2tldFVybFxuICAgIH1cbiAgICB0aGlzLl9jbGllbnROdW1iZXIgPSArK2NsaWVudENvdW50ZXJcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ID0gZGF0YWJhc2VJZGVudGl0eVxuICAgIHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb24gPSB0ZW5hbnRIYW5kbGVcbiAgICAgID8gdGVuYW50SGFuZGxlLmluc3BlY3Qoe2RhdGFiYXNlSWRlbnRpZmllcjogLyoqIEB0eXBlIHtzdHJpbmd9ICovIChkYXRhYmFzZUlkZW50aWZpZXIpfSkuc2NoZW1hR2VuZXJhdGlvblxuICAgICAgOiBudWxsXG4gICAgLyoqIEB0eXBlIHtTeW5jUmVhbHRpbWVCcmlkZ2UgfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWx0aW1lQnJpZGdlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U2hhcmVkQ29ubmVjdGlvbiB8IG51bGwgfCB1bmRlZmluZWR9IFNoYXJlZCBhcHAtbGlmZXRpbWUgd2Vic29ja2V0IGNvbm5lY3Rpb24gKHVuZGVmaW5lZCB1bnRpbCBmaXJzdCByZXNvbHZlZCwgbnVsbCB3aGVuIG5vbmUgaXMgY29uZmlndXJlZCkuICovXG4gICAgdGhpcy5fc3luY0Nvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3N1YnNjcmliZVVzZXJTY29wZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtcInN1YnNjcmliZWRcIiB8IFwic3Vic2NyaWJpbmdcIiB8IFwidW5zdWJzY3JpYmVkXCJ9ICovXG4gICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gICAgdGhpcy5fc2NvcGVTdG9yZSA9IHNjb3BlU3RvcmUgfHwgbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fc2NoZWR1bGVkUmVwbGF5ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7KChyZWFzb246IFwibXV0YXRpb25cIiB8IFwicmVhbHRpbWVcIikgPT4gUHJvbWlzZTx2b2lkPikgfCBudWxsfSAqL1xuICAgIHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlciA9IG51bGxcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3MgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y2FsbGJhY2s6IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZCwgY2FsbGJhY2tOYW1lOiBcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiLCBtb2RlbENsYXNzOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3RyYWNrZWRDYWxsYmFja3MgPSBbXVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxvYmplY3Q+fSAqL1xuICAgIHRoaXMuX3JlbW90ZUFwcGx5UmVjb3JkcyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgdGhpcy5fcmVtb3RlR2VuZXJhdGlvbnMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8b2JqZWN0LCBBcnJheTxzdHJpbmcgfCBudW1iZXIgfCBudWxsPj59ICovXG4gICAgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGggPSAwXG4gICAgLyoqIEB0eXBlIHtMb2dnZXIgfCB7ZXJyb3I6ICguLi5tZXNzYWdlczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPHZvaWQ+fSB8IG51bGx9ICovXG4gICAgdGhpcy5fbG9nZ2VyID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dW5rbm93bj4+fSAqL1xuICAgIHRoaXMuX2FjdGl2ZUxpZmVjeWNsZVdvcmsgPSBuZXcgU2V0KClcbiAgICB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uID0gMFxuICAgIHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCA9IDBcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3N0YXJ0ZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhdXRvbWF0aWMgbXV0YXRpb24gdHJhY2tpbmcgZm9yIGV2ZXJ5IGRlY2xhcmVkIHJlc291cmNlIChvbiBieVxuICAgKiBkZWZhdWx0OiBsb2NhbCBjcmVhdGVzIGFuZCB1cGRhdGVzIHF1ZXVlIHBlbmRpbmcgc3luYyByb3dzIG9uY2UgdGhlaXJcbiAgICogdHJhbnNhY3Rpb24gY29tbWl0cyBhbmQgc2NoZWR1bGUgYW4gaW1tZWRpYXRlIHJlcGxheSBhdHRlbXB0LCB3aXRob3V0XG4gICAqIGFwcC1zaWRlIHF1ZXVlIGNhbGxzKS4gYHRyYWNrOiBmYWxzZWAgcmVzb3VyY2VzIGFyZSBza2lwcGVkOyBgdHJhY2s6IHRydWVgXG4gICAqIGFkZHMgZGVzdHJveXM7IGFuIG9wZXJhdGlvbnMgbGlzdCBuYXJyb3dzIHRoZSB0cmFja2VkIG9wZXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgYXdhaXQgdGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvblByb21pc2VcbiAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICBpZiAodGhpcy5fc3RhcnRlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydGVkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgY29uc3Qgb3BlcmF0aW9ucyA9IHRoaXMudHJhY2tlZE9wZXJhdGlvbnMoe3Jlc291cmNlQ29uZmlnLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgICBpZiAocmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IFwiY3JlYXRlXCIpKSB7XG4gICAgICAgICAgY29uc3QgY2FsbGJhY2tOYW1lID0gb3BlcmF0aW9uID09PSBcImRlc3Ryb3lcIiA/IFwiYmVmb3JlRGVzdHJveVwiIDogXCJiZWZvcmVVcGRhdGVcIlxuICAgICAgICAgIGNvbnN0IGNhbGxiYWNrID0gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIHJlY29yZCkgPT4ge1xuICAgICAgICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICAgICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgICAgICAgY29uc3QgY2FwdHVyZWRWZXJzaW9ucyA9IHRoaXMuX2NhcHR1cmVkQmFzZVZlcnNpb25zLmdldChyZWNvcmQpIHx8IFtdXG5cbiAgICAgICAgICAgIGNhcHR1cmVkVmVyc2lvbnMucHVzaCh0aGlzLnByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pKVxuICAgICAgICAgICAgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuc2V0KHJlY29yZCwgY2FwdHVyZWRWZXJzaW9ucylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzW2NhbGxiYWNrTmFtZV0oY2FsbGJhY2spXG4gICAgICAgICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrTmFtZSA9IFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVNbb3BlcmF0aW9uXVxuICAgICAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMudHJhY2tlZE11dGF0aW9uQ2FsbGJhY2soe29wZXJhdGlvbiwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgICAgIHJlc291cmNlQ29uZmlnLm1vZGVsQ2xhc3NbY2FsbGJhY2tOYW1lXShjYWxsYmFjaylcbiAgICAgICAgdGhpcy5fdHJhY2tlZENhbGxiYWNrcy5wdXNoKHtjYWxsYmFjaywgY2FsbGJhY2tOYW1lLCBtb2RlbENsYXNzOiByZXNvdXJjZUNvbmZpZy5tb2RlbENsYXNzfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYWxsIHRyYWNraW5nIGNhbGxiYWNrcywgYWJvcnRzIGluLWZsaWdodCBwdWxsL3JlcGxheS9yZWFsdGltZVxuICAgKiB3b3JrIGFuZCByZXNvbHZlcyBhZnRlciBpdCBpcyBxdWllc2NlbnQuIE9wdGlvbmFsIHNlbGVjdGVkIHNjb3BlIHJlc2V0IGFuZFxuICAgKiBhcHAtb3duZWQgY2xlYW51cCBoYXBwZW4gYWZ0ZXIgb2xkIHdvcmsgZHJhaW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFN0b3BPcHRpb25zfSBbb3B0aW9uc10gLSBTdG9wIGFuZCBzZWxlY3RlZC1zY29wZSByZXNldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0b3Aob3B0aW9ucyA9IHt9KSB7XG4gICAgZm9yIChjb25zdCB7Y2FsbGJhY2ssIGNhbGxiYWNrTmFtZSwgbW9kZWxDbGFzc30gb2YgdGhpcy5fdHJhY2tlZENhbGxiYWNrcykge1xuICAgICAgbW9kZWxDbGFzcy51bnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICB0aGlzLl90cmFja2VkQ2FsbGJhY2tzID0gW11cbiAgICB0aGlzLl9zdGFydGVkID0gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLl9ydW5MaWZlY3ljbGVUcmFuc2l0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3Jlc2V0U2NvcGVzRm9yTGlmZWN5Y2xlKG9wdGlvbnMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBYm9ydHMgYW5kIGRyYWlucyBjdXJyZW50IHdvcmssIHRoZW4gYXRvbWljYWxseSByZXNldHMgc2VsZWN0ZWQgc2NvcGVcbiAgICogY3Vyc29ycyB0b2dldGhlciB3aXRoIGFuIG9wdGlvbmFsIGFwcC1vd25lZCBsb2NhbC1yb3cgY2xlYW51cCBob29rLlxuICAgKiBUcmFja2luZyBkZWNsYXJhdGlvbnMgcmVtYWluIHJlZ2lzdGVyZWQgc28gdGhlIHNhbWUgY2xpZW50IG1heSBjb250aW51ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGVbXX0gc2NvcGVzIC0gU2VsZWN0ZWQgc2NvcGVzIHRvIHJlc2V0LlxuICAgKiBAcGFyYW0ge3tjbGVhbnVwPzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U2NvcGVDbGVhbnVwfX0gW29wdGlvbnNdIC0gU2NvcGUgY2xlYW51cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlc2V0U2NvcGVzKHNjb3Blcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZSh7Li4ub3B0aW9ucywgcmVzZXRTY29wZXM6IHNjb3Blc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlcGxhY2VzIHRoZSBleHRlcm5hbCBpZGVudGl0eSByZWFkIGJ5IHRoZSBjb25maWd1cmVkIGF1dGggYW5kXG4gICAqIHNjb3BlLW93bmVyIHJlc29sdmVyczogb2xkIHdvcmsgaXMgYWJvcnRlZCBhbmQgZHJhaW5lZCwgc2VsZWN0ZWQgcHJpdmF0ZVxuICAgKiBzY29wZSBzdGF0ZS9jYWNoZSBpcyByZXNldCwgdGhlbiB0aGUgYXBwJ3MgcmVwbGFjZW1lbnQgY2FsbGJhY2sgcnVucyB3aGlsZVxuICAgKiBuZXcgc3luYyB3b3JrIHJlbWFpbnMgYmVoaW5kIHRoZSBsaWZlY3ljbGUgYmFycmllci4gT3B0aW9uYWxseSBzdWJzY3JpYmVzXG4gICAqIHRoZSBuZXcgdXNlciBzY29wZSBiZWZvcmUgcmVzb2x2aW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlcGxhY2VJZGVudGl0eU9wdGlvbnN9IG9wdGlvbnMgLSBJZGVudGl0eSByZXBsYWNlbWVudCBjb250cmFjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBsYWNlSWRlbnRpdHkob3B0aW9ucykge1xuICAgIGlmICghb3B0aW9ucyB8fCB0eXBlb2Ygb3B0aW9ucyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50LnJlcGxhY2VJZGVudGl0eSByZXF1aXJlcyBhbiBvcHRpb25zIG9iamVjdFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtjbGVhbnVwLCByZXBsYWNlLCByZXNldFNjb3BlcyA9IFtdLCBzdWJzY3JpYmVVc2VyU2NvcGUgPSBmYWxzZSwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0T3B0aW9ucylcbiAgICBpZiAodHlwZW9mIHJlcGxhY2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudC5yZXBsYWNlSWRlbnRpdHkgcmVxdWlyZXMgYSByZXBsYWNlIGNhbGxiYWNrXCIpXG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpYmVVc2VyU2NvcGUgIT09IFwiYm9vbGVhblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50LnJlcGxhY2VJZGVudGl0eSBzdWJzY3JpYmVVc2VyU2NvcGUgbXVzdCBiZSBib29sZWFuXCIpXG5cbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVUcmFuc2l0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3Jlc2V0U2NvcGVzRm9yTGlmZWN5Y2xlKHtjbGVhbnVwLCByZXNldFNjb3Blc30pXG4gICAgICBhd2FpdCByZXBsYWNlKClcbiAgICB9KVxuXG4gICAgaWYgKHN1YnNjcmliZVVzZXJTY29wZSkgYXdhaXQgdGhpcy5zdWJzY3JpYmVVc2VyU2NvcGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGNhbGxiYWNrIHdoaWxlIGhvbGRpbmcgdGhlIGN1cnJlbnQgbGlmZWN5Y2xlIGdlbmVyYXRpb24gYW5kXG4gICAqIHRyYWNrcyBpdCBzbyBzdG9wL3Jlc2V0L2lkZW50aXR5IHJlcGxhY2VtZW50IGNhbiBhd2FpdCBxdWllc2NlbmNlLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7KHNpZ25hbDogQWJvcnRTaWduYWwpID0+IFByb21pc2U8UmVzdWx0Pn0gY2FsbGJhY2sgLSBHZW5lcmF0aW9uLWJvdW5kIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5MaWZlY3ljbGVXb3JrKGNhbGxiYWNrKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCA+IDApIGF3YWl0IHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Qcm9taXNlXG5cbiAgICBjb25zdCBzaWduYWwgPSB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXIuc2lnbmFsXG5cbiAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICBjb25zdCBwcm9taXNlID0gY2FsbGJhY2soc2lnbmFsKVxuXG4gICAgdGhpcy5fYWN0aXZlTGlmZWN5Y2xlV29yay5hZGQocHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9hY3RpdmVMaWZlY3ljbGVXb3JrLmRlbGV0ZShwcm9taXNlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG11dGF0aW9uIHF1ZXVlaW5nIG9ubHkgd2hpbGUgdGhlIGxpZmVjeWNsZSBnZW5lcmF0aW9uIGNhcHR1cmVkIGJ5IHRoZVxuICAgKiBjYWxsZXIgcmVtYWlucyBhY3RpdmUuIFVubGlrZSBwdWxscywgYSBtdXRhdGlvbiBtdXN0IG5ldmVyIHdhaXQgdGhyb3VnaCBhblxuICAgKiBpZGVudGl0eSB0cmFuc2l0aW9uIGFuZCB0aGVuIHBlcnNpc3QgdW5kZXIgdGhlIHJlcGxhY2VtZW50IGlkZW50aXR5LlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsaWZlY3ljbGVHZW5lcmF0aW9uIC0gR2VuZXJhdGlvbiBvd25pbmcgdGhlIG11dGF0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmVzdWx0Pn0gY2FsbGJhY2sgLSBNdXRhdGlvbiBxdWV1ZWluZyB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuTXV0YXRpb25MaWZlY3ljbGVXb3JrKGxpZmVjeWNsZUdlbmVyYXRpb24sIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fYXNzZXJ0TXV0YXRpb25MaWZlY3ljbGVHZW5lcmF0aW9uKGxpZmVjeWNsZUdlbmVyYXRpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLl9hc3NlcnRNdXRhdGlvbkxpZmVjeWNsZUdlbmVyYXRpb24obGlmZWN5Y2xlR2VuZXJhdGlvbilcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgbXV0YXRpb24gcXVldWVpbmcgY2FwdHVyZWQgb3V0c2lkZSB0aGUgY3VycmVudCBzdGFibGUgbGlmZWN5Y2xlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbGlmZWN5Y2xlR2VuZXJhdGlvbiAtIEdlbmVyYXRpb24gb3duaW5nIHRoZSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXNzZXJ0TXV0YXRpb25MaWZlY3ljbGVHZW5lcmF0aW9uKGxpZmVjeWNsZUdlbmVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlVHJhbnNpdGlvbkNvdW50ID09PSAwICYmIGxpZmVjeWNsZUdlbmVyYXRpb24gPT09IHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb24pIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBtdXRhdGlvbiBiZWxvbmdzIHRvIGFuIGluYWN0aXZlIGxpZmVjeWNsZSBnZW5lcmF0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBhIGxpZmVjeWNsZSBiYXJyaWVyOiBjb29wZXJhdGl2ZWx5IGFib3J0cyB0cmFuc3BvcnQvc3RhcnQgd29yayxcbiAgICogc3RvcHMgbmV3IHJlYWx0aW1lIGRlbGl2ZXJ5LCBhd2FpdHMgb2xkIGFwcGxpZXMvcmVwbGF5cy9wdWxscywgcmVqZWN0cyBvblxuICAgKiB1bmV4cGVjdGVkIG9sZC13b3JrIGZhaWx1cmVzLCB0aGVuIHJ1bnMgdGhlIHJlc2V0L3JlcGxhY2VtZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gVHJhbnNpdGlvbiBhY3Rpb24gYWZ0ZXIgcXVpZXNjZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBfcnVuTGlmZWN5Y2xlVHJhbnNpdGlvbihjYWxsYmFjaykge1xuICAgIHRoaXMuX2xpZmVjeWNsZVRyYW5zaXRpb25Db3VudCArPSAxXG5cbiAgICAvLyB1bnN1YnNjcmliZSgpIGludmFsaWRhdGVzIHRoZSBzdWJzY3JpcHRpb24gZ2VuZXJhdGlvbiBzeW5jaHJvbm91c2x5LCBzb1xuICAgIC8vIGFuIG9sZCBvblJlc3VtZS9vbk1lc3NhZ2UgY2FsbGJhY2sgY2Fubm90IGVudGVyIHRoaXMgdHJhbnNpdGlvbidzIGRyYWluLlxuICAgIGNvbnN0IHJlYWx0aW1lVW5zdWJzY3JpYmVQcm9taXNlID0gdGhpcy5fcmVhbHRpbWVCcmlkZ2U/LnVuc3Vic2NyaWJlKClcbiAgICBjb25zdCBwcmV2aW91c1RyYW5zaXRpb24gPSB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZVxuICAgIGNvbnN0IHRyYW5zaXRpb24gPSBwcmV2aW91c1RyYW5zaXRpb24udGhlbihhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhYm9ydENvbnRyb2xsZXIgPSB0aGlzLl9saWZlY3ljbGVBYm9ydENvbnRyb2xsZXJcbiAgICAgIGNvbnN0IGFib3J0UmVhc29uID0gbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjbGllbnQgbGlmZWN5Y2xlIHdhcyBzdG9wcGVkXCIpXG5cbiAgICAgIGFib3J0Q29udHJvbGxlci5hYm9ydChhYm9ydFJlYXNvbilcblxuICAgICAgaWYgKHJlYWx0aW1lVW5zdWJzY3JpYmVQcm9taXNlKSBhd2FpdCByZWFsdGltZVVuc3Vic2NyaWJlUHJvbWlzZVxuXG4gICAgICBjb25zdCB3b3JrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4udGhpcy5fYWN0aXZlTGlmZWN5Y2xlV29ya10pXG5cbiAgICAgIGlmICh0aGlzLl9yZWFsdGltZUJyaWRnZSkgYXdhaXQgdGhpcy5fcmVhbHRpbWVCcmlkZ2Uud2FpdEZvckFwcGxpZWQoKVxuXG4gICAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICAgIGNvbnN0IHVuZXhwZWN0ZWRFcnJvcnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiB3b3JrUmVzdWx0cykge1xuICAgICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiICYmICF0aGlzLmlzTGlmZWN5Y2xlQWJvcnQocmVzdWx0LnJlYXNvbikpIHVuZXhwZWN0ZWRFcnJvcnMucHVzaChyZXN1bHQucmVhc29uKVxuICAgICAgfVxuXG4gICAgICBpZiAodW5leHBlY3RlZEVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IHVuZXhwZWN0ZWRFcnJvcnNbMF1cbiAgICAgIGlmICh1bmV4cGVjdGVkRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcih1bmV4cGVjdGVkRXJyb3JzLCBcIlN5bmMgY2xpZW50IGxpZmVjeWNsZSBmYWlsZWQgd2hpbGUgYmVjb21pbmcgcXVpZXNjZW50XCIpXG5cbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuX2xpZmVjeWNsZUFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgICAgdGhpcy5fbGlmZWN5Y2xlR2VuZXJhdGlvbiArPSAxXG4gICAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uQ291bnQgLT0gMVxuICAgICAgdGhpcy5fdXNlclNjb3BlU3RhdGUgPSBcInVuc3Vic2NyaWJlZFwiXG4gICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgIH0pXG5cbiAgICB0aGlzLl9saWZlY3ljbGVUcmFuc2l0aW9uUHJvbWlzZSA9IHRyYW5zaXRpb24udGhlbigoKSA9PiB1bmRlZmluZWQsICgpID0+IHVuZGVmaW5lZClcblxuICAgIHJldHVybiB0cmFuc2l0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVzZXRzIHNlbGVjdGVkIHNjb3BlcyB0aHJvdWdoIHRoZSBmcmFtZXdvcmstb3duZWQgc3RvcmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50U3RvcE9wdGlvbnN9IG9wdGlvbnMgLSBSZXNldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXNldFNjb3Blc0ZvckxpZmVjeWNsZShvcHRpb25zKSB7XG4gICAgY29uc3Qge2NsZWFudXAsIHJlc2V0U2NvcGVzID0gW10sIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdE9wdGlvbnMpXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc2V0U2NvcGVzKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjbGllbnQgcmVzZXRTY29wZXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgIGlmIChjbGVhbnVwICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNsZWFudXAgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjbGllbnQgY2xlYW51cCBtdXN0IGJlIGEgZnVuY3Rpb25cIilcbiAgICBpZiAoY2xlYW51cCAmJiByZXNldFNjb3Blcy5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2xpZW50IGNsZWFudXAgcmVxdWlyZXMgYXQgbGVhc3Qgb25lIHJlc2V0IHNjb3BlXCIpXG4gICAgaWYgKHJlc2V0U2NvcGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5yZXNldChyZXNldFNjb3Blcywge2NsZWFudXB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gZXJyb3IgaXMgdGhlIGZyYW1ld29yaydzIG5hcnJvdyBleHBlY3RlZCBsaWZlY3ljbGUgYWJvcnQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYW5kaWRhdGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhbiBleHBlY3RlZCBsaWZlY3ljbGUgYWJvcnQuXG4gICAqL1xuICBpc0xpZmVjeWNsZUFib3J0KGVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgU3luY0NsaWVudExpZmVjeWNsZUFib3J0RXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBUaHJvd3MgdGhlIGN1cnJlbnQgbGlmZWN5Y2xlIHJlYXNvbiB3aGVuIHRoZSBzaWduYWwgaXMgYWJvcnRlZC5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIHNpZ25hbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKSB7XG4gICAgaWYgKCFzaWduYWwuYWJvcnRlZCkgcmV0dXJuXG5cbiAgICB0aHJvdyBzaWduYWwucmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyBzaWduYWwucmVhc29uIDogbmV3IFN5bmNDbGllbnRMaWZlY3ljbGVBYm9ydEVycm9yKFwiU3luYyBjbGllbnQgbGlmZWN5Y2xlIHdhcyBzdG9wcGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW5kIHZhbGlkYXRlcyB0aGUgdHJhY2tlZCBvcGVyYXRpb25zIGZvciBhIHJlc291cmNlIGNvbmZpZy5cbiAgICogVHJhY2tpbmcgaXMgb24gYnkgZGVmYXVsdDogbW9kZWxzIGRlY2xhcmluZyBgc3RhdGljIHN5bmNgIHdpdGhvdXQgYSBgdHJhY2tgXG4gICAqIGtleSBxdWV1ZSBsb2NhbCBjcmVhdGVzIGFuZCB1cGRhdGVzIGF1dG9tYXRpY2FsbHk7IGB0cmFjazogZmFsc2VgIG9wdHMgYVxuICAgKiBtb2RlbCBvdXQgKGZvciBtb2RlbHMgd3JpdHRlbiBieSBub24tdXNlciBmbG93cykuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUmVzb3VyY2UgY29uZmlnIGFuZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIj59IFRyYWNrZWQgb3BlcmF0aW9ucy5cbiAgICovXG4gIHRyYWNrZWRPcGVyYXRpb25zKHtyZXNvdXJjZUNvbmZpZywgcmVzb3VyY2VUeXBlfSkge1xuICAgIGNvbnN0IHRyYWNrID0gcmVzb3VyY2VDb25maWcudHJhY2tcblxuICAgIGlmICh0cmFjayA9PT0gZmFsc2UpIHJldHVybiBbXVxuICAgIGlmICh0cmFjayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gREVGQVVMVF9UUkFDS0VEX09QRVJBVElPTlNcbiAgICBpZiAodHJhY2sgPT09IHRydWUpIHJldHVybiBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdXG5cbiAgICBpZiAoIXRyYWNrIHx8IHR5cGVvZiB0cmFjayAhPT0gXCJvYmplY3RcIiB8fCAhQXJyYXkuaXNBcnJheSh0cmFjay5vcGVyYXRpb25zKSB8fCB0cmFjay5vcGVyYXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jQ2xpZW50IHJlc291cmNlICR7cmVzb3VyY2VUeXBlfSB0cmFjayBtdXN0IGJlIHRydWUgb3Ige29wZXJhdGlvbnM6IFsuLi5dfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgdHJhY2sub3BlcmF0aW9ucykge1xuICAgICAgaWYgKCEob3BlcmF0aW9uIGluIFRSQUNLRURfQ0FMTEJBQ0tfTkFNRVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY0NsaWVudCByZXNvdXJjZSAke3Jlc291cmNlVHlwZX0gdHJhY2sub3BlcmF0aW9ucyBtdXN0IGJlIGNyZWF0ZS91cGRhdGUvZGVzdHJveSwgZ290OiAke1N0cmluZyhvcGVyYXRpb24pfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYWNrLm9wZXJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxpZmVjeWNsZSBjYWxsYmFjayBxdWV1ZWluZyBvbmUgdHJhY2tlZCBtdXRhdGlvbi4gVGhlIHF1ZXVlZFxuICAgKiBwYXlsb2FkIGFuZCBzeW5jIHR5cGUgYXJlIHNuYXBzaG90dGVkIGF0IG11dGF0aW9uLWNhbGxiYWNrIHRpbWUsIHNvXG4gICAqIGFmdGVyU2F2ZSBob29rcyBhc3NpZ25pbmcgdW5zYXZlZCBhdHRyaWJ1dGVzIChvciBhbnkgbGF0ZXIgZHJpZnQgb24gdGhlXG4gICAqIHJlY29yZCkgY2Fubm90IGNoYW5nZSB3aGF0IGdldHMgcXVldWVkIHZzIHdoYXQgd2FzIGNvbW1pdHRlZC4gUXVldWVpbmcgaXNcbiAgICogZGVmZXJyZWQgdGhyb3VnaCB0aGUgbW9kZWwgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gaXQgb25seSBydW5zXG4gICAqIG9uY2UgdGhlIG11dGF0aW9uJ3MgdHJhbnNhY3Rpb24gaGFzIGNvbW1pdHRlZCAoaW1tZWRpYXRlbHkgd2hlbiBub1xuICAgKiB0cmFuc2FjdGlvbiBpcyBvcGVuKSAtIHF1ZXVlZCBzeW5jcyBuZXZlciByZWZlcmVuY2Ugcm9sbGVkLWJhY2sgcm93cy5cbiAgICogUG9zdC1jb21taXQgcXVldWUgZmFpbHVyZXMgYXJlIHJlcG9ydGVkIHdpdGhvdXQgcmV0aHJvd2luZyBpbnRvIHRoZVxuICAgKiBkcml2ZXIncyBhZnRlckNvbW1pdCBjaGFpbiAoc2VlIHJlcG9ydEFmdGVyQ29tbWl0RXJyb3IpLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBPcGVyYXRpb24gYW5kIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMgeyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBQcm9taXNlPHZvaWQ+fSBMaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqL1xuICB0cmFja2VkTXV0YXRpb25DYWxsYmFjayh7b3BlcmF0aW9uLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICByZXR1cm4gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLm93bnNSZWNvcmQocmVjb3JkKSkgcmV0dXJuXG4gICAgICBpZiAodGhpcy5pc1RyYWNraW5nU3VwcHJlc3NlZChyZWNvcmQpKSByZXR1cm5cblxuICAgICAgY29uc3QgbGlmZWN5Y2xlR2VuZXJhdGlvbiA9IHRoaXMuX2xpZmVjeWNsZUdlbmVyYXRpb25cbiAgICAgIGNvbnN0IGRhdGEgPSBTeW5jQXBpQ2xpZW50LnF1ZXVlZFN5bmNEYXRhKHtcbiAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICBkYXRhOiByZXNvdXJjZUNvbmZpZy50cmFja2VkRGF0YSA/IHJlc291cmNlQ29uZmlnLnRyYWNrZWREYXRhKHtvcGVyYXRpb24sIHJlY29yZH0pIDogdW5kZWZpbmVkLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICByZXNvdXJjZTogcmVjb3JkXG4gICAgICB9KVxuICAgICAgY29uc3Qgc3luY1R5cGUgPSB0aGlzLmRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgICAgIGNvbnN0IGJhc2VWZXJzaW9uID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZ1xuICAgICAgICA/IHRoaXMuY2FwdHVyZWRCYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgICAgICAgOiBudWxsXG4gICAgICBjb25zdCBkYXRhYmFzZU9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG4gICAgICBjb25zdCBvcGVyYXRpb25TY29wZSA9IGRhdGFiYXNlT3BlcmF0aW9uXG4gICAgICAgID8gZGF0YWJhc2VPcGVyYXRpb24uZm9yTW9kZWwodGhpcy5jb25maWcuc3luY01vZGVsKVxuICAgICAgICA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbFxuXG4gICAgICBhd2FpdCByZWNvcmQuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5NdXRhdGlvbkxpZmVjeWNsZVdvcmsobGlmZWN5Y2xlR2VuZXJhdGlvbiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIHtcbiAgICAgICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUNvbmZsaWN0VHJhY2tlZFN5bmMoe1xuICAgICAgICAgICAgICAgIGJhc2VWZXJzaW9uLFxuICAgICAgICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2U6IHJlY29yZCxcbiAgICAgICAgICAgICAgICByZXNvdXJjZVR5cGU6IHJlY29yZC5jb25zdHJ1Y3Rvci5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICAgICAgICBzeW5jVHlwZVxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgYXdhaXQgU3luY0FwaUNsaWVudC5xdWV1ZUxvY2FsU3luYyh7ZGF0YSwgcmVzb3VyY2U6IHJlY29yZCwgc3luY01vZGVsOiBvcGVyYXRpb25TY29wZSwgc3luY1R5cGV9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgaWYgKHRoaXMuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikpIHJldHVyblxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5yZXBvcnRBZnRlckNvbW1pdEVycm9yKC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcikpXG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhIHBvc3QtY29tbWl0IHRyYWNrZWQtcXVldWVpbmcgZmFpbHVyZS4gVGhlIHRyYW5zYWN0aW9uIGhhcyBhbHJlYWR5XG4gICAqIGNvbW1pdHRlZCB3aGVuIGFmdGVyQ29tbWl0IGNhbGxiYWNrcyBydW4sIHNvIHJldGhyb3dpbmcgaGVyZSB3b3VsZCBwb2lzb25cbiAgICogdGhlIGRyaXZlcidzIGF3YWl0ZWQgYWZ0ZXJDb21taXQgY2hhaW4gKGJyZWFraW5nIHVucmVsYXRlZCBjYWxsYmFja3MpIC1cbiAgICogaW5zdGVhZCB0aGUgZmFpbHVyZSBnb2VzIHRvIHRoZSBjb25maWd1cmVkIHN5bmMuY2xpZW50Lm9uRXJyb3IgaG9vaywgb3IgaXNcbiAgICogbG9nZ2VkIGxvdWRseSB0aHJvdWdoIHRoZSBjbGllbnQncyBsb2dnZXIgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gUG9zdC1jb21taXQgcXVldWVpbmcgZmFpbHVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZXBvcnRBZnRlckNvbW1pdEVycm9yKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLm9uRXJyb3IpIHtcbiAgICAgIHRoaXMuY29uZmlnLm9uRXJyb3IoZXJyb3IpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyKCkuZXJyb3IoXCJTeW5jQ2xpZW50IGZhaWxlZCB0byBxdWV1ZSBhIHRyYWNrZWQgbXV0YXRpb24gYWZ0ZXIgY29tbWl0XCIsIGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxhemlseSBidWlsdCBjbGllbnQgbG9nZ2VyLlxuICAgKiBAcmV0dXJucyB7TG9nZ2VyIHwge2Vycm9yOiAoLi4ubWVzc2FnZXM6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTx2b2lkPn19IENsaWVudCBsb2dnZXIuXG4gICAqL1xuICBsb2dnZXIoKSB7XG4gICAgdGhpcy5fbG9nZ2VyIHx8PSBuZXcgTG9nZ2VyKFwiU3luY0NsaWVudFwiLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gdGhpcy5fbG9nZ2VyXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIHJlY29yZCBpcyBjdXJyZW50bHkgYmVpbmcgd3JpdHRlbiBieSBwdWxsLWFwcGx5IChlY2hvIHN1cHByZXNzaW9uKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmVjb3JkIHdyaXRlIG9yaWdpbmF0ZXMgZnJvbSBhIHJlbW90ZSBjaGFuZ2UuXG4gICAqL1xuICBpc1JlbW90ZUFwcGx5KHJlY29yZCkge1xuICAgIHJldHVybiB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMuaGFzKHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRyYWNrZWQgbXV0YXRpb24gcXVldWVpbmcgaXMgY3VycmVudGx5IHN1cHByZXNzZWQgZm9yIGEgcmVjb3JkOlxuICAgKiBlaXRoZXIgdGhlIHJlY29yZCB3YXMgbWFya2VkIGFzIGEgcmVtb3RlIGFwcGx5IChgbWFya1JlbW90ZUFwcGx5YCwgdXNlZCBieVxuICAgKiBwdWxsIGFuZCByZWFsdGltZSBhcHBsaWVzKSBvciBhIGB3aXRob3V0VHJhY2tpbmdgIGNhbGxiYWNrIGlzIHJ1bm5pbmcgb25cbiAgICogdGhpcyBjbGllbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdHJhY2tlZCBxdWV1ZWluZyBpcyBzdXBwcmVzc2VkIGZvciB0aGUgcmVjb3JkLlxuICAgKi9cbiAgaXNUcmFja2luZ1N1cHByZXNzZWQocmVjb3JkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoID4gMCB8fCB0aGlzLmlzUmVtb3RlQXBwbHkocmVjb3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRoIHRyYWNrZWQgbXV0YXRpb24gcXVldWVpbmcgc3VwcHJlc3NlZCBvbiB0aGlzIGNsaWVudCAtXG4gICAqIGZvciBjb2RlIGFwcGx5aW5nIHNlcnZlci1vcmlnaW5hdGVkIGRhdGEgb3V0c2lkZSB0aGUgZGVyaXZlZCBwdWxsL3JlYWx0aW1lXG4gICAqIGFwcGxpZXJzIChsZWdhY3kgcHVsbCBwYXRocywgaW1wb3J0ZXJzLCBzaWduLWluIGJhY2tmaWxscyksIHNvIHRoZWlyIHdyaXRlc1xuICAgKiBhcmUgbm90IGVjaG9lZCBiYWNrIHRvIHRoZSBzZXJ2ZXIgYXMgZGV2aWNlIGNoYW5nZXMuIFN1cHByZXNzaW9uIGNvdmVycyB0aGVcbiAgICogd2hvbGUgYXN5bmMgZHVyYXRpb24gb2YgdGhlIGNhbGxiYWNrIChuZXN0ZWQgY2FsbHMgc3RhY2spIGFuZCBpc1xuICAgKiBjbGllbnQtd2lkZSB3aGlsZSBpdCBydW5zOiBtdXRhdGlvbnMgZnJvbSBjb25jdXJyZW50bHkgcnVubmluZyB0YXNrcyBhcmVcbiAgICogYWxzbyBzdXBwcmVzc2VkIGZvciB0aGF0IHdpbmRvdywgc28gcHJlZmVyIGBtYXJrUmVtb3RlQXBwbHkocmVjb3JkKWAgd2hlblxuICAgKiB3cml0ZXMgZnJvbSBvdGhlciBmbG93cyBjYW4gaW50ZXJsZWF2ZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+IHwgVH0gY2FsbGJhY2sgLSBXb3JrIHdob3NlIG1vZGVsIHdyaXRlcyBzaG91bGQgbm90IHF1ZXVlIHRyYWNrZWQgc3luY3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBUaGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aG91dFRyYWNraW5nKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fd2l0aG91dFRyYWNraW5nRGVwdGgrK1xuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3dpdGhvdXRUcmFja2luZ0RlcHRoLS1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFya3Mgb25lIHJlY29yZCBhcyBiZWluZyB3cml0dGVuIGZyb20gc2VydmVyLW9yaWdpbmF0ZWQgZGF0YSBzbyB0cmFja2VkXG4gICAqIG11dGF0aW9uIHF1ZXVlaW5nIHNraXBzIGl0IChyZWNvcmQtcHJlY2lzZSBzdXBwcmVzc2lvbikuIFRoZSBkZXJpdmVkIHB1bGxcbiAgICogYW5kIHJlYWx0aW1lIGFwcGxpZXJzIHVzZSB0aGlzIGludGVybmFsbHkgYXJvdW5kIGV2ZXJ5IGFwcGxpZWQgd3JpdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIExvY2FsIG1vZGVsIHJlY29yZCBhYm91dCB0byBiZSB3cml0dGVuLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gUmVsZWFzZSBjYWxsYmFjayByZS1lbmFibGluZyB0cmFja2luZyBmb3IgdGhlIHJlY29yZC5cbiAgICovXG4gIG1hcmtSZW1vdGVBcHBseShyZWNvcmQpIHtcbiAgICB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMuYWRkKHJlY29yZClcblxuICAgIHJldHVybiAoKSA9PiB0aGlzLl9yZW1vdGVBcHBseVJlY29yZHMuZGVsZXRlKHJlY29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhpcyBjbGllbnQgYXMgdGhlIGFwcCdzIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0Q3VycmVudCgpIHtcbiAgICBzZXRDdXJyZW50U3luY0NsaWVudCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaGVzIHRoZSBvbmUgcmV1c2FibGUgY29vcmRpbmF0b3IgdGhhdCBvd25zIG11dGF0aW9uIGFuZCByZWNvbm5lY3RcbiAgICogY3ljbGVzIGZvciB0aGlzIGNsaWVudC4gVGhlIHJldHVybmVkIGRldGFjaCBvbmx5IHJlbW92ZXMgdGhlIHNhbWUgb3duZXIuXG4gICAqIEBwYXJhbSB7KHJlYXNvbjogXCJtdXRhdGlvblwiIHwgXCJyZWFsdGltZVwiKSA9PiBQcm9taXNlPHZvaWQ+fSB0cmlnZ2VyIC0gQ29vcmRpbmF0b3IgdHJpZ2dlci5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IElkZW1wb3RlbnQgZGV0YWNoIGNhbGxiYWNrLlxuICAgKi9cbiAgYXR0YWNoQ29vcmRpbmF0b3IodHJpZ2dlcikge1xuICAgIGlmICh0eXBlb2YgdHJpZ2dlciAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IGNvb3JkaW5hdG9yIHRyaWdnZXIgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG4gICAgaWYgKHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlcikgdGhyb3cgbmV3IEVycm9yKFwiU3luY0NsaWVudCBhbHJlYWR5IGhhcyBhbiBhdHRhY2hlZCBjb29yZGluYXRvclwiKVxuXG4gICAgdGhpcy5fY29vcmRpbmF0b3JUcmlnZ2VyID0gdHJpZ2dlclxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9jb29yZGluYXRvclRyaWdnZXIgPT09IHRyaWdnZXIpIHRoaXMuX2Nvb3JkaW5hdG9yVHJpZ2dlciA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUm91dGVzIGZyYW1ld29yay1vd25lZCB3b3JrIHRocm91Z2ggdGhlIGF0dGFjaGVkIGNvb3JkaW5hdG9yLCBvciByZXR1cm5zXG4gICAqIG51bGwgc28gdGhlIGxlZ2FjeSBkaXJlY3Qgc2NoZWR1bGluZyBvd25lciBtYXkgcnVuLlxuICAgKiBAcGFyYW0ge1wibXV0YXRpb25cIiB8IFwicmVhbHRpbWVcIn0gcmVhc29uIC0gVHJpZ2dlciByZWFzb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gQ29vcmRpbmF0b3IgZmxpZ2h0LCBvciBudWxsIHdpdGhvdXQgYW4gb3duZXIuXG4gICAqL1xuICByZXF1ZXN0Q29vcmRpbmF0b3JTeW5jKHJlYXNvbikge1xuICAgIHJldHVybiB0aGlzLl9jb29yZGluYXRvclRyaWdnZXIgPyB0aGlzLl9jb29yZGluYXRvclRyaWdnZXIocmVhc29uKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhcHAncyBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gQ3VycmVudCBzeW5jIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1N5bmNDbGllbnR9ICovIChjdXJyZW50U3luY0NsaWVudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN5bmMgY2xpZW50IGRlcml2ZWQgZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbi4gQWxpYXMgZm9yXG4gICAqIGBuZXcgU3luY0NsaWVudCh7Y29uZmlndXJhdGlvbiwgLi4ub3B0aW9uc30pYC5cbiAgICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMgYW5kIHRoZSBzeW5jLmNsaWVudCBibG9jay4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudE9wdGlvbnMsIFwiY29uZmlndXJhdGlvblwiPn0gW29wdGlvbnNdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7U3luY0NsaWVudH0gU3luYyBjbGllbnQgZGVyaXZlZCBmcm9tIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jQ2xpZW50KHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyAob3IgcmUtYWN0aXZhdGVzKSBhIHN5bmMgc2NvcGUgZnJvbSBhIG1vZGVsIHF1ZXJ5IGFuZCBwdWxscyBpdCB3aGVuIG9ubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBRdWVyeSBkZWNsYXJpbmcgdGhlIHN5bmMgc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBTeW5jIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KHByb2dyZXNzOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUHVsbFByb2dyZXNzKSA9PiB2b2lkfSBbb3B0aW9ucy5vblByb2dyZXNzXSAtIENhbGxlZCBwZXIgYXBwbGllZCBwYWdlIG9mIHRoZSBwdWxsIHRoaXMgZGVjbGFyYXRpb24gdHJpZ2dlcnMsIHNvIHRoZSBpbml0aWFsIGltcG9ydCBvZiBhIG5ld2x5IGRlY2xhcmVkIHNjb3BlIGNhbiBkcml2ZSBhIFwic3luY2VkQ291bnQgb2YgdG90YWxcIiBwcm9ncmVzcyBiYXIuIFNlZSBgcHVsbCgpYC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy51cHN0cmVhbVJlZnJlc2hdIC0gTWFya3MgdGhlIGNoYW5nZXMgcmVxdWVzdChzKSBhcyBhIHVzZXItaW5pdGlhdGVkIHJlZnJlc2gsIHNvIHRoZSBzZXJ2ZXIgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cy4gU2VlIGBwdWxsKClgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c2NvcGU6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZSwgcHVsbGVkOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9Pn0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0IChudWxsIHdoaWxlIG9mZmxpbmUpLlxuICAgKi9cbiAgYXN5bmMgc3luYyhxdWVyeSwge29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpXG4gICAgY29uc3Qgc2NvcGUgPSBzZXJpYWxpemVkU2NvcGVGcm9tUXVlcnkocXVlcnkpXG4gICAgY29uc3Qgc2NvcGVTdG9yZSA9IHRoaXMuc2NvcGVTdG9yZSgpXG4gICAgY29uc3Qgc2NvcGVSb3cgPSBhd2FpdCBzY29wZVN0b3JlLmZpbmRPckNyZWF0ZVNjb3BlKHNjb3BlKVxuXG4gICAgaWYgKCFzY29wZVJvdy5jdXJzb3JQYXlsb2FkICYmIHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcikge1xuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yUGF5bG9hZCA9IGF3YWl0IHRoaXMuY29uZmlnLmxlZ2FjeUN1cnNvcih7c2NvcGV9KVxuICAgICAgY29uc3QgbGVnYWN5Q3Vyc29yID0gU3luY0FwaUNsaWVudC5zeW5jQ3Vyc29yRnJvbVBheWxvYWQobGVnYWN5Q3Vyc29yUGF5bG9hZClcblxuICAgICAgaWYgKGxlZ2FjeUN1cnNvcikgYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBsZWdhY3lDdXJzb3IpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwdWxsZWQ6IGF3YWl0IHRoaXMucHVsbCh7b25Qcm9ncmVzcywgdXBzdHJlYW1SZWZyZXNofSksIHNjb3BlfVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoZSBzeW5jIHNjb3BlIGRlY2xhcmVkIGJ5IGEgbW9kZWwgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gUXVlcnkgd2hvc2Ugc2NvcGUgc2hvdWxkIHN0b3Agc3luY2luZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN5bmMocXVlcnkpIHtcbiAgICB0aGlzLmFzc2VydFF1ZXJ5T3duZXJzaGlwKHF1ZXJ5KVxuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoc2VyaWFsaXplZFNjb3BlRnJvbVF1ZXJ5KHF1ZXJ5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWxscyBjaGFuZ2VzIGZvciBldmVyeSBhY3RpdmUgc2NvcGUgd2l0aCBwZXItc2NvcGUgY3Vyc29ycyAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gUHVsbCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW29wdGlvbnMub25Qcm9ncmVzc10gLSBDYWxsZWQgcGVyIGFwcGxpZWQgcGFnZSB3aXRoIGN1bXVsYXRpdmUgYHtwYWdlcywgc3luY2VkQ291bnQsIHRvdGFsfWAgYWNyb3NzIHRoZSBwdWxsZWQgc2NvcGVzLCBmb3IgcmVuZGVyaW5nIGEgXCJzeW5jZWRDb3VudCBvZiB0b3RhbFwiIHByb2dyZXNzIGJhciAoZS5nLiBhIGZ1bGwtaW1wb3J0IHNjcmVlbikuIE9wdGlvbmFsOyBvbWl0dGluZyBpdCBrZWVwcyB0aGUgZXhpc3RpbmcgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudXBzdHJlYW1SZWZyZXNoXSAtIFNlbmRzIGB1cHN0cmVhbVJlZnJlc2g6IHRydWVgIG9uIHRoZSBjaGFuZ2VzIHJlcXVlc3QocyksIHRlbGxpbmcgdGhlIHNlcnZlciB0aGlzIHB1bGwgaXMgdXNlci1pbml0aWF0ZWQgc28gaXQgY2FuIGJ5cGFzcyB1cHN0cmVhbS1pbXBvcnQgdGhyb3R0bGUgd2luZG93cyAoc2VlIGRvY3Mvc3luYy11cHN0cmVhbS1pbXBvcnRzLm1kKS4gQmFja2dyb3VuZCBwdWxscyBvbWl0IGl0IGFuZCBzdGF5IHRocm90dGxlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHQgfCBudWxsPn0gQ29tYmluZWQgcHVsbCByZXN1bHQsIG9yIG51bGwgd2hpbGUgb2ZmbGluZS5cbiAgICovXG4gIGFzeW5jIHB1bGwoe29uUHJvZ3Jlc3MsIHVwc3RyZWFtUmVmcmVzaH0gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVXb3JrKGFzeW5jIChzaWduYWwpID0+IGF3YWl0IHRoaXMuX3B1bGwoe29uUHJvZ3Jlc3MsIHNpZ25hbCwgdXBzdHJlYW1SZWZyZXNofSkpXG4gIH1cblxuICAvKipcbiAgICogUHVsbCBpbXBsZW1lbnRhdGlvbiBib3VuZCB0byBvbmUgbGlmZWN5Y2xlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gYXJncy5zaWduYWwgLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy51cHN0cmVhbVJlZnJlc2hdIC0gVXNlci1pbml0aWF0ZWQgdXBzdHJlYW0gcmVmcmVzaCBtYXJrZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0IHwgbnVsbD59IENvbWJpbmVkIHB1bGwgcmVzdWx0LCBvciBudWxsIHdoaWxlIG9mZmxpbmUuXG4gICAqL1xuICBhc3luYyBfcHVsbCh7b25Qcm9ncmVzcywgc2lnbmFsLCB1cHN0cmVhbVJlZnJlc2h9KSB7XG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVybiBudWxsXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9ICovXG4gICAgbGV0IGNvbWJpbmVkUmVzdWx0ID0gbnVsbFxuXG4gICAgYXdhaXQgU3luY0FwaUNsaWVudC5zaW5nbGVGbGlnaHQoYHZlbG9jaW91cy1zeW5jLWNsaWVudC1wdWxsLSR7dGhpcy5fY2xpZW50TnVtYmVyfWAsIGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IGF1dGhlbnRpY2F0aW9uVG9rZW4gPSBhd2FpdCB0aGlzLmNvbmZpZy5hdXRoZW50aWNhdGlvblRva2VuKClcbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHNjb3BlU3RvcmUgPSB0aGlzLnNjb3BlU3RvcmUoKVxuICAgICAgY29uc3QgYXBwbHlTeW5jID0gdGhpcy5yZW1vdGVBcHBseVN5bmMoKVxuICAgICAgY29uc3QgcmVzdWx0ID0ge1xuICAgICAgICBjaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgcGFnZXM6IDAsXG4gICAgICAgIHJlc291cmNlQ2hhbmdlZDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKHt9KSxcbiAgICAgICAgcmVzb3VyY2VDb3VudHM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KSxcbiAgICAgICAgc3luY2VkQ291bnQ6IDAsXG4gICAgICAgIHRvdGFsOiAwXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgc2NvcGVSb3cgb2YgYXdhaXQgc2NvcGVTdG9yZS5hY3RpdmVTY29wZXMoKSkge1xuICAgICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICAgIC8vIEN1bXVsYXRlIHNjb3BlIHByb2dyZXNzIG9udG8gdGhlIGNvdW50cyBvZiB0aGUgc2NvcGVzIGFscmVhZHkgcHVsbGVkIHNvIGEgc2luZ2xlXG4gICAgICAgIC8vIHNjb3BlJ3MgcGVyLXBhZ2UgcHJvZ3Jlc3MgcmVhZHMgZXhhY3RseSBpdHMgb3duIGNvdW50cyAoYmFzZSAwKSwgYW5kIG11bHRpLXNjb3BlXG4gICAgICAgIC8vIHB1bGxzIHJlcG9ydCBhIHJ1bm5pbmcgY3VtdWxhdGl2ZSB0b3RhbCBhY3Jvc3MgZXZlcnkgc2NvcGUuXG4gICAgICAgIGNvbnN0IGJhc2VQYWdlcyA9IHJlc3VsdC5wYWdlc1xuICAgICAgICBjb25zdCBiYXNlU3luY2VkQ291bnQgPSByZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgY29uc3QgYmFzZVRvdGFsID0gcmVzdWx0LnRvdGFsXG4gICAgICAgIGNvbnN0IHNjb3BlUmVzdWx0ID0gYXdhaXQgU3luY0FwaUNsaWVudC5wdWxsQ2hhbmdlcyh7XG4gICAgICAgICAgYXBwbHlTeW5jLFxuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgICAgbG9hZEN1cnNvcjogYXN5bmMgKCkgPT4gYXdhaXQgc2NvcGVTdG9yZS5sb2FkQ3Vyc29yKHNjb3BlUm93KSxcbiAgICAgICAgICBvblByb2dyZXNzOiBvblByb2dyZXNzID8gKHByb2dyZXNzKSA9PiBvblByb2dyZXNzKHtcbiAgICAgICAgICAgIHBhZ2VzOiBiYXNlUGFnZXMgKyBwcm9ncmVzcy5wYWdlcyxcbiAgICAgICAgICAgIHN5bmNlZENvdW50OiBiYXNlU3luY2VkQ291bnQgKyBwcm9ncmVzcy5zeW5jZWRDb3VudCxcbiAgICAgICAgICAgIHRvdGFsOiBiYXNlVG90YWwgKyBwcm9ncmVzcy50b3RhbFxuICAgICAgICAgIH0pIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHBvc3RDaGFuZ2VzOiBhc3luYyAocGF5bG9hZCwgb3B0aW9ucykgPT4gYXdhaXQgdGhpcy5jb25maWcucG9zdENoYW5nZXMoe1xuICAgICAgICAgICAgLi4ucGF5bG9hZCxcbiAgICAgICAgICAgIC8vIE9ubHkgdGhlIGFsbC10eXBlcyBzY29wZSBjYXJyaWVzIHRoZSB0eXBlIGxpc3Q7IGEgdHlwZS1kZWNsYXJlZCBzY29wZSBuZWVkcyBub25lLlxuICAgICAgICAgICAgc2NvcGU6IHtcbiAgICAgICAgICAgICAgY29uZGl0aW9uczogc2NvcGVSb3cuY29uZGl0aW9ucyxcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBzY29wZVJvdy5yZXNvdXJjZVR5cGUsXG4gICAgICAgICAgICAgIC4uLihzY29wZVJvdy5yZXNvdXJjZVR5cGUgPT09IG51bGwgPyB7cmVzb3VyY2VUeXBlczogdGhpcy51c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCl9IDoge30pXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLi4uKHVwc3RyZWFtUmVmcmVzaCA/IHt1cHN0cmVhbVJlZnJlc2g6IHRydWV9IDoge30pXG4gICAgICAgICAgfSwgb3B0aW9ucyksXG4gICAgICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgc2NvcGVTdG9yZS5zYXZlQ3Vyc29yKHNjb3BlUm93LCBjdXJzb3IpLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuXG4gICAgICAgIHJlc3VsdC5jaGFuZ2VkIHx8PSBzY29wZVJlc3VsdC5jaGFuZ2VkXG4gICAgICAgIHJlc3VsdC5wYWdlcyArPSBzY29wZVJlc3VsdC5wYWdlc1xuICAgICAgICByZXN1bHQuc3luY2VkQ291bnQgKz0gc2NvcGVSZXN1bHQuc3luY2VkQ291bnRcbiAgICAgICAgcmVzdWx0LnRvdGFsICs9IHNjb3BlUmVzdWx0LnRvdGFsXG5cbiAgICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCBjb3VudF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDb3VudHMpKSB7XG4gICAgICAgICAgcmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gPSAocmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyBjb3VudFxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwgY2hhbmdlZF0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGVSZXN1bHQucmVzb3VyY2VDaGFuZ2VkKSkge1xuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gY2hhbmdlZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbWJpbmVkUmVzdWx0ID0gcmVzdWx0XG4gICAgfSlcblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICByZXR1cm4gY29tYmluZWRSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGRlcml2ZWQgcmVtb3RlLWNoYW5nZSBhcHBsaWVyIHNoYXJlZCBieSBwdWxscyBhbmQgcmVhbHRpbWUgcHVzaGVzOlxuICAgKiBhcHBsaWVzIHRocm91Z2ggdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZ3MsIHJlZ2lzdGVycyBlYWNoIHdyaXR0ZW4gcmVjb3JkXG4gICAqIGZvciBlY2hvIHN1cHByZXNzaW9uICh0cmFja2VkIHJlc291cmNlcyBkbyBub3QgcmUtcXVldWUgYXBwbGllZCBjaGFuZ2VzKSwgYW5kXG4gICAqIGZhaWxzIGxvdWRseSBpbnN0ZWFkIG9mIHNpbGVudGx5IHNraXBwaW5nIHVuY29uZmlndXJlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7e3NvdXJjZT86IHN0cmluZ319IFthcmdzXSAtIEVycm9yIGNvbnRleHQgZGVzY3JpYmluZyB3aGVyZSB0aGUgY2hhbmdlIGNhbWUgZnJvbS5cbiAgICogQHJldHVybnMgeyhzeW5jOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlRW52ZWxvcGUpID0+IFByb21pc2U8aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUFwcGx5UmVzdWx0Pn0gTG91ZCByZW1vdGUtY2hhbmdlIGFwcGxpZXIuXG4gICAqL1xuICByZW1vdGVBcHBseVN5bmMoe3NvdXJjZSA9IFwicHVsbGVkIGNoYW5nZVwifSA9IHt9KSB7XG4gICAgcmV0dXJuIGFzeW5jIChzeW5jKSA9PiB7XG4gICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBzeW5jLnJlc291cmNlVHlwZSgpXG4gICAgICBjb25zdCBjb25maWd1cmVkUmVzb3VyY2UgPSByZXNvdXJjZVR5cGUgPyB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXSA6IHVuZGVmaW5lZFxuXG4gICAgICBpZiAoIXJlc291cmNlVHlwZSB8fCAhY29uZmlndXJlZFJlc291cmNlPy5hdHRyaWJ1dGVzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3luYyByZXNvdXJjZSB3aXRoIHB1bGwgYXR0cmlidXRlcyBjb25maWd1cmVkIGZvciAke3NvdXJjZX06ICR7U3RyaW5nKHJlc291cmNlVHlwZSl9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBzeW5jLmRhdGEoKVxuICAgICAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0uY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuXG4gICAgICAgIGlmICh2ZXJzaW9uQXR0cmlidXRlKSB7XG4gICAgICAgICAgY29uc3QgZGF0YUF0dHJpYnV0ZXMgPSBkYXRhICYmIHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGRhdGEpXG4gICAgICAgICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGF0YSlcbiAgICAgICAgICAgIDoge31cblxuICAgICAgICAgIHRoaXMubm90ZVJlbW90ZVZlcnNpb24oe3Jlc291cmNlSWQ6IFN0cmluZyhzeW5jLnJlc291cmNlSWQoKSksIHJlc291cmNlVHlwZSwgdmVyc2lvbjogZGF0YUF0dHJpYnV0ZXNbdmVyc2lvbkF0dHJpYnV0ZV19KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHVsbFJlc291cmNlQ29uZmlncyA9IHRoaXMucHVsbFJlc291cmNlQ29uZmlncyhvcGVyYXRpb24pXG4gICAgICAgIGNvbnN0IGFwcGxpZXIgPSBTeW5jQXBpQ2xpZW50LnJlc291cmNlQXBwbGllcihwdWxsUmVzb3VyY2VDb25maWdzLCAocmVjb3JkKSA9PiB7XG4gICAgICAgICAgaWYgKG9wZXJhdGlvbikgdGhpcy5iaW5kUmVtb3RlUmVjb3JkKHtvcGVyYXRpb24sIHJlY29yZH0pXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5tYXJrUmVtb3RlQXBwbHkocmVjb3JkKVxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiBhd2FpdCBhcHBsaWVyKHN5bmMpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2hhcmVkIGFwcC1saWZldGltZSB3ZWJzb2NrZXQgY29ubmVjdGlvbiBhbGwgc3luYyB0cmFmZmljXG4gICAqIHJpZGVzLCBvciBudWxsIHdoZW4gbm9uZSBpcyBjb25maWd1cmVkLiBCdWlsdCBvbmNlIGFuZCBtZW1vaXplZCAocGVyXG4gICAqIGNsaWVudCk6IGFuIGFwcC1wcm92aWRlZCBgc3luYy5jbGllbnQud2Vic29ja2V0Q2xpZW50YCBpbnN0YW5jZSB3aW5zICh0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IGNhbiBwYXNzIGl0cyBvd24gY2xpZW50IHNvIG9uZSBzb2NrZXQgY2Fycmllc1xuICAgKiBldmVyeXRoaW5nKSwgZWxzZSBhIGZyYW1ld29yay1vd25lZCByZWNvbm5lY3Rpbmcge0BsaW5rIFZlbG9jaW91c1dlYnNvY2tldENsaWVudH1cbiAgICogYnVpbHQgZnJvbSBgc3luYy5jbGllbnQud2Vic29ja2V0VXJsYC4gVGhlIHJlYWx0aW1lIGJyaWRnZSByaWRlcyB0aGlzXG4gICAqIGNvbm5lY3Rpb24gd2l0aG91dCBvd25pbmcgaXRzIGxpZmVjeWNsZTsgd2hlbiBuZWl0aGVyIGlzIGNvbmZpZ3VyZWQgdGhlXG4gICAqIGJyaWRnZSBmYWxscyBiYWNrIHRvIHRoZSBkZXByZWNhdGVkIHBlci1jeWNsZSBgcmVhbHRpbWUuY3JlYXRlQ2xpZW50YC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFNoYXJlZENvbm5lY3Rpb24gfCBudWxsfSBTaGFyZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24sIG9yIG51bGwuXG4gICAqL1xuICBzeW5jQ29ubmVjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fc3luY0Nvbm5lY3Rpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX3N5bmNDb25uZWN0aW9uXG5cbiAgICBpZiAodGhpcy5jb25maWcud2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHRoaXMuY29uZmlnLndlYnNvY2tldENsaWVudFxuICAgIH0gZWxzZSBpZiAodGhpcy5jb25maWcud2Vic29ja2V0VXJsKSB7XG4gICAgICBjb25zdCB1cmwgPSB0eXBlb2YgdGhpcy5jb25maWcud2Vic29ja2V0VXJsID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzLmNvbmZpZy53ZWJzb2NrZXRVcmwoKSA6IHRoaXMuY29uZmlnLndlYnNvY2tldFVybFxuXG4gICAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IHVybCA/IG5ldyBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQoe3VybH0pIDogbnVsbFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zeW5jQ29ubmVjdGlvbiA9IG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fc3luY0Nvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRoZSBkZXJpdmVkIHJlYWx0aW1lIGNoYW5uZWxzIHNvIHB1c2hlZCB3ZWJzb2NrZXQgY2hhbmdlcyBhcHBseVxuICAgKiB0aHJvdWdoIHRoZSBzYW1lIGRlcml2ZWQgYXBwbGllciBhcyBwdWxscyAoaWRlbXBvdGVudCwgc2luZ2xlLWZsaWdodGVkKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2NvbnRleHRdIC0gQXBwIGNvbnRleHQgcGFzc2VkIHRvIHRoZSBkZXByZWNhdGVkIGBzeW5jLmNsaWVudC5yZWFsdGltZS5jaGFubmVsc2AgY2FsbGJhY2sgKHJ1bnRpbWUgc2NvcGUgdmFsdWVzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzdWJzY3JpYmVSZWFsdGltZShjb250ZXh0KSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLmFzc2VydFRlbmFudFJlYWR5KClcbiAgICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS5zdWJzY3JpYmUoY29udGV4dCwge3NpZ25hbH0pXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRoZSBzZXJ2ZXItZW51bWVyYXRlZCB1c2VyIHNjb3BlOiBcImV2ZXJ5dGhpbmcgbXkgYWJpbGl0eSBjYW5cbiAgICogc2VlXCIuIERlY2xhcmVzIGEgdXNlciBzY29wZSAoZW1wdHkgY29uZGl0aW9ucykgZm9yIGV2ZXJ5IHB1bGxhYmxlIHN5bmNlZFxuICAgKiByZXNvdXJjZSB0eXBlLCBzdWJzY3JpYmVzIHJlYWx0aW1lIHNvIHRoZWlyIGZyYW1ld29yayBzeW5jIGNoYW5uZWxcbiAgICogc3Vic2NyaXB0aW9ucyBnbyBsaXZlLCBhbmQgcHVsbHMgc28gdGhlIGRldmljZSBjYXRjaGVzIHVwLiBUaGUgc2VydmVyXG4gICAqIGF1dGhvcml6ZXMgZWFjaCBlbXB0eS1jb25kaXRpb25zIHNjb3BlIHRocm91Z2ggdGhlIGFwcCBzeW5jIHJlc291cmNlJ3NcbiAgICogYGF1dGhvcml6ZUNoYW5nZXNgIGFuZCByZS1jaGVja3MgcmVjb3JkIGFjY2VzcyBwZXIgZGVsaXZlcnksIHNvIHRoZSBjbGllbnRcbiAgICogc3Vic2NyaWJlcyB3aXRoIGp1c3QgaXRzIHRva2VuIGFuZCB0aGUgc2VydmVyIGRlY2lkZXMgbWVtYmVyc2hpcC5cbiAgICogSWRlbXBvdGVudCBhbmQgc2luZ2xlLWZsaWdodGVkIGxpa2Uge0BsaW5rIFN5bmNDbGllbnQjc3Vic2NyaWJlUmVhbHRpbWV9LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN1YnNjcmliZVVzZXJTY29wZSgpIHtcbiAgICBpZiAodGhpcy5fdXNlclNjb3BlU3RhdGUgPT09IFwic3Vic2NyaWJlZFwiKSByZXR1cm5cblxuICAgIGlmICghdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSkge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlUHJvbWlzZSA9IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4gYXdhaXQgdGhpcy5fc3Vic2NyaWJlVXNlclNjb3BlKHNpZ25hbCkpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW5kIGFjdGl2YXRlcyB0aGUgc2VydmVyLWVudW1lcmF0ZWQgdXNlciBzY29wZSB3aXRob3V0IHN0YXJ0aW5nXG4gICAqIHJlYWx0aW1lIG9yIHB1bGxpbmcuIFVzZSB0aGlzIGZyb20gU3luY0Nvb3JkaW5hdG9yLnByZXBhcmUoKSBzbyB0aGVcbiAgICogY29vcmRpbmF0b3IgcmVtYWlucyB0aGUgc29sZSBuZXR3b3JrIG9yZGVyaW5nIG93bmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGFjdGl2YXRlVXNlclNjb3BlKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4gYXdhaXQgdGhpcy5fYWN0aXZhdGVVc2VyU2NvcGUoc2lnbmFsKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3RpdmF0ZXMgdGhlIHVzZXIgc2NvcGUgdW5kZXIgdGhlIGN1cnJlbnQgbGlmZWN5Y2xlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IHNpZ25hbCAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgc2NvcGUgaXMgZHVyYWJsZS5cbiAgICovXG4gIGFzeW5jIF9hY3RpdmF0ZVVzZXJTY29wZShzaWduYWwpIHtcbiAgICBhd2FpdCB0aGlzLnNjb3BlU3RvcmUoKS5maW5kT3JDcmVhdGVTY29wZShhd2FpdCB0aGlzLnVzZXJTY29wZSgpKVxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbmQgYWN0aXZhdGVzIHRoZSB1c2VyIHNjb3BlIGZvciBldmVyeSBwdWxsYWJsZSByZXNvdXJjZSwgdGhlblxuICAgKiBzdWJzY3JpYmVzIHJlYWx0aW1lIGFuZCBwdWxscy5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3N1YnNjcmliZVVzZXJTY29wZShzaWduYWwpIHtcbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwic3Vic2NyaWJpbmdcIlxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2FjdGl2YXRlVXNlclNjb3BlKHNpZ25hbClcblxuICAgICAgYXdhaXQgdGhpcy5zdWJzY3JpYmVSZWFsdGltZSgpXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBhd2FpdCB0aGlzLnB1bGwoKVxuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuXG4gICAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwic3Vic2NyaWJlZFwiXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3VzZXJTY29wZVN0YXRlID0gXCJ1bnN1YnNjcmliZWRcIlxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVW5zdWJzY3JpYmVzIHRoZSB1c2VyIHNjb3BlOiBkZWFjdGl2YXRlcyB0aGUgcGVyLXJlc291cmNlIHVzZXIgc2NvcGVzIGFuZFxuICAgKiBjbG9zZXMgdGhlIHJlYWx0aW1lIGNoYW5uZWwgc3Vic2NyaXB0aW9ucy4gVGhlIHNoYXJlZCB3ZWJzb2NrZXQgY29ubmVjdGlvblxuICAgKiBzdGF5cyBvcGVuIHdoZW4gb25lIGlzIGNvbmZpZ3VyZWQgKHNpZ24tb3V0IGRyb3BzIHN1YnNjcmlwdGlvbnMgd2l0aG91dFxuICAgKiBkaXNjb25uZWN0aW5nKSwgc28gYSBzdWJzZXF1ZW50IHNpZ24taW4gcmVzdWJzY3JpYmVzIG92ZXIgdGhlIHNhbWUgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVuc3Vic2NyaWJlVXNlclNjb3BlKCkge1xuICAgIGF3YWl0IHRoaXMuc2NvcGVTdG9yZSgpLmRlYWN0aXZhdGUoYXdhaXQgdGhpcy51c2VyU2NvcGUoKSlcblxuICAgIGF3YWl0IHRoaXMudW5zdWJzY3JpYmVSZWFsdGltZSgpXG5cbiAgICB0aGlzLl91c2VyU2NvcGVTdGF0ZSA9IFwidW5zdWJzY3JpYmVkXCJcbiAgICB0aGlzLl9zdWJzY3JpYmVVc2VyU2NvcGVQcm9taXNlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB1c2VyIHNjb3BlOiBhIHNpbmdsZSBhbGwtdHlwZXMgc2NvcGUgKG51bGwgcmVzb3VyY2VUeXBlKSB3aXRoIGVtcHR5XG4gICAqIGNvbmRpdGlvbnMsIHBhcnRpdGlvbmVkIGxvY2FsbHkgYnkgb3duZXIuIE9uZSBzY29wZSAtIG5vdCBvbmUgcGVyIHJlc291cmNlXG4gICAqIHR5cGUgLSBzbyB0aGUgc2VydmVyIGF1dGhvcml6ZXMgdGhlIGNhbGxlciBvbmNlIHBlciBzeW5jIGFuZCBwZXIgc3Vic2NyaWJlLFxuICAgKiBob3dldmVyIG1hbnkgcmVzb3VyY2UgdHlwZXMgaXQgc2VydmVzLiBUaGUgc2VydmVyIGRlY2lkZXMgd2hpY2ggdHlwZXMgdGhlXG4gICAqIGNhbGxlciBtYXkgc2VlOyB0aGUgY2xpZW50IGFwcGxpZXMgZWFjaCBwdWxsZWQgcm93IGJ5IHRoZSByZXNvdXJjZSB0eXBlIG9uXG4gICAqIGl0cyBvd24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZT59IFRoZSB1c2VyIHNjb3BlLlxuICAgKi9cbiAgYXN5bmMgdXNlclNjb3BlKCkge1xuICAgIHJldHVybiB7Y29uZGl0aW9uczoge30sIG93bmVyOiBhd2FpdCB0aGlzLnVzZXJTY29wZU93bmVyKCksIHJlc291cmNlVHlwZTogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcmVzb3VyY2UgdHlwZXMgdGhlIHVzZXIgc2NvcGUgY292ZXJzOiBldmVyeSBkZWNsYXJlZCByZXNvdXJjZSB0aGF0XG4gICAqIHJlY2VpdmVzIHB1bGxlZCBjaGFuZ2VzIChoYXMgcHVsbCBgYXR0cmlidXRlc2ApLCBzbyB0aGUgY2xpZW50IGNhbiBhcHBseVxuICAgKiB0aGVtLiBTZW50IHdpdGggdGhlIHNjb3BlIGFzIGEgZGVsaXZlcnkvdHlwZSBmaWx0ZXIgLSBpdCBuYXJyb3dzLCBuZXZlclxuICAgKiB3aWRlbnMsIHdoYXQgdGhlIHNlcnZlcidzIGF1dGhvcml6YXRpb24gYWxyZWFkeSBhbGxvd3MsIGFuZCBpdCBrZWVwcyBhXG4gICAqIGJyb2FkY2FzdCBvZiBhIHR5cGUgdGhpcyBjbGllbnQgY2Fubm90IGFwcGx5IGZyb20gcmVhY2hpbmcgdGhlIHNlcnZlcidzXG4gICAqIHBlci1kZWxpdmVyeSBhY2Nlc3MgcmUtY2hlY2sgKGEgZGF0YWJhc2UgcXVlcnkgcGVyIG1hdGNoZWQgYnJvYWRjYXN0LCBwZXJcbiAgICogc3Vic2NyaWJlZCBkZXZpY2UpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IFB1bGxhYmxlIHJlc291cmNlIHR5cGUgbmFtZXMuXG4gICAqL1xuICB1c2VyU2NvcGVSZXNvdXJjZVR5cGVzKCkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLnB1bGxSZXNvdXJjZUNvbmZpZ3MoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgbG9jYWwgcGFydGl0aW9uIGtleSBmb3IgdGhlIHVzZXIgc2NvcGU6IHRoZSBjdXJyZW50bHlcbiAgICogY29uZmlndXJlZCBhdXRoZW50aWNhdGVkIGlkZW50aXR5ICh0aGUgc3luYyBhdXRoIHRva2VuKS4gUGFydGl0aW9uaW5nIHRoZVxuICAgKiB1c2VyIHNjb3BlJ3MgbG9jYWwgc2NvcGUvY3Vyc29yIHJvd3MgYnkgdGhpcyBvd25lciBrZWVwcyB0aGVcbiAgICogZW1wdHktY29uZGl0aW9ucyBjdXJzb3IgZnJvbSBsZWFraW5nIGFjcm9zcyBhY2NvdW50cyBvbiBhIHNoYXJlZCBkZXZpY2VcbiAgICogKGFjY291bnQgQiBzaWduaW5nIGluIGFmdGVyIGFjY291bnQgQSBnZXRzIGEgZnJlc2ggY3Vyc29yKSB3aGlsZSB0aGUgc2FtZVxuICAgKiBhY2NvdW50IHJlY29ubmVjdGluZyBrZWVwcyBpdHMgY3Vyc29yIGNvbnRpbnVpdHkuIFRoZSBvd25lciBpcyBhIGxvY2FsXG4gICAqIHBhcnRpdGlvbiBrZXkgb25seSDigJQgcHVsbHMgc3RpbGwgcG9zdCBlbXB0eSBjb25kaXRpb25zIHRvIHRoZSBzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFVzZXItc2NvcGUgb3duZXIgcGFydGl0aW9uIGtleS5cbiAgICovXG4gIGFzeW5jIHVzZXJTY29wZU93bmVyKCkge1xuICAgIHJldHVybiBTdHJpbmcoYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFVuc3Vic2NyaWJlcyB0aGUgcmVhbHRpbWUgY2hhbm5lbHMgYW5kIGRpc2Nvbm5lY3RzIHRoZSB3ZWJzb2NrZXQgY2xpZW50IChpZGVtcG90ZW50KS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB1bnN1YnNjcmliZVJlYWx0aW1lKCkge1xuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS51bnN1YnNjcmliZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB0aGUgcmVhbHRpbWUgc3Vic2NyaXB0aW9uIHN0YXRlIGFuZCBwZXItY2hhbm5lbCByZWFkaW5lc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPFN5bmNSZWFsdGltZUJyaWRnZVtcInN0YXR1c1wiXT59IFJlYWx0aW1lIHN0YXR1cy5cbiAgICovXG4gIHJlYWx0aW1lU3RhdHVzKCkge1xuICAgIHJldHVybiB0aGlzLnJlYWx0aW1lQnJpZGdlKCkuc3RhdHVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBd2FpdHMgYWxsIHBlbmRpbmcgcmVhbHRpbWUgbWVzc2FnZSBhcHBsaWVzIGFuZCBhbnkgc2NoZWR1bGVkXG4gICAqIHB1bGwtb24tcmVjb25uZWN0ICh1c2VmdWwgaW4gdGVzdHMgYW5kIHNodXRkb3duIGZsb3dzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB3YWl0Rm9yUmVhbHRpbWVBcHBsaWVkKCkge1xuICAgIGF3YWl0IHRoaXMucmVhbHRpbWVCcmlkZ2UoKS53YWl0Rm9yQXBwbGllZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGF6aWx5IGJ1aWx0IHJlYWx0aW1lIGJyaWRnZS5cbiAgICogQHJldHVybnMge1N5bmNSZWFsdGltZUJyaWRnZX0gUmVhbHRpbWUgYnJpZGdlLlxuICAgKi9cbiAgcmVhbHRpbWVCcmlkZ2UoKSB7XG4gICAgdGhpcy5fcmVhbHRpbWVCcmlkZ2UgfHw9IG5ldyBTeW5jUmVhbHRpbWVCcmlkZ2Uoe3N5bmNDbGllbnQ6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlYWx0aW1lQnJpZGdlXG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGEgbG9jYWwgbW9kZWwgY2hhbmdlIGFzIGEgcGVuZGluZyBzeW5jIHJvdyBhbmQgc2NoZWR1bGVzIGFuIGltbWVkaWF0ZVxuICAgKiByZXBsYXkgYXR0ZW1wdCAoa2VwdCBwZW5kaW5nIHdoaWxlIG9mZmxpbmUgb3Igd2hlbiB0aGUgYmFja2VuZCByZWplY3RzIGl0KS5cbiAgICogQHBhcmFtIHt7YmFzZVZlcnNpb24/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCByZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wZXJhdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHN5bmNUeXBlPzogc3RyaW5nfX0gYXJncyAtIFF1ZXVlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IFBlbmRpbmcgbG9jYWwgc3luYyByb3cgb3IgZHVyYWJsZSBjb25mbGljdC10cmFja2VkIGludGVudC5cbiAgICovXG4gIGFzeW5jIHF1ZXVlKHtiYXNlVmVyc2lvbiwgZGF0YSwgb3BlcmF0aW9uID0gXCJ1cGRhdGVcIiwgcmVzb3VyY2UsIHN5bmNUeXBlfSkge1xuICAgIGNvbnN0IGxpZmVjeWNsZUdlbmVyYXRpb24gPSB0aGlzLl9saWZlY3ljbGVHZW5lcmF0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTXV0YXRpb25MaWZlY3ljbGVXb3JrKGxpZmVjeWNsZUdlbmVyYXRpb24sIGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgICAgdGhpcy5hc3NlcnRSZWNvcmRPd25lcnNoaXAocmVzb3VyY2UpXG4gICAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWdGb3IocmVzb3VyY2UpXG4gICAgICBjb25zdCByZXNvbHZlZFN5bmNUeXBlID0gc3luY1R5cGUgPz8gdGhpcy5kZWZhdWx0U3luY1R5cGUoe29wZXJhdGlvbiwgcmVjb3JkOiByZXNvdXJjZSwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgICBpZiAocmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykge1xuICAgICAgICBjb25zdCBxdWV1ZWREYXRhID0gU3luY0FwaUNsaWVudC5xdWV1ZWRTeW5jRGF0YSh7XG4gICAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogcmVzb3VyY2VDb25maWcubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSxcbiAgICAgICAgICByZXNvdXJjZVxuICAgICAgICB9KVxuICAgICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlQ29uZmxpY3RUcmFja2VkU3luYyh7XG4gICAgICAgICAgYmFzZVZlcnNpb246IGJhc2VWZXJzaW9uID09PSB1bmRlZmluZWQgPyB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZDogcmVzb3VyY2UsIHJlc291cmNlQ29uZmlnfSkgOiBiYXNlVmVyc2lvbixcbiAgICAgICAgICBjb25mbGljdFRyYWNraW5nOiByZXNvdXJjZUNvbmZpZy5jb25mbGljdFRyYWNraW5nLFxuICAgICAgICAgIGRhdGE6IHF1ZXVlZERhdGEsXG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIHJlc291cmNlLFxuICAgICAgICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2UuY29uc3RydWN0b3IuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgc3luY1R5cGU6IHJlc29sdmVkU3luY1R5cGVcbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLnNjaGVkdWxlUmVwbGF5KClcblxuICAgICAgICByZXR1cm4gcmVjb3JkXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHN5bmNSb3cgPSBhd2FpdCB0aGlzLndpdGhUZW5hbnRPcGVyYXRpb24oYXN5bmMgKGRhdGFiYXNlT3BlcmF0aW9uKSA9PiBhd2FpdCBTeW5jQXBpQ2xpZW50LnF1ZXVlTG9jYWxTeW5jKHtcbiAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IHJlc291cmNlQ29uZmlnLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICBkYXRhLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiByZXNvdXJjZUNvbmZpZy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdLFxuICAgICAgICByZXNvdXJjZSxcbiAgICAgICAgc3luY01vZGVsOiBkYXRhYmFzZU9wZXJhdGlvbiA/IGRhdGFiYXNlT3BlcmF0aW9uLm1vZGVsQ2xhc3ModGhpcy5jb25maWcuc3luY01vZGVsKSA6IHRoaXMuY29uZmlnLnN5bmNNb2RlbCxcbiAgICAgICAgc3luY1R5cGU6IHJlc29sdmVkU3luY1R5cGVcbiAgICAgIH0pKVxuXG4gICAgICB0aGlzLnNjaGVkdWxlUmVwbGF5KClcblxuICAgICAgcmV0dXJuIHN5bmNSb3dcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIGxvY2FsIHN5bmMgcm93cyB0byB0aGUgYmFja2VuZCAoc2luZ2xlLWZsaWdodGVkLCBvbmxpbmUtZ2F0ZWQpLlxuICAgKiBSb3dzIGFyZSBvbmx5IG1hcmtlZCBzdWNjZXNzZnVsIGFmdGVyIHRoZSBiYWNrZW5kIGFja25vd2xlZGdlcyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlcGxheVBlbmRpbmcoKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiBhd2FpdCB0aGlzLl9yZXBsYXlQZW5kaW5nKHNpZ25hbCkpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5IGltcGxlbWVudGF0aW9uIGJvdW5kIHRvIG9uZSBsaWZlY3ljbGUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3JlcGxheVBlbmRpbmcoc2lnbmFsKSB7XG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuICAgIGlmICghKGF3YWl0IHRoaXMuaXNPbmxpbmUoKSkpIHJldHVyblxuICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcblxuICAgIGF3YWl0IFN5bmNBcGlDbGllbnQuc2luZ2xlRmxpZ2h0KGB2ZWxvY2lvdXMtc3luYy1jbGllbnQtcmVwbGF5LSR7dGhpcy5fY2xpZW50TnVtYmVyfWAsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG4gICAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIHJlc291cmNlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZy5yZXNvdXJjZXMpKSB7XG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZykgY29udGludWVcblxuICAgICAgICBhd2FpdCBTeW5jQXBpQ2xpZW50LnJlcGxheUNvbmZsaWN0VHJhY2tlZFN5bmNzKHtcbiAgICAgICAgICBhcHBseUNvbmZsaWN0OiBhc3luYyAoe3JlY29yZCwgcmVzdWx0fSkgPT4gYXdhaXQgdGhpcy5hcHBseUNvbmZsaWN0UmVwbGF5UmVzdWx0KHtyZWNvcmQsIHJlc3VsdCwgcmVzb3VyY2VUeXBlfSksXG4gICAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXdhaXQgdGhpcy5jb25maWcuYXV0aGVudGljYXRpb25Ub2tlbigpLFxuICAgICAgICAgIGJhdGNoU2l6ZTogdGhpcy5jb25maWcuYmF0Y2hTaXplLFxuICAgICAgICAgIGNvbmZsaWN0VHJhY2tpbmc6IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcsXG4gICAgICAgICAgcG9zdFJlcGxheTogdGhpcy5jb25maWcucG9zdFJlcGxheSxcbiAgICAgICAgICByZW1vdGVHZW5lcmF0aW9uOiAoaWRlbnRpdHkpID0+IHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCxcbiAgICAgICAgICByZXNvdXJjZVR5cGUsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGF3YWl0IFN5bmNBcGlDbGllbnQucmVwbGF5TG9jYWxTeW5jcyh7XG4gICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGF3YWl0IHRoaXMuY29uZmlnLmF1dGhlbnRpY2F0aW9uVG9rZW4oKSxcbiAgICAgICAgYmF0Y2hTaXplOiB0aGlzLmNvbmZpZy5iYXRjaFNpemUsXG4gICAgICAgIHBvc3RSZXBsYXk6IHRoaXMuY29uZmlnLnBvc3RSZXBsYXksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgc3luY01vZGVsOiBvcGVyYXRpb24gPyBvcGVyYXRpb24ubW9kZWxDbGFzcyh0aGlzLmNvbmZpZy5zeW5jTW9kZWwpIDogdGhpcy5jb25maWcuc3luY01vZGVsXG4gICAgICB9KVxuICAgIH0pKVxuXG4gICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYW4gYXV0aG9yaXRhdGl2ZSBzZXJ2ZXJNb2RlbCByZXR1cm5lZCBieSBhIGNvbmZsaWN0IHRocm91Z2ggdGhlXG4gICAqIHNhbWUgdGVuYW50LWJvdW5kLCB0cmFja2luZy1zdXBwcmVzc2VkIGFwcGxpZXIgdXNlZCBieSBwdWxsL3JlYWx0aW1lLlxuICAgKiBBIGNvbmZsaWN0IHJlc3VsdCB3aXRob3V0IHNlcnZlck1vZGVsIGhhcyBubyBhdXRob3JpdGF0aXZlIHN0YXRlIHRvIGFwcGx5XG4gICAqIGFuZCByZW1haW5zIGRpYWdub3N0aWMtb25seS5cbiAgICogQHBhcmFtIHt7cmVjb3JkOiBpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkLCByZXNvdXJjZVR5cGU6IHN0cmluZywgcmVzdWx0OiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVwbGF5SXRlbX19IGFyZ3MgLSBDb25mbGljdCByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXBwbHlDb25mbGljdFJlcGxheVJlc3VsdCh7cmVjb3JkLCByZXNvdXJjZVR5cGUsIHJlc3VsdH0pIHtcbiAgICBjb25zdCBjb25mbGljdCA9IHJlc3VsdC5jb25mbGljdFxuXG4gICAgaWYgKCFjb25mbGljdCB8fCAhT2JqZWN0Lmhhc093bihjb25mbGljdCwgXCJzZXJ2ZXJNb2RlbFwiKSkgcmV0dXJuXG5cbiAgICBjb25zdCBzZXJ2ZXJNb2RlbCA9IGNvbmZsaWN0LnNlcnZlck1vZGVsXG5cbiAgICBpZiAoc2VydmVyTW9kZWwgIT09IG51bGwgJiYgKHR5cGVvZiBzZXJ2ZXJNb2RlbCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcnZlck1vZGVsKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCBzZXJ2ZXJNb2RlbCBmb3IgJHtyZXNvdXJjZVR5cGV9IG11c3QgYmUgYW4gb2JqZWN0IG9yIG51bGxgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlSWQgPSByZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZFxuXG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZUlkICE9PSBcInN0cmluZ1wiIHx8IHJlc291cmNlSWQubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY29uZmxpY3QgZm9yICR7cmVzb3VyY2VUeXBlfSBpcyBtaXNzaW5nIHJlc291cmNlSWRgKVxuXG4gICAgY29uc3Qgc3luYyA9IFN5bmNBcGlDbGllbnQuc3luY0VudmVsb3BlRnJvbVBheWxvYWQoe1xuICAgICAgZGF0YTogc2VydmVyTW9kZWwsXG4gICAgICByZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgc3luY1R5cGU6IHNlcnZlck1vZGVsID09PSBudWxsID8gXCJkZWxldGVcIiA6IFwidXBkYXRlXCJcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5yZW1vdGVBcHBseVN5bmMoe3NvdXJjZTogXCJjb25mbGljdCBzZXJ2ZXIgdmVyc2lvblwifSkoc3luYylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHF1ZXVlIGNvdW50cyBhbmQgcHJpdmFjeS1zYWZlIGNvbmZsaWN0cyBmb3IgY29vcmRpbmF0b3IvVUkgc3RhdHVzLlxuICAgKiBGdWxsIGxvY2FsL3NlcnZlciBwYXlsb2FkcyByZW1haW4gb25seSBpbiB0aGUgZHVyYWJsZSBtdXRhdGlvbiBsb2cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy1jb29yZGluYXRvci10eXBlcy5qc1wiKS5TeW5jQ2xpZW50SW5zcGVjdGlvbj59IER1cmFibGUgc3luYyBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGluc3BlY3RTeW5jU3RhdGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZVdvcmsoYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdGhyb3dJZkxpZmVjeWNsZUFib3J0ZWQoc2lnbmFsKVxuICAgICAgbGV0IHBlbmRpbmdDb3VudCA9IDBcbiAgICAgIGxldCByZWplY3RlZENvdW50ID0gMFxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0NvbmZsaWN0RGlhZ25vc3RpY1tdfSAqL1xuICAgICAgY29uc3QgY29uZmxpY3RzID0gW11cblxuICAgICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25maWcucmVzb3VyY2VzKSkge1xuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmcpIGNvbnRpbnVlXG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYXdhaXQgcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5yZWNvcmRzKCkpIHtcbiAgICAgICAgICBpZiAocmVjb3JkLm11dGF0aW9uLm1vZGVsICE9PSByZXNvdXJjZVR5cGUpIGNvbnRpbnVlXG4gICAgICAgICAgaWYgKFtcInBlbmRpbmdcIiwgXCJhcHBsaWVkLWxvY2FsbHlcIiwgXCJwZWVyLWFwcGxpZWRcIl0uaW5jbHVkZXMocmVjb3JkLnN0YXR1cykpIHBlbmRpbmdDb3VudCArPSAxXG4gICAgICAgICAgaWYgKHJlY29yZC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikgcmVqZWN0ZWRDb3VudCArPSAxXG4gICAgICAgICAgaWYgKHJlY29yZC5zdGF0dXMgPT09IFwiY29uZmxpY3RcIikgY29uZmxpY3RzLnB1c2goc3luY0NvbmZsaWN0RGlhZ25vc3RpYyhyZWNvcmQpKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIH1cblxuICAgICAgcGVuZGluZ0NvdW50ICs9IGF3YWl0IHRoaXMud2l0aFRlbmFudE9wZXJhdGlvbihhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IHN5bmNNb2RlbCA9IG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5tb2RlbENsYXNzKHRoaXMuY29uZmlnLnN5bmNNb2RlbCkgOiB0aGlzLmNvbmZpZy5zeW5jTW9kZWxcbiAgICAgICAgY29uc3QgcGVuZGluZ1Jvd3MgPSBhd2FpdCBzeW5jTW9kZWwucHJlbG9hZCh7cmVzb3VyY2U6IHRydWV9KS53aGVyZSh7c3RhdGU6IFwicGVuZGluZ1wifSkub3JkZXIoXCJjcmVhdGVkX2F0XCIpLnRvQXJyYXkoKVxuXG4gICAgICAgIHJldHVybiBwZW5kaW5nUm93cy5sZW5ndGhcbiAgICAgIH0pXG4gICAgICB0aGlzLl90aHJvd0lmTGlmZWN5Y2xlQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIHJldHVybiB7Y29uZmxpY3RzLCBwZW5kaW5nQ291bnQsIHJlamVjdGVkQ291bnR9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGR1cmFibGUgY29uZmxpY3Qgb24gaXRzIGRlY2xhcmVkIHJlc291cmNlIGxvZy4gUmV0cnktbG9jYWwgaXNcbiAgICogc2NoZWR1bGVkIHRocm91Z2ggdGhlIGN1cnJlbnQgY29vcmRpbmF0b3Igd2hlbiBhdHRhY2hlZC5cbiAgICogQHBhcmFtIHt7cmVjb3JkSWQ6IHN0cmluZywgcmVzb2x1dGlvbjogXCJrZWVwLXNlcnZlclwiIHwgXCJyZXRyeS1sb2NhbFwiLCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBSZXNvbHV0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gLSBSZXNvbHZlZCBkdXJhYmxlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVDb25mbGljdCh7cmVjb3JkSWQsIHJlc29sdXRpb24sIHJlc291cmNlVHlwZX0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlV29yayhhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBjb25zdCBjb25mbGljdFRyYWNraW5nID0gdGhpcy5jb25maWcucmVzb3VyY2VzW3Jlc291cmNlVHlwZV0/LmNvbmZsaWN0VHJhY2tpbmdcblxuICAgICAgaWYgKCFjb25mbGljdFRyYWNraW5nKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZsaWN0LXRyYWNrZWQgc3luYyByZXNvdXJjZSBjb25maWd1cmVkIGZvcjogJHtyZXNvdXJjZVR5cGV9YClcblxuICAgICAgY29uc3QgcmVjb3JkID0gYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5yZXNvbHZlQ29uZmxpY3Qoe2lkOiByZWNvcmRJZCwgcmVzb2x1dGlvbn0pXG5cbiAgICAgIHRoaXMuX3Rocm93SWZMaWZlY3ljbGVBYm9ydGVkKHNpZ25hbClcbiAgICAgIGlmIChyZXNvbHV0aW9uID09PSBcInJldHJ5LWxvY2FsXCIpIHRoaXMuc2NoZWR1bGVSZXBsYXkoKVxuXG4gICAgICByZXR1cm4gcmVjb3JkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGF1dGhvcml0YXRpdmUgcmVtb3RlIG9ic2VydmF0aW9uIHNvIGFuIGluLWZsaWdodCBhY2tub3dsZWRnZW1lbnRcbiAgICogY2Fubm90IHJlYmFzZSBhIHN1Y2Nlc3NvciBhY3Jvc3MgdGhhdCBvYnNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VJZDogc3RyaW5nIHwgbnVtYmVyLCByZXNvdXJjZVR5cGU6IHN0cmluZywgdmVyc2lvbj86IHN0cmluZyB8IG51bWJlciB8IG51bGx9fSBhcmdzIC0gUmVtb3RlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG5vdGVSZW1vdGVWZXJzaW9uKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHZlcnNpb259KSB7XG4gICAgdm9pZCB2ZXJzaW9uXG4gICAgY29uc3QgaWRlbnRpdHkgPSBgJHtyZXNvdXJjZVR5cGV9OiR7U3RyaW5nKHJlc291cmNlSWQpfWBcblxuICAgIHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLnNldChpZGVudGl0eSwgKHRoaXMuX3JlbW90ZUdlbmVyYXRpb25zLmdldChpZGVudGl0eSkgfHwgMCkgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBhdXRob3JpdGF0aXZlIGJhc2UgdmVyc2lvbiBvYnNlcnZlZCBiZWZvcmUgYSBsb2NhbCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gQmFzZSB2ZXJzaW9uLlxuICAgKi9cbiAgYmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBpZiAob3BlcmF0aW9uID09PSBcImNyZWF0ZVwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHJlc291cmNlQ29uZmlnLmNvbmZsaWN0VHJhY2tpbmc/LnZlcnNpb25BdHRyaWJ1dGVcblxuICAgIGlmICghdmVyc2lvbkF0dHJpYnV0ZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkLnJlYWRBdHRyaWJ1dGUodmVyc2lvbkF0dHJpYnV0ZSlcblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0IHZlcnNpb24gJHt2ZXJzaW9uQXR0cmlidXRlfSBtdXN0IGJlIGEgRGF0ZSwgc3RyaW5nLCBudW1iZXIsIG9yIG51bGxgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBwcmUtYXNzaWdubWVudCB2YWx1ZSBleHBvc2VkIGJ5IHJlY29yZCBjaGFuZ2VzIGR1cmluZyBiZWZvcmVVcGRhdGUuXG4gICAqIERlbGV0ZXMgaGF2ZSBubyB2ZXJzaW9uIGNoYW5nZSBwYWlyIGFuZCB1c2UgdGhlIHJlY29yZCdzIGN1cnJlbnQgdmVyc2lvbi5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiLCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUNvbmZpZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9fSBhcmdzIC0gVmVyc2lvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gUHJlLW11dGF0aW9uIGJhc2UgdmVyc2lvbi5cbiAgICovXG4gIHByZU11dGF0aW9uQmFzZVZlcnNpb25Gb3Ioe29wZXJhdGlvbiwgcmVjb3JkLCByZXNvdXJjZUNvbmZpZ30pIHtcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gcmVzb3VyY2VDb25maWcuY29uZmxpY3RUcmFja2luZz8udmVyc2lvbkF0dHJpYnV0ZVxuICAgIGNvbnN0IHZlcnNpb25Db2x1bW4gPSB2ZXJzaW9uQXR0cmlidXRlXG4gICAgICA/IHJlY29yZC5jb25zdHJ1Y3Rvci5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbdmVyc2lvbkF0dHJpYnV0ZV1cbiAgICAgIDogdW5kZWZpbmVkXG4gICAgY29uc3QgdmVyc2lvbkNoYW5nZSA9IG9wZXJhdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiB2ZXJzaW9uQ29sdW1uXG4gICAgICA/IHJlY29yZC5jaGFuZ2VzKClbdmVyc2lvbkNvbHVtbl1cbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIXZlcnNpb25DaGFuZ2UpIHJldHVybiB0aGlzLmJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KVxuXG4gICAgY29uc3QgdmFsdWUgPSB2ZXJzaW9uQ2hhbmdlWzBdXG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjb25mbGljdCB2ZXJzaW9uICR7dmVyc2lvbkF0dHJpYnV0ZX0gbXVzdCBiZSBhIERhdGUsIHN0cmluZywgbnVtYmVyLCBvciBudWxsYClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25zdW1lcyB0aGUgYmFzZSBjYXB0dXJlZCBmb3IgdGhpcyBsaWZlY3ljbGUgZXZlbnQgYmVmb3JlIGl0cyBhZnRlci1jb21taXRcbiAgICogY2xvc3VyZSBpcyBkZWZlcnJlZCwgcHJlc2VydmluZyByZXBlYXRlZCBzYW1lLXJlY29yZCB3cml0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlQ29uZmlnOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRSZXNvdXJjZUNvbmZpZ319IGFyZ3MgLSBDYXB0dXJlIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBDYXB0dXJlZCBiYXNlIHZlcnNpb24uXG4gICAqL1xuICBjYXB0dXJlZEJhc2VWZXJzaW9uRm9yKHtvcGVyYXRpb24sIHJlY29yZCwgcmVzb3VyY2VDb25maWd9KSB7XG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNhcHR1cmVkVmVyc2lvbnMgPSB0aGlzLl9jYXB0dXJlZEJhc2VWZXJzaW9ucy5nZXQocmVjb3JkKVxuICAgIGNvbnN0IGJhc2VWZXJzaW9uID0gY2FwdHVyZWRWZXJzaW9ucz8uc2hpZnQoKVxuXG4gICAgaWYgKGNhcHR1cmVkVmVyc2lvbnM/Lmxlbmd0aCA9PT0gMCkgdGhpcy5fY2FwdHVyZWRCYXNlVmVyc2lvbnMuZGVsZXRlKHJlY29yZClcbiAgICBpZiAoYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIGJhc2VWZXJzaW9uXG5cbiAgICByZXR1cm4gdGhpcy5iYXNlVmVyc2lvbkZvcih7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgYSBiYWNrZ3JvdW5kIHJlcGxheSBhdHRlbXB0IHdpdGhvdXQgYmxvY2tpbmcgdGhlIGNhbGxlci5cbiAgICogRmFpbHVyZXMgZ28gdG8gY29uZmlnLm9uRXJyb3IgKG9yIHJldGhyb3cgd2hlbiBub25lIGlzIGNvbmZpZ3VyZWQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlUmVwbGF5KCkge1xuICAgIGNvbnN0IGNvb3JkaW5hdG9yUnVuID0gdGhpcy5yZXF1ZXN0Q29vcmRpbmF0b3JTeW5jKFwibXV0YXRpb25cIilcblxuICAgIGlmIChjb29yZGluYXRvclJ1bikge1xuICAgICAgdGhpcy5fc2NoZWR1bGVkUmVwbGF5ID0gY29vcmRpbmF0b3JSdW5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3NjaGVkdWxlZFJlcGxheSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJlcGxheVBlbmRpbmcoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuaXNMaWZlY3ljbGVBYm9ydChlcnJvcikpIHJldHVyblxuXG4gICAgICAgIHRoaXMucmVwb3J0RXJyb3IoLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKSlcbiAgICAgIH1cbiAgICB9KSgpXG4gIH1cblxuICAvKipcbiAgICogQXdhaXRzIHRoZSBsYXN0IHNjaGVkdWxlZCBiYWNrZ3JvdW5kIHJlcGxheSAodXNlZnVsIGluIHRlc3RzIGFuZCBzaHV0ZG93biBmbG93cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgd2FpdEZvclNjaGVkdWxlZFJlcGxheSgpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkUmVwbGF5KSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRSZXBsYXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGEgYmFja2dyb3VuZCBzeW5jIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gQmFja2dyb3VuZCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlcG9ydEVycm9yKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLm9uRXJyb3IpIHtcbiAgICAgIHRoaXMuY29uZmlnLm9uRXJyb3IoZXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGNvbm5lY3Rpdml0eSB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGdhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBiYWNrZW5kIGlzIGNvbnNpZGVyZWQgcmVhY2hhYmxlLlxuICAgKi9cbiAgYXN5bmMgaXNPbmxpbmUoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5pc09ubGluZSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiAoYXdhaXQgdGhpcy5jb25maWcuaXNPbmxpbmUoKSkgIT09IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2NvcGUgc3RvcmUgYmFja2luZyBkZWNsYXJlZCBzY29wZXMgYW5kIGN1cnNvcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtc2NvcGUtc3RvcmUuanNcIikuZGVmYXVsdH0gU2NvcGUgc3RvcmUuXG4gICAqL1xuICBzY29wZVN0b3JlKCkge1xuICAgIHRoaXMuYXNzZXJ0VGVuYW50UmVhZHkoKVxuXG4gICAgaWYgKHRoaXMuX3Njb3BlU3RvcmUgJiYgdGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJiB0aGlzLl9zY29wZVN0b3JlLnN0b3JlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgc3RvcmUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fc2NvcGVTdG9yZSB8fD0gbmV3IFN5bmNTY29wZVN0b3JlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIHRlbmFudEhhbmRsZTogdGhpcy5jb25maWcudGVuYW50SGFuZGxlXG4gICAgfSlcblxuICAgIHJldHVybiB0aGlzLl9zY29wZVN0b3JlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHJlc291cmNlIGNvbmZpZyBmb3IgYSBsb2NhbCByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlIC0gTG9jYWwgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50UmVzb3VyY2VDb25maWd9IERlY2xhcmVkIHJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHJlc291cmNlQ29uZmlnRm9yKHJlc291cmNlKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHJlc291cmNlPy5jb25zdHJ1Y3RvclxuXG4gICAgaWYgKHR5cGVvZiBtb2RlbENsYXNzPy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHJlc291cmNlcyBtdXN0IGJlIG1vZGVsIHJlY29yZHMgd2l0aCBhIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSwgZ290OiAke1N0cmluZyhyZXNvdXJjZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLmNvbmZpZy5yZXNvdXJjZXNbcmVzb3VyY2VUeXBlXVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZykgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIHJlc291cmNlIGNvbmZpZ3VyZWQgZm9yOiAke3Jlc291cmNlVHlwZX1gKVxuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHN5bmMgdHlwZSBmb3IgYSBtdXRhdGlvbiB0aHJvdWdoIHRoZSByZXNvdXJjZSBjb25maWcuIFRoZVxuICAgKiBcInVwc2VydFwiIGZsYWcgcXVldWVzIGNyZWF0ZXMgYW5kIHVwZGF0ZXMgYXMgXCJ1cGRhdGVcIiByb3dzICh0aGUgc2VydmVyXG4gICAqIHVwc2VydHMgYnkgcmVzb3VyY2UgaWQpIGFuZCBkZXN0cm95cyBhcyBcImRlbGV0ZVwiIHJvd3MuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VDb25maWc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfX0gYXJncyAtIE11dGF0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN5bmMgdHlwZS5cbiAgICovXG4gIGRlZmF1bHRTeW5jVHlwZSh7b3BlcmF0aW9uLCByZWNvcmQsIHJlc291cmNlQ29uZmlnfSkge1xuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VDb25maWcuc3luY1R5cGUgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHJlc291cmNlQ29uZmlnLnN5bmNUeXBlKHtvcGVyYXRpb24sIHJlY29yZH0pXG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJkZXN0cm95XCIpIHJldHVybiBcImRlbGV0ZVwiXG4gICAgaWYgKHJlc291cmNlQ29uZmlnLnN5bmNUeXBlID09PSBcInVwc2VydFwiKSByZXR1cm4gXCJ1cGRhdGVcIlxuXG4gICAgcmV0dXJuIG9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIERlcml2ZXMgdGhlIHB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncyBmcm9tIHRoZSBkZWNsYXJlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSBbb3BlcmF0aW9uXSAtIFRlbmFudCBvcGVyYXRpb24gYmluZGluZyB0aGUgcmVzb3VyY2UgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZz59IFB1bGwtYXBwbHkgcmVzb3VyY2UgY29uZmlncy5cbiAgICovXG4gIHB1bGxSZXNvdXJjZUNvbmZpZ3Mob3BlcmF0aW9uKSB7XG4gICAgaWYgKCFvcGVyYXRpb24gJiYgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncykgcmV0dXJuIHRoaXMuX3B1bGxSZXNvdXJjZUNvbmZpZ3NcblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlncyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnPn0gKi8gKE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnLnJlc291cmNlcylcbiAgICAgICAgLmZpbHRlcigoWywgcmVzb3VyY2VdKSA9PiBCb29sZWFuKHJlc291cmNlLmF0dHJpYnV0ZXMpKVxuICAgICAgICAubWFwKChbcmVzb3VyY2VUeXBlLCByZXNvdXJjZV0pID0+IHtcbiAgICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gb3BlcmF0aW9uID8gb3BlcmF0aW9uLm1vZGVsQ2xhc3MocmVzb3VyY2UubW9kZWxDbGFzcykgOiByZXNvdXJjZS5tb2RlbENsYXNzXG4gICAgICAgICAgY29uc3QgZmluZFJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmRcbiAgICAgICAgICBjb25zdCBmaW5kUmVjb3JkRm9yRGVsZXRlID0gcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZVxuXG4gICAgICAgICAgcmV0dXJuIFtyZXNvdXJjZVR5cGUsIHtcbiAgICAgICAgICAgIGFmdGVyQXBwbHk6IHJlc291cmNlLmFmdGVyQXBwbHksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZ1tcImF0dHJpYnV0ZXNcIl19ICovIChyZXNvdXJjZS5hdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBmaW5kUmVjb3JkOiBvcGVyYXRpb24gJiYgZmluZFJlY29yZFxuICAgICAgICAgICAgICA/IChhcmdzKSA9PiBmaW5kUmVjb3JkKHsuLi5hcmdzLCBtb2RlbENsYXNzLCBvcGVyYXRpb246IG9wZXJhdGlvbiB8fCBudWxsfSlcbiAgICAgICAgICAgICAgOiBmaW5kUmVjb3JkLFxuICAgICAgICAgICAgZmluZFJlY29yZEZvckRlbGV0ZTogb3BlcmF0aW9uICYmIGZpbmRSZWNvcmRGb3JEZWxldGVcbiAgICAgICAgICAgICAgPyAoYXJncykgPT4gZmluZFJlY29yZEZvckRlbGV0ZSh7Li4uYXJncywgbW9kZWxDbGFzcywgb3BlcmF0aW9uOiBvcGVyYXRpb24gfHwgbnVsbH0pXG4gICAgICAgICAgICAgIDogZmluZFJlY29yZEZvckRlbGV0ZSxcbiAgICAgICAgICAgIG1vZGVsQ2xhc3NcbiAgICAgICAgICB9XVxuICAgICAgICB9KVxuICAgICkpXG5cbiAgICBpZiAoIW9wZXJhdGlvbikgdGhpcy5fcHVsbFJlc291cmNlQ29uZmlncyA9IHJlc291cmNlQ29uZmlnc1xuXG4gICAgcmV0dXJuIHJlc291cmNlQ29uZmlnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9jYWwgc3RhdGUgd29yayBvbiB0aGlzIGNsaWVudCdzIGNhcHR1cmVkIHRlbmFudCwgb3IgZGlyZWN0bHkgZm9yIHRoZSBsZWdhY3kgZGVmYXVsdC1kYXRhYmFzZSBjbGllbnQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEJvdW5kIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoVGVuYW50T3BlcmF0aW9uKGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG51bGwpXG4gICAgdGhpcy5hc3NlcnRUZW5hbnRSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcudGVuYW50SGFuZGxlLmRhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgbmFtZTogXCJUZW5hbnQgU3luY0NsaWVudFwiXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5jb25maWcuc3luY01vZGVsKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyB3aGV0aGVyIGEgcmVjb3JkIGJlbG9uZ3MgdG8gdGhpcyBjbGllbnQncyBwaHlzaWNhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2FuZGlkYXRlIHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyBjbGllbnQgb3ducyBpdC5cbiAgICovXG4gIG93bnNSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgZGF0YWJhc2VPcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgcmV0dXJuIHJlY29yZC5kYXRhYmFzZUlkZW50aXR5KCkgPT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiZcbiAgICAgIGRhdGFiYXNlT3BlcmF0aW9uPy5zY2hlbWFHZW5lcmF0aW9uKCkgPT09IHRoaXMuX3RlbmFudFNjaGVtYUdlbmVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIGEgcmVjb3JkIG5vdCBvd25lZCBieSB0aGlzIGNsaWVudCdzIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDYW5kaWRhdGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydFJlY29yZE93bmVyc2hpcChyZWNvcmQpIHtcbiAgICBpZiAoIXRoaXMub3duc1JlY29yZChyZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHJlc291cmNlIGJlbG9uZ3MgdG8gYW5vdGhlciBvciB1bnJlc29sdmVkIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRlY2xhcmVkIHF1ZXJ5IGFnYWluc3QgdGhpcyBjbGllbnQncyBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHF1ZXJ5IC0gU2NvcGUgcXVlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0UXVlcnlPd25lcnNoaXAocXVlcnkpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLnRlbmFudEhhbmRsZSB8fCAhdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBxdWVyeS5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUudGVuYW50KCl9KVxuICAgIGNvbnN0IHF1ZXJ5RGF0YWJhc2VJZGVudGl0eSA9IHF1ZXJ5Ll9vcGVyYXRpb24/LmRhdGFiYXNlSWRlbnRpdHkoKVxuXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5jb25maWcuZGF0YWJhc2VJZGVudGlmaWVyIHx8XG4gICAgICAhdGhpcy5jb25maWcucmVzb3VyY2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldIHx8XG4gICAgICBxdWVyeURhdGFiYXNlSWRlbnRpdHkgIT09IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNDbGllbnQgc2NvcGUgYmVsb25ncyB0byBhbm90aGVyIG9yIHVucmVzb2x2ZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgd29yayBhZnRlciB0aGUgaGFuZGxlJ3MgcmVhZHkgcGh5c2ljYWwgc2NoZW1hIGdlbmVyYXRpb24gY2hhbmdlZCBvciBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0VGVuYW50UmVhZHkoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUgfHwgIXRoaXMuY29uZmlnLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuXG5cbiAgICBjb25zdCBsaWZlY3ljbGUgPSB0aGlzLmNvbmZpZy50ZW5hbnRIYW5kbGUuaW5zcGVjdCh7ZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmNvbmZpZy5kYXRhYmFzZUlkZW50aWZpZXJ9KVxuXG4gICAgaWYgKCFsaWZlY3ljbGUucmVhZHkgfHwgIWxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uIHx8IGxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uICE9PSB0aGlzLl90ZW5hbnRTY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jQ2xpZW50IHRlbmFudCBkYXRhYmFzZSBnZW5lcmF0aW9uIGlzIHN0YWxlIG9yIG5vdCByZWFkeVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIGN1c3RvbSByZW1vdGUgcmVzb2x2ZXIgcmVzdWx0IHRvIHRoZSBhY3RpdmUgdGVuYW50IG9wZXJhdGlvbiBhZnRlciBwcm92aW5nIGl0cyBjYXB0dXJlZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBCaW5kaW5nIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYmluZFJlbW90ZVJlY29yZCh7b3BlcmF0aW9uLCByZWNvcmR9KSB7XG4gICAgaWYgKHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbj8uKCkgPT09IG9wZXJhdGlvbikgcmV0dXJuXG4gICAgdGhpcy5hc3NlcnRSZWNvcmRPd25lcnNoaXAocmVjb3JkKVxuICAgIG9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBwcml2YWN5LXNhZmUgY29uZmxpY3QgbWV0YWRhdGEgZnJvbSBhIGR1cmFibGUgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBEdXJhYmxlIGNvbmZsaWN0IHJlY29yZC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanNcIikuU3luY0NvbmZsaWN0RGlhZ25vc3RpY30gLSBTYWZlIGRpYWdub3N0aWMuXG4gKi9cbmZ1bmN0aW9uIHN5bmNDb25mbGljdERpYWdub3N0aWMocmVjb3JkKSB7XG4gIGNvbnN0IGNvbmZsaWN0ID0gcmVjb3JkLnN5bmNSZXN1bHQ/LmNvbmZsaWN0XG4gIGNvbnN0IGNvbmZsaWN0T2JqZWN0ID0gY29uZmxpY3QgJiYgIShjb25mbGljdCBpbnN0YW5jZW9mIERhdGUpICYmIHR5cGVvZiBjb25mbGljdCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjb25mbGljdClcbiAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChjb25mbGljdClcbiAgICA6IHt9XG4gIGNvbnN0IHJlc291cmNlSWQgPSByZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZFxuXG4gIGlmICh0eXBlb2YgcmVzb3VyY2VJZCAhPT0gXCJzdHJpbmdcIiB8fCByZXNvdXJjZUlkLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNvbmZsaWN0ICR7cmVjb3JkLmlkfSBpcyBtaXNzaW5nIGEgc2FmZSByZXNvdXJjZUlkYClcblxuICByZXR1cm4ge1xuICAgIGJhc2VWZXJzaW9uOiBzYWZlQ29uZmxpY3RWZXJzaW9uKGNvbmZsaWN0T2JqZWN0LmJhc2VWZXJzaW9uID8/IHJlY29yZC5tdXRhdGlvbi5iYXNlVmVyc2lvbiA/PyBudWxsKSxcbiAgICBjbGllbnRNdXRhdGlvbklkOiByZWNvcmQubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICBsb2NhbFZlcnNpb246IHNhZmVDb25mbGljdFZlcnNpb24oY29uZmxpY3RPYmplY3QubG9jYWxWZXJzaW9uID8/IG51bGwpLFxuICAgIHJlY29yZElkOiByZWNvcmQuaWQsXG4gICAgcmVzb3VyY2VJZCxcbiAgICByZXNvdXJjZVR5cGU6IHJlY29yZC5tdXRhdGlvbi5tb2RlbCxcbiAgICBzZXJ2ZXJWZXJzaW9uOiBzYWZlQ29uZmxpY3RWZXJzaW9uKGNvbmZsaWN0T2JqZWN0LnNlcnZlclZlcnNpb24gPz8gbnVsbCksXG4gICAgdmVyc2lvbkF0dHJpYnV0ZTogdHlwZW9mIGNvbmZsaWN0T2JqZWN0LnZlcnNpb25BdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgPyBjb25mbGljdE9iamVjdC52ZXJzaW9uQXR0cmlidXRlIDogbnVsbFxuICB9XG59XG5cbi8qKlxuICogUmVzdHJpY3RzIGRpYWdub3N0aWMgdmVyc2lvbnMgdG8gc2FmZSBzY2FsYXIgdmFsdWVzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZlcnNpb24gY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IC0gU2FmZSBzY2FsYXIgdmVyc2lvbi5cbiAqL1xuZnVuY3Rpb24gc2FmZUNvbmZsaWN0VmVyc2lvbih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiA/IHZhbHVlIDogbnVsbFxufVxuXG4vKipcbiAqIEJ1aWxkcyBvbmUgcmVzb3VyY2UgY29uZmlnIGZyb20gYSBtb2RlbCdzIGBzdGF0aWMgc3luY2AgZGVjbGFyYXRpb24gcGx1cyBpdHNcbiAqIGRlcml2ZWQgY29sdW1uIG1ldGFkYXRhLlxuICogQHBhcmFtIHt7ZGVjbGFyYXRpb246IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb24sIG1ldGFkYXRhTW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1vZGVsQ2xhc3M6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBEZWNsYXJhdGlvbiBhcmdzLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnfSBEZXJpdmVkIHJlc291cmNlIGNvbmZpZy5cbiAqL1xuZnVuY3Rpb24gcmVzb3VyY2VDb25maWdGcm9tU3luY0RlY2xhcmF0aW9uKHtkZWNsYXJhdGlvbiwgbWV0YWRhdGFNb2RlbENsYXNzLCBtb2RlbENsYXNzLCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWREZWNsYXJhdGlvbiA9IGRlY2xhcmF0aW9uID09PSB0cnVlID8ge30gOiBkZWNsYXJhdGlvblxuXG4gIGlmICghbm9ybWFsaXplZERlY2xhcmF0aW9uIHx8IHR5cGVvZiBub3JtYWxpemVkRGVjbGFyYXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShub3JtYWxpemVkRGVjbGFyYXRpb24pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgbXVzdCBiZSB0cnVlIG9yIGEgc3luYyBkZWNsYXJhdGlvbiBvYmplY3QsIGdvdDogJHtTdHJpbmcoZGVjbGFyYXRpb24pfWApXG4gIH1cblxuICBjb25zdCB7YWZ0ZXJBcHBseSwgYXR0cmlidXRlcywgYm9vbGVhbkF0dHJpYnV0ZXMsIGNvbmZsaWN0VHJhY2tpbmcsIGZpbmRSZWNvcmQsIGZpbmRSZWNvcmRGb3JEZWxldGUsIGxvY2FsT25seUF0dHJpYnV0ZXMsIHB1Ymxpc2gsIHJlYWx0aW1lLCBzeW5jVHlwZSwgdHJhY2ssIHRyYWNrZWREYXRhLCAuLi5yZXN0RGVjbGFyYXRpb259ID0gbm9ybWFsaXplZERlY2xhcmF0aW9uXG4gIGNvbnN0IHVua25vd25LZXlzID0gT2JqZWN0LmtleXMocmVzdERlY2xhcmF0aW9uKVxuXG4gIC8vIGBwdWJsaXNoYCBpcyB0aGUgc2VydmVyLXNpZGUgaGFsZiBvZiB0aGUgc2hhcmVkIGBzdGF0aWMgc3luY2AgZGVjbGFyYXRpb25cbiAgLy8gKGNvbnN1bWVkIGJ5IFN5bmNQdWJsaXNoZXIgb24gdGhlIGJhY2tlbmQpIC0gdGhlIGNsaWVudCBkZXJpdmVzIG5vdGhpbmdcbiAgLy8gZnJvbSBpdCwgYnV0IG1vZGVscyBkZWNsYXJlZCBvbmNlIGZvciBib3RoIHNpZGVzIG11c3Qgc3RheSB2YWxpZCBoZXJlLlxuICB2b2lkIHB1Ymxpc2hcblxuICBpZiAodW5rbm93bktleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IHN0YXRpYyBzeW5jIHJlY2VpdmVkIHVua25vd24ga2V5czogJHt1bmtub3duS2V5cy5qb2luKFwiLCBcIil9IChzdXBwb3J0ZWQ6IGFmdGVyQXBwbHksIGF0dHJpYnV0ZXMsIGJvb2xlYW5BdHRyaWJ1dGVzLCBjb25mbGljdFRyYWNraW5nLCBmaW5kUmVjb3JkLCBmaW5kUmVjb3JkRm9yRGVsZXRlLCBsb2NhbE9ubHlBdHRyaWJ1dGVzLCBwdWJsaXNoLCByZWFsdGltZSwgc3luY1R5cGUsIHRyYWNrLCB0cmFja2VkRGF0YSlgKVxuICB9XG4gIGlmIChzeW5jVHlwZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBzeW5jVHlwZSAhPT0gXCJmdW5jdGlvblwiICYmIHN5bmNUeXBlICE9PSBcInVwc2VydFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgc3luY1R5cGUgbXVzdCBiZSBhIGZ1bmN0aW9uIG9yIHRoZSBzdHJpbmcgXCJ1cHNlcnRcIiwgZ290OiAke1N0cmluZyhzeW5jVHlwZSl9YClcbiAgfVxuXG4gIGNvbnN0IGRlcml2ZWQgPSBkZXJpdmVkU3luY0F0dHJpYnV0ZXMoe21vZGVsQ2xhc3M6IG1ldGFkYXRhTW9kZWxDbGFzcywgcmVzb3VyY2VUeXBlfSlcblxuICBpZiAoY29uZmxpY3RUcmFja2luZykgdmFsaWRhdGVDb25mbGljdFRyYWNraW5nKHtjb25mbGljdFRyYWNraW5nLCBkZXJpdmVkLCByZXNvdXJjZVR5cGV9KVxuXG4gIHJldHVybiB7XG4gICAgYWZ0ZXJBcHBseSxcbiAgICBhdHRyaWJ1dGVzLFxuICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiBtZXJnZWRBdHRyaWJ1dGVOYW1lcyhkZXJpdmVkLmJvb2xlYW5BdHRyaWJ1dGVzLCBib29sZWFuQXR0cmlidXRlcyksXG4gICAgY29uZmxpY3RUcmFja2luZzogY29uZmxpY3RUcmFja2luZyA/IHsuLi5jb25mbGljdFRyYWNraW5nLCB2ZXJzaW9uQXR0cmlidXRlOiBjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgfHwgXCJ1cGRhdGVkQXRcIn0gOiB1bmRlZmluZWQsXG4gICAgZmluZFJlY29yZCxcbiAgICBmaW5kUmVjb3JkRm9yRGVsZXRlLFxuICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IG1lcmdlZEF0dHJpYnV0ZU5hbWVzKFxuICAgICAgZGVyaXZlZC5sb2NhbE9ubHlBdHRyaWJ1dGVzLFxuICAgICAgWy4uLihsb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSwgLi4uKGNvbmZsaWN0VHJhY2tpbmcgPyBbY29uZmxpY3RUcmFja2luZy52ZXJzaW9uQXR0cmlidXRlIHx8IFwidXBkYXRlZEF0XCJdIDogW10pXVxuICAgICksXG4gICAgbWV0YWRhdGFNb2RlbENsYXNzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgcmVhbHRpbWUsXG4gICAgc3luY1R5cGUsXG4gICAgdHJhY2s6IG5vcm1hbGl6ZWRUcmFjayh0cmFjayksXG4gICAgdHJhY2tlZERhdGFcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgcmVzb3VyY2UncyBkdXJhYmxlIGNvbmZsaWN0LXRyYWNraW5nIGRlY2xhcmF0aW9uLlxuICogQHBhcmFtIHt7Y29uZmxpY3RUcmFja2luZzogaW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmxpY3RUcmFja2luZ0NvbmZpZywgZGVyaXZlZDoge2Jvb2xlYW5BdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbG9jYWxPbmx5QXR0cmlidXRlczogc3RyaW5nW119LCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBWYWxpZGF0aW9uIGFyZ3MuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVDb25mbGljdFRyYWNraW5nKHtjb25mbGljdFRyYWNraW5nLCBkZXJpdmVkLCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IHJlcXVpcmVkU3RyaW5ncyA9IHtcbiAgICBhY3RvckRldmljZUlkOiBjb25mbGljdFRyYWNraW5nLmFjdG9yRGV2aWNlSWQsXG4gICAgYWN0b3JVc2VySWQ6IGNvbmZsaWN0VHJhY2tpbmcuYWN0b3JVc2VySWQsXG4gICAgb2ZmbGluZUdyYW50SWQ6IGNvbmZsaWN0VHJhY2tpbmcub2ZmbGluZUdyYW50SWQsXG4gICAgcG9saWN5SGFzaDogY29uZmxpY3RUcmFja2luZy5wb2xpY3lIYXNoXG4gIH1cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyZXF1aXJlZFN0cmluZ3MpKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCB2YWx1ZS5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcuJHtrZXl9IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nYClcbiAgfVxuICBpZiAoIWNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgfHwgdHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cgbXVzdCBiZSBhIExvY2FsTXV0YXRpb25Mb2dgKVxuICBpZiAodHlwZW9mIGNvbmZsaWN0VHJhY2tpbmcuY2xpZW50TXV0YXRpb25JZCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQgbXVzdCBiZSBhIGZ1bmN0aW9uYClcbiAgaWYgKCFjb25mbGljdFRyYWNraW5nLnZlcnNpb25BdHRyaWJ1dGUgJiYgIWRlcml2ZWQubG9jYWxPbmx5QXR0cmlidXRlcy5pbmNsdWRlcyhcInVwZGF0ZWRBdFwiKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZVR5cGV9IGNvbmZsaWN0VHJhY2tpbmcgcmVxdWlyZXMgdmVyc2lvbkF0dHJpYnV0ZSBiZWNhdXNlIHRoZSBtb2RlbCBoYXMgbm8gdXBkYXRlZEF0IGNvbHVtbmApXG4gIH1cbn1cblxuLyoqXG4gKiBEZXJpdmVzIGJvb2xlYW4gYW5kIGxvY2FsLW9ubHkgYXR0cmlidXRlIG5hbWVzIGZyb20gYSBtb2RlbCdzIGNvbHVtbiBtZXRhZGF0YTpcbiAqIGJvb2xlYW5zIGZyb20gYm9vbGVhbiBjb2x1bW4gdHlwZXM7IGxvY2FsLW9ubHkgZnJvbSB0aGUgcHJpbWFyeSBrZXksXG4gKiBjcmVhdGVkQXQvdXBkYXRlZEF0LCBhbmQgc3luYyBib29ra2VlcGluZyBjb2x1bW5zLlxuICogQHBhcmFtIHt7bW9kZWxDbGFzczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIERlcml2YXRpb24gYXJncy5cbiAqIEByZXR1cm5zIHt7Ym9vbGVhbkF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBzdHJpbmdbXX19IERlcml2ZWQgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBkZXJpdmVkU3luY0F0dHJpYnV0ZXMoe21vZGVsQ2xhc3MsIHJlc291cmNlVHlwZX0pIHtcbiAgaWYgKFxuICAgIHR5cGVvZiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVzICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5wcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCIgfHxcbiAgICB0eXBlb2YgbW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5ICE9PSBcImZ1bmN0aW9uXCJcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gc3RhdGljIHN5bmMgcmVxdWlyZXMgYSBWZWxvY2lvdXMgbW9kZWwgY2xhc3Mgd2l0aCBjb2x1bW4gbWV0YWRhdGEgKGdldENvbHVtbk5hbWVzLCBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwLCBnZXRDb2x1bW5UeXBlQnlOYW1lLCBwcmltYXJ5S2V5LCBoYXNQcmltYXJ5S2V5KWApXG4gIH1cblxuICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYm9vbGVhbkF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBsb2NhbE9ubHlBdHRyaWJ1dGVzID0gW11cblxuICBpZiAobW9kZWxDbGFzcy5oYXNQcmltYXJ5S2V5KCkpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgRGVyaXZlZCBzeW5jIGF0dHJpYnV0ZXMgZm9yICR7cmVzb3VyY2VUeXBlfWApXG5cbiAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtwcmltYXJ5S2V5Q29sdW1uXSB8fCBwcmltYXJ5S2V5Q29sdW1uKVxuICB9XG5cbiAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZXMoKSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoTE9DQUxfQk9PS0tFRVBJTkdfQVRUUklCVVRFX05BTUVTLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpICYmICFsb2NhbE9ubHlBdHRyaWJ1dGVzLmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gICAgaWYgKGNvbHVtblR5cGUgJiYgaXNCb29sZWFuQ29sdW1uVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgYm9vbGVhbkF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7Ym9vbGVhbkF0dHJpYnV0ZXMsIGxvY2FsT25seUF0dHJpYnV0ZXN9XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlcml2ZWQgYXR0cmlidXRlIG5hbWVzIHdpdGggZGVjbGFyZWQgZXh0cmFzIGludG8gYSBzb3J0ZWQsIGR1cGxpY2F0ZS1mcmVlIGxpc3QuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXJpdmVkIC0gRGVyaXZlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSBkZWNsYXJlZCAtIERlY2xhcmVkIGV4dHJhIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gTWVyZ2VkIGF0dHJpYnV0ZSBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gbWVyZ2VkQXR0cmlidXRlTmFtZXMoZGVyaXZlZCwgZGVjbGFyZWQpIHtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KFsuLi5kZXJpdmVkLCAuLi4oZGVjbGFyZWQgfHwgW10pXSldLnNvcnQoKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBkZWNsYXJhdGlvbidzIHRyYWNrIHZhbHVlOiBhbiBvcGVyYXRpb25zIGFycmF5IGlzIHNob3J0aGFuZCBmb3JcbiAqIHRoZSB7b3BlcmF0aW9uc30gZm9ybS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbkNvbmZpZ1tcInRyYWNrXCJdfSB0cmFjayAtIERlY2xhcmVkIHRyYWNrIHZhbHVlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudFJlc291cmNlQ29uZmlnW1widHJhY2tcIl19IE5vcm1hbGl6ZWQgdHJhY2sgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZWRUcmFjayh0cmFjaykge1xuICBpZiAoQXJyYXkuaXNBcnJheSh0cmFjaykpIHJldHVybiB7b3BlcmF0aW9uczogdHJhY2t9XG5cbiAgcmV0dXJuIHRyYWNrXG59XG5cbi8qKlxuICogQnVpbGRzIGEgZnJhbWV3b3JrLW93bmVkIHN5bmMgZW5kcG9pbnQgUE9TVGVyIG92ZXIgdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0LlxuICogQHBhcmFtIHt7cGF0aDogc3RyaW5nLCByZXF1ZXN0Q29udGV4dDogaW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1N5bmNDbGllbnRUcmFuc3BvcnR9fSBhcmdzIC0gUG9zdGVyIGFyZ3MuXG4gKiBAcmV0dXJucyB7KHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IHtzaWduYWw/OiBBYm9ydFNpZ25hbH0pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBTeW5jIGVuZHBvaW50IFBPU1Rlci5cbiAqL1xuZnVuY3Rpb24gdHJhbnNwb3J0UG9zdGVyKHtwYXRoLCByZXF1ZXN0Q29udGV4dCwgdHJhbnNwb3J0fSkge1xuICByZXR1cm4gYXN5bmMgKHBheWxvYWQsIG9wdGlvbnMgPSB7fSkgPT4ge1xuICAgIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0gbWVyZ2VSZW1vdGVSZXF1ZXN0Q29udGV4dCh7XG4gICAgICBjb250ZXh0OiByZXF1ZXN0Q29udGV4dCxcbiAgICAgIGxhYmVsOiBcIlN5bmMgY2xpZW50IHJlcXVlc3QgY29udGV4dFwiLFxuICAgICAgcGFyYW1zOiBwYXlsb2FkXG4gICAgfSlcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRyYW5zcG9ydC5wb3N0KHBhdGgsIHJlcXVlc3RQYXlsb2FkLCB7c2lnbmFsOiBvcHRpb25zLnNpZ25hbH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZS5qc29uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3luYy5jbGllbnQgdHJhbnNwb3J0LnBvc3QgbXVzdCByZXNvbHZlIHRvIGEgcmVzcG9uc2Ugd2l0aCBhIGpzb24oKSBtZXRob2QgZm9yICR7cGF0aH0gKGxpa2UgdGhlIGZyb250ZW5kLW1vZGVsIHdlYnNvY2tldCBjbGllbnQpYClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcmVzcG9uc2UuanNvbigpXG4gIH1cbn1cblxuLyoqXG4gKiBMYXppbHkgYnVpbGRzIChhbmQgbWVtb2l6ZXMgcGVyIGNvbmZpZ3VyYXRpb24pIHRoZSBzeW5jIGNsaWVudCBkZXJpdmVkIGZyb20gdGhlXG4gKiBhcHAncyBWZWxvY2lvdXMgY29uZmlndXJhdGlvbiBhbmQgcmVnaXN0ZXJzIGl0IGFzIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICogQHBhcmFtIHtDb25maWd1cmF0aW9ufSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgcmVnaXN0ZXJlZCBtb2RlbHMgYW5kIHRoZSBzeW5jLmNsaWVudCBibG9jay4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtTeW5jQ2xpZW50fSBNZW1vaXplZCBzeW5jIGNsaWVudCBmb3IgdGhlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzeW5jQ2xpZW50KGNvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKSkge1xuICBsZXQgY2xpZW50ID0gc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24uZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFjbGllbnQpIHtcbiAgICBjbGllbnQgPSBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pXG4gICAgc3luY0NsaWVudHNCeUNvbmZpZ3VyYXRpb24uc2V0KGNvbmZpZ3VyYXRpb24sIGNsaWVudClcbiAgICBjbGllbnQuc2V0Q3VycmVudCgpXG4gIH1cblxuICByZXR1cm4gY2xpZW50XG59XG5cbi8qKlxuICogRGVjbGFyZXMgYSBzeW5jIHNjb3BlIG9uIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcXVlcnkgLSBRdWVyeSBkZWNsYXJpbmcgdGhlIHN5bmMgc2NvcGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx7c2NvcGU6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZSwgcHVsbGVkOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdCB8IG51bGx9Pn0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3luYyhxdWVyeSkge1xuICByZXR1cm4gYXdhaXQgU3luY0NsaWVudC5jdXJyZW50KCkuc3luYyhxdWVyeSlcbn1cbiJdfQ==