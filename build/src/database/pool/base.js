// @ts-check
import Configuration from "../../configuration.js";
import Logger from "../../logger.js";
import baseMethodsForward from "./base-methods-forward.js";
import sha256Hex from "../../utils/sha256-hex.js";
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
export const POOL_CONFIGURATION_KEY = Symbol("velociousPoolConfigurationKey");
/**
 * Shared.
 * @type {{currentPool: VelociousDatabasePoolBase | null}} */
const shared = {
    currentPool: null
};
/**
 * Runs stable stringify.
 * @param {ReturnType<typeof JSON.parse>} value - Value to stringify.
 * @returns {string} - Stable JSON string.
 */
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object
            .keys(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value))
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)[key])}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
}
class VelociousDatabasePoolBase {
    /**
     * Without current connection context.
     * @type {undefined | ((callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>)} */
    _withoutCurrentConnectionContext = undefined;
    /**
     * Runs current.
     * @returns {VelociousDatabasePoolBase} - The current.
     */
    static current() {
        if (!shared.currentPool)
            throw new Error("A database pool hasn't been set");
        return shared.currentPool;
    }
    /**
     * Clears any global connections for the given configuration.
     * @param {import("../../configuration.js").default} configuration - Configuration owning the pool.
     * @returns {void} - No return value.
     */
    static clearGlobalConnections(configuration) { void configuration; }
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Configuration} args.configuration - Configuration instance.
     * @param {string} args.identifier - Identifier.
     */
    constructor({ configuration, identifier }) {
        this.configuration = configuration || Configuration.current();
        if (!this.configuration)
            throw new Error("No configuration given");
        if (!identifier)
            throw new Error("No identifier was given");
        this.identifier = identifier;
        this.logger = new Logger(this);
    }
    /** Throws when a revoked test attempt tries to acquire database access. */
    assertDatabaseAccessAllowed() {
        this.configuration.assertDatabaseAccessAllowed();
    }
    /**
     * Runs checkin.
     * @abstract
     * @param {import("../drivers/base.js").default} _connection - Connection.
     */
    checkin(_connection) {
        throw new Error("'checkin' not implemented");
    }
    /**
     * Permanently discards an attempt-owned checked-out connection.
     * @abstract
     * @param {import("../drivers/base.js").default} _connection - Connection that must not return to the pool.
     * @returns {Promise<void>} - Resolves after the connection is closed and removed from pool ownership.
     */
    discard(_connection) {
        throw new Error("'discard' not implemented");
    }
    /**
     * Runs checkout.
     * @abstract
     * @param {ConnectionCheckoutOptions} [_options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
     */
    checkout(_options) {
        throw new Error("'checkout' not implemented");
    }
    /**
     * Runs get current connection.
     * @abstract
     * @returns {import("../drivers/base.js").default} - The current connection.
     */
    getCurrentConnection() {
        throw new Error("'getCurrentConnection' not implemented");
    }
    /**
     * Returns the connection pinned to the current context, if any.
     * Default implementation defers to `getCurrentConnection`.
     * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
     */
    getCurrentContextConnection() {
        return this.getCurrentConnection();
    }
    /**
     * Pins a connection to be returned to callers that run without a connection-context
     * pin (used by the test runner to share one connection with in-process HTTP handlers).
     * Base pools that do not track async context ignore it; async-context pools override.
     * @param {import("../drivers/base.js").default} _connection - Shared connection.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque registration handle when supported.
     */
    setTestSharedConnection(_connection) {
        return undefined;
    }
    /**
     * Sets a provider that resolves the connection eligible for in-process test request sharing.
     * Base pools that do not track async context ignore it; async-context pools override.
     * @param {() => import("../drivers/base.js").default | undefined} _provider - Shared connection provider.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque registration handle when supported.
     */
    setTestSharedConnectionProvider(_provider) {
        return undefined;
    }
    /**
     * Registers a test shared connection selected by the caller's live async context.
     * Base pools that do not track async context ignore it.
     * @param {{matches: () => boolean, provider: () => import("../drivers/base.js").default | undefined}} _args - Context selector and connection provider.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque scoped registration handle.
     */
    registerTestSharedConnectionProvider(_args) {
        return undefined;
    }
    /**
     * Registers a test connection for one resolved physical database configuration.
     * @param {import("../drivers/base.js").default} _connection - Attempt-owned connection.
     * @param {string} _reuseKey - Resolved physical configuration identity.
     * @returns {TestSharedConnectionRegistration | undefined} - Opaque registration handle when supported.
     */
    setTestSharedConnectionForConfiguration(_connection, _reuseKey) {
        return undefined;
    }
    /**
     * Clears the shared connection or provider set for in-process test requests. No-op by default.
     * When a registration is provided, clears only if it is still the active registration.
     * @param {TestSharedConnectionRegistration} [_registration] - Opaque handle returned when the shared value was set.
     * @returns {void}
     */
    clearTestSharedConnection(_registration) { }
    /**
     * Runs a callback inside the test shared connection's context. Base pools that do not
     * track async context just run the callback as-is; async-context pools override.
     * @template T
     * @param {() => T} callback - Callback to run.
     * @returns {T} - Callback result.
     */
    runWithTestSharedConnection(callback) {
        return callback();
    }
    /**
     * Returns the connection registered for test-only in-process sharing.
     * Base pools do not need a separate shared connection.
     * @returns {import("../drivers/base.js").default | undefined} - Shared connection.
     */
    testSharedConnection() {
        return undefined;
    }
    /**
     * Returns whether the current connection is pinned to an execution context.
     * @returns {boolean} - Whether the current connection can be reused by nested code.
     */
    hasCurrentConnectionContext() {
        return true;
    }
    /**
     * Runs without current connection context.
     * @template T
     * @param {() => T} callback - Callback to run without ? current connection context.
     * @returns {T} - Callback result.
     */
    withoutCurrentConnectionContext(callback) {
        if (this._withoutCurrentConnectionContext)
            return /** @type {T} */ (this._withoutCurrentConnectionContext(callback));
        return callback();
    }
    /**
     * Runs get configuration.
     * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the pool identifier.
     */
    getConfiguration() {
        return this.configuration.resolveDatabaseConfiguration(this.identifier);
    }
    /**
     * Runs get configuration reuse key.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfiguration] - Resolved configuration to identify.
     * @returns {string} - Reuse key for the currently resolved database configuration.
     */
    getConfigurationReuseKey(databaseConfiguration = this.getConfiguration()) {
        return stableStringify({
            database: databaseConfiguration.database,
            host: databaseConfiguration.host,
            name: databaseConfiguration.name,
            port: databaseConfiguration.port,
            schema: databaseConfiguration.schema,
            schemaCache: databaseConfiguration.schemaCache,
            sqlConfig: databaseConfiguration.sqlConfig,
            type: databaseConfiguration.type,
            useDatabase: databaseConfiguration.useDatabase,
            username: databaseConfiguration.username
        });
    }
    /**
     * Runs connection matches current configuration.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {boolean} - Whether connection matches current resolved configuration.
     */
    connectionMatchesCurrentConfiguration(connection) {
        return this.getConnectionConfigurationReuseKey(connection) === this.getConfigurationReuseKey();
    }
    /**
     * Returns the resolved database configuration key stamped on a connection at checkout.
     * @param {import("../drivers/base.js").default} connection - Checked-out connection.
     * @returns {string} - Connection configuration reuse key.
     */
    getConnectionConfigurationReuseKey(connection) {
        const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection);
        const reuseKey = connectionWithPoolKey[POOL_CONFIGURATION_KEY];
        if (!reuseKey)
            throw new Error("Database connection is missing its configuration reuse key");
        return reuseKey;
    }
    /**
     * Clears schema metadata cached by this pool's current connection.
     * Pools that keep multiple connections alive should override this to clear every live connection.
     * @returns {void} - No return value.
     */
    clearSchemaCache() {
        this._clearConnectionSchemaCache(this.getCurrentConnection());
    }
    /**
     * Runs clear connection schema cache.
     * @param {import("../drivers/base.js").default} connection - Connection whose local schema cache should be cleared.
     * @returns {void} - No return value.
     */
    _clearConnectionSchemaCache(connection) {
        connection._clearLocalSchemaCache();
    }
    /**
     * Runs primary key type.
     * @abstract
     * @returns {string} - The primary key type.
     */
    primaryKeyType() {
        throw new Error("'primaryKeyType' not implemented");
    }
    /**
     * Runs set current.
     * @returns {void} - No return value.
     */
    setCurrent() {
        shared.currentPool = this;
    }
    /**
     * Runs set driver class.
     * @param {typeof import("../drivers/base.js").default} driverClass - Driver class.
     */
    setDriverClass(driverClass) {
        this.driverClass = driverClass;
    }
    /**
     * Runs spawn connection.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection.
     */
    async spawnConnection() {
        const databaseConfig = this.getConfiguration();
        this.logger.debug("spawnConnection", { identifier: this.identifier, databaseConfig });
        return await this.spawnConnectionForConfiguration(databaseConfig);
    }
    /**
     * Spawns a connection for an already-resolved physical database configuration.
     * The reuse identity is derived only from that captured configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured resolved configuration.
     * @returns {Promise<import("../drivers/base.js").default>} - Connected and identity-stamped driver.
     */
    async spawnConnectionForConfiguration(databaseConfiguration) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        const connection = await this.spawnConnectionWithConfiguration(databaseConfiguration, reuseKey);
        this.stampConnectionForConfigurationReuseKey(connection, reuseKey);
        return connection;
    }
    /**
     * Stamps a connected driver with its pool reuse identity and diagnostic-safe opaque identity.
     * @param {import("../drivers/base.js").default} connection - Connected driver.
     * @param {string} reuseKey - Exact physical configuration reuse key captured for this spawn.
     * @returns {void}
     */
    stampConnectionForConfigurationReuseKey(connection, reuseKey) {
        const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection);
        const databaseIdentityFingerprint = `sha256:${sha256Hex(`database-configuration-reuse:v1\0${reuseKey}`)}`;
        connectionWithPoolKey[POOL_CONFIGURATION_KEY] = reuseKey;
        connection.setPoolDiagnosticIdentity({
            databaseIdentifier: this.identifier,
            databaseIdentityFingerprint
        });
        connection.setSchemaCacheInvalidator(() => {
            this.clearSchemaCache();
            this.configuration.clearSchemaCachesForReuseKey(reuseKey);
        });
    }
    /**
     * Runs spawn connection with configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
     * @param {string} [reuseKey] - Exact resolved physical identity.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection with configuration.
     */
    async spawnConnectionWithConfiguration(config, reuseKey) {
        const DriverClass = config.driver || this.driverClass;
        if (!DriverClass)
            throw new Error("No driver class set in database pool or in given config");
        const sharedConnection = await this.configuration.getEnvironmentHandler().createTestSharedTransactionConnection({
            DriverClass,
            config,
            configuration: this.configuration,
            databaseIdentifier: this.identifier,
            reuseKey
        });
        const connection = sharedConnection || new DriverClass(config, this.configuration);
        try {
            await connection.connect();
        }
        catch (error) {
            await this.closeConnectionAfterFailedConnect(connection);
            throw error;
        }
        return connection;
    }
    /**
     * Checks out a connection for an already-resolved physical configuration.
     * Multi-configuration pools override this for explicit tenant registrations.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} _databaseConfiguration - Captured configuration.
     * @param {ConnectionCheckoutOptions} [_options] - Checkout options.
     * @param {{retain: boolean}} [_args] - Pool-specific retention behavior.
     * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
     */
    async checkoutForConfiguration(_databaseConfiguration, _options, _args) {
        throw new Error("Database pool does not support captured configuration checkout");
    }
    /**
     * Runs close connection after failed connect.
     * @param {import("../drivers/base.js").default} connection - Connection to close.
     * @returns {Promise<void>} - Resolves when cleanup has been attempted.
     */
    async closeConnectionAfterFailedConnect(connection) {
        try {
            await connection.close();
        }
        catch (error) {
            this.logger.warn("Failed to close database connection after connect failed", { error });
        }
    }
    /**
     * Runs with connection.
     * @template T
     * @abstract
     * @param {ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} _optionsOrCallback - Checkout options or callback function.
     * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [_callback] - Callback function.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withConnection(_optionsOrCallback, _callback) {
        throw new Error("'withConnection' not implemented");
    }
    /**
     * Runs an operation on a freshly checked-out connection.
     * @template T
     * @param {ConnectionCheckoutOptions} options - Checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withOperationConnection(options, callback) {
        const owner = Symbol("database-operation-owner");
        return await this.withConnection(options, async (connection) => await callback(connection, owner));
    }
    /**
     * Runs work through a pool-owned checkout for an immutable, already-resolved
     * physical configuration. Concrete pools must preserve their capacity,
     * timeout, queue, debug, and closeAll ownership on this path.
     * @template T
     * @param {CapturedConnectionOptions} options - Captured checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    async withCapturedOperationConnection(options, callback) {
        void options;
        void callback;
        throw new Error("'withCapturedOperationConnection' not implemented");
    }
    async openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration) { throw new Error("Frontend tenant SQLite lifecycle requires a keyed single-connection pool"); }
    async flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration) { throw new Error("Frontend tenant SQLite lifecycle requires a keyed single-connection pool"); }
    async closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration) { throw new Error("Frontend tenant SQLite lifecycle requires a keyed single-connection pool"); }
    async deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration) { throw new Error("Frontend tenant SQLite lifecycle requires a keyed single-connection pool"); }
    capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration) { return false; }
    capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ _databaseConfiguration) { return false; }
    /**
     * Ensures a reusable connection exists for contexts where AsyncLocalStorage isn't set.
     * Default implementation just checks out a connection.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the global connection.
     */
    async ensureGlobalConnection() {
        return await this.checkout();
    }
    /**
     * Runs get debug snapshot.
     * @returns {DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
     */
    getDebugSnapshot() {
        return {
            configuration: this.debugConfigurationSnapshot(),
            connections: [],
            connectionsBeingSpawned: 0,
            identifier: this.identifier,
            idleCount: 0,
            inUseCount: 0,
            pendingCheckoutCount: 0,
            poolClass: this.constructor.name
        };
    }
    /**
     * Runs debug configuration snapshot.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Sanitized resolved database configuration.
     */
    debugConfigurationSnapshot() {
        const databaseConfig = this.getConfiguration();
        const poolConfig = databaseConfig.pool;
        return {
            database: databaseConfig.database,
            driver: databaseConfig.driver?.name,
            host: databaseConfig.host,
            migrations: databaseConfig.migrations,
            name: databaseConfig.name,
            pool: poolConfig ? { idleTimeoutMillis: poolConfig.idleTimeoutMillis, max: poolConfig.max } : undefined,
            port: databaseConfig.port,
            schema: databaseConfig.schema,
            type: databaseConfig.type,
            useDatabase: databaseConfig.useDatabase,
            username: databaseConfig.username
        };
    }
    /**
     * Runs debug connection snapshot.
     * @param {import("../drivers/base.js").default} connection - Database connection.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} details - Extra diagnostic fields.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Connection diagnostic snapshot.
     */
    debugConnectionSnapshot(connection, details = {}) {
        const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection);
        return {
            ...connection.getDebugSnapshot(),
            ...details,
            reuseKey: connectionWithPoolKey[POOL_CONFIGURATION_KEY]
        };
    }
    /**
     * Closes all connections for this pool.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async closeAll() { }
}
baseMethodsForward(VelociousDatabasePoolBase);
export default VelociousDatabasePoolBase;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9wb29sL2Jhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLHdCQUF3QixDQUFBO0FBQ2xELE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sa0JBQWtCLE1BQU0sMkJBQTJCLENBQUE7QUFDMUQsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFFakQ7OztHQUdHO0FBRUg7Ozs7R0FJRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILE1BQU0sQ0FBQyxNQUFNLHNCQUFzQixHQUFHLE1BQU0sQ0FBQywrQkFBK0IsQ0FBQyxDQUFBO0FBRTdFOzs2REFFNkQ7QUFDN0QsTUFBTSxNQUFNLEdBQUc7SUFDYixXQUFXLEVBQUUsSUFBSTtDQUNsQixDQUFBO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLEtBQUs7SUFDNUIsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDekIsT0FBTyxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFBO0lBQ3RFLENBQUM7SUFFRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN2QyxNQUFNLE9BQU8sR0FBRyxNQUFNO2FBQ25CLElBQUksQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO2FBQzFFLElBQUksRUFBRTthQUNOLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFD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QVc7WUFDdkMsUUFBUSxFQUFFLGNBQWMsQ0FBQyxRQUFRO1NBQ2xDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCx1QkFBdUIsQ0FBQyxVQUFVLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDOUMsTUFBTSxxQkFBcUIsR0FBRyx5RkFBeUYsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXBJLE9BQU87WUFDTCxHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRTtZQUNoQyxHQUFHLE9BQU87WUFDVixRQUFRLEVBQUUscUJBQXFCLENBQUMsc0JBQXNCLENBQUM7U0FDeEQsQ0FBQTtJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsUUFBUSxLQUFJLENBQUM7Q0FDcEI7QUFFRCxrQkFBa0IsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFBO0FBRTdDLGVBQWUseUJBQXlCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBiYXNlTWV0aG9kc0ZvcndhcmQgZnJvbSBcIi4vYmFzZS1tZXRob2RzLWZvcndhcmQuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5cbi8qKlxuICogT3BhcXVlIG93bmVyc2hpcCBoYW5kbGUgZm9yIGFuIGluLXByb2Nlc3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiByZWdpc3RyYXRpb24uXG4gKiBAdHlwZWRlZiB7e293bmVyOiBzeW1ib2x9fSBUZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvblxuICovXG5cbi8qKlxuICogQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoZSBjaGVja2VkLW91dCBjb25uZWN0aW9uLlxuICovXG4vKipcbiAqIENhcHR1cmVkQ29ubmVjdGlvbk9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENhcHR1cmVkQ29ubmVjdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBSZXNvbHZlZCBwaHlzaWNhbCBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGNhcHR1cmVkIGJ5IHRoZSBjYWxsZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNoZWNrZWQtb3V0IGNvbm5lY3Rpb24uXG4gKi9cbi8qKlxuICogRGF0YWJhc2VQb29sUGVuZGluZ0NoZWNrb3V0RGVidWdTbmFwc2hvdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRGF0YWJhc2VQb29sUGVuZGluZ0NoZWNrb3V0RGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IGNoZWNrb3V0TmFtZSAtIEh1bWFuLXJlYWRhYmxlIGNoZWNrb3V0IG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gZW5xdWV1ZWRBdCAtIFRpbWVzdGFtcCB3aGVuIHRoZSBjaGVja291dCBzdGFydGVkIHdhaXRpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaW5kZXggLSBQZW5kaW5nIGNoZWNrb3V0IHF1ZXVlIGluZGV4LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSByZW1haW5pbmdUaW1lb3V0TXMgLSBNaWxsaXNlY29uZHMgYmVmb3JlIHRoZSBjaGVja291dCB0aW1lcyBvdXQsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5IG5lZWRlZCBieSB0aGUgY2hlY2tvdXQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRBdCAtIFRpbWVzdGFtcCB3aGVuIHRoZSBjaGVja291dCB3aWxsIHRpbWUgb3V0LCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNaWxsaXMgLSBUaW1lb3V0IGNvbmZpZ3VyZWQgZm9yIHRoZSBjaGVja291dCwgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHdhaXRpbmdGb3JNcyAtIE1pbGxpc2Vjb25kcyBhbHJlYWR5IHNwZW50IHdhaXRpbmcuXG4gKi9cbi8qKlxuICogRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmZpZ3VyYXRpb24gLSBTYW5pdGl6ZWQgcmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gY29ubmVjdGlvbnMgLSBMaXZlIGNvbm5lY3Rpb24gc25hcHNob3RzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkIC0gTnVtYmVyIG9mIGluLXByb2dyZXNzIGNvbm5lY3Rpb24gc3Bhd25zLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGlkbGVDb3VudCAtIE51bWJlciBvZiBpZGxlIGNvbm5lY3Rpb25zLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtpZGxlTWF0Y2hpbmdQZW5kaW5nQ2hlY2tvdXRDb3VudF0gLSBJZGxlIGNvbm5lY3Rpb25zIHRoYXQgY2FuIHNhdGlzZnkgYXQgbGVhc3Qgb25lIHBlbmRpbmcgY2hlY2tvdXQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaW5Vc2VDb3VudCAtIE51bWJlciBvZiBjaGVja2VkLW91dCBjb25uZWN0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8RGF0YWJhc2VQb29sUGVuZGluZ0NoZWNrb3V0RGVidWdTbmFwc2hvdD59IFtwZW5kaW5nQ2hlY2tvdXRzXSAtIFdhaXRpbmcgY2hlY2tvdXQgc25hcHNob3RzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHBlbmRpbmdDaGVja291dENvdW50IC0gTnVtYmVyIG9mIHF1ZXVlZCBjaGVja291dCByZXF1ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3BlbmRpbmdDaGVja291dERyYWluQWN0aXZlXSAtIFdoZXRoZXIgYSBjaGVja291dCBkcmFpbiBwYXNzIGlzIGFjdGl2ZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3BlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkXSAtIFdoZXRoZXIgYW5vdGhlciBjaGVja291dCBkcmFpbiBwYXNzIHdhcyByZXF1ZXN0ZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcG9vbENsYXNzIC0gUG9vbCBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHt7Y29ubmVjdGlvbkNyZWF0aW9uQ291bnQ6IG51bWJlciwgY29ubmVjdGlvbkNyZWF0aW9uRmFpbHVyZUNvdW50OiBudW1iZXIsIGNvbm5lY3Rpb25DcmVhdGlvbk1heE1zOiBudW1iZXIsIGNvbm5lY3Rpb25DcmVhdGlvblRvdGFsTXM6IG51bWJlciwgY2hlY2tvdXRUaW1lb3V0Q291bnQ6IG51bWJlciwgY2hlY2tvdXRXYWl0Q291bnQ6IG51bWJlciwgY2hlY2tvdXRXYWl0TWF4TXM6IG51bWJlciwgY2hlY2tvdXRXYWl0VG90YWxNczogbnVtYmVyLCBpZGxlUmVhcENvdW50OiBudW1iZXIsIGlkbGVSZWFwRGlzcG9zYWxDb3VudDogbnVtYmVyLCBpZGxlUmVhcEZhaWx1cmVDb3VudDogbnVtYmVyLCBpZGxlUmVhcE1heE1zOiBudW1iZXIsIGlkbGVSZWFwVG90YWxNczogbnVtYmVyLCBwZWFrTGl2ZUNvbm5lY3Rpb25zOiBudW1iZXJ9fSBbdGVsZW1ldHJ5XSAtIEN1bXVsYXRpdmUgcG9vbCBsaWZlY3ljbGUgdGVsZW1ldHJ5LlxuICovXG5leHBvcnQgY29uc3QgUE9PTF9DT05GSUdVUkFUSU9OX0tFWSA9IFN5bWJvbChcInZlbG9jaW91c1Bvb2xDb25maWd1cmF0aW9uS2V5XCIpXG5cbi8qKlxuICogU2hhcmVkLlxuICogQHR5cGUge3tjdXJyZW50UG9vbDogVmVsb2Npb3VzRGF0YWJhc2VQb29sQmFzZSB8IG51bGx9fSAqL1xuY29uc3Qgc2hhcmVkID0ge1xuICBjdXJyZW50UG9vbDogbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgc3RhYmxlIHN0cmluZ2lmeS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gc3RyaW5naWZ5LlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUgSlNPTiBzdHJpbmcuXG4gKi9cbmZ1bmN0aW9uIHN0YWJsZVN0cmluZ2lmeSh2YWx1ZSkge1xuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gYFske3ZhbHVlLm1hcCgoZW50cnkpID0+IHN0YWJsZVN0cmluZ2lmeShlbnRyeSkpLmpvaW4oXCIsXCIpfV1gXG4gIH1cblxuICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgY29uc3QgZW50cmllcyA9IE9iamVjdFxuICAgICAgLmtleXMoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSkpXG4gICAgICAuc29ydCgpXG4gICAgICAubWFwKChrZXkpID0+IGAke0pTT04uc3RyaW5naWZ5KGtleSl9OiR7c3RhYmxlU3RyaW5naWZ5KC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpW2tleV0pfWApXG5cbiAgICByZXR1cm4gYHske2VudHJpZXMuam9pbihcIixcIil9fWBcbiAgfVxuXG4gIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbn1cblxuY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VQb29sQmFzZSB7XG4gIC8qKlxuICAgKiBXaXRob3V0IGN1cnJlbnQgY29ubmVjdGlvbiBjb250ZXh0LlxuICAgKiBAdHlwZSB7dW5kZWZpbmVkIHwgKChjYWxsYmFjazogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KX0gKi9cbiAgX3dpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBjdXJyZW50LlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzRGF0YWJhc2VQb29sQmFzZX0gLSBUaGUgY3VycmVudC5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50KCkge1xuICAgIGlmICghc2hhcmVkLmN1cnJlbnRQb29sKSB0aHJvdyBuZXcgRXJyb3IoXCJBIGRhdGFiYXNlIHBvb2wgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gc2hhcmVkLmN1cnJlbnRQb29sXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGFueSBnbG9iYWwgY29ubmVjdGlvbnMgZm9yIHRoZSBnaXZlbiBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSBwb29sLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgY2xlYXJHbG9iYWxDb25uZWN0aW9ucyhjb25maWd1cmF0aW9uKSB7IHZvaWQgY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Q29uZmlndXJhdGlvbn0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG5cbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBnaXZlblwiKVxuICAgIGlmICghaWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gaWRlbnRpZmllciB3YXMgZ2l2ZW5cIilcblxuICAgIHRoaXMuaWRlbnRpZmllciA9IGlkZW50aWZpZXJcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgfVxuXG4gIC8qKiBUaHJvd3Mgd2hlbiBhIHJldm9rZWQgdGVzdCBhdHRlbXB0IHRyaWVzIHRvIGFjcXVpcmUgZGF0YWJhc2UgYWNjZXNzLiAqL1xuICBhc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGVja2luLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gX2Nvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKi9cbiAgY2hlY2tpbihfY29ubmVjdGlvbikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidjaGVja2luJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSBkaXNjYXJkcyBhbiBhdHRlbXB0LW93bmVkIGNoZWNrZWQtb3V0IGNvbm5lY3Rpb24uXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBfY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gdGhhdCBtdXN0IG5vdCByZXR1cm4gdG8gdGhlIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBjb25uZWN0aW9uIGlzIGNsb3NlZCBhbmQgcmVtb3ZlZCBmcm9tIHBvb2wgb3duZXJzaGlwLlxuICAgKi9cbiAgZGlzY2FyZChfY29ubmVjdGlvbikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidkaXNjYXJkJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoZWNrb3V0LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtDb25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbX29wdGlvbnNdIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNoZWNrb3V0LlxuICAgKi9cbiAgY2hlY2tvdXQoX29wdGlvbnMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY2hlY2tvdXQnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgY29ubmVjdGlvbi5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0Q3VycmVudENvbm5lY3Rpb24oKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2dldEN1cnJlbnRDb25uZWN0aW9uJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25uZWN0aW9uIHBpbm5lZCB0byB0aGUgY3VycmVudCBjb250ZXh0LCBpZiBhbnkuXG4gICAqIERlZmF1bHQgaW1wbGVtZW50YXRpb24gZGVmZXJzIHRvIGBnZXRDdXJyZW50Q29ubmVjdGlvbmAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgY3VycmVudCBjb250ZXh0IGNvbm5lY3Rpb24uXG4gICAqL1xuICBnZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0Q3VycmVudENvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFBpbnMgYSBjb25uZWN0aW9uIHRvIGJlIHJldHVybmVkIHRvIGNhbGxlcnMgdGhhdCBydW4gd2l0aG91dCBhIGNvbm5lY3Rpb24tY29udGV4dFxuICAgKiBwaW4gKHVzZWQgYnkgdGhlIHRlc3QgcnVubmVyIHRvIHNoYXJlIG9uZSBjb25uZWN0aW9uIHdpdGggaW4tcHJvY2VzcyBIVFRQIGhhbmRsZXJzKS5cbiAgICogQmFzZSBwb29scyB0aGF0IGRvIG5vdCB0cmFjayBhc3luYyBjb250ZXh0IGlnbm9yZSBpdDsgYXN5bmMtY29udGV4dCBwb29scyBvdmVycmlkZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gX2Nvbm5lY3Rpb24gLSBTaGFyZWQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE9wYXF1ZSByZWdpc3RyYXRpb24gaGFuZGxlIHdoZW4gc3VwcG9ydGVkLlxuICAgKi9cbiAgc2V0VGVzdFNoYXJlZENvbm5lY3Rpb24oX2Nvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHByb3ZpZGVyIHRoYXQgcmVzb2x2ZXMgdGhlIGNvbm5lY3Rpb24gZWxpZ2libGUgZm9yIGluLXByb2Nlc3MgdGVzdCByZXF1ZXN0IHNoYXJpbmcuXG4gICAqIEJhc2UgcG9vbHMgdGhhdCBkbyBub3QgdHJhY2sgYXN5bmMgY29udGV4dCBpZ25vcmUgaXQ7IGFzeW5jLWNvbnRleHQgcG9vbHMgb3ZlcnJpZGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IF9wcm92aWRlciAtIFNoYXJlZCBjb25uZWN0aW9uIHByb3ZpZGVyLlxuICAgKiBAcmV0dXJucyB7VGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUgd2hlbiBzdXBwb3J0ZWQuXG4gICAqL1xuICBzZXRUZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKF9wcm92aWRlcikge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIHNlbGVjdGVkIGJ5IHRoZSBjYWxsZXIncyBsaXZlIGFzeW5jIGNvbnRleHQuXG4gICAqIEJhc2UgcG9vbHMgdGhhdCBkbyBub3QgdHJhY2sgYXN5bmMgY29udGV4dCBpZ25vcmUgaXQuXG4gICAqIEBwYXJhbSB7e21hdGNoZXM6ICgpID0+IGJvb2xlYW4sIHByb3ZpZGVyOiAoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH19IF9hcmdzIC0gQ29udGV4dCBzZWxlY3RvciBhbmQgY29ubmVjdGlvbiBwcm92aWRlci5cbiAgICogQHJldHVybnMge1Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSAtIE9wYXF1ZSBzY29wZWQgcmVnaXN0cmF0aW9uIGhhbmRsZS5cbiAgICovXG4gIHJlZ2lzdGVyVGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcihfYXJncykge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSB0ZXN0IGNvbm5lY3Rpb24gZm9yIG9uZSByZXNvbHZlZCBwaHlzaWNhbCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBfY29ubmVjdGlvbiAtIEF0dGVtcHQtb3duZWQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9yZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtUZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gLSBPcGFxdWUgcmVnaXN0cmF0aW9uIGhhbmRsZSB3aGVuIHN1cHBvcnRlZC5cbiAgICovXG4gIHNldFRlc3RTaGFyZWRDb25uZWN0aW9uRm9yQ29uZmlndXJhdGlvbihfY29ubmVjdGlvbiwgX3JldXNlS2V5KSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gb3IgcHJvdmlkZXIgc2V0IGZvciBpbi1wcm9jZXNzIHRlc3QgcmVxdWVzdHMuIE5vLW9wIGJ5IGRlZmF1bHQuXG4gICAqIFdoZW4gYSByZWdpc3RyYXRpb24gaXMgcHJvdmlkZWQsIGNsZWFycyBvbmx5IGlmIGl0IGlzIHN0aWxsIHRoZSBhY3RpdmUgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSBbX3JlZ2lzdHJhdGlvbl0gLSBPcGFxdWUgaGFuZGxlIHJldHVybmVkIHdoZW4gdGhlIHNoYXJlZCB2YWx1ZSB3YXMgc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oX3JlZ2lzdHJhdGlvbikge31cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSB0aGUgdGVzdCBzaGFyZWQgY29ubmVjdGlvbidzIGNvbnRleHQuIEJhc2UgcG9vbHMgdGhhdCBkbyBub3RcbiAgICogdHJhY2sgYXN5bmMgY29udGV4dCBqdXN0IHJ1biB0aGUgY2FsbGJhY2sgYXMtaXM7IGFzeW5jLWNvbnRleHQgcG9vbHMgb3ZlcnJpZGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbihjYWxsYmFjaykge1xuICAgIHJldHVybiBjYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29ubmVjdGlvbiByZWdpc3RlcmVkIGZvciB0ZXN0LW9ubHkgaW4tcHJvY2VzcyBzaGFyaW5nLlxuICAgKiBCYXNlIHBvb2xzIGRvIG5vdCBuZWVkIGEgc2VwYXJhdGUgc2hhcmVkIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBTaGFyZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHRlc3RTaGFyZWRDb25uZWN0aW9uKCkge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgdGhlIGN1cnJlbnQgY29ubmVjdGlvbiBpcyBwaW5uZWQgdG8gYW4gZXhlY3V0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgY29ubmVjdGlvbiBjYW4gYmUgcmV1c2VkIGJ5IG5lc3RlZCBjb2RlLlxuICAgKi9cbiAgaGFzQ3VycmVudENvbm5lY3Rpb25Db250ZXh0KCkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRob3V0IGN1cnJlbnQgY29ubmVjdGlvbiBjb250ZXh0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIHdpdGhvdXQgPyBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dChjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLl93aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0KSByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAodGhpcy5fd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dChjYWxsYmFjaykpXG5cbiAgICByZXR1cm4gY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBmb3IgdGhlIHBvb2wgaWRlbnRpZmllci5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKHRoaXMuaWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IFtkYXRhYmFzZUNvbmZpZ3VyYXRpb25dIC0gUmVzb2x2ZWQgY29uZmlndXJhdGlvbiB0byBpZGVudGlmeS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZXVzZSBrZXkgZm9yIHRoZSBjdXJyZW50bHkgcmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSkge1xuICAgIHJldHVybiBzdGFibGVTdHJpbmdpZnkoe1xuICAgICAgZGF0YWJhc2U6IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5kYXRhYmFzZSxcbiAgICAgIGhvc3Q6IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5ob3N0LFxuICAgICAgbmFtZTogZGF0YWJhc2VDb25maWd1cmF0aW9uLm5hbWUsXG4gICAgICBwb3J0OiBkYXRhYmFzZUNvbmZpZ3VyYXRpb24ucG9ydCxcbiAgICAgIHNjaGVtYTogZGF0YWJhc2VDb25maWd1cmF0aW9uLnNjaGVtYSxcbiAgICAgIHNjaGVtYUNhY2hlOiBkYXRhYmFzZUNvbmZpZ3VyYXRpb24uc2NoZW1hQ2FjaGUsXG4gICAgICBzcWxDb25maWc6IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5zcWxDb25maWcsXG4gICAgICB0eXBlOiBkYXRhYmFzZUNvbmZpZ3VyYXRpb24udHlwZSxcbiAgICAgIHVzZURhdGFiYXNlOiBkYXRhYmFzZUNvbmZpZ3VyYXRpb24udXNlRGF0YWJhc2UsXG4gICAgICB1c2VybmFtZTogZGF0YWJhc2VDb25maWd1cmF0aW9uLnVzZXJuYW1lXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24gbWF0Y2hlcyBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNvbm5lY3Rpb24gbWF0Y2hlcyBjdXJyZW50IHJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBjb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pID09PSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBrZXkgc3RhbXBlZCBvbiBhIGNvbm5lY3Rpb24gYXQgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDaGVja2VkLW91dCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbm5lY3Rpb24gY29uZmlndXJhdGlvbiByZXVzZSBrZXkuXG4gICAqL1xuICBnZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBjb25uZWN0aW9uV2l0aFBvb2xLZXkgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tQT09MX0NPTkZJR1VSQVRJT05fS0VZXT86IHN0cmluZ319ICovIChjb25uZWN0aW9uKVxuICAgIGNvbnN0IHJldXNlS2V5ID0gY29ubmVjdGlvbldpdGhQb29sS2V5W1BPT0xfQ09ORklHVVJBVElPTl9LRVldXG5cbiAgICBpZiAoIXJldXNlS2V5KSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBjb25uZWN0aW9uIGlzIG1pc3NpbmcgaXRzIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5XCIpXG5cbiAgICByZXR1cm4gcmV1c2VLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgc2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBieSB0aGlzIHBvb2wncyBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIFBvb2xzIHRoYXQga2VlcCBtdWx0aXBsZSBjb25uZWN0aW9ucyBhbGl2ZSBzaG91bGQgb3ZlcnJpZGUgdGhpcyB0byBjbGVhciBldmVyeSBsaXZlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGUoKSB7XG4gICAgdGhpcy5fY2xlYXJDb25uZWN0aW9uU2NoZW1hQ2FjaGUodGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBzY2hlbWEgY2FjaGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHdob3NlIGxvY2FsIHNjaGVtYSBjYWNoZSBzaG91bGQgYmUgY2xlYXJlZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2NsZWFyQ29ubmVjdGlvblNjaGVtYUNhY2hlKGNvbm5lY3Rpb24pIHtcbiAgICBjb25uZWN0aW9uLl9jbGVhckxvY2FsU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkgdHlwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHByaW1hcnkga2V5IHR5cGUuXG4gICAqL1xuICBwcmltYXJ5S2V5VHlwZSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIncHJpbWFyeUtleVR5cGUnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnQoKSB7XG4gICAgc2hhcmVkLmN1cnJlbnRQb29sID0gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGRyaXZlciBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRyaXZlckNsYXNzIC0gRHJpdmVyIGNsYXNzLlxuICAgKi9cbiAgc2V0RHJpdmVyQ2xhc3MoZHJpdmVyQ2xhc3MpIHtcbiAgICB0aGlzLmRyaXZlckNsYXNzID0gZHJpdmVyQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwYXduIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBzcGF3biBjb25uZWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3Bhd25Db25uZWN0aW9uKCkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlnID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwic3Bhd25Db25uZWN0aW9uXCIsIHtpZGVudGlmaWVyOiB0aGlzLmlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlnfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWcpXG4gIH1cblxuICAvKipcbiAgICogU3Bhd25zIGEgY29ubmVjdGlvbiBmb3IgYW4gYWxyZWFkeS1yZXNvbHZlZCBwaHlzaWNhbCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBUaGUgcmV1c2UgaWRlbnRpdHkgaXMgZGVyaXZlZCBvbmx5IGZyb20gdGhhdCBjYXB0dXJlZCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gQ2FwdHVyZWQgcmVzb2x2ZWQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIENvbm5lY3RlZCBhbmQgaWRlbnRpdHktc3RhbXBlZCBkcml2ZXIuXG4gICAqL1xuICBhc3luYyBzcGF3bkNvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbldpdGhDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgcmV1c2VLZXkpXG5cbiAgICB0aGlzLnN0YW1wQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uLCByZXVzZUtleSlcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogU3RhbXBzIGEgY29ubmVjdGVkIGRyaXZlciB3aXRoIGl0cyBwb29sIHJldXNlIGlkZW50aXR5IGFuZCBkaWFnbm9zdGljLXNhZmUgb3BhcXVlIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGVkIGRyaXZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gRXhhY3QgcGh5c2ljYWwgY29uZmlndXJhdGlvbiByZXVzZSBrZXkgY2FwdHVyZWQgZm9yIHRoaXMgc3Bhd24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhbXBDb25uZWN0aW9uRm9yQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24sIHJldXNlS2V5KSB7XG4gICAgY29uc3QgY29ubmVjdGlvbldpdGhQb29sS2V5ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbUE9PTF9DT05GSUdVUkFUSU9OX0tFWV0/OiBzdHJpbmd9fSAqLyAoY29ubmVjdGlvbilcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQgPSBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1jb25maWd1cmF0aW9uLXJldXNlOnYxXFwwJHtyZXVzZUtleX1gKX1gXG5cbiAgICBjb25uZWN0aW9uV2l0aFBvb2xLZXlbUE9PTF9DT05GSUdVUkFUSU9OX0tFWV0gPSByZXVzZUtleVxuICAgIGNvbm5lY3Rpb24uc2V0UG9vbERpYWdub3N0aWNJZGVudGl0eSh7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuaWRlbnRpZmllcixcbiAgICAgIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICAgIH0pXG4gICAgY29ubmVjdGlvbi5zZXRTY2hlbWFDYWNoZUludmFsaWRhdG9yKCgpID0+IHtcbiAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uY2xlYXJTY2hlbWFDYWNoZXNGb3JSZXVzZUtleShyZXVzZUtleSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gY29ubmVjdGlvbiB3aXRoIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBjb25maWcgLSBDb25maWd1cmF0aW9uIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtyZXVzZUtleV0gLSBFeGFjdCByZXNvbHZlZCBwaHlzaWNhbCBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHNwYXduIGNvbm5lY3Rpb24gd2l0aCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3Bhd25Db25uZWN0aW9uV2l0aENvbmZpZ3VyYXRpb24oY29uZmlnLCByZXVzZUtleSkge1xuICAgIGNvbnN0IERyaXZlckNsYXNzID0gY29uZmlnLmRyaXZlciB8fCB0aGlzLmRyaXZlckNsYXNzXG5cbiAgICBpZiAoIURyaXZlckNsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkcml2ZXIgY2xhc3Mgc2V0IGluIGRhdGFiYXNlIHBvb2wgb3IgaW4gZ2l2ZW4gY29uZmlnXCIpXG5cbiAgICBjb25zdCBzaGFyZWRDb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmNyZWF0ZVRlc3RTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24oe1xuICAgICAgRHJpdmVyQ2xhc3MsXG4gICAgICBjb25maWcsXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuaWRlbnRpZmllcixcbiAgICAgIHJldXNlS2V5XG4gICAgfSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gc2hhcmVkQ29ubmVjdGlvbiB8fCBuZXcgRHJpdmVyQ2xhc3MoY29uZmlnLCB0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jb25uZWN0KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZUNvbm5lY3Rpb25BZnRlckZhaWxlZENvbm5lY3QoY29ubmVjdGlvbilcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgb3V0IGEgY29ubmVjdGlvbiBmb3IgYW4gYWxyZWFkeS1yZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uLlxuICAgKiBNdWx0aS1jb25maWd1cmF0aW9uIHBvb2xzIG92ZXJyaWRlIHRoaXMgZm9yIGV4cGxpY2l0IHRlbmFudCByZWdpc3RyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gX2RhdGFiYXNlQ29uZmlndXJhdGlvbiAtIENhcHR1cmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7Q29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gW19vcHRpb25zXSAtIENoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7e3JldGFpbjogYm9vbGVhbn19IFtfYXJnc10gLSBQb29sLXNwZWNpZmljIHJldGVudGlvbiBiZWhhdmlvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIENoZWNrZWQtb3V0IGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBjaGVja291dEZvckNvbmZpZ3VyYXRpb24oX2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgX29wdGlvbnMsIF9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgcG9vbCBkb2VzIG5vdCBzdXBwb3J0IGNhcHR1cmVkIGNvbmZpZ3VyYXRpb24gY2hlY2tvdXRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIGNvbm5lY3Rpb24gYWZ0ZXIgZmFpbGVkIGNvbm5lY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRvIGNsb3NlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VDb25uZWN0aW9uQWZ0ZXJGYWlsZWRDb25uZWN0KGNvbm5lY3Rpb24pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgdG8gY2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvbiBhZnRlciBjb25uZWN0IGZhaWxlZFwiLCB7ZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7Q29ubmVjdGlvbkNoZWNrb3V0T3B0aW9ucyB8ICgoYXJnOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPil9IF9vcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7KGFyZzogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IFtfY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHdpdGhDb25uZWN0aW9uKF9vcHRpb25zT3JDYWxsYmFjaywgX2NhbGxiYWNrKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3dpdGhDb25uZWN0aW9uJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIG9wZXJhdGlvbiBvbiBhIGZyZXNobHkgY2hlY2tlZC1vdXQgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtDb25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBvcHRpb25zIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHsoY29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIG93bmVyOiBzeW1ib2wpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoT3BlcmF0aW9uQ29ubmVjdGlvbihvcHRpb25zLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IG93bmVyID0gU3ltYm9sKFwiZGF0YWJhc2Utb3BlcmF0aW9uLW93bmVyXCIpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoQ29ubmVjdGlvbihvcHRpb25zLCBhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbiwgb3duZXIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB0aHJvdWdoIGEgcG9vbC1vd25lZCBjaGVja291dCBmb3IgYW4gaW1tdXRhYmxlLCBhbHJlYWR5LXJlc29sdmVkXG4gICAqIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uIENvbmNyZXRlIHBvb2xzIG11c3QgcHJlc2VydmUgdGhlaXIgY2FwYWNpdHksXG4gICAqIHRpbWVvdXQsIHF1ZXVlLCBkZWJ1ZywgYW5kIGNsb3NlQWxsIG93bmVyc2hpcCBvbiB0aGlzIHBhdGguXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7Q2FwdHVyZWRDb25uZWN0aW9uT3B0aW9uc30gb3B0aW9ucyAtIENhcHR1cmVkIGNoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBvd25lcjogc3ltYm9sKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aENhcHR1cmVkT3BlcmF0aW9uQ29ubmVjdGlvbihvcHRpb25zLCBjYWxsYmFjaykge1xuICAgIHZvaWQgb3B0aW9uc1xuICAgIHZvaWQgY2FsbGJhY2tcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInd2l0aENhcHR1cmVkT3BlcmF0aW9uQ29ubmVjdGlvbicgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICBhc3luYyBvcGVuQ2FwdHVyZWRDb25uZWN0aW9uKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBfZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7IHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlIHJlcXVpcmVzIGEga2V5ZWQgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbFwiKSB9XG4gIGFzeW5jIGZsdXNoQ2FwdHVyZWRDb25uZWN0aW9uKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBfZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7IHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlIHJlcXVpcmVzIGEga2V5ZWQgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbFwiKSB9XG4gIGFzeW5jIGNsb3NlQ2FwdHVyZWRDb25uZWN0aW9uKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBfZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7IHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIHRlbmFudCBTUUxpdGUgbGlmZWN5Y2xlIHJlcXVpcmVzIGEga2V5ZWQgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbFwiKSB9XG4gIGFzeW5jIGRlbGV0ZUNhcHR1cmVkRGF0YWJhc2UoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIF9kYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHsgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBsaWZlY3ljbGUgcmVxdWlyZXMgYSBrZXllZCBzaW5nbGUtY29ubmVjdGlvbiBwb29sXCIpIH1cbiAgY2FwdHVyZWRDb25uZWN0aW9uSW5Vc2UoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIF9kYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHsgcmV0dXJuIGZhbHNlIH1cbiAgY2FwdHVyZWRDb25uZWN0aW9uSGFzUGVuZGluZ1dyaXRlcygvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gX2RhdGFiYXNlQ29uZmlndXJhdGlvbikgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGEgcmV1c2FibGUgY29ubmVjdGlvbiBleGlzdHMgZm9yIGNvbnRleHRzIHdoZXJlIEFzeW5jTG9jYWxTdG9yYWdlIGlzbid0IHNldC5cbiAgICogRGVmYXVsdCBpbXBsZW1lbnRhdGlvbiBqdXN0IGNoZWNrcyBvdXQgYSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZ2xvYmFsIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBlbnN1cmVHbG9iYWxDb25uZWN0aW9uKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNoZWNrb3V0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge0RhdGFiYXNlUG9vbERlYnVnU25hcHNob3R9IC0gRGlhZ25vc3RpYyBzbmFwc2hvdCBmb3IgdGhpcyBwb29sLlxuICAgKi9cbiAgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5kZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpLFxuICAgICAgY29ubmVjdGlvbnM6IFtdLFxuICAgICAgY29ubmVjdGlvbnNCZWluZ1NwYXduZWQ6IDAsXG4gICAgICBpZGVudGlmaWVyOiB0aGlzLmlkZW50aWZpZXIsXG4gICAgICBpZGxlQ291bnQ6IDAsXG4gICAgICBpblVzZUNvdW50OiAwLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0Q291bnQ6IDAsXG4gICAgICBwb29sQ2xhc3M6IHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGNvbmZpZ3VyYXRpb24gc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2FuaXRpemVkIHJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBkZWJ1Z0NvbmZpZ3VyYXRpb25TbmFwc2hvdCgpIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcG9vbENvbmZpZyA9IGRhdGFiYXNlQ29uZmlnLnBvb2xcblxuICAgIHJldHVybiB7XG4gICAgICBkYXRhYmFzZTogZGF0YWJhc2VDb25maWcuZGF0YWJhc2UsXG4gICAgICBkcml2ZXI6IGRhdGFiYXNlQ29uZmlnLmRyaXZlcj8ubmFtZSxcbiAgICAgIGhvc3Q6IGRhdGFiYXNlQ29uZmlnLmhvc3QsXG4gICAgICBtaWdyYXRpb25zOiBkYXRhYmFzZUNvbmZpZy5taWdyYXRpb25zLFxuICAgICAgbmFtZTogZGF0YWJhc2VDb25maWcubmFtZSxcbiAgICAgIHBvb2w6IHBvb2xDb25maWcgPyB7aWRsZVRpbWVvdXRNaWxsaXM6IHBvb2xDb25maWcuaWRsZVRpbWVvdXRNaWxsaXMsIG1heDogcG9vbENvbmZpZy5tYXh9IDogdW5kZWZpbmVkLFxuICAgICAgcG9ydDogZGF0YWJhc2VDb25maWcucG9ydCxcbiAgICAgIHNjaGVtYTogZGF0YWJhc2VDb25maWcuc2NoZW1hLFxuICAgICAgdHlwZTogZGF0YWJhc2VDb25maWcudHlwZSxcbiAgICAgIHVzZURhdGFiYXNlOiBkYXRhYmFzZUNvbmZpZy51c2VEYXRhYmFzZSxcbiAgICAgIHVzZXJuYW1lOiBkYXRhYmFzZUNvbmZpZy51c2VybmFtZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGNvbm5lY3Rpb24gc25hcHNob3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGV0YWlscyAtIEV4dHJhIGRpYWdub3N0aWMgZmllbGRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbm5lY3Rpb24gZGlhZ25vc3RpYyBzbmFwc2hvdC5cbiAgICovXG4gIGRlYnVnQ29ubmVjdGlvblNuYXBzaG90KGNvbm5lY3Rpb24sIGRldGFpbHMgPSB7fSkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25XaXRoUG9vbEtleSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W1BPT0xfQ09ORklHVVJBVElPTl9LRVldPzogc3RyaW5nfX0gKi8gKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uY29ubmVjdGlvbi5nZXREZWJ1Z1NuYXBzaG90KCksXG4gICAgICAuLi5kZXRhaWxzLFxuICAgICAgcmV1c2VLZXk6IGNvbm5lY3Rpb25XaXRoUG9vbEtleVtQT09MX0NPTkZJR1VSQVRJT05fS0VZXVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYWxsIGNvbm5lY3Rpb25zIGZvciB0aGlzIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbG9zZUFsbCgpIHt9XG59XG5cbmJhc2VNZXRob2RzRm9yd2FyZChWZWxvY2lvdXNEYXRhYmFzZVBvb2xCYXNlKVxuXG5leHBvcnQgZGVmYXVsdCBWZWxvY2lvdXNEYXRhYmFzZVBvb2xCYXNlXG4iXX0=