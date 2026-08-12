// @ts-check

/** @type {WeakMap<object, (callback: () => Promise<unknown>) => Promise<unknown>>} */
const coordinators = new WeakMap()

/**
 * Registers test-only serialization owned by the active broker.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Serializer.
 * @returns {void}
 */
export function setSharedTransactionCoordinator(connection, coordinator) {
  coordinators.set(connection, coordinator)
}

/**
 * Removes a broker-owned coordinator without disturbing a replacement.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Expected serializer.
 * @returns {void}
 */
export function clearSharedTransactionCoordinator(connection, coordinator) {
  if (coordinators.get(connection) === coordinator) coordinators.delete(connection)
}

/**
 * Runs parent work through broker serialization when registered.
 * @template T
 * @param {object} connection - Parent physical connection.
 * @param {() => Promise<T>} callback - Parent operation.
 * @returns {Promise<T>} - Operation result.
 */
export async function coordinateSharedTransactionConnection(connection, callback) {
  const coordinator = coordinators.get(connection)

  if (!coordinator) return await callback()
  return /** @type {T} */ (await coordinator(callback))
}
