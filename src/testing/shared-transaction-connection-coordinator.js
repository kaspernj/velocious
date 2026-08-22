// @ts-check

/** @typedef {{ownedQueue: Promise<void>}} CoordinatorOwnerScope */
/** @typedef {{coordinator: (callback: () => Promise<unknown>) => Promise<unknown>, owner: symbol, ownerScopes: Map<symbol, CoordinatorOwnerScope>}} CoordinatorRegistration */

/** @type {WeakMap<object, CoordinatorRegistration>} */
const coordinators = new WeakMap()

/**
 * Serializes sibling work that inherited one coordinator owner without re-entering the broker queue.
 * @template T
 * @param {import("../database/drivers/base.js").default} connection - Parent physical connection.
 * @param {CoordinatorRegistration} registration - Physical connection registration.
 * @param {CoordinatorOwnerScope} ownerScope - Queue inherited from the current owner.
 * @param {() => Promise<T>} callback - Owned operation.
 * @returns {Promise<T>} - Operation result.
 */
async function coordinateOwnedSharedTransactionConnection(connection, registration, ownerScope, callback) {
  const previous = ownerScope.ownedQueue
  /**
   * Releases the next owned sibling operation.
   * @type {() => void}
   */
  let release = () => {}

  ownerScope.ownedQueue = new Promise((resolve) => { release = resolve })
  await previous
  const operationOwner = Symbol("shared-transaction-owned-operation")
  const environmentHandler = connection.configuration.getEnvironmentHandler()
  const operationScope = {ownedQueue: Promise.resolve()}

  registration.ownerScopes.set(operationOwner, operationScope)
  try {
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, operationOwner, callback)
  } finally {
    await drainOwnedSharedTransactionConnections(operationScope)
    registration.ownerScopes.delete(operationOwner)
    release()
  }
}

/**
 * Drains all inherited operations admitted before the root owner is revoked.
 * @param {CoordinatorOwnerScope} ownerScope - Owner scope to drain.
 * @returns {Promise<void>} - Resolves when the owned queue stops advancing.
 */
async function drainOwnedSharedTransactionConnections(ownerScope) {
  let tail

  do {
    tail = ownerScope.ownedQueue
    await tail
  } while (tail !== ownerScope.ownedQueue)
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
  const rootOwner = Symbol("shared-transaction-root-operation")
  const environmentHandler = connection.configuration.getEnvironmentHandler()
  const rootScope = {ownedQueue: Promise.resolve()}

  registration.ownerScopes.set(rootOwner, rootScope)
  try {
    return await environmentHandler.runWithSharedTransactionCoordinatorOwner(connection, rootOwner, callback)
  } finally {
    await drainOwnedSharedTransactionConnections(rootScope)
    registration.ownerScopes.delete(rootOwner)
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

  coordinators.set(connection, {
    coordinator,
    owner,
    ownerScopes: new Map()
  })
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
  const currentOwner = environmentHandler.getSharedTransactionCoordinatorOwner(connection)
  const currentOwnerScope = currentOwner ? registration.ownerScopes.get(currentOwner) : undefined

  if (currentOwnerScope) {
    return await coordinateOwnedSharedTransactionConnection(connection, registration, currentOwnerScope, callback)
  }
  if (operationOwner === registration.owner) {
    return await coordinateRootSharedTransactionConnection(connection, registration, callback)
  }

  return /** @type {T} */ (await registration.coordinator(async () => {
    return await coordinateRootSharedTransactionConnection(connection, registration, callback)
  }))
}
