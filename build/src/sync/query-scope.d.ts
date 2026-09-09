/**
 * Serializes a model query into a transportable sync scope.
 *
 * Only plain attribute equality conditions are supported: the scope must be
 * expressible as `{resourceType, conditions}` so servers can match it against
 * their change feeds. Anything else (raw SQL, negations, joins, orders,
 * limits, offsets, groups) fails loudly.
 * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Model query declaring the sync scope.
 * @returns {import("./sync-client-types.js").SerializedSyncScope} Serialized sync scope.
 */
export declare function serializedScopeFromQuery(query: import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>): import("./sync-client-types.js").SerializedSyncScope;
/**
 * Returns a stable canonical key identifying a sync scope. When an `owner` is
 * present (the authenticated identity that declared the scope locally), it
 * participates in the key so the same wire scope owned by a different user gets
 * its own local identity and cursor — a user scope's empty-conditions cursor
 * never leaks across accounts on a shared device, while the same user
 * reconnecting keeps continuity. Owner-less scopes keep their pre-owner key.
 *
 * A null `resourceType` is the all-types scope (the user scope): one scope
 * covering every resource type the server authorizes for the caller, rather
 * than one scope per type. It keys as an empty resource type, so it never
 * collides with a type-declared scope.
 * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
 * @returns {string} Stable scope key.
 */
export declare function scopeKey(scope: import("./sync-client-types.js").SerializedSyncScope): string;
//# sourceMappingURL=query-scope.d.ts.map