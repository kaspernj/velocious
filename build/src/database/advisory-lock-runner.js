// @ts-check
import timeout, { TimeoutError } from "awaitery/build/timeout.js";
import { DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS } from "./advisory-lock-bound.js";
import { AdvisoryLockBackendUnavailableError, resolveAdvisoryLockBackendPolicy, refuseAdvisoryLockTierBelowMinimum } from "./advisory-lock-backend-policy.js";
import { AdvisoryLockLostError, AdvisoryLockServiceUnavailableError, advisoryLockBackendUnavailable } from "./advisory-lock-errors.js";
/**
 * Provenance of one advisory-lock acquisition (STC-210 design §3): every
 * held lock reports the tier that actually served it, so a fallback is
 * visible to the callback, in logs, and in `getAdvisoryLockBackendStatus()`.
 * @typedef {object} AdvisoryLockBackendProvenance
 * @property {import("./advisory-lock-backend-policy.js").AdvisoryLockTier} backend - Tier that served the acquisition.
 * @property {string} [driverType] - Database driver type when the driver tier served it.
 * @property {number} [epoch] - Fencing epoch when the serving tier issues one.
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
        const lockServerResult = await this.attemptLockServer({ args, callback, mode: "wait", name });
        // The wait mode never returns a deferred outcome, so the value member is present.
        if (lockServerResult)
            return /** @type {{value: T}} */ (lockServerResult).value;
        const fileBackend = await this.fileBackendForName(name);
        if (fileBackend) {
            const acquired = await fileBackend.acquire(name, { timeoutMs: this.acquireTimeoutMs(args) });
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
        const lockServerResult = await this.attemptLockServer({ args, callback, mode: "or-fail", name });
        // The or-fail mode throws on contention, so the value member is present.
        if (lockServerResult)
            return /** @type {{value: T}} */ (lockServerResult).value;
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
        const lockServerResult = await this.attemptLockServer({ args, callback, mode: "defer", name });
        if (lockServerResult) {
            if ("deferred" in lockServerResult)
                return lockServerResult.deferred;
            return { acquired: true, result: /** @type {{value: T}} */ (lockServerResult).value };
        }
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
     * Serves one acquisition on the lock-server tier when the lock name prefers
     * it (design §1/§9), falling *upward* to the driver path when the server is
     * unreachable and the name's minimum tier permits a DB-native hold.
     *
     * `null` means "this tier did not serve the acquisition — continue with the
     * next eligible tier". A returned value means the lock-server tier answered,
     * including a definitive busy/timeout outcome.
     * @template T
     * @param {{args: {holdTimeoutMs?: number | null, timeoutMs?: number | null}, callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, mode: "wait" | "or-fail" | "defer", name: string}} request - Acquisition request.
     * @returns {Promise<{deferred: {acquired: false, reason: "contended", lockName: string}} | {value: T} | null>} - Result when this tier served it, otherwise null.
     */
    async attemptLockServer({ args, callback, mode, name }) {
        const policy = resolveAdvisoryLockBackendPolicy(name, this.configuration.getAdvisoryLockPolicy());
        if (policy.preferredTier !== "lock-server")
            return null;
        if (!policy.allowedTiers.includes("lock-server"))
            return null;
        const backend = await this.configuration.getAdvisoryLockLockServerBackend();
        if (!backend) {
            this.reportAdvisoryLockFallback({ reason: "lock-server tier is not enabled in configuration", servedBy: "driver-native", lockName: name });
            return null;
        }
        /** @type {boolean} */
        let acquired;
        try {
            if (mode === "wait") {
                acquired = await backend.acquire(name, { timeoutMs: this.acquireTimeoutMs(args) });
            }
            else {
                acquired = await backend.tryAcquire(name);
            }
        }
        catch (error) {
            if (!(error instanceof AdvisoryLockServiceUnavailableError))
                throw error;
            if (policy.minTier === "lock-server") {
                throw advisoryLockBackendUnavailable({
                    lockName: name,
                    minTier: policy.minTier,
                    reasons: [`lock-server unavailable: ${error.message}`]
                });
            }
            this.reportAdvisoryLockFallback({ reason: error.message, servedBy: "driver-native", lockName: name });
            return null;
        }
        if (!acquired) {
            if (mode === "defer")
                return { deferred: { acquired: false, reason: "contended", lockName: name } };
            if (mode === "or-fail")
                throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, { name });
            throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, { name });
        }
        const epoch = backend.getHoldEpoch(name);
        const lockBackend = /** @type {AdvisoryLockBackendProvenance} */ ({
            backend: "lock-server",
            epoch: epoch ?? undefined,
            fencingSupported: true,
            lockName: name
        });
        this.configuration.recordAdvisoryLockAcquisition({ backend: "lock-server", fencingSupported: true, lockName: name });
        const value = await this.runLockServerHold({
            backend,
            callback,
            holdTimeoutMs: args.holdTimeoutMs,
            lockBackend,
            name
        });
        return { value };
    }
    /**
     * Runs the critical section under a lock-server lease and surfaces a fenced
     * lease as `AdvisoryLockLostError` (design §8): the section may have
     * overlapped another holder, so its outcome must not be trusted as exclusive.
     * @template T
     * @param {{backend: import("./advisory-lock-lock-server-backend.js").default, callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, holdTimeoutMs?: number | null, lockBackend: AdvisoryLockBackendProvenance, name: string}} args - Hold request.
     * @returns {Promise<T>} - Callback result.
     */
    async runLockServerHold({ backend, callback, holdTimeoutMs, lockBackend, name }) {
        /** @type {T | undefined} */
        let value;
        /** @type {unknown} */
        let callbackError;
        let failed = false;
        try {
            value = await this.runLockedCallback({
                callback,
                holdTimeoutMs,
                lockBackend,
                name,
                release: async () => await backend.release(name)
            });
        }
        catch (error) {
            failed = true;
            callbackError = error;
        }
        const loss = backend.takeLoss(name, lockBackend.epoch ?? null);
        if (loss) {
            throw new AdvisoryLockLostError(`Lost the lease for advisory lock ${JSON.stringify(name)} while the critical section was running`, {
                cause: callbackError instanceof Error ? callbackError : undefined,
                currentEpoch: loss.currentEpoch,
                epoch: lockBackend.epoch ?? null,
                lockName: name
            });
        }
        if (failed)
            throw callbackError;
        return /** @type {T} */ (value);
    }
    /**
     * Reports an acquisition served below the lock name's preferred tier
     * (design §3): every fallback is visible on the framework-error channel, so a
     * silent downgrade is impossible.
     * @param {{lockName: string, reason: string, servedBy: import("./advisory-lock-backend-policy.js").AdvisoryLockTier}} args - Fallback details.
     * @returns {void}
     */
    reportAdvisoryLockFallback({ lockName, reason, servedBy }) {
        const policy = resolveAdvisoryLockBackendPolicy(lockName, this.configuration.getAdvisoryLockPolicy());
        const payload = {
            context: "advisory-lock-fallback",
            lockName,
            preferredTier: policy.preferredTier,
            reason,
            servedBy
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
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
    acquireTimeoutMs(args) {
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
export { AdvisoryLockLostError, AdvisoryLockServiceUnavailableError } from "./advisory-lock-errors.js";
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1ydW5uZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDL0QsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMEJBQTBCLENBQUE7QUFDakYsT0FBTyxFQUNMLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsa0NBQWtDLEVBQ25DLE1BQU0sbUNBQW1DLENBQUE7QUFDMUMsT0FBTyxFQUNMLHFCQUFxQixFQUNyQixtQ0FBbUMsRUFDbkMsOEJBQThCLEVBQy9CLE1BQU0sMkJBQTJCLENBQUE7QUFFbEM7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7R0FFRztBQUNILE1BQU0sd0JBQXlCLFNBQVEsS0FBSztJQUMxQzs7OztPQUlHO0lBQ0gsWUFBWSxPQUFPLEVBQUUsRUFBQyxJQUFJLEVBQUM7UUFDekIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRywwQkFBMEIsQ0FBQTtRQUN0QyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtJQUN0QixDQUFDO0NBQ0Y7QUFFRDs7R0FFRztBQUNILE1BQU0scUJBQXNCLFNBQVEsS0FBSztJQUN2Qzs7OztPQUlHO0lBQ0gsWUFBWSxPQUFPLEVBQUUsRUFBQyxJQUFJLEVBQUM7UUFDekIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyx1QkFBdUIsQ0FBQTtRQUNuQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtJQUN0QixDQUFDO0NBQ0Y7QUFFRDs7R0FFRztBQUNILE1BQU0sNEJBQTZCLFNBQVEsS0FBSztJQUM5Qzs7OztPQUlHO0lBQ0gsWUFBWSxPQUFPLEVB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O0dBSUc7QUFDSCxTQUFTLGdDQUFnQyxDQUFDLE1BQU07SUFDOUMsT0FBTyxNQUFNLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtBQUM3QyxDQUFDO0FBRUQsT0FBTyxFQUFDLHFCQUFxQixFQUFFLDRCQUE0QixFQUFFLHdCQUF3QixFQUFDLENBQUE7QUFDdEYsT0FBTyxFQUFDLG1DQUFtQyxFQUFFLCtCQUErQixFQUFDLE1BQU0sbUNBQW1DLENBQUE7QUFDdEgsT0FBTyxFQUFDLHFCQUFxQixFQUFFLG1DQUFtQyxFQUFDLE1BQU0sMkJBQTJCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQsIHtUaW1lb3V0RXJyb3J9IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCB7REVGQVVMVF9BRFZJU09SWV9MT0NLX0FDUVVJUkVfVElNRU9VVF9NU30gZnJvbSBcIi4vYWR2aXNvcnktbG9jay1ib3VuZC5qc1wiXG5pbXBvcnQge1xuICBBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvcixcbiAgcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3ksXG4gIHJlZnVzZUFkdmlzb3J5TG9ja1RpZXJCZWxvd01pbmltdW1cbn0gZnJvbSBcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiXG5pbXBvcnQge1xuICBBZHZpc29yeUxvY2tMb3N0RXJyb3IsXG4gIEFkdmlzb3J5TG9ja1NlcnZpY2VVbmF2YWlsYWJsZUVycm9yLFxuICBhZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVcbn0gZnJvbSBcIi4vYWR2aXNvcnktbG9jay1lcnJvcnMuanNcIlxuXG4vKipcbiAqIFByb3ZlbmFuY2Ugb2Ygb25lIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gKFNUQy0yMTAgZGVzaWduIMKnMyk6IGV2ZXJ5XG4gKiBoZWxkIGxvY2sgcmVwb3J0cyB0aGUgdGllciB0aGF0IGFjdHVhbGx5IHNlcnZlZCBpdCwgc28gYSBmYWxsYmFjayBpc1xuICogdmlzaWJsZSB0byB0aGUgY2FsbGJhY2ssIGluIGxvZ3MsIGFuZCBpbiBgZ2V0QWR2aXNvcnlMb2NrQmFja2VuZFN0YXR1cygpYC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tUaWVyfSBiYWNrZW5kIC0gVGllciB0aGF0IHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RyaXZlclR5cGVdIC0gRGF0YWJhc2UgZHJpdmVyIHR5cGUgd2hlbiB0aGUgZHJpdmVyIHRpZXIgc2VydmVkIGl0LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtlcG9jaF0gLSBGZW5jaW5nIGVwb2NoIHdoZW4gdGhlIHNlcnZpbmcgdGllciBpc3N1ZXMgb25lLlxuICogQHByb3BlcnR5IHtib29sZWFufSBmZW5jaW5nU3VwcG9ydGVkIC0gV2hldGhlciB0aGlzIHRpZXIgY2FycmllcyBmZW5jaW5nIHRva2VucyAoZGVzaWduIMKnOCk7IHRoZSBmaWxlIHRpZXIgcmVwb3J0cyBmYWxzZSByYXRoZXIgdGhhbiBwcmV0ZW5kaW5nLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtob2xkZXJJZF0gLSBCYWNrZW5kIGhvbGRlciBpZCBmb3IgdGhlIGZpbGUgdGllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbG9ja05hbWVdIC0gTG9jayBuYW1lIHRoaXMgcHJvdmVuYW5jZSBiZWxvbmdzIHRvLlxuICovXG5cbi8qKlxuICogVGhyb3duIHdoZW4gYW4gYWR2aXNvcnkgbG9jayBjb3VsZCBub3QgYmUgYWNxdWlyZWQgYmVmb3JlIGB0aW1lb3V0TXNgIGVsYXBzZWQuXG4gKi9cbmNsYXNzIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgdGhhdCB0aW1lZCBvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrVGltZW91dEVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbmFtZVxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIGZpbmRzIHRoZSBsb2NrIGFscmVhZHkgaGVsZC5cbiAqL1xuY2xhc3MgQWR2aXNvcnlMb2NrQnVzeUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tuYW1lOiBzdHJpbmd9fSBhcmdzIC0gVGhlIGFkdmlzb3J5IGxvY2sgbmFtZSB0aGF0IHdhcyBhbHJlYWR5IGhlbGQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrQnVzeUVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbmFtZVxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYSBjYWxsYmFjayBob2xkcyBhbiBhZHZpc29yeSBsb2NrIGxvbmdlciB0aGFuIGBob2xkVGltZW91dE1zYC5cbiAqL1xuY2xhc3MgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bmFtZTogc3RyaW5nfX0gYXJncyAtIFRoZSBhZHZpc29yeSBsb2NrIG5hbWUgd2hvc2UgaG9sZCB0aW1lZCBvdXQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IG5hbWVcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYWR2aXNvcnkgbG9ja3Mgb24gdGhlIGNhbGxlciBjb25uZWN0aW9uIGJ5IGRlZmF1bHQsIHVzaW5nIGEgZGVkaWNhdGVkXG4gKiBsb2NrIGNvbm5lY3Rpb24gd2hlbiBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgaXMgcmVxdWVzdGVkIG9yIHdoZW4gYSBwb3NpdGl2ZVxuICogaG9sZCB0aW1lb3V0IG5lZWRzIHNlcGFyYXRlIG93bmVyc2hpcC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQWR2aXNvcnlMb2NrUnVubmVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYW4gYWR2aXNvcnktbG9jayBydW5uZXIgZm9yIG9uZSBtb2RlbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmd9fSBhcmdzIC0gUnVubmVyIGRlcGVuZGVuY2llcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uUHJvdmlkZXIsIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5jb25uZWN0aW9uUHJvdmlkZXIgPSBjb25uZWN0aW9uUHJvdmlkZXJcbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBhZnRlciBhY3F1aXJpbmcgdGhlIGFkdmlzb3J5IGxvY2ssIHdhaXRpbmcgdXAgdG8gYHRpbWVvdXRNc2AuXG4gICAqIFdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHRydWUgdGhlIGxvY2sgaXMgYWNxdWlyZWQgb24gYSBzcGF3bmVkXG4gICAqIGNvbm5lY3Rpb24gdGhhdCBpcyByZWxlYXNlZCBhZnRlciB0aGUgY2FsbGJhY2sgZmluaXNoZXMsIHdoaWxlIHRoZSBjYWxsYmFja1xuICAgKiBpdHNlbGYgc3RpbGwgcnVucyBhZ2FpbnN0IHRoZSBjYWxsZXIvbW9kZWwgY29ubmVjdGlvbi4gV2hlbiBhIGBob2xkVGltZW91dE1zYFxuICAgKiBpcyBzZXQgdGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5IGZvciBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24gKGBjb250cm9sLmNoZWNrKClgLCBgY29udHJvbC5zaWduYWxgLCBgY29udHJvbC50aW1lZE91dGAsXG4gICAqIGBjb250cm9sLnJlbWFpbmluZygpYCk7IGEgZGVkaWNhdGVkIGNvbm5lY3Rpb24gaXMgYWxzbyB1c2VkIHNvIHRpbWVvdXRcbiAgICogY2xlYW51cCBjYW4gcmVsZWFzZSB0aGUgbG9jayBldmVuIGlmIGNhbGxiYWNrIGRhdGFiYXNlIHdvcmsgaXMgc3R1Y2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w/OiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBMb2NrIGFuZCBob2xkIHRpbWVvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgbG9ja1NlcnZlclJlc3VsdCA9IGF3YWl0IHRoaXMuYXR0ZW1wdExvY2tTZXJ2ZXIoe2FyZ3MsIGNhbGxiYWNrLCBtb2RlOiBcIndhaXRcIiwgbmFtZX0pXG5cbiAgICAvLyBUaGUgd2FpdCBtb2RlIG5ldmVyIHJldHVybnMgYSBkZWZlcnJlZCBvdXRjb21lLCBzbyB0aGUgdmFsdWUgbWVtYmVyIGlzIHByZXNlbnQuXG4gICAgaWYgKGxvY2tTZXJ2ZXJSZXN1bHQpIHJldHVybiAvKiogQHR5cGUge3t2YWx1ZTogVH19ICovIChsb2NrU2VydmVyUmVzdWx0KS52YWx1ZVxuXG4gICAgY29uc3QgZmlsZUJhY2tlbmQgPSBhd2FpdCB0aGlzLmZpbGVCYWNrZW5kRm9yTmFtZShuYW1lKVxuXG4gICAgaWYgKGZpbGVCYWNrZW5kKSB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGZpbGVCYWNrZW5kLmFjcXVpcmUobmFtZSwge3RpbWVvdXRNczogdGhpcy5hY3F1aXJlVGltZW91dE1zKGFyZ3MpfSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yKGBUaW1lZCBvdXQgd2FpdGluZyBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSBvbiB0aGUgZmlsZSB0aWVyYCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2NrQmFja2VuZCA9IHRoaXMuZmlsZVByb3ZlbmFuY2UoZmlsZUJhY2tlbmQsIG5hbWUpXG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5yZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7YmFja2VuZDogbG9ja0JhY2tlbmQuYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZDogbG9ja0JhY2tlbmQuZmVuY2luZ1N1cHBvcnRlZCwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWUsIHJlbGVhc2U6IGFzeW5jICgpID0+IGF3YWl0IGZpbGVCYWNrZW5kLnJlbGVhc2UobmFtZSl9KVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmRyaXZlclByb3ZlbmFuY2UoY29ubmVjdGlvbilcblxuICAgICAgdGhpcy5hc3NlcnREcml2ZXJUaWVyRWxpZ2libGUobmFtZSwgbG9ja0JhY2tlbmQpXG5cbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgY29ubmVjdGlvbi5hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIGFyZ3MpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcihgVGltZWQgb3V0IHdhaXRpbmcgZm9yIGFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX1gLCB7bmFtZX0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5yZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7YmFja2VuZDogbG9ja0JhY2tlbmQuYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZDogbG9ja0JhY2tlbmQuZmVuY2luZ1N1cHBvcnRlZCwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWUsIHJlbGVhc2U6IGFzeW5jICgpID0+IGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgb25seSBpZiB0aGUgYWR2aXNvcnkgbG9jayBjYW4gYmUgYWNxdWlyZWQgaW1tZWRpYXRlbHkuXG4gICAqIFdoZW4gYGRlZGljYXRlZENvbm5lY3Rpb25gIGlzIHRydWUgdGhlIGxvY2sgaXMgYWNxdWlyZWQgb24gYSBzcGF3bmVkXG4gICAqIGNvbm5lY3Rpb24gdGhhdCBpcyByZWxlYXNlZCBhZnRlciB0aGUgY2FsbGJhY2sgZmluaXNoZXMsIHdoaWxlIHRoZSBjYWxsYmFja1xuICAgKiBpdHNlbGYgc3RpbGwgcnVucyBhZ2FpbnN0IHRoZSBjYWxsZXIvbW9kZWwgY29ubmVjdGlvbi4gV2hlbiBhIGBob2xkVGltZW91dE1zYFxuICAgKiBpcyBzZXQgdGhlIGNhbGxiYWNrIHJlY2VpdmVzIGEgYFRpbWVvdXRDb250cm9sYCBmcm9tIGF3YWl0ZXJ5IGZvciBjb29wZXJhdGl2ZVxuICAgKiBjYW5jZWxsYXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w/OiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3tob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBIb2xkIHRpbWVvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgbG9ja1NlcnZlclJlc3VsdCA9IGF3YWl0IHRoaXMuYXR0ZW1wdExvY2tTZXJ2ZXIoe2FyZ3MsIGNhbGxiYWNrLCBtb2RlOiBcIm9yLWZhaWxcIiwgbmFtZX0pXG5cbiAgICAvLyBUaGUgb3ItZmFpbCBtb2RlIHRocm93cyBvbiBjb250ZW50aW9uLCBzbyB0aGUgdmFsdWUgbWVtYmVyIGlzIHByZXNlbnQuXG4gICAgaWYgKGxvY2tTZXJ2ZXJSZXN1bHQpIHJldHVybiAvKiogQHR5cGUge3t2YWx1ZTogVH19ICovIChsb2NrU2VydmVyUmVzdWx0KS52YWx1ZVxuXG4gICAgY29uc3QgZmlsZUJhY2tlbmQgPSBhd2FpdCB0aGlzLmZpbGVCYWNrZW5kRm9yTmFtZShuYW1lKVxuXG4gICAgaWYgKGZpbGVCYWNrZW5kKSB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGZpbGVCYWNrZW5kLnRyeUFjcXVpcmUobmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgICB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrQnVzeUVycm9yKGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IGlzIGFscmVhZHkgaGVsZCBvbiB0aGUgZmlsZSB0aWVyYCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2NrQmFja2VuZCA9IHRoaXMuZmlsZVByb3ZlbmFuY2UoZmlsZUJhY2tlbmQsIG5hbWUpXG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5yZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7YmFja2VuZDogbG9ja0JhY2tlbmQuYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZDogbG9ja0JhY2tlbmQuZmVuY2luZ1N1cHBvcnRlZCwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWUsIHJlbGVhc2U6IGFzeW5jICgpID0+IGF3YWl0IGZpbGVCYWNrZW5kLnJlbGVhc2UobmFtZSl9KVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhMb2NrQ29ubmVjdGlvbihhcmdzLCBhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmRyaXZlclByb3ZlbmFuY2UoY29ubmVjdGlvbilcblxuICAgICAgdGhpcy5hc3NlcnREcml2ZXJUaWVyRWxpZ2libGUobmFtZSwgbG9ja0JhY2tlbmQpXG5cbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgY29ubmVjdGlvbi50cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja0J1c3lFcnJvcihgQWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSBpcyBhbHJlYWR5IGhlbGRgLCB7bmFtZX0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5yZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7YmFja2VuZDogbG9ja0JhY2tlbmQuYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZDogbG9ja0JhY2tlbmQuZmVuY2luZ1N1cHBvcnRlZCwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWUsIHJlbGVhc2U6IGFzeW5jICgpID0+IGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGlmIHRoZSBhZHZpc29yeSBsb2NrIGNhbiBiZSBhY3F1aXJlZCB3aXRob3V0IHdhaXRpbmc7XG4gICAqIG90aGVyd2lzZSByZXR1cm5zIGEgYHthY3F1aXJlZDogZmFsc2V9YCBkZWZlciByZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAgICpcbiAgICogVGhpcyBpcyB0aGUgbm9uLXRocm93aW5nIGNvdW50ZXJwYXJ0IG9mIGB3aXRoQWR2aXNvcnlMb2NrT3JGYWlsYCBmb3IgaG90XG4gICAqIHBhdGhzOiBcImhvbGRlciBidXN5LCBkZWZlciBtZVwiIGlzIGEgZmlyc3QtY2xhc3Mgb3V0Y29tZSwgc28gYSBjb250ZW5kZWRcbiAgICogbG9jayBwcm9kdWNlcyB6ZXJvIGV4Y2VwdGlvbiB0cmFmZmljIGFuZCDigJQgYmVjYXVzZSB0aGUgcHJvYmUgaXMgYSBzaW5nbGVcbiAgICogaW1tZWRpYXRlIHRyeS1hY3F1aXJlIOKAlCB6ZXJvIHBpbm5lZCBjb25uZWN0aW9ucy4gQ2FsbGVycyByZXNjaGVkdWxlIHZpYVxuICAgKiB0aGVpciBvd24gZXZlbnQtZHJpdmVuIHJldHJ5IG1hY2hpbmVyeS4gVGhlIHJlc3VsdCBmb3JtIGlzIGlkZW50aWNhbFxuICAgKiBhY3Jvc3MgdGllcnM6IHRoZSBkcml2ZXIncyBgdHJ5QWNxdWlyZUFkdmlzb3J5TG9ja2AgbWFwcyBwZXItdGllciAoTXlTUUxcbiAgICogYEdFVF9MT0NLKG5hbWUsIDApYCwgUG9zdGdyZVNRTCBgcGdfdHJ5X2Fkdmlzb3J5X2xvY2tgLCBTUUwgU2VydmVyXG4gICAqIGBzcF9nZXRhcHBsb2NrIEBMb2NrVGltZW91dCA9IDBgLCBTUUxpdGUgcHJvY2Vzcy1sb2NhbCBxdWV1ZSwgU1FMaXRlIE5vZGVcbiAgICogZmlsZSBsb2NrKSwgc28gYSBjYWxsZXIgbmV2ZXIgYnJhbmNoZXMgb24gdGhlIGJhY2tlbmQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmdzPzoge2NvbnRyb2w/OiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3tob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBIb2xkIHRpbWVvdXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2FjcXVpcmVkOiB0cnVlLCByZXN1bHQ6IFR9IHwge2FjcXVpcmVkOiBmYWxzZSwgcmVhc29uOiBcImNvbnRlbmRlZFwiLCBsb2NrTmFtZTogc3RyaW5nfT59IC0gRWl0aGVyIHRoZSBoZWxkLWNhbGxiYWNrIHJlc3VsdCBvciB0aGUgZGVmZXIgb3V0Y29tZS5cbiAgICovXG4gIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckRlZmVyKG5hbWUsIGNhbGxiYWNrLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCBsb2NrU2VydmVyUmVzdWx0ID0gYXdhaXQgdGhpcy5hdHRlbXB0TG9ja1NlcnZlcih7YXJncywgY2FsbGJhY2ssIG1vZGU6IFwiZGVmZXJcIiwgbmFtZX0pXG5cbiAgICBpZiAobG9ja1NlcnZlclJlc3VsdCkge1xuICAgICAgaWYgKFwiZGVmZXJyZWRcIiBpbiBsb2NrU2VydmVyUmVzdWx0KSByZXR1cm4gbG9ja1NlcnZlclJlc3VsdC5kZWZlcnJlZFxuXG4gICAgICByZXR1cm4ge2FjcXVpcmVkOiB0cnVlLCByZXN1bHQ6IC8qKiBAdHlwZSB7e3ZhbHVlOiBUfX0gKi8gKGxvY2tTZXJ2ZXJSZXN1bHQpLnZhbHVlfVxuICAgIH1cblxuICAgIGNvbnN0IGZpbGVCYWNrZW5kID0gYXdhaXQgdGhpcy5maWxlQmFja2VuZEZvck5hbWUobmFtZSlcblxuICAgIGlmIChmaWxlQmFja2VuZCkge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBmaWxlQmFja2VuZC5hY3F1aXJlKG5hbWUsIHt0aW1lb3V0TXM6IDB9KVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSByZXR1cm4ge2FjcXVpcmVkOiBmYWxzZSwgcmVhc29uOiBcImNvbnRlbmRlZFwiLCBsb2NrTmFtZTogbmFtZX1cblxuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmZpbGVQcm92ZW5hbmNlKGZpbGVCYWNrZW5kLCBuYW1lKVxuXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucmVjb3JkQWR2aXNvcnlMb2NrQWNxdWlzaXRpb24oe2JhY2tlbmQ6IGxvY2tCYWNrZW5kLmJhY2tlbmQsIGZlbmNpbmdTdXBwb3J0ZWQ6IGxvY2tCYWNrZW5kLmZlbmNpbmdTdXBwb3J0ZWQsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7Y2FsbGJhY2ssIGhvbGRUaW1lb3V0TXM6IGFyZ3MuaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWUsIHJlbGVhc2U6IGFzeW5jICgpID0+IGF3YWl0IGZpbGVCYWNrZW5kLnJlbGVhc2UobmFtZSl9KVxuXG4gICAgICByZXR1cm4ge2FjcXVpcmVkOiB0cnVlLCByZXN1bHR9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGNvbm5lY3Rpb24udHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSByZXR1cm4ge2FjcXVpcmVkOiBmYWxzZSwgcmVhc29uOiBcImNvbnRlbmRlZFwiLCBsb2NrTmFtZTogbmFtZX1cblxuICAgICAgY29uc3QgbG9ja0JhY2tlbmQgPSB0aGlzLmRyaXZlclByb3ZlbmFuY2UoY29ubmVjdGlvbilcblxuICAgICAgdGhpcy5hc3NlcnREcml2ZXJUaWVyRWxpZ2libGUobmFtZSwgbG9ja0JhY2tlbmQpXG5cbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5yZWNvcmRBZHZpc29yeUxvY2tBY3F1aXNpdGlvbih7YmFja2VuZDogbG9ja0JhY2tlbmQuYmFja2VuZCwgZmVuY2luZ1N1cHBvcnRlZDogbG9ja0JhY2tlbmQuZmVuY2luZ1N1cHBvcnRlZCwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkxvY2tlZENhbGxiYWNrKHtjYWxsYmFjaywgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgY29ubmVjdGlvbi5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpfSlcblxuICAgICAgcmV0dXJuIHthY3F1aXJlZDogdHJ1ZSwgcmVzdWx0fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbG9jayBob2xkZXIgY2FsbGJhY2sgYW5kIHJlbGVhc2VzIHRoZSBsb2NrIGZyb20gaXRzIG93bmluZyBiYWNrZW5kLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tjYWxsYmFjazogKGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD4sIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2UsIG5hbWU6IHN0cmluZywgcmVsZWFzZTogKCkgPT4gUHJvbWlzZTx1bmtub3duPn19IGFyZ3MgLSBMb2NrZWQgY2FsbGJhY2sgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTG9ja2VkQ2FsbGJhY2soe2NhbGxiYWNrLCBob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCwgbmFtZSwgcmVsZWFzZX0pIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IEFkdmlzb3J5TG9ja1J1bm5lci5ydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMsIGxvY2tCYWNrZW5kKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCByZWxlYXNlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VydmVzIG9uZSBhY3F1aXNpdGlvbiBvbiB0aGUgbG9jay1zZXJ2ZXIgdGllciB3aGVuIHRoZSBsb2NrIG5hbWUgcHJlZmVyc1xuICAgKiBpdCAoZGVzaWduIMKnMS/CpzkpLCBmYWxsaW5nICp1cHdhcmQqIHRvIHRoZSBkcml2ZXIgcGF0aCB3aGVuIHRoZSBzZXJ2ZXIgaXNcbiAgICogdW5yZWFjaGFibGUgYW5kIHRoZSBuYW1lJ3MgbWluaW11bSB0aWVyIHBlcm1pdHMgYSBEQi1uYXRpdmUgaG9sZC5cbiAgICpcbiAgICogYG51bGxgIG1lYW5zIFwidGhpcyB0aWVyIGRpZCBub3Qgc2VydmUgdGhlIGFjcXVpc2l0aW9uIOKAlCBjb250aW51ZSB3aXRoIHRoZVxuICAgKiBuZXh0IGVsaWdpYmxlIHRpZXJcIi4gQSByZXR1cm5lZCB2YWx1ZSBtZWFucyB0aGUgbG9jay1zZXJ2ZXIgdGllciBhbnN3ZXJlZCxcbiAgICogaW5jbHVkaW5nIGEgZGVmaW5pdGl2ZSBidXN5L3RpbWVvdXQgb3V0Y29tZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7YXJnczoge2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCB0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfSwgY2FsbGJhY2s6IChhcmdzPzoge2NvbnRyb2w/OiBpbXBvcnQoXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCIpLlRpbWVvdXRDb250cm9sLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9KSA9PiBQcm9taXNlPFQ+LCBtb2RlOiBcIndhaXRcIiB8IFwib3ItZmFpbFwiIHwgXCJkZWZlclwiLCBuYW1lOiBzdHJpbmd9fSByZXF1ZXN0IC0gQWNxdWlzaXRpb24gcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2RlZmVycmVkOiB7YWNxdWlyZWQ6IGZhbHNlLCByZWFzb246IFwiY29udGVuZGVkXCIsIGxvY2tOYW1lOiBzdHJpbmd9fSB8IHt2YWx1ZTogVH0gfCBudWxsPn0gLSBSZXN1bHQgd2hlbiB0aGlzIHRpZXIgc2VydmVkIGl0LCBvdGhlcndpc2UgbnVsbC5cbiAgICovXG4gIGFzeW5jIGF0dGVtcHRMb2NrU2VydmVyKHthcmdzLCBjYWxsYmFjaywgbW9kZSwgbmFtZX0pIHtcbiAgICBjb25zdCBwb2xpY3kgPSByZXNvbHZlQWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeShuYW1lLCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QWR2aXNvcnlMb2NrUG9saWN5KCkpXG5cbiAgICBpZiAocG9saWN5LnByZWZlcnJlZFRpZXIgIT09IFwibG9jay1zZXJ2ZXJcIikgcmV0dXJuIG51bGxcbiAgICBpZiAoIXBvbGljeS5hbGxvd2VkVGllcnMuaW5jbHVkZXMoXCJsb2NrLXNlcnZlclwiKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGJhY2tlbmQgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QWR2aXNvcnlMb2NrTG9ja1NlcnZlckJhY2tlbmQoKVxuXG4gICAgaWYgKCFiYWNrZW5kKSB7XG4gICAgICB0aGlzLnJlcG9ydEFkdmlzb3J5TG9ja0ZhbGxiYWNrKHtyZWFzb246IFwibG9jay1zZXJ2ZXIgdGllciBpcyBub3QgZW5hYmxlZCBpbiBjb25maWd1cmF0aW9uXCIsIHNlcnZlZEJ5OiBcImRyaXZlci1uYXRpdmVcIiwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICBsZXQgYWNxdWlyZWRcblxuICAgIHRyeSB7XG4gICAgICBpZiAobW9kZSA9PT0gXCJ3YWl0XCIpIHtcbiAgICAgICAgYWNxdWlyZWQgPSBhd2FpdCBiYWNrZW5kLmFjcXVpcmUobmFtZSwge3RpbWVvdXRNczogdGhpcy5hY3F1aXJlVGltZW91dE1zKGFyZ3MpfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFjcXVpcmVkID0gYXdhaXQgYmFja2VuZC50cnlBY3F1aXJlKG5hbWUpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgQWR2aXNvcnlMb2NrU2VydmljZVVuYXZhaWxhYmxlRXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICBpZiAocG9saWN5Lm1pblRpZXIgPT09IFwibG9jay1zZXJ2ZXJcIikge1xuICAgICAgICB0aHJvdyBhZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGUoe1xuICAgICAgICAgIGxvY2tOYW1lOiBuYW1lLFxuICAgICAgICAgIG1pblRpZXI6IHBvbGljeS5taW5UaWVyLFxuICAgICAgICAgIHJlYXNvbnM6IFtgbG9jay1zZXJ2ZXIgdW5hdmFpbGFibGU6ICR7ZXJyb3IubWVzc2FnZX1gXVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICB0aGlzLnJlcG9ydEFkdmlzb3J5TG9ja0ZhbGxiYWNrKHtyZWFzb246IGVycm9yLm1lc3NhZ2UsIHNlcnZlZEJ5OiBcImRyaXZlci1uYXRpdmVcIiwgbG9ja05hbWU6IG5hbWV9KVxuXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmICghYWNxdWlyZWQpIHtcbiAgICAgIGlmIChtb2RlID09PSBcImRlZmVyXCIpIHJldHVybiB7ZGVmZXJyZWQ6IHthY3F1aXJlZDogZmFsc2UsIHJlYXNvbjogXCJjb250ZW5kZWRcIiwgbG9ja05hbWU6IG5hbWV9fVxuICAgICAgaWYgKG1vZGUgPT09IFwib3ItZmFpbFwiKSB0aHJvdyBuZXcgQWR2aXNvcnlMb2NrQnVzeUVycm9yKGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IGlzIGFscmVhZHkgaGVsZGAsIHtuYW1lfSlcblxuICAgICAgdGhyb3cgbmV3IEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcihgVGltZWQgb3V0IHdhaXRpbmcgZm9yIGFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX1gLCB7bmFtZX0pXG4gICAgfVxuXG4gICAgY29uc3QgZXBvY2ggPSBiYWNrZW5kLmdldEhvbGRFcG9jaChuYW1lKVxuICAgIGNvbnN0IGxvY2tCYWNrZW5kID0gLyoqIEB0eXBlIHtBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0gKi8gKHtcbiAgICAgIGJhY2tlbmQ6IFwibG9jay1zZXJ2ZXJcIixcbiAgICAgIGVwb2NoOiBlcG9jaCA/PyB1bmRlZmluZWQsXG4gICAgICBmZW5jaW5nU3VwcG9ydGVkOiB0cnVlLFxuICAgICAgbG9ja05hbWU6IG5hbWVcbiAgICB9KVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLnJlY29yZEFkdmlzb3J5TG9ja0FjcXVpc2l0aW9uKHtiYWNrZW5kOiBcImxvY2stc2VydmVyXCIsIGZlbmNpbmdTdXBwb3J0ZWQ6IHRydWUsIGxvY2tOYW1lOiBuYW1lfSlcblxuICAgICAgICBjb25zdCB2YWx1ZSA9IGF3YWl0IHRoaXMucnVuTG9ja1NlcnZlckhvbGQoe1xuICAgICAgYmFja2VuZCxcbiAgICAgIGNhbGxiYWNrLFxuICAgICAgaG9sZFRpbWVvdXRNczogYXJncy5ob2xkVGltZW91dE1zLFxuICAgICAgbG9ja0JhY2tlbmQsXG4gICAgICBuYW1lXG4gICAgfSlcblxuICAgIHJldHVybiB7dmFsdWV9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY3JpdGljYWwgc2VjdGlvbiB1bmRlciBhIGxvY2stc2VydmVyIGxlYXNlIGFuZCBzdXJmYWNlcyBhIGZlbmNlZFxuICAgKiBsZWFzZSBhcyBgQWR2aXNvcnlMb2NrTG9zdEVycm9yYCAoZGVzaWduIMKnOCk6IHRoZSBzZWN0aW9uIG1heSBoYXZlXG4gICAqIG92ZXJsYXBwZWQgYW5vdGhlciBob2xkZXIsIHNvIGl0cyBvdXRjb21lIG11c3Qgbm90IGJlIHRydXN0ZWQgYXMgZXhjbHVzaXZlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tiYWNrZW5kOiBpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXItYmFja2VuZC5qc1wiKS5kZWZhdWx0LCBjYWxsYmFjazogKGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD4sIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBsb2NrQmFja2VuZDogQWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2UsIG5hbWU6IHN0cmluZ319IGFyZ3MgLSBIb2xkIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bkxvY2tTZXJ2ZXJIb2xkKHtiYWNrZW5kLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcywgbG9ja0JhY2tlbmQsIG5hbWV9KSB7XG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB2YWx1ZVxuICAgIC8qKiBAdHlwZSB7dW5rbm93bn0gKi9cbiAgICBsZXQgY2FsbGJhY2tFcnJvclxuICAgIGxldCBmYWlsZWQgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIHZhbHVlID0gYXdhaXQgdGhpcy5ydW5Mb2NrZWRDYWxsYmFjayh7XG4gICAgICAgIGNhbGxiYWNrLFxuICAgICAgICBob2xkVGltZW91dE1zLFxuICAgICAgICBsb2NrQmFja2VuZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgcmVsZWFzZTogYXN5bmMgKCkgPT4gYXdhaXQgYmFja2VuZC5yZWxlYXNlKG5hbWUpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBmYWlsZWQgPSB0cnVlXG4gICAgICBjYWxsYmFja0Vycm9yID0gZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCBsb3NzID0gYmFja2VuZC50YWtlTG9zcyhuYW1lLCBsb2NrQmFja2VuZC5lcG9jaCA/PyBudWxsKVxuXG4gICAgaWYgKGxvc3MpIHtcbiAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tMb3N0RXJyb3IoXG4gICAgICAgIGBMb3N0IHRoZSBsZWFzZSBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSB3aGlsZSB0aGUgY3JpdGljYWwgc2VjdGlvbiB3YXMgcnVubmluZ2AsXG4gICAgICAgIHtcbiAgICAgICAgICBjYXVzZTogY2FsbGJhY2tFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gY2FsbGJhY2tFcnJvciA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBjdXJyZW50RXBvY2g6IGxvc3MuY3VycmVudEVwb2NoLFxuICAgICAgICAgIGVwb2NoOiBsb2NrQmFja2VuZC5lcG9jaCA/PyBudWxsLFxuICAgICAgICAgIGxvY2tOYW1lOiBuYW1lXG4gICAgICAgIH1cbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkKSB0aHJvdyBjYWxsYmFja0Vycm9yXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiBhY3F1aXNpdGlvbiBzZXJ2ZWQgYmVsb3cgdGhlIGxvY2sgbmFtZSdzIHByZWZlcnJlZCB0aWVyXG4gICAqIChkZXNpZ24gwqczKTogZXZlcnkgZmFsbGJhY2sgaXMgdmlzaWJsZSBvbiB0aGUgZnJhbWV3b3JrLWVycm9yIGNoYW5uZWwsIHNvIGFcbiAgICogc2lsZW50IGRvd25ncmFkZSBpcyBpbXBvc3NpYmxlLlxuICAgKiBAcGFyYW0ge3tsb2NrTmFtZTogc3RyaW5nLCByZWFzb246IHN0cmluZywgc2VydmVkQnk6IGltcG9ydChcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiKS5BZHZpc29yeUxvY2tUaWVyfX0gYXJncyAtIEZhbGxiYWNrIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVwb3J0QWR2aXNvcnlMb2NrRmFsbGJhY2soe2xvY2tOYW1lLCByZWFzb24sIHNlcnZlZEJ5fSkge1xuICAgIGNvbnN0IHBvbGljeSA9IHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5KGxvY2tOYW1lLCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QWR2aXNvcnlMb2NrUG9saWN5KCkpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IFwiYWR2aXNvcnktbG9jay1mYWxsYmFja1wiLFxuICAgICAgbG9ja05hbWUsXG4gICAgICBwcmVmZXJyZWRUaWVyOiBwb2xpY3kucHJlZmVycmVkVGllcixcbiAgICAgIHJlYXNvbixcbiAgICAgIHNlcnZlZEJ5XG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBiYWNrZW5kIHBvbGljeSBmb3Igb25lIGxvY2sgbmFtZSBhbmQgcmV0dXJucyB0aGUgZmlsZVxuICAgKiBiYWNrZW5kIHdoZW4gdGhlIG5hbWUgZXhwbGljaXRseSBvcHRzIGludG8gdGhlIGZpbGUgdGllclxuICAgKiAoYHByZWZlcnJlZFRpZXI6IFwiZmlsZVwiYCBwbHVzIGBhZHZpc29yeUxvY2tzLmJhY2tlbmRzLmZpbGUuZW5hYmxlZDogdHJ1ZWApLlxuICAgKiBBIG5hbWUgd2hvc2UgZGVjbGFyZWQgbWluaW11bSB0aWVyIGlzIGNyb3NzLWhvc3QgaXMgcmVmdXNlZCBsb3VkbHlcbiAgICogKGBBZHZpc29yeUxvY2tNaW5UaWVyUmVmdXNlZEVycm9yYCkgYmVmb3JlIGFueSBjb250YWN0IHdpdGggdGhlIGZpbGVcbiAgICogdGllci4gQSBuYW1lIHRoYXQgcHJlZmVycyB0aGUgZmlsZSB0aWVyIHdoaWxlIHRoZSBiYWNrZW5kIGlzIGRpc2FibGVkXG4gICAqIG1vdmVzIHRvIHRoZSBkcml2ZXIgcGF0aCAoYSBzdHJvbmdlci1vci1lcXVhbCB0aWVyKSwgbmV2ZXIgdGhlIG90aGVyIHdheVxuICAgKiBhcm91bmQuIE5vdGhpbmcgaGVyZSBldmVyIGF1dG8tZW5hYmxlcyB0aGUgZmlsZSB0aWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlsZSBiYWNrZW5kIHNlcnZpbmcgdGhpcyBuYW1lLCBvciBudWxsIGZvciB0aGUgZHJpdmVyIHBhdGguXG4gICAqL1xuICBhc3luYyBmaWxlQmFja2VuZEZvck5hbWUobmFtZSkge1xuICAgIGNvbnN0IHBvbGljeSA9IHJlc29sdmVBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5KG5hbWUsIHRoaXMuY29uZmlndXJhdGlvbi5nZXRBZHZpc29yeUxvY2tQb2xpY3koKSlcblxuICAgIGlmIChwb2xpY3kucHJlZmVycmVkVGllciAhPT0gXCJmaWxlXCIpIHJldHVybiBudWxsXG5cbiAgICBpZiAoIWFkdmlzb3J5TG9ja1BvbGljeUFsbG93c0ZpbGVUaWVyKHBvbGljeSkpIHtcbiAgICAgIHJlZnVzZUFkdmlzb3J5TG9ja1RpZXJCZWxvd01pbmltdW0oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGxvY2tOYW1lOiBuYW1lLFxuICAgICAgICBtaW5UaWVyOiBwb2xpY3kubWluVGllcixcbiAgICAgICAgcmVxdWVzdGVkQmFja2VuZDogXCJmaWxlXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgYmFja2VuZCA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRBZHZpc29yeUxvY2tGaWxlQmFja2VuZCgpXG5cbiAgICBpZiAoIWJhY2tlbmQpIHtcbiAgICAgIC8vIFByZWZlcnJlZCB0aWVyIHVuYXZhaWxhYmxlOiBmYWlsICp1cHdhcmQqIHRvIHRoZSBkcml2ZXIgcGF0aCAoYVxuICAgICAgLy8gc3Ryb25nZXItb3ItZXF1YWwgdGllciksIG5ldmVyIGRvd253YXJkLiBJZiB0aGUgZHJpdmVyIGNhbm5vdCBzYXRpc2Z5XG4gICAgICAvLyB0aGUgbWluaW11bSBlaXRoZXIsIGBhc3NlcnREcml2ZXJUaWVyRWxpZ2libGVgIHRocm93c1xuICAgICAgLy8gYEFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yYCBvbiB0aGUgZHJpdmVyIHBhdGguXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIHJldHVybiBiYWNrZW5kXG4gIH1cblxuICAvKipcbiAgICogRmFpbC1jbG9zZWQgY2hlY2sgb24gdGhlIGRyaXZlciBwYXRoIChkZXNpZ24gwqc5KTogYW4gdW5kZWNsYXJlZCBsb2NrIG5hbWVcbiAgICoga2VlcHMgdG9kYXkncyBiZWhhdmlvciAoYW55IGRyaXZlciBzZXJ2ZXMgaXQg4oCUIGZ1bGwgYmFja3dhcmRcbiAgICogY29tcGF0aWJpbGl0eSksIGJ1dCBhIG5hbWUgd2l0aCBhbiBleHBsaWNpdCBwb2xpY3kgZW50cnkgaXMgcmVmdXNlZCB3aXRoXG4gICAqIGBBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvcmAgd2hlbiB0aGUgY29uZmlndXJlZCBkcml2ZXIgY2Fubm90XG4gICAqIHNhdGlzZnkgaXRzIG1pbmltdW0gdGllciAoZS5nLiBgbWluVGllcjogXCJkcml2ZXItbmF0aXZlXCJgIG9uIGEgU1FMaXRlXG4gICAqIGRyaXZlciwgd2hpY2ggaGFzIG5vIG5hdGl2ZSBhZHZpc29yeS1sb2NrIHByaW1pdGl2ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge0Fkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSBsb2NrQmFja2VuZCAtIFRpZXIgdGhlIGRyaXZlciBwYXRoIHdvdWxkIHNlcnZlIHdpdGguXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RHJpdmVyVGllckVsaWdpYmxlKG5hbWUsIGxvY2tCYWNrZW5kKSB7XG4gICAgY29uc3QgcG9saWN5ID0gcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3kobmFtZSwgdGhpcy5jb25maWd1cmF0aW9uLmdldEFkdmlzb3J5TG9ja1BvbGljeSgpKVxuXG4gICAgaWYgKCFwb2xpY3kuZW50cnkpIHJldHVyblxuXG4gICAgY29uc3QgdGllciA9IGxvY2tCYWNrZW5kLmJhY2tlbmRcblxuICAgIGlmICh0aWVyID09PSBcInByb2Nlc3MtbG9jYWxcIiAmJiAhcG9saWN5LmFsbG93ZWRUaWVycy5pbmNsdWRlcyhcInByb2Nlc3MtbG9jYWxcIikpIHtcbiAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvcihcbiAgICAgICAgYEFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gcmVxdWlyZXMgbWluaW11bSB0aWVyICR7SlNPTi5zdHJpbmdpZnkocG9saWN5Lm1pblRpZXIpfSBidXQgdGhlIGNvbmZpZ3VyZWQgZHJpdmVyICgke1N0cmluZyhsb2NrQmFja2VuZC5kcml2ZXJUeXBlKX0pIG9ubHkgb2ZmZXJzIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXJgLFxuICAgICAgICB7bG9ja05hbWU6IG5hbWUsIG1pblRpZXI6IHBvbGljeS5taW5UaWVyLCByZWFzb25zOiBbYGRyaXZlciB0aWVyICR7dGllcn0gYmVsb3cgbWluVGllciAke3BvbGljeS5taW5UaWVyfWBdfVxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgd2FpdCBib3VuZCBmb3IgYSBmaWxlLXRpZXIgYWNxdWlzaXRpb246IGFuIGV4cGxpY2l0IGNhbGxlclxuICAgKiBgdGltZW91dE1zYCAoaW5jbHVkaW5nIGFuIGV4cGxpY2l0IGBudWxsYCBvcHQtb3V0KSB3aW5zLCBvdGhlcndpc2UgdGhlXG4gICAqIHNhbWUgZnJhbWV3b3JrIGRlZmF1bHQgdGhhdCBib3VuZHMgZHJpdmVyIGFjcXVpc2l0aW9ucyBhcHBsaWVzLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gYXJncyAtIExvY2sgb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gV2FpdCBib3VuZCBpbiBtaWxsaXNlY29uZHMsIG9yIGBudWxsYCBmb3IgYW4gaW5kZWZpbml0ZSB3YWl0LlxuICAgKi9cbiAgYWNxdWlyZVRpbWVvdXRNcyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MudGltZW91dE1zICE9PSB1bmRlZmluZWQpIHJldHVybiBhcmdzLnRpbWVvdXRNc1xuXG4gICAgcmV0dXJuIERFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGFjcXVpc2l0aW9uIHByb3ZlbmFuY2UgZm9yIGEgZmlsZS10aWVyIGhvbGQuIFRoZSBmaWxlIHRpZXJcbiAgICogY2Fubm90IGNhcnJ5IGZlbmNpbmcgdG9rZW5zLCBzbyB0aGUgbGltaXRhdGlvbiBpcyByZXBvcnRlZCBvbiBldmVyeVxuICAgKiBhY3F1aXNpdGlvbiByYXRoZXIgdGhhbiBzaWxlbnRseSBwcmV0ZW5kZWQgYXdheSAoZGVzaWduIMKnOCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0fSBiYWNrZW5kIC0gQmFja2VuZCB0aGF0IHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7QWR2aXNvcnlMb2NrQmFja2VuZFByb3ZlbmFuY2V9IC0gQWNxdWlzaXRpb24gcHJvdmVuYW5jZS5cbiAgICovXG4gIGZpbGVQcm92ZW5hbmNlKGJhY2tlbmQsIG5hbWUpIHtcbiAgICByZXR1cm4ge2JhY2tlbmQ6IFwiZmlsZVwiLCBmZW5jaW5nU3VwcG9ydGVkOiBmYWxzZSwgaG9sZGVySWQ6IGJhY2tlbmQuaG9sZGVySWQsIGxvY2tOYW1lOiBuYW1lfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYWNxdWlzaXRpb24gcHJvdmVuYW5jZSBmb3IgYSBkcml2ZXItc2VydmVkIGhvbGQuIFNRTGl0ZSBoYXMgbm9cbiAgICogbmF0aXZlIGFkdmlzb3J5LWxvY2sgcHJpbWl0aXZlLCBzbyBpdHMgZW11bGF0aW9uIHRpZXIgaXMgcmVwb3J0ZWQgYXNcbiAgICogYHByb2Nlc3MtbG9jYWxgIHJhdGhlciB0aGFuIHByZXRlbmRpbmcgdG8gYmUgZGF0YWJhc2UtbmF0aXZlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25uZWN0aW9uIHRoYXQgc2VydmVkIHRoZSBhY3F1aXNpdGlvbi5cbiAgICogQHJldHVybnMge0Fkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSAtIEFjcXVpc2l0aW9uIHByb3ZlbmFuY2UuXG4gICAqL1xuICBkcml2ZXJQcm92ZW5hbmNlKGNvbm5lY3Rpb24pIHtcbiAgICBsZXQgZHJpdmVyVHlwZSA9IG51bGxcblxuICAgIHRyeSB7XG4gICAgICBkcml2ZXJUeXBlID0gY29ubmVjdGlvbi5nZXRUeXBlKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFRlc3Qgc3R1YiBkcml2ZXJzIG1heSBub3QgaW1wbGVtZW50IGdldFR5cGUoKTsgdGhlIHRpZXIgYWxvbmUgaWRlbnRpZmllcyB0aGUgYmFja2VuZC5cbiAgICB9XG5cbiAgICBjb25zdCB0aWVyID0gdHlwZW9mIGNvbm5lY3Rpb24uYWR2aXNvcnlMb2NrQmFja2VuZFRpZXIgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBjb25uZWN0aW9uLmFkdmlzb3J5TG9ja0JhY2tlbmRUaWVyKClcbiAgICAgIDogKGRyaXZlclR5cGUgPT09IFwic3FsaXRlXCIgPyBcInByb2Nlc3MtbG9jYWxcIiA6IFwiZHJpdmVyLW5hdGl2ZVwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzXCIpLkFkdmlzb3J5TG9ja1RpZXJ9ICovICh0aWVyKSxcbiAgICAgIGRyaXZlclR5cGU6IGRyaXZlclR5cGUgPz8gdW5kZWZpbmVkLFxuICAgICAgZmVuY2luZ1N1cHBvcnRlZDogdGllciA9PT0gXCJkcml2ZXItbmF0aXZlXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2NrIHdvcmsgb24gdGhlIGNhbGxlciBjb25uZWN0aW9uIHVubGVzcyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgaXNcbiAgICogcmVxdWVzdGVkIG9yIGEgcG9zaXRpdmUgaG9sZCB0aW1lb3V0IG5lZWRzIGl0cyBvd24gbG9jayBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbiwgaG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBhcmdzIC0gTG9jayBjb25uZWN0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KGNvbm5lY3Rpb246IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgcmVjZWl2aW5nIHRoZSBjb25uZWN0aW9uIHRoYXQgb3ducyB0aGUgYWR2aXNvcnkgbG9jay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2l0aExvY2tDb25uZWN0aW9uKGFyZ3MsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgaG9sZFRpbWVvdXRNcyA9IGFyZ3MuaG9sZFRpbWVvdXRNc1xuXG4gICAgaWYgKGFyZ3MuZGVkaWNhdGVkQ29ubmVjdGlvbiB8fCAoaG9sZFRpbWVvdXRNcyAmJiBob2xkVGltZW91dE1zID4gMCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhEZWRpY2F0ZWRDb25uZWN0aW9uKGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh0aGlzLmNvbm5lY3Rpb25Qcm92aWRlcigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFNwYXducyBhIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24gYW5kIGNsb3NlcyBpdCBhZnRlciBsb2NrIHdvcmsgY29tcGxldGVzXG4gICAqIHdoZW4gdGhlIHNwYXduZWQgZHJpdmVyIG93bnMgdGhlIHVuZGVybHlpbmcgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoY29ubmVjdGlvbjogaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0aGF0IHJlY2VpdmVzIHRoZSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3aXRoRGVkaWNhdGVkQ29ubmVjdGlvbihjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKS5zcGF3bkNvbm5lY3Rpb24oKVxuXG4gICAgLy8gVGhlIHNwYXduZWQgZHJpdmVyIG93bnMgaXRzIHBoeXNpY2FsIGNvbm5lY3Rpb24gdW5sZXNzIGl0IGJvcnJvd3MgYSBzaGFyZWQgb25lXG4gICAgLy8gdmlhIGBnZXRDb25uZWN0aW9uYC4gQW4gb3duZWQgY29ubmVjdGlvbiBsaXZlcyBvdXRzaWRlIHRoZSBwb29scycgdHJhY2tlZCBzZXRzLFxuICAgIC8vIHNvIHJlZ2lzdGVyIGl0IHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQ6IGEgc2h1dGRvd24gdGhlbiBjbG9zZXMgaXQgKHJlbGVhc2luZyB0aGVcbiAgICAvLyBsb2NrKSBpbnN0ZWFkIG9mIG9ycGhhbmluZyBhIGhhbGYtb3BlbiBzZXNzaW9uIHVudGlsIHRoZSBEQiBgd2FpdF90aW1lb3V0YC5cbiAgICBjb25zdCBvd25zQ29ubmVjdGlvbiA9ICFjb25uZWN0aW9uLmdldEFyZ3MoKS5nZXRDb25uZWN0aW9uXG5cbiAgICBpZiAob3duc0Nvbm5lY3Rpb24pIHRoaXMuY29uZmlndXJhdGlvbi5yZWdpc3RlckFkdmlzb3J5TG9ja0Nvbm5lY3Rpb24oY29ubmVjdGlvbilcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKG93bnNDb25uZWN0aW9uKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi51bnJlZ2lzdGVyQWR2aXNvcnlMb2NrQ29ubmVjdGlvbihjb25uZWN0aW9uKVxuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBgY2FsbGJhY2tgLCByZWplY3Rpbmcgd2l0aCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaWYgaXQgaGFzXG4gICAqIG5vdCBzZXR0bGVkIHdpdGhpbiBgaG9sZFRpbWVvdXRNc2AuIFRoZSBjYWxsYmFjayBpcyBub3QgY2FuY2VsbGVkOyBjYWxsZXJzXG4gICAqIHVzZSBhIGRlZGljYXRlZCBhZHZpc29yeS1sb2NrIGNvbm5lY3Rpb24gc28gdGhlIGxvY2sgY2FuIHN0aWxsIGJlIHJlbGVhc2VkLlxuICAgKlxuICAgKiBUaGUgY2FsbGJhY2sgcmVjZWl2ZXMgYSBgVGltZW91dENvbnRyb2xgIGZyb20gYXdhaXRlcnksIGVuYWJsaW5nIGNvb3BlcmF0aXZlXG4gICAqIGNhbmNlbGxhdGlvbiB2aWEgYGNvbnRyb2wuY2hlY2soKWAsIGBjb250cm9sLnNpZ25hbGAsIGBjb250cm9sLnRpbWVkT3V0YCxcbiAgICogYW5kIGBjb250cm9sLnJlbWFpbmluZygpYCwgcGx1cyBgbG9ja0JhY2tlbmRgIHByb3ZlbmFuY2UgZm9yIHRoZSB0aWVyIHRoYXRcbiAgICogc2VydmVkIHRoZSBhY3F1aXNpdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUgKGZvciB0aGUgZXJyb3IgbWVzc2FnZSkuXG4gICAqIEBwYXJhbSB7KGFyZ3M/OiB7Y29udHJvbD86IGltcG9ydChcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIikuVGltZW91dENvbnRyb2wsIGxvY2tCYWNrZW5kOiBBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0pID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgaG9sZGluZyB0aGUgbG9jay5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbaG9sZFRpbWVvdXRNc10gLSBNYXggaG9sZCB0aW1lOyBmYWxzeSBkaXNhYmxlcyB0aGUgdGltZW91dC5cbiAgICogQHBhcmFtIHtBZHZpc29yeUxvY2tCYWNrZW5kUHJvdmVuYW5jZX0gW2xvY2tCYWNrZW5kXSAtIFByb3ZlbmFuY2Ugb2YgdGhlIGFjcXVpc2l0aW9uIHNlcnZpbmcgdGhpcyBob2xkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zLCBsb2NrQmFja2VuZCkge1xuICAgIGlmICghaG9sZFRpbWVvdXRNcyB8fCBob2xkVGltZW91dE1zIDw9IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7bG9ja0JhY2tlbmQ6IGxvY2tCYWNrZW5kID8/IEFkdmlzb3J5TG9ja1J1bm5lci51bmtub3duQmFja2VuZFByb3ZlbmFuY2UoKX0pXG4gICAgfVxuXG4gICAgbGV0IGNhbGxiYWNrU2V0dGxlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IGhvbGRUaW1lb3V0TXN9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHtjb250cm9sLCBsb2NrQmFja2VuZDogbG9ja0JhY2tlbmQgPz8gQWR2aXNvcnlMb2NrUnVubmVyLnVua25vd25CYWNrZW5kUHJvdmVuYW5jZSgpfSlcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBjYWxsYmFja1NldHRsZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghY2FsbGJhY2tTZXR0bGVkIHx8IGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yKGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IGhlbGQgbG9uZ2VyIHRoYW4gJHtob2xkVGltZW91dE1zfW1zYCwge25hbWV9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOZXV0cmFsIHByb3ZlbmFuY2UgZm9yIGRpcmVjdCBgcnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0YCBjYWxsZXJzIHRoYXRcbiAgICogaG9sZCBhIGxvY2sgYWNxdWlyZWQgb3V0c2lkZSB0aGlzIHJ1bm5lci5cbiAgICogQHJldHVybnMge0Fkdmlzb3J5TG9ja0JhY2tlbmRQcm92ZW5hbmNlfSAtIFByb3ZlbmFuY2Ugd2l0aCBhbiB1bmtub3duIHRpZXIuXG4gICAqL1xuICBzdGF0aWMgdW5rbm93bkJhY2tlbmRQcm92ZW5hbmNlKCkge1xuICAgIHJldHVybiB7YmFja2VuZDogXCJwcm9jZXNzLWxvY2FsXCIsIGZlbmNpbmdTdXBwb3J0ZWQ6IGZhbHNlfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhZHZpc29yeSBsb2NrIHBvbGljeSBhbGxvd3MgZmlsZSB0aWVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuUmVzb2x2ZWRBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5fSBwb2xpY3kgLSBSZXNvbHZlZCBwb2xpY3kuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmaWxlIHRpZXIgbWF5IHNlcnZlIHRoaXMgbmFtZS5cbiAqL1xuZnVuY3Rpb24gYWR2aXNvcnlMb2NrUG9saWN5QWxsb3dzRmlsZVRpZXIocG9saWN5KSB7XG4gIHJldHVybiBwb2xpY3kuYWxsb3dlZFRpZXJzLmluY2x1ZGVzKFwiZmlsZVwiKVxufVxuXG5leHBvcnQge0Fkdmlzb3J5TG9ja0J1c3lFcnJvciwgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciwgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yfVxuZXhwb3J0IHtBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvciwgQWR2aXNvcnlMb2NrTWluVGllclJlZnVzZWRFcnJvcn0gZnJvbSBcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiXG5leHBvcnQge0Fkdmlzb3J5TG9ja0xvc3RFcnJvciwgQWR2aXNvcnlMb2NrU2VydmljZVVuYXZhaWxhYmxlRXJyb3J9IGZyb20gXCIuL2Fkdmlzb3J5LWxvY2stZXJyb3JzLmpzXCJcbiJdfQ==