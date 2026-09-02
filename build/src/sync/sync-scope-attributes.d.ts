/**
 * Reads and validates a sync/change model's declared scope-partition
 * attributes (`static syncScopeAttributes`).
 *
 * The declaration names the attribute(s) partitioning the app's sync feed —
 * the same attribute names client pull scopes use as conditions (for example
 * `["eventId"]` or `["accountId"]`). The publisher persists them onto every
 * published sync row and broadcasts them as the framework sync channel's
 * scoping params, and the change feed serializes them onto every changes row
 * under their own names. Velocious itself has no built-in partition name.
 * @param {ReturnType<typeof JSON.parse>} syncModel - Sync/change model class.
 * @returns {string[] | null} Declared scope attributes, or null when the model declares none.
 */
export declare function declaredSyncScopeAttributes(syncModel: ReturnType<typeof JSON.parse>): string[] | null;
//# sourceMappingURL=sync-scope-attributes.d.ts.map