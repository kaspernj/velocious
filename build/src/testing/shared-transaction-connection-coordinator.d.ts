export type CoordinatorOwnerScope = {
    ownedQueue: Promise<void>;
};
export type CoordinatorRegistration = {
    connectionScope: CoordinatorOwnerScope;
    coordinator: (callback: () => Promise<unknown>) => Promise<unknown>;
    owner: symbol;
    ownerScopes: Map<symbol, CoordinatorOwnerScope>;
};
/**
 * Registers test-only serialization owned by the active broker.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Serializer.
 * @returns {symbol} - Opaque owner for broker-internal connection calls.
 */
export declare function setSharedTransactionCoordinator(connection: object, coordinator: (callback: () => Promise<unknown>) => Promise<unknown>): symbol;
/**
 * Removes a broker-owned coordinator without disturbing a replacement.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Expected serializer.
 * @returns {void}
 */
export declare function clearSharedTransactionCoordinator(connection: object, coordinator: (callback: () => Promise<unknown>) => Promise<unknown>): void;
/**
 * Runs parent work through broker serialization when registered.
 * @template T
 * @param {import("../database/drivers/base.js").default} connection - Parent physical connection.
 * @param {() => Promise<T>} callback - Parent operation.
 * @param {symbol} [operationOwner] - Broker owner for an already-coordinated operation.
 * @returns {Promise<T>} - Operation result.
 */
export declare function coordinateSharedTransactionConnection<T>(connection: import("../database/drivers/base.js").default, callback: () => Promise<T>, operationOwner?: symbol): Promise<T>;
/**
 * Runs physical query work without inheriting this connection's coordinator owner.
 * Unregistered connections have no coordinator ownership to clear.
 * @template T
 * @param {import("../database/drivers/base.js").default} connection - Physical connection.
 * @param {() => Promise<T>} callback - Physical query work.
 * @returns {Promise<T>} - Callback result.
 */
export declare function runWithoutSharedTransactionCoordinatorOwner<T>(connection: import("../database/drivers/base.js").default, callback: () => Promise<T>): Promise<T>;
//# sourceMappingURL=shared-transaction-connection-coordinator.d.ts.map