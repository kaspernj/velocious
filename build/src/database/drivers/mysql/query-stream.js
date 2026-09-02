import { PassThrough } from "node:stream";
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
            if (error)
                reject(error);
            else
                resolve(pooledConnection);
        });
    });
    let completed = false;
    try {
        const sourceStream = connection.query(sql).stream();
        const rowStream = new PassThrough({ objectMode: true });
        sourceStream.on("error", (/** @type {unknown} */ error) => rowStream.destroy(error instanceof Error ? error : new Error(String(error))));
        sourceStream.pipe(rowStream);
        for await (const row of rowStream) {
            yield row;
        }
        completed = true;
    }
    finally {
        if (completed) {
            connection.release();
        }
        else {
            connection.destroy();
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktc3RyZWFtLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvbXlzcWwvcXVlcnktc3RyZWFtLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFdkM7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssU0FBUyxDQUFDLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxHQUFHO0lBQ2xELE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDdkQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLEtBQUssRUFBRSxnQkFBZ0IsRUFBRSxFQUFFO1lBQzdDLElBQUksS0FBSztnQkFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7O2dCQUNuQixPQUFPLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUNoQyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUMsQ0FBQyxDQUFBO0lBQ0YsSUFBSSxTQUFTLEdBQUcsS0FBSyxDQUFBO0lBRXJCLElBQUksQ0FBQztRQUNILE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUE7UUFDbkQsTUFBTSxTQUFTLEdBQUcsSUFBSSxXQUFXLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUVyRCxZQUFZLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLHNCQUFzQixDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUN4SSxZQUFZLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRTVCLElBQUksS0FBSyxFQUFFLE1BQU0sR0FBRyxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ2xDLE1BQU0sR0FBRyxDQUFBO1FBQ1gsQ0FBQztRQUVELFNBQVMsR0FBRyxJQUFJLENBQUE7SUFDbEIsQ0FBQztZQUFTLENBQUM7UUFDVCxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ2QsVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ3RCLENBQUM7YUFBTSxDQUFDO1lBQ04sVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ3RCLENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7UGFzc1Rocm91Z2h9IGZyb20gXCJub2RlOnN0cmVhbVwiXG5cbi8qKlxuICogU3RyZWFtcyB0aGUgcm93cyBvZiBgc3FsYCBmcm9tIGEgZGVkaWNhdGVkIHBvb2xlZCBjb25uZWN0aW9uLCB5aWVsZGluZyByb3cgb2JqZWN0cyBvbmUgYXQgYVxuICogdGltZSBzbyBhbiBhcmJpdHJhcmlseSBsYXJnZSByZXN1bHQgc2V0IGlzIG5ldmVyIGJ1ZmZlcmVkIGluIG1lbW9yeS4gVGhlIGBteXNxbGAgcGFja2FnZSdzXG4gKiBxdWVyeSBzdHJlYW0gaXMgYSBgcmVhZGFibGUtc3RyZWFtYCBwb2x5ZmlsbCB0aGF0IGlzIG5vdCBhc3luYy1pdGVyYWJsZSwgc28gaXQgaXMgcGlwZWQgdGhyb3VnaFxuICogYSBuYXRpdmUge0BsaW5rIFBhc3NUaHJvdWdofSAod2hpY2ggaXMpIOKAlCBgcGlwZWAgcHJlc2VydmVzIGJhY2twcmVzc3VyZSwgcGF1c2luZyB0aGUgc291cmNlXG4gKiBjb25uZWN0aW9uIHdoZW4gdGhlIGNvbnN1bWVyIGZhbGxzIGJlaGluZC4gVGhlIGNvbm5lY3Rpb24gaXMgcmVsZWFzZWQgYmFjayB0byB0aGUgcG9vbCBvblxuICogbm9ybWFsIGNvbXBsZXRpb24sIGFuZCBkZXN0cm95ZWQgaWYgaXRlcmF0aW9uIGlzIGFib3J0ZWQgKGEgYGJyZWFrYC9gdGhyb3dgIG91dCBvZiB0aGVcbiAqIGNvbnN1bWluZyBgZm9yIGF3YWl0YCkgc28gYSBoYWxmLWRyYWluZWQgY29ubmVjdGlvbiBpcyBuZXZlciBoYW5kZWQgYmFjayB0byB0aGUgcG9vbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwibXlzcWxcIikuUG9vbH0gcG9vbCAtIFBvb2wgdG8gY2hlY2sgYSBzdHJlYW1pbmcgY29ubmVjdGlvbiBvdXQgb2YuXG4gKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZyB0byBzdHJlYW0uXG4gKiBAeWllbGRzIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gLSBUaGUgcmVzdWx0IHJvd3MsIG9uZSBhdCBhIHRpbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uKiBzdHJlYW1RdWVyeShwb29sLCBzcWwpIHtcbiAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBwb29sLmdldENvbm5lY3Rpb24oKGVycm9yLCBwb29sZWRDb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvcilcbiAgICAgIGVsc2UgcmVzb2x2ZShwb29sZWRDb25uZWN0aW9uKVxuICAgIH0pXG4gIH0pXG4gIGxldCBjb21wbGV0ZWQgPSBmYWxzZVxuXG4gIHRyeSB7XG4gICAgY29uc3Qgc291cmNlU3RyZWFtID0gY29ubmVjdGlvbi5xdWVyeShzcWwpLnN0cmVhbSgpXG4gICAgY29uc3Qgcm93U3RyZWFtID0gbmV3IFBhc3NUaHJvdWdoKHtvYmplY3RNb2RlOiB0cnVlfSlcblxuICAgIHNvdXJjZVN0cmVhbS5vbihcImVycm9yXCIsICgvKiogQHR5cGUge3Vua25vd259ICovIGVycm9yKSA9PiByb3dTdHJlYW0uZGVzdHJveShlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpKVxuICAgIHNvdXJjZVN0cmVhbS5waXBlKHJvd1N0cmVhbSlcblxuICAgIGZvciBhd2FpdCAoY29uc3Qgcm93IG9mIHJvd1N0cmVhbSkge1xuICAgICAgeWllbGQgcm93XG4gICAgfVxuXG4gICAgY29tcGxldGVkID0gdHJ1ZVxuICB9IGZpbmFsbHkge1xuICAgIGlmIChjb21wbGV0ZWQpIHtcbiAgICAgIGNvbm5lY3Rpb24ucmVsZWFzZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbm5lY3Rpb24uZGVzdHJveSgpXG4gICAgfVxuICB9XG59XG4iXX0=