/**
 * Streams the rows of `sql` from a dedicated pooled connection, yielding row objects one at a
 * time so an arbitrarily large result set is never buffered in memory. The `mysql` package's
 * query stream is a `readable-stream` polyfill that is not async-iterable, so it is piped through
 * a native {@link PassThrough} (which is) — `pipe` preserves backpressure, pausing the source
 * connection when the consumer falls behind. The connection is released back to the pool on
 * normal completion, and destroyed if iteration is aborted (a `break`/`throw` out of the
 * consuming `for await`) so a half-drained connection is never handed back to the pool.
 * @param {import("mysql").Pool} pool - Pool to check a streaming connection out of.
 * @param {string} sql - SQL string to stream.
 * @yields {Record<string, unknown>} - The result rows, one at a time.
 */
export default function streamQuery(pool: import("mysql").Pool, sql: string): AsyncGenerator<any, void, unknown>;
//# sourceMappingURL=query-stream.d.ts.map