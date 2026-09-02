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
//# sourceMappingURL=sync-client-registry.d.ts.map