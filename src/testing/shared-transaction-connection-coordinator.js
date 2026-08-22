// @ts-check

/** @typedef {{coordinator: (callback: () => Promise<unknown>) => Promise<unknown>, ownedQueue: Promise<void>, owner: symbol, reentrantOwners: Set<symbol>, rootOwners: Set<symbol>}} CoordinatorRegistration */

/** @type {WeakMap<object, CoordinatorRegistration>} */
const coordinators = new WeakMap()
/** @type {WeakMap<object, CoordinatorRegistration>} */
const connectionRegistrations = new WeakMap()

/**
 * Runs work directly when only the connection-local queue remains registered.
 * @param {() => Promise<unknown>} callback - Serialized operation.
 * @returns {Promise<unknown>} - Operation result.
 */
async function inactiveCoordinator(callback) {
  return await callback()
}

/**
 * Serializes sibling work that inherited one coordinator owner without re-entering the broker queue.
 * @template T
 * @param {import("../database/drivers/base.js").default} connection - Parent physical connection.
 * @param {CoordinatorRegistration} registration - Physical connection registration.
 * @param {() => Promise<T>} callback - Owned operation.
 * @returns {Promise<T>} - Operation result.
 */
async function coordinateOwnedSharedTransactionConnection(connection, registration, callback) {
  const previous = registration.ownedQueue
  /**
   * Releases the next owned sibling operation.
   * @type {() => void}
   */
  let release = () => {}

  registration.ownedQueue = new Promise((resolve) => { release = resolve })
  await previous
  const operationOwner = Symbol("shared-transaction-owned-operation")
  const environmentHandler = connection.configuration.getEnvironmentHandler()

  registration.reentrantOwners.add(operationOwner)
  try {
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, operationOwner, callback)
  } finally {
    registration.reentrantOwners.delete(operationOwner)
    release()
  }
}

/**
 * Drains all inherited operations admitted before the root owner is revoked.
 * @param {CoordinatorRegistration} registration - Physical connection registration.
 * @returns {Promise<void>} - Resolves when the owned queue stops advancing.
 */
async function drainOwnedSharedTransactionConnections(registration) {
  let tail

  do {
    tail = registration.ownedQueue
    await tail
  } while (tail !== registration.ownedQueue)
}

/**
 * Runs one broker-serialized root while tracking and draining its inherited work.
 * @template T
 * @param {import("../database/drivers/base.js").default} connection - Parent physical connection.
 * @param {CoordinatorRegistration} registration - Physical connection registration.
 * @param {() => Promise<T>} callback - Root operation.
 * @returns {Promise<T>} - Operation result.
 */
async function coordinateRootSharedTransactionConnection(connection, registration, callback) {
  await drainOwnedSharedTransactionConnections(registration)
  const rootOwner = Symbol("shared-transaction-root-operation")
  const environmentHandler = connection.configuration.getEnvironmentHandler()

  registration.rootOwners.add(rootOwner)
  try {
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, rootOwner, callback)
  } finally {
    await drainOwnedSharedTransactionConnections(registration)
    registration.rootOwners.delete(rootOwner)
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
  let registration = connectionRegistrations.get(connection)

  if (registration) {
    registration.coordinator = coordinator
    registration.owner = owner
  } else {
    registration = {coordinator, ownedQueue: Promise.resolve(), owner, reentrantOwners: new Set(), rootOwners: new Set()}
    connectionRegistrations.set(connection, registration)
  }

  coordinators.set(connection, registration)
  return owner
}

/**
 * Removes a broker-owned coordinator without disturbing a replacement.
 * @param {object} connection - Parent physical connection.
 * @param {(callback: () => Promise<unknown>) => Promise<unknown>} coordinator - Expected serializer.
 * @returns {void}
 */
export function clearSharedTransactionCoordinator(connection, coordinator) {
  const registration = coordinators.get(connection)

  if (registration?.coordinator === coordinator) {
    coordinators.delete(connection)
    registration.coordinator = inactiveCoordinator
  }
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
  const activeRegistration = coordinators.get(connection)
  const registration = activeRegistration || connectionRegistrations.get(connection)

  if (!registration) return await callback()

  const environmentHandler = connection.configuration.getEnvironmentHandler()
  const currentOwner = environmentHandler.getSharedTransactionCoordinatorOwner(connection)

  if (currentOwner && registration.reentrantOwners.has(currentOwner)) return await callback()
  if (currentOwner && registration.rootOwners.has(currentOwner)) {
    return await coordinateOwnedSharedTransactionConnection(connection, registration, callback)
  }
  if (!activeRegistration) return await coordinateOwnedSharedTransactionConnection(connection, registration, callback)
  if (operationOwner === registration.owner) {
    return await coordinateRootSharedTransactionConnection(connection, registration, callback)
  }

  return /** @type {T} */ (await registration.coordinator(async () => {
    return await coordinateRootSharedTransactionConnection(connection, registration, callback)
  }))
}
