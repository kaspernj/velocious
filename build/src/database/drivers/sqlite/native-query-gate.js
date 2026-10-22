// @ts-check
import Mutex from "epic-locks/build/mutex.js";
/**
 * @typedef {object} NativeSqliteConnection
 * @property {(sql: string) => Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} getAllAsync - Reads rows.
 * @property {(sql: string) => Promise<{changes: number}>} runAsync - Runs a mutation.
 * @property {(sql: string) => Promise<void>} execAsync - Executes a SQL script.
 * @property {() => Promise<void>} closeAsync - Closes the native connection.
 */
/** @type {Map<string, Mutex>} */
const mutexesByDatabaseName = new Map();
/**
 * Returns the process-wide native query gate for one SQLite database name.
 * expo-sqlite caches native databases by name, so a gate scoped to a driver
 * instance is not enough: two drivers on the same database can still release
 * each other's shared `NativeStatement` objects.
 * @param {string} databaseName - SQLite database name.
 * @returns {Mutex} Mutex serializing native calls for that database.
 */
export function nativeDatabaseMutex(databaseName) {
    let mutex = mutexesByDatabaseName.get(databaseName);
    if (!mutex) {
        mutex = new Mutex();
        mutexesByDatabaseName.set(databaseName, mutex);
    }
    return mutex;
}
/**
 * Whether an expo-sqlite error means the native database/statement was released.
 * @param {unknown} error - Thrown error.
 * @returns {boolean} Whether the error is the native-handle lifetime failure.
 */
export function isNativeHandleError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const causeMessage = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    const text = `${message} ${causeMessage}`;
    return /NativeStatement\.runAsync|NativeDatabase\.prepareAsync/.test(text) && /NullPointerException|already released/.test(text);
}
/**
 * Runs one native operation under the per-database gate, reopening once when
 * expo-sqlite reports the shared native handle was released.
 * @template T
 * @param {object} args - Operation args.
 * @param {string} args.databaseName - SQLite database name.
 * @param {() => NativeSqliteConnection | undefined} args.getConnection - Current connection getter.
 * @param {() => Promise<NativeSqliteConnection>} args.reopenConnection - Opens a fresh native connection.
 * @param {(connection: NativeSqliteConnection) => Promise<T>} args.operation - Operation to run.
 * @returns {Promise<T>} Operation result.
 */
export async function runNativeOperation({ databaseName, getConnection, reopenConnection, operation }) {
    return await nativeDatabaseMutex(databaseName).sync(async () => {
        const connection = getConnection();
        if (!connection)
            throw new Error("Not connected yet");
        try {
            return await operation(connection);
        }
        catch (error) {
            if (!isNativeHandleError(error))
                throw error;
            return await operation(await reopenConnection());
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmF0aXZlLXF1ZXJ5LWdhdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvbmF0aXZlLXF1ZXJ5LWdhdGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBRTdDOzs7Ozs7R0FNRztBQUVILGlDQUFpQztBQUNqQyxNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFdkM7Ozs7Ozs7R0FPRztBQUNILE1BQU0sVUFBVSxtQkFBbUIsQ0FBQyxZQUFZO0lBQzlDLElBQUksS0FBSyxHQUFHLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQTtJQUVuRCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDWCxLQUFLLEdBQUcsSUFBSSxLQUFLLEVBQUUsQ0FBQTtRQUNuQixxQkFBcUIsQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQ2hELENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLG1CQUFtQixDQUFDLEtBQUs7SUFDdkMsTUFBTSxPQUFPLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3RFLE1BQU0sWUFBWSxHQUFHLEtBQUssWUFBWSxLQUFLLElBQUksS0FBSyxDQUFDLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7SUFDdEcsTUFBTSxJQUFJLEdBQUcsR0FBRyxPQUFPLElBQUksWUFBWSxFQUFFLENBQUE7SUFFekMsT0FBTyx3REFBd0QsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksdUNBQXVDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ2xJLENBQUM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxFQUFDLFlBQVksRUFBRSxhQUFhLEVBQUUsZ0JBQWdCLEVBQUUsU0FBUyxFQUFDO0lBQ2pHLE9BQU8sTUFBTSxtQkFBbUIsQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDN0QsTUFBTSxVQUFVLEdBQUcsYUFBYSxFQUFFLENBQUE7UUFFbEMsSUFBSSxDQUFDLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFFckQsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNwQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUM7Z0JBQUUsTUFBTSxLQUFLLENBQUE7WUFFNUMsT0FBTyxNQUFNLFNBQVMsQ0FBQyxNQUFNLGdCQUFnQixFQUFFLENBQUMsQ0FBQTtRQUNsRCxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBNdXRleCBmcm9tIFwiZXBpYy1sb2Nrcy9idWlsZC9tdXRleC5qc1wiXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTmF0aXZlU3FsaXRlQ29ubmVjdGlvblxuICogQHByb3BlcnR5IHsoc3FsOiBzdHJpbmcpID0+IFByb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IGdldEFsbEFzeW5jIC0gUmVhZHMgcm93cy5cbiAqIEBwcm9wZXJ0eSB7KHNxbDogc3RyaW5nKSA9PiBQcm9taXNlPHtjaGFuZ2VzOiBudW1iZXJ9Pn0gcnVuQXN5bmMgLSBSdW5zIGEgbXV0YXRpb24uXG4gKiBAcHJvcGVydHkgeyhzcWw6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPn0gZXhlY0FzeW5jIC0gRXhlY3V0ZXMgYSBTUUwgc2NyaXB0LlxuICogQHByb3BlcnR5IHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjbG9zZUFzeW5jIC0gQ2xvc2VzIHRoZSBuYXRpdmUgY29ubmVjdGlvbi5cbiAqL1xuXG4vKiogQHR5cGUge01hcDxzdHJpbmcsIE11dGV4Pn0gKi9cbmNvbnN0IG11dGV4ZXNCeURhdGFiYXNlTmFtZSA9IG5ldyBNYXAoKVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHByb2Nlc3Mtd2lkZSBuYXRpdmUgcXVlcnkgZ2F0ZSBmb3Igb25lIFNRTGl0ZSBkYXRhYmFzZSBuYW1lLlxuICogZXhwby1zcWxpdGUgY2FjaGVzIG5hdGl2ZSBkYXRhYmFzZXMgYnkgbmFtZSwgc28gYSBnYXRlIHNjb3BlZCB0byBhIGRyaXZlclxuICogaW5zdGFuY2UgaXMgbm90IGVub3VnaDogdHdvIGRyaXZlcnMgb24gdGhlIHNhbWUgZGF0YWJhc2UgY2FuIHN0aWxsIHJlbGVhc2VcbiAqIGVhY2ggb3RoZXIncyBzaGFyZWQgYE5hdGl2ZVN0YXRlbWVudGAgb2JqZWN0cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBTUUxpdGUgZGF0YWJhc2UgbmFtZS5cbiAqIEByZXR1cm5zIHtNdXRleH0gTXV0ZXggc2VyaWFsaXppbmcgbmF0aXZlIGNhbGxzIGZvciB0aGF0IGRhdGFiYXNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmF0aXZlRGF0YWJhc2VNdXRleChkYXRhYmFzZU5hbWUpIHtcbiAgbGV0IG11dGV4ID0gbXV0ZXhlc0J5RGF0YWJhc2VOYW1lLmdldChkYXRhYmFzZU5hbWUpXG5cbiAgaWYgKCFtdXRleCkge1xuICAgIG11dGV4ID0gbmV3IE11dGV4KClcbiAgICBtdXRleGVzQnlEYXRhYmFzZU5hbWUuc2V0KGRhdGFiYXNlTmFtZSwgbXV0ZXgpXG4gIH1cblxuICByZXR1cm4gbXV0ZXhcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGFuIGV4cG8tc3FsaXRlIGVycm9yIG1lYW5zIHRoZSBuYXRpdmUgZGF0YWJhc2Uvc3RhdGVtZW50IHdhcyByZWxlYXNlZC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBUaHJvd24gZXJyb3IuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgZXJyb3IgaXMgdGhlIG5hdGl2ZS1oYW5kbGUgbGlmZXRpbWUgZmFpbHVyZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTmF0aXZlSGFuZGxlRXJyb3IoZXJyb3IpIHtcbiAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICBjb25zdCBjYXVzZU1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLmNhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5jYXVzZS5tZXNzYWdlIDogXCJcIlxuICBjb25zdCB0ZXh0ID0gYCR7bWVzc2FnZX0gJHtjYXVzZU1lc3NhZ2V9YFxuXG4gIHJldHVybiAvTmF0aXZlU3RhdGVtZW50XFwucnVuQXN5bmN8TmF0aXZlRGF0YWJhc2VcXC5wcmVwYXJlQXN5bmMvLnRlc3QodGV4dCkgJiYgL051bGxQb2ludGVyRXhjZXB0aW9ufGFscmVhZHkgcmVsZWFzZWQvLnRlc3QodGV4dClcbn1cblxuLyoqXG4gKiBSdW5zIG9uZSBuYXRpdmUgb3BlcmF0aW9uIHVuZGVyIHRoZSBwZXItZGF0YWJhc2UgZ2F0ZSwgcmVvcGVuaW5nIG9uY2Ugd2hlblxuICogZXhwby1zcWxpdGUgcmVwb3J0cyB0aGUgc2hhcmVkIG5hdGl2ZSBoYW5kbGUgd2FzIHJlbGVhc2VkLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3BlcmF0aW9uIGFyZ3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZU5hbWUgLSBTUUxpdGUgZGF0YWJhc2UgbmFtZS5cbiAqIEBwYXJhbSB7KCkgPT4gTmF0aXZlU3FsaXRlQ29ubmVjdGlvbiB8IHVuZGVmaW5lZH0gYXJncy5nZXRDb25uZWN0aW9uIC0gQ3VycmVudCBjb25uZWN0aW9uIGdldHRlci5cbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxOYXRpdmVTcWxpdGVDb25uZWN0aW9uPn0gYXJncy5yZW9wZW5Db25uZWN0aW9uIC0gT3BlbnMgYSBmcmVzaCBuYXRpdmUgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IE5hdGl2ZVNxbGl0ZUNvbm5lY3Rpb24pID0+IFByb21pc2U8VD59IGFyZ3Mub3BlcmF0aW9uIC0gT3BlcmF0aW9uIHRvIHJ1bi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBPcGVyYXRpb24gcmVzdWx0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuTmF0aXZlT3BlcmF0aW9uKHtkYXRhYmFzZU5hbWUsIGdldENvbm5lY3Rpb24sIHJlb3BlbkNvbm5lY3Rpb24sIG9wZXJhdGlvbn0pIHtcbiAgcmV0dXJuIGF3YWl0IG5hdGl2ZURhdGFiYXNlTXV0ZXgoZGF0YWJhc2VOYW1lKS5zeW5jKGFzeW5jICgpID0+IHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZ2V0Q29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vdCBjb25uZWN0ZWQgeWV0XCIpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbihjb25uZWN0aW9uKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWlzTmF0aXZlSGFuZGxlRXJyb3IoZXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICByZXR1cm4gYXdhaXQgb3BlcmF0aW9uKGF3YWl0IHJlb3BlbkNvbm5lY3Rpb24oKSlcbiAgICB9XG4gIH0pXG59XG4iXX0=