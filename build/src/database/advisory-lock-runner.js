// @ts-check
import timeout, { TimeoutError } from "awaitery/build/timeout.js";
/**
 * Thrown when an advisory lock could not be acquired before `timeoutMs` elapsed.
 */
class AdvisoryLockTimeoutError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{name: string}} args - The advisory lock name that timed out.
     */
    constructor(message, { name }) {
        super(message);
        this.name = "AdvisoryLockTimeoutError";
        this.lockName = name;
    }
}
/**
 * Thrown when `withAdvisoryLockOrFail` finds the lock already held.
 */
class AdvisoryLockBusyError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{name: string}} args - The advisory lock name that was already held.
     */
    constructor(message, { name }) {
        super(message);
        this.name = "AdvisoryLockBusyError";
        this.lockName = name;
    }
}
/**
 * Thrown when a callback holds an advisory lock longer than `holdTimeoutMs`.
 */
class AdvisoryLockHoldTimeoutError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{name: string}} args - The advisory lock name whose hold timed out.
     */
    constructor(message, { name }) {
        super(message);
        this.name = "AdvisoryLockHoldTimeoutError";
        this.lockName = name;
    }
}
/**
 * Runs advisory locks on the caller connection by default, using a dedicated
 * lock connection when `dedicatedConnection` is requested or when a positive
 * hold timeout needs separate ownership.
 */
export default class AdvisoryLockRunner {
    /**
     * Creates an advisory-lock runner for one model database identifier.
     * @param {{configuration: import("../configuration.js").default, connectionProvider: () => import("./drivers/base.js").default, databaseIdentifier: string}} args - Runner dependencies.
     */
    constructor({ configuration, connectionProvider, databaseIdentifier }) {
        this.configuration = configuration;
        this.connectionProvider = connectionProvider;
        this.databaseIdentifier = databaseIdentifier;
    }
    /**
     * Runs a callback after acquiring the advisory lock, waiting up to `timeoutMs`.
     * When `dedicatedConnection` is true the lock is acquired on a spawned
     * connection that is released after the callback finishes, while the callback
     * itself still runs against the caller/model connection. When a `holdTimeoutMs`
     * is set the callback receives a `TimeoutControl` from awaitery for cooperative
     * cancellation (`control.check()`, `control.signal`, `control.timedOut`,
     * `control.remaining()`); a dedicated connection is also used so timeout
     * cleanup can release the lock even if callback database work is stuck.
     * @template T
     * @param {string} name - Lock name.
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Lock and hold timeout options.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withAdvisoryLock(name, callback, args = {}) {
        return await this.withLockConnection(args, async (connection) => {
            const acquired = await connection.acquireAdvisoryLock(name, args);
            if (!acquired) {
                throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, { name });
            }
            return await this.runLockedCallback({ callback, connection, holdTimeoutMs: args.holdTimeoutMs, name });
        });
    }
    /**
     * Runs a callback only if the advisory lock can be acquired immediately.
     * When `dedicatedConnection` is true the lock is acquired on a spawned
     * connection that is released after the callback finishes, while the callback
     * itself still runs against the caller/model connection. When a `holdTimeoutMs`
     * is set the callback receives a `TimeoutControl` from awaitery for cooperative
     * cancellation.
     * @template T
     * @param {string} name - Lock name.
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withAdvisoryLockOrFail(name, callback, args = {}) {
        return await this.withLockConnection(args, async (connection) => {
            const acquired = await connection.tryAcquireAdvisoryLock(name);
            if (!acquired) {
                throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, { name });
            }
            return await this.runLockedCallback({ callback, connection, holdTimeoutMs: args.holdTimeoutMs, name });
        });
    }
    /**
     * Runs a callback if the advisory lock can be acquired without waiting;
     * otherwise returns a `{acquired: false}` defer result instead of throwing.
     *
     * This is the non-throwing counterpart of `withAdvisoryLockOrFail` for hot
     * paths: "holder busy, defer me" is a first-class outcome, so a contended
     * lock produces zero exception traffic and — because the probe is a single
     * immediate try-acquire — zero pinned connections. Callers reschedule via
     * their own event-driven retry machinery. The result form is identical
     * across tiers: the driver's `tryAcquireAdvisoryLock` maps per-tier (MySQL
     * `GET_LOCK(name, 0)`, PostgreSQL `pg_try_advisory_lock`, SQL Server
     * `sp_getapplock @LockTimeout = 0`, SQLite process-local queue, SQLite Node
     * file lock), so a caller never branches on the backend.
     * @template T
     * @param {string} name - Lock name.
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
     * @returns {Promise<{acquired: true, result: T} | {acquired: false, reason: "contended", lockName: string}>} - Either the held-callback result or the defer outcome.
     */
    async withAdvisoryLockOrDefer(name, callback, args = {}) {
        return await this.withLockConnection(args, async (connection) => {
            const acquired = await connection.tryAcquireAdvisoryLock(name);
            if (!acquired)
                return { acquired: false, reason: "contended", lockName: name };
            const result = await this.runLockedCallback({ callback, connection, holdTimeoutMs: args.holdTimeoutMs, name });
            return { acquired: true, result };
        });
    }
    /**
     * Runs the lock holder callback and releases the lock from its owning connection.
     * @template T
     * @param {{callback: (args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>, connection: import("./drivers/base.js").default, holdTimeoutMs?: number | null, name: string}} args - Locked callback args.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async runLockedCallback({ callback, connection, holdTimeoutMs, name }) {
        try {
            return await AdvisoryLockRunner.runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs);
        }
        finally {
            await connection.releaseAdvisoryLock(name);
        }
    }
    /**
     * Runs lock work on the caller connection unless `dedicatedConnection` is
     * requested or a positive hold timeout needs its own lock connection.
     * @template T
     * @param {{dedicatedConnection?: boolean, holdTimeoutMs?: number | null}} args - Lock connection options.
     * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback receiving the connection that owns the advisory lock.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withLockConnection(args, callback) {
        const holdTimeoutMs = args.holdTimeoutMs;
        if (args.dedicatedConnection || (holdTimeoutMs && holdTimeoutMs > 0)) {
            return await this.withDedicatedConnection(callback);
        }
        return await callback(this.connectionProvider());
    }
    /**
     * Spawns a dedicated lock connection and closes it after lock work completes
     * when the spawned driver owns the underlying physical connection.
     * @template T
     * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback that receives the dedicated lock connection.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withDedicatedConnection(callback) {
        const connection = await this.configuration.getDatabasePool(this.databaseIdentifier).spawnConnection();
        // The spawned driver owns its physical connection unless it borrows a shared one
        // via `getConnection`. An owned connection lives outside the pools' tracked sets,
        // so register it while the lock is held: a shutdown then closes it (releasing the
        // lock) instead of orphaning a half-open session until the DB `wait_timeout`.
        const ownsConnection = !connection.getArgs().getConnection;
        if (ownsConnection)
            this.configuration.registerAdvisoryLockConnection(connection);
        try {
            return await callback(connection);
        }
        finally {
            if (ownsConnection) {
                this.configuration.unregisterAdvisoryLockConnection(connection);
                await connection.close();
            }
            else {
                await connection.releaseHeldAdvisoryLocks();
            }
        }
    }
    /**
     * Runs `callback`, rejecting with `AdvisoryLockHoldTimeoutError` if it has
     * not settled within `holdTimeoutMs`. The callback is not cancelled; callers
     * use a dedicated advisory-lock connection so the lock can still be released.
     *
     * The callback receives a `TimeoutControl` from awaitery, enabling cooperative
     * cancellation via `control.check()`, `control.signal`, `control.timedOut`,
     * and `control.remaining()`.
     * @template T
     * @param {string} name - Lock name (for the error message).
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback holding the lock.
     * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    static async runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs) {
        if (!holdTimeoutMs || holdTimeoutMs <= 0) {
            return await callback();
        }
        let callbackSettled = false;
        try {
            return await timeout({ timeout: holdTimeoutMs }, async ({ control }) => {
                try {
                    return await callback({ control });
                }
                finally {
                    callbackSettled = true;
                }
            });
        }
        catch (error) {
            if (!callbackSettled || error instanceof TimeoutError) {
                throw new AdvisoryLockHoldTimeoutError(`Advisory lock ${JSON.stringify(name)} held longer than ${holdTimeoutMs}ms`, { name });
            }
            throw error;
        }
    }
}
export { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1ydW5uZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFFL0Q7O0dBRUc7QUFDSCxNQUFNLHdCQUF5QixTQUFRLEtBQUs7SUFDMUM7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFDO1FBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsMEJBQTBCLENBQUE7UUFDdEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztDQUNGO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLHFCQUFzQixTQUFRLEtBQUs7SUFDdkM7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFDO1FBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsdUJBQXVCLENBQUE7UUFDbkMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztDQUNGO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLDRCQUE2QixTQUFRLEtBQUs7SUFDOUM7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFDO1FBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsOEJBQThCLENBQUE7UUFDMUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztDQUNGO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0JBQWtCO0lBQ3JDOzs7T0FHRztJQUNILFlBQVksRUFB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Q0FBQztJQUNILENBQUM7Q0FDRjtBQUVELE9BQU8sRUFBQyxxQkFBcUIsRUFBRSw0QkFBNEIsRUFBRSx3QkFBd0IsRUFBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0LCB7VGltZW91dEVycm9yfSBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5cbi8qKlxuICogVGhyb3duIHdoZW4gYW4gYWR2aXNvcnkgbG9jayBjb3VsZCBub3QgYmUgYWNxdWlyZWQgYmVmb3JlIGB0aW1lb3V0TXNgIGVsYXBzZWQuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgdGhhdCB0aW1lZCBvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrVGltZW91dEVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbmFtZVxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIGZpbmRzIHRoZSBsb2NrIGFscmVhZHkgaGVsZC5cbiAqL1xuY2xhc3MgQWR2aXNvcnlMb2NrQnVzeUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmd9fSBhcmdzIC0gVGhlIGFkdmlzb3J5IGxvY2sgbmFtZSB0aGF0IHdhcyBhbHJlYWR5IGhlbGQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrQnVzeUVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbmFtZVxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYSBjYWxsYmFjayBob2xkcyBhbiBhZHZpc29yeSBsb2NrIGxvbmdlciB0aGFuIGBob2xkVGltZW91dE1zYC5cbiAqL1xuY2xhc3MgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgd2hvc2UgaG9sZCB0aW1lZCBvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYWR2aXNvcnkgbG9ja3Mgb24gdGhlIGNhbGxlciBjb25uZWN0aW9uIGJ5IGRlZmF1bHQsIHVzaW5nIGEgZGVkaWNhdGVkXG4gKiBsb2NrIGNvbm5lY3Rpb24gd2hlbiBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgaXMgcmVxdWVzdGVkIG9yIHdoZW4gYSBwb3NpdGl2ZVxuICogaG9sZCB0aW1lb3V0IG5lZWRzIHNlcGFyYXRlIG93bmVyc2hpcC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQWR2aXNvcnlMb2NrUnVubmVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYW4gYWR2aXNvcnktbG9jayBydW5uZXIgZm9yIG9uZSBtb2RlbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmd9fSBhcmdzIC0gUnVubmVyIGRlcGVuZGVuY2llcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uUHJvdmlkZXIsIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5jb25uZWN0aW9uUHJvdmlkZXIgPSBjb25uZWN0aW9uUHJvdmlkZXJcbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBhZnRlciBhY3F1aXJpbmcgdGhlIGFkdmlzb3J5IGxvY2ssIHdhaXRpbmcgdXAgdG8gYHRpbWVvdXRNc2AuXG4gICAqIFdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHRydWUgdGhlIGxvY2sgaXMgYWNxdWlyZWQgb24gYSBzcGF3bmVkXG4gICAqIGNvbm5lY3Rpb24gdGhhdCBpcyByZWxlYXNlZCBhZnRlciB0aGUgY2FsbGJhY2sgZmluaXNoZXMsIHdoaWxlIHRoZSBjYWxsYmFja1xuICAgKiBpdHNlbGYgc3RpbGwgcnVucyBhZ2FpbnN0IHRoZSBjYWxsZXIvbW9kZWwgY29ubmVjdGlvbi4gV2hlbiBhIGBob2xkVGltZW91dE1zYFxuICAgKiBpcyBzZXQgdGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5IGZvciBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24gKGBjb250cm9sLmNoZWNrKClgLCBgY29udHJvbC5zaWduYWxgLCBgY29udHJvbC50aW1lZE91dGAsXG4gICAqIGBjb250cm9sLnJlbWFpbmluZygpYCk7IGEgZGVkaWNhdGVkIGNvbm5lY3Rpb24gaXMgYWxzbyB1c2VkIHNvIHRpbWVvdXRcbiAgICogY2xlYW51cCBjYW4gcmVsZWFzZSB0aGUgbG9jayBldmVuIGlmIGNhbGxiYWNrIGRhdGFiYXNlIHdvcmsgaXMgc3R1Y2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w6IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2x9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBMb2NrIGFuZCBob2xkIHRpbWVvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGNvbm5lY3Rpb24uYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCBhcmdzKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3IoYFRpbWVkIG91dCB3YWl0aW5nIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9YCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGNvbm5lY3Rpb24sIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbmFtZX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgb25seSBpZiB0aGUgYWR2aXNvcnkgbG9jayBjYW4gYmUgYWNxdWlyZWQgaW1tZWRpYXRlbHkuXG4gICAqIFdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHRydWUgdGhlIGxvY2sgaXMgYWNxdWlyZWQgb24gYSBzcGF3bmVkXG4gICAqIGNvbm5lY3Rpb24gdGhhdCBpcyByZWxlYXNlZCBhZnRlciB0aGUgY2FsbGJhY2sgZmluaXNoZXMsIHdoaWxlIHRoZSBjYWxsYmFja1xuICAgKiBpdHNlbGYgc3RpbGwgcnVucyBhZ2FpbnN0IHRoZSBjYWxsZXIvbW9kZWwgY29ubmVjdGlvbi4gV2hlbiBhIGBob2xkVGltZW91dE1zYFxuICAgKiBpcyBzZXQgdGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5IGZvciBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w6IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2x9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3tob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBIb2xkIHRpbWVvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGNvbm5lY3Rpb24udHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tCdXN5RXJyb3IoYEFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gaXMgYWxyZWFkeSBoZWxkYCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGNvbm5lY3Rpb24sIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbmFtZX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaWYgdGhlIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkIHdpdGhvdXQgd2FpdGluZztcbiAgICogb3RoZXJ3aXNlIHJldHVybnMgYSBge2FjcXVpcmVkOiBmYWxzZX1gIGRlZmVyIHJlc3VsdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgKlxuICAgKiBUaGlzIGlzIHRoZSBub24tdGhyb3dpbmcgY291bnRlcnBhcnQgb2YgYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIGZvciBob3RcbiAgICogcGF0aHM6IFwiaG9sZGVyIGJ1c3ksIGRlZmVyIG1lXCIgaXMgYSBmaXJzdC1jbGFzcyBvdXRjb21lLCBzbyBhIGNvbnRlbmRlZFxuICAgKiBsb2NrIHByb2R1Y2VzIHplcm8gZXhjZXB0aW9uIHRyYWZmaWMgYW5kIOKAlCBiZWNhdXNlIHRoZSBwcm9iZSBpcyBhIHNpbmdsZVxuICAgKiBpbW1lZGlhdGUgdHJ5LWFjcXVpcmUg4oCUIHplcm8gcGlubmVkIGNvbm5lY3Rpb25zLiBDYWxsZXJzIHJlc2NoZWR1bGUgdmlhXG4gICAqIHRoZWlyIG93biBldmVudC1kcml2ZW4gcmV0cnkgbWFjaGluZXJ5LiBUaGUgcmVzdWx0IGZvcm0gaXMgaWRlbnRpY2FsXG4gICAqIGFjcm9zcyB0aWVyczogdGhlIGRyaXZlcidzIGB0cnlBY3F1aXJlQWR2aXNvcnlMb2NrYCBtYXBzIHBlci10aWVyIChNeVNRTFxuICAgKiBgR0VUX0xPQ0sobmFtZSwgMClgLCBQb3N0Z3JlU1FMIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AsIFNRTCBTZXJ2ZXJcbiAgICogYHNwX2dldGFwcGxvY2sgQExvY2tUaW1lb3V0ID0gMGAsIFNRTGl0ZSBwcm9jZXNzLWxvY2FsIHF1ZXVlLCBTUUxpdGUgTm9kZVxuICAgKiBmaWxlIGxvY2spLCBzbyBhIGNhbGxlciBuZXZlciBicmFuY2hlcyBvbiB0aGUgYmFja2VuZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7KGFyZ3M/OiB7Y29udHJvbDogaW1wb3J0KFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiKS5UaW1lb3V0Q29udHJvbH0pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIEhvbGQgdGltZW91dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YWNxdWlyZWQ6IHRydWUsIHJlc3VsdDogVH0gfCB7YWNxdWlyZWQ6IGZhbHNlLCByZWFzb246IFwiY29udGVuZGVkXCIsIGxvY2tOYW1lOiBzdHJpbmd9Pn0gLSBFaXRoZXIgdGhlIGhlbGQtY2FsbGJhY2sgcmVzdWx0IG9yIHRoZSBkZWZlciBvdXRjb21lLlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9ja09yRGVmZXIobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBjb25uZWN0aW9uLnRyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgcmV0dXJuIHthY3F1aXJlZDogZmFsc2UsIHJlYXNvbjogXCJjb250ZW5kZWRcIiwgbG9ja05hbWU6IG5hbWV9XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBjb25uZWN0aW9uLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIG5hbWV9KVxuXG4gICAgICByZXR1cm4ge2FjcXVpcmVkOiB0cnVlLCByZXN1bHR9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBsb2NrIGhvbGRlciBjYWxsYmFjayBhbmQgcmVsZWFzZXMgdGhlIGxvY2sgZnJvbSBpdHMgb3duaW5nIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2NhbGxiYWNrOiAoYXJncz86IHtjb250cm9sOiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sfSkgPT4gUHJvbWlzZTxUPiwgY29ubmVjdGlvbjogaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgaG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIG5hbWU6IHN0cmluZ319IGFyZ3MgLSBMb2NrZWQgY2FsbGJhY2sgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBjb25uZWN0aW9uLCBob2xkVGltZW91dE1zLCBuYW1lfSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgQWR2aXNvcnlMb2NrUnVubmVyLnJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcylcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9jayB3b3JrIG9uIHRoZSBjYWxsZXIgY29ubmVjdGlvbiB1bmxlc3MgYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzXG4gICAqIHJlcXVlc3RlZCBvciBhIHBvc2l0aXZlIGhvbGQgdGltZW91dCBuZWVkcyBpdHMgb3duIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW4sIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gYXJncyAtIExvY2sgY29ubmVjdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHJlY2VpdmluZyB0aGUgY29ubmVjdGlvbiB0aGF0IG93bnMgdGhlIGFkdmlzb3J5IGxvY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGhvbGRUaW1lb3V0TXMgPSBhcmdzLmhvbGRUaW1lb3V0TXNcblxuICAgIGlmIChhcmdzLmRlZGljYXRlZENvbm5lY3Rpb24gfHwgKGhvbGRUaW1lb3V0TXMgJiYgaG9sZFRpbWVvdXRNcyA+IDApKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGVkaWNhdGVkQ29ubmVjdGlvbihjYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sodGhpcy5jb25uZWN0aW9uUHJvdmlkZXIoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGF3bnMgYSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uIGFuZCBjbG9zZXMgaXQgYWZ0ZXIgbG9jayB3b3JrIGNvbXBsZXRlc1xuICAgKiB3aGVuIHRoZSBzcGF3bmVkIGRyaXZlciBvd25zIHRoZSB1bmRlcmx5aW5nIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdGhhdCByZWNlaXZlcyB0aGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERlZGljYXRlZENvbm5lY3Rpb24oY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikuc3Bhd25Db25uZWN0aW9uKClcblxuICAgIC8vIFRoZSBzcGF3bmVkIGRyaXZlciBvd25zIGl0cyBwaHlzaWNhbCBjb25uZWN0aW9uIHVubGVzcyBpdCBib3Jyb3dzIGEgc2hhcmVkIG9uZVxuICAgIC8vIHZpYSBgZ2V0Q29ubmVjdGlvbmAuIEFuIG93bmVkIGNvbm5lY3Rpb24gbGl2ZXMgb3V0c2lkZSB0aGUgcG9vbHMnIHRyYWNrZWQgc2V0cyxcbiAgICAvLyBzbyByZWdpc3RlciBpdCB3aGlsZSB0aGUgbG9jayBpcyBoZWxkOiBhIHNodXRkb3duIHRoZW4gY2xvc2VzIGl0IChyZWxlYXNpbmcgdGhlXG4gICAgLy8gbG9jaykgaW5zdGVhZCBvZiBvcnBoYW5pbmcgYSBoYWxmLW9wZW4gc2Vzc2lvbiB1bnRpbCB0aGUgREIgYHdhaXRfdGltZW91dGAuXG4gICAgY29uc3Qgb3duc0Nvbm5lY3Rpb24gPSAhY29ubmVjdGlvbi5nZXRBcmdzKCkuZ2V0Q29ubmVjdGlvblxuXG4gICAgaWYgKG93bnNDb25uZWN0aW9uKSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVnaXN0ZXJBZHZpc29yeUxvY2tDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChvd25zQ29ubmVjdGlvbikge1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24udW5yZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbilcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLnJlbGVhc2VIZWxkQWR2aXNvcnlMb2NrcygpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYGNhbGxiYWNrYCwgcmVqZWN0aW5nIHdpdGggYEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JgIGlmIGl0IGhhc1xuICAgKiBub3Qgc2V0dGxlZCB3aXRoaW4gYGhvbGRUaW1lb3V0TXNgLiBUaGUgY2FsbGJhY2sgaXMgbm90IGNhbmNlbGxlZDsgY2FsbGVyc1xuICAgKiB1c2UgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIHNvIHRoZSBsb2NrIGNhbiBzdGlsbCBiZSByZWxlYXNlZC5cbiAgICpcbiAgICogVGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5LCBlbmFibGluZyBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24gdmlhIGBjb250cm9sLmNoZWNrKClgLCBgY29udHJvbC5zaWduYWxgLCBgY29udHJvbC50aW1lZE91dGAsXG4gICAqIGFuZCBgY29udHJvbC5yZW1haW5pbmcoKWAuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lIChmb3IgdGhlIGVycm9yIG1lc3NhZ2UpLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w6IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2x9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGhvbGRpbmcgdGhlIGxvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2hvbGRUaW1lb3V0TXNdIC0gTWF4IGhvbGQgdGltZTsgZmFsc3kgZGlzYWJsZXMgdGhlIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMpIHtcbiAgICBpZiAoIWhvbGRUaW1lb3V0TXMgfHwgaG9sZFRpbWVvdXRNcyA8PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGxldCBjYWxsYmFja1NldHRsZWQgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHt0aW1lb3V0OiBob2xkVGltZW91dE1zfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7Y29udHJvbH0pXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgY2FsbGJhY2tTZXR0bGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWNhbGxiYWNrU2V0dGxlZCB8fCBlcnJvciBpbnN0YW5jZW9mIFRpbWVvdXRFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcihgQWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSBoZWxkIGxvbmdlciB0aGFuICR7aG9sZFRpbWVvdXRNc31tc2AsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcn1cbiJdfQ==