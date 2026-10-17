// @ts-check
import timeout, { TimeoutError } from "awaitery/build/timeout.js";
import { DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS } from "./advisory-lock-bound.js";
import { AdvisoryLockBackendUnavailableError, resolveAdvisoryLockBackendPolicy, refuseAdvisoryLockTierBelowMinimum } from "./advisory-lock-backend-policy.js";
/**
 * Provenance of one advisory-lock acquisition (STC-210 design §3): every
 * held lock reports the tier that actually served it, so a fallback is
 * visible to the callback, in logs, and in `getAdvisoryLockBackendStatus()`.
 * @typedef {object} AdvisoryLockBackendProvenance
 * @property {import("./advisory-lock-backend-policy.js").AdvisoryLockTier} backend - Tier that served the acquisition.
 * @property {string} [driverType] - Database driver type when the driver tier served it.
 * @property {boolean} fencingSupported - Whether this tier carries fencing tokens (design §8); the file tier reports false rather than pretending.
 * @property {string} [holderId] - Backend holder id for the file tier.
 * @property {string} [lockName] - Lock name this provenance belongs to.
 */
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
     * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Lock and hold timeout options.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withAdvisoryLock(name, callback, args = {}) {
        const fileBackend = await this.fileBackendForName(name);
        if (fileBackend) {
            const acquired = await fileBackend.acquire(name, { timeoutMs: this.fileAcquireTimeoutMs(args) });
            if (!acquired) {
                throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)} on the file tier`, { name });
            }
            const lockBackend = this.fileProvenance(fileBackend, name);
            this.configuration.recordAdvisoryLockAcquisition({ backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name });
            return await this.runLockedCallback({ callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await fileBackend.release(name) });
        }
        return await this.withLockConnection(args, async (connection) => {
            const lockBackend = this.driverProvenance(connection);
            this.assertDriverTierEligible(name, lockBackend);
            const acquired = await connection.acquireAdvisoryLock(name, args);
            if (!acquired) {
                throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, { name });
            }
            this.configuration.recordAdvisoryLockAcquisition({ backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name });
            return await this.runLockedCallback({ callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await connection.releaseAdvisoryLock(name) });
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
     * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async withAdvisoryLockOrFail(name, callback, args = {}) {
        const fileBackend = await this.fileBackendForName(name);
        if (fileBackend) {
            const acquired = await fileBackend.tryAcquire(name);
            if (!acquired) {
                throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held on the file tier`, { name });
            }
            const lockBackend = this.fileProvenance(fileBackend, name);
            this.configuration.recordAdvisoryLockAcquisition({ backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name });
            return await this.runLockedCallback({ callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await fileBackend.release(name) });
        }
        return await this.withLockConnection(args, async (connection) => {
            const lockBackend = this.driverProvenance(connection);
            this.assertDriverTierEligible(name, lockBackend);
            const acquired = await connection.tryAcquireAdvisoryLock(name);
            if (!acquired) {
                throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, { name });
            }
            this.configuration.recordAdvisoryLockAcquisition({ backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name });
            return await this.runLockedCallback({ callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await connection.releaseAdvisoryLock(name) });
        });
    }
    /**
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
     * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
     * @returns {Promise<{acquired: true, result: T} | {acquired: false, reason: "contended", lockName: string}>} - Either the held-callback result or the defer outcome.
     */
    async withAdvisoryLockOrDefer(name, callback, args = {}) {
        const fileBackend = await this.fileBackendForName(name);
        if (fileBackend) {
            const acquired = await fileBackend.acquire(name, { timeoutMs: 0 });
            if (!acquired)
                return { acquired: false, reason: "contended", lockName: name };
            const lockBackend = this.fileProvenance(fileBackend, name);
            this.configuration.recordAdvisoryLockAcquisition({ backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name });
            const result = await this.runLockedCallback({ callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await fileBackend.release(name) });
            return { acquired: true, result };
        }
        return await this.withLockConnection(args, async (connection) => {
            const acquired = await connection.tryAcquireAdvisoryLock(name);
            if (!acquired)
                return { acquired: false, reason: "contended", lockName: name };
            const lockBackend = this.driverProvenance(connection);
            this.assertDriverTierEligible(name, lockBackend);
            this.configuration.recordAdvisoryLockAcquisition({ backend: lockBackend.backend, fencingSupported: lockBackend.fencingSupported, lockName: name });
            const result = await this.runLockedCallback({ callback, holdTimeoutMs: args.holdTimeoutMs, lockBackend, name, release: async () => await connection.releaseAdvisoryLock(name) });
            return { acquired: true, result };
        });
    }
    /**
     * Runs the lock holder callback and releases the lock from its owning backend.
     * @template T
     * @param {{callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, holdTimeoutMs?: number | null, lockBackend: AdvisoryLockBackendProvenance, name: string, release: () => Promise<unknown>}} args - Locked callback args.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    async runLockedCallback({ callback, holdTimeoutMs, lockBackend, name, release }) {
        try {
            return await AdvisoryLockRunner.runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs, lockBackend);
        }
        finally {
            await release();
        }
    }
    /**
     * Resolves the backend policy for one lock name and returns the file
     * backend when the name explicitly opts into the file tier
     * (`preferredTier: "file"` plus `advisoryLocks.backends.file.enabled: true`).
     * A name whose declared minimum tier is cross-host is refused loudly
     * (`AdvisoryLockMinTierRefusedError`) before any contact with the file
     * tier. A name that prefers the file tier while the backend is disabled
     * moves to the driver path (a stronger-or-equal tier), never the other way
     * around. Nothing here ever auto-enables the file tier.
     * @param {string} name - Lock name.
     * @returns {Promise<import("./advisory-lock-file-backend.js").default | null>} - Resolves with the file backend serving this name, or null for the driver path.
     */
    async fileBackendForName(name) {
        const policy = resolveAdvisoryLockBackendPolicy(name, this.configuration.getAdvisoryLockPolicy());
        if (policy.preferredTier !== "file")
            return null;
        if (!advisoryLockPolicyAllowsFileTier(policy)) {
            refuseAdvisoryLockTierBelowMinimum({
                configuration: this.configuration,
                lockName: name,
                minTier: policy.minTier,
                requestedBackend: "file"
            });
        }
        const backend = await this.configuration.getAdvisoryLockFileBackend();
        if (!backend) {
            // Preferred tier unavailable: fail *upward* to the driver path (a
            // stronger-or-equal tier), never downward. If the driver cannot satisfy
            // the minimum either, `assertDriverTierEligible` throws
            // `AdvisoryLockBackendUnavailableError` on the driver path.
            return null;
        }
        return backend;
    }
    /**
     * Fail-closed check on the driver path (design §9): an undeclared lock name
     * keeps today's behavior (any driver serves it — full backward
     * compatibility), but a name with an explicit policy entry is refused with
     * `AdvisoryLockBackendUnavailableError` when the configured driver cannot
     * satisfy its minimum tier (e.g. `minTier: "driver-native"` on a SQLite
     * driver, which has no native advisory-lock primitive).
     * @param {string} name - Lock name.
     * @param {AdvisoryLockBackendProvenance} lockBackend - Tier the driver path would serve with.
     * @returns {void}
     */
    assertDriverTierEligible(name, lockBackend) {
        const policy = resolveAdvisoryLockBackendPolicy(name, this.configuration.getAdvisoryLockPolicy());
        if (!policy.entry)
            return;
        const tier = lockBackend.backend;
        if (tier === "process-local" && !policy.allowedTiers.includes("process-local")) {
            throw new AdvisoryLockBackendUnavailableError(`Advisory lock ${JSON.stringify(name)} requires minimum tier ${JSON.stringify(policy.minTier)} but the configured driver (${String(lockBackend.driverType)}) only offers the process-local tier`, { lockName: name, minTier: policy.minTier, reasons: [`driver tier ${tier} below minTier ${policy.minTier}`] });
        }
    }
    /**
     * Resolves the wait bound for a file-tier acquisition: an explicit caller
     * `timeoutMs` (including an explicit `null` opt-out) wins, otherwise the
     * same framework default that bounds driver acquisitions applies.
     * @param {{timeoutMs?: number | null}} args - Lock options.
     * @returns {number | null} - Wait bound in milliseconds, or `null` for an indefinite wait.
     */
    fileAcquireTimeoutMs(args) {
        if (args.timeoutMs !== undefined)
            return args.timeoutMs;
        return DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS;
    }
    /**
     * Builds the acquisition provenance for a file-tier hold. The file tier
     * cannot carry fencing tokens, so the limitation is reported on every
     * acquisition rather than silently pretended away (design §8).
     * @param {import("./advisory-lock-file-backend.js").default} backend - Backend that served the acquisition.
     * @param {string} name - Lock name.
     * @returns {AdvisoryLockBackendProvenance} - Acquisition provenance.
     */
    fileProvenance(backend, name) {
        return { backend: "file", fencingSupported: false, holderId: backend.holderId, lockName: name };
    }
    /**
     * Builds the acquisition provenance for a driver-served hold. SQLite has no
     * native advisory-lock primitive, so its emulation tier is reported as
     * `process-local` rather than pretending to be database-native.
     * @param {import("./drivers/base.js").default} connection - Connection that served the acquisition.
     * @returns {AdvisoryLockBackendProvenance} - Acquisition provenance.
     */
    driverProvenance(connection) {
        let driverType = null;
        try {
            driverType = connection.getType();
        }
        catch {
            // Test stub drivers may not implement getType(); the tier alone identifies the backend.
        }
        const tier = typeof connection.advisoryLockBackendTier === "function"
            ? connection.advisoryLockBackendTier()
            : (driverType === "sqlite" ? "process-local" : "driver-native");
        return {
            backend: /** @type {import("./advisory-lock-backend-policy.js").AdvisoryLockTier} */ (tier),
            driverType: driverType ?? undefined,
            fencingSupported: tier === "driver-native"
        };
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
     * and `control.remaining()`, plus `lockBackend` provenance for the tier that
     * served the acquisition.
     * @template T
     * @param {string} name - Lock name (for the error message).
     * @param {(args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>} callback - Callback holding the lock.
     * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
     * @param {AdvisoryLockBackendProvenance} [lockBackend] - Provenance of the acquisition serving this hold.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    static async runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs, lockBackend) {
        if (!holdTimeoutMs || holdTimeoutMs <= 0) {
            return await callback({ lockBackend: lockBackend ?? AdvisoryLockRunner.unknownBackendProvenance() });
        }
        let callbackSettled = false;
        try {
            return await timeout({ timeout: holdTimeoutMs }, async ({ control }) => {
                try {
                    return await callback({ control, lockBackend: lockBackend ?? AdvisoryLockRunner.unknownBackendProvenance() });
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
    /**
     * Neutral provenance for direct `runWithAdvisoryLockHoldTimeout` callers that
     * hold a lock acquired outside this runner.
     * @returns {AdvisoryLockBackendProvenance} - Provenance with an unknown tier.
     */
    static unknownBackendProvenance() {
        return { backend: "process-local", fencingSupported: false };
    }
}
/**
 * Runs advisory lock policy allows file tier.
 * @param {import("./advisory-lock-backend-policy.js").ResolvedAdvisoryLockBackendPolicy} policy - Resolved policy.
 * @returns {boolean} - Whether the file tier may serve this name.
 */
function advisoryLockPolicyAllowsFileTier(policy) {
    return policy.allowedTiers.includes("file");
}
export { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError };
export { AdvisoryLockBackendUnavailableError, AdvisoryLockMinTierRefusedError } from "./advisory-lock-backend-policy.js";
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1ydW5uZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDL0QsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUNMLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsa0NBQWtDLEVBQ25DLE1BQU0sbUNBQW1DLENBQUE7QUFFMUM7Ozs7Ozs7Ozs7R0FVRztBQUVIOztHQUVHO0FBQ0gsTUFBTSx3QkFBeUIsU0FBUSxLQUFLO0lBQzFDOzs7O09BSUc7SUFDSCxZQUFZLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBQztRQUN6QixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLDBCQUEwQixDQUFBO1FBQ3RDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO0lBQ3RCLENBQUM7Q0FDRjtBQUVEOztHQUVHO0FBQ0gsTUFBTSxxQkFBc0IsU0FBUSxLQUFLO0lBQ3ZDOzs7O09BSUc7SUFDSCxZQUFZLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBQztRQUN6QixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLHVCQUF1QixDQUFBO1FBQ25DLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO0lBQ3RCLENBQUM7Q0FDRjtBQUVEOztHQUVHO0FBQ0gsTUFBTSw0QkFBNkIsU0FBUSxLQUFLO0lBQzlDOzs7O09BSUc7SUFDSCxZQUFZLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBQztRQUN6QixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFH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QUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyx3QkFBd0I7UUFDN0IsT0FBTyxFQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFDLENBQUE7SUFDNUQsQ0FBQztDQUNGO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZ0NBQWdDLENBQUMsTUFBTTtJQUM5QyxPQUFPLE1BQU0sQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0FBQzdDLENBQUM7QUFFRCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsQ0FBQTtBQUN0RixPQUFPLEVBQUMsbUNBQW1DLEVBQUUsK0JBQStCLEVBQUMsTUFBTSxtQ0FBbUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgdGltZW91dCwge1RpbWVvdXRFcnJvcn0gZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHtERUZBVUxUX0FEVklTT1JZX0xPQ0tfQUNRVUlSRV9USU1FT1VUX01TfSBmcm9tIFwiLi9hZHZpc29yeS1sb2NrLWJvdW5kLmpzXCJcbmltcG9ydCB7XG4gIEFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yLFxuICByZXNvbHZlQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeSxcbiAgcmVmdXNlQWR2aXNvcnlMb2NrVGllckJlbG93TWluaW11bVxufSBmcm9tIFwiLi9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCJcblxuLyoqXG4gKiBQcm92ZW5hbmNlIG9mIG9uZSBhZHZpc29yeS1sb2NrIGFjcXVpc2l0aW9uIChTVEMtMjEwIGRlc2lnbiDCpzMpOiBldmVyeVxuICogaGVsZCBsb2NrIHJlcG9ydHMgdGhlIHRpZXIgdGhhdCBhY3R1YWxseSBzZXJ2ZWQgaXQsIHNvIGEgZmFsbGJhY2sgaXNcbiAqIHZpc2libGUgdG8gdGhlIGNhbGxiYWNrLCBpbiBsb2dzLCBhbmQgaW4gYGdldEFkdmlzb3J5TG9ja0JhY2tlbmRTdGF0dXMoKWAuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuQWR2aXNvcnlMb2NrVGllcn0gYmFja2VuZCAtIFRpZXIgdGhhdCBzZXJ2ZWQgdGhlIGFjcXVpc2l0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkcml2ZXJUeXBlXSAtIERhdGFiYXNlIGRyaXZlciB0eXBlIHdoZW4gdGhlIGRyaXZlciB0aWVyIHNlcnZlZCBpdC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZmVuY2luZ1N1cHBvcnRlZCAtIFdoZXRoZXIgdGhpcyB0aWVyIGNhcnJpZXMgZmVuY2luZyB0b2tlbnMgKGRlc2lnbiDCpzgpOyB0aGUgZmlsZSB0aWVyIHJlcG9ydHMgZmFsc2UgcmF0aGVyIHRoYW4gcHJldGVuZGluZy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaG9sZGVySWRdIC0gQmFja2VuZCBob2xkZXIgaWQgZm9yIHRoZSBmaWxlIHRpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2xvY2tOYW1lXSAtIExvY2sgbmFtZSB0aGlzIHByb3ZlbmFuY2UgYmVsb25ncyB0by5cbiAqL1xuXG4vKipcbiAqIFRocm93biB3aGVuIGFuIGFkdmlzb3J5IGxvY2sgY291bGQgbm90IGJlIGFjcXVpcmVkIGJlZm9yZSBgdGltZW91dE1zYCBlbGFwc2VkLlxuICovXG5jbGFzcyBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e25hbWU6IHN0cmluZ319IGFyZ3MgLSBUaGUgYWR2aXNvcnkgbG9jayBuYW1lIHRoYXQgdGltZWQgb3V0LlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge25hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFRocm93biB3aGVuIGB3aXRoQWR2aXNvcnlMb2NrT3JGYWlsYCBmaW5kcyB0aGUgbG9jayBhbHJlYWR5IGhlbGQuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja0J1c3lFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgdGhhdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge25hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja0J1c3lFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFRocm93biB3aGVuIGEgY2FsbGJhY2sgaG9sZHMgYW4gYWR2aXNvcnkgbG9jayBsb25nZXIgdGhhbiBgaG9sZFRpbWVvdXRNc2AuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e25hbWU6IHN0cmluZ319IGFyZ3MgLSBUaGUgYWR2aXNvcnkgbG9jayBuYW1lIHdob3NlIGhvbGQgdGltZWQgb3V0LlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge25hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JcIlxuICAgIHRoaXMubG9ja05hbWUgPSBuYW1lXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFkdmlzb3J5IGxvY2tzIG9uIHRoZSBjYWxsZXIgY29ubmVjdGlvbiBieSBkZWZhdWx0LCB1c2luZyBhIGRlZGljYXRlZFxuICogbG9jayBjb25uZWN0aW9uIHdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHJlcXVlc3RlZCBvciB3aGVuIGEgcG9zaXRpdmVcbiAqIGhvbGQgdGltZW91dCBuZWVkcyBzZXBhcmF0ZSBvd25lcnNoaXAuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEFkdmlzb3J5TG9ja1J1bm5lciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGFkdmlzb3J5LWxvY2sgcnVubmVyIGZvciBvbmUgbW9kZWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gYXJncyAtIFJ1bm5lciBkZXBlbmRlbmNpZXMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvblByb3ZpZGVyLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuY29ubmVjdGlvblByb3ZpZGVyID0gY29ubmVjdGlvblByb3ZpZGVyXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgYWZ0ZXIgYWNxdWlyaW5nIHRoZSBhZHZpc29yeSBsb2NrLCB3YWl0aW5nIHVwIHRvIGB0aW1lb3V0TXNgLlxuICAgKiBXaGVuIGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBpcyB0cnVlIHRoZSBsb2NrIGlzIGFjcXVpcmVkIG9uIGEgc3Bhd25lZFxuICAgKiBjb25uZWN0aW9uIHRoYXQgaXMgcmVsZWFzZWQgYWZ0ZXIgdGhlIGNhbGxiYWNrIGZpbmlzaGVzLCB3aGlsZSB0aGUgY2FsbGJhY2tcbiAgICogaXRzZWxmIHN0aWxsIHJ1bnMgYWdhaW5zdCB0aGUgY2FsbGVyL21vZGVsIGNvbm5lY3Rpb24uIFdoZW4gYSBgaG9sZFRpbWVvdXRNc2BcbiAgICogaXMgc2V0IHRoZSBjYWxsYmFjayByZWNlaXZlcyBhIGBUaW1lb3V0Q29udHJvbGAgZnJvbSBhd2FpdGVyeSBmb3IgY29vcGVyYXRpdmVcbiAgICogY2FuY2VsbGF0aW9uIChgY29udHJvbC5jaGVjaygpYCwgYGNvbnRyb2wuc2lnbmFsYCwgYGNvbnRyb2wudGltZWRPdXRgLFxuICAgKiBgY29udHJvbC5yZW1haW5pbmcoKWApOyBhIGRlZGljYXRlZCBjb25uZWN0aW9uIGlzIGFsc28gdXNlZCBzbyB0aW1lb3V0XG4gICAqIGNsZWFudXAgY2FuIHJlbGVhc2UgdGhlIGxvY2sgZXZlbiBpZiBjYWxsYmFjayBkYXRhYmFzZSB3b3JrIGlzIHN0dWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHsoYXJncz86IHtjb250cm9sPzogaW1wb3J0KFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiKS5UaW1lb3V0Q29udHJvbCwgbG9ja0JhY2tlbmQ6IEFkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBpbnZva2Ugd2hpbGUgdGhlIGxvY2sgaXMgaGVsZC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgaG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGRlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFufX0gW2FyZ3NdIC0gTG9jayBhbmQgaG9sZCB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhBZHZpc29yeUxvY2sobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGZpbGVCYWNrZW5kID0gYXdhaXQgdGhpcy5maWxlQmFja2VuZEZvck5hbWUobmFtZSlcblxuICAgIGlmIChmaWxlQmFja2VuZCkge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBmaWxlQmFja2VuZC5hY3F1aXJlKG5hbWUsIHt0aW1lb3V0TXM6IHRoaXMuZmlsZUFjcXVpcmVUaW1lb3V0TXMoYXJncyl9KVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3IoYFRpbWVkIG91dCB3YWl0aW5nIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IG9uIHRoZSBmaWxlIHRpZXJgLCB7bmFtZX0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxvY2tCYWNrZW5kID0gdGhpcy5maWxlUHJvdmVuYW5jZShmaWxlQmFja2VuZCwgbmFtZSlcblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtiYWNrZW5kOiBsb2NrQmFja2VuZC5iYWNrZW5kLCBmZW5jaW5nU3VwcG9ydGVkOiBsb2NrQmFja2VuZC5mZW5jaW5nU3VwcG9ydGVkLCBsb2NrTmFtZTogbmFtZX0pXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgZmlsZUJhY2tlbmQucmVsZWFzZShuYW1lKX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25zdCBsb2NrQmFja2VuZCA9IHRoaXMuZHJpdmVyUHJvdmVuYW5jZShjb25uZWN0aW9uKVxuXG4gICAgICB0aGlzLmFzc2VydERyaXZlclRpZXJFbGlnaWJsZShuYW1lLCBsb2NrQmFja2VuZClcblxuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBjb25uZWN0aW9uLmFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgYXJncylcblxuICAgICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yKGBUaW1lZCBvdXQgd2FpdGluZyBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfWAsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtiYWNrZW5kOiBsb2NrQmFja2VuZC5iYWNrZW5kLCBmZW5jaW5nU3VwcG9ydGVkOiBsb2NrQmFja2VuZC5mZW5jaW5nU3VwcG9ydGVkLCBsb2NrTmFtZTogbmFtZX0pXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBvbmx5IGlmIHRoZSBhZHZpc29yeSBsb2NrIGNhbiBiZSBhY3F1aXJlZCBpbW1lZGlhdGVseS5cbiAgICogV2hlbiBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgaXMgdHJ1ZSB0aGUgbG9jayBpcyBhY3F1aXJlZCBvbiBhIHNwYXduZWRcbiAgICogY29ubmVjdGlvbiB0aGF0IGlzIHJlbGVhc2VkIGFmdGVyIHRoZSBjYWxsYmFjayBmaW5pc2hlcywgd2hpbGUgdGhlIGNhbGxiYWNrXG4gICAqIGl0c2VsZiBzdGlsbCBydW5zIGFnYWluc3QgdGhlIGNhbGxlci9tb2RlbCBjb25uZWN0aW9uLiBXaGVuIGEgYGhvbGRUaW1lb3V0TXNgXG4gICAqIGlzIHNldCB0aGUgY2FsbGJhY2sgcmVjZWl2ZXMgYSBgVGltZW91dENvbnRyb2xgIGZyb20gYXdhaXRlcnkgZm9yIGNvb3BlcmF0aXZlXG4gICAqIGNhbmNlbGxhdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7KGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIEhvbGQgdGltZW91dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoQWR2aXNvcnlMb2NrT3JGYWlsKG5hbWUsIGNhbGxiYWNrLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCBmaWxlQmFja2VuZCA9IGF3YWl0IHRoaXMuZmlsZUJhY2tlbmRGb3JOYW1lKG5hbWUpXG5cbiAgICBpZiAoZmlsZUJhY2tlbmQpIHtcbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZmlsZUJhY2tlbmQudHJ5QWNxdWlyZShuYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tCdXN5RXJyb3IoYEFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gaXMgYWxyZWFkeSBoZWxkIG9uIHRoZSBmaWxlIHRpZXJgLCB7bmFtZX0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxvY2tCYWNrZW5kID0gdGhpcy5maWxlUHJvdmVuYW5jZShmaWxlQmFja2VuZCwgbmFtZSlcblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtiYWNrZW5kOiBsb2NrQmFja2VuZC5iYWNrZW5kLCBmZW5jaW5nU3VwcG9ydGVkOiBsb2NrQmFja2VuZC5mZW5jaW5nU3VwcG9ydGVkLCBsb2NrTmFtZTogbmFtZX0pXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgZmlsZUJhY2tlbmQucmVsZWFzZShuYW1lKX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25zdCBsb2NrQmFja2VuZCA9IHRoaXMuZHJpdmVyUHJvdmVuYW5jZShjb25uZWN0aW9uKVxuXG4gICAgICB0aGlzLmFzc2VydERyaXZlclRpZXJFbGlnaWJsZShuYW1lLCBsb2NrQmFja2VuZClcblxuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBjb25uZWN0aW9uLnRyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrQnVzeUVycm9yKGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IGlzIGFscmVhZHkgaGVsZGAsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtiYWNrZW5kOiBsb2NrQmFja2VuZC5iYWNrZW5kLCBmZW5jaW5nU3VwcG9ydGVkOiBsb2NrQmFja2VuZC5mZW5jaW5nU3VwcG9ydGVkLCBsb2NrTmFtZTogbmFtZX0pXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaWYgdGhlIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkIHdpdGhvdXQgd2FpdGluZztcbiAgICogb3RoZXJ3aXNlIHJldHVybnMgYSBge2FjcXVpcmVkOiBmYWxzZX1gIGRlZmVyIHJlc3VsdCBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICAgKlxuICAgKiBUaGlzIGlzIHRoZSBub24tdGhyb3dpbmcgY291bnRlcnBhcnQgb2YgYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIGZvciBob3RcbiAgICogcGF0aHM6IFwiaG9sZGVyIGJ1c3ksIGRlZmVyIG1lXCIgaXMgYSBmaXJzdC1jbGFzcyBvdXRjb21lLCBzbyBhIGNvbnRlbmRlZFxuICAgKiBsb2NrIHByb2R1Y2VzIHplcm8gZXhjZXB0aW9uIHRyYWZmaWMgYW5kIOKAlCBiZWNhdXNlIHRoZSBwcm9iZSBpcyBhIHNpbmdsZVxuICAgKiBpbW1lZGlhdGUgdHJ5LWFjcXVpcmUg4oCUIHplcm8gcGlubmVkIGNvbm5lY3Rpb25zLiBDYWxsZXJzIHJlc2NoZWR1bGUgdmlhXG4gICAqIHRoZWlyIG93biBldmVudC1kcml2ZW4gcmV0cnkgbWFjaGluZXJ5LiBUaGUgcmVzdWx0IGZvcm0gaXMgaWRlbnRpY2FsXG4gICAqIGFjcm9zcyB0aWVyczogdGhlIGRyaXZlcidzIGB0cnlBY3F1aXJlQWR2aXNvcnlMb2NrYCBtYXBzIHBlci10aWVyIChNeVNRTFxuICAgKiBgR0VUX0xPQ0sobmFtZSwgMClgLCBQb3N0Z3JlU1FMIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AsIFNRTCBTZXJ2ZXJcbiAgICogYHNwX2dldGFwcGxvY2sgQExvY2tUaW1lb3V0ID0gMGAsIFNRTGl0ZSBwcm9jZXNzLWxvY2FsIHF1ZXVlLCBTUUxpdGUgTm9kZVxuICAgKiBmaWxlIGxvY2spLCBzbyBhIGNhbGxlciBuZXZlciBicmFuY2hlcyBvbiB0aGUgYmFja2VuZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7KGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIEhvbGQgdGltZW91dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YWNxdWlyZWQ6IHRydWUsIHJlc3VsdDogVH0gfCB7YWNxdWlyZWQ6IGZhbHNlLCByZWFzb246IFwiY29udGVuZGVkXCIsIGxvY2tOYW1lOiBzdHJpbmd9Pn0gLSBFaXRoZXIgdGhlIGhlbGQtY2FsbGJhY2sgcmVzdWx0IG9yIHRoZSBkZWZlciBvdXRjb21lLlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9ja09yRGVmZXIobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGZpbGVCYWNrZW5kID0gYXdhaXQgdGhpcy5maWxlQmFja2VuZEZvck5hbWUobmFtZSlcblxuICAgIGlmIChmaWxlQmFja2VuZCkge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBmaWxlQmFja2VuZC5hY3F1aXJlKG5hbWUsIHt0aW1lb3V0TXM6IDB9KVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSByZXR1cm4ge2FjcXVpcmVkOiBmYWxzZSwgcmVhc29uOiBcImNvbnRlbmRlZFwiLCBsb2NrTmFtZTogbmFtZX1cblxuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmZpbGVQcm92ZW5hbmNlKGZpbGVCYWNrZW5kLCBuYW1lKVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucmVjb3JkQWR2aXNvcnlMb2NrQWNxdWlzaXRpb24oe2JhY2tlbmQ6IGxvY2tCYWNrZW5kLmJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQ6IGxvY2tCYWNrZW5kLmZlbmNpbmdTdXBwb3J0ZWQsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWUsIHJlbGVhc2U6IGFzeW5jICgpID0+IGF3YWl0IGZpbGVCYWNrZW5kLnJlbGVhc2UobmFtZSl9KVxuXG4gICAgICByZXR1cm4ge2FjcXVpcmVkOiB0cnVlLCByZXN1bHR9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGNvbm5lY3Rpb24udHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSByZXR1cm4ge2FjcXVpcmVkOiBmYWxzZSwgcmVhc29uOiBcImNvbnRlbmRlZFwiLCBsb2NrTmFtZTogbmFtZX1cblxuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmRyaXZlclByb3ZlbmFuY2UoY29ubmVjdGlvbilcblxuICAgICAgdGhpcy5hc3NlcnREcml2ZXJUaWVyRWxpZ2libGUobmFtZSwgbG9ja0JhY2tlbmQpXG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5yZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7YmFja2VuZDogbG9ja0JhY2tlbmQuYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZDogbG9ja0JhY2tlbmQuZmVuY2luZ1N1cHBvcnRlZCwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpfSlcblxuICAgICAgcmV0dXJuIHthY3F1aXJlZDogdHJ1ZSwgcmVzdWx0fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbG9jayBob2xkZXIgY2FsbGJhY2sgYW5kIHJlbGVhc2VzIHRoZSBsb2NrIGZyb20gaXRzIG93bmluZyBiYWNrZW5kLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogKGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD4sIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2UsIG5hbWU6IHN0cmluZywgcmVsZWFzZTogKCkgPT4gUHJvbWlzZTx1bmtub3duPn19IGFyZ3MgLSBMb2NrZWQgY2FsbGJhY2sgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZX0pIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IEFkdmlzb3J5TG9ja1J1bm5lci5ydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCByZWxlYXNlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGJhY2tlbmQgcG9saWN5IGZvciBvbmUgbG9jayBuYW1lIGFuZCByZXR1cm5zIHRoZSBmaWxlXG4gICAqIGJhY2tlbmQgd2hlbiB0aGUgbmFtZSBleHBsaWNpdGx5IG9wdHMgaW50byB0aGUgZmlsZSB0aWVyXG4gICAqIChgcHJlZmVycmVkVGllcjogXCJmaWxlXCJgIHBsdXMgYGFkdmlzb3J5TG9ja3MuYmFja2VuZHMuZmlsZS5lbmFibGVkOiB0cnVlYCkuXG4gICAqIEEgbmFtZSB3aG9zZSBkZWNsYXJlZCBtaW5pbXVtIHRpZXIgaXMgY3Jvc3MtaG9zdCBpcyByZWZ1c2VkIGxvdWRseVxuICAgKiAoYEFkdmlzb3J5TG9ja01pblRpZXJSZWZ1c2VkRXJyb3JgKSBiZWZvcmUgYW55IGNvbnRhY3Qgd2l0aCB0aGUgZmlsZVxuICAgKiB0aWVyLiBBIG5hbWUgdGhhdCBwcmVmZXJzIHRoZSBmaWxlIHRpZXIgd2hpbGUgdGhlIGJhY2tlbmQgaXMgZGlzYWJsZWRcbiAgICogbW92ZXMgdG8gdGhlIGRyaXZlciBwYXRoIChhIHN0cm9uZ2VyLW9yLWVxdWFsIHRpZXIpLCBuZXZlciB0aGUgb3RoZXIgd2F5XG4gICAqIGFyb3VuZC4gTm90aGluZyBoZXJlIGV2ZXIgYXV0by1lbmFibGVzIHRoZSBmaWxlIHRpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaWxlIGJhY2tlbmQgc2VydmluZyB0aGlzIG5hbWUsIG9yIG51bGwgZm9yIHRoZSBkcml2ZXIgcGF0aC5cbiAgICovXG4gIGFzeW5jIGZpbGVCYWNrZW5kRm9yTmFtZShuYW1lKSB7XG4gICAgY29uc3QgcG9saWN5ID0gcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3kobmFtZSwgdGhpcy5jb25maWd1cmF0aW9uLmdldEFkdmlzb3J5TG9ja1BvbGljeSgpKVxuXG4gICAgaWYgKHBvbGljeS5wcmVmZXJyZWRUaWVyICE9PSBcImZpbGVcIikgcmV0dXJuIG51bGxcblxuICAgIGlmICghYWR2aXNvcnlMb2NrUG9saWN5QWxsb3dzRmlsZVRpZXIocG9saWN5KSkge1xuICAgICAgcmVmdXNlQWR2aXNvcnlMb2NrVGllckJlbG93TWluaW11bSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbG9ja05hbWU6IG5hbWUsXG4gICAgICAgIG1pblRpZXI6IHBvbGljeS5taW5UaWVyLFxuICAgICAgICByZXF1ZXN0ZWRCYWNrZW5kOiBcImZpbGVcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBiYWNrZW5kID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKClcblxuICAgIGlmICghYmFja2VuZCkge1xuICAgICAgLy8gUHJlZmVycmVkIHRpZXIgdW5hdmFpbGFibGU6IGZhaWwgKnVwd2FyZCogdG8gdGhlIGRyaXZlciBwYXRoIChhXG4gICAgICAvLyBzdHJvbmdlci1vci1lcXVhbCB0aWVyKSwgbmV2ZXIgZG93bndhcmQuIElmIHRoZSBkcml2ZXIgY2Fubm90IHNhdGlzZnlcbiAgICAgIC8vIHRoZSBtaW5pbXVtIGVpdGhlciwgYGFzc2VydERyaXZlclRpZXJFbGlnaWJsZWAgdGhyb3dzXG4gICAgICAvLyBgQWR2aXNvcnlMb2NrQmFja2VuZFVuYXZhaWxhYmxlRXJyb3JgIG9uIHRoZSBkcml2ZXIgcGF0aC5cbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIGJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWlsLWNsb3NlZCBjaGVjayBvbiB0aGUgZHJpdmVyIHBhdGggKGRlc2lnbiDCpzkpOiBhbiB1bmRlY2xhcmVkIGxvY2sgbmFtZVxuICAgKiBrZWVwcyB0b2RheSdzIGJlaGF2aW9yIChhbnkgZHJpdmVyIHNlcnZlcyBpdCDigJQgZnVsbCBiYWNrd2FyZFxuICAgKiBjb21wYXRpYmlsaXR5KSwgYnV0IGEgbmFtZSB3aXRoIGFuIGV4cGxpY2l0IHBvbGljeSBlbnRyeSBpcyByZWZ1c2VkIHdpdGhcbiAgICogYEFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yYCB3aGVuIHRoZSBjb25maWd1cmVkIGRyaXZlciBjYW5ub3RcbiAgICogc2F0aXNmeSBpdHMgbWluaW11bSB0aWVyIChlLmcuIGBtaW5UaWVyOiBcImRyaXZlci1uYXRpdmVcImAgb24gYSBTUUxpdGVcbiAgICogZHJpdmVyLCB3aGljaCBoYXMgbm8gbmF0aXZlIGFkdmlzb3J5LWxvY2sgcHJpbWl0aXZlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7QWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9IGxvY2tCYWNrZW5kIC0gVGllciB0aGUgZHJpdmVyIHBhdGggd291bGQgc2VydmUgd2l0aC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnREcml2ZXJUaWVyRWxpZ2libGUobmFtZSwgbG9ja0JhY2tlbmQpIHtcbiAgICBjb25zdCBwb2xpY3kgPSByZXNvbHZlQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeShuYW1lLCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QWR2aXNvcnlMb2NrUG9saWN5KCkpXG5cbiAgICBpZiAoIXBvbGljeS5lbnRyeSkgcmV0dXJuXG5cbiAgICBjb25zdCB0aWVyID0gbG9ja0JhY2tlbmQuYmFja2VuZFxuXG4gICAgaWYgKHRpZXIgPT09IFwicHJvY2Vzcy1sb2NhbFwiICYmICFwb2xpY3kuYWxsb3dlZFRpZXJzLmluY2x1ZGVzKFwicHJvY2Vzcy1sb2NhbFwiKSkge1xuICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yKFxuICAgICAgICBgQWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSByZXF1aXJlcyBtaW5pbXVtIHRpZXIgJHtKU09OLnN0cmluZ2lmeShwb2xpY3kubWluVGllcil9IGJ1dCB0aGUgY29uZmlndXJlZCBkcml2ZXIgKCR7U3RyaW5nKGxvY2tCYWNrZW5kLmRyaXZlclR5cGUpfSkgb25seSBvZmZlcnMgdGhlIHByb2Nlc3MtbG9jYWwgdGllcmAsXG4gICAgICAgIHtsb2NrTmFtZTogbmFtZSwgbWluVGllcjogcG9saWN5Lm1pblRpZXIsIHJlYXNvbnM6IFtgZHJpdmVyIHRpZXIgJHt0aWVyfSBiZWxvdyBtaW5UaWVyICR7cG9saWN5Lm1pblRpZXJ9YF19XG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSB3YWl0IGJvdW5kIGZvciBhIGZpbGUtdGllciBhY3F1aXNpdGlvbjogYW4gZXhwbGljaXQgY2FsbGVyXG4gICAqIGB0aW1lb3V0TXNgIChpbmNsdWRpbmcgYW4gZXhwbGljaXQgYG51bGxgIG9wdC1vdXQpIHdpbnMsIG90aGVyd2lzZSB0aGVcbiAgICogc2FtZSBmcmFtZXdvcmsgZGVmYXVsdCB0aGF0IGJvdW5kcyBkcml2ZXIgYWNxdWlzaXRpb25zIGFwcGxpZXMuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBhcmdzIC0gTG9jayBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBXYWl0IGJvdW5kIGluIG1pbGxpc2Vjb25kcywgb3IgYG51bGxgIGZvciBhbiBpbmRlZmluaXRlIHdhaXQuXG4gICAqL1xuICBmaWxlQWNxdWlyZVRpbWVvdXRNcyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MudGltZW91dE1zICE9PSB1bmRlZmluZWQpIHJldHVybiBhcmdzLnRpbWVvdXRNc1xuXG4gICAgcmV0dXJuIERFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGFjcXVpc2l0aW9uIHByb3ZlbmFuY2UgZm9yIGEgZmlsZS10aWVyIGhvbGQuIFRoZSBmaWxlIHRpZXJcbiAgICogY2Fubm90IGNhcnJ5IGZlbmNpbmcgdG9rZW5zLCBzbyB0aGUgbGltaXRhdGlvbiBpcyByZXBvcnRlZCBvbiBldmVyeVxuICAgKiBhY3F1aXNpdGlvbiByYXRoZXIgdGhhbiBzaWxlbnRseSBwcmV0ZW5kZWQgYXdheSAoZGVzaWduIMKnOCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0fSBiYWNrZW5kIC0gQmFja2VuZCB0aGF0IHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7QWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9IC0gQWNxdWlzaXRpb24gcHJvdmVuYW5jZS5cbiAgICovXG4gIGZpbGVQcm92ZW5hbmNlKGJhY2tlbmQsIG5hbWUpIHtcbiAgICByZXR1cm4ge2JhY2tlbmQ6IFwiZmlsZVwiLCBmZW5jaW5nU3VwcG9ydGVkOiBmYWxzZSwgaG9sZGVySWQ6IGJhY2tlbmQuaG9sZGVySWQsIGxvY2tOYW1lOiBuYW1lfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYWNxdWlzaXRpb24gcHJvdmVuYW5jZSBmb3IgYSBkcml2ZXItc2VydmVkIGhvbGQuIFNRTGl0ZSBoYXMgbm9cbiAgICogbmF0aXZlIGFkdmlzb3J5LWxvY2sgcHJpbWl0aXZlLCBzbyBpdHMgZW11bGF0aW9uIHRpZXIgaXMgcmVwb3J0ZWQgYXNcbiAgICogYHByb2Nlc3MtbG9jYWxgIHJhdGhlciB0aGFuIHByZXRlbmRpbmcgdG8gYmUgZGF0YWJhc2UtbmF0aXZlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRoYXQgc2VydmVkIHRoZSBhY3F1aXNpdGlvbi5cbiAgICogQHJldHVybnMge0Fkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSAtIEFjcXVpc2l0aW9uIHByb3ZlbmFuY2UuXG4gICAqL1xuICBkcml2ZXJQcm92ZW5hbmNlKGNvbm5lY3Rpb24pIHtcbiAgICBsZXQgZHJpdmVyVHlwZSA9IG51bGxcblxuICAgIHRyeSB7XG4gICAgICBkcml2ZXJUeXBlID0gY29ubmVjdGlvbi5nZXRUeXBlKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFRlc3Qgc3R1YiBkcml2ZXJzIG1heSBub3QgaW1wbGVtZW50IGdldFR5cGUoKTsgdGhlIHRpZXIgYWxvbmUgaWRlbnRpZmllcyB0aGUgYmFja2VuZC5cbiAgICB9XG5cbiAgICBjb25zdCB0aWVyID0gdHlwZW9mIGNvbm5lY3Rpb24uYWR2aXNvcnlMb2NrQmFja2VuZFRpZXIgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBjb25uZWN0aW9uLmFkdmlzb3J5TG9ja0JhY2tlbmRUaWVyKClcbiAgICAgIDogKGRyaXZlclR5cGUgPT09IFwic3FsaXRlXCIgPyBcInByb2Nlc3MtbG9jYWxcIiA6IFwiZHJpdmVyLW5hdGl2ZVwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXJ9ICovICh0aWVyKSxcbiAgICAgIGRyaXZlclR5cGU6IGRyaXZlclR5cGUgPz8gdW5kZWZpbmVkLFxuICAgICAgZmVuY2luZ1N1cHBvcnRlZDogdGllciA9PT0gXCJkcml2ZXItbmF0aXZlXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2NrIHdvcmsgb24gdGhlIGNhbGxlciBjb25uZWN0aW9uIHVubGVzcyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgaXNcbiAgICogcmVxdWVzdGVkIG9yIGEgcG9zaXRpdmUgaG9sZCB0aW1lb3V0IG5lZWRzIGl0cyBvd24gbG9jayBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbiwgaG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBhcmdzIC0gTG9jayBjb25uZWN0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgcmVjZWl2aW5nIHRoZSBjb25uZWN0aW9uIHRoYXQgb3ducyB0aGUgYWR2aXNvcnkgbG9jay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgaG9sZFRpbWVvdXRNcyA9IGFyZ3MuaG9sZFRpbWVvdXRNc1xuXG4gICAgaWYgKGFyZ3MuZGVkaWNhdGVkQ29ubmVjdGlvbiB8fCAoaG9sZFRpbWVvdXRNcyAmJiBob2xkVGltZW91dE1zID4gMCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEZWRpY2F0ZWRDb25uZWN0aW9uKGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh0aGlzLmNvbm5lY3Rpb25Qcm92aWRlcigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFNwYXducyBhIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24gYW5kIGNsb3NlcyBpdCBhZnRlciBsb2NrIHdvcmsgY29tcGxldGVzXG4gICAqIHdoZW4gdGhlIHNwYXduZWQgZHJpdmVyIG93bnMgdGhlIHVuZGVybHlpbmcgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoY29ubmVjdGlvbjogaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0aGF0IHJlY2VpdmVzIHRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGVkaWNhdGVkQ29ubmVjdGlvbihjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKS5zcGF3bkNvbm5lY3Rpb24oKVxuXG4gICAgLy8gVGhlIHNwYXduZWQgZHJpdmVyIG93bnMgaXRzIHBoeXNpY2FsIGNvbm5lY3Rpb24gdW5sZXNzIGl0IGJvcnJvd3MgYSBzaGFyZWQgb25lXG4gICAgLy8gdmlhIGBnZXRDb25uZWN0aW9uYC4gQW4gb3duZWQgY29ubmVjdGlvbiBsaXZlcyBvdXRzaWRlIHRoZSBwb29scycgdHJhY2tlZCBzZXRzLFxuICAgIC8vIHNvIHJlZ2lzdGVyIGl0IHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQ6IGEgc2h1dGRvd24gdGhlbiBjbG9zZXMgaXQgKHJlbGVhc2luZyB0aGVcbiAgICAvLyBsb2NrKSBpbnN0ZWFkIG9mIG9ycGhhbmluZyBhIGhhbGYtb3BlbiBzZXNzaW9uIHVudGlsIHRoZSBEQiBgd2FpdF90aW1lb3V0YC5cbiAgICBjb25zdCBvd25zQ29ubmVjdGlvbiA9ICFjb25uZWN0aW9uLmdldEFyZ3MoKS5nZXRDb25uZWN0aW9uXG5cbiAgICBpZiAob3duc0Nvbm5lY3Rpb24pIHRoaXMuY29uZmlndXJhdGlvbi5yZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbilcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKG93bnNDb25uZWN0aW9uKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi51bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBgY2FsbGJhY2tgLCByZWplY3Rpbmcgd2l0aCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaWYgaXQgaGFzXG4gICAqIG5vdCBzZXR0bGVkIHdpdGhpbiBgaG9sZFRpbWVvdXRNc2AuIFRoZSBjYWxsYmFjayBpcyBub3QgY2FuY2VsbGVkOyBjYWxsZXJzXG4gICAqIHVzZSBhIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb24gc28gdGhlIGxvY2sgY2FuIHN0aWxsIGJlIHJlbGVhc2VkLlxuICAgKlxuICAgKiBUaGUgY2FsbGJhY2sgcmVjZWl2ZXMgYSBgVGltZW91dENvbnRyb2xgIGZyb20gYXdhaXRlcnksIGVuYWJsaW5nIGNvb3BlcmF0aXZlXG4gICAqIGNhbmNlbGxhdGlvbiB2aWEgYGNvbnRyb2wuY2hlY2soKWAsIGBjb250cm9sLnNpZ25hbGAsIGBjb250cm9sLnRpbWVkT3V0YCxcbiAgICogYW5kIGBjb250cm9sLnJlbWFpbmluZygpYCwgcGx1cyBgbG9ja0JhY2tlbmRgIHByb3ZlbmFuY2UgZm9yIHRoZSB0aWVyIHRoYXRcbiAgICogc2VydmVkIHRoZSBhY3F1aXNpdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUgKGZvciB0aGUgZXJyb3IgbWVzc2FnZSkuXG4gICAqIEBwYXJhbSB7KGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgaG9sZGluZyB0aGUgbG9jay5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbaG9sZFRpbWVvdXRNc10gLSBNYXggaG9sZCB0aW1lOyBmYWxzeSBkaXNhYmxlcyB0aGUgdGltZW91dC5cbiAgICogQHBhcmFtIHtBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0gW2xvY2tCYWNrZW5kXSAtIFByb3ZlbmFuY2Ugb2YgdGhlIGFjcXVpc2l0aW9uIHNlcnZpbmcgdGhpcyBob2xkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCkge1xuICAgIGlmICghaG9sZFRpbWVvdXRNcyB8fCBob2xkVGltZW91dE1zIDw9IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7bG9ja0JhY2tlbmQ6IGxvY2tCYWNrZW5kID8/IEFkdmlzb3J5TG9ja1J1bm5lci51bmtub3duQmFja2VuZFByb3ZlbmFuY2UoKX0pXG4gICAgfVxuXG4gICAgbGV0IGNhbGxiYWNrU2V0dGxlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IGhvbGRUaW1lb3V0TXN9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHtjb250cm9sLCBsb2NrQmFja2VuZDogbG9ja0JhY2tlbmQgPz8gQWR2aXNvcnlMb2NrUnVubmVyLnVua25vd25CYWNrZW5kUHJvdmVuYW5jZSgpfSlcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBjYWxsYmFja1NldHRsZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghY2FsbGJhY2tTZXR0bGVkIHx8IGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yKGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IGhlbGQgbG9uZ2VyIHRoYW4gJHtob2xkVGltZW91dE1zfW1zYCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOZXV0cmFsIHByb3ZlbmFuY2UgZm9yIGRpcmVjdCBgcnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0YCBjYWxsZXJzIHRoYXRcbiAgICogaG9sZCBhIGxvY2sgYWNxdWlyZWQgb3V0c2lkZSB0aGlzIHJ1bm5lci5cbiAgICogQHJldHVybnMge0Fkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSAtIFByb3ZlbmFuY2Ugd2l0aCBhbiB1bmtub3duIHRpZXIuXG4gICAqL1xuICBzdGF0aWMgdW5rbm93bkJhY2tlbmRQcm92ZW5hbmNlKCkge1xuICAgIHJldHVybiB7YmFja2VuZDogXCJwcm9jZXNzLWxvY2FsXCIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGZhbHNlfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhZHZpc29yeSBsb2NrIHBvbGljeSBhbGxvd3MgZmlsZSB0aWVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuUmVzb2x2ZWRBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5fSBwb2xpY3kgLSBSZXNvbHZlZCBwb2xpY3kuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmaWxlIHRpZXIgbWF5IHNlcnZlIHRoaXMgbmFtZS5cbiAqL1xuZnVuY3Rpb24gYWR2aXNvcnlMb2NrUG9saWN5QWxsb3dzRmlsZVRpZXIocG9saWN5KSB7XG4gIHJldHVybiBwb2xpY3kuYWxsb3dlZFRpZXJzLmluY2x1ZGVzKFwiZmlsZVwiKVxufVxuXG5leHBvcnQge0Fkdmlzb3J5TG9ja0J1c3lFcnJvciwgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciwgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yfVxuZXhwb3J0IHtBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvciwgQWR2aXNvcnlMb2NrTWluVGllclJlZnVzZWRFcnJvcn0gZnJvbSBcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiXG4iXX0=