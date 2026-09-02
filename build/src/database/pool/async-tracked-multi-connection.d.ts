import { AsyncLocalStorage } from "async_hooks";
import BasePool from "./base.js";
import DatabasePoolCheckoutTimeoutError from "./checkout-timeout-error.js";
export type PendingCheckout = {
    /**
     * - Resolved database configuration needed by the checkout.
     */
    databaseConfig: import("../../configuration-types.js").DatabaseConfigurationType;
    /**
     * - Timestamp when the checkout started waiting.
     */
    enqueuedAt: number;
    /**
     * - Checkout options.
     */
    options: import("./base.js").ConnectionCheckoutOptions;
    /**
     * - Database configuration reuse key needed by the checkout.
     */
    reuseKey: string;
    /**
     * - Resolves with an activated connection.
     */
    resolve: (connection: import("../drivers/base.js").default) => void;
    /**
     * - Rejects when checkout cannot complete.
     */
    reject: (error: Error) => void;
    /**
     * - Timestamp when the checkout will time out, or null when disabled.
     */
    timeoutAt: number | null;
    /**
     * - Milliseconds to wait before rejecting, or null when disabled.
     */
    timeoutMillis: number | null;
    /**
     * - Timer that rejects the pending checkout.
     */
    timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * - Database-access scope captured at enqueue.
     */
    testDatabaseAccessScope?: {
        revoked: boolean;
    } | undefined;
    /**
     * - Async-safe profile attribution captured at enqueue.
     */
    testProfileContext?: import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined;
};
/**
 * PendingCheckout type.
 * @typedef {object} PendingCheckout
 * @property {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database configuration needed by the checkout.
 * @property {number} enqueuedAt - Timestamp when the checkout started waiting.
 * @property {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
 * @property {string} reuseKey - Database configuration reuse key needed by the checkout.
 * @property {(connection: import("../drivers/base.js").default) => void} resolve - Resolves with an activated connection.
 * @property {(error: Error) => void} reject - Rejects when checkout cannot complete.
 * @property {number | null} timeoutAt - Timestamp when the checkout will time out, or null when disabled.
 * @property {number | null} timeoutMillis - Milliseconds to wait before rejecting, or null when disabled.
 * @property {ReturnType<typeof setTimeout> | undefined} timeoutTimer - Timer that rejects the pending checkout.
 * @property {{revoked: boolean} | undefined} [testDatabaseAccessScope] - Database-access scope captured at enqueue.
 * @property {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} [testProfileContext] - Async-safe profile attribution captured at enqueue.
 */
export declare const CLOSED_CONNECTION: unique symbol;
export default class VelociousDatabasePoolAsyncTrackedMultiConnection extends BasePool {
    _withoutCurrentConnectionContext: (callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>;
    /**
     * Global fallback connections keyed by configuration instance and pool identifier.
     * @type {WeakMap<import("../../configuration.js").default, Record<string, import("../drivers/base.js").default>>}
     */
    static globalConnections: WeakMap<import("../../configuration.js").default, Record<string, import("../drivers/base.js").default>>;
    asyncLocalStorage: AsyncLocalStorage<any>;
    /**
     * When set, returned by getCurrentContextConnection when no async context exists.
     * Used by the test runner to share a connection between test code and HTTP handlers
     * running in the same process (in-process test server mode).
     * @type {import("../drivers/base.js").default | undefined}
     */
    _testSharedConnection: import("../drivers/base.js").default | undefined;
    /**
     * Dynamically resolves the connection eligible for in-process test request sharing.
     * @type {(() => import("../drivers/base.js").default | undefined) | undefined}
     */
    _testSharedConnectionProvider: (() => import("../drivers/base.js").default | undefined) | undefined;
    /**
     * Identifies the lifecycle that installed the current shared connection or provider.
     * @type {import("./base.js").TestSharedConnectionRegistration | undefined}
     */
    _testSharedConnectionRegistration: import("./base.js").TestSharedConnectionRegistration | undefined;
    /** Attempt-owned shared connections keyed by resolved physical configuration. */
    _testSharedConnectionsByReuseKey: Map<any, any>;
    /**
     * Concurrent providers selected by live async join context.
     * @type {Map<import("./base.js").TestSharedConnectionRegistration, {matches: () => boolean, provider: () => import("../drivers/base.js").default | undefined}>}
     */
    _testSharedConnectionProviders: Map<import("./base.js").TestSharedConnectionRegistration, {
        matches: () => boolean;
        provider: () => import("../drivers/base.js").default | undefined;
    }>;
    /**
     * Connections.
     * @type {import("../drivers/base.js").default[]} */
    connections: import("../drivers/base.js").default[];
    /**
     * Physical identities requested to remain resident by the frontend tenant lifecycle.
     * @type {Set<string>}
     */
    lifecycleRetainedReuseKeys: Set<string>;
    /**
     * Parked lifecycle-owned connections keyed by physical identity.
     * @type {Map<string, import("../drivers/base.js").default>}
     */
    lifecycleRetainedConnections: Map<string, import("../drivers/base.js").default>;
    /**
     * Connections in use.
     * @type {Record<number, import("../drivers/base.js").default>} */
    connectionsInUse: Record<number, import("../drivers/base.js").default>;
    /**
     * Pending checkouts.
     * @type {PendingCheckout[]} */
    pendingCheckouts: PendingCheckout[];
    /**
     * Connections being spawned.
     * @type {number} */
    connectionsBeingSpawned: number;
    /**
     * Pending checkout drain promise.
     * @type {Promise<void> | undefined} */
    pendingCheckoutDrainPromise: Promise<void> | undefined;
    /** Whether a caller requested another pass through the pending checkout queue. */
    pendingCheckoutDrainRequested: boolean;
    /**
     * Idle connection reaper timer.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    idleConnectionReaperTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * In-flight connection-close promises. The idle reaper is armed on check-in
     * and runs fire-and-forget when its timer fires, so a scheduled reap can be
     * closing a connection while an explicit `reapIdleConnections()` (or
     * `clearIdleConnectionReaperTimer()`) runs. Tracking the in-flight closes lets
     * those callers await them, so once a reap resolves the connections it
     * expired are fully closed instead of half-closed mid-`close()`.
     * @type {Set<Promise<void>>}
     */
    inflightConnectionCloses: Set<Promise<void>>;
    /**
     * In-flight close promise per connection, so concurrent closes of the same
     * connection await the same close rather than closing the driver handle twice.
     * @type {WeakMap<object, Promise<void>>}
     */
    connectionClosePromises: WeakMap<object, Promise<void>>;
    /** Cumulative low-cardinality pool telemetry. */
    telemetry: {
        connectionCreationCount: number;
        connectionCreationFailureCount: number;
        connectionCreationMaxMs: number;
        connectionCreationTotalMs: number;
        checkoutTimeoutCount: number;
        checkoutWaitCount: number;
        checkoutWaitMaxMs: number;
        checkoutWaitTotalMs: number;
        idleReapCount: number;
        idleReapDisposalCount: number;
        idleReapFailureCount: number;
        idleReapMaxMs: number;
        idleReapTotalMs: number;
        peakLiveConnections: number;
    };
    idSeq: number;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.identifier - Identifier.
     */
    constructor({ configuration, identifier }: {
        configuration: import("../../configuration.js").default;
        identifier: string;
    });
    /**
     * Returns the pool telemetry clock.
     * @returns {number} - Current time in milliseconds.
     */
    nowMs(): number;
    /**
     * Records a pool metric in the active async-safe test profile context.
     * @param {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} context - Captured profile context.
     * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
     * @param {{durationMs?: number, failed?: boolean, value?: number}} [values] - Aggregate values.
     * @returns {void}
     */
    recordTestProfilePoolMetric(context: import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined, metric: "connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections", values?: {
        durationMs?: number;
        failed?: boolean;
        value?: number;
    }): void;
    /**
     * Spawns and times a physical connection without retaining its configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Resolved database configuration.
     * @param {string} [reuseKey] - Exact resolved physical identity.
     * @returns {Promise<import("../drivers/base.js").default>} - Connected driver.
     */
    spawnConnectionWithConfiguration(config: import("../../configuration-types.js").DatabaseConfigurationType, reuseKey?: string): Promise<import("../drivers/base.js").default>;
    /**
     * Runs checkin.
     * @param {import("../drivers/base.js").default} connection - Database connection instance.
     * @returns {Promise<void>} - Resolves when the connection is checked in or closed.
     */
    checkin(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Permanently removes and closes a checked-out connection.
     * @param {import("../drivers/base.js").default} connection - Connection that must not return to the pool.
     */
    discard(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs close checked out connection after checkin failure.
     * @param {import("../drivers/base.js").default} connection - Connection that failed check-in cleanup.
     * @param {number | undefined} id - Connection checkout id.
     * @param {ReturnType<typeof JSON.parse>} originalError - Error that caused check-in cleanup to fail.
     * @returns {Promise<void>} - Resolves when cleanup has been attempted.
     */
    closeCheckedOutConnectionAfterCheckinFailure(connection: import("../drivers/base.js").default, id: number | undefined, originalError: ReturnType<typeof JSON.parse>): Promise<void>;
    /**
     * Runs untrack connection in use.
     * @param {import("../drivers/base.js").default} connection - Connection being checked in.
     * @param {number | undefined} id - Connection checkout id.
     * @returns {void}
     */
    untrackConnectionInUse(connection: import("../drivers/base.js").default, id: number | undefined): void;
    /**
     * Runs handle checked in idle connection.
     * @returns {Promise<void>} - Resolves once idle reaping has been scheduled or run.
     */
    handleCheckedInIdleConnection(): Promise<void>;
    /**
     * Runs checkout.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
     */
    checkout(options?: import("./base.js").ConnectionCheckoutOptions): Promise<import("../drivers/base.js").default>;
    /**
     * Checks out a connection for an already-resolved physical configuration
     * without consulting ambient tenant state.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Captured database configuration.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Activated pooled connection.
     */
    checkoutForConfiguration(databaseConfig: import("../../configuration-types.js").DatabaseConfigurationType, options?: import("./base.js").ConnectionCheckoutOptions): Promise<import("../drivers/base.js").default>;
    /**
     * Runs take idle connection for reuse key.
     * @param {string} reuseKey - Database configuration reuse key.
     * @param {object} [args] - Options.
     * @param {boolean} [args.includeOpenTransactions] - Whether connections with open transactions may be returned.
     * @returns {import("../drivers/base.js").default | undefined} - Matching idle connection.
     */
    takeIdleConnectionForReuseKey(reuseKey: string, { includeOpenTransactions }?: {
        includeOpenTransactions?: boolean;
    }): import("../drivers/base.js").default | undefined;
    /**
     * Runs connection matches reuse key.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @param {string} reuseKey - Database configuration reuse key.
     * @returns {boolean} - Whether the connection matches the reuse key.
     */
    connectionMatchesReuseKey(connection: import("../drivers/base.js").default, reuseKey: string): boolean;
    /**
     * Runs activate connection.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Activated connection.
     */
    activateConnection(connection: import("../drivers/base.js").default, options?: import("./base.js").ConnectionCheckoutOptions): Promise<import("../drivers/base.js").default>;
    /**
     * Closes a rejected checkout, then hands freed capacity to queued callers.
     * @param {import("../drivers/base.js").default} connection - Rejected connection.
     * @param {ReturnType<typeof JSON.parse>} error - Access revocation error.
     * @param {number} [id] - Assigned checkout id, if activation reached that stage.
     * @returns {Promise<never>} - Always rejects with the access or cleanup errors.
     */
    closeRejectedCheckoutAndThrow(connection: import("../drivers/base.js").default, error: ReturnType<typeof JSON.parse>, id?: number): Promise<never>;
    /**
     * Runs max connections.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfig] - Configuration whose pool maximum applies.
     * @returns {number | null} - Configured max live connections.
     */
    maxConnections(databaseConfig?: import("../../configuration-types.js").DatabaseConfigurationType): number | null;
    /**
     * Runs checkout timeout millis.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfig] - Configuration whose timeout applies.
     * @returns {number | null} - Pending checkout timeout in milliseconds, or null when disabled.
     */
    checkoutTimeoutMillis(databaseConfig?: import("../../configuration-types.js").DatabaseConfigurationType): number | null;
    /**
     * Runs valid checkout timeout millis.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate checkout timeout.
     * @returns {value is number} - Whether the value is a valid timeout.
     */
    validCheckoutTimeoutMillis(value: ReturnType<typeof JSON.parse>): value is number;
    /**
     * Runs valid max connections.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate max connection count.
     * @returns {value is number} - Whether the value is a valid max connection count.
     */
    validMaxConnections(value: ReturnType<typeof JSON.parse>): value is number;
    /**
     * Runs live connection count.
     * @returns {number} - Number of live and in-progress connections.
     */
    liveConnectionCount(): number;
    /**
     * Runs can spawn connection.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfig] - Configuration whose pool maximum applies.
     * @returns {boolean} - Whether a new connection can be spawned.
     */
    canSpawnConnection(databaseConfig?: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    /**
     * Runs spawn connection for checkout.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database config for the checkout.
     * @param {string} reuseKey - Database configuration reuse key for the checkout.
     * @param {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} profileContext - Profile context captured when checkout began.
     * @returns {Promise<import("../drivers/base.js").default>} - Spawned connection.
     */
    spawnConnectionForCheckout(databaseConfig: import("../../configuration-types.js").DatabaseConfigurationType, reuseKey: string, profileContext: import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined): Promise<import("../drivers/base.js").default>;
    /**
     * Runs wait for checkout.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database config for the checkout.
     * @param {string} reuseKey - Database configuration reuse key.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with an activated connection.
     */
    waitForCheckout(databaseConfig: import("../../configuration-types.js").DatabaseConfigurationType, reuseKey: string, options?: import("./base.js").ConnectionCheckoutOptions): Promise<import("../drivers/base.js").default>;
    /**
     * Runs drain pending checkouts.
     * @returns {Promise<void>} - Resolves when pending checkouts have been drained as far as possible.
     */
    drainPendingCheckouts(): Promise<void>;
    /**
     * Starts the single checkout-drain owner. The shared promise is cleared before
     * it settles, closing the resolved-promise/stale-field interval in which a new
     * request could otherwise be lost.
     * @returns {void}
     */
    startPendingCheckoutDrain(): void;
    /**
     * Runs drain passes until every request observed during the active pass has
     * received a later pass.
     * @param {{reject: (reason?: ReturnType<typeof JSON.parse>) => void, resolve: (value?: void) => void}} deferred - Shared drain settlement.
     * @returns {Promise<void>}
     */
    runRequestedPendingCheckoutDrains({ reject, resolve }: {
        reject: (reason?: ReturnType<typeof JSON.parse>) => void;
        resolve: (value?: void) => void;
    }): Promise<void>;
    /**
     * Runs drain pending checkouts actual.
     * @returns {Promise<void>} - Resolves when pending checkouts have been drained as far as possible.
     */
    drainPendingCheckoutsActual(): Promise<void>;
    /**
     * Runs resolve pending checkout with matching idle connection.
     * @returns {Promise<boolean>} - Whether a pending checkout was resolved with an idle connection.
     */
    resolvePendingCheckoutWithMatchingIdleConnection(): Promise<boolean>;
    /**
     * Runs remove pending checkout at.
     * @param {number} index - Pending checkout index.
     * @returns {PendingCheckout} - Removed checkout.
     */
    removePendingCheckoutAt(index: number): PendingCheckout;
    /**
     * Records a completed queue wait without retaining per-checkout labels or samples.
     * @param {PendingCheckout} checkout - Checkout leaving the pending queue.
     * @returns {void}
     */
    recordCheckoutWait(checkout: PendingCheckout): void;
    /**
     * Runs start pending checkout timeout.
     * @param {PendingCheckout} checkout - Pending checkout to time out.
     * @returns {ReturnType<typeof setTimeout> | undefined} - Timer, if timeout is enabled.
     */
    startPendingCheckoutTimeout(checkout: PendingCheckout): ReturnType<typeof setTimeout> | undefined;
    /**
     * Runs timeout pending checkout.
     * @param {PendingCheckout} checkout - Pending checkout to reject.
     * @returns {void}
     */
    timeoutPendingCheckout(checkout: PendingCheckout): void;
    /**
     * Runs pending checkout timeout error.
     * @param {PendingCheckout} checkout - Timed-out checkout.
     * @returns {DatabasePoolCheckoutTimeoutError} - Timeout error.
     */
    pendingCheckoutTimeoutError(checkout: PendingCheckout): DatabasePoolCheckoutTimeoutError;
    /**
     * Builds sanitized diagnostics for a checkout timeout.
     * @param {PendingCheckout} checkout - Timed-out checkout.
     * @returns {string} - Pool state summary.
     */
    pendingCheckoutTimeoutDiagnostics(checkout: PendingCheckout): string;
    /**
     * Builds a sanitized connection summary for checkout timeout diagnostics.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} connection - Connection debug snapshot.
     * @returns {string} - Sanitized connection state.
     */
    pendingCheckoutTimeoutConnectionSummary(connection: Record<string, ReturnType<typeof JSON.parse>>): string;
    /**
     * Builds a sanitized pending checkout summary for checkout timeout diagnostics.
     * @param {import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot} pendingCheckout - Waiting checkout snapshot.
     * @returns {string} - Sanitized pending checkout state.
     */
    pendingCheckoutTimeoutPendingSummary(pendingCheckout: import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot): string;
    /**
     * Runs clear pending checkout timeout.
     * @param {PendingCheckout} checkout - Pending checkout.
     * @returns {void}
     */
    clearPendingCheckoutTimeout(checkout: PendingCheckout): void;
    /**
     * Runs close idle connection for pending checkout capacity.
     * @param {PendingCheckout} checkout - Checkout waiting for a connection.
     * @returns {Promise<boolean>} - Whether an idle connection was closed to free capacity.
     */
    closeIdleConnectionForPendingCheckoutCapacity(checkout: PendingCheckout): Promise<boolean>;
    /**
     * Runs find idle connection for reuse key.
     * @param {string} reuseKey - Database configuration reuse key.
     * @returns {import("../drivers/base.js").default | undefined} - Matching idle connection, if present.
     */
    findIdleConnectionForReuseKey(reuseKey: string): import("../drivers/base.js").default | undefined;
    /**
     * Runs idle connection for pending checkout.
     * @param {PendingCheckout} checkout - Checkout waiting for a connection.
     * @returns {Promise<import("../drivers/base.js").default | undefined>} - Matching idle connection, if one can be reused.
     */
    idleConnectionForPendingCheckout(checkout: PendingCheckout): Promise<import("../drivers/base.js").default | undefined>;
    /**
     * Runs spawn and resolve pending checkout.
     * @param {PendingCheckout} checkout - Checkout request to resolve.
     * @returns {Promise<void>} - Resolves when the checkout has been handled.
     */
    spawnAndResolvePendingCheckout(checkout: PendingCheckout): Promise<void>;
    /**
     * Runs resolve pending checkout.
     * @param {PendingCheckout} checkout - Checkout request to resolve.
     * @param {import("../drivers/base.js").default} connection - Connection to activate.
     * @returns {Promise<void>} - Resolves when the checkout has been handled.
     */
    resolvePendingCheckout(checkout: PendingCheckout, connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs close one idle connection for capacity.
     * @returns {Promise<boolean>} - Whether an idle connection was closed to free capacity.
     */
    closeOneIdleConnectionForCapacity(): Promise<boolean>;
    /**
     * Runs with connection.
     * @template T
     * @param {import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} optionsOrCallback - Checkout options or callback to invoke with the connection.
     * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [callback] - Callback to invoke with the connection.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withConnection<T>(optionsOrCallback: import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>), callback?: (arg: import("../drivers/base.js").default) => Promise<T>): Promise<T>;
    openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    /**
     * Runs a captured operation through the normal bounded pool lifecycle.
     * @template T
     * @param {import("./base.js").CapturedConnectionOptions} options - Captured checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    withCapturedOperationConnection<T>({ databaseConfiguration, name }: import("./base.js").CapturedConnectionOptions, callback: (connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>): Promise<T>;
    /**
     * Runs get current connection.
     * @returns {import("../drivers/base.js").default} - The current connection.
     */
    getCurrentConnection(): import("../drivers/base.js").default;
    /**
     * Runs current fallback connection or fail.
     * @returns {import("../drivers/base.js").default} - Fallback connection, if present.
     */
    currentFallbackConnectionOrFail(): import("../drivers/base.js").default;
    /**
     * Runs ensure connection is in use.
     * @param {number} id - Checked-out connection id.
     * @returns {void}
     */
    ensureConnectionIsInUse(id: number): void;
    /**
     * Registers a fallback connection for this pool identifier that will be used when no async context is available.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {void} - No return value.
     */
    setGlobalConnection(connection: import("../drivers/base.js").default): void;
    /**
     * Ensures a global fallback connection exists for this pool identifier and returns it.
     * If one is already set, it is returned and also made available in the pool queue.
     * Otherwise a new connection is spawned, registered, and queued.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the global connection.
     */
    ensureGlobalConnection(): Promise<import("../drivers/base.js").default>;
    /**
     * Set a shared connection for test mode so that HTTP handlers running
     * in the same process can reuse the test runner's database connection.
     * @param {import("../drivers/base.js").default} connection - Shared connection.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnection(connection: import("../drivers/base.js").default): import("./base.js").TestSharedConnectionRegistration;
    /**
     * Sets a provider that is evaluated when an in-process test request is dispatched.
     * @param {() => import("../drivers/base.js").default | undefined} provider - Shared connection provider.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnectionProvider(provider: () => import("../drivers/base.js").default | undefined): import("./base.js").TestSharedConnectionRegistration;
    /**
     * Registers a provider selected by the current live async join context.
     * @param {{matches: () => boolean, provider: () => import("../drivers/base.js").default | undefined}} args - Context selector and provider.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque scoped registration handle.
     */
    registerTestSharedConnectionProvider(args: {
        matches: () => boolean;
        provider: () => import("../drivers/base.js").default | undefined;
    }): import("./base.js").TestSharedConnectionRegistration;
    /**
     * Registers an attempt-owned connection for exactly one physical configuration.
     * @param {import("../drivers/base.js").default} connection - Attempt-owned connection.
     * @param {string} reuseKey - Resolved physical configuration identity.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnectionForConfiguration(connection: import("../drivers/base.js").default, reuseKey: string): import("./base.js").TestSharedConnectionRegistration;
    /**
     * Clears the current shared connection registration. A supplied stale registration
     * cannot clear a provider installed by a newer lifecycle.
     * @param {import("./base.js").TestSharedConnectionRegistration} [registration] - Opaque registration handle to clear conditionally.
     * @returns {void} */
    clearTestSharedConnection(registration?: import("./base.js").TestSharedConnectionRegistration): void;
    /**
     * Runs a callback inside the test shared connection's async context, so nested
     * `getCurrentConnection`/`ensureConnections` reuse it (with a real context) rather
     * than checking out a fresh pooled connection. Used to run an in-process request
     * handler on the same connection — and open transaction — as the test body. No-op
     * (runs the callback as-is) when no shared connection is set.
     * @template T
     * @param {() => T} callback - Callback to run in the shared connection's context.
     * @returns {T} - Callback result.
     */
    runWithTestSharedConnection<T>(callback: () => T): T;
    /**
     * Resolves a test-shared connection only while its checkout ID is still owned by this pool.
     * Fallback-only registrations have no checkout ID and must enter the normal checkout path.
     * @returns {import("../drivers/base.js").default | undefined} - Active shared connection.
     */
    activeTestSharedConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Resolves the connection currently eligible for in-process test request sharing.
     * @returns {import("../drivers/base.js").default | undefined} - Shared connection.
     */
    testSharedConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Returns the connection tied to the current async context, if any.
     * Falls back to the test shared connection when no async context exists.
     * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
     */
    getCurrentContextConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Returns whether this pool has a real async context for the current connection.
     * @returns {boolean} - Whether nested code can reuse the current connection context.
     */
    hasCurrentConnectionContext(): boolean;
    /**
     * Runs get debug snapshot.
     * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
     */
    getDebugSnapshot(): import("./base.js").DatabasePoolDebugSnapshot;
    /**
     * Runs debug connection snapshots.
     * @param {number} now - Current timestamp.
     * @returns {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, seenConnections: Set<import("../drivers/base.js").default>}} - Connection snapshots and seen set.
     */
    debugConnectionSnapshots(now: number): {
        connections: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        seenConnections: Set<import("../drivers/base.js").default>;
    };
    /**
     * Runs add in use debug connection snapshots.
     * @param {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, now: number, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
     * @returns {void}
     */
    addInUseDebugConnectionSnapshots({ connections, now, seenConnections }: {
        connections: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        now: number;
        seenConnections: Set<import("../drivers/base.js").default>;
    }): void;
    /**
     * Runs add idle debug connection snapshots.
     * @param {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, now: number, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
     * @returns {void}
     */
    addIdleDebugConnectionSnapshots({ connections, now, seenConnections }: {
        connections: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        now: number;
        seenConnections: Set<import("../drivers/base.js").default>;
    }): void;
    /**
     * Runs add fallback debug connection snapshots.
     * @param {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
     * @returns {void}
     */
    addFallbackDebugConnectionSnapshots({ connections, seenConnections }: {
        connections: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        seenConnections: Set<import("../drivers/base.js").default>;
    }): void;
    /**
     * Runs add debug connection snapshot if unseen.
     * @param {{connection: import("../drivers/base.js").default | undefined, connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, reapable?: boolean, seenConnections: Set<import("../drivers/base.js").default>, state: string}} args - Snapshot collection state.
     * @returns {void}
     */
    addDebugConnectionSnapshotIfUnseen({ connection, connections, reapable, seenConnections, state }: {
        connection: import("../drivers/base.js").default | undefined;
        connections: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        reapable?: boolean;
        seenConnections: Set<import("../drivers/base.js").default>;
        state: string;
    }): void;
    /**
     * Runs pending checkout debug snapshots.
     * @param {number} now - Current timestamp.
     * @returns {import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot[]} - Pending checkout snapshots.
     */
    pendingCheckoutDebugSnapshots(now: number): import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot[];
    /**
     * Runs get global connection.
     * @returns {import("../drivers/base.js").default | undefined} - The global connection.
     */
    getGlobalConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Runs get global connection for identifier.
     * @returns {import("../drivers/base.js").default | undefined} - The global connection for this pool identifier.
     */
    getGlobalConnectionForIdentifier(): import("../drivers/base.js").default | undefined;
    /**
     * Runs clear global connection for identifier.
     * @returns {void} - No return value.
     */
    clearGlobalConnectionForIdentifier(): void;
    /**
     * Clears schema metadata cached by every live connection owned by this pool.
     * @returns {void} - No return value.
     */
    clearSchemaCache(): void;
    /**
     * Runs idle timeout millis.
     * @returns {number | null} - Idle timeout in milliseconds, or null when disabled.
     */
    idleTimeoutMillis(): number | null;
    /**
     * Runs valid idle timeout millis.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate idle timeout value.
     * @returns {value is number} - Whether the value is a valid idle timeout.
     */
    validIdleTimeoutMillis(value: ReturnType<typeof JSON.parse>): value is number;
    /**
     * Runs schedule idle connection reaper.
     * @returns {void} */
    scheduleIdleConnectionReaper(): void;
    /**
     * Runs has idle connections to reap.
     * @returns {boolean} - Whether an idle reaper timer should be scheduled.
     */
    hasIdleConnectionsToReap(): boolean;
    /**
     * Runs next idle connection reap delay.
     * @param {number} idleTimeoutMillis - Idle timeout in milliseconds.
     * @returns {number} - Delay before the next reap.
     */
    nextIdleConnectionReapDelay(idleTimeoutMillis: number): number;
    /**
     * Closes idle checked-in connections that have exceeded the configured timeout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    reapIdleConnections(): Promise<void>;
    /**
     * Runs close expired idle connections.
     * @param {import("../drivers/base.js").default[]} expiredConnections - Connections to close.
     * @param {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} [profileContext] - Reaper profile context.
     * @returns {Promise<void>} - Resolves when closed.
     */
    closeExpiredIdleConnections(expiredConnections: import("../drivers/base.js").default[], profileContext?: import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined): Promise<void>;
    /**
     * Runs await inflight connection closes.
     * @returns {Promise<void>} - Resolves once in-flight connection closes settle.
     */
    awaitInflightConnectionCloses(): Promise<void>;
    /**
     * Runs classify idle connections for reaping.
     * @param {{idleTimeoutMillis: number, now: number}} args - Reaper classification inputs.
     * @returns {{expiredConnections: import("../drivers/base.js").default[], keptConnections: import("../drivers/base.js").default[]}} - Classified idle connections.
     */
    classifyIdleConnectionsForReaping({ idleTimeoutMillis, now }: {
        idleTimeoutMillis: number;
        now: number;
    }): {
        expiredConnections: import("../drivers/base.js").default[];
        keptConnections: import("../drivers/base.js").default[];
    };
    /**
     * Runs classify idle connection for reaping.
     * @param {{connection: import("../drivers/base.js").default, expiredConnections: import("../drivers/base.js").default[], idleTimeoutMillis: number, keptConnections: import("../drivers/base.js").default[], now: number}} args - Classification state.
     * @returns {void}
     */
    classifyIdleConnectionForReaping({ connection, expiredConnections, idleTimeoutMillis, keptConnections, now }: {
        connection: import("../drivers/base.js").default;
        expiredConnections: import("../drivers/base.js").default[];
        idleTimeoutMillis: number;
        keptConnections: import("../drivers/base.js").default[];
        now: number;
    }): void;
    /**
     * Runs connection is closed.
     * @param {import("../drivers/base.js").default} connection - Connection to inspect.
     * @returns {boolean} - Whether the connection is marked closed.
     */
    connectionIsClosed(connection: import("../drivers/base.js").default): boolean;
    /**
     * Runs idle connection expired.
     * @param {{connection: import("../drivers/base.js").default, idleTimeoutMillis: number, now: number}} args - Expiry inputs.
     * @returns {boolean} - Whether the idle connection expired.
     */
    idleConnectionExpired({ connection, idleTimeoutMillis, now }: {
        connection: import("../drivers/base.js").default;
        idleTimeoutMillis: number;
        now: number;
    }): boolean;
    /**
     * Runs connection has open transaction.
     * @param {import("../drivers/base.js").default} connection - Connection to inspect.
     * @returns {boolean} - Whether the connection has an open transaction.
     */
    connectionHasOpenTransaction(connection: import("../drivers/base.js").default): boolean;
    /**
     * Rolls back any transaction a previous holder left open before a connection
     * re-enters the idle pool. A connection returned to the pool with an open
     * transaction would otherwise be handed to an unrelated checkout, whose
     * startTransaction() then fails with "A transaction is already running" and
     * poisons every following caller that reuses it.
     * @param {import("../drivers/base.js").default} connection - Connection being checked in.
     * @returns {Promise<void>} - Resolves when the connection holds no open transaction.
     */
    rollbackLeftOpenTransaction(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs close connection.
     * @param {import("../drivers/base.js").default} connection - Connection to close.
     * @returns {Promise<void>} - Resolves when complete.
     */
    closeConnection(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs clear idle connection reaper timer.
     * @returns {void} */
    clearIdleConnectionReaperTimer(): void;
    /**
     * Closes all active and cached connections for this pool.
     * @returns {Promise<void>} - Resolves when complete.
     */
    closeAll(): Promise<void>;
    /**
     * Runs reject pending checkouts.
     * @param {Error} error - Error to reject pending checkouts with.
     * @returns {void}
     */
    rejectPendingCheckouts(error: Error): void;
    /**
     * Replaces all globally registered fallback connections.
     * @param {Record<string, import("../drivers/base.js").default>} [connections] - Connections.
     * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
     * @returns {void} - No return value.
     */
    static setGlobalConnections(connections?: Record<string, import("../drivers/base.js").default>, configuration?: import("../../configuration.js").default): void;
    /**
     * Clears globally registered fallback connections for all configurations or a single configuration.
     * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
     * @returns {void} - No return value.
     */
    static clearGlobalConnections(configuration?: import("../../configuration.js").default): void;
}
//# sourceMappingURL=async-tracked-multi-connection.d.ts.map