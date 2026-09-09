// @ts-check
import mysql from "mysql";
import QueryAbortedError from "../../query-aborted-error.js";
/**
 * Checks out one pool connection while honoring cancellation before checkout completes.
 * A connection returned after cancellation is released without running the query.
 * @param {import("mysql").Pool} pool - Pool to check out from.
 * @param {string} sql - SQL associated with the checkout.
 * @param {AbortSignal | undefined} signal - Optional cancellation signal.
 * @returns {Promise<import("mysql").PoolConnection>} - Checked-out connection.
 */
function checkoutConnection(pool, sql, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        /** @type {(() => void) | undefined} */
        let removeAbortListener;
        const settle = () => {
            settled = true;
            if (removeAbortListener)
                removeAbortListener();
        };
        const onAbort = () => {
            if (settled)
                return;
            settle();
            reject(new QueryAbortedError({ sql }));
        };
        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
            removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        }
        if (signal?.aborted) {
            onAbort();
            return;
        }
        pool.getConnection((error, connection) => {
            if (settled) {
                if (connection)
                    connection.release();
                return;
            }
            settle();
            if (error) {
                reject(error);
            }
            else {
                resolve(connection);
            }
        });
    });
}
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
 * @param {number | null | undefined} threadId - Server thread id of the query to kill.
 * @returns {Promise<void>} - Resolves once the kill has been attempted.
 */
function killServerQuery(pool, threadId) {
    return new Promise((resolve) => {
        const connectionConfig = /** @type {{config?: {connectionConfig?: unknown}}} */ (pool).config?.connectionConfig;
        if (!threadId || !connectionConfig) {
            resolve();
            return;
        }
        let killConnection;
        try {
            killConnection = mysql.createConnection(/** @type {ReturnType<typeof JSON.parse>} */ (connectionConfig));
        }
        catch {
            resolve();
            return;
        }
        killConnection.on("error", () => { });
        killConnection.query(`KILL QUERY ${Number(threadId)}`, () => {
            killConnection.destroy();
            resolve();
        });
    });
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
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the mapped rows.
 */
export default async function query(pool, sql, { signal } = {}) {
    if (signal?.aborted)
        throw new QueryAbortedError({ sql });
    const connection = await checkoutConnection(pool, sql, signal);
    return await new Promise((resolve, reject) => {
        let settled = false;
        /** @type {(() => void) | undefined} */
        let removeAbortListener;
        const settle = () => {
            settled = true;
            if (removeAbortListener)
                removeAbortListener();
        };
        const onAbort = () => {
            if (settled)
                return;
            settle();
            const threadId = connection.threadId;
            // Destroy — never release — so a connection still mid-statement is not
            // returned to the pool and the pool slot is freed even if the separate
            // server-side kill attempt stalls. The pool spawns a fresh connection on
            // the next checkout.
            connection.destroy();
            void killServerQuery(pool, threadId);
            reject(new QueryAbortedError({ connectionDestroyed: true, sql }));
        };
        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
            removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        }
        // An abort that landed between the checkout above and attaching the listener
        // would not fire the listener (the event already dispatched), so re-check and
        // abort synchronously to close that race before issuing the query.
        if (signal?.aborted) {
            onAbort();
            return;
        }
        connection.query(sql, (/** @type {ReturnType<typeof JSON.parse>} */ error, /** @type {ReturnType<typeof JSON.parse>} */ results, /** @type {ReturnType<typeof JSON.parse>} */ fields) => {
            if (settled)
                return;
            settle();
            if (error) {
                // A fatal error leaves the socket unusable, so discard it; an ordinary
                // query error keeps a healthy connection that can be reused.
                if (error.fatal) {
                    connection.destroy();
                }
                else {
                    connection.release();
                }
                reject(new Error(`Query failed because of ${error}: ${sql}`));
                return;
            }
            connection.release();
            resolve(mapRows(results, fields));
        });
    });
}
/**
 * Materializes the driver rows as isolated plain records keyed by field name.
 * @param {ReturnType<typeof JSON.parse>} results - Driver result rows.
 * @param {ReturnType<typeof JSON.parse>} fields - Driver result fields.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>[]} - Mapped rows.
 */
function mapRows(results, fields) {
    const rows = [];
    const resultRows = Array.isArray(results) ? results : [];
    const resultFields = Array.isArray(fields) ? fields : [];
    for (const rowData of resultRows) {
        /**
         * Result.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const result = {};
        for (const fieldData of resultFields) {
            const field = fieldData.name;
            const value = rowData[field];
            result[field] = value;
        }
        rows.push(result);
    }
    return rows;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9teXNxbC9xdWVyeS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFBO0FBQ3pCLE9BQU8saUJBQWlCLE1BQU0sOEJBQThCLENBQUE7QUFFNUQ7Ozs7Ozs7R0FPRztBQUNILFNBQVMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxNQUFNO0lBQzNDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDckMsSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFBO1FBQ25CLHVDQUF1QztRQUN2QyxJQUFJLG1CQUFtQixDQUFBO1FBRXZCLE1BQU0sTUFBTSxHQUFHLEdBQUcsRUFBRTtZQUNsQixPQUFPLEdBQUcsSUFBSSxDQUFBO1lBQ2QsSUFBSSxtQkFBbUI7Z0JBQUUsbUJBQW1CLEVBQUUsQ0FBQTtRQUNoRCxDQUFDLENBQUE7UUFFRCxNQUFNLE9BQU8sR0FBRyxHQUFHLEVBQUU7WUFDbkIsSUFBSSxPQUFPO2dCQUFFLE9BQU07WUFFbkIsTUFBTSxFQUFFLENBQUE7WUFDUixNQUFNLENBQUMsSUFBSSxpQkFBaUIsQ0FBQyxFQUFDLEdBQUcsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUN0QyxDQUFDLENBQUE7UUFFRCxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1gsTUFBTSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUN2RCxtQkFBbUIsR0FBRyxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQUMsbUJBQW1CLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzFFLENBQUM7UUFFRCxJQUFJLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztZ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QUNwQixPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFBO1FBQ25DLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLE9BQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTTtJQUM5QixNQUFNLElBQUksR0FBRyxFQUFFLENBQUE7SUFDZixNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUN4RCxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUV4RCxLQUFLLE1BQU0sT0FBTyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQ2pDOzttRUFFMkQ7UUFDM0QsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxTQUFTLElBQUksWUFBWSxFQUFFLENBQUM7WUFDckMsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLElBQUksQ0FBQTtZQUM1QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFNUIsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUN2QixDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNuQixDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBteXNxbCBmcm9tIFwibXlzcWxcIlxuaW1wb3J0IFF1ZXJ5QWJvcnRlZEVycm9yIGZyb20gXCIuLi8uLi9xdWVyeS1hYm9ydGVkLWVycm9yLmpzXCJcblxuLyoqXG4gKiBDaGVja3Mgb3V0IG9uZSBwb29sIGNvbm5lY3Rpb24gd2hpbGUgaG9ub3JpbmcgY2FuY2VsbGF0aW9uIGJlZm9yZSBjaGVja291dCBjb21wbGV0ZXMuXG4gKiBBIGNvbm5lY3Rpb24gcmV0dXJuZWQgYWZ0ZXIgY2FuY2VsbGF0aW9uIGlzIHJlbGVhc2VkIHdpdGhvdXQgcnVubmluZyB0aGUgcXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIm15c3FsXCIpLlBvb2x9IHBvb2wgLSBQb29sIHRvIGNoZWNrIG91dCBmcm9tLlxuICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBhc3NvY2lhdGVkIHdpdGggdGhlIGNoZWNrb3V0LlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2lnbmFsIC0gT3B0aW9uYWwgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIm15c3FsXCIpLlBvb2xDb25uZWN0aW9uPn0gLSBDaGVja2VkLW91dCBjb25uZWN0aW9uLlxuICovXG5mdW5jdGlvbiBjaGVja291dENvbm5lY3Rpb24ocG9vbCwgc3FsLCBzaWduYWwpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBsZXQgc2V0dGxlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlbW92ZUFib3J0TGlzdGVuZXJcblxuICAgIGNvbnN0IHNldHRsZSA9ICgpID0+IHtcbiAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICBpZiAocmVtb3ZlQWJvcnRMaXN0ZW5lcikgcmVtb3ZlQWJvcnRMaXN0ZW5lcigpXG4gICAgfVxuXG4gICAgY29uc3Qgb25BYm9ydCA9ICgpID0+IHtcbiAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgc2V0dGxlKClcbiAgICAgIHJlamVjdChuZXcgUXVlcnlBYm9ydGVkRXJyb3Ioe3NxbH0pKVxuICAgIH1cblxuICAgIGlmIChzaWduYWwpIHtcbiAgICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25BYm9ydCwge29uY2U6IHRydWV9KVxuICAgICAgcmVtb3ZlQWJvcnRMaXN0ZW5lciA9ICgpID0+IHNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25BYm9ydClcbiAgICB9XG5cbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSB7XG4gICAgICBvbkFib3J0KClcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgcG9vbC5nZXRDb25uZWN0aW9uKChlcnJvciwgY29ubmVjdGlvbikgPT4ge1xuICAgICAgaWYgKHNldHRsZWQpIHtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIGNvbm5lY3Rpb24ucmVsZWFzZSgpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHNldHRsZSgpXG5cbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNvbHZlKGNvbm5lY3Rpb24pXG4gICAgICB9XG4gICAgfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBCZXN0LWVmZm9ydCBgS0lMTCBRVUVSWWAgc28gdGhlIHNlcnZlciBhYm9ydHMgdGhlIHJ1bm5pbmcgc3RhdGVtZW50IOKAlCByZWxlYXNpbmdcbiAqIGl0cyBsb2Nrcy9yZXNvdXJjZXMgaW1tZWRpYXRlbHkg4oCUIGluc3RlYWQgb2YgZmluaXNoaW5nIGl0IGFmdGVyIHRoZSBjbGllbnRcbiAqIHNvY2tldCBpcyBkZXN0cm95ZWQuIERlc3Ryb3lpbmcgdGhlIHNvY2tldCBhbG9uZSBkb2VzIG5vdCBpbnRlcnJ1cHQgYVxuICogbm9uLWNvb3BlcmF0aXZlIHJ1bm5pbmcgc3RhdGVtZW50IChlLmcuIGBTTEVFUGAgb3IgYSBsb25nIHNjYW4pIHNlcnZlci1zaWRlLCBzb1xuICogdGhlIGRlYWRsaW5lIHdvdWxkIG90aGVyd2lzZSBvbmx5IHN1cHByZXNzIHRoZSBjbGllbnQgd2hpbGUgdGhlIHF1ZXJ5IGtlZXBzXG4gKiBob2xkaW5nIGRhdGFiYXNlIHJlc291cmNlcy4gUnVucyBvbiBhIHRocm93YXdheSBjb25uZWN0aW9uIGJlY2F1c2UgdGhlIGRyaXZlclxuICogcG9vbCBpcyBjYXBwZWQgYXQgb25lIGNvbm5lY3Rpb24gKHRoZSBvbmUgcnVubmluZyB0aGUgYWJvcnRlZCBxdWVyeSkuIEFueVxuICogZmFpbHVyZSBpcyBzd2FsbG93ZWQ6IHRoZSBjYWxsZXIgc3RpbGwgZGVzdHJveXMgdGhlIHNvY2tldCBhbmQgcmVqZWN0cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwibXlzcWxcIikuUG9vbH0gcG9vbCAtIFBvb2wgd2hvc2UgY29ubmVjdGlvbiBjb25maWcgc2VlZHMgdGhlIGtpbGwgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gdGhyZWFkSWQgLSBTZXJ2ZXIgdGhyZWFkIGlkIG9mIHRoZSBxdWVyeSB0byBraWxsLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSB0aGUga2lsbCBoYXMgYmVlbiBhdHRlbXB0ZWQuXG4gKi9cbmZ1bmN0aW9uIGtpbGxTZXJ2ZXJRdWVyeShwb29sLCB0aHJlYWRJZCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCBjb25uZWN0aW9uQ29uZmlnID0gLyoqIEB0eXBlIHt7Y29uZmlnPzoge2Nvbm5lY3Rpb25Db25maWc/OiB1bmtub3dufX19ICovIChwb29sKS5jb25maWc/LmNvbm5lY3Rpb25Db25maWdcblxuICAgIGlmICghdGhyZWFkSWQgfHwgIWNvbm5lY3Rpb25Db25maWcpIHtcbiAgICAgIHJlc29sdmUoKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBsZXQga2lsbENvbm5lY3Rpb25cblxuICAgIHRyeSB7XG4gICAgICBraWxsQ29ubmVjdGlvbiA9IG15c3FsLmNyZWF0ZUNvbm5lY3Rpb24oLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGNvbm5lY3Rpb25Db25maWcpKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmVzb2x2ZSgpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGtpbGxDb25uZWN0aW9uLm9uKFwiZXJyb3JcIiwgKCkgPT4ge30pXG4gICAga2lsbENvbm5lY3Rpb24ucXVlcnkoYEtJTEwgUVVFUlkgJHtOdW1iZXIodGhyZWFkSWQpfWAsICgpID0+IHtcbiAgICAgIGtpbGxDb25uZWN0aW9uLmRlc3Ryb3koKVxuICAgICAgcmVzb2x2ZSgpXG4gICAgfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGBzcWxgIG9uIGEgZGVkaWNhdGVkIGNvbm5lY3Rpb24gY2hlY2tlZCBvdXQgb2YgYHBvb2xgIHNvIGl0IGNhbiBiZVxuICogYWJvcnRlZCB3aGlsZSBpdCBpcyBzdGlsbCBleGVjdXRpbmcuIFdoZW4gYHNpZ25hbGAgZmlyZXMgYmVmb3JlIHRoZSBxdWVyeVxuICogc2V0dGxlcyB0aGUgY29ubmVjdGlvbiBpcyBkZXN0cm95ZWQg4oCUIHdoaWNoIGFib3J0cyB0aGUgcnVubmluZyBzdGF0ZW1lbnQgYXRcbiAqIHRoZSBzb2NrZXQgYW5kIHJlbW92ZXMgdGhlIGNvbm5lY3Rpb24gZnJvbSB0aGUgcG9vbCBzbyBpdCBpcyBuZXZlciBoYW5kZWQgYmFja1xuICogbWlkLXN0YXRlbWVudCDigJQgYW5kIHRoZSBwcm9taXNlIHJlamVjdHMgd2l0aCBhIHtAbGluayBRdWVyeUFib3J0ZWRFcnJvcn0uIE9uXG4gKiBzdWNjZXNzIHRoZSBjb25uZWN0aW9uIGlzIHJlbGVhc2VkIGJhY2sgdG8gdGhlIHBvb2wuIE9uIGEgZmF0YWwgY29ubmVjdGlvblxuICogZXJyb3IgaXQgaXMgZGVzdHJveWVkOyBvbiBhbiBvcmRpbmFyeSBxdWVyeSBlcnJvciAoc3ludGF4LCBjb25zdHJhaW50LCBldGMuKVxuICogaXQgaXMgcmVsZWFzZWQsIGJlY2F1c2UgdGhlIGNvbm5lY3Rpb24gaXRzZWxmIGlzIHN0aWxsIGhlYWx0aHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIm15c3FsXCIpLlBvb2x9IHBvb2wgLSBQb29sLlxuICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gKiBAcGFyYW0ge3tzaWduYWw/OiBBYm9ydFNpZ25hbH19IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbWFwcGVkIHJvd3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIHF1ZXJ5KHBvb2wsIHNxbCwge3NpZ25hbH0gPSB7fSkge1xuICBpZiAoc2lnbmFsPy5hYm9ydGVkKSB0aHJvdyBuZXcgUXVlcnlBYm9ydGVkRXJyb3Ioe3NxbH0pXG5cbiAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IGNoZWNrb3V0Q29ubmVjdGlvbihwb29sLCBzcWwsIHNpZ25hbClcblxuICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGxldCBzZXR0bGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcmVtb3ZlQWJvcnRMaXN0ZW5lclxuXG4gICAgY29uc3Qgc2V0dGxlID0gKCkgPT4ge1xuICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgIGlmIChyZW1vdmVBYm9ydExpc3RlbmVyKSByZW1vdmVBYm9ydExpc3RlbmVyKClcbiAgICB9XG5cbiAgICBjb25zdCBvbkFib3J0ID0gKCkgPT4ge1xuICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuXG4gICAgICBzZXR0bGUoKVxuICAgICAgY29uc3QgdGhyZWFkSWQgPSBjb25uZWN0aW9uLnRocmVhZElkXG5cbiAgICAgIC8vIERlc3Ryb3kg4oCUIG5ldmVyIHJlbGVhc2Ug4oCUIHNvIGEgY29ubmVjdGlvbiBzdGlsbCBtaWQtc3RhdGVtZW50IGlzIG5vdFxuICAgICAgLy8gcmV0dXJuZWQgdG8gdGhlIHBvb2wgYW5kIHRoZSBwb29sIHNsb3QgaXMgZnJlZWQgZXZlbiBpZiB0aGUgc2VwYXJhdGVcbiAgICAgIC8vIHNlcnZlci1zaWRlIGtpbGwgYXR0ZW1wdCBzdGFsbHMuIFRoZSBwb29sIHNwYXducyBhIGZyZXNoIGNvbm5lY3Rpb24gb25cbiAgICAgIC8vIHRoZSBuZXh0IGNoZWNrb3V0LlxuICAgICAgY29ubmVjdGlvbi5kZXN0cm95KClcbiAgICAgIHZvaWQga2lsbFNlcnZlclF1ZXJ5KHBvb2wsIHRocmVhZElkKVxuICAgICAgcmVqZWN0KG5ldyBRdWVyeUFib3J0ZWRFcnJvcih7Y29ubmVjdGlvbkRlc3Ryb3llZDogdHJ1ZSwgc3FsfSkpXG4gICAgfVxuXG4gICAgaWYgKHNpZ25hbCkge1xuICAgICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvbkFib3J0LCB7b25jZTogdHJ1ZX0pXG4gICAgICByZW1vdmVBYm9ydExpc3RlbmVyID0gKCkgPT4gc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvbkFib3J0KVxuICAgIH1cblxuICAgIC8vIEFuIGFib3J0IHRoYXQgbGFuZGVkIGJldHdlZW4gdGhlIGNoZWNrb3V0IGFib3ZlIGFuZCBhdHRhY2hpbmcgdGhlIGxpc3RlbmVyXG4gICAgLy8gd291bGQgbm90IGZpcmUgdGhlIGxpc3RlbmVyICh0aGUgZXZlbnQgYWxyZWFkeSBkaXNwYXRjaGVkKSwgc28gcmUtY2hlY2sgYW5kXG4gICAgLy8gYWJvcnQgc3luY2hyb25vdXNseSB0byBjbG9zZSB0aGF0IHJhY2UgYmVmb3JlIGlzc3VpbmcgdGhlIHF1ZXJ5LlxuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHtcbiAgICAgIG9uQWJvcnQoKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGVycm9yLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyByZXN1bHRzLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmaWVsZHMpID0+IHtcbiAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cblxuICAgICAgc2V0dGxlKClcblxuICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgIC8vIEEgZmF0YWwgZXJyb3IgbGVhdmVzIHRoZSBzb2NrZXQgdW51c2FibGUsIHNvIGRpc2NhcmQgaXQ7IGFuIG9yZGluYXJ5XG4gICAgICAgIC8vIHF1ZXJ5IGVycm9yIGtlZXBzIGEgaGVhbHRoeSBjb25uZWN0aW9uIHRoYXQgY2FuIGJlIHJldXNlZC5cbiAgICAgICAgaWYgKGVycm9yLmZhdGFsKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5kZXN0cm95KClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25uZWN0aW9uLnJlbGVhc2UoKVxuICAgICAgICB9XG5cbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkIGJlY2F1c2Ugb2YgJHtlcnJvcn06ICR7c3FsfWApKVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25uZWN0aW9uLnJlbGVhc2UoKVxuICAgICAgcmVzb2x2ZShtYXBSb3dzKHJlc3VsdHMsIGZpZWxkcykpXG4gICAgfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBNYXRlcmlhbGl6ZXMgdGhlIGRyaXZlciByb3dzIGFzIGlzb2xhdGVkIHBsYWluIHJlY29yZHMga2V5ZWQgYnkgZmllbGQgbmFtZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc3VsdHMgLSBEcml2ZXIgcmVzdWx0IHJvd3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBmaWVsZHMgLSBEcml2ZXIgcmVzdWx0IGZpZWxkcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXX0gLSBNYXBwZWQgcm93cy5cbiAqL1xuZnVuY3Rpb24gbWFwUm93cyhyZXN1bHRzLCBmaWVsZHMpIHtcbiAgY29uc3Qgcm93cyA9IFtdXG4gIGNvbnN0IHJlc3VsdFJvd3MgPSBBcnJheS5pc0FycmF5KHJlc3VsdHMpID8gcmVzdWx0cyA6IFtdXG4gIGNvbnN0IHJlc3VsdEZpZWxkcyA9IEFycmF5LmlzQXJyYXkoZmllbGRzKSA/IGZpZWxkcyA6IFtdXG5cbiAgZm9yIChjb25zdCByb3dEYXRhIG9mIHJlc3VsdFJvd3MpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBmaWVsZERhdGEgb2YgcmVzdWx0RmllbGRzKSB7XG4gICAgICBjb25zdCBmaWVsZCA9IGZpZWxkRGF0YS5uYW1lXG4gICAgICBjb25zdCB2YWx1ZSA9IHJvd0RhdGFbZmllbGRdXG5cbiAgICAgIHJlc3VsdFtmaWVsZF0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJvd3MucHVzaChyZXN1bHQpXG4gIH1cblxuICByZXR1cm4gcm93c1xufVxuIl19