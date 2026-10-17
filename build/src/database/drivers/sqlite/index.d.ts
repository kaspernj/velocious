import Base from "./base.js";
export default class VelociousDatabaseDriversSqliteNode extends Base {
    /**
     * Connection.
     * @type {import("sqlite").Database | undefined} */
    connection: import("sqlite").Database | undefined;
    /**
     * Advisory lock directory.
     * @type {string | undefined} */
    _advisoryLockDirectory: string | undefined;
    connect(): Promise<void>;
    localStorageName(): string;
    databasePath(): string;
    _close(): Promise<void>;
    deleteDatabaseStorage(): Promise<void>;
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query actual.
     */
    _queryActual(sql: string, options?: import("../base.js").QueryOptions): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql: string): Promise<number>;
    /**
     * The filesystem lock directory is this driver's driver-native tier on
     * top of the shared process-local pre-filter tier from the base driver,
     * so SQLite deployments with multiple Node processes writing to the same
     * database file see consistent advisory-lock mutual exclusion across
     * processes, not just within a single process.
     * @returns {boolean} - Always true for the Node SQLite driver.
     */
    supportsDriverNativeAdvisoryLock(): boolean;
    /**
     * Filesystem lock directory as the driver-native tier on top of the
     * shared process-local pre-filter tier from the base driver, so SQLite
     * deployments with multiple Node processes writing to the same database
     * file see consistent advisory-lock mutual exclusion across processes,
     * not just within a single process.
     *
     * The base driver's process-local tier serializes same-process callers
     * first (no filesystem round trip for uncontended traffic); this hook
     * is only reached once the tier has granted the caller its turn, and its
     * result is what confirms cross-process exclusion for SQLite.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
     * @returns {Promise<boolean>} - Whether the advisory lock was acquired.
     */
    _acquireAdvisoryLock(name: string, { timeoutMs }?: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock was acquired immediately.
     */
    _tryAcquireAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Releases the on-disk lock directory for a lock this driver instance
     * acquired through the base driver's two-tier chain. A caller that tries
     * to release a lock it never acquired (or that was already released by
     * another driver) gets `false` back and the filesystem state is left
     * alone so we never delete somebody else's lock directory.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock was released.
     */
    _releaseAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Filesystem-tier view for the base driver's `isAdvisoryLockHeld`, which
     * answers from the process-local tier first and only asks this hook when
     * the tier has no owner for the name.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock file is held.
     */
    _isAdvisoryLockHeldNative(name: string): Promise<boolean>;
    /**
     * The Node SQLite driver layers the opt-in file tier on top of the
     * process-local pre-filter, so telemetry reports it as `file`.
     * @returns {string} - Tier name reported on telemetry payloads.
     */
    advisoryLockBackendTier(): string;
    /**
     * Attribute the named lock to the file-tier owner recorded in
     * `owner.json` (`pid@hostname`), captured at the telemetry event moment
     * (best-effort; the caller guards failures). Falls back to the
     * process-local owner when the filesystem lock is not the holder.
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - File lock owner identity, or null when no process holds the lock.
     */
    advisoryLockHolderConnectionId(name: string): Promise<string | null>;
    /**
     * Runs resolve advisory lock directory.
     * @returns {string} - The advisory-lock directory.
     */
    _resolveAdvisoryLockDirectory(): string;
    /**
     * Runs advisory lock path.
     * @param {string} name - Lock name.
     * @returns {string} - Filesystem path for the advisory lock.
     */
    _advisoryLockPath(name: string): string;
    /**
     * Runs ensure advisory lock directory.
     * @returns {Promise<void>} */
    _ensureAdvisoryLockDirectory(): Promise<void>;
    /**
     * Runs write advisory lock metadata.
     * @param {string} lockDirPath - Absolute path of the lock directory.
     * @returns {Promise<void>}
     */
    _writeAdvisoryLockMetadata(lockDirPath: string): Promise<void>;
    /**
     * Publishes a fully initialized lock directory with one atomic rename.
     * A losing candidate is removed in the same call, so concurrent acquisition
     * cannot observe or delete another process's half-written owner metadata.
     * @param {string} lockPath - Stable advisory-lock path.
     * @returns {Promise<boolean>} - Whether this candidate became the lock owner.
     */
    _publishAdvisoryLockDirectory(lockPath: string): Promise<boolean>;
    /**
     * Runs acquire advisory lock file.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} args - Timeout args.
     * @returns {Promise<boolean>} - Whether the advisory-lock file was acquired.
     */
    _acquireAdvisoryLockFile(name: string, { timeoutMs }: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Runs try acquire advisory lock file.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory-lock file was acquired immediately.
     */
    _tryAcquireAdvisoryLockFile(name: string): Promise<boolean>;
    /**
     * Runs release advisory lock file.
     * @param {string} name - Lock name.
     * @returns {Promise<void>}
     */
    _releaseAdvisoryLockFile(name: string): Promise<void>;
    /**
     * Runs is advisory lock file held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory-lock file exists and is active.
     */
    _isAdvisoryLockFileHeld(name: string): Promise<boolean>;
    /**
     * A lock directory is considered stale when its owner metadata names a
     * PID on this host that is no longer running. Cross-host ownership (a
     * different `hostname`) is treated as live because we cannot reliably
     * probe a PID on another machine; operators in that situation should
     * remove stale lock directories by hand if they linger.
     * @param {string} lockPath - Absolute path of the lock directory.
     * @returns {Promise<boolean>} - Whether the advisory-lock file is stale.
     */
    _isAdvisoryLockStale(lockPath: string): Promise<boolean>;
}
//# sourceMappingURL=index.d.ts.map