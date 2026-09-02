import Configuration from "../configuration.js";
import Logger from "../logger.js";
import SyncRealtimeBridge from "./sync-realtime-bridge.js";
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
    /** @type {import("./sync-client-types.js").SyncClientConfig} */
    config: import("./sync-client-types.js").SyncClientConfig;
    _clientNumber: number;
    _databaseIdentity: string | null;
    _tenantSchemaGeneration: string | null | undefined;
    /** @type {SyncRealtimeBridge | null} */
    _realtimeBridge: SyncRealtimeBridge | null;
    /** @type {import("./sync-client-types.js").SyncClientSharedConnection | null | undefined} Shared app-lifetime websocket connection (undefined until first resolved, null when none is configured). */
    _syncConnection: import("./sync-client-types.js").SyncClientSharedConnection | null | undefined;
    /** @type {Promise<void> | null} */
    _subscribeUserScopePromise: Promise<void> | null;
    /** @type {"subscribed" | "subscribing" | "unsubscribed"} */
    _userScopeState: "subscribed" | "subscribing" | "unsubscribed";
    /** @type {import("./sync-scope-store.js").default | null} */
    _scopeStore: import("./sync-scope-store.js").default | null;
    /** @type {Promise<void> | null} */
    _scheduledReplay: Promise<void> | null;
    /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig> | null} */
    _pullResourceConfigs: Record<string, import("./sync-api-client-types.js").SyncResourceConfig> | null;
    /** @type {Array<{callback: (record: ReturnType<typeof JSON.parse>) => Promise<void> | void, callbackName: "afterCreate" | "afterUpdate" | "afterDestroy" | "beforeUpdate" | "beforeDestroy", modelClass: ReturnType<typeof JSON.parse>}>} */
    _trackedCallbacks: Array<{
        callback: (record: ReturnType<typeof JSON.parse>) => Promise<void> | void;
        callbackName: "afterCreate" | "afterUpdate" | "afterDestroy" | "beforeUpdate" | "beforeDestroy";
        modelClass: ReturnType<typeof JSON.parse>;
    }>;
    /** @type {WeakSet<object>} */
    _remoteApplyRecords: WeakSet<object>;
    /** @type {Map<string, number>} */
    _remoteGenerations: Map<string, number>;
    /** @type {WeakMap<object, Array<string | number | null>>} */
    _capturedBaseVersions: WeakMap<object, Array<string | number | null>>;
    _withoutTrackingDepth: number;
    /** @type {Logger | {error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} | null} */
    _logger: Logger | {
        error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>;
    } | null;
    _started: boolean;
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
    constructor(options?: import("./sync-client-types.js").SyncClientOptions);
    /**
     * Registers automatic mutation tracking for every declared resource (on by
     * default: local creates and updates queue pending sync rows once their
     * transaction commits and schedule an immediate replay attempt, without
     * app-side queue calls). `track: false` resources are skipped; `track: true`
     * adds destroys; an operations list narrows the tracked operations.
     * @returns {Promise<void>}
     */
    start(): Promise<void>;
    /**
     * Unregisters all tracking callbacks (tests, sign-out, hot reload).
     * @returns {void}
     */
    stop(): void;
    /**
     * Resolves and validates the tracked operations for a resource config.
     * Tracking is on by default: models declaring `static sync` without a `track`
     * key queue local creates and updates automatically; `track: false` opts a
     * model out (for models written by non-user flows).
     * @param {{resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig, resourceType: string}} args - Resource config and name.
     * @returns {Array<"create" | "update" | "destroy">} Tracked operations.
     */
    trackedOperations({ resourceConfig, resourceType }: {
        resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig;
        resourceType: string;
    }): Array<"create" | "update" | "destroy">;
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
    trackedMutationCallback({ operation, resourceConfig }: {
        operation: "create" | "update" | "destroy";
        resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig;
    }): (record: ReturnType<typeof JSON.parse>) => Promise<void>;
    /**
     * Reports a post-commit tracked-queueing failure. The transaction has already
     * committed when afterCommit callbacks run, so rethrowing here would poison
     * the driver's awaited afterCommit chain (breaking unrelated callbacks) -
     * instead the failure goes to the configured sync.client.onError hook, or is
     * logged loudly through the client's logger when none is configured.
     * @param {Error} error - Post-commit queueing failure.
     * @returns {Promise<void>}
     */
    reportAfterCommitError(error: Error): Promise<void>;
    /**
     * Returns the lazily built client logger.
     * @returns {Logger | {error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>}} Client logger.
     */
    logger(): Logger | {
        error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>;
    };
    /**
     * Whether a record is currently being written by pull-apply (echo suppression).
     * @param {ReturnType<typeof JSON.parse>} record - Local model record.
     * @returns {boolean} Whether the record write originates from a remote change.
     */
    isRemoteApply(record: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Whether tracked mutation queueing is currently suppressed for a record:
     * either the record was marked as a remote apply (`markRemoteApply`, used by
     * pull and realtime applies) or a `withoutTracking` callback is running on
     * this client.
     * @param {ReturnType<typeof JSON.parse>} record - Local model record.
     * @returns {boolean} Whether tracked queueing is suppressed for the record.
     */
    isTrackingSuppressed(record: ReturnType<typeof JSON.parse>): boolean;
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
    withoutTracking<T>(callback: () => Promise<T> | T): Promise<T>;
    /**
     * Marks one record as being written from server-originated data so tracked
     * mutation queueing skips it (record-precise suppression). The derived pull
     * and realtime appliers use this internally around every applied write.
     * @param {ReturnType<typeof JSON.parse>} record - Local model record about to be written.
     * @returns {() => void} Release callback re-enabling tracking for the record.
     */
    markRemoteApply(record: ReturnType<typeof JSON.parse>): () => void;
    /**
     * Registers this client as the app's current sync client.
     * @returns {void}
     */
    setCurrent(): void;
    /**
     * Returns the app's current sync client.
     * @returns {SyncClient} Current sync client.
     */
    static current(): SyncClient;
    /**
     * Builds a sync client derived from the given configuration. Alias for
     * `new SyncClient({configuration, ...options})`.
     * @param {Configuration} [configuration] - Configuration owning the registered models and the sync.client block. Defaults to the current configuration.
     * @param {Omit<import("./sync-client-types.js").SyncClientOptions, "configuration">} [options] - Optional overrides.
     * @returns {SyncClient} Sync client derived from the configuration.
     */
    static fromConfiguration(configuration?: Configuration, options?: Omit<import("./sync-client-types.js").SyncClientOptions, "configuration">): SyncClient;
    /**
     * Declares (or re-activates) a sync scope from a model query and pulls it when online.
     * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query declaring the sync scope.
     * @param {object} [options] - Sync options.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [options.onProgress] - Called per applied page of the pull this declaration triggers, so the initial import of a newly declared scope can drive a "syncedCount of total" progress bar. See `pull()`.
     * @param {boolean} [options.upstreamRefresh] - Marks the changes request(s) as a user-initiated refresh, so the server can bypass upstream-import throttle windows. See `pull()`.
     * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result (null while offline).
     */
    sync(query: import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>, { onProgress, upstreamRefresh }?: {
        onProgress?: (progress: import("./sync-api-client-types.js").SyncPullProgress) => void;
        upstreamRefresh?: boolean;
    }): Promise<{
        scope: import("./sync-client-types.js").SerializedSyncScope;
        pulled: import("./sync-api-client-types.js").SyncChangesResult | null;
    }>;
    /**
     * Deactivates the sync scope declared by a model query.
     * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query whose scope should stop syncing.
     * @returns {Promise<void>}
     */
    unsync(query: import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Pulls changes for every active scope with per-scope cursors (single-flighted, online-gated).
     * @param {object} [options] - Pull options.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [options.onProgress] - Called per applied page with cumulative `{pages, syncedCount, total}` across the pulled scopes, for rendering a "syncedCount of total" progress bar (e.g. a full-import screen). Optional; omitting it keeps the existing behavior.
     * @param {boolean} [options.upstreamRefresh] - Sends `upstreamRefresh: true` on the changes request(s), telling the server this pull is user-initiated so it can bypass upstream-import throttle windows (see docs/sync-upstream-imports.md). Background pulls omit it and stay throttled.
     * @returns {Promise<import("./sync-api-client-types.js").SyncChangesResult | null>} Combined pull result, or null while offline.
     */
    pull({ onProgress, upstreamRefresh }?: {
        onProgress?: (progress: import("./sync-api-client-types.js").SyncPullProgress) => void;
        upstreamRefresh?: boolean;
    }): Promise<import("./sync-api-client-types.js").SyncChangesResult | null>;
    /**
     * Builds the derived remote-change applier shared by pulls and realtime pushes:
     * applies through the declared resource configs, registers each written record
     * for echo suppression (tracked resources do not re-queue applied changes), and
     * fails loudly instead of silently skipping unconfigured resources.
     * @param {{source?: string}} [args] - Error context describing where the change came from.
     * @returns {(sync: import("./sync-api-client-types.js").SyncChangeEnvelope) => Promise<import("./sync-api-client-types.js").SyncChangeApplyResult>} Loud remote-change applier.
     */
    remoteApplySync({ source }?: {
        source?: string;
    }): (sync: import("./sync-api-client-types.js").SyncChangeEnvelope) => Promise<import("./sync-api-client-types.js").SyncChangeApplyResult>;
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
    syncConnection(): import("./sync-client-types.js").SyncClientSharedConnection | null;
    /**
     * Subscribes the derived realtime channels so pushed websocket changes apply
     * through the same derived applier as pulls (idempotent, single-flighted).
     * @param {ReturnType<typeof JSON.parse>} [context] - App context passed to the deprecated `sync.client.realtime.channels` callback (runtime scope values).
     * @returns {Promise<void>}
     */
    subscribeRealtime(context?: ReturnType<typeof JSON.parse>): Promise<void>;
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
    subscribeUserScope(): Promise<void>;
    /**
     * Declares and activates the user scope for every pullable resource, then
     * subscribes realtime and pulls.
     * @returns {Promise<void>}
     */
    _subscribeUserScope(): Promise<void>;
    /**
     * Unsubscribes the user scope: deactivates the per-resource user scopes and
     * closes the realtime channel subscriptions. The shared websocket connection
     * stays open when one is configured (sign-out drops subscriptions without
     * disconnecting), so a subsequent sign-in resubscribes over the same socket.
     * @returns {Promise<void>}
     */
    unsubscribeUserScope(): Promise<void>;
    /**
     * The user scope: a single all-types scope (null resourceType) with empty
     * conditions, partitioned locally by owner. One scope - not one per resource
     * type - so the server authorizes the caller once per sync and per subscribe,
     * however many resource types it serves. The server decides which types the
     * caller may see; the client applies each pulled row by the resource type on
     * its own envelope.
     * @returns {Promise<import("./sync-client-types.js").SerializedSyncScope>} The user scope.
     */
    userScope(): Promise<import("./sync-client-types.js").SerializedSyncScope>;
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
    userScopeResourceTypes(): string[];
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
    userScopeOwner(): Promise<string>;
    /**
     * Unsubscribes the realtime channels and disconnects the websocket client (idempotent).
     * @returns {Promise<void>}
     */
    unsubscribeRealtime(): Promise<void>;
    /**
     * Reports the realtime subscription state and per-channel readiness.
     * @returns {ReturnType<SyncRealtimeBridge["status"]>} Realtime status.
     */
    realtimeStatus(): ReturnType<SyncRealtimeBridge["status"]>;
    /**
     * Awaits all pending realtime message applies and any scheduled
     * pull-on-reconnect (useful in tests and shutdown flows).
     * @returns {Promise<void>}
     */
    waitForRealtimeApplied(): Promise<void>;
    /**
     * Returns the lazily built realtime bridge.
     * @returns {SyncRealtimeBridge} Realtime bridge.
     */
    realtimeBridge(): SyncRealtimeBridge;
    /**
     * Queues a local model change as a pending sync row and schedules an immediate
     * replay attempt (kept pending while offline or when the backend rejects it).
     * @param {{baseVersion?: string | number | null, resource: ReturnType<typeof JSON.parse>, data?: Record<string, ReturnType<typeof JSON.parse>>, operation?: "create" | "update" | "destroy", syncType?: string}} args - Queue args.
     * @returns {Promise<ReturnType<typeof JSON.parse> | import("./local-mutation-log.js").LocalMutationLogRecord>} Pending local sync row or durable conflict-tracked intent.
     */
    queue({ baseVersion, data, operation, resource, syncType }: {
        baseVersion?: string | number | null;
        resource: ReturnType<typeof JSON.parse>;
        data?: Record<string, ReturnType<typeof JSON.parse>>;
        operation?: "create" | "update" | "destroy";
        syncType?: string;
    }): Promise<ReturnType<typeof JSON.parse> | import("./local-mutation-log.js").LocalMutationLogRecord>;
    /**
     * Drains pending local sync rows to the backend (single-flighted, online-gated).
     * Rows are only marked successful after the backend acknowledges them.
     * @returns {Promise<void>}
     */
    replayPending(): Promise<void>;
    /**
     * Records an authoritative remote observation so an in-flight acknowledgement
     * cannot rebase a successor across that observation.
     * @param {{resourceId: string | number, resourceType: string, version?: string | number | null}} args - Remote identity.
     * @returns {void}
     */
    noteRemoteVersion({ resourceId, resourceType, version }: {
        resourceId: string | number;
        resourceType: string;
        version?: string | number | null;
    }): void;
    /**
     * Reads the authoritative base version observed before a local mutation.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Version args.
     * @returns {string | number | null} Base version.
     */
    baseVersionFor({ operation, record, resourceConfig }: {
        operation: "create" | "update" | "destroy";
        record: ReturnType<typeof JSON.parse>;
        resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig;
    }): string | number | null;
    /**
     * Reads the pre-assignment value exposed by record changes during beforeUpdate.
     * Deletes have no version change pair and use the record's current version.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Version args.
     * @returns {string | number | null} Pre-mutation base version.
     */
    preMutationBaseVersionFor({ operation, record, resourceConfig }: {
        operation: "create" | "update" | "destroy";
        record: ReturnType<typeof JSON.parse>;
        resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig;
    }): string | number | null;
    /**
     * Consumes the base captured for this lifecycle event before its after-commit
     * closure is deferred, preserving repeated same-record writes in one transaction.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Capture args.
     * @returns {string | number | null} Captured base version.
     */
    capturedBaseVersionFor({ operation, record, resourceConfig }: {
        operation: "create" | "update" | "destroy";
        record: ReturnType<typeof JSON.parse>;
        resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig;
    }): string | number | null;
    /**
     * Schedules a background replay attempt without blocking the caller.
     * Failures go to config.onError (or rethrow when none is configured).
     * @returns {void}
     */
    scheduleReplay(): void;
    /**
     * Awaits the last scheduled background replay (useful in tests and shutdown flows).
     * @returns {Promise<void>}
     */
    waitForScheduledReplay(): Promise<void>;
    /**
     * Reports a background sync failure.
     * @param {Error} error - Background failure.
     * @returns {void}
     */
    reportError(error: Error): void;
    /**
     * Resolves connectivity through the configured gate.
     * @returns {Promise<boolean>} Whether the backend is considered reachable.
     */
    isOnline(): Promise<boolean>;
    /**
     * Returns the scope store backing declared scopes and cursors.
     * @returns {import("./sync-scope-store.js").default} Scope store.
     */
    scopeStore(): import("./sync-scope-store.js").default;
    /**
     * Resolves the declared resource config for a local record.
     * @param {ReturnType<typeof JSON.parse>} resource - Local model record.
     * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Declared resource config.
     */
    resourceConfigFor(resource: ReturnType<typeof JSON.parse>): import("./sync-client-types.js").SyncClientResourceConfig;
    /**
     * Resolves the sync type for a mutation through the resource config. The
     * "upsert" flag queues creates and updates as "update" rows (the server
     * upserts by resource id) and destroys as "delete" rows.
     * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Mutation args.
     * @returns {string} Sync type.
     */
    defaultSyncType({ operation, record, resourceConfig }: {
        operation: "create" | "update" | "destroy";
        record: ReturnType<typeof JSON.parse>;
        resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig;
    }): string;
    /**
     * Derives the pull-apply resource configs from the declared resources.
     * @param {import("../database/operation.js").default | null} [operation] - Tenant operation binding the resource model classes.
     * @returns {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} Pull-apply resource configs.
     */
    pullResourceConfigs(operation?: import("../database/operation.js").default | null): Record<string, import("./sync-api-client-types.js").SyncResourceConfig>;
    /**
     * Runs local state work on this client's captured tenant, or directly for the legacy default-database client.
     * @template T
     * @param {(operation: import("../database/operation.js").default | null) => Promise<T>} callback - Bound work.
     * @returns {Promise<T>} Callback result.
     */
    withTenantOperation<T>(callback: (operation: import("../database/operation.js").default | null) => Promise<T>): Promise<T>;
    /**
     * Reports whether a record belongs to this client's physical database.
     * @param {ReturnType<typeof JSON.parse>} record - Candidate record.
     * @returns {boolean} Whether this client owns it.
     */
    ownsRecord(record: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Rejects a record not owned by this client's physical database.
     * @param {ReturnType<typeof JSON.parse>} record - Candidate record.
     * @returns {void}
     */
    assertRecordOwnership(record: ReturnType<typeof JSON.parse>): void;
    /**
     * Validates a declared query against this client's captured tenant database.
     * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Scope query.
     * @returns {void}
     */
    assertQueryOwnership(query: import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>): void;
    /**
     * Rejects work after the handle's ready physical schema generation changed or closed.
     * @returns {void}
     */
    assertTenantReady(): void;
    /**
     * Binds a custom remote resolver result to the active tenant operation after proving its captured identity.
     * @param {{operation: import("../database/operation.js").default, record: ReturnType<typeof JSON.parse>}} args - Binding args.
     * @returns {void}
     */
    bindRemoteRecord({ operation, record }: {
        operation: import("../database/operation.js").default;
        record: ReturnType<typeof JSON.parse>;
    }): void;
}
/**
 * Lazily builds (and memoizes per configuration) the sync client derived from the
 * app's Velocious configuration and registers it as the current sync client.
 * @param {Configuration} [configuration] - Configuration owning the registered models and the sync.client block. Defaults to the current configuration.
 * @returns {SyncClient} Memoized sync client for the configuration.
 */
export declare function syncClient(configuration?: Configuration): SyncClient;
/**
 * Declares a sync scope on the current sync client.
 * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query declaring the sync scope.
 * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result.
 */
export declare function sync(query: import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>): Promise<{
    scope: import("./sync-client-types.js").SerializedSyncScope;
    pulled: import("./sync-api-client-types.js").SyncChangesResult | null;
}>;
//# sourceMappingURL=sync-client.d.ts.map