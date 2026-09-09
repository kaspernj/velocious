// @ts-check
import { AsyncLocalStorage } from "async_hooks";
import BasePool, { POOL_CONFIGURATION_KEY } from "./base.js";
import DatabasePoolCheckoutTimeoutError from "./checkout-timeout-error.js";
import { currentTestProfileContext } from "../../testing/test-profile-context.js";
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
export const CLOSED_CONNECTION = Symbol("velociousClosedConnection");
const IDLE_CONNECTION_CHECKED_IN_AT = Symbol("velociousIdleConnectionCheckedInAt");
const CONNECTION_CHECKED_OUT_AT = Symbol("velociousConnectionCheckedOutAt");
const SUPPRESSED_CONNECTION_CONTEXT = Symbol("velociousSuppressedConnectionContext");
const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MILLIS = 5000;
const DEFAULT_CHECKOUT_TIMEOUT_MILLIS = 10000;
export default class VelociousDatabasePoolAsyncTrackedMultiConnection extends BasePool {
    /**
     * Global fallback connections keyed by configuration instance and pool identifier.
     * @type {WeakMap<import("../../configuration.js").default, Record<string, import("../drivers/base.js").default>>}
     */
    static globalConnections = new WeakMap();
    asyncLocalStorage = new AsyncLocalStorage();
    /**
     * When set, returned by getCurrentContextConnection when no async context exists.
     * Used by the test runner to share a connection between test code and HTTP handlers
     * running in the same process (in-process test server mode).
     * @type {import("../drivers/base.js").default | undefined}
     */
    _testSharedConnection = undefined;
    /**
     * Dynamically resolves the connection eligible for in-process test request sharing.
     * @type {(() => import("../drivers/base.js").default | undefined) | undefined}
     */
    _testSharedConnectionProvider = undefined;
    /**
     * Identifies the lifecycle that installed the current shared connection or provider.
     * @type {import("./base.js").TestSharedConnectionRegistration | undefined}
     */
    _testSharedConnectionRegistration = undefined;
    /** Attempt-owned shared connections keyed by resolved physical configuration. */
    _testSharedConnectionsByReuseKey = new Map();
    /**
     * Concurrent providers selected by live async join context.
     * @type {Map<import("./base.js").TestSharedConnectionRegistration, {matches: () => boolean, provider: () => import("../drivers/base.js").default | undefined}>}
     */
    _testSharedConnectionProviders = new Map();
    /**
     * Connections.
     * @type {import("../drivers/base.js").default[]} */
    connections = [];
    /**
     * Physical identities requested to remain resident by the frontend tenant lifecycle.
     * @type {Set<string>}
     */
    lifecycleRetainedReuseKeys = new Set();
    /**
     * Parked lifecycle-owned connections keyed by physical identity.
     * @type {Map<string, import("../drivers/base.js").default>}
     */
    lifecycleRetainedConnections = new Map();
    /**
     * Connections in use.
     * @type {Record<number, import("../drivers/base.js").default>} */
    connectionsInUse = {};
    /**
     * Pending checkouts.
     * @type {PendingCheckout[]} */
    pendingCheckouts = [];
    /**
     * Connections being spawned.
     * @type {number} */
    connectionsBeingSpawned = 0;
    /**
     * Pending checkout drain promise.
     * @type {Promise<void> | undefined} */
    pendingCheckoutDrainPromise = undefined;
    /** Whether a caller requested another pass through the pending checkout queue. */
    pendingCheckoutDrainRequested = false;
    /**
     * Idle connection reaper timer.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    idleConnectionReaperTimer = undefined;
    /**
     * In-flight connection-close promises. The idle reaper is armed on check-in
     * and runs fire-and-forget when its timer fires, so a scheduled reap can be
     * closing a connection while an explicit `reapIdleConnections()` (or
     * `clearIdleConnectionReaperTimer()`) runs. Tracking the in-flight closes lets
     * those callers await them, so once a reap resolves the connections it
     * expired are fully closed instead of half-closed mid-`close()`.
     * @type {Set<Promise<void>>}
     */
    inflightConnectionCloses = new Set();
    /**
     * In-flight close promise per connection, so concurrent closes of the same
     * connection await the same close rather than closing the driver handle twice.
     * @type {WeakMap<object, Promise<void>>}
     */
    connectionClosePromises = new WeakMap();
    /** Cumulative low-cardinality pool telemetry. */
    telemetry = {
        connectionCreationCount: 0,
        connectionCreationFailureCount: 0,
        connectionCreationMaxMs: 0,
        connectionCreationTotalMs: 0,
        checkoutTimeoutCount: 0,
        checkoutWaitCount: 0,
        checkoutWaitMaxMs: 0,
        checkoutWaitTotalMs: 0,
        idleReapCount: 0,
        idleReapDisposalCount: 0,
        idleReapFailureCount: 0,
        idleReapMaxMs: 0,
        idleReapTotalMs: 0,
        peakLiveConnections: 0
    };
    idSeq = 0;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.identifier - Identifier.
     */
    constructor({ configuration, identifier }) {
        super({ configuration, identifier });
        /**
         * Runs a callback without the inherited current connection context.
         * @type {(callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>}
         */
        const withoutCurrentConnectionContext = (callback) => this.asyncLocalStorage.run(SUPPRESSED_CONNECTION_CONTEXT, callback);
        this._withoutCurrentConnectionContext = withoutCurrentConnectionContext;
    }
    /**
     * Returns the pool telemetry clock.
     * @returns {number} - Current time in milliseconds.
     */
    nowMs() { return Date.now(); }
    /**
     * Records a pool metric in the active async-safe test profile context.
     * @param {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} context - Captured profile context.
     * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
     * @param {{durationMs?: number, failed?: boolean, value?: number}} [values] - Aggregate values.
     * @returns {void}
     */
    recordTestProfilePoolMetric(context, metric, values = {}) {
        if (!context)
            return;
        context.profiler.recordPoolMetric(context, this.identifier, metric, values);
    }
    /**
     * Spawns and times a physical connection without retaining its configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Resolved database configuration.
     * @param {string} [reuseKey] - Exact resolved physical identity.
     * @returns {Promise<import("../drivers/base.js").default>} - Connected driver.
     */
    async spawnConnectionWithConfiguration(config, reuseKey) {
        const startedAt = this.nowMs();
        const profileContext = currentTestProfileContext(this.configuration);
        let failed = true;
        try {
            const connection = await super.spawnConnectionWithConfiguration(config, reuseKey);
            failed = false;
            const liveConnectionCount = this.liveConnectionCount() - this.connectionsBeingSpawned + 1;
            if (liveConnectionCount > this.telemetry.peakLiveConnections) {
                this.telemetry.peakLiveConnections = liveConnectionCount;
                this.recordTestProfilePoolMetric(profileContext, "peakLiveConnections", { value: liveConnectionCount });
            }
            return connection;
        }
        finally {
            const durationMs = Math.max(0, this.nowMs() - startedAt);
            this.telemetry.connectionCreationCount++;
            if (failed)
                this.telemetry.connectionCreationFailureCount++;
            this.telemetry.connectionCreationTotalMs += durationMs;
            this.telemetry.connectionCreationMaxMs = Math.max(this.telemetry.connectionCreationMaxMs, durationMs);
            this.recordTestProfilePoolMetric(profileContext, "connectionCreation", { durationMs, failed });
        }
    }
    /**
     * Runs checkin.
     * @param {import("../drivers/base.js").default} connection - Database connection instance.
     * @returns {Promise<void>} - Resolves when the connection is checked in or closed.
     */
    async checkin(connection) {
        const id = connection.getIdSeq();
        const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean, [CONNECTION_CHECKED_OUT_AT]?: number, [IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection);
        if (trackedConnection[CLOSED_CONNECTION]) {
            if (typeof id === "number")
                this.untrackConnectionInUse(connection, id);
            await this.drainPendingCheckouts();
            return;
        }
        try {
            await this.rollbackLeftOpenTransaction(connection);
            await connection.releaseHeldAdvisoryLocks();
            await connection.clearConnectionCheckoutName();
            await connection.cleanupSessionStateAfterCheckout();
        }
        catch (error) {
            await this.closeCheckedOutConnectionAfterCheckinFailure(connection, id, error);
            throw error;
        }
        this.untrackConnectionInUse(connection, id);
        delete trackedConnection[CONNECTION_CHECKED_OUT_AT];
        const reuseKey = this.getConnectionConfigurationReuseKey(connection);
        if (this.lifecycleRetainedReuseKeys.has(reuseKey)) {
            const retainedConnection = this.lifecycleRetainedConnections.get(reuseKey);
            if (!retainedConnection || retainedConnection === connection || retainedConnection.getIdSeq() !== undefined) {
                delete trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT];
                this.lifecycleRetainedConnections.set(reuseKey, connection);
                await this.drainPendingCheckouts();
                return;
            }
        }
        trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT] = Date.now();
        this.connections.push(connection);
        await this.drainPendingCheckouts();
        if (this.connections.includes(connection))
            await this.handleCheckedInIdleConnection();
    }
    /**
     * Permanently removes and closes a checked-out connection.
     * @param {import("../drivers/base.js").default} connection - Connection that must not return to the pool.
     */
    async discard(connection) {
        const id = connection.getIdSeq();
        const errors = [];
        this.untrackConnectionInUse(connection, id);
        try {
            await this.closeConnection(connection);
        }
        catch (error) {
            errors.push(error);
        }
        try {
            await this.drainPendingCheckouts();
        }
        catch (error) {
            errors.push(error);
        }
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to discard a database connection");
    }
    /**
     * Runs close checked out connection after checkin failure.
     * @param {import("../drivers/base.js").default} connection - Connection that failed check-in cleanup.
     * @param {number | undefined} id - Connection checkout id.
     * @param {ReturnType<typeof JSON.parse>} originalError - Error that caused check-in cleanup to fail.
     * @returns {Promise<void>} - Resolves when cleanup has been attempted.
     */
    async closeCheckedOutConnectionAfterCheckinFailure(connection, id, originalError) {
        this.untrackConnectionInUse(connection, id);
        try {
            await this.closeConnection(connection);
        }
        catch (error) {
            this.logger.warn("Failed to close database connection after check-in cleanup failed", { error, originalError });
        }
        try {
            await this.drainPendingCheckouts();
        }
        catch (error) {
            this.logger.warn("Failed to drain pending database checkouts after check-in cleanup failed", { error, originalError });
        }
    }
    /**
     * Runs untrack connection in use.
     * @param {import("../drivers/base.js").default} connection - Connection being checked in.
     * @param {number | undefined} id - Connection checkout id.
     * @returns {void}
     */
    untrackConnectionInUse(connection, id) {
        if (typeof id !== "number") {
            throw new Error(`idSeq on connection wasn't set? '${typeof id}' = ${id}`);
        }
        delete this.connectionsInUse[id];
        connection.setIdSeq(undefined);
    }
    /**
     * Runs handle checked in idle connection.
     * @returns {Promise<void>} - Resolves once idle reaping has been scheduled or run.
     */
    async handleCheckedInIdleConnection() {
        if (this.idleTimeoutMillis() === 0) {
            await this.reapIdleConnections();
        }
        else {
            this.scheduleIdleConnectionReaper();
        }
    }
    /**
     * Runs checkout.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
     */
    async checkout(options = {}) {
        this.assertDatabaseAccessAllowed();
        let databaseConfig = this.getConfiguration();
        let reuseKey = this.getConfigurationReuseKey(databaseConfig);
        let connection = this.takeIdleConnectionForReuseKey(reuseKey);
        if (connection)
            return await this.activateConnection(connection, options);
        await this.reapIdleConnections();
        databaseConfig = this.getConfiguration();
        reuseKey = this.getConfigurationReuseKey(databaseConfig);
        connection = this.takeIdleConnectionForReuseKey(reuseKey);
        if (connection)
            return await this.activateConnection(connection, options);
        if (this.canSpawnConnection(databaseConfig)) {
            // The post-reap configuration is fresh for the current caller, and its reuse key is
            // derived from this exact captured object so the connection cannot open one tenant while
            // being stamped for another. The queued path retains the same captured pair.
            connection = await this.spawnConnectionForCheckout(databaseConfig, reuseKey, currentTestProfileContext(this.configuration));
            return await this.activateConnection(connection, options);
        }
        return await this.waitForCheckout(databaseConfig, reuseKey, options);
    }
    /**
     * Checks out a connection for an already-resolved physical configuration
     * without consulting ambient tenant state.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Captured database configuration.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Activated pooled connection.
     */
    async checkoutForConfiguration(databaseConfig, options = {}) {
        this.assertDatabaseAccessAllowed();
        const reuseKey = this.getConfigurationReuseKey(databaseConfig);
        const lifecycleRetainedConnection = this.lifecycleRetainedConnections.get(reuseKey);
        if (lifecycleRetainedConnection && lifecycleRetainedConnection.getIdSeq() === undefined) {
            return await this.activateConnection(lifecycleRetainedConnection, options);
        }
        let connection = this.takeIdleConnectionForReuseKey(reuseKey);
        if (connection)
            return await this.activateConnection(connection, options);
        await this.reapIdleConnections();
        connection = this.takeIdleConnectionForReuseKey(reuseKey);
        if (connection)
            return await this.activateConnection(connection, options);
        if (this.canSpawnConnection(databaseConfig)) {
            connection = await this.spawnConnectionForCheckout(databaseConfig, reuseKey, currentTestProfileContext(this.configuration));
            return await this.activateConnection(connection, options);
        }
        return await this.waitForCheckout(databaseConfig, reuseKey, options);
    }
    /**
     * Runs take idle connection for reuse key.
     * @param {string} reuseKey - Database configuration reuse key.
     * @param {object} [args] - Options.
     * @param {boolean} [args.includeOpenTransactions] - Whether connections with open transactions may be returned.
     * @returns {import("../drivers/base.js").default | undefined} - Matching idle connection.
     */
    takeIdleConnectionForReuseKey(reuseKey, { includeOpenTransactions = true } = {}) {
        const connectionIndex = this.connections.findIndex((queuedConnection) => {
            if (!includeOpenTransactions && this.connectionHasOpenTransaction(queuedConnection))
                return false;
            return this.connectionMatchesReuseKey(queuedConnection, reuseKey);
        });
        const connection = connectionIndex === -1 ? undefined : this.connections.splice(connectionIndex, 1)[0];
        return connection;
    }
    /**
     * Runs connection matches reuse key.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @param {string} reuseKey - Database configuration reuse key.
     * @returns {boolean} - Whether the connection matches the reuse key.
     */
    connectionMatchesReuseKey(connection, reuseKey) {
        const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection);
        return connectionWithPoolKey[POOL_CONFIGURATION_KEY] === reuseKey;
    }
    /**
     * Runs activate connection.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Activated connection.
     */
    async activateConnection(connection, options = {}) {
        try {
            this.assertDatabaseAccessAllowed();
        }
        catch (error) {
            await this.closeRejectedCheckoutAndThrow(connection, error);
        }
        if (connection.getIdSeq() !== undefined)
            throw new Error(`Connection already has an ID-seq - is it in use? ${connection.getIdSeq()}`);
        const id = this.idSeq++;
        const trackedConnection = /** @type {import("../drivers/base.js").default & {[CONNECTION_CHECKED_OUT_AT]?: number, [IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection);
        delete trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT];
        trackedConnection[CONNECTION_CHECKED_OUT_AT] = Date.now();
        connection.setIdSeq(id);
        this.connectionsInUse[id] = connection;
        try {
            await connection.setConnectionCheckoutName(options.name);
            this.assertDatabaseAccessAllowed();
        }
        catch (error) {
            await this.closeRejectedCheckoutAndThrow(connection, error, id);
        }
        return connection;
    }
    /**
     * Closes a rejected checkout, then hands freed capacity to queued callers.
     * @param {import("../drivers/base.js").default} connection - Rejected connection.
     * @param {ReturnType<typeof JSON.parse>} error - Access revocation error.
     * @param {number} [id] - Assigned checkout id, if activation reached that stage.
     * @returns {Promise<never>} - Always rejects with the access or cleanup errors.
     */
    async closeRejectedCheckoutAndThrow(connection, error, id) {
        if (id !== undefined)
            this.untrackConnectionInUse(connection, id);
        /** @type {ReturnType<typeof JSON.parse>[]} */
        const cleanupErrors = [];
        try {
            await this.closeConnection(connection);
        }
        catch (closeError) {
            cleanupErrors.push(closeError);
        }
        try {
            if (this.pendingCheckoutDrainPromise) {
                this.pendingCheckoutDrainRequested = true;
            }
            else {
                await this.drainPendingCheckouts();
            }
        }
        catch (drainError) {
            cleanupErrors.push(drainError);
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError([error, ...cleanupErrors], "Database checkout rejection cleanup failed", { cause: error });
        }
        throw error;
    }
    /**
     * Runs max connections.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfig] - Configuration whose pool maximum applies.
     * @returns {number | null} - Configured max live connections.
     */
    maxConnections(databaseConfig = this.getConfiguration()) {
        const value = databaseConfig.pool?.max;
        if (value === null)
            return null;
        if (this.validMaxConnections(value))
            return value;
        return DEFAULT_MAX_CONNECTIONS;
    }
    /**
     * Runs checkout timeout millis.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfig] - Configuration whose timeout applies.
     * @returns {number | null} - Pending checkout timeout in milliseconds, or null when disabled.
     */
    checkoutTimeoutMillis(databaseConfig = this.getConfiguration()) {
        const value = databaseConfig.pool?.checkoutTimeoutMillis;
        if (value === null)
            return null;
        if (this.validCheckoutTimeoutMillis(value))
            return value;
        return DEFAULT_CHECKOUT_TIMEOUT_MILLIS;
    }
    /**
     * Runs valid checkout timeout millis.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate checkout timeout.
     * @returns {value is number} - Whether the value is a valid timeout.
     */
    validCheckoutTimeoutMillis(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0;
    }
    /**
     * Runs valid max connections.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate max connection count.
     * @returns {value is number} - Whether the value is a valid max connection count.
     */
    validMaxConnections(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 1;
    }
    /**
     * Runs live connection count.
     * @returns {number} - Number of live and in-progress connections.
     */
    liveConnectionCount() {
        const connections = new Set([
            ...this.connections,
            ...Object.values(this.connectionsInUse),
            ...this.lifecycleRetainedConnections.values(),
            this.getGlobalConnectionForIdentifier()
        ].filter(Boolean));
        return connections.size + this.connectionsBeingSpawned;
    }
    /**
     * Runs can spawn connection.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} [databaseConfig] - Configuration whose pool maximum applies.
     * @returns {boolean} - Whether a new connection can be spawned.
     */
    canSpawnConnection(databaseConfig = this.getConfiguration()) {
        const maxConnections = this.maxConnections(databaseConfig);
        return maxConnections === null || this.liveConnectionCount() < maxConnections;
    }
    /**
     * Runs spawn connection for checkout.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database config for the checkout.
     * @param {string} reuseKey - Database configuration reuse key for the checkout.
     * @param {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} profileContext - Profile context captured when checkout began.
     * @returns {Promise<import("../drivers/base.js").default>} - Spawned connection.
     */
    async spawnConnectionForCheckout(databaseConfig, reuseKey, profileContext) {
        this.connectionsBeingSpawned++;
        try {
            const environmentHandler = this.configuration.getEnvironmentHandler();
            const connection = await environmentHandler.runWithTestProfileContext(profileContext, async () => {
                return await this.spawnConnectionWithConfiguration(databaseConfig, this.getConfigurationReuseKey(databaseConfig));
            });
            this.stampConnectionForConfigurationReuseKey(connection, reuseKey);
            return connection;
        }
        finally {
            this.connectionsBeingSpawned--;
        }
    }
    /**
     * Runs wait for checkout.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database config for the checkout.
     * @param {string} reuseKey - Database configuration reuse key.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with an activated connection.
     */
    async waitForCheckout(databaseConfig, reuseKey, options = {}) {
        return await new Promise((resolve, reject) => {
            const enqueuedAt = Date.now();
            const timeoutMillis = this.checkoutTimeoutMillis(databaseConfig);
            /** @type {PendingCheckout} */
            const checkout = {
                databaseConfig,
                enqueuedAt,
                options,
                reject,
                resolve,
                reuseKey,
                timeoutAt: timeoutMillis === null ? null : enqueuedAt + timeoutMillis,
                timeoutMillis,
                timeoutTimer: undefined,
                testDatabaseAccessScope: this.configuration.getEnvironmentHandler().currentTestDatabaseAccessScope(),
                testProfileContext: currentTestProfileContext(this.configuration)
            };
            checkout.timeoutTimer = this.startPendingCheckoutTimeout(checkout);
            this.pendingCheckouts.push(checkout);
            void this.drainPendingCheckouts().catch((error) => {
                const checkoutError = error instanceof Error ? error : new Error("Failed to drain pending database connection checkouts.", { cause: error });
                this.rejectPendingCheckouts(checkoutError);
            });
        });
    }
    /**
     * Runs drain pending checkouts.
     * @returns {Promise<void>} - Resolves when pending checkouts have been drained as far as possible.
     */
    async drainPendingCheckouts() {
        this.pendingCheckoutDrainRequested = true;
        if (!this.pendingCheckoutDrainPromise)
            this.startPendingCheckoutDrain();
        await this.pendingCheckoutDrainPromise;
    }
    /**
     * Starts the single checkout-drain owner. The shared promise is cleared before
     * it settles, closing the resolved-promise/stale-field interval in which a new
     * request could otherwise be lost.
     * @returns {void}
     */
    startPendingCheckoutDrain() {
        const { promise, reject, resolve } = Promise.withResolvers();
        this.pendingCheckoutDrainPromise = promise;
        void this.runRequestedPendingCheckoutDrains({ reject, resolve });
    }
    /**
     * Runs drain passes until every request observed during the active pass has
     * received a later pass.
     * @param {{reject: (reason?: ReturnType<typeof JSON.parse>) => void, resolve: (value?: void) => void}} deferred - Shared drain settlement.
     * @returns {Promise<void>}
     */
    async runRequestedPendingCheckoutDrains({ reject, resolve }) {
        try {
            while (this.pendingCheckoutDrainRequested) {
                this.pendingCheckoutDrainRequested = false;
                await this.drainPendingCheckoutsActual();
            }
        }
        catch (error) {
            this.pendingCheckoutDrainPromise = undefined;
            reject(error);
            return;
        }
        this.pendingCheckoutDrainPromise = undefined;
        resolve();
    }
    /**
     * Runs drain pending checkouts actual.
     * @returns {Promise<void>} - Resolves when pending checkouts have been drained as far as possible.
     */
    async drainPendingCheckoutsActual() {
        while (this.pendingCheckouts.length > 0) {
            if (await this.resolvePendingCheckoutWithMatchingIdleConnection())
                continue;
            const checkout = this.pendingCheckouts[0];
            if (await this.closeIdleConnectionForPendingCheckoutCapacity(checkout))
                continue;
            if (!this.pendingCheckouts.includes(checkout))
                continue;
            if (this.canSpawnConnection(checkout.databaseConfig)) {
                this.removePendingCheckoutAt(0);
                await this.spawnAndResolvePendingCheckout(checkout);
                continue;
            }
            const reapedConnection = await this.idleConnectionForPendingCheckout(checkout);
            if (!this.pendingCheckouts.includes(checkout))
                continue;
            if (!reapedConnection)
                return;
            this.removePendingCheckoutAt(0);
            await this.resolvePendingCheckout(checkout, reapedConnection);
        }
    }
    /**
     * Runs resolve pending checkout with matching idle connection.
     * @returns {Promise<boolean>} - Whether a pending checkout was resolved with an idle connection.
     */
    async resolvePendingCheckoutWithMatchingIdleConnection() {
        for (let index = 0; index < this.pendingCheckouts.length; index++) {
            const checkout = this.pendingCheckouts[index];
            const connection = this.takeIdleConnectionForReuseKey(checkout.reuseKey, { includeOpenTransactions: false });
            if (!connection)
                continue;
            this.removePendingCheckoutAt(index);
            await this.resolvePendingCheckout(checkout, connection);
            return true;
        }
        return false;
    }
    /**
     * Runs remove pending checkout at.
     * @param {number} index - Pending checkout index.
     * @returns {PendingCheckout} - Removed checkout.
     */
    removePendingCheckoutAt(index) {
        const checkout = this.pendingCheckouts.splice(index, 1)[0];
        this.clearPendingCheckoutTimeout(checkout);
        this.recordCheckoutWait(checkout);
        return checkout;
    }
    /**
     * Records a completed queue wait without retaining per-checkout labels or samples.
     * @param {PendingCheckout} checkout - Checkout leaving the pending queue.
     * @returns {void}
     */
    recordCheckoutWait(checkout) {
        const waitedForMs = Math.max(0, this.nowMs() - checkout.enqueuedAt);
        this.telemetry.checkoutWaitCount++;
        this.telemetry.checkoutWaitTotalMs += waitedForMs;
        this.telemetry.checkoutWaitMaxMs = Math.max(this.telemetry.checkoutWaitMaxMs, waitedForMs);
        this.recordTestProfilePoolMetric(checkout.testProfileContext, "checkoutWait", { durationMs: waitedForMs });
    }
    /**
     * Runs start pending checkout timeout.
     * @param {PendingCheckout} checkout - Pending checkout to time out.
     * @returns {ReturnType<typeof setTimeout> | undefined} - Timer, if timeout is enabled.
     */
    startPendingCheckoutTimeout(checkout) {
        if (checkout.timeoutMillis === null)
            return undefined;
        const timer = setTimeout(() => {
            this.timeoutPendingCheckout(checkout);
        }, checkout.timeoutMillis);
        return timer;
    }
    /**
     * Runs timeout pending checkout.
     * @param {PendingCheckout} checkout - Pending checkout to reject.
     * @returns {void}
     */
    timeoutPendingCheckout(checkout) {
        const index = this.pendingCheckouts.indexOf(checkout);
        if (index === -1)
            return;
        this.removePendingCheckoutAt(index);
        this.telemetry.checkoutTimeoutCount++;
        this.recordTestProfilePoolMetric(checkout.testProfileContext, "checkoutTimeout");
        checkout.reject(this.pendingCheckoutTimeoutError(checkout));
    }
    /**
     * Runs pending checkout timeout error.
     * @param {PendingCheckout} checkout - Timed-out checkout.
     * @returns {DatabasePoolCheckoutTimeoutError} - Timeout error.
     */
    pendingCheckoutTimeoutError(checkout) {
        const checkoutName = checkout.options.name ? ` Checkout name: ${JSON.stringify(checkout.options.name)}.` : "";
        const diagnostics = this.pendingCheckoutTimeoutDiagnostics(checkout);
        return new DatabasePoolCheckoutTimeoutError(`Timed out after ${checkout.timeoutMillis}ms waiting for database connection checkout from pool "${this.identifier}".${checkoutName} ${diagnostics}`);
    }
    /**
     * Builds sanitized diagnostics for a checkout timeout.
     * @param {PendingCheckout} checkout - Timed-out checkout.
     * @returns {string} - Pool state summary.
     */
    pendingCheckoutTimeoutDiagnostics(checkout) {
        const snapshot = this.getDebugSnapshot();
        const connectionSummaries = snapshot.connections
            .map((connection) => this.pendingCheckoutTimeoutConnectionSummary(connection))
            .join(", ");
        const pendingSummaries = (snapshot.pendingCheckouts || [])
            .map((pendingCheckout) => this.pendingCheckoutTimeoutPendingSummary(pendingCheckout))
            .join(", ");
        const waitedForMs = Math.max(0, Date.now() - checkout.enqueuedAt);
        return `Pool state: max=${this.maxConnections() ?? "unbounded"}, inUse=${snapshot.inUseCount}, idle=${snapshot.idleCount}, pending=${snapshot.pendingCheckoutCount}, spawning=${snapshot.connectionsBeingSpawned}, timedOutWaitingForMs=${waitedForMs}, holders=[${connectionSummaries}], waiting=[${pendingSummaries}].`;
    }
    /**
     * Builds a sanitized connection summary for checkout timeout diagnostics.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} connection - Connection debug snapshot.
     * @returns {string} - Sanitized connection state.
     */
    pendingCheckoutTimeoutConnectionSummary(connection) {
        const parts = [`state=${connection.state}`];
        if (connection.checkoutName)
            parts.push(`checkout=${JSON.stringify(connection.checkoutName)}`);
        if (typeof connection.checkedOutForMs === "number")
            parts.push(`checkedOutForMs=${connection.checkedOutForMs}`);
        if (typeof connection.idleForMs === "number")
            parts.push(`idleForMs=${connection.idleForMs}`);
        if (typeof connection.openTransactions === "number")
            parts.push(`openTransactions=${connection.openTransactions}`);
        const activeQuery = connection.activeQuery;
        if (activeQuery && typeof activeQuery === "object" && !Array.isArray(activeQuery)) {
            const runningMs = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (activeQuery).runningMs;
            if (typeof runningMs === "number")
                parts.push(`activeQueryMs=${runningMs}`);
        }
        return `{${parts.join(" ")}}`;
    }
    /**
     * Builds a sanitized pending checkout summary for checkout timeout diagnostics.
     * @param {import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot} pendingCheckout - Waiting checkout snapshot.
     * @returns {string} - Sanitized pending checkout state.
     */
    pendingCheckoutTimeoutPendingSummary(pendingCheckout) {
        const parts = [`index=${pendingCheckout.index}`, `waitingForMs=${pendingCheckout.waitingForMs}`];
        if (pendingCheckout.checkoutName)
            parts.push(`checkout=${JSON.stringify(pendingCheckout.checkoutName)}`);
        if (pendingCheckout.remainingTimeoutMs !== null)
            parts.push(`remainingTimeoutMs=${pendingCheckout.remainingTimeoutMs}`);
        return `{${parts.join(" ")}}`;
    }
    /**
     * Runs clear pending checkout timeout.
     * @param {PendingCheckout} checkout - Pending checkout.
     * @returns {void}
     */
    clearPendingCheckoutTimeout(checkout) {
        if (!checkout.timeoutTimer)
            return;
        clearTimeout(checkout.timeoutTimer);
        checkout.timeoutTimer = undefined;
    }
    /**
     * Runs close idle connection for pending checkout capacity.
     * @param {PendingCheckout} checkout - Checkout waiting for a connection.
     * @returns {Promise<boolean>} - Whether an idle connection was closed to free capacity.
     */
    async closeIdleConnectionForPendingCheckoutCapacity(checkout) {
        const connection = this.findIdleConnectionForReuseKey(checkout.reuseKey);
        if (connection)
            return false;
        await this.reapIdleConnections();
        if (this.findIdleConnectionForReuseKey(checkout.reuseKey))
            return false;
        return this.canSpawnConnection(checkout.databaseConfig) ? false : await this.closeOneIdleConnectionForCapacity();
    }
    /**
     * Runs find idle connection for reuse key.
     * @param {string} reuseKey - Database configuration reuse key.
     * @returns {import("../drivers/base.js").default | undefined} - Matching idle connection, if present.
     */
    findIdleConnectionForReuseKey(reuseKey) {
        return this.connections.find((connection) => !this.connectionHasOpenTransaction(connection) && this.connectionMatchesReuseKey(connection, reuseKey));
    }
    /**
     * Runs idle connection for pending checkout.
     * @param {PendingCheckout} checkout - Checkout waiting for a connection.
     * @returns {Promise<import("../drivers/base.js").default | undefined>} - Matching idle connection, if one can be reused.
     */
    async idleConnectionForPendingCheckout(checkout) {
        let connection = this.takeIdleConnectionForReuseKey(checkout.reuseKey, { includeOpenTransactions: false });
        if (connection)
            return connection;
        await this.reapIdleConnections();
        if (!this.pendingCheckouts.includes(checkout))
            return;
        connection = this.takeIdleConnectionForReuseKey(checkout.reuseKey, { includeOpenTransactions: false });
        return connection;
    }
    /**
     * Runs spawn and resolve pending checkout.
     * @param {PendingCheckout} checkout - Checkout request to resolve.
     * @returns {Promise<void>} - Resolves when the checkout has been handled.
     */
    async spawnAndResolvePendingCheckout(checkout) {
        const environmentHandler = this.configuration.getEnvironmentHandler();
        return await environmentHandler.runWithTestProfileContext(checkout.testProfileContext, async () => {
            return await environmentHandler.runWithCapturedTestDatabaseAccessScope(checkout.testDatabaseAccessScope, async () => {
                let connection;
                try {
                    this.assertDatabaseAccessAllowed();
                    connection = await this.spawnConnectionForCheckout(checkout.databaseConfig, checkout.reuseKey, checkout.testProfileContext);
                }
                catch (error) {
                    checkout.reject(error instanceof Error ? error : new Error("Failed to spawn database connection.", { cause: error }));
                    return;
                }
                await this.resolvePendingCheckout(checkout, connection);
            });
        });
    }
    /**
     * Runs resolve pending checkout.
     * @param {PendingCheckout} checkout - Checkout request to resolve.
     * @param {import("../drivers/base.js").default} connection - Connection to activate.
     * @returns {Promise<void>} - Resolves when the checkout has been handled.
     */
    async resolvePendingCheckout(checkout, connection) {
        const environmentHandler = this.configuration.getEnvironmentHandler();
        return await environmentHandler.runWithTestProfileContext(checkout.testProfileContext, async () => {
            return await environmentHandler.runWithCapturedTestDatabaseAccessScope(checkout.testDatabaseAccessScope, async () => {
                try {
                    checkout.resolve(await this.activateConnection(connection, checkout.options));
                }
                catch (error) {
                    checkout.reject(error instanceof Error ? error : new Error("Failed to activate database connection.", { cause: error }));
                }
            });
        });
    }
    /**
     * Runs close one idle connection for capacity.
     * @returns {Promise<boolean>} - Whether an idle connection was closed to free capacity.
     */
    async closeOneIdleConnectionForCapacity() {
        const connection = this.connections.find((candidate) => !this.connectionHasOpenTransaction(candidate));
        if (!connection)
            return false;
        this.connections = this.connections.filter((candidate) => candidate !== connection);
        await this.closeConnection(connection);
        return true;
    }
    /**
     * Runs with connection.
     * @template T
     * @param {import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} optionsOrCallback - Checkout options or callback to invoke with the connection.
     * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [callback] - Callback to invoke with the connection.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withConnection(optionsOrCallback, callback) {
        this.assertDatabaseAccessAllowed();
        const options = typeof optionsOrCallback == "function" ? {} : optionsOrCallback;
        const actualCallback = typeof optionsOrCallback == "function" ? optionsOrCallback : callback;
        if (!actualCallback)
            throw new Error("withConnection requires a callback");
        const testSharedConnection = this.activeTestSharedConnection();
        if (testSharedConnection && this.connectionMatchesCurrentConfiguration(testSharedConnection)) {
            return await this.asyncLocalStorage.run(testSharedConnection.getIdSeq(), async () => {
                return await actualCallback(testSharedConnection);
            });
        }
        const connection = await this.checkout(options);
        const id = connection.getIdSeq();
        return await this.asyncLocalStorage.run(id, async () => {
            try {
                return await actualCallback(connection);
            }
            finally {
                await this.checkin(connection);
            }
        });
    }
    async openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        const wasRetained = this.lifecycleRetainedReuseKeys.has(reuseKey);
        this.lifecycleRetainedReuseKeys.add(reuseKey);
        try {
            const connection = await this.checkoutForConfiguration(databaseConfiguration, { name: "Frontend tenant SQLite open" });
            await this.checkin(connection);
        }
        catch (error) {
            if (!wasRetained)
                this.lifecycleRetainedReuseKeys.delete(reuseKey);
            throw error;
        }
    }
    async flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        const connection = this.lifecycleRetainedConnections.get(reuseKey)
            || this.connections.find((candidate) => this.getConnectionConfigurationReuseKey(candidate) === reuseKey);
        if (connection)
            await connection.flushPendingWrites();
    }
    async closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        if (this.capturedConnectionInUse(databaseConfiguration))
            throw new Error("Cannot close an in-use frontend tenant SQLite handle");
        const retainedConnection = this.lifecycleRetainedConnections.get(reuseKey);
        this.lifecycleRetainedReuseKeys.delete(reuseKey);
        this.lifecycleRetainedConnections.delete(reuseKey);
        const connections = this.connections.filter((candidate) => this.getConnectionConfigurationReuseKey(candidate) === reuseKey);
        this.connections = this.connections.filter((candidate) => this.getConnectionConfigurationReuseKey(candidate) !== reuseKey);
        if (retainedConnection)
            connections.push(retainedConnection);
        for (const connection of connections)
            await this.closeConnection(connection);
    }
    async deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        await this.closeCapturedConnection(databaseConfiguration);
        const DriverClass = databaseConfiguration.driver || this.driverClass;
        if (!DriverClass)
            throw new Error("No driver class configured for frontend tenant SQLite deletion");
        await new DriverClass(databaseConfiguration, this.configuration).deleteDatabaseStorage();
    }
    capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        return Object.values(this.connectionsInUse).some((connection) => this.getConnectionConfigurationReuseKey(connection) === reuseKey);
    }
    capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        const connections = [...this.connections, ...Object.values(this.connectionsInUse), ...this.lifecycleRetainedConnections.values()];
        return connections.some((connection) => this.getConnectionConfigurationReuseKey(connection) === reuseKey && connection.hasPendingWrites());
    }
    /**
     * Runs a captured operation through the normal bounded pool lifecycle.
     * @template T
     * @param {import("./base.js").CapturedConnectionOptions} options - Captured checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    async withCapturedOperationConnection({ databaseConfiguration, name }, callback) {
        const connection = await this.checkoutForConfiguration(databaseConfiguration, { name });
        const id = connection.getIdSeq();
        const owner = Symbol("captured-database-operation-owner");
        return await this.asyncLocalStorage.run(id, async () => {
            try {
                return await callback(connection, owner);
            }
            finally {
                await this.checkin(connection);
            }
        });
    }
    /**
     * Runs get current connection.
     * @returns {import("../drivers/base.js").default} - The current connection.
     */
    getCurrentConnection() {
        this.assertDatabaseAccessAllowed();
        const id = this.asyncLocalStorage.getStore();
        if (id === undefined)
            return this.currentFallbackConnectionOrFail();
        if (id === SUPPRESSED_CONNECTION_CONTEXT)
            return this.currentFallbackConnectionOrFail();
        this.ensureConnectionIsInUse(id);
        const currentConnection = this.connectionsInUse[id];
        if (!currentConnection) {
            throw new Error(`Couldn't get current connection from that ID: ${id}`);
        }
        return currentConnection;
    }
    /**
     * Runs current fallback connection or fail.
     * @returns {import("../drivers/base.js").default} - Fallback connection, if present.
     */
    currentFallbackConnectionOrFail() {
        const fallbackConnection = this.getGlobalConnection();
        if (fallbackConnection)
            return fallbackConnection;
        throw new Error("ID hasn't been set for this async context");
    }
    /**
     * Runs ensure connection is in use.
     * @param {number} id - Checked-out connection id.
     * @returns {void}
     */
    ensureConnectionIsInUse(id) {
        if (!(id in this.connectionsInUse)) {
            throw new Error(`Connection ${id} doesn't exist any more - has it been checked in again?`);
        }
    }
    /**
     * Registers a fallback connection for this pool identifier that will be used when no async context is available.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {void} - No return value.
     */
    setGlobalConnection(connection) {
        const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor);
        let mapForConfiguration = klass.globalConnections.get(this.configuration);
        if (!mapForConfiguration) {
            mapForConfiguration = {};
            klass.globalConnections.set(this.configuration, mapForConfiguration);
        }
        mapForConfiguration[this.identifier] = connection;
    }
    /**
     * Ensures a global fallback connection exists for this pool identifier and returns it.
     * If one is already set, it is returned and also made available in the pool queue.
     * Otherwise a new connection is spawned, registered, and queued.
     * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the global connection.
     */
    async ensureGlobalConnection() {
        const existing = this.getGlobalConnection();
        if (existing)
            return existing;
        const connection = await this.spawnConnection();
        this.setGlobalConnection(connection);
        return connection;
    }
    /**
     * Set a shared connection for test mode so that HTTP handlers running
     * in the same process can reuse the test runner's database connection.
     * @param {import("../drivers/base.js").default} connection - Shared connection.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnection(connection) {
        const registration = { owner: Symbol("test-shared-connection") };
        this._testSharedConnection = connection;
        this._testSharedConnectionProvider = undefined;
        this._testSharedConnectionRegistration = registration;
        return registration;
    }
    /**
     * Sets a provider that is evaluated when an in-process test request is dispatched.
     * @param {() => import("../drivers/base.js").default | undefined} provider - Shared connection provider.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnectionProvider(provider) {
        const registration = { owner: Symbol("test-shared-connection-provider") };
        this._testSharedConnection = undefined;
        this._testSharedConnectionProvider = provider;
        this._testSharedConnectionRegistration = registration;
        return registration;
    }
    /**
     * Registers a provider selected by the current live async join context.
     * @param {{matches: () => boolean, provider: () => import("../drivers/base.js").default | undefined}} args - Context selector and provider.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque scoped registration handle.
     */
    registerTestSharedConnectionProvider(args) {
        const registration = { owner: Symbol("test-shared-connection-context-provider") };
        this._testSharedConnectionProviders.set(registration, args);
        return registration;
    }
    /**
     * Registers an attempt-owned connection for exactly one physical configuration.
     * @param {import("../drivers/base.js").default} connection - Attempt-owned connection.
     * @param {string} reuseKey - Resolved physical configuration identity.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnectionForConfiguration(connection, reuseKey) {
        const registration = { owner: Symbol("test-shared-physical-connection") };
        this._testSharedConnectionsByReuseKey.set(reuseKey, { connection, registration });
        return registration;
    }
    /**
     * Clears the current shared connection registration. A supplied stale registration
     * cannot clear a provider installed by a newer lifecycle.
     * @param {import("./base.js").TestSharedConnectionRegistration} [registration] - Opaque registration handle to clear conditionally.
     * @returns {void} */
    clearTestSharedConnection(registration) {
        if (registration && this._testSharedConnectionProviders.delete(registration))
            return;
        if (registration) {
            for (const [reuseKey, entry] of this._testSharedConnectionsByReuseKey) {
                if (entry.registration !== registration)
                    continue;
                this._testSharedConnectionsByReuseKey.delete(reuseKey);
                return;
            }
        }
        else {
            this._testSharedConnectionsByReuseKey.clear();
        }
        if (registration && registration !== this._testSharedConnectionRegistration)
            return;
        this._testSharedConnection = undefined;
        this._testSharedConnectionProvider = undefined;
        this._testSharedConnectionRegistration = undefined;
    }
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
    runWithTestSharedConnection(callback) {
        const connection = this.activeTestSharedConnection();
        if (!connection)
            return callback();
        return this.asyncLocalStorage.run(connection.getIdSeq(), callback);
    }
    /**
     * Resolves a test-shared connection only while its checkout ID is still owned by this pool.
     * Fallback-only registrations have no checkout ID and must enter the normal checkout path.
     * @returns {import("../drivers/base.js").default | undefined} - Active shared connection.
     */
    activeTestSharedConnection() {
        const connection = this.testSharedConnection();
        const id = connection?.getIdSeq();
        if (typeof id !== "number")
            return;
        if (this.connectionsInUse[id] !== connection)
            return;
        return connection;
    }
    /**
     * Resolves the connection currently eligible for in-process test request sharing.
     * @returns {import("../drivers/base.js").default | undefined} - Shared connection.
     */
    testSharedConnection() {
        for (const { matches, provider } of this._testSharedConnectionProviders.values()) {
            if (matches())
                return provider();
        }
        const reuseKey = this.getConfigurationReuseKey();
        const physicalRegistration = this._testSharedConnectionsByReuseKey.get(reuseKey);
        if (physicalRegistration)
            return physicalRegistration.connection;
        return this._testSharedConnectionProvider
            ? this._testSharedConnectionProvider()
            : this._testSharedConnection;
    }
    /**
     * Returns the connection tied to the current async context, if any.
     * Falls back to the test shared connection when no async context exists.
     * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
     */
    getCurrentContextConnection() {
        const id = this.asyncLocalStorage.getStore();
        if (id === SUPPRESSED_CONNECTION_CONTEXT)
            return undefined;
        if (id === undefined)
            return this.testSharedConnection();
        return this.getCurrentConnection();
    }
    /**
     * Returns whether this pool has a real async context for the current connection.
     * @returns {boolean} - Whether nested code can reuse the current connection context.
     */
    hasCurrentConnectionContext() {
        const id = this.asyncLocalStorage.getStore();
        return id !== undefined && id !== SUPPRESSED_CONNECTION_CONTEXT;
    }
    /**
     * Runs get debug snapshot.
     * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
     */
    getDebugSnapshot() {
        const snapshot = super.getDebugSnapshot();
        const now = Date.now();
        const { connections } = this.debugConnectionSnapshots(now);
        return {
            ...snapshot,
            connections,
            connectionsBeingSpawned: this.connectionsBeingSpawned,
            idleCount: this.connections.length + [...this.lifecycleRetainedConnections.values()].filter((connection) => connection.getIdSeq() === undefined).length,
            idleMatchingPendingCheckoutCount: this.connections.filter((connection) => {
                return !this.connectionHasOpenTransaction(connection)
                    && this.pendingCheckouts.some((checkout) => this.connectionMatchesReuseKey(connection, checkout.reuseKey));
            }).length,
            inUseCount: Object.keys(this.connectionsInUse).length,
            pendingCheckoutDrainActive: Boolean(this.pendingCheckoutDrainPromise),
            pendingCheckoutDrainRequested: this.pendingCheckoutDrainRequested,
            pendingCheckouts: this.pendingCheckoutDebugSnapshots(now),
            pendingCheckoutCount: this.pendingCheckouts.length,
            telemetry: { ...this.telemetry }
        };
    }
    /**
     * Runs debug connection snapshots.
     * @param {number} now - Current timestamp.
     * @returns {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, seenConnections: Set<import("../drivers/base.js").default>}} - Connection snapshots and seen set.
     */
    debugConnectionSnapshots(now) {
        /**
         * Connections.
         * @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const connections = [];
        const seenConnections = new Set();
        this.addInUseDebugConnectionSnapshots({ connections, now, seenConnections });
        this.addIdleDebugConnectionSnapshots({ connections, now, seenConnections });
        for (const connection of this.lifecycleRetainedConnections.values()) {
            this.addDebugConnectionSnapshotIfUnseen({ connection, connections, reapable: false, seenConnections, state: "lifecycle-retained" });
        }
        this.addFallbackDebugConnectionSnapshots({ connections, seenConnections });
        return { connections, seenConnections };
    }
    /**
     * Runs add in use debug connection snapshots.
     * @param {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, now: number, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
     * @returns {void}
     */
    addInUseDebugConnectionSnapshots({ connections, now, seenConnections }) {
        for (const [id, connection] of Object.entries(this.connectionsInUse)) {
            const trackedConnection = /** @type {import("../drivers/base.js").default & {[CONNECTION_CHECKED_OUT_AT]?: number}} */ (connection);
            const checkedOutAt = trackedConnection[CONNECTION_CHECKED_OUT_AT];
            const checkedOutForMs = typeof checkedOutAt === "number" ? Math.max(0, now - checkedOutAt) : undefined;
            seenConnections.add(connection);
            connections.push(this.debugConnectionSnapshot(connection, { checkedOutAt, checkedOutForMs, checkoutId: id, state: "in-use" }));
        }
    }
    /**
     * Runs add idle debug connection snapshots.
     * @param {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, now: number, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
     * @returns {void}
     */
    addIdleDebugConnectionSnapshots({ connections, now, seenConnections }) {
        for (const connection of this.connections) {
            if (seenConnections.has(connection))
                continue;
            seenConnections.add(connection);
            const trackedConnection = /** @type {import("../drivers/base.js").default & {[IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection);
            const checkedInAt = trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT];
            const idleForMs = typeof checkedInAt === "number" ? Math.max(0, now - checkedInAt) : undefined;
            connections.push(this.debugConnectionSnapshot(connection, { checkedInAt, idleForMs, state: "idle" }));
        }
    }
    /**
     * Runs add fallback debug connection snapshots.
     * @param {{connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
     * @returns {void}
     */
    addFallbackDebugConnectionSnapshots({ connections, seenConnections }) {
        this.addDebugConnectionSnapshotIfUnseen({ connection: this.getGlobalConnectionForIdentifier(), connections, reapable: false, seenConnections, state: "global" });
        this.addDebugConnectionSnapshotIfUnseen({ connection: this._testSharedConnection, connections, reapable: false, seenConnections, state: "test-shared" });
    }
    /**
     * Runs add debug connection snapshot if unseen.
     * @param {{connection: import("../drivers/base.js").default | undefined, connections: Array<Record<string, ReturnType<typeof JSON.parse>>>, reapable?: boolean, seenConnections: Set<import("../drivers/base.js").default>, state: string}} args - Snapshot collection state.
     * @returns {void}
     */
    addDebugConnectionSnapshotIfUnseen({ connection, connections, reapable, seenConnections, state }) {
        if (!connection || seenConnections.has(connection))
            return;
        seenConnections.add(connection);
        connections.push(this.debugConnectionSnapshot(connection, { reapable, state }));
    }
    /**
     * Runs pending checkout debug snapshots.
     * @param {number} now - Current timestamp.
     * @returns {import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot[]} - Pending checkout snapshots.
     */
    pendingCheckoutDebugSnapshots(now) {
        return this.pendingCheckouts.map((checkout, index) => ({
            checkoutName: checkout.options.name,
            enqueuedAt: checkout.enqueuedAt,
            index,
            remainingTimeoutMs: checkout.timeoutAt === null ? null : Math.max(0, checkout.timeoutAt - now),
            reuseKey: checkout.reuseKey,
            timeoutAt: checkout.timeoutAt,
            timeoutMillis: checkout.timeoutMillis,
            waitingForMs: Math.max(0, now - checkout.enqueuedAt)
        }));
    }
    /**
     * Runs get global connection.
     * @returns {import("../drivers/base.js").default | undefined} - The global connection.
     */
    getGlobalConnection() {
        const connection = this.getGlobalConnectionForIdentifier();
        if (!connection)
            return;
        if (!this.connectionMatchesCurrentConfiguration(connection))
            return;
        return connection;
    }
    /**
     * Runs get global connection for identifier.
     * @returns {import("../drivers/base.js").default | undefined} - The global connection for this pool identifier.
     */
    getGlobalConnectionForIdentifier() {
        const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor);
        const mapForConfiguration = klass.globalConnections.get(this.configuration);
        return mapForConfiguration?.[this.identifier];
    }
    /**
     * Runs clear global connection for identifier.
     * @returns {void} - No return value.
     */
    clearGlobalConnectionForIdentifier() {
        const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor);
        const mapForConfiguration = klass.globalConnections.get(this.configuration);
        if (!mapForConfiguration)
            return;
        delete mapForConfiguration[this.identifier];
    }
    /**
     * Clears schema metadata cached by every live connection owned by this pool.
     * @returns {void} - No return value.
     */
    clearSchemaCache() {
        const connections = new Set([
            ...this.connections,
            ...Object.values(this.connectionsInUse),
            this.getGlobalConnection(),
            this._testSharedConnection
        ].filter(Boolean));
        for (const connection of connections) {
            if (connection)
                this._clearConnectionSchemaCache(connection);
        }
    }
    /**
     * Runs idle timeout millis.
     * @returns {number | null} - Idle timeout in milliseconds, or null when disabled.
     */
    idleTimeoutMillis() {
        const value = this.getConfiguration().pool?.idleTimeoutMillis;
        if (value === null)
            return null;
        if (this.validIdleTimeoutMillis(value))
            return value;
        return DEFAULT_IDLE_TIMEOUT_MILLIS;
    }
    /**
     * Runs valid idle timeout millis.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate idle timeout value.
     * @returns {value is number} - Whether the value is a valid idle timeout.
     */
    validIdleTimeoutMillis(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0;
    }
    /**
     * Runs schedule idle connection reaper.
     * @returns {void} */
    scheduleIdleConnectionReaper() {
        if (this.idleConnectionReaperTimer)
            return;
        if (!this.hasIdleConnectionsToReap())
            return;
        const delay = this.nextIdleConnectionReapDelay(/** @type {number} */ (this.idleTimeoutMillis()));
        this.idleConnectionReaperTimer = setTimeout(() => {
            this.idleConnectionReaperTimer = undefined;
            void this.reapIdleConnections().catch((error) => {
                this.logger.warn(() => ["Failed to reap idle database connections:", error]);
            });
        }, delay);
        if (typeof this.idleConnectionReaperTimer.unref === "function") {
            this.idleConnectionReaperTimer.unref();
        }
    }
    /**
     * Runs has idle connections to reap.
     * @returns {boolean} - Whether an idle reaper timer should be scheduled.
     */
    hasIdleConnectionsToReap() {
        return this.connections.length > 0 && this.idleTimeoutMillis() !== null;
    }
    /**
     * Runs next idle connection reap delay.
     * @param {number} idleTimeoutMillis - Idle timeout in milliseconds.
     * @returns {number} - Delay before the next reap.
     */
    nextIdleConnectionReapDelay(idleTimeoutMillis) {
        let delay = idleTimeoutMillis;
        const now = Date.now();
        for (const connection of this.connections) {
            if (this.connectionHasOpenTransaction(connection))
                continue;
            const trackedConnection = /** @type {import("../drivers/base.js").default & {[IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection);
            const checkedInAt = trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT];
            if (typeof checkedInAt !== "number")
                continue;
            delay = Math.min(delay, Math.max(0, idleTimeoutMillis - (now - checkedInAt)));
        }
        return delay;
    }
    /**
     * Closes idle checked-in connections that have exceeded the configured timeout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async reapIdleConnections() {
        if (this.connections.length === 0)
            return;
        const idleTimeoutMillis = this.idleTimeoutMillis();
        if (idleTimeoutMillis === null)
            return;
        const startedAt = this.nowMs();
        const profileContext = currentTestProfileContext(this.configuration);
        let failed = true;
        try {
            const { expiredConnections, keptConnections } = this.classifyIdleConnectionsForReaping({ idleTimeoutMillis, now: this.nowMs() });
            this.connections = keptConnections;
            await this.closeExpiredIdleConnections(expiredConnections, profileContext);
            await this.awaitInflightConnectionCloses();
            if (this.connections.length > 0)
                this.scheduleIdleConnectionReaper();
            failed = false;
        }
        finally {
            const durationMs = Math.max(0, this.nowMs() - startedAt);
            this.telemetry.idleReapCount++;
            if (failed)
                this.telemetry.idleReapFailureCount++;
            this.telemetry.idleReapTotalMs += durationMs;
            this.telemetry.idleReapMaxMs = Math.max(this.telemetry.idleReapMaxMs, durationMs);
            this.recordTestProfilePoolMetric(profileContext, "idleReap", { durationMs, failed });
        }
    }
    /**
     * Runs close expired idle connections.
     * @param {import("../drivers/base.js").default[]} expiredConnections - Connections to close.
     * @param {import("../../testing/test-profiler.js").TestProfileAsyncContext | undefined} [profileContext] - Reaper profile context.
     * @returns {Promise<void>} - Resolves when closed.
     */
    async closeExpiredIdleConnections(expiredConnections, profileContext) {
        for (const connection of expiredConnections) {
            await this.closeConnection(connection);
            this.telemetry.idleReapDisposalCount++;
            this.recordTestProfilePoolMetric(profileContext, "idleReapDisposal");
        }
    }
    /**
     * Runs await inflight connection closes.
     * @returns {Promise<void>} - Resolves once in-flight connection closes settle.
     */
    async awaitInflightConnectionCloses() {
        if (this.inflightConnectionCloses.size > 0) {
            await Promise.allSettled([...this.inflightConnectionCloses]);
        }
    }
    /**
     * Runs classify idle connections for reaping.
     * @param {{idleTimeoutMillis: number, now: number}} args - Reaper classification inputs.
     * @returns {{expiredConnections: import("../drivers/base.js").default[], keptConnections: import("../drivers/base.js").default[]}} - Classified idle connections.
     */
    classifyIdleConnectionsForReaping({ idleTimeoutMillis, now }) {
        /**
         * Kept connections.
         * @type {import("../drivers/base.js").default[]} */
        const keptConnections = [];
        /**
         * Expired connections.
         * @type {import("../drivers/base.js").default[]} */
        const expiredConnections = [];
        for (const connection of this.connections) {
            this.classifyIdleConnectionForReaping({ connection, expiredConnections, idleTimeoutMillis, keptConnections, now });
        }
        return { expiredConnections, keptConnections };
    }
    /**
     * Runs classify idle connection for reaping.
     * @param {{connection: import("../drivers/base.js").default, expiredConnections: import("../drivers/base.js").default[], idleTimeoutMillis: number, keptConnections: import("../drivers/base.js").default[], now: number}} args - Classification state.
     * @returns {void}
     */
    classifyIdleConnectionForReaping({ connection, expiredConnections, idleTimeoutMillis, keptConnections, now }) {
        if (this.connectionIsClosed(connection))
            return;
        if (this.connectionHasOpenTransaction(connection)) {
            keptConnections.push(connection);
            return;
        }
        const target = this.idleConnectionExpired({ connection, idleTimeoutMillis, now }) ? expiredConnections : keptConnections;
        target.push(connection);
    }
    /**
     * Runs connection is closed.
     * @param {import("../drivers/base.js").default} connection - Connection to inspect.
     * @returns {boolean} - Whether the connection is marked closed.
     */
    connectionIsClosed(connection) {
        const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean}} */ (connection);
        return Boolean(trackedConnection[CLOSED_CONNECTION]);
    }
    /**
     * Runs idle connection expired.
     * @param {{connection: import("../drivers/base.js").default, idleTimeoutMillis: number, now: number}} args - Expiry inputs.
     * @returns {boolean} - Whether the idle connection expired.
     */
    idleConnectionExpired({ connection, idleTimeoutMillis, now }) {
        const trackedConnection = /** @type {import("../drivers/base.js").default & {[IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection);
        const checkedInAt = trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT];
        return typeof checkedInAt === "number" && now - checkedInAt >= idleTimeoutMillis;
    }
    /**
     * Runs connection has open transaction.
     * @param {import("../drivers/base.js").default} connection - Connection to inspect.
     * @returns {boolean} - Whether the connection has an open transaction.
     */
    connectionHasOpenTransaction(connection) {
        return connection._transactionsCount > 0;
    }
    /**
     * Rolls back any transaction a previous holder left open before a connection
     * re-enters the idle pool. A connection returned to the pool with an open
     * transaction would otherwise be handed to an unrelated checkout, whose
     * startTransaction() then fails with "A transaction is already running" and
     * poisons every following caller that reuses it.
     * @param {import("../drivers/base.js").default} connection - Connection being checked in.
     * @returns {Promise<void>} - Resolves when the connection holds no open transaction.
     */
    async rollbackLeftOpenTransaction(connection) {
        if (!this.connectionHasOpenTransaction(connection))
            return;
        this.logger.warn(() => [`Rolling back a transaction left open on a connection being checked in (identifier=${this.identifier}).`]);
        while (this.connectionHasOpenTransaction(connection)) {
            await connection.rollbackTransaction();
        }
    }
    /**
     * Runs close connection.
     * @param {import("../drivers/base.js").default} connection - Connection to close.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async closeConnection(connection) {
        // Idempotent: a fire-and-forget scheduled reap and an explicit reap can both
        // target the same connection. Await the in-flight close instead of closing
        // twice (which can throw on the driver) or returning while the underlying
        // handle is still open.
        const existingClose = this.connectionClosePromises.get(connection);
        if (existingClose) {
            return await existingClose;
        }
        const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean, [CONNECTION_CHECKED_OUT_AT]?: number, [IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection);
        for (const [reuseKey, retainedConnection] of this.lifecycleRetainedConnections) {
            if (retainedConnection === connection)
                this.lifecycleRetainedConnections.delete(reuseKey);
        }
        trackedConnection[CLOSED_CONNECTION] = true;
        delete trackedConnection[CONNECTION_CHECKED_OUT_AT];
        delete trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT];
        const closePromise = (async () => {
            await trackedConnection.close();
        })();
        this.connectionClosePromises.set(connection, closePromise);
        this.inflightConnectionCloses.add(closePromise);
        try {
            await closePromise;
        }
        finally {
            this.inflightConnectionCloses.delete(closePromise);
        }
    }
    /**
     * Runs clear idle connection reaper timer.
     * @returns {void} */
    clearIdleConnectionReaperTimer() {
        if (!this.idleConnectionReaperTimer)
            return;
        clearTimeout(this.idleConnectionReaperTimer);
        this.idleConnectionReaperTimer = undefined;
    }
    /**
     * Closes all active and cached connections for this pool.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async closeAll() {
        this.clearIdleConnectionReaperTimer();
        this.rejectPendingCheckouts(new Error("Database pool was closed before checkout completed."));
        const connections = new Set([
            ...this.connections,
            ...Object.values(this.connectionsInUse),
            ...this.lifecycleRetainedConnections.values(),
            this.getGlobalConnectionForIdentifier(),
            this._testSharedConnection
        ].filter(Boolean));
        this.connections = [];
        this.connectionsInUse = {};
        this.lifecycleRetainedConnections.clear();
        this.lifecycleRetainedReuseKeys.clear();
        this.clearTestSharedConnection();
        this.clearGlobalConnectionForIdentifier();
        for (const connection of connections) {
            if (!connection)
                continue;
            await this.closeConnection(connection);
        }
    }
    /**
     * Runs reject pending checkouts.
     * @param {Error} error - Error to reject pending checkouts with.
     * @returns {void}
     */
    rejectPendingCheckouts(error) {
        const pendingCheckouts = this.pendingCheckouts;
        this.pendingCheckouts = [];
        for (const checkout of pendingCheckouts) {
            this.clearPendingCheckoutTimeout(checkout);
            checkout.reject(error);
        }
    }
    /**
     * Replaces all globally registered fallback connections.
     * @param {Record<string, import("../drivers/base.js").default>} [connections] - Connections.
     * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
     * @returns {void} - No return value.
     */
    static setGlobalConnections(connections, configuration) {
        if (!configuration) {
            this.globalConnections = new WeakMap();
            return;
        }
        this.globalConnections.set(configuration, connections || {});
    }
    /**
     * Clears globally registered fallback connections for all configurations or a single configuration.
     * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
     * @returns {void} - No return value.
     */
    static clearGlobalConnections(configuration) {
        if (!configuration) {
            this.globalConnections = new WeakMap();
            return;
        }
        this.globalConnections.delete(configuration);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3Bvb2wvYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDL0MsT0FBTyxRQUFRLEVBQUUsRUFBRSxzQkFBc0IsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUM1RCxPQUFPLGdDQUFnQyxNQUFNLDZCQUE2QixDQUFBO0FBQzFFLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxNQUFNLHVDQUF1QyxDQUFBO0FBRWpGOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsTUFBTSxDQUFDLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLDJCQUEyQixDQUFDLENBQUE7QUFDcEUsTUFBTSw2QkFBNkIsR0FBRyxNQUFNLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtBQUNsRixNQUFNLHlCQUF5QixHQUFHLE1BQU0sQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO0FBQzNFLE1BQU0sNkJBQTZCLEdBQUcsTUFBTSxDQUFDLHNDQUFzQyxDQUFDLENBQUE7QUFDcEYsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUE7QUFDbEMsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLENBQUE7QUFDeEMsTUFBTSwrQkFBK0IsR0FBRyxLQUFLLENBQUE7QUFFN0MsTUFBTSxDQUFDLE9BQU8sT0FBTyxnREFBaUQsU0FBUSxRQUFRO0lBQ3BGOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBRXhDLGlCQUFpQixHQUFHLElBQUksaUJBQWlCLEVBQUUsQ0FBQTtJQUUzQzs7Ozs7T0FLRztJQUNILHFCQUFxQixHQUFHLFNBQVMsQ0FBQTtJQUVqQzs7O09BR0c7SUFDSCw2QkFBNkIsR0FBRyxTQUFTLENBQUE7SUFFekM7OztPQUdHO0lBQ0gsaUNBQWlDLEdBQUcsU0FBUyxDQUFBO0lBRTdDLGlGQUFpRjtJQUNqRixnQ0FBZ0MsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBRTVDOzs7T0FHRztJQUNILDhCQUE4QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFFMUM7O3dEQUVvRDtJQUNwRCxXQUFXLEdBQUcsRUFBRSxDQUFBO0lBRWhCOzs7T0FHRztJQUNILDBCQUEwQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFFdEM7OztPQUdHO0lBQ0gsNEJBQTRCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUV4Qzs7c0VBRWtFO0lBQ2xFLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtJQUVyQjs7bUNBRStCO0lBQy9CLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtJQUVyQjs7d0JBRW9CO0lBQ3BCLHVCQUF1QixHQUFHLENBQUMsQ0FBQTtJQUUzQjs7MkNBRXVDO0lBQ3ZDLDJCQUEyQixHQUFHLFNBQVMsQ0FBQTtJQUV2QyxrRkFBa0Y7SUFDbEYsNkJBQTZCLEdBQUcsS0FBSyxDQUFBO0lBRXJDOzsyREFFdUQ7SUFDdkQseUJBQXlCLEdBQUcsU0FBUyxDQUFBO0lBRXJDOzs7Ozs7OztPQVFHO0lBQ0gsd0JBQXdCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUVwQzs7OztPQUlHO0lBQ0gsdUJBQXVCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtJQUV2QyxpREFBaUQ7SUFDakQsU0FBUyxHQUFHO1FBQ1YsdUJBQXVCLEVBQUUsQ0FBQztRQUMxQiw4QkFBOEIsRUFBRSxDQUFDO1FBQ2pDLHVCQUF1QixFQUFFLENBQUM7UUFDMUIseUJBQXlCLEVBQUUsQ0FBQztRQUM1QixvQkFBb0IsRUFBRSxDQUFDO1FBQ3ZCLGlCQUFpQixFQUFFLENBQUM7UUFDcEIsaUJBQWlCLEVBQUUsQ0FBQztRQUNwQixtQkFBbUIsRUFBRSxDQUFDO1FBQ3RCLGFBQWEsRUFBRSxDQUFDO1FBQ2hCLHFCQUFxQixFQUFFLENBQUM7UUFDeEIsb0JBQW9CLEVBQUUsQ0FBQztRQUN2QixhQUFhLEVBQUUsQ0FBQztRQUNoQixlQUFlLEVBQUUsQ0FBQztRQUNsQixtQkFBbUIsRUFBRSxDQUFDO0tBQ3ZCLENBQUE7SUFFRCxLQUFLLEdBQUcsQ0FBQyxDQUFBO0lBRVQ7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBQztRQUNyQyxLQUFLLENBQUMsRUFBQyxhQUFhLEVBQUUsVUFBVSxFQUFDLENBQUMsQ0FBQTtRQUNsQzs7O1dBR0c7UUFDSCxNQUFNLCtCQUErQixHQUFHLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLDZCQUE2QixFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ3pILElBQUksQ0FBQyxnQ0FBZ0MsR0FBRywrQkFBK0IsQ0FBQTtJQUN6RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxLQUFLLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBLENBQUMsQ0FBQztJQUU3Qjs7Ozs7O09BTUc7SUFDSCwyQkFBMkIsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sR0FBRyxFQUFFO1FBQ3RELElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTTtRQUVwQixPQUFPLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQTtJQUM3RSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0NBQWdDLENBQUMsTUFBTSxFQUFFLFFBQVE7UUFDckQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQzlCLE1BQU0sY0FBYyxHQUFHLHlCQUF5QixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNwRSxJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUE7UUFFakIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxVQUFVLEdBQUcsTUFBTSxLQUFLLENBQUMsZ0NBQWdDLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1lBRWpGLE1BQU0sR0FBRyxLQUFLLENBQUE7WUFDZCxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLElBQUksQ0FBQyx1QkFBdUIsR0FBRyxDQUFDLENBQUE7WUFFekYsSUFBSSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLG1CQUFtQixFQUFFLENBQUM7Z0JBQzdELElBQUksQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUE7Z0JBQ3hELElBQUksQ0FBQywyQkFBMkIsQ0FBQyxjQUFjLEVBQUUscUJBQXFCLEVBQUUsRUFBQyxLQUFLLEVBQUUsbUJBQW1CLEVBQUMsQ0FBQyxDQUFBO1lBQ3ZHLENBQUM7WUFFRCxPQUFPLFVBQVUsQ0FBQTtRQUNuQixDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLEdBQUcsU0FBUyxDQUFDLENBQUE7WUFFeEQsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1lBQ3hDLElBQUksTUFBTTtnQkFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLDhCQUE4QixFQUFFLENBQUE7WUFDM0QsSUFBSSxDQUFDLFNBQVMsQ0FBQyx5QkFBeUIsSUFBSSxVQUFVLENBQUE7WUFDdEQsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsdUJBQXVCLEVBQUUsVUFBVSxDQUFDLENBQUE7WUFDckcsSUFBSSxDQUFDLDJCQUEyQixDQUFDLGNBQWMsRUFBRSxvQkFBb0IsRUFBRSxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBQzlGLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVTtRQUN0QixNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsUUFBUSxFQUFFLENBQUE7UUFDaEMsTUFBTSxpQkFBaUIsR0FBRyxxS0FBcUssQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTVNLElBQUksaUJBQWlCLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO1lBQ3pDLElBQUksT0FBTyxFQUFFLEtBQUssUUFBUTtnQkFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFBO1lBQ3ZFLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7WUFDbEMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNsRCxNQUFNLFVBQVUsQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1lBQzNDLE1BQU0sVUFBVSxDQUFDLDJCQUEyQixFQUFFLENBQUE7WUFDOUMsTUFBTSxVQUFVLENBQUMsZ0NBQWdDLEVBQUUsQ0FBQTtRQUNyRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sSUFBSSxDQUFDLDRDQUE0QyxDQUFDLFVBQVUsRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDOUUsTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO1FBRUQsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUMzQyxPQUFPLGlCQUFpQixDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFDbkQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXBFLElBQUksSUFBSSxDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUUxRSxJQUFJLENBQUMsa0JBQWtCLElBQUksa0JBQWtCLEtBQUssVUFBVSxJQUFJLGtCQUFrQixDQUFDLFFBQVEsRUFBRSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUM1RyxPQUFPLGlCQUFpQixDQUFDLDZCQUE2QixDQUFDLENBQUE7Z0JBQ3ZELElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFBO2dCQUMzRCxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO2dCQUNsQyxPQUFNO1lBQ1IsQ0FBQztRQUNILENBQUM7UUFFRCxpQkFBaUIsQ0FBQyw2QkFBNkIsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQUM3RCxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNqQyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ2xDLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO1lBQUUsTUFBTSxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtJQUN2RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVO1FBQ3RCLE1BQU0sRUFBRSxHQUFHLFVBQVUsQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUNoQyxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7UUFFakIsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUMzQyxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDeEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3BCLENBQUM7UUFDRCxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3BDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNwQixDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxNQUFNLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN4QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxjQUFjLENBQUMsTUFBTSxFQUFFLHlDQUF5QyxDQUFDLENBQUE7SUFDcEcsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxFQUFFLGFBQWE7UUFDOUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUUzQyxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDeEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxtRUFBbUUsRUFBRSxFQUFDLEtBQUssRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQy9HLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3BDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsMEVBQTBFLEVBQUUsRUFBQyxLQUFLLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUN0SCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsc0JBQXNCLENBQUMsVUFBVSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxPQUFPLEVBQUUsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxPQUFPLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBQzNFLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNoQyxVQUFVLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsNkJBQTZCO1FBQ2pDLElBQUksSUFBSSxDQUFDLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUNsQyxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFBO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLEVBQUU7UUFDekIsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEMsSUFBSSxjQUFjLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDNUMsSUFBSSxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQzVELElBQUksVUFBVSxHQUFHLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUU3RCxJQUFJLFVBQVU7WUFBRSxPQUFPLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUV6RSxNQUFNLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQ2hDLGNBQWMsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUN4QyxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQ3hELFVBQVUsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFekQsSUFBSSxVQUFVO1lBQUUsT0FBTyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFFekUsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUM1QyxvRkFBb0Y7WUFDcEYseUZBQXlGO1lBQ3pGLDZFQUE2RTtZQUM3RSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQ2hELGNBQWMsRUFDZCxRQUFRLEVBQ1IseUJBQXlCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUM5QyxDQUFBO1lBRUQsT0FBTyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDM0QsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDdEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxjQUFjLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDekQsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDbEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQzlELE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUVuRixJQUFJLDJCQUEyQixJQUFJLDJCQUEyQixDQUFDLFFBQVEsRUFBRSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3hGLE9BQU8sTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsMkJBQTJCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUUsQ0FBQztRQUVELElBQUksVUFBVSxHQUFHLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUU3RCxJQUFJLFVBQVU7WUFBRSxPQUFPLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUV6RSxNQUFNLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQ2hDLFVBQVUsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFekQsSUFBSSxVQUFVO1lBQUUsT0FBTyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFFekUsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUM1QyxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQ2hELGNBQWMsRUFDZCxRQUFRLEVBQ1IseUJBQXlCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUM5QyxDQUFBO1lBRUQsT0FBTyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDM0QsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDdEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILDZCQUE2QixDQUFDLFFBQVEsRUFBRSxFQUFDLHVCQUF1QixHQUFHLElBQUksRUFBQyxHQUFHLEVBQUU7UUFDM0UsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFO1lBQ3RFLElBQUksQ0FBQyx1QkFBdUIsSUFBSSxJQUFJLENBQUMsNEJBQTRCLENBQUMsZ0JBQWdCLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFFakcsT0FBTyxJQUFJLENBQUMseUJBQXlCLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFDbkUsQ0FBQyxDQUFDLENBQUE7UUFDRixNQUFNLFVBQVUsR0FBRyxlQUFlLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXRHLE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHlCQUF5QixDQUFDLFVBQVUsRUFBRSxRQUFRO1FBQzVDLE1BQU0scUJBQXFCLEdBQUcseUZBQXlGLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVwSSxPQUFPLHFCQUFxQixDQUFDLHNCQUFzQixDQUFDLEtBQUssUUFBUSxDQUFBO0lBQ25FLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDL0MsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDcEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFDN0QsQ0FBQztRQUNELElBQUksVUFBVSxDQUFDLFFBQVEsRUFBRSxLQUFLLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxVQUFVLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRXJJLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUV2QixNQUFNLGlCQUFpQixHQUFHLHNJQUFzSSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDN0ssT0FBTyxpQkFBaUIsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1FBQ3ZELGlCQUFpQixDQUFDLHlCQUF5QixDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRXpELFVBQVUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDdkIsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQTtRQUV0QyxJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsQ0FBQyx5QkFBeUIsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDeEQsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUE7UUFDcEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBQ2pFLENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDZCQUE2QixDQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUN2RCxJQUFJLEVBQUUsS0FBSyxTQUFTO1lBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUVqRSw4Q0FBOEM7UUFDOUMsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFBO1FBRXhCLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUN4QyxDQUFDO1FBQUMsT0FBTyxVQUFVLEVBQUUsQ0FBQztZQUNwQixhQUFhLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ2hDLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxJQUFJLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFDO2dCQUNyQyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsSUFBSSxDQUFBO1lBQzNDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1lBQ3BDLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxVQUFVLEVBQUUsQ0FBQztZQUNwQixhQUFhLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ2hDLENBQUM7UUFFRCxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDN0IsTUFBTSxJQUFJLGNBQWMsQ0FBQyxDQUFDLEtBQUssRUFBRSxHQUFHLGFBQWEsQ0FBQyxFQUFFLDRDQUE0QyxFQUFFLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDbkgsQ0FBQztRQUVELE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxjQUFjLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtRQUNyRCxNQUFNLEtBQUssR0FBRyxjQUFjLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQTtRQUV0QyxJQUFJLEtBQUssS0FBSyxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDL0IsSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFakQsT0FBTyx1QkFBdUIsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHFCQUFxQixDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7UUFDNUQsTUFBTSxLQUFLLEdBQUcsY0FBYyxDQUFDLElBQUksRUFBRSxxQkFBcUIsQ0FBQTtRQUV4RCxJQUFJLEtBQUssS0FBSyxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDL0IsSUFBSSxJQUFJLENBQUMsMEJBQTBCLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFeEQsT0FBTywrQkFBK0IsQ0FBQTtJQUN4QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDBCQUEwQixDQUFDLEtBQUs7UUFDOUIsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFBO0lBQzFFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsbUJBQW1CLENBQUMsS0FBSztRQUN2QixPQUFPLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUE7SUFDMUUsQ0FBQztJQUVEOzs7T0FHRztJQUNILG1CQUFtQjtRQUNqQixNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsQ0FBQztZQUMxQixHQUFHLElBQUksQ0FBQyxXQUFXO1lBQ25CLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUM7WUFDdkMsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxFQUFFO1lBQzdDLElBQUksQ0FBQyxnQ0FBZ0MsRUFBRTtTQUN4QyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO1FBRWxCLE9BQU8sV0FBVyxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxrQkFBa0IsQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFO1FBQ3pELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsY0FBYyxDQUFDLENBQUE7UUFFMUQsT0FBTyxjQUFjLEtBQUssSUFBSSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLGNBQWMsQ0FBQTtJQUMvRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQixDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsY0FBYztRQUN2RSxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUU5QixJQUFJLENBQUM7WUFDSCxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtZQUNyRSxNQUFNLFVBQVUsR0FBRyxNQUFNLGtCQUFrQixDQUFDLHlCQUF5QixDQUFDLGNBQWMsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDL0YsT0FBTyxNQUFNLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUE7WUFDbkgsQ0FBQyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsdUNBQXVDLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1lBRWxFLE9BQU8sVUFBVSxDQUFBO1FBQ25CLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBQ2hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQzFELE9BQU8sTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUMzQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7WUFDN0IsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ2hFLDhCQUE4QjtZQUM5QixNQUFNLFFBQVEsR0FBRztnQkFDZixjQUFjO2dCQUNkLFVBQVU7Z0JBQ1YsT0FBTztnQkFDUCxNQUFNO2dCQUNOLE9BQU87Z0JBQ1AsUUFBUTtnQkFDUixTQUFTLEVBQUUsYUFBYSxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxVQUFVLEdBQUcsYUFBYTtnQkFDckUsYUFBYTtnQkFDYixZQUFZLEVBQUUsU0FBUztnQkFDdkIsdUJBQXVCLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLDhCQUE4QixFQUFFO2dCQUNwRyxrQkFBa0IsRUFBRSx5QkFBeUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDO2FBQ2xFLENBQUE7WUFFRCxRQUFRLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNsRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ3BDLEtBQUssSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7Z0JBQ2hELE1BQU0sYUFBYSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsd0RBQXdELEVBQUUsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtnQkFFMUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1lBQzVDLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQjtRQUN6QixJQUFJLENBQUMsNkJBQTZCLEdBQUcsSUFBSSxDQUFBO1FBRXpDLElBQUksQ0FBQyxJQUFJLENBQUMsMkJBQTJCO1lBQUUsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFDdkUsTUFBTSxJQUFJLENBQUMsMkJBQTJCLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gseUJBQXlCO1FBQ3ZCLE1BQU0sRUFBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBQyxHQUFHLE9BQU8sQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUUxRCxJQUFJLENBQUMsMkJBQTJCLEdBQUcsT0FBTyxDQUFBO1FBQzFDLEtBQUssSUFBSSxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsTUFBTSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7SUFDaEUsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsTUFBTSxFQUFFLE9BQU8sRUFBQztRQUN2RCxJQUFJLENBQUM7WUFDSCxPQUFPLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFDO2dCQUMxQyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsS0FBSyxDQUFBO2dCQUMxQyxNQUFNLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1lBQzFDLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQywyQkFBMkIsR0FBRyxTQUFTLENBQUE7WUFDNUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2IsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsMkJBQTJCLEdBQUcsU0FBUyxDQUFBO1FBQzVDLE9BQU8sRUFBRSxDQUFBO0lBQ1gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQywyQkFBMkI7UUFDL0IsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hDLElBQUksTUFBTSxJQUFJLENBQUMsZ0RBQWdELEVBQUU7Z0JBQUUsU0FBUTtZQUUzRSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFekMsSUFBSSxNQUFNLElBQUksQ0FBQyw2Q0FBNkMsQ0FBQyxRQUFRLENBQUM7Z0JBQUUsU0FBUTtZQUNoRixJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7Z0JBQUUsU0FBUTtZQUN2RCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDckQsSUFBSSxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUMvQixNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDbkQsU0FBUTtZQUNWLENBQUM7WUFFRCxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLGdDQUFnQyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRTlFLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQztnQkFBRSxTQUFRO1lBQ3ZELElBQUksQ0FBQyxnQkFBZ0I7Z0JBQUUsT0FBTTtZQUU3QixJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDL0IsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFLGdCQUFnQixDQUFDLENBQUE7UUFDL0QsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsZ0RBQWdEO1FBQ3BELEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLEtBQUssR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7WUFDbEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzdDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLEVBQUMsdUJBQXVCLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUUxRyxJQUFJLENBQUMsVUFBVTtnQkFBRSxTQUFRO1lBRXpCLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNuQyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLENBQUE7WUFFdkQsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHVCQUF1QixDQUFDLEtBQUs7UUFDM0IsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFMUQsSUFBSSxDQUFDLDJCQUEyQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQzFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUVqQyxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtCQUFrQixDQUFDLFFBQVE7UUFDekIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVuRSxJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDbEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsSUFBSSxXQUFXLENBQUE7UUFDakQsSUFBSSxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsaUJBQWlCLEVBQUUsV0FBVyxDQUFDLENBQUE7UUFDMUYsSUFBSSxDQUFDLDJCQUEyQixDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsRUFBRSxjQUFjLEVBQUUsRUFBQyxVQUFVLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUMxRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDJCQUEyQixDQUFDLFFBQVE7UUFDbEMsSUFBSSxRQUFRLENBQUMsYUFBYSxLQUFLLElBQUk7WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUVyRCxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQzVCLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN2QyxDQUFDLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRTFCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxzQkFBc0IsQ0FBQyxRQUFRO1FBQzdCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFckQsSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO1lBQUUsT0FBTTtRQUV4QixJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDbkMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1FBQ3JDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTtRQUNoRixRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFBO0lBQzdELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMkJBQTJCLENBQUMsUUFBUTtRQUNsQyxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsbUJBQW1CLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDN0csTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXBFLE9BQU8sSUFBSSxnQ0FBZ0MsQ0FBQyxtQkFBbUIsUUFBUSxDQUFDLGFBQWEsMERBQTBELElBQUksQ0FBQyxVQUFVLEtBQUssWUFBWSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUE7SUFDbk0sQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQ0FBaUMsQ0FBQyxRQUFRO1FBQ3hDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3hDLE1BQU0sbUJBQW1CLEdBQUcsUUFBUSxDQUFDLFdBQVc7YUFDN0MsR0FBRyxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsdUNBQXVDLENBQUMsVUFBVSxDQUFDLENBQUM7YUFDN0UsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ2IsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7YUFDdkQsR0FBRyxDQUFDLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsb0NBQW9DLENBQUMsZUFBZSxDQUFDLENBQUM7YUFDcEYsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ2IsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVqRSxPQUFPLG1CQUFtQixJQUFJLENBQUMsY0FBYyxFQUFFLElBQUksV0FBVyxXQUFXLFFBQVEsQ0FBQyxVQUFVLFVBQVUsUUFBUSxDQUFDLFNBQVMsYUFBYSxRQUFRLENBQUMsb0JBQW9CLGNBQWMsUUFBUSxDQUFDLHVCQUF1QiwwQkFBMEIsV0FBVyxjQUFjLG1CQUFtQixlQUFlLGdCQUFnQixJQUFJLENBQUE7SUFDM1QsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx1Q0FBdUMsQ0FBQyxVQUFVO1FBQ2hELE1BQU0sS0FBSyxHQUFHLENBQUMsU0FBUyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUUzQyxJQUFJLFVBQVUsQ0FBQyxZQUFZO1lBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM5RixJQUFJLE9BQU8sVUFBVSxDQUFDLGVBQWUsS0FBSyxRQUFRO1lBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsVUFBVSxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUE7UUFDL0csSUFBSSxPQUFPLFVBQVUsQ0FBQyxTQUFTLEtBQUssUUFBUTtZQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsYUFBYSxVQUFVLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtRQUM3RixJQUFJLE9BQU8sVUFBVSxDQUFDLGdCQUFnQixLQUFLLFFBQVE7WUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLG9CQUFvQixVQUFVLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFBO1FBRWxILE1BQU0sV0FBVyxHQUFHLFVBQVUsQ0FBQyxXQUFXLENBQUE7UUFFMUMsSUFBSSxXQUFXLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQ2xGLE1BQU0sU0FBUyxHQUFJLDREQUE0RCxDQUFDLENBQUMsV0FBVyxDQUFFLENBQUMsU0FBUyxDQUFBO1lBRXhHLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUTtnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBQzdFLENBQUM7UUFFRCxPQUFPLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFBO0lBQy9CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0NBQW9DLENBQUMsZUFBZTtRQUNsRCxNQUFNLEtBQUssR0FBRyxDQUFDLFNBQVMsZUFBZSxDQUFDLEtBQUssRUFBRSxFQUFFLGdCQUFnQixlQUFlLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUVoRyxJQUFJLGVBQWUsQ0FBQyxZQUFZO1lBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN4RyxJQUFJLGVBQWUsQ0FBQyxrQkFBa0IsS0FBSyxJQUFJO1lBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsZUFBZSxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQTtRQUV2SCxPQUFPLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFBO0lBQy9CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMkJBQTJCLENBQUMsUUFBUTtRQUNsQyxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVk7WUFBRSxPQUFNO1FBRWxDLFlBQVksQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDbkMsUUFBUSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7SUFDbkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsNkNBQTZDLENBQUMsUUFBUTtRQUMxRCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXhFLElBQUksVUFBVTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTVCLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFaEMsSUFBSSxJQUFJLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXZFLE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxpQ0FBaUMsRUFBRSxDQUFBO0lBQ2xILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsNkJBQTZCLENBQUMsUUFBUTtRQUNwQyxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7SUFDdEosQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0NBQWdDLENBQUMsUUFBUTtRQUM3QyxJQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxFQUFDLHVCQUF1QixFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFeEcsSUFBSSxVQUFVO1lBQUUsT0FBTyxVQUFVLENBQUE7UUFFakMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUNoQyxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7WUFBRSxPQUFNO1FBRXJELFVBQVUsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxFQUFDLHVCQUF1QixFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFcEcsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsUUFBUTtRQUMzQyxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUVyRSxPQUFPLE1BQU0sa0JBQWtCLENBQUMseUJBQXlCLENBQUMsUUFBUSxDQUFDLGtCQUFrQixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2hHLE9BQU8sTUFBTSxrQkFBa0IsQ0FBQyxzQ0FBc0MsQ0FBQyxRQUFRLENBQUMsdUJBQXVCLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ2xILElBQUksVUFBVSxDQUFBO2dCQUVkLElBQUksQ0FBQztvQkFDSCxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTtvQkFDbEMsVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUNoRCxRQUFRLENBQUMsY0FBYyxFQUN2QixRQUFRLENBQUMsUUFBUSxFQUNqQixRQUFRLENBQUMsa0JBQWtCLENBQzVCLENBQUE7Z0JBQ0gsQ0FBQztnQkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO29CQUNmLFFBQVEsQ0FBQyxNQUFNLENBQUMsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLENBQUE7b0JBQ25ILE9BQU07Z0JBQ1IsQ0FBQztnQkFFRCxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLENBQUE7WUFDekQsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLEVBQUUsVUFBVTtRQUMvQyxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUVyRSxPQUFPLE1BQU0sa0JBQWtCLENBQUMseUJBQXlCLENBQUMsUUFBUSxDQUFDLGtCQUFrQixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2hHLE9BQU8sTUFBTSxrQkFBa0IsQ0FBQyxzQ0FBc0MsQ0FBQyxRQUFRLENBQUMsdUJBQXVCLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ2xILElBQUksQ0FBQztvQkFDSCxRQUFRLENBQUMsT0FBTyxDQUFDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQTtnQkFDL0UsQ0FBQztnQkFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO29CQUNmLFFBQVEsQ0FBQyxNQUFNLENBQUMsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBQ3hILENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxpQ0FBaUM7UUFDckMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLDRCQUE0QixDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7UUFFdEcsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU3QixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLEtBQUssVUFBVSxDQUFDLENBQUE7UUFDbkYsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXRDLE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsaUJBQWlCLEVBQUUsUUFBUTtRQUM5QyxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTtRQUNsQyxNQUFNLE9BQU8sR0FBRyxPQUFPLGlCQUFpQixJQUFJLFVBQVUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQTtRQUMvRSxNQUFNLGNBQWMsR0FBRyxPQUFPLGlCQUFpQixJQUFJLFVBQVUsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQTtRQUU1RixJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtRQUUxRSxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFBO1FBQzlELElBQUksb0JBQW9CLElBQUksSUFBSSxDQUFDLHFDQUFxQyxDQUFDLG9CQUFvQixDQUFDLEVBQUUsQ0FBQztZQUM3RixPQUFPLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbEYsT0FBTyxNQUFNLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1lBQ25ELENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMvQyxNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsUUFBUSxFQUFFLENBQUE7UUFFaEMsT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3JELElBQUksQ0FBQztnQkFDSCxPQUFPLE1BQU0sY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3pDLENBQUM7b0JBQVMsQ0FBQztnQkFDVCxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDaEMsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVELEtBQUssQ0FBQyxzQkFBc0IsQ0FBQywrRUFBK0UsQ0FBQyxxQkFBcUI7UUFDaEksTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDckUsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUVqRSxJQUFJLENBQUMsMEJBQTBCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQzdDLElBQUksQ0FBQztZQUNILE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLHFCQUFxQixFQUFFLEVBQUMsSUFBSSxFQUFFLDZCQUE2QixFQUFDLENBQUMsQ0FBQTtZQUNwSCxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDaEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsV0FBVztnQkFBRSxJQUFJLENBQUMsMEJBQTBCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ2xFLE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsdUJBQXVCLENBQUMsK0VBQStFLENBQUMscUJBQXFCO1FBQ2pJLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1FBQ3JFLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDO2VBQzdELElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0NBQWtDLENBQUMsU0FBUyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUE7UUFDMUcsSUFBSSxVQUFVO1lBQUUsTUFBTSxVQUFVLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtJQUN2RCxDQUFDO0lBRUQsS0FBSyxDQUFDLHVCQUF1QixDQUFDLCtFQUErRSxDQUFDLHFCQUFxQjtRQUNqSSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNyRSxJQUFJLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0RBQXNELENBQUMsQ0FBQTtRQUNoSSxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDMUUsSUFBSSxDQUFDLDBCQUEwQixDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUNoRCxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ2xELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0NBQWtDLENBQUMsU0FBUyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUE7UUFDM0gsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLFNBQVMsQ0FBQyxLQUFLLFFBQVEsQ0FBQyxDQUFBO1FBQzFILElBQUksa0JBQWtCO1lBQUUsV0FBVyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQzVELEtBQUssTUFBTSxVQUFVLElBQUksV0FBVztZQUFFLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUM5RSxDQUFDO0lBRUQsS0FBSyxDQUFDLHNCQUFzQixDQUFDLCtFQUErRSxDQUFDLHFCQUFxQjtRQUNoSSxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1FBQ3pELE1BQU0sV0FBVyxHQUFHLHFCQUFxQixDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFBO1FBQ3BFLElBQUksQ0FBQyxXQUFXO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxnRUFBZ0UsQ0FBQyxDQUFBO1FBQ25HLE1BQU0sSUFBSSxXQUFXLENBQUMscUJBQXFCLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLHFCQUFxQixFQUFFLENBQUE7SUFDMUYsQ0FBQztJQUVELHVCQUF1QixDQUFDLCtFQUErRSxDQUFDLHFCQUFxQjtRQUMzSCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNyRSxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0NBQWtDLENBQUMsVUFBVSxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUE7SUFDcEksQ0FBQztJQUVELGtDQUFrQyxDQUFDLCtFQUErRSxDQUFDLHFCQUFxQjtRQUN0SSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNyRSxNQUFNLFdBQVcsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQTtRQUNqSSxPQUFPLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxVQUFVLENBQUMsS0FBSyxRQUFRLElBQUksVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUMsQ0FBQTtJQUM1SSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLCtCQUErQixDQUFDLEVBQUMscUJBQXFCLEVBQUUsSUFBSSxFQUFDLEVBQUUsUUFBUTtRQUMzRSxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxxQkFBcUIsRUFBRSxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7UUFDckYsTUFBTSxFQUFFLEdBQUcsVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFBO1FBQ2hDLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFBO1FBRXpELE9BQU8sTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNyRCxJQUFJLENBQUM7Z0JBQ0gsT0FBTyxNQUFNLFFBQVEsQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDMUMsQ0FBQztvQkFBUyxDQUFDO2dCQUNULE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNoQyxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsb0JBQW9CO1FBQ2xCLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1FBQ2xDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUU1QyxJQUFJLEVBQUUsS0FBSyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQTtRQUNuRSxJQUFJLEVBQUUsS0FBSyw2QkFBNkI7WUFBRSxPQUFPLElBQUksQ0FBQywrQkFBK0IsRUFBRSxDQUFBO1FBRXZGLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVoQyxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVuRCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBQ3hFLENBQUM7UUFFRCxPQUFPLGlCQUFpQixDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCwrQkFBK0I7UUFDN0IsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUVyRCxJQUFJLGtCQUFrQjtZQUFFLE9BQU8sa0JBQWtCLENBQUE7UUFFakQsTUFBTSxJQUFJLEtBQUssQ0FBQywyQ0FBMkMsQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsdUJBQXVCLENBQUMsRUFBRTtRQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFLElBQUksSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSx5REFBeUQsQ0FBQyxDQUFBO1FBQzVGLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLFVBQVU7UUFDNUIsTUFBTSxLQUFLLEdBQUcsc0VBQXNFLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDdkcsSUFBSSxtQkFBbUIsR0FBRyxLQUFLLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUV6RSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUN6QixtQkFBbUIsR0FBRyxFQUFFLENBQUE7WUFDeEIsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLG1CQUFtQixDQUFDLENBQUE7UUFDdEUsQ0FBQztRQUVELG1CQUFtQixDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxVQUFVLENBQUE7SUFDbkQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQjtRQUMxQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUUzQyxJQUFJLFFBQVE7WUFBRSxPQUFPLFFBQVEsQ0FBQTtRQUU3QixNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUUvQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFcEMsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsdUJBQXVCLENBQUMsVUFBVTtRQUNoQyxNQUFNLFlBQVksR0FBRyxFQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsd0JBQXdCLENBQUMsRUFBQyxDQUFBO1FBRTlELElBQUksQ0FBQyxxQkFBcUIsR0FBRyxVQUFVLENBQUE7UUFDdkMsSUFBSSxDQUFDLDZCQUE2QixHQUFHLFNBQVMsQ0FBQTtRQUM5QyxJQUFJLENBQUMsaUNBQWlDLEdBQUcsWUFBWSxDQUFBO1FBRXJELE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsK0JBQStCLENBQUMsUUFBUTtRQUN0QyxNQUFNLFlBQVksR0FBRyxFQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsaUNBQWlDLENBQUMsRUFBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7UUFDdEMsSUFBSSxDQUFDLDZCQUE2QixHQUFHLFFBQVEsQ0FBQTtRQUM3QyxJQUFJLENBQUMsaUNBQWlDLEdBQUcsWUFBWSxDQUFBO1FBRXJELE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0NBQW9DLENBQUMsSUFBSTtRQUN2QyxNQUFNLFlBQVksR0FBRyxFQUFDLEtBQUssRUFBRSxNQUFNLENBQUMseUNBQXlDLENBQUMsRUFBQyxDQUFBO1FBQy9FLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQzNELE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHVDQUF1QyxDQUFDLFVBQVUsRUFBRSxRQUFRO1FBQzFELE1BQU0sWUFBWSxHQUFHLEVBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLENBQUE7UUFFdkUsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtRQUMvRSxPQUFPLFlBQVksQ0FBQTtJQUNyQixDQUFDO0lBRUQ7Ozs7eUJBSXFCO0lBQ3JCLHlCQUF5QixDQUFDLFlBQVk7UUFDcEMsSUFBSSxZQUFZLElBQUksSUFBSSxDQUFDLDhCQUE4QixDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUM7WUFBRSxPQUFNO1FBQ3BGLElBQUksWUFBWSxFQUFFLENBQUM7WUFDakIsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxnQ0FBZ0MsRUFBRSxDQUFDO2dCQUN0RSxJQUFJLEtBQUssQ0FBQyxZQUFZLEtBQUssWUFBWTtvQkFBRSxTQUFRO2dCQUNqRCxJQUFJLENBQUMsZ0NBQWdDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUN0RCxPQUFNO1lBQ1IsQ0FBQztRQUNILENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQy9DLENBQUM7UUFDRCxJQUFJLFlBQVksSUFBSSxZQUFZLEtBQUssSUFBSSxDQUFDLGlDQUFpQztZQUFFLE9BQU07UUFFbkYsSUFBSSxDQUFDLHFCQUFxQixHQUFHLFNBQVMsQ0FBQTtRQUN0QyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsU0FBUyxDQUFBO1FBQzlDLElBQUksQ0FBQyxpQ0FBaUMsR0FBRyxTQUFTLENBQUE7SUFDcEQsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILDJCQUEyQixDQUFDLFFBQVE7UUFDbEMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUE7UUFFcEQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLFFBQVEsRUFBRSxDQUFBO1FBRWxDLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDcEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwwQkFBMEI7UUFDeEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDOUMsTUFBTSxFQUFFLEdBQUcsVUFBVSxFQUFFLFFBQVEsRUFBRSxDQUFBO1FBRWpDLElBQUksT0FBTyxFQUFFLEtBQUssUUFBUTtZQUFFLE9BQU07UUFDbEMsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLEtBQUssVUFBVTtZQUFFLE9BQU07UUFFcEQsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILG9CQUFvQjtRQUNsQixLQUFLLE1BQU0sRUFBQyxPQUFPLEVBQUUsUUFBUSxFQUFDLElBQUksSUFBSSxDQUFDLDhCQUE4QixDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7WUFDL0UsSUFBSSxPQUFPLEVBQUU7Z0JBQUUsT0FBTyxRQUFRLEVBQUUsQ0FBQTtRQUNsQyxDQUFDO1FBQ0QsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUE7UUFDaEQsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRWhGLElBQUksb0JBQW9CO1lBQUUsT0FBTyxvQkFBb0IsQ0FBQyxVQUFVLENBQUE7UUFDaEUsT0FBTyxJQUFJLENBQUMsNkJBQTZCO1lBQ3ZDLENBQUMsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLEVBQUU7WUFDdEMsQ0FBQyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDJCQUEyQjtRQUN6QixNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsUUFBUSxFQUFFLENBQUE7UUFFNUMsSUFBSSxFQUFFLEtBQUssNkJBQTZCO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFDMUQsSUFBSSxFQUFFLEtBQUssU0FBUztZQUFFLE9BQU8sSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFFeEQsT0FBTyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMkJBQTJCO1FBQ3pCLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUU1QyxPQUFPLEVBQUUsS0FBSyxTQUFTLElBQUksRUFBRSxLQUFLLDZCQUE2QixDQUFBO0lBQ2pFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxnQkFBZ0I7UUFDZCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7UUFDdEIsTUFBTSxFQUFDLFdBQVcsRUFBQyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUV4RCxPQUFPO1lBQ0wsR0FBRyxRQUFRO1lBQ1gsV0FBVztZQUNYLHVCQUF1QixFQUFFLElBQUksQ0FBQyx1QkFBdUI7WUFDckQsU0FBUyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsS0FBSyxTQUFTLENBQUMsQ0FBQyxNQUFNO1lBQ3ZKLGdDQUFnQyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUU7Z0JBQ3ZFLE9BQU8sQ0FBQyxJQUFJLENBQUMsNEJBQTRCLENBQUMsVUFBVSxDQUFDO3VCQUNoRCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFBO1lBQzlHLENBQUMsQ0FBQyxDQUFDLE1BQU07WUFDVCxVQUFVLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxNQUFNO1lBQ3JELDBCQUEwQixFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUM7WUFDckUsNkJBQTZCLEVBQUUsSUFBSSxDQUFDLDZCQUE2QjtZQUNqRSxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsNkJBQTZCLENBQUMsR0FBRyxDQUFDO1lBQ3pELG9CQUFvQixFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNO1lBQ2xELFNBQVMsRUFBRSxFQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBQztTQUMvQixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxHQUFHO1FBQzFCOzswRUFFa0U7UUFDbEUsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBQ3RCLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFakMsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEVBQUMsV0FBVyxFQUFFLEdBQUcsRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1FBQzFFLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxFQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtRQUN6RSxLQUFLLE1BQU0sVUFBVSxJQUFJLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQ3BFLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsS0FBSyxFQUFFLG9CQUFvQixFQUFDLENBQUMsQ0FBQTtRQUNuSSxDQUFDO1FBQ0QsSUFBSSxDQUFDLG1DQUFtQyxDQUFDLEVBQUMsV0FBVyxFQUFFLGVBQWUsRUFBQyxDQUFDLENBQUE7UUFFeEUsT0FBTyxFQUFDLFdBQVcsRUFBRSxlQUFlLEVBQUMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdDQUFnQyxDQUFDLEVBQUMsV0FBVyxFQUFFLEdBQUcsRUFBRSxlQUFlLEVBQUM7UUFDbEUsS0FBSyxNQUFNLENBQUMsRUFBRSxFQUFFLFVBQVUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztZQUNyRSxNQUFNLGlCQUFpQixHQUFHLDRGQUE0RixDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDbkksTUFBTSxZQUFZLEdBQUcsaUJBQWlCLENBQUMseUJBQXlCLENBQUMsQ0FBQTtZQUNqRSxNQUFNLGVBQWUsR0FBRyxPQUFPLFlBQVksS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEdBQUcsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1lBRXRHLGVBQWUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDL0IsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCLENBQUMsVUFBVSxFQUFFLEVBQUMsWUFBWSxFQUFFLGVBQWUsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDOUgsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsK0JBQStCLENBQUMsRUFBQyxXQUFXLEVBQUUsR0FBRyxFQUFFLGVBQWUsRUFBQztRQUNqRSxLQUFLLE1BQU0sVUFBVSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUMxQyxJQUFJLGVBQWUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO2dCQUFFLFNBQVE7WUFFN0MsZUFBZSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUUvQixNQUFNLGlCQUFpQixHQUFHLGdHQUFnRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDdkksTUFBTSxXQUFXLEdBQUcsaUJBQWlCLENBQUMsNkJBQTZCLENBQUMsQ0FBQTtZQUNwRSxNQUFNLFNBQVMsR0FBRyxPQUFPLFdBQVcsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEdBQUcsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1lBRTlGLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFVBQVUsRUFBRSxFQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUNyRyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxtQ0FBbUMsQ0FBQyxFQUFDLFdBQVcsRUFBRSxlQUFlLEVBQUM7UUFDaEUsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLEVBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtRQUM5SixJQUFJLENBQUMsa0NBQWtDLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtJQUN4SixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGtDQUFrQyxDQUFDLEVBQUMsVUFBVSxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBQztRQUM1RixJQUFJLENBQUMsVUFBVSxJQUFJLGVBQWUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO1lBQUUsT0FBTTtRQUUxRCxlQUFlLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQy9CLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFVBQVUsRUFBRSxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDL0UsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw2QkFBNkIsQ0FBQyxHQUFHO1FBQy9CLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDckQsWUFBWSxFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSTtZQUNuQyxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVU7WUFDL0IsS0FBSztZQUNMLGtCQUFrQixFQUFFLFFBQVEsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxTQUFTLEdBQUcsR0FBRyxDQUFDO1lBQzlGLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUTtZQUMzQixTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVM7WUFDN0IsYUFBYSxFQUFFLFFBQVEsQ0FBQyxhQUFhO1lBQ3JDLFlBQVksRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxHQUFHLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQztTQUNyRCxDQUFDLENBQUMsQ0FBQTtJQUNMLENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGdDQUFnQyxFQUFFLENBQUE7UUFFMUQsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsVUFBVSxDQUFDO1lBQUUsT0FBTTtRQUVuRSxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZ0NBQWdDO1FBQzlCLE1BQU0sS0FBSyxHQUFHLHNFQUFzRSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQ3ZHLE1BQU0sbUJBQW1CLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFM0UsT0FBTyxtQkFBbUIsRUFBRSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0NBQWtDO1FBQ2hDLE1BQU0sS0FBSyxHQUFHLHNFQUFzRSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQ3ZHLE1BQU0sbUJBQW1CLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFM0UsSUFBSSxDQUFDLG1CQUFtQjtZQUFFLE9BQU07UUFFaEMsT0FBTyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7T0FHRztJQUNILGdCQUFnQjtRQUNkLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDO1lBQzFCLEdBQUcsSUFBSSxDQUFDLFdBQVc7WUFDbkIsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztZQUN2QyxJQUFJLENBQUMsbUJBQW1CLEVBQUU7WUFDMUIsSUFBSSxDQUFDLHFCQUFxQjtTQUMzQixDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO1FBRWxCLEtBQUssTUFBTSxVQUFVLElBQUksV0FBVyxFQUFFLENBQUM7WUFDckMsSUFBSSxVQUFVO2dCQUFFLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUM5RCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILGlCQUFpQjtRQUNmLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLElBQUksRUFBRSxpQkFBaUIsQ0FBQTtRQUU3RCxJQUFJLEtBQUssS0FBSyxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDL0IsSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFcEQsT0FBTywyQkFBMkIsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHNCQUFzQixDQUFDLEtBQUs7UUFDMUIsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFBO0lBQzFFLENBQUM7SUFFRDs7eUJBRXFCO0lBQ3JCLDRCQUE0QjtRQUMxQixJQUFJLElBQUksQ0FBQyx5QkFBeUI7WUFBRSxPQUFNO1FBQzFDLElBQUksQ0FBQyxJQUFJLENBQUMsd0JBQXdCLEVBQUU7WUFBRSxPQUFNO1FBRTVDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUVoRyxJQUFJLENBQUMseUJBQXlCLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtZQUMvQyxJQUFJLENBQUMseUJBQXlCLEdBQUcsU0FBUyxDQUFBO1lBQzFDLEtBQUssSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7Z0JBQzlDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMkNBQTJDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUM5RSxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtRQUVULElBQUksT0FBTyxJQUFJLENBQUMseUJBQXlCLENBQUMsS0FBSyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQy9ELElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILHdCQUF3QjtRQUN0QixPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsS0FBSyxJQUFJLENBQUE7SUFDekUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwyQkFBMkIsQ0FBQyxpQkFBaUI7UUFDM0MsSUFBSSxLQUFLLEdBQUcsaUJBQWlCLENBQUE7UUFDN0IsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRXRCLEtBQUssTUFBTSxVQUFVLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQzFDLElBQUksSUFBSSxDQUFDLDRCQUE0QixDQUFDLFVBQVUsQ0FBQztnQkFBRSxTQUFRO1lBRTNELE1BQU0saUJBQWlCLEdBQUcsZ0dBQWdHLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUN2SSxNQUFNLFdBQVcsR0FBRyxpQkFBaUIsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1lBRXBFLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUTtnQkFBRSxTQUFRO1lBRTdDLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxpQkFBaUIsR0FBRyxDQUFDLEdBQUcsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDL0UsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxtQkFBbUI7UUFDdkIsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUV6QyxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBRWxELElBQUksaUJBQWlCLEtBQUssSUFBSTtZQUFFLE9BQU07UUFDdEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQzlCLE1BQU0sY0FBYyxHQUFHLHlCQUF5QixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNwRSxJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUE7UUFFakIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxFQUFDLGtCQUFrQixFQUFFLGVBQWUsRUFBQyxHQUFHLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLGlCQUFpQixFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLEVBQUMsQ0FBQyxDQUFBO1lBRTVILElBQUksQ0FBQyxXQUFXLEdBQUcsZUFBZSxDQUFBO1lBQ2xDLE1BQU0sSUFBSSxDQUFDLDJCQUEyQixDQUFDLGtCQUFrQixFQUFFLGNBQWMsQ0FBQyxDQUFBO1lBQzFFLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixFQUFFLENBQUE7WUFDMUMsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFBO1lBQ3BFLE1BQU0sR0FBRyxLQUFLLENBQUE7UUFDaEIsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLFNBQVMsQ0FBQyxDQUFBO1lBRXhELElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLENBQUE7WUFDOUIsSUFBSSxNQUFNO2dCQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtZQUNqRCxJQUFJLENBQUMsU0FBUyxDQUFDLGVBQWUsSUFBSSxVQUFVLENBQUE7WUFDNUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsRUFBRSxVQUFVLENBQUMsQ0FBQTtZQUNqRixJQUFJLENBQUMsMkJBQTJCLENBQUMsY0FBYyxFQUFFLFVBQVUsRUFBRSxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBQ3BGLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsa0JBQWtCLEVBQUUsY0FBYztRQUNsRSxLQUFLLE1BQU0sVUFBVSxJQUFJLGtCQUFrQixFQUFFLENBQUM7WUFDNUMsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3RDLElBQUksQ0FBQyxTQUFTLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtZQUN0QyxJQUFJLENBQUMsMkJBQTJCLENBQUMsY0FBYyxFQUFFLGtCQUFrQixDQUFDLENBQUE7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsNkJBQTZCO1FBQ2pDLElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMzQyxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUE7UUFDOUQsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUNBQWlDLENBQUMsRUFBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUM7UUFDeEQ7OzREQUVvRDtRQUNwRCxNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUE7UUFDMUI7OzREQUVvRDtRQUNwRCxNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtRQUU3QixLQUFLLE1BQU0sVUFBVSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUMxQyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsRUFBQyxVQUFVLEVBQUUsa0JBQWtCLEVBQUUsaUJBQWlCLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBQyxDQUFDLENBQUE7UUFDbEgsQ0FBQztRQUVELE9BQU8sRUFBQyxrQkFBa0IsRUFBRSxlQUFlLEVBQUMsQ0FBQTtJQUM5QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdDQUFnQyxDQUFDLEVBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLGlCQUFpQixFQUFFLGVBQWUsRUFBRSxHQUFHLEVBQUM7UUFDeEcsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsVUFBVSxDQUFDO1lBQUUsT0FBTTtRQUMvQyxJQUFJLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ2xELGVBQWUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDaEMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsRUFBQyxVQUFVLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxFQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQTtRQUV0SCxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsa0JBQWtCLENBQUMsVUFBVTtRQUMzQixNQUFNLGlCQUFpQixHQUFHLHFGQUFxRixDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFNUgsT0FBTyxPQUFPLENBQUMsaUJBQWlCLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFBO0lBQ3RELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxVQUFVLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxFQUFDO1FBQ3hELE1BQU0saUJBQWlCLEdBQUcsZ0dBQWdHLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUN2SSxNQUFNLFdBQVcsR0FBRyxpQkFBaUIsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1FBRXBFLE9BQU8sT0FBTyxXQUFXLEtBQUssUUFBUSxJQUFJLEdBQUcsR0FBRyxXQUFXLElBQUksaUJBQWlCLENBQUE7SUFDbEYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw0QkFBNEIsQ0FBQyxVQUFVO1FBQ3JDLE9BQU8sVUFBVSxDQUFDLGtCQUFrQixHQUFHLENBQUMsQ0FBQTtJQUMxQyxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsVUFBVTtRQUMxQyxJQUFJLENBQUMsSUFBSSxDQUFDLDRCQUE0QixDQUFDLFVBQVUsQ0FBQztZQUFFLE9BQU07UUFFMUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxxRkFBcUYsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUVsSSxPQUFPLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ3JELE1BQU0sVUFBVSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxVQUFVO1FBQzlCLDZFQUE2RTtRQUM3RSwyRUFBMkU7UUFDM0UsMEVBQTBFO1FBQzFFLHdCQUF3QjtRQUN4QixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRWxFLElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsT0FBTyxNQUFNLGFBQWEsQ0FBQTtRQUM1QixDQUFDO1FBRUQsTUFBTSxpQkFBaUIsR0FBRyxxS0FBcUssQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTVNLEtBQUssTUFBTSxDQUFDLFFBQVEsRUFBRSxrQkFBa0IsQ0FBQyxJQUFJLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO1lBQy9FLElBQUksa0JBQWtCLEtBQUssVUFBVTtnQkFBRSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQzNGLENBQUM7UUFFRCxpQkFBaUIsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLElBQUksQ0FBQTtRQUMzQyxPQUFPLGlCQUFpQixDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFDbkQsT0FBTyxpQkFBaUIsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1FBRXZELE1BQU0sWUFBWSxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDL0IsTUFBTSxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNqQyxDQUFDLENBQUMsRUFBRSxDQUFBO1FBRUosSUFBSSxDQUFDLHVCQUF1QixDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDMUQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUUvQyxJQUFJLENBQUM7WUFDSCxNQUFNLFlBQVksQ0FBQTtRQUNwQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsd0JBQXdCLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3BELENBQUM7SUFDSCxDQUFDO0lBRUQ7O3lCQUVxQjtJQUNyQiw4QkFBOEI7UUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUI7WUFBRSxPQUFNO1FBRTNDLFlBQVksQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQTtRQUM1QyxJQUFJLENBQUMseUJBQXlCLEdBQUcsU0FBUyxDQUFBO0lBQzVDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsUUFBUTtRQUNaLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxDQUFBO1FBQ3JDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFDLENBQUE7UUFFN0YsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUM7WUFDMUIsR0FBRyxJQUFJLENBQUMsV0FBVztZQUNuQixHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDO1lBQ3ZDLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLE1BQU0sRUFBRTtZQUM3QyxJQUFJLENBQUMsZ0NBQWdDLEVBQUU7WUFDdkMsSUFBSSxDQUFDLHFCQUFxQjtTQUMzQixDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO1FBRWxCLElBQUksQ0FBQyxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBQ3JCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7UUFDMUIsSUFBSSxDQUFDLDRCQUE0QixDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ3pDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUN2QyxJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtRQUNoQyxJQUFJLENBQUMsa0NBQWtDLEVBQUUsQ0FBQTtRQUV6QyxLQUFLLE1BQU0sVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3JDLElBQUksQ0FBQyxVQUFVO2dCQUFFLFNBQVE7WUFFekIsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7SUFFSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHNCQUFzQixDQUFDLEtBQUs7UUFDMUIsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUE7UUFFOUMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtRQUUxQixLQUFLLE1BQU0sUUFBUSxJQUFJLGdCQUFnQixFQUFFLENBQUM7WUFDeEMsSUFBSSxDQUFDLDJCQUEyQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQzFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDeEIsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxXQUFXLEVBQUUsYUFBYTtRQUNwRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDbkIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7WUFDdEMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxXQUFXLElBQUksRUFBRSxDQUFDLENBQUE7SUFDOUQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsc0JBQXNCLENBQUMsYUFBYTtRQUN6QyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDbkIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7WUFDdEMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsaUJBQWlCLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBQzlDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gXCJhc3luY19ob29rc1wiXG5pbXBvcnQgQmFzZVBvb2wsIHsgUE9PTF9DT05GSUdVUkFUSU9OX0tFWSB9IGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0IERhdGFiYXNlUG9vbENoZWNrb3V0VGltZW91dEVycm9yIGZyb20gXCIuL2NoZWNrb3V0LXRpbWVvdXQtZXJyb3IuanNcIlxuaW1wb3J0IHsgY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCB9IGZyb20gXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1jb250ZXh0LmpzXCJcblxuLyoqXG4gKiBQZW5kaW5nQ2hlY2tvdXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBlbmRpbmdDaGVja291dFxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlnIC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBuZWVkZWQgYnkgdGhlIGNoZWNrb3V0LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGVucXVldWVkQXQgLSBUaW1lc3RhbXAgd2hlbiB0aGUgY2hlY2tvdXQgc3RhcnRlZCB3YWl0aW5nLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gb3B0aW9ucyAtIENoZWNrb3V0IG9wdGlvbnMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmV1c2VLZXkgLSBEYXRhYmFzZSBjb25maWd1cmF0aW9uIHJldXNlIGtleSBuZWVkZWQgYnkgdGhlIGNoZWNrb3V0LlxuICogQHByb3BlcnR5IHsoY29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IHZvaWR9IHJlc29sdmUgLSBSZXNvbHZlcyB3aXRoIGFuIGFjdGl2YXRlZCBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfSByZWplY3QgLSBSZWplY3RzIHdoZW4gY2hlY2tvdXQgY2Fubm90IGNvbXBsZXRlLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0QXQgLSBUaW1lc3RhbXAgd2hlbiB0aGUgY2hlY2tvdXQgd2lsbCB0aW1lIG91dCwgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TWlsbGlzIC0gTWlsbGlzZWNvbmRzIHRvIHdhaXQgYmVmb3JlIHJlamVjdGluZywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gdGltZW91dFRpbWVyIC0gVGltZXIgdGhhdCByZWplY3RzIHRoZSBwZW5kaW5nIGNoZWNrb3V0LlxuICogQHByb3BlcnR5IHt7cmV2b2tlZDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IFt0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZV0gLSBEYXRhYmFzZS1hY2Nlc3Mgc2NvcGUgY2FwdHVyZWQgYXQgZW5xdWV1ZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBbdGVzdFByb2ZpbGVDb250ZXh0XSAtIEFzeW5jLXNhZmUgcHJvZmlsZSBhdHRyaWJ1dGlvbiBjYXB0dXJlZCBhdCBlbnF1ZXVlLlxuICovXG5leHBvcnQgY29uc3QgQ0xPU0VEX0NPTk5FQ1RJT04gPSBTeW1ib2woXCJ2ZWxvY2lvdXNDbG9zZWRDb25uZWN0aW9uXCIpXG5jb25zdCBJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVCA9IFN5bWJvbChcInZlbG9jaW91c0lkbGVDb25uZWN0aW9uQ2hlY2tlZEluQXRcIilcbmNvbnN0IENPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVQgPSBTeW1ib2woXCJ2ZWxvY2lvdXNDb25uZWN0aW9uQ2hlY2tlZE91dEF0XCIpXG5jb25zdCBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVCA9IFN5bWJvbChcInZlbG9jaW91c1N1cHByZXNzZWRDb25uZWN0aW9uQ29udGV4dFwiKVxuY29uc3QgREVGQVVMVF9NQVhfQ09OTkVDVElPTlMgPSAxMFxuY29uc3QgREVGQVVMVF9JRExFX1RJTUVPVVRfTUlMTElTID0gNTAwMFxuY29uc3QgREVGQVVMVF9DSEVDS09VVF9USU1FT1VUX01JTExJUyA9IDEwMDAwXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUG9vbEFzeW5jVHJhY2tlZE11bHRpQ29ubmVjdGlvbiBleHRlbmRzIEJhc2VQb29sIHtcbiAgLyoqXG4gICAqIEdsb2JhbCBmYWxsYmFjayBjb25uZWN0aW9ucyBrZXllZCBieSBjb25maWd1cmF0aW9uIGluc3RhbmNlIGFuZCBwb29sIGlkZW50aWZpZXIuXG4gICAqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+Pn1cbiAgICovXG4gIHN0YXRpYyBnbG9iYWxDb25uZWN0aW9ucyA9IG5ldyBXZWFrTWFwKClcblxuICBhc3luY0xvY2FsU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG5cbiAgLyoqXG4gICAqIFdoZW4gc2V0LCByZXR1cm5lZCBieSBnZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24gd2hlbiBubyBhc3luYyBjb250ZXh0IGV4aXN0cy5cbiAgICogVXNlZCBieSB0aGUgdGVzdCBydW5uZXIgdG8gc2hhcmUgYSBjb25uZWN0aW9uIGJldHdlZW4gdGVzdCBjb2RlIGFuZCBIVFRQIGhhbmRsZXJzXG4gICAqIHJ1bm5pbmcgaW4gdGhlIHNhbWUgcHJvY2VzcyAoaW4tcHJvY2VzcyB0ZXN0IHNlcnZlciBtb2RlKS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX3Rlc3RTaGFyZWRDb25uZWN0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIER5bmFtaWNhbGx5IHJlc29sdmVzIHRoZSBjb25uZWN0aW9uIGVsaWdpYmxlIGZvciBpbi1wcm9jZXNzIHRlc3QgcmVxdWVzdCBzaGFyaW5nLlxuICAgKiBAdHlwZSB7KCgpID0+IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkKSB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIElkZW50aWZpZXMgdGhlIGxpZmVjeWNsZSB0aGF0IGluc3RhbGxlZCB0aGUgY3VycmVudCBzaGFyZWQgY29ubmVjdGlvbiBvciBwcm92aWRlci5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF90ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKiBBdHRlbXB0LW93bmVkIHNoYXJlZCBjb25uZWN0aW9ucyBrZXllZCBieSByZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uLiAqL1xuICBfdGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleSA9IG5ldyBNYXAoKVxuXG4gIC8qKlxuICAgKiBDb25jdXJyZW50IHByb3ZpZGVycyBzZWxlY3RlZCBieSBsaXZlIGFzeW5jIGpvaW4gY29udGV4dC5cbiAgICogQHR5cGUge01hcDxpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb24sIHttYXRjaGVzOiAoKSA9PiBib29sZWFuLCBwcm92aWRlcjogKCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9Pn1cbiAgICovXG4gIF90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVycyA9IG5ldyBNYXAoKVxuXG4gIC8qKlxuICAgKiBDb25uZWN0aW9ucy5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W119ICovXG4gIGNvbm5lY3Rpb25zID0gW11cblxuICAvKipcbiAgICogUGh5c2ljYWwgaWRlbnRpdGllcyByZXF1ZXN0ZWQgdG8gcmVtYWluIHJlc2lkZW50IGJ5IHRoZSBmcm9udGVuZCB0ZW5hbnQgbGlmZWN5Y2xlLlxuICAgKiBAdHlwZSB7U2V0PHN0cmluZz59XG4gICAqL1xuICBsaWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cyA9IG5ldyBTZXQoKVxuXG4gIC8qKlxuICAgKiBQYXJrZWQgbGlmZWN5Y2xlLW93bmVkIGNvbm5lY3Rpb25zIGtleWVkIGJ5IHBoeXNpY2FsIGlkZW50aXR5LlxuICAgKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fVxuICAgKi9cbiAgbGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucyA9IG5ldyBNYXAoKVxuXG4gIC8qKlxuICAgKiBDb25uZWN0aW9ucyBpbiB1c2UuXG4gICAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIGNvbm5lY3Rpb25zSW5Vc2UgPSB7fVxuXG4gIC8qKlxuICAgKiBQZW5kaW5nIGNoZWNrb3V0cy5cbiAgICogQHR5cGUge1BlbmRpbmdDaGVja291dFtdfSAqL1xuICBwZW5kaW5nQ2hlY2tvdXRzID0gW11cblxuICAvKipcbiAgICogQ29ubmVjdGlvbnMgYmVpbmcgc3Bhd25lZC5cbiAgICogQHR5cGUge251bWJlcn0gKi9cbiAgY29ubmVjdGlvbnNCZWluZ1NwYXduZWQgPSAwXG5cbiAgLyoqXG4gICAqIFBlbmRpbmcgY2hlY2tvdXQgZHJhaW4gcHJvbWlzZS5cbiAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gIHBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuXG4gIC8qKiBXaGV0aGVyIGEgY2FsbGVyIHJlcXVlc3RlZCBhbm90aGVyIHBhc3MgdGhyb3VnaCB0aGUgcGVuZGluZyBjaGVja291dCBxdWV1ZS4gKi9cbiAgcGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBJZGxlIGNvbm5lY3Rpb24gcmVhcGVyIHRpbWVyLlxuICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gIGlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogSW4tZmxpZ2h0IGNvbm5lY3Rpb24tY2xvc2UgcHJvbWlzZXMuIFRoZSBpZGxlIHJlYXBlciBpcyBhcm1lZCBvbiBjaGVjay1pblxuICAgKiBhbmQgcnVucyBmaXJlLWFuZC1mb3JnZXQgd2hlbiBpdHMgdGltZXIgZmlyZXMsIHNvIGEgc2NoZWR1bGVkIHJlYXAgY2FuIGJlXG4gICAqIGNsb3NpbmcgYSBjb25uZWN0aW9uIHdoaWxlIGFuIGV4cGxpY2l0IGByZWFwSWRsZUNvbm5lY3Rpb25zKClgIChvclxuICAgKiBgY2xlYXJJZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKClgKSBydW5zLiBUcmFja2luZyB0aGUgaW4tZmxpZ2h0IGNsb3NlcyBsZXRzXG4gICAqIHRob3NlIGNhbGxlcnMgYXdhaXQgdGhlbSwgc28gb25jZSBhIHJlYXAgcmVzb2x2ZXMgdGhlIGNvbm5lY3Rpb25zIGl0XG4gICAqIGV4cGlyZWQgYXJlIGZ1bGx5IGNsb3NlZCBpbnN0ZWFkIG9mIGhhbGYtY2xvc2VkIG1pZC1gY2xvc2UoKWAuXG4gICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAqL1xuICBpbmZsaWdodENvbm5lY3Rpb25DbG9zZXMgPSBuZXcgU2V0KClcblxuICAvKipcbiAgICogSW4tZmxpZ2h0IGNsb3NlIHByb21pc2UgcGVyIGNvbm5lY3Rpb24sIHNvIGNvbmN1cnJlbnQgY2xvc2VzIG9mIHRoZSBzYW1lXG4gICAqIGNvbm5lY3Rpb24gYXdhaXQgdGhlIHNhbWUgY2xvc2UgcmF0aGVyIHRoYW4gY2xvc2luZyB0aGUgZHJpdmVyIGhhbmRsZSB0d2ljZS5cbiAgICogQHR5cGUge1dlYWtNYXA8b2JqZWN0LCBQcm9taXNlPHZvaWQ+Pn1cbiAgICovXG4gIGNvbm5lY3Rpb25DbG9zZVByb21pc2VzID0gbmV3IFdlYWtNYXAoKVxuXG4gIC8qKiBDdW11bGF0aXZlIGxvdy1jYXJkaW5hbGl0eSBwb29sIHRlbGVtZXRyeS4gKi9cbiAgdGVsZW1ldHJ5ID0ge1xuICAgIGNvbm5lY3Rpb25DcmVhdGlvbkNvdW50OiAwLFxuICAgIGNvbm5lY3Rpb25DcmVhdGlvbkZhaWx1cmVDb3VudDogMCxcbiAgICBjb25uZWN0aW9uQ3JlYXRpb25NYXhNczogMCxcbiAgICBjb25uZWN0aW9uQ3JlYXRpb25Ub3RhbE1zOiAwLFxuICAgIGNoZWNrb3V0VGltZW91dENvdW50OiAwLFxuICAgIGNoZWNrb3V0V2FpdENvdW50OiAwLFxuICAgIGNoZWNrb3V0V2FpdE1heE1zOiAwLFxuICAgIGNoZWNrb3V0V2FpdFRvdGFsTXM6IDAsXG4gICAgaWRsZVJlYXBDb3VudDogMCxcbiAgICBpZGxlUmVhcERpc3Bvc2FsQ291bnQ6IDAsXG4gICAgaWRsZVJlYXBGYWlsdXJlQ291bnQ6IDAsXG4gICAgaWRsZVJlYXBNYXhNczogMCxcbiAgICBpZGxlUmVhcFRvdGFsTXM6IDAsXG4gICAgcGVha0xpdmVDb25uZWN0aW9uczogMFxuICB9XG5cbiAgaWRTZXEgPSAwXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZGVudGlmaWVyIC0gSWRlbnRpZmllci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBpZGVudGlmaWVyfSkge1xuICAgIHN1cGVyKHtjb25maWd1cmF0aW9uLCBpZGVudGlmaWVyfSlcbiAgICAvKipcbiAgICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aG91dCB0aGUgaW5oZXJpdGVkIGN1cnJlbnQgY29ubmVjdGlvbiBjb250ZXh0LlxuICAgICAqIEB0eXBlIHsoY2FsbGJhY2s6ICgpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn1cbiAgICAgKi9cbiAgICBjb25zdCB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0ID0gKGNhbGxiYWNrKSA9PiB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLnJ1bihTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVCwgY2FsbGJhY2spXG4gICAgdGhpcy5fd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dCA9IHdpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBwb29sIHRlbGVtZXRyeSBjbG9jay5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IHRpbWUgaW4gbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgbm93TXMoKSB7IHJldHVybiBEYXRlLm5vdygpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHBvb2wgbWV0cmljIGluIHRoZSBhY3RpdmUgYXN5bmMtc2FmZSB0ZXN0IHByb2ZpbGUgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IGNvbnRleHQgLSBDYXB0dXJlZCBwcm9maWxlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7XCJjb25uZWN0aW9uQ3JlYXRpb25cIiB8IFwiY2hlY2tvdXRXYWl0XCIgfCBcImNoZWNrb3V0VGltZW91dFwiIHwgXCJpZGxlUmVhcFwiIHwgXCJpZGxlUmVhcERpc3Bvc2FsXCIgfCBcInBlYWtMaXZlQ29ubmVjdGlvbnNcIn0gbWV0cmljIC0gTWV0cmljIG5hbWUuXG4gICAqIEBwYXJhbSB7e2R1cmF0aW9uTXM/OiBudW1iZXIsIGZhaWxlZD86IGJvb2xlYW4sIHZhbHVlPzogbnVtYmVyfX0gW3ZhbHVlc10gLSBBZ2dyZWdhdGUgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhjb250ZXh0LCBtZXRyaWMsIHZhbHVlcyA9IHt9KSB7XG4gICAgaWYgKCFjb250ZXh0KSByZXR1cm5cblxuICAgIGNvbnRleHQucHJvZmlsZXIucmVjb3JkUG9vbE1ldHJpYyhjb250ZXh0LCB0aGlzLmlkZW50aWZpZXIsIG1ldHJpYywgdmFsdWVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFNwYXducyBhbmQgdGltZXMgYSBwaHlzaWNhbCBjb25uZWN0aW9uIHdpdGhvdXQgcmV0YWluaW5nIGl0cyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gY29uZmlnIC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtyZXVzZUtleV0gLSBFeGFjdCByZXNvbHZlZCBwaHlzaWNhbCBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIENvbm5lY3RlZCBkcml2ZXIuXG4gICAqL1xuICBhc3luYyBzcGF3bkNvbm5lY3Rpb25XaXRoQ29uZmlndXJhdGlvbihjb25maWcsIHJldXNlS2V5KSB7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gdGhpcy5ub3dNcygpXG4gICAgY29uc3QgcHJvZmlsZUNvbnRleHQgPSBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCBzdXBlci5zcGF3bkNvbm5lY3Rpb25XaXRoQ29uZmlndXJhdGlvbihjb25maWcsIHJldXNlS2V5KVxuXG4gICAgICBmYWlsZWQgPSBmYWxzZVxuICAgICAgY29uc3QgbGl2ZUNvbm5lY3Rpb25Db3VudCA9IHRoaXMubGl2ZUNvbm5lY3Rpb25Db3VudCgpIC0gdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZCArIDFcblxuICAgICAgaWYgKGxpdmVDb25uZWN0aW9uQ291bnQgPiB0aGlzLnRlbGVtZXRyeS5wZWFrTGl2ZUNvbm5lY3Rpb25zKSB7XG4gICAgICAgIHRoaXMudGVsZW1ldHJ5LnBlYWtMaXZlQ29ubmVjdGlvbnMgPSBsaXZlQ29ubmVjdGlvbkNvdW50XG4gICAgICAgIHRoaXMucmVjb3JkVGVzdFByb2ZpbGVQb29sTWV0cmljKHByb2ZpbGVDb250ZXh0LCBcInBlYWtMaXZlQ29ubmVjdGlvbnNcIiwge3ZhbHVlOiBsaXZlQ29ubmVjdGlvbkNvdW50fSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgZHVyYXRpb25NcyA9IE1hdGgubWF4KDAsIHRoaXMubm93TXMoKSAtIHN0YXJ0ZWRBdClcblxuICAgICAgdGhpcy50ZWxlbWV0cnkuY29ubmVjdGlvbkNyZWF0aW9uQ291bnQrK1xuICAgICAgaWYgKGZhaWxlZCkgdGhpcy50ZWxlbWV0cnkuY29ubmVjdGlvbkNyZWF0aW9uRmFpbHVyZUNvdW50KytcbiAgICAgIHRoaXMudGVsZW1ldHJ5LmNvbm5lY3Rpb25DcmVhdGlvblRvdGFsTXMgKz0gZHVyYXRpb25Nc1xuICAgICAgdGhpcy50ZWxlbWV0cnkuY29ubmVjdGlvbkNyZWF0aW9uTWF4TXMgPSBNYXRoLm1heCh0aGlzLnRlbGVtZXRyeS5jb25uZWN0aW9uQ3JlYXRpb25NYXhNcywgZHVyYXRpb25NcylcbiAgICAgIHRoaXMucmVjb3JkVGVzdFByb2ZpbGVQb29sTWV0cmljKHByb2ZpbGVDb250ZXh0LCBcImNvbm5lY3Rpb25DcmVhdGlvblwiLCB7ZHVyYXRpb25NcywgZmFpbGVkfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGVja2luLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gRGF0YWJhc2UgY29ubmVjdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY29ubmVjdGlvbiBpcyBjaGVja2VkIGluIG9yIGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIGNoZWNraW4oY29ubmVjdGlvbikge1xuICAgIGNvbnN0IGlkID0gY29ubmVjdGlvbi5nZXRJZFNlcSgpXG4gICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDTE9TRURfQ09OTkVDVElPTl0/OiBib29sZWFuLCBbQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF0/OiBudW1iZXIsIFtJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF0/OiBudW1iZXJ9fSAqLyAoY29ubmVjdGlvbilcblxuICAgIGlmICh0cmFja2VkQ29ubmVjdGlvbltDTE9TRURfQ09OTkVDVElPTl0pIHtcbiAgICAgIGlmICh0eXBlb2YgaWQgPT09IFwibnVtYmVyXCIpIHRoaXMudW50cmFja0Nvbm5lY3Rpb25JblVzZShjb25uZWN0aW9uLCBpZClcbiAgICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrTGVmdE9wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKVxuICAgICAgYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlSGVsZEFkdmlzb3J5TG9ja3MoKVxuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKVxuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbGVhbnVwU2Vzc2lvblN0YXRlQWZ0ZXJDaGVja291dCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDaGVja2VkT3V0Q29ubmVjdGlvbkFmdGVyQ2hlY2tpbkZhaWx1cmUoY29ubmVjdGlvbiwgaWQsIGVycm9yKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICB0aGlzLnVudHJhY2tDb25uZWN0aW9uSW5Vc2UoY29ubmVjdGlvbiwgaWQpXG4gICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdXG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbilcblxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVJldGFpbmVkUmV1c2VLZXlzLmhhcyhyZXVzZUtleSkpIHtcbiAgICAgIGNvbnN0IHJldGFpbmVkQ29ubmVjdGlvbiA9IHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5nZXQocmV1c2VLZXkpXG5cbiAgICAgIGlmICghcmV0YWluZWRDb25uZWN0aW9uIHx8IHJldGFpbmVkQ29ubmVjdGlvbiA9PT0gY29ubmVjdGlvbiB8fCByZXRhaW5lZENvbm5lY3Rpb24uZ2V0SWRTZXEoKSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cbiAgICAgICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLnNldChyZXVzZUtleSwgY29ubmVjdGlvbilcbiAgICAgICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF0gPSBEYXRlLm5vdygpXG4gICAgdGhpcy5jb25uZWN0aW9ucy5wdXNoKGNvbm5lY3Rpb24pXG4gICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKVxuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLmluY2x1ZGVzKGNvbm5lY3Rpb24pKSBhd2FpdCB0aGlzLmhhbmRsZUNoZWNrZWRJbklkbGVDb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSByZW1vdmVzIGFuZCBjbG9zZXMgYSBjaGVja2VkLW91dCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0aGF0IG11c3Qgbm90IHJldHVybiB0byB0aGUgcG9vbC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmQoY29ubmVjdGlvbikge1xuICAgIGNvbnN0IGlkID0gY29ubmVjdGlvbi5nZXRJZFNlcSgpXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIHRoaXMudW50cmFja0Nvbm5lY3Rpb25JblVzZShjb25uZWN0aW9uLCBpZClcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZUNvbm5lY3Rpb24oY29ubmVjdGlvbilcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGRpc2NhcmQgYSBkYXRhYmFzZSBjb25uZWN0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBjaGVja2VkIG91dCBjb25uZWN0aW9uIGFmdGVyIGNoZWNraW4gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gdGhhdCBmYWlsZWQgY2hlY2staW4gY2xlYW51cC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IGlkIC0gQ29ubmVjdGlvbiBjaGVja291dCBpZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gb3JpZ2luYWxFcnJvciAtIEVycm9yIHRoYXQgY2F1c2VkIGNoZWNrLWluIGNsZWFudXAgdG8gZmFpbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhbnVwIGhhcyBiZWVuIGF0dGVtcHRlZC5cbiAgICovXG4gIGFzeW5jIGNsb3NlQ2hlY2tlZE91dENvbm5lY3Rpb25BZnRlckNoZWNraW5GYWlsdXJlKGNvbm5lY3Rpb24sIGlkLCBvcmlnaW5hbEVycm9yKSB7XG4gICAgdGhpcy51bnRyYWNrQ29ubmVjdGlvbkluVXNlKGNvbm5lY3Rpb24sIGlkKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgdG8gY2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvbiBhZnRlciBjaGVjay1pbiBjbGVhbnVwIGZhaWxlZFwiLCB7ZXJyb3IsIG9yaWdpbmFsRXJyb3J9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgdG8gZHJhaW4gcGVuZGluZyBkYXRhYmFzZSBjaGVja291dHMgYWZ0ZXIgY2hlY2staW4gY2xlYW51cCBmYWlsZWRcIiwge2Vycm9yLCBvcmlnaW5hbEVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnRyYWNrIGNvbm5lY3Rpb24gaW4gdXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiBiZWluZyBjaGVja2VkIGluLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gaWQgLSBDb25uZWN0aW9uIGNoZWNrb3V0IGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHVudHJhY2tDb25uZWN0aW9uSW5Vc2UoY29ubmVjdGlvbiwgaWQpIHtcbiAgICBpZiAodHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGlkU2VxIG9uIGNvbm5lY3Rpb24gd2Fzbid0IHNldD8gJyR7dHlwZW9mIGlkfScgPSAke2lkfWApXG4gICAgfVxuXG4gICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvbnNJblVzZVtpZF1cbiAgICBjb25uZWN0aW9uLnNldElkU2VxKHVuZGVmaW5lZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjaGVja2VkIGluIGlkbGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSBpZGxlIHJlYXBpbmcgaGFzIGJlZW4gc2NoZWR1bGVkIG9yIHJ1bi5cbiAgICovXG4gIGFzeW5jIGhhbmRsZUNoZWNrZWRJbklkbGVDb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLmlkbGVUaW1lb3V0TWlsbGlzKCkgPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc2NoZWR1bGVJZGxlQ29ubmVjdGlvblJlYXBlcigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnN9IFtvcHRpb25zXSAtIENoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjaGVja291dC5cbiAgICovXG4gIGFzeW5jIGNoZWNrb3V0KG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBsZXQgZGF0YWJhc2VDb25maWcgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGxldCByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlnKVxuICAgIGxldCBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShyZXVzZUtleSlcblxuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucylcblxuICAgIGF3YWl0IHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpXG4gICAgZGF0YWJhc2VDb25maWcgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWcpXG4gICAgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpXG5cbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMpXG5cbiAgICBpZiAodGhpcy5jYW5TcGF3bkNvbm5lY3Rpb24oZGF0YWJhc2VDb25maWcpKSB7XG4gICAgICAvLyBUaGUgcG9zdC1yZWFwIGNvbmZpZ3VyYXRpb24gaXMgZnJlc2ggZm9yIHRoZSBjdXJyZW50IGNhbGxlciwgYW5kIGl0cyByZXVzZSBrZXkgaXNcbiAgICAgIC8vIGRlcml2ZWQgZnJvbSB0aGlzIGV4YWN0IGNhcHR1cmVkIG9iamVjdCBzbyB0aGUgY29ubmVjdGlvbiBjYW5ub3Qgb3BlbiBvbmUgdGVuYW50IHdoaWxlXG4gICAgICAvLyBiZWluZyBzdGFtcGVkIGZvciBhbm90aGVyLiBUaGUgcXVldWVkIHBhdGggcmV0YWlucyB0aGUgc2FtZSBjYXB0dXJlZCBwYWlyLlxuICAgICAgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuc3Bhd25Db25uZWN0aW9uRm9yQ2hlY2tvdXQoXG4gICAgICAgIGRhdGFiYXNlQ29uZmlnLFxuICAgICAgICByZXVzZUtleSxcbiAgICAgICAgY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgICApXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndhaXRGb3JDaGVja291dChkYXRhYmFzZUNvbmZpZywgcmV1c2VLZXksIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIG91dCBhIGNvbm5lY3Rpb24gZm9yIGFuIGFscmVhZHktcmVzb2x2ZWQgcGh5c2ljYWwgY29uZmlndXJhdGlvblxuICAgKiB3aXRob3V0IGNvbnN1bHRpbmcgYW1iaWVudCB0ZW5hbnQgc3RhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZyAtIENhcHR1cmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnN9IFtvcHRpb25zXSAtIENoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBBY3RpdmF0ZWQgcG9vbGVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBjaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWcsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlnKVxuICAgIGNvbnN0IGxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbiA9IHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5nZXQocmV1c2VLZXkpXG5cbiAgICBpZiAobGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9uICYmIGxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbi5nZXRJZFNlcSgpID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihsaWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb24sIG9wdGlvbnMpXG4gICAgfVxuXG4gICAgbGV0IGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KVxuXG4gICAgaWYgKGNvbm5lY3Rpb24pIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zKVxuXG4gICAgYXdhaXQgdGhpcy5yZWFwSWRsZUNvbm5lY3Rpb25zKClcbiAgICBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShyZXVzZUtleSlcblxuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucylcblxuICAgIGlmICh0aGlzLmNhblNwYXduQ29ubmVjdGlvbihkYXRhYmFzZUNvbmZpZykpIHtcbiAgICAgIGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbkZvckNoZWNrb3V0KFxuICAgICAgICBkYXRhYmFzZUNvbmZpZyxcbiAgICAgICAgcmV1c2VLZXksXG4gICAgICAgIGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuICAgICAgKVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53YWl0Rm9yQ2hlY2tvdXQoZGF0YWJhc2VDb25maWcsIHJldXNlS2V5LCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGFrZSBpZGxlIGNvbm5lY3Rpb24gZm9yIHJldXNlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbiByZXVzZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmluY2x1ZGVPcGVuVHJhbnNhY3Rpb25zXSAtIFdoZXRoZXIgY29ubmVjdGlvbnMgd2l0aCBvcGVuIHRyYW5zYWN0aW9ucyBtYXkgYmUgcmV0dXJuZWQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBNYXRjaGluZyBpZGxlIGNvbm5lY3Rpb24uXG4gICAqL1xuICB0YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShyZXVzZUtleSwge2luY2x1ZGVPcGVuVHJhbnNhY3Rpb25zID0gdHJ1ZX0gPSB7fSkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25JbmRleCA9IHRoaXMuY29ubmVjdGlvbnMuZmluZEluZGV4KChxdWV1ZWRDb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoIWluY2x1ZGVPcGVuVHJhbnNhY3Rpb25zICYmIHRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihxdWV1ZWRDb25uZWN0aW9uKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25NYXRjaGVzUmV1c2VLZXkocXVldWVkQ29ubmVjdGlvbiwgcmV1c2VLZXkpXG4gICAgfSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gY29ubmVjdGlvbkluZGV4ID09PSAtMSA/IHVuZGVmaW5lZCA6IHRoaXMuY29ubmVjdGlvbnMuc3BsaWNlKGNvbm5lY3Rpb25JbmRleCwgMSlbMF1cblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uIG1hdGNoZXMgcmV1c2Uga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbiByZXVzZSBrZXkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gbWF0Y2hlcyB0aGUgcmV1c2Uga2V5LlxuICAgKi9cbiAgY29ubmVjdGlvbk1hdGNoZXNSZXVzZUtleShjb25uZWN0aW9uLCByZXVzZUtleSkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25XaXRoUG9vbEtleSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W1BPT0xfQ09ORklHVVJBVElPTl9LRVldPzogc3RyaW5nfX0gKi8gKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gY29ubmVjdGlvbldpdGhQb29sS2V5W1BPT0xfQ09ORklHVVJBVElPTl9LRVldID09PSByZXVzZUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0aXZhdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnN9IFtvcHRpb25zXSAtIENoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBBY3RpdmF0ZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIGFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zID0ge30pIHtcbiAgICB0cnkge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlUmVqZWN0ZWRDaGVja291dEFuZFRocm93KGNvbm5lY3Rpb24sIGVycm9yKVxuICAgIH1cbiAgICBpZiAoY29ubmVjdGlvbi5nZXRJZFNlcSgpICE9PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgQ29ubmVjdGlvbiBhbHJlYWR5IGhhcyBhbiBJRC1zZXEgLSBpcyBpdCBpbiB1c2U/ICR7Y29ubmVjdGlvbi5nZXRJZFNlcSgpfWApXG5cbiAgICBjb25zdCBpZCA9IHRoaXMuaWRTZXErK1xuXG4gICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXT86IG51bWJlciwgW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuICAgIGRlbGV0ZSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cbiAgICB0cmFja2VkQ29ubmVjdGlvbltDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXSA9IERhdGUubm93KClcblxuICAgIGNvbm5lY3Rpb24uc2V0SWRTZXEoaWQpXG4gICAgdGhpcy5jb25uZWN0aW9uc0luVXNlW2lkXSA9IGNvbm5lY3Rpb25cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnNldENvbm5lY3Rpb25DaGVja291dE5hbWUob3B0aW9ucy5uYW1lKVxuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlUmVqZWN0ZWRDaGVja291dEFuZFRocm93KGNvbm5lY3Rpb24sIGVycm9yLCBpZClcbiAgICB9XG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhIHJlamVjdGVkIGNoZWNrb3V0LCB0aGVuIGhhbmRzIGZyZWVkIGNhcGFjaXR5IHRvIHF1ZXVlZCBjYWxsZXJzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gUmVqZWN0ZWQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBBY2Nlc3MgcmV2b2NhdGlvbiBlcnJvci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtpZF0gLSBBc3NpZ25lZCBjaGVja291dCBpZCwgaWYgYWN0aXZhdGlvbiByZWFjaGVkIHRoYXQgc3RhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG5ldmVyPn0gLSBBbHdheXMgcmVqZWN0cyB3aXRoIHRoZSBhY2Nlc3Mgb3IgY2xlYW51cCBlcnJvcnMuXG4gICAqL1xuICBhc3luYyBjbG9zZVJlamVjdGVkQ2hlY2tvdXRBbmRUaHJvdyhjb25uZWN0aW9uLCBlcnJvciwgaWQpIHtcbiAgICBpZiAoaWQgIT09IHVuZGVmaW5lZCkgdGhpcy51bnRyYWNrQ29ubmVjdGlvbkluVXNlKGNvbm5lY3Rpb24sIGlkKVxuXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPltdfSAqL1xuICAgIGNvbnN0IGNsZWFudXBFcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgY2xlYW51cEVycm9ycy5wdXNoKGNsb3NlRXJyb3IpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLnBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZSkge1xuICAgICAgICB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkID0gdHJ1ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGRyYWluRXJyb3IpIHtcbiAgICAgIGNsZWFudXBFcnJvcnMucHVzaChkcmFpbkVycm9yKVxuICAgIH1cblxuICAgIGlmIChjbGVhbnVwRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIC4uLmNsZWFudXBFcnJvcnNdLCBcIkRhdGFiYXNlIGNoZWNrb3V0IHJlamVjdGlvbiBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF4IGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gW2RhdGFiYXNlQ29uZmlnXSAtIENvbmZpZ3VyYXRpb24gd2hvc2UgcG9vbCBtYXhpbXVtIGFwcGxpZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIENvbmZpZ3VyZWQgbWF4IGxpdmUgY29ubmVjdGlvbnMuXG4gICAqL1xuICBtYXhDb25uZWN0aW9ucyhkYXRhYmFzZUNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSB7XG4gICAgY29uc3QgdmFsdWUgPSBkYXRhYmFzZUNvbmZpZy5wb29sPy5tYXhcblxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodGhpcy52YWxpZE1heENvbm5lY3Rpb25zKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gREVGQVVMVF9NQVhfQ09OTkVDVElPTlNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoZWNrb3V0IHRpbWVvdXQgbWlsbGlzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gW2RhdGFiYXNlQ29uZmlnXSAtIENvbmZpZ3VyYXRpb24gd2hvc2UgdGltZW91dCBhcHBsaWVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQZW5kaW5nIGNoZWNrb3V0IHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBjaGVja291dFRpbWVvdXRNaWxsaXMoZGF0YWJhc2VDb25maWcgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSkge1xuICAgIGNvbnN0IHZhbHVlID0gZGF0YWJhc2VDb25maWcucG9vbD8uY2hlY2tvdXRUaW1lb3V0TWlsbGlzXG5cbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHRoaXMudmFsaWRDaGVja291dFRpbWVvdXRNaWxsaXModmFsdWUpKSByZXR1cm4gdmFsdWVcblxuICAgIHJldHVybiBERUZBVUxUX0NIRUNLT1VUX1RJTUVPVVRfTUlMTElTXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZCBjaGVja291dCB0aW1lb3V0IG1pbGxpcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgY2hlY2tvdXQgdGltZW91dC5cbiAgICogQHJldHVybnMge3ZhbHVlIGlzIG51bWJlcn0gLSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIHZhbGlkIHRpbWVvdXQuXG4gICAqL1xuICB2YWxpZENoZWNrb3V0VGltZW91dE1pbGxpcyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+PSAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZCBtYXggY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIG1heCBjb25uZWN0aW9uIGNvdW50LlxuICAgKiBAcmV0dXJucyB7dmFsdWUgaXMgbnVtYmVyfSAtIFdoZXRoZXIgdGhlIHZhbHVlIGlzIGEgdmFsaWQgbWF4IGNvbm5lY3Rpb24gY291bnQuXG4gICAqL1xuICB2YWxpZE1heENvbm5lY3Rpb25zKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpdmUgY29ubmVjdGlvbiBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgbGl2ZSBhbmQgaW4tcHJvZ3Jlc3MgY29ubmVjdGlvbnMuXG4gICAqL1xuICBsaXZlQ29ubmVjdGlvbkNvdW50KCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gbmV3IFNldChbXG4gICAgICAuLi50aGlzLmNvbm5lY3Rpb25zLFxuICAgICAgLi4uT2JqZWN0LnZhbHVlcyh0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpLFxuICAgICAgLi4udGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLnZhbHVlcygpLFxuICAgICAgdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXG5cbiAgICByZXR1cm4gY29ubmVjdGlvbnMuc2l6ZSArIHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhbiBzcGF3biBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gW2RhdGFiYXNlQ29uZmlnXSAtIENvbmZpZ3VyYXRpb24gd2hvc2UgcG9vbCBtYXhpbXVtIGFwcGxpZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYSBuZXcgY29ubmVjdGlvbiBjYW4gYmUgc3Bhd25lZC5cbiAgICovXG4gIGNhblNwYXduQ29ubmVjdGlvbihkYXRhYmFzZUNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSB7XG4gICAgY29uc3QgbWF4Q29ubmVjdGlvbnMgPSB0aGlzLm1heENvbm5lY3Rpb25zKGRhdGFiYXNlQ29uZmlnKVxuXG4gICAgcmV0dXJuIG1heENvbm5lY3Rpb25zID09PSBudWxsIHx8IHRoaXMubGl2ZUNvbm5lY3Rpb25Db3VudCgpIDwgbWF4Q29ubmVjdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwYXduIGNvbm5lY3Rpb24gZm9yIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWcgLSBSZXNvbHZlZCBkYXRhYmFzZSBjb25maWcgZm9yIHRoZSBjaGVja291dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbiByZXVzZSBrZXkgZm9yIHRoZSBjaGVja291dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IHByb2ZpbGVDb250ZXh0IC0gUHJvZmlsZSBjb250ZXh0IGNhcHR1cmVkIHdoZW4gY2hlY2tvdXQgYmVnYW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBTcGF3bmVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBzcGF3bkNvbm5lY3Rpb25Gb3JDaGVja291dChkYXRhYmFzZUNvbmZpZywgcmV1c2VLZXksIHByb2ZpbGVDb250ZXh0KSB7XG4gICAgdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZCsrXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLnJ1bldpdGhUZXN0UHJvZmlsZUNvbnRleHQocHJvZmlsZUNvbnRleHQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc3Bhd25Db25uZWN0aW9uV2l0aENvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWcsIHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlnKSlcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuc3RhbXBDb25uZWN0aW9uRm9yQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24sIHJldXNlS2V5KVxuXG4gICAgICByZXR1cm4gY29ubmVjdGlvblxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkLS1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBjaGVja291dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlnIC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlnIGZvciB0aGUgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbb3B0aW9uc10gLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCBhbiBhY3RpdmF0ZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JDaGVja291dChkYXRhYmFzZUNvbmZpZywgcmV1c2VLZXksIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBlbnF1ZXVlZEF0ID0gRGF0ZS5ub3coKVxuICAgICAgY29uc3QgdGltZW91dE1pbGxpcyA9IHRoaXMuY2hlY2tvdXRUaW1lb3V0TWlsbGlzKGRhdGFiYXNlQ29uZmlnKVxuICAgICAgLyoqIEB0eXBlIHtQZW5kaW5nQ2hlY2tvdXR9ICovXG4gICAgICBjb25zdCBjaGVja291dCA9IHtcbiAgICAgICAgZGF0YWJhc2VDb25maWcsXG4gICAgICAgIGVucXVldWVkQXQsXG4gICAgICAgIG9wdGlvbnMsXG4gICAgICAgIHJlamVjdCxcbiAgICAgICAgcmVzb2x2ZSxcbiAgICAgICAgcmV1c2VLZXksXG4gICAgICAgIHRpbWVvdXRBdDogdGltZW91dE1pbGxpcyA9PT0gbnVsbCA/IG51bGwgOiBlbnF1ZXVlZEF0ICsgdGltZW91dE1pbGxpcyxcbiAgICAgICAgdGltZW91dE1pbGxpcyxcbiAgICAgICAgdGltZW91dFRpbWVyOiB1bmRlZmluZWQsXG4gICAgICAgIHRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuY3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKCksXG4gICAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgICB9XG5cbiAgICAgIGNoZWNrb3V0LnRpbWVvdXRUaW1lciA9IHRoaXMuc3RhcnRQZW5kaW5nQ2hlY2tvdXRUaW1lb3V0KGNoZWNrb3V0KVxuICAgICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLnB1c2goY2hlY2tvdXQpXG4gICAgICB2b2lkIHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGNvbnN0IGNoZWNrb3V0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gZHJhaW4gcGVuZGluZyBkYXRhYmFzZSBjb25uZWN0aW9uIGNoZWNrb3V0cy5cIiwge2NhdXNlOiBlcnJvcn0pXG5cbiAgICAgICAgdGhpcy5yZWplY3RQZW5kaW5nQ2hlY2tvdXRzKGNoZWNrb3V0RXJyb3IpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiBwZW5kaW5nIGNoZWNrb3V0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIGNoZWNrb3V0cyBoYXZlIGJlZW4gZHJhaW5lZCBhcyBmYXIgYXMgcG9zc2libGUuXG4gICAqL1xuICBhc3luYyBkcmFpblBlbmRpbmdDaGVja291dHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblJlcXVlc3RlZCA9IHRydWVcblxuICAgIGlmICghdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UpIHRoaXMuc3RhcnRQZW5kaW5nQ2hlY2tvdXREcmFpbigpXG4gICAgYXdhaXQgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgdGhlIHNpbmdsZSBjaGVja291dC1kcmFpbiBvd25lci4gVGhlIHNoYXJlZCBwcm9taXNlIGlzIGNsZWFyZWQgYmVmb3JlXG4gICAqIGl0IHNldHRsZXMsIGNsb3NpbmcgdGhlIHJlc29sdmVkLXByb21pc2Uvc3RhbGUtZmllbGQgaW50ZXJ2YWwgaW4gd2hpY2ggYSBuZXdcbiAgICogcmVxdWVzdCBjb3VsZCBvdGhlcndpc2UgYmUgbG9zdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGFydFBlbmRpbmdDaGVja291dERyYWluKCkge1xuICAgIGNvbnN0IHtwcm9taXNlLCByZWplY3QsIHJlc29sdmV9ID0gUHJvbWlzZS53aXRoUmVzb2x2ZXJzKClcblxuICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlID0gcHJvbWlzZVxuICAgIHZvaWQgdGhpcy5ydW5SZXF1ZXN0ZWRQZW5kaW5nQ2hlY2tvdXREcmFpbnMoe3JlamVjdCwgcmVzb2x2ZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiBwYXNzZXMgdW50aWwgZXZlcnkgcmVxdWVzdCBvYnNlcnZlZCBkdXJpbmcgdGhlIGFjdGl2ZSBwYXNzIGhhc1xuICAgKiByZWNlaXZlZCBhIGxhdGVyIHBhc3MuXG4gICAqIEBwYXJhbSB7e3JlamVjdDogKHJlYXNvbj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkLCByZXNvbHZlOiAodmFsdWU/OiB2b2lkKSA9PiB2b2lkfX0gZGVmZXJyZWQgLSBTaGFyZWQgZHJhaW4gc2V0dGxlbWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBydW5SZXF1ZXN0ZWRQZW5kaW5nQ2hlY2tvdXREcmFpbnMoe3JlamVjdCwgcmVzb2x2ZX0pIHtcbiAgICB0cnkge1xuICAgICAgd2hpbGUgKHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblJlcXVlc3RlZCA9IGZhbHNlXG4gICAgICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzQWN0dWFsKClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIHJlamVjdChlcnJvcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiBwZW5kaW5nIGNoZWNrb3V0cyBhY3R1YWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcGVuZGluZyBjaGVja291dHMgaGF2ZSBiZWVuIGRyYWluZWQgYXMgZmFyIGFzIHBvc3NpYmxlLlxuICAgKi9cbiAgYXN5bmMgZHJhaW5QZW5kaW5nQ2hlY2tvdXRzQWN0dWFsKCkge1xuICAgIHdoaWxlICh0aGlzLnBlbmRpbmdDaGVja291dHMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucmVzb2x2ZVBlbmRpbmdDaGVja291dFdpdGhNYXRjaGluZ0lkbGVDb25uZWN0aW9uKCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNoZWNrb3V0ID0gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzWzBdXG5cbiAgICAgIGlmIChhd2FpdCB0aGlzLmNsb3NlSWRsZUNvbm5lY3Rpb25Gb3JQZW5kaW5nQ2hlY2tvdXRDYXBhY2l0eShjaGVja291dCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIXRoaXMucGVuZGluZ0NoZWNrb3V0cy5pbmNsdWRlcyhjaGVja291dCkpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5jYW5TcGF3bkNvbm5lY3Rpb24oY2hlY2tvdXQuZGF0YWJhc2VDb25maWcpKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlUGVuZGluZ0NoZWNrb3V0QXQoMClcbiAgICAgICAgYXdhaXQgdGhpcy5zcGF3bkFuZFJlc29sdmVQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlYXBlZENvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmlkbGVDb25uZWN0aW9uRm9yUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0KVxuXG4gICAgICBpZiAoIXRoaXMucGVuZGluZ0NoZWNrb3V0cy5pbmNsdWRlcyhjaGVja291dCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIXJlYXBlZENvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgICB0aGlzLnJlbW92ZVBlbmRpbmdDaGVja291dEF0KDApXG4gICAgICBhd2FpdCB0aGlzLnJlc29sdmVQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQsIHJlYXBlZENvbm5lY3Rpb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBwZW5kaW5nIGNoZWNrb3V0IHdpdGggbWF0Y2hpbmcgaWRsZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgcGVuZGluZyBjaGVja291dCB3YXMgcmVzb2x2ZWQgd2l0aCBhbiBpZGxlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyByZXNvbHZlUGVuZGluZ0NoZWNrb3V0V2l0aE1hdGNoaW5nSWRsZUNvbm5lY3Rpb24oKSB7XG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IHRoaXMucGVuZGluZ0NoZWNrb3V0cy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0ID0gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzW2luZGV4XVxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkoY2hlY2tvdXQucmV1c2VLZXksIHtpbmNsdWRlT3BlblRyYW5zYWN0aW9uczogZmFsc2V9KVxuXG4gICAgICBpZiAoIWNvbm5lY3Rpb24pIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMucmVtb3ZlUGVuZGluZ0NoZWNrb3V0QXQoaW5kZXgpXG4gICAgICBhd2FpdCB0aGlzLnJlc29sdmVQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQsIGNvbm5lY3Rpb24pXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgcGVuZGluZyBjaGVja291dCBhdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGluZGV4IC0gUGVuZGluZyBjaGVja291dCBpbmRleC5cbiAgICogQHJldHVybnMge1BlbmRpbmdDaGVja291dH0gLSBSZW1vdmVkIGNoZWNrb3V0LlxuICAgKi9cbiAgcmVtb3ZlUGVuZGluZ0NoZWNrb3V0QXQoaW5kZXgpIHtcbiAgICBjb25zdCBjaGVja291dCA9IHRoaXMucGVuZGluZ0NoZWNrb3V0cy5zcGxpY2UoaW5kZXgsIDEpWzBdXG5cbiAgICB0aGlzLmNsZWFyUGVuZGluZ0NoZWNrb3V0VGltZW91dChjaGVja291dClcbiAgICB0aGlzLnJlY29yZENoZWNrb3V0V2FpdChjaGVja291dClcblxuICAgIHJldHVybiBjaGVja291dFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBjb21wbGV0ZWQgcXVldWUgd2FpdCB3aXRob3V0IHJldGFpbmluZyBwZXItY2hlY2tvdXQgbGFiZWxzIG9yIHNhbXBsZXMuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIENoZWNrb3V0IGxlYXZpbmcgdGhlIHBlbmRpbmcgcXVldWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQ2hlY2tvdXRXYWl0KGNoZWNrb3V0KSB7XG4gICAgY29uc3Qgd2FpdGVkRm9yTXMgPSBNYXRoLm1heCgwLCB0aGlzLm5vd01zKCkgLSBjaGVja291dC5lbnF1ZXVlZEF0KVxuXG4gICAgdGhpcy50ZWxlbWV0cnkuY2hlY2tvdXRXYWl0Q291bnQrK1xuICAgIHRoaXMudGVsZW1ldHJ5LmNoZWNrb3V0V2FpdFRvdGFsTXMgKz0gd2FpdGVkRm9yTXNcbiAgICB0aGlzLnRlbGVtZXRyeS5jaGVja291dFdhaXRNYXhNcyA9IE1hdGgubWF4KHRoaXMudGVsZW1ldHJ5LmNoZWNrb3V0V2FpdE1heE1zLCB3YWl0ZWRGb3JNcylcbiAgICB0aGlzLnJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhjaGVja291dC50ZXN0UHJvZmlsZUNvbnRleHQsIFwiY2hlY2tvdXRXYWl0XCIsIHtkdXJhdGlvbk1zOiB3YWl0ZWRGb3JNc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBwZW5kaW5nIGNoZWNrb3V0IHRpbWVvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIFBlbmRpbmcgY2hlY2tvdXQgdG8gdGltZSBvdXQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gLSBUaW1lciwgaWYgdGltZW91dCBpcyBlbmFibGVkLlxuICAgKi9cbiAgc3RhcnRQZW5kaW5nQ2hlY2tvdXRUaW1lb3V0KGNoZWNrb3V0KSB7XG4gICAgaWYgKGNoZWNrb3V0LnRpbWVvdXRNaWxsaXMgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnRpbWVvdXRQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQpXG4gICAgfSwgY2hlY2tvdXQudGltZW91dE1pbGxpcylcblxuICAgIHJldHVybiB0aW1lclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGltZW91dCBwZW5kaW5nIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBQZW5kaW5nIGNoZWNrb3V0IHRvIHJlamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB0aW1lb3V0UGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0KSB7XG4gICAgY29uc3QgaW5kZXggPSB0aGlzLnBlbmRpbmdDaGVja291dHMuaW5kZXhPZihjaGVja291dClcblxuICAgIGlmIChpbmRleCA9PT0gLTEpIHJldHVyblxuXG4gICAgdGhpcy5yZW1vdmVQZW5kaW5nQ2hlY2tvdXRBdChpbmRleClcbiAgICB0aGlzLnRlbGVtZXRyeS5jaGVja291dFRpbWVvdXRDb3VudCsrXG4gICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMoY2hlY2tvdXQudGVzdFByb2ZpbGVDb250ZXh0LCBcImNoZWNrb3V0VGltZW91dFwiKVxuICAgIGNoZWNrb3V0LnJlamVjdCh0aGlzLnBlbmRpbmdDaGVja291dFRpbWVvdXRFcnJvcihjaGVja291dCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZW5kaW5nIGNoZWNrb3V0IHRpbWVvdXQgZXJyb3IuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIFRpbWVkLW91dCBjaGVja291dC5cbiAgICogQHJldHVybnMge0RhdGFiYXNlUG9vbENoZWNrb3V0VGltZW91dEVycm9yfSAtIFRpbWVvdXQgZXJyb3IuXG4gICAqL1xuICBwZW5kaW5nQ2hlY2tvdXRUaW1lb3V0RXJyb3IoY2hlY2tvdXQpIHtcbiAgICBjb25zdCBjaGVja291dE5hbWUgPSBjaGVja291dC5vcHRpb25zLm5hbWUgPyBgIENoZWNrb3V0IG5hbWU6ICR7SlNPTi5zdHJpbmdpZnkoY2hlY2tvdXQub3B0aW9ucy5uYW1lKX0uYCA6IFwiXCJcbiAgICBjb25zdCBkaWFnbm9zdGljcyA9IHRoaXMucGVuZGluZ0NoZWNrb3V0VGltZW91dERpYWdub3N0aWNzKGNoZWNrb3V0KVxuXG4gICAgcmV0dXJuIG5ldyBEYXRhYmFzZVBvb2xDaGVja291dFRpbWVvdXRFcnJvcihgVGltZWQgb3V0IGFmdGVyICR7Y2hlY2tvdXQudGltZW91dE1pbGxpc31tcyB3YWl0aW5nIGZvciBkYXRhYmFzZSBjb25uZWN0aW9uIGNoZWNrb3V0IGZyb20gcG9vbCBcIiR7dGhpcy5pZGVudGlmaWVyfVwiLiR7Y2hlY2tvdXROYW1lfSAke2RpYWdub3N0aWNzfWApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHNhbml0aXplZCBkaWFnbm9zdGljcyBmb3IgYSBjaGVja291dCB0aW1lb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBUaW1lZC1vdXQgY2hlY2tvdXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUG9vbCBzdGF0ZSBzdW1tYXJ5LlxuICAgKi9cbiAgcGVuZGluZ0NoZWNrb3V0VGltZW91dERpYWdub3N0aWNzKGNoZWNrb3V0KSB7XG4gICAgY29uc3Qgc25hcHNob3QgPSB0aGlzLmdldERlYnVnU25hcHNob3QoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25TdW1tYXJpZXMgPSBzbmFwc2hvdC5jb25uZWN0aW9uc1xuICAgICAgLm1hcCgoY29ubmVjdGlvbikgPT4gdGhpcy5wZW5kaW5nQ2hlY2tvdXRUaW1lb3V0Q29ubmVjdGlvblN1bW1hcnkoY29ubmVjdGlvbikpXG4gICAgICAuam9pbihcIiwgXCIpXG4gICAgY29uc3QgcGVuZGluZ1N1bW1hcmllcyA9IChzbmFwc2hvdC5wZW5kaW5nQ2hlY2tvdXRzIHx8IFtdKVxuICAgICAgLm1hcCgocGVuZGluZ0NoZWNrb3V0KSA9PiB0aGlzLnBlbmRpbmdDaGVja291dFRpbWVvdXRQZW5kaW5nU3VtbWFyeShwZW5kaW5nQ2hlY2tvdXQpKVxuICAgICAgLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IHdhaXRlZEZvck1zID0gTWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIGNoZWNrb3V0LmVucXVldWVkQXQpXG5cbiAgICByZXR1cm4gYFBvb2wgc3RhdGU6IG1heD0ke3RoaXMubWF4Q29ubmVjdGlvbnMoKSA/PyBcInVuYm91bmRlZFwifSwgaW5Vc2U9JHtzbmFwc2hvdC5pblVzZUNvdW50fSwgaWRsZT0ke3NuYXBzaG90LmlkbGVDb3VudH0sIHBlbmRpbmc9JHtzbmFwc2hvdC5wZW5kaW5nQ2hlY2tvdXRDb3VudH0sIHNwYXduaW5nPSR7c25hcHNob3QuY29ubmVjdGlvbnNCZWluZ1NwYXduZWR9LCB0aW1lZE91dFdhaXRpbmdGb3JNcz0ke3dhaXRlZEZvck1zfSwgaG9sZGVycz1bJHtjb25uZWN0aW9uU3VtbWFyaWVzfV0sIHdhaXRpbmc9WyR7cGVuZGluZ1N1bW1hcmllc31dLmBcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzYW5pdGl6ZWQgY29ubmVjdGlvbiBzdW1tYXJ5IGZvciBjaGVja291dCB0aW1lb3V0IGRpYWdub3N0aWNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2FuaXRpemVkIGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqL1xuICBwZW5kaW5nQ2hlY2tvdXRUaW1lb3V0Q29ubmVjdGlvblN1bW1hcnkoY29ubmVjdGlvbikge1xuICAgIGNvbnN0IHBhcnRzID0gW2BzdGF0ZT0ke2Nvbm5lY3Rpb24uc3RhdGV9YF1cblxuICAgIGlmIChjb25uZWN0aW9uLmNoZWNrb3V0TmFtZSkgcGFydHMucHVzaChgY2hlY2tvdXQ9JHtKU09OLnN0cmluZ2lmeShjb25uZWN0aW9uLmNoZWNrb3V0TmFtZSl9YClcbiAgICBpZiAodHlwZW9mIGNvbm5lY3Rpb24uY2hlY2tlZE91dEZvck1zID09PSBcIm51bWJlclwiKSBwYXJ0cy5wdXNoKGBjaGVja2VkT3V0Rm9yTXM9JHtjb25uZWN0aW9uLmNoZWNrZWRPdXRGb3JNc31gKVxuICAgIGlmICh0eXBlb2YgY29ubmVjdGlvbi5pZGxlRm9yTXMgPT09IFwibnVtYmVyXCIpIHBhcnRzLnB1c2goYGlkbGVGb3JNcz0ke2Nvbm5lY3Rpb24uaWRsZUZvck1zfWApXG4gICAgaWYgKHR5cGVvZiBjb25uZWN0aW9uLm9wZW5UcmFuc2FjdGlvbnMgPT09IFwibnVtYmVyXCIpIHBhcnRzLnB1c2goYG9wZW5UcmFuc2FjdGlvbnM9JHtjb25uZWN0aW9uLm9wZW5UcmFuc2FjdGlvbnN9YClcblxuICAgIGNvbnN0IGFjdGl2ZVF1ZXJ5ID0gY29ubmVjdGlvbi5hY3RpdmVRdWVyeVxuXG4gICAgaWYgKGFjdGl2ZVF1ZXJ5ICYmIHR5cGVvZiBhY3RpdmVRdWVyeSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhY3RpdmVRdWVyeSkpIHtcbiAgICAgIGNvbnN0IHJ1bm5pbmdNcyA9ICgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFjdGl2ZVF1ZXJ5KSkucnVubmluZ01zXG5cbiAgICAgIGlmICh0eXBlb2YgcnVubmluZ01zID09PSBcIm51bWJlclwiKSBwYXJ0cy5wdXNoKGBhY3RpdmVRdWVyeU1zPSR7cnVubmluZ01zfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGB7JHtwYXJ0cy5qb2luKFwiIFwiKX19YFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHNhbml0aXplZCBwZW5kaW5nIGNoZWNrb3V0IHN1bW1hcnkgZm9yIGNoZWNrb3V0IHRpbWVvdXQgZGlhZ25vc3RpY3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbFBlbmRpbmdDaGVja291dERlYnVnU25hcHNob3R9IHBlbmRpbmdDaGVja291dCAtIFdhaXRpbmcgY2hlY2tvdXQgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2FuaXRpemVkIHBlbmRpbmcgY2hlY2tvdXQgc3RhdGUuXG4gICAqL1xuICBwZW5kaW5nQ2hlY2tvdXRUaW1lb3V0UGVuZGluZ1N1bW1hcnkocGVuZGluZ0NoZWNrb3V0KSB7XG4gICAgY29uc3QgcGFydHMgPSBbYGluZGV4PSR7cGVuZGluZ0NoZWNrb3V0LmluZGV4fWAsIGB3YWl0aW5nRm9yTXM9JHtwZW5kaW5nQ2hlY2tvdXQud2FpdGluZ0Zvck1zfWBdXG5cbiAgICBpZiAocGVuZGluZ0NoZWNrb3V0LmNoZWNrb3V0TmFtZSkgcGFydHMucHVzaChgY2hlY2tvdXQ9JHtKU09OLnN0cmluZ2lmeShwZW5kaW5nQ2hlY2tvdXQuY2hlY2tvdXROYW1lKX1gKVxuICAgIGlmIChwZW5kaW5nQ2hlY2tvdXQucmVtYWluaW5nVGltZW91dE1zICE9PSBudWxsKSBwYXJ0cy5wdXNoKGByZW1haW5pbmdUaW1lb3V0TXM9JHtwZW5kaW5nQ2hlY2tvdXQucmVtYWluaW5nVGltZW91dE1zfWApXG5cbiAgICByZXR1cm4gYHske3BhcnRzLmpvaW4oXCIgXCIpfX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBwZW5kaW5nIGNoZWNrb3V0IHRpbWVvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIFBlbmRpbmcgY2hlY2tvdXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJQZW5kaW5nQ2hlY2tvdXRUaW1lb3V0KGNoZWNrb3V0KSB7XG4gICAgaWYgKCFjaGVja291dC50aW1lb3V0VGltZXIpIHJldHVyblxuXG4gICAgY2xlYXJUaW1lb3V0KGNoZWNrb3V0LnRpbWVvdXRUaW1lcilcbiAgICBjaGVja291dC50aW1lb3V0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIGlkbGUgY29ubmVjdGlvbiBmb3IgcGVuZGluZyBjaGVja291dCBjYXBhY2l0eS5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gQ2hlY2tvdXQgd2FpdGluZyBmb3IgYSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFuIGlkbGUgY29ubmVjdGlvbiB3YXMgY2xvc2VkIHRvIGZyZWUgY2FwYWNpdHkuXG4gICAqL1xuICBhc3luYyBjbG9zZUlkbGVDb25uZWN0aW9uRm9yUGVuZGluZ0NoZWNrb3V0Q2FwYWNpdHkoY2hlY2tvdXQpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5maW5kSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShjaGVja291dC5yZXVzZUtleSlcblxuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpXG5cbiAgICBpZiAodGhpcy5maW5kSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShjaGVja291dC5yZXVzZUtleSkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuY2FuU3Bhd25Db25uZWN0aW9uKGNoZWNrb3V0LmRhdGFiYXNlQ29uZmlnKSA/IGZhbHNlIDogYXdhaXQgdGhpcy5jbG9zZU9uZUlkbGVDb25uZWN0aW9uRm9yQ2FwYWNpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBpZGxlIGNvbm5lY3Rpb24gZm9yIHJldXNlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbiByZXVzZSBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBNYXRjaGluZyBpZGxlIGNvbm5lY3Rpb24sIGlmIHByZXNlbnQuXG4gICAqL1xuICBmaW5kSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShyZXVzZUtleSkge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25zLmZpbmQoKGNvbm5lY3Rpb24pID0+ICF0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikgJiYgdGhpcy5jb25uZWN0aW9uTWF0Y2hlc1JldXNlS2V5KGNvbm5lY3Rpb24sIHJldXNlS2V5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlkbGUgY29ubmVjdGlvbiBmb3IgcGVuZGluZyBjaGVja291dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gQ2hlY2tvdXQgd2FpdGluZyBmb3IgYSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gTWF0Y2hpbmcgaWRsZSBjb25uZWN0aW9uLCBpZiBvbmUgY2FuIGJlIHJldXNlZC5cbiAgICovXG4gIGFzeW5jIGlkbGVDb25uZWN0aW9uRm9yUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0KSB7XG4gICAgbGV0IGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KGNoZWNrb3V0LnJldXNlS2V5LCB7aW5jbHVkZU9wZW5UcmFuc2FjdGlvbnM6IGZhbHNlfSlcblxuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gY29ubmVjdGlvblxuXG4gICAgYXdhaXQgdGhpcy5yZWFwSWRsZUNvbm5lY3Rpb25zKClcbiAgICBpZiAoIXRoaXMucGVuZGluZ0NoZWNrb3V0cy5pbmNsdWRlcyhjaGVja291dCkpIHJldHVyblxuXG4gICAgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkoY2hlY2tvdXQucmV1c2VLZXksIHtpbmNsdWRlT3BlblRyYW5zYWN0aW9uczogZmFsc2V9KVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwYXduIGFuZCByZXNvbHZlIHBlbmRpbmcgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIENoZWNrb3V0IHJlcXVlc3QgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hlY2tvdXQgaGFzIGJlZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIHNwYXduQW5kUmVzb2x2ZVBlbmRpbmdDaGVja291dChjaGVja291dCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5ydW5XaXRoVGVzdFByb2ZpbGVDb250ZXh0KGNoZWNrb3V0LnRlc3RQcm9maWxlQ29udGV4dCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShjaGVja291dC50ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBsZXQgY29ubmVjdGlvblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbkZvckNoZWNrb3V0KFxuICAgICAgICAgICAgY2hlY2tvdXQuZGF0YWJhc2VDb25maWcsXG4gICAgICAgICAgICBjaGVja291dC5yZXVzZUtleSxcbiAgICAgICAgICAgIGNoZWNrb3V0LnRlc3RQcm9maWxlQ29udGV4dFxuICAgICAgICAgIClcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjaGVja291dC5yZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIHNwYXduIGRhdGFiYXNlIGNvbm5lY3Rpb24uXCIsIHtjYXVzZTogZXJyb3J9KSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMucmVzb2x2ZVBlbmRpbmdDaGVja291dChjaGVja291dCwgY29ubmVjdGlvbilcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgcGVuZGluZyBjaGVja291dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gQ2hlY2tvdXQgcmVxdWVzdCB0byByZXNvbHZlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0byBhY3RpdmF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hlY2tvdXQgaGFzIGJlZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQsIGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIHJldHVybiBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIucnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChjaGVja291dC50ZXN0UHJvZmlsZUNvbnRleHQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoY2hlY2tvdXQudGVzdERhdGFiYXNlQWNjZXNzU2NvcGUsIGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjaGVja291dC5yZXNvbHZlKGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIGNoZWNrb3V0Lm9wdGlvbnMpKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNoZWNrb3V0LnJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWN0aXZhdGUgZGF0YWJhc2UgY29ubmVjdGlvbi5cIiwge2NhdXNlOiBlcnJvcn0pKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBvbmUgaWRsZSBjb25uZWN0aW9uIGZvciBjYXBhY2l0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhbiBpZGxlIGNvbm5lY3Rpb24gd2FzIGNsb3NlZCB0byBmcmVlIGNhcGFjaXR5LlxuICAgKi9cbiAgYXN5bmMgY2xvc2VPbmVJZGxlQ29ubmVjdGlvbkZvckNhcGFjaXR5KCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmZpbmQoKGNhbmRpZGF0ZSkgPT4gIXRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjYW5kaWRhdGUpKVxuXG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm4gZmFsc2VcblxuICAgIHRoaXMuY29ubmVjdGlvbnMgPSB0aGlzLmNvbm5lY3Rpb25zLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IGNvbm5lY3Rpb24pXG4gICAgYXdhaXQgdGhpcy5jbG9zZUNvbm5lY3Rpb24oY29ubmVjdGlvbilcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnMgfCAoKGFyZzogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD4pfSBvcHRpb25zT3JDYWxsYmFjayAtIENoZWNrb3V0IG9wdGlvbnMgb3IgY2FsbGJhY2sgdG8gaW52b2tlIHdpdGggdGhlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KGFyZzogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IFtjYWxsYmFja10gLSBDYWxsYmFjayB0byBpbnZva2Ugd2l0aCB0aGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aENvbm5lY3Rpb24ob3B0aW9uc09yQ2FsbGJhY2ssIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IG9wdGlvbnMgPSB0eXBlb2Ygb3B0aW9uc09yQ2FsbGJhY2sgPT0gXCJmdW5jdGlvblwiID8ge30gOiBvcHRpb25zT3JDYWxsYmFja1xuICAgIGNvbnN0IGFjdHVhbENhbGxiYWNrID0gdHlwZW9mIG9wdGlvbnNPckNhbGxiYWNrID09IFwiZnVuY3Rpb25cIiA/IG9wdGlvbnNPckNhbGxiYWNrIDogY2FsbGJhY2tcblxuICAgIGlmICghYWN0dWFsQ2FsbGJhY2spIHRocm93IG5ldyBFcnJvcihcIndpdGhDb25uZWN0aW9uIHJlcXVpcmVzIGEgY2FsbGJhY2tcIilcblxuICAgIGNvbnN0IHRlc3RTaGFyZWRDb25uZWN0aW9uID0gdGhpcy5hY3RpdmVUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uICYmIHRoaXMuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbih0ZXN0U2hhcmVkQ29ubmVjdGlvbikpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLnJ1bih0ZXN0U2hhcmVkQ29ubmVjdGlvbi5nZXRJZFNlcSgpLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxDYWxsYmFjayh0ZXN0U2hhcmVkQ29ubmVjdGlvbilcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY2hlY2tvdXQob3B0aW9ucylcbiAgICBjb25zdCBpZCA9IGNvbm5lY3Rpb24uZ2V0SWRTZXEoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UucnVuKGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgYWN0dWFsQ2FsbGJhY2soY29ubmVjdGlvbilcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBvcGVuQ2FwdHVyZWRDb25uZWN0aW9uKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBjb25zdCB3YXNSZXRhaW5lZCA9IHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuaGFzKHJldXNlS2V5KVxuXG4gICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5hZGQocmV1c2VLZXkpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHtuYW1lOiBcIkZyb250ZW5kIHRlbmFudCBTUUxpdGUgb3BlblwifSlcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXdhc1JldGFpbmVkKSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkUmV1c2VLZXlzLmRlbGV0ZShyZXVzZUtleSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZmx1c2hDYXB0dXJlZENvbm5lY3Rpb24oLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuZ2V0KHJldXNlS2V5KVxuICAgICAgfHwgdGhpcy5jb25uZWN0aW9ucy5maW5kKChjYW5kaWRhdGUpID0+IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjYW5kaWRhdGUpID09PSByZXVzZUtleSlcbiAgICBpZiAoY29ubmVjdGlvbikgYXdhaXQgY29ubmVjdGlvbi5mbHVzaFBlbmRpbmdXcml0ZXMoKVxuICB9XG5cbiAgYXN5bmMgY2xvc2VDYXB0dXJlZENvbm5lY3Rpb24oLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGlmICh0aGlzLmNhcHR1cmVkQ29ubmVjdGlvbkluVXNlKGRhdGFiYXNlQ29uZmlndXJhdGlvbikpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbG9zZSBhbiBpbi11c2UgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBoYW5kbGVcIilcbiAgICBjb25zdCByZXRhaW5lZENvbm5lY3Rpb24gPSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuZ2V0KHJldXNlS2V5KVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuZGVsZXRlKHJldXNlS2V5KVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5kZWxldGUocmV1c2VLZXkpXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB0aGlzLmNvbm5lY3Rpb25zLmZpbHRlcigoY2FuZGlkYXRlKSA9PiB0aGlzLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY2FuZGlkYXRlKSA9PT0gcmV1c2VLZXkpXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IHRoaXMuY29ubmVjdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjYW5kaWRhdGUpICE9PSByZXVzZUtleSlcbiAgICBpZiAocmV0YWluZWRDb25uZWN0aW9uKSBjb25uZWN0aW9ucy5wdXNoKHJldGFpbmVkQ29ubmVjdGlvbilcbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gIH1cblxuICBhc3luYyBkZWxldGVDYXB0dXJlZERhdGFiYXNlKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBhd2FpdCB0aGlzLmNsb3NlQ2FwdHVyZWRDb25uZWN0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBjb25zdCBEcml2ZXJDbGFzcyA9IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5kcml2ZXIgfHwgdGhpcy5kcml2ZXJDbGFzc1xuICAgIGlmICghRHJpdmVyQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBjbGFzcyBjb25maWd1cmVkIGZvciBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRlbGV0aW9uXCIpXG4gICAgYXdhaXQgbmV3IERyaXZlckNsYXNzKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgdGhpcy5jb25maWd1cmF0aW9uKS5kZWxldGVEYXRhYmFzZVN0b3JhZ2UoKVxuICB9XG5cbiAgY2FwdHVyZWRDb25uZWN0aW9uSW5Vc2UoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMuY29ubmVjdGlvbnNJblVzZSkuc29tZSgoY29ubmVjdGlvbikgPT4gdGhpcy5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pID09PSByZXVzZUtleSlcbiAgfVxuXG4gIGNhcHR1cmVkQ29ubmVjdGlvbkhhc1BlbmRpbmdXcml0ZXMoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuY29ubmVjdGlvbnMsIC4uLk9iamVjdC52YWx1ZXModGhpcy5jb25uZWN0aW9uc0luVXNlKSwgLi4udGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLnZhbHVlcygpXVxuICAgIHJldHVybiBjb25uZWN0aW9ucy5zb21lKChjb25uZWN0aW9uKSA9PiB0aGlzLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbikgPT09IHJldXNlS2V5ICYmIGNvbm5lY3Rpb24uaGFzUGVuZGluZ1dyaXRlcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYXB0dXJlZCBvcGVyYXRpb24gdGhyb3VnaCB0aGUgbm9ybWFsIGJvdW5kZWQgcG9vbCBsaWZlY3ljbGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNhcHR1cmVkQ29ubmVjdGlvbk9wdGlvbnN9IG9wdGlvbnMgLSBDYXB0dXJlZCBjaGVja291dCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgb3duZXI6IHN5bWJvbCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhDYXB0dXJlZE9wZXJhdGlvbkNvbm5lY3Rpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgbmFtZX0sIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWV9KVxuICAgIGNvbnN0IGlkID0gY29ubmVjdGlvbi5nZXRJZFNlcSgpXG4gICAgY29uc3Qgb3duZXIgPSBTeW1ib2woXCJjYXB0dXJlZC1kYXRhYmFzZS1vcGVyYXRpb24tb3duZXJcIilcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLnJ1bihpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24sIG93bmVyKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0Q3VycmVudENvbm5lY3Rpb24oKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IGlkID0gdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoaWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuY3VycmVudEZhbGxiYWNrQ29ubmVjdGlvbk9yRmFpbCgpXG4gICAgaWYgKGlkID09PSBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVCkgcmV0dXJuIHRoaXMuY3VycmVudEZhbGxiYWNrQ29ubmVjdGlvbk9yRmFpbCgpXG5cbiAgICB0aGlzLmVuc3VyZUNvbm5lY3Rpb25Jc0luVXNlKGlkKVxuXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zSW5Vc2VbaWRdXG5cbiAgICBpZiAoIWN1cnJlbnRDb25uZWN0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGdldCBjdXJyZW50IGNvbm5lY3Rpb24gZnJvbSB0aGF0IElEOiAke2lkfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGN1cnJlbnRDb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGZhbGxiYWNrIGNvbm5lY3Rpb24gb3IgZmFpbC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIEZhbGxiYWNrIGNvbm5lY3Rpb24sIGlmIHByZXNlbnQuXG4gICAqL1xuICBjdXJyZW50RmFsbGJhY2tDb25uZWN0aW9uT3JGYWlsKCkge1xuICAgIGNvbnN0IGZhbGxiYWNrQ29ubmVjdGlvbiA9IHRoaXMuZ2V0R2xvYmFsQ29ubmVjdGlvbigpXG5cbiAgICBpZiAoZmFsbGJhY2tDb25uZWN0aW9uKSByZXR1cm4gZmFsbGJhY2tDb25uZWN0aW9uXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJRCBoYXNuJ3QgYmVlbiBzZXQgZm9yIHRoaXMgYXN5bmMgY29udGV4dFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGNvbm5lY3Rpb24gaXMgaW4gdXNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gaWQgLSBDaGVja2VkLW91dCBjb25uZWN0aW9uIGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVuc3VyZUNvbm5lY3Rpb25Jc0luVXNlKGlkKSB7XG4gICAgaWYgKCEoaWQgaW4gdGhpcy5jb25uZWN0aW9uc0luVXNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25uZWN0aW9uICR7aWR9IGRvZXNuJ3QgZXhpc3QgYW55IG1vcmUgLSBoYXMgaXQgYmVlbiBjaGVja2VkIGluIGFnYWluP2ApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGZhbGxiYWNrIGNvbm5lY3Rpb24gZm9yIHRoaXMgcG9vbCBpZGVudGlmaWVyIHRoYXQgd2lsbCBiZSB1c2VkIHdoZW4gbm8gYXN5bmMgY29udGV4dCBpcyBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRHbG9iYWxDb25uZWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBrbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUG9vbEFzeW5jVHJhY2tlZE11bHRpQ29ubmVjdGlvbn0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgbGV0IG1hcEZvckNvbmZpZ3VyYXRpb24gPSBrbGFzcy5nbG9iYWxDb25uZWN0aW9ucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFtYXBGb3JDb25maWd1cmF0aW9uKSB7XG4gICAgICBtYXBGb3JDb25maWd1cmF0aW9uID0ge31cbiAgICAgIGtsYXNzLmdsb2JhbENvbm5lY3Rpb25zLnNldCh0aGlzLmNvbmZpZ3VyYXRpb24sIG1hcEZvckNvbmZpZ3VyYXRpb24pXG4gICAgfVxuXG4gICAgbWFwRm9yQ29uZmlndXJhdGlvblt0aGlzLmlkZW50aWZpZXJdID0gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYSBnbG9iYWwgZmFsbGJhY2sgY29ubmVjdGlvbiBleGlzdHMgZm9yIHRoaXMgcG9vbCBpZGVudGlmaWVyIGFuZCByZXR1cm5zIGl0LlxuICAgKiBJZiBvbmUgaXMgYWxyZWFkeSBzZXQsIGl0IGlzIHJldHVybmVkIGFuZCBhbHNvIG1hZGUgYXZhaWxhYmxlIGluIHRoZSBwb29sIHF1ZXVlLlxuICAgKiBPdGhlcndpc2UgYSBuZXcgY29ubmVjdGlvbiBpcyBzcGF3bmVkLCByZWdpc3RlcmVkLCBhbmQgcXVldWVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZ2xvYmFsIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBlbnN1cmVHbG9iYWxDb25uZWN0aW9uKCkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uKClcblxuICAgIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5zcGF3bkNvbm5lY3Rpb24oKVxuXG4gICAgdGhpcy5zZXRHbG9iYWxDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFNldCBhIHNoYXJlZCBjb25uZWN0aW9uIGZvciB0ZXN0IG1vZGUgc28gdGhhdCBIVFRQIGhhbmRsZXJzIHJ1bm5pbmdcbiAgICogaW4gdGhlIHNhbWUgcHJvY2VzcyBjYW4gcmV1c2UgdGhlIHRlc3QgcnVubmVyJ3MgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFNoYXJlZCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAtIE9wYXF1ZSByZWdpc3RyYXRpb24gaGFuZGxlLlxuICAgKi9cbiAgc2V0VGVzdFNoYXJlZENvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtvd25lcjogU3ltYm9sKFwidGVzdC1zaGFyZWQtY29ubmVjdGlvblwiKX1cblxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uID0gY29ubmVjdGlvblxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiA9IHJlZ2lzdHJhdGlvblxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgYSBwcm92aWRlciB0aGF0IGlzIGV2YWx1YXRlZCB3aGVuIGFuIGluLXByb2Nlc3MgdGVzdCByZXF1ZXN0IGlzIGRpc3BhdGNoZWQuXG4gICAqIEBwYXJhbSB7KCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IHByb3ZpZGVyIC0gU2hhcmVkIGNvbm5lY3Rpb24gcHJvdmlkZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzZXRUZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKHByb3ZpZGVyKSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge293bmVyOiBTeW1ib2woXCJ0ZXN0LXNoYXJlZC1jb25uZWN0aW9uLXByb3ZpZGVyXCIpfVxuXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyID0gcHJvdmlkZXJcbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiA9IHJlZ2lzdHJhdGlvblxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHByb3ZpZGVyIHNlbGVjdGVkIGJ5IHRoZSBjdXJyZW50IGxpdmUgYXN5bmMgam9pbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge3ttYXRjaGVzOiAoKSA9PiBib29sZWFuLCBwcm92aWRlcjogKCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9fSBhcmdzIC0gQ29udGV4dCBzZWxlY3RvciBhbmQgcHJvdmlkZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IC0gT3BhcXVlIHNjb3BlZCByZWdpc3RyYXRpb24gaGFuZGxlLlxuICAgKi9cbiAgcmVnaXN0ZXJUZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKGFyZ3MpIHtcbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7b3duZXI6IFN5bWJvbChcInRlc3Qtc2hhcmVkLWNvbm5lY3Rpb24tY29udGV4dC1wcm92aWRlclwiKX1cbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVycy5zZXQocmVnaXN0cmF0aW9uLCBhcmdzKVxuICAgIHJldHVybiByZWdpc3RyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYW4gYXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uIGZvciBleGFjdGx5IG9uZSBwaHlzaWNhbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBSZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAtIE9wYXF1ZSByZWdpc3RyYXRpb24gaGFuZGxlLlxuICAgKi9cbiAgc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKGNvbm5lY3Rpb24sIHJldXNlS2V5KSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge293bmVyOiBTeW1ib2woXCJ0ZXN0LXNoYXJlZC1waHlzaWNhbC1jb25uZWN0aW9uXCIpfVxuXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleS5zZXQocmV1c2VLZXksIHtjb25uZWN0aW9uLCByZWdpc3RyYXRpb259KVxuICAgIHJldHVybiByZWdpc3RyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGN1cnJlbnQgc2hhcmVkIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9uLiBBIHN1cHBsaWVkIHN0YWxlIHJlZ2lzdHJhdGlvblxuICAgKiBjYW5ub3QgY2xlYXIgYSBwcm92aWRlciBpbnN0YWxsZWQgYnkgYSBuZXdlciBsaWZlY3ljbGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSBbcmVnaXN0cmF0aW9uXSAtIE9wYXF1ZSByZWdpc3RyYXRpb24gaGFuZGxlIHRvIGNsZWFyIGNvbmRpdGlvbmFsbHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIGlmIChyZWdpc3RyYXRpb24gJiYgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcnMuZGVsZXRlKHJlZ2lzdHJhdGlvbikpIHJldHVyblxuICAgIGlmIChyZWdpc3RyYXRpb24pIHtcbiAgICAgIGZvciAoY29uc3QgW3JldXNlS2V5LCBlbnRyeV0gb2YgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleSkge1xuICAgICAgICBpZiAoZW50cnkucmVnaXN0cmF0aW9uICE9PSByZWdpc3RyYXRpb24pIGNvbnRpbnVlXG4gICAgICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uc0J5UmV1c2VLZXkuZGVsZXRlKHJldXNlS2V5KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleS5jbGVhcigpXG4gICAgfVxuICAgIGlmIChyZWdpc3RyYXRpb24gJiYgcmVnaXN0cmF0aW9uICE9PSB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbikgcmV0dXJuXG5cbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBpbnNpZGUgdGhlIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24ncyBhc3luYyBjb250ZXh0LCBzbyBuZXN0ZWRcbiAgICogYGdldEN1cnJlbnRDb25uZWN0aW9uYC9gZW5zdXJlQ29ubmVjdGlvbnNgIHJldXNlIGl0ICh3aXRoIGEgcmVhbCBjb250ZXh0KSByYXRoZXJcbiAgICogdGhhbiBjaGVja2luZyBvdXQgYSBmcmVzaCBwb29sZWQgY29ubmVjdGlvbi4gVXNlZCB0byBydW4gYW4gaW4tcHJvY2VzcyByZXF1ZXN0XG4gICAqIGhhbmRsZXIgb24gdGhlIHNhbWUgY29ubmVjdGlvbiDigJQgYW5kIG9wZW4gdHJhbnNhY3Rpb24g4oCUIGFzIHRoZSB0ZXN0IGJvZHkuIE5vLW9wXG4gICAqIChydW5zIHRoZSBjYWxsYmFjayBhcy1pcykgd2hlbiBubyBzaGFyZWQgY29ubmVjdGlvbiBpcyBzZXQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gaW4gdGhlIHNoYXJlZCBjb25uZWN0aW9uJ3MgY29udGV4dC5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuYWN0aXZlVGVzdFNoYXJlZENvbm5lY3Rpb24oKVxuXG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UucnVuKGNvbm5lY3Rpb24uZ2V0SWRTZXEoKSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSB0ZXN0LXNoYXJlZCBjb25uZWN0aW9uIG9ubHkgd2hpbGUgaXRzIGNoZWNrb3V0IElEIGlzIHN0aWxsIG93bmVkIGJ5IHRoaXMgcG9vbC5cbiAgICogRmFsbGJhY2stb25seSByZWdpc3RyYXRpb25zIGhhdmUgbm8gY2hlY2tvdXQgSUQgYW5kIG11c3QgZW50ZXIgdGhlIG5vcm1hbCBjaGVja291dCBwYXRoLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQWN0aXZlIHNoYXJlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgYWN0aXZlVGVzdFNoYXJlZENvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMudGVzdFNoYXJlZENvbm5lY3Rpb24oKVxuICAgIGNvbnN0IGlkID0gY29ubmVjdGlvbj8uZ2V0SWRTZXEoKVxuXG4gICAgaWYgKHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikgcmV0dXJuXG4gICAgaWYgKHRoaXMuY29ubmVjdGlvbnNJblVzZVtpZF0gIT09IGNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY29ubmVjdGlvbiBjdXJyZW50bHkgZWxpZ2libGUgZm9yIGluLXByb2Nlc3MgdGVzdCByZXF1ZXN0IHNoYXJpbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBTaGFyZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHRlc3RTaGFyZWRDb25uZWN0aW9uKCkge1xuICAgIGZvciAoY29uc3Qge21hdGNoZXMsIHByb3ZpZGVyfSBvZiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVycy52YWx1ZXMoKSkge1xuICAgICAgaWYgKG1hdGNoZXMoKSkgcmV0dXJuIHByb3ZpZGVyKClcbiAgICB9XG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpXG4gICAgY29uc3QgcGh5c2ljYWxSZWdpc3RyYXRpb24gPSB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LmdldChyZXVzZUtleSlcblxuICAgIGlmIChwaHlzaWNhbFJlZ2lzdHJhdGlvbikgcmV0dXJuIHBoeXNpY2FsUmVnaXN0cmF0aW9uLmNvbm5lY3Rpb25cbiAgICByZXR1cm4gdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlclxuICAgICAgPyB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKClcbiAgICAgIDogdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25uZWN0aW9uIHRpZWQgdG8gdGhlIGN1cnJlbnQgYXN5bmMgY29udGV4dCwgaWYgYW55LlxuICAgKiBGYWxscyBiYWNrIHRvIHRoZSB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIHdoZW4gbm8gYXN5bmMgY29udGV4dCBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgY3VycmVudCBjb250ZXh0IGNvbm5lY3Rpb24uXG4gICAqL1xuICBnZXRDdXJyZW50Q29udGV4dENvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChpZCA9PT0gU1VQUFJFU1NFRF9DT05ORUNUSU9OX0NPTlRFWFQpIHJldHVybiB1bmRlZmluZWRcbiAgICBpZiAoaWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMudGVzdFNoYXJlZENvbm5lY3Rpb24oKVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0Q3VycmVudENvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciB0aGlzIHBvb2wgaGFzIGEgcmVhbCBhc3luYyBjb250ZXh0IGZvciB0aGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG5lc3RlZCBjb2RlIGNhbiByZXVzZSB0aGUgY3VycmVudCBjb25uZWN0aW9uIGNvbnRleHQuXG4gICAqL1xuICBoYXNDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQoKSB7XG4gICAgY29uc3QgaWQgPSB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiBpZCAhPT0gdW5kZWZpbmVkICYmIGlkICE9PSBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkRhdGFiYXNlUG9vbERlYnVnU25hcHNob3R9IC0gRGlhZ25vc3RpYyBzbmFwc2hvdCBmb3IgdGhpcyBwb29sLlxuICAgKi9cbiAgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IHN1cGVyLmdldERlYnVnU25hcHNob3QoKVxuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCB7Y29ubmVjdGlvbnN9ID0gdGhpcy5kZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMobm93KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnNuYXBzaG90LFxuICAgICAgY29ubmVjdGlvbnMsXG4gICAgICBjb25uZWN0aW9uc0JlaW5nU3Bhd25lZDogdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZCxcbiAgICAgIGlkbGVDb3VudDogdGhpcy5jb25uZWN0aW9ucy5sZW5ndGggKyBbLi4udGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLnZhbHVlcygpXS5maWx0ZXIoKGNvbm5lY3Rpb24pID0+IGNvbm5lY3Rpb24uZ2V0SWRTZXEoKSA9PT0gdW5kZWZpbmVkKS5sZW5ndGgsXG4gICAgICBpZGxlTWF0Y2hpbmdQZW5kaW5nQ2hlY2tvdXRDb3VudDogdGhpcy5jb25uZWN0aW9ucy5maWx0ZXIoKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgICAgcmV0dXJuICF0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbilcbiAgICAgICAgICAmJiB0aGlzLnBlbmRpbmdDaGVja291dHMuc29tZSgoY2hlY2tvdXQpID0+IHRoaXMuY29ubmVjdGlvbk1hdGNoZXNSZXVzZUtleShjb25uZWN0aW9uLCBjaGVja291dC5yZXVzZUtleSkpXG4gICAgICB9KS5sZW5ndGgsXG4gICAgICBpblVzZUNvdW50OiBPYmplY3Qua2V5cyh0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpLmxlbmd0aCxcbiAgICAgIHBlbmRpbmdDaGVja291dERyYWluQWN0aXZlOiBCb29sZWFuKHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlKSxcbiAgICAgIHBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkOiB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0czogdGhpcy5wZW5kaW5nQ2hlY2tvdXREZWJ1Z1NuYXBzaG90cyhub3cpLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0Q291bnQ6IHRoaXMucGVuZGluZ0NoZWNrb3V0cy5sZW5ndGgsXG4gICAgICB0ZWxlbWV0cnk6IHsuLi50aGlzLnRlbGVtZXRyeX1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBjb25uZWN0aW9uIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7e2Nvbm5lY3Rpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBzZWVuQ29ubmVjdGlvbnM6IFNldDxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59fSAtIENvbm5lY3Rpb24gc25hcHNob3RzIGFuZCBzZWVuIHNldC5cbiAgICovXG4gIGRlYnVnQ29ubmVjdGlvblNuYXBzaG90cyhub3cpIHtcbiAgICAvKipcbiAgICAgKiBDb25uZWN0aW9ucy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IFtdXG4gICAgY29uc3Qgc2VlbkNvbm5lY3Rpb25zID0gbmV3IFNldCgpXG5cbiAgICB0aGlzLmFkZEluVXNlRGVidWdDb25uZWN0aW9uU25hcHNob3RzKHtjb25uZWN0aW9ucywgbm93LCBzZWVuQ29ubmVjdGlvbnN9KVxuICAgIHRoaXMuYWRkSWRsZURlYnVnQ29ubmVjdGlvblNuYXBzaG90cyh7Y29ubmVjdGlvbnMsIG5vdywgc2VlbkNvbm5lY3Rpb25zfSlcbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLnZhbHVlcygpKSB7XG4gICAgICB0aGlzLmFkZERlYnVnQ29ubmVjdGlvblNuYXBzaG90SWZVbnNlZW4oe2Nvbm5lY3Rpb24sIGNvbm5lY3Rpb25zLCByZWFwYWJsZTogZmFsc2UsIHNlZW5Db25uZWN0aW9ucywgc3RhdGU6IFwibGlmZWN5Y2xlLXJldGFpbmVkXCJ9KVxuICAgIH1cbiAgICB0aGlzLmFkZEZhbGxiYWNrRGVidWdDb25uZWN0aW9uU25hcHNob3RzKHtjb25uZWN0aW9ucywgc2VlbkNvbm5lY3Rpb25zfSlcblxuICAgIHJldHVybiB7Y29ubmVjdGlvbnMsIHNlZW5Db25uZWN0aW9uc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBpbiB1c2UgZGVidWcgY29ubmVjdGlvbiBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBub3c6IG51bWJlciwgc2VlbkNvbm5lY3Rpb25zOiBTZXQ8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fX0gYXJncyAtIFNuYXBzaG90IGNvbGxlY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkSW5Vc2VEZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMoe2Nvbm5lY3Rpb25zLCBub3csIHNlZW5Db25uZWN0aW9uc30pIHtcbiAgICBmb3IgKGNvbnN0IFtpZCwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb25uZWN0aW9uc0luVXNlKSkge1xuICAgICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuICAgICAgY29uc3QgY2hlY2tlZE91dEF0ID0gdHJhY2tlZENvbm5lY3Rpb25bQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF1cbiAgICAgIGNvbnN0IGNoZWNrZWRPdXRGb3JNcyA9IHR5cGVvZiBjaGVja2VkT3V0QXQgPT09IFwibnVtYmVyXCIgPyBNYXRoLm1heCgwLCBub3cgLSBjaGVja2VkT3V0QXQpIDogdW5kZWZpbmVkXG5cbiAgICAgIHNlZW5Db25uZWN0aW9ucy5hZGQoY29ubmVjdGlvbilcbiAgICAgIGNvbm5lY3Rpb25zLnB1c2godGhpcy5kZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdChjb25uZWN0aW9uLCB7Y2hlY2tlZE91dEF0LCBjaGVja2VkT3V0Rm9yTXMsIGNoZWNrb3V0SWQ6IGlkLCBzdGF0ZTogXCJpbi11c2VcIn0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBpZGxlIGRlYnVnIGNvbm5lY3Rpb24gc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Piwgbm93OiBudW1iZXIsIHNlZW5Db25uZWN0aW9uczogU2V0PGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IGFyZ3MgLSBTbmFwc2hvdCBjb2xsZWN0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZElkbGVEZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMoe2Nvbm5lY3Rpb25zLCBub3csIHNlZW5Db25uZWN0aW9uc30pIHtcbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgdGhpcy5jb25uZWN0aW9ucykge1xuICAgICAgaWYgKHNlZW5Db25uZWN0aW9ucy5oYXMoY29ubmVjdGlvbikpIGNvbnRpbnVlXG5cbiAgICAgIHNlZW5Db25uZWN0aW9ucy5hZGQoY29ubmVjdGlvbilcblxuICAgICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF0/OiBudW1iZXJ9fSAqLyAoY29ubmVjdGlvbilcbiAgICAgIGNvbnN0IGNoZWNrZWRJbkF0ID0gdHJhY2tlZENvbm5lY3Rpb25bSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdXG4gICAgICBjb25zdCBpZGxlRm9yTXMgPSB0eXBlb2YgY2hlY2tlZEluQXQgPT09IFwibnVtYmVyXCIgPyBNYXRoLm1heCgwLCBub3cgLSBjaGVja2VkSW5BdCkgOiB1bmRlZmluZWRcblxuICAgICAgY29ubmVjdGlvbnMucHVzaCh0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90KGNvbm5lY3Rpb24sIHtjaGVja2VkSW5BdCwgaWRsZUZvck1zLCBzdGF0ZTogXCJpZGxlXCJ9KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgZmFsbGJhY2sgZGVidWcgY29ubmVjdGlvbiBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBzZWVuQ29ubmVjdGlvbnM6IFNldDxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59fSBhcmdzIC0gU25hcHNob3QgY29sbGVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRGYWxsYmFja0RlYnVnQ29ubmVjdGlvblNuYXBzaG90cyh7Y29ubmVjdGlvbnMsIHNlZW5Db25uZWN0aW9uc30pIHtcbiAgICB0aGlzLmFkZERlYnVnQ29ubmVjdGlvblNuYXBzaG90SWZVbnNlZW4oe2Nvbm5lY3Rpb246IHRoaXMuZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKSwgY29ubmVjdGlvbnMsIHJlYXBhYmxlOiBmYWxzZSwgc2VlbkNvbm5lY3Rpb25zLCBzdGF0ZTogXCJnbG9iYWxcIn0pXG4gICAgdGhpcy5hZGREZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdElmVW5zZWVuKHtjb25uZWN0aW9uOiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbiwgY29ubmVjdGlvbnMsIHJlYXBhYmxlOiBmYWxzZSwgc2VlbkNvbm5lY3Rpb25zLCBzdGF0ZTogXCJ0ZXN0LXNoYXJlZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBkZWJ1ZyBjb25uZWN0aW9uIHNuYXBzaG90IGlmIHVuc2Vlbi5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGNvbm5lY3Rpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCByZWFwYWJsZT86IGJvb2xlYW4sIHNlZW5Db25uZWN0aW9uczogU2V0PGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Piwgc3RhdGU6IHN0cmluZ319IGFyZ3MgLSBTbmFwc2hvdCBjb2xsZWN0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZERlYnVnQ29ubmVjdGlvblNuYXBzaG90SWZVbnNlZW4oe2Nvbm5lY3Rpb24sIGNvbm5lY3Rpb25zLCByZWFwYWJsZSwgc2VlbkNvbm5lY3Rpb25zLCBzdGF0ZX0pIHtcbiAgICBpZiAoIWNvbm5lY3Rpb24gfHwgc2VlbkNvbm5lY3Rpb25zLmhhcyhjb25uZWN0aW9uKSkgcmV0dXJuXG5cbiAgICBzZWVuQ29ubmVjdGlvbnMuYWRkKGNvbm5lY3Rpb24pXG4gICAgY29ubmVjdGlvbnMucHVzaCh0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90KGNvbm5lY3Rpb24sIHtyZWFwYWJsZSwgc3RhdGV9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlbmRpbmcgY2hlY2tvdXQgZGVidWcgc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sUGVuZGluZ0NoZWNrb3V0RGVidWdTbmFwc2hvdFtdfSAtIFBlbmRpbmcgY2hlY2tvdXQgc25hcHNob3RzLlxuICAgKi9cbiAgcGVuZGluZ0NoZWNrb3V0RGVidWdTbmFwc2hvdHMobm93KSB7XG4gICAgcmV0dXJuIHRoaXMucGVuZGluZ0NoZWNrb3V0cy5tYXAoKGNoZWNrb3V0LCBpbmRleCkgPT4gKHtcbiAgICAgIGNoZWNrb3V0TmFtZTogY2hlY2tvdXQub3B0aW9ucy5uYW1lLFxuICAgICAgZW5xdWV1ZWRBdDogY2hlY2tvdXQuZW5xdWV1ZWRBdCxcbiAgICAgIGluZGV4LFxuICAgICAgcmVtYWluaW5nVGltZW91dE1zOiBjaGVja291dC50aW1lb3V0QXQgPT09IG51bGwgPyBudWxsIDogTWF0aC5tYXgoMCwgY2hlY2tvdXQudGltZW91dEF0IC0gbm93KSxcbiAgICAgIHJldXNlS2V5OiBjaGVja291dC5yZXVzZUtleSxcbiAgICAgIHRpbWVvdXRBdDogY2hlY2tvdXQudGltZW91dEF0LFxuICAgICAgdGltZW91dE1pbGxpczogY2hlY2tvdXQudGltZW91dE1pbGxpcyxcbiAgICAgIHdhaXRpbmdGb3JNczogTWF0aC5tYXgoMCwgbm93IC0gY2hlY2tvdXQuZW5xdWV1ZWRBdClcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBnbG9iYWwgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBnbG9iYWwgY29ubmVjdGlvbi5cbiAgICovXG4gIGdldEdsb2JhbENvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKVxuXG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm5cbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbihjb25uZWN0aW9uKSkgcmV0dXJuXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGdsb2JhbCBjb25uZWN0aW9uIGZvciBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGdsb2JhbCBjb25uZWN0aW9uIGZvciB0aGlzIHBvb2wgaWRlbnRpZmllci5cbiAgICovXG4gIGdldEdsb2JhbENvbm5lY3Rpb25Gb3JJZGVudGlmaWVyKCkge1xuICAgIGNvbnN0IGtsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VQb29sQXN5bmNUcmFja2VkTXVsdGlDb25uZWN0aW9ufSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBtYXBGb3JDb25maWd1cmF0aW9uID0ga2xhc3MuZ2xvYmFsQ29ubmVjdGlvbnMuZ2V0KHRoaXMuY29uZmlndXJhdGlvbilcblxuICAgIHJldHVybiBtYXBGb3JDb25maWd1cmF0aW9uPy5bdGhpcy5pZGVudGlmaWVyXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgZ2xvYmFsIGNvbm5lY3Rpb24gZm9yIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyR2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKSB7XG4gICAgY29uc3Qga2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVBvb2xBc3luY1RyYWNrZWRNdWx0aUNvbm5lY3Rpb259ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IG1hcEZvckNvbmZpZ3VyYXRpb24gPSBrbGFzcy5nbG9iYWxDb25uZWN0aW9ucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFtYXBGb3JDb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGRlbGV0ZSBtYXBGb3JDb25maWd1cmF0aW9uW3RoaXMuaWRlbnRpZmllcl1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgc2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBieSBldmVyeSBsaXZlIGNvbm5lY3Rpb24gb3duZWQgYnkgdGhpcyBwb29sLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjbGVhclNjaGVtYUNhY2hlKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gbmV3IFNldChbXG4gICAgICAuLi50aGlzLmNvbm5lY3Rpb25zLFxuICAgICAgLi4uT2JqZWN0LnZhbHVlcyh0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpLFxuICAgICAgdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uKCksXG4gICAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIGNvbm5lY3Rpb25zKSB7XG4gICAgICBpZiAoY29ubmVjdGlvbikgdGhpcy5fY2xlYXJDb25uZWN0aW9uU2NoZW1hQ2FjaGUoY29ubmVjdGlvbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpZGxlIHRpbWVvdXQgbWlsbGlzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBJZGxlIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBpZGxlVGltZW91dE1pbGxpcygpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLnBvb2w/LmlkbGVUaW1lb3V0TWlsbGlzXG5cbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHRoaXMudmFsaWRJZGxlVGltZW91dE1pbGxpcyh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIERFRkFVTFRfSURMRV9USU1FT1VUX01JTExJU1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWQgaWRsZSB0aW1lb3V0IG1pbGxpcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgaWRsZSB0aW1lb3V0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dmFsdWUgaXMgbnVtYmVyfSAtIFdoZXRoZXIgdGhlIHZhbHVlIGlzIGEgdmFsaWQgaWRsZSB0aW1lb3V0LlxuICAgKi9cbiAgdmFsaWRJZGxlVGltZW91dE1pbGxpcyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+PSAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlZHVsZSBpZGxlIGNvbm5lY3Rpb24gcmVhcGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgc2NoZWR1bGVJZGxlQ29ubmVjdGlvblJlYXBlcigpIHtcbiAgICBpZiAodGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKSByZXR1cm5cbiAgICBpZiAoIXRoaXMuaGFzSWRsZUNvbm5lY3Rpb25zVG9SZWFwKCkpIHJldHVyblxuXG4gICAgY29uc3QgZGVsYXkgPSB0aGlzLm5leHRJZGxlQ29ubmVjdGlvblJlYXBEZWxheSgvKiogQHR5cGUge251bWJlcn0gKi8gKHRoaXMuaWRsZVRpbWVvdXRNaWxsaXMoKSkpXG5cbiAgICB0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdm9pZCB0aGlzLnJlYXBJZGxlQ29ubmVjdGlvbnMoKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gcmVhcCBpZGxlIGRhdGFiYXNlIGNvbm5lY3Rpb25zOlwiLCBlcnJvcl0pXG4gICAgICB9KVxuICAgIH0sIGRlbGF5KVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyLnVucmVmKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgaWRsZSBjb25uZWN0aW9ucyB0byByZWFwLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFuIGlkbGUgcmVhcGVyIHRpbWVyIHNob3VsZCBiZSBzY2hlZHVsZWQuXG4gICAqL1xuICBoYXNJZGxlQ29ubmVjdGlvbnNUb1JlYXAoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnMubGVuZ3RoID4gMCAmJiB0aGlzLmlkbGVUaW1lb3V0TWlsbGlzKCkgIT09IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgaWRsZSBjb25uZWN0aW9uIHJlYXAgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpZGxlVGltZW91dE1pbGxpcyAtIElkbGUgdGltZW91dCBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGVsYXkgYmVmb3JlIHRoZSBuZXh0IHJlYXAuXG4gICAqL1xuICBuZXh0SWRsZUNvbm5lY3Rpb25SZWFwRGVsYXkoaWRsZVRpbWVvdXRNaWxsaXMpIHtcbiAgICBsZXQgZGVsYXkgPSBpZGxlVGltZW91dE1pbGxpc1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pKSBjb250aW51ZVxuXG4gICAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuICAgICAgY29uc3QgY2hlY2tlZEluQXQgPSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cblxuICAgICAgaWYgKHR5cGVvZiBjaGVja2VkSW5BdCAhPT0gXCJudW1iZXJcIikgY29udGludWVcblxuICAgICAgZGVsYXkgPSBNYXRoLm1pbihkZWxheSwgTWF0aC5tYXgoMCwgaWRsZVRpbWVvdXRNaWxsaXMgLSAobm93IC0gY2hlY2tlZEluQXQpKSlcbiAgICB9XG5cbiAgICByZXR1cm4gZGVsYXlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgaWRsZSBjaGVja2VkLWluIGNvbm5lY3Rpb25zIHRoYXQgaGF2ZSBleGNlZWRlZCB0aGUgY29uZmlndXJlZCB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVhcElkbGVDb25uZWN0aW9ucygpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgaWRsZVRpbWVvdXRNaWxsaXMgPSB0aGlzLmlkbGVUaW1lb3V0TWlsbGlzKClcblxuICAgIGlmIChpZGxlVGltZW91dE1pbGxpcyA9PT0gbnVsbCkgcmV0dXJuXG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gdGhpcy5ub3dNcygpXG4gICAgY29uc3QgcHJvZmlsZUNvbnRleHQgPSBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHtleHBpcmVkQ29ubmVjdGlvbnMsIGtlcHRDb25uZWN0aW9uc30gPSB0aGlzLmNsYXNzaWZ5SWRsZUNvbm5lY3Rpb25zRm9yUmVhcGluZyh7aWRsZVRpbWVvdXRNaWxsaXMsIG5vdzogdGhpcy5ub3dNcygpfSlcblxuICAgICAgdGhpcy5jb25uZWN0aW9ucyA9IGtlcHRDb25uZWN0aW9uc1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZUV4cGlyZWRJZGxlQ29ubmVjdGlvbnMoZXhwaXJlZENvbm5lY3Rpb25zLCBwcm9maWxlQ29udGV4dClcbiAgICAgIGF3YWl0IHRoaXMuYXdhaXRJbmZsaWdodENvbm5lY3Rpb25DbG9zZXMoKVxuICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbnMubGVuZ3RoID4gMCkgdGhpcy5zY2hlZHVsZUlkbGVDb25uZWN0aW9uUmVhcGVyKClcbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBNYXRoLm1heCgwLCB0aGlzLm5vd01zKCkgLSBzdGFydGVkQXQpXG5cbiAgICAgIHRoaXMudGVsZW1ldHJ5LmlkbGVSZWFwQ291bnQrK1xuICAgICAgaWYgKGZhaWxlZCkgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBGYWlsdXJlQ291bnQrK1xuICAgICAgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBUb3RhbE1zICs9IGR1cmF0aW9uTXNcbiAgICAgIHRoaXMudGVsZW1ldHJ5LmlkbGVSZWFwTWF4TXMgPSBNYXRoLm1heCh0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcE1heE1zLCBkdXJhdGlvbk1zKVxuICAgICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMocHJvZmlsZUNvbnRleHQsIFwiaWRsZVJlYXBcIiwge2R1cmF0aW9uTXMsIGZhaWxlZH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UgZXhwaXJlZCBpZGxlIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W119IGV4cGlyZWRDb25uZWN0aW9ucyAtIENvbm5lY3Rpb25zIHRvIGNsb3NlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gW3Byb2ZpbGVDb250ZXh0XSAtIFJlYXBlciBwcm9maWxlIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VFeHBpcmVkSWRsZUNvbm5lY3Rpb25zKGV4cGlyZWRDb25uZWN0aW9ucywgcHJvZmlsZUNvbnRleHQpIHtcbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgZXhwaXJlZENvbm5lY3Rpb25zKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgICAgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBEaXNwb3NhbENvdW50KytcbiAgICAgIHRoaXMucmVjb3JkVGVzdFByb2ZpbGVQb29sTWV0cmljKHByb2ZpbGVDb250ZXh0LCBcImlkbGVSZWFwRGlzcG9zYWxcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhd2FpdCBpbmZsaWdodCBjb25uZWN0aW9uIGNsb3Nlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSBpbi1mbGlnaHQgY29ubmVjdGlvbiBjbG9zZXMgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgYXdhaXRJbmZsaWdodENvbm5lY3Rpb25DbG9zZXMoKSB7XG4gICAgaWYgKHRoaXMuaW5mbGlnaHRDb25uZWN0aW9uQ2xvc2VzLnNpemUgPiAwKSB7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnRoaXMuaW5mbGlnaHRDb25uZWN0aW9uQ2xvc2VzXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGFzc2lmeSBpZGxlIGNvbm5lY3Rpb25zIGZvciByZWFwaW5nLlxuICAgKiBAcGFyYW0ge3tpZGxlVGltZW91dE1pbGxpczogbnVtYmVyLCBub3c6IG51bWJlcn19IGFyZ3MgLSBSZWFwZXIgY2xhc3NpZmljYXRpb24gaW5wdXRzLlxuICAgKiBAcmV0dXJucyB7e2V4cGlyZWRDb25uZWN0aW9uczogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXSwga2VwdENvbm5lY3Rpb25zOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdfX0gLSBDbGFzc2lmaWVkIGlkbGUgY29ubmVjdGlvbnMuXG4gICAqL1xuICBjbGFzc2lmeUlkbGVDb25uZWN0aW9uc0ZvclJlYXBpbmcoe2lkbGVUaW1lb3V0TWlsbGlzLCBub3d9KSB7XG4gICAgLyoqXG4gICAgICogS2VwdCBjb25uZWN0aW9ucy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBrZXB0Q29ubmVjdGlvbnMgPSBbXVxuICAgIC8qKlxuICAgICAqIEV4cGlyZWQgY29ubmVjdGlvbnMuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgY29uc3QgZXhwaXJlZENvbm5lY3Rpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICB0aGlzLmNsYXNzaWZ5SWRsZUNvbm5lY3Rpb25Gb3JSZWFwaW5nKHtjb25uZWN0aW9uLCBleHBpcmVkQ29ubmVjdGlvbnMsIGlkbGVUaW1lb3V0TWlsbGlzLCBrZXB0Q29ubmVjdGlvbnMsIG5vd30pXG4gICAgfVxuXG4gICAgcmV0dXJuIHtleHBpcmVkQ29ubmVjdGlvbnMsIGtlcHRDb25uZWN0aW9uc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsYXNzaWZ5IGlkbGUgY29ubmVjdGlvbiBmb3IgcmVhcGluZy5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGV4cGlyZWRDb25uZWN0aW9uczogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXSwgaWRsZVRpbWVvdXRNaWxsaXM6IG51bWJlciwga2VwdENvbm5lY3Rpb25zOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdLCBub3c6IG51bWJlcn19IGFyZ3MgLSBDbGFzc2lmaWNhdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGFzc2lmeUlkbGVDb25uZWN0aW9uRm9yUmVhcGluZyh7Y29ubmVjdGlvbiwgZXhwaXJlZENvbm5lY3Rpb25zLCBpZGxlVGltZW91dE1pbGxpcywga2VwdENvbm5lY3Rpb25zLCBub3d9KSB7XG4gICAgaWYgKHRoaXMuY29ubmVjdGlvbklzQ2xvc2VkKGNvbm5lY3Rpb24pKSByZXR1cm5cbiAgICBpZiAodGhpcy5jb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pKSB7XG4gICAgICBrZXB0Q29ubmVjdGlvbnMucHVzaChjb25uZWN0aW9uKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy5pZGxlQ29ubmVjdGlvbkV4cGlyZWQoe2Nvbm5lY3Rpb24sIGlkbGVUaW1lb3V0TWlsbGlzLCBub3d9KSA/IGV4cGlyZWRDb25uZWN0aW9ucyA6IGtlcHRDb25uZWN0aW9uc1xuXG4gICAgdGFyZ2V0LnB1c2goY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24gaXMgY2xvc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIGlzIG1hcmtlZCBjbG9zZWQuXG4gICAqL1xuICBjb25uZWN0aW9uSXNDbG9zZWQoY29ubmVjdGlvbikge1xuICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbQ0xPU0VEX0NPTk5FQ1RJT05dPzogYm9vbGVhbn19ICovIChjb25uZWN0aW9uKVxuXG4gICAgcmV0dXJuIEJvb2xlYW4odHJhY2tlZENvbm5lY3Rpb25bQ0xPU0VEX0NPTk5FQ1RJT05dKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaWRsZSBjb25uZWN0aW9uIGV4cGlyZWQuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBpZGxlVGltZW91dE1pbGxpczogbnVtYmVyLCBub3c6IG51bWJlcn19IGFyZ3MgLSBFeHBpcnkgaW5wdXRzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBpZGxlIGNvbm5lY3Rpb24gZXhwaXJlZC5cbiAgICovXG4gIGlkbGVDb25uZWN0aW9uRXhwaXJlZCh7Y29ubmVjdGlvbiwgaWRsZVRpbWVvdXRNaWxsaXMsIG5vd30pIHtcbiAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuICAgIGNvbnN0IGNoZWNrZWRJbkF0ID0gdHJhY2tlZENvbm5lY3Rpb25bSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdXG5cbiAgICByZXR1cm4gdHlwZW9mIGNoZWNrZWRJbkF0ID09PSBcIm51bWJlclwiICYmIG5vdyAtIGNoZWNrZWRJbkF0ID49IGlkbGVUaW1lb3V0TWlsbGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uIGhhcyBvcGVuIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIGhhcyBhbiBvcGVuIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgcmV0dXJuIGNvbm5lY3Rpb24uX3RyYW5zYWN0aW9uc0NvdW50ID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgYW55IHRyYW5zYWN0aW9uIGEgcHJldmlvdXMgaG9sZGVyIGxlZnQgb3BlbiBiZWZvcmUgYSBjb25uZWN0aW9uXG4gICAqIHJlLWVudGVycyB0aGUgaWRsZSBwb29sLiBBIGNvbm5lY3Rpb24gcmV0dXJuZWQgdG8gdGhlIHBvb2wgd2l0aCBhbiBvcGVuXG4gICAqIHRyYW5zYWN0aW9uIHdvdWxkIG90aGVyd2lzZSBiZSBoYW5kZWQgdG8gYW4gdW5yZWxhdGVkIGNoZWNrb3V0LCB3aG9zZVxuICAgKiBzdGFydFRyYW5zYWN0aW9uKCkgdGhlbiBmYWlscyB3aXRoIFwiQSB0cmFuc2FjdGlvbiBpcyBhbHJlYWR5IHJ1bm5pbmdcIiBhbmRcbiAgICogcG9pc29ucyBldmVyeSBmb2xsb3dpbmcgY2FsbGVyIHRoYXQgcmV1c2VzIGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiBiZWluZyBjaGVja2VkIGluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb25uZWN0aW9uIGhvbGRzIG5vIG9wZW4gdHJhbnNhY3Rpb24uXG4gICAqL1xuICBhc3luYyByb2xsYmFja0xlZnRPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pKSByZXR1cm5cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW2BSb2xsaW5nIGJhY2sgYSB0cmFuc2FjdGlvbiBsZWZ0IG9wZW4gb24gYSBjb25uZWN0aW9uIGJlaW5nIGNoZWNrZWQgaW4gKGlkZW50aWZpZXI9JHt0aGlzLmlkZW50aWZpZXJ9KS5gXSlcblxuICAgIHdoaWxlICh0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIHtcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gdG8gY2xvc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbG9zZUNvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIC8vIElkZW1wb3RlbnQ6IGEgZmlyZS1hbmQtZm9yZ2V0IHNjaGVkdWxlZCByZWFwIGFuZCBhbiBleHBsaWNpdCByZWFwIGNhbiBib3RoXG4gICAgLy8gdGFyZ2V0IHRoZSBzYW1lIGNvbm5lY3Rpb24uIEF3YWl0IHRoZSBpbi1mbGlnaHQgY2xvc2UgaW5zdGVhZCBvZiBjbG9zaW5nXG4gICAgLy8gdHdpY2UgKHdoaWNoIGNhbiB0aHJvdyBvbiB0aGUgZHJpdmVyKSBvciByZXR1cm5pbmcgd2hpbGUgdGhlIHVuZGVybHlpbmdcbiAgICAvLyBoYW5kbGUgaXMgc3RpbGwgb3Blbi5cbiAgICBjb25zdCBleGlzdGluZ0Nsb3NlID0gdGhpcy5jb25uZWN0aW9uQ2xvc2VQcm9taXNlcy5nZXQoY29ubmVjdGlvbilcblxuICAgIGlmIChleGlzdGluZ0Nsb3NlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgZXhpc3RpbmdDbG9zZVxuICAgIH1cblxuICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbQ0xPU0VEX0NPTk5FQ1RJT05dPzogYm9vbGVhbiwgW0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdPzogbnVtYmVyLCBbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG5cbiAgICBmb3IgKGNvbnN0IFtyZXVzZUtleSwgcmV0YWluZWRDb25uZWN0aW9uXSBvZiB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMpIHtcbiAgICAgIGlmIChyZXRhaW5lZENvbm5lY3Rpb24gPT09IGNvbm5lY3Rpb24pIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5kZWxldGUocmV1c2VLZXkpXG4gICAgfVxuXG4gICAgdHJhY2tlZENvbm5lY3Rpb25bQ0xPU0VEX0NPTk5FQ1RJT05dID0gdHJ1ZVxuICAgIGRlbGV0ZSB0cmFja2VkQ29ubmVjdGlvbltDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXVxuICAgIGRlbGV0ZSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cblxuICAgIGNvbnN0IGNsb3NlUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0cmFja2VkQ29ubmVjdGlvbi5jbG9zZSgpXG4gICAgfSkoKVxuXG4gICAgdGhpcy5jb25uZWN0aW9uQ2xvc2VQcm9taXNlcy5zZXQoY29ubmVjdGlvbiwgY2xvc2VQcm9taXNlKVxuICAgIHRoaXMuaW5mbGlnaHRDb25uZWN0aW9uQ2xvc2VzLmFkZChjbG9zZVByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xvc2VQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRDb25uZWN0aW9uQ2xvc2VzLmRlbGV0ZShjbG9zZVByb21pc2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgaWRsZSBjb25uZWN0aW9uIHJlYXBlciB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIGNsZWFySWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lcigpIHtcbiAgICBpZiAoIXRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lcikgcmV0dXJuXG5cbiAgICBjbGVhclRpbWVvdXQodGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKVxuICAgIHRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhbGwgYWN0aXZlIGFuZCBjYWNoZWQgY29ubmVjdGlvbnMgZm9yIHRoaXMgcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQWxsKCkge1xuICAgIHRoaXMuY2xlYXJJZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKClcbiAgICB0aGlzLnJlamVjdFBlbmRpbmdDaGVja291dHMobmV3IEVycm9yKFwiRGF0YWJhc2UgcG9vbCB3YXMgY2xvc2VkIGJlZm9yZSBjaGVja291dCBjb21wbGV0ZWQuXCIpKVxuXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLnRoaXMuY29ubmVjdGlvbnMsXG4gICAgICAuLi5PYmplY3QudmFsdWVzKHRoaXMuY29ubmVjdGlvbnNJblVzZSksXG4gICAgICAuLi50aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCksXG4gICAgICB0aGlzLmdldEdsb2JhbENvbm5lY3Rpb25Gb3JJZGVudGlmaWVyKCksXG4gICAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKVxuXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IFtdXG4gICAgdGhpcy5jb25uZWN0aW9uc0luVXNlID0ge31cbiAgICB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuY2xlYXIoKVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuY2xlYXIoKVxuICAgIHRoaXMuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgdGhpcy5jbGVhckdsb2JhbENvbm5lY3Rpb25Gb3JJZGVudGlmaWVyKClcblxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykge1xuICAgICAgaWYgKCFjb25uZWN0aW9uKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgIH1cblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVqZWN0IHBlbmRpbmcgY2hlY2tvdXRzLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRvIHJlamVjdCBwZW5kaW5nIGNoZWNrb3V0cyB3aXRoLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlamVjdFBlbmRpbmdDaGVja291dHMoZXJyb3IpIHtcbiAgICBjb25zdCBwZW5kaW5nQ2hlY2tvdXRzID0gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzXG5cbiAgICB0aGlzLnBlbmRpbmdDaGVja291dHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBjaGVja291dCBvZiBwZW5kaW5nQ2hlY2tvdXRzKSB7XG4gICAgICB0aGlzLmNsZWFyUGVuZGluZ0NoZWNrb3V0VGltZW91dChjaGVja291dClcbiAgICAgIGNoZWNrb3V0LnJlamVjdChlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgYWxsIGdsb2JhbGx5IHJlZ2lzdGVyZWQgZmFsbGJhY2sgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBbY29ubmVjdGlvbnNdIC0gQ29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0R2xvYmFsQ29ubmVjdGlvbnMoY29ubmVjdGlvbnMsIGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRoaXMuZ2xvYmFsQ29ubmVjdGlvbnMgPSBuZXcgV2Vha01hcCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmdsb2JhbENvbm5lY3Rpb25zLnNldChjb25maWd1cmF0aW9uLCBjb25uZWN0aW9ucyB8fCB7fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgZ2xvYmFsbHkgcmVnaXN0ZXJlZCBmYWxsYmFjayBjb25uZWN0aW9ucyBmb3IgYWxsIGNvbmZpZ3VyYXRpb25zIG9yIGEgc2luZ2xlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgY2xlYXJHbG9iYWxDb25uZWN0aW9ucyhjb25maWd1cmF0aW9uKSB7XG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB7XG4gICAgICB0aGlzLmdsb2JhbENvbm5lY3Rpb25zID0gbmV3IFdlYWtNYXAoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5nbG9iYWxDb25uZWN0aW9ucy5kZWxldGUoY29uZmlndXJhdGlvbilcbiAgfVxufVxuIl19