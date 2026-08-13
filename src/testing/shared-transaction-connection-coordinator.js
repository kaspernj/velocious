// @ts-check

/** @type {WeakMap<object, {coordinator: (callback: () => Promise<unknown>) => Promise<unknown>, owner: symbol}>} */
const coordinators = new WeakMap()

/**
 * Registers test-only serialization owned by the active broker.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Serializer.
 * @returns {symbol} - Opaque owner for broker-internal connection calls.
 */
export function setSharedTransactionCoordinator(connection, coordinator) {
  const owner = Symbol("shared-transaction-coordinator")

  coordinators.set(connection, {coordinator, owner})
  return owner
}

/**
 * Removes a broker-owned coordinator without disturbing a replacement.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Expected serializer.
 * @returns {void}
 */
export function clearSharedTransactionCoordinator(connection, coordinator) {
  if (coordinators.get(connection)?.coordinator === coordinator) coordinators.delete(connection)
}

/**
 * Runs parent work through broker serialization when registered.
 * @template T
 * @param {import("../database/drivers/base.js").default} connection - Parent physical connection.
 * @param {() => Promise<T>} callback - Parent operation.
 * @param {symbol} [operationOwner] - Broker owner for an already-coordinated operation.
 * @returns {Promise<T>} - Operation result.
 */
export async function coordinateSharedTransactionConnection(connection, callback, operationOwner) {
  const registration = coordinators.get(connection)

  if (!registration) return await callback()
  if (operationOwner === registration.owner) return await callback()

  const environmentHandler = connection.configuration.getEnvironmentHandler()

  if (environmentHandler.getSharedTransactionCoordinatorOwner(connection) === registration.owner) {
    return await callback()
  }

  return /** @type {T} */ (await registration.coordinator(async () => {
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, registration.owner, callback)
  }))
}
