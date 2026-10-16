export type AdvisoryLockBackendProvenance = {
    /**
     * - Tier that served the acquisition.
     */
    backend: import("./advisory-lock-backend-policy.js").AdvisoryLockTier;
    /**
     * - Database driver type when the driver tier served it.
     */
    driverType?: string;
    /**
     * - Whether this tier carries fencing tokens (design §8); the file tier reports false rather than pretending.
     */
    fencingSupported: boolean;
    /**
     * - Backend holder id for the file tier.
     */
    holderId?: string;
    /**
     * - Lock name this provenance belongs to.
     */
    lockName?: string;
};
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
declare class AdvisoryLockTimeoutError extends Error {
    lockName: string;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{name: string}} args - The advisory lock name that timed out.
     */
    constructor(message: string, { name }: {
        name: string;
    });
}
/**
 * Thrown when `withAdvisoryLockOrFail` finds the lock already held.
 */
declare class AdvisoryLockBusyError extends Error {
    lockName: string;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{name: string}} args - The advisory lock name that was already held.
     */
    constructor(message: string, { name }: {
        name: string;
    });
}
/**
 * Thrown when a callback holds an advisory lock longer than `holdTimeoutMs`.
 */
declare class AdvisoryLockHoldTimeoutError extends Error {
    lockName: string;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{name: string}} args - The advisory lock name whose hold timed out.
     */
    constructor(message: string, { name }: {
        name: string;
    });
}
/**
 * Runs advisory locks on the caller connection by default, using a dedicated
 * lock connection when `dedicatedConnection` is requested or when a positive
 * hold timeout needs separate ownership.
 */
export default class AdvisoryLockRunner {
    configuration: import("../configuration.js").default;
    connectionProvider: () => import("./drivers/base.js").default;
    databaseIdentifier: string;
    /**
     * Creates an advisory-lock runner for one model database identifier.
     * @param {{configuration: import("../configuration.js").default, connectionProvider: () => import("./drivers/base.js").default, databaseIdentifier: string}} args - Runner dependencies.
     */
    constructor({ configuration, connectionProvider, databaseIdentifier }: {
        configuration: import("../configuration.js").default;
        connectionProvider: () => import("./drivers/base.js").default;
        databaseIdentifier: string;
    });
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
    withAdvisoryLock<T>(name: string, callback: (args?: {
        control?: import("awaitery/build/timeout.js").TimeoutControl;
        lockBackend: AdvisoryLockBackendProvenance;
    }) => Promise<T>, args?: {
        timeoutMs?: number | null;
        holdTimeoutMs?: number | null;
        dedicatedConnection?: boolean;
    }): Promise<T>;
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
    withAdvisoryLockOrFail<T>(name: string, callback: (args?: {
        control?: import("awaitery/build/timeout.js").TimeoutControl;
        lockBackend: AdvisoryLockBackendProvenance;
    }) => Promise<T>, args?: {
        holdTimeoutMs?: number | null;
        dedicatedConnection?: boolean;
    }): Promise<T>;
    /**
     * Runs the lock holder callback and releases the lock from its owning backend.
     * @template T
     * @param {{callback: (args?: {control?: import("awaitery/build/timeout.js").TimeoutControl, lockBackend: AdvisoryLockBackendProvenance}) => Promise<T>, holdTimeoutMs?: number | null, lockBackend: AdvisoryLockBackendProvenance, name: string, release: () => Promise<unknown>}} args - Locked callback args.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    runLockedCallback<T>({ callback, holdTimeoutMs, lockBackend, name, release }: {
        callback: (args?: {
            control?: import("awaitery/build/timeout.js").TimeoutControl;
            lockBackend: AdvisoryLockBackendProvenance;
        }) => Promise<T>;
        holdTimeoutMs?: number | null;
        lockBackend: AdvisoryLockBackendProvenance;
        name: string;
        release: () => Promise<unknown>;
    }): Promise<T>;
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
    fileBackendForName(name: string): Promise<import("./advisory-lock-file-backend.js").default | null>;
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
    assertDriverTierEligible(name: string, lockBackend: AdvisoryLockBackendProvenance): void;
    /**
     * Resolves the wait bound for a file-tier acquisition: an explicit caller
     * `timeoutMs` (including an explicit `null` opt-out) wins, otherwise the
     * same framework default that bounds driver acquisitions applies.
     * @param {{timeoutMs?: number | null}} args - Lock options.
     * @returns {number | null} - Wait bound in milliseconds, or `null` for an indefinite wait.
     */
    fileAcquireTimeoutMs(args: {
        timeoutMs?: number | null;
    }): number | null;
    /**
     * Builds the acquisition provenance for a file-tier hold. The file tier
     * cannot carry fencing tokens, so the limitation is reported on every
     * acquisition rather than silently pretended away (design §8).
     * @param {import("./advisory-lock-file-backend.js").default} backend - Backend that served the acquisition.
     * @param {string} name - Lock name.
     * @returns {AdvisoryLockBackendProvenance} - Acquisition provenance.
     */
    fileProvenance(backend: import("./advisory-lock-file-backend.js").default, name: string): AdvisoryLockBackendProvenance;
    /**
     * Builds the acquisition provenance for a driver-served hold. SQLite has no
     * native advisory-lock primitive, so its emulation tier is reported as
     * `process-local` rather than pretending to be database-native.
     * @param {import("./drivers/base.js").default} connection - Connection that served the acquisition.
     * @returns {AdvisoryLockBackendProvenance} - Acquisition provenance.
     */
    driverProvenance(connection: import("./drivers/base.js").default): AdvisoryLockBackendProvenance;
    /**
     * Runs lock work on the caller connection unless `dedicatedConnection` is
     * requested or a positive hold timeout needs its own lock connection.
     * @template T
     * @param {{dedicatedConnection?: boolean, holdTimeoutMs?: number | null}} args - Lock connection options.
     * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback receiving the connection that owns the advisory lock.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withLockConnection<T>(args: {
        dedicatedConnection?: boolean;
        holdTimeoutMs?: number | null;
    }, callback: (connection: import("./drivers/base.js").default) => Promise<T>): Promise<T>;
    /**
     * Spawns a dedicated lock connection and closes it after lock work completes
     * when the spawned driver owns the underlying physical connection.
     * @template T
     * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback that receives the dedicated lock connection.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withDedicatedConnection<T>(callback: (connection: import("./drivers/base.js").default) => Promise<T>): Promise<T>;
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
    static runWithAdvisoryLockHoldTimeout<T>(name: string, callback: (args?: {
        control?: import("awaitery/build/timeout.js").TimeoutControl;
        lockBackend: AdvisoryLockBackendProvenance;
    }) => Promise<T>, holdTimeoutMs?: number | null, lockBackend?: AdvisoryLockBackendProvenance): Promise<T>;
    /**
     * Neutral provenance for direct `runWithAdvisoryLockHoldTimeout` callers that
     * hold a lock acquired outside this runner.
     * @returns {AdvisoryLockBackendProvenance} - Provenance with an unknown tier.
     */
    static unknownBackendProvenance(): AdvisoryLockBackendProvenance;
}
export { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError };
export { AdvisoryLockBackendUnavailableError, AdvisoryLockMinTierRefusedError } from "./advisory-lock-backend-policy.js";
//# sourceMappingURL=advisory-lock-runner.d.ts.map