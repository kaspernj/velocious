// @ts-check
import BasePool from "./base.js";
import OperationLease from "../operation-lease.js";
import { coordinateSharedTransactionConnection } from "../../testing/shared-transaction-connection-coordinator.js";
/**
 * SinglePoolConnectionEntry type.
 * @typedef {object} SinglePoolConnectionEntry
 * @property {number} activeCheckoutCount - Active users of the connection.
 * @property {string[]} checkoutNames - Nested checkout names.
 * @property {import("../drivers/base.js").default} connection - Owned driver.
 * @property {boolean} lifecycleRetained - Whether frontend tenant lifecycle ownership retains this entry.
 * @property {boolean} retained - Whether normal ambient use retains this idle entry.
 * @property {string} reuseKey - Physical configuration reuse key.
 */
/**
 * SinglePoolPendingCheckout type.
 * @typedef {object} SinglePoolPendingCheckout
 * @property {string | undefined} checkoutName - Checkout name.
 * @property {Promise<void>} [closePromise] - Rejects if closeAll owns cancellation.
 * @property {number} enqueuedAt - Enqueue timestamp.
 * @property {(error: Error) => void} reject - Rejects a capacity waiter during closeAll.
 * @property {string} reuseKey - Physical configuration reuse key.
 * @property {number | null} timeoutAt - Timeout timestamp.
 * @property {number | null} timeoutMillis - Configured timeout.
 */
const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_CHECKOUT_TIMEOUT_MILLIS = 10000;
export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
    activeCheckoutCount = 0;
    suppressedConnectionContextCount = 0;
    operationLeaseQueue = Promise.resolve();
    connectionsBeingSpawned = 0;
    /** @type {Map<string, SinglePoolConnectionEntry>} */
    connectionEntries = new Map();
    /** @type {Map<string, Promise<SinglePoolConnectionEntry>>} */
    connectionEntrySpawnPromises = new Map();
    /** @type {Map<string, Promise<void>>} */
    capturedOperationQueues = new Map();
    /** @type {SinglePoolPendingCheckout[]} */
    pendingCheckouts = [];
    /** @type {Set<() => boolean>} */
    capacityWaiters = new Set();
    closeGeneration = 0;
    /** @type {Map<string, {connection: import("../drivers/base.js").default, registration: import("./base.js").TestSharedConnectionRegistration}>} */
    testSharedConnectionsByReuseKey = new Map();
    /**
     * Checks a connection back into its keyed physical entry.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {Promise<void>} - Resolves when cleanup completes.
     */
    async checkin(connection) {
        const entry = this.entryForConnection(connection);
        if (!entry || entry.activeCheckoutCount < 1)
            return;
        entry.activeCheckoutCount--;
        entry.checkoutNames.pop();
        this.activeCheckoutCount--;
        if (entry.activeCheckoutCount > 0) {
            await connection.setConnectionCheckoutName(entry.checkoutNames[entry.checkoutNames.length - 1]);
            return;
        }
        try {
            await connection.releaseHeldAdvisoryLocks();
            await connection.clearConnectionCheckoutName();
        }
        catch (error) {
            try {
                await this.removeAndCloseEntry(entry);
            }
            catch (closeError) {
                throw new AggregateError([error, closeError], "Database checkout cleanup and connection close both failed", { cause: closeError });
            }
            throw error;
        }
        if (!entry.lifecycleRetained && (!entry.retained || this.capacityWaiters.size > 0))
            await this.removeAndCloseEntry(entry);
    }
    /**
     * Permanently removes and closes a checked-out connection.
     * @param {import("../drivers/base.js").default} connection - Connection that must not return to the pool.
     */
    async discard(connection) {
        const entry = this.entryForConnection(connection);
        if (entry) {
            this.activeCheckoutCount -= entry.activeCheckoutCount;
            entry.activeCheckoutCount = 0;
            entry.checkoutNames = [];
            await this.removeAndCloseEntry(entry);
            return;
        }
        await connection.close();
    }
    /**
     * Checks out the ambient configuration and retains it as the single mutable
     * browser fallback connection.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
     */
    async checkout(options = {}) {
        return await this.checkoutForConfiguration(this.getConfiguration(), options, { retain: true });
    }
    /**
     * Checks out an explicitly captured physical configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured configuration.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @param {{retain: boolean}} [args] - Whether this becomes the ambient retained connection.
     * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
     */
    async checkoutForConfiguration(databaseConfiguration, options = {}, { retain } = { retain: false }) {
        this.assertDatabaseAccessAllowed();
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        let entry = this.connectionEntries.get(reuseKey);
        if (!entry) {
            let spawnPromise = this.connectionEntrySpawnPromises.get(reuseKey);
            let waitedForCapacityReservation = false;
            if (!spawnPromise) {
                if (this.capacityWaiters.size === 0 && this.tryReserveConnectionCapacity(databaseConfiguration)) {
                    spawnPromise = this.spawnConnectionEntry(databaseConfiguration, reuseKey, this.closeGeneration);
                    this.connectionEntrySpawnPromises.set(reuseKey, spawnPromise);
                }
                else {
                    await this.reserveConnectionCapacity(databaseConfiguration, { name: options.name, reuseKey });
                    waitedForCapacityReservation = true;
                }
                entry = this.connectionEntries.get(reuseKey);
                spawnPromise = this.connectionEntrySpawnPromises.get(reuseKey);
                if (!entry && !spawnPromise) {
                    spawnPromise = this.spawnConnectionEntry(databaseConfiguration, reuseKey, this.closeGeneration);
                    this.connectionEntrySpawnPromises.set(reuseKey, spawnPromise);
                }
                else if (waitedForCapacityReservation) {
                    this.releaseConnectionCapacityReservation();
                }
            }
            if (!entry && spawnPromise) {
                try {
                    entry = await spawnPromise;
                }
                finally {
                    if (this.connectionEntrySpawnPromises.get(reuseKey) === spawnPromise) {
                        this.connectionEntrySpawnPromises.delete(reuseKey);
                    }
                }
            }
        }
        if (!entry)
            throw new Error("Database connection entry was not created");
        if (this.connectionEntries.get(reuseKey) !== entry) {
            return await this.checkoutForConfiguration(databaseConfiguration, options, { retain });
        }
        try {
            this.assertDatabaseAccessAllowed();
        }
        catch (error) {
            if (entry.activeCheckoutCount === 0 && this.capacityWaiters.size > 0) {
                try {
                    await this.removeAndCloseEntry(entry);
                }
                catch (closeError) {
                    throw new AggregateError([error, closeError], "Database access revocation and connection close both failed", { cause: closeError });
                }
            }
            throw error;
        }
        if (retain) {
            const previousConnection = this.connection;
            entry.retained = true;
            this.connection = entry.connection;
            if (previousConnection && previousConnection !== entry.connection) {
                const previousEntry = this.entryForConnection(previousConnection);
                if (previousEntry) {
                    previousEntry.retained = false;
                    if (previousEntry.activeCheckoutCount === 0 && !previousEntry.lifecycleRetained)
                        await this.removeAndCloseEntry(previousEntry);
                }
            }
        }
        entry.checkoutNames.push(options.name || "");
        await entry.connection.setConnectionCheckoutName(options.name);
        entry.activeCheckoutCount++;
        this.activeCheckoutCount++;
        try {
            this.assertDatabaseAccessAllowed();
        }
        catch (error) {
            try {
                await this.checkin(entry.connection);
            }
            catch (checkinError) {
                throw new AggregateError([error, checkinError], "Database access revocation and connection check-in both failed", { cause: checkinError });
            }
            throw error;
        }
        return entry.connection;
    }
    /**
     * Ensures capacity exists for another physical connection.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Requested configuration.
     * @param {{name?: string, reuseKey: string}} options - Pending checkout identity.
     * @returns {Promise<void>} - Resolves when capacity is available.
     */
    async reserveConnectionCapacity(databaseConfiguration, options) {
        while (true) {
            const idleEntry = [...this.connectionEntries.values()].find((entry) => entry.activeCheckoutCount === 0 && !entry.lifecycleRetained);
            if (idleEntry) {
                await this.removeAndCloseEntry(idleEntry);
                continue;
            }
            await this.waitForCapacity(databaseConfiguration, options);
            return;
        }
    }
    /**
     * Waits for pool capacity with normal timeout and closeAll ownership.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Requested configuration.
     * @param {{name?: string, reuseKey: string}} options - Pending checkout identity.
     * @returns {Promise<void>} - Resolves on a capacity change.
     */
    async waitForCapacity(databaseConfiguration, options) {
        const timeoutMillis = this.checkoutTimeoutMillis(databaseConfiguration);
        const enqueuedAt = Date.now();
        await new Promise((resolve, reject) => {
            /** @type {ReturnType<typeof setTimeout> | undefined} */
            let timer;
            const finish = () => {
                if (timer)
                    clearTimeout(timer);
                this.capacityWaiters.delete(capacityAvailable);
                this.removePendingCheckout(pending);
            };
            const capacityAvailable = () => {
                if (!this.tryReserveConnectionCapacity(databaseConfiguration))
                    return false;
                finish();
                resolve(undefined);
                return true;
            };
            /** @type {SinglePoolPendingCheckout} */
            const pending = {
                checkoutName: options.name,
                enqueuedAt,
                reject: (error) => {
                    finish();
                    reject(error);
                },
                reuseKey: options.reuseKey,
                timeoutAt: timeoutMillis === null ? null : enqueuedAt + timeoutMillis,
                timeoutMillis
            };
            this.pendingCheckouts.push(pending);
            this.capacityWaiters.add(capacityAvailable);
            if (timeoutMillis !== null) {
                timer = setTimeout(() => {
                    pending.reject(new Error(`Timed out waiting for database connection checkout after ${timeoutMillis}ms.`));
                }, timeoutMillis);
            }
        });
    }
    /**
     * Runs with connection.
     * @template T
     * @param {import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} optionsOrCallback - Options or callback.
     * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [callback] - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    async withConnection(optionsOrCallback, callback) {
        const options = typeof optionsOrCallback == "function" ? {} : optionsOrCallback;
        const actualCallback = typeof optionsOrCallback == "function" ? optionsOrCallback : callback;
        if (!actualCallback)
            throw new Error("withConnection requires a callback");
        const connection = await this.checkout(options);
        try {
            return await actualCallback(connection);
        }
        finally {
            await this.checkin(connection);
        }
    }
    async openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const connection = await this.checkoutForConfiguration(databaseConfiguration, { name: "Frontend tenant SQLite open" }, { retain: false });
        const entry = this.entryForConnection(connection);
        if (!entry)
            throw new Error("Frontend tenant SQLite connection entry disappeared during open");
        entry.lifecycleRetained = true;
        await this.checkin(connection);
    }
    async flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration));
        if (entry)
            await entry.connection.flushPendingWrites();
    }
    async closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration));
        if (!entry)
            return;
        if (entry.activeCheckoutCount > 0)
            throw new Error("Cannot close an in-use frontend tenant SQLite handle");
        await this.removeAndCloseEntry(entry);
    }
    async deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        await this.closeCapturedConnection(databaseConfiguration);
        const DriverClass = databaseConfiguration.driver || this.driverClass;
        if (!DriverClass)
            throw new Error("No driver class configured for frontend tenant SQLite deletion");
        const driver = new DriverClass(databaseConfiguration, this.configuration);
        await driver.deleteDatabaseStorage();
    }
    capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration));
        return Boolean(entry && entry.activeCheckoutCount > 0);
    }
    capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration));
        return Boolean(entry?.connection.hasPendingWrites());
    }
    /**
     * Runs a legacy ambient operation under one pool-wide FIFO lease.
     * @template T
     * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    async withOperationConnection(options, callback) {
        const previousLease = this.operationLeaseQueue;
        let releaseQueue = () => { };
        const queueTurn = new Promise((resolve) => { releaseQueue = () => resolve(undefined); });
        this.operationLeaseQueue = previousLease.then(async () => await queueTurn);
        await previousLease;
        try {
            const databaseConfiguration = this.getConfiguration();
            return await this.runOwnedOperation(databaseConfiguration, options, { retain: true }, callback);
        }
        finally {
            releaseQueue();
        }
    }
    /**
     * Runs a captured operation under a FIFO lease scoped only to its physical
     * database identity, so unrelated tenant databases remain concurrent.
     * @template T
     * @param {import("./base.js").CapturedConnectionOptions} options - Captured options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    async withCapturedOperationConnection({ databaseConfiguration, name }, callback) {
        const reuseKey = this.getConfigurationReuseKey(databaseConfiguration);
        const previousTurn = this.capturedOperationQueues.get(reuseKey) || Promise.resolve();
        let releaseTurn = () => { };
        const turn = new Promise((resolve) => { releaseTurn = () => resolve(undefined); });
        const queueTail = previousTurn.then(async () => await turn);
        const wasQueued = this.capturedOperationQueues.has(reuseKey);
        const pending = wasQueued ? this.addOperationPendingCheckout(databaseConfiguration, { name, reuseKey }) : undefined;
        this.capturedOperationQueues.set(reuseKey, queueTail);
        try {
            await this.waitForOperationTurn(previousTurn, pending);
            return await this.runOwnedOperation(databaseConfiguration, { name }, { retain: false }, callback);
        }
        finally {
            if (pending)
                this.removePendingCheckout(pending);
            releaseTurn();
            void queueTail.finally(() => {
                if (this.capturedOperationQueues.get(reuseKey) === queueTail)
                    this.capturedOperationQueues.delete(reuseKey);
            });
        }
    }
    /**
     * Runs one callback with an installed driver operation lease.
     * @template T
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
     * @param {{retain: boolean}} checkoutArgs - Checkout retention.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    async runOwnedOperation(databaseConfiguration, options, checkoutArgs, callback) {
        const owner = Symbol("single-pool-operation-owner");
        const operationLease = new OperationLease(owner);
        const connection = await this.checkoutForConfiguration(databaseConfiguration, options, checkoutArgs);
        try {
            return await coordinateSharedTransactionConnection(connection, async () => {
                let operationLeaseInstalled = false;
                try {
                    await connection.setOperationLease(operationLease);
                    operationLeaseInstalled = true;
                    return await callback(connection, owner);
                }
                finally {
                    operationLease.release();
                    if (operationLeaseInstalled)
                        connection.clearOperationLease(operationLease);
                }
            });
        }
        finally {
            await this.checkin(connection);
        }
    }
    /**
     * Waits for a same-physical-database operation queue turn.
     * @param {Promise<void>} previousTurn - Previous queue tail.
     * @param {SinglePoolPendingCheckout | undefined} pending - Pending debug entry.
     * @returns {Promise<void>} - Resolves when the previous turn releases.
     */
    async waitForOperationTurn(previousTurn, pending) {
        if (!pending) {
            await previousTurn;
            return;
        }
        if (pending.timeoutMillis === null) {
            await new Promise((resolve, reject) => {
                previousTurn.then(resolve, reject);
                pending.closePromise?.catch(reject);
            });
            return;
        }
        const timeoutMillis = pending.timeoutMillis;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out waiting for database connection checkout after ${timeoutMillis}ms.`)), timeoutMillis);
            previousTurn.then(() => {
                clearTimeout(timer);
                resolve(undefined);
            }, (error) => {
                clearTimeout(timer);
                reject(error);
            });
            pending.closePromise?.catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    /**
     * Runs without current connection context.
     * @template T
     * @param {() => T} callback - Callback.
     * @returns {T} - Callback result.
     */
    withoutCurrentConnectionContext(callback) {
        this.suppressedConnectionContextCount += 1;
        try {
            const result = callback();
            if (result instanceof Promise) {
                return /** @type {T} */ (result.finally(() => { this.suppressedConnectionContextCount -= 1; }));
            }
            this.suppressedConnectionContextCount -= 1;
            return result;
        }
        catch (error) {
            this.suppressedConnectionContextCount -= 1;
            throw error;
        }
    }
    /** Clears schema metadata on every live physical connection. */
    clearSchemaCache() {
        for (const entry of this.connectionEntries.values())
            this._clearConnectionSchemaCache(entry.connection);
    }
    /** Closes every pool-owned connection and rejects queued capacity requests. */
    async closeAll() {
        const closeError = new Error("Database pool was closed before checkout completed.");
        this.closeGeneration++;
        for (const pending of [...this.pendingCheckouts])
            pending.reject(closeError);
        this.notifyCapacityWaiters();
        await Promise.allSettled([...this.connectionEntrySpawnPromises.values()]);
        const entries = [...this.connectionEntries.values()];
        this.connectionEntries.clear();
        this.connectionEntrySpawnPromises.clear();
        this.testSharedConnectionsByReuseKey.clear();
        this.connection = undefined;
        this.activeCheckoutCount = 0;
        for (const entry of entries)
            await entry.connection.close();
    }
    /**
     * Returns the mutable ambient fallback connection.
     * @returns {import("../drivers/base.js").default} - Mutable ambient fallback connection.
     */
    getCurrentConnection() {
        this.assertDatabaseAccessAllowed();
        if (!this.connection)
            throw new Error("A connection hasn't been made yet");
        return this.connection;
    }
    /**
     * Registers an attempt-owned connection for exactly one physical configuration.
     * @param {import("../drivers/base.js").default} connection - Attempt-owned connection.
     * @param {string} reuseKey - Resolved physical configuration identity.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnectionForConfiguration(connection, reuseKey) {
        const registration = { owner: Symbol("test-shared-physical-connection") };
        this.testSharedConnectionsByReuseKey.set(reuseKey, { connection, registration });
        return registration;
    }
    /**
     * Clears an attempt-owned shared physical connection without revoking a newer owner.
     * @param {import("./base.js").TestSharedConnectionRegistration} [registration] - Registration to clear conditionally.
     */
    clearTestSharedConnection(registration) {
        if (!registration) {
            this.testSharedConnectionsByReuseKey.clear();
            return;
        }
        for (const [reuseKey, entry] of this.testSharedConnectionsByReuseKey) {
            if (entry.registration !== registration)
                continue;
            this.testSharedConnectionsByReuseKey.delete(reuseKey);
            return;
        }
    }
    /**
     * Resolves the attempt-owned connection for the current physical configuration.
     * @returns {import("../drivers/base.js").default | undefined} - Shared connection.
     */
    testSharedConnection() {
        const reuseKey = this.getConfigurationReuseKey();
        return this.testSharedConnectionsByReuseKey.get(reuseKey)?.connection;
    }
    /**
     * Returns the current context fallback connection when it is not suppressed.
     * @returns {import("../drivers/base.js").default | undefined} - Current fallback connection.
     */
    getCurrentContextConnection() {
        if (this.suppressedConnectionContextCount > 0)
            return undefined;
        return this.testSharedConnection() || this.connection;
    }
    /**
     * Returns whether fallback context is available.
     * @returns {boolean} - Whether fallback context is available.
     */
    hasCurrentConnectionContext() {
        return this.suppressedConnectionContextCount === 0;
    }
    /**
     * Returns pool diagnostics for retained and temporary keyed connections.
     * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Pool diagnostics.
     */
    getDebugSnapshot() {
        const connections = [...this.connectionEntries.values()].map((entry) => this.debugConnectionSnapshot(entry.connection, {
            activeCheckoutCount: entry.activeCheckoutCount,
            state: entry.retained ? "shared" : entry.activeCheckoutCount > 0 ? "in-use" : entry.lifecycleRetained ? "lifecycle-retained" : "idle"
        }));
        const now = Date.now();
        return {
            ...super.getDebugSnapshot(),
            connections,
            connectionsBeingSpawned: this.connectionsBeingSpawned,
            idleCount: [...this.connectionEntries.values()].filter((entry) => entry.activeCheckoutCount === 0).length,
            inUseCount: [...this.connectionEntries.values()].filter((entry) => entry.activeCheckoutCount > 0).length,
            pendingCheckouts: this.pendingCheckouts.map((pending, index) => ({
                checkoutName: pending.checkoutName,
                enqueuedAt: pending.enqueuedAt,
                index,
                remainingTimeoutMs: pending.timeoutAt === null ? null : Math.max(0, pending.timeoutAt - now),
                reuseKey: pending.reuseKey,
                timeoutAt: pending.timeoutAt,
                timeoutMillis: pending.timeoutMillis,
                waitingForMs: Math.max(0, now - pending.enqueuedAt)
            })),
            pendingCheckoutCount: this.pendingCheckouts.length
        };
    }
    /**
     * Returns the configured connection maximum.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @returns {number | null} - Configured connection maximum.
     */
    maxConnections(databaseConfiguration) {
        const value = databaseConfiguration.pool?.max;
        if (value === null)
            return null;
        if (typeof value === "number" && Number.isFinite(value) && value >= 1)
            return value;
        return DEFAULT_MAX_CONNECTIONS;
    }
    /**
     * Returns the configured checkout timeout.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @returns {number | null} - Configured checkout timeout.
     */
    checkoutTimeoutMillis(databaseConfiguration) {
        const value = databaseConfiguration.pool?.checkoutTimeoutMillis;
        if (value === null)
            return null;
        if (typeof value === "number" && Number.isFinite(value) && value >= 0)
            return value;
        return DEFAULT_CHECKOUT_TIMEOUT_MILLIS;
    }
    /**
     * Returns whether another physical connection may be spawned.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @returns {boolean} - Whether another physical connection may be spawned.
     */
    canSpawnConnection(databaseConfiguration) {
        const max = this.maxConnections(databaseConfiguration);
        return max === null || this.connectionEntries.size + this.connectionsBeingSpawned < max;
    }
    /**
     * Atomically claims one connection slot without yielding.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration whose maximum applies.
     * @returns {boolean} - Whether a slot was reserved.
     */
    tryReserveConnectionCapacity(databaseConfiguration) {
        if (!this.canSpawnConnection(databaseConfiguration))
            return false;
        this.connectionsBeingSpawned++;
        return true;
    }
    /** Releases one previously claimed connection slot. */
    releaseConnectionCapacityReservation() {
        if (this.connectionsBeingSpawned < 1) {
            throw new Error("Cannot release an unreserved database connection slot");
        }
        this.connectionsBeingSpawned--;
        this.notifyCapacityWaiters();
    }
    /**
     * Spawns and tracks a physical connection entry.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @param {string} reuseKey - Physical reuse key.
     * @param {number} closeGeneration - Pool lifecycle generation at spawn start.
     * @returns {Promise<SinglePoolConnectionEntry>} - New entry.
     */
    async spawnConnectionEntry(databaseConfiguration, reuseKey, closeGeneration) {
        try {
            const connection = await this.spawnConnectionForConfiguration(databaseConfiguration);
            if (this.closeGeneration !== closeGeneration) {
                await connection.close();
                throw new Error("Database pool was closed before checkout completed.");
            }
            /** @type {SinglePoolConnectionEntry} */
            const entry = { activeCheckoutCount: 0, checkoutNames: [], connection, lifecycleRetained: false, retained: false, reuseKey };
            this.connectionEntries.set(reuseKey, entry);
            return entry;
        }
        finally {
            this.releaseConnectionCapacityReservation();
        }
    }
    /**
     * Removes and closes an entry.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {SinglePoolConnectionEntry | undefined} - Entry owning a connection.
     */
    entryForConnection(connection) {
        return [...this.connectionEntries.values()].find((entry) => entry.connection === connection);
    }
    /**
     * Adds a same-key operation pending entry.
     * @param {SinglePoolConnectionEntry} entry - Entry to close.
     * @returns {Promise<void>} - Resolves after close.
     */
    async removeAndCloseEntry(entry) {
        if (this.connectionEntries.get(entry.reuseKey) !== entry)
            return;
        this.connectionEntries.delete(entry.reuseKey);
        if (this.connection === entry.connection)
            this.connection = undefined;
        await entry.connection.close();
        this.notifyCapacityWaiters();
    }
    /** Wakes all capacity waiters to re-check the bounded pool. */
    notifyCapacityWaiters() {
        for (const reserveAndResolve of this.capacityWaiters) {
            if (reserveAndResolve())
                return;
        }
    }
    /**
     * Adds a same-key operation pending entry.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @param {{name?: string, reuseKey: string}} options - Pending identity.
     * @returns {SinglePoolPendingCheckout} - Added same-key operation pending entry.
     */
    addOperationPendingCheckout(databaseConfiguration, { name, reuseKey }) {
        const timeoutMillis = this.checkoutTimeoutMillis(databaseConfiguration);
        const enqueuedAt = Date.now();
        /**
         * Rejects the close-owned promise.
         * @type {(error: Error) => void}
         */
        let rejectClose = () => { };
        const closePromise = new Promise((resolve, reject) => {
            void resolve;
            rejectClose = reject;
        });
        const pending = {
            checkoutName: name,
            closePromise,
            enqueuedAt,
            reject: rejectClose,
            reuseKey,
            timeoutAt: timeoutMillis === null ? null : enqueuedAt + timeoutMillis,
            timeoutMillis
        };
        this.pendingCheckouts.push(pending);
        return pending;
    }
    /**
     * Removes a pending checkout debug entry.
     * @param {SinglePoolPendingCheckout} pending - Pending entry.
     * @returns {void}
     */
    removePendingCheckout(pending) {
        const index = this.pendingCheckouts.indexOf(pending);
        if (index !== -1)
            this.pendingCheckouts.splice(index, 1);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2luZ2xlLW11bHRpLXVzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9wb29sL3NpbmdsZS1tdWx0aS11c2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sUUFBUSxNQUFNLFdBQVcsQ0FBQTtBQUNoQyxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMscUNBQXFDLEVBQUMsTUFBTSw0REFBNEQsQ0FBQTtBQUVoSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7Ozs7OztHQVVHO0FBRUgsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUE7QUFDbEMsTUFBTSwrQkFBK0IsR0FBRyxLQUFLLENBQUE7QUFFN0MsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQ0FBcUMsU0FBUSxRQUFRO0lBQ3hFLG1CQUFtQixHQUFHLENBQUMsQ0FBQTtJQUN2QixnQ0FBZ0MsR0FBRyxDQUFDLENBQUE7SUFDcEMsbUJBQW1CLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3ZDLHVCQUF1QixHQUFHLENBQUMsQ0FBQTtJQUUzQixxREFBcUQ7SUFDckQsaUJBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUM3Qiw4REFBOEQ7SUFDOUQsNEJBQTRCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUN4Qyx5Q0FBeUM7SUFDekMsdUJBQXVCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUNuQywwQ0FBMEM7SUFDMUMsZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO0lBQ3JCLGlDQUFpQztJQUNqQyxlQUFlLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUMzQixlQUFlLEdBQUcsQ0FBQyxDQUFBO0lBQ25CLGtKQUFrSjtJQUNsSiwrQkFBK0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBRTNDOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVU7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UixTQUFTLEVBQUUsYUFBYSxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxVQUFVLEdBQUcsYUFBYTtZQUNyRSxhQUFhO1NBQ2QsQ0FBQTtRQUVELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFbkMsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxPQUFPO1FBQzNCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFcEQsSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO1lBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUE7SUFDMUQsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlUG9vbCBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCBPcGVyYXRpb25MZWFzZSBmcm9tIFwiLi4vb3BlcmF0aW9uLWxlYXNlLmpzXCJcbmltcG9ydCB7Y29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbn0gZnJvbSBcIi4uLy4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuXG4vKipcbiAqIFNpbmdsZVBvb2xDb25uZWN0aW9uRW50cnkgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNpbmdsZVBvb2xDb25uZWN0aW9uRW50cnlcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhY3RpdmVDaGVja291dENvdW50IC0gQWN0aXZlIHVzZXJzIG9mIHRoZSBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gY2hlY2tvdXROYW1lcyAtIE5lc3RlZCBjaGVja291dCBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBPd25lZCBkcml2ZXIuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGxpZmVjeWNsZVJldGFpbmVkIC0gV2hldGhlciBmcm9udGVuZCB0ZW5hbnQgbGlmZWN5Y2xlIG93bmVyc2hpcCByZXRhaW5zIHRoaXMgZW50cnkuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldGFpbmVkIC0gV2hldGhlciBub3JtYWwgYW1iaWVudCB1c2UgcmV0YWlucyB0aGlzIGlkbGUgZW50cnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmV1c2VLZXkgLSBQaHlzaWNhbCBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAqL1xuLyoqXG4gKiBTaW5nbGVQb29sUGVuZGluZ0NoZWNrb3V0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTaW5nbGVQb29sUGVuZGluZ0NoZWNrb3V0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gY2hlY2tvdXROYW1lIC0gQ2hlY2tvdXQgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW2Nsb3NlUHJvbWlzZV0gLSBSZWplY3RzIGlmIGNsb3NlQWxsIG93bnMgY2FuY2VsbGF0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGVucXVldWVkQXQgLSBFbnF1ZXVlIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH0gcmVqZWN0IC0gUmVqZWN0cyBhIGNhcGFjaXR5IHdhaXRlciBkdXJpbmcgY2xvc2VBbGwuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmV1c2VLZXkgLSBQaHlzaWNhbCBjb25maWd1cmF0aW9uIHJldXNlIGtleS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dEF0IC0gVGltZW91dCB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNaWxsaXMgLSBDb25maWd1cmVkIHRpbWVvdXQuXG4gKi9cblxuY29uc3QgREVGQVVMVF9NQVhfQ09OTkVDVElPTlMgPSAxMFxuY29uc3QgREVGQVVMVF9DSEVDS09VVF9USU1FT1VUX01JTExJUyA9IDEwMDAwXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUG9vbFNpbmdsZU11bHRpVXNlciBleHRlbmRzIEJhc2VQb29sIHtcbiAgYWN0aXZlQ2hlY2tvdXRDb3VudCA9IDBcbiAgc3VwcHJlc3NlZENvbm5lY3Rpb25Db250ZXh0Q291bnQgPSAwXG4gIG9wZXJhdGlvbkxlYXNlUXVldWUgPSBQcm9taXNlLnJlc29sdmUoKVxuICBjb25uZWN0aW9uc0JlaW5nU3Bhd25lZCA9IDBcblxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFNpbmdsZVBvb2xDb25uZWN0aW9uRW50cnk+fSAqL1xuICBjb25uZWN0aW9uRW50cmllcyA9IG5ldyBNYXAoKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8U2luZ2xlUG9vbENvbm5lY3Rpb25FbnRyeT4+fSAqL1xuICBjb25uZWN0aW9uRW50cnlTcGF3blByb21pc2VzID0gbmV3IE1hcCgpXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG4gIGNhcHR1cmVkT3BlcmF0aW9uUXVldWVzID0gbmV3IE1hcCgpXG4gIC8qKiBAdHlwZSB7U2luZ2xlUG9vbFBlbmRpbmdDaGVja291dFtdfSAqL1xuICBwZW5kaW5nQ2hlY2tvdXRzID0gW11cbiAgLyoqIEB0eXBlIHtTZXQ8KCkgPT4gYm9vbGVhbj59ICovXG4gIGNhcGFjaXR5V2FpdGVycyA9IG5ldyBTZXQoKVxuICBjbG9zZUdlbmVyYXRpb24gPSAwXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywge2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4vYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn0+fSAqL1xuICB0ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5ID0gbmV3IE1hcCgpXG5cbiAgLyoqXG4gICAqIENoZWNrcyBhIGNvbm5lY3Rpb24gYmFjayBpbnRvIGl0cyBrZXllZCBwaHlzaWNhbCBlbnRyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBjaGVja2luKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cnlGb3JDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG5cbiAgICBpZiAoIWVudHJ5IHx8IGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQgPCAxKSByZXR1cm5cblxuICAgIGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQtLVxuICAgIGVudHJ5LmNoZWNrb3V0TmFtZXMucG9wKClcbiAgICB0aGlzLmFjdGl2ZUNoZWNrb3V0Q291bnQtLVxuXG4gICAgaWYgKGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQgPiAwKSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnNldENvbm5lY3Rpb25DaGVja291dE5hbWUoZW50cnkuY2hlY2tvdXROYW1lc1tlbnRyeS5jaGVja291dE5hbWVzLmxlbmd0aCAtIDFdKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKClcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZW1vdmVBbmRDbG9zZUVudHJ5KGVudHJ5KVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBjbG9zZUVycm9yXSwgXCJEYXRhYmFzZSBjaGVja291dCBjbGVhbnVwIGFuZCBjb25uZWN0aW9uIGNsb3NlIGJvdGggZmFpbGVkXCIsIHtjYXVzZTogY2xvc2VFcnJvcn0pXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGlmICghZW50cnkubGlmZWN5Y2xlUmV0YWluZWQgJiYgKCFlbnRyeS5yZXRhaW5lZCB8fCB0aGlzLmNhcGFjaXR5V2FpdGVycy5zaXplID4gMCkpIGF3YWl0IHRoaXMucmVtb3ZlQW5kQ2xvc2VFbnRyeShlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSByZW1vdmVzIGFuZCBjbG9zZXMgYSBjaGVja2VkLW91dCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29ubmVjdGlvbiB0aGF0IG11c3Qgbm90IHJldHVybiB0byB0aGUgcG9vbC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmQoY29ubmVjdGlvbikge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyeUZvckNvbm5lY3Rpb24oY29ubmVjdGlvbilcblxuICAgIGlmIChlbnRyeSkge1xuICAgICAgdGhpcy5hY3RpdmVDaGVja291dENvdW50IC09IGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnRcbiAgICAgIGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQgPSAwXG4gICAgICBlbnRyeS5jaGVja291dE5hbWVzID0gW11cbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlQW5kQ2xvc2VFbnRyeShlbnRyeSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBvdXQgdGhlIGFtYmllbnQgY29uZmlndXJhdGlvbiBhbmQgcmV0YWlucyBpdCBhcyB0aGUgc2luZ2xlIG11dGFibGVcbiAgICogYnJvd3NlciBmYWxsYmFjayBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbb3B0aW9uc10gLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gQ2hlY2tlZC1vdXQgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIGNoZWNrb3V0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbih0aGlzLmdldENvbmZpZ3VyYXRpb24oKSwgb3B0aW9ucywge3JldGFpbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIG91dCBhbiBleHBsaWNpdGx5IGNhcHR1cmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBDYXB0dXJlZCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Db25uZWN0aW9uQ2hlY2tvdXRPcHRpb25zfSBbb3B0aW9uc10gLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3tyZXRhaW46IGJvb2xlYW59fSBbYXJnc10gLSBXaGV0aGVyIHRoaXMgYmVjb21lcyB0aGUgYW1iaWVudCByZXRhaW5lZCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gQ2hlY2tlZC1vdXQgY29ubmVjdGlvbi5cbiAgICovXG4gIGFzeW5jIGNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG9wdGlvbnMgPSB7fSwge3JldGFpbn0gPSB7cmV0YWluOiBmYWxzZX0pIHtcbiAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgbGV0IGVudHJ5ID0gdGhpcy5jb25uZWN0aW9uRW50cmllcy5nZXQocmV1c2VLZXkpXG5cbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICBsZXQgc3Bhd25Qcm9taXNlID0gdGhpcy5jb25uZWN0aW9uRW50cnlTcGF3blByb21pc2VzLmdldChyZXVzZUtleSlcbiAgICAgIGxldCB3YWl0ZWRGb3JDYXBhY2l0eVJlc2VydmF0aW9uID0gZmFsc2VcblxuICAgICAgaWYgKCFzcGF3blByb21pc2UpIHtcbiAgICAgICAgaWYgKHRoaXMuY2FwYWNpdHlXYWl0ZXJzLnNpemUgPT09IDAgJiYgdGhpcy50cnlSZXNlcnZlQ29ubmVjdGlvbkNhcGFjaXR5KGRhdGFiYXNlQ29uZmlndXJhdGlvbikpIHtcbiAgICAgICAgICBzcGF3blByb21pc2UgPSB0aGlzLnNwYXduQ29ubmVjdGlvbkVudHJ5KGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgcmV1c2VLZXksIHRoaXMuY2xvc2VHZW5lcmF0aW9uKVxuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbkVudHJ5U3Bhd25Qcm9taXNlcy5zZXQocmV1c2VLZXksIHNwYXduUHJvbWlzZSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlc2VydmVDb25uZWN0aW9uQ2FwYWNpdHkoZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZTogb3B0aW9ucy5uYW1lLCByZXVzZUtleX0pXG4gICAgICAgICAgd2FpdGVkRm9yQ2FwYWNpdHlSZXNlcnZhdGlvbiA9IHRydWVcbiAgICAgICAgfVxuXG4gICAgICAgIGVudHJ5ID0gdGhpcy5jb25uZWN0aW9uRW50cmllcy5nZXQocmV1c2VLZXkpXG4gICAgICAgIHNwYXduUHJvbWlzZSA9IHRoaXMuY29ubmVjdGlvbkVudHJ5U3Bhd25Qcm9taXNlcy5nZXQocmV1c2VLZXkpXG5cbiAgICAgICAgaWYgKCFlbnRyeSAmJiAhc3Bhd25Qcm9taXNlKSB7XG4gICAgICAgICAgc3Bhd25Qcm9taXNlID0gdGhpcy5zcGF3bkNvbm5lY3Rpb25FbnRyeShkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHJldXNlS2V5LCB0aGlzLmNsb3NlR2VuZXJhdGlvbilcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25FbnRyeVNwYXduUHJvbWlzZXMuc2V0KHJldXNlS2V5LCBzcGF3blByb21pc2UpXG4gICAgICAgIH0gZWxzZSBpZiAod2FpdGVkRm9yQ2FwYWNpdHlSZXNlcnZhdGlvbikge1xuICAgICAgICAgIHRoaXMucmVsZWFzZUNvbm5lY3Rpb25DYXBhY2l0eVJlc2VydmF0aW9uKClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIWVudHJ5ICYmIHNwYXduUHJvbWlzZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGVudHJ5ID0gYXdhaXQgc3Bhd25Qcm9taXNlXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbkVudHJ5U3Bhd25Qcm9taXNlcy5nZXQocmV1c2VLZXkpID09PSBzcGF3blByb21pc2UpIHtcbiAgICAgICAgICAgIHRoaXMuY29ubmVjdGlvbkVudHJ5U3Bhd25Qcm9taXNlcy5kZWxldGUocmV1c2VLZXkpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghZW50cnkpIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGNvbm5lY3Rpb24gZW50cnkgd2FzIG5vdCBjcmVhdGVkXCIpXG4gICAgaWYgKHRoaXMuY29ubmVjdGlvbkVudHJpZXMuZ2V0KHJldXNlS2V5KSAhPT0gZW50cnkpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG9wdGlvbnMsIHtyZXRhaW59KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlbnRyeS5hY3RpdmVDaGVja291dENvdW50ID09PSAwICYmIHRoaXMuY2FwYWNpdHlXYWl0ZXJzLnNpemUgPiAwKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yZW1vdmVBbmRDbG9zZUVudHJ5KGVudHJ5KVxuICAgICAgICB9IGNhdGNoIChjbG9zZUVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgY2xvc2VFcnJvcl0sIFwiRGF0YWJhc2UgYWNjZXNzIHJldm9jYXRpb24gYW5kIGNvbm5lY3Rpb24gY2xvc2UgYm90aCBmYWlsZWRcIiwge2NhdXNlOiBjbG9zZUVycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBpZiAocmV0YWluKSB7XG4gICAgICBjb25zdCBwcmV2aW91c0Nvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25cblxuICAgICAgZW50cnkucmV0YWluZWQgPSB0cnVlXG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSBlbnRyeS5jb25uZWN0aW9uXG5cbiAgICAgIGlmIChwcmV2aW91c0Nvbm5lY3Rpb24gJiYgcHJldmlvdXNDb25uZWN0aW9uICE9PSBlbnRyeS5jb25uZWN0aW9uKSB7XG4gICAgICAgIGNvbnN0IHByZXZpb3VzRW50cnkgPSB0aGlzLmVudHJ5Rm9yQ29ubmVjdGlvbihwcmV2aW91c0Nvbm5lY3Rpb24pXG5cbiAgICAgICAgaWYgKHByZXZpb3VzRW50cnkpIHtcbiAgICAgICAgICBwcmV2aW91c0VudHJ5LnJldGFpbmVkID0gZmFsc2VcbiAgICAgICAgICBpZiAocHJldmlvdXNFbnRyeS5hY3RpdmVDaGVja291dENvdW50ID09PSAwICYmICFwcmV2aW91c0VudHJ5LmxpZmVjeWNsZVJldGFpbmVkKSBhd2FpdCB0aGlzLnJlbW92ZUFuZENsb3NlRW50cnkocHJldmlvdXNFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGVudHJ5LmNoZWNrb3V0TmFtZXMucHVzaChvcHRpb25zLm5hbWUgfHwgXCJcIilcbiAgICBhd2FpdCBlbnRyeS5jb25uZWN0aW9uLnNldENvbm5lY3Rpb25DaGVja291dE5hbWUob3B0aW9ucy5uYW1lKVxuICAgIGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQrK1xuICAgIHRoaXMuYWN0aXZlQ2hlY2tvdXRDb3VudCsrXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNoZWNraW4oZW50cnkuY29ubmVjdGlvbilcbiAgICAgIH0gY2F0Y2ggKGNoZWNraW5FcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBjaGVja2luRXJyb3JdLCBcIkRhdGFiYXNlIGFjY2VzcyByZXZvY2F0aW9uIGFuZCBjb25uZWN0aW9uIGNoZWNrLWluIGJvdGggZmFpbGVkXCIsIHtjYXVzZTogY2hlY2tpbkVycm9yfSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJ5LmNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGNhcGFjaXR5IGV4aXN0cyBmb3IgYW5vdGhlciBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gUmVxdWVzdGVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7e25hbWU/OiBzdHJpbmcsIHJldXNlS2V5OiBzdHJpbmd9fSBvcHRpb25zIC0gUGVuZGluZyBjaGVja291dCBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjYXBhY2l0eSBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBhc3luYyByZXNlcnZlQ29ubmVjdGlvbkNhcGFjaXR5KGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3B0aW9ucykge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBpZGxlRW50cnkgPSBbLi4udGhpcy5jb25uZWN0aW9uRW50cmllcy52YWx1ZXMoKV0uZmluZCgoZW50cnkpID0+IGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQgPT09IDAgJiYgIWVudHJ5LmxpZmVjeWNsZVJldGFpbmVkKVxuXG4gICAgICBpZiAoaWRsZUVudHJ5KSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVtb3ZlQW5kQ2xvc2VFbnRyeShpZGxlRW50cnkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvckNhcGFjaXR5KGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3B0aW9ucylcbiAgICAgIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgcG9vbCBjYXBhY2l0eSB3aXRoIG5vcm1hbCB0aW1lb3V0IGFuZCBjbG9zZUFsbCBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBSZXF1ZXN0ZWQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHt7bmFtZT86IHN0cmluZywgcmV1c2VLZXk6IHN0cmluZ319IG9wdGlvbnMgLSBQZW5kaW5nIGNoZWNrb3V0IGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbiBhIGNhcGFjaXR5IGNoYW5nZS5cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JDYXBhY2l0eShkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG9wdGlvbnMpIHtcbiAgICBjb25zdCB0aW1lb3V0TWlsbGlzID0gdGhpcy5jaGVja291dFRpbWVvdXRNaWxsaXMoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGVucXVldWVkQXQgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IHRpbWVyXG4gICAgICBjb25zdCBmaW5pc2ggPSAoKSA9PiB7XG4gICAgICAgIGlmICh0aW1lcikgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgICAgICB0aGlzLmNhcGFjaXR5V2FpdGVycy5kZWxldGUoY2FwYWNpdHlBdmFpbGFibGUpXG4gICAgICAgIHRoaXMucmVtb3ZlUGVuZGluZ0NoZWNrb3V0KHBlbmRpbmcpXG4gICAgICB9XG4gICAgICBjb25zdCBjYXBhY2l0eUF2YWlsYWJsZSA9ICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnRyeVJlc2VydmVDb25uZWN0aW9uQ2FwYWNpdHkoZGF0YWJhc2VDb25maWd1cmF0aW9uKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgZmluaXNoKClcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG5cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICAgIC8qKiBAdHlwZSB7U2luZ2xlUG9vbFBlbmRpbmdDaGVja291dH0gKi9cbiAgICAgIGNvbnN0IHBlbmRpbmcgPSB7XG4gICAgICAgIGNoZWNrb3V0TmFtZTogb3B0aW9ucy5uYW1lLFxuICAgICAgICBlbnF1ZXVlZEF0LFxuICAgICAgICByZWplY3Q6IChlcnJvcikgPT4ge1xuICAgICAgICAgIGZpbmlzaCgpXG4gICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICB9LFxuICAgICAgICByZXVzZUtleTogb3B0aW9ucy5yZXVzZUtleSxcbiAgICAgICAgdGltZW91dEF0OiB0aW1lb3V0TWlsbGlzID09PSBudWxsID8gbnVsbCA6IGVucXVldWVkQXQgKyB0aW1lb3V0TWlsbGlzLFxuICAgICAgICB0aW1lb3V0TWlsbGlzXG4gICAgICB9XG5cbiAgICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0cy5wdXNoKHBlbmRpbmcpXG4gICAgICB0aGlzLmNhcGFjaXR5V2FpdGVycy5hZGQoY2FwYWNpdHlBdmFpbGFibGUpXG5cbiAgICAgIGlmICh0aW1lb3V0TWlsbGlzICE9PSBudWxsKSB7XG4gICAgICAgIHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgcGVuZGluZy5yZWplY3QobmV3IEVycm9yKGBUaW1lZCBvdXQgd2FpdGluZyBmb3IgZGF0YWJhc2UgY29ubmVjdGlvbiBjaGVja291dCBhZnRlciAke3RpbWVvdXRNaWxsaXN9bXMuYCkpXG4gICAgICAgIH0sIHRpbWVvdXRNaWxsaXMpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9ucyB8ICgoYXJnOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPil9IG9wdGlvbnNPckNhbGxiYWNrIC0gT3B0aW9ucyBvciBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoYXJnOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gW2NhbGxiYWNrXSAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ29ubmVjdGlvbihvcHRpb25zT3JDYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgICBjb25zdCBvcHRpb25zID0gdHlwZW9mIG9wdGlvbnNPckNhbGxiYWNrID09IFwiZnVuY3Rpb25cIiA/IHt9IDogb3B0aW9uc09yQ2FsbGJhY2tcbiAgICBjb25zdCBhY3R1YWxDYWxsYmFjayA9IHR5cGVvZiBvcHRpb25zT3JDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIgPyBvcHRpb25zT3JDYWxsYmFjayA6IGNhbGxiYWNrXG5cbiAgICBpZiAoIWFjdHVhbENhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJ3aXRoQ29ubmVjdGlvbiByZXF1aXJlcyBhIGNhbGxiYWNrXCIpXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jaGVja291dChvcHRpb25zKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBhY3R1YWxDYWxsYmFjayhjb25uZWN0aW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICB9XG4gIH1cblxuICBhc3luYyBvcGVuQ2FwdHVyZWRDb25uZWN0aW9uKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZTogXCJGcm9udGVuZCB0ZW5hbnQgU1FMaXRlIG9wZW5cIn0sIHtyZXRhaW46IGZhbHNlfSlcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cnlGb3JDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBjb25uZWN0aW9uIGVudHJ5IGRpc2FwcGVhcmVkIGR1cmluZyBvcGVuXCIpXG4gICAgZW50cnkubGlmZWN5Y2xlUmV0YWluZWQgPSB0cnVlXG4gICAgYXdhaXQgdGhpcy5jaGVja2luKGNvbm5lY3Rpb24pXG4gIH1cblxuICBhc3luYyBmbHVzaENhcHR1cmVkQ29ubmVjdGlvbigvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmNvbm5lY3Rpb25FbnRyaWVzLmdldCh0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pKVxuICAgIGlmIChlbnRyeSkgYXdhaXQgZW50cnkuY29ubmVjdGlvbi5mbHVzaFBlbmRpbmdXcml0ZXMoKVxuICB9XG5cbiAgYXN5bmMgY2xvc2VDYXB0dXJlZENvbm5lY3Rpb24oLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jb25uZWN0aW9uRW50cmllcy5nZXQodGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cbiAgICBpZiAoZW50cnkuYWN0aXZlQ2hlY2tvdXRDb3VudCA+IDApIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbG9zZSBhbiBpbi11c2UgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBoYW5kbGVcIilcbiAgICBhd2FpdCB0aGlzLnJlbW92ZUFuZENsb3NlRW50cnkoZW50cnkpXG4gIH1cblxuICBhc3luYyBkZWxldGVDYXB0dXJlZERhdGFiYXNlKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBhd2FpdCB0aGlzLmNsb3NlQ2FwdHVyZWRDb25uZWN0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBjb25zdCBEcml2ZXJDbGFzcyA9IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5kcml2ZXIgfHwgdGhpcy5kcml2ZXJDbGFzc1xuICAgIGlmICghRHJpdmVyQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBjbGFzcyBjb25maWd1cmVkIGZvciBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGRlbGV0aW9uXCIpXG4gICAgY29uc3QgZHJpdmVyID0gbmV3IERyaXZlckNsYXNzKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgdGhpcy5jb25maWd1cmF0aW9uKVxuICAgIGF3YWl0IGRyaXZlci5kZWxldGVEYXRhYmFzZVN0b3JhZ2UoKVxuICB9XG5cbiAgY2FwdHVyZWRDb25uZWN0aW9uSW5Vc2UoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jb25uZWN0aW9uRW50cmllcy5nZXQodGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcbiAgICByZXR1cm4gQm9vbGVhbihlbnRyeSAmJiBlbnRyeS5hY3RpdmVDaGVja291dENvdW50ID4gMClcbiAgfVxuXG4gIGNhcHR1cmVkQ29ubmVjdGlvbkhhc1BlbmRpbmdXcml0ZXMoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5jb25uZWN0aW9uRW50cmllcy5nZXQodGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcbiAgICByZXR1cm4gQm9vbGVhbihlbnRyeT8uY29ubmVjdGlvbi5oYXNQZW5kaW5nV3JpdGVzKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGxlZ2FjeSBhbWJpZW50IG9wZXJhdGlvbiB1bmRlciBvbmUgcG9vbC13aWRlIEZJRk8gbGVhc2UuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbm5lY3Rpb25DaGVja291dE9wdGlvbnN9IG9wdGlvbnMgLSBDaGVja291dCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgb3duZXI6IHN5bWJvbCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aE9wZXJhdGlvbkNvbm5lY3Rpb24ob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91c0xlYXNlID0gdGhpcy5vcGVyYXRpb25MZWFzZVF1ZXVlXG4gICAgbGV0IHJlbGVhc2VRdWV1ZSA9ICgpID0+IHt9XG4gICAgY29uc3QgcXVldWVUdXJuID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVsZWFzZVF1ZXVlID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG5cbiAgICB0aGlzLm9wZXJhdGlvbkxlYXNlUXVldWUgPSBwcmV2aW91c0xlYXNlLnRoZW4oYXN5bmMgKCkgPT4gYXdhaXQgcXVldWVUdXJuKVxuICAgIGF3YWl0IHByZXZpb3VzTGVhc2VcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Pd25lZE9wZXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG9wdGlvbnMsIHtyZXRhaW46IHRydWV9LCBjYWxsYmFjaylcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVsZWFzZVF1ZXVlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhcHR1cmVkIG9wZXJhdGlvbiB1bmRlciBhIEZJRk8gbGVhc2Ugc2NvcGVkIG9ubHkgdG8gaXRzIHBoeXNpY2FsXG4gICAqIGRhdGFiYXNlIGlkZW50aXR5LCBzbyB1bnJlbGF0ZWQgdGVuYW50IGRhdGFiYXNlcyByZW1haW4gY29uY3VycmVudC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ2FwdHVyZWRDb25uZWN0aW9uT3B0aW9uc30gb3B0aW9ucyAtIENhcHR1cmVkIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBvd25lcjogc3ltYm9sKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQ2FwdHVyZWRPcGVyYXRpb25Db25uZWN0aW9uKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIG5hbWV9LCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHJldXNlS2V5ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IHByZXZpb3VzVHVybiA9IHRoaXMuY2FwdHVyZWRPcGVyYXRpb25RdWV1ZXMuZ2V0KHJldXNlS2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGxldCByZWxlYXNlVHVybiA9ICgpID0+IHt9XG4gICAgY29uc3QgdHVybiA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2VUdXJuID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgY29uc3QgcXVldWVUYWlsID0gcHJldmlvdXNUdXJuLnRoZW4oYXN5bmMgKCkgPT4gYXdhaXQgdHVybilcbiAgICBjb25zdCB3YXNRdWV1ZWQgPSB0aGlzLmNhcHR1cmVkT3BlcmF0aW9uUXVldWVzLmhhcyhyZXVzZUtleSlcbiAgICBjb25zdCBwZW5kaW5nID0gd2FzUXVldWVkID8gdGhpcy5hZGRPcGVyYXRpb25QZW5kaW5nQ2hlY2tvdXQoZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZSwgcmV1c2VLZXl9KSA6IHVuZGVmaW5lZFxuXG4gICAgdGhpcy5jYXB0dXJlZE9wZXJhdGlvblF1ZXVlcy5zZXQocmV1c2VLZXksIHF1ZXVlVGFpbClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JPcGVyYXRpb25UdXJuKHByZXZpb3VzVHVybiwgcGVuZGluZylcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuT3duZWRPcGVyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZX0sIHtyZXRhaW46IGZhbHNlfSwgY2FsbGJhY2spXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChwZW5kaW5nKSB0aGlzLnJlbW92ZVBlbmRpbmdDaGVja291dChwZW5kaW5nKVxuICAgICAgcmVsZWFzZVR1cm4oKVxuICAgICAgdm9pZCBxdWV1ZVRhaWwuZmluYWxseSgoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmNhcHR1cmVkT3BlcmF0aW9uUXVldWVzLmdldChyZXVzZUtleSkgPT09IHF1ZXVlVGFpbCkgdGhpcy5jYXB0dXJlZE9wZXJhdGlvblF1ZXVlcy5kZWxldGUocmV1c2VLZXkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBjYWxsYmFjayB3aXRoIGFuIGluc3RhbGxlZCBkcml2ZXIgb3BlcmF0aW9uIGxlYXNlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gUGh5c2ljYWwgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29ubmVjdGlvbkNoZWNrb3V0T3B0aW9uc30gb3B0aW9ucyAtIENoZWNrb3V0IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7e3JldGFpbjogYm9vbGVhbn19IGNoZWNrb3V0QXJncyAtIENoZWNrb3V0IHJldGVudGlvbi5cbiAgICogQHBhcmFtIHsoY29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIG93bmVyOiBzeW1ib2wpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bk93bmVkT3BlcmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3B0aW9ucywgY2hlY2tvdXRBcmdzLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IG93bmVyID0gU3ltYm9sKFwic2luZ2xlLXBvb2wtb3BlcmF0aW9uLW93bmVyXCIpXG4gICAgY29uc3Qgb3BlcmF0aW9uTGVhc2UgPSBuZXcgT3BlcmF0aW9uTGVhc2Uob3duZXIpXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgb3B0aW9ucywgY2hlY2tvdXRBcmdzKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKGNvbm5lY3Rpb24sIGFzeW5jICgpID0+IHtcbiAgICAgICAgbGV0IG9wZXJhdGlvbkxlYXNlSW5zdGFsbGVkID0gZmFsc2VcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGNvbm5lY3Rpb24uc2V0T3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uTGVhc2UpXG4gICAgICAgICAgb3BlcmF0aW9uTGVhc2VJbnN0YWxsZWQgPSB0cnVlXG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbiwgb3duZXIpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgb3BlcmF0aW9uTGVhc2UucmVsZWFzZSgpXG4gICAgICAgICAgaWYgKG9wZXJhdGlvbkxlYXNlSW5zdGFsbGVkKSBjb25uZWN0aW9uLmNsZWFyT3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uTGVhc2UpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBzYW1lLXBoeXNpY2FsLWRhdGFiYXNlIG9wZXJhdGlvbiBxdWV1ZSB0dXJuLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHByZXZpb3VzVHVybiAtIFByZXZpb3VzIHF1ZXVlIHRhaWwuXG4gICAqIEBwYXJhbSB7U2luZ2xlUG9vbFBlbmRpbmdDaGVja291dCB8IHVuZGVmaW5lZH0gcGVuZGluZyAtIFBlbmRpbmcgZGVidWcgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByZXZpb3VzIHR1cm4gcmVsZWFzZXMuXG4gICAqL1xuICBhc3luYyB3YWl0Rm9yT3BlcmF0aW9uVHVybihwcmV2aW91c1R1cm4sIHBlbmRpbmcpIHtcbiAgICBpZiAoIXBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHByZXZpb3VzVHVyblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHBlbmRpbmcudGltZW91dE1pbGxpcyA9PT0gbnVsbCkge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBwcmV2aW91c1R1cm4udGhlbihyZXNvbHZlLCByZWplY3QpXG4gICAgICAgIHBlbmRpbmcuY2xvc2VQcm9taXNlPy5jYXRjaChyZWplY3QpXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGltZW91dE1pbGxpcyA9IHBlbmRpbmcudGltZW91dE1pbGxpc1xuXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHJlamVjdChuZXcgRXJyb3IoYFRpbWVkIG91dCB3YWl0aW5nIGZvciBkYXRhYmFzZSBjb25uZWN0aW9uIGNoZWNrb3V0IGFmdGVyICR7dGltZW91dE1pbGxpc31tcy5gKSksIHRpbWVvdXRNaWxsaXMpXG5cbiAgICAgIHByZXZpb3VzVHVybi50aGVuKCgpID0+IHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgIH0pXG4gICAgICBwZW5kaW5nLmNsb3NlUHJvbWlzZT8uY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aG91dCBjdXJyZW50IGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICB3aXRob3V0Q3VycmVudENvbm5lY3Rpb25Db250ZXh0KGNhbGxiYWNrKSB7XG4gICAgdGhpcy5zdXBwcmVzc2VkQ29ubmVjdGlvbkNvbnRleHRDb3VudCArPSAxXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gY2FsbGJhY2soKVxuXG4gICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAocmVzdWx0LmZpbmFsbHkoKCkgPT4geyB0aGlzLnN1cHByZXNzZWRDb25uZWN0aW9uQ29udGV4dENvdW50IC09IDEgfSkpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuc3VwcHJlc3NlZENvbm5lY3Rpb25Db250ZXh0Q291bnQgLT0gMVxuICAgICAgcmV0dXJuIHJlc3VsdFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN1cHByZXNzZWRDb25uZWN0aW9uQ29udGV4dENvdW50IC09IDFcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqIENsZWFycyBzY2hlbWEgbWV0YWRhdGEgb24gZXZlcnkgbGl2ZSBwaHlzaWNhbCBjb25uZWN0aW9uLiAqL1xuICBjbGVhclNjaGVtYUNhY2hlKCkge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jb25uZWN0aW9uRW50cmllcy52YWx1ZXMoKSkgdGhpcy5fY2xlYXJDb25uZWN0aW9uU2NoZW1hQ2FjaGUoZW50cnkuY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKiBDbG9zZXMgZXZlcnkgcG9vbC1vd25lZCBjb25uZWN0aW9uIGFuZCByZWplY3RzIHF1ZXVlZCBjYXBhY2l0eSByZXF1ZXN0cy4gKi9cbiAgYXN5bmMgY2xvc2VBbGwoKSB7XG4gICAgY29uc3QgY2xvc2VFcnJvciA9IG5ldyBFcnJvcihcIkRhdGFiYXNlIHBvb2wgd2FzIGNsb3NlZCBiZWZvcmUgY2hlY2tvdXQgY29tcGxldGVkLlwiKVxuXG4gICAgdGhpcy5jbG9zZUdlbmVyYXRpb24rK1xuXG4gICAgZm9yIChjb25zdCBwZW5kaW5nIG9mIFsuLi50aGlzLnBlbmRpbmdDaGVja291dHNdKSBwZW5kaW5nLnJlamVjdChjbG9zZUVycm9yKVxuICAgIHRoaXMubm90aWZ5Q2FwYWNpdHlXYWl0ZXJzKClcbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnRoaXMuY29ubmVjdGlvbkVudHJ5U3Bhd25Qcm9taXNlcy52YWx1ZXMoKV0pXG5cbiAgICBjb25zdCBlbnRyaWVzID0gWy4uLnRoaXMuY29ubmVjdGlvbkVudHJpZXMudmFsdWVzKCldXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25FbnRyaWVzLmNsZWFyKClcbiAgICB0aGlzLmNvbm5lY3Rpb25FbnRyeVNwYXduUHJvbWlzZXMuY2xlYXIoKVxuICAgIHRoaXMudGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleS5jbGVhcigpXG4gICAgdGhpcy5jb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5hY3RpdmVDaGVja291dENvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSBhd2FpdCBlbnRyeS5jb25uZWN0aW9uLmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtdXRhYmxlIGFtYmllbnQgZmFsbGJhY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIE11dGFibGUgYW1iaWVudCBmYWxsYmFjayBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0Q3VycmVudENvbm5lY3Rpb24oKSB7XG4gICAgdGhpcy5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJBIGNvbm5lY3Rpb24gaGFzbid0IGJlZW4gbWFkZSB5ZXRcIilcblxuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYW4gYXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uIGZvciBleGFjdGx5IG9uZSBwaHlzaWNhbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBSZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAtIE9wYXF1ZSByZWdpc3RyYXRpb24gaGFuZGxlLlxuICAgKi9cbiAgc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKGNvbm5lY3Rpb24sIHJldXNlS2V5KSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge293bmVyOiBTeW1ib2woXCJ0ZXN0LXNoYXJlZC1waHlzaWNhbC1jb25uZWN0aW9uXCIpfVxuXG4gICAgdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LnNldChyZXVzZUtleSwge2Nvbm5lY3Rpb24sIHJlZ2lzdHJhdGlvbn0pXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBhbiBhdHRlbXB0LW93bmVkIHNoYXJlZCBwaHlzaWNhbCBjb25uZWN0aW9uIHdpdGhvdXQgcmV2b2tpbmcgYSBuZXdlciBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259IFtyZWdpc3RyYXRpb25dIC0gUmVnaXN0cmF0aW9uIHRvIGNsZWFyIGNvbmRpdGlvbmFsbHkuXG4gICAqL1xuICBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIGlmICghcmVnaXN0cmF0aW9uKSB7XG4gICAgICB0aGlzLnRlc3RTaGFyZWRDb25uZWN0aW9uc0J5UmV1c2VLZXkuY2xlYXIoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbcmV1c2VLZXksIGVudHJ5XSBvZiB0aGlzLnRlc3RTaGFyZWRDb25uZWN0aW9uc0J5UmV1c2VLZXkpIHtcbiAgICAgIGlmIChlbnRyeS5yZWdpc3RyYXRpb24gIT09IHJlZ2lzdHJhdGlvbikgY29udGludWVcbiAgICAgIHRoaXMudGVzdFNoYXJlZENvbm5lY3Rpb25zQnlSZXVzZUtleS5kZWxldGUocmV1c2VLZXkpXG4gICAgICByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGF0dGVtcHQtb3duZWQgY29ubmVjdGlvbiBmb3IgdGhlIGN1cnJlbnQgcGh5c2ljYWwgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgdGVzdFNoYXJlZENvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgcmV1c2VLZXkgPSB0aGlzLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpXG5cbiAgICByZXR1cm4gdGhpcy50ZXN0U2hhcmVkQ29ubmVjdGlvbnNCeVJldXNlS2V5LmdldChyZXVzZUtleSk/LmNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IGNvbnRleHQgZmFsbGJhY2sgY29ubmVjdGlvbiB3aGVuIGl0IGlzIG5vdCBzdXBwcmVzc2VkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBmYWxsYmFjayBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0Q3VycmVudENvbnRleHRDb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLnN1cHByZXNzZWRDb25uZWN0aW9uQ29udGV4dENvdW50ID4gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXMudGVzdFNoYXJlZENvbm5lY3Rpb24oKSB8fCB0aGlzLmNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgZmFsbGJhY2sgY29udGV4dCBpcyBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZmFsbGJhY2sgY29udGV4dCBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBoYXNDdXJyZW50Q29ubmVjdGlvbkNvbnRleHQoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3VwcHJlc3NlZENvbm5lY3Rpb25Db250ZXh0Q291bnQgPT09IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHBvb2wgZGlhZ25vc3RpY3MgZm9yIHJldGFpbmVkIGFuZCB0ZW1wb3Jhcnkga2V5ZWQgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRGF0YWJhc2VQb29sRGVidWdTbmFwc2hvdH0gLSBQb29sIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IFsuLi50aGlzLmNvbm5lY3Rpb25FbnRyaWVzLnZhbHVlcygpXS5tYXAoKGVudHJ5KSA9PiB0aGlzLmRlYnVnQ29ubmVjdGlvblNuYXBzaG90KGVudHJ5LmNvbm5lY3Rpb24sIHtcbiAgICAgIGFjdGl2ZUNoZWNrb3V0Q291bnQ6IGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQsXG4gICAgICBzdGF0ZTogZW50cnkucmV0YWluZWQgPyBcInNoYXJlZFwiIDogZW50cnkuYWN0aXZlQ2hlY2tvdXRDb3VudCA+IDAgPyBcImluLXVzZVwiIDogZW50cnkubGlmZWN5Y2xlUmV0YWluZWQgPyBcImxpZmVjeWNsZS1yZXRhaW5lZFwiIDogXCJpZGxlXCJcbiAgICB9KSlcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uc3VwZXIuZ2V0RGVidWdTbmFwc2hvdCgpLFxuICAgICAgY29ubmVjdGlvbnMsXG4gICAgICBjb25uZWN0aW9uc0JlaW5nU3Bhd25lZDogdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZCxcbiAgICAgIGlkbGVDb3VudDogWy4uLnRoaXMuY29ubmVjdGlvbkVudHJpZXMudmFsdWVzKCldLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmFjdGl2ZUNoZWNrb3V0Q291bnQgPT09IDApLmxlbmd0aCxcbiAgICAgIGluVXNlQ291bnQ6IFsuLi50aGlzLmNvbm5lY3Rpb25FbnRyaWVzLnZhbHVlcygpXS5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5hY3RpdmVDaGVja291dENvdW50ID4gMCkubGVuZ3RoLFxuICAgICAgcGVuZGluZ0NoZWNrb3V0czogdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLm1hcCgocGVuZGluZywgaW5kZXgpID0+ICh7XG4gICAgICAgIGNoZWNrb3V0TmFtZTogcGVuZGluZy5jaGVja291dE5hbWUsXG4gICAgICAgIGVucXVldWVkQXQ6IHBlbmRpbmcuZW5xdWV1ZWRBdCxcbiAgICAgICAgaW5kZXgsXG4gICAgICAgIHJlbWFpbmluZ1RpbWVvdXRNczogcGVuZGluZy50aW1lb3V0QXQgPT09IG51bGwgPyBudWxsIDogTWF0aC5tYXgoMCwgcGVuZGluZy50aW1lb3V0QXQgLSBub3cpLFxuICAgICAgICByZXVzZUtleTogcGVuZGluZy5yZXVzZUtleSxcbiAgICAgICAgdGltZW91dEF0OiBwZW5kaW5nLnRpbWVvdXRBdCxcbiAgICAgICAgdGltZW91dE1pbGxpczogcGVuZGluZy50aW1lb3V0TWlsbGlzLFxuICAgICAgICB3YWl0aW5nRm9yTXM6IE1hdGgubWF4KDAsIG5vdyAtIHBlbmRpbmcuZW5xdWV1ZWRBdClcbiAgICAgIH0pKSxcbiAgICAgIHBlbmRpbmdDaGVja291dENvdW50OiB0aGlzLnBlbmRpbmdDaGVja291dHMubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbmZpZ3VyZWQgY29ubmVjdGlvbiBtYXhpbXVtLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gUGh5c2ljYWwgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gQ29uZmlndXJlZCBjb25uZWN0aW9uIG1heGltdW0uXG4gICAqL1xuICBtYXhDb25uZWN0aW9ucyhkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCB2YWx1ZSA9IGRhdGFiYXNlQ29uZmlndXJhdGlvbi5wb29sPy5tYXhcblxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPj0gMSkgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gREVGQVVMVF9NQVhfQ09OTkVDVElPTlNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25maWd1cmVkIGNoZWNrb3V0IHRpbWVvdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBQaHlzaWNhbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBDb25maWd1cmVkIGNoZWNrb3V0IHRpbWVvdXQuXG4gICAqL1xuICBjaGVja291dFRpbWVvdXRNaWxsaXMoZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgdmFsdWUgPSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24ucG9vbD8uY2hlY2tvdXRUaW1lb3V0TWlsbGlzXG5cbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDApIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIERFRkFVTFRfQ0hFQ0tPVVRfVElNRU9VVF9NSUxMSVNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgYW5vdGhlciBwaHlzaWNhbCBjb25uZWN0aW9uIG1heSBiZSBzcGF3bmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gUGh5c2ljYWwgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbm90aGVyIHBoeXNpY2FsIGNvbm5lY3Rpb24gbWF5IGJlIHNwYXduZWQuXG4gICAqL1xuICBjYW5TcGF3bkNvbm5lY3Rpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgbWF4ID0gdGhpcy5tYXhDb25uZWN0aW9ucyhkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXR1cm4gbWF4ID09PSBudWxsIHx8IHRoaXMuY29ubmVjdGlvbkVudHJpZXMuc2l6ZSArIHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWQgPCBtYXhcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IGNsYWltcyBvbmUgY29ubmVjdGlvbiBzbG90IHdpdGhvdXQgeWllbGRpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBQaHlzaWNhbCBjb25maWd1cmF0aW9uIHdob3NlIG1heGltdW0gYXBwbGllcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhIHNsb3Qgd2FzIHJlc2VydmVkLlxuICAgKi9cbiAgdHJ5UmVzZXJ2ZUNvbm5lY3Rpb25DYXBhY2l0eShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAoIXRoaXMuY2FuU3Bhd25Db25uZWN0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbikpIHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5jb25uZWN0aW9uc0JlaW5nU3Bhd25lZCsrXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqIFJlbGVhc2VzIG9uZSBwcmV2aW91c2x5IGNsYWltZWQgY29ubmVjdGlvbiBzbG90LiAqL1xuICByZWxlYXNlQ29ubmVjdGlvbkNhcGFjaXR5UmVzZXJ2YXRpb24oKSB7XG4gICAgaWYgKHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWQgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVsZWFzZSBhbiB1bnJlc2VydmVkIGRhdGFiYXNlIGNvbm5lY3Rpb24gc2xvdFwiKVxuICAgIH1cblxuICAgIHRoaXMuY29ubmVjdGlvbnNCZWluZ1NwYXduZWQtLVxuICAgIHRoaXMubm90aWZ5Q2FwYWNpdHlXYWl0ZXJzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGF3bnMgYW5kIHRyYWNrcyBhIHBoeXNpY2FsIGNvbm5lY3Rpb24gZW50cnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBQaHlzaWNhbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmV1c2VLZXkgLSBQaHlzaWNhbCByZXVzZSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjbG9zZUdlbmVyYXRpb24gLSBQb29sIGxpZmVjeWNsZSBnZW5lcmF0aW9uIGF0IHNwYXduIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaW5nbGVQb29sQ29ubmVjdGlvbkVudHJ5Pn0gLSBOZXcgZW50cnkuXG4gICAqL1xuICBhc3luYyBzcGF3bkNvbm5lY3Rpb25FbnRyeShkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHJldXNlS2V5LCBjbG9zZUdlbmVyYXRpb24pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuc3Bhd25Db25uZWN0aW9uRm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICAgIGlmICh0aGlzLmNsb3NlR2VuZXJhdGlvbiAhPT0gY2xvc2VHZW5lcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBwb29sIHdhcyBjbG9zZWQgYmVmb3JlIGNoZWNrb3V0IGNvbXBsZXRlZC5cIilcbiAgICAgIH1cblxuICAgICAgLyoqIEB0eXBlIHtTaW5nbGVQb29sQ29ubmVjdGlvbkVudHJ5fSAqL1xuICAgICAgY29uc3QgZW50cnkgPSB7YWN0aXZlQ2hlY2tvdXRDb3VudDogMCwgY2hlY2tvdXROYW1lczogW10sIGNvbm5lY3Rpb24sIGxpZmVjeWNsZVJldGFpbmVkOiBmYWxzZSwgcmV0YWluZWQ6IGZhbHNlLCByZXVzZUtleX1cblxuICAgICAgdGhpcy5jb25uZWN0aW9uRW50cmllcy5zZXQocmV1c2VLZXksIGVudHJ5KVxuXG4gICAgICByZXR1cm4gZW50cnlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5yZWxlYXNlQ29ubmVjdGlvbkNhcGFjaXR5UmVzZXJ2YXRpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGFuZCBjbG9zZXMgYW4gZW50cnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7U2luZ2xlUG9vbENvbm5lY3Rpb25FbnRyeSB8IHVuZGVmaW5lZH0gLSBFbnRyeSBvd25pbmcgYSBjb25uZWN0aW9uLlxuICAgKi9cbiAgZW50cnlGb3JDb25uZWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuY29ubmVjdGlvbkVudHJpZXMudmFsdWVzKCldLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5jb25uZWN0aW9uID09PSBjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBzYW1lLWtleSBvcGVyYXRpb24gcGVuZGluZyBlbnRyeS5cbiAgICogQHBhcmFtIHtTaW5nbGVQb29sQ29ubmVjdGlvbkVudHJ5fSBlbnRyeSAtIEVudHJ5IHRvIGNsb3NlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUFuZENsb3NlRW50cnkoZW50cnkpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uRW50cmllcy5nZXQoZW50cnkucmV1c2VLZXkpICE9PSBlbnRyeSkgcmV0dXJuXG5cbiAgICB0aGlzLmNvbm5lY3Rpb25FbnRyaWVzLmRlbGV0ZShlbnRyeS5yZXVzZUtleSlcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uID09PSBlbnRyeS5jb25uZWN0aW9uKSB0aGlzLmNvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgICBhd2FpdCBlbnRyeS5jb25uZWN0aW9uLmNsb3NlKClcbiAgICB0aGlzLm5vdGlmeUNhcGFjaXR5V2FpdGVycygpXG4gIH1cblxuICAvKiogV2FrZXMgYWxsIGNhcGFjaXR5IHdhaXRlcnMgdG8gcmUtY2hlY2sgdGhlIGJvdW5kZWQgcG9vbC4gKi9cbiAgbm90aWZ5Q2FwYWNpdHlXYWl0ZXJzKCkge1xuICAgIGZvciAoY29uc3QgcmVzZXJ2ZUFuZFJlc29sdmUgb2YgdGhpcy5jYXBhY2l0eVdhaXRlcnMpIHtcbiAgICAgIGlmIChyZXNlcnZlQW5kUmVzb2x2ZSgpKSByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIHNhbWUta2V5IG9wZXJhdGlvbiBwZW5kaW5nIGVudHJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gZGF0YWJhc2VDb25maWd1cmF0aW9uIC0gUGh5c2ljYWwgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHt7bmFtZT86IHN0cmluZywgcmV1c2VLZXk6IHN0cmluZ319IG9wdGlvbnMgLSBQZW5kaW5nIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7U2luZ2xlUG9vbFBlbmRpbmdDaGVja291dH0gLSBBZGRlZCBzYW1lLWtleSBvcGVyYXRpb24gcGVuZGluZyBlbnRyeS5cbiAgICovXG4gIGFkZE9wZXJhdGlvblBlbmRpbmdDaGVja291dChkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHtuYW1lLCByZXVzZUtleX0pIHtcbiAgICBjb25zdCB0aW1lb3V0TWlsbGlzID0gdGhpcy5jaGVja291dFRpbWVvdXRNaWxsaXMoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGVucXVldWVkQXQgPSBEYXRlLm5vdygpXG4gICAgLyoqXG4gICAgICogUmVqZWN0cyB0aGUgY2xvc2Utb3duZWQgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVqZWN0Q2xvc2UgPSAoKSA9PiB7fVxuICAgIGNvbnN0IGNsb3NlUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHZvaWQgcmVzb2x2ZVxuICAgICAgcmVqZWN0Q2xvc2UgPSByZWplY3RcbiAgICB9KVxuICAgIGNvbnN0IHBlbmRpbmcgPSB7XG4gICAgICBjaGVja291dE5hbWU6IG5hbWUsXG4gICAgICBjbG9zZVByb21pc2UsXG4gICAgICBlbnF1ZXVlZEF0LFxuICAgICAgcmVqZWN0OiByZWplY3RDbG9zZSxcbiAgICAgIHJldXNlS2V5LFxuICAgICAgdGltZW91dEF0OiB0aW1lb3V0TWlsbGlzID09PSBudWxsID8gbnVsbCA6IGVucXVldWVkQXQgKyB0aW1lb3V0TWlsbGlzLFxuICAgICAgdGltZW91dE1pbGxpc1xuICAgIH1cblxuICAgIHRoaXMucGVuZGluZ0NoZWNrb3V0cy5wdXNoKHBlbmRpbmcpXG5cbiAgICByZXR1cm4gcGVuZGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBwZW5kaW5nIGNoZWNrb3V0IGRlYnVnIGVudHJ5LlxuICAgKiBAcGFyYW0ge1NpbmdsZVBvb2xQZW5kaW5nQ2hlY2tvdXR9IHBlbmRpbmcgLSBQZW5kaW5nIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlbW92ZVBlbmRpbmdDaGVja291dChwZW5kaW5nKSB7XG4gICAgY29uc3QgaW5kZXggPSB0aGlzLnBlbmRpbmdDaGVja291dHMuaW5kZXhPZihwZW5kaW5nKVxuXG4gICAgaWYgKGluZGV4ICE9PSAtMSkgdGhpcy5wZW5kaW5nQ2hlY2tvdXRzLnNwbGljZShpbmRleCwgMSlcbiAgfVxufVxuIl19