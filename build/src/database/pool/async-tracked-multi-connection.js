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
            if (!matches())
                continue;
            const connection = provider();
            if (connection && !this.connectionMatchesCurrentConfiguration(connection)) {
                throw new Error(`Test shared connection provider for ${this.identifier} returned a connection for a different database configuration`);
            }
            return connection;
        }
        return undefined;
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
        if (this._testSharedConnectionProviders.size > 0 && !this.connectionMatchesCurrentConfiguration(currentConnection)) {
            const perTenantConnection = this.testSharedConnectionForCurrentTenant();
            if (perTenantConnection)
                return perTenantConnection;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3Bvb2wvYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDL0MsT0FBTyxRQUFRLEVBQUUsRUFBRSxzQkFBc0IsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUM1RCxPQUFPLGdDQUFnQyxNQUFNLDZCQUE2QixDQUFBO0FBQzFFLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxNQUFNLHVDQUF1QyxDQUFBO0FBRWpGOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsTUFBTSxDQUFDLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLDJCQUEyQixDQUFDLENBQUE7QUFDcEUsTUFBTSw2QkFBNkIsR0FBRyxNQUFNLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtBQUNsRixNQUFNLHlCQUF5QixHQUFHLE1BQU0sQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO0FBQzNFLE1BQU0sNkJBQTZCLEdBQUcsTUFBTSxDQUFDLHNDQUFzQyxDQUFDLENBQUE7QUFDcEYsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUE7QUFDbEMsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLENBQUE7QUFDeEMsTUFBTSwrQkFBK0IsR0FBRyxLQUFLLENBQUE7QUFFN0MsTUFBTSxDQUFDLE9BQU8sT0FBTyxnREFBaUQsU0FBUSxRQUFRO0lBQ3BGOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBRXhDLGlCQUFpQixHQUFHLElBQUksaUJBQWlCLEVBQUUsQ0FBQTtJQUUzQzs7Ozs7T0FLRztJQUNILHFCQUFxQixHQUFHLFNBQVMsQ0FBQTtJQUVqQzs7O09BR0c7SUFDSCw2QkFBNkIs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RTFCLEtBQUssTUFBTSxRQUFRLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsMkJBQTJCLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDMUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN4QixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsTUFBTSxDQUFDLG9CQUFvQixDQUFDLFdBQVcsRUFBRSxhQUFhO1FBQ3BELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtZQUN0QyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxzQkFBc0IsQ0FBQyxhQUFhO1FBQ3pDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtZQUN0QyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUE7SUFDOUMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSBcImFzeW5jX2hvb2tzXCJcbmltcG9ydCBCYXNlUG9vbCwgeyBQT09MX0NPTkZJR1VSQVRJT05fS0VZIH0gZnJvbSBcIi4vYmFzZS5qc1wiXG5pbXBvcnQgRGF0YWJhc2VQb29sQ2hlY2tvdXRUaW1lb3V0RXJyb3IgZnJvbSBcIi4vY2hlY2tvdXQtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQgeyBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0IH0gZnJvbSBcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlLWNvbnRleHQuanNcIlxuXG4vKipcbiAqIFBlbmRpbmdDaGVja291dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUGVuZGluZ0NoZWNrb3V0XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWcgLSBSZXNvbHZlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uIG5lZWRlZCBieSB0aGUgY2hlY2tvdXQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gZW5xdWV1ZWRBdCAtIFRpbWVzdGFtcCB3aGVuIHRoZSBjaGVja291dCBzdGFydGVkIHdhaXRpbmcuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBvcHRpb25zIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXVzZUtleSAtIERhdGFiYXNlIGNvbmZpZ3VyYXRpb24gcmV1c2Uga2V5IG5lZWRlZCBieSB0aGUgY2hlY2tvdXQuXG4gKiBAcHJvcGVydHkgeyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gdm9pZH0gcmVzb2x2ZSAtIFJlc29sdmVzIHdpdGggYW4gYWN0aXZhdGVkIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9IHJlamVjdCAtIFJlamVjdHMgd2hlbiBjaGVja291dCBjYW5ub3QgY29tcGxldGUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRBdCAtIFRpbWVzdGFtcCB3aGVuIHRoZSBjaGVja291dCB3aWxsIHRpbWUgb3V0LCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNaWxsaXMgLSBNaWxsaXNlY29uZHMgdG8gd2FpdCBiZWZvcmUgcmVqZWN0aW5nLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSB0aW1lb3V0VGltZXIgLSBUaW1lciB0aGF0IHJlamVjdHMgdGhlIHBlbmRpbmcgY2hlY2tvdXQuXG4gKiBAcHJvcGVydHkge3tyZXZva2VkOiBib29sZWFufSB8IHVuZGVmaW5lZH0gW3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlXSAtIERhdGFiYXNlLWFjY2VzcyBzY29wZSBjYXB0dXJlZCBhdCBlbnF1ZXVlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IFt0ZXN0UHJvZmlsZUNvbnRleHRdIC0gQXN5bmMtc2FmZSBwcm9maWxlIGF0dHJpYnV0aW9uIGNhcHR1cmVkIGF0IGVucXVldWUuXG4gKi9cbmV4cG9ydCBjb25zdCBDTE9TRURfQ09OTkVDVElPTiA9IFN5bWJvbChcInZlbG9jaW91c0Nsb3NlZENvbm5lY3Rpb25cIilcbmNvbnN0IElETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUID0gU3ltYm9sKFwidmVsb2Npb3VzSWRsZUNvbm5lY3Rpb25DaGVja2VkSW5BdFwiKVxuY29uc3QgQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVCA9IFN5bWJvbChcInZlbG9jaW91c0Nvbm5lY3Rpb25DaGVja2VkT3V0QXRcIilcbmNvbnN0IFNVUFBSRVNTRURfQ09OTkVDVElPTl9DT05URVhUID0gU3ltYm9sKFwidmVsb2Npb3VzU3VwcHJlc3NlZENvbm5lY3Rpb25Db250ZXh0XCIpXG5jb25zdCBERUZBVUxUX01BWF9DT05ORUNUSU9OUyA9IDEwXG5jb25zdCBERUZBVUxUX0lETEVfVElNRU9VVF9NSUxMSVMgPSA1MDAwXG5jb25zdCBERUZBVUxUX0NIRUNLT1VUX1RJTUVPVVRfTUlMTElTID0gMTAwMDBcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VQb29sQXN5bmNUcmFja2VkTXVsdGlDb25uZWN0aW9uIGV4dGVuZHMgQmFzZVBvb2wge1xuICAvKipcbiAgICogR2xvYmFsIGZhbGxiYWNrIGNvbm5lY3Rpb25zIGtleWVkIGJ5IGNvbmZpZ3VyYXRpb24gaW5zdGFuY2UgYW5kIHBvb2wgaWRlbnRpZmllci5cbiAgICogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD4+fVxuICAgKi9cbiAgc3RhdGljIGdsb2JhbENvbm5lY3Rpb25zID0gbmV3IFdlYWtNYXAoKVxuXG4gIGFzeW5jTG9jYWxTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcblxuICAvKipcbiAgICogV2hlbiBzZXQsIHJldHVybmVkIGJ5IGdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbiB3aGVuIG5vIGFzeW5jIGNvbnRleHQgZXhpc3RzLlxuICAgKiBVc2VkIGJ5IHRoZSB0ZXN0IHJ1bm5lciB0byBzaGFyZSBhIGNvbm5lY3Rpb24gYmV0d2VlbiB0ZXN0IGNvZGUgYW5kIEhUVFAgaGFuZGxlcnNcbiAgICogcnVubmluZyBpbiB0aGUgc2FtZSBwcm9jZXNzIChpbi1wcm9jZXNzIHRlc3Qgc2VydmVyIG1vZGUpLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9XG4gICAqL1xuICBfdGVzdFNoYXJlZENvbm5lY3Rpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRHluYW1pY2FsbHkgcmVzb2x2ZXMgdGhlIGNvbm5lY3Rpb24gZWxpZ2libGUgZm9yIGluLXByb2Nlc3MgdGVzdCByZXF1ZXN0IHNoYXJpbmcuXG4gICAqIEB0eXBlIHsoKCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQpIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogSWRlbnRpZmllcyB0aGUgbGlmZWN5Y2xlIHRoYXQgaW5zdGFsbGVkIHRoZSBjdXJyZW50IHNoYXJlZCBjb25uZWN0aW9uIG9yIHByb3ZpZGVyLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqIEF0dGVtcHQtb3duZWQgc2hhcmVkIGNvbm5lY3Rpb25zIGtleWVkIGJ5IHJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uICovXG4gIF90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5ID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIENvbmN1cnJlbnQgcHJvdmlkZXJzIHNlbGVjdGVkIGJ5IGxpdmUgYXN5bmMgam9pbiBjb250ZXh0LlxuICAgKiBAdHlwZSB7TWFwPGltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiwge21hdGNoZXM6ICgpID0+IGJvb2xlYW4sIHByb3ZpZGVyOiAoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0+fVxuICAgKi9cbiAgX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIENvbm5lY3Rpb25zLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgY29ubmVjdGlvbnMgPSBbXVxuXG4gIC8qKlxuICAgKiBQaHlzaWNhbCBpZGVudGl0aWVzIHJlcXVlc3RlZCB0byByZW1haW4gcmVzaWRlbnQgYnkgdGhlIGZyb250ZW5kIHRlbmFudCBsaWZlY3ljbGUuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn1cbiAgICovXG4gIGxpZmVjeWNsZVJldGFpbmVkUmV1c2VLZXlzID0gbmV3IFNldCgpXG5cbiAgLyoqXG4gICAqIFBhcmtlZCBsaWZlY3ljbGUtb3duZWQgY29ubmVjdGlvbnMga2V5ZWQgYnkgcGh5c2ljYWwgaWRlbnRpdHkuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59XG4gICAqL1xuICBsaWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIENvbm5lY3Rpb25zIGluIHVzZS5cbiAgICogQHR5cGUge1JlY29yZDxudW1iZXIsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgY29ubmVjdGlvbnNJblVzZSA9IHt9XG5cbiAgLyoqXG4gICAqIFBlbmRpbmcgY2hlY2tvdXRzLlxuICAgKiBAdHlwZSB7UGVuZGluZ0NoZWNrb3V0W119ICovXG4gIHBlbmRpbmdDaGVja291dHMgPSBbXVxuXG4gIC8qKlxuICAgKiBDb25uZWN0aW9ucyBiZWluZyBzcGF3bmVkLlxuICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICBjb25uZWN0aW9uc0JlaW5nU3Bhd25lZCA9IDBcblxuICAvKipcbiAgICogUGVuZGluZyBjaGVja291dCBkcmFpbiBwcm9taXNlLlxuICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgcGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG5cbiAgLyoqIFdoZXRoZXIgYSBjYWxsZXIgcmVxdWVzdGVkIGFub3RoZXIgcGFzcyB0aHJvdWdoIHRoZSBwZW5kaW5nIGNoZWNrb3V0IHF1ZXVlLiAqL1xuICBwZW5kaW5nQ2hlY2tvdXREcmFpblJlcXVlc3RlZCA9IGZhbHNlXG5cbiAgLyoqXG4gICAqIElkbGUgY29ubmVjdGlvbiByZWFwZXIgdGltZXIuXG4gICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lciA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBJbi1mbGlnaHQgY29ubmVjdGlvbi1jbG9zZSBwcm9taXNlcy4gVGhlIGlkbGUgcmVhcGVyIGlzIGFybWVkIG9uIGNoZWNrLWluXG4gICAqIGFuZCBydW5zIGZpcmUtYW5kLWZvcmdldCB3aGVuIGl0cyB0aW1lciBmaXJlcywgc28gYSBzY2hlZHVsZWQgcmVhcCBjYW4gYmVcbiAgICogY2xvc2luZyBhIGNvbm5lY3Rpb24gd2hpbGUgYW4gZXhwbGljaXQgYHJlYXBJZGxlQ29ubmVjdGlvbnMoKWAgKG9yXG4gICAqIGBjbGVhcklkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIoKWApIHJ1bnMuIFRyYWNraW5nIHRoZSBpbi1mbGlnaHQgY2xvc2VzIGxldHNcbiAgICogdGhvc2UgY2FsbGVycyBhd2FpdCB0aGVtLCBzbyBvbmNlIGEgcmVhcCByZXNvbHZlcyB0aGUgY29ubmVjdGlvbnMgaXRcbiAgICogZXhwaXJlZCBhcmUgZnVsbHkgY2xvc2VkIGluc3RlYWQgb2YgaGFsZi1jbG9zZWQgbWlkLWBjbG9zZSgpYC5cbiAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICovXG4gIGluZmxpZ2h0Q29ubmVjdGlvbkNsb3NlcyA9IG5ldyBTZXQoKVxuXG4gIC8qKlxuICAgKiBJbi1mbGlnaHQgY2xvc2UgcHJvbWlzZSBwZXIgY29ubmVjdGlvbiwgc28gY29uY3VycmVudCBjbG9zZXMgb2YgdGhlIHNhbWVcbiAgICogY29ubmVjdGlvbiBhd2FpdCB0aGUgc2FtZSBjbG9zZSByYXRoZXIgdGhhbiBjbG9zaW5nIHRoZSBkcml2ZXIgaGFuZGxlIHR3aWNlLlxuICAgKiBAdHlwZSB7V2Vha01hcDxvYmplY3QsIFByb21pc2U8dm9pZD4+fVxuICAgKi9cbiAgY29ubmVjdGlvbkNsb3NlUHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG5cbiAgLyoqIEN1bXVsYXRpdmUgbG93LWNhcmRpbmFsaXR5IHBvb2wgdGVsZW1ldHJ5LiAqL1xuICB0ZWxlbWV0cnkgPSB7XG4gICAgY29ubmVjdGlvbkNyZWF0aW9uQ291bnQ6IDAsXG4gICAgY29ubmVjdGlvbkNyZWF0aW9uRmFpbHVyZUNvdW50OiAwLFxuICAgIGNvbm5lY3Rpb25DcmVhdGlvbk1heE1zOiAwLFxuICAgIGNvbm5lY3Rpb25DcmVhdGlvblRvdGFsTXM6IDAsXG4gICAgY2hlY2tvdXRUaW1lb3V0Q291bnQ6IDAsXG4gICAgY2hlY2tvdXRXYWl0Q291bnQ6IDAsXG4gICAgY2hlY2tvdXRXYWl0TWF4TXM6IDAsXG4gICAgY2hlY2tvdXRXYWl0VG90YWxNczogMCxcbiAgICBpZGxlUmVhcENvdW50OiAwLFxuICAgIGlkbGVSZWFwRGlzcG9zYWxDb3VudDogMCxcbiAgICBpZGxlUmVhcEZhaWx1cmVDb3VudDogMCxcbiAgICBpZGxlUmVhcE1heE1zOiAwLFxuICAgIGlkbGVSZWFwVG90YWxNczogMCxcbiAgICBwZWFrTGl2ZUNvbm5lY3Rpb25zOiAwXG4gIH1cblxuICBpZFNlcSA9IDBcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkZW50aWZpZXIgLSBJZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGlkZW50aWZpZXJ9KSB7XG4gICAgc3VwZXIoe2NvbmZpZ3VyYXRpb24sIGlkZW50aWZpZXJ9KVxuICAgIC8qKlxuICAgICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRob3V0IHRoZSBpbmhlcml0ZWQgY3VycmVudCBjb25uZWN0aW9uIGNvbnRleHQuXG4gICAgICogQHR5cGUgeyhjYWxsYmFjazogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fVxuICAgICAqL1xuICAgIGNvbnN0IHdpdGhvdXRDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQgPSAoY2FsbGJhY2spID0+IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UucnVuKFNVUFBSRVNTRURfQ09OTkVDVElPTl9DT05URVhULCBjYWxsYmFjaylcbiAgICB0aGlzLl93aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0ID0gd2l0aG91dEN1cnJlbnRDb25uZWN0aW9uQ29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHBvb2wgdGVsZW1ldHJ5IGNsb2NrLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEN1cnJlbnQgdGltZSBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBub3dNcygpIHsgcmV0dXJuIERhdGUubm93KCkgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcG9vbCBtZXRyaWMgaW4gdGhlIGFjdGl2ZSBhc3luYy1zYWZlIHRlc3QgcHJvZmlsZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gY29udGV4dCAtIENhcHR1cmVkIHByb2ZpbGUgY29udGV4dC5cbiAgICogQHBhcmFtIHtcImNvbm5lY3Rpb25DcmVhdGlvblwiIHwgXCJjaGVja291dFdhaXRcIiB8IFwiY2hlY2tvdXRUaW1lb3V0XCIgfCBcImlkbGVSZWFwXCIgfCBcImlkbGVSZWFwRGlzcG9zYWxcIiB8IFwicGVha0xpdmVDb25uZWN0aW9uc1wifSBtZXRyaWMgLSBNZXRyaWMgbmFtZS5cbiAgICogQHBhcmFtIHt7ZHVyYXRpb25Ncz86IG51bWJlciwgZmFpbGVkPzogYm9vbGVhbiwgdmFsdWU/OiBudW1iZXJ9fSBbdmFsdWVzXSAtIEFnZ3JlZ2F0ZSB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGVzdFByb2ZpbGVQb29sTWV0cmljKGNvbnRleHQsIG1ldHJpYywgdmFsdWVzID0ge30pIHtcbiAgICBpZiAoIWNvbnRleHQpIHJldHVyblxuXG4gICAgY29udGV4dC5wcm9maWxlci5yZWNvcmRQb29sTWV0cmljKGNvbnRleHQsIHRoaXMuaWRlbnRpZmllciwgbWV0cmljLCB2YWx1ZXMpXG4gIH1cblxuICAvKipcbiAgICogU3Bhd25zIGFuZCB0aW1lcyBhIHBoeXNpY2FsIGNvbm5lY3Rpb24gd2l0aG91dCByZXRhaW5pbmcgaXRzIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBjb25maWcgLSBSZXNvbHZlZCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3JldXNlS2V5XSAtIEV4YWN0IHJlc29sdmVkIHBoeXNpY2FsIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gQ29ubmVjdGVkIGRyaXZlci5cbiAgICovXG4gIGFzeW5jIHNwYXduQ29ubmVjdGlvbldpdGhDb25maWd1cmF0aW9uKGNvbmZpZywgcmV1c2VLZXkpIHtcbiAgICBjb25zdCBzdGFydGVkQXQgPSB0aGlzLm5vd01zKClcbiAgICBjb25zdCBwcm9maWxlQ29udGV4dCA9IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHN1cGVyLnNwYXduQ29ubmVjdGlvbldpdGhDb25maWd1cmF0aW9uKGNvbmZpZywgcmV1c2VLZXkpXG5cbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICBjb25zdCBsaXZlQ29ubmVjdGlvbkNvdW50ID0gdGhpcy5saXZlQ29ubmVjdGlvbkNvdW50KCkgLSB0aGlzLmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkICsgMVxuXG4gICAgICBpZiAobGl2ZUNvbm5lY3Rpb25Db3VudCA+IHRoaXMudGVsZW1ldHJ5LnBlYWtMaXZlQ29ubmVjdGlvbnMpIHtcbiAgICAgICAgdGhpcy50ZWxlbWV0cnkucGVha0xpdmVDb25uZWN0aW9ucyA9IGxpdmVDb25uZWN0aW9uQ291bnRcbiAgICAgICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMocHJvZmlsZUNvbnRleHQsIFwicGVha0xpdmVDb25uZWN0aW9uc1wiLCB7dmFsdWU6IGxpdmVDb25uZWN0aW9uQ291bnR9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29ubmVjdGlvblxuICAgIH0gZmluYWxseSB7XG4gICAgICBjb25zdCBkdXJhdGlvbk1zID0gTWF0aC5tYXgoMCwgdGhpcy5ub3dNcygpIC0gc3RhcnRlZEF0KVxuXG4gICAgICB0aGlzLnRlbGVtZXRyeS5jb25uZWN0aW9uQ3JlYXRpb25Db3VudCsrXG4gICAgICBpZiAoZmFpbGVkKSB0aGlzLnRlbGVtZXRyeS5jb25uZWN0aW9uQ3JlYXRpb25GYWlsdXJlQ291bnQrK1xuICAgICAgdGhpcy50ZWxlbWV0cnkuY29ubmVjdGlvbkNyZWF0aW9uVG90YWxNcyArPSBkdXJhdGlvbk1zXG4gICAgICB0aGlzLnRlbGVtZXRyeS5jb25uZWN0aW9uQ3JlYXRpb25NYXhNcyA9IE1hdGgubWF4KHRoaXMudGVsZW1ldHJ5LmNvbm5lY3Rpb25DcmVhdGlvbk1heE1zLCBkdXJhdGlvbk1zKVxuICAgICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMocHJvZmlsZUNvbnRleHQsIFwiY29ubmVjdGlvbkNyZWF0aW9uXCIsIHtkdXJhdGlvbk1zLCBmYWlsZWR9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoZWNraW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBEYXRhYmFzZSBjb25uZWN0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb25uZWN0aW9uIGlzIGNoZWNrZWQgaW4gb3IgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgY2hlY2tpbihjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgaWQgPSBjb25uZWN0aW9uLmdldElkU2VxKClcbiAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0NMT1NFRF9DT05ORUNUSU9OXT86IGJvb2xlYW4sIFtDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXT86IG51bWJlciwgW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuXG4gICAgaWYgKHRyYWNrZWRDb25uZWN0aW9uW0NMT1NFRF9DT05ORUNUSU9OXSkge1xuICAgICAgaWYgKHR5cGVvZiBpZCA9PT0gXCJudW1iZXJcIikgdGhpcy51bnRyYWNrQ29ubmVjdGlvbkluVXNlKGNvbm5lY3Rpb24sIGlkKVxuICAgICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tMZWZ0T3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnJlbGVhc2VIZWxkQWR2aXNvcnlMb2NrcygpXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLmNsZWFyQ29ubmVjdGlvbkNoZWNrb3V0TmFtZSgpXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLmNsZWFudXBTZXNzaW9uU3RhdGVBZnRlckNoZWNrb3V0KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZUNoZWNrZWRPdXRDb25uZWN0aW9uQWZ0ZXJDaGVja2luRmFpbHVyZShjb25uZWN0aW9uLCBpZCwgZXJyb3IpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHRoaXMudW50cmFja0Nvbm5lY3Rpb25JblVzZShjb25uZWN0aW9uLCBpZClcbiAgICBkZWxldGUgdHJhY2tlZENvbm5lY3Rpb25bQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF1cbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuaGFzKHJldXNlS2V5KSkge1xuICAgICAgY29uc3QgcmV0YWluZWRDb25uZWN0aW9uID0gdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLmdldChyZXVzZUtleSlcblxuICAgICAgaWYgKCFyZXRhaW5lZENvbm5lY3Rpb24gfHwgcmV0YWluZWRDb25uZWN0aW9uID09PSBjb25uZWN0aW9uIHx8IHJldGFpbmVkQ29ubmVjdGlvbi5nZXRJZFNlcSgpICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXVxuICAgICAgICB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuc2V0KHJldXNlS2V5LCBjb25uZWN0aW9uKVxuICAgICAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXSA9IERhdGUubm93KClcbiAgICB0aGlzLmNvbm5lY3Rpb25zLnB1c2goY29ubmVjdGlvbilcbiAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpXG4gICAgaWYgKHRoaXMuY29ubmVjdGlvbnMuaW5jbHVkZXMoY29ubmVjdGlvbikpIGF3YWl0IHRoaXMuaGFuZGxlQ2hlY2tlZEluSWRsZUNvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcm1hbmVudGx5IHJlbW92ZXMgYW5kIGNsb3NlcyBhIGNoZWNrZWQtb3V0IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRoYXQgbXVzdCBub3QgcmV0dXJuIHRvIHRoZSBwb29sLlxuICAgKi9cbiAgYXN5bmMgZGlzY2FyZChjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgaWQgPSBjb25uZWN0aW9uLmdldElkU2VxKClcbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgdGhpcy51bnRyYWNrQ29ubmVjdGlvbkluVXNlKGNvbm5lY3Rpb24sIGlkKVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gZGlzY2FyZCBhIGRhdGFiYXNlIGNvbm5lY3Rpb25cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIGNoZWNrZWQgb3V0IGNvbm5lY3Rpb24gYWZ0ZXIgY2hlY2tpbiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0aGF0IGZhaWxlZCBjaGVjay1pbiBjbGVhbnVwLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gaWQgLSBDb25uZWN0aW9uIGNoZWNrb3V0IGlkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBvcmlnaW5hbEVycm9yIC0gRXJyb3IgdGhhdCBjYXVzZWQgY2hlY2staW4gY2xlYW51cCB0byBmYWlsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VDaGVja2VkT3V0Q29ubmVjdGlvbkFmdGVyQ2hlY2tpbkZhaWx1cmUoY29ubmVjdGlvbiwgaWQsIG9yaWdpbmFsRXJyb3IpIHtcbiAgICB0aGlzLnVudHJhY2tDb25uZWN0aW9uSW5Vc2UoY29ubmVjdGlvbiwgaWQpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZUNvbm5lY3Rpb24oY29ubmVjdGlvbilcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBjbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9uIGFmdGVyIGNoZWNrLWluIGNsZWFudXAgZmFpbGVkXCIsIHtlcnJvciwgb3JpZ2luYWxFcnJvcn0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZHJhaW5QZW5kaW5nQ2hlY2tvdXRzKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBkcmFpbiBwZW5kaW5nIGRhdGFiYXNlIGNoZWNrb3V0cyBhZnRlciBjaGVjay1pbiBjbGVhbnVwIGZhaWxlZFwiLCB7ZXJyb3IsIG9yaWdpbmFsRXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVudHJhY2sgY29ubmVjdGlvbiBpbiB1c2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIGJlaW5nIGNoZWNrZWQgaW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBpZCAtIENvbm5lY3Rpb24gY2hlY2tvdXQgaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdW50cmFja0Nvbm5lY3Rpb25JblVzZShjb25uZWN0aW9uLCBpZCkge1xuICAgIGlmICh0eXBlb2YgaWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgaWRTZXEgb24gY29ubmVjdGlvbiB3YXNuJ3Qgc2V0PyAnJHt0eXBlb2YgaWR9JyA9ICR7aWR9YClcbiAgICB9XG5cbiAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uc0luVXNlW2lkXVxuICAgIGNvbm5lY3Rpb24uc2V0SWRTZXEodW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNoZWNrZWQgaW4gaWRsZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIGlkbGUgcmVhcGluZyBoYXMgYmVlbiBzY2hlZHVsZWQgb3IgcnVuLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlQ2hlY2tlZEluSWRsZUNvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuaWRsZVRpbWVvdXRNaWxsaXMoKSA9PT0gMCkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFwSWRsZUNvbm5lY3Rpb25zKClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zY2hlZHVsZUlkbGVDb25uZWN0aW9uUmVhcGVyKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGVja291dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gW29wdGlvbnNdIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNoZWNrb3V0LlxuICAgKi9cbiAgYXN5bmMgY2hlY2tvdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGxldCBkYXRhYmFzZUNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgbGV0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWcpXG4gICAgbGV0IGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KVxuXG4gICAgaWYgKGNvbm5lY3Rpb24pIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zKVxuXG4gICAgYXdhaXQgdGhpcy5yZWFwSWRsZUNvbm5lY3Rpb25zKClcbiAgICBkYXRhYmFzZUNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZylcbiAgICBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShyZXVzZUtleSlcblxuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgb3B0aW9ucylcblxuICAgIGlmICh0aGlzLmNhblNwYXduQ29ubmVjdGlvbihkYXRhYmFzZUNvbmZpZykpIHtcbiAgICAgIC8vIFRoZSBwb3N0LXJlYXAgY29uZmlndXJhdGlvbiBpcyBmcmVzaCBmb3IgdGhlIGN1cnJlbnQgY2FsbGVyLCBhbmQgaXRzIHJldXNlIGtleSBpc1xuICAgICAgLy8gZGVyaXZlZCBmcm9tIHRoaXMgZXhhY3QgY2FwdHVyZWQgb2JqZWN0IHNvIHRoZSBjb25uZWN0aW9uIGNhbm5vdCBvcGVuIG9uZSB0ZW5hbnQgd2hpbGVcbiAgICAgIC8vIGJlaW5nIHN0YW1wZWQgZm9yIGFub3RoZXIuIFRoZSBxdWV1ZWQgcGF0aCByZXRhaW5zIHRoZSBzYW1lIGNhcHR1cmVkIHBhaXIuXG4gICAgICBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5zcGF3bkNvbm5lY3Rpb25Gb3JDaGVja291dChcbiAgICAgICAgZGF0YWJhc2VDb25maWcsXG4gICAgICAgIHJldXNlS2V5LFxuICAgICAgICBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcbiAgICAgIClcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2FpdEZvckNoZWNrb3V0KGRhdGFiYXNlQ29uZmlnLCByZXVzZUtleSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgb3V0IGEgY29ubmVjdGlvbiBmb3IgYW4gYWxyZWFkeS1yZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uXG4gICAqIHdpdGhvdXQgY29uc3VsdGluZyBhbWJpZW50IHRlbmFudCBzdGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlnIC0gQ2FwdHVyZWQgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gW29wdGlvbnNdIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIEFjdGl2YXRlZCBwb29sZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIGNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZywgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWcpXG4gICAgY29uc3QgbGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9uID0gdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLmdldChyZXVzZUtleSlcblxuICAgIGlmIChsaWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb24gJiYgbGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9uLmdldElkU2VxKCkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbiwgb3B0aW9ucylcbiAgICB9XG5cbiAgICBsZXQgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkocmV1c2VLZXkpXG5cbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGF3YWl0IHRoaXMuYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMpXG5cbiAgICBhd2FpdCB0aGlzLnJlYXBJZGxlQ29ubmVjdGlvbnMoKVxuICAgIGNvbm5lY3Rpb24gPSB0aGlzLnRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KVxuXG4gICAgaWYgKGNvbm5lY3Rpb24pIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zKVxuXG4gICAgaWYgKHRoaXMuY2FuU3Bhd25Db25uZWN0aW9uKGRhdGFiYXNlQ29uZmlnKSkge1xuICAgICAgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuc3Bhd25Db25uZWN0aW9uRm9yQ2hlY2tvdXQoXG4gICAgICAgIGRhdGFiYXNlQ29uZmlnLFxuICAgICAgICByZXVzZUtleSxcbiAgICAgICAgY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgICApXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFjdGl2YXRlQ29ubmVjdGlvbihjb25uZWN0aW9uLCBvcHRpb25zKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndhaXRGb3JDaGVja291dChkYXRhYmFzZUNvbmZpZywgcmV1c2VLZXksIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0YWtlIGlkbGUgY29ubmVjdGlvbiBmb3IgcmV1c2Uga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBEYXRhYmFzZSBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaW5jbHVkZU9wZW5UcmFuc2FjdGlvbnNdIC0gV2hldGhlciBjb25uZWN0aW9ucyB3aXRoIG9wZW4gdHJhbnNhY3Rpb25zIG1heSBiZSByZXR1cm5lZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIE1hdGNoaW5nIGlkbGUgY29ubmVjdGlvbi5cbiAgICovXG4gIHRha2VJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KHJldXNlS2V5LCB7aW5jbHVkZU9wZW5UcmFuc2FjdGlvbnMgPSB0cnVlfSA9IHt9KSB7XG4gICAgY29uc3QgY29ubmVjdGlvbkluZGV4ID0gdGhpcy5jb25uZWN0aW9ucy5maW5kSW5kZXgoKHF1ZXVlZENvbm5lY3Rpb24pID0+IHtcbiAgICAgIGlmICghaW5jbHVkZU9wZW5UcmFuc2FjdGlvbnMgJiYgdGhpcy5jb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKHF1ZXVlZENvbm5lY3Rpb24pKSByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbk1hdGNoZXNSZXVzZUtleShxdWV1ZWRDb25uZWN0aW9uLCByZXVzZUtleSlcbiAgICB9KVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBjb25uZWN0aW9uSW5kZXggPT09IC0xID8gdW5kZWZpbmVkIDogdGhpcy5jb25uZWN0aW9ucy5zcGxpY2UoY29ubmVjdGlvbkluZGV4LCAxKVswXVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24gbWF0Y2hlcyByZXVzZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBEYXRhYmFzZSBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29ubmVjdGlvbiBtYXRjaGVzIHRoZSByZXVzZSBrZXkuXG4gICAqL1xuICBjb25uZWN0aW9uTWF0Y2hlc1JldXNlS2V5KGNvbm5lY3Rpb24sIHJldXNlS2V5KSB7XG4gICAgY29uc3QgY29ubmVjdGlvbldpdGhQb29sS2V5ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbUE9PTF9DT05GSUdVUkFUSU9OX0tFWV0/OiBzdHJpbmd9fSAqLyAoY29ubmVjdGlvbilcblxuICAgIHJldHVybiBjb25uZWN0aW9uV2l0aFBvb2xLZXlbUE9PTF9DT05GSUdVUkFUSU9OX0tFWV0gPT09IHJldXNlS2V5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmF0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gW29wdGlvbnNdIC0gQ2hlY2tvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIEFjdGl2YXRlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgYWN0aXZhdGVDb25uZWN0aW9uKGNvbm5lY3Rpb24sIG9wdGlvbnMgPSB7fSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VSZWplY3RlZENoZWNrb3V0QW5kVGhyb3coY29ubmVjdGlvbiwgZXJyb3IpXG4gICAgfVxuICAgIGlmIChjb25uZWN0aW9uLmdldElkU2VxKCkgIT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGBDb25uZWN0aW9uIGFscmVhZHkgaGFzIGFuIElELXNlcSAtIGlzIGl0IGluIHVzZT8gJHtjb25uZWN0aW9uLmdldElkU2VxKCl9YClcblxuICAgIGNvbnN0IGlkID0gdGhpcy5pZFNlcSsrXG5cbiAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdPzogbnVtYmVyLCBbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXVxuICAgIHRyYWNrZWRDb25uZWN0aW9uW0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdID0gRGF0ZS5ub3coKVxuXG4gICAgY29ubmVjdGlvbi5zZXRJZFNlcShpZClcbiAgICB0aGlzLmNvbm5lY3Rpb25zSW5Vc2VbaWRdID0gY29ubmVjdGlvblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24uc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShvcHRpb25zLm5hbWUpXG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VSZWplY3RlZENoZWNrb3V0QW5kVGhyb3coY29ubmVjdGlvbiwgZXJyb3IsIGlkKVxuICAgIH1cblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGEgcmVqZWN0ZWQgY2hlY2tvdXQsIHRoZW4gaGFuZHMgZnJlZWQgY2FwYWNpdHkgdG8gcXVldWVkIGNhbGxlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBSZWplY3RlZCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEFjY2VzcyByZXZvY2F0aW9uIGVycm9yLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2lkXSAtIEFzc2lnbmVkIGNoZWNrb3V0IGlkLCBpZiBhY3RpdmF0aW9uIHJlYWNoZWQgdGhhdCBzdGFnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bmV2ZXI+fSAtIEFsd2F5cyByZWplY3RzIHdpdGggdGhlIGFjY2VzcyBvciBjbGVhbnVwIGVycm9ycy5cbiAgICovXG4gIGFzeW5jIGNsb3NlUmVqZWN0ZWRDaGVja291dEFuZFRocm93KGNvbm5lY3Rpb24sIGVycm9yLCBpZCkge1xuICAgIGlmIChpZCAhPT0gdW5kZWZpbmVkKSB0aGlzLnVudHJhY2tDb25uZWN0aW9uSW5Vc2UoY29ubmVjdGlvbiwgaWQpXG5cbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+W119ICovXG4gICAgY29uc3QgY2xlYW51cEVycm9ycyA9IFtdXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jbG9zZUNvbm5lY3Rpb24oY29ubmVjdGlvbilcbiAgICB9IGNhdGNoIChjbG9zZUVycm9yKSB7XG4gICAgICBjbGVhbnVwRXJyb3JzLnB1c2goY2xvc2VFcnJvcilcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5Qcm9taXNlKSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQgPSB0cnVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLmRyYWluUGVuZGluZ0NoZWNrb3V0cygpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZHJhaW5FcnJvcikge1xuICAgICAgY2xlYW51cEVycm9ycy5wdXNoKGRyYWluRXJyb3IpXG4gICAgfVxuXG4gICAgaWYgKGNsZWFudXBFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgLi4uY2xlYW51cEVycm9yc10sIFwiRGF0YWJhc2UgY2hlY2tvdXQgcmVqZWN0aW9uIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cblxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXggY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBbZGF0YWJhc2VDb25maWddIC0gQ29uZmlndXJhdGlvbiB3aG9zZSBwb29sIG1heGltdW0gYXBwbGllcy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gQ29uZmlndXJlZCBtYXggbGl2ZSBjb25uZWN0aW9ucy5cbiAgICovXG4gIG1heENvbm5lY3Rpb25zKGRhdGFiYXNlQ29uZmlnID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkpIHtcbiAgICBjb25zdCB2YWx1ZSA9IGRhdGFiYXNlQ29uZmlnLnBvb2w/Lm1heFxuXG4gICAgaWYgKHZhbHVlID09PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICh0aGlzLnZhbGlkTWF4Q29ubmVjdGlvbnModmFsdWUpKSByZXR1cm4gdmFsdWVcblxuICAgIHJldHVybiBERUZBVUxUX01BWF9DT05ORUNUSU9OU1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2hlY2tvdXQgdGltZW91dCBtaWxsaXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBbZGF0YWJhc2VDb25maWddIC0gQ29uZmlndXJhdGlvbiB3aG9zZSB0aW1lb3V0IGFwcGxpZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFBlbmRpbmcgY2hlY2tvdXQgdGltZW91dCBpbiBtaWxsaXNlY29uZHMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAgICovXG4gIGNoZWNrb3V0VGltZW91dE1pbGxpcyhkYXRhYmFzZUNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSB7XG4gICAgY29uc3QgdmFsdWUgPSBkYXRhYmFzZUNvbmZpZy5wb29sPy5jaGVja291dFRpbWVvdXRNaWxsaXNcblxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodGhpcy52YWxpZENoZWNrb3V0VGltZW91dE1pbGxpcyh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIERFRkFVTFRfQ0hFQ0tPVVRfVElNRU9VVF9NSUxMSVNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkIGNoZWNrb3V0IHRpbWVvdXQgbWlsbGlzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBjaGVja291dCB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7dmFsdWUgaXMgbnVtYmVyfSAtIFdoZXRoZXIgdGhlIHZhbHVlIGlzIGEgdmFsaWQgdGltZW91dC5cbiAgICovXG4gIHZhbGlkQ2hlY2tvdXRUaW1lb3V0TWlsbGlzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHZhbGlkIG1heCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgbWF4IGNvbm5lY3Rpb24gY291bnQuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBudW1iZXJ9IC0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSB2YWxpZCBtYXggY29ubmVjdGlvbiBjb3VudC5cbiAgICovXG4gIHZhbGlkTWF4Q29ubmVjdGlvbnModmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPj0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGl2ZSBjb25uZWN0aW9uIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBsaXZlIGFuZCBpbi1wcm9ncmVzcyBjb25uZWN0aW9ucy5cbiAgICovXG4gIGxpdmVDb25uZWN0aW9uQ291bnQoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLnRoaXMuY29ubmVjdGlvbnMsXG4gICAgICAuLi5PYmplY3QudmFsdWVzKHRoaXMuY29ubmVjdGlvbnNJblVzZSksXG4gICAgICAuLi50aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCksXG4gICAgICB0aGlzLmdldEdsb2JhbENvbm5lY3Rpb25Gb3JJZGVudGlmaWVyKClcbiAgICBdLmZpbHRlcihCb29sZWFuKSlcblxuICAgIHJldHVybiBjb25uZWN0aW9ucy5zaXplICsgdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FuIHNwYXduIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBbZGF0YWJhc2VDb25maWddIC0gQ29uZmlndXJhdGlvbiB3aG9zZSBwb29sIG1heGltdW0gYXBwbGllcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhIG5ldyBjb25uZWN0aW9uIGNhbiBiZSBzcGF3bmVkLlxuICAgKi9cbiAgY2FuU3Bhd25Db25uZWN0aW9uKGRhdGFiYXNlQ29uZmlnID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkpIHtcbiAgICBjb25zdCBtYXhDb25uZWN0aW9ucyA9IHRoaXMubWF4Q29ubmVjdGlvbnMoZGF0YWJhc2VDb25maWcpXG5cbiAgICByZXR1cm4gbWF4Q29ubmVjdGlvbnMgPT09IG51bGwgfHwgdGhpcy5saXZlQ29ubmVjdGlvbkNvdW50KCkgPCBtYXhDb25uZWN0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gY29ubmVjdGlvbiBmb3IgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZyAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZyBmb3IgdGhlIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBEYXRhYmFzZSBjb25maWd1cmF0aW9uIHJldXNlIGtleSBmb3IgdGhlIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gcHJvZmlsZUNvbnRleHQgLSBQcm9maWxlIGNvbnRleHQgY2FwdHVyZWQgd2hlbiBjaGVja291dCBiZWdhbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFNwYXduZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIHNwYXduQ29ubmVjdGlvbkZvckNoZWNrb3V0KGRhdGFiYXNlQ29uZmlnLCByZXVzZUtleSwgcHJvZmlsZUNvbnRleHQpIHtcbiAgICB0aGlzLmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkKytcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIucnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChwcm9maWxlQ29udGV4dCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5zcGF3bkNvbm5lY3Rpb25XaXRoQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZywgdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWcpKVxuICAgICAgfSlcblxuICAgICAgdGhpcy5zdGFtcENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbiwgcmV1c2VLZXkpXG5cbiAgICAgIHJldHVybiBjb25uZWN0aW9uXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWQtLVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdhaXQgZm9yIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWcgLSBSZXNvbHZlZCBkYXRhYmFzZSBjb25maWcgZm9yIHRoZSBjaGVja291dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJldXNlS2V5IC0gRGF0YWJhc2UgY29uZmlndXJhdGlvbiByZXVzZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnN9IFtvcHRpb25zXSAtIENoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIGFuIGFjdGl2YXRlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgd2FpdEZvckNoZWNrb3V0KGRhdGFiYXNlQ29uZmlnLCByZXVzZUtleSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBEYXRlLm5vdygpXG4gICAgICBjb25zdCB0aW1lb3V0TWlsbGlzID0gdGhpcy5jaGVja291dFRpbWVvdXRNaWxsaXMoZGF0YWJhc2VDb25maWcpXG4gICAgICAvKiogQHR5cGUge1BlbmRpbmdDaGVja291dH0gKi9cbiAgICAgIGNvbnN0IGNoZWNrb3V0ID0ge1xuICAgICAgICBkYXRhYmFzZUNvbmZpZyxcbiAgICAgICAgZW5xdWV1ZWRBdCxcbiAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgICByZXNvbHZlLFxuICAgICAgICByZXVzZUtleSxcbiAgICAgICAgdGltZW91dEF0OiB0aW1lb3V0TWlsbGlzID09PSBudWxsID8gbnVsbCA6IGVucXVldWVkQXQgKyB0aW1lb3V0TWlsbGlzLFxuICAgICAgICB0aW1lb3V0TWlsbGlzLFxuICAgICAgICB0aW1lb3V0VGltZXI6IHVuZGVmaW5lZCxcbiAgICAgICAgdGVzdERhdGFiYXNlQWNjZXNzU2NvcGU6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5jdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoKSxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcbiAgICAgIH1cblxuICAgICAgY2hlY2tvdXQudGltZW91dFRpbWVyID0gdGhpcy5zdGFydFBlbmRpbmdDaGVja291dFRpbWVvdXQoY2hlY2tvdXQpXG4gICAgICB0aGlzLnBlbmRpbmdDaGVja291dHMucHVzaChjaGVja291dClcbiAgICAgIHZvaWQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHMoKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgY29uc3QgY2hlY2tvdXRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIkZhaWxlZCB0byBkcmFpbiBwZW5kaW5nIGRhdGFiYXNlIGNvbm5lY3Rpb24gY2hlY2tvdXRzLlwiLCB7Y2F1c2U6IGVycm9yfSlcblxuICAgICAgICB0aGlzLnJlamVjdFBlbmRpbmdDaGVja291dHMoY2hlY2tvdXRFcnJvcilcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyYWluIHBlbmRpbmcgY2hlY2tvdXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHBlbmRpbmcgY2hlY2tvdXRzIGhhdmUgYmVlbiBkcmFpbmVkIGFzIGZhciBhcyBwb3NzaWJsZS5cbiAgICovXG4gIGFzeW5jIGRyYWluUGVuZGluZ0NoZWNrb3V0cygpIHtcbiAgICB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkID0gdHJ1ZVxuXG4gICAgaWYgKCF0aGlzLnBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZSkgdGhpcy5zdGFydFBlbmRpbmdDaGVja291dERyYWluKClcbiAgICBhd2FpdCB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyB0aGUgc2luZ2xlIGNoZWNrb3V0LWRyYWluIG93bmVyLiBUaGUgc2hhcmVkIHByb21pc2UgaXMgY2xlYXJlZCBiZWZvcmVcbiAgICogaXQgc2V0dGxlcywgY2xvc2luZyB0aGUgcmVzb2x2ZWQtcHJvbWlzZS9zdGFsZS1maWVsZCBpbnRlcnZhbCBpbiB3aGljaCBhIG5ld1xuICAgKiByZXF1ZXN0IGNvdWxkIG90aGVyd2lzZSBiZSBsb3N0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXJ0UGVuZGluZ0NoZWNrb3V0RHJhaW4oKSB7XG4gICAgY29uc3Qge3Byb21pc2UsIHJlamVjdCwgcmVzb2x2ZX0gPSBQcm9taXNlLndpdGhSZXNvbHZlcnMoKVxuXG4gICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UgPSBwcm9taXNlXG4gICAgdm9pZCB0aGlzLnJ1blJlcXVlc3RlZFBlbmRpbmdDaGVja291dERyYWlucyh7cmVqZWN0LCByZXNvbHZlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyYWluIHBhc3NlcyB1bnRpbCBldmVyeSByZXF1ZXN0IG9ic2VydmVkIGR1cmluZyB0aGUgYWN0aXZlIHBhc3MgaGFzXG4gICAqIHJlY2VpdmVkIGEgbGF0ZXIgcGFzcy5cbiAgICogQHBhcmFtIHt7cmVqZWN0OiAocmVhc29uPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQsIHJlc29sdmU6ICh2YWx1ZT86IHZvaWQpID0+IHZvaWR9fSBkZWZlcnJlZCAtIFNoYXJlZCBkcmFpbiBzZXR0bGVtZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJ1blJlcXVlc3RlZFBlbmRpbmdDaGVja291dERyYWlucyh7cmVqZWN0LCByZXNvbHZlfSkge1xuICAgIHRyeSB7XG4gICAgICB3aGlsZSAodGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblJlcXVlc3RlZCkge1xuICAgICAgICB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUmVxdWVzdGVkID0gZmFsc2VcbiAgICAgICAgYXdhaXQgdGhpcy5kcmFpblBlbmRpbmdDaGVja291dHNBY3R1YWwoKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnBlbmRpbmdDaGVja291dERyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICByZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyYWluIHBlbmRpbmcgY2hlY2tvdXRzIGFjdHVhbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIGNoZWNrb3V0cyBoYXZlIGJlZW4gZHJhaW5lZCBhcyBmYXIgYXMgcG9zc2libGUuXG4gICAqL1xuICBhc3luYyBkcmFpblBlbmRpbmdDaGVja291dHNBY3R1YWwoKSB7XG4gICAgd2hpbGUgKHRoaXMucGVuZGluZ0NoZWNrb3V0cy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5yZXNvbHZlUGVuZGluZ0NoZWNrb3V0V2l0aE1hdGNoaW5nSWRsZUNvbm5lY3Rpb24oKSkgY29udGludWVcblxuICAgICAgY29uc3QgY2hlY2tvdXQgPSB0aGlzLnBlbmRpbmdDaGVja291dHNbMF1cblxuICAgICAgaWYgKGF3YWl0IHRoaXMuY2xvc2VJZGxlQ29ubmVjdGlvbkZvclBlbmRpbmdDaGVja291dENhcGFjaXR5KGNoZWNrb3V0KSkgY29udGludWVcbiAgICAgIGlmICghdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmluY2x1ZGVzKGNoZWNrb3V0KSkgY29udGludWVcbiAgICAgIGlmICh0aGlzLmNhblNwYXduQ29ubmVjdGlvbihjaGVja291dC5kYXRhYmFzZUNvbmZpZykpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVQZW5kaW5nQ2hlY2tvdXRBdCgwKVxuICAgICAgICBhd2FpdCB0aGlzLnNwYXduQW5kUmVzb2x2ZVBlbmRpbmdDaGVja291dChjaGVja291dClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVhcGVkQ29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuaWRsZUNvbm5lY3Rpb25Gb3JQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQpXG5cbiAgICAgIGlmICghdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmluY2x1ZGVzKGNoZWNrb3V0KSkgY29udGludWVcbiAgICAgIGlmICghcmVhcGVkQ29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICAgIHRoaXMucmVtb3ZlUGVuZGluZ0NoZWNrb3V0QXQoMClcbiAgICAgIGF3YWl0IHRoaXMucmVzb2x2ZVBlbmRpbmdDaGVja291dChjaGVja291dCwgcmVhcGVkQ29ubmVjdGlvbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIHBlbmRpbmcgY2hlY2tvdXQgd2l0aCBtYXRjaGluZyBpZGxlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBwZW5kaW5nIGNoZWNrb3V0IHdhcyByZXNvbHZlZCB3aXRoIGFuIGlkbGUgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVQZW5kaW5nQ2hlY2tvdXRXaXRoTWF0Y2hpbmdJZGxlQ29ubmVjdGlvbigpIHtcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY29uc3QgY2hlY2tvdXQgPSB0aGlzLnBlbmRpbmdDaGVja291dHNbaW5kZXhdXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShjaGVja291dC5yZXVzZUtleSwge2luY2x1ZGVPcGVuVHJhbnNhY3Rpb25zOiBmYWxzZX0pXG5cbiAgICAgIGlmICghY29ubmVjdGlvbikgY29udGludWVcblxuICAgICAgdGhpcy5yZW1vdmVQZW5kaW5nQ2hlY2tvdXRBdChpbmRleClcbiAgICAgIGF3YWl0IHRoaXMucmVzb2x2ZVBlbmRpbmdDaGVja291dChjaGVja291dCwgY29ubmVjdGlvbilcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBwZW5kaW5nIGNoZWNrb3V0IGF0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBQZW5kaW5nIGNoZWNrb3V0IGluZGV4LlxuICAgKiBAcmV0dXJucyB7UGVuZGluZ0NoZWNrb3V0fSAtIFJlbW92ZWQgY2hlY2tvdXQuXG4gICAqL1xuICByZW1vdmVQZW5kaW5nQ2hlY2tvdXRBdChpbmRleCkge1xuICAgIGNvbnN0IGNoZWNrb3V0ID0gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLnNwbGljZShpbmRleCwgMSlbMF1cblxuICAgIHRoaXMuY2xlYXJQZW5kaW5nQ2hlY2tvdXRUaW1lb3V0KGNoZWNrb3V0KVxuICAgIHRoaXMucmVjb3JkQ2hlY2tvdXRXYWl0KGNoZWNrb3V0KVxuXG4gICAgcmV0dXJuIGNoZWNrb3V0XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGNvbXBsZXRlZCBxdWV1ZSB3YWl0IHdpdGhvdXQgcmV0YWluaW5nIHBlci1jaGVja291dCBsYWJlbHMgb3Igc2FtcGxlcy5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gQ2hlY2tvdXQgbGVhdmluZyB0aGUgcGVuZGluZyBxdWV1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRDaGVja291dFdhaXQoY2hlY2tvdXQpIHtcbiAgICBjb25zdCB3YWl0ZWRGb3JNcyA9IE1hdGgubWF4KDAsIHRoaXMubm93TXMoKSAtIGNoZWNrb3V0LmVucXVldWVkQXQpXG5cbiAgICB0aGlzLnRlbGVtZXRyeS5jaGVja291dFdhaXRDb3VudCsrXG4gICAgdGhpcy50ZWxlbWV0cnkuY2hlY2tvdXRXYWl0VG90YWxNcyArPSB3YWl0ZWRGb3JNc1xuICAgIHRoaXMudGVsZW1ldHJ5LmNoZWNrb3V0V2FpdE1heE1zID0gTWF0aC5tYXgodGhpcy50ZWxlbWV0cnkuY2hlY2tvdXRXYWl0TWF4TXMsIHdhaXRlZEZvck1zKVxuICAgIHRoaXMucmVjb3JkVGVzdFByb2ZpbGVQb29sTWV0cmljKGNoZWNrb3V0LnRlc3RQcm9maWxlQ29udGV4dCwgXCJjaGVja291dFdhaXRcIiwge2R1cmF0aW9uTXM6IHdhaXRlZEZvck1zfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHBlbmRpbmcgY2hlY2tvdXQgdGltZW91dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gUGVuZGluZyBjaGVja291dCB0byB0aW1lIG91dC5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAtIFRpbWVyLCBpZiB0aW1lb3V0IGlzIGVuYWJsZWQuXG4gICAqL1xuICBzdGFydFBlbmRpbmdDaGVja291dFRpbWVvdXQoY2hlY2tvdXQpIHtcbiAgICBpZiAoY2hlY2tvdXQudGltZW91dE1pbGxpcyA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMudGltZW91dFBlbmRpbmdDaGVja291dChjaGVja291dClcbiAgICB9LCBjaGVja291dC50aW1lb3V0TWlsbGlzKVxuXG4gICAgcmV0dXJuIHRpbWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aW1lb3V0IHBlbmRpbmcgY2hlY2tvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIFBlbmRpbmcgY2hlY2tvdXQgdG8gcmVqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHRpbWVvdXRQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQpIHtcbiAgICBjb25zdCBpbmRleCA9IHRoaXMucGVuZGluZ0NoZWNrb3V0cy5pbmRleE9mKGNoZWNrb3V0KVxuXG4gICAgaWYgKGluZGV4ID09PSAtMSkgcmV0dXJuXG5cbiAgICB0aGlzLnJlbW92ZVBlbmRpbmdDaGVja291dEF0KGluZGV4KVxuICAgIHRoaXMudGVsZW1ldHJ5LmNoZWNrb3V0VGltZW91dENvdW50KytcbiAgICB0aGlzLnJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhjaGVja291dC50ZXN0UHJvZmlsZUNvbnRleHQsIFwiY2hlY2tvdXRUaW1lb3V0XCIpXG4gICAgY2hlY2tvdXQucmVqZWN0KHRoaXMucGVuZGluZ0NoZWNrb3V0VGltZW91dEVycm9yKGNoZWNrb3V0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlbmRpbmcgY2hlY2tvdXQgdGltZW91dCBlcnJvci5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gVGltZWQtb3V0IGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7RGF0YWJhc2VQb29sQ2hlY2tvdXRUaW1lb3V0RXJyb3J9IC0gVGltZW91dCBlcnJvci5cbiAgICovXG4gIHBlbmRpbmdDaGVja291dFRpbWVvdXRFcnJvcihjaGVja291dCkge1xuICAgIGNvbnN0IGNoZWNrb3V0TmFtZSA9IGNoZWNrb3V0Lm9wdGlvbnMubmFtZSA/IGAgQ2hlY2tvdXQgbmFtZTogJHtKU09OLnN0cmluZ2lmeShjaGVja291dC5vcHRpb25zLm5hbWUpfS5gIDogXCJcIlxuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gdGhpcy5wZW5kaW5nQ2hlY2tvdXRUaW1lb3V0RGlhZ25vc3RpY3MoY2hlY2tvdXQpXG5cbiAgICByZXR1cm4gbmV3IERhdGFiYXNlUG9vbENoZWNrb3V0VGltZW91dEVycm9yKGBUaW1lZCBvdXQgYWZ0ZXIgJHtjaGVja291dC50aW1lb3V0TWlsbGlzfW1zIHdhaXRpbmcgZm9yIGRhdGFiYXNlIGNvbm5lY3Rpb24gY2hlY2tvdXQgZnJvbSBwb29sIFwiJHt0aGlzLmlkZW50aWZpZXJ9XCIuJHtjaGVja291dE5hbWV9ICR7ZGlhZ25vc3RpY3N9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgc2FuaXRpemVkIGRpYWdub3N0aWNzIGZvciBhIGNoZWNrb3V0IHRpbWVvdXQuXG4gICAqIEBwYXJhbSB7UGVuZGluZ0NoZWNrb3V0fSBjaGVja291dCAtIFRpbWVkLW91dCBjaGVja291dC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQb29sIHN0YXRlIHN1bW1hcnkuXG4gICAqL1xuICBwZW5kaW5nQ2hlY2tvdXRUaW1lb3V0RGlhZ25vc3RpY3MoY2hlY2tvdXQpIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IHRoaXMuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgY29uc3QgY29ubmVjdGlvblN1bW1hcmllcyA9IHNuYXBzaG90LmNvbm5lY3Rpb25zXG4gICAgICAubWFwKChjb25uZWN0aW9uKSA9PiB0aGlzLnBlbmRpbmdDaGVja291dFRpbWVvdXRDb25uZWN0aW9uU3VtbWFyeShjb25uZWN0aW9uKSlcbiAgICAgIC5qb2luKFwiLCBcIilcbiAgICBjb25zdCBwZW5kaW5nU3VtbWFyaWVzID0gKHNuYXBzaG90LnBlbmRpbmdDaGVja291dHMgfHwgW10pXG4gICAgICAubWFwKChwZW5kaW5nQ2hlY2tvdXQpID0+IHRoaXMucGVuZGluZ0NoZWNrb3V0VGltZW91dFBlbmRpbmdTdW1tYXJ5KHBlbmRpbmdDaGVja291dCkpXG4gICAgICAuam9pbihcIiwgXCIpXG4gICAgY29uc3Qgd2FpdGVkRm9yTXMgPSBNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gY2hlY2tvdXQuZW5xdWV1ZWRBdClcblxuICAgIHJldHVybiBgUG9vbCBzdGF0ZTogbWF4PSR7dGhpcy5tYXhDb25uZWN0aW9ucygpID8/IFwidW5ib3VuZGVkXCJ9LCBpblVzZT0ke3NuYXBzaG90LmluVXNlQ291bnR9LCBpZGxlPSR7c25hcHNob3QuaWRsZUNvdW50fSwgcGVuZGluZz0ke3NuYXBzaG90LnBlbmRpbmdDaGVja291dENvdW50fSwgc3Bhd25pbmc9JHtzbmFwc2hvdC5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZH0sIHRpbWVkT3V0V2FpdGluZ0Zvck1zPSR7d2FpdGVkRm9yTXN9LCBob2xkZXJzPVske2Nvbm5lY3Rpb25TdW1tYXJpZXN9XSwgd2FpdGluZz1bJHtwZW5kaW5nU3VtbWFyaWVzfV0uYFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHNhbml0aXplZCBjb25uZWN0aW9uIHN1bW1hcnkgZm9yIGNoZWNrb3V0IHRpbWVvdXQgZGlhZ25vc3RpY3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTYW5pdGl6ZWQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICovXG4gIHBlbmRpbmdDaGVja291dFRpbWVvdXRDb25uZWN0aW9uU3VtbWFyeShjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgcGFydHMgPSBbYHN0YXRlPSR7Y29ubmVjdGlvbi5zdGF0ZX1gXVxuXG4gICAgaWYgKGNvbm5lY3Rpb24uY2hlY2tvdXROYW1lKSBwYXJ0cy5wdXNoKGBjaGVja291dD0ke0pTT04uc3RyaW5naWZ5KGNvbm5lY3Rpb24uY2hlY2tvdXROYW1lKX1gKVxuICAgIGlmICh0eXBlb2YgY29ubmVjdGlvbi5jaGVja2VkT3V0Rm9yTXMgPT09IFwibnVtYmVyXCIpIHBhcnRzLnB1c2goYGNoZWNrZWRPdXRGb3JNcz0ke2Nvbm5lY3Rpb24uY2hlY2tlZE91dEZvck1zfWApXG4gICAgaWYgKHR5cGVvZiBjb25uZWN0aW9uLmlkbGVGb3JNcyA9PT0gXCJudW1iZXJcIikgcGFydHMucHVzaChgaWRsZUZvck1zPSR7Y29ubmVjdGlvbi5pZGxlRm9yTXN9YClcbiAgICBpZiAodHlwZW9mIGNvbm5lY3Rpb24ub3BlblRyYW5zYWN0aW9ucyA9PT0gXCJudW1iZXJcIikgcGFydHMucHVzaChgb3BlblRyYW5zYWN0aW9ucz0ke2Nvbm5lY3Rpb24ub3BlblRyYW5zYWN0aW9uc31gKVxuXG4gICAgY29uc3QgYWN0aXZlUXVlcnkgPSBjb25uZWN0aW9uLmFjdGl2ZVF1ZXJ5XG5cbiAgICBpZiAoYWN0aXZlUXVlcnkgJiYgdHlwZW9mIGFjdGl2ZVF1ZXJ5ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGFjdGl2ZVF1ZXJ5KSkge1xuICAgICAgY29uc3QgcnVubmluZ01zID0gKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWN0aXZlUXVlcnkpKS5ydW5uaW5nTXNcblxuICAgICAgaWYgKHR5cGVvZiBydW5uaW5nTXMgPT09IFwibnVtYmVyXCIpIHBhcnRzLnB1c2goYGFjdGl2ZVF1ZXJ5TXM9JHtydW5uaW5nTXN9YClcbiAgICB9XG5cbiAgICByZXR1cm4gYHske3BhcnRzLmpvaW4oXCIgXCIpfX1gXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc2FuaXRpemVkIHBlbmRpbmcgY2hlY2tvdXQgc3VtbWFyeSBmb3IgY2hlY2tvdXQgdGltZW91dCBkaWFnbm9zdGljcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sUGVuZGluZ0NoZWNrb3V0RGVidWdTbmFwc2hvdH0gcGVuZGluZ0NoZWNrb3V0IC0gV2FpdGluZyBjaGVja291dCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTYW5pdGl6ZWQgcGVuZGluZyBjaGVja291dCBzdGF0ZS5cbiAgICovXG4gIHBlbmRpbmdDaGVja291dFRpbWVvdXRQZW5kaW5nU3VtbWFyeShwZW5kaW5nQ2hlY2tvdXQpIHtcbiAgICBjb25zdCBwYXJ0cyA9IFtgaW5kZXg9JHtwZW5kaW5nQ2hlY2tvdXQuaW5kZXh9YCwgYHdhaXRpbmdGb3JNcz0ke3BlbmRpbmdDaGVja291dC53YWl0aW5nRm9yTXN9YF1cblxuICAgIGlmIChwZW5kaW5nQ2hlY2tvdXQuY2hlY2tvdXROYW1lKSBwYXJ0cy5wdXNoKGBjaGVja291dD0ke0pTT04uc3RyaW5naWZ5KHBlbmRpbmdDaGVja291dC5jaGVja291dE5hbWUpfWApXG4gICAgaWYgKHBlbmRpbmdDaGVja291dC5yZW1haW5pbmdUaW1lb3V0TXMgIT09IG51bGwpIHBhcnRzLnB1c2goYHJlbWFpbmluZ1RpbWVvdXRNcz0ke3BlbmRpbmdDaGVja291dC5yZW1haW5pbmdUaW1lb3V0TXN9YClcblxuICAgIHJldHVybiBgeyR7cGFydHMuam9pbihcIiBcIil9fWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHBlbmRpbmcgY2hlY2tvdXQgdGltZW91dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gUGVuZGluZyBjaGVja291dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhclBlbmRpbmdDaGVja291dFRpbWVvdXQoY2hlY2tvdXQpIHtcbiAgICBpZiAoIWNoZWNrb3V0LnRpbWVvdXRUaW1lcikgcmV0dXJuXG5cbiAgICBjbGVhclRpbWVvdXQoY2hlY2tvdXQudGltZW91dFRpbWVyKVxuICAgIGNoZWNrb3V0LnRpbWVvdXRUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UgaWRsZSBjb25uZWN0aW9uIGZvciBwZW5kaW5nIGNoZWNrb3V0IGNhcGFjaXR5LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBDaGVja291dCB3YWl0aW5nIGZvciBhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYW4gaWRsZSBjb25uZWN0aW9uIHdhcyBjbG9zZWQgdG8gZnJlZSBjYXBhY2l0eS5cbiAgICovXG4gIGFzeW5jIGNsb3NlSWRsZUNvbm5lY3Rpb25Gb3JQZW5kaW5nQ2hlY2tvdXRDYXBhY2l0eShjaGVja291dCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmZpbmRJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KGNoZWNrb3V0LnJldXNlS2V5KVxuXG4gICAgaWYgKGNvbm5lY3Rpb24pIHJldHVybiBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5yZWFwSWRsZUNvbm5lY3Rpb25zKClcblxuICAgIGlmICh0aGlzLmZpbmRJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KGNoZWNrb3V0LnJldXNlS2V5KSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5jYW5TcGF3bkNvbm5lY3Rpb24oY2hlY2tvdXQuZGF0YWJhc2VDb25maWcpID8gZmFsc2UgOiBhd2FpdCB0aGlzLmNsb3NlT25lSWRsZUNvbm5lY3Rpb25Gb3JDYXBhY2l0eSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGlkbGUgY29ubmVjdGlvbiBmb3IgcmV1c2Uga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBEYXRhYmFzZSBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIE1hdGNoaW5nIGlkbGUgY29ubmVjdGlvbiwgaWYgcHJlc2VudC5cbiAgICovXG4gIGZpbmRJZGxlQ29ubmVjdGlvbkZvclJldXNlS2V5KHJldXNlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnMuZmluZCgoY29ubmVjdGlvbikgPT4gIXRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKSAmJiB0aGlzLmNvbm5lY3Rpb25NYXRjaGVzUmV1c2VLZXkoY29ubmVjdGlvbiwgcmV1c2VLZXkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaWRsZSBjb25uZWN0aW9uIGZvciBwZW5kaW5nIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBDaGVja291dCB3YWl0aW5nIGZvciBhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBNYXRjaGluZyBpZGxlIGNvbm5lY3Rpb24sIGlmIG9uZSBjYW4gYmUgcmV1c2VkLlxuICAgKi9cbiAgYXN5bmMgaWRsZUNvbm5lY3Rpb25Gb3JQZW5kaW5nQ2hlY2tvdXQoY2hlY2tvdXQpIHtcbiAgICBsZXQgY29ubmVjdGlvbiA9IHRoaXMudGFrZUlkbGVDb25uZWN0aW9uRm9yUmV1c2VLZXkoY2hlY2tvdXQucmV1c2VLZXksIHtpbmNsdWRlT3BlblRyYW5zYWN0aW9uczogZmFsc2V9KVxuXG4gICAgaWYgKGNvbm5lY3Rpb24pIHJldHVybiBjb25uZWN0aW9uXG5cbiAgICBhd2FpdCB0aGlzLnJlYXBJZGxlQ29ubmVjdGlvbnMoKVxuICAgIGlmICghdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmluY2x1ZGVzKGNoZWNrb3V0KSkgcmV0dXJuXG5cbiAgICBjb25uZWN0aW9uID0gdGhpcy50YWtlSWRsZUNvbm5lY3Rpb25Gb3JSZXVzZUtleShjaGVja291dC5yZXVzZUtleSwge2luY2x1ZGVPcGVuVHJhbnNhY3Rpb25zOiBmYWxzZX0pXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gYW5kIHJlc29sdmUgcGVuZGluZyBjaGVja291dC5cbiAgICogQHBhcmFtIHtQZW5kaW5nQ2hlY2tvdXR9IGNoZWNrb3V0IC0gQ2hlY2tvdXQgcmVxdWVzdCB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjaGVja291dCBoYXMgYmVlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgc3Bhd25BbmRSZXNvbHZlUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0KSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICByZXR1cm4gYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLnJ1bldpdGhUZXN0UHJvZmlsZUNvbnRleHQoY2hlY2tvdXQudGVzdFByb2ZpbGVDb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKGNoZWNrb3V0LnRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGxldCBjb25uZWN0aW9uXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgICAgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuc3Bhd25Db25uZWN0aW9uRm9yQ2hlY2tvdXQoXG4gICAgICAgICAgICBjaGVja291dC5kYXRhYmFzZUNvbmZpZyxcbiAgICAgICAgICAgIGNoZWNrb3V0LnJldXNlS2V5LFxuICAgICAgICAgICAgY2hlY2tvdXQudGVzdFByb2ZpbGVDb250ZXh0XG4gICAgICAgICAgKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNoZWNrb3V0LnJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gc3Bhd24gZGF0YWJhc2UgY29ubmVjdGlvbi5cIiwge2NhdXNlOiBlcnJvcn0pKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5yZXNvbHZlUGVuZGluZ0NoZWNrb3V0KGNoZWNrb3V0LCBjb25uZWN0aW9uKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBwZW5kaW5nIGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge1BlbmRpbmdDaGVja291dH0gY2hlY2tvdXQgLSBDaGVja291dCByZXF1ZXN0IHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRvIGFjdGl2YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjaGVja291dCBoYXMgYmVlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZVBlbmRpbmdDaGVja291dChjaGVja291dCwgY29ubmVjdGlvbikge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5ydW5XaXRoVGVzdFByb2ZpbGVDb250ZXh0KGNoZWNrb3V0LnRlc3RQcm9maWxlQ29udGV4dCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShjaGVja291dC50ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNoZWNrb3V0LnJlc29sdmUoYXdhaXQgdGhpcy5hY3RpdmF0ZUNvbm5lY3Rpb24oY29ubmVjdGlvbiwgY2hlY2tvdXQub3B0aW9ucykpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY2hlY2tvdXQucmVqZWN0KGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3RpdmF0ZSBkYXRhYmFzZSBjb25uZWN0aW9uLlwiLCB7Y2F1c2U6IGVycm9yfSkpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIG9uZSBpZGxlIGNvbm5lY3Rpb24gZm9yIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFuIGlkbGUgY29ubmVjdGlvbiB3YXMgY2xvc2VkIHRvIGZyZWUgY2FwYWNpdHkuXG4gICAqL1xuICBhc3luYyBjbG9zZU9uZUlkbGVDb25uZWN0aW9uRm9yQ2FwYWNpdHkoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZmluZCgoY2FuZGlkYXRlKSA9PiAhdGhpcy5jb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNhbmRpZGF0ZSkpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IHRoaXMuY29ubmVjdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gY29ubmVjdGlvbilcbiAgICBhd2FpdCB0aGlzLmNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9ucyB8ICgoYXJnOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPil9IG9wdGlvbnNPckNhbGxiYWNrIC0gQ2hlY2tvdXQgb3B0aW9ucyBvciBjYWxsYmFjayB0byBpbnZva2Ugd2l0aCB0aGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoYXJnOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIHRvIGludm9rZSB3aXRoIHRoZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ29ubmVjdGlvbihvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3Qgb3B0aW9ucyA9IHR5cGVvZiBvcHRpb25zT3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIgPyB7fSA6IG9wdGlvbnNPckNhbGxiYWNrXG4gICAgY29uc3QgYWN0dWFsQ2FsbGJhY2sgPSB0eXBlb2Ygb3B0aW9uc09yQ2FsbGJhY2sgPT0gXCJmdW5jdGlvblwiID8gb3B0aW9uc09yQ2FsbGJhY2sgOiBjYWxsYmFja1xuXG4gICAgaWYgKCFhY3R1YWxDYWxsYmFjaykgdGhyb3cgbmV3IEVycm9yKFwid2l0aENvbm5lY3Rpb24gcmVxdWlyZXMgYSBjYWxsYmFja1wiKVxuXG4gICAgY29uc3QgY29ubmVjdGlvbkNvbnRleHRTdXBwcmVzc2VkID0gdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpID09PSBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVFxuICAgIGNvbnN0IHRlc3RTaGFyZWRDb25uZWN0aW9uID0gY29ubmVjdGlvbkNvbnRleHRTdXBwcmVzc2VkID8gdW5kZWZpbmVkIDogdGhpcy5hY3RpdmVUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgaWYgKHRlc3RTaGFyZWRDb25uZWN0aW9uICYmIHRoaXMuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbih0ZXN0U2hhcmVkQ29ubmVjdGlvbikpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLnJ1bih0ZXN0U2hhcmVkQ29ubmVjdGlvbi5nZXRJZFNlcSgpLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxDYWxsYmFjayh0ZXN0U2hhcmVkQ29ubmVjdGlvbilcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY2hlY2tvdXQob3B0aW9ucylcbiAgICBjb25zdCBpZCA9IGNvbm5lY3Rpb24uZ2V0SWRTZXEoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UucnVuKGlkLCBhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgYWN0dWFsQ2FsbGJhY2soY29ubmVjdGlvbilcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBvcGVuQ2FwdHVyZWRDb25uZWN0aW9uKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBjb25zdCB3YXNSZXRhaW5lZCA9IHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuaGFzKHJldXNlS2V5KVxuXG4gICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5hZGQocmV1c2VLZXkpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHtuYW1lOiBcIkZyb250ZW5kIHRlbmFudCBTUUxpdGUgb3BlblwifSlcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXdhc1JldGFpbmVkKSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkUmV1c2VLZXlzLmRlbGV0ZShyZXVzZUtleSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZmx1c2hDYXB0dXJlZENvbm5lY3Rpb24oLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuZ2V0KHJldXNlS2V5KVxuICAgICAgfHwgdGhpcy5jb25uZWN0aW9ucy5maW5kKChjYW5kaWRhdGUpID0+IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjYW5kaWRhdGUpID09PSByZXVzZUtleSlcbiAgICBpZiAoY29ubmVjdGlvbikgYXdhaXQgY29ubmVjdGlvbi5mbHVzaFBlbmRpbmdXcml0ZXMoKVxuICB9XG5cbiAgYXN5bmMgY2xvc2VDYXB0dXJlZENvbm5lY3Rpb24oLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGlmICh0aGlzLmNhcHR1cmVkQ29ubmVjdGlvbkluVXNlKGRhdGFiYXNlQ29uZmlndXJhdGlvbikpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbG9zZSBhbiBpbi11c2UgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBoYW5kbGVcIilcbiAgICBjb25zdCByZXRhaW5lZENvbm5lY3Rpb24gPSB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMuZ2V0KHJldXNlS2V5KVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRSZXVzZUtleXMuZGVsZXRlKHJldXNlS2V5KVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5kZWxldGUocmV1c2VLZXkpXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB0aGlzLmNvbm5lY3Rpb25zLmZpbHRlcigoY2FuZGlkYXRlKSA9PiB0aGlzLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY2FuZGlkYXRlKSA9PT0gcmV1c2VLZXkpXG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IHRoaXMuY29ubmVjdGlvbnMuZmlsdGVyKChjYW5kaWRhdGUpID0+IHRoaXMuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjYW5kaWRhdGUpICE9PSByZXVzZUtleSlcbiAgICBpZiAocmV0YWluZWRDb25uZWN0aW9uKSBjb25uZWN0aW9ucy5wdXNoKHJldGFpbmVkQ29ubmVjdGlvbilcbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gIH1cblxuICBhc3luYyBkZWxldGVDYXB0dXJlZERhdGFiYXNlKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBhd2FpdCB0aGlzLmNsb3NlQ2FwdHVyZWRDb25uZWN0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBjb25zdCBEcml2ZXJDbGFzcyA9IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5kcml2ZXIgfHwgdGhpcy5kcml2ZXJDbGFzc1xuICAgIGlmICghRHJpdmVyQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBjbGFzcyBjb25maWd1cmVkIGZvciBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRlbGV0aW9uXCIpXG4gICAgYXdhaXQgbmV3IERyaXZlckNsYXNzKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgdGhpcy5jb25maWd1cmF0aW9uKS5kZWxldGVEYXRhYmFzZVN0b3JhZ2UoKVxuICB9XG5cbiAgY2FwdHVyZWRDb25uZWN0aW9uSW5Vc2UoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMuY29ubmVjdGlvbnNJblVzZSkuc29tZSgoY29ubmVjdGlvbikgPT4gdGhpcy5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pID09PSByZXVzZUtleSlcbiAgfVxuXG4gIGNhcHR1cmVkQ29ubmVjdGlvbkhhc1BlbmRpbmdXcml0ZXMoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuY29ubmVjdGlvbnMsIC4uLk9iamVjdC52YWx1ZXModGhpcy5jb25uZWN0aW9uc0luVXNlKSwgLi4udGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLnZhbHVlcygpXVxuICAgIHJldHVybiBjb25uZWN0aW9ucy5zb21lKChjb25uZWN0aW9uKSA9PiB0aGlzLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbikgPT09IHJldXNlS2V5ICYmIGNvbm5lY3Rpb24uaGFzUGVuZGluZ1dyaXRlcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYXB0dXJlZCBvcGVyYXRpb24gdGhyb3VnaCB0aGUgbm9ybWFsIGJvdW5kZWQgcG9vbCBsaWZlY3ljbGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNhcHR1cmVkQ29ubmVjdGlvbk9wdGlvbnN9IG9wdGlvbnMgLSBDYXB0dXJlZCBjaGVja291dCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgb3duZXI6IHN5bWJvbCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPcGVyYXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhDYXB0dXJlZE9wZXJhdGlvbkNvbm5lY3Rpb24oe2RhdGFiYXNlQ29uZmlndXJhdGlvbiwgbmFtZX0sIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWV9KVxuICAgIGNvbnN0IGlkID0gY29ubmVjdGlvbi5nZXRJZFNlcSgpXG4gICAgY29uc3Qgb3duZXIgPSBTeW1ib2woXCJjYXB0dXJlZC1kYXRhYmFzZS1vcGVyYXRpb24tb3duZXJcIilcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmFzeW5jTG9jYWxTdG9yYWdlLnJ1bihpZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24sIG93bmVyKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHRlc3Qtc2hhcmVkIGNvbm5lY3Rpb24gZnJvbSB0aGUgcGVyLXRlbmFudCBjb250ZXh0IHByb3ZpZGVycyBvbmx5LlxuICAgKiBVbmxpa2Uge0BsaW5rIHRlc3RTaGFyZWRDb25uZWN0aW9ufSwgdGhpcyBuZXZlciBmYWxscyBiYWNrIHRvIHRoZSBwb29sIGRlZmF1bHQgb3JcbiAgICogdGhlIHBlci1jb25maWd1cmF0aW9uIHNoYXJlZCBjb25uZWN0aW9uLCBzbyBpdCBpcyBzYWZlIHRvIGNvbnN1bHQgZnJvbVxuICAgKiBgZ2V0Q3VycmVudENvbm5lY3Rpb25gIHdpdGhvdXQgY2hhbmdpbmcgYmVoYXZpb3Igd2hlbiBubyBwZXItdGVuYW50IHByb3ZpZGVyXG4gICAqIG1hdGNoZXMgKHRoZSBwcm9kdWN0aW9uIGNhc2UsIHdoZXJlIHRoZSBwcm92aWRlciBsaXN0IGlzIGVtcHR5KS5cbiAgICpcbiAgICogVGhlIHByb3ZpZGVyIGBtYXRjaGVzKClgIGNhbGxiYWNrIG1heSBpbnNwZWN0IHRoZSBsaXZlIHRlbmFudCBjb250ZXh0LCB3aGljaCBpc1xuICAgKiBlc3RhYmxpc2hlZCBkdXJpbmcgcm91dGUgcmVzb2x1dGlvbiDigJQgYWZ0ZXIgdGhlIHJlcXVlc3QtcnVubmVyIGluc3RhbGxzIHRoZSBhc3luY1xuICAgKiBjb25uZWN0aW9uIGNvbnRleHQuIFRoaXMgaXMgd2hhdCBsZXRzIGEgdGVzdCBydW4gZW5yb2xsIG1vcmUgdGhhbiBvbmUgdGVuYW50IG9uIGFcbiAgICogc2luZ2xlIHBvb2wgYW5kIHJvdXRlIGVhY2ggdGVuYW50J3MgaW4tcmVxdWVzdCBxdWVyaWVzIHRvIGl0cyBvd24gZW5yb2xsZWRcbiAgICogY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFBlci10ZW5hbnQgc2hhcmVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICB0ZXN0U2hhcmVkQ29ubmVjdGlvbkZvckN1cnJlbnRUZW5hbnQoKSB7XG4gICAgZm9yIChjb25zdCB7bWF0Y2hlcywgcHJvdmlkZXJ9IG9mIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzLnZhbHVlcygpKSB7XG4gICAgICBpZiAoIW1hdGNoZXMoKSkgY29udGludWVcblxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHByb3ZpZGVyKClcblxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIXRoaXMuY29ubmVjdGlvbk1hdGNoZXNDdXJyZW50Q29uZmlndXJhdGlvbihjb25uZWN0aW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gcHJvdmlkZXIgZm9yICR7dGhpcy5pZGVudGlmaWVyfSByZXR1cm5lZCBhIGNvbm5lY3Rpb24gZm9yIGEgZGlmZmVyZW50IGRhdGFiYXNlIGNvbmZpZ3VyYXRpb25gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29ubmVjdGlvblxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0Q3VycmVudENvbm5lY3Rpb24oKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGNvbnN0IGlkID0gdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoaWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuY3VycmVudEZhbGxiYWNrQ29ubmVjdGlvbk9yRmFpbCgpXG4gICAgaWYgKGlkID09PSBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVCkgcmV0dXJuIHRoaXMuY3VycmVudEZhbGxiYWNrQ29ubmVjdGlvbk9yRmFpbCgpXG5cbiAgICB0aGlzLmVuc3VyZUNvbm5lY3Rpb25Jc0luVXNlKGlkKVxuXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zSW5Vc2VbaWRdXG5cbiAgICBpZiAoIWN1cnJlbnRDb25uZWN0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGdldCBjdXJyZW50IGNvbm5lY3Rpb24gZnJvbSB0aGF0IElEOiAke2lkfWApXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzLnNpemUgPiAwICYmICF0aGlzLmNvbm5lY3Rpb25NYXRjaGVzQ3VycmVudENvbmZpZ3VyYXRpb24oY3VycmVudENvbm5lY3Rpb24pKSB7XG4gICAgICBjb25zdCBwZXJUZW5hbnRDb25uZWN0aW9uID0gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbkZvckN1cnJlbnRUZW5hbnQoKVxuXG4gICAgICBpZiAocGVyVGVuYW50Q29ubmVjdGlvbikgcmV0dXJuIHBlclRlbmFudENvbm5lY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gY3VycmVudENvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgZmFsbGJhY2sgY29ubmVjdGlvbiBvciBmYWlsLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gRmFsbGJhY2sgY29ubmVjdGlvbiwgaWYgcHJlc2VudC5cbiAgICovXG4gIGN1cnJlbnRGYWxsYmFja0Nvbm5lY3Rpb25PckZhaWwoKSB7XG4gICAgY29uc3QgZmFsbGJhY2tDb25uZWN0aW9uID0gdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uKClcblxuICAgIGlmIChmYWxsYmFja0Nvbm5lY3Rpb24pIHJldHVybiBmYWxsYmFja0Nvbm5lY3Rpb25cblxuICAgIHRocm93IG5ldyBFcnJvcihcIklEIGhhc24ndCBiZWVuIHNldCBmb3IgdGhpcyBhc3luYyBjb250ZXh0XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgY29ubmVjdGlvbiBpcyBpbiB1c2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpZCAtIENoZWNrZWQtb3V0IGNvbm5lY3Rpb24gaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZW5zdXJlQ29ubmVjdGlvbklzSW5Vc2UoaWQpIHtcbiAgICBpZiAoIShpZCBpbiB0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbm5lY3Rpb24gJHtpZH0gZG9lc24ndCBleGlzdCBhbnkgbW9yZSAtIGhhcyBpdCBiZWVuIGNoZWNrZWQgaW4gYWdhaW4/YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgZmFsbGJhY2sgY29ubmVjdGlvbiBmb3IgdGhpcyBwb29sIGlkZW50aWZpZXIgdGhhdCB3aWxsIGJlIHVzZWQgd2hlbiBubyBhc3luYyBjb250ZXh0IGlzIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEdsb2JhbENvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIGNvbnN0IGtsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VQb29sQXN5bmNUcmFja2VkTXVsdGlDb25uZWN0aW9ufSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBsZXQgbWFwRm9yQ29uZmlndXJhdGlvbiA9IGtsYXNzLmdsb2JhbENvbm5lY3Rpb25zLmdldCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIW1hcEZvckNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIG1hcEZvckNvbmZpZ3VyYXRpb24gPSB7fVxuICAgICAga2xhc3MuZ2xvYmFsQ29ubmVjdGlvbnMuc2V0KHRoaXMuY29uZmlndXJhdGlvbiwgbWFwRm9yQ29uZmlndXJhdGlvbilcbiAgICB9XG5cbiAgICBtYXBGb3JDb25maWd1cmF0aW9uW3RoaXMuaWRlbnRpZmllcl0gPSBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIGdsb2JhbCBmYWxsYmFjayBjb25uZWN0aW9uIGV4aXN0cyBmb3IgdGhpcyBwb29sIGlkZW50aWZpZXIgYW5kIHJldHVybnMgaXQuXG4gICAqIElmIG9uZSBpcyBhbHJlYWR5IHNldCwgaXQgaXMgcmV0dXJuZWQgYW5kIGFsc28gbWFkZSBhdmFpbGFibGUgaW4gdGhlIHBvb2wgcXVldWUuXG4gICAqIE90aGVyd2lzZSBhIG5ldyBjb25uZWN0aW9uIGlzIHNwYXduZWQsIHJlZ2lzdGVyZWQsIGFuZCBxdWV1ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBnbG9iYWwgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUdsb2JhbENvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldEdsb2JhbENvbm5lY3Rpb24oKVxuXG4gICAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3RpbmdcblxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLnNwYXduQ29ubmVjdGlvbigpXG5cbiAgICB0aGlzLnNldEdsb2JhbENvbm5lY3Rpb24oY29ubmVjdGlvbilcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogU2V0IGEgc2hhcmVkIGNvbm5lY3Rpb24gZm9yIHRlc3QgbW9kZSBzbyB0aGF0IEhUVFAgaGFuZGxlcnMgcnVubmluZ1xuICAgKiBpbiB0aGUgc2FtZSBwcm9jZXNzIGNhbiByZXVzZSB0aGUgdGVzdCBydW5uZXIncyBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gU2hhcmVkIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzZXRUZXN0U2hhcmVkQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge293bmVyOiBTeW1ib2woXCJ0ZXN0LXNoYXJlZC1jb25uZWN0aW9uXCIpfVxuXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gcmVnaXN0cmF0aW9uXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHByb3ZpZGVyIHRoYXQgaXMgZXZhbHVhdGVkIHdoZW4gYW4gaW4tcHJvY2VzcyB0ZXN0IHJlcXVlc3QgaXMgZGlzcGF0Y2hlZC5cbiAgICogQHBhcmFtIHsoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcHJvdmlkZXIgLSBTaGFyZWQgY29ubmVjdGlvbiBwcm92aWRlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gLSBPcGFxdWUgcmVnaXN0cmF0aW9uIGhhbmRsZS5cbiAgICovXG4gIHNldFRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIocHJvdmlkZXIpIHtcbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7b3duZXI6IFN5bWJvbChcInRlc3Qtc2hhcmVkLWNvbm5lY3Rpb24tcHJvdmlkZXJcIil9XG5cbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIgPSBwcm92aWRlclxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gcmVnaXN0cmF0aW9uXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgcHJvdmlkZXIgc2VsZWN0ZWQgYnkgdGhlIGN1cnJlbnQgbGl2ZSBhc3luYyBqb2luIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7e21hdGNoZXM6ICgpID0+IGJvb2xlYW4sIHByb3ZpZGVyOiAoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH19IGFyZ3MgLSBDb250ZXh0IHNlbGVjdG9yIGFuZCBwcm92aWRlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gLSBPcGFxdWUgc2NvcGVkIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICByZWdpc3RlclRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoYXJncykge1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtvd25lcjogU3ltYm9sKFwidGVzdC1zaGFyZWQtY29ubmVjdGlvbi1jb250ZXh0LXByb3ZpZGVyXCIpfVxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzLnNldChyZWdpc3RyYXRpb24sIGFyZ3MpXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBhdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24gZm9yIGV4YWN0bHkgb25lIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBBdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzZXRUZXN0U2hhcmVkQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb24oY29ubmVjdGlvbiwgcmV1c2VLZXkpIHtcbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7b3duZXI6IFN5bWJvbChcInRlc3Qtc2hhcmVkLXBoeXNpY2FsLWNvbm5lY3Rpb25cIil9XG5cbiAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LnNldChyZXVzZUtleSwge2Nvbm5lY3Rpb24sIHJlZ2lzdHJhdGlvbn0pXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgY3VycmVudCBzaGFyZWQgY29ubmVjdGlvbiByZWdpc3RyYXRpb24uIEEgc3VwcGxpZWQgc3RhbGUgcmVnaXN0cmF0aW9uXG4gICAqIGNhbm5vdCBjbGVhciBhIHByb3ZpZGVyIGluc3RhbGxlZCBieSBhIG5ld2VyIGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IFtyZWdpc3RyYXRpb25dIC0gT3BhcXVlIHJlZ2lzdHJhdGlvbiBoYW5kbGUgdG8gY2xlYXIgY29uZGl0aW9uYWxseS5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgaWYgKHJlZ2lzdHJhdGlvbiAmJiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVycy5kZWxldGUocmVnaXN0cmF0aW9uKSkgcmV0dXJuXG4gICAgaWYgKHJlZ2lzdHJhdGlvbikge1xuICAgICAgZm9yIChjb25zdCBbcmV1c2VLZXksIGVudHJ5XSBvZiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5KSB7XG4gICAgICAgIGlmIChlbnRyeS5yZWdpc3RyYXRpb24gIT09IHJlZ2lzdHJhdGlvbikgY29udGludWVcbiAgICAgICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleS5kZWxldGUocmV1c2VLZXkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LmNsZWFyKClcbiAgICB9XG4gICAgaWYgKHJlZ2lzdHJhdGlvbiAmJiByZWdpc3RyYXRpb24gIT09IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uKSByZXR1cm5cblxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fdGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSB0aGUgdGVzdCBzaGFyZWQgY29ubmVjdGlvbidzIGFzeW5jIGNvbnRleHQsIHNvIG5lc3RlZFxuICAgKiBgZ2V0Q3VycmVudENvbm5lY3Rpb25gL2BlbnN1cmVDb25uZWN0aW9uc2AgcmV1c2UgaXQgKHdpdGggYSByZWFsIGNvbnRleHQpIHJhdGhlclxuICAgKiB0aGFuIGNoZWNraW5nIG91dCBhIGZyZXNoIHBvb2xlZCBjb25uZWN0aW9uLiBVc2VkIHRvIHJ1biBhbiBpbi1wcm9jZXNzIHJlcXVlc3RcbiAgICogaGFuZGxlciBvbiB0aGUgc2FtZSBjb25uZWN0aW9uIOKAlCBhbmQgb3BlbiB0cmFuc2FjdGlvbiDigJQgYXMgdGhlIHRlc3QgYm9keS4gTm8tb3BcbiAgICogKHJ1bnMgdGhlIGNhbGxiYWNrIGFzLWlzKSB3aGVuIG5vIHNoYXJlZCBjb25uZWN0aW9uIGlzIHNldC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBpbiB0aGUgc2hhcmVkIGNvbm5lY3Rpb24ncyBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb24oY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5hY3RpdmVUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gdGhpcy5hc3luY0xvY2FsU3RvcmFnZS5ydW4oY29ubmVjdGlvbi5nZXRJZFNlcSgpLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHRlc3Qtc2hhcmVkIGNvbm5lY3Rpb24gb25seSB3aGlsZSBpdHMgY2hlY2tvdXQgSUQgaXMgc3RpbGwgb3duZWQgYnkgdGhpcyBwb29sLlxuICAgKiBGYWxsYmFjay1vbmx5IHJlZ2lzdHJhdGlvbnMgaGF2ZSBubyBjaGVja291dCBJRCBhbmQgbXVzdCBlbnRlciB0aGUgbm9ybWFsIGNoZWNrb3V0IHBhdGguXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgc2hhcmVkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhY3RpdmVUZXN0U2hhcmVkQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgY29uc3QgaWQgPSBjb25uZWN0aW9uPy5nZXRJZFNlcSgpXG5cbiAgICBpZiAodHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSByZXR1cm5cbiAgICBpZiAodGhpcy5jb25uZWN0aW9uc0luVXNlW2lkXSAhPT0gY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25uZWN0aW9uIGN1cnJlbnRseSBlbGlnaWJsZSBmb3IgaW4tcHJvY2VzcyB0ZXN0IHJlcXVlc3Qgc2hhcmluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgdGVzdFNoYXJlZENvbm5lY3Rpb24oKSB7XG4gICAgZm9yIChjb25zdCB7bWF0Y2hlcywgcHJvdmlkZXJ9IG9mIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXJzLnZhbHVlcygpKSB7XG4gICAgICBpZiAobWF0Y2hlcygpKSByZXR1cm4gcHJvdmlkZXIoKVxuICAgIH1cbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KClcbiAgICBjb25zdCBwaHlzaWNhbFJlZ2lzdHJhdGlvbiA9IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uc0J5UmV1c2VLZXkuZ2V0KHJldXNlS2V5KVxuXG4gICAgaWYgKHBoeXNpY2FsUmVnaXN0cmF0aW9uKSByZXR1cm4gcGh5c2ljYWxSZWdpc3RyYXRpb24uY29ubmVjdGlvblxuICAgIHJldHVybiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyXG4gICAgICA/IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoKVxuICAgICAgOiB0aGlzLl90ZXN0U2hhcmVkQ29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbm5lY3Rpb24gdGllZCB0byB0aGUgY3VycmVudCBhc3luYyBjb250ZXh0LCBpZiBhbnkuXG4gICAqIEZhbGxzIGJhY2sgdG8gdGhlIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gd2hlbiBubyBhc3luYyBjb250ZXh0IGV4aXN0cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSBjdXJyZW50IGNvbnRleHQgY29ubmVjdGlvbi5cbiAgICovXG4gIGdldEN1cnJlbnRDb250ZXh0Q29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgaWYgKGlkID09PSBTVVBQUkVTU0VEX0NPTk5FQ1RJT05fQ09OVEVYVCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmIChpZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbigpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIHRoaXMgcG9vbCBoYXMgYSByZWFsIGFzeW5jIGNvbnRleHQgZm9yIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbmVzdGVkIGNvZGUgY2FuIHJldXNlIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICovXG4gIGhhc0N1cnJlbnRDb25uZWN0aW9uQ29udGV4dCgpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMuYXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGlkICE9PSB1bmRlZmluZWQgJiYgaWQgIT09IFNVUFBSRVNTRURfQ09OTkVDVElPTl9DT05URVhUXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdH0gLSBEaWFnbm9zdGljIHNuYXBzaG90IGZvciB0aGlzIHBvb2wuXG4gICAqL1xuICBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gc3VwZXIuZ2V0RGVidWdTbmFwc2hvdCgpXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHtjb25uZWN0aW9uc30gPSB0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90cyhub3cpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uc25hcHNob3QsXG4gICAgICBjb25uZWN0aW9ucyxcbiAgICAgIGNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkOiB0aGlzLmNvbm5lY3Rpb25zQmVpbmdTcGF3bmVkLFxuICAgICAgaWRsZUNvdW50OiB0aGlzLmNvbm5lY3Rpb25zLmxlbmd0aCArIFsuLi50aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCldLmZpbHRlcigoY29ubmVjdGlvbikgPT4gY29ubmVjdGlvbi5nZXRJZFNlcSgpID09PSB1bmRlZmluZWQpLmxlbmd0aCxcbiAgICAgIGlkbGVNYXRjaGluZ1BlbmRpbmdDaGVja291dENvdW50OiB0aGlzLmNvbm5lY3Rpb25zLmZpbHRlcigoY29ubmVjdGlvbikgPT4ge1xuICAgICAgICByZXR1cm4gIXRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKVxuICAgICAgICAgICYmIHRoaXMucGVuZGluZ0NoZWNrb3V0cy5zb21lKChjaGVja291dCkgPT4gdGhpcy5jb25uZWN0aW9uTWF0Y2hlc1JldXNlS2V5KGNvbm5lY3Rpb24sIGNoZWNrb3V0LnJldXNlS2V5KSlcbiAgICAgIH0pLmxlbmd0aCxcbiAgICAgIGluVXNlQ291bnQ6IE9iamVjdC5rZXlzKHRoaXMuY29ubmVjdGlvbnNJblVzZSkubGVuZ3RoLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0RHJhaW5BY3RpdmU6IEJvb2xlYW4odGhpcy5wZW5kaW5nQ2hlY2tvdXREcmFpblByb21pc2UpLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQ6IHRoaXMucGVuZGluZ0NoZWNrb3V0RHJhaW5SZXF1ZXN0ZWQsXG4gICAgICBwZW5kaW5nQ2hlY2tvdXRzOiB0aGlzLnBlbmRpbmdDaGVja291dERlYnVnU25hcHNob3RzKG5vdyksXG4gICAgICBwZW5kaW5nQ2hlY2tvdXRDb3VudDogdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLmxlbmd0aCxcbiAgICAgIHRlbGVtZXRyeTogey4uLnRoaXMudGVsZW1ldHJ5fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGNvbm5lY3Rpb24gc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHt7Y29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHNlZW5Db25uZWN0aW9uczogU2V0PGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IC0gQ29ubmVjdGlvbiBzbmFwc2hvdHMgYW5kIHNlZW4gc2V0LlxuICAgKi9cbiAgZGVidWdDb25uZWN0aW9uU25hcHNob3RzKG5vdykge1xuICAgIC8qKlxuICAgICAqIENvbm5lY3Rpb25zLlxuICAgICAqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gW11cbiAgICBjb25zdCBzZWVuQ29ubmVjdGlvbnMgPSBuZXcgU2V0KClcblxuICAgIHRoaXMuYWRkSW5Vc2VEZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMoe2Nvbm5lY3Rpb25zLCBub3csIHNlZW5Db25uZWN0aW9uc30pXG4gICAgdGhpcy5hZGRJZGxlRGVidWdDb25uZWN0aW9uU25hcHNob3RzKHtjb25uZWN0aW9ucywgbm93LCBzZWVuQ29ubmVjdGlvbnN9KVxuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmxpZmVjeWNsZVJldGFpbmVkQ29ubmVjdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgIHRoaXMuYWRkRGVidWdDb25uZWN0aW9uU25hcHNob3RJZlVuc2Vlbih7Y29ubmVjdGlvbiwgY29ubmVjdGlvbnMsIHJlYXBhYmxlOiBmYWxzZSwgc2VlbkNvbm5lY3Rpb25zLCBzdGF0ZTogXCJsaWZlY3ljbGUtcmV0YWluZWRcIn0pXG4gICAgfVxuICAgIHRoaXMuYWRkRmFsbGJhY2tEZWJ1Z0Nvbm5lY3Rpb25TbmFwc2hvdHMoe2Nvbm5lY3Rpb25zLCBzZWVuQ29ubmVjdGlvbnN9KVxuXG4gICAgcmV0dXJuIHtjb25uZWN0aW9ucywgc2VlbkNvbm5lY3Rpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGluIHVzZSBkZWJ1ZyBjb25uZWN0aW9uIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIG5vdzogbnVtYmVyLCBzZWVuQ29ubmVjdGlvbnM6IFNldDxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59fSBhcmdzIC0gU25hcHNob3QgY29sbGVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRJblVzZURlYnVnQ29ubmVjdGlvblNuYXBzaG90cyh7Y29ubmVjdGlvbnMsIG5vdywgc2VlbkNvbm5lY3Rpb25zfSkge1xuICAgIGZvciAoY29uc3QgW2lkLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbm5lY3Rpb25zSW5Vc2UpKSB7XG4gICAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgICBjb25zdCBjaGVja2VkT3V0QXQgPSB0cmFja2VkQ29ubmVjdGlvbltDT05ORUNUSU9OX0NIRUNLRURfT1VUX0FUXVxuICAgICAgY29uc3QgY2hlY2tlZE91dEZvck1zID0gdHlwZW9mIGNoZWNrZWRPdXRBdCA9PT0gXCJudW1iZXJcIiA/IE1hdGgubWF4KDAsIG5vdyAtIGNoZWNrZWRPdXRBdCkgOiB1bmRlZmluZWRcblxuICAgICAgc2VlbkNvbm5lY3Rpb25zLmFkZChjb25uZWN0aW9uKVxuICAgICAgY29ubmVjdGlvbnMucHVzaCh0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90KGNvbm5lY3Rpb24sIHtjaGVja2VkT3V0QXQsIGNoZWNrZWRPdXRGb3JNcywgY2hlY2tvdXRJZDogaWQsIHN0YXRlOiBcImluLXVzZVwifSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGlkbGUgZGVidWcgY29ubmVjdGlvbiBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBub3c6IG51bWJlciwgc2VlbkNvbm5lY3Rpb25zOiBTZXQ8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fX0gYXJncyAtIFNuYXBzaG90IGNvbGxlY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkSWRsZURlYnVnQ29ubmVjdGlvblNuYXBzaG90cyh7Y29ubmVjdGlvbnMsIG5vdywgc2VlbkNvbm5lY3Rpb25zfSkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICBpZiAoc2VlbkNvbm5lY3Rpb25zLmhhcyhjb25uZWN0aW9uKSkgY29udGludWVcblxuICAgICAgc2VlbkNvbm5lY3Rpb25zLmFkZChjb25uZWN0aW9uKVxuXG4gICAgICBjb25zdCB0cmFja2VkQ29ubmVjdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXT86IG51bWJlcn19ICovIChjb25uZWN0aW9uKVxuICAgICAgY29uc3QgY2hlY2tlZEluQXQgPSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cbiAgICAgIGNvbnN0IGlkbGVGb3JNcyA9IHR5cGVvZiBjaGVja2VkSW5BdCA9PT0gXCJudW1iZXJcIiA/IE1hdGgubWF4KDAsIG5vdyAtIGNoZWNrZWRJbkF0KSA6IHVuZGVmaW5lZFxuXG4gICAgICBjb25uZWN0aW9ucy5wdXNoKHRoaXMuZGVidWdDb25uZWN0aW9uU25hcHNob3QoY29ubmVjdGlvbiwge2NoZWNrZWRJbkF0LCBpZGxlRm9yTXMsIHN0YXRlOiBcImlkbGVcIn0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBmYWxsYmFjayBkZWJ1ZyBjb25uZWN0aW9uIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHNlZW5Db25uZWN0aW9uczogU2V0PGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IGFyZ3MgLSBTbmFwc2hvdCBjb2xsZWN0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZEZhbGxiYWNrRGVidWdDb25uZWN0aW9uU25hcHNob3RzKHtjb25uZWN0aW9ucywgc2VlbkNvbm5lY3Rpb25zfSkge1xuICAgIHRoaXMuYWRkRGVidWdDb25uZWN0aW9uU25hcHNob3RJZlVuc2Vlbih7Y29ubmVjdGlvbjogdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpLCBjb25uZWN0aW9ucywgcmVhcGFibGU6IGZhbHNlLCBzZWVuQ29ubmVjdGlvbnMsIHN0YXRlOiBcImdsb2JhbFwifSlcbiAgICB0aGlzLmFkZERlYnVnQ29ubmVjdGlvblNuYXBzaG90SWZVbnNlZW4oe2Nvbm5lY3Rpb246IHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uLCBjb25uZWN0aW9ucywgcmVhcGFibGU6IGZhbHNlLCBzZWVuQ29ubmVjdGlvbnMsIHN0YXRlOiBcInRlc3Qtc2hhcmVkXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGRlYnVnIGNvbm5lY3Rpb24gc25hcHNob3QgaWYgdW5zZWVuLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgY29ubmVjdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHJlYXBhYmxlPzogYm9vbGVhbiwgc2VlbkNvbm5lY3Rpb25zOiBTZXQ8aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+LCBzdGF0ZTogc3RyaW5nfX0gYXJncyAtIFNuYXBzaG90IGNvbGxlY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkRGVidWdDb25uZWN0aW9uU25hcHNob3RJZlVuc2Vlbih7Y29ubmVjdGlvbiwgY29ubmVjdGlvbnMsIHJlYXBhYmxlLCBzZWVuQ29ubmVjdGlvbnMsIHN0YXRlfSkge1xuICAgIGlmICghY29ubmVjdGlvbiB8fCBzZWVuQ29ubmVjdGlvbnMuaGFzKGNvbm5lY3Rpb24pKSByZXR1cm5cblxuICAgIHNlZW5Db25uZWN0aW9ucy5hZGQoY29ubmVjdGlvbilcbiAgICBjb25uZWN0aW9ucy5wdXNoKHRoaXMuZGVidWdDb25uZWN0aW9uU25hcHNob3QoY29ubmVjdGlvbiwge3JlYXBhYmxlLCBzdGF0ZX0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVuZGluZyBjaGVja291dCBkZWJ1ZyBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5EYXRhYmFzZVBvb2xQZW5kaW5nQ2hlY2tvdXREZWJ1Z1NuYXBzaG90W119IC0gUGVuZGluZyBjaGVja291dCBzbmFwc2hvdHMuXG4gICAqL1xuICBwZW5kaW5nQ2hlY2tvdXREZWJ1Z1NuYXBzaG90cyhub3cpIHtcbiAgICByZXR1cm4gdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLm1hcCgoY2hlY2tvdXQsIGluZGV4KSA9PiAoe1xuICAgICAgY2hlY2tvdXROYW1lOiBjaGVja291dC5vcHRpb25zLm5hbWUsXG4gICAgICBlbnF1ZXVlZEF0OiBjaGVja291dC5lbnF1ZXVlZEF0LFxuICAgICAgaW5kZXgsXG4gICAgICByZW1haW5pbmdUaW1lb3V0TXM6IGNoZWNrb3V0LnRpbWVvdXRBdCA9PT0gbnVsbCA/IG51bGwgOiBNYXRoLm1heCgwLCBjaGVja291dC50aW1lb3V0QXQgLSBub3cpLFxuICAgICAgcmV1c2VLZXk6IGNoZWNrb3V0LnJldXNlS2V5LFxuICAgICAgdGltZW91dEF0OiBjaGVja291dC50aW1lb3V0QXQsXG4gICAgICB0aW1lb3V0TWlsbGlzOiBjaGVja291dC50aW1lb3V0TWlsbGlzLFxuICAgICAgd2FpdGluZ0Zvck1zOiBNYXRoLm1heCgwLCBub3cgLSBjaGVja291dC5lbnF1ZXVlZEF0KVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGdsb2JhbCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIGdsb2JhbCBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0R2xvYmFsQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5nZXRHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVyblxuICAgIGlmICghdGhpcy5jb25uZWN0aW9uTWF0Y2hlc0N1cnJlbnRDb25maWd1cmF0aW9uKGNvbm5lY3Rpb24pKSByZXR1cm5cblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZ2xvYmFsIGNvbm5lY3Rpb24gZm9yIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgZ2xvYmFsIGNvbm5lY3Rpb24gZm9yIHRoaXMgcG9vbCBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKSB7XG4gICAgY29uc3Qga2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVBvb2xBc3luY1RyYWNrZWRNdWx0aUNvbm5lY3Rpb259ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IG1hcEZvckNvbmZpZ3VyYXRpb24gPSBrbGFzcy5nbG9iYWxDb25uZWN0aW9ucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgcmV0dXJuIG1hcEZvckNvbmZpZ3VyYXRpb24/Llt0aGlzLmlkZW50aWZpZXJdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBnbG9iYWwgY29ubmVjdGlvbiBmb3IgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2xlYXJHbG9iYWxDb25uZWN0aW9uRm9ySWRlbnRpZmllcigpIHtcbiAgICBjb25zdCBrbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUG9vbEFzeW5jVHJhY2tlZE11bHRpQ29ubmVjdGlvbn0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgbWFwRm9yQ29uZmlndXJhdGlvbiA9IGtsYXNzLmdsb2JhbENvbm5lY3Rpb25zLmdldCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIW1hcEZvckNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgZGVsZXRlIG1hcEZvckNvbmZpZ3VyYXRpb25bdGhpcy5pZGVudGlmaWVyXVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBzY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGJ5IGV2ZXJ5IGxpdmUgY29ubmVjdGlvbiBvd25lZCBieSB0aGlzIHBvb2wuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGUoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLnRoaXMuY29ubmVjdGlvbnMsXG4gICAgICAuLi5PYmplY3QudmFsdWVzKHRoaXMuY29ubmVjdGlvbnNJblVzZSksXG4gICAgICB0aGlzLmdldEdsb2JhbENvbm5lY3Rpb24oKSxcbiAgICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXG5cbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIHtcbiAgICAgIGlmIChjb25uZWN0aW9uKSB0aGlzLl9jbGVhckNvbm5lY3Rpb25TY2hlbWFDYWNoZShjb25uZWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlkbGUgdGltZW91dCBtaWxsaXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIElkbGUgdGltZW91dCBpbiBtaWxsaXNlY29uZHMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAgICovXG4gIGlkbGVUaW1lb3V0TWlsbGlzKCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkucG9vbD8uaWRsZVRpbWVvdXRNaWxsaXNcblxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodGhpcy52YWxpZElkbGVUaW1lb3V0TWlsbGlzKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gREVGQVVMVF9JRExFX1RJTUVPVVRfTUlMTElTXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZCBpZGxlIHRpbWVvdXQgbWlsbGlzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBpZGxlIHRpbWVvdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBudW1iZXJ9IC0gV2hldGhlciB0aGUgdmFsdWUgaXMgYSB2YWxpZCBpZGxlIHRpbWVvdXQuXG4gICAqL1xuICB2YWxpZElkbGVUaW1lb3V0TWlsbGlzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVkdWxlIGlkbGUgY29ubmVjdGlvbiByZWFwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBzY2hlZHVsZUlkbGVDb25uZWN0aW9uUmVhcGVyKCkge1xuICAgIGlmICh0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIpIHJldHVyblxuICAgIGlmICghdGhpcy5oYXNJZGxlQ29ubmVjdGlvbnNUb1JlYXAoKSkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxheSA9IHRoaXMubmV4dElkbGVDb25uZWN0aW9uUmVhcERlbGF5KC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAodGhpcy5pZGxlVGltZW91dE1pbGxpcygpKSlcblxuICAgIHRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMucmVhcElkbGVDb25uZWN0aW9ucygpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byByZWFwIGlkbGUgZGF0YWJhc2UgY29ubmVjdGlvbnM6XCIsIGVycm9yXSlcbiAgICAgIH0pXG4gICAgfSwgZGVsYXkpXG5cbiAgICBpZiAodHlwZW9mIHRoaXMuaWRsZUNvbm5lY3Rpb25SZWFwZXJUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIudW5yZWYoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBpZGxlIGNvbm5lY3Rpb25zIHRvIHJlYXAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW4gaWRsZSByZWFwZXIgdGltZXIgc2hvdWxkIGJlIHNjaGVkdWxlZC5cbiAgICovXG4gIGhhc0lkbGVDb25uZWN0aW9uc1RvUmVhcCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9ucy5sZW5ndGggPiAwICYmIHRoaXMuaWRsZVRpbWVvdXRNaWxsaXMoKSAhPT0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBpZGxlIGNvbm5lY3Rpb24gcmVhcCBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGlkbGVUaW1lb3V0TWlsbGlzIC0gSWRsZSB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBiZWZvcmUgdGhlIG5leHQgcmVhcC5cbiAgICovXG4gIG5leHRJZGxlQ29ubmVjdGlvblJlYXBEZWxheShpZGxlVGltZW91dE1pbGxpcykge1xuICAgIGxldCBkZWxheSA9IGlkbGVUaW1lb3V0TWlsbGlzXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgICBjb25zdCBjaGVja2VkSW5BdCA9IHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXVxuXG4gICAgICBpZiAodHlwZW9mIGNoZWNrZWRJbkF0ICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBkZWxheSA9IE1hdGgubWluKGRlbGF5LCBNYXRoLm1heCgwLCBpZGxlVGltZW91dE1pbGxpcyAtIChub3cgLSBjaGVja2VkSW5BdCkpKVxuICAgIH1cblxuICAgIHJldHVybiBkZWxheVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBpZGxlIGNoZWNrZWQtaW4gY29ubmVjdGlvbnMgdGhhdCBoYXZlIGV4Y2VlZGVkIHRoZSBjb25maWd1cmVkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZWFwSWRsZUNvbm5lY3Rpb25zKCkge1xuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBpZGxlVGltZW91dE1pbGxpcyA9IHRoaXMuaWRsZVRpbWVvdXRNaWxsaXMoKVxuXG4gICAgaWYgKGlkbGVUaW1lb3V0TWlsbGlzID09PSBudWxsKSByZXR1cm5cbiAgICBjb25zdCBzdGFydGVkQXQgPSB0aGlzLm5vd01zKClcbiAgICBjb25zdCBwcm9maWxlQ29udGV4dCA9IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qge2V4cGlyZWRDb25uZWN0aW9ucywga2VwdENvbm5lY3Rpb25zfSA9IHRoaXMuY2xhc3NpZnlJZGxlQ29ubmVjdGlvbnNGb3JSZWFwaW5nKHtpZGxlVGltZW91dE1pbGxpcywgbm93OiB0aGlzLm5vd01zKCl9KVxuXG4gICAgICB0aGlzLmNvbm5lY3Rpb25zID0ga2VwdENvbm5lY3Rpb25zXG4gICAgICBhd2FpdCB0aGlzLmNsb3NlRXhwaXJlZElkbGVDb25uZWN0aW9ucyhleHBpcmVkQ29ubmVjdGlvbnMsIHByb2ZpbGVDb250ZXh0KVxuICAgICAgYXdhaXQgdGhpcy5hd2FpdEluZmxpZ2h0Q29ubmVjdGlvbkNsb3NlcygpXG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5sZW5ndGggPiAwKSB0aGlzLnNjaGVkdWxlSWRsZUNvbm5lY3Rpb25SZWFwZXIoKVxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgZHVyYXRpb25NcyA9IE1hdGgubWF4KDAsIHRoaXMubm93TXMoKSAtIHN0YXJ0ZWRBdClcblxuICAgICAgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBDb3VudCsrXG4gICAgICBpZiAoZmFpbGVkKSB0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcEZhaWx1cmVDb3VudCsrXG4gICAgICB0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcFRvdGFsTXMgKz0gZHVyYXRpb25Nc1xuICAgICAgdGhpcy50ZWxlbWV0cnkuaWRsZVJlYXBNYXhNcyA9IE1hdGgubWF4KHRoaXMudGVsZW1ldHJ5LmlkbGVSZWFwTWF4TXMsIGR1cmF0aW9uTXMpXG4gICAgICB0aGlzLnJlY29yZFRlc3RQcm9maWxlUG9vbE1ldHJpYyhwcm9maWxlQ29udGV4dCwgXCJpZGxlUmVhcFwiLCB7ZHVyYXRpb25NcywgZmFpbGVkfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBleHBpcmVkIGlkbGUgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXX0gZXhwaXJlZENvbm5lY3Rpb25zIC0gQ29ubmVjdGlvbnMgdG8gY2xvc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBbcHJvZmlsZUNvbnRleHRdIC0gUmVhcGVyIHByb2ZpbGUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBjbG9zZUV4cGlyZWRJZGxlQ29ubmVjdGlvbnMoZXhwaXJlZENvbm5lY3Rpb25zLCBwcm9maWxlQ29udGV4dCkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiBleHBpcmVkQ29ubmVjdGlvbnMpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgICB0aGlzLnRlbGVtZXRyeS5pZGxlUmVhcERpc3Bvc2FsQ291bnQrK1xuICAgICAgdGhpcy5yZWNvcmRUZXN0UHJvZmlsZVBvb2xNZXRyaWMocHJvZmlsZUNvbnRleHQsIFwiaWRsZVJlYXBEaXNwb3NhbFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF3YWl0IGluZmxpZ2h0IGNvbm5lY3Rpb24gY2xvc2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIGluLWZsaWdodCBjb25uZWN0aW9uIGNsb3NlcyBzZXR0bGUuXG4gICAqL1xuICBhc3luYyBhd2FpdEluZmxpZ2h0Q29ubmVjdGlvbkNsb3NlcygpIHtcbiAgICBpZiAodGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXMuc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4udGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXNdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsYXNzaWZ5IGlkbGUgY29ubmVjdGlvbnMgZm9yIHJlYXBpbmcuXG4gICAqIEBwYXJhbSB7e2lkbGVUaW1lb3V0TWlsbGlzOiBudW1iZXIsIG5vdzogbnVtYmVyfX0gYXJncyAtIFJlYXBlciBjbGFzc2lmaWNhdGlvbiBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHt7ZXhwaXJlZENvbm5lY3Rpb25zOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdLCBrZXB0Q29ubmVjdGlvbnM6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W119fSAtIENsYXNzaWZpZWQgaWRsZSBjb25uZWN0aW9ucy5cbiAgICovXG4gIGNsYXNzaWZ5SWRsZUNvbm5lY3Rpb25zRm9yUmVhcGluZyh7aWRsZVRpbWVvdXRNaWxsaXMsIG5vd30pIHtcbiAgICAvKipcbiAgICAgKiBLZXB0IGNvbm5lY3Rpb25zLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IGtlcHRDb25uZWN0aW9ucyA9IFtdXG4gICAgLyoqXG4gICAgICogRXhwaXJlZCBjb25uZWN0aW9ucy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBleHBpcmVkQ29ubmVjdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIHRoaXMuY2xhc3NpZnlJZGxlQ29ubmVjdGlvbkZvclJlYXBpbmcoe2Nvbm5lY3Rpb24sIGV4cGlyZWRDb25uZWN0aW9ucywgaWRsZVRpbWVvdXRNaWxsaXMsIGtlcHRDb25uZWN0aW9ucywgbm93fSlcbiAgICB9XG5cbiAgICByZXR1cm4ge2V4cGlyZWRDb25uZWN0aW9ucywga2VwdENvbm5lY3Rpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xhc3NpZnkgaWRsZSBjb25uZWN0aW9uIGZvciByZWFwaW5nLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZXhwaXJlZENvbm5lY3Rpb25zOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdFtdLCBpZGxlVGltZW91dE1pbGxpczogbnVtYmVyLCBrZXB0Q29ubmVjdGlvbnM6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0W10sIG5vdzogbnVtYmVyfX0gYXJncyAtIENsYXNzaWZpY2F0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsYXNzaWZ5SWRsZUNvbm5lY3Rpb25Gb3JSZWFwaW5nKHtjb25uZWN0aW9uLCBleHBpcmVkQ29ubmVjdGlvbnMsIGlkbGVUaW1lb3V0TWlsbGlzLCBrZXB0Q29ubmVjdGlvbnMsIG5vd30pIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uSXNDbG9zZWQoY29ubmVjdGlvbikpIHJldHVyblxuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIHtcbiAgICAgIGtlcHRDb25uZWN0aW9ucy5wdXNoKGNvbm5lY3Rpb24pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLmlkbGVDb25uZWN0aW9uRXhwaXJlZCh7Y29ubmVjdGlvbiwgaWRsZVRpbWVvdXRNaWxsaXMsIG5vd30pID8gZXhwaXJlZENvbm5lY3Rpb25zIDoga2VwdENvbm5lY3Rpb25zXG5cbiAgICB0YXJnZXQucHVzaChjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdGlvbiBpcyBjbG9zZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgbWFya2VkIGNsb3NlZC5cbiAgICovXG4gIGNvbm5lY3Rpb25Jc0Nsb3NlZChjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDTE9TRURfQ09OTkVDVElPTl0/OiBib29sZWFufX0gKi8gKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gQm9vbGVhbih0cmFja2VkQ29ubmVjdGlvbltDTE9TRURfQ09OTkVDVElPTl0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpZGxlIGNvbm5lY3Rpb24gZXhwaXJlZC5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGlkbGVUaW1lb3V0TWlsbGlzOiBudW1iZXIsIG5vdzogbnVtYmVyfX0gYXJncyAtIEV4cGlyeSBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGlkbGUgY29ubmVjdGlvbiBleHBpcmVkLlxuICAgKi9cbiAgaWRsZUNvbm5lY3Rpb25FeHBpcmVkKHtjb25uZWN0aW9uLCBpZGxlVGltZW91dE1pbGxpcywgbm93fSkge1xuICAgIGNvbnN0IHRyYWNrZWRDb25uZWN0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtbSURMRV9DT05ORUNUSU9OX0NIRUNLRURfSU5fQVRdPzogbnVtYmVyfX0gKi8gKGNvbm5lY3Rpb24pXG4gICAgY29uc3QgY2hlY2tlZEluQXQgPSB0cmFja2VkQ29ubmVjdGlvbltJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF1cblxuICAgIHJldHVybiB0eXBlb2YgY2hlY2tlZEluQXQgPT09IFwibnVtYmVyXCIgJiYgbm93IC0gY2hlY2tlZEluQXQgPj0gaWRsZVRpbWVvdXRNaWxsaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24gaGFzIG9wZW4gdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaGFzIGFuIG9wZW4gdHJhbnNhY3Rpb24uXG4gICAqL1xuICBjb25uZWN0aW9uSGFzT3BlblRyYW5zYWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gY29ubmVjdGlvbi5fdHJhbnNhY3Rpb25zQ291bnQgPiAwXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBhbnkgdHJhbnNhY3Rpb24gYSBwcmV2aW91cyBob2xkZXIgbGVmdCBvcGVuIGJlZm9yZSBhIGNvbm5lY3Rpb25cbiAgICogcmUtZW50ZXJzIHRoZSBpZGxlIHBvb2wuIEEgY29ubmVjdGlvbiByZXR1cm5lZCB0byB0aGUgcG9vbCB3aXRoIGFuIG9wZW5cbiAgICogdHJhbnNhY3Rpb24gd291bGQgb3RoZXJ3aXNlIGJlIGhhbmRlZCB0byBhbiB1bnJlbGF0ZWQgY2hlY2tvdXQsIHdob3NlXG4gICAqIHN0YXJ0VHJhbnNhY3Rpb24oKSB0aGVuIGZhaWxzIHdpdGggXCJBIHRyYW5zYWN0aW9uIGlzIGFscmVhZHkgcnVubmluZ1wiIGFuZFxuICAgKiBwb2lzb25zIGV2ZXJ5IGZvbGxvd2luZyBjYWxsZXIgdGhhdCByZXVzZXMgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIGJlaW5nIGNoZWNrZWQgaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvbm5lY3Rpb24gaG9sZHMgbm8gb3BlbiB0cmFuc2FjdGlvbi5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrTGVmdE9wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb25IYXNPcGVuVHJhbnNhY3Rpb24oY29ubmVjdGlvbikpIHJldHVyblxuXG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbYFJvbGxpbmcgYmFjayBhIHRyYW5zYWN0aW9uIGxlZnQgb3BlbiBvbiBhIGNvbm5lY3Rpb24gYmVpbmcgY2hlY2tlZCBpbiAoaWRlbnRpZmllcj0ke3RoaXMuaWRlbnRpZmllcn0pLmBdKVxuXG4gICAgd2hpbGUgKHRoaXMuY29ubmVjdGlvbkhhc09wZW5UcmFuc2FjdGlvbihjb25uZWN0aW9uKSkge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0byBjbG9zZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgLy8gSWRlbXBvdGVudDogYSBmaXJlLWFuZC1mb3JnZXQgc2NoZWR1bGVkIHJlYXAgYW5kIGFuIGV4cGxpY2l0IHJlYXAgY2FuIGJvdGhcbiAgICAvLyB0YXJnZXQgdGhlIHNhbWUgY29ubmVjdGlvbi4gQXdhaXQgdGhlIGluLWZsaWdodCBjbG9zZSBpbnN0ZWFkIG9mIGNsb3NpbmdcbiAgICAvLyB0d2ljZSAod2hpY2ggY2FuIHRocm93IG9uIHRoZSBkcml2ZXIpIG9yIHJldHVybmluZyB3aGlsZSB0aGUgdW5kZXJseWluZ1xuICAgIC8vIGhhbmRsZSBpcyBzdGlsbCBvcGVuLlxuICAgIGNvbnN0IGV4aXN0aW5nQ2xvc2UgPSB0aGlzLmNvbm5lY3Rpb25DbG9zZVByb21pc2VzLmdldChjb25uZWN0aW9uKVxuXG4gICAgaWYgKGV4aXN0aW5nQ2xvc2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCBleGlzdGluZ0Nsb3NlXG4gICAgfVxuXG4gICAgY29uc3QgdHJhY2tlZENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge1tDTE9TRURfQ09OTkVDVElPTl0/OiBib29sZWFuLCBbQ09OTkVDVElPTl9DSEVDS0VEX09VVF9BVF0/OiBudW1iZXIsIFtJRExFX0NPTk5FQ1RJT05fQ0hFQ0tFRF9JTl9BVF0/OiBudW1iZXJ9fSAqLyAoY29ubmVjdGlvbilcblxuICAgIGZvciAoY29uc3QgW3JldXNlS2V5LCByZXRhaW5lZENvbm5lY3Rpb25dIG9mIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucykge1xuICAgICAgaWYgKHJldGFpbmVkQ29ubmVjdGlvbiA9PT0gY29ubmVjdGlvbikgdGhpcy5saWZlY3ljbGVSZXRhaW5lZENvbm5lY3Rpb25zLmRlbGV0ZShyZXVzZUtleSlcbiAgICB9XG5cbiAgICB0cmFja2VkQ29ubmVjdGlvbltDTE9TRURfQ09OTkVDVElPTl0gPSB0cnVlXG4gICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0NPTk5FQ1RJT05fQ0hFQ0tFRF9PVVRfQVRdXG4gICAgZGVsZXRlIHRyYWNrZWRDb25uZWN0aW9uW0lETEVfQ09OTkVDVElPTl9DSEVDS0VEX0lOX0FUXVxuXG4gICAgY29uc3QgY2xvc2VQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRyYWNrZWRDb25uZWN0aW9uLmNsb3NlKClcbiAgICB9KSgpXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25DbG9zZVByb21pc2VzLnNldChjb25uZWN0aW9uLCBjbG9zZVByb21pc2UpXG4gICAgdGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXMuYWRkKGNsb3NlUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG9zZVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5pbmZsaWdodENvbm5lY3Rpb25DbG9zZXMuZGVsZXRlKGNsb3NlUHJvbWlzZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBpZGxlIGNvbm5lY3Rpb24gcmVhcGVyIHRpbWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgY2xlYXJJZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKCkge1xuICAgIGlmICghdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyKSByZXR1cm5cblxuICAgIGNsZWFyVGltZW91dCh0aGlzLmlkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIpXG4gICAgdGhpcy5pZGxlQ29ubmVjdGlvblJlYXBlclRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFsbCBhY3RpdmUgYW5kIGNhY2hlZCBjb25uZWN0aW9ucyBmb3IgdGhpcyBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2VBbGwoKSB7XG4gICAgdGhpcy5jbGVhcklkbGVDb25uZWN0aW9uUmVhcGVyVGltZXIoKVxuICAgIHRoaXMucmVqZWN0UGVuZGluZ0NoZWNrb3V0cyhuZXcgRXJyb3IoXCJEYXRhYmFzZSBwb29sIHdhcyBjbG9zZWQgYmVmb3JlIGNoZWNrb3V0IGNvbXBsZXRlZC5cIikpXG5cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IG5ldyBTZXQoW1xuICAgICAgLi4udGhpcy5jb25uZWN0aW9ucyxcbiAgICAgIC4uLk9iamVjdC52YWx1ZXModGhpcy5jb25uZWN0aW9uc0luVXNlKSxcbiAgICAgIC4uLnRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy52YWx1ZXMoKSxcbiAgICAgIHRoaXMuZ2V0R2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKSxcbiAgICAgIHRoaXMuX3Rlc3RTaGFyZWRDb25uZWN0aW9uXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gW11cbiAgICB0aGlzLmNvbm5lY3Rpb25zSW5Vc2UgPSB7fVxuICAgIHRoaXMubGlmZWN5Y2xlUmV0YWluZWRDb25uZWN0aW9ucy5jbGVhcigpXG4gICAgdGhpcy5saWZlY3ljbGVSZXRhaW5lZFJldXNlS2V5cy5jbGVhcigpXG4gICAgdGhpcy5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKClcbiAgICB0aGlzLmNsZWFyR2xvYmFsQ29ubmVjdGlvbkZvcklkZW50aWZpZXIoKVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIGNvbm5lY3Rpb25zKSB7XG4gICAgICBpZiAoIWNvbm5lY3Rpb24pIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgfVxuXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWplY3QgcGVuZGluZyBjaGVja291dHMuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdG8gcmVqZWN0IHBlbmRpbmcgY2hlY2tvdXRzIHdpdGguXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVqZWN0UGVuZGluZ0NoZWNrb3V0cyhlcnJvcikge1xuICAgIGNvbnN0IHBlbmRpbmdDaGVja291dHMgPSB0aGlzLnBlbmRpbmdDaGVja291dHNcblxuICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNoZWNrb3V0IG9mIHBlbmRpbmdDaGVja291dHMpIHtcbiAgICAgIHRoaXMuY2xlYXJQZW5kaW5nQ2hlY2tvdXRUaW1lb3V0KGNoZWNrb3V0KVxuICAgICAgY2hlY2tvdXQucmVqZWN0KGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyBhbGwgZ2xvYmFsbHkgcmVnaXN0ZXJlZCBmYWxsYmFjayBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IFtjb25uZWN0aW9uc10gLSBDb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRHbG9iYWxDb25uZWN0aW9ucyhjb25uZWN0aW9ucywgY29uZmlndXJhdGlvbikge1xuICAgIGlmICghY29uZmlndXJhdGlvbikge1xuICAgICAgdGhpcy5nbG9iYWxDb25uZWN0aW9ucyA9IG5ldyBXZWFrTWFwKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuZ2xvYmFsQ29ubmVjdGlvbnMuc2V0KGNvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb25zIHx8IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBnbG9iYWxseSByZWdpc3RlcmVkIGZhbGxiYWNrIGNvbm5lY3Rpb25zIGZvciBhbGwgY29uZmlndXJhdGlvbnMgb3IgYSBzaW5nbGUgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBjbGVhckdsb2JhbENvbm5lY3Rpb25zKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRoaXMuZ2xvYmFsQ29ubmVjdGlvbnMgPSBuZXcgV2Vha01hcCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmdsb2JhbENvbm5lY3Rpb25zLmRlbGV0ZShjb25maWd1cmF0aW9uKVxuICB9XG59XG4iXX0=