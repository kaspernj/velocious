// @ts-check

/**
 * Registry for the app's current sync client.
 *
 * Kept dependency-free so client-bundled modules (like the query layer) can
 * delegate to a configured sync client without importing the sync stack.
 */

/** @type {ReturnType<typeof JSON.parse>} */
let currentClient = null

/**
 * Registers the current sync client.
 * @param {ReturnType<typeof JSON.parse>} client - Configured sync client (or null to clear).
 * @returns {void}
 */
export function setCurrentSyncClient(client) {
  currentClient = client
}

/**
 * Returns the current sync client.
 * @returns {ReturnType<typeof JSON.parse>} Current sync client.
 */
export function currentSyncClient() {
  if (!currentClient) throw new Error("No sync client configured - create a SyncClient and call setCurrent() on it first")

  return currentClient
}
