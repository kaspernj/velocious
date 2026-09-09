import BasePool from "./base.js";
export type SinglePoolConnectionEntry = {
    /**
     * - Active users of the connection.
     */
    activeCheckoutCount: number;
    /**
     * - Nested checkout names.
     */
    checkoutNames: string[];
    /**
     * - Owned driver.
     */
    connection: import("../drivers/base.js").default;
    /**
     * - Whether frontend tenant lifecycle ownership retains this entry.
     */
    lifecycleRetained: boolean;
    /**
     * - Whether normal ambient use retains this idle entry.
     */
    retained: boolean;
    /**
     * - Physical configuration reuse key.
     */
    reuseKey: string;
};
export type SinglePoolPendingCheckout = {
    /**
     * - Checkout name.
     */
    checkoutName: string | undefined;
    /**
     * - Rejects if closeAll owns cancellation.
     */
    closePromise?: Promise<void>;
    /**
     * - Enqueue timestamp.
     */
    enqueuedAt: number;
    /**
     * - Rejects a capacity waiter during closeAll.
     */
    reject: (error: Error) => void;
    /**
     * - Physical configuration reuse key.
     */
    reuseKey: string;
    /**
     * - Timeout timestamp.
     */
    timeoutAt: number | null;
    /**
     * - Configured timeout.
     */
    timeoutMillis: number | null;
};
export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
    connection: import("../drivers/base.js").default | undefined;
    activeCheckoutCount: number;
    suppressedConnectionContextCount: number;
    operationLeaseQueue: Promise<void>;
    connectionsBeingSpawned: number;
    /** @type {Map<string, SinglePoolConnectionEntry>} */
    connectionEntries: Map<string, SinglePoolConnectionEntry>;
    /** @type {Map<string, Promise<SinglePoolConnectionEntry>>} */
    connectionEntrySpawnPromises: Map<string, Promise<SinglePoolConnectionEntry>>;
    /** @type {Map<string, Promise<void>>} */
    capturedOperationQueues: Map<string, Promise<void>>;
    /** @type {SinglePoolPendingCheckout[]} */
    pendingCheckouts: SinglePoolPendingCheckout[];
    /** @type {Set<() => boolean>} */
    capacityWaiters: Set<() => boolean>;
    closeGeneration: number;
    /** @type {Map<string, {connection: import("../drivers/base.js").default, registration: import("./base.js").TestSharedConnectionRegistration}>} */
    testSharedConnectionsByReuseKey: Map<string, {
        connection: import("../drivers/base.js").default;
        registration: import("./base.js").TestSharedConnectionRegistration;
    }>;
    /**
     * Checks a connection back into its keyed physical entry.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {Promise<void>} - Resolves when cleanup completes.
     */
    checkin(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Permanently removes and closes a checked-out connection.
     * @param {import("../drivers/base.js").default} connection - Connection that must not return to the pool.
     */
    discard(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Checks out the ambient configuration and retains it as the single mutable
     * browser fallback connection.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
     */
    checkout(options?: import("./base.js").ConnectionCheckoutOptions): Promise<import("../drivers/base.js").default>;
    /**
     * Checks out an explicitly captured physical configuration.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured configuration.
     * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
     * @param {{retain: boolean}} [args] - Whether this becomes the ambient retained connection.
     * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
     */
    checkoutForConfiguration(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, options?: import("./base.js").ConnectionCheckoutOptions, { retain }?: {
        retain: boolean;
    }): Promise<import("../drivers/base.js").default>;
    /**
     * Ensures capacity exists for another physical connection.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Requested configuration.
     * @param {{name?: string, reuseKey: string}} options - Pending checkout identity.
     * @returns {Promise<void>} - Resolves when capacity is available.
     */
    reserveConnectionCapacity(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, options: {
        name?: string;
        reuseKey: string;
    }): Promise<void>;
    /**
     * Waits for pool capacity with normal timeout and closeAll ownership.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Requested configuration.
     * @param {{name?: string, reuseKey: string}} options - Pending checkout identity.
     * @returns {Promise<void>} - Resolves on a capacity change.
     */
    waitForCapacity(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, options: {
        name?: string;
        reuseKey: string;
    }): Promise<void>;
    /**
     * Runs with connection.
     * @template T
     * @param {import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} optionsOrCallback - Options or callback.
     * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [callback] - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    withConnection<T>(optionsOrCallback: import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>), callback?: (arg: import("../drivers/base.js").default) => Promise<T>): Promise<T>;
    openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): Promise<void>;
    capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    /**
     * Runs a legacy ambient operation under one pool-wide FIFO lease.
     * @template T
     * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    withOperationConnection<T>(options: import("./base.js").ConnectionCheckoutOptions, callback: (connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>): Promise<T>;
    /**
     * Runs a captured operation under a FIFO lease scoped only to its physical
     * database identity, so unrelated tenant databases remain concurrent.
     * @template T
     * @param {import("./base.js").CapturedConnectionOptions} options - Captured options.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    withCapturedOperationConnection<T>({ databaseConfiguration, name }: import("./base.js").CapturedConnectionOptions, callback: (connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>): Promise<T>;
    /**
     * Runs one callback with an installed driver operation lease.
     * @template T
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
     * @param {{retain: boolean}} checkoutArgs - Checkout retention.
     * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    runOwnedOperation<T>(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, options: import("./base.js").ConnectionCheckoutOptions, checkoutArgs: {
        retain: boolean;
    }, callback: (connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>): Promise<T>;
    /**
     * Waits for a same-physical-database operation queue turn.
     * @param {Promise<void>} previousTurn - Previous queue tail.
     * @param {SinglePoolPendingCheckout | undefined} pending - Pending debug entry.
     * @returns {Promise<void>} - Resolves when the previous turn releases.
     */
    waitForOperationTurn(previousTurn: Promise<void>, pending: SinglePoolPendingCheckout | undefined): Promise<void>;
    /**
     * Runs without current connection context.
     * @template T
     * @param {() => T} callback - Callback.
     * @returns {T} - Callback result.
     */
    withoutCurrentConnectionContext<T>(callback: () => T): T;
    /** Clears schema metadata on every live physical connection. */
    clearSchemaCache(): void;
    /** Closes every pool-owned connection and rejects queued capacity requests. */
    closeAll(): Promise<void>;
    /**
     * Returns the mutable ambient fallback connection.
     * @returns {import("../drivers/base.js").default} - Mutable ambient fallback connection.
     */
    getCurrentConnection(): import("../drivers/base.js").default;
    /**
     * Registers an attempt-owned connection for exactly one physical configuration.
     * @param {import("../drivers/base.js").default} connection - Attempt-owned connection.
     * @param {string} reuseKey - Resolved physical configuration identity.
     * @returns {import("./base.js").TestSharedConnectionRegistration} - Opaque registration handle.
     */
    setTestSharedConnectionForConfiguration(connection: import("../drivers/base.js").default, reuseKey: string): import("./base.js").TestSharedConnectionRegistration;
    /**
     * Clears an attempt-owned shared physical connection without revoking a newer owner.
     * @param {import("./base.js").TestSharedConnectionRegistration} [registration] - Registration to clear conditionally.
     */
    clearTestSharedConnection(registration?: import("./base.js").TestSharedConnectionRegistration): void;
    /**
     * Resolves the attempt-owned connection for the current physical configuration.
     * @returns {import("../drivers/base.js").default | undefined} - Shared connection.
     */
    testSharedConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Returns the current context fallback connection when it is not suppressed.
     * @returns {import("../drivers/base.js").default | undefined} - Current fallback connection.
     */
    getCurrentContextConnection(): import("../drivers/base.js").default | undefined;
    /**
     * Returns whether fallback context is available.
     * @returns {boolean} - Whether fallback context is available.
     */
    hasCurrentConnectionContext(): boolean;
    /**
     * Returns pool diagnostics for retained and temporary keyed connections.
     * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Pool diagnostics.
     */
    getDebugSnapshot(): import("./base.js").DatabasePoolDebugSnapshot;
    /**
     * Returns the configured connection maximum.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @returns {number | null} - Configured connection maximum.
     */
    maxConnections(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): number | null;
    /**
     * Returns the configured checkout timeout.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @returns {number | null} - Configured checkout timeout.
     */
    checkoutTimeoutMillis(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): number | null;
    /**
     * Returns whether another physical connection may be spawned.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @returns {boolean} - Whether another physical connection may be spawned.
     */
    canSpawnConnection(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    /**
     * Atomically claims one connection slot without yielding.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration whose maximum applies.
     * @returns {boolean} - Whether a slot was reserved.
     */
    tryReserveConnectionCapacity(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType): boolean;
    /** Releases one previously claimed connection slot. */
    releaseConnectionCapacityReservation(): void;
    /**
     * Spawns and tracks a physical connection entry.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @param {string} reuseKey - Physical reuse key.
     * @param {number} closeGeneration - Pool lifecycle generation at spawn start.
     * @returns {Promise<SinglePoolConnectionEntry>} - New entry.
     */
    spawnConnectionEntry(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, reuseKey: string, closeGeneration: number): Promise<SinglePoolConnectionEntry>;
    /**
     * Removes and closes an entry.
     * @param {import("../drivers/base.js").default} connection - Connection.
     * @returns {SinglePoolConnectionEntry | undefined} - Entry owning a connection.
     */
    entryForConnection(connection: import("../drivers/base.js").default): SinglePoolConnectionEntry | undefined;
    /**
     * Adds a same-key operation pending entry.
     * @param {SinglePoolConnectionEntry} entry - Entry to close.
     * @returns {Promise<void>} - Resolves after close.
     */
    removeAndCloseEntry(entry: SinglePoolConnectionEntry): Promise<void>;
    /** Wakes all capacity waiters to re-check the bounded pool. */
    notifyCapacityWaiters(): void;
    /**
     * Adds a same-key operation pending entry.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
     * @param {{name?: string, reuseKey: string}} options - Pending identity.
     * @returns {SinglePoolPendingCheckout} - Added same-key operation pending entry.
     */
    addOperationPendingCheckout(databaseConfiguration: import("../../configuration-types.js").DatabaseConfigurationType, { name, reuseKey }: {
        name?: string;
        reuseKey: string;
    }): SinglePoolPendingCheckout;
    /**
     * Removes a pending checkout debug entry.
     * @param {SinglePoolPendingCheckout} pending - Pending entry.
     * @returns {void}
     */
    removePendingCheckout(pending: SinglePoolPendingCheckout): void;
}
//# sourceMappingURL=single-multi-use.d.ts.map