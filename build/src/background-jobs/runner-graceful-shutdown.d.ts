import Configuration from "../configuration.js";
export type RunnerCloseableConfiguration = {
    disconnectBeacon: () => Promise<void>;
    closeDatabaseConnections: () => Promise<void>;
    shutdown: () => Promise<void>;
};
/**
 * Gracefully closes a background-job runner's framework connections (beacon +
 * database) on shutdown, so the database server ends the session and releases any
 * advisory lock the runner still holds *immediately* — instead of leaving a
 * half-open session that keeps the lock (e.g. the build-planner lock) held until
 * the server's idle `wait_timeout` (hours).
 *
 * A runner child otherwise exits abruptly on shutdown (`process.exit`) and relies
 * on the OS tearing down its sockets. A named lock releases only when its owning
 * session ends, and an abrupt exit / container teardown does not reliably deliver a
 * clean disconnect to the server — so the lock leaks. Sending a real close here
 * (`COM_QUIT` via `closeDatabaseConnections`) makes the server end the session and
 * release the lock deterministically.
 *
 * The beacon disconnect and the database close run independently, each bounded by
 * `closeTimeoutMs`: the database close releases the locks and must still run even if
 * the beacon disconnect hangs (a wedged beacon socket during teardown), and neither
 * may block the exit forever. A failed or timed-out close is thrown, not swallowed —
 * the caller surfaces it (a lock that failed to release must be visible).
 * @param {RunnerCloseableConfiguration | null} configuration - Configuration whose connections to close; null when none is set (nothing to close).
 * @param {number} [closeTimeoutMs] - Max time to spend on each close before giving up.
 * @returns {Promise<void>} - Resolves once both closes have settled; rejects if either failed.
 */
export declare function closeRunnerConnections(configuration: RunnerCloseableConfiguration | null, closeTimeoutMs?: number): Promise<void>;
/**
 * Closes only a pooled runner's framework connections while its application
 * process lifecycle remains active for later jobs.
 * @param {RunnerCloseableConfiguration | null} configuration - Configuration whose framework connections to close.
 * @param {number} [closeTimeoutMs] - Max time for each framework close.
 * @returns {Promise<void>} - Resolves after framework cleanup.
 */
export declare function closeRunnerFrameworkConnections(configuration: RunnerCloseableConfiguration | null, closeTimeoutMs?: number): Promise<void>;
/**
 * The current configuration, or null when none has been set yet — a runner that is
 * signalled before it runs any job holds no connections (and no locks) to close.
 * Only that expected "not set yet" case is treated as null; any other error is a real
 * fault and is rethrown rather than masked.
 * @returns {Configuration | null} - The current configuration, or null when none is set.
 */
export declare function currentConfigurationOrNull(): Configuration | null;
//# sourceMappingURL=runner-graceful-shutdown.d.ts.map