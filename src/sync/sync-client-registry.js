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

/**
 * Returns the current sync client when one is registered.
 *
 * Background jobs that replay the sync queue can legitimately run before an app has
 * registered its client, or after it cleared it on sign-out. They need a non-throwing
 * lookup so that state is a no-op instead of a failed job.
 * @returns {ReturnType<typeof JSON.parse> | null} Current sync client, or null.
 */
export function currentSyncClientOrNull() {
  return currentClient
}
