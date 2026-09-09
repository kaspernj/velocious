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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1ydW5uZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFFL0Q7O0dBRUc7QUFDSCxNQUFNLHdCQUF5QixTQUFRLEtBQUs7SUFDMUM7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFDO1FBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsMEJBQTBCLENBQUE7UUFDdEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztDQUNGO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLHFCQUFzQixTQUFRLEtBQUs7SUFDdkM7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFDO1FBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsdUJBQXVCLENBQUE7UUFDbkMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztDQUNGO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLDRCQUE2QixTQUFRLEtBQUs7SUFDOUM7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFDO1FBQ3pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsOEJBQThCLENBQUE7UUFDMUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7SUFDdEIsQ0FBQztDQUNGO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0JBQWtCO0lBQ3JDOzs7T0FHRztJQUNILFlBQVksRUFB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O29CQUNILE9BQU8sTUFBTSxRQUFRLENBQUMsRUFBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO2dCQUNsQyxDQUFDO3dCQUFTLENBQUM7b0JBQ1QsZUFBZSxHQUFHLElBQUksQ0FBQTtnQkFDeEIsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsZUFBZSxJQUFJLEtBQUssWUFBWSxZQUFZLEVBQUUsQ0FBQztnQkFDdEQsTUFBTSxJQUFJLDRCQUE0QixDQUFDLGlCQUFpQixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsYUFBYSxJQUFJLEVBQUUsRUFBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQzdILENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgdGltZW91dCwge1RpbWVvdXRFcnJvcn0gZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuXG4vKipcbiAqIFRocm93biB3aGVuIGFuIGFkdmlzb3J5IGxvY2sgY291bGQgbm90IGJlIGFjcXVpcmVkIGJlZm9yZSBgdGltZW91dE1zYCBlbGFwc2VkLlxuICovXG5jbGFzcyBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e25hbWU6IHN0cmluZ319IGFyZ3MgLSBUaGUgYWR2aXNvcnkgbG9jayBuYW1lIHRoYXQgdGltZWQgb3V0LlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge25hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFRocm93biB3aGVuIGB3aXRoQWR2aXNvcnlMb2NrT3JGYWlsYCBmaW5kcyB0aGUgbG9jayBhbHJlYWR5IGhlbGQuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja0J1c3lFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgdGhhdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge25hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja0J1c3lFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFRocm93biB3aGVuIGEgY2FsbGJhY2sgaG9sZHMgYW4gYWR2aXNvcnkgbG9jayBsb25nZXIgdGhhbiBgaG9sZFRpbWVvdXRNc2AuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e25hbWU6IHN0cmluZ319IGFyZ3MgLSBUaGUgYWR2aXNvcnkgbG9jayBuYW1lIHdob3NlIGhvbGQgdGltZWQgb3V0LlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge25hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JcIlxuICAgIHRoaXMubG9ja05hbWUgPSBuYW1lXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFkdmlzb3J5IGxvY2tzIG9uIHRoZSBjYWxsZXIgY29ubmVjdGlvbiBieSBkZWZhdWx0LCB1c2luZyBhIGRlZGljYXRlZFxuICogbG9jayBjb25uZWN0aW9uIHdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHJlcXVlc3RlZCBvciB3aGVuIGEgcG9zaXRpdmVcbiAqIGhvbGQgdGltZW91dCBuZWVkcyBzZXBhcmF0ZSBvd25lcnNoaXAuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEFkdmlzb3J5TG9ja1J1bm5lciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGFkdmlzb3J5LWxvY2sgcnVubmVyIGZvciBvbmUgbW9kZWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gYXJncyAtIFJ1bm5lciBkZXBlbmRlbmNpZXMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvblByb3ZpZGVyLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuY29ubmVjdGlvblByb3ZpZGVyID0gY29ubmVjdGlvblByb3ZpZGVyXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgYWZ0ZXIgYWNxdWlyaW5nIHRoZSBhZHZpc29yeSBsb2NrLCB3YWl0aW5nIHVwIHRvIGB0aW1lb3V0TXNgLlxuICAgKiBXaGVuIGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBpcyB0cnVlIHRoZSBsb2NrIGlzIGFjcXVpcmVkIG9uIGEgc3Bhd25lZFxuICAgKiBjb25uZWN0aW9uIHRoYXQgaXMgcmVsZWFzZWQgYWZ0ZXIgdGhlIGNhbGxiYWNrIGZpbmlzaGVzLCB3aGlsZSB0aGUgY2FsbGJhY2tcbiAgICogaXRzZWxmIHN0aWxsIHJ1bnMgYWdhaW5zdCB0aGUgY2FsbGVyL21vZGVsIGNvbm5lY3Rpb24uIFdoZW4gYSBgaG9sZFRpbWVvdXRNc2BcbiAgICogaXMgc2V0IHRoZSBjYWxsYmFjayByZWNlaXZlcyBhIGBUaW1lb3V0Q29udHJvbGAgZnJvbSBhd2FpdGVyeSBmb3IgY29vcGVyYXRpdmVcbiAgICogY2FuY2VsbGF0aW9uIChgY29udHJvbC5jaGVjaygpYCwgYGNvbnRyb2wuc2lnbmFsYCwgYGNvbnRyb2wudGltZWRPdXRgLFxuICAgKiBgY29udHJvbC5yZW1haW5pbmcoKWApOyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIGlzIGFsc28gdXNlZCBzbyB0aW1lb3V0XG4gICAqIGNsZWFudXAgY2FuIHJlbGVhc2UgdGhlIGxvY2sgZXZlbiBpZiBjYWxsYmFjayBkYXRhYmFzZSB3b3JrIGlzIHN0dWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHsoYXJncz86IHtjb250cm9sOiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sfSkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBpbnZva2Ugd2hpbGUgdGhlIGxvY2sgaXMgaGVsZC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgaG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGRlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFufX0gW2FyZ3NdIC0gTG9jayBhbmQgaG9sZCB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhBZHZpc29yeUxvY2sobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBjb25uZWN0aW9uLmFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgYXJncylcblxuICAgICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yKGBUaW1lZCBvdXQgd2FpdGluZyBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfWAsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBjb25uZWN0aW9uLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIG5hbWV9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIG9ubHkgaWYgdGhlIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkIGltbWVkaWF0ZWx5LlxuICAgKiBXaGVuIGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBpcyB0cnVlIHRoZSBsb2NrIGlzIGFjcXVpcmVkIG9uIGEgc3Bhd25lZFxuICAgKiBjb25uZWN0aW9uIHRoYXQgaXMgcmVsZWFzZWQgYWZ0ZXIgdGhlIGNhbGxiYWNrIGZpbmlzaGVzLCB3aGlsZSB0aGUgY2FsbGJhY2tcbiAgICogaXRzZWxmIHN0aWxsIHJ1bnMgYWdhaW5zdCB0aGUgY2FsbGVyL21vZGVsIGNvbm5lY3Rpb24uIFdoZW4gYSBgaG9sZFRpbWVvdXRNc2BcbiAgICogaXMgc2V0IHRoZSBjYWxsYmFjayByZWNlaXZlcyBhIGBUaW1lb3V0Q29udHJvbGAgZnJvbSBhd2FpdGVyeSBmb3IgY29vcGVyYXRpdmVcbiAgICogY2FuY2VsbGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHsoYXJncz86IHtjb250cm9sOiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sfSkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBpbnZva2Ugd2hpbGUgdGhlIGxvY2sgaXMgaGVsZC5cbiAgICogQHBhcmFtIHt7aG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGRlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFufX0gW2FyZ3NdIC0gSG9sZCB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBjb25uZWN0aW9uLnRyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrQnVzeUVycm9yKGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IGlzIGFscmVhZHkgaGVsZGAsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBjb25uZWN0aW9uLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIG5hbWV9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbG9jayBob2xkZXIgY2FsbGJhY2sgYW5kIHJlbGVhc2VzIHRoZSBsb2NrIGZyb20gaXRzIG93bmluZyBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogKGFyZ3M/OiB7Y29udHJvbDogaW1wb3J0KFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiKS5UaW1lb3V0Q29udHJvbH0pID0+IFByb21pc2U8VD4sIGNvbm5lY3Rpb246IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBuYW1lOiBzdHJpbmd9fSBhcmdzIC0gTG9ja2VkIGNhbGxiYWNrIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgY29ubmVjdGlvbiwgaG9sZFRpbWVvdXRNcywgbmFtZX0pIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IEFkdmlzb3J5TG9ja1J1bm5lci5ydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvY2sgd29yayBvbiB0aGUgY2FsbGVyIGNvbm5lY3Rpb24gdW5sZXNzIGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBpc1xuICAgKiByZXF1ZXN0ZWQgb3IgYSBwb3NpdGl2ZSBob2xkIHRpbWVvdXQgbmVlZHMgaXRzIG93biBsb2NrIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFuLCBob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IGFyZ3MgLSBMb2NrIGNvbm5lY3Rpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHsoY29ubmVjdGlvbjogaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayByZWNlaXZpbmcgdGhlIGNvbm5lY3Rpb24gdGhhdCBvd25zIHRoZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoTG9ja0Nvbm5lY3Rpb24oYXJncywgY2FsbGJhY2spIHtcbiAgICBjb25zdCBob2xkVGltZW91dE1zID0gYXJncy5ob2xkVGltZW91dE1zXG5cbiAgICBpZiAoYXJncy5kZWRpY2F0ZWRDb25uZWN0aW9uIHx8IChob2xkVGltZW91dE1zICYmIGhvbGRUaW1lb3V0TXMgPiAwKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aERlZGljYXRlZENvbm5lY3Rpb24oY2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHRoaXMuY29ubmVjdGlvblByb3ZpZGVyKCkpXG4gIH1cblxuICAvKipcbiAgICogU3Bhd25zIGEgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbiBhbmQgY2xvc2VzIGl0IGFmdGVyIGxvY2sgd29yayBjb21wbGV0ZXNcbiAgICogd2hlbiB0aGUgc3Bhd25lZCBkcml2ZXIgb3ducyB0aGUgdW5kZXJseWluZyBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRoYXQgcmVjZWl2ZXMgdGhlIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhEZWRpY2F0ZWRDb25uZWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpLnNwYXduQ29ubmVjdGlvbigpXG5cbiAgICAvLyBUaGUgc3Bhd25lZCBkcml2ZXIgb3ducyBpdHMgcGh5c2ljYWwgY29ubmVjdGlvbiB1bmxlc3MgaXQgYm9ycm93cyBhIHNoYXJlZCBvbmVcbiAgICAvLyB2aWEgYGdldENvbm5lY3Rpb25gLiBBbiBvd25lZCBjb25uZWN0aW9uIGxpdmVzIG91dHNpZGUgdGhlIHBvb2xzJyB0cmFja2VkIHNldHMsXG4gICAgLy8gc28gcmVnaXN0ZXIgaXQgd2hpbGUgdGhlIGxvY2sgaXMgaGVsZDogYSBzaHV0ZG93biB0aGVuIGNsb3NlcyBpdCAocmVsZWFzaW5nIHRoZVxuICAgIC8vIGxvY2spIGluc3RlYWQgb2Ygb3JwaGFuaW5nIGEgaGFsZi1vcGVuIHNlc3Npb24gdW50aWwgdGhlIERCIGB3YWl0X3RpbWVvdXRgLlxuICAgIGNvbnN0IG93bnNDb25uZWN0aW9uID0gIWNvbm5lY3Rpb24uZ2V0QXJncygpLmdldENvbm5lY3Rpb25cblxuICAgIGlmIChvd25zQ29ubmVjdGlvbikgdGhpcy5jb25maWd1cmF0aW9uLnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAob3duc0Nvbm5lY3Rpb24pIHtcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnVucmVnaXN0ZXJBZHZpc29yeUxvY2tDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlSGVsZEFkdmlzb3J5TG9ja3MoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjYWxsYmFja2AsIHJlamVjdGluZyB3aXRoIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpZiBpdCBoYXNcbiAgICogbm90IHNldHRsZWQgd2l0aGluIGBob2xkVGltZW91dE1zYC4gVGhlIGNhbGxiYWNrIGlzIG5vdCBjYW5jZWxsZWQ7IGNhbGxlcnNcbiAgICogdXNlIGEgZGVkaWNhdGVkIGFkdmlzb3J5LWxvY2sgY29ubmVjdGlvbiBzbyB0aGUgbG9jayBjYW4gc3RpbGwgYmUgcmVsZWFzZWQuXG4gICAqXG4gICAqIFRoZSBjYWxsYmFjayByZWNlaXZlcyBhIGBUaW1lb3V0Q29udHJvbGAgZnJvbSBhd2FpdGVyeSwgZW5hYmxpbmcgY29vcGVyYXRpdmVcbiAgICogY2FuY2VsbGF0aW9uIHZpYSBgY29udHJvbC5jaGVjaygpYCwgYGNvbnRyb2wuc2lnbmFsYCwgYGNvbnRyb2wudGltZWRPdXRgLFxuICAgKiBhbmQgYGNvbnRyb2wucmVtYWluaW5nKClgLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZSAoZm9yIHRoZSBlcnJvciBtZXNzYWdlKS5cbiAgICogQHBhcmFtIHsoYXJncz86IHtjb250cm9sOiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sfSkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBob2xkaW5nIHRoZSBsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFtob2xkVGltZW91dE1zXSAtIE1heCBob2xkIHRpbWU7IGZhbHN5IGRpc2FibGVzIHRoZSB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zKSB7XG4gICAgaWYgKCFob2xkVGltZW91dE1zIHx8IGhvbGRUaW1lb3V0TXMgPD0gMCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG5cbiAgICBsZXQgY2FsbGJhY2tTZXR0bGVkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGltZW91dCh7dGltZW91dDogaG9sZFRpbWVvdXRNc30sIGFzeW5jICh7Y29udHJvbH0pID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soe2NvbnRyb2x9KVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGNhbGxiYWNrU2V0dGxlZCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFjYWxsYmFja1NldHRsZWQgfHwgZXJyb3IgaW5zdGFuY2VvZiBUaW1lb3V0RXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IoYEFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gaGVsZCBsb25nZXIgdGhhbiAke2hvbGRUaW1lb3V0TXN9bXNgLCB7bmFtZX0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCB7QWR2aXNvcnlMb2NrQnVzeUVycm9yLCBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yLCBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9XG4iXX0=