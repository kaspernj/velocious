/**
 * Runs `sql` on a dedicated connection checked out of `pool` so it can be
 * aborted while it is still executing. When `signal` fires before the query
 * settles the connection is destroyed — which aborts the running statement at
 * the socket and removes the connection from the pool so it is never handed back
 * mid-statement — and the promise rejects with a {@link QueryAbortedError}. On
 * success the connection is released back to the pool. On a fatal connection
 * error it is destroyed; on an ordinary query error (syntax, constraint, etc.)
 * it is released, because the connection itself is still healthy.
 * @param {import("mysql").Pool} pool - Pool.
 * @param {string} sql - SQL string.
 * @param {{signal?: AbortSignal}} [options] - Query options.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the mapped rows.
 */
export default function query(pool: import("mysql").Pool, sql: string, { signal }?: {
    signal?: AbortSignal;
}): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
//# sourceMappingURL=query.d.ts.map