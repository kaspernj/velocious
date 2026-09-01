import Configuration from "../../configuration.js";
import Logger from "../../logger.js";
export type TestSharedConnectionRegistration = {
    owner: symbol;
};
export type ConnectionCheckoutOptions = {
    /**
     * - Human-readable name for the checked-out connection.
     */
    name?: string;
};
export type CapturedConnectionOptions = {
    /**
     * - Resolved physical database configuration captured by the caller.
     */
    databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType;
    /**
     * - Human-readable name for the checked-out connection.
     */
    name?: string;
};
export type DatabasePoolPendingCheckoutDebugSnapshot = {
    /**
     * - Human-readable checkout name.
     */
    checkoutName: string | undefined;
    /**
     * - Timestamp when the checkout started waiting.
     */
    enqueuedAt: number;
    /**
     * - Pending checkout queue index.
     */
    index: number;
    /**
     * - Milliseconds before the checkout times out, or null when disabled.
     */
    remainingTimeoutMs: number | null;
    /**
     * - Database configuration reuse key needed by the checkout.
     */
    reuseKey: string;
    /**
     * - Timestamp when the checkout will time out, or null when disabled.
     */
    timeoutAt: number | null;
    /**
     * - Timeout configured for the checkout, or null when disabled.
     */
    timeoutMillis: number | null;
    /**
     * - Milliseconds already spent waiting.
     */
    waitingForMs: number;
};
export type DatabasePoolDebugSnapshot = {
    /**
     * - Sanitized resolved database configuration.
     */
    configuration: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Live connection snapshots.
     */
    connections: Array<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * - Number of in-progress connection spawns.
     */
    connectionsBeingSpawned: number;
    /**
     * - Number of idle connections.
     */
    idleCount: number;
    /**
     * - Idle connections that can satisfy at least one pending checkout.
     */
    idleMatchingPendingCheckoutCount?: number;
    /**
     * - Database identifier.
     */
    identifier: string;
    /**
     * - Number of checked-out connections.
     */
    inUseCount: number;
    /**
     * - Waiting checkout snapshots.
     */
    pendingCheckouts?: Array<DatabasePoolPendingCheckoutDebugSnapshot>;
    /**
     * - Number of queued checkout requests.
     */
    pendingCheckoutCount: number;
    /**
     * - Whether a checkout drain pass is active.
     */
    pendingCheckoutDrainActive?: boolean;
    /**
     * - Whether another checkout drain pass was requested.
     */
    pendingCheckoutDrainRequested?: boolean;
    /**
     * - Pool class name.
     */
    poolClass: string;
    /**
     * - Cumulative pool lifecycle telemetry.
     */
    telemetry?: {
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
};
/**
 * Opaque ownership handle for an in-process test shared connection registration.
 * @typedef {{owner: symbol}} TestSharedConnectionRegistration
 */
/**
 * ConnectionCheckoutOptions type.
 * @typedef {object} ConnectionCheckoutOptions
 * @property {string} [name] - Human-readable name for the checked-out connection.
 */
/**
 * CapturedConnectionOptions type.
 * @typedef {object} CapturedConnectionOptions
 * @property {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Resolved physical database configuration captured by the caller.
 * @property {string} [name] - Human-readable name for the checked-out connection.
 */
/**
 * DatabasePoolPendingCheckoutDebugSnapshot type.
 * @typedef {object} DatabasePoolPendingCheckoutDebugSnapshot
 * @property {string | undefined} checkoutName - Human-readable checkout name.
 * @property {number} enqueuedAt - Timestamp when the checkout started waiting.
 * @property {number} index - Pending checkout queue index.
 * @property {number | null} remainingTimeoutMs - Milliseconds before the checkout times out, or null when disabled.
 * @property {string} reuseKey - Database configuration reuse key needed by the checkout.
 * @property {number | null} timeoutAt - Timestamp when the checkout will time out, or null when disabled.
 * @property {number | null} timeoutMillis - Timeout configured for the checkout, or null when disabled.
 * @property {number} waitingForMs - Milliseconds already spent waiting.
 */
/**
 * DatabasePoolDebugSnapshot type.
 * @typedef {object} DatabasePoolDebugSnapshot
 * @property {Record<string, ReturnType<typeof JSON.parse>>} configuration - Sanitized resolved database configuration.
 * @property {Array<Record<string, ReturnType<typeof JSON.parse>>>} connections - Live connection snapshots.
 * @property {number} connectionsBeingSpawned - Number of in-progress connection spawns.
 * @property {number} idleCount - Number of idle connections.
 * @property {number} [idleMatchingPendingCheckoutCount] - Idle connections that can satisfy at least one pending checkout.
 * @property {string} identifier - Database identifier.
 * @property {number} inUseCount - Number of checked-out connections.
 * @property {Array<DatabasePoolPendingCheckoutDebugSnapshot>} [pendingCheckouts] - Waiting checkout snapshots.
 * @property {number} pendingCheckoutCount - Number of queued checkout requests.
 * @property {boolean} [pendingCheckoutDrainActive] - Whether a checkout drain pass is active.
 * @property {boolean} [pendingCheckoutDrainRequested] - Whether another checkout drain pass was requested.
 * @property {string} poolClass - Pool class name.
 * @property {{connectionCreationCount: number, connectionCreationFailureCount: number, connectionCreationMaxMs: number, connectionCreationTotalMs: number, checkoutTimeoutCount: number, checkoutWaitCount: number, checkoutWaitMaxMs: number, checkoutWaitTotalMs: number, idleReapCount: number, idleReapDisposalCount: number, idleReapFailureCount: number, idleReapMaxMs: number, idleReapTotalMs: number, peakLiveConnections: number}} [telemetry] - Cumulative pool lifecycle telemetry.
 */
export declare const POOL_CONFIGURATION_KEY: unique symbol;
declare class VelociousDatabasePoolBase {
    configuration: Configuration;
    identifier: string;
    logger: Logger;
    driverClass: typeof import("../drivers/base.js").default | undefined;
    /**
     * Without current connection context.
     * @type {undefined | ((callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>)} */
    _withoutCurrentConnectionContext: undefined | ((callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>);
    /**
     * Runs current.
     * @returns {VelociousDatabasePoolBase} - The current.
     */
    static current(): VelociousDatabasePoolBase;
    /**
     * Clears any global connections for the given configuration.
     * @param {import("../../configuration.js").default} configuration - Configuration owning the pool.
     * @returns {void} - No return value.
     */
    static clearGlobalConnections(configuration: import("../../configuration.js").default): void;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Configuration} args.configuration - Configuration instance.
     * @param {string} args.identifier - Identifier.
     */
    constructor({ configuration, identifier }: {
        configuration: Configuration;
        identifier: string;
    });
    /** Throws when a revoked test attempt tries to acquire database access. */
    assertDatabaseAccessAllowed(): void;
    /**
     * Runs checkin.
     * @abstract
     * @param {import("../drivers/base.js").default} _connection - Connection.
     */
    checkin(_connection: import("../drivers/base.js").default): void;
    /**
     * Permanently discards an attempt-owned checked-out connection.
     * @abstract
     * @param {import("../drivers/base.js").default} _connection - Connection that must not return to the pool.
     * @returns {Promise<void>} - Resolves after the connection is closed and removed from pool ownership.
     */
    discard(_connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs checkout.
     * @abstract
     * @param {ConnectionCheckoutOptions} [_options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
     */
    checkout(_options?: ConnectionCheckoutOptions): Promise<import("../drivers/base.js").default>;
    /**
     * Runs get current connection.
     * @abstract
     * @returns {import("../drivers/base.js").default} - The current connection.
     */
    getCurrentConnection(): import("../drivers/base.js").default;
    /**
     * Returns the connection pinned to the current context, if any.
     * Default implementation defers to `getCurrentConnection`.
     * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
     */
    getCurrentContextConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Pins a connection to be returned to callers that run without a connection-context
     * pin (used by the test runner to share one connection with in-process HTTP handlers).
     * Base pools that do not track async context ignore it; async-context pools override.
     * @param {import("../drivers/base.js").default} _connection - Shared connection.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque registration handle when supported.
     */
    setTestSharedConnection(_connection: import("../drivers/base.js").default): TestSharedConnectionRegistration | undefined;
    /**
     * Sets a provider that resolves the connection eligible for in-process test request sharing.
     * Base pools that do not track async context ignore it; async-context pools override.
     * @param {() => import("../drivers/base.js").default | undefined} _provider - Shared connection provider.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque registration handle when supported.
     */
    setTestSharedConnectionProvider(_provider: () => import("../drivers/base.js").default | undefined): TestSharedConnectionRegistration | undefined;
    /**
     * Registers a test shared connection selected by the caller's live async context.
     * Base pools that do not track async context ignore it.
     * @param {{matches: () => boolean, provider: () => import("../drivers/base.js").default | undefined}} _args - Context selector and connection provider.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque scoped registration handle.
     */
    registerTestSharedConnectionProvider(_args: {
        matches: () => boolean;
        provider: () => import("../drivers/base.js").default | undefined;
    }): TestSharedConnectionRegistration | undefined;
    /**
     * Registers a test connection for one resolved physical database configuration.
     * @param {import("../drivers/base.js").default} _connection - Attempt-owned connection.
     * @param {string} _reuseKey - Resolved physical configuration identity.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque registration handle when supported.
     */
    setTestSharedConnectionForConfiguration(_connection: import("../drivers/base.js").default, _reuseKey: string): TestSharedConnectionRegistration | undefined;
    /**
     * Clears the shared connection or provider set for in-process test requests. No-op by default.
     * When a registration is provided, clears only if it is still the active registration.
     * @param {TestSharedConnectionRegistration} [_registration] - Opaque handle returned when the shared value was set.
     * @returns {void}
     */
    clearTestSharedConnection(_registration?: TestSharedConnectionRegistration): void;
    /**
     * Runs a callback inside the test shared connection's context. Base pools that do not
     * track async context just run the callback as-is; async-context pools override.
     * @template T
     * @param {() => T} callback - Callback to run.
     * @returns {T} - Callback result.
     */
    runWithTestSharedConnection<T>(callback: () => T): T;
    /**
     * Returns the connection registered for test-only in-process sharing.
     * Base pools do not need a separate shared connection.
     * @returns {import("../drivers/base.js").default | undefined} - Shared connection.
     */
    testSharedConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Returns whether the current connection is pinned to an execution context.
     * @returns {boolean} - Whether the current connection can be reused by nested code.
     */
    hasCurrentConnectionContext(): boolean;
    /**
     * Runs without current connection context.
     * @template T
     * @param {() => T} callback - Callback to run without ? current connection context.
     * @returns {T} - Callback result.
     */
    withoutCurrentConnectionContext<T>(callback: () => T): T;
    /**
     * Runs get configuration.
     * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the pool identifier.
     */
    getConfiguration(): import("../../configuration-types.js").DatabaseConfigurationType;
    /**
     * Runs get configuration reuse key.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfiguration] - Resolved configuration to identify.
     * @returns {string} - Reuse key for the currently resolved database configuration.
     */
    getConfigurationReuseKey(databaseConfiguration?: import("../../configuration-types.js").DatabaseConfigurationType): string;
    /**
     * Runs connection matches current configuration.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {boolean} - Whether connection matches current resolved configuration.
     */
    connectionMatchesCurrentConfiguration(connection: import("../drivers/base.js").default): boolean;
    /**
     * Returns the resolved database configuration key stamped on a connection at checkout.
     * @param {import("../drivers/base.js").default} connection - Checked-out connection.
     * @returns {string} - Connection configuration reuse key.
     */
    getConnectionConfigurationReuseKey(connection: import("../drivers/base.js").default): string;
    /**
     * Clears schema metadata cached by this pool's current connection.
     * Pools that keep multiple connections alive should override this to clear every live connection.
     * @returns {void} - No return value.
     */
    clearSchemaCache(): void;
    /**
     * Runs clear connection schema cache.
     * @param {import("../drivers/base.js").default} connection - Connection whose local schema cache should be cleared.
     * @returns {void} - No return value.
     */
    _clearConnectionSchemaCache(connection: import("../drivers/base.js").default): void;
    /**
     * Runs primary key type.
     * @abstract
     * @returns {string} - The primary key type.
     */
    primaryKeyType(): string;
    /**
     * Runs set current.
     * @returns {void} - No return value.
     */
    setCurrent(): void;
    /**
     * Runs set driver class.
     * @param {typeof import("../drivers/base.js").default} driverClass - Driver class.
     */
    setDriverClass(driverClass: typeof import("../drivers/base.js").default): void;
    /**
     * Runs spawn connection.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection.
     */
    spawnConnection(): Promise<import("../drivers/base.js").default>;
    /**
     * Spawns a connection for an already-resolved physical database configuration.
     * The reuse identity is derived only from that captured configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured resolved configuration.
     * @returns {Promise<import("../drivers/base.js").default>} - Connected and identity-stamped driver.
     */
    spawnConnectionForConfiguration(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<import("../drivers/base.js").default>;
    /**
     * Stamps a connected driver with its pool reuse identity and diagnostic-safe opaque identity.
     * @param {import("../drivers/base.js").default} connection - Connected driver.
     * @param {string} reuseKey - Exact physical configuration reuse key captured for this spawn.
     * @returns {void}
     */
    stampConnectionForConfigurationReuseKey(connection: import("../drivers/base.js").default, reuseKey: string): void;
    /**
     * Runs spawn connection with configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
     * @param {string} [reuseKey] - Exact resolved physical identity.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection with configuration.
     */
    spawnConnectionWithConfiguration(config: import("../../configuration-types.js").DatabaseConfigurationType, reuseKey?: string): Promise<import("../drivers/base.js").default>;
    /**
     * Checks out a connection for an already-resolved physical configuration.
     * Multi-configuration pools override this for explicit tenant registrations.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} _databaseConfiguration - Captured configuration.
     * @param {ConnectionCheckoutOptions} [_options] - Checkout options.
     * @param {{retain: boolean}} [_args] - Pool-specific retention behavior.
     * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
     */
    checkoutForConfiguration(_databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, _options?: ConnectionCheckoutOptions, _args?: {
        retain: boolean;
    }): Promise<import("../drivers/base.js").default>;
    /**
     * Runs close connection after failed connect.
     * @param {import("../drivers/base.js").default} connection - Connection to close.
     * @returns {Promise<void>} - Resolves when cleanup has been attempted.
     */
    closeConnectionAfterFailedConnect(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs with connection.
     * @template T
     * @abstract
     * @param {ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} _optionsOrCallback - Checkout options or callback function.
     * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [_callback] - Callback function.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withConnection<T>(_optionsOrCallback: ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>), _callback?: (arg: import("../drivers/base.js").default) => Promise<T>): Promise<T>;
    /**
     * Runs an operation on a freshly checked-out connection.
     * @template T
     * @param {ConnectionCheckoutOptions} options - Checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withOperationConnection<T>(options: ConnectionCheckoutOptions, callback: (connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>): Promise<T>;
    /**
     * Runs work through a pool-owned checkout for an immutable, already-resolved
     * physical configuration. Concrete pools must preserve their capacity,
     * timeout, queue, debug, and closeAll ownership on this path.
     * @template T
     * @param {CapturedConnectionOptions} options - Captured checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    withCapturedOperationConnection<T>(options: CapturedConnectionOptions, callback: (connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>): Promise<T>;
    openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    /**
     * Ensures a reusable connection exists for contexts where AsyncLocalStorage isn't set.
     * Default implementation just checks out a connection.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the global connection.
     */
    ensureGlobalConnection(): Promise<import("../drivers/base.js").default>;
    /**
     * Runs get debug snapshot.
     * @returns {DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
     */
    getDebugSnapshot(): DatabasePoolDebugSnapshot;
    /**
     * Runs debug configuration snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Sanitized resolved database configuration.
     */
    debugConfigurationSnapshot(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs debug connection snapshot.
     * @param {import("../drivers/base.js").default} connection - Database connection.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} details - Extra diagnostic fields.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Connection diagnostic snapshot.
     */
    debugConnectionSnapshot(connection: import("../drivers/base.js").default, details?: Record<string, ReturnType<typeof JSON.parse>>): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Closes all connections for this pool.
     * @returns {Promise<void>} - Resolves when complete.
     */
    closeAll(): Promise<void>;
}
export default VelociousDatabasePoolBase;
//# sourceMappingURL=base.d.ts.map