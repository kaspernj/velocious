// @ts-check

import mysql from "mysql"
import QueryAbortedError from "../../query-aborted-error.js"

/**
 * Best-effort `KILL QUERY` so the server aborts the running statement — releasing
 * its locks/resources immediately — instead of finishing it after the client
 * socket is destroyed. Destroying the socket alone does not interrupt a
 * non-cooperative running statement (e.g. `SLEEP` or a long scan) server-side, so
 * the deadline would otherwise only suppress the client while the query keeps
 * holding database resources. Runs on a throwaway connection because the driver
 * pool is capped at one connection (the one running the aborted query). Any
 * failure is swallowed: the caller still destroys the socket and rejects.
 * @param {import("mysql").Pool} pool - Pool whose connection config seeds the kill connection.
 * @param {number | undefined} threadId - Server thread id of the query to kill.
 * @returns {Promise<void>} - Resolves once the kill has been attempted.
 */
function killServerQuery(pool, threadId) {
  return new Promise((resolve) => {
    const connectionConfig = /** @type {{config?: {connectionConfig?: unknown}}} */ (pool).config?.connectionConfig

    if (!threadId || !connectionConfig) {
      resolve()

      return
    }

    let killConnection

    try {
      killConnection = mysql.createConnection(/** @type {?} */ (connectionConfig))
    } catch {
      resolve()

      return
    }

    killConnection.on("error", () => {})
    killConnection.query(`KILL QUERY ${Number(threadId)}`, () => {
      killConnection.destroy()
      resolve()
    })
  })
}

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
 * @returns {Promise<Record<string, ?>[]>} - Resolves with the mapped rows.
 */
export default async function query(pool, sql, {signal} = {}) {
  if (signal?.aborted) throw new QueryAbortedError({sql})

  const connection = await new Promise((resolve, reject) => {
    pool.getConnection((error, pooledConnection) => {
      if (error) reject(error)
      else resolve(pooledConnection)
    })
  })

  return await new Promise((resolve, reject) => {
    let settled = false
    /** @type {(() => void) | undefined} */
    let removeAbortListener

    const settle = () => {
      settled = true
      if (removeAbortListener) removeAbortListener()
    }

    const onAbort = () => {
      if (settled) return

      settle()
      // Force the server to abort the running statement (releasing its
      // locks/resources now, not when it finishes), then destroy the client
      // socket. Destroy — never release — so a connection still mid-statement is
      // not returned to the pool; the pool spawns a fresh one on the next
      // checkout. The kill runs in the background so the caller rejects promptly.
      void killServerQuery(pool, connection.threadId).finally(() => connection.destroy())
      reject(new QueryAbortedError({sql}))
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, {once: true})
      removeAbortListener = () => signal.removeEventListener("abort", onAbort)
    }

    // An abort that landed between the checkout above and attaching the listener
    // would not fire the listener (the event already dispatched), so re-check and
    // abort synchronously to close that race before issuing the query.
    if (signal?.aborted) {
      onAbort()

      return
    }

    connection.query(sql, (/** @type {?} */ error, /** @type {?} */ results, /** @type {?} */ fields) => {
      if (settled) return

      settle()

      if (error) {
        // A fatal error leaves the socket unusable, so discard it; an ordinary
        // query error keeps a healthy connection that can be reused.
        if (error.fatal) {
          connection.destroy()
        } else {
          connection.release()
        }

        reject(new Error(`Query failed because of ${error}: ${sql}`))

        return
      }

      connection.release()
      resolve(mapRows(results, fields))
    })
  })
}

/**
 * Materializes the driver rows as isolated plain records keyed by field name.
 * @param {?} results - Driver result rows.
 * @param {?} fields - Driver result fields.
 * @returns {Record<string, ?>[]} - Mapped rows.
 */
function mapRows(results, fields) {
  const rows = []
  const resultRows = Array.isArray(results) ? results : []
  const resultFields = Array.isArray(fields) ? fields : []

  for (const rowData of resultRows) {
    /**
     * Result.
     * @type {Record<string, ?>} */
    const result = {}

    for (const fieldData of resultFields) {
      const field = fieldData.name
      const value = rowData[field]

      result[field] = value
    }

    rows.push(result)
  }

  return rows
}
