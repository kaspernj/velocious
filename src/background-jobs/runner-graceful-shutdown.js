// @ts-check

import timeout from "awaitery/build/timeout.js"

import Configuration, {CurrentConfigurationNotSetError} from "../configuration.js"

/** Bounded grace for closing framework connections on shutdown before forcing exit. */
const SHUTDOWN_CLOSE_TIMEOUT_MS = 5000

/**
 * The subset of a configuration a runner closes on shutdown. Typed structurally so
 * the shutdown path stays typechecked without a broad cast, and a future signature
 * drift surfaces at the call sites (and in tests) instead of hiding behind `any`.
 * @typedef {{disconnectBeacon: () => Promise<void>, closeDatabaseConnections: () => Promise<void>}} RunnerCloseableConfiguration
 */

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
export async function closeRunnerConnections(configuration, closeTimeoutMs = SHUTDOWN_CLOSE_TIMEOUT_MS) {
  if (!configuration) return

  const [beaconResult, databaseResult] = await Promise.allSettled([
    timeout({timeout: closeTimeoutMs}, () => configuration.disconnectBeacon()),
    timeout({timeout: closeTimeoutMs}, () => configuration.closeDatabaseConnections())
  ])

  /** @type {unknown[]} */
  const errors = []

  if (beaconResult.status == "rejected") errors.push(beaconResult.reason)
  if (databaseResult.status == "rejected") errors.push(databaseResult.reason)

  if (errors.length == 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, "Failed to close background-job runner connections on shutdown")
}

/**
 * The current configuration, or null when none has been set yet — a runner that is
 * signalled before it runs any job holds no connections (and no locks) to close.
 * Only that expected "not set yet" case is treated as null; any other error is a real
 * fault and is rethrown rather than masked.
 * @returns {Configuration | null} - The current configuration, or null when none is set.
 */
export function currentConfigurationOrNull() {
  try {
    return Configuration.current()
  } catch (error) {
    if (error instanceof CurrentConfigurationNotSetError) return null

    throw error
  }
}
