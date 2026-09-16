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
        const connectionContextSuppressed = this.asyncLocalStorage.getStore() === SUPPRESSED_CONNECTION_CONTEXT;
        const testSharedConnection = connectionContextSuppressed ? undefined : this.activeTestSharedConnection();
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
     * Resolves a test-shared connection from the per-tenant context providers only.
     * Unlike {@link testSharedConnection}, this never falls back to the pool default or
     * the per-configuration shared connection, so it is safe to consult from
     * `getCurrentConnection` without changing behavior when no per-tenant provider
     * matches (the production case, where the provider list is empty).
     *
     * The provider `matches()` callback may inspect the live tenant context, which is
     * established during route resolution — after the request-runner installs the async
     * connection context. This is what lets a test run enroll more than one tenant on a
     * single pool and route each tenant's in-request queries to its own enrolled
     * connection.
     * @returns {import("../drivers/base.js").default | undefined} - Per-tenant shared connection.
     */
    testSharedConnectionForCurrentTenant() {
        for (const { matches, provider } of this._testSharedConnectionProviders.values()) {
            if (matches())
                return provider();
        }
        return undefined;
    }
    /**
     * Runs get current connection.
     * @returns {import("../drivers/base.js").default} - The current connection.
     */
    getCurrentConnection() {
        this.assertDatabaseAccessAllowed();
        const perTenantConnection = this.testSharedConnectionForCurrentTenant();
        if (perTenantConnection)
            return perTenantConnection;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3Bvb2wvYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDL0MsT0FBTyxRQUFRLEVBQUUsRUFBRSxzQkFBc0IsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUM1RCxPQUFPLGdDQUFnQyxNQUFNLDZCQUE2QixDQUFBO0FBQzFFLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxNQUFNLHVDQUF1QyxDQUFBO0FBRWpGOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsTUFBTSxDQUFDLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLDJCQUEyQixDQUFDLENBQUE7QUFDcEUsTUFBTSw2QkFBNkIsR0FBRyxNQUFNLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtBQUNsRixNQUFNLHlCQUF5QixHQUFHLE1BQU0sQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO0FBQzNFLE1BQU0sNkJBQTZCLEdBQUcsTUFBTSxDQUFDLHNDQUFzQyxDQUFDLENBQUE7QUFDcEYsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUE7QUFDbEMsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLENBQUE7QUFDeEMsTUFBTSwrQkFBK0IsR0FBRyxLQUFLLENBQUE7QUFFN0MsTUFBTSxDQUFDLE9BQU8sT0FBTyxnREFBaUQsU0FBUSxRQUFRO0lBQ3BGOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBRXhDLGlCQUFpQixHQUFHLElBQUksaUJBQWlCLEVBQUUsQ0FBQTtJQUUzQzs7Ozs7T0FLRztJQUNILHFCQUFxQixHQUFHLFNBQVMsQ0FBQTtJQUVqQzs7O09BR0c7SUFDSCw2QkFBNkIs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RUQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLHNCQUFzQixDQUFDLGFBQWE7UUFDekMsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ25CLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO1lBQ3RDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUM5QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQXN5bmNMb2NhbFN0b3JhZ2UgfSBmcm9tIFwiYXN5bmNfaG9va3NcIlxuaW1wb3J0IEJhc2VQb29sLCB7IFBPT0xfQ09ORklHVVJBVElPTl9LRVkgfSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCBEYXRhYmFzZVBvb2xDaGVja291dFRpbWVvdXRFcnJvciBmcm9tIFwiLi9jaGVja291dC10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQgfSBmcm9tIFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGUtY29udGV4dC5qc1wiXG5cbi8qKlxuICogUGVuZGluZ0NoZWNrb3V0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQZW5kaW5nQ2hlY2tvdXRcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZyAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gbmVlZGVkIGJ5IHRoZSBjaGVja291dC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBlbnF1ZXVlZEF0IC0gVGltZXN0YW1wIHdoZW4gdGhlIGNoZWNrb3V0IHN0YXJ0ZWQgd2FpdGluZy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnN9IG9wdGlvbnMgLSBDaGVja291dCBvcHRpb25zLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJldXNlS2V5IC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbiByZXVzZSBrZXkgbmVlZGVkIGJ5IHRoZSBjaGVja291dC5cbiAqIEBwcm9wZXJ0eSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkfSByZXNvbHZlIC0gUmVzb2x2ZXMgd2l0aCBhbiBhY3RpdmF0ZWQgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH0gcmVqZWN0IC0gUmVqZWN0cyB3aGVuIGNoZWNrb3V0IGNhbm5vdCBjb21wbGV0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dEF0IC0gVGltZXN0YW1wIHdoZW4gdGhlIGNoZWNrb3V0IHdpbGwgdGltZSBvdXQsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1pbGxpcyAtIE1pbGxpc2Vjb25kcyB0byB3YWl0IGJlZm9yZSByZWplY3RpbmcsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9IHRpbWVvdXRUaW1lciAtIFRpbWVyIHRoYXQgcmVqZWN0cyB0aGUgcGVuZGluZyBjaGVja291dC5cbiAqIEBwcm9wZXJ0eSB7e3Jldm9rZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkfSBbdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVdIC0gRGF0YWJhc2UtYWNjZXNzIHNjb3BlIGNhcHR1cmVkIGF0IGVucXVldWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gW3Rlc3RQcm9maWxlQ29udGV4dF0gLSBBc3luYy1zYWZlIHByb2ZpbGUgYXR0cmlidXRpb24gY2FwdHVyZWQgYXQgZW5xdWV1ZS5cbiAqL1xuZXhwb3J0IGNvbnN0IENMT1NFRF9DT05ORUNUSU9OID0gU3ltYm9sKFwidmVsb2Npb3VzQ2xvc2VkQ29ubmVjdGlvblwiKVxuY29uc3QgSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVQgPSBTeW1ib2woXCJ2ZWxvY2lvdXNJZGxlQ29ubmVjdGlvbkNoZWNrZWRJbkF0XCIpXG5jb25zdCBDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUID0gU3ltYm9sKFwidmVsb2Npb3VzQ29ubmVjdGlvbkNoZWNrZWRPdXRBdFwiKVxuY29uc3QgU1VQUFJFU1NFRF9DT05ORUNUSU9OX0NPTlRFWFQgPSBTeW1ib2woXCJ2ZWxvY2lvdXNTdXBwcmVzc2VkQ29ubmVjdGlvbkNvbnRleHRcIilcbmNvbnN0IERFRkFVTFRfTUFYX0NPTk5FQ1RJT05TID0gMTBcbmNvbnN0IERFRkFVTFRfSURMRV9USU1FT1VUX01JTExJUyA9IDUwMDBcbmNvbnN0IERFRkFVTFRfQ0hFQ0tPVVRfVElNRU9VVF9NSUxMSVMgPSAxMDAwMFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVBvb2xBc3luY1RyYWNrZWRNdWx0aUNvbm5lY3Rpb24gZXh0ZW5kcyBCYXNlUG9vbCB7XG4gIC8qKlxuICAgKiBHbG9iYWwgZmFsbGJhY2sgY29ubmVjdGlvbnMga2V5ZWQgYnkgY29uZmlndXJhdGlvbiBpbnN0YW5jZSBhbmQgcG9vbCBpZGVudGlmaWVyLlxuICAgKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pj59XG4gICAqL1xuICBzdGF0aWMgZ2xvYmFsQ29ubmVjdGlvbnMgPSBuZXcgV2Vha01hcCgpXG5cbiAgYXN5bmNMb2NhbFN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuXG4gIC8qKlxuICAgKiBXaGVuIHNldCwgcmV0dXJuZWQgYnkgZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uIHdoZW4gbm8gYXN5bmMgY29udGV4dCBleGlzdHMuXG4gICAqIFVzZWQgYnkgdGhlIHRlc3QgcnVubmVyIHRvIHNoYXJlIGEgY29ubmVjdGlvbiBiZXR3ZWVuIHRlc3QgY29kZSBhbmQgSFRUUCBoYW5kbGVyc1xuICAgKiBydW5uaW5nIGluIHRoZSBzYW1lIHByb2Nlc3MgKGluLXByb2Nlc3MgdGVzdCBzZXJ2ZXIgbW9kZSkuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF90ZXN0U2hhcmVkQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEeW5hbWljYWxseSByZXNvbHZlcyB0aGUgY29ubmVjdGlvbiBlbGlnaWJsZSBmb3IgaW4tcHJvY2VzcyB0ZXN0IHJlcXVlc3Qgc2hhcmluZy5cbiAgICogQHR5cGUgeygoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCkgfCB1bmRlZmluZWR9XG4gICAqL1xuICBfdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlciA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBJZGVudGlmaWVzIHRoZSBsaWZlY3ljbGUgdGhhdCBpbnN0YWxsZWQgdGhlIGN1cnJlbnQgc2hhcmVkIGNvbm5lY3Rpb24gb3IgcHJvdmlkZXIuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9XG4gICAqL1xuICBfdGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKiogQXR0ZW1wdC1vd25lZCBzaGFyZWQgY29ubmVjdGlvbnMga2V5ZWQgYnkgcmVzb2x2ZWQgcGh5c2ljYWwgY29uZmlndXJhdGlvbi4gKi9cbiAgX3Rlc3RTaGFyZWRDb25uZWN0aW9uc0J5UmV1c2VLZXkgPSBuZXcgTWFwKClcblxuICAvKipcbiAgICogQ29uY3VycmVudCBwcm92aWRlcnMgc2VsZWN0ZWQgYnkgbGl2ZSBhc3luYyBqb2luIGNvbnRleHQuXG4gICAqIEB0eXBlIHtNYXA8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uLCB7bWF0Y2hlczogKCkgPT4gYm9vbGVhbiwgcHJvdmlkZXI6ICgpID0+IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfT59XG4gICAqL1xuICBfdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcnMgPSBuZXcgTWFwKClcblxuICAvKipcbiAgICogQ29ubmVjdGlvbnMuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdfSAqL1xuICBjb25uZWN0aW9ucyA9IFtdXG5cbiAgLyoqXG4gICAqIFBoeXNpY2FsIGlkZW50aXRpZXMgcmVxdWVzdGVkIHRvIHJlbWFpbiByZXNpZGVudCBieSB0aGUgZnJvbnRlbmQgdGVuYW50IGxpZmVjeWNsZS5cbiAgICogQHR5cGUge1NldDxzdHJpbmc+fVxuICAgKi9cbiAgbGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMgPSBuZXcgU2V0KClcblxuICAvKipcbiAgICogUGFya2VkIGxpZmVjeWNsZS1vd25lZCBjb25uZWN0aW9ucyBrZXllZCBieSBwaHlzaWNhbCBpZGVudGl0eS5cbiAgICogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn1cbiAgICovXG4gIGxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMgPSBuZXcgTWFwKClcblxuICAvKipcbiAgICogQ29ubmVjdGlvbnMgaW4gdXNlLlxuICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciwgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBjb25uZWN0aW9uc0luVXNlID0ge31cblxuICAvKipcbiAgICogUGVuZGluZyBjaGVja291dHMuXG4gICAqIEB0eXBlIHtQZW5kaW5nQ2hlY2tvdXRbXX0gKi9cbiAgcGVuZGluZ0NoZWNrb3V0cyA9IFtdXG5cbiAgLyoqXG4gICAqIENvbm5lY3Rpb25zIGJlaW5nIHNwYXduZWQuXG4gICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gIGNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkID0gMFxuXG4gIC8qKlxuICAgKiBQZW5kaW5nIGNoZWNrb3V0IGRyYWluIHByb21pc2UuXG4gICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICBwZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UgPSB1bmRlZmluZWRcblxuICAvKiogV2hldGhlciBhIGNhbGxlciByZXF1ZXN0ZWQgYW5vdGhlciBwYXNzIHRocm91Z2ggdGhlIHBlbmRpbmcgY2hlY2tvdXQgcXVldWUuICovXG4gIHBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkID0gZmFsc2VcblxuICAvKipcbiAgICogSWRsZSBjb25uZWN0aW9uIHJlYXBlciB0aW1lci5cbiAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICBpZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEluLWZsaWdodCBjb25uZWN0aW9uLWNsb3NlIHByb21pc2VzLiBUaGUgaWRsZSByZWFwZXIgaXMgYXJtZWQgb24gY2hlY2staW5cbiAgICogYW5kIHJ1bnMgZmlyZS1hbmQtZm9yZ2V0IHdoZW4gaXRzIHRpbWVyIGZpcmVzLCBzbyBhIHNjaGVkdWxlZCByZWFwIGNhbiBiZVxuICAgKiBjbG9zaW5nIGEgY29ubmVjdGlvbiB3aGlsZSBhbiBleHBsaWNpdCBgcmVhcElkbGVDb25uZWN0aW9ucygpYCAob3JcbiAgICogYGNsZWFySWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lcigpYCkgcnVucy4gVHJhY2tpbmcgdGhlIGluLWZsaWdodCBjbG9zZXMgbGV0c1xuICAgKiB0aG9zZSBjYWxsZXJzIGF3YWl0IHRoZW0sIHNvIG9uY2UgYSByZWFwIHJlc29sdmVzIHRoZSBjb25uZWN0aW9ucyBpdFxuICAgKiBleHBpcmVkIGFyZSBmdWxseSBjbG9zZWQgaW5zdGVhZCBvZiBoYWxmLWNsb3NlZCBtaWQtYGNsb3NlKClgLlxuICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgKi9cbiAgaW5mbGlnaHRDb25uZWN0aW9uQ2xvc2VzID0gbmV3IFNldCgpXG5cbiAgLyoqXG4gICAqIEluLWZsaWdodCBjbG9zZSBwcm9taXNlIHBlciBjb25uZWN0aW9uLCBzbyBjb25jdXJyZW50IGNsb3NlcyBvZiB0aGUgc2FtZVxuICAgKiBjb25uZWN0aW9uIGF3YWl0IHRoZSBzYW1lIGNsb3NlIHJhdGhlciB0aGFuIGNsb3NpbmcgdGhlIGRyaXZlciBoYW5kbGUgdHdpY2UuXG4gICAqIEB0eXBlIHtXZWFrTWFwPG9iamVjdCwgUHJvbWlzZTx2b2lkPj59XG4gICAqL1xuICBjb25uZWN0aW9uQ2xvc2VQcm9taXNlcyA9IG5ldyBXZWFrTWFwKClcblxuICAvKiogQ3VtdWxhdGl2ZSBsb3ctY2FyZGluYWxpdHkgcG9vbCB0ZWxlbWV0cnkuICovXG4gIHRlbGVtZXRyeSA9IHtcbiAgICBjb25uZWN0aW9uQ3JlYXRpb25Db3VudDogMCxcbiAgICBjb25uZWN0aW9uQ3JlYXRpb25GYWlsdXJlQ291bnQ6IDAsXG4gICAgY29ubmVjdGlvbkNyZWF0aW9uTWF4TXM6IDAsXG4gICAgY29ubmVjdGlvbkNyZWF0aW9uVG90YWxNczogMCxcbiAgICBjaGVja291dFRpbWVvdXRDb3VudDogMCxcbiAgICBjaGVja291dFdhaXRDb3VudDogMCxcbiAgICBjaGVja291dFdhaXRNYXhNczogMCxcbiAgICBjaGVja291dFdhaXRUb3RhbE1zOiAwLFxuICAgIGlkbGVSZWFwQ291bnQ6IDAsXG4gICAgaWRsZVJlYXBEaXNwb3NhbENvdW50OiAwLFxuICAgIGlkbGVSZWFwRmFpbHVyZUNvdW50OiAwLFxuICAgIGlkbGVSZWFwTWF4TXM6IDAsXG4gICAgaWRsZVJlYXBUb3RhbE1zOiAwLFxuICAgIHBlYWtMaXZlQ29ubmVjdGlvbnM6IDBcbiAgfVxuXG4gIGlkU2VxID0gMFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWRlbnRpZmllciAtIElkZW50aWZpZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaWRlbnRpZmllcn0pIHtcbiAgICBzdXBlcih7Y29uZmlndXJhdGlvbiwgaWRlbnRpZmllcn0pXG4gICAgLyoqXG4gICAgICogUnVucyBhIGNhbGxiYWNrIHdpdGhvdXQgdGhlIGluaGVyaXRlZCBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICAgKiBAdHlwZSB7KGNhbGxiYWNrOiAoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59XG4gICAgICovXG4gICAgY29uc3Qgd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dCA9IChjYWxsYmFjaykgPT4gdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5ydW4oU1VQUFJFU1NFRF9DT05ORUNUSU9OX0NPTlRFWFQsIGNhbGxiYWNrKVxuICAgIHRoaXMuX3dpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQgPSB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcG9vbCB0ZWxlbWV0cnkgY2xvY2suXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQ3VycmVudCB0aW1lIGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vd01zKCkgeyByZXR1cm4gRGF0ZS5ub3coKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBwb29sIG1ldHJpYyBpbiB0aGUgYWN0aXZlIGFzeW5jLXNhZmUgdGVzdCBwcm9maWxlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBjb250ZXh0IC0gQ2FwdHVyZWQgcHJvZmlsZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1wiY29ubmVjdGlvbkNyZWF0aW9uXCIgfCBcImNoZWNrb3V0V2FpdFwiIHwgXCJjaGVja291dFRpbWVvdXRcIiB8IFwiaWRsZVJlYXBcIiB8IFwiaWRsZVJlYXBEaXNwb3NhbFwiIHwgXCJwZWFrTGl2ZUNvbm5lY3Rpb25zXCJ9IG1ldHJpYyAtIE1ldHJpYyBuYW1lLlxuICAgKiBAcGFyYW0ge3tkdXJhdGlvbk1zPzogbnVtYmVyLCBmYWlsZWQ/OiBib29sZWFuLCB2YWx1ZT86IG51bWJlcn19IFt2YWx1ZXNdIC0gQWdncmVnYXRlIHZhbHVlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMoY29udGV4dCwgbWV0cmljLCB2YWx1ZXMgPSB7fSkge1xuICAgIGlmICghY29udGV4dCkgcmV0dXJuXG5cbiAgICBjb250ZXh0LnByb2ZpbGVyLnJlY29yZFBvb2xNZXRyaWMoY29udGV4dCwgdGhpcy5pZGVudGlmaWVyLCBtZXRyaWMsIHZhbHVlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGF3bnMgYW5kIHRpbWVzIGEgcGh5c2ljYWwgY29ubmVjdGlvbiB3aXRob3V0IHJldGFpbmluZyBpdHMgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGNvbmZpZyAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbcmV1c2VLZXldIC0gRXhhY3QgcmVzb2x2ZWQgcGh5c2ljYWwgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBDb25uZWN0ZWQgZHJpdmVyLlxuICAgKi9cbiAgYXN5bmMgc3Bhd25Db25uZWN0aW9uV2l0aENvbmZpZ3VyYXRpb24oY29uZmlnLCByZXVzZUtleSkge1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IHRoaXMubm93TXMoKVxuICAgIGNvbnN0IHByb2ZpbGVDb250ZXh0ID0gY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgc3VwZXIuc3Bhd25Db25uZWN0aW9uV2l0aENvbmZpZ3VyYXRpb24oY29uZmlnLCByZXVzZUtleSlcblxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGxpdmVDb25uZWN0aW9uQ291bnQgPSB0aGlzLmxpdmVDb25uZWN0aW9uQ291bnQoKSAtIHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWQgKyAxXG5cbiAgICAgIGlmIChsaXZlQ29ubmVjdGlvbkNvdW50ID4gdGhpcy50ZWxlbWV0cnkucGVha0xpdmVDb25uZWN0aW9ucykge1xuICAgICAgICB0aGlzLnRlbGVtZXRyeS5wZWFrTGl2ZUNvbm5lY3Rpb25zID0gbGl2ZUNvbm5lY3Rpb25Db3VudFxuICAgICAgICB0aGlzLnJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhwcm9maWxlQ29udGV4dCwgXCJwZWFrTGl2ZUNvbm5lY3Rpb25zXCIsIHt2YWx1ZTogbGl2ZUNvbm5lY3Rpb25Db3VudH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb25uZWN0aW9uXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBNYXRoLm1heCgwLCB0aGlzLm5vd01zKCkgLSBzdGFydGVkQXQpXG5cbiAgICAgIHRoaXMudGVsZW1ldHJ5LmNvbm5lY3Rpb25DcmVhdGlvbkNvdW50KytcbiAgICAgIGlmIChmYWlsZWQpIHRoaXMudGVsZW1ldHJ5LmNvbm5lY3Rpb25DcmVhdGlvbkZhaWx1cmVDb3VudCsrXG4gICAgICB0aGlzLnRlbGVtZXRyeS5jb25uZWN0aW9uQ3JlYXRpb25Ub3RhbE1zICs9IGR1cmF0aW9uTXNcbiAgICAgIHRoaXMudGVsZW1ldHJ5LmNvbm5lY3Rpb25DcmVhdGlvbk1heE1zID0gTWF0aC5tYXgodGhpcy50ZWxlbWV0cnkuY29ubmVjdGlvbkNyZWF0aW9uTWF4TXMsIGR1cmF0aW9uTXMpXG4gICAgICB0aGlzLnJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhwcm9maWxlQ29udGV4dCwgXCJjb25uZWN0aW9uQ3JlYXRpb25cIiwge2R1cmF0aW9uTXMsIGZhaWxlZH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2hlY2tpbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIERhdGFiYXNlIGNvbm5lY3Rpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvbm5lY3Rpb24gaXMgY2hlY2tlZCBpbiBvciBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBjaGVja2luKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBpZCA9IGNvbm5lY3Rpb24uZ2V0SWRTZXEoKVxuICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbQ0xPU0VEX0NPTk5FQ1RJT05dPzogYm9vbGVhbiwgW0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdPzogbnVtYmVyLCBbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG5cbiAgICBpZiAodHJhY2tlZENvbm5lY3Rpb25bQ0xPU0VEX0NPTk5FQ1RJT05dKSB7XG4gICAgICBpZiAodHlwZW9mIGlkID09PSBcIm51bWJlclwiKSB0aGlzLnVudHJhY2tDb25uZWN0aW9uSW5Vc2UoY29ubmVjdGlvbiwgaWQpXG4gICAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja0xlZnRPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbilcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKClcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKClcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xlYW51cFNlc3Npb25TdGF0ZUFmdGVyQ2hlY2tvdXQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlQ2hlY2tlZE91dENvbm5lY3Rpb25BZnRlckNoZWNraW5GYWlsdXJlKGNvbm5lY3Rpb24sIGlkLCBlcnJvcilcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgdGhpcy51bnRyYWNrQ29ubmVjdGlvbkluVXNlKGNvbm5lY3Rpb24sIGlkKVxuICAgIGRlbGV0ZSB0cmFja2VkQ29ubmVjdGlvbltDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXVxuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pXG5cbiAgICBpZiAodGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5oYXMocmV1c2VLZXkpKSB7XG4gICAgICBjb25zdCByZXRhaW5lZENvbm5lY3Rpb24gPSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuZ2V0KHJldXNlS2V5KVxuXG4gICAgICBpZiAoIXJldGFpbmVkQ29ubmVjdGlvbiB8fCByZXRhaW5lZENvbm5lY3Rpb24gPT09IGNvbm5lY3Rpb24gfHwgcmV0YWluZWRDb25uZWN0aW9uLmdldElkU2VxKCkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgdHJhY2tlZENvbm5lY3Rpb25bSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdXG4gICAgICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5zZXQocmV1c2VLZXksIGNvbm5lY3Rpb24pXG4gICAgICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgdHJhY2tlZENvbm5lY3Rpb25bSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdID0gRGF0ZS5ub3coKVxuICAgIHRoaXMuY29ubmVjdGlvbnMucHVzaChjb25uZWN0aW9uKVxuICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKClcbiAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5pbmNsdWRlcyhjb25uZWN0aW9uKSkgYXdhaXQgdGhpcy5oYW5kbGVDaGVja2VkSW5JZGxlQ29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUGVybWFuZW50bHkgcmVtb3ZlcyBhbmQgY2xvc2VzIGEgY2hlY2tlZC1vdXQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gdGhhdCBtdXN0IG5vdCByZXR1cm4gdG8gdGhlIHBvb2wuXG4gICAqL1xuICBhc3luYyBkaXNjYXJkKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBpZCA9IGNvbm5lY3Rpb24uZ2V0SWRTZXEoKVxuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICB0aGlzLnVudHJhY2tDb25uZWN0aW9uSW5Vc2UoY29ubmVjdGlvbiwgaWQpXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgIH1cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBkaXNjYXJkIGEgZGF0YWJhc2UgY29ubmVjdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UgY2hlY2tlZCBvdXQgY29ubmVjdGlvbiBhZnRlciBjaGVja2luIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRoYXQgZmFpbGVkIGNoZWNrLWluIGNsZWFudXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBpZCAtIENvbm5lY3Rpb24gY2hlY2tvdXQgaWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG9yaWdpbmFsRXJyb3IgLSBFcnJvciB0aGF0IGNhdXNlZCBjaGVjay1pbiBjbGVhbnVwIHRvIGZhaWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBoYXMgYmVlbiBhdHRlbXB0ZWQuXG4gICAqL1xuICBhc3luYyBjbG9zZUNoZWNrZWRPdXRDb25uZWN0aW9uQWZ0ZXJDaGVja2luRmFpbHVyZShjb25uZWN0aW9uLCBpZCwgb3JpZ2luYWxFcnJvcikge1xuICAgIHRoaXMudW50cmFja0Nvbm5lY3Rpb25JblVzZShjb25uZWN0aW9uLCBpZClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHRvIGNsb3NlIGRhdGFiYXNlIGNvbm5lY3Rpb24gYWZ0ZXIgY2hlY2staW4gY2xlYW51cCBmYWlsZWRcIiwge2Vycm9yLCBvcmlnaW5hbEVycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHRvIGRyYWluIHBlbmRpbmcgZGF0YWJhc2UgY2hlY2tvdXRzIGFmdGVyIGNoZWNrLWluIGNsZWFudXAgZmFpbGVkXCIsIHtlcnJvciwgb3JpZ2luYWxFcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW50cmFjayBjb25uZWN0aW9uIGluIHVzZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gYmVpbmcgY2hlY2tlZCBpbi5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IGlkIC0gQ29ubmVjdGlvbiBjaGVja291dCBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnRyYWNrQ29ubmVjdGlvbkluVXNlKGNvbm5lY3Rpb24sIGlkKSB7XG4gICAgaWYgKHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBpZFNlcSBvbiBjb25uZWN0aW9uIHdhc24ndCBzZXQ/ICcke3R5cGVvZiBpZH0nID0gJHtpZH1gKVxuICAgIH1cblxuICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25zSW5Vc2VbaWRdXG4gICAgY29ubmVjdGlvbi5zZXRJZFNlcSh1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgY2hlY2tlZCBpbiBpZGxlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgaWRsZSByZWFwaW5nIGhhcyBiZWVuIHNjaGVkdWxlZCBvciBydW4uXG4gICAqL1xuICBhc3luYyBoYW5kbGVDaGVja2VkSW5JZGxlQ29ubmVjdGlvbigpIHtcbiAgICBpZiAodGhpcy5pZGxlVGltZW91dE1pbGxpcygpID09PSAwKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlYXBJZGxlQ29ubmVjdGlvbnMoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnNjaGVkdWxlSWRsZUNvbm5lY3Rpb25SZWFwZXIoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbb3B0aW9uc10gLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2hlY2tvdXQuXG4gICAqL1xuICBhc3luYyBjaGVja291dChvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgbGV0IGRhdGFiYXNlQ29uZmlnID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBsZXQgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZylcbiAgICBsZXQgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpXG5cbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMpXG5cbiAgICBhd2FpdCB0aGlzLnJlYXBJZGxlQ29ubmVjdGlvbnMoKVxuICAgIGRhdGFiYXNlQ29uZmlnID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlnKVxuICAgIGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KVxuXG4gICAgaWYgKGNvbm5lY3Rpb24pIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zKVxuXG4gICAgaWYgKHRoaXMuY2FuU3Bhd25Db25uZWN0aW9uKGRhdGFiYXNlQ29uZmlnKSkge1xuICAgICAgLy8gVGhlIHBvc3QtcmVhcCBjb25maWd1cmF0aW9uIGlzIGZyZXNoIGZvciB0aGUgY3VycmVudCBjYWxsZXIsIGFuZCBpdHMgcmV1c2Uga2V5IGlzXG4gICAgICAvLyBkZXJpdmVkIGZyb20gdGhpcyBleGFjdCBjYXB0dXJlZCBvYmplY3Qgc28gdGhlIGNvbm5lY3Rpb24gY2Fubm90IG9wZW4gb25lIHRlbmFudCB3aGlsZVxuICAgICAgLy8gYmVpbmcgc3RhbXBlZCBmb3IgYW5vdGhlci4gVGhlIHF1ZXVlZCBwYXRoIHJldGFpbnMgdGhlIHNhbWUgY2FwdHVyZWQgcGFpci5cbiAgICAgIGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbkZvckNoZWNrb3V0KFxuICAgICAgICBkYXRhYmFzZUNvbmZpZyxcbiAgICAgICAgcmV1c2VLZXksXG4gICAgICAgIGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuICAgICAgKVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53YWl0Rm9yQ2hlY2tvdXQoZGF0YWJhc2VDb25maWcsIHJldXNlS2V5LCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBvdXQgYSBjb25uZWN0aW9uIGZvciBhbiBhbHJlYWR5LXJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb25cbiAgICogd2l0aG91dCBjb25zdWx0aW5nIGFtYmllbnQgdGVuYW50IHN0YXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWcgLSBDYXB0dXJlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbb3B0aW9uc10gLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gQWN0aXZhdGVkIHBvb2xlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlnLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZylcbiAgICBjb25zdCBsaWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb24gPSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuZ2V0KHJldXNlS2V5KVxuXG4gICAgaWYgKGxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbiAmJiBsaWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb24uZ2V0SWRTZXEoKSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24obGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9uLCBvcHRpb25zKVxuICAgIH1cblxuICAgIGxldCBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShyZXVzZUtleSlcblxuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucylcblxuICAgIGF3YWl0IHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpXG4gICAgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpXG5cbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMpXG5cbiAgICBpZiAodGhpcy5jYW5TcGF3bkNvbm5lY3Rpb24oZGF0YWJhc2VDb25maWcpKSB7XG4gICAgICBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5zcGF3bkNvbm5lY3Rpb25Gb3JDaGVja291dChcbiAgICAgICAgZGF0YWJhc2VDb25maWcsXG4gICAgICAgIHJldXNlS2V5LFxuICAgICAgICBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcbiAgICAgIClcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2FpdEZvckNoZWNrb3V0KGRhdGFiYXNlQ29uZmlnLCByZXVzZUtleSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRha2UgaWRsZSBjb25uZWN0aW9uIGZvciByZXVzZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pbmNsdWRlT3BlblRyYW5zYWN0aW9uc10gLSBXaGV0aGVyIGNvbm5lY3Rpb25zIHdpdGggb3BlbiB0cmFuc2FjdGlvbnMgbWF5IGJlIHJldHVybmVkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gTWF0Y2hpbmcgaWRsZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgdGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXksIHtpbmNsdWRlT3BlblRyYW5zYWN0aW9ucyA9IHRydWV9ID0ge30pIHtcbiAgICBjb25zdCBjb25uZWN0aW9uSW5kZXggPSB0aGlzLmNvbm5lY3Rpb25zLmZpbmRJbmRleCgocXVldWVkQ29ubmVjdGlvbikgPT4ge1xuICAgICAgaWYgKCFpbmNsdWRlT3BlblRyYW5zYWN0aW9ucyAmJiB0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24ocXVldWVkQ29ubmVjdGlvbikpIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uTWF0Y2hlc1JldXNlS2V5KHF1ZXVlZENvbm5lY3Rpb24sIHJldXNlS2V5KVxuICAgIH0pXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25JbmRleCA9PT0gLTEgPyB1bmRlZmluZWQgOiB0aGlzLmNvbm5lY3Rpb25zLnNwbGljZShjb25uZWN0aW9uSW5kZXgsIDEpWzBdXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdGlvbiBtYXRjaGVzIHJldXNlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIG1hdGNoZXMgdGhlIHJldXNlIGtleS5cbiAgICovXG4gIGNvbm5lY3Rpb25NYXRjaGVzUmV1c2VLZXkoY29ubmVjdGlvbiwgcmV1c2VLZXkpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uV2l0aFBvb2xLZXkgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tQT09MX0NPTkZJR1VSQVRJT05fS0VZXT86IHN0cmluZ319ICovIChjb25uZWN0aW9uKVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25XaXRoUG9vbEtleVtQT09MX0NPTkZJR1VSQVRJT05fS0VZXSA9PT0gcmV1c2VLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjdGl2YXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbb3B0aW9uc10gLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gQWN0aXZhdGVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyBhY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZVJlamVjdGVkQ2hlY2tvdXRBbmRUaHJvdyhjb25uZWN0aW9uLCBlcnJvcilcbiAgICB9XG4gICAgaWYgKGNvbm5lY3Rpb24uZ2V0SWRTZXEoKSAhPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYENvbm5lY3Rpb24gYWxyZWFkeSBoYXMgYW4gSUQtc2VxIC0gaXMgaXQgaW4gdXNlPyAke2Nvbm5lY3Rpb24uZ2V0SWRTZXEoKX1gKVxuXG4gICAgY29uc3QgaWQgPSB0aGlzLmlkU2VxKytcblxuICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF0/OiBudW1iZXIsIFtJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF0/OiBudW1iZXJ9fSAqLyAoY29ubmVjdGlvbilcbiAgICBkZWxldGUgdHJhY2tlZENvbm5lY3Rpb25bSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdXG4gICAgdHJhY2tlZENvbm5lY3Rpb25bQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF0gPSBEYXRlLm5vdygpXG5cbiAgICBjb25uZWN0aW9uLnNldElkU2VxKGlkKVxuICAgIHRoaXMuY29ubmVjdGlvbnNJblVzZVtpZF0gPSBjb25uZWN0aW9uXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5zZXRDb25uZWN0aW9uQ2hlY2tvdXROYW1lKG9wdGlvbnMubmFtZSlcbiAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZVJlamVjdGVkQ2hlY2tvdXRBbmRUaHJvdyhjb25uZWN0aW9uLCBlcnJvciwgaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYSByZWplY3RlZCBjaGVja291dCwgdGhlbiBoYW5kcyBmcmVlZCBjYXBhY2l0eSB0byBxdWV1ZWQgY2FsbGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFJlamVjdGVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gQWNjZXNzIHJldm9jYXRpb24gZXJyb3IuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbaWRdIC0gQXNzaWduZWQgY2hlY2tvdXQgaWQsIGlmIGFjdGl2YXRpb24gcmVhY2hlZCB0aGF0IHN0YWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxuZXZlcj59IC0gQWx3YXlzIHJlamVjdHMgd2l0aCB0aGUgYWNjZXNzIG9yIGNsZWFudXAgZXJyb3JzLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VSZWplY3RlZENoZWNrb3V0QW5kVGhyb3coY29ubmVjdGlvbiwgZXJyb3IsIGlkKSB7XG4gICAgaWYgKGlkICE9PSB1bmRlZmluZWQpIHRoaXMudW50cmFja0Nvbm5lY3Rpb25JblVzZShjb25uZWN0aW9uLCBpZClcblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT5bXX0gKi9cbiAgICBjb25zdCBjbGVhbnVwRXJyb3JzID0gW11cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgIGNsZWFudXBFcnJvcnMucHVzaChjbG9zZUVycm9yKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblJlcXVlc3RlZCA9IHRydWVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChkcmFpbkVycm9yKSB7XG4gICAgICBjbGVhbnVwRXJyb3JzLnB1c2goZHJhaW5FcnJvcilcbiAgICB9XG5cbiAgICBpZiAoY2xlYW51cEVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCAuLi5jbGVhbnVwRXJyb3JzXSwgXCJEYXRhYmFzZSBjaGVja291dCByZWplY3Rpb24gY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1heCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IFtkYXRhYmFzZUNvbmZpZ10gLSBDb25maWd1cmF0aW9uIHdob3NlIHBvb2wgbWF4aW11bSBhcHBsaWVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBDb25maWd1cmVkIG1heCBsaXZlIGNvbm5lY3Rpb25zLlxuICAgKi9cbiAgbWF4Q29ubmVjdGlvbnMoZGF0YWJhc2VDb25maWcgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSkge1xuICAgIGNvbnN0IHZhbHVlID0gZGF0YWJhc2VDb25maWcucG9vbD8ubWF4XG5cbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHRoaXMudmFsaWRNYXhDb25uZWN0aW9ucyh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIERFRkFVTFRfTUFYX0NPTk5FQ1RJT05TXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGVja291dCB0aW1lb3V0IG1pbGxpcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IFtkYXRhYmFzZUNvbmZpZ10gLSBDb25maWd1cmF0aW9uIHdob3NlIHRpbWVvdXQgYXBwbGllcy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUGVuZGluZyBjaGVja291dCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICAgKi9cbiAgY2hlY2tvdXRUaW1lb3V0TWlsbGlzKGRhdGFiYXNlQ29uZmlnID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkpIHtcbiAgICBjb25zdCB2YWx1ZSA9IGRhdGFiYXNlQ29uZmlnLnBvb2w/LmNoZWNrb3V0VGltZW91dE1pbGxpc1xuXG4gICAgaWYgKHZhbHVlID09PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICh0aGlzLnZhbGlkQ2hlY2tvdXRUaW1lb3V0TWlsbGlzKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gREVGQVVMVF9DSEVDS09VVF9USU1FT1VUX01JTExJU1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWQgY2hlY2tvdXQgdGltZW91dCBtaWxsaXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGNoZWNrb3V0IHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBudW1iZXJ9IC0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSB2YWxpZCB0aW1lb3V0LlxuICAgKi9cbiAgdmFsaWRDaGVja291dFRpbWVvdXRNaWxsaXModmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPj0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWQgbWF4IGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBtYXggY29ubmVjdGlvbiBjb3VudC5cbiAgICogQHJldHVybnMge3ZhbHVlIGlzIG51bWJlcn0gLSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIHZhbGlkIG1heCBjb25uZWN0aW9uIGNvdW50LlxuICAgKi9cbiAgdmFsaWRNYXhDb25uZWN0aW9ucyh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+PSAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaXZlIGNvbm5lY3Rpb24gY291bnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIGxpdmUgYW5kIGluLXByb2dyZXNzIGNvbm5lY3Rpb25zLlxuICAgKi9cbiAgbGl2ZUNvbm5lY3Rpb25Db3VudCgpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IG5ldyBTZXQoW1xuICAgICAgLi4udGhpcy5jb25uZWN0aW9ucyxcbiAgICAgIC4uLk9iamVjdC52YWx1ZXModGhpcy5jb25uZWN0aW9uc0luVXNlKSxcbiAgICAgIC4uLnRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy52YWx1ZXMoKSxcbiAgICAgIHRoaXMuZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKVxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25zLnNpemUgKyB0aGlzLmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYW4gc3Bhd24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IFtkYXRhYmFzZUNvbmZpZ10gLSBDb25maWd1cmF0aW9uIHdob3NlIHBvb2wgbWF4aW11bSBhcHBsaWVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGEgbmV3IGNvbm5lY3Rpb24gY2FuIGJlIHNwYXduZWQuXG4gICAqL1xuICBjYW5TcGF3bkNvbm5lY3Rpb24oZGF0YWJhc2VDb25maWcgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSkge1xuICAgIGNvbnN0IG1heENvbm5lY3Rpb25zID0gdGhpcy5tYXhDb25uZWN0aW9ucyhkYXRhYmFzZUNvbmZpZylcblxuICAgIHJldHVybiBtYXhDb25uZWN0aW9ucyA9PT0gbnVsbCB8fCB0aGlzLmxpdmVDb25uZWN0aW9uQ291bnQoKSA8IG1heENvbm5lY3Rpb25zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcGF3biBjb25uZWN0aW9uIGZvciBjaGVja291dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlnIC0gUmVzb2x2ZWQgZGF0YWJhc2UgY29uZmlnIGZvciB0aGUgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5IGZvciB0aGUgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBwcm9maWxlQ29udGV4dCAtIFByb2ZpbGUgY29udGV4dCBjYXB0dXJlZCB3aGVuIGNoZWNrb3V0IGJlZ2FuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gU3Bhd25lZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3Bhd25Db25uZWN0aW9uRm9yQ2hlY2tvdXQoZGF0YWJhc2VDb25maWcsIHJldXNlS2V5LCBwcm9maWxlQ29udGV4dCkge1xuICAgIHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWQrK1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5ydW5XaXRoVGVzdFByb2ZpbGVDb250ZXh0KHByb2ZpbGVDb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbldpdGhDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlnLCB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZykpXG4gICAgICB9KVxuXG4gICAgICB0aGlzLnN0YW1wQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uLCByZXVzZUtleSlcblxuICAgICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZC0tXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2FpdCBmb3IgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZyAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZyBmb3IgdGhlIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBEYXRhYmFzZSBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gW29wdGlvbnNdIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggYW4gYWN0aXZhdGVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyB3YWl0Rm9yQ2hlY2tvdXQoZGF0YWJhc2VDb25maWcsIHJldXNlS2V5LCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgZW5xdWV1ZWRBdCA9IERhdGUubm93KClcbiAgICAgIGNvbnN0IHRpbWVvdXRNaWxsaXMgPSB0aGlzLmNoZWNrb3V0VGltZW91dE1pbGxpcyhkYXRhYmFzZUNvbmZpZylcbiAgICAgIC8qKiBAdHlwZSB7UGVuZGluZ0NoZWNrb3V0fSAqL1xuICAgICAgY29uc3QgY2hlY2tvdXQgPSB7XG4gICAgICAgIGRhdGFiYXNlQ29uZmlnLFxuICAgICAgICBlbnF1ZXVlZEF0LFxuICAgICAgICBvcHRpb25zLFxuICAgICAgICByZWplY3QsXG4gICAgICAgIHJlc29sdmUsXG4gICAgICAgIHJldXNlS2V5LFxuICAgICAgICB0aW1lb3V0QXQ6IHRpbWVvdXRNaWxsaXMgPT09IG51bGwgPyBudWxsIDogZW5xdWV1ZWRBdCArIHRpbWVvdXRNaWxsaXMsXG4gICAgICAgIHRpbWVvdXRNaWxsaXMsXG4gICAgICAgIHRpbWVvdXRUaW1lcjogdW5kZWZpbmVkLFxuICAgICAgICB0ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZTogdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmN1cnJlbnRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSgpLFxuICAgICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuICAgICAgfVxuXG4gICAgICBjaGVja291dC50aW1lb3V0VGltZXIgPSB0aGlzLnN0YXJ0UGVuZGluZ0NoZWNrb3V0VGltZW91dChjaGVja291dClcbiAgICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0cy5wdXNoKGNoZWNrb3V0KVxuICAgICAgdm9pZCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBjb25zdCBjaGVja291dEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGRyYWluIHBlbmRpbmcgZGF0YWJhc2UgY29ubmVjdGlvbiBjaGVja291dHMuXCIsIHtjYXVzZTogZXJyb3J9KVxuXG4gICAgICAgIHRoaXMucmVqZWN0UGVuZGluZ0NoZWNrb3V0cyhjaGVja291dEVycm9yKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gcGVuZGluZyBjaGVja291dHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcGVuZGluZyBjaGVja291dHMgaGF2ZSBiZWVuIGRyYWluZWQgYXMgZmFyIGFzIHBvc3NpYmxlLlxuICAgKi9cbiAgYXN5bmMgZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKCkge1xuICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQgPSB0cnVlXG5cbiAgICBpZiAoIXRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlKSB0aGlzLnN0YXJ0UGVuZGluZ0NoZWNrb3V0RHJhaW4oKVxuICAgIGF3YWl0IHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHRoZSBzaW5nbGUgY2hlY2tvdXQtZHJhaW4gb3duZXIuIFRoZSBzaGFyZWQgcHJvbWlzZSBpcyBjbGVhcmVkIGJlZm9yZVxuICAgKiBpdCBzZXR0bGVzLCBjbG9zaW5nIHRoZSByZXNvbHZlZC1wcm9taXNlL3N0YWxlLWZpZWxkIGludGVydmFsIGluIHdoaWNoIGEgbmV3XG4gICAqIHJlcXVlc3QgY291bGQgb3RoZXJ3aXNlIGJlIGxvc3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhcnRQZW5kaW5nQ2hlY2tvdXREcmFpbigpIHtcbiAgICBjb25zdCB7cHJvbWlzZSwgcmVqZWN0LCByZXNvbHZlfSA9IFByb21pc2Uud2l0aFJlc29sdmVycygpXG5cbiAgICB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZSA9IHByb21pc2VcbiAgICB2b2lkIHRoaXMucnVuUmVxdWVzdGVkUGVuZGluZ0NoZWNrb3V0RHJhaW5zKHtyZWplY3QsIHJlc29sdmV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gcGFzc2VzIHVudGlsIGV2ZXJ5IHJlcXVlc3Qgb2JzZXJ2ZWQgZHVyaW5nIHRoZSBhY3RpdmUgcGFzcyBoYXNcbiAgICogcmVjZWl2ZWQgYSBsYXRlciBwYXNzLlxuICAgKiBAcGFyYW0ge3tyZWplY3Q6IChyZWFzb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCwgcmVzb2x2ZTogKHZhbHVlPzogdm9pZCkgPT4gdm9pZH19IGRlZmVycmVkIC0gU2hhcmVkIGRyYWluIHNldHRsZW1lbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcnVuUmVxdWVzdGVkUGVuZGluZ0NoZWNrb3V0RHJhaW5zKHtyZWplY3QsIHJlc29sdmV9KSB7XG4gICAgdHJ5IHtcbiAgICAgIHdoaWxlICh0aGlzLnBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkKSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQgPSBmYWxzZVxuICAgICAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0c0FjdHVhbCgpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICByZWplY3QoZXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gcGVuZGluZyBjaGVja291dHMgYWN0dWFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHBlbmRpbmcgY2hlY2tvdXRzIGhhdmUgYmVlbiBkcmFpbmVkIGFzIGZhciBhcyBwb3NzaWJsZS5cbiAgICovXG4gIGFzeW5jIGRyYWluUGVuZGluZ0NoZWNrb3V0c0FjdHVhbCgpIHtcbiAgICB3aGlsZSAodGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLnJlc29sdmVQZW5kaW5nQ2hlY2tvdXRXaXRoTWF0Y2hpbmdJZGxlQ29ubmVjdGlvbigpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjaGVja291dCA9IHRoaXMucGVuZGluZ0NoZWNrb3V0c1swXVxuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5jbG9zZUlkbGVDb25uZWN0aW9uRm9yUGVuZGluZ0NoZWNrb3V0Q2FwYWNpdHkoY2hlY2tvdXQpKSBjb250aW51ZVxuICAgICAgaWYgKCF0aGlzLnBlbmRpbmdDaGVja291dHMuaW5jbHVkZXMoY2hlY2tvdXQpKSBjb250aW51ZVxuICAgICAgaWYgKHRoaXMuY2FuU3Bhd25Db25uZWN0aW9uKGNoZWNrb3V0LmRhdGFiYXNlQ29uZmlnKSkge1xuICAgICAgICB0aGlzLnJlbW92ZVBlbmRpbmdDaGVja291dEF0KDApXG4gICAgICAgIGF3YWl0IHRoaXMuc3Bhd25BbmRSZXNvbHZlUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWFwZWRDb25uZWN0aW9uID0gYXdhaXQgdGhpcy5pZGxlQ29ubmVjdGlvbkZvclBlbmRpbmdDaGVja291dChjaGVja291dClcblxuICAgICAgaWYgKCF0aGlzLnBlbmRpbmdDaGVja291dHMuaW5jbHVkZXMoY2hlY2tvdXQpKSBjb250aW51ZVxuICAgICAgaWYgKCFyZWFwZWRDb25uZWN0aW9uKSByZXR1cm5cblxuICAgICAgdGhpcy5yZW1vdmVQZW5kaW5nQ2hlY2tvdXRBdCgwKVxuICAgICAgYXdhaXQgdGhpcy5yZXNvbHZlUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0LCByZWFwZWRDb25uZWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgcGVuZGluZyBjaGVja291dCB3aXRoIG1hdGNoaW5nIGlkbGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIHBlbmRpbmcgY2hlY2tvdXQgd2FzIHJlc29sdmVkIHdpdGggYW4gaWRsZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZVBlbmRpbmdDaGVja291dFdpdGhNYXRjaGluZ0lkbGVDb25uZWN0aW9uKCkge1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCB0aGlzLnBlbmRpbmdDaGVja291dHMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBjb25zdCBjaGVja291dCA9IHRoaXMucGVuZGluZ0NoZWNrb3V0c1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KGNoZWNrb3V0LnJldXNlS2V5LCB7aW5jbHVkZU9wZW5UcmFuc2FjdGlvbnM6IGZhbHNlfSlcblxuICAgICAgaWYgKCFjb25uZWN0aW9uKSBjb250aW51ZVxuXG4gICAgICB0aGlzLnJlbW92ZVBlbmRpbmdDaGVja291dEF0KGluZGV4KVxuICAgICAgYXdhaXQgdGhpcy5yZXNvbHZlUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0LCBjb25uZWN0aW9uKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIHBlbmRpbmcgY2hlY2tvdXQgYXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFBlbmRpbmcgY2hlY2tvdXQgaW5kZXguXG4gICAqIEByZXR1cm5zIHtQZW5kaW5nQ2hlY2tvdXR9IC0gUmVtb3ZlZCBjaGVja291dC5cbiAgICovXG4gIHJlbW92ZVBlbmRpbmdDaGVja291dEF0KGluZGV4KSB7XG4gICAgY29uc3QgY2hlY2tvdXQgPSB0aGlzLnBlbmRpbmdDaGVja291dHMuc3BsaWNlKGluZGV4LCAxKVswXVxuXG4gICAgdGhpcy5jbGVhclBlbmRpbmdDaGVja291dFRpbWVvdXQoY2hlY2tvdXQpXG4gICAgdGhpcy5yZWNvcmRDaGVja291dFdhaXQoY2hlY2tvdXQpXG5cbiAgICByZXR1cm4gY2hlY2tvdXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgY29tcGxldGVkIHF1ZXVlIHdhaXQgd2l0aG91dCByZXRhaW5pbmcgcGVyLWNoZWNrb3V0IGxhYmVscyBvciBzYW1wbGVzLlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBDaGVja291dCBsZWF2aW5nIHRoZSBwZW5kaW5nIHF1ZXVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZENoZWNrb3V0V2FpdChjaGVja291dCkge1xuICAgIGNvbnN0IHdhaXRlZEZvck1zID0gTWF0aC5tYXgoMCwgdGhpcy5ub3dNcygpIC0gY2hlY2tvdXQuZW5xdWV1ZWRBdClcblxuICAgIHRoaXMudGVsZW1ldHJ5LmNoZWNrb3V0V2FpdENvdW50KytcbiAgICB0aGlzLnRlbGVtZXRyeS5jaGVja291dFdhaXRUb3RhbE1zICs9IHdhaXRlZEZvck1zXG4gICAgdGhpcy50ZWxlbWV0cnkuY2hlY2tvdXRXYWl0TWF4TXMgPSBNYXRoLm1heCh0aGlzLnRlbGVtZXRyeS5jaGVja291dFdhaXRNYXhNcywgd2FpdGVkRm9yTXMpXG4gICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMoY2hlY2tvdXQudGVzdFByb2ZpbGVDb250ZXh0LCBcImNoZWNrb3V0V2FpdFwiLCB7ZHVyYXRpb25Nczogd2FpdGVkRm9yTXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgcGVuZGluZyBjaGVja291dCB0aW1lb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBQZW5kaW5nIGNoZWNrb3V0IHRvIHRpbWUgb3V0LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9IC0gVGltZXIsIGlmIHRpbWVvdXQgaXMgZW5hYmxlZC5cbiAgICovXG4gIHN0YXJ0UGVuZGluZ0NoZWNrb3V0VGltZW91dChjaGVja291dCkge1xuICAgIGlmIChjaGVja291dC50aW1lb3V0TWlsbGlzID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy50aW1lb3V0UGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0KVxuICAgIH0sIGNoZWNrb3V0LnRpbWVvdXRNaWxsaXMpXG5cbiAgICByZXR1cm4gdGltZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRpbWVvdXQgcGVuZGluZyBjaGVja291dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gUGVuZGluZyBjaGVja291dCB0byByZWplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdGltZW91dFBlbmRpbmdDaGVja291dChjaGVja291dCkge1xuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmluZGV4T2YoY2hlY2tvdXQpXG5cbiAgICBpZiAoaW5kZXggPT09IC0xKSByZXR1cm5cblxuICAgIHRoaXMucmVtb3ZlUGVuZGluZ0NoZWNrb3V0QXQoaW5kZXgpXG4gICAgdGhpcy50ZWxlbWV0cnkuY2hlY2tvdXRUaW1lb3V0Q291bnQrK1xuICAgIHRoaXMucmVjb3JkVGVzdFByb2ZpbGVQb29sTWV0cmljKGNoZWNrb3V0LnRlc3RQcm9maWxlQ29udGV4dCwgXCJjaGVja291dFRpbWVvdXRcIilcbiAgICBjaGVja291dC5yZWplY3QodGhpcy5wZW5kaW5nQ2hlY2tvdXRUaW1lb3V0RXJyb3IoY2hlY2tvdXQpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVuZGluZyBjaGVja291dCB0aW1lb3V0IGVycm9yLlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBUaW1lZC1vdXQgY2hlY2tvdXQuXG4gICAqIEByZXR1cm5zIHtEYXRhYmFzZVBvb2xDaGVja291dFRpbWVvdXRFcnJvcn0gLSBUaW1lb3V0IGVycm9yLlxuICAgKi9cbiAgcGVuZGluZ0NoZWNrb3V0VGltZW91dEVycm9yKGNoZWNrb3V0KSB7XG4gICAgY29uc3QgY2hlY2tvdXROYW1lID0gY2hlY2tvdXQub3B0aW9ucy5uYW1lID8gYCBDaGVja291dCBuYW1lOiAke0pTT04uc3RyaW5naWZ5KGNoZWNrb3V0Lm9wdGlvbnMubmFtZSl9LmAgOiBcIlwiXG4gICAgY29uc3QgZGlhZ25vc3RpY3MgPSB0aGlzLnBlbmRpbmdDaGVja291dFRpbWVvdXREaWFnbm9zdGljcyhjaGVja291dClcblxuICAgIHJldHVybiBuZXcgRGF0YWJhc2VQb29sQ2hlY2tvdXRUaW1lb3V0RXJyb3IoYFRpbWVkIG91dCBhZnRlciAke2NoZWNrb3V0LnRpbWVvdXRNaWxsaXN9bXMgd2FpdGluZyBmb3IgZGF0YWJhc2UgY29ubmVjdGlvbiBjaGVja291dCBmcm9tIHBvb2wgXCIke3RoaXMuaWRlbnRpZmllcn1cIi4ke2NoZWNrb3V0TmFtZX0gJHtkaWFnbm9zdGljc31gKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBzYW5pdGl6ZWQgZGlhZ25vc3RpY3MgZm9yIGEgY2hlY2tvdXQgdGltZW91dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gVGltZWQtb3V0IGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBvb2wgc3RhdGUgc3VtbWFyeS5cbiAgICovXG4gIHBlbmRpbmdDaGVja291dFRpbWVvdXREaWFnbm9zdGljcyhjaGVja291dCkge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gdGhpcy5nZXREZWJ1Z1NuYXBzaG90KClcbiAgICBjb25zdCBjb25uZWN0aW9uU3VtbWFyaWVzID0gc25hcHNob3QuY29ubmVjdGlvbnNcbiAgICAgIC5tYXAoKGNvbm5lY3Rpb24pID0+IHRoaXMucGVuZGluZ0NoZWNrb3V0VGltZW91dENvbm5lY3Rpb25TdW1tYXJ5KGNvbm5lY3Rpb24pKVxuICAgICAgLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IHBlbmRpbmdTdW1tYXJpZXMgPSAoc25hcHNob3QucGVuZGluZ0NoZWNrb3V0cyB8fCBbXSlcbiAgICAgIC5tYXAoKHBlbmRpbmdDaGVja291dCkgPT4gdGhpcy5wZW5kaW5nQ2hlY2tvdXRUaW1lb3V0UGVuZGluZ1N1bW1hcnkocGVuZGluZ0NoZWNrb3V0KSlcbiAgICAgIC5qb2luKFwiLCBcIilcbiAgICBjb25zdCB3YWl0ZWRGb3JNcyA9IE1hdGgubWF4KDAsIERhdGUubm93KCkgLSBjaGVja291dC5lbnF1ZXVlZEF0KVxuXG4gICAgcmV0dXJuIGBQb29sIHN0YXRlOiBtYXg9JHt0aGlzLm1heENvbm5lY3Rpb25zKCkgPz8gXCJ1bmJvdW5kZWRcIn0sIGluVXNlPSR7c25hcHNob3QuaW5Vc2VDb3VudH0sIGlkbGU9JHtzbmFwc2hvdC5pZGxlQ291bnR9LCBwZW5kaW5nPSR7c25hcHNob3QucGVuZGluZ0NoZWNrb3V0Q291bnR9LCBzcGF3bmluZz0ke3NuYXBzaG90LmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkfSwgdGltZWRPdXRXYWl0aW5nRm9yTXM9JHt3YWl0ZWRGb3JNc30sIGhvbGRlcnM9WyR7Y29ubmVjdGlvblN1bW1hcmllc31dLCB3YWl0aW5nPVske3BlbmRpbmdTdW1tYXJpZXN9XS5gXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc2FuaXRpemVkIGNvbm5lY3Rpb24gc3VtbWFyeSBmb3IgY2hlY2tvdXQgdGltZW91dCBkaWFnbm9zdGljcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhbml0aXplZCBjb25uZWN0aW9uIHN0YXRlLlxuICAgKi9cbiAgcGVuZGluZ0NoZWNrb3V0VGltZW91dENvbm5lY3Rpb25TdW1tYXJ5KGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBwYXJ0cyA9IFtgc3RhdGU9JHtjb25uZWN0aW9uLnN0YXRlfWBdXG5cbiAgICBpZiAoY29ubmVjdGlvbi5jaGVja291dE5hbWUpIHBhcnRzLnB1c2goYGNoZWNrb3V0PSR7SlNPTi5zdHJpbmdpZnkoY29ubmVjdGlvbi5jaGVja291dE5hbWUpfWApXG4gICAgaWYgKHR5cGVvZiBjb25uZWN0aW9uLmNoZWNrZWRPdXRGb3JNcyA9PT0gXCJudW1iZXJcIikgcGFydHMucHVzaChgY2hlY2tlZE91dEZvck1zPSR7Y29ubmVjdGlvbi5jaGVja2VkT3V0Rm9yTXN9YClcbiAgICBpZiAodHlwZW9mIGNvbm5lY3Rpb24uaWRsZUZvck1zID09PSBcIm51bWJlclwiKSBwYXJ0cy5wdXNoKGBpZGxlRm9yTXM9JHtjb25uZWN0aW9uLmlkbGVGb3JNc31gKVxuICAgIGlmICh0eXBlb2YgY29ubmVjdGlvbi5vcGVuVHJhbnNhY3Rpb25zID09PSBcIm51bWJlclwiKSBwYXJ0cy5wdXNoKGBvcGVuVHJhbnNhY3Rpb25zPSR7Y29ubmVjdGlvbi5vcGVuVHJhbnNhY3Rpb25zfWApXG5cbiAgICBjb25zdCBhY3RpdmVRdWVyeSA9IGNvbm5lY3Rpb24uYWN0aXZlUXVlcnlcblxuICAgIGlmIChhY3RpdmVRdWVyeSAmJiB0eXBlb2YgYWN0aXZlUXVlcnkgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoYWN0aXZlUXVlcnkpKSB7XG4gICAgICBjb25zdCBydW5uaW5nTXMgPSAoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhY3RpdmVRdWVyeSkpLnJ1bm5pbmdNc1xuXG4gICAgICBpZiAodHlwZW9mIHJ1bm5pbmdNcyA9PT0gXCJudW1iZXJcIikgcGFydHMucHVzaChgYWN0aXZlUXVlcnlNcz0ke3J1bm5pbmdNc31gKVxuICAgIH1cblxuICAgIHJldHVybiBgeyR7cGFydHMuam9pbihcIiBcIil9fWBcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzYW5pdGl6ZWQgcGVuZGluZyBjaGVja291dCBzdW1tYXJ5IGZvciBjaGVja291dCB0aW1lb3V0IGRpYWdub3N0aWNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5EYXRhYmFzZVBvb2xQZW5kaW5nQ2hlY2tvdXREZWJ1Z1NuYXBzaG90fSBwZW5kaW5nQ2hlY2tvdXQgLSBXYWl0aW5nIGNoZWNrb3V0IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhbml0aXplZCBwZW5kaW5nIGNoZWNrb3V0IHN0YXRlLlxuICAgKi9cbiAgcGVuZGluZ0NoZWNrb3V0VGltZW91dFBlbmRpbmdTdW1tYXJ5KHBlbmRpbmdDaGVja291dCkge1xuICAgIGNvbnN0IHBhcnRzID0gW2BpbmRleD0ke3BlbmRpbmdDaGVja291dC5pbmRleH1gLCBgd2FpdGluZ0Zvck1zPSR7cGVuZGluZ0NoZWNrb3V0LndhaXRpbmdGb3JNc31gXVxuXG4gICAgaWYgKHBlbmRpbmdDaGVja291dC5jaGVja291dE5hbWUpIHBhcnRzLnB1c2goYGNoZWNrb3V0PSR7SlNPTi5zdHJpbmdpZnkocGVuZGluZ0NoZWNrb3V0LmNoZWNrb3V0TmFtZSl9YClcbiAgICBpZiAocGVuZGluZ0NoZWNrb3V0LnJlbWFpbmluZ1RpbWVvdXRNcyAhPT0gbnVsbCkgcGFydHMucHVzaChgcmVtYWluaW5nVGltZW91dE1zPSR7cGVuZGluZ0NoZWNrb3V0LnJlbWFpbmluZ1RpbWVvdXRNc31gKVxuXG4gICAgcmV0dXJuIGB7JHtwYXJ0cy5qb2luKFwiIFwiKX19YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgcGVuZGluZyBjaGVja291dCB0aW1lb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBQZW5kaW5nIGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyUGVuZGluZ0NoZWNrb3V0VGltZW91dChjaGVja291dCkge1xuICAgIGlmICghY2hlY2tvdXQudGltZW91dFRpbWVyKSByZXR1cm5cblxuICAgIGNsZWFyVGltZW91dChjaGVja291dC50aW1lb3V0VGltZXIpXG4gICAgY2hlY2tvdXQudGltZW91dFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBpZGxlIGNvbm5lY3Rpb24gZm9yIHBlbmRpbmcgY2hlY2tvdXQgY2FwYWNpdHkuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIENoZWNrb3V0IHdhaXRpbmcgZm9yIGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhbiBpZGxlIGNvbm5lY3Rpb24gd2FzIGNsb3NlZCB0byBmcmVlIGNhcGFjaXR5LlxuICAgKi9cbiAgYXN5bmMgY2xvc2VJZGxlQ29ubmVjdGlvbkZvclBlbmRpbmdDaGVja291dENhcGFjaXR5KGNoZWNrb3V0KSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZmluZElkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkoY2hlY2tvdXQucmV1c2VLZXkpXG5cbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLnJlYXBJZGxlQ29ubmVjdGlvbnMoKVxuXG4gICAgaWYgKHRoaXMuZmluZElkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkoY2hlY2tvdXQucmV1c2VLZXkpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLmNhblNwYXduQ29ubmVjdGlvbihjaGVja291dC5kYXRhYmFzZUNvbmZpZykgPyBmYWxzZSA6IGF3YWl0IHRoaXMuY2xvc2VPbmVJZGxlQ29ubmVjdGlvbkZvckNhcGFjaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgaWRsZSBjb25uZWN0aW9uIGZvciByZXVzZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gTWF0Y2hpbmcgaWRsZSBjb25uZWN0aW9uLCBpZiBwcmVzZW50LlxuICAgKi9cbiAgZmluZElkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9ucy5maW5kKChjb25uZWN0aW9uKSA9PiAhdGhpcy5jb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pICYmIHRoaXMuY29ubmVjdGlvbk1hdGNoZXNSZXVzZUtleShjb25uZWN0aW9uLCByZXVzZUtleSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpZGxlIGNvbm5lY3Rpb24gZm9yIHBlbmRpbmcgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIENoZWNrb3V0IHdhaXRpbmcgZm9yIGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIE1hdGNoaW5nIGlkbGUgY29ubmVjdGlvbiwgaWYgb25lIGNhbiBiZSByZXVzZWQuXG4gICAqL1xuICBhc3luYyBpZGxlQ29ubmVjdGlvbkZvclBlbmRpbmdDaGVja291dChjaGVja291dCkge1xuICAgIGxldCBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShjaGVja291dC5yZXVzZUtleSwge2luY2x1ZGVPcGVuVHJhbnNhY3Rpb25zOiBmYWxzZX0pXG5cbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGNvbm5lY3Rpb25cblxuICAgIGF3YWl0IHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpXG4gICAgaWYgKCF0aGlzLnBlbmRpbmdDaGVja291dHMuaW5jbHVkZXMoY2hlY2tvdXQpKSByZXR1cm5cblxuICAgIGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KGNoZWNrb3V0LnJldXNlS2V5LCB7aW5jbHVkZU9wZW5UcmFuc2FjdGlvbnM6IGZhbHNlfSlcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcGF3biBhbmQgcmVzb2x2ZSBwZW5kaW5nIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBDaGVja291dCByZXF1ZXN0IHRvIHJlc29sdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNoZWNrb3V0IGhhcyBiZWVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBzcGF3bkFuZFJlc29sdmVQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIHJldHVybiBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIucnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChjaGVja291dC50ZXN0UHJvZmlsZUNvbnRleHQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoY2hlY2tvdXQudGVzdERhdGFiYXNlQWNjZXNzU2NvcGUsIGFzeW5jICgpID0+IHtcbiAgICAgICAgbGV0IGNvbm5lY3Rpb25cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5zcGF3bkNvbm5lY3Rpb25Gb3JDaGVja291dChcbiAgICAgICAgICAgIGNoZWNrb3V0LmRhdGFiYXNlQ29uZmlnLFxuICAgICAgICAgICAgY2hlY2tvdXQucmV1c2VLZXksXG4gICAgICAgICAgICBjaGVja291dC50ZXN0UHJvZmlsZUNvbnRleHRcbiAgICAgICAgICApXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY2hlY2tvdXQucmVqZWN0KGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIkZhaWxlZCB0byBzcGF3biBkYXRhYmFzZSBjb25uZWN0aW9uLlwiLCB7Y2F1c2U6IGVycm9yfSkpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLnJlc29sdmVQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQsIGNvbm5lY3Rpb24pXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIHBlbmRpbmcgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIENoZWNrb3V0IHJlcXVlc3QgdG8gcmVzb2x2ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24gdG8gYWN0aXZhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNoZWNrb3V0IGhhcyBiZWVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyByZXNvbHZlUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0LCBjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLnJ1bldpdGhUZXN0UHJvZmlsZUNvbnRleHQoY2hlY2tvdXQudGVzdFByb2ZpbGVDb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKGNoZWNrb3V0LnRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2hlY2tvdXQucmVzb2x2ZShhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBjaGVja291dC5vcHRpb25zKSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjaGVja291dC5yZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjdGl2YXRlIGRhdGFiYXNlIGNvbm5lY3Rpb24uXCIsIHtjYXVzZTogZXJyb3J9KSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugb25lIGlkbGUgY29ubmVjdGlvbiBmb3IgY2FwYWNpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYW4gaWRsZSBjb25uZWN0aW9uIHdhcyBjbG9zZWQgdG8gZnJlZSBjYXBhY2l0eS5cbiAgICovXG4gIGFzeW5jIGNsb3NlT25lSWRsZUNvbm5lY3Rpb25Gb3JDYXBhY2l0eSgpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5maW5kKChjYW5kaWRhdGUpID0+ICF0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY2FuZGlkYXRlKSlcblxuICAgIGlmICghY29ubmVjdGlvbikgcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gdGhpcy5jb25uZWN0aW9ucy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBjb25uZWN0aW9uKVxuICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zIHwgKChhcmc6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+KX0gb3B0aW9uc09yQ2FsbGJhY2sgLSBDaGVja291dCBvcHRpb25zIG9yIGNhbGxiYWNrIHRvIGludm9rZSB3aXRoIHRoZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geyhhcmc6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdpdGggdGhlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhDb25uZWN0aW9uKG9wdGlvbnNPckNhbGxiYWNrLCBjYWxsYmFjaykge1xuICAgIHRoaXMuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBjb25zdCBvcHRpb25zID0gdHlwZW9mIG9wdGlvbnNPckNhbGxiYWNrID09IFwiZnVuY3Rpb25cIiA/IHt9IDogb3B0aW9uc09yQ2FsbGJhY2tcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IHR5cGVvZiBvcHRpb25zT3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIgPyBvcHRpb25zT3JDYWxsYmFjayA6IGNhbGxiYWNrXG5cbiAgICBpZiAoIWFjdHVhbENhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJ3aXRoQ29ubmVjdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCBjb25uZWN0aW9uQ29udGV4dFN1cHByZXNzZWQgPSB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKCkgPT09IFNVUFBSRVNTRURfQ09OTkVDVElPTl9DT05URVhUXG4gICAgY29uc3QgdGVzdFNoYXJlZENvbm5lY3Rpb24gPSBjb25uZWN0aW9uQ29udGV4dFN1cHByZXNzZWQgPyB1bmRlZmluZWQgOiB0aGlzLmFjdGl2ZVRlc3RTaGFyZWRDb25uZWN0aW9uKClcbiAgICBpZiAodGVzdFNoYXJlZENvbm5lY3Rpb24gJiYgdGhpcy5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKHRlc3RTaGFyZWRDb25uZWN0aW9uKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UucnVuKHRlc3RTaGFyZWRDb25uZWN0aW9uLmdldElkU2VxKCksIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGFjdHVhbENhbGxiYWNrKHRlc3RTaGFyZWRDb25uZWN0aW9uKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jaGVja291dChvcHRpb25zKVxuICAgIGNvbnN0IGlkID0gY29ubmVjdGlvbi5nZXRJZFNlcSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5ydW4oaWQsIGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxDYWxsYmFjayhjb25uZWN0aW9uKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIG9wZW5DYXB0dXJlZENvbm5lY3Rpb24oLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IHdhc1JldGFpbmVkID0gdGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5oYXMocmV1c2VLZXkpXG5cbiAgICB0aGlzLmxpZmVjeWNsZVJldGFpbmVkUmV1c2VLZXlzLmFkZChyZXVzZUtleSlcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWU6IFwiRnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBvcGVuXCJ9KVxuICAgICAgYXdhaXQgdGhpcy5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghd2FzUmV0YWluZWQpIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuZGVsZXRlKHJldXNlS2V5KVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaENhcHR1cmVkQ29ubmVjdGlvbigvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5nZXQocmV1c2VLZXkpXG4gICAgICB8fCB0aGlzLmNvbm5lY3Rpb25zLmZpbmQoKGNhbmRpZGF0ZSkgPT4gdGhpcy5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNhbmRpZGF0ZSkgPT09IHJldXNlS2V5KVxuICAgIGlmIChjb25uZWN0aW9uKSBhd2FpdCBjb25uZWN0aW9uLmZsdXNoUGVuZGluZ1dyaXRlcygpXG4gIH1cblxuICBhc3luYyBjbG9zZUNhcHR1cmVkQ29ubmVjdGlvbigvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgaWYgKHRoaXMuY2FwdHVyZWRDb25uZWN0aW9uSW5Vc2UoZGF0YWJhc2VDb25maWd1cmF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNsb3NlIGFuIGluLXVzZSBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGhhbmRsZVwiKVxuICAgIGNvbnN0IHJldGFpbmVkQ29ubmVjdGlvbiA9IHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5nZXQocmV1c2VLZXkpXG4gICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5kZWxldGUocmV1c2VLZXkpXG4gICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLmRlbGV0ZShyZXVzZUtleSlcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHRoaXMuY29ubmVjdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjYW5kaWRhdGUpID09PSByZXVzZUtleSlcbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gdGhpcy5jb25uZWN0aW9ucy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gdGhpcy5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNhbmRpZGF0ZSkgIT09IHJldXNlS2V5KVxuICAgIGlmIChyZXRhaW5lZENvbm5lY3Rpb24pIGNvbm5lY3Rpb25zLnB1c2gocmV0YWluZWRDb25uZWN0aW9uKVxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBjb25uZWN0aW9ucykgYXdhaXQgdGhpcy5jbG9zZUNvbm5lY3Rpb24oY29ubmVjdGlvbilcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUNhcHR1cmVkRGF0YWJhc2UoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGF3YWl0IHRoaXMuY2xvc2VDYXB0dXJlZENvbm5lY3Rpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IERyaXZlckNsYXNzID0gZGF0YWJhc2VDb25maWd1cmF0aW9uLmRyaXZlciB8fCB0aGlzLmRyaXZlckNsYXNzXG4gICAgaWYgKCFEcml2ZXJDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gZHJpdmVyIGNsYXNzIGNvbmZpZ3VyZWQgZm9yIGZyb250ZW5kIHRlbmFudCBTUUxpdGUgZGVsZXRpb25cIilcbiAgICBhd2FpdCBuZXcgRHJpdmVyQ2xhc3MoZGF0YWJhc2VDb25maWd1cmF0aW9uLCB0aGlzLmNvbmZpZ3VyYXRpb24pLmRlbGV0ZURhdGFiYXNlU3RvcmFnZSgpXG4gIH1cblxuICBjYXB0dXJlZENvbm5lY3Rpb25JblVzZSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5jb25uZWN0aW9uc0luVXNlKS5zb21lKChjb25uZWN0aW9uKSA9PiB0aGlzLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbikgPT09IHJldXNlS2V5KVxuICB9XG5cbiAgY2FwdHVyZWRDb25uZWN0aW9uSGFzUGVuZGluZ1dyaXRlcygvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBbLi4udGhpcy5jb25uZWN0aW9ucywgLi4uT2JqZWN0LnZhbHVlcyh0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpLCAuLi50aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCldXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25zLnNvbWUoKGNvbm5lY3Rpb24pID0+IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKSA9PT0gcmV1c2VLZXkgJiYgY29ubmVjdGlvbi5oYXNQZW5kaW5nV3JpdGVzKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhcHR1cmVkIG9wZXJhdGlvbiB0aHJvdWdoIHRoZSBub3JtYWwgYm91bmRlZCBwb29sIGxpZmVjeWNsZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ2FwdHVyZWRDb25uZWN0aW9uT3B0aW9uc30gb3B0aW9ucyAtIENhcHR1cmVkIGNoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBvd25lcjogc3ltYm9sKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aENhcHR1cmVkT3BlcmF0aW9uQ29ubmVjdGlvbih7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBuYW1lfSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZX0pXG4gICAgY29uc3QgaWQgPSBjb25uZWN0aW9uLmdldElkU2VxKClcbiAgICBjb25zdCBvd25lciA9IFN5bWJvbChcImNhcHR1cmVkLWRhdGFiYXNlLW9wZXJhdGlvbi1vd25lclwiKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UucnVuKGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbiwgb3duZXIpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCB0aGlzLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgdGVzdC1zaGFyZWQgY29ubmVjdGlvbiBmcm9tIHRoZSBwZXItdGVuYW50IGNvbnRleHQgcHJvdmlkZXJzIG9ubHkuXG4gICAqIFVubGlrZSB7QGxpbmsgdGVzdFNoYXJlZENvbm5lY3Rpb259LCB0aGlzIG5ldmVyIGZhbGxzIGJhY2sgdG8gdGhlIHBvb2wgZGVmYXVsdCBvclxuICAgKiB0aGUgcGVyLWNvbmZpZ3VyYXRpb24gc2hhcmVkIGNvbm5lY3Rpb24sIHNvIGl0IGlzIHNhZmUgdG8gY29uc3VsdCBmcm9tXG4gICAqIGBnZXRDdXJyZW50Q29ubmVjdGlvbmAgd2l0aG91dCBjaGFuZ2luZyBiZWhhdmlvciB3aGVuIG5vIHBlci10ZW5hbnQgcHJvdmlkZXJcbiAgICogbWF0Y2hlcyAodGhlIHByb2R1Y3Rpb24gY2FzZSwgd2hlcmUgdGhlIHByb3ZpZGVyIGxpc3QgaXMgZW1wdHkpLlxuICAgKlxuICAgKiBUaGUgcHJvdmlkZXIgYG1hdGNoZXMoKWAgY2FsbGJhY2sgbWF5IGluc3BlY3QgdGhlIGxpdmUgdGVuYW50IGNvbnRleHQsIHdoaWNoIGlzXG4gICAqIGVzdGFibGlzaGVkIGR1cmluZyByb3V0ZSByZXNvbHV0aW9uIOKAlCBhZnRlciB0aGUgcmVxdWVzdC1ydW5uZXIgaW5zdGFsbHMgdGhlIGFzeW5jXG4gICAqIGNvbm5lY3Rpb24gY29udGV4dC4gVGhpcyBpcyB3aGF0IGxldHMgYSB0ZXN0IHJ1biBlbnJvbGwgbW9yZSB0aGFuIG9uZSB0ZW5hbnQgb24gYVxuICAgKiBzaW5nbGUgcG9vbCBhbmQgcm91dGUgZWFjaCB0ZW5hbnQncyBpbi1yZXF1ZXN0IHF1ZXJpZXMgdG8gaXRzIG93biBlbnJvbGxlZFxuICAgKiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gUGVyLXRlbmFudCBzaGFyZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHRlc3RTaGFyZWRDb25uZWN0aW9uRm9yQ3VycmVudFRlbmFudCgpIHtcbiAgICBmb3IgKGNvbnN0IHttYXRjaGVzLCBwcm92aWRlcn0gb2YgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcnMudmFsdWVzKCkpIHtcbiAgICAgIGlmIChtYXRjaGVzKCkpIHJldHVybiBwcm92aWRlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqL1xuICBnZXRDdXJyZW50Q29ubmVjdGlvbigpIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG5cbiAgICBjb25zdCBwZXJUZW5hbnRDb25uZWN0aW9uID0gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbkZvckN1cnJlbnRUZW5hbnQoKVxuICAgIGlmIChwZXJUZW5hbnRDb25uZWN0aW9uKSByZXR1cm4gcGVyVGVuYW50Q29ubmVjdGlvblxuXG4gICAgY29uc3QgaWQgPSB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChpZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5jdXJyZW50RmFsbGJhY2tDb25uZWN0aW9uT3JGYWlsKClcbiAgICBpZiAoaWQgPT09IFNVUFBSRVNTRURfQ09OTkVDVElPTl9DT05URVhUKSByZXR1cm4gdGhpcy5jdXJyZW50RmFsbGJhY2tDb25uZWN0aW9uT3JGYWlsKClcblxuICAgIHRoaXMuZW5zdXJlQ29ubmVjdGlvbklzSW5Vc2UoaWQpXG5cbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnNJblVzZVtpZF1cblxuICAgIGlmICghY3VycmVudENvbm5lY3Rpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZ2V0IGN1cnJlbnQgY29ubmVjdGlvbiBmcm9tIHRoYXQgSUQ6ICR7aWR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gY3VycmVudENvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgZmFsbGJhY2sgY29ubmVjdGlvbiBvciBmYWlsLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gRmFsbGJhY2sgY29ubmVjdGlvbiwgaWYgcHJlc2VudC5cbiAgICovXG4gIGN1cnJlbnRGYWxsYmFja0Nvbm5lY3Rpb25PckZhaWwoKSB7XG4gICAgY29uc3QgZmFsbGJhY2tDb25uZWN0aW9uID0gdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uKClcblxuICAgIGlmIChmYWxsYmFja0Nvbm5lY3Rpb24pIHJldHVybiBmYWxsYmFja0Nvbm5lY3Rpb25cblxuICAgIHRocm93IG5ldyBFcnJvcihcIklEIGhhc24ndCBiZWVuIHNldCBmb3IgdGhpcyBhc3luYyBjb250ZXh0XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgY29ubmVjdGlvbiBpcyBpbiB1c2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpZCAtIENoZWNrZWQtb3V0IGNvbm5lY3Rpb24gaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZW5zdXJlQ29ubmVjdGlvbklzSW5Vc2UoaWQpIHtcbiAgICBpZiAoIShpZCBpbiB0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbm5lY3Rpb24gJHtpZH0gZG9lc24ndCBleGlzdCBhbnkgbW9yZSAtIGhhcyBpdCBiZWVuIGNoZWNrZWQgaW4gYWdhaW4/YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgZmFsbGJhY2sgY29ubmVjdGlvbiBmb3IgdGhpcyBwb29sIGlkZW50aWZpZXIgdGhhdCB3aWxsIGJlIHVzZWQgd2hlbiBubyBhc3luYyBjb250ZXh0IGlzIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEdsb2JhbENvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIGNvbnN0IGtsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VQb29sQXN5bmNUcmFja2VkTXVsdGlDb25uZWN0aW9ufSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBsZXQgbWFwRm9yQ29uZmlndXJhdGlvbiA9IGtsYXNzLmdsb2JhbENvbm5lY3Rpb25zLmdldCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIW1hcEZvckNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIG1hcEZvckNvbmZpZ3VyYXRpb24gPSB7fVxuICAgICAga2xhc3MuZ2xvYmFsQ29ubmVjdGlvbnMuc2V0KHRoaXMuY29uZmlndXJhdGlvbiwgbWFwRm9yQ29uZmlndXJhdGlvbilcbiAgICB9XG5cbiAgICBtYXBGb3JDb25maWd1cmF0aW9uW3RoaXMuaWRlbnRpZmllcl0gPSBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIGdsb2JhbCBmYWxsYmFjayBjb25uZWN0aW9uIGV4aXN0cyBmb3IgdGhpcyBwb29sIGlkZW50aWZpZXIgYW5kIHJldHVybnMgaXQuXG4gICAqIElmIG9uZSBpcyBhbHJlYWR5IHNldCwgaXQgaXMgcmV0dXJuZWQgYW5kIGFsc28gbWFkZSBhdmFpbGFibGUgaW4gdGhlIHBvb2wgcXVldWUuXG4gICAqIE90aGVyd2lzZSBhIG5ldyBjb25uZWN0aW9uIGlzIHNwYXduZWQsIHJlZ2lzdGVyZWQsIGFuZCBxdWV1ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBnbG9iYWwgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUdsb2JhbENvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldEdsb2JhbENvbm5lY3Rpb24oKVxuXG4gICAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3RpbmdcblxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbigpXG5cbiAgICB0aGlzLnNldEdsb2JhbENvbm5lY3Rpb24oY29ubmVjdGlvbilcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogU2V0IGEgc2hhcmVkIGNvbm5lY3Rpb24gZm9yIHRlc3QgbW9kZSBzbyB0aGF0IEhUVFAgaGFuZGxlcnMgcnVubmluZ1xuICAgKiBpbiB0aGUgc2FtZSBwcm9jZXNzIGNhbiByZXVzZSB0aGUgdGVzdCBydW5uZXIncyBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gU2hhcmVkIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzZXRUZXN0U2hhcmVkQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge293bmVyOiBTeW1ib2woXCJ0ZXN0LXNoYXJlZC1jb25uZWN0aW9uXCIpfVxuXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gcmVnaXN0cmF0aW9uXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHByb3ZpZGVyIHRoYXQgaXMgZXZhbHVhdGVkIHdoZW4gYW4gaW4tcHJvY2VzcyB0ZXN0IHJlcXVlc3QgaXMgZGlzcGF0Y2hlZC5cbiAgICogQHBhcmFtIHsoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcHJvdmlkZXIgLSBTaGFyZWQgY29ubmVjdGlvbiBwcm92aWRlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gLSBPcGFxdWUgcmVnaXN0cmF0aW9uIGhhbmRsZS5cbiAgICovXG4gIHNldFRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIocHJvdmlkZXIpIHtcbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7b3duZXI6IFN5bWJvbChcInRlc3Qtc2hhcmVkLWNvbm5lY3Rpb24tcHJvdmlkZXJcIil9XG5cbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIgPSBwcm92aWRlclxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gcmVnaXN0cmF0aW9uXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgcHJvdmlkZXIgc2VsZWN0ZWQgYnkgdGhlIGN1cnJlbnQgbGl2ZSBhc3luYyBqb2luIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7e21hdGNoZXM6ICgpID0+IGJvb2xlYW4sIHByb3ZpZGVyOiAoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBDb250ZXh0IHNlbGVjdG9yIGFuZCBwcm92aWRlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gLSBPcGFxdWUgc2NvcGVkIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICByZWdpc3RlclRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoYXJncykge1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtvd25lcjogU3ltYm9sKFwidGVzdC1zaGFyZWQtY29ubmVjdGlvbi1jb250ZXh0LXByb3ZpZGVyXCIpfVxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzLnNldChyZWdpc3RyYXRpb24sIGFyZ3MpXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBhdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24gZm9yIGV4YWN0bHkgb25lIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBBdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzZXRUZXN0U2hhcmVkQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb24oY29ubmVjdGlvbiwgcmV1c2VLZXkpIHtcbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7b3duZXI6IFN5bWJvbChcInRlc3Qtc2hhcmVkLXBoeXNpY2FsLWNvbm5lY3Rpb25cIil9XG5cbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LnNldChyZXVzZUtleSwge2Nvbm5lY3Rpb24sIHJlZ2lzdHJhdGlvbn0pXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgY3VycmVudCBzaGFyZWQgY29ubmVjdGlvbiByZWdpc3RyYXRpb24uIEEgc3VwcGxpZWQgc3RhbGUgcmVnaXN0cmF0aW9uXG4gICAqIGNhbm5vdCBjbGVhciBhIHByb3ZpZGVyIGluc3RhbGxlZCBieSBhIG5ld2VyIGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IFtyZWdpc3RyYXRpb25dIC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUgdG8gY2xlYXIgY29uZGl0aW9uYWxseS5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgaWYgKHJlZ2lzdHJhdGlvbiAmJiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVycy5kZWxldGUocmVnaXN0cmF0aW9uKSkgcmV0dXJuXG4gICAgaWYgKHJlZ2lzdHJhdGlvbikge1xuICAgICAgZm9yIChjb25zdCBbcmV1c2VLZXksIGVudHJ5XSBvZiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5KSB7XG4gICAgICAgIGlmIChlbnRyeS5yZWdpc3RyYXRpb24gIT09IHJlZ2lzdHJhdGlvbikgY29udGludWVcbiAgICAgICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleS5kZWxldGUocmV1c2VLZXkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LmNsZWFyKClcbiAgICB9XG4gICAgaWYgKHJlZ2lzdHJhdGlvbiAmJiByZWdpc3RyYXRpb24gIT09IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uKSByZXR1cm5cblxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSB0aGUgdGVzdCBzaGFyZWQgY29ubmVjdGlvbidzIGFzeW5jIGNvbnRleHQsIHNvIG5lc3RlZFxuICAgKiBgZ2V0Q3VycmVudENvbm5lY3Rpb25gL2BlbnN1cmVDb25uZWN0aW9uc2AgcmV1c2UgaXQgKHdpdGggYSByZWFsIGNvbnRleHQpIHJhdGhlclxuICAgKiB0aGFuIGNoZWNraW5nIG91dCBhIGZyZXNoIHBvb2xlZCBjb25uZWN0aW9uLiBVc2VkIHRvIHJ1biBhbiBpbi1wcm9jZXNzIHJlcXVlc3RcbiAgICogaGFuZGxlciBvbiB0aGUgc2FtZSBjb25uZWN0aW9uIOKAlCBhbmQgb3BlbiB0cmFuc2FjdGlvbiDigJQgYXMgdGhlIHRlc3QgYm9keS4gTm8tb3BcbiAgICogKHJ1bnMgdGhlIGNhbGxiYWNrIGFzLWlzKSB3aGVuIG5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBpbiB0aGUgc2hhcmVkIGNvbm5lY3Rpb24ncyBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb24oY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5hY3RpdmVUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5ydW4oY29ubmVjdGlvbi5nZXRJZFNlcSgpLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHRlc3Qtc2hhcmVkIGNvbm5lY3Rpb24gb25seSB3aGlsZSBpdHMgY2hlY2tvdXQgSUQgaXMgc3RpbGwgb3duZWQgYnkgdGhpcyBwb29sLlxuICAgKiBGYWxsYmFjay1vbmx5IHJlZ2lzdHJhdGlvbnMgaGF2ZSBubyBjaGVja291dCBJRCBhbmQgbXVzdCBlbnRlciB0aGUgbm9ybWFsIGNoZWNrb3V0IHBhdGguXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgc2hhcmVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhY3RpdmVUZXN0U2hhcmVkQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgY29uc3QgaWQgPSBjb25uZWN0aW9uPy5nZXRJZFNlcSgpXG5cbiAgICBpZiAodHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSByZXR1cm5cbiAgICBpZiAodGhpcy5jb25uZWN0aW9uc0luVXNlW2lkXSAhPT0gY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25uZWN0aW9uIGN1cnJlbnRseSBlbGlnaWJsZSBmb3IgaW4tcHJvY2VzcyB0ZXN0IHJlcXVlc3Qgc2hhcmluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgdGVzdFNoYXJlZENvbm5lY3Rpb24oKSB7XG4gICAgZm9yIChjb25zdCB7bWF0Y2hlcywgcHJvdmlkZXJ9IG9mIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzLnZhbHVlcygpKSB7XG4gICAgICBpZiAobWF0Y2hlcygpKSByZXR1cm4gcHJvdmlkZXIoKVxuICAgIH1cbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KClcbiAgICBjb25zdCBwaHlzaWNhbFJlZ2lzdHJhdGlvbiA9IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uc0J5UmV1c2VLZXkuZ2V0KHJldXNlS2V5KVxuXG4gICAgaWYgKHBoeXNpY2FsUmVnaXN0cmF0aW9uKSByZXR1cm4gcGh5c2ljYWxSZWdpc3RyYXRpb24uY29ubmVjdGlvblxuICAgIHJldHVybiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyXG4gICAgICA/IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoKVxuICAgICAgOiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbm5lY3Rpb24gdGllZCB0byB0aGUgY3VycmVudCBhc3luYyBjb250ZXh0LCBpZiBhbnkuXG4gICAqIEZhbGxzIGJhY2sgdG8gdGhlIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gd2hlbiBubyBhc3luYyBjb250ZXh0IGV4aXN0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBjdXJyZW50IGNvbnRleHQgY29ubmVjdGlvbi5cbiAgICovXG4gIGdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgaWYgKGlkID09PSBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmIChpZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbigpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIHRoaXMgcG9vbCBoYXMgYSByZWFsIGFzeW5jIGNvbnRleHQgZm9yIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbmVzdGVkIGNvZGUgY2FuIHJldXNlIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICovXG4gIGhhc0N1cnJlbnRDb25uZWN0aW9uQ29udGV4dCgpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGlkICE9PSB1bmRlZmluZWQgJiYgaWQgIT09IFNVUFBSRVNTRURfQ09OTkVDVElPTl9DT05URVhUXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdH0gLSBEaWFnbm9zdGljIHNuYXBzaG90IGZvciB0aGlzIHBvb2wuXG4gICAqL1xuICBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gc3VwZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHtjb25uZWN0aW9uc30gPSB0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90cyhub3cpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uc25hcHNob3QsXG4gICAgICBjb25uZWN0aW9ucyxcbiAgICAgIGNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkOiB0aGlzLmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkLFxuICAgICAgaWRsZUNvdW50OiB0aGlzLmNvbm5lY3Rpb25zLmxlbmd0aCArIFsuLi50aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCldLmZpbHRlcigoY29ubmVjdGlvbikgPT4gY29ubmVjdGlvbi5nZXRJZFNlcSgpID09PSB1bmRlZmluZWQpLmxlbmd0aCxcbiAgICAgIGlkbGVNYXRjaGluZ1BlbmRpbmdDaGVja291dENvdW50OiB0aGlzLmNvbm5lY3Rpb25zLmZpbHRlcigoY29ubmVjdGlvbikgPT4ge1xuICAgICAgICByZXR1cm4gIXRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKVxuICAgICAgICAgICYmIHRoaXMucGVuZGluZ0NoZWNrb3V0cy5zb21lKChjaGVja291dCkgPT4gdGhpcy5jb25uZWN0aW9uTWF0Y2hlc1JldXNlS2V5KGNvbm5lY3Rpb24sIGNoZWNrb3V0LnJldXNlS2V5KSlcbiAgICAgIH0pLmxlbmd0aCxcbiAgICAgIGluVXNlQ291bnQ6IE9iamVjdC5rZXlzKHRoaXMuY29ubmVjdGlvbnNJblVzZSkubGVuZ3RoLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0RHJhaW5BY3RpdmU6IEJvb2xlYW4odGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UpLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQ6IHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQsXG4gICAgICBwZW5kaW5nQ2hlY2tvdXRzOiB0aGlzLnBlbmRpbmdDaGVja291dERlYnVnU25hcHNob3RzKG5vdyksXG4gICAgICBwZW5kaW5nQ2hlY2tvdXRDb3VudDogdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmxlbmd0aCxcbiAgICAgIHRlbGVtZXRyeTogey4uLnRoaXMudGVsZW1ldHJ5fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGNvbm5lY3Rpb24gc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHt7Y29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHNlZW5Db25uZWN0aW9uczogU2V0PGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IC0gQ29ubmVjdGlvbiBzbmFwc2hvdHMgYW5kIHNlZW4gc2V0LlxuICAgKi9cbiAgZGVidWdDb25uZWN0aW9uU25hcHNob3RzKG5vdykge1xuICAgIC8qKlxuICAgICAqIENvbm5lY3Rpb25zLlxuICAgICAqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gW11cbiAgICBjb25zdCBzZWVuQ29ubmVjdGlvbnMgPSBuZXcgU2V0KClcblxuICAgIHRoaXMuYWRkSW5Vc2VEZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMoe2Nvbm5lY3Rpb25zLCBub3csIHNlZW5Db25uZWN0aW9uc30pXG4gICAgdGhpcy5hZGRJZGxlRGVidWdDb25uZWN0aW9uU25hcHNob3RzKHtjb25uZWN0aW9ucywgbm93LCBzZWVuQ29ubmVjdGlvbnN9KVxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgIHRoaXMuYWRkRGVidWdDb25uZWN0aW9uU25hcHNob3RJZlVuc2Vlbih7Y29ubmVjdGlvbiwgY29ubmVjdGlvbnMsIHJlYXBhYmxlOiBmYWxzZSwgc2VlbkNvbm5lY3Rpb25zLCBzdGF0ZTogXCJsaWZlY3ljbGUtcmV0YWluZWRcIn0pXG4gICAgfVxuICAgIHRoaXMuYWRkRmFsbGJhY2tEZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMoe2Nvbm5lY3Rpb25zLCBzZWVuQ29ubmVjdGlvbnN9KVxuXG4gICAgcmV0dXJuIHtjb25uZWN0aW9ucywgc2VlbkNvbm5lY3Rpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGluIHVzZSBkZWJ1ZyBjb25uZWN0aW9uIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIG5vdzogbnVtYmVyLCBzZWVuQ29ubmVjdGlvbnM6IFNldDxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59fSBhcmdzIC0gU25hcHNob3QgY29sbGVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRJblVzZURlYnVnQ29ubmVjdGlvblNuYXBzaG90cyh7Y29ubmVjdGlvbnMsIG5vdywgc2VlbkNvbm5lY3Rpb25zfSkge1xuICAgIGZvciAoY29uc3QgW2lkLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpKSB7XG4gICAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgICBjb25zdCBjaGVja2VkT3V0QXQgPSB0cmFja2VkQ29ubmVjdGlvbltDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXVxuICAgICAgY29uc3QgY2hlY2tlZE91dEZvck1zID0gdHlwZW9mIGNoZWNrZWRPdXRBdCA9PT0gXCJudW1iZXJcIiA/IE1hdGgubWF4KDAsIG5vdyAtIGNoZWNrZWRPdXRBdCkgOiB1bmRlZmluZWRcblxuICAgICAgc2VlbkNvbm5lY3Rpb25zLmFkZChjb25uZWN0aW9uKVxuICAgICAgY29ubmVjdGlvbnMucHVzaCh0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90KGNvbm5lY3Rpb24sIHtjaGVja2VkT3V0QXQsIGNoZWNrZWRPdXRGb3JNcywgY2hlY2tvdXRJZDogaWQsIHN0YXRlOiBcImluLXVzZVwifSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGlkbGUgZGVidWcgY29ubmVjdGlvbiBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBub3c6IG51bWJlciwgc2VlbkNvbm5lY3Rpb25zOiBTZXQ8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fX0gYXJncyAtIFNuYXBzaG90IGNvbGxlY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkSWRsZURlYnVnQ29ubmVjdGlvblNuYXBzaG90cyh7Y29ubmVjdGlvbnMsIG5vdywgc2VlbkNvbm5lY3Rpb25zfSkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICBpZiAoc2VlbkNvbm5lY3Rpb25zLmhhcyhjb25uZWN0aW9uKSkgY29udGludWVcblxuICAgICAgc2VlbkNvbm5lY3Rpb25zLmFkZChjb25uZWN0aW9uKVxuXG4gICAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuICAgICAgY29uc3QgY2hlY2tlZEluQXQgPSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cbiAgICAgIGNvbnN0IGlkbGVGb3JNcyA9IHR5cGVvZiBjaGVja2VkSW5BdCA9PT0gXCJudW1iZXJcIiA/IE1hdGgubWF4KDAsIG5vdyAtIGNoZWNrZWRJbkF0KSA6IHVuZGVmaW5lZFxuXG4gICAgICBjb25uZWN0aW9ucy5wdXNoKHRoaXMuZGVidWdDb25uZWN0aW9uU25hcHNob3QoY29ubmVjdGlvbiwge2NoZWNrZWRJbkF0LCBpZGxlRm9yTXMsIHN0YXRlOiBcImlkbGVcIn0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBmYWxsYmFjayBkZWJ1ZyBjb25uZWN0aW9uIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHNlZW5Db25uZWN0aW9uczogU2V0PGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IGFyZ3MgLSBTbmFwc2hvdCBjb2xsZWN0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZEZhbGxiYWNrRGVidWdDb25uZWN0aW9uU25hcHNob3RzKHtjb25uZWN0aW9ucywgc2VlbkNvbm5lY3Rpb25zfSkge1xuICAgIHRoaXMuYWRkRGVidWdDb25uZWN0aW9uU25hcHNob3RJZlVuc2Vlbih7Y29ubmVjdGlvbjogdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpLCBjb25uZWN0aW9ucywgcmVhcGFibGU6IGZhbHNlLCBzZWVuQ29ubmVjdGlvbnMsIHN0YXRlOiBcImdsb2JhbFwifSlcbiAgICB0aGlzLmFkZERlYnVnQ29ubmVjdGlvblNuYXBzaG90SWZVbnNlZW4oe2Nvbm5lY3Rpb246IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uLCBjb25uZWN0aW9ucywgcmVhcGFibGU6IGZhbHNlLCBzZWVuQ29ubmVjdGlvbnMsIHN0YXRlOiBcInRlc3Qtc2hhcmVkXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGRlYnVnIGNvbm5lY3Rpb24gc25hcHNob3QgaWYgdW5zZWVuLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgY29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHJlYXBhYmxlPzogYm9vbGVhbiwgc2VlbkNvbm5lY3Rpb25zOiBTZXQ8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+LCBzdGF0ZTogc3RyaW5nfX0gYXJncyAtIFNuYXBzaG90IGNvbGxlY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkRGVidWdDb25uZWN0aW9uU25hcHNob3RJZlVuc2Vlbih7Y29ubmVjdGlvbiwgY29ubmVjdGlvbnMsIHJlYXBhYmxlLCBzZWVuQ29ubmVjdGlvbnMsIHN0YXRlfSkge1xuICAgIGlmICghY29ubmVjdGlvbiB8fCBzZWVuQ29ubmVjdGlvbnMuaGFzKGNvbm5lY3Rpb24pKSByZXR1cm5cblxuICAgIHNlZW5Db25uZWN0aW9ucy5hZGQoY29ubmVjdGlvbilcbiAgICBjb25uZWN0aW9ucy5wdXNoKHRoaXMuZGVidWdDb25uZWN0aW9uU25hcHNob3QoY29ubmVjdGlvbiwge3JlYXBhYmxlLCBzdGF0ZX0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVuZGluZyBjaGVja291dCBkZWJ1ZyBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5EYXRhYmFzZVBvb2xQZW5kaW5nQ2hlY2tvdXREZWJ1Z1NuYXBzaG90W119IC0gUGVuZGluZyBjaGVja291dCBzbmFwc2hvdHMuXG4gICAqL1xuICBwZW5kaW5nQ2hlY2tvdXREZWJ1Z1NuYXBzaG90cyhub3cpIHtcbiAgICByZXR1cm4gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLm1hcCgoY2hlY2tvdXQsIGluZGV4KSA9PiAoe1xuICAgICAgY2hlY2tvdXROYW1lOiBjaGVja291dC5vcHRpb25zLm5hbWUsXG4gICAgICBlbnF1ZXVlZEF0OiBjaGVja291dC5lbnF1ZXVlZEF0LFxuICAgICAgaW5kZXgsXG4gICAgICByZW1haW5pbmdUaW1lb3V0TXM6IGNoZWNrb3V0LnRpbWVvdXRBdCA9PT0gbnVsbCA/IG51bGwgOiBNYXRoLm1heCgwLCBjaGVja291dC50aW1lb3V0QXQgLSBub3cpLFxuICAgICAgcmV1c2VLZXk6IGNoZWNrb3V0LnJldXNlS2V5LFxuICAgICAgdGltZW91dEF0OiBjaGVja291dC50aW1lb3V0QXQsXG4gICAgICB0aW1lb3V0TWlsbGlzOiBjaGVja291dC50aW1lb3V0TWlsbGlzLFxuICAgICAgd2FpdGluZ0Zvck1zOiBNYXRoLm1heCgwLCBub3cgLSBjaGVja291dC5lbnF1ZXVlZEF0KVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGdsb2JhbCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGdsb2JhbCBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0R2xvYmFsQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVyblxuICAgIGlmICghdGhpcy5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKGNvbm5lY3Rpb24pKSByZXR1cm5cblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZ2xvYmFsIGNvbm5lY3Rpb24gZm9yIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgZ2xvYmFsIGNvbm5lY3Rpb24gZm9yIHRoaXMgcG9vbCBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKSB7XG4gICAgY29uc3Qga2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVBvb2xBc3luY1RyYWNrZWRNdWx0aUNvbm5lY3Rpb259ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IG1hcEZvckNvbmZpZ3VyYXRpb24gPSBrbGFzcy5nbG9iYWxDb25uZWN0aW9ucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgcmV0dXJuIG1hcEZvckNvbmZpZ3VyYXRpb24/Llt0aGlzLmlkZW50aWZpZXJdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBnbG9iYWwgY29ubmVjdGlvbiBmb3IgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2xlYXJHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpIHtcbiAgICBjb25zdCBrbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUG9vbEFzeW5jVHJhY2tlZE11bHRpQ29ubmVjdGlvbn0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgbWFwRm9yQ29uZmlndXJhdGlvbiA9IGtsYXNzLmdsb2JhbENvbm5lY3Rpb25zLmdldCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIW1hcEZvckNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgZGVsZXRlIG1hcEZvckNvbmZpZ3VyYXRpb25bdGhpcy5pZGVudGlmaWVyXVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBzY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGJ5IGV2ZXJ5IGxpdmUgY29ubmVjdGlvbiBvd25lZCBieSB0aGlzIHBvb2wuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGUoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLnRoaXMuY29ubmVjdGlvbnMsXG4gICAgICAuLi5PYmplY3QudmFsdWVzKHRoaXMuY29ubmVjdGlvbnNJblVzZSksXG4gICAgICB0aGlzLmdldEdsb2JhbENvbm5lY3Rpb24oKSxcbiAgICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXG5cbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIHtcbiAgICAgIGlmIChjb25uZWN0aW9uKSB0aGlzLl9jbGVhckNvbm5lY3Rpb25TY2hlbWFDYWNoZShjb25uZWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlkbGUgdGltZW91dCBtaWxsaXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIElkbGUgdGltZW91dCBpbiBtaWxsaXNlY29uZHMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAgICovXG4gIGlkbGVUaW1lb3V0TWlsbGlzKCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkucG9vbD8uaWRsZVRpbWVvdXRNaWxsaXNcblxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodGhpcy52YWxpZElkbGVUaW1lb3V0TWlsbGlzKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gREVGQVVMVF9JRExFX1RJTUVPVVRfTUlMTElTXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZCBpZGxlIHRpbWVvdXQgbWlsbGlzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBpZGxlIHRpbWVvdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBudW1iZXJ9IC0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSB2YWxpZCBpZGxlIHRpbWVvdXQuXG4gICAqL1xuICB2YWxpZElkbGVUaW1lb3V0TWlsbGlzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVkdWxlIGlkbGUgY29ubmVjdGlvbiByZWFwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBzY2hlZHVsZUlkbGVDb25uZWN0aW9uUmVhcGVyKCkge1xuICAgIGlmICh0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIpIHJldHVyblxuICAgIGlmICghdGhpcy5oYXNJZGxlQ29ubmVjdGlvbnNUb1JlYXAoKSkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxheSA9IHRoaXMubmV4dElkbGVDb25uZWN0aW9uUmVhcERlbGF5KC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAodGhpcy5pZGxlVGltZW91dE1pbGxpcygpKSlcblxuICAgIHRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byByZWFwIGlkbGUgZGF0YWJhc2UgY29ubmVjdGlvbnM6XCIsIGVycm9yXSlcbiAgICAgIH0pXG4gICAgfSwgZGVsYXkpXG5cbiAgICBpZiAodHlwZW9mIHRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIudW5yZWYoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBpZGxlIGNvbm5lY3Rpb25zIHRvIHJlYXAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW4gaWRsZSByZWFwZXIgdGltZXIgc2hvdWxkIGJlIHNjaGVkdWxlZC5cbiAgICovXG4gIGhhc0lkbGVDb25uZWN0aW9uc1RvUmVhcCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9ucy5sZW5ndGggPiAwICYmIHRoaXMuaWRsZVRpbWVvdXRNaWxsaXMoKSAhPT0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBpZGxlIGNvbm5lY3Rpb24gcmVhcCBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGlkbGVUaW1lb3V0TWlsbGlzIC0gSWRsZSB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBiZWZvcmUgdGhlIG5leHQgcmVhcC5cbiAgICovXG4gIG5leHRJZGxlQ29ubmVjdGlvblJlYXBEZWxheShpZGxlVGltZW91dE1pbGxpcykge1xuICAgIGxldCBkZWxheSA9IGlkbGVUaW1lb3V0TWlsbGlzXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgICBjb25zdCBjaGVja2VkSW5BdCA9IHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXVxuXG4gICAgICBpZiAodHlwZW9mIGNoZWNrZWRJbkF0ICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBkZWxheSA9IE1hdGgubWluKGRlbGF5LCBNYXRoLm1heCgwLCBpZGxlVGltZW91dE1pbGxpcyAtIChub3cgLSBjaGVja2VkSW5BdCkpKVxuICAgIH1cblxuICAgIHJldHVybiBkZWxheVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBpZGxlIGNoZWNrZWQtaW4gY29ubmVjdGlvbnMgdGhhdCBoYXZlIGV4Y2VlZGVkIHRoZSBjb25maWd1cmVkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZWFwSWRsZUNvbm5lY3Rpb25zKCkge1xuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBpZGxlVGltZW91dE1pbGxpcyA9IHRoaXMuaWRsZVRpbWVvdXRNaWxsaXMoKVxuXG4gICAgaWYgKGlkbGVUaW1lb3V0TWlsbGlzID09PSBudWxsKSByZXR1cm5cbiAgICBjb25zdCBzdGFydGVkQXQgPSB0aGlzLm5vd01zKClcbiAgICBjb25zdCBwcm9maWxlQ29udGV4dCA9IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qge2V4cGlyZWRDb25uZWN0aW9ucywga2VwdENvbm5lY3Rpb25zfSA9IHRoaXMuY2xhc3NpZnlJZGxlQ29ubmVjdGlvbnNGb3JSZWFwaW5nKHtpZGxlVGltZW91dE1pbGxpcywgbm93OiB0aGlzLm5vd01zKCl9KVxuXG4gICAgICB0aGlzLmNvbm5lY3Rpb25zID0ga2VwdENvbm5lY3Rpb25zXG4gICAgICBhd2FpdCB0aGlzLmNsb3NlRXhwaXJlZElkbGVDb25uZWN0aW9ucyhleHBpcmVkQ29ubmVjdGlvbnMsIHByb2ZpbGVDb250ZXh0KVxuICAgICAgYXdhaXQgdGhpcy5hd2FpdEluZmxpZ2h0Q29ubmVjdGlvbkNsb3NlcygpXG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5sZW5ndGggPiAwKSB0aGlzLnNjaGVkdWxlSWRsZUNvbm5lY3Rpb25SZWFwZXIoKVxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgZHVyYXRpb25NcyA9IE1hdGgubWF4KDAsIHRoaXMubm93TXMoKSAtIHN0YXJ0ZWRBdClcblxuICAgICAgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBDb3VudCsrXG4gICAgICBpZiAoZmFpbGVkKSB0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcEZhaWx1cmVDb3VudCsrXG4gICAgICB0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcFRvdGFsTXMgKz0gZHVyYXRpb25Nc1xuICAgICAgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBNYXhNcyA9IE1hdGgubWF4KHRoaXMudGVsZW1ldHJ5LmlkbGVSZWFwTWF4TXMsIGR1cmF0aW9uTXMpXG4gICAgICB0aGlzLnJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhwcm9maWxlQ29udGV4dCwgXCJpZGxlUmVhcFwiLCB7ZHVyYXRpb25NcywgZmFpbGVkfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBleHBpcmVkIGlkbGUgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXX0gZXhwaXJlZENvbm5lY3Rpb25zIC0gQ29ubmVjdGlvbnMgdG8gY2xvc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBbcHJvZmlsZUNvbnRleHRdIC0gUmVhcGVyIHByb2ZpbGUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBjbG9zZUV4cGlyZWRJZGxlQ29ubmVjdGlvbnMoZXhwaXJlZENvbm5lY3Rpb25zLCBwcm9maWxlQ29udGV4dCkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBleHBpcmVkQ29ubmVjdGlvbnMpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgICB0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcERpc3Bvc2FsQ291bnQrK1xuICAgICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMocHJvZmlsZUNvbnRleHQsIFwiaWRsZVJlYXBEaXNwb3NhbFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF3YWl0IGluZmxpZ2h0IGNvbm5lY3Rpb24gY2xvc2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIGluLWZsaWdodCBjb25uZWN0aW9uIGNsb3NlcyBzZXR0bGUuXG4gICAqL1xuICBhc3luYyBhd2FpdEluZmxpZ2h0Q29ubmVjdGlvbkNsb3NlcygpIHtcbiAgICBpZiAodGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXMuc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4udGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXNdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsYXNzaWZ5IGlkbGUgY29ubmVjdGlvbnMgZm9yIHJlYXBpbmcuXG4gICAqIEBwYXJhbSB7e2lkbGVUaW1lb3V0TWlsbGlzOiBudW1iZXIsIG5vdzogbnVtYmVyfX0gYXJncyAtIFJlYXBlciBjbGFzc2lmaWNhdGlvbiBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHt7ZXhwaXJlZENvbm5lY3Rpb25zOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdLCBrZXB0Q29ubmVjdGlvbnM6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W119fSAtIENsYXNzaWZpZWQgaWRsZSBjb25uZWN0aW9ucy5cbiAgICovXG4gIGNsYXNzaWZ5SWRsZUNvbm5lY3Rpb25zRm9yUmVhcGluZyh7aWRsZVRpbWVvdXRNaWxsaXMsIG5vd30pIHtcbiAgICAvKipcbiAgICAgKiBLZXB0IGNvbm5lY3Rpb25zLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IGtlcHRDb25uZWN0aW9ucyA9IFtdXG4gICAgLyoqXG4gICAgICogRXhwaXJlZCBjb25uZWN0aW9ucy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBleHBpcmVkQ29ubmVjdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIHRoaXMuY2xhc3NpZnlJZGxlQ29ubmVjdGlvbkZvclJlYXBpbmcoe2Nvbm5lY3Rpb24sIGV4cGlyZWRDb25uZWN0aW9ucywgaWRsZVRpbWVvdXRNaWxsaXMsIGtlcHRDb25uZWN0aW9ucywgbm93fSlcbiAgICB9XG5cbiAgICByZXR1cm4ge2V4cGlyZWRDb25uZWN0aW9ucywga2VwdENvbm5lY3Rpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xhc3NpZnkgaWRsZSBjb25uZWN0aW9uIGZvciByZWFwaW5nLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZXhwaXJlZENvbm5lY3Rpb25zOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdLCBpZGxlVGltZW91dE1pbGxpczogbnVtYmVyLCBrZXB0Q29ubmVjdGlvbnM6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W10sIG5vdzogbnVtYmVyfX0gYXJncyAtIENsYXNzaWZpY2F0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsYXNzaWZ5SWRsZUNvbm5lY3Rpb25Gb3JSZWFwaW5nKHtjb25uZWN0aW9uLCBleHBpcmVkQ29ubmVjdGlvbnMsIGlkbGVUaW1lb3V0TWlsbGlzLCBrZXB0Q29ubmVjdGlvbnMsIG5vd30pIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uSXNDbG9zZWQoY29ubmVjdGlvbikpIHJldHVyblxuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIHtcbiAgICAgIGtlcHRDb25uZWN0aW9ucy5wdXNoKGNvbm5lY3Rpb24pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLmlkbGVDb25uZWN0aW9uRXhwaXJlZCh7Y29ubmVjdGlvbiwgaWRsZVRpbWVvdXRNaWxsaXMsIG5vd30pID8gZXhwaXJlZENvbm5lY3Rpb25zIDoga2VwdENvbm5lY3Rpb25zXG5cbiAgICB0YXJnZXQucHVzaChjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdGlvbiBpcyBjbG9zZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgbWFya2VkIGNsb3NlZC5cbiAgICovXG4gIGNvbm5lY3Rpb25Jc0Nsb3NlZChjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDTE9TRURfQ09OTkVDVElPTl0/OiBib29sZWFufX0gKi8gKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gQm9vbGVhbih0cmFja2VkQ29ubmVjdGlvbltDTE9TRURfQ09OTkVDVElPTl0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpZGxlIGNvbm5lY3Rpb24gZXhwaXJlZC5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGlkbGVUaW1lb3V0TWlsbGlzOiBudW1iZXIsIG5vdzogbnVtYmVyfX0gYXJncyAtIEV4cGlyeSBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGlkbGUgY29ubmVjdGlvbiBleHBpcmVkLlxuICAgKi9cbiAgaWRsZUNvbm5lY3Rpb25FeHBpcmVkKHtjb25uZWN0aW9uLCBpZGxlVGltZW91dE1pbGxpcywgbm93fSkge1xuICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgY29uc3QgY2hlY2tlZEluQXQgPSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cblxuICAgIHJldHVybiB0eXBlb2YgY2hlY2tlZEluQXQgPT09IFwibnVtYmVyXCIgJiYgbm93IC0gY2hlY2tlZEluQXQgPj0gaWRsZVRpbWVvdXRNaWxsaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24gaGFzIG9wZW4gdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaGFzIGFuIG9wZW4gdHJhbnNhY3Rpb24uXG4gICAqL1xuICBjb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gY29ubmVjdGlvbi5fdHJhbnNhY3Rpb25zQ291bnQgPiAwXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBhbnkgdHJhbnNhY3Rpb24gYSBwcmV2aW91cyBob2xkZXIgbGVmdCBvcGVuIGJlZm9yZSBhIGNvbm5lY3Rpb25cbiAgICogcmUtZW50ZXJzIHRoZSBpZGxlIHBvb2wuIEEgY29ubmVjdGlvbiByZXR1cm5lZCB0byB0aGUgcG9vbCB3aXRoIGFuIG9wZW5cbiAgICogdHJhbnNhY3Rpb24gd291bGQgb3RoZXJ3aXNlIGJlIGhhbmRlZCB0byBhbiB1bnJlbGF0ZWQgY2hlY2tvdXQsIHdob3NlXG4gICAqIHN0YXJ0VHJhbnNhY3Rpb24oKSB0aGVuIGZhaWxzIHdpdGggXCJBIHRyYW5zYWN0aW9uIGlzIGFscmVhZHkgcnVubmluZ1wiIGFuZFxuICAgKiBwb2lzb25zIGV2ZXJ5IGZvbGxvd2luZyBjYWxsZXIgdGhhdCByZXVzZXMgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIGJlaW5nIGNoZWNrZWQgaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvbm5lY3Rpb24gaG9sZHMgbm8gb3BlbiB0cmFuc2FjdGlvbi5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrTGVmdE9wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIHJldHVyblxuXG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbYFJvbGxpbmcgYmFjayBhIHRyYW5zYWN0aW9uIGxlZnQgb3BlbiBvbiBhIGNvbm5lY3Rpb24gYmVpbmcgY2hlY2tlZCBpbiAoaWRlbnRpZmllcj0ke3RoaXMuaWRlbnRpZmllcn0pLmBdKVxuXG4gICAgd2hpbGUgKHRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKSkge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0byBjbG9zZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgLy8gSWRlbXBvdGVudDogYSBmaXJlLWFuZC1mb3JnZXQgc2NoZWR1bGVkIHJlYXAgYW5kIGFuIGV4cGxpY2l0IHJlYXAgY2FuIGJvdGhcbiAgICAvLyB0YXJnZXQgdGhlIHNhbWUgY29ubmVjdGlvbi4gQXdhaXQgdGhlIGluLWZsaWdodCBjbG9zZSBpbnN0ZWFkIG9mIGNsb3NpbmdcbiAgICAvLyB0d2ljZSAod2hpY2ggY2FuIHRocm93IG9uIHRoZSBkcml2ZXIpIG9yIHJldHVybmluZyB3aGlsZSB0aGUgdW5kZXJseWluZ1xuICAgIC8vIGhhbmRsZSBpcyBzdGlsbCBvcGVuLlxuICAgIGNvbnN0IGV4aXN0aW5nQ2xvc2UgPSB0aGlzLmNvbm5lY3Rpb25DbG9zZVByb21pc2VzLmdldChjb25uZWN0aW9uKVxuXG4gICAgaWYgKGV4aXN0aW5nQ2xvc2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCBleGlzdGluZ0Nsb3NlXG4gICAgfVxuXG4gICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDTE9TRURfQ09OTkVDVElPTl0/OiBib29sZWFuLCBbQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF0/OiBudW1iZXIsIFtJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF0/OiBudW1iZXJ9fSAqLyAoY29ubmVjdGlvbilcblxuICAgIGZvciAoY29uc3QgW3JldXNlS2V5LCByZXRhaW5lZENvbm5lY3Rpb25dIG9mIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucykge1xuICAgICAgaWYgKHJldGFpbmVkQ29ubmVjdGlvbiA9PT0gY29ubmVjdGlvbikgdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLmRlbGV0ZShyZXVzZUtleSlcbiAgICB9XG5cbiAgICB0cmFja2VkQ29ubmVjdGlvbltDTE9TRURfQ09OTkVDVElPTl0gPSB0cnVlXG4gICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdXG4gICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXVxuXG4gICAgY29uc3QgY2xvc2VQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRyYWNrZWRDb25uZWN0aW9uLmNsb3NlKClcbiAgICB9KSgpXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25DbG9zZVByb21pc2VzLnNldChjb25uZWN0aW9uLCBjbG9zZVByb21pc2UpXG4gICAgdGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXMuYWRkKGNsb3NlUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG9zZVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXMuZGVsZXRlKGNsb3NlUHJvbWlzZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBpZGxlIGNvbm5lY3Rpb24gcmVhcGVyIHRpbWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgY2xlYXJJZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKCkge1xuICAgIGlmICghdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKSByZXR1cm5cblxuICAgIGNsZWFyVGltZW91dCh0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIpXG4gICAgdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFsbCBhY3RpdmUgYW5kIGNhY2hlZCBjb25uZWN0aW9ucyBmb3IgdGhpcyBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VBbGwoKSB7XG4gICAgdGhpcy5jbGVhcklkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIoKVxuICAgIHRoaXMucmVqZWN0UGVuZGluZ0NoZWNrb3V0cyhuZXcgRXJyb3IoXCJEYXRhYmFzZSBwb29sIHdhcyBjbG9zZWQgYmVmb3JlIGNoZWNrb3V0IGNvbXBsZXRlZC5cIikpXG5cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IG5ldyBTZXQoW1xuICAgICAgLi4udGhpcy5jb25uZWN0aW9ucyxcbiAgICAgIC4uLk9iamVjdC52YWx1ZXModGhpcy5jb25uZWN0aW9uc0luVXNlKSxcbiAgICAgIC4uLnRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy52YWx1ZXMoKSxcbiAgICAgIHRoaXMuZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKSxcbiAgICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gW11cbiAgICB0aGlzLmNvbm5lY3Rpb25zSW5Vc2UgPSB7fVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5jbGVhcigpXG4gICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5jbGVhcigpXG4gICAgdGhpcy5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKClcbiAgICB0aGlzLmNsZWFyR2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIGNvbm5lY3Rpb25zKSB7XG4gICAgICBpZiAoIWNvbm5lY3Rpb24pIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgfVxuXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWplY3QgcGVuZGluZyBjaGVja291dHMuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdG8gcmVqZWN0IHBlbmRpbmcgY2hlY2tvdXRzIHdpdGguXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVqZWN0UGVuZGluZ0NoZWNrb3V0cyhlcnJvcikge1xuICAgIGNvbnN0IHBlbmRpbmdDaGVja291dHMgPSB0aGlzLnBlbmRpbmdDaGVja291dHNcblxuICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNoZWNrb3V0IG9mIHBlbmRpbmdDaGVja291dHMpIHtcbiAgICAgIHRoaXMuY2xlYXJQZW5kaW5nQ2hlY2tvdXRUaW1lb3V0KGNoZWNrb3V0KVxuICAgICAgY2hlY2tvdXQucmVqZWN0KGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyBhbGwgZ2xvYmFsbHkgcmVnaXN0ZXJlZCBmYWxsYmFjayBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IFtjb25uZWN0aW9uc10gLSBDb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRHbG9iYWxDb25uZWN0aW9ucyhjb25uZWN0aW9ucywgY29uZmlndXJhdGlvbikge1xuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgdGhpcy5nbG9iYWxDb25uZWN0aW9ucyA9IG5ldyBXZWFrTWFwKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuZ2xvYmFsQ29ubmVjdGlvbnMuc2V0KGNvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb25zIHx8IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBnbG9iYWxseSByZWdpc3RlcmVkIGZhbGxiYWNrIGNvbm5lY3Rpb25zIGZvciBhbGwgY29uZmlndXJhdGlvbnMgb3IgYSBzaW5nbGUgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBjbGVhckdsb2JhbENvbm5lY3Rpb25zKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRoaXMuZ2xvYmFsQ29ubmVjdGlvbnMgPSBuZXcgV2Vha01hcCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmdsb2JhbENvbm5lY3Rpb25zLmRlbGV0ZShjb25maWd1cmF0aW9uKVxuICB9XG59XG4iXX0=