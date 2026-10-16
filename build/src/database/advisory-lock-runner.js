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
        const driverType = connection.getType();
        return {
            backend: driverType === "sqlite" ? "process-local" : "driver-native",
            driverType,
            fencingSupported: driverType !== "sqlite"
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1ydW5uZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDL0QsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUNMLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsa0NBQWtDLEVBQ25DLE1BQU0sbUNBQW1DLENBQUE7QUFFMUM7Ozs7Ozs7Ozs7R0FVRztBQUVIOztHQUVHO0FBQ0gsTUFBTSx3QkFBeUIsU0FBUSxLQUFLO0lBQzFDOzs7O09BSUc7SUFDSCxZQUFZLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBQztRQUN6QixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLDBCQUEwQixDQUFBO1FBQ3RDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO0lBQ3RCLENBQUM7Q0FDRjtBQUVEOztHQUVHO0FBQ0gsTUFBTSxxQkFBc0IsU0FBUSxLQUFLO0lBQ3ZDOzs7O09BSUc7SUFDSCxZQUFZLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBQztRQUN6QixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLHVCQUF1QixDQUFBO1FBQ25DLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO0lBQ3RCLENBQUM7Q0FDRjtBQUVEOztHQUVHO0FBQ0gsTUFBTSw0QkFBNkIsU0FBUSxLQUFLO0lBQzlDOzs7O09BSUc7SUFDSCxZQUFZLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBQztRQUN6QixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLDhCQUE4QixDQUFBO1FBQzFDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO0lBQ3RCLENBQUM7Q0FDRjtBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGtCQUFrQjtJQUNyQzs7O09BR0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLGtCQUFrQixFQUFFLGtCQUFrQixFQUFDO1FBQ2pFLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxrQkFBa0IsQ0FBQTtRQUM1QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsa0JBQWtCLENBQUE7SUFDOUMsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7OztPQWNHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxHQUFHLEVBQUU7UUFDOUMsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFdkQsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixNQUFNLFFBQVEsR0FBRyxNQUFNLFdBQVcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsRUFBQyxDQUFDLENBQUE7WUFFOUYsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUNkLE1BQU0sSUFBSSx3QkFBd0IsQ0FBQyx1Q0FBdUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsRUFBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQzVILENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUUxRCxJQUFJLENBQUMsYUFBYSxDQUFDLDZCQUE2QixDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsV0FBVyxDQUFDLGdCQUFnQixFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBRWhKLE9BQU8sTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxRQUFRLEVBQUUsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLFdBQVcsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUMsQ0FBQyxDQUFBO1FBQzdKLENBQUM7UUFFRCxPQUFPLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLEVBQUU7WUFDOUQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBRXJELElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFFaEQsTUFBTSxRQUFRLEdBQUcsTUFBTSxVQUFVLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO1lBRWpFLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDZCxNQUFNLElBQUksd0JBQXdCLENBQUMsdUNBQXVDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7WUFDM0csQ0FBQztZQUVELElBQUksQ0FBQyxhQUFhLENBQUMsNkJBQTZCLENBQUMsRUFBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFFaEosT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sVUFBVSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUN4SyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEdBQUcsRUFBRTtRQUNwRCxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2RCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE1BQU0sUUFBUSxHQUFHLE1BQU0sV0FBVyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUVuRCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2QsTUFBTSxJQUFJLHFCQUFxQixDQUFDLGlCQUFpQixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxtQ0FBbUMsRUFBRSxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7WUFDbkgsQ0FBQztZQUVELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxDQUFBO1lBRTFELElBQUksQ0FBQyxhQUFhLENBQUMsNkJBQTZCLENBQUMsRUFBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFFaEosT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sV0FBVyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBQyxDQUFDLENBQUE7UUFDN0osQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsRUFBRTtZQUM5RCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFckQsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQTtZQUVoRCxNQUFNLFFBQVEsR0FBRyxNQUFNLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUU5RCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2QsTUFBTSxJQUFJLHFCQUFxQixDQUFDLGlCQUFpQixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7WUFDbEcsQ0FBQztZQUVELElBQUksQ0FBQyxhQUFhLENBQUMsNkJBQTZCLENBQUMsRUFBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFFaEosT0FBTyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sVUFBVSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUN4SyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxhQUFhLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDM0UsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLGtCQUFrQixDQUFDLDhCQUE4QixDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1FBQzVHLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sT0FBTyxFQUFFLENBQUE7UUFDakIsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJO1FBQzNCLE1BQU0sTUFBTSxHQUFHLGdDQUFnQyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQTtRQUVqRyxJQUFJLE1BQU0sQ0FBQyxhQUFhLEtBQUssTUFBTTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRWhELElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQzlDLGtDQUFrQyxDQUFDO2dCQUNqQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQ2pDLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTztnQkFDdkIsZ0JBQWdCLEVBQUUsTUFBTTthQUN6QixDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLDBCQUEwQixFQUFFLENBQUE7UUFFckUsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2Isa0VBQWtFO1lBQ2xFLHdFQUF3RTtZQUN4RSx3REFBd0Q7WUFDeEQsNERBQTREO1lBQzVELE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsd0JBQXdCLENBQUMsSUFBSSxFQUFFLFdBQVc7UUFDeEMsTUFBTSxNQUFNLEdBQUcsZ0NBQWdDLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxDQUFBO1FBRWpHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSztZQUFFLE9BQU07UUFFekIsTUFBTSxJQUFJLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FBQTtRQUVoQyxJQUFJLElBQUksS0FBSyxlQUFlLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1lBQy9FLE1BQU0sSUFBSSxtQ0FBbUMsQ0FDM0MsaUJBQWlCLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLDBCQUEwQixJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsK0JBQStCLE1BQU0sQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLHNDQUFzQyxFQUNoTSxFQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUMsZUFBZSxJQUFJLGtCQUFrQixNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBQyxDQUM1RyxDQUFBO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxvQkFBb0IsQ0FBQyxJQUFJO1FBQ3ZCLElBQUksSUFBSSxDQUFDLFNBQVMsS0FBSyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFBO1FBRXZELE9BQU8sd0NBQXdDLENBQUE7SUFDakQsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxjQUFjLENBQUMsT0FBTyxFQUFFLElBQUk7UUFDMUIsT0FBTyxFQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUMvRixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsZ0JBQWdCLENBQUMsVUFBVTtRQUN6QixNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFdkMsT0FBTztZQUNMLE9BQU8sRUFBRSxVQUFVLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLGVBQWU7WUFDcEUsVUFBVTtZQUNWLGdCQUFnQixFQUFFLFVBQVUsS0FBSyxRQUFRO1NBQzFDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsUUFBUTtRQUNyQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFBO1FBRXhDLElBQUksSUFBSSxDQUFDLG1CQUFtQixJQUFJLENBQUMsYUFBYSxJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3JFLE9BQU8sTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDckQsQ0FBQztRQUVELE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQTtJQUNsRCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLFFBQVE7UUFDcEMsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUV0RyxpRkFBaUY7UUFDakYsa0ZBQWtGO1FBQ2xGLGtGQUFrRjtRQUNsRiw4RUFBOEU7UUFDOUUsTUFBTSxjQUFjLEdBQUcsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsYUFBYSxDQUFBO1FBRTFELElBQUksY0FBYztZQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsOEJBQThCLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFakYsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNuQyxDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLGNBQWMsRUFBRSxDQUFDO2dCQUNuQixJQUFJLENBQUMsYUFBYSxDQUFDLGdDQUFnQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUMvRCxNQUFNLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUMxQixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxVQUFVLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtZQUM3QyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7O09BZUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLDhCQUE4QixDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLFdBQVc7UUFDcEYsSUFBSSxDQUFDLGFBQWEsSUFBSSxhQUFhLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDekMsT0FBTyxNQUFNLFFBQVEsQ0FBQyxFQUFDLFdBQVcsRUFBRSxXQUFXLElBQUksa0JBQWtCLENBQUMsd0JBQXdCLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDcEcsQ0FBQztRQUVELElBQUksZUFBZSxHQUFHLEtBQUssQ0FBQTtRQUUzQixJQUFJLENBQUM7WUFDSCxPQUFPLE1BQU0sT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLGFBQWEsRUFBQyxFQUFFLEtBQUssRUFBRSxFQUFDLE9BQU8sRUFBQyxFQUFFLEVBQUU7Z0JBQ2pFLElBQUksQ0FBQztvQkFDSCxPQUFPLE1BQU0sUUFBUSxDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxXQUFXLElBQUksa0JBQWtCLENBQUMsd0JBQXdCLEVBQUUsRUFBQyxDQUFDLENBQUE7Z0JBQzdHLENBQUM7d0JBQVMsQ0FBQztvQkFDVCxlQUFlLEdBQUcsSUFBSSxDQUFBO2dCQUN4QixDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxlQUFlLElBQUksS0FBSyxZQUFZLFlBQVksRUFBRSxDQUFDO2dCQUN0RCxNQUFNLElBQUksNEJBQTRCLENBQUMsaUJBQWlCLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLHFCQUFxQixhQUFhLElBQUksRUFBRSxFQUFDLElBQUksRUFBQyxDQUFDLENBQUE7WUFDN0gsQ0FBQztZQUVELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLHdCQUF3QjtRQUM3QixPQUFPLEVBQUMsT0FBTyxFQUFFLGVBQWUsRUFBRSxnQkFBZ0IsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUM1RCxDQUFDO0NBQ0Y7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxnQ0FBZ0MsQ0FBQyxNQUFNO0lBQzlDLE9BQU8sTUFBTSxDQUFDLFlBQVksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUE7QUFDN0MsQ0FBQztBQUVELE9BQU8sRUFBQyxxQkFBcUIsRUFBRSw0QkFBNEIsRUFBRSx3QkFBd0IsRUFBQyxDQUFBO0FBQ3RGLE9BQU8sRUFBQyxtQ0FBbUMsRUFBRSwrQkFBK0IsRUFBQyxNQUFNLG1DQUFtQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0LCB7VGltZW91dEVycm9yfSBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQge0RFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVN9IGZyb20gXCIuL2Fkdmlzb3J5LWxvY2stYm91bmQuanNcIlxuaW1wb3J0IHtcbiAgQWR2aXNvcnlMb2NrQmFja2VuZFVuYXZhaWxhYmxlRXJyb3IsXG4gIHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5LFxuICByZWZ1c2VBZHZpc29yeUxvY2tUaWVyQmVsb3dNaW5pbXVtXG59IGZyb20gXCIuL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIlxuXG4vKipcbiAqIFByb3ZlbmFuY2Ugb2Ygb25lIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gKFNUQy0yMTAgZGVzaWduIMKnMyk6IGV2ZXJ5XG4gKiBoZWxkIGxvY2sgcmVwb3J0cyB0aGUgdGllciB0aGF0IGFjdHVhbGx5IHNlcnZlZCBpdCwgc28gYSBmYWxsYmFjayBpc1xuICogdmlzaWJsZSB0byB0aGUgY2FsbGJhY2ssIGluIGxvZ3MsIGFuZCBpbiBgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cygpYC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tUaWVyfSBiYWNrZW5kIC0gVGllciB0aGF0IHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RyaXZlclR5cGVdIC0gRGF0YWJhc2UgZHJpdmVyIHR5cGUgd2hlbiB0aGUgZHJpdmVyIHRpZXIgc2VydmVkIGl0LlxuICogQHByb3BlcnR5IHtib29sZWFufSBmZW5jaW5nU3VwcG9ydGVkIC0gV2hldGhlciB0aGlzIHRpZXIgY2FycmllcyBmZW5jaW5nIHRva2VucyAoZGVzaWduIMKnOCk7IHRoZSBmaWxlIHRpZXIgcmVwb3J0cyBmYWxzZSByYXRoZXIgdGhhbiBwcmV0ZW5kaW5nLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtob2xkZXJJZF0gLSBCYWNrZW5kIGhvbGRlciBpZCBmb3IgdGhlIGZpbGUgdGllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbG9ja05hbWVdIC0gTG9jayBuYW1lIHRoaXMgcHJvdmVuYW5jZSBiZWxvbmdzIHRvLlxuICovXG5cbi8qKlxuICogVGhyb3duIHdoZW4gYW4gYWR2aXNvcnkgbG9jayBjb3VsZCBub3QgYmUgYWNxdWlyZWQgYmVmb3JlIGB0aW1lb3V0TXNgIGVsYXBzZWQuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgdGhhdCB0aW1lZCBvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrVGltZW91dEVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbmFtZVxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIGZpbmRzIHRoZSBsb2NrIGFscmVhZHkgaGVsZC5cbiAqL1xuY2xhc3MgQWR2aXNvcnlMb2NrQnVzeUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmd9fSBhcmdzIC0gVGhlIGFkdmlzb3J5IGxvY2sgbmFtZSB0aGF0IHdhcyBhbHJlYWR5IGhlbGQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrQnVzeUVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbmFtZVxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYSBjYWxsYmFjayBob2xkcyBhbiBhZHZpc29yeSBsb2NrIGxvbmdlciB0aGFuIGBob2xkVGltZW91dE1zYC5cbiAqL1xuY2xhc3MgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgd2hvc2UgaG9sZCB0aW1lZCBvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYWR2aXNvcnkgbG9ja3Mgb24gdGhlIGNhbGxlciBjb25uZWN0aW9uIGJ5IGRlZmF1bHQsIHVzaW5nIGEgZGVkaWNhdGVkXG4gKiBsb2NrIGNvbm5lY3Rpb24gd2hlbiBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgaXMgcmVxdWVzdGVkIG9yIHdoZW4gYSBwb3NpdGl2ZVxuICogaG9sZCB0aW1lb3V0IG5lZWRzIHNlcGFyYXRlIG93bmVyc2hpcC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQWR2aXNvcnlMb2NrUnVubmVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYW4gYWR2aXNvcnktbG9jayBydW5uZXIgZm9yIG9uZSBtb2RlbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmd9fSBhcmdzIC0gUnVubmVyIGRlcGVuZGVuY2llcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uUHJvdmlkZXIsIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5jb25uZWN0aW9uUHJvdmlkZXIgPSBjb25uZWN0aW9uUHJvdmlkZXJcbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBhZnRlciBhY3F1aXJpbmcgdGhlIGFkdmlzb3J5IGxvY2ssIHdhaXRpbmcgdXAgdG8gYHRpbWVvdXRNc2AuXG4gICAqIFdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHRydWUgdGhlIGxvY2sgaXMgYWNxdWlyZWQgb24gYSBzcGF3bmVkXG4gICAqIGNvbm5lY3Rpb24gdGhhdCBpcyByZWxlYXNlZCBhZnRlciB0aGUgY2FsbGJhY2sgZmluaXNoZXMsIHdoaWxlIHRoZSBjYWxsYmFja1xuICAgKiBpdHNlbGYgc3RpbGwgcnVucyBhZ2FpbnN0IHRoZSBjYWxsZXIvbW9kZWwgY29ubmVjdGlvbi4gV2hlbiBhIGBob2xkVGltZW91dE1zYFxuICAgKiBpcyBzZXQgdGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5IGZvciBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24gKGBjb250cm9sLmNoZWNrKClgLCBgY29udHJvbC5zaWduYWxgLCBgY29udHJvbC50aW1lZE91dGAsXG4gICAqIGBjb250cm9sLnJlbWFpbmluZygpYCk7IGEgZGVkaWNhdGVkIGNvbm5lY3Rpb24gaXMgYWxzbyB1c2VkIHNvIHRpbWVvdXRcbiAgICogY2xlYW51cCBjYW4gcmVsZWFzZSB0aGUgbG9jayBldmVuIGlmIGNhbGxiYWNrIGRhdGFiYXNlIHdvcmsgaXMgc3R1Y2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w/OiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBMb2NrIGFuZCBob2xkIHRpbWVvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZmlsZUJhY2tlbmQgPSBhd2FpdCB0aGlzLmZpbGVCYWNrZW5kRm9yTmFtZShuYW1lKVxuXG4gICAgaWYgKGZpbGVCYWNrZW5kKSB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGZpbGVCYWNrZW5kLmFjcXVpcmUobmFtZSwge3RpbWVvdXRNczogdGhpcy5maWxlQWNxdWlyZVRpbWVvdXRNcyhhcmdzKX0pXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcihgVGltZWQgb3V0IHdhaXRpbmcgZm9yIGFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gb24gdGhlIGZpbGUgdGllcmAsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmZpbGVQcm92ZW5hbmNlKGZpbGVCYWNrZW5kLCBuYW1lKVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucmVjb3JkQWR2aXNvcnlMb2NrQWNxdWlzaXRpb24oe2JhY2tlbmQ6IGxvY2tCYWNrZW5kLmJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQ6IGxvY2tCYWNrZW5kLmZlbmNpbmdTdXBwb3J0ZWQsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kLCBuYW1lLCByZWxlYXNlOiBhc3luYyAoKSA9PiBhd2FpdCBmaWxlQmFja2VuZC5yZWxlYXNlKG5hbWUpfSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoTG9ja0Nvbm5lY3Rpb24oYXJncywgYXN5bmMgKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbnN0IGxvY2tCYWNrZW5kID0gdGhpcy5kcml2ZXJQcm92ZW5hbmNlKGNvbm5lY3Rpb24pXG5cbiAgICAgIHRoaXMuYXNzZXJ0RHJpdmVyVGllckVsaWdpYmxlKG5hbWUsIGxvY2tCYWNrZW5kKVxuXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGNvbm5lY3Rpb24uYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCBhcmdzKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3IoYFRpbWVkIG91dCB3YWl0aW5nIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9YCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucmVjb3JkQWR2aXNvcnlMb2NrQWNxdWlzaXRpb24oe2JhY2tlbmQ6IGxvY2tCYWNrZW5kLmJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQ6IGxvY2tCYWNrZW5kLmZlbmNpbmdTdXBwb3J0ZWQsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kLCBuYW1lLCByZWxlYXNlOiBhc3luYyAoKSA9PiBhd2FpdCBjb25uZWN0aW9uLnJlbGVhc2VBZHZpc29yeUxvY2sobmFtZSl9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIG9ubHkgaWYgdGhlIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkIGltbWVkaWF0ZWx5LlxuICAgKiBXaGVuIGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBpcyB0cnVlIHRoZSBsb2NrIGlzIGFjcXVpcmVkIG9uIGEgc3Bhd25lZFxuICAgKiBjb25uZWN0aW9uIHRoYXQgaXMgcmVsZWFzZWQgYWZ0ZXIgdGhlIGNhbGxiYWNrIGZpbmlzaGVzLCB3aGlsZSB0aGUgY2FsbGJhY2tcbiAgICogaXRzZWxmIHN0aWxsIHJ1bnMgYWdhaW5zdCB0aGUgY2FsbGVyL21vZGVsIGNvbm5lY3Rpb24uIFdoZW4gYSBgaG9sZFRpbWVvdXRNc2BcbiAgICogaXMgc2V0IHRoZSBjYWxsYmFjayByZWNlaXZlcyBhIGBUaW1lb3V0Q29udHJvbGAgZnJvbSBhd2FpdGVyeSBmb3IgY29vcGVyYXRpdmVcbiAgICogY2FuY2VsbGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHsoYXJncz86IHtjb250cm9sPzogaW1wb3J0KFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiKS5UaW1lb3V0Q29udHJvbCwgbG9ja0JhY2tlbmQ6IEFkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBpbnZva2Ugd2hpbGUgdGhlIGxvY2sgaXMgaGVsZC5cbiAgICogQHBhcmFtIHt7aG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGRlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFufX0gW2FyZ3NdIC0gSG9sZCB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGZpbGVCYWNrZW5kID0gYXdhaXQgdGhpcy5maWxlQmFja2VuZEZvck5hbWUobmFtZSlcblxuICAgIGlmIChmaWxlQmFja2VuZCkge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBmaWxlQmFja2VuZC50cnlBY3F1aXJlKG5hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja0J1c3lFcnJvcihgQWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSBpcyBhbHJlYWR5IGhlbGQgb24gdGhlIGZpbGUgdGllcmAsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmZpbGVQcm92ZW5hbmNlKGZpbGVCYWNrZW5kLCBuYW1lKVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucmVjb3JkQWR2aXNvcnlMb2NrQWNxdWlzaXRpb24oe2JhY2tlbmQ6IGxvY2tCYWNrZW5kLmJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQ6IGxvY2tCYWNrZW5kLmZlbmNpbmdTdXBwb3J0ZWQsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kLCBuYW1lLCByZWxlYXNlOiBhc3luYyAoKSA9PiBhd2FpdCBmaWxlQmFja2VuZC5yZWxlYXNlKG5hbWUpfSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoTG9ja0Nvbm5lY3Rpb24oYXJncywgYXN5bmMgKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbnN0IGxvY2tCYWNrZW5kID0gdGhpcy5kcml2ZXJQcm92ZW5hbmNlKGNvbm5lY3Rpb24pXG5cbiAgICAgIHRoaXMuYXNzZXJ0RHJpdmVyVGllckVsaWdpYmxlKG5hbWUsIGxvY2tCYWNrZW5kKVxuXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGNvbm5lY3Rpb24udHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tCdXN5RXJyb3IoYEFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gaXMgYWxyZWFkeSBoZWxkYCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucmVjb3JkQWR2aXNvcnlMb2NrQWNxdWlzaXRpb24oe2JhY2tlbmQ6IGxvY2tCYWNrZW5kLmJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQ6IGxvY2tCYWNrZW5kLmZlbmNpbmdTdXBwb3J0ZWQsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zOiBhcmdzLmhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kLCBuYW1lLCByZWxlYXNlOiBhc3luYyAoKSA9PiBhd2FpdCBjb25uZWN0aW9uLnJlbGVhc2VBZHZpc29yeUxvY2sobmFtZSl9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbG9jayBob2xkZXIgY2FsbGJhY2sgYW5kIHJlbGVhc2VzIHRoZSBsb2NrIGZyb20gaXRzIG93bmluZyBiYWNrZW5kLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogKGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD4sIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2UsIG5hbWU6IHN0cmluZywgcmVsZWFzZTogKCkgPT4gUHJvbWlzZTx1bmtub3duPn19IGFyZ3MgLSBMb2NrZWQgY2FsbGJhY2sgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZX0pIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IEFkdmlzb3J5TG9ja1J1bm5lci5ydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCByZWxlYXNlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGJhY2tlbmQgcG9saWN5IGZvciBvbmUgbG9jayBuYW1lIGFuZCByZXR1cm5zIHRoZSBmaWxlXG4gICAqIGJhY2tlbmQgd2hlbiB0aGUgbmFtZSBleHBsaWNpdGx5IG9wdHMgaW50byB0aGUgZmlsZSB0aWVyXG4gICAqIChgcHJlZmVycmVkVGllcjogXCJmaWxlXCJgIHBsdXMgYGFkdmlzb3J5TG9ja3MuYmFja2VuZHMuZmlsZS5lbmFibGVkOiB0cnVlYCkuXG4gICAqIEEgbmFtZSB3aG9zZSBkZWNsYXJlZCBtaW5pbXVtIHRpZXIgaXMgY3Jvc3MtaG9zdCBpcyByZWZ1c2VkIGxvdWRseVxuICAgKiAoYEFkdmlzb3J5TG9ja01pblRpZXJSZWZ1c2VkRXJyb3JgKSBiZWZvcmUgYW55IGNvbnRhY3Qgd2l0aCB0aGUgZmlsZVxuICAgKiB0aWVyLiBBIG5hbWUgdGhhdCBwcmVmZXJzIHRoZSBmaWxlIHRpZXIgd2hpbGUgdGhlIGJhY2tlbmQgaXMgZGlzYWJsZWRcbiAgICogbW92ZXMgdG8gdGhlIGRyaXZlciBwYXRoIChhIHN0cm9uZ2VyLW9yLWVxdWFsIHRpZXIpLCBuZXZlciB0aGUgb3RoZXIgd2F5XG4gICAqIGFyb3VuZC4gTm90aGluZyBoZXJlIGV2ZXIgYXV0by1lbmFibGVzIHRoZSBmaWxlIHRpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaWxlIGJhY2tlbmQgc2VydmluZyB0aGlzIG5hbWUsIG9yIG51bGwgZm9yIHRoZSBkcml2ZXIgcGF0aC5cbiAgICovXG4gIGFzeW5jIGZpbGVCYWNrZW5kRm9yTmFtZShuYW1lKSB7XG4gICAgY29uc3QgcG9saWN5ID0gcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3kobmFtZSwgdGhpcy5jb25maWd1cmF0aW9uLmdldEFkdmlzb3J5TG9ja1BvbGljeSgpKVxuXG4gICAgaWYgKHBvbGljeS5wcmVmZXJyZWRUaWVyICE9PSBcImZpbGVcIikgcmV0dXJuIG51bGxcblxuICAgIGlmICghYWR2aXNvcnlMb2NrUG9saWN5QWxsb3dzRmlsZVRpZXIocG9saWN5KSkge1xuICAgICAgcmVmdXNlQWR2aXNvcnlMb2NrVGllckJlbG93TWluaW11bSh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgbG9ja05hbWU6IG5hbWUsXG4gICAgICAgIG1pblRpZXI6IHBvbGljeS5taW5UaWVyLFxuICAgICAgICByZXF1ZXN0ZWRCYWNrZW5kOiBcImZpbGVcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBiYWNrZW5kID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kKClcblxuICAgIGlmICghYmFja2VuZCkge1xuICAgICAgLy8gUHJlZmVycmVkIHRpZXIgdW5hdmFpbGFibGU6IGZhaWwgKnVwd2FyZCogdG8gdGhlIGRyaXZlciBwYXRoIChhXG4gICAgICAvLyBzdHJvbmdlci1vci1lcXVhbCB0aWVyKSwgbmV2ZXIgZG93bndhcmQuIElmIHRoZSBkcml2ZXIgY2Fubm90IHNhdGlzZnlcbiAgICAgIC8vIHRoZSBtaW5pbXVtIGVpdGhlciwgYGFzc2VydERyaXZlclRpZXJFbGlnaWJsZWAgdGhyb3dzXG4gICAgICAvLyBgQWR2aXNvcnlMb2NrQmFja2VuZFVuYXZhaWxhYmxlRXJyb3JgIG9uIHRoZSBkcml2ZXIgcGF0aC5cbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgcmV0dXJuIGJhY2tlbmRcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWlsLWNsb3NlZCBjaGVjayBvbiB0aGUgZHJpdmVyIHBhdGggKGRlc2lnbiDCpzkpOiBhbiB1bmRlY2xhcmVkIGxvY2sgbmFtZVxuICAgKiBrZWVwcyB0b2RheSdzIGJlaGF2aW9yIChhbnkgZHJpdmVyIHNlcnZlcyBpdCDigJQgZnVsbCBiYWNrd2FyZFxuICAgKiBjb21wYXRpYmlsaXR5KSwgYnV0IGEgbmFtZSB3aXRoIGFuIGV4cGxpY2l0IHBvbGljeSBlbnRyeSBpcyByZWZ1c2VkIHdpdGhcbiAgICogYEFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yYCB3aGVuIHRoZSBjb25maWd1cmVkIGRyaXZlciBjYW5ub3RcbiAgICogc2F0aXNmeSBpdHMgbWluaW11bSB0aWVyIChlLmcuIGBtaW5UaWVyOiBcImRyaXZlci1uYXRpdmVcImAgb24gYSBTUUxpdGVcbiAgICogZHJpdmVyLCB3aGljaCBoYXMgbm8gbmF0aXZlIGFkdmlzb3J5LWxvY2sgcHJpbWl0aXZlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7QWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9IGxvY2tCYWNrZW5kIC0gVGllciB0aGUgZHJpdmVyIHBhdGggd291bGQgc2VydmUgd2l0aC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnREcml2ZXJUaWVyRWxpZ2libGUobmFtZSwgbG9ja0JhY2tlbmQpIHtcbiAgICBjb25zdCBwb2xpY3kgPSByZXNvbHZlQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeShuYW1lLCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QWR2aXNvcnlMb2NrUG9saWN5KCkpXG5cbiAgICBpZiAoIXBvbGljeS5lbnRyeSkgcmV0dXJuXG5cbiAgICBjb25zdCB0aWVyID0gbG9ja0JhY2tlbmQuYmFja2VuZFxuXG4gICAgaWYgKHRpZXIgPT09IFwicHJvY2Vzcy1sb2NhbFwiICYmICFwb2xpY3kuYWxsb3dlZFRpZXJzLmluY2x1ZGVzKFwicHJvY2Vzcy1sb2NhbFwiKSkge1xuICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yKFxuICAgICAgICBgQWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSByZXF1aXJlcyBtaW5pbXVtIHRpZXIgJHtKU09OLnN0cmluZ2lmeShwb2xpY3kubWluVGllcil9IGJ1dCB0aGUgY29uZmlndXJlZCBkcml2ZXIgKCR7U3RyaW5nKGxvY2tCYWNrZW5kLmRyaXZlclR5cGUpfSkgb25seSBvZmZlcnMgdGhlIHByb2Nlc3MtbG9jYWwgdGllcmAsXG4gICAgICAgIHtsb2NrTmFtZTogbmFtZSwgbWluVGllcjogcG9saWN5Lm1pblRpZXIsIHJlYXNvbnM6IFtgZHJpdmVyIHRpZXIgJHt0aWVyfSBiZWxvdyBtaW5UaWVyICR7cG9saWN5Lm1pblRpZXJ9YF19XG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSB3YWl0IGJvdW5kIGZvciBhIGZpbGUtdGllciBhY3F1aXNpdGlvbjogYW4gZXhwbGljaXQgY2FsbGVyXG4gICAqIGB0aW1lb3V0TXNgIChpbmNsdWRpbmcgYW4gZXhwbGljaXQgYG51bGxgIG9wdC1vdXQpIHdpbnMsIG90aGVyd2lzZSB0aGVcbiAgICogc2FtZSBmcmFtZXdvcmsgZGVmYXVsdCB0aGF0IGJvdW5kcyBkcml2ZXIgYWNxdWlzaXRpb25zIGFwcGxpZXMuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBhcmdzIC0gTG9jayBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBXYWl0IGJvdW5kIGluIG1pbGxpc2Vjb25kcywgb3IgYG51bGxgIGZvciBhbiBpbmRlZmluaXRlIHdhaXQuXG4gICAqL1xuICBmaWxlQWNxdWlyZVRpbWVvdXRNcyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MudGltZW91dE1zICE9PSB1bmRlZmluZWQpIHJldHVybiBhcmdzLnRpbWVvdXRNc1xuXG4gICAgcmV0dXJuIERFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGFjcXVpc2l0aW9uIHByb3ZlbmFuY2UgZm9yIGEgZmlsZS10aWVyIGhvbGQuIFRoZSBmaWxlIHRpZXJcbiAgICogY2Fubm90IGNhcnJ5IGZlbmNpbmcgdG9rZW5zLCBzbyB0aGUgbGltaXRhdGlvbiBpcyByZXBvcnRlZCBvbiBldmVyeVxuICAgKiBhY3F1aXNpdGlvbiByYXRoZXIgdGhhbiBzaWxlbnRseSBwcmV0ZW5kZWQgYXdheSAoZGVzaWduIMKnOCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0fSBiYWNrZW5kIC0gQmFja2VuZCB0aGF0IHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7QWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9IC0gQWNxdWlzaXRpb24gcHJvdmVuYW5jZS5cbiAgICovXG4gIGZpbGVQcm92ZW5hbmNlKGJhY2tlbmQsIG5hbWUpIHtcbiAgICByZXR1cm4ge2JhY2tlbmQ6IFwiZmlsZVwiLCBmZW5jaW5nU3VwcG9ydGVkOiBmYWxzZSwgaG9sZGVySWQ6IGJhY2tlbmQuaG9sZGVySWQsIGxvY2tOYW1lOiBuYW1lfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYWNxdWlzaXRpb24gcHJvdmVuYW5jZSBmb3IgYSBkcml2ZXItc2VydmVkIGhvbGQuIFNRTGl0ZSBoYXMgbm9cbiAgICogbmF0aXZlIGFkdmlzb3J5LWxvY2sgcHJpbWl0aXZlLCBzbyBpdHMgZW11bGF0aW9uIHRpZXIgaXMgcmVwb3J0ZWQgYXNcbiAgICogYHByb2Nlc3MtbG9jYWxgIHJhdGhlciB0aGFuIHByZXRlbmRpbmcgdG8gYmUgZGF0YWJhc2UtbmF0aXZlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRoYXQgc2VydmVkIHRoZSBhY3F1aXNpdGlvbi5cbiAgICogQHJldHVybnMge0Fkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSAtIEFjcXVpc2l0aW9uIHByb3ZlbmFuY2UuXG4gICAqL1xuICBkcml2ZXJQcm92ZW5hbmNlKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBkcml2ZXJUeXBlID0gY29ubmVjdGlvbi5nZXRUeXBlKClcblxuICAgIHJldHVybiB7XG4gICAgICBiYWNrZW5kOiBkcml2ZXJUeXBlID09PSBcInNxbGl0ZVwiID8gXCJwcm9jZXNzLWxvY2FsXCIgOiBcImRyaXZlci1uYXRpdmVcIixcbiAgICAgIGRyaXZlclR5cGUsXG4gICAgICBmZW5jaW5nU3VwcG9ydGVkOiBkcml2ZXJUeXBlICE9PSBcInNxbGl0ZVwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9jayB3b3JrIG9uIHRoZSBjYWxsZXIgY29ubmVjdGlvbiB1bmxlc3MgYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzXG4gICAqIHJlcXVlc3RlZCBvciBhIHBvc2l0aXZlIGhvbGQgdGltZW91dCBuZWVkcyBpdHMgb3duIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW4sIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gYXJncyAtIExvY2sgY29ubmVjdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhjb25uZWN0aW9uOiBpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHJlY2VpdmluZyB0aGUgY29ubmVjdGlvbiB0aGF0IG93bnMgdGhlIGFkdmlzb3J5IGxvY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGhvbGRUaW1lb3V0TXMgPSBhcmdzLmhvbGRUaW1lb3V0TXNcblxuICAgIGlmIChhcmdzLmRlZGljYXRlZENvbm5lY3Rpb24gfHwgKGhvbGRUaW1lb3V0TXMgJiYgaG9sZFRpbWVvdXRNcyA+IDApKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRGVkaWNhdGVkQ29ubmVjdGlvbihjYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sodGhpcy5jb25uZWN0aW9uUHJvdmlkZXIoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGF3bnMgYSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uIGFuZCBjbG9zZXMgaXQgYWZ0ZXIgbG9jayB3b3JrIGNvbXBsZXRlc1xuICAgKiB3aGVuIHRoZSBzcGF3bmVkIGRyaXZlciBvd25zIHRoZSB1bmRlcmx5aW5nIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdGhhdCByZWNlaXZlcyB0aGUgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aERlZGljYXRlZENvbm5lY3Rpb24oY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikuc3Bhd25Db25uZWN0aW9uKClcblxuICAgIC8vIFRoZSBzcGF3bmVkIGRyaXZlciBvd25zIGl0cyBwaHlzaWNhbCBjb25uZWN0aW9uIHVubGVzcyBpdCBib3Jyb3dzIGEgc2hhcmVkIG9uZVxuICAgIC8vIHZpYSBgZ2V0Q29ubmVjdGlvbmAuIEFuIG93bmVkIGNvbm5lY3Rpb24gbGl2ZXMgb3V0c2lkZSB0aGUgcG9vbHMnIHRyYWNrZWQgc2V0cyxcbiAgICAvLyBzbyByZWdpc3RlciBpdCB3aGlsZSB0aGUgbG9jayBpcyBoZWxkOiBhIHNodXRkb3duIHRoZW4gY2xvc2VzIGl0IChyZWxlYXNpbmcgdGhlXG4gICAgLy8gbG9jaykgaW5zdGVhZCBvZiBvcnBoYW5pbmcgYSBoYWxmLW9wZW4gc2Vzc2lvbiB1bnRpbCB0aGUgREIgYHdhaXRfdGltZW91dGAuXG4gICAgY29uc3Qgb3duc0Nvbm5lY3Rpb24gPSAhY29ubmVjdGlvbi5nZXRBcmdzKCkuZ2V0Q29ubmVjdGlvblxuXG4gICAgaWYgKG93bnNDb25uZWN0aW9uKSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVnaXN0ZXJBZHZpc29yeUxvY2tDb25uZWN0aW9uKGNvbm5lY3Rpb24pXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChvd25zQ29ubmVjdGlvbikge1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24udW5yZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbilcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLnJlbGVhc2VIZWxkQWR2aXNvcnlMb2NrcygpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYGNhbGxiYWNrYCwgcmVqZWN0aW5nIHdpdGggYEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JgIGlmIGl0IGhhc1xuICAgKiBub3Qgc2V0dGxlZCB3aXRoaW4gYGhvbGRUaW1lb3V0TXNgLiBUaGUgY2FsbGJhY2sgaXMgbm90IGNhbmNlbGxlZDsgY2FsbGVyc1xuICAgKiB1c2UgYSBkZWRpY2F0ZWQgYWR2aXNvcnktbG9jayBjb25uZWN0aW9uIHNvIHRoZSBsb2NrIGNhbiBzdGlsbCBiZSByZWxlYXNlZC5cbiAgICpcbiAgICogVGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5LCBlbmFibGluZyBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24gdmlhIGBjb250cm9sLmNoZWNrKClgLCBgY29udHJvbC5zaWduYWxgLCBgY29udHJvbC50aW1lZE91dGAsXG4gICAqIGFuZCBgY29udHJvbC5yZW1haW5pbmcoKWAsIHBsdXMgYGxvY2tCYWNrZW5kYCBwcm92ZW5hbmNlIGZvciB0aGUgdGllciB0aGF0XG4gICAqIHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lIChmb3IgdGhlIGVycm9yIG1lc3NhZ2UpLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w/OiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGhvbGRpbmcgdGhlIGxvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2hvbGRUaW1lb3V0TXNdIC0gTWF4IGhvbGQgdGltZTsgZmFsc3kgZGlzYWJsZXMgdGhlIHRpbWVvdXQuXG4gICAqIEBwYXJhbSB7QWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9IFtsb2NrQmFja2VuZF0gLSBQcm92ZW5hbmNlIG9mIHRoZSBhY3F1aXNpdGlvbiBzZXJ2aW5nIHRoaXMgaG9sZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQpIHtcbiAgICBpZiAoIWhvbGRUaW1lb3V0TXMgfHwgaG9sZFRpbWVvdXRNcyA8PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soe2xvY2tCYWNrZW5kOiBsb2NrQmFja2VuZCA/PyBBZHZpc29yeUxvY2tSdW5uZXIudW5rbm93bkJhY2tlbmRQcm92ZW5hbmNlKCl9KVxuICAgIH1cblxuICAgIGxldCBjYWxsYmFja1NldHRsZWQgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHt0aW1lb3V0OiBob2xkVGltZW91dE1zfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7Y29udHJvbCwgbG9ja0JhY2tlbmQ6IGxvY2tCYWNrZW5kID8/IEFkdmlzb3J5TG9ja1J1bm5lci51bmtub3duQmFja2VuZFByb3ZlbmFuY2UoKX0pXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgY2FsbGJhY2tTZXR0bGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIWNhbGxiYWNrU2V0dGxlZCB8fCBlcnJvciBpbnN0YW5jZW9mIFRpbWVvdXRFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcihgQWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSBoZWxkIGxvbmdlciB0aGFuICR7aG9sZFRpbWVvdXRNc31tc2AsIHtuYW1lfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTmV1dHJhbCBwcm92ZW5hbmNlIGZvciBkaXJlY3QgYHJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dGAgY2FsbGVycyB0aGF0XG4gICAqIGhvbGQgYSBsb2NrIGFjcXVpcmVkIG91dHNpZGUgdGhpcyBydW5uZXIuXG4gICAqIEByZXR1cm5zIHtBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0gLSBQcm92ZW5hbmNlIHdpdGggYW4gdW5rbm93biB0aWVyLlxuICAgKi9cbiAgc3RhdGljIHVua25vd25CYWNrZW5kUHJvdmVuYW5jZSgpIHtcbiAgICByZXR1cm4ge2JhY2tlbmQ6IFwicHJvY2Vzcy1sb2NhbFwiLCBmZW5jaW5nU3VwcG9ydGVkOiBmYWxzZX1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYWR2aXNvcnkgbG9jayBwb2xpY3kgYWxsb3dzIGZpbGUgdGllci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLlJlc29sdmVkQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeX0gcG9saWN5IC0gUmVzb2x2ZWQgcG9saWN5LlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZmlsZSB0aWVyIG1heSBzZXJ2ZSB0aGlzIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGFkdmlzb3J5TG9ja1BvbGljeUFsbG93c0ZpbGVUaWVyKHBvbGljeSkge1xuICByZXR1cm4gcG9saWN5LmFsbG93ZWRUaWVycy5pbmNsdWRlcyhcImZpbGVcIilcbn1cblxuZXhwb3J0IHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcn1cbmV4cG9ydCB7QWR2aXNvcnlMb2NrQmFja2VuZFVuYXZhaWxhYmxlRXJyb3IsIEFkdmlzb3J5TG9ja01pblRpZXJSZWZ1c2VkRXJyb3J9IGZyb20gXCIuL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIlxuIl19