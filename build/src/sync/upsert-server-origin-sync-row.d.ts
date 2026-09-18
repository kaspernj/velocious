/**
 * Atomically reconciles and upserts one server-origin sync row by its complete,
 * null-safe logical identity. The identity contains the null actor, resource
 * type/id, and every scope column declared by the sync model. A stable portable
 * advisory lock serializes runtime publication and maintenance/backfill calls;
 * legacy duplicates converge to the newest server sequence, then the lowest
 * immutable id, before the survivor is updated and re-sequenced.
 *
 * The lock is acquired through the static sync model on a dedicated connection.
 * `persistenceModel` may be an operation-bound model facade so reads/writes keep
 * their owning operation while sharing the same identity lock as ordinary
 * publisher calls.
 * @param {object} args - Persistence arguments.
 * @param {string} [args.actorForeignKeyColumn] - Persisted actor foreign-key column.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Complete sync-row mutation attributes.
 * @param {ReturnType<typeof JSON.parse>} [args.persistenceModel] - Optional operation-bound model used for row reads/writes.
 * @param {string[]} [args.scopeColumnNames] - Additional persisted scope columns used by deprecated publisher declarations.
 * @param {ReturnType<typeof JSON.parse>} args.syncModel - Static sync model owning scope metadata and the advisory lock.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} Created or reconciled sync row.
 */
export declare function upsertServerOriginSyncRow({ actorForeignKeyColumn, attributes, persistenceModel, scopeColumnNames, syncModel, ...restArgs }: {
    actorForeignKeyColumn?: string;
    attributes: Record<string, ReturnType<typeof JSON.parse>>;
    persistenceModel?: ReturnType<typeof JSON.parse>;
    scopeColumnNames?: string[];
    syncModel: ReturnType<typeof JSON.parse>;
}): Promise<ReturnType<typeof JSON.parse>>;
//# sourceMappingURL=upsert-server-origin-sync-row.d.ts.map