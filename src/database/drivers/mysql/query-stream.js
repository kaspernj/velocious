/**
 * Streams the rows of `sql` from a dedicated pooled connection, yielding row objects one at a
 * time so an arbitrarily large result set is never buffered in memory. The connection is held
 * for the life of the stream: it is released back to the pool on normal completion, and
 * destroyed if iteration is aborted (a `break`/`throw` out of the consuming `for await`) so a
 * half-drained connection is never handed back to the pool.
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
    for await (const row of connection.query(sql).stream()) {
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
