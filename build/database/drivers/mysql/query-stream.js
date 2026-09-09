import {PassThrough} from "node:stream"

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
export default async function* streamQuery(pool, sql) {
  const connection = await new Promise((resolve, reject) => {
    pool.getConnection((error, pooledConnection) => {
      if (error) reject(error)
      else resolve(pooledConnection)
    })
  })
  let completed = false

  try {
    const sourceStream = connection.query(sql).stream()
    const rowStream = new PassThrough({objectMode: true})

    sourceStream.on("error", (/** @type {unknown} */ error) => rowStream.destroy(error instanceof Error ? error : new Error(String(error))))
    sourceStream.pipe(rowStream)

    for await (const row of rowStream) {
      yield row
    }

    completed = true
  } finally {
    if (completed) {
      connection.release()
    } else {
      connection.destroy()
    }
  }
}
