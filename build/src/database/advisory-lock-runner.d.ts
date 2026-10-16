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
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Lock and hold timeout options.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withAdvisoryLock<T>(name: string, callback: (args?: {
        control: import("awaitery/build/timeout.js").TimeoutControl;
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
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - Hold timeout options.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    withAdvisoryLockOrFail<T>(name: string, callback: (args?: {
        control: import("awaitery/build/timeout.js").TimeoutControl;
    }) => Promise<T>, args?: {
        holdTimeoutMs?: number | null;
        dedicatedConnection?: boolean;
    }): Promise<T>;
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
    withAdvisoryLockOrDefer<T>(name: string, callback: (args?: {
        control: import("awaitery/build/timeout.js").TimeoutControl;
    }) => Promise<T>, args?: {
        holdTimeoutMs?: number | null;
        dedicatedConnection?: boolean;
    }): Promise<{
        acquired: true;
        result: T;
    } | {
        acquired: false;
        reason: "contended";
        lockName: string;
    }>;
    /**
     * Runs the lock holder callback and releases the lock from its owning connection.
     * @template T
     * @param {{callback: (args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>, connection: import("./drivers/base.js").default, holdTimeoutMs?: number | null, name: string}} args - Locked callback args.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    runLockedCallback<T>({ callback, connection, holdTimeoutMs, name }: {
        callback: (args?: {
            control: import("awaitery/build/timeout.js").TimeoutControl;
        }) => Promise<T>;
        connection: import("./drivers/base.js").default;
        holdTimeoutMs?: number | null;
        name: string;
    }): Promise<T>;
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
     * and `control.remaining()`.
     * @template T
     * @param {string} name - Lock name (for the error message).
     * @param {(args?: {control: import("awaitery/build/timeout.js").TimeoutControl}) => Promise<T>} callback - Callback holding the lock.
     * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
     * @returns {Promise<T>} - Resolves with the callback result.
     */
    static runWithAdvisoryLockHoldTimeout<T>(name: string, callback: (args?: {
        control: import("awaitery/build/timeout.js").TimeoutControl;
    }) => Promise<T>, holdTimeoutMs?: number | null): Promise<T>;
}
export { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError };
//# sourceMappingURL=advisory-lock-runner.d.ts.map