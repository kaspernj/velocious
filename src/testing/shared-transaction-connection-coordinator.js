// @ts-check

/** @typedef {{coordinator: (callback: () => Promise<unknown>) => Promise<unknown>, ownedQueue: Promise<void>, owner: symbol}} CoordinatorRegistration */

/** @type {WeakMap<object, CoordinatorRegistration>} */
const coordinators = new WeakMap()

/**
 * Serializes sibling work that inherited one coordinator owner without re-entering the broker queue.
 * @template T
 * @param {CoordinatorRegistration} registration - Physical connection registration.
 * @param {() => Promise<T>} callback - Owned operation.
 * @returns {Promise<T>} - Operation result.
 */
async function coordinateOwnedSharedTransactionConnection(registration, callback) {
  const previous = registration.ownedQueue
  /**
   * Releases the next owned sibling operation.
   * @type {() => void}
   */
  let release = () => {}

  registration.ownedQueue = new Promise((resolve) => { release = resolve })
  await previous
  try {
    return await callback()
  } finally {
    release()
  }
}

/**
 * Registers test-only serialization owned by the active broker.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Serializer.
 * @returns {symbol} - Opaque owner for broker-internal connection calls.
 */
export function setSharedTransactionCoordinator(connection, coordinator) {
  const owner = Symbol("shared-transaction-coordinator")

  coordinators.set(connection, {coordinator, ownedQueue: Promise.resolve(), owner})
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
  const environmentHandler = connection.configuration.getEnvironmentHandler()
  const inheritedOwner = environmentHandler.getSharedTransactionCoordinatorOwner(connection)

  if (inheritedOwner === registration.owner && operationOwner === registration.owner) return await callback()
  if (inheritedOwner === registration.owner) {
    return await coordinateOwnedSharedTransactionConnection(registration, callback)
  }
  if (operationOwner === registration.owner) {
    await registration.ownedQueue
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, registration.owner, callback)
  }

  return /** @type {T} */ (await registration.coordinator(async () => {
    await registration.ownedQueue
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, registration.owner, callback)
  }))
}
