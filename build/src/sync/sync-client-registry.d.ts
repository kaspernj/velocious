/**
 * Registers the current sync client.
 * @param {ReturnType<typeof JSON.parse>} client - Configured sync client (or null to clear).
 * @returns {void}
 */
export declare function setCurrentSyncClient(client: ReturnType<typeof JSON.parse>): void;
/**
 * Returns the current sync client.
 * @returns {ReturnType<typeof JSON.parse>} Current sync client.
 */
export declare function currentSyncClient(): ReturnType<typeof JSON.parse>;
/**
 * Returns the current sync client when one is registered.
 *
 * Background jobs that replay the sync queue can legitimately run before an app has
 * registered its client, or after it cleared it on sign-out. They need a non-throwing
 * lookup so that state is a no-op instead of a failed job.
 * @returns {ReturnType<typeof JSON.parse> | null} Current sync client, or null.
 */
export declare function currentSyncClientOrNull(): ReturnType<typeof JSON.parse> | null;
//# sourceMappingURL=sync-client-registry.d.ts.map